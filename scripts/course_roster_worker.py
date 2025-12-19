#!/usr/bin/env python3
"""
강의 운영 자동화: 오픈채팅 입장자 카페 가입/닉네임 검증 워커.

역할
- Realtime API(/logs/stream) 구독 → member_joined / message 이벤트 소비
- 입장자 닉네임에서 "(카페닉)" 파싱 → 카페 멤버 스냅샷과 매칭(크롤러 JSON 또는 레거시 CSV)
- 정책:
  - 입장 후 15분 유예(grace) 동안은 조용히 대기
  - 15분 이후에도 미확인이면 1회 안내(멘션)
  - 24시간 이후에도 미확인이면 1회 추가 안내(멘션)
  - VERIFIED 또는 2차 안내 시도 이후 추적 종료(상태는 시트/로그에 남김)
- 결과를 Google Sheets에 upsert(강의별 시트 탭)

가드레일
- SAFE_MODE / talkApi.enabled / allowlist / 방별 feature toggle 을 모두 존중한다.
- 설정/데이터가 불완전하면 조용히 진행하지 않고 명시적으로 스킵/로그 기록한다. (FALLBACK 금지)

설정
- roomId별 매핑 파일: `data/course_roster_worker.json` (gitignore)
- Google 서비스계정: `data/gcp_service_account.json` (gitignore)

실행
  python scripts/course_roster_worker.py

주의
- Talk-API 발신은 Realtime API(`/send/talkapi/dispatch`)를 경유하며, SAFE_MODE에서 차단된다.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _safe_str(v: Any) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        try:
            if isinstance(v, float) and (v != v):
                return ""
        except Exception:
            return ""
        return str(v)
    return str(v).strip()


def _read_json(path: Path) -> Dict[str, Any]:
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return {}
    except Exception as e:
        raise RuntimeError(f"json read failed: {path} ({e})")

    try:
        obj = json.loads(raw or "{}")
    except Exception as e:
        raise RuntimeError(f"invalid json: {path} ({e})")

    return obj if isinstance(obj, dict) else {}


def _write_json_atomic(path: Path, obj: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def _ts_to_ms(ts: str) -> int:
    try:
        t = (ts or "").replace("Z", "+00:00")
        dt = datetime.fromisoformat(t)
        return int(dt.timestamp() * 1000)
    except Exception:
        return 0


def _human_ms(ms: int) -> str:
    if not ms:
        return ""
    try:
        d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
        return d.isoformat()
    except Exception:
        return ""


def _load_google_sheets_client(service_account_json: str):
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except Exception as e:
        raise SystemExit(
            "[오류] Google Sheets 라이브러리가 설치되어 있지 않습니다. "
            "`pip install -r requirements.txt` 후 다시 실행하세요. "
            f"(import error: {e})"
        )

    if not service_account_json or not os.path.exists(service_account_json):
        raise SystemExit(f"[오류] 서비스 계정 JSON 파일이 존재하지 않습니다: {service_account_json}")

    creds = Credentials.from_service_account_file(service_account_json, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def _parse_spreadsheet_id(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", s)
    if m:
        return m.group(1)
    return s


def _extract_naver_cafe_club_id(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.search(r"(?:clubid|clubId|search\.clubid|search\.clubId)=(\d+)", s, flags=re.IGNORECASE)
    if m:
        return str(m.group(1) or "").strip()
    return ""


def _col_letter(n: int) -> str:
    if n <= 0:
        raise ValueError("n must be >= 1")
    s = ""
    x = n
    while x > 0:
        x, r = divmod(x - 1, 26)
        s = chr(ord("A") + r) + s
    return s


def _ensure_sheet_exists(svc, spreadsheet_id: str, sheet_name: str) -> None:
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = meta.get("sheets") or []
    titles = {s.get("properties", {}).get("title") for s in sheets if isinstance(s, dict)}
    if sheet_name in titles:
        return
    req = {"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]}
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=req).execute()


def _get_values(svc, spreadsheet_id: str, rng: str) -> List[List[str]]:
    res = svc.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=rng).execute()
    values = res.get("values") or []
    out: List[List[str]] = []
    for row in values:
        if isinstance(row, list):
            out.append([_safe_str(x) for x in row])
    return out


def _update_values(svc, spreadsheet_id: str, rng: str, values: List[List[str]]) -> None:
    body = {"range": rng, "majorDimension": "ROWS", "values": values}
    svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=rng,
        valueInputOption="RAW",
        body=body,
    ).execute()


def _batch_update_rows(svc, spreadsheet_id: str, sheet_name: str, items: List[Tuple[int, List[str]]], last_col: str) -> None:
    if not items:
        return
    chunk = 400
    for i in range(0, len(items), chunk):
        part = items[i : i + chunk]
        data = []
        for row_no, row_vals in part:
            data.append({"range": f"{sheet_name}!A{row_no}:{last_col}{row_no}", "values": [row_vals]})
        body = {"valueInputOption": "RAW", "data": data}
        svc.spreadsheets().values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()


def _append_rows(svc, spreadsheet_id: str, sheet_name: str, rows: List[List[str]], last_col: str) -> None:
    if not rows:
        return
    svc.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:{last_col}",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()


class TTLCache:
    def __init__(self, ttl_ms: int):
        self.ttl_ms = max(1, int(ttl_ms))
        self._m: Dict[str, int] = {}

    def seen(self, key: str) -> bool:
        now = _now_ms()
        if len(self._m) > 50000:
            self._m = {k: v for k, v in self._m.items() if v > now}
        exp = self._m.get(key)
        if exp and exp > now:
            return True
        self._m[key] = now + self.ttl_ms
        return False


@dataclass
class RoomConfig:
    room_id: str
    enabled: bool
    spreadsheet_id: str
    roster_sheet: str
    cafe_source: str  # crawler | csv(레거시)
    cafe_url: str
    cafe_club_id: str
    crawler_repo_path: str
    crawler_python_exe: str
    crawler_settings_path: str
    cafe_csv_path: str  # 레거시
    join_url: str


@dataclass
class Policy:
    grace_ms: int
    remind2_ms: int
    check_interval_sec: int
    cafe_cache_sec: int
    verify_cooldown_sec: int


@dataclass
class CafeSnapshot:
    loaded_at_ms: int
    source_mtime_ms: int
    snapshot_at_ms: int
    nickname_to_user_ids: Dict[str, List[str]]
    error: str


@dataclass
class PendingMember:
    room_id: str
    room_name: str
    kakao_user_id: str
    kakao_name: str
    joined_at_ms: int
    last_seen_ms: int
    last_check_ms: int
    status: str
    cafe_nickname: str
    cafe_user_id: str
    nudge1_at_ms: int
    nudge1_ok: Optional[bool]
    nudge2_at_ms: int
    nudge2_ok: Optional[bool]
    verified_at_ms: int
    last_error: str

class SheetsRosterUpserter:
    def __init__(self, service_account_json: str):
        self.svc = _load_google_sheets_client(service_account_json)
        self.index: Dict[Tuple[str, str], Dict[str, int]] = {}
        self.header_ok: Dict[Tuple[str, str], bool] = {}
        self.queue: Dict[Tuple[str, str], Dict[str, List[str]]] = defaultdict(dict)

        self.header = [
            "key",
            "roomId",
            "roomName",
            "kakaoUserId",
            "kakaoNickname",
            "cafeNicknameParsed",
            "cafeUserId",
            "status",
            "joinedAt",
            "verifiedAt",
            "nudge1At",
            "nudge1Ok",
            "nudge2At",
            "nudge2Ok",
            "lastSeenAt",
            "lastCheckedAt",
            "cafeSnapshotAt",
            "workerUpdatedAt",
            "lastError",
        ]

    def _ensure_ready(self, spreadsheet_id: str, sheet_name: str) -> None:
        key = (spreadsheet_id, sheet_name)
        if self.header_ok.get(key):
            return

        _ensure_sheet_exists(self.svc, spreadsheet_id, sheet_name)

        header_vals = _get_values(self.svc, spreadsheet_id, f"{sheet_name}!A1:Z1")
        cur = header_vals[0] if header_vals else []
        if cur[: len(self.header)] != self.header:
            last_col = _col_letter(len(self.header))
            _update_values(self.svc, spreadsheet_id, f"{sheet_name}!A1:{last_col}1", [self.header])

        col = _get_values(self.svc, spreadsheet_id, f"{sheet_name}!A2:A")
        idx: Dict[str, int] = {}
        for i, row in enumerate(col):
            k = row[0] if row else ""
            if not k:
                continue
            idx[k] = 2 + i
        self.index[key] = idx
        self.header_ok[key] = True

    def enqueue(self, spreadsheet_id: str, sheet_name: str, key_str: str, row_values: List[str]) -> None:
        sid = _parse_spreadsheet_id(spreadsheet_id)
        if not sid:
            raise RuntimeError("spreadsheet_id is empty")
        self._ensure_ready(sid, sheet_name)
        self.queue[(sid, sheet_name)][key_str] = row_values

    def flush(self) -> None:
        for (sid, sheet), items in list(self.queue.items()):
            if not items:
                continue
            self._ensure_ready(sid, sheet)
            idx = self.index.get((sid, sheet), {})
            last_col = _col_letter(len(self.header))

            updates: List[Tuple[int, List[str]]] = []
            appends: List[List[str]] = []

            for k, row in items.items():
                row_no = idx.get(k)
                if row_no:
                    updates.append((row_no, row))
                else:
                    appends.append(row)

            if updates:
                _batch_update_rows(self.svc, sid, sheet, updates, last_col)
            if appends:
                _append_rows(self.svc, sid, sheet, appends, last_col)
                start_row = max(idx.values(), default=1) + 1
                for i, row in enumerate(appends):
                    k = row[0] if row else ""
                    if k:
                        idx[k] = start_row + i
                self.index[(sid, sheet)] = idx

            self.queue[(sid, sheet)] = {}


class CafeSnapshotLoader:
    def __init__(self, policy: Policy):
        self.policy = policy
        self.cache: Dict[str, CafeSnapshot] = {}
        self.repo_root = Path(__file__).resolve().parents[1]
        self.snap_dir = (self.repo_root / "data" / "course_roster_worker" / "cafe_snapshots").resolve()
        self.bridge_script = (self.repo_root / "scripts" / "crawl_naver_cafe_members.py").resolve()

    def load(self, rm: RoomConfig) -> CafeSnapshot:
        src = str(rm.cafe_source or "").strip().lower()
        if src == "crawler":
            return self._load_from_crawler(
                club_id=rm.cafe_club_id,
                crawler_repo=rm.crawler_repo_path,
                python_exe=rm.crawler_python_exe,
                settings_path=rm.crawler_settings_path,
                cafe_name=f"club_{rm.cafe_club_id}",
            )
        if src == "csv":
            return self._load_from_csv(rm.cafe_csv_path)
        return CafeSnapshot(
            loaded_at_ms=_now_ms(),
            source_mtime_ms=0,
            snapshot_at_ms=0,
            nickname_to_user_ids={},
            error=f"지원하지 않는 cafe_source: {rm.cafe_source}",
        )

    def _load_from_csv(self, csv_path: str) -> CafeSnapshot:
        p = Path(csv_path)
        if not p.exists():
            raise FileNotFoundError(f"카페 CSV가 존재하지 않습니다: {csv_path}")

        mtime_ms = int(p.stat().st_mtime * 1000)
        key = f"csv:{str(p)}"
        cached = self.cache.get(key)
        now = _now_ms()
        if cached:
            fresh_by_ttl = (now - cached.loaded_at_ms) < (self.policy.cafe_cache_sec * 1000)
            fresh_by_mtime = cached.source_mtime_ms == mtime_ms
            if fresh_by_ttl and fresh_by_mtime:
                return cached

        nickname_to_ids: Dict[str, List[str]] = defaultdict(list)
        with p.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                raise RuntimeError(f"카페 CSV header가 비어있습니다: {csv_path}")
            fields = [str(x or "").strip() for x in reader.fieldnames]
            if "nickname" not in fields or "user_id" not in fields:
                raise RuntimeError(f"카페 CSV header에 nickname/user_id 컬럼이 없습니다: {fields}")
            for row in reader:
                if not isinstance(row, dict):
                    continue
                nick = str(row.get("nickname") or "").strip()
                uid = str(row.get("user_id") or "").strip()
                if not nick or not uid:
                    continue
                nickname_to_ids[nick].append(uid)

        snap = CafeSnapshot(
            loaded_at_ms=now,
            source_mtime_ms=mtime_ms,
            snapshot_at_ms=mtime_ms,
            nickname_to_user_ids=dict(nickname_to_ids),
            error="",
        )
        self.cache[key] = snap
        return snap

    def _read_crawler_snapshot(self, path: Path, source_mtime_ms: int) -> CafeSnapshot:
        now = _now_ms()
        try:
            raw = path.read_text(encoding="utf-8-sig")
            obj = json.loads(raw or "{}")
        except Exception as e:
            return CafeSnapshot(
                loaded_at_ms=now,
                source_mtime_ms=source_mtime_ms,
                snapshot_at_ms=source_mtime_ms,
                nickname_to_user_ids={},
                error=f"카페 스냅샷 JSON 파싱 실패: {e}",
            )
        if not isinstance(obj, dict):
            return CafeSnapshot(
                loaded_at_ms=now,
                source_mtime_ms=source_mtime_ms,
                snapshot_at_ms=source_mtime_ms,
                nickname_to_user_ids={},
                error="카페 스냅샷 JSON 형식 오류(object 필요)",
            )

        ok = bool(obj.get("ok"))
        err = str(obj.get("error") or "").strip()
        fetched_at_ms = _ts_to_ms(str(obj.get("fetchedAt") or "").strip()) or source_mtime_ms

        members = obj.get("members") if isinstance(obj.get("members"), list) else []
        nickname_to_ids: Dict[str, List[str]] = defaultdict(list)
        for m in members:
            if not isinstance(m, dict):
                continue
            nick = str(m.get("cafeNickname") or "").strip()
            uid = str(m.get("cafeUserId") or "").strip()
            if not nick or not uid:
                continue
            nickname_to_ids[nick].append(uid)

        return CafeSnapshot(
            loaded_at_ms=now,
            source_mtime_ms=source_mtime_ms,
            snapshot_at_ms=fetched_at_ms,
            nickname_to_user_ids=dict(nickname_to_ids),
            error=("" if ok else (err or "crawl_failed")),
        )

    def _load_from_crawler(
        self,
        *,
        club_id: str,
        crawler_repo: str,
        python_exe: str,
        settings_path: str,
        cafe_name: str,
    ) -> CafeSnapshot:
        club = str(club_id or "").strip()
        if not club:
            return CafeSnapshot(
                loaded_at_ms=_now_ms(),
                source_mtime_ms=0,
                snapshot_at_ms=0,
                nickname_to_user_ids={},
                error="cafeClubId가 비어 있습니다.",
            )

        refresh_ms = max(30, int(self.policy.cafe_cache_sec)) * 1000
        key = f"crawler:{club}"
        out_path = (self.snap_dir / f"club_{club}.json").resolve()

        now = _now_ms()
        file_mtime_ms = int(out_path.stat().st_mtime * 1000) if out_path.exists() else 0
        cached = self.cache.get(key)
        if cached and file_mtime_ms and cached.source_mtime_ms == file_mtime_ms:
            if cached.snapshot_at_ms and (now - cached.snapshot_at_ms) < refresh_ms:
                return cached

        # 파일이 있고 충분히 최근이면(갱신 주기 내) 크롤링 없이 읽어서 사용
        if out_path.exists() and file_mtime_ms:
            snap = self._read_crawler_snapshot(out_path, file_mtime_ms)
            if snap.snapshot_at_ms and (now - snap.snapshot_at_ms) < refresh_ms:
                self.cache[key] = snap
                return snap

        # 크롤링 수행
        if not python_exe or not Path(python_exe).exists():
            snap = CafeSnapshot(
                loaded_at_ms=_now_ms(),
                source_mtime_ms=file_mtime_ms,
                snapshot_at_ms=0,
                nickname_to_user_ids={},
                error=f"crawler pythonExe 경로가 없거나 존재하지 않습니다: {python_exe}",
            )
            self.cache[key] = snap
            return snap
        if not crawler_repo or not Path(crawler_repo).exists():
            snap = CafeSnapshot(
                loaded_at_ms=_now_ms(),
                source_mtime_ms=file_mtime_ms,
                snapshot_at_ms=0,
                nickname_to_user_ids={},
                error=f"crawler repoPath 경로가 없거나 존재하지 않습니다: {crawler_repo}",
            )
            self.cache[key] = snap
            return snap
        if settings_path and not Path(settings_path).exists():
            snap = CafeSnapshot(
                loaded_at_ms=_now_ms(),
                source_mtime_ms=file_mtime_ms,
                snapshot_at_ms=0,
                nickname_to_user_ids={},
                error=f"crawler settingsPath 경로가 존재하지 않습니다: {settings_path}",
            )
            self.cache[key] = snap
            return snap
        if not self.bridge_script.exists():
            snap = CafeSnapshot(
                loaded_at_ms=_now_ms(),
                source_mtime_ms=file_mtime_ms,
                snapshot_at_ms=0,
                nickname_to_user_ids={},
                error=f"bridge script가 없습니다: {self.bridge_script}",
            )
            self.cache[key] = snap
            return snap

        self.snap_dir.mkdir(parents=True, exist_ok=True)
        args = [
            str(python_exe),
            str(self.bridge_script),
            "--crawler-repo",
            str(crawler_repo),
            "--club-id",
            club,
            "--cafe-name",
            str(cafe_name or f"club_{club}"),
            "--output",
            str(out_path),
        ]
        if str(settings_path or "").strip():
            args.extend(["--settings", str(settings_path)])

        try:
            p = subprocess.run(args, capture_output=True, text=True, timeout=900)
        except Exception as e:
            snap = CafeSnapshot(
                loaded_at_ms=_now_ms(),
                source_mtime_ms=file_mtime_ms,
                snapshot_at_ms=0,
                nickname_to_user_ids={},
                error=f"카페 크롤링 실행 실패: {e}",
            )
            self.cache[key] = snap
            return snap

        file_mtime_ms = int(out_path.stat().st_mtime * 1000) if out_path.exists() else 0
        snap = self._read_crawler_snapshot(out_path, file_mtime_ms)
        if p.returncode != 0 and not snap.error:
            hint = (p.stderr or p.stdout or "").strip()
            snap.error = f"카페 크롤링 실패(code={p.returncode}): {hint[:200]}"
        self.cache[key] = snap
        return snap


class CourseRosterWorker:
    def __init__(
        self,
        realtime_base: str,
        runtime_path: Path,
        config_path: Path,
        status_path: Path,
        state_path: Path,
        lock_path: Path,
        policy: Policy,
        service_account_json: str,
    ):
        self.realtime_base = realtime_base.rstrip("/")
        self.runtime_path = runtime_path
        self.config_path = config_path
        self.status_path = status_path
        self.state_path = state_path
        self.lock_path = lock_path
        self.policy = policy

        self.rooms: Dict[str, RoomConfig] = {}
        self.pending: Dict[str, PendingMember] = {}
        self.last_seen_ms: int = 0
        self.last_tick_ms: int = 0
        self.last_flush_ms: int = 0
        self.last_runtime_load_ms: int = 0
        self.runtime_cache: Dict[str, Any] = {}

        self.event_dedup = TTLCache(10 * 60 * 1000)
        self.join_dedup = TTLCache(10 * 60 * 1000)

        self.cafe_loader = CafeSnapshotLoader(policy)
        self.sheets = SheetsRosterUpserter(service_account_json)

    def log(self, level: str, msg: str, **fields: Any) -> None:
        payload = {"ts": _iso_now(), "level": level, "msg": msg}
        if fields:
            payload.update(fields)
        print(json.dumps(payload, ensure_ascii=False), flush=True)

    def _load_rooms_config(self) -> None:
        cfg = _read_json(self.config_path)
        rooms_obj = cfg.get("rooms")
        if not isinstance(rooms_obj, dict) or not rooms_obj:
            raise SystemExit(
                f"[오류] roster worker config가 비어있습니다: {self.config_path}\n"
                f"- 예시 파일을 참고해 roomId별 시트/카페 설정을 등록하세요: config/course_roster_worker.example.json"
            )

        rooms: Dict[str, RoomConfig] = {}
        for rid, v in rooms_obj.items():
            rid2 = str(rid or "").strip()
            if not rid2 or not isinstance(v, dict):
                continue

            enabled = bool(v.get("enabled", True))
            sheet_id = _parse_spreadsheet_id(str(v.get("spreadsheetId") or v.get("sheetId") or "").strip())
            roster_sheet = str(v.get("rosterSheet") or v.get("rosterSheetName") or "ROSTER_RAW").strip() or "ROSTER_RAW"
            cafe_source_raw = str(v.get("cafeSource") or "").strip().lower()
            cafe_csv = str(v.get("cafeCsvPath") or "").strip()
            cafe_club_id = str(v.get("cafeClubId") or v.get("clubId") or "").strip()
            crawler_repo = (
                str(v.get("crawlerRepoPath") or "").strip()
                or str(os.getenv("NAVER_CAFE_CRAWLER_REPO") or "").strip()
                or "C:\\dev\\naver-cafe-member-crawler"
            )
            crawler_py = (
                str(v.get("crawlerPythonExe") or "").strip()
                or str(os.getenv("NAVER_CAFE_CRAWLER_PYTHON") or "").strip()
            )
            if not crawler_py and crawler_repo:
                crawler_py = str((Path(crawler_repo) / "venv" / "Scripts" / "python.exe").resolve())
            crawler_settings = (
                str(v.get("crawlerSettingsPath") or "").strip()
                or str(os.getenv("NAVER_CAFE_CRAWLER_SETTINGS") or "").strip()
            )
            join_url = str(v.get("joinUrl") or "").strip()
            cafe_url = str(v.get("cafeUrl") or "").strip()

            if not cafe_club_id:
                extracted = _extract_naver_cafe_club_id(cafe_url or join_url)
                if extracted:
                    cafe_club_id = extracted

            cafe_source = cafe_source_raw
            if cafe_source not in ("crawler", "csv"):
                # 하위 호환(구 설정): clubId가 있으면 crawler, 아니면 csv를 사용한다.
                if cafe_club_id and cafe_csv:
                    cafe_source = "ambiguous"
                elif cafe_club_id:
                    cafe_source = "crawler"
                elif cafe_csv:
                    cafe_source = "csv"
                else:
                    cafe_source = ""

            missing: list[str] = []
            if not sheet_id:
                missing.append("spreadsheetId")
            if cafe_source == "crawler":
                if not cafe_club_id:
                    missing.append("cafeClubId")
                if not crawler_repo or not Path(crawler_repo).exists():
                    missing.append("crawlerRepoPath")
                if not crawler_py or not Path(crawler_py).exists():
                    missing.append("crawlerPythonExe")
                if crawler_settings and not Path(crawler_settings).exists():
                    missing.append("crawlerSettingsPath")
            elif cafe_source == "csv":
                if not cafe_csv:
                    missing.append("cafeCsvPath")
                elif not Path(cafe_csv).exists():
                    missing.append("cafeCsvMissing")
            elif cafe_source == "ambiguous":
                missing.append("cafeSource(ambiguous: set cafeSource)")
            else:
                missing.append("cafeSource")

            if enabled and missing:
                self.log(
                    "WARN",
                    "room config incomplete; disabled",
                    roomId=rid2,
                    enabled=enabled,
                    spreadsheetId=sheet_id,
                    cafeSource=(cafe_source or "[missing]"),
                    cafeClubId=("[missing]" if not cafe_club_id else cafe_club_id),
                    cafeCsvPath=("[missing]" if not cafe_csv else cafe_csv),
                    missing=",".join(missing),
                )
                enabled = False

            rooms[rid2] = RoomConfig(
                room_id=rid2,
                enabled=enabled,
                spreadsheet_id=sheet_id,
                roster_sheet=roster_sheet,
                cafe_source=cafe_source or "crawler",
                cafe_url=cafe_url,
                cafe_club_id=cafe_club_id,
                crawler_repo_path=crawler_repo,
                crawler_python_exe=crawler_py,
                crawler_settings_path=crawler_settings,
                cafe_csv_path=cafe_csv,
                join_url=join_url,
            )

        if not rooms:
            raise SystemExit(f"[오류] rooms 설정이 없습니다: {self.config_path}")

        self.rooms = rooms
        self.log("INFO", "config loaded", rooms=len(self.rooms))

    def _load_runtime_cached(self) -> Dict[str, Any]:
        now = _now_ms()
        if self.runtime_cache and (now - self.last_runtime_load_ms) < 1500:
            return self.runtime_cache
        cfg = _read_json(self.runtime_path)
        self.runtime_cache = cfg
        self.last_runtime_load_ms = now
        return cfg

    def _room_runtime_features(self, runtime: Dict[str, Any], room_id: str) -> Dict[str, Any]:
        feats = runtime.get("features")
        if isinstance(feats, dict):
            v = feats.get(room_id)
            if isinstance(v, dict):
                return v
        return {}

    def _is_room_allowed(self, runtime: Dict[str, Any], room_id: str) -> bool:
        allow = runtime.get("allowedRoomIds")
        if not isinstance(allow, list):
            return False
        return room_id in [str(x).strip() for x in allow if str(x).strip()]

    def _is_send_enabled(self, runtime: Dict[str, Any], room_id: str) -> Tuple[bool, str]:
        if bool(runtime.get("safeMode", True)):
            return False, "SAFE_MODE"
        if not self._is_room_allowed(runtime, room_id):
            return False, "ROOM_NOT_ALLOWED"

        feats = self._room_runtime_features(runtime, room_id)
        if feats.get("courseRoster") is not True:
            return False, "COURSE_ROSTER_DISABLED"

        talk = runtime.get("talkApi")
        if not isinstance(talk, dict) or not bool(talk.get("enabled")):
            return False, "TALKAPI_DISABLED"

        return True, ""

    def _make_key(self, room_id: str, user_id: str) -> str:
        return f"{room_id}:{user_id}"

    def _parse_cafe_nickname(self, kakao_name: str) -> str:
        s = str(kakao_name or "").strip()
        if not s:
            return ""
        m = re.search(r"\(([^()]{1,64})\)\s*$", s)
        if m:
            return str(m.group(1) or "").strip()
        return ""

    def _send_mention(self, room_id: str, user_id: str, name: str, message: str, timeout_sec: float = 12.0) -> Tuple[bool, str]:
        url = f"{self.realtime_base}/send/talkapi/dispatch"
        body = {"roomId": room_id, "message": message, "mentionees": [{"name": name, "userId": user_id}]}
        try:
            r = requests.post(url, json=body, timeout=timeout_sec)
            j = r.json() if r.content else {}
            if r.status_code >= 400:
                detail = _safe_str((j or {}).get("detail") or (j or {}).get("error") or f"HTTP {r.status_code}")
                return False, detail
            ok = bool((j or {}).get("ok"))
            if not ok:
                err = _safe_str(((j or {}).get("talkApi") or {}).get("errMsg") or (j or {}).get("detail") or "send_failed")
                return False, err
            return True, ""
        except Exception as e:
            return False, str(e)

    def _upsert_row(self, rm: RoomConfig, pm: PendingMember, cafe_snapshot_at_ms: int) -> None:
        key = self._make_key(pm.room_id, pm.kakao_user_id)
        values_by_header = {
            "key": key,
            "roomId": pm.room_id,
            "roomName": pm.room_name,
            "kakaoUserId": pm.kakao_user_id,
            "kakaoNickname": pm.kakao_name,
            "cafeNicknameParsed": pm.cafe_nickname,
            "cafeUserId": pm.cafe_user_id,
            "status": pm.status,
            "joinedAt": _human_ms(pm.joined_at_ms),
            "verifiedAt": _human_ms(pm.verified_at_ms),
            "nudge1At": _human_ms(pm.nudge1_at_ms),
            "nudge1Ok": "" if pm.nudge1_ok is None else ("1" if pm.nudge1_ok else "0"),
            "nudge2At": _human_ms(pm.nudge2_at_ms),
            "nudge2Ok": "" if pm.nudge2_ok is None else ("1" if pm.nudge2_ok else "0"),
            "lastSeenAt": _human_ms(pm.last_seen_ms),
            "lastCheckedAt": _human_ms(pm.last_check_ms),
            "cafeSnapshotAt": _human_ms(cafe_snapshot_at_ms),
            "workerUpdatedAt": _iso_now(),
            "lastError": pm.last_error or "",
        }
        row = [values_by_header.get(h, "") for h in self.sheets.header]
        self.sheets.enqueue(rm.spreadsheet_id, rm.roster_sheet, key, row)

    def _try_verify(self, rm: RoomConfig, pm: PendingMember) -> Tuple[bool, str, int]:
        cafe_nick = self._parse_cafe_nickname(pm.kakao_name)
        pm.cafe_nickname = cafe_nick
        if not cafe_nick:
            return False, "INVALID_NICKNAME_FORMAT", 0

        try:
            snap = self.cafe_loader.load(rm)
        except Exception as e:
            pm.last_error = str(e)
            return False, "CAFE_SNAPSHOT_ERROR", 0
        if snap.error:
            pm.last_error = snap.error
            return False, "CAFE_SNAPSHOT_ERROR", snap.snapshot_at_ms

        ids = snap.nickname_to_user_ids.get(cafe_nick) or []
        if not ids:
            return False, "NOT_FOUND_IN_CAFE", snap.snapshot_at_ms
        if len(ids) > 1:
            return False, "AMBIGUOUS_NICKNAME", snap.snapshot_at_ms

        pm.cafe_user_id = ids[0]
        return True, "", snap.snapshot_at_ms

    def _compose_nudge1(self, rm: RoomConfig, name: str) -> str:
        lines = [
            f"@{name} 카페 가입/닉네임 확인이 필요합니다.",
            "1) 비공개 카페 가입을 완료해주세요.",
            "2) 오픈채팅 닉네임을 `이름@름(카페닉네임)` 형식으로 맞춰주세요.",
            "완료 후 15분 내 자동 확인됩니다.",
        ]
        if rm.join_url:
            lines.insert(2, f"- 가입 링크: {rm.join_url}")
        return "\n".join(lines)

    def _compose_nudge2(self, rm: RoomConfig, name: str) -> str:
        lines = [
            f"@{name} 아직 카페 가입/닉네임이 확인되지 않았습니다.",
            "오픈채팅 닉네임을 `이름@름(카페닉네임)` 형식으로 맞춘 뒤, 카페 가입을 완료해주세요.",
        ]
        if rm.join_url:
            lines.append(f"- 가입 링크: {rm.join_url}")
        return "\n".join(lines)

    def _compose_verified(self, name: str) -> str:
        return f"@{name} 확인되었습니다. 편하게 소통해주시면 됩니다!"

    def _load_state(self) -> None:
        obj = _read_json(self.state_path)
        self.last_seen_ms = int(obj.get("lastSeenMs") or 0)
        pending_list = obj.get("pending")
        if isinstance(pending_list, list):
            for item in pending_list:
                if not isinstance(item, dict):
                    continue
                try:
                    pm = PendingMember(
                        room_id=str(item.get("roomId") or "").strip(),
                        room_name=str(item.get("roomName") or "").strip(),
                        kakao_user_id=str(item.get("kakaoUserId") or "").strip(),
                        kakao_name=str(item.get("kakaoNickname") or "").strip(),
                        joined_at_ms=int(item.get("joinedAtMs") or 0),
                        last_seen_ms=int(item.get("lastSeenMs") or 0),
                        last_check_ms=int(item.get("lastCheckMs") or 0),
                        status=str(item.get("status") or "PENDING"),
                        cafe_nickname=str(item.get("cafeNicknameParsed") or ""),
                        cafe_user_id=str(item.get("cafeUserId") or ""),
                        nudge1_at_ms=int(item.get("nudge1AtMs") or 0),
                        nudge1_ok=item.get("nudge1Ok", None),
                        nudge2_at_ms=int(item.get("nudge2AtMs") or 0),
                        nudge2_ok=item.get("nudge2Ok", None),
                        verified_at_ms=int(item.get("verifiedAtMs") or 0),
                        last_error=str(item.get("lastError") or ""),
                    )
                    if pm.room_id and pm.kakao_user_id and pm.joined_at_ms:
                        self.pending[self._make_key(pm.room_id, pm.kakao_user_id)] = pm
                except Exception:
                    continue

    def _save_state(self) -> None:
        out = {
            "lastSeenMs": self.last_seen_ms,
            "pending": [
                {
                    "roomId": pm.room_id,
                    "roomName": pm.room_name,
                    "kakaoUserId": pm.kakao_user_id,
                    "kakaoNickname": pm.kakao_name,
                    "joinedAtMs": pm.joined_at_ms,
                    "lastSeenMs": pm.last_seen_ms,
                    "lastCheckMs": pm.last_check_ms,
                    "status": pm.status,
                    "cafeNicknameParsed": pm.cafe_nickname,
                    "cafeUserId": pm.cafe_user_id,
                    "nudge1AtMs": pm.nudge1_at_ms,
                    "nudge1Ok": pm.nudge1_ok,
                    "nudge2AtMs": pm.nudge2_at_ms,
                    "nudge2Ok": pm.nudge2_ok,
                    "verifiedAtMs": pm.verified_at_ms,
                    "lastError": pm.last_error,
                }
                for pm in self.pending.values()
            ],
            "updatedAt": _iso_now(),
        }
        _write_json_atomic(self.state_path, out)

    def _write_status(self, **extra: Any) -> None:
        payload = {
            "pid": os.getpid(),
            "heartbeatTs": _iso_now(),
            "lastSeenMs": self.last_seen_ms,
            "pending": len(self.pending),
        }
        payload.update(extra)
        _write_json_atomic(self.status_path, payload)

    def _acquire_lock(self) -> None:
        self.lock_path.parent.mkdir(parents=True, exist_ok=True)
        if self.lock_path.exists():
            status = _read_json(self.status_path)
            hb = str(status.get("heartbeatTs") or "").strip()
            hb_age_sec = None
            try:
                if hb:
                    dt = datetime.fromisoformat(hb.replace("Z", "+00:00")).astimezone(timezone.utc)
                    hb_age_sec = (datetime.now(timezone.utc) - dt).total_seconds()
            except Exception:
                hb_age_sec = None

            if hb_age_sec is not None and hb_age_sec <= 300:
                raise SystemExit(f"[오류] roster-worker 중복 실행 감지(heartbeat age={int(hb_age_sec)}s): {self.lock_path}")

            try:
                self.lock_path.unlink()
            except Exception:
                raise SystemExit(f"[오류] stale lock 제거 실패: {self.lock_path}")

        self.lock_path.write_text(str(os.getpid()), encoding="utf-8")

    def _handle_join(self, room_id: str, room_name: str, user_id: str, name: str, ts_ms: int) -> None:
        rm = self.rooms.get(room_id)
        if not rm or not rm.enabled:
            return

        dedup_key = f"{room_id}:{user_id}:{int(ts_ms/1000)}"
        if self.join_dedup.seen(dedup_key):
            return

        key = self._make_key(room_id, user_id)
        now = _now_ms()

        pm = self.pending.get(key)
        if not pm:
            pm = PendingMember(
                room_id=room_id,
                room_name=room_name,
                kakao_user_id=user_id,
                kakao_name=name,
                joined_at_ms=ts_ms or now,
                last_seen_ms=ts_ms or now,
                last_check_ms=0,
                status="PENDING",
                cafe_nickname="",
                cafe_user_id="",
                nudge1_at_ms=0,
                nudge1_ok=None,
                nudge2_at_ms=0,
                nudge2_ok=None,
                verified_at_ms=0,
                last_error="",
            )
            self.pending[key] = pm
        else:
            pm.room_name = room_name or pm.room_name
            if name:
                pm.kakao_name = name
            pm.last_seen_ms = now

        self._maybe_verify_and_act(pm, allow_send=True)

    def _handle_message(self, room_id: str, room_name: str, user_id: str, name: str, ts_ms: int) -> None:
        rm = self.rooms.get(room_id)
        if not rm or not rm.enabled:
            return
        key = self._make_key(room_id, user_id)
        pm = self.pending.get(key)
        if not pm:
            return
        if room_name:
            pm.room_name = room_name
        if name:
            pm.kakao_name = name
        pm.last_seen_ms = ts_ms or _now_ms()

        now = _now_ms()
        if pm.last_check_ms and (now - pm.last_check_ms) < (self.policy.verify_cooldown_sec * 1000):
            return
        self._maybe_verify_and_act(pm, allow_send=True)

    def _maybe_verify_and_act(self, pm: PendingMember, allow_send: bool) -> None:
        now = _now_ms()
        pm.last_check_ms = now
        rm = self.rooms.get(pm.room_id)
        if not rm or not rm.enabled:
            return

        runtime = self._load_runtime_cached()
        send_ok, send_reason = self._is_send_enabled(runtime, pm.room_id)
        if not send_ok:
            allow_send = False
            pm.last_error = send_reason

        verified, reason, snap_at_ms = False, "", 0
        try:
            verified, reason, snap_at_ms = self._try_verify(rm, pm)
        except Exception as e:
            pm.last_error = str(e)
            reason = "CAFE_SNAPSHOT_ERROR"

        if verified:
            if pm.status != "VERIFIED":
                pm.status = "VERIFIED"
                pm.verified_at_ms = now
                pm.last_error = ""
                if allow_send:
                    msg = self._compose_verified(pm.kakao_name or "Guest")
                    ok, err = self._send_mention(pm.room_id, pm.kakao_user_id, pm.kakao_name or "Guest", msg)
                    if not ok:
                        pm.last_error = f"verified_send_failed:{err}"
                self.log("INFO", "verified", roomId=pm.room_id, userId=pm.kakao_user_id, cafeUserId=pm.cafe_user_id)

            self._upsert_row(rm, pm, snap_at_ms)
            self.pending.pop(self._make_key(pm.room_id, pm.kakao_user_id), None)
            return

        if reason == "INVALID_NICKNAME_FORMAT":
            pm.status = "INVALID_NICK"
        elif reason == "AMBIGUOUS_NICKNAME":
            pm.status = "AMBIGUOUS"
        elif reason == "CAFE_SNAPSHOT_ERROR":
            pm.status = "SNAPSHOT_ERROR"
        else:
            pm.status = "PENDING"

        self._upsert_row(rm, pm, snap_at_ms)

    def tick(self) -> None:
        now = _now_ms()
        if self.last_tick_ms and (now - self.last_tick_ms) < (self.policy.check_interval_sec * 1000):
            return
        self.last_tick_ms = now

        runtime = self._load_runtime_cached()

        keys = list(self.pending.keys())
        for key in keys:
            pm = self.pending.get(key)
            if not pm:
                continue
            rm = self.rooms.get(pm.room_id)
            if not rm or not rm.enabled:
                continue

            try:
                self._maybe_verify_and_act(pm, allow_send=True)
            except Exception as e:
                pm.last_error = str(e)

            if key not in self.pending:
                continue

            age = now - pm.joined_at_ms

            send_ok, send_reason = self._is_send_enabled(runtime, pm.room_id)
            if not send_ok:
                pm.last_error = send_reason
                continue
            if pm.status == "SNAPSHOT_ERROR":
                # 카페 스냅샷(크롤러/CSV) 자체가 불안정한 상태에서는 오발신을 막기 위해 안내를 스킵한다.
                continue

            if pm.nudge1_at_ms == 0 and age >= self.policy.grace_ms:
                msg = self._compose_nudge1(rm, pm.kakao_name or "Guest")
                ok, err = self._send_mention(pm.room_id, pm.kakao_user_id, pm.kakao_name or "Guest", msg)
                pm.nudge1_at_ms = now
                pm.nudge1_ok = ok
                pm.last_error = "" if ok else f"nudge1_send_failed:{err}"
                pm.status = "NUDGE1"
                self.log("INFO", "nudge1 attempted", roomId=pm.room_id, userId=pm.kakao_user_id, ok=ok)
                self._upsert_row(rm, pm, 0)
                continue

            if pm.nudge2_at_ms == 0 and age >= self.policy.remind2_ms:
                msg = self._compose_nudge2(rm, pm.kakao_name or "Guest")
                ok, err = self._send_mention(pm.room_id, pm.kakao_user_id, pm.kakao_name or "Guest", msg)
                pm.nudge2_at_ms = now
                pm.nudge2_ok = ok
                pm.last_error = "" if ok else f"nudge2_send_failed:{err}"
                pm.status = "NUDGE2"
                self.log("INFO", "nudge2 attempted", roomId=pm.room_id, userId=pm.kakao_user_id, ok=ok)
                self._upsert_row(rm, pm, 0)
                self.pending.pop(key, None)
                continue

        if (now - self.last_flush_ms) >= 10_000:
            try:
                self.sheets.flush()
            except Exception as e:
                self.log("WARN", "sheets flush failed", err=str(e))
            self.last_flush_ms = now

        try:
            self._save_state()
        except Exception as e:
            self.log("WARN", "state save failed", err=str(e))

        try:
            self._write_status()
        except Exception:
            pass

    def _parse_join_feed(self, text: str) -> List[Tuple[str, str]]:
        s = (text or "").strip()
        if not (s.startswith("{") and s.endswith("}")):
            return []
        try:
            obj = json.loads(s)
        except Exception:
            return []

        feed_type = obj.get("feedType")
        try:
            if int(feed_type) != 4:
                return []
        except Exception:
            return []

        members = obj.get("members")
        if not isinstance(members, list):
            m1 = obj.get("member")
            members = [m1] if isinstance(m1, dict) else []

        out: List[Tuple[str, str]] = []
        for m in members:
            if not isinstance(m, dict):
                continue
            uid = str(m.get("userId") or "").strip()
            nm = str(m.get("nickName") or "").strip()
            if uid:
                out.append((uid, nm or "Guest"))
        return out

    def process_entry(self, entry: Dict[str, Any]) -> None:
        room_id = str(entry.get("roomId") or "").strip()
        if not room_id:
            return
        rm = self.rooms.get(room_id)
        if not rm or not rm.enabled:
            return

        runtime = self._load_runtime_cached()
        if not self._is_room_allowed(runtime, room_id):
            return

        ts_ms = _ts_to_ms(str(entry.get("ts") or "")) or 0
        if ts_ms and ts_ms > self.last_seen_ms:
            self.last_seen_ms = ts_ms

        uid = _safe_str(entry.get("uid"))
        fallback = f"{room_id}:{_safe_str(entry.get('payloadType'))}:{_safe_str(entry.get('senderId'))}:{_safe_str(entry.get('mid'))}:{_safe_str(entry.get('ts'))}"
        dedup_key = uid or fallback
        if self.event_dedup.seen(dedup_key):
            return

        ptype = _safe_str(entry.get("payloadType"))
        room_name = _safe_str(entry.get("roomName")) or room_id

        if ptype == "member_joined":
            entrants = entry.get("entrants")
            if isinstance(entrants, list):
                for it in entrants:
                    if not isinstance(it, dict):
                        continue
                    user_id = _safe_str(it.get("senderId"))
                    name = _safe_str(it.get("name")) or "Guest"
                    joined_at = int(it.get("joinedAt") or ts_ms or _now_ms())
                    if user_id:
                        self._handle_join(room_id, room_name, user_id, name, joined_at)
            return

        if ptype == "message":
            message_type = entry.get("messageType")
            norm_type = None
            try:
                n = int(message_type) if message_type is not None else None
                if n is not None and n >= 16384:
                    n = n - 16384
                norm_type = n
            except Exception:
                norm_type = None

            text = _safe_str(entry.get("text"))
            if norm_type == 0:
                pairs = self._parse_join_feed(text)
                if pairs:
                    for uid2, nm2 in pairs:
                        self._handle_join(room_id, room_name, uid2, nm2, ts_ms or _now_ms())
                    return

            sender_id = _safe_str(entry.get("senderId"))
            sender_name = _safe_str(entry.get("senderName")) or _safe_str(entry.get("sender")) or ""
            if sender_id:
                self._handle_message(room_id, room_name, sender_id, sender_name, ts_ms or _now_ms())

    def run_forever(self) -> int:
        self._acquire_lock()
        self._load_rooms_config()
        self._load_state()

        started_at = _iso_now()
        self._write_status(startedAt=started_at)
        self.log("INFO", "course roster worker started", pid=os.getpid(), realtime=self.realtime_base)

        while True:
            try:
                since = self.last_seen_ms - 3000 if self.last_seen_ms else (_now_ms() - 3000)
                params = {
                    "all": "1",
                    "limit": "200",
                    "interval": "1000",
                    "since": str(max(0, int(since))),
                }
                url = f"{self.realtime_base}/logs/stream"
                self.log("INFO", "sse connect", url=url, since=params["since"])

                with requests.get(url, params=params, stream=True, timeout=(10, 90)) as resp:
                    resp.raise_for_status()
                    for raw in resp.iter_lines(decode_unicode=True):
                        if raw is None:
                            continue
                        line = raw.strip()
                        if not line or line.startswith(":"):
                            continue
                        if not line.startswith("data:"):
                            continue
                        try:
                            payload = json.loads(line[len("data:") :].strip())
                        except Exception:
                            continue

                        all_entries = payload.get("all")
                        if isinstance(all_entries, list):
                            for e in all_entries:
                                if isinstance(e, dict):
                                    self.process_entry(e)

                        rooms_entries = payload.get("rooms")
                        if isinstance(rooms_entries, dict):
                            for _, arr in rooms_entries.items():
                                if not isinstance(arr, list):
                                    continue
                                for e in arr:
                                    if isinstance(e, dict):
                                        self.process_entry(e)

                        self.tick()

            except KeyboardInterrupt:
                self.log("INFO", "shutdown requested")
                return 0
            except Exception as e:
                self.log("WARN", "sse loop error; retry in 3s", err=str(e))
                try:
                    self.tick()
                except Exception:
                    pass
                time.sleep(3)


def _default_repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _resolve_default_service_account(repo_root: Path) -> str:
    return str(repo_root / "data" / "gcp_service_account.json")


def main() -> int:
    ap = argparse.ArgumentParser(description="오픈채팅 입장자 카페/닉네임 검증 워커")
    ap.add_argument(
        "--realtime-base",
        default=os.getenv("REALTIME_API_BASE") or os.getenv("REALTIME_API_URL") or "http://127.0.0.1:8650",
        help="Realtime API 베이스 URL (기본: http://127.0.0.1:8650)",
    )
    ap.add_argument("--runtime", default=None, help="runtime.json 경로(기본: node-iris-app/config/runtime.json)")
    ap.add_argument(
        "--config",
        default=os.getenv("COURSE_ROSTER_CONFIG") or "data/course_roster_worker.json",
        help="roomId별 시트/카페 설정 매핑 config(JSON). 기본: data/course_roster_worker.json",
    )
    ap.add_argument(
        "--service-account-json",
        default=None,
        help="Google 서비스 계정 JSON 경로(기본: env GOOGLE_APPLICATION_CREDENTIALS 또는 data/gcp_service_account.json)",
    )
    ap.add_argument("--grace-min", type=int, default=15, help="1차 안내 유예(분). 기본 15")
    ap.add_argument("--remind2-hours", type=int, default=24, help="2차 안내 시점(시간). 기본 24")
    ap.add_argument("--check-interval-sec", type=int, default=60, help="주기적 체크 간격(초). 기본 60")
    ap.add_argument(
        "--cafe-cache-sec",
        type=int,
        default=300,
        help="카페 스냅샷 갱신 최소 간격(초). 기본 300 (crawler 모드에서는 이 주기보다 자주 크롤링하지 않음)",
    )
    ap.add_argument("--verify-cooldown-sec", type=int, default=60, help="동일 사용자 재검증 쿨다운(초). 기본 60")
    args = ap.parse_args()

    root = _default_repo_root()
    runtime_path = Path(args.runtime) if args.runtime else (root / "node-iris-app" / "config" / "runtime.json")
    status_path = root / "node-iris-app" / "data" / "roster_worker_status.json"
    state_path = root / "node-iris-app" / "data" / "roster_worker_state.json"
    lock_path = root / "node-iris-app" / "data" / "locks" / "roster_worker.lock"

    cfg_path = Path(args.config)
    if not cfg_path.is_absolute():
        cfg_path = root / cfg_path

    sa_raw = (
        str(args.service_account_json or "").strip()
        or str(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
        or str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    )
    if not sa_raw:
        sa_raw = _resolve_default_service_account(root)

    policy = Policy(
        grace_ms=max(0, int(args.grace_min)) * 60 * 1000,
        remind2_ms=max(1, int(args.remind2_hours)) * 60 * 60 * 1000,
        check_interval_sec=max(5, int(args.check_interval_sec)),
        cafe_cache_sec=max(30, int(args.cafe_cache_sec)),
        verify_cooldown_sec=max(5, int(args.verify_cooldown_sec)),
    )

    worker = CourseRosterWorker(
        realtime_base=str(args.realtime_base),
        runtime_path=runtime_path,
        config_path=cfg_path,
        status_path=status_path,
        state_path=state_path,
        lock_path=lock_path,
        policy=policy,
        service_account_json=sa_raw,
    )
    return worker.run_forever()


if __name__ == "__main__":
    sys.exit(main())
