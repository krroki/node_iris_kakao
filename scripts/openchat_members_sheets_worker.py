#!/usr/bin/env python3
"""
오픈채팅 멤버(전체) 목록을 Google Sheets에 주기적으로 upsert 하는 워커.

목표
- UI(3100)에서 roomId별 Sheets 타겟/주기를 설정해두면, 별도 수동 호출 없이 자동 동작.

중요(완전성/폴백 금지)
- 멤버 목록 단일 소스는 IRIS DB(db2.open_chat_member).
- 기본 정책은 `loadedMembersCount < activeMembersCount`이면 실패(스킵) 처리한다.
  (하나도 빠짐없이를 목표로 하므로 불완전 스냅샷 업서트를 조용히 수행하지 않는다.)

설정 파일(기본, gitignore)
- data/openchat_members_sheets.json
  - spreadsheetId/sheetName/serviceAccountJson: 기본값
  - worker.enabled: 워커 동작 여부
  - 스케줄: ON이면 10분마다 업서트(고정, 즉시 실행 금지; 다음 주기부터)
  - rooms[roomId].enabled: 해당 방 자동 동기화 ON/OFF
  - rooms[roomId].spreadsheetId/sheetName/serviceAccountJson: 방별 override
  - rooms[roomId].allowIncomplete: 불완전 업서트 허용(권장하지 않음)

상태 파일
- node-iris-app/data/openchat_members_sheets_worker_status.json
- node-iris-app/data/openchat_members_sheets_worker_state.json
- node-iris-app/data/locks/openchat_members_sheets_worker.lock
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import requests


DEFAULT_CONFIG_PATH = "data/openchat_members_sheets.json"
SCHEDULE_INTERVAL_SEC = 10 * 60  # 스케줄링 ON 시 고정: 10분
TEST_ALERT_ROOM_ID = "18462226881291012"  # 테스트용 오픈채팅방(알림 전용)
ALERT_MAX_CHARS = 1600  # 카카오톡 메시지 길이 안전 여유


def _repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _now_ms() -> int:
    return int(time.time() * 1000)


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
    except Exception as e:
        raise SystemExit(f"[오류] JSON 파싱 실패: {path} ({e})")
    if not isinstance(j, dict):
        raise SystemExit(f"[오류] JSON 형식 오류(object 필요): {path}")
    return j


def _write_json_atomic(path: Path, obj: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(path)


def _read_iris_url(repo_root: Path) -> str:
    env_url = (
        str(os.getenv("IRIS_URL") or "").strip()
        or str(os.getenv("IRIS_QUERY_BASE") or "").strip()
        or str(os.getenv("IRIS_BRIDGE_URL") or "").strip()
    )
    if env_url:
        return env_url
    p = repo_root / "config" / "windows" / "iris_url.txt"
    s = _read_text(p).strip()
    return s or "http://127.0.0.1:5050"


def log(level: str, msg: str, **extra: Any) -> None:
    ts = datetime.now().strftime("%H:%M:%S")
    payload = f" {json.dumps(extra, ensure_ascii=False)}" if extra else ""
    print(f"[{ts}][{level}] {msg}{payload}", flush=True)


def _parse_int(raw: object) -> Optional[int]:
    try:
        if raw is None:
            return None
        if isinstance(raw, bool):
            return None
        if isinstance(raw, int):
            return raw
        n = int(str(raw).strip())
        return n
    except Exception:
        return None


def _parse_sync_output(stdout: str) -> dict:
    out: dict = {}
    lines = [ln.strip() for ln in str(stdout or "").splitlines() if ln.strip()]
    for line in lines:
        if line.startswith("[room]"):
            m = re.search(r"name=(.+)$", line)
            if m:
                out["roomName"] = (m.group(1) or "").strip()
        if line.startswith("[count]"):
            m = re.search(
                r"activeMembersCount=([^/]+)\/\s*loadedMembersCount=([^/]+)\/\s*fetched=(.+)$",
                line,
            )
            if m:
                active_raw = (m.group(1) or "").strip()
                loaded_raw = (m.group(2) or "").strip()
                fetched_raw = (m.group(3) or "").strip()
                active = None if active_raw.lower() == "n/a" else _parse_int(active_raw)
                out["counts"] = {
                    "activeMembersCount": active,
                    "loadedMembersCount": _parse_int(loaded_raw),
                    "fetched": _parse_int(fetched_raw),
                }
        if line.startswith("[done]"):
            sheet = re.search(r"\bsheet=([^\s]+)\b", line)
            updates = re.search(r"\bupdates=(\d+)\b", line)
            appends = re.search(r"\bappends=(\d+)\b", line)
            existing = re.search(r"\bexisting=(\d+)\b", line)
            out["sheets"] = {
                "sheetName": sheet.group(1) if sheet else None,
                "updates": _parse_int(updates.group(1)) if updates else None,
                "appends": _parse_int(appends.group(1)) if appends else None,
                "existing": _parse_int(existing.group(1)) if existing else None,
            }
    return out


def _is_incomplete_error(text: str) -> bool:
    s = str(text or "")
    return (
        "loadedMembersCount < activeMembersCount" in s
        or "멤버 DB가 불완전" in s
        or "open_chat_member가 비어" in s
    )


@dataclass
class RoomPlan:
    room_id: str
    allow_incomplete: bool


class OpenchatMembersSheetsWorker:
    def __init__(self, repo_root: Path, config_path: Path):
        self.root = repo_root
        self.config_path = config_path
        self.realtime_base = (
            str(os.getenv("REALTIME_API_BASE") or os.getenv("REALTIME_API_URL") or "").strip() or "http://127.0.0.1:8650"
        ).rstrip("/")
        self.status_path = self.root / "node-iris-app" / "data" / "openchat_members_sheets_worker_status.json"
        self.state_path = self.root / "node-iris-app" / "data" / "openchat_members_sheets_worker_state.json"
        self.lock_path = self.root / "node-iris-app" / "data" / "locks" / "openchat_members_sheets_worker.lock"
        self.state: dict = {}

    def _load_state(self) -> None:
        try:
            self.state = _read_json(self.state_path) if self.state_path.exists() else {}
        except Exception as e:
            log("WARN", "state 로드 실패(무시)", err=str(e), path=str(self.state_path))
            self.state = {}
        if not isinstance(self.state, dict):
            self.state = {}
        if "rooms" not in self.state or not isinstance(self.state.get("rooms"), dict):
            self.state["rooms"] = {}

    def _save_state(self) -> None:
        out = dict(self.state)
        out["updatedAt"] = _iso_now()
        _write_json_atomic(self.state_path, out)

    def _write_status(self, **extra: Any) -> None:
        payload = {
            "pid": os.getpid(),
            "heartbeatTs": _iso_now(),
            "configPath": str(self.config_path),
        }
        payload.update(extra)
        _write_json_atomic(self.status_path, payload)

    def _acquire_lock(self) -> None:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        if self.lock_path.exists():
            hb_age_sec = None
            try:
                st = _read_json(self.status_path)
                hb = str(st.get("heartbeatTs") or "").strip()
                if hb:
                    dt = datetime.fromisoformat(hb.replace("Z", "+00:00")).astimezone(timezone.utc)
                    hb_age_sec = (datetime.now(timezone.utc) - dt).total_seconds()
            except Exception:
                hb_age_sec = None

            if hb_age_sec is not None and hb_age_sec <= 300:
                raise SystemExit(
                    f"[오류] openchat-members-sheets-worker 중복 실행 감지(heartbeat age={int(hb_age_sec)}s): {self.lock_path}"
                )

            try:
                self.lock_path.unlink()
            except Exception:
                raise SystemExit(f"[오류] stale lock 제거 실패: {self.lock_path}")

        self.lock_path.write_text(str(os.getpid()), encoding="utf-8")

    def _load_config(self) -> dict:
        if not self.config_path.exists():
            raise SystemExit(f"[오류] config가 없습니다: {self.config_path}")
        cfg = _read_json(self.config_path)
        return cfg

    def _get_worker_enabled(self, cfg: dict) -> bool:
        worker = cfg.get("worker")
        if isinstance(worker, dict) and "enabled" in worker:
            return bool(worker.get("enabled"))
        # 안전: 명시되지 않으면 OFF
        return False

    def _build_room_plans(self, cfg: dict) -> list[RoomPlan]:
        rooms = cfg.get("rooms")
        if not isinstance(rooms, dict):
            return []
        out: list[RoomPlan] = []
        for rid, v in rooms.items():
            rid2 = str(rid or "").strip()
            if not rid2:
                continue
            if not isinstance(v, dict):
                continue
            # 안전: roomId별 자동 동기화는 enabled=true 를 명시한 방만 수행한다.
            if not bool(v.get("enabled")):
                continue
            allow_incomplete = bool(v.get("allowIncomplete") or v.get("allow_incomplete"))
            out.append(RoomPlan(room_id=rid2, allow_incomplete=allow_incomplete))
        out.sort(key=lambda x: x.room_id)
        return out

    def _mark_disabled_rooms(self, cfg: dict) -> bool:
        rooms = cfg.get("rooms")
        if not isinstance(rooms, dict):
            return False
        now_ms = _now_ms()
        changed = False
        for rid, v in rooms.items():
            rid2 = str(rid or "").strip()
            if not rid2 or not isinstance(v, dict):
                continue
            if bool(v.get("enabled")):
                continue
            rs = self._room_state(rid2)
            if rs.get("enabled") is False:
                continue
            rs["enabled"] = False
            rs["disabledAtMs"] = now_ms
            rs["disabledAtTs"] = _iso_now()
            # 재활성화 시 "다음 주기"에서 실행되도록 nextRun을 제거한다.
            rs.pop("nextRunMs", None)
            rs.pop("nextRunTs", None)
            changed = True
        return changed

    def _room_state(self, room_id: str) -> dict:
        rooms_state = self.state.get("rooms")
        if not isinstance(rooms_state, dict):
            rooms_state = {}
            self.state["rooms"] = rooms_state
        rs = rooms_state.get(room_id)
        if not isinstance(rs, dict):
            rs = {}
            rooms_state[room_id] = rs
        return rs

    def _schedule_next_cycle(self, rs: dict, now_ms: int) -> None:
        interval_ms = SCHEDULE_INTERVAL_SEC * 1000
        next_ms = now_ms + interval_ms
        rs["nextRunMs"] = next_ms
        rs["nextRunTs"] = _iso_from_ms(next_ms)

    def _send_alert_to_test_room(self, text: str, timeout_sec: float = 12.0) -> Tuple[bool, str]:
        url = f"{self.realtime_base}/send/talkapi/dispatch"
        body = {"roomId": TEST_ALERT_ROOM_ID, "message": text, "mentionees": []}
        try:
            r = requests.post(url, json=body, timeout=timeout_sec)
            j = r.json() if r.content else {}
            if r.status_code >= 400:
                detail = str((j or {}).get("detail") or (j or {}).get("error") or f"HTTP {r.status_code}")
                return False, detail
            ok = bool((j or {}).get("ok"))
            if not ok:
                err = str(((j or {}).get("talkApi") or {}).get("errMsg") or (j or {}).get("detail") or "send_failed")
                return False, err
            return True, ""
        except Exception as e:
            return False, str(e)

    def _result_label(self, result: str) -> str:
        r = str(result or "").strip().upper()
        if r == "INCOMPLETE_MEMBER_DB":
            return "멤버 DB 미로딩(스크롤 로딩 필요)"
        if r == "TIMEOUT":
            return "타임아웃"
        if r == "ERROR":
            return "실패"
        if r == "OK":
            return "성공"
        return r or "알 수 없음"

    def _short_detail(self, err_text: str) -> str:
        s = (err_text or "").strip().replace("\r", "")
        if len(s) > 240:
            s = s[:240] + "…"
        return s

    def _compose_room_alert_block(self, room_id: str, result: str, parsed: dict, err_text: str) -> str:
        room_name = ""
        try:
            room_name = str((parsed or {}).get("roomName") or "").strip()
        except Exception:
            room_name = ""
        counts = (parsed or {}).get("counts") if isinstance(parsed, dict) else None
        active = None
        loaded = None
        fetched = None
        if isinstance(counts, dict):
            active = counts.get("activeMembersCount")
            loaded = counts.get("loadedMembersCount")
            fetched = counts.get("fetched")

        label = self._result_label(result)
        title = f"• {room_name or '(이름 미확인)'} ({room_id})"
        lines = [title, f"  - 상태: {label}"]
        if active is not None or loaded is not None or fetched is not None:
            lines.append(
                "  - 인원: active={}/loaded={}/fetched={}".format(
                    active if active is not None else "N/A",
                    loaded if loaded is not None else "N/A",
                    fetched if fetched is not None else "N/A",
                )
            )
        detail = self._short_detail(err_text)
        if detail:
            lines.append(f"  - 원인: {detail}")
        if str(result or "").strip().upper() == "INCOMPLETE_MEMBER_DB":
            lines.append(f"  - 조치: 멤버 목록 로딩 필요 (pwsh scripts/openchat_load_members.ps1 -RoomId {room_id} -Scrolls 600)")
        return "\n".join(lines).strip()

    def _compose_batch_alert(self, blocks: list[str]) -> str:
        head = f"[운영 알림] 오픈채팅 멤버 Sheets 동기화: 문제 {len(blocks)}건"
        intro = "아래 방에서 동기화가 완료되지 않았습니다. 다음 주기에 자동으로 다시 시도합니다."
        body = "\n\n".join(blocks).strip()
        msg = "\n".join([head, intro, "", body]).strip()
        if len(msg) <= ALERT_MAX_CHARS:
            return msg
        return (msg[: ALERT_MAX_CHARS - 20].rstrip() + "\n...(길어서 일부 생략)")

    def _run_sync_once(self, room_id: str, allow_incomplete: bool) -> Tuple[int, str, str, float]:
        script = self.root / "scripts" / "sync_openchat_members_to_sheets.py"
        if not script.exists():
            raise SystemExit(f"[오류] sync 스크립트가 없습니다: {script}")

        cmd = [sys.executable, str(script), "--room-id", str(room_id), "--config", str(self.config_path)]
        if allow_incomplete:
            cmd.append("--allow-incomplete")

        env = dict(os.environ)
        env["PYTHONUTF8"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        env["IRIS_URL"] = _read_iris_url(self.root)

        started = time.time()
        p = subprocess.run(
            cmd,
            cwd=str(self.root),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
        )
        dur = time.time() - started
        return int(p.returncode or 0), str(p.stdout or ""), str(p.stderr or ""), dur

    def _update_room_state(
        self,
        room_id: str,
        result: str,
        stdout: str,
        stderr: str,
        dur_sec: float,
        parsed: dict,
    ) -> None:
        rooms_state: dict = self.state.get("rooms") if isinstance(self.state.get("rooms"), dict) else {}
        now_ms = _now_ms()
        rs: dict = rooms_state.get(room_id) if isinstance(rooms_state.get(room_id), dict) else {}
        rs = dict(rs)
        rs.update(
            {
                "lastAttemptMs": now_ms,
                "lastAttemptTs": _iso_now(),
                "lastResult": result,
                "durationMs": int(max(0.0, dur_sec) * 1000),
            }
        )
        if result == "OK":
            rs["lastOkMs"] = now_ms
            rs["lastOkTs"] = _iso_now()
            rs["lastError"] = ""
        else:
            rs["lastError"] = (stderr.strip() or stdout.strip() or "")[:8000]
        if parsed:
            rs["parsed"] = parsed
        rooms_state[room_id] = rs
        self.state["rooms"] = rooms_state

    def run_forever(self) -> int:
        self._load_state()
        self._acquire_lock()

        log("INFO", "openchat-members-sheets-worker 시작", config=str(self.config_path))
        self._write_status(state="STARTING", intervalSec=SCHEDULE_INTERVAL_SEC, alertRoomId=TEST_ALERT_ROOM_ID)

        last_hb_ms = 0
        while True:
            now_ms = _now_ms()
            try:
                cfg = self._load_config()
            except SystemExit as e:
                self._write_status(state="ERROR", error=str(e))
                raise

            enabled = self._get_worker_enabled(cfg)
            if not enabled:
                log("INFO", "worker 비활성(worker.enabled=false) → 종료")
                self._write_status(state="DISABLED", workerEnabled=False)
                return 0

            # re-enable 시 "다음 주기" 실행을 보장하기 위해, 현재 disabled인 방을 state에 반영한다.
            if self._mark_disabled_rooms(cfg):
                try:
                    self._save_state()
                except Exception:
                    pass

            plans = self._build_room_plans(cfg)
            if not plans:
                # 설정은 켜져있지만 대상 방이 없으면 주기적으로 status만 갱신한다.
                if now_ms - last_hb_ms > 30_000:
                    self._write_status(state="IDLE", workerEnabled=True, roomsEnabled=0, intervalSec=SCHEDULE_INTERVAL_SEC)
                    last_hb_ms = now_ms
                time.sleep(5)
                continue

            ran_any = False
            ok_cnt = 0
            fail_cnt = 0
            skip_cnt = 0

            # 알림은 "주기당 1회"로 배치해 테스트방 스팸을 줄인다.
            cycle_alert_blocks: list[str] = []
            cycle_alert_room_ids: list[str] = []

            for plan in plans:
                rs = self._room_state(plan.room_id)
                # 요구: 자동 동기화는 "다음 주기"에서 실행한다(즉시 실행 금지).
                # => room enabled 전환 시 nextRunMs를 now+10분으로 예약하고 이번 루프에서는 스킵한다.
                if rs.get("enabled") is not True:
                    rs["enabled"] = True
                    rs["enabledAtMs"] = now_ms
                    rs["enabledAtTs"] = _iso_now()
                    self._schedule_next_cycle(rs, now_ms)
                    rs["lastResult"] = rs.get("lastResult") or "SCHEDULED_NEXT_CYCLE"
                    try:
                        self._save_state()
                    except Exception:
                        pass
                    continue

                next_run_ms = _parse_int(rs.get("nextRunMs")) or 0
                if next_run_ms <= 0:
                    self._schedule_next_cycle(rs, now_ms)
                    try:
                        self._save_state()
                    except Exception:
                        pass
                    continue

                # 너무 늦었으면(워커 다운/설정 변경 등) catch-up 하지 말고 다음 주기로 미룬다.
                if now_ms >= next_run_ms and (now_ms - next_run_ms) > (SCHEDULE_INTERVAL_SEC * 1000):
                    rs["lastResult"] = "SKIPPED_MISSED_SCHEDULE"
                    self._schedule_next_cycle(rs, now_ms)
                    try:
                        self._save_state()
                    except Exception:
                        pass
                    continue

                if now_ms < next_run_ms:
                    continue

                ran_any = True
                log(
                    "INFO",
                    "동기화 시작",
                    roomId=plan.room_id,
                    intervalSec=SCHEDULE_INTERVAL_SEC,
                    allowIncomplete=plan.allow_incomplete,
                )
                try:
                    code, stdout, stderr, dur = self._run_sync_once(plan.room_id, plan.allow_incomplete)
                    parsed = _parse_sync_output(stdout)
                    err_text = (stdout + "\n" + stderr).strip()
                    if code == 0:
                        ok_cnt += 1
                        self._update_room_state(plan.room_id, "OK", stdout, stderr, dur, parsed)
                        log("INFO", "동기화 완료(OK)", roomId=plan.room_id, durationSec=round(dur, 3))
                    else:
                        if _is_incomplete_error(err_text):
                            skip_cnt += 1
                            self._update_room_state(plan.room_id, "INCOMPLETE_MEMBER_DB", stdout, stderr, dur, parsed)
                            log("WARN", "멤버 DB 불완전 → 스킵", roomId=plan.room_id, durationSec=round(dur, 3))
                        else:
                            fail_cnt += 1
                            self._update_room_state(plan.room_id, "ERROR", stdout, stderr, dur, parsed)
                            log("ERROR", "동기화 실패", roomId=plan.room_id, code=code, durationSec=round(dur, 3))
                except subprocess.TimeoutExpired:
                    fail_cnt += 1
                    self._update_room_state(plan.room_id, "TIMEOUT", "", "timeout", 300.0, {})
                    log("ERROR", "동기화 시간초과", roomId=plan.room_id)
                    parsed = {}
                    err_text = "timeout"
                except Exception as e:
                    fail_cnt += 1
                    self._update_room_state(plan.room_id, "ERROR", "", str(e), 0.0, {})
                    log("ERROR", "동기화 예외", roomId=plan.room_id, err=str(e))
                    parsed = {}
                    err_text = str(e)

                # 성공/실패 무관하게 다음 주기로 예약(재시도 없음)
                now2 = _now_ms()
                rs2 = self._room_state(plan.room_id)
                self._schedule_next_cycle(rs2, now2)

                # 실패/스킵(INCOMPLETE 포함)은 테스트 방에 알림(재시도 없이 1회)
                result = str(rs2.get("lastResult") or "").strip()
                if result and result != "OK":
                    cycle_alert_blocks.append(self._compose_room_alert_block(plan.room_id, result, parsed, err_text))
                    cycle_alert_room_ids.append(plan.room_id)

                # 매 룸 처리 후 상태 저장/하트비트 갱신
                try:
                    self._save_state()
                except Exception as e:
                    log("WARN", "state 저장 실패(무시)", err=str(e), path=str(self.state_path))

                self._write_status(
                    state="RUNNING",
                    workerEnabled=True,
                    roomsEnabled=len(plans),
                    ok=ok_cnt,
                    failed=fail_cnt,
                    skipped=skip_cnt,
                    intervalSec=SCHEDULE_INTERVAL_SEC,
                    alertRoomId=TEST_ALERT_ROOM_ID,
                )
                last_hb_ms = _now_ms()

            if cycle_alert_blocks:
                msg = self._compose_batch_alert(cycle_alert_blocks)
                ok_alert, err_alert = self._send_alert_to_test_room(msg)
                now_alert_ts = _iso_now()
                for rid in cycle_alert_room_ids:
                    rs = self._room_state(rid)
                    rs["lastAlertTs"] = now_alert_ts
                    rs["lastAlertOk"] = bool(ok_alert)
                    rs["lastAlertError"] = "" if ok_alert else str(err_alert)[:600]
                try:
                    self._save_state()
                except Exception:
                    pass

            if not ran_any:
                # due인 방이 없으면 heartbeat만 유지
                if now_ms - last_hb_ms > 30_000:
                    self._write_status(state="IDLE", workerEnabled=True, roomsEnabled=len(plans), intervalSec=SCHEDULE_INTERVAL_SEC)
                    last_hb_ms = now_ms
                time.sleep(5)
                continue

            # 한 바퀴 돌았으면 잠깐 쉰다(설정 변경 반영을 위해 너무 길게 sleep하지 않는다)
            time.sleep(2)


def main() -> int:
    ap = argparse.ArgumentParser(description="오픈채팅 멤버 Sheets 자동 동기화 워커")
    ap.add_argument(
        "--config",
        default=os.getenv("OPENCHAT_MEMBERS_SHEETS_CONFIG") or DEFAULT_CONFIG_PATH,
        help=f"설정 파일 경로(기본: {DEFAULT_CONFIG_PATH})",
    )
    args = ap.parse_args()

    root = _repo_root()
    cfg_path = Path(args.config)
    if not cfg_path.is_absolute():
        cfg_path = (root / cfg_path).resolve()

    worker = OpenchatMembersSheetsWorker(repo_root=root, config_path=cfg_path)
    return worker.run_forever()


if __name__ == "__main__":
    raise SystemExit(main())
