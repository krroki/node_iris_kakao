#!/usr/bin/env python3
"""
오픈채팅 멤버(닉네임/userId + 메타) 목록을 Google Sheets에 upsert 한다.

중요(완전성/폴백 금지):
- 멤버 목록의 단일 소스는 IRIS DB(db2.open_chat_member)이며,
  대형 방은 단말에서 "멤버 목록"을 열고 스크롤해야 DB가 충분히 채워질 수 있다.
- 기본 동작은 `loadedMembersCount < activeMembersCount`이면 즉시 실패(중단)한다.
  "하나도 빠짐없이"를 목표로 하므로, 불완전한 스냅샷을 조용히 업서트하지 않는다.

권한/인증(중요):
- Google Sheets 쓰기(upsert)는 API Key만으로는 불가능하다(OAuth2 필요).
- 이 스크립트는 기본적으로 "서비스 계정" JSON을 사용한다.
  시트 문서에 서비스 계정 이메일을 Editor로 공유해야 한다.
- 편의:
  - `data/gcp_service_account.json`이 존재하면 별도 env 없이 자동 사용한다.
  - `data/openchat_members_sheets.json`(gitignore)로 spreadsheetId/sheetName을 1회 등록해두면
    이후 `--room-id`만으로 실행 가능하다.

업서트 스키마(헤더):
- roomId, roomName, userId, nickname
- linkId, memberType, profileType, linkMemberType, profileLinkId
- privilege, report, enc
- profileImageUrl, fullProfileImageUrl, originalProfileImageUrl
- updatedAt

예시:
  # 0) (1회) 시트 타겟 등록(로컬 config)
  #   python scripts/sync_openchat_members_to_sheets.py --init-config --spreadsheet-id <SHEET_ID_OR_URL>
  #
  # 1) (선행) 멤버 DB 강제 로딩(송신 없음)
  #   pwsh scripts/openchat_load_members.ps1 -RoomId 18426993080683374 -Scrolls 600
  #
  # 2) upsert (서비스 계정 JSON은 gitignore(data/) 아래에 둔다)
  #   set IRIS_URL=http://127.0.0.1:5050
  #   set GOOGLE_APPLICATION_CREDENTIALS=C:\\dev\\12.kakao\\data\\gcp_service_account.json
  #   python scripts/sync_openchat_members_to_sheets.py ^
  #     --room-id 18426993080683374 ^
  #     --spreadsheet-id <SHEET_ID_OR_URL> ^
  #     --sheet-name members
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import requests


SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

DEFAULT_SHEETS_CONFIG = "data/openchat_members_sheets.json"
DEFAULT_SERVICE_ACCOUNT_JSON = "data/gcp_service_account.json"


def _repo_root() -> Path:
    # scripts/<this_file> 기준 상위가 repo root
    return Path(__file__).resolve().parent.parent


def _resolve_repo_rel_path(p: str) -> str:
    s = str(p or "").strip()
    if not s:
        return ""
    pp = Path(s)
    if pp.is_absolute():
        return str(pp)
    return str((_repo_root() / pp).resolve())


def _load_local_config(path_raw: str) -> dict:
    path = Path(_resolve_repo_rel_path(path_raw))
    if not path.exists():
        return {}
    try:
        # Windows PowerShell Set-Content로 만든 UTF-8 BOM 파일도 안전하게 처리한다.
        j = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as e:
        raise SystemExit(f"[오류] 로컬 config JSON 파싱 실패: {path} ({e})")
    if not isinstance(j, dict):
        raise SystemExit(f"[오류] 로컬 config 형식 오류: object(JSON dict)여야 합니다: {path}")
    return j


def _save_local_config(path_raw: str, obj: dict) -> None:
    path = Path(_resolve_repo_rel_path(path_raw))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(obj, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _now_iso_utc() -> str:
    return _dt.datetime.now(tz=_dt.timezone.utc).replace(microsecond=0).isoformat()


def _safe_int(v: object) -> Optional[int]:
    try:
        if isinstance(v, bool):
            return None
        if isinstance(v, int):
            return v
        if isinstance(v, float):
            if v != v:
                return None
            return int(v)
        if isinstance(v, str):
            t = v.strip()
            if t and t.isdigit():
                return int(t)
    except Exception:
        return None
    return None


def _parse_spreadsheet_id(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        raise SystemExit("spreadsheet-id가 비어 있습니다.")
    # full URL: https://docs.google.com/spreadsheets/d/<ID>/edit...
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", s)
    if m:
        return m.group(1)
    return s


def _infer_default_sheet_name(room_name: str) -> Optional[str]:
    """
    강의톡방(접두어)인 경우, 빈칸 sheetName의 기본값을 룸 타입별로 분리해 충돌을 방지한다.

    예:
      - (사담방) ...      -> MEMBERS_CHAT
      - 1. (공지방) ...   -> MEMBERS_NOTICE
      - [프리미엄방] ...  -> MEMBERS_PREMIUM
    """
    s = str(room_name or "").strip()
    if not s:
        return None

    m = re.match(r"^(?:\d+\.)?\s*(?:\(([^)]+)\)|\[([^\]]+)\])\s*", s)
    if not m:
        return None
    prefix = str(m.group(1) or m.group(2) or "").strip()
    if not prefix:
        return None

    p = re.sub(r"\s+", "", prefix)
    if "사담" in p:
        return "MEMBERS_CHAT"
    if "공지" in p:
        return "MEMBERS_NOTICE"
    if "프리미엄" in p:
        return "MEMBERS_PREMIUM"
    return None


def _iris_base() -> str:
    return (
        os.getenv("IRIS_QUERY_BASE")
        or os.getenv("IRIS_URL")
        or os.getenv("IRIS_BRIDGE_URL")
        or "http://127.0.0.1:5050"
    ).rstrip("/")


def iris_query(query: str, bind: list, timeout: float = 10.0) -> list[dict]:
    url = _iris_base() + "/query"
    body = {"query": query, "bind": bind}
    try:
        r = requests.post(url, json=body, timeout=timeout)
    except Exception as e:
        raise SystemExit(f"[오류] IRIS /query 호출 실패: {e}")
    if r.status_code != 200:
        raise SystemExit(f"[오류] IRIS /query 실패: HTTP {r.status_code} body={r.text[:200]}")
    try:
        j = r.json()
    except Exception as e:
        raise SystemExit(f"[오류] IRIS /query 응답 JSON 파싱 실패: {e}")
    data = j.get("data")
    if not isinstance(data, list):
        raise SystemExit("[오류] IRIS /query 응답 형식 오류: data[] 없음")
    return data


def _parse_room_name_from_meta(meta_raw: object) -> Optional[str]:
    s = str(meta_raw or "").strip()
    if not s:
        return None
    if not (s.startswith("[") or s.startswith("{")):
        return None
    try:
        j = json.loads(s)
    except Exception:
        return None

    contents: list[str] = []
    if isinstance(j, list):
        for it in j:
            if isinstance(it, dict):
                c = it.get("content")
                if isinstance(c, str) and c.strip():
                    contents.append(c.strip())
    elif isinstance(j, dict):
        c = j.get("content")
        if isinstance(c, str) and c.strip():
            contents.append(c.strip())

    # Observed pattern in chat_rooms.meta:
    #   "Welcome to '<ROOM_NAME>'."
    for c in contents:
        m = re.search(r"Welcome to\s+['\"](.+?)['\"]", c)
        if m:
            name = (m.group(1) or "").strip()
            if name:
                return name
    return None


def fetch_room_meta(room_id: str) -> tuple[str, Optional[int]]:
    # chat_rooms에는 name 컬럼이 없고, meta(JSON)에 room name이 들어오는 케이스가 관측된다.
    rows = iris_query("select active_members_count, meta from chat_rooms where id=?", [room_id], timeout=10.0)
    if not rows:
        return room_id, None
    row = rows[0] if isinstance(rows[0], dict) else {}
    name = _parse_room_name_from_meta(row.get("meta")) or room_id
    active = _safe_int(row.get("active_members_count"))
    return name, active


def fetch_loaded_member_count(room_id: str) -> int:
    rows = iris_query(
        "select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?",
        [room_id],
        timeout=20.0,
    )
    if not rows:
        return 0
    row = rows[0] if isinstance(rows[0], dict) else {}
    return _safe_int(row.get("cnt")) or 0


def fetch_members(room_id: str, page_size: int = 500) -> list[dict]:
    out: dict[str, dict] = {}
    offset = 0
    while True:
        rows = iris_query(
            "select user_id, nickname, link_id, type, profile_type, link_member_type, profile_link_id, "
            "privilege, report, enc, profile_image_url, full_profile_image_url, original_profile_image_url "
            "from db2.open_chat_member where involved_chat_id=? order by nickname limit ? offset ?",
            [room_id, page_size, offset],
            timeout=30.0,
        )
        if not rows:
            break
        for row in rows:
            if not isinstance(row, dict):
                continue
            uid = str(row.get("user_id") or "").strip()
            if not uid:
                continue

            rec = out.get(uid)
            if not rec:
                rec = {
                    "userId": uid,
                    "nickname": "",
                    "linkId": "",
                    "memberType": "",
                    "profileType": "",
                    "linkMemberType": "",
                    "profileLinkId": "",
                    "privilege": "",
                    "report": "",
                    "enc": "",
                    "profileImageUrl": "",
                    "fullProfileImageUrl": "",
                    "originalProfileImageUrl": "",
                }
                out[uid] = rec

            # 같은 userId가 여러 번 들어오면 "비어있지 않은 값"을 우선한다.
            nick = str(row.get("nickname") or "").strip()
            if nick and not rec.get("nickname"):
                rec["nickname"] = nick

            for src, dst in [
                ("link_id", "linkId"),
                ("type", "memberType"),
                ("profile_type", "profileType"),
                ("link_member_type", "linkMemberType"),
                ("profile_link_id", "profileLinkId"),
                ("privilege", "privilege"),
                ("report", "report"),
                ("enc", "enc"),
            ]:
                v = str(row.get(src) or "").strip()
                if v and not rec.get(dst):
                    rec[dst] = v

            for src, dst in [
                ("profile_image_url", "profileImageUrl"),
                ("full_profile_image_url", "fullProfileImageUrl"),
                ("original_profile_image_url", "originalProfileImageUrl"),
            ]:
                v = str(row.get(src) or "").strip()
                if v and not rec.get(dst):
                    rec[dst] = v
        if len(rows) < page_size:
            break
        offset += page_size

    members = [out[uid] for uid in sorted(out.keys(), key=lambda x: (out[x].get("nickname") or "", x))]
    return members


def build_sheets_client(service_account_json: str):
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except Exception as e:
        raise SystemExit(
            "[오류] Google Sheets 라이브러리가 설치되어 있지 않습니다. "
            "`pip install -r requirements.txt` 후 다시 실행하세요. "
            f"(import error: {e})"
        )

    if not os.path.exists(service_account_json):
        raise SystemExit(f"[오류] 서비스 계정 JSON 파일이 존재하지 않습니다: {service_account_json}")

    creds = Credentials.from_service_account_file(service_account_json, scopes=SCOPES)
    return build("sheets", "v4", credentials=creds, cache_discovery=False)


def ensure_sheet_exists(svc, spreadsheet_id: str, sheet_name: str) -> None:
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = meta.get("sheets") or []
    titles = {s.get("properties", {}).get("title") for s in sheets if isinstance(s, dict)}
    if sheet_name in titles:
        return
    req = {"requests": [{"addSheet": {"properties": {"title": sheet_name}}}]}
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=req).execute()


def get_values(svc, spreadsheet_id: str, rng: str) -> list[list[str]]:
    res = svc.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=rng).execute()
    values = res.get("values") or []
    out: list[list[str]] = []
    for row in values:
        if isinstance(row, list):
            out.append([str(x) for x in row])
    return out


def update_values(svc, spreadsheet_id: str, rng: str, values: list[list[str]]) -> None:
    body = {"range": rng, "majorDimension": "ROWS", "values": values}
    svc.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=rng,
        valueInputOption="RAW",
        body=body,
    ).execute()


def _col_letter(n: int) -> str:
    if n <= 0:
        raise ValueError("n must be >= 1")
    s = ""
    x = n
    while x > 0:
        x, r = divmod(x - 1, 26)
        s = chr(ord("A") + r) + s
    return s


def batch_update_rows(
    svc,
    spreadsheet_id: str,
    items: list[tuple[int, list[str]]],
    sheet_name: str,
    last_col: str,
) -> None:
    # items: (row_number, values[A..last_col])
    if not items:
        return
    chunk = 400
    for i in range(0, len(items), chunk):
        part = items[i : i + chunk]
        data = []
        for row_no, row_vals in part:
            data.append(
                {
                    "range": f"{sheet_name}!A{row_no}:{last_col}{row_no}",
                    "values": [row_vals],
                }
            )
        body = {"valueInputOption": "RAW", "data": data}
        svc.spreadsheets().values().batchUpdate(spreadsheetId=spreadsheet_id, body=body).execute()


def append_rows(svc, spreadsheet_id: str, sheet_name: str, rows: list[list[str]], last_col: str) -> None:
    if not rows:
        return
    svc.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f"{sheet_name}!A:{last_col}",
        valueInputOption="RAW",
        insertDataOption="INSERT_ROWS",
        body={"values": rows},
    ).execute()


def main() -> int:
    ap = argparse.ArgumentParser(description="IRIS open_chat_member -> Google Sheets upsert")
    ap.add_argument("--room-id", required=True, help="오픈채팅 roomId")
    ap.add_argument("--spreadsheet-id", required=False, help="Google Sheets spreadsheet ID 또는 URL")
    ap.add_argument("--sheet-name", default=None, help="업서트할 시트 탭 이름(기본: members)")
    ap.add_argument(
        "--service-account-json",
        default=None,
        help="서비스 계정 JSON 파일 경로(또는 env GOOGLE_APPLICATION_CREDENTIALS/GOOGLE_SERVICE_ACCOUNT_JSON)",
    )
    ap.add_argument(
        "--config",
        default=os.getenv("OPENCHAT_MEMBERS_SHEETS_CONFIG") or DEFAULT_SHEETS_CONFIG,
        help=f"로컬 기본값 config(JSON). 기본: {DEFAULT_SHEETS_CONFIG} (repo 기준 경로)",
    )
    ap.add_argument(
        "--init-config",
        action="store_true",
        help="spreadsheetId/sheetName/serviceAccountJson 기본값을 로컬 config로 저장하고 종료한다(키 내용은 저장하지 않음).",
    )
    ap.add_argument("--allow-incomplete", action="store_true", help="loaded < active 이어도 강제로 업서트(권장하지 않음)")
    ap.add_argument("--dry-run", action="store_true", help="Sheets에 쓰지 않고, IRIS에서 읽은 요약만 출력")
    args = ap.parse_args()

    cfg = _load_local_config(str(args.config or DEFAULT_SHEETS_CONFIG))

    def _room_cfg(room_id: str) -> dict:
        rooms = cfg.get("rooms")
        if isinstance(rooms, dict):
            v = rooms.get(room_id)
            if isinstance(v, dict):
                return v
        return {}

    if args.init_config:
        raw_sheet = str(args.spreadsheet_id or "").strip()
        if not raw_sheet:
            print("[오류] --init-config에는 --spreadsheet-id가 필요합니다.", file=sys.stderr)
            return 2
        spreadsheet_id = _parse_spreadsheet_id(raw_sheet)
        sheet_name = str(args.sheet_name or cfg.get("sheetName") or cfg.get("sheet_name") or "members").strip() or "members"

        sa_raw = (
            str(args.service_account_json or "").strip()
            or str(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
            or str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
            or str(cfg.get("serviceAccountJson") or cfg.get("service_account_json") or "").strip()
        )
        if not sa_raw:
            # 편의: 표준 위치에 파일이 있으면 상대경로로 저장(노출/이동에도 안정적)
            default_sa = Path(_resolve_repo_rel_path(DEFAULT_SERVICE_ACCOUNT_JSON))
            if default_sa.exists():
                sa_raw = DEFAULT_SERVICE_ACCOUNT_JSON

        # NOTE: init-config는 spreadsheetId/sheetName/serviceAccountJson만 갱신한다.
        # rooms/worker 등 다른 설정을 덮어쓰지 않도록 기존 config를 보존한다.
        out = dict(cfg) if isinstance(cfg, dict) else {}
        out["spreadsheetId"] = spreadsheet_id
        out["sheetName"] = sheet_name
        if sa_raw:
            out["serviceAccountJson"] = sa_raw

        _save_local_config(str(args.config or DEFAULT_SHEETS_CONFIG), out)
        print(f"[done] config saved: {Path(_resolve_repo_rel_path(str(args.config or DEFAULT_SHEETS_CONFIG)))}")
        return 0

    room_id = str(args.room_id).strip()
    if not room_id:
        print("[오류] room-id가 비어 있습니다.", file=sys.stderr)
        return 2

    room_cfg = _room_cfg(room_id)

    room_name, active_cnt = fetch_room_meta(room_id)
    loaded_cnt = fetch_loaded_member_count(room_id)
    members = fetch_members(room_id)

    print(f"[room] id={room_id}, name={room_name}")
    print(f"[count] activeMembersCount={active_cnt if active_cnt is not None else 'N/A'} / loadedMembersCount={loaded_cnt} / fetched={len(members)}")

    allow_incomplete = bool(
        args.allow_incomplete
        or bool(room_cfg.get("allowIncomplete") or room_cfg.get("allow_incomplete"))
        or bool(cfg.get("allowIncomplete") or cfg.get("allow_incomplete"))
    )

    if active_cnt is not None and loaded_cnt < active_cnt and not allow_incomplete:
        print(
            "[오류] 멤버 DB가 불완전합니다(loadedMembersCount < activeMembersCount). "
            "단말에서 멤버 목록을 충분히 스크롤하여 db2.open_chat_member를 채운 뒤 다시 실행하세요.\n"
            "  - 예: pwsh scripts/openchat_load_members.ps1 -RoomId <ROOM_ID> -Scrolls 600\n"
            "불가피하게 진행하려면 --allow-incomplete 를 명시하세요(권장하지 않음).",
            file=sys.stderr,
        )
        return 2

    if args.dry_run:
        print("[dry-run] Sheets 업서트는 수행하지 않습니다.")
        return 0

    raw_sheet = (
        str(args.spreadsheet_id or "").strip()
        or str(os.getenv("SHEETS_SPREADSHEET_ID") or "").strip()
        or str(room_cfg.get("spreadsheetId") or room_cfg.get("spreadsheet_id") or room_cfg.get("spreadsheet") or "").strip()
        or str(cfg.get("spreadsheetId") or cfg.get("spreadsheet_id") or cfg.get("spreadsheet") or "").strip()
    )
    if not raw_sheet:
        print(
            "[오류] spreadsheet-id가 비어 있습니다.\n"
            "1) 1회성 실행: --spreadsheet-id <SHEET_ID_OR_URL>\n"
            "2) 영구 등록: `python scripts/sync_openchat_members_to_sheets.py --init-config --spreadsheet-id <SHEET_ID_OR_URL>`\n"
            f"   (저장 위치: {DEFAULT_SHEETS_CONFIG} 또는 --config로 지정)\n"
            "※ 시트 쓰기는 API key가 아니라 OAuth(서비스 계정)가 필요합니다.",
            file=sys.stderr,
        )
        return 2

    spreadsheet_id = _parse_spreadsheet_id(raw_sheet)
    sheet_name = (
        str(args.sheet_name or "").strip()
        or str(os.getenv("SHEETS_SHEET_NAME") or "").strip()
        or str(room_cfg.get("sheetName") or room_cfg.get("sheet_name") or "").strip()
        or str(_infer_default_sheet_name(room_name) or "").strip()
        or str(cfg.get("sheetName") or cfg.get("sheet_name") or "").strip()
        or "members"
    )

    sa_json = (
        str(args.service_account_json or "").strip()
        or str(os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON") or "").strip()
        or str(os.getenv("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
        or str(room_cfg.get("serviceAccountJson") or room_cfg.get("service_account_json") or "").strip()
        or str(cfg.get("serviceAccountJson") or cfg.get("service_account_json") or "").strip()
    )
    if not sa_json:
        # 편의: 표준 위치에 파일이 있으면 자동 사용
        default_sa = Path(_resolve_repo_rel_path(DEFAULT_SERVICE_ACCOUNT_JSON))
        if default_sa.exists():
            sa_json = str(default_sa)
    else:
        sa_json = _resolve_repo_rel_path(sa_json)

    if not sa_json:
        print(
            "[오류] Google Sheets 쓰기(upsert)는 API key만으로는 불가능합니다.\n"
            "서비스 계정 JSON(권장) 또는 OAuth2 토큰이 필요합니다.\n"
            "  1) GCP에서 Service Account 생성\n"
            "  2) JSON 키 파일 다운로드 → `data/` 아래 저장(이 repo는 data/가 gitignore)\n"
            "  3) 시트 문서에 서비스 계정 이메일을 Editor로 공유\n"
            f"  4) env GOOGLE_APPLICATION_CREDENTIALS=... 설정 또는 {DEFAULT_SERVICE_ACCOUNT_JSON} 저장 후 재실행",
            file=sys.stderr,
        )
        return 2

    svc = build_sheets_client(sa_json)
    ensure_sheet_exists(svc, spreadsheet_id, sheet_name)

    # Header + existing rows
    header = [
        "roomId",
        "roomName",
        "userId",
        "nickname",
        "linkId",
        "memberType",
        "profileType",
        "linkMemberType",
        "profileLinkId",
        "privilege",
        "report",
        "enc",
        "profileImageUrl",
        "fullProfileImageUrl",
        "originalProfileImageUrl",
        "updatedAt",
    ]
    last_col = _col_letter(len(header))
    values = get_values(svc, spreadsheet_id, f"{sheet_name}!A:{last_col}")
    if not values:
        update_values(svc, spreadsheet_id, f"{sheet_name}!A1:{last_col}1", [header])
        values = [header]
    else:
        # ensure header row
        if [c.strip() for c in values[0][: len(header)]] != header:
            update_values(svc, spreadsheet_id, f"{sheet_name}!A1:{last_col}1", [header])

    # Build index of existing rows
    existing: dict[tuple[str, str], tuple[int, list[str]]] = {}
    dup = 0
    for idx, row in enumerate(values[1:], start=2):
        padded = [str(x) for x in row] + [""] * max(0, len(header) - len(row))
        rid = str(padded[0]).strip() if len(padded) > 0 else ""
        uid = str(padded[2]).strip() if len(padded) > 2 else ""
        if not rid or not uid:
            continue
        key = (rid, uid)
        if key in existing:
            dup += 1
            continue
        existing[key] = (idx, padded[: len(header)])

    now = _now_iso_utc()
    updates: list[tuple[int, list[str]]] = []
    appends: list[list[str]] = []

    for m in members:
        uid = str(m.get("userId") or "").strip()
        nick = str(m.get("nickname") or "").strip()
        if not uid:
            continue
        key = (room_id, uid)
        row_vals = [
            room_id,
            room_name,
            uid,
            nick,
            str(m.get("linkId") or "").strip(),
            str(m.get("memberType") or "").strip(),
            str(m.get("profileType") or "").strip(),
            str(m.get("linkMemberType") or "").strip(),
            str(m.get("profileLinkId") or "").strip(),
            str(m.get("privilege") or "").strip(),
            str(m.get("report") or "").strip(),
            str(m.get("enc") or "").strip(),
            str(m.get("profileImageUrl") or "").strip(),
            str(m.get("fullProfileImageUrl") or "").strip(),
            str(m.get("originalProfileImageUrl") or "").strip(),
            now,
        ]
        if key in existing:
            row_no, prev = existing[key]
            # 값이 완전히 동일하면 updatedAt까지 매번 갱신하지 않는다(불필요한 update 감소)
            if prev[: len(header) - 1] == row_vals[: len(header) - 1]:
                continue
            updates.append((row_no, row_vals))
        else:
            appends.append(row_vals)

    # Execute updates/appends
    batch_update_rows(svc, spreadsheet_id, updates, sheet_name, last_col)
    append_rows(svc, spreadsheet_id, sheet_name, appends, last_col)

    print(
        f"[done] spreadsheet={spreadsheet_id} sheet={sheet_name} "
        f"updates={len(updates)} appends={len(appends)} existing={len(existing)} dupExistingKeys={dup}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
