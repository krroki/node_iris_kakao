from __future__ import annotations

import json
import atexit
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from . import audit as audit_mod
from .config import AuditConfig, CourseConfig, DEFAULT_CONFIG_PATH, GradeRules, OpenchatAutoLoadConfig, load_config, repo_root
from .crawler import crawl_cafe_members
from .iris import fetch_loaded_member_count, fetch_openchat_members, fetch_room_meta, fetch_rooms, read_iris_base, read_realtime_base
from .room_infer import infer_room_type_and_course_key
from .sheets import (
    append_rows,
    apply_actions_sheet_format,
    apply_overview_sheet_format,
    batch_update_rows,
    build_sheets_client,
    clear_values,
    delete_rows_range,
    ensure_sheet_exists,
    get_values,
    move_sheet_to_index,
    update_values,
)


def _now_ms() -> int:
    return int(time.time() * 1000)


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _iso_from_ms(ms: int) -> str:
    try:
        return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).replace(microsecond=0).isoformat()
    except Exception:
        return _iso_now()


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return ""


def _read_json(path: Path) -> dict:
    raw = _read_text(path).strip()
    if not raw:
        return {}
    try:
        j = json.loads(raw)
    except Exception:
        return {}
    return j if isinstance(j, dict) else {}


def _write_json_atomic(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _safe_filename(s: str) -> str:
    # Windows 파일명 안전(공백/한글은 허용, 금지문자만 치환)
    bad = '<>:"/\\\\|?*'
    out = "".join("_" if ch in bad else ch for ch in str(s or "").strip())
    return out or "course"


def _col_letter(n: int) -> str:
    if n <= 0:
        raise ValueError("n must be >= 1")
    s = ""
    x = n
    while x > 0:
        x, r = divmod(x - 1, 26)
        s = chr(ord("A") + r) + s
    return s


def _pad_row(row: list[str], n: int) -> list[str]:
    r = [str(x) for x in (row or [])]
    if len(r) < n:
        r = r + [""] * (n - len(r))
    return r[:n]


def _is_true(v: object) -> bool:
    s = str(v or "").strip().upper()
    return s in ("1", "TRUE", "T", "Y", "YES")


def _build_key_tuple(header_to_idx: dict[str, int], row: list[str], key_cols: list[str]) -> Optional[tuple[str, ...]]:
    parts: list[str] = []
    for col in key_cols:
        idx = header_to_idx.get(col)
        if idx is None:
            return None
        parts.append(str(row[idx] if idx < len(row) else "").strip())
    if any(not p for p in parts):
        return None
    return tuple(parts)


def _format_key_for_log(key_cols: list[str], key: tuple[str, ...]) -> str:
    pairs = []
    for c, v in zip(key_cols, key):
        if c == "courseKey":
            continue
        pairs.append(f"{c}={v}")
    return ";".join(pairs) if pairs else ";".join([f"{c}={v}" for c, v in zip(key_cols, key)])


def _json_compact(obj: dict[str, str]) -> str:
    try:
        return json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    except Exception:
        return str(obj)


def _get_row_val(row: list[str], header_to_idx: dict[str, int], col: str) -> str:
    idx = header_to_idx.get(col)
    if idx is None:
        return ""
    return str(row[idx] if idx < len(row) else "").strip()


def _upsert_sheet_rows(
    *,
    svc,
    spreadsheet_id: str,
    sheet_name: str,
    rows: list[list[str]],
    key_cols: list[str],
    now_iso: str,
    extra_cols: list[str],
    ignore_update_cols: set[str],
    log_fields: list[str],
    log_rows: list[list[str]],
    course_key: str,
    max_detail_logs: int = 200,
) -> dict:
    if not rows:
        return {"inserted": 0, "updated": 0, "left": 0, "rejoined": 0, "init": False}

    new_header = [str(x).strip() for x in (rows[0] or [])]
    if not new_header:
        return {"inserted": 0, "updated": 0, "left": 0, "rejoined": 0, "init": False}

    required_header = list(new_header)
    for c in extra_cols:
        if c not in required_header:
            required_header.append(c)

    existing = get_values(svc, spreadsheet_id, sheet_name)
    if not existing:
        out_rows: list[list[str]] = []
        header_to_idx = {c: i for i, c in enumerate(required_header)}
        for i, r in enumerate(rows):
            if i == 0:
                out_rows.append(required_header)
                continue
            base = _pad_row(r, len(required_header))
            # presence cols init
            if "present" in header_to_idx:
                base[header_to_idx["present"]] = "TRUE"
            if "firstSeenAt" in header_to_idx:
                base[header_to_idx["firstSeenAt"]] = now_iso
            if "leftAt" in header_to_idx:
                base[header_to_idx["leftAt"]] = ""
            out_rows.append(base)

        update_values(svc, spreadsheet_id, sheet_name, out_rows)

        # init summary only (avoid log 폭주)
        log_rows.append([now_iso, course_key, sheet_name, "INIT", "", f"rows={max(0, len(out_rows)-1)}", "", ""])
        return {"inserted": max(0, len(out_rows) - 1), "updated": 0, "left": 0, "rejoined": 0, "init": True}

    existing_header = [str(x).strip() for x in (existing[0] or [])]
    final_header = list(existing_header)
    for c in required_header:
        if c not in final_header:
            final_header.append(c)

    header_changed = final_header != existing_header
    last_col = _col_letter(len(final_header))

    if header_changed:
        batch_update_rows(svc, spreadsheet_id, sheet_name, [(1, _pad_row(final_header, len(final_header)))], last_col=last_col)

    header_to_idx = {c: i for i, c in enumerate(final_header)}

    # build existing index
    existing_index: dict[tuple[str, ...], tuple[int, list[str]]] = {}
    dup_keys = 0
    dup_rows: list[tuple[tuple[str, ...], int, list[str]]] = []

    present_idx_existing = header_to_idx.get("present")

    def is_present(row: list[str]) -> bool:
        if present_idx_existing is None:
            return True
        cell = str(row[present_idx_existing] if present_idx_existing < len(row) else "").strip()
        return True if cell == "" else _is_true(cell)

    for i, r in enumerate(existing[1:] if len(existing) > 1 else []):
        row_no = i + 2
        rr = _pad_row(r, len(final_header))
        key = _build_key_tuple(header_to_idx, rr, key_cols)
        if not key:
            continue

        if key in existing_index:
            dup_keys += 1
            kept_row_no, kept_row = existing_index[key]
            kept_present = is_present(kept_row)
            cur_present = is_present(rr)

            # prefer present=TRUE row, otherwise prefer the later row (newer append)
            keep_current = False
            if cur_present and not kept_present:
                keep_current = True
            elif cur_present == kept_present:
                keep_current = row_no > kept_row_no

            if keep_current:
                dup_rows.append((key, kept_row_no, kept_row))
                existing_index[key] = (row_no, rr)
            else:
                dup_rows.append((key, row_no, rr))
            continue

        existing_index[key] = (row_no, rr)

    # build new rows index
    new_header_to_idx = {c: i for i, c in enumerate(new_header)}
    new_index: dict[tuple[str, ...], list[str]] = {}
    new_dup = 0
    for r in rows[1:]:
        rr = [str(x).strip() for x in (r or [])]
        key_parts: list[str] = []
        ok = True
        for c in key_cols:
            idx = new_header_to_idx.get(c)
            if idx is None:
                ok = False
                break
            key_parts.append(str(rr[idx] if idx < len(rr) else "").strip())
        if not ok or any(not p for p in key_parts):
            continue
        key = tuple(key_parts)
        if key in new_index:
            new_dup += 1
        new_index[key] = rr

    inserted = 0
    updated = 0
    left = 0
    rejoined = 0
    dup_deactivated = 0

    updates: list[tuple[int, list[str]]] = []
    appends: list[list[str]] = []

    def add_log(action: str, key: tuple[str, ...], old_row: Optional[list[str]], new_row: Optional[list[str]]) -> None:
        if max_detail_logs <= 0:
            return
        if len(log_rows) >= max_detail_logs:
            return
        key_str = _format_key_for_log(key_cols, key)
        old_map: dict[str, str] = {}
        new_map: dict[str, str] = {}
        for f in log_fields:
            if old_row is not None:
                old_map[f] = _get_row_val(old_row, header_to_idx, f)
            if new_row is not None:
                new_map[f] = _get_row_val(new_row, header_to_idx, f)

        changed_fields: list[str] = []
        for f in log_fields:
            if old_map.get(f, "") != new_map.get(f, ""):
                changed_fields.append(f)

        if action == "UPDATE":
            # UPDATE인데 (로그 필드 기준) 의미있는 변경이 없으면 로그 생략
            if not changed_fields:
                return
            # present 컬럼 신규 도입 시(blank->TRUE) 마이그레이션 로그는 스팸이므로 생략
            if (
                changed_fields == ["present"]
                and old_map.get("present", "") == ""
                and new_map.get("present", "").upper() == "TRUE"
            ):
                return

        log_rows.append(
            [
                now_iso,
                course_key,
                sheet_name,
                action,
                key_str,
                ",".join(changed_fields),
                _json_compact(old_map) if old_map else "",
                _json_compact(new_map) if new_map else "",
            ]
        )

    # upsert: updates + inserts
    for key, new_raw in new_index.items():
        if key in existing_index:
            row_no, old_row = existing_index[key]
            next_row = list(old_row)

            changed_any = False
            for col in new_header:
                if col in ignore_update_cols:
                    continue
                idx_new = new_header_to_idx.get(col)
                idx_old = header_to_idx.get(col)
                if idx_new is None or idx_old is None:
                    continue
                new_val = str(new_raw[idx_new] if idx_new < len(new_raw) else "").strip()
                old_val = str(next_row[idx_old] if idx_old < len(next_row) else "").strip()
                if new_val != old_val:
                    next_row[idx_old] = new_val
                    changed_any = True

            present_idx = header_to_idx.get("present")
            leftat_idx = header_to_idx.get("leftAt")
            first_seen_idx = header_to_idx.get("firstSeenAt")
            old_present = True
            if present_idx is not None:
                cell = str(next_row[present_idx] or "").strip()
                old_present = True if cell == "" else _is_true(cell)
            if present_idx is not None:
                next_row[present_idx] = "TRUE"
                if not old_present:
                    if leftat_idx is not None:
                        next_row[leftat_idx] = ""
                    if first_seen_idx is not None and not str(next_row[first_seen_idx] or "").strip():
                        next_row[first_seen_idx] = now_iso
                    changed_any = True
                    rejoined += 1
                else:
                    # blank -> TRUE(마이그레이션) 포함: present는 항상 TRUE로 정규화
                    if str(old_row[present_idx] if present_idx is not None else "").strip() != "TRUE":
                        if leftat_idx is not None:
                            next_row[leftat_idx] = ""
                        if first_seen_idx is not None and not str(next_row[first_seen_idx] or "").strip():
                            next_row[first_seen_idx] = now_iso
                        changed_any = True

            if changed_any:
                updates.append((row_no, _pad_row(next_row, len(final_header))))
                updated += 1
                add_log("REJOIN" if (present_idx is not None and not old_present) else "UPDATE", key, old_row, next_row)
        else:
            new_row = [""] * len(final_header)
            for col in new_header:
                idx_new = new_header_to_idx.get(col)
                idx_final = header_to_idx.get(col)
                if idx_new is None or idx_final is None:
                    continue
                new_row[idx_final] = str(new_raw[idx_new] if idx_new < len(new_raw) else "").strip()
            if "present" in header_to_idx:
                new_row[header_to_idx["present"]] = "TRUE"
            if "firstSeenAt" in header_to_idx:
                new_row[header_to_idx["firstSeenAt"]] = now_iso
            if "leftAt" in header_to_idx:
                new_row[header_to_idx["leftAt"]] = ""
            appends.append(_pad_row(new_row, len(final_header)))
            inserted += 1
            add_log("INSERT", key, None, new_row)

    # mark missing rows as left
    present_idx = header_to_idx.get("present")
    if present_idx is not None:
        # duplicates: ensure only one row per key is effectively active
        if dup_rows:
            for _key, row_no, old_row in dup_rows:
                cell = str(old_row[present_idx] if present_idx < len(old_row) else "").strip()
                was_present = True if cell == "" else _is_true(cell)
                if not was_present:
                    continue
                next_row = list(old_row)
                next_row[present_idx] = "FALSE"
                if "leftAt" in header_to_idx:
                    next_row[header_to_idx["leftAt"]] = now_iso
                updates.append((row_no, _pad_row(next_row, len(final_header))))
                dup_deactivated += 1

        for key, (row_no, old_row) in existing_index.items():
            if key in new_index:
                continue
            cell = str(old_row[present_idx] or "").strip()
            is_present = True if cell == "" else _is_true(cell)
            if not is_present:
                continue
            next_row = list(old_row)
            next_row[present_idx] = "FALSE"
            if "leftAt" in header_to_idx:
                next_row[header_to_idx["leftAt"]] = now_iso
            updates.append((row_no, _pad_row(next_row, len(final_header))))
            left += 1
            add_log("LEFT", key, old_row, next_row)

    # bulk apply
    if updates:
        batch_update_rows(svc, spreadsheet_id, sheet_name, updates, last_col=last_col)
    if appends:
        append_rows(svc, spreadsheet_id, sheet_name, appends, last_col=last_col)

    if dup_keys or new_dup:
        extra = f"dup existing={dup_keys}, new={new_dup}"
        if dup_deactivated:
            extra = f"{extra}, deactivated={dup_deactivated}"
        log_rows.append([now_iso, course_key, sheet_name, "WARN", "", extra, "", ""])

    log_rows.append(
        [
            now_iso,
            course_key,
            sheet_name,
            "SUMMARY",
            "",
            f"inserted={inserted},updated={updated},left={left},rejoined={rejoined}",
            "",
            "",
        ]
    )
    return {"inserted": inserted, "updated": updated, "left": left, "rejoined": rejoined, "init": False}


class CourseMembershipAuditWorker:
    def __init__(self, root: Path, config_path: Path):
        self.root = root
        self.config_path = config_path
        self.realtime_base = read_realtime_base()
        self.iris_base = read_iris_base(root)

        self.status_path = self.root / "node-iris-app" / "data" / "course_membership_audit_worker_status.json"
        self.state_path = self.root / "node-iris-app" / "data" / "course_membership_audit_worker_state.json"
        self.lock_path = self.root / "node-iris-app" / "data" / "locks" / "course_membership_audit_worker.lock"
        self._lock_fp = None
        self._lock_offset = 4096

        self.state: dict = {}

        # watchdog는 status.heartbeatTs가 300초 이상 stale이면 워커를 재기동한다.
        # 크롤링/시트 업서트처럼 오래 걸리는 작업 중에도 heartbeat를 주기적으로 갱신해야
        # 정상 동작 중인 워커가 "heartbeat stale"로 오판되어 중복 실행되는 문제(카페 창 다중 생성)를 막을 수 있다.
        self._status_extra: dict[str, Any] = {}
        self._status_lock = threading.Lock()

    def _friendly_error(self, raw_err: str) -> str:
        s = str(raw_err or "").strip()
        if not s:
            return "알 수 없는 오류가 발생했어요."

        if "IRIS /query 호출 실패" in s or "IRIS /query 실패" in s:
            return "카카오톡 데이터(멤버 DB) 연결에 실패했어요. IRIS 연결을 확인해주세요."
        if "Realtime API /rooms" in s:
            return "방 목록을 불러오지 못했어요. 서버 상태를 확인해주세요."

        if "settings.json" in s and ("찾지 못했습니다" in s or "없습니다" in s):
            return "카페 로그인 설정(settings.json)을 찾지 못했어요."
        if "naver_id/naver_pw" in s:
            return "카페 로그인 정보(naver_id/naver_pw)가 비어 있어요."
        if "카페 크롤링 실패" in s:
            return "카페 멤버를 불러오지 못했어요. 로그인/권한을 확인해주세요."

        # Google Sheets 권한/대상 오류
        if ("The caller does not have permission" in s) or ("insufficientPermissions" in s) or ("PERMISSION_DENIED" in s):
            return "서비스계정이 스프레드시트 편집 권한이 없어요. 시트를 서비스계정 이메일에 Editor로 공유해주세요."
        if ("Requested entity was not found" in s) or ("notFound" in s):
            return "스프레드시트를 찾지 못했어요. URL/ID를 확인해주세요."

        # 너무 긴/난해한 메시지는 사용자용으로 축약
        if len(s) > 160:
            return s[:160] + "…"
        return s

    def _openchat_auto_load_state(self) -> dict:
        st = self.state.get("openchatAutoLoad")
        if not isinstance(st, dict):
            st = {}
        by_room = st.get("lastByRoomMs")
        if not isinstance(by_room, dict):
            by_room = {}
        st["lastByRoomMs"] = by_room
        try:
            st["lastGlobalMs"] = int(st.get("lastGlobalMs") or 0)
        except Exception:
            st["lastGlobalMs"] = 0
        self.state["openchatAutoLoad"] = st
        return st

    def _maybe_openchat_auto_load(
        self,
        *,
        course_key: str,
        room_type: str,
        room_label: str,
        room_id: str,
        active: Optional[int],
        loaded: int,
        cfg: OpenchatAutoLoadConfig,
    ) -> bool:
        if not cfg.enabled:
            return False

        if active is None or int(active) <= 0:
            return False
        if loaded >= int(active):
            return False

        now_ms = _now_ms()
        st = self._openchat_auto_load_state()
        by_room = st.get("lastByRoomMs") if isinstance(st.get("lastByRoomMs"), dict) else {}
        last_room_ms = 0
        try:
            last_room_ms = int(by_room.get(room_id) or 0)
        except Exception:
            last_room_ms = 0
        last_global_ms = 0
        try:
            last_global_ms = int(st.get("lastGlobalMs") or 0)
        except Exception:
            last_global_ms = 0

        room_wait_ms = max(0, int(cfg.cooldown_room_sec) * 1000 - (now_ms - last_room_ms))
        global_wait_ms = max(0, int(cfg.cooldown_global_sec) * 1000 - (now_ms - last_global_ms))
        wait_ms = max(room_wait_ms, global_wait_ms)
        if wait_ms > 0:
            wait_sec = int((wait_ms + 999) / 1000)
            self._append_course_event(
                course_key=course_key,
                level="INFO",
                stage="OPENCHAT_LOAD",
                pct=25,
                message=f"{room_label} 멤버 DB 로딩은 잠시 후 다시 시도돼요(쿨다운 {wait_sec}s)",
            )
            self._save_state()
            return False

        script = (self.root / "scripts" / "openchat_load_members.ps1").resolve()
        if not script.exists():
            self._append_course_event(
                course_key=course_key,
                level="WARN",
                stage="OPENCHAT_LOAD",
                pct=25,
                message=f"{room_label} 멤버 DB 로딩 스크립트를 찾지 못했어요(자동 로딩 스킵)",
            )
            self._save_state()
            return False

        log_dir = (self.root / "logs" / "course_membership_audit" / "openchat_load_members" / _safe_filename(course_key)).resolve()
        log_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        out_path = log_dir / f"{room_type}.{room_id}.{ts}.out.log"
        err_path = log_dir / f"{room_type}.{room_id}.{ts}.err.log"

        args = [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            str(script),
            "-RoomId",
            str(room_id),
            "-Scrolls",
            str(int(cfg.scrolls)),
            "-ScrollPauseMs",
            str(int(cfg.scroll_pause_ms)),
            "-IrisQueryBase",
            str(self.iris_base),
        ]
        if str(cfg.adb_serial or "").strip():
            args += ["-Serial", str(cfg.adb_serial).strip()]

        self._set_course_progress(
            course_key=course_key,
            stage="OPENCHAT_LOAD",
            message=f"{room_label} 멤버 DB 로딩 중(loaded {loaded}/{active})",
            pct=25,
        )

        code = 999
        try:
            with open(out_path, "wb") as out_f, open(err_path, "wb") as err_f:
                p = subprocess.Popen(args, cwd=str(self.root), stdout=out_f, stderr=err_f)
                try:
                    p.wait(timeout=float(cfg.timeout_sec))
                except subprocess.TimeoutExpired:
                    try:
                        p.kill()
                    except Exception:
                        pass
                    code = 124
                else:
                    code = int(p.returncode or 0)
        except Exception as e:
            self._append_course_event(
                course_key=course_key,
                level="WARN",
                stage="OPENCHAT_LOAD",
                pct=25,
                message=f"{room_label} 멤버 DB 로딩 실행에 실패했어요({e})",
            )
            self._save_state()
            return False
        finally:
            # 쿨다운은 '시도' 기준으로 잡아 thrash를 막는다.
            try:
                by_room[room_id] = int(now_ms)
            except Exception:
                by_room[room_id] = now_ms
            st["lastByRoomMs"] = by_room
            st["lastGlobalMs"] = int(now_ms)
            self.state["openchatAutoLoad"] = st
            self._save_state()

        if code == 0:
            self._append_course_event(
                course_key=course_key,
                level="INFO",
                stage="OPENCHAT_LOAD",
                pct=30,
                message=f"{room_label} 멤버 DB 로딩 완료(재조회 중)",
            )
            self._save_state()
            return True

        if code == 124:
            self._append_course_event(
                course_key=course_key,
                level="WARN",
                stage="OPENCHAT_LOAD",
                pct=30,
                message=f"{room_label} 멤버 DB 로딩이 시간 초과로 중단됐어요(로그 확인)",
            )
            self._save_state()
            return False

        self._append_course_event(
            course_key=course_key,
            level="WARN",
            stage="OPENCHAT_LOAD",
            pct=30,
            message=f"{room_label} 멤버 DB 로딩에 실패했어요(로그 확인)",
        )
        self._save_state()
        return False

    def _append_course_event(
        self,
        *,
        course_key: str,
        level: str,
        message: str,
        stage: str = "",
        pct: Optional[int] = None,
    ) -> None:
        cs = self._course_state(course_key)
        events = cs.get("events")
        if not isinstance(events, list):
            events = []

        ev: dict[str, Any] = {
            "ts": _iso_now(),
            "level": str(level or "INFO"),
            "message": str(message or "").strip(),
        }
        if stage:
            ev["stage"] = str(stage)
        if pct is not None:
            try:
                ev["pct"] = int(pct)
            except Exception:
                pass

        events.append(ev)
        if len(events) > 80:
            events = events[-80:]
        cs["events"] = events

    def _set_course_progress(
        self,
        *,
        course_key: str,
        stage: str,
        message: str,
        pct: Optional[int] = None,
        level: str = "INFO",
    ) -> None:
        cs = self._course_state(course_key)
        progress = cs.get("progress")
        if not isinstance(progress, dict):
            progress = {}
        progress["stage"] = str(stage or "").strip()
        progress["message"] = str(message or "").strip()
        progress["ts"] = _iso_now()
        progress["ms"] = _now_ms()
        if pct is not None:
            try:
                progress["pct"] = int(pct)
            except Exception:
                pass
        cs["progress"] = progress
        self._append_course_event(course_key=course_key, level=level, message=message, stage=stage, pct=pct)
        self._save_state()

    def log(self, level: str, msg: str, **extra: Any) -> None:
        ts = datetime.now().strftime("%H:%M:%S")
        payload = f" {json.dumps(extra, ensure_ascii=False)}" if extra else ""
        print(f"[{ts}][{level}] {msg}{payload}", flush=True)

    def _write_status(self, **extra: Any) -> None:
        with self._status_lock:
            if extra:
                self._status_extra.update(extra)
            payload = {"pid": os.getpid(), "heartbeatTs": _iso_now(), "configPath": str(self.config_path)}
            payload.update(self._status_extra)
            _write_json_atomic(self.status_path, payload)

    def _load_state(self) -> None:
        try:
            self.state = _read_json(self.state_path) if self.state_path.exists() else {}
        except Exception as e:
            self.log("WARN", "state 로드 실패(무시)", err=str(e), path=str(self.state_path))
            self.state = {}
        if not isinstance(self.state, dict):
            self.state = {}

    def _save_state(self) -> None:
        try:
            _write_json_atomic(self.state_path, self.state)
        except Exception as e:
            self.log("WARN", "state 저장 실패(무시)", err=str(e), path=str(self.state_path))

    def _release_lock(self) -> None:
        fp = self._lock_fp
        self._lock_fp = None
        if not fp:
            return
        try:
            fp.seek(int(self._lock_offset or 0))
            if os.name == "nt":
                import msvcrt  # type: ignore

                msvcrt.locking(fp.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl  # type: ignore

                fcntl.flock(fp.fileno(), fcntl.LOCK_UN)
        except Exception:
            pass
        try:
            fp.close()
        except Exception:
            pass

    def _acquire_lock(self) -> None:
        """
        싱글톤 락(필수)
        - Windows에서는 `os.kill(pid, 0)`가 프로세스 생존 확인에 신뢰할 수 없어 중복 실행이 발생할 수 있다.
        - 파일 핸들을 열고 OS 파일 락을 잡아, 프로세스 종료 시 락이 자동 해제되도록 한다.
        """
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            try:
                fp = self.lock_path.open("r+", encoding="utf-8")
            except FileNotFoundError:
                fp = self.lock_path.open("w+", encoding="utf-8")
        except Exception as e:
            raise SystemExit(f"[오류] lock 파일 열기 실패: {self.lock_path} ({e})")

        try:
            fp.seek(int(self._lock_offset or 0))
            if os.name == "nt":
                import msvcrt  # type: ignore

                msvcrt.locking(fp.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl  # type: ignore

                fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            # 다른 프로세스가 락을 잡고 있으면 즉시 종료한다.
            other_pid = ""
            try:
                fp.seek(0)
                other_pid = (fp.read() or "").strip()
            except Exception:
                other_pid = ""
            try:
                fp.close()
            except Exception:
                pass

            hb_age_sec = None
            try:
                st = _read_json(self.status_path)
                hb = str(st.get("heartbeatTs") or "").strip()
                if hb:
                    dt = datetime.fromisoformat(hb.replace("Z", "+00:00")).astimezone(timezone.utc)
                    hb_age_sec = (datetime.now(timezone.utc) - dt).total_seconds()
            except Exception:
                hb_age_sec = None

            hint_parts = []
            if other_pid:
                hint_parts.append(f"pid={other_pid}")
            if hb_age_sec is not None:
                hint_parts.append(f"heartbeat age={int(hb_age_sec)}s")
            hint = f" ({', '.join(hint_parts)})" if hint_parts else ""
            raise SystemExit(f"[오류] course-membership-audit-worker 중복 실행 감지: {self.lock_path}{hint}")

        # 락 유지용 핸들을 인스턴스에 보관한다.
        self._lock_fp = fp
        atexit.register(self._release_lock)
        try:
            fp.seek(0)
            fp.truncate()
            fp.write(str(os.getpid()))
            fp.flush()
        except Exception:
            pass

    def _course_state(self, course_key: str) -> dict:
        cs = self.state.get("courses")
        if not isinstance(cs, dict):
            cs = {}
            self.state["courses"] = cs
        cur = cs.get(course_key)
        if not isinstance(cur, dict):
            cur = {}
            cs[course_key] = cur
        return cur

    def _ensure_worker_enabled_at(self, now_ms: int) -> int:
        enabled_at = int(self.state.get("enabledAtMs") or 0)
        if enabled_at <= 0:
            enabled_at = now_ms
            self.state["enabledAtMs"] = enabled_at
            self.state["enabledAtTs"] = _iso_from_ms(enabled_at)
        return enabled_at

    def _pick_interval_sec(self, cfg: AuditConfig, now_ms: int) -> int:
        enabled_at = self._ensure_worker_enabled_at(now_ms)
        hot_days = max(0, int(cfg.worker.hot_days))
        hot_ms = hot_days * 24 * 60 * 60 * 1000
        if hot_days > 0 and (now_ms - enabled_at) < hot_ms:
            return int(cfg.worker.hot_interval_sec)
        return int(cfg.worker.steady_interval_sec)

    def _resolve_service_account_json(self) -> str:
        sa = (
            str(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
            or str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
        )
        if sa:
            return sa
        default = (self.root / "data" / "gcp_service_account.json").resolve()
        return str(default)

    def _fetch_payment_ssot_records(
        self,
        svc: Any,
        course: CourseConfig,
        *,
        premium_enabled: bool,
    ) -> tuple[list[dict], dict[str, int]]:
        """
        결제/수기 SSOT(구글 시트)에서 코스 멤버 목록을 읽어온다.

        반환 레코드 스키마(최소):
          - ssotUserId, ssotNickname, ssotName, ssotGrade, ssotKind, ssotTrack, sourceRow

        NOTE:
          - 읽기 실패 시 fallback 하지 않는다(SSOT가 흔들리면 전체 판단이 깨짐).
          - 개인정보가 포함될 수 있으므로 여기서는 개별 행을 로그로 남기지 않는다.
        """
        pay = getattr(course, "payment_ssot", None)
        if not pay:
            return [], {"total": 0}

        def _norm(s: str) -> str:
            return audit_mod.normalize_cafe_nickname(str(s or "")).lower()

        sheet_name = str(getattr(pay, "sheet_name", "") or "").strip()
        header_row = int(getattr(pay, "header_row", 1) or 1)

        header_range = f"{sheet_name}!{header_row}:{header_row}"
        values = get_values(svc, pay.spreadsheet_id, header_range)
        header = values[0] if (values and isinstance(values[0], list)) else []
        header_norm = {_norm(str(v)): i for i, v in enumerate(header) if str(v or "").strip()}

        def _idx(col_name: str) -> int:
            k = _norm(col_name)
            if not k:
                return -1
            return int(header_norm.get(k, -1))

        idx_grade = _idx(pay.grade_col)
        idx_nick = _idx(pay.nickname_col)
        idx_id = _idx(pay.id_col)
        idx_kind = _idx(pay.kind_col)
        idx_name = _idx(getattr(pay, "name_col", "") or "")

        missing_cols: list[str] = []
        if idx_id < 0:
            missing_cols.append(str(pay.id_col))
        if idx_nick < 0:
            missing_cols.append(str(pay.nickname_col))
        if idx_grade < 0:
            missing_cols.append(str(pay.grade_col))
        if idx_kind < 0:
            missing_cols.append(str(pay.kind_col))
        if missing_cols:
            raise SystemExit(
                f"결제 SSOT 헤더({sheet_name} {header_row}행)에서 컬럼을 찾지 못했어요: {', '.join(missing_cols)}"
            )

        # 데이터(헤더 다음 행부터) - 행 단위로 읽는다
        # NOTE: row-only range는 trailing empty cells가 생략될 수 있으므로 index 접근 시 길이 체크 필요
        data_start = header_row + 1
        data_end = max(data_start, data_start + 5000)
        data_range = f"{sheet_name}!{data_start}:{data_end}"
        rows = get_values(svc, pay.spreadsheet_id, data_range)

        exclude_raw = [str(x or "").strip() for x in (pay.exclude_kinds or []) if str(x or "").strip()]
        exclude_keys = [_norm(x) for x in exclude_raw if _norm(x)]

        def _cell(row: list, i: int) -> str:
            if i < 0:
                return ""
            if i >= len(row):
                return ""
            return str(row[i] or "").strip()

        def _split_nickname_change(raw: str) -> tuple[str, list[str]]:
            """
            운영자가 결제 시트에 'old->new' 형태로 기록한 경우를 지원한다.
            - 현재 닉네임: 마지막 토큰(= new)
            - 이전 닉네임: 그 이전 토큰들(= old...)
            """
            s = str(raw or "").strip()
            if not s:
                return "", []
            parts = [p.strip() for p in re.split(r"\s*(?:->|→)\s*", s) if str(p or "").strip()]
            if len(parts) <= 1:
                return s, []
            cur = parts[-1]
            prev = [p for p in parts[:-1] if p]
            return cur, prev

        def _should_exclude(kind_raw: str) -> bool:
            k = _norm(kind_raw)
            if not k:
                return False
            for ex in exclude_keys:
                if ex and ex in k:
                    return True
            return False

        stats: dict[str, int] = {
            "total": 0,
            "kept": 0,
            "excluded": 0,
            "missingId": 0,
            "missingNickname": 0,
            "deduped": 0,
            "staff": 0,
            "premium": 0,
            "normal": 0,
        }

        by_id: dict[str, dict] = {}
        order: list[str] = []

        for offset, row in enumerate(rows or []):
            if not isinstance(row, list):
                continue
            stats["total"] += 1

            ssot_user_id = _cell(row, idx_id)
            if not ssot_user_id:
                stats["missingId"] += 1
                continue

            ssot_nick_raw = _cell(row, idx_nick)
            ssot_nick, ssot_aliases = _split_nickname_change(ssot_nick_raw)
            if not ssot_nick:
                stats["missingNickname"] += 1

            ssot_grade = _cell(row, idx_grade)
            ssot_kind = _cell(row, idx_kind)
            ssot_name = _cell(row, idx_name)

            if _should_exclude(ssot_kind):
                stats["excluded"] += 1
                continue

            ssot_track = audit_mod.classify_track_from_payment(ssot_grade, ssot_kind)
            # 프리미엄방이 없는 코스에서는 프리미엄 트랙을 쓰지 않는다(전체를 일반로 간주).
            if (not premium_enabled) and ssot_track == "premium":
                ssot_track = "normal"
            stats[ssot_track] = int(stats.get(ssot_track) or 0) + 1

            rec = {
                "ssotUserId": ssot_user_id,
                "ssotNickname": ssot_nick,
                "ssotNicknameAliases": ssot_aliases,
                "ssotName": ssot_name,
                "ssotGrade": ssot_grade,
                "ssotKind": ssot_kind,
                "ssotTrack": ssot_track,
                "sourceRow": str(data_start + offset),
            }

            if ssot_user_id in by_id:
                stats["deduped"] += 1
                # 최신(더 아래 행)이 우선이라고 가정하고 overwrite
                by_id[ssot_user_id] = rec
            else:
                by_id[ssot_user_id] = rec
                order.append(ssot_user_id)

        out: list[dict] = [by_id[i] for i in order if i in by_id]
        stats["kept"] = len(out)
        return out, stats

    def _infer_rooms_for_course(self, course_key: str, rooms: list[dict]) -> Tuple[Optional[dict], str]:
        grouped: dict[str, list[dict]] = {"chat": [], "notice": [], "premium": []}
        for r in rooms:
            if not isinstance(r, dict):
                continue
            rid = str(r.get("roomId") or "").strip()
            rname = str(r.get("roomName") or "").strip()
            if not rid or not rname:
                continue
            rt, ck = infer_room_type_and_course_key(rname)
            if not rt or not ck:
                continue
            if ck != course_key:
                continue
            grouped[rt].append({"roomId": rid, "roomName": rname})

        out: dict[str, dict] = {}
        for rt in ["chat", "notice", "premium"]:
            items = grouped.get(rt) or []
            if len(items) == 0:
                return None, f"ROOM_NOT_FOUND:{rt}"
            if len(items) > 1:
                ids = ",".join(sorted({str(it.get("roomId") or "") for it in items}))
                return None, f"ROOM_AMBIGUOUS:{rt}:{ids}"
            out[rt] = items[0]
        return out, ""

    def _resolve_rooms(self, course: CourseConfig, rooms: list[dict]) -> Tuple[Optional[dict], str]:
        if course.rooms.any_set():
            if not (course.rooms.chat and course.rooms.notice):
                return None, "ROOMS_OVERRIDE_INCOMPLETE"

            out: dict[str, dict] = {
                "chat": {"roomId": course.rooms.chat, "roomName": ""},
                "notice": {"roomId": course.rooms.notice, "roomName": ""},
            }
            # 프리미엄방이 "없는 코스"를 지원한다. (rooms.premium이 비어있으면 프리미엄방 미사용)
            if str(course.rooms.premium or "").strip():
                out["premium"] = {"roomId": course.rooms.premium, "roomName": ""}
            return out, ""
        return self._infer_rooms_for_course(course.course_key, rooms)

    def _fetch_openchat_bundle(
        self,
        course_key: str,
        resolved_rooms: dict,
        openchat_auto_load: OpenchatAutoLoadConfig,
    ) -> Tuple[dict[str, dict], dict[str, list[dict]], str]:
        fetched_at = _iso_now()
        room_infos: dict[str, dict] = {}
        members_by_room: dict[str, list[dict]] = {}

        # resolved_rooms에 존재하는 방만 수집한다(premium 없는 코스 지원).
        room_types = ["chat", "notice"]
        if isinstance(resolved_rooms.get("premium"), dict) and str(resolved_rooms.get("premium", {}).get("roomId") or "").strip():
            room_types.append("premium")

        for i, rt in enumerate(room_types):
            info = resolved_rooms.get(rt) if isinstance(resolved_rooms.get(rt), dict) else {}
            room_id = str(info.get("roomId") or "").strip()
            if not room_id:
                raise SystemExit(f"[오류] roomId 비어있음(rt={rt})")

            rt_label = "사담방" if rt == "chat" else "공지방" if rt == "notice" else "프리미엄방"
            pct = 20 + i * 10
            self._set_course_progress(course_key=course_key, stage="OPENCHAT", message=f"{rt_label} 멤버를 불러오는 중", pct=pct)

            room_name, active, link_id = fetch_room_meta(self.iris_base, room_id)
            loaded = fetch_loaded_member_count(self.iris_base, room_id, link_id)
            members = fetch_openchat_members(self.iris_base, room_id, link_id)
            incomplete = (active is not None) and (loaded < int(active))

            # DB가 덜 로딩된 방은(대형 방) Redroid UI 스크롤로 DB를 채운 뒤 재조회한다.
            if incomplete and openchat_auto_load.enabled:
                attempts = max(1, int(openchat_auto_load.max_attempts or 1))
                for _ in range(attempts):
                    did = self._maybe_openchat_auto_load(
                        course_key=course_key,
                        room_type=rt,
                        room_label=rt_label,
                        room_id=room_id,
                        active=active,
                        loaded=loaded,
                        cfg=openchat_auto_load,
                    )
                    if not did:
                        break
                    loaded = fetch_loaded_member_count(self.iris_base, room_id, link_id)
                    members = fetch_openchat_members(self.iris_base, room_id, link_id)
                    incomplete = (active is not None) and (loaded < int(active))
                    if not incomplete:
                        break

            room_infos[rt] = {
                "roomType": rt,
                "roomId": room_id,
                "roomName": room_name,
                "activeMembersCount": active,
                "loadedMembersCount": loaded,
                "incomplete": bool(incomplete),
            }
            members_by_room[rt] = members

        return room_infos, members_by_room, fetched_at

    def _export_to_sheets(
        self,
        *,
        svc,
        course: CourseConfig,
        cafe_rows: list[list[str]],
        openchat_rows: list[list[str]],
        ssot_rows: list[list[str]],
        rules_rows: list[list[str]],
        audit_rows: list[list[str]],
        cafe_snapshot: dict,
        room_infos: dict[str, dict],
        ssot_records: list[dict],
        now_iso: str,
    ) -> None:
        # upsert(no clear) + change history
        tabs = course.tabs
        log_tab = getattr(tabs, "audit_log", "") or "AUDIT_LOG"
        overview_tab = getattr(tabs, "overview", "") or "OVERVIEW"
        actions_tab = getattr(tabs, "actions", "") or "ACTIONS"
        for tab in [
            overview_tab,
            actions_tab,
            tabs.cafe_raw,
            tabs.openchat_raw,
            getattr(tabs, "ssot_raw", "") or "SSOT_RAW",
            tabs.rules_raw,
            tabs.audit,
            log_tab,
        ]:
            ensure_sheet_exists(svc, course.spreadsheet_id, tab)
        # overview 탭은 사용성을 위해 항상 "가장 앞"으로 이동한다.
        move_sheet_to_index(svc, course.spreadsheet_id, overview_tab, 0)
        # ACTIONS 탭은 overview 바로 다음 탭으로 고정(운영자 입장에서 바로 찾기)
        move_sheet_to_index(svc, course.spreadsheet_id, actions_tab, 1)

        log_header = ["ts", "courseKey", "tab", "action", "key", "fields", "old", "new"]
        existing_log = get_values(svc, course.spreadsheet_id, f"{log_tab}!1:1")
        if not existing_log or not (existing_log[0] if existing_log else []):
            update_values(svc, course.spreadsheet_id, log_tab, [log_header])

        log_rows: list[list[str]] = []
        extra_cols = ["present", "firstSeenAt", "leftAt"]

        _upsert_sheet_rows(
            svc=svc,
            spreadsheet_id=course.spreadsheet_id,
            sheet_name=tabs.cafe_raw,
            rows=cafe_rows,
            key_cols=["clubId", "cafeUserId"],
            now_iso=now_iso,
            extra_cols=extra_cols,
            ignore_update_cols={"fetchedAt"},
            log_fields=["cafeNickname", "grade", "track", "present"],
            log_rows=log_rows,
            course_key=course.course_key,
        )
        _upsert_sheet_rows(
            svc=svc,
            spreadsheet_id=course.spreadsheet_id,
            sheet_name=tabs.openchat_raw,
            rows=openchat_rows,
            key_cols=["roomId", "openchatUserId"],
            now_iso=now_iso,
            extra_cols=extra_cols,
            ignore_update_cols={"fetchedAt", "activeMembersCount", "loadedMembersCount"},
            log_fields=["openchatNickname", "parsedCafeNickname", "present"],
            log_rows=log_rows,
            course_key=course.course_key,
        )
        _upsert_sheet_rows(
            svc=svc,
            spreadsheet_id=course.spreadsheet_id,
            sheet_name=getattr(tabs, "ssot_raw", "") or "SSOT_RAW",
            rows=ssot_rows,
            key_cols=["ssotUserId"],
            now_iso=now_iso,
            extra_cols=extra_cols,
            ignore_update_cols={"fetchedAt"},
            log_fields=["ssotNickname", "ssotGrade", "ssotTrack", "present"],
            log_rows=log_rows,
            course_key=course.course_key,
            max_detail_logs=0,
        )
        _upsert_sheet_rows(
            svc=svc,
            spreadsheet_id=course.spreadsheet_id,
            sheet_name=tabs.rules_raw,
            rows=rules_rows,
            key_cols=["key"],
            now_iso=now_iso,
            extra_cols=[],
            ignore_update_cols=set(),
            log_fields=[],
            log_rows=log_rows,
            course_key=course.course_key,
            max_detail_logs=0,
        )
        _upsert_sheet_rows(
            svc=svc,
            spreadsheet_id=course.spreadsheet_id,
            sheet_name=tabs.audit,
            rows=audit_rows,
            key_cols=["auditKey"],
            now_iso=now_iso,
            extra_cols=extra_cols,
            ignore_update_cols={"cafeUpdatedAt", "openchatUpdatedAt"},
            log_fields=["cafeNickname", "grade", "track", "ssotPresent", "inCafe", "missingRooms", "auditStatus", "present"],
            log_rows=log_rows,
            course_key=course.course_key,
        )

        if log_rows:
            append_rows(svc, course.spreadsheet_id, log_tab, log_rows, last_col=_col_letter(len(log_header)))

        # Overview에서 최근 AUDIT_LOG를 바로 확인할 수 있도록 최근 N개를 읽어온다.
        # (로그는 무한정 커지지 않도록 상한을 두고 초과분은 앞쪽부터 정리)
        recent_logs: list[list[str]] = []
        try:
            keep_rows = 5000  # header 제외, 최신 N개만 유지
            show_rows = 120  # Overview에서 최신 로그 일부 표시

            col_a = get_values(svc, course.spreadsheet_id, f"{log_tab}!A:A")
            total_rows = len(col_a)  # header 포함
            if keep_rows > 0 and total_rows > (keep_rows + 1):
                delete_end = max(2, total_rows - keep_rows)
                delete_rows_range(svc, course.spreadsheet_id, log_tab, 2, delete_end)
                total_rows = keep_rows + 1

            if total_rows >= 2:
                end_row = total_rows
                start_row = max(2, end_row - show_rows + 1)
                recent_logs = get_values(svc, course.spreadsheet_id, f"{log_tab}!A{start_row}:H{end_row}")
        except Exception:
            recent_logs = []

        # Overview는 derived view이므로 clear 후 전체 재작성한다.
        overview_rows = audit_mod.build_overview_rows(
            course_key=course.course_key,
            now_iso=now_iso,
            cafe_snapshot=cafe_snapshot,
            room_infos=room_infos,
            audit_rows=audit_rows,
            openchat_rows=openchat_rows,
            recent_audit_log_rows=recent_logs,
            ssot_records=ssot_records,
        )
        clear_values(svc, course.spreadsheet_id, overview_tab)
        update_values(svc, course.spreadsheet_id, overview_tab, overview_rows)
        apply_overview_sheet_format(svc, course.spreadsheet_id, overview_tab, overview_rows, frozen_rows=16)

        # ACTIONS 탭(운영자가 "지금 당장 해야 할 일"을 상세히 확인)
        actions_rows = audit_mod.build_actions_rows(
            course_key=course.course_key,
            now_iso=now_iso,
            cafe_snapshot=cafe_snapshot,
            room_infos=room_infos,
            audit_rows=audit_rows,
            openchat_rows=openchat_rows,
            ssot_records=ssot_records,
        )
        clear_values(svc, course.spreadsheet_id, actions_tab)
        update_values(svc, course.spreadsheet_id, actions_tab, actions_rows)
        apply_actions_sheet_format(svc, course.spreadsheet_id, actions_tab, actions_rows, frozen_rows=6)

    def _run_course_once(self, cfg: AuditConfig, course: CourseConfig, rooms: list[dict], interval_sec: int) -> str:
        now_iso = _iso_now()
        cs = self._course_state(course.course_key)

        # basic validation
        if not course.club_id:
            raise SystemExit("clubId가 비어 있습니다.")

        resolved_rooms, room_err = self._resolve_rooms(course, rooms)     
        if not resolved_rooms:
            raise SystemExit(f"rooms 해석 실패: {room_err}")

        has_premium_room = bool(
            isinstance(resolved_rooms.get("premium"), dict)
            and str(resolved_rooms.get("premium", {}).get("roomId") or "").strip()
        )

        # openchat
        self._set_course_progress(course_key=course.course_key, stage="OPENCHAT", message="톡방 데이터를 불러오는 중", pct=15)
        room_infos, members_by_room, openchat_fetched_at = self._fetch_openchat_bundle(
            course.course_key,
            resolved_rooms,
            cfg.worker.openchat_auto_load,
        )

        # crawler
        self._set_course_progress(course_key=course.course_key, stage="CAFE", message="카페 멤버를 불러오는 중", pct=55)
        c = cfg.worker.crawler
        if not c.repo_path or not Path(c.repo_path).exists():
            raise SystemExit(f"crawler.repoPath가 없거나 경로가 없습니다: {c.repo_path}")
        if not c.python_exe or not Path(c.python_exe).exists():
            raise SystemExit(f"crawler.pythonExe가 없거나 경로가 없습니다: {c.python_exe}")
        if c.settings_path and not Path(c.settings_path).exists():
            raise SystemExit(f"crawler.settingsPath 경로가 없습니다: {c.settings_path}")

        snap_dir = (self.root / "data" / "course_membership_audit" / "snapshots").resolve()
        out_json = snap_dir / f"cafe_{_safe_filename(course.course_key)}.json"
        code, cafe_snapshot, _stdout, _stderr, crawl_dur = crawl_cafe_members(
            python_exe=c.python_exe,
            crawler_repo=c.repo_path,
            settings_path=c.settings_path,
            club_id=course.club_id,
            cafe_name=course.course_key,
            output_json=out_json,
            timeout_sec=900,
        )
        if code != 0 or not bool(cafe_snapshot.get("ok")):
            err = str(cafe_snapshot.get("error") or "").strip() or f"crawl_failed(code={code})"
            raise SystemExit(f"카페 크롤링 실패: {err}")

        total_cnt = cafe_snapshot.get("totalCount")
        if total_cnt is not None:
            self._append_course_event(
                course_key=course.course_key,
                level="INFO",
                message=f"카페 멤버 {int(total_cnt) if str(total_cnt).isdigit() else total_cnt}명 불러옴",
                stage="CAFE",
                pct=70,
            )
            self._save_state()

        wants_sheets_export = (
            bool(str(getattr(course, "spreadsheet_id", "") or "").strip())
            and str(getattr(course, "spreadsheet_id", "") or "").strip().upper() not in ("DISABLED", "NONE", "N/A")
        )
        needs_sheets_client = wants_sheets_export or bool(getattr(course, "payment_ssot", None))

        svc = None
        if needs_sheets_client:
            sa_json = self._resolve_service_account_json()
            svc = build_sheets_client(sa_json)

        # payment ssot (optional)
        ssot_records: list[dict] = []
        ssot_stats: dict[str, int] = {}
        if getattr(course, "payment_ssot", None):
            if not svc:
                raise SystemExit("결제 SSOT를 읽기 위해 Google Sheets 인증 설정이 필요해요.")
            self._set_course_progress(course_key=course.course_key, stage="SSOT", message="결제 SSOT(결제 확인 시트) 불러오는 중", pct=78)
            ssot_records, ssot_stats = self._fetch_payment_ssot_records(svc, course, premium_enabled=has_premium_room)
            if ssot_records:
                self._append_course_event(
                    course_key=course.course_key,
                    level="INFO",
                    message=f"결제 SSOT {len(ssot_records)}명 불러옴(일반 {ssot_stats.get('normal',0)}, 프리미엄 {ssot_stats.get('premium',0)}, 운영진 {ssot_stats.get('staff',0)})",
                    stage="SSOT",
                    pct=82,
                )
                self._save_state()

        # build rows
        self._set_course_progress(course_key=course.course_key, stage="CALC", message="데이터를 정리하는 중", pct=85)
        worker_info = {
            "intervalSec": str(interval_sec),
            "realtimeBase": self.realtime_base,
            "irisBase": self.iris_base,
        }
        course_info = {"clubId": course.club_id, "spreadsheetId": (course.spreadsheet_id_raw or course.spreadsheet_id) if wants_sheets_export else ""}

        rules_eff = course.grade_rules
        if not has_premium_room:
            # 프리미엄방이 없는 코스에서는 프리미엄 트랙 판정을 끈다.
            rules_eff = GradeRules(premium_grades=[], staff_grades=course.grade_rules.staff_grades)

        cafe_rows = audit_mod.build_cafe_raw_rows(course_key=course.course_key, cafe_snapshot=cafe_snapshot, rules=rules_eff)
        cafe_members = cafe_snapshot.get("members") if isinstance(cafe_snapshot.get("members"), list) else []
        cafe_nick_set = {
            str(it.get("cafeNickname") or "").strip()
            for it in cafe_members
            if isinstance(it, dict) and str(it.get("cafeNickname") or "").strip()
        }
        ssot_nick_set: set[str] = set()
        for r in (ssot_records or []) if isinstance(ssot_records, list) else []:
            if not isinstance(r, dict):
                continue
            for nn in audit_mod.iter_ssot_nickname_variants(r):
                if nn:
                    ssot_nick_set.add(str(nn).strip())
        canonical_cafe_nick_set = audit_mod.build_canonical_cafe_nick_set(cafe_nick_set, ssot_nick_set)
        openchat_rows = audit_mod.build_openchat_raw_rows(
            course_key=course.course_key,
            fetched_at=openchat_fetched_at,
            room_infos=room_infos,
            members_by_room=members_by_room,
            cafe_nick_set=canonical_cafe_nick_set,
        )
        rules_rows = audit_mod.build_rules_raw_rows(
            course_key=course.course_key,
            now_iso=now_iso,
            worker_info=worker_info,
            course_info=course_info,
            room_infos=room_infos,
            rules=rules_eff,
            cafe_snapshot=cafe_snapshot,
            openchat_fetched_at=openchat_fetched_at,
        )
        audit_rows = audit_mod.build_audit_view_rows(
            course_key=course.course_key,
            cafe_snapshot=cafe_snapshot,
            rules=rules_eff,
            room_infos=room_infos,
            members_by_room=members_by_room,
            openchat_fetched_at=openchat_fetched_at,
            ssot_records=ssot_records,
        )
        ssot_rows = (
            audit_mod.build_ssot_raw_rows(course_key=course.course_key, fetched_at=now_iso, ssot_records=ssot_records)
            if ssot_records
            else [
                [
                    "courseKey",
                    "fetchedAt",
                    "ssotUserId",
                    "ssotNickname",
                    "ssotNicknameAliases",
                    "ssotName",
                    "ssotGrade",
                    "ssotTrack",
                    "ssotKind",
                    "sourceRow",
                ]
            ]
        )

        actions_rows = audit_mod.build_actions_rows(
            course_key=course.course_key,
            now_iso=now_iso,
            cafe_snapshot=cafe_snapshot,
            room_infos=room_infos,
            audit_rows=audit_rows,
            openchat_rows=openchat_rows,
            ssot_records=ssot_records,
        )

        # snapshot(json) — 웹 콘솔(Supabase) 업로드용
        self._set_course_progress(course_key=course.course_key, stage="SNAPSHOT", message="스냅샷을 저장하는 중", pct=92)
        snap_dir2 = (self.root / "node-iris-app" / "data" / "courseops_snapshots").resolve()
        snap_path = snap_dir2 / f"{_safe_filename(course.course_key)}.json"
        snapshot_payload = {
            "version": 1,
            "courseKey": course.course_key,
            "fetchedAt": now_iso,
            "cafeFetchedAt": str(cafe_snapshot.get("fetchedAt") or "").strip(),
            "openchatFetchedAt": openchat_fetched_at,
            "roomInfos": room_infos,
            "ssotStats": ssot_stats,
            "tables": {
                "rulesRaw": rules_rows,
                "auditView": audit_rows,
                "openchatRaw": openchat_rows,
                "ssotRaw": ssot_rows,
                "actions": actions_rows,
            },
        }
        _write_json_atomic(snap_path, snapshot_payload)

        cs["lastSnapshotPath"] = str(snap_path)
        cs["lastSnapshotFetchedAt"] = now_iso
        cs["lastSnapshotMs"] = _now_ms()

        # legacy: 구글 시트 export(옵션)
        if wants_sheets_export:
            if not svc:
                raise SystemExit("시트 export를 위해 Google Sheets 인증 설정이 필요해요.")
            self._set_course_progress(course_key=course.course_key, stage="SHEETS", message="레거시: 시트에 반영하는 중", pct=97)
            self._export_to_sheets(
                svc=svc,
                course=course,
                cafe_rows=cafe_rows,
                openchat_rows=openchat_rows,
                ssot_rows=ssot_rows,
                rules_rows=rules_rows,
                audit_rows=audit_rows,
                cafe_snapshot=cafe_snapshot,
                room_infos=room_infos,
                ssot_records=ssot_records,
                now_iso=now_iso,
            )

        # state update
        cs["lastCafeFetchedAt"] = str(cafe_snapshot.get("fetchedAt") or "").strip()
        cs["lastOpenchatFetchedAt"] = openchat_fetched_at
        cs["lastRooms"] = room_infos
        cs["lastCrawlDurationSec"] = round(float(crawl_dur), 3)
        cs["lastOkTs"] = now_iso
        cs["lastOkMs"] = _now_ms()

        return "OK"

    def run_forever(self) -> int:
        self._load_state()
        self._acquire_lock()

        self.log("INFO", "course-membership-audit-worker 시작", config=str(self.config_path))
        self._write_status(state="STARTING", realtimeBase=self.realtime_base, irisBase=self.iris_base)

        def _hb_loop() -> None:
            # watchdog(Test-CourseMembershipAuditWorkerOk)은 heartbeatTs가 300초 초과로 stale이면 재시작한다.
            # 작업이 길어도(오픈채팅 멤버 로딩/카페 크롤링/시트 업서트) heartbeat는 살아있어야 한다.
            while True:
                try:
                    self._write_status()
                except Exception:
                    pass
                time.sleep(30)

        threading.Thread(target=_hb_loop, name="course-membership-audit-heartbeat", daemon=True).start()

        last_hb_ms = 0
        while True:
            # UI/API(run-once 등)에서 state 파일을 갱신할 수 있으므로, 루프마다 최신 state를 로드한다.
            # (단일 프로세스 락은 유지되며, state는 파일을 SSOT로 사용)
            self._load_state()
            now_ms = _now_ms()
            try:
                cfg_path, cfg = load_config(str(self.config_path))
            except SystemExit as e:
                # config 파일이 아직 없거나 깨진 경우: 워커를 죽이지 말고 대기한다(UI에서 저장 후 반영)
                self._write_status(state="NO_CONFIG", error=str(e), workerEnabled=False)
                time.sleep(5)
                continue
            if not cfg.worker.enabled:
                self.log("INFO", "worker 비활성(worker.enabled=false) → 종료")
                self._write_status(state="DISABLED", workerEnabled=False)
                return 0

            # state에 config에 없는 courseKey가 남아있으면 UI에 "???? 코스" 같은 고아 엔트리가 생길 수 있다.
            # config 기준으로 prune해서 SSOT를 유지한다.
            try:
                valid_keys = set(cfg.courses.keys())
                cs_map = self.state.get("courses")
                if isinstance(cs_map, dict) and valid_keys:
                    stale = [k for k in list(cs_map.keys()) if k not in valid_keys]
                    if stale:
                        for k in stale:
                            cs_map.pop(k, None)
                        self._save_state()
                        self.log("WARN", "state에서 알 수 없는 courseKey 제거", removed=len(stale))
            except Exception:
                pass

            interval_sec = self._pick_interval_sec(cfg, now_ms)

            # rooms snapshot(한 번만)
            try:
                rooms = fetch_rooms(self.realtime_base, timeout=10.0)
            except SystemExit as e:
                self._write_status(state="ERROR", error=str(e), workerEnabled=True, intervalSec=interval_sec)
                time.sleep(5)
                continue

            courses = [c for c in cfg.courses.values() if c.enabled]
            courses.sort(key=lambda x: x.course_key)

            if not courses:
                if now_ms - last_hb_ms > 30_000:
                    self._write_status(state="IDLE", workerEnabled=True, coursesEnabled=0, intervalSec=interval_sec)
                    last_hb_ms = now_ms
                time.sleep(5)
                continue

            ran_any = False
            ok_cnt = 0
            fail_cnt = 0

            for course in courses:
                cs = self._course_state(course.course_key)
                if cs.get("enabled") is not True:
                    cs["enabled"] = True
                    cs["enabledAtMs"] = now_ms
                    cs["enabledAtTs"] = _iso_from_ms(now_ms)
                    cs["nextRunMs"] = now_ms  # 최초 1회는 즉시 실행
                    cs["nextRunTs"] = _iso_from_ms(now_ms)
                    self._save_state()

                next_run_ms = int(cs.get("nextRunMs") or 0)
                if next_run_ms <= 0:
                    cs["nextRunMs"] = now_ms
                    cs["nextRunTs"] = _iso_from_ms(now_ms)
                    self._save_state()
                    next_run_ms = now_ms

                if now_ms < next_run_ms:
                    continue

                ran_any = True
                start_ms = _now_ms()
                self.log("INFO", "점검 시작", courseKey=course.course_key, intervalSec=interval_sec)
                # 이전 실행의 실패 결과가 남아있으면 "진행 중"에도 실패로 보일 수 있으므로 먼저 리셋한다.
                cs["lastResult"] = "RUNNING"
                cs["lastError"] = ""
                cs["lastErrorUser"] = ""
                cs["lastErrorTs"] = ""
                cs["lastErrorMs"] = 0
                self._save_state()
                self._set_course_progress(course_key=course.course_key, stage="START", message="1회 업서트를 시작했어요", pct=10)

                try:
                    result = self._run_course_once(cfg, course, rooms, interval_sec)
                    ok_cnt += 1
                    cs["lastResult"] = result
                    cs["lastError"] = ""
                    cs["lastErrorUser"] = ""
                    cs["lastErrorTs"] = ""
                    cs["lastErrorMs"] = 0
                    self._set_course_progress(course_key=course.course_key, stage="DONE", message="완료됐어요", pct=100)
                    self.log("INFO", "점검 완료(OK)", courseKey=course.course_key, durationSec=round((_now_ms() - start_ms) / 1000.0, 3))
                except SystemExit as e:
                    fail_cnt += 1
                    cs["lastResult"] = "ERROR"
                    err_raw = str(e)
                    err_user = self._friendly_error(err_raw)
                    cs["lastError"] = err_raw
                    cs["lastErrorUser"] = err_user
                    cs["lastErrorTs"] = _iso_now()
                    cs["lastErrorMs"] = _now_ms()
                    self._set_course_progress(course_key=course.course_key, stage="ERROR", message=err_user, pct=100, level="ERROR")
                    self.log("ERROR", "점검 실패", courseKey=course.course_key, err=str(e))
                except Exception as e:
                    fail_cnt += 1
                    cs["lastResult"] = "ERROR"
                    err_raw = str(e)
                    err_user = self._friendly_error(err_raw)
                    cs["lastError"] = err_raw
                    cs["lastErrorUser"] = err_user
                    cs["lastErrorTs"] = _iso_now()
                    cs["lastErrorMs"] = _now_ms()
                    self._set_course_progress(course_key=course.course_key, stage="ERROR", message=err_user, pct=100, level="ERROR")
                    self.log("ERROR", "점검 예외", courseKey=course.course_key, err=str(e))

                # 다음 주기 예약(재시도 없음)
                now2 = _now_ms()
                cs["lastRunMs"] = now2
                cs["lastRunTs"] = _iso_from_ms(now2)
                cs["nextRunMs"] = now2 + int(interval_sec) * 1000
                cs["nextRunTs"] = _iso_from_ms(int(cs["nextRunMs"]))
                cs["intervalSec"] = int(interval_sec)
                self._save_state()

                self._write_status(
                    state="RUNNING",
                    workerEnabled=True,
                    coursesEnabled=len(courses),
                    ok=ok_cnt,
                    failed=fail_cnt,
                    intervalSec=interval_sec,
                )
                last_hb_ms = _now_ms()

            if not ran_any:
                if now_ms - last_hb_ms > 30_000:
                    self._write_status(state="IDLE", workerEnabled=True, coursesEnabled=len(courses), intervalSec=interval_sec)
                    last_hb_ms = now_ms
                time.sleep(5)
                continue

            time.sleep(2)


def main() -> int:
    cfg_path = os.getenv("COURSE_MEMBERSHIP_AUDIT_CONFIG") or DEFAULT_CONFIG_PATH
    root = repo_root()
    p = Path(cfg_path)
    if not p.is_absolute():
        p = (root / p).resolve()
    worker = CourseMembershipAuditWorker(root=root, config_path=p)
    return worker.run_forever()


if __name__ == "__main__":
    raise SystemExit(main())
