from __future__ import annotations

import os
from typing import List


SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


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


def move_sheet_to_index(svc, spreadsheet_id: str, sheet_name: str, index: int) -> None:
    idx = max(0, int(index))
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = meta.get("sheets") or []
    target = None
    for s in sheets:
        if not isinstance(s, dict):
            continue
        p = s.get("properties") if isinstance(s.get("properties"), dict) else {}
        if p.get("title") == sheet_name:
            target = p
            break
    if not target:
        return
    sheet_id = target.get("sheetId")
    cur_idx = target.get("index")
    try:
        sid = int(sheet_id)
    except Exception:
        return
    try:
        cidx = int(cur_idx)
    except Exception:
        cidx = None
    if cidx == idx:
        return
    req = {
        "requests": [
            {
                "updateSheetProperties": {
                    "properties": {"sheetId": sid, "index": idx},
                    "fields": "index",
                }
            }
        ]
    }
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=req).execute()


def set_sheet_frozen_rows(svc, spreadsheet_id: str, sheet_name: str, frozen_row_count: int) -> None:
    n = max(0, int(frozen_row_count))
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = meta.get("sheets") or []
    target = None
    for s in sheets:
        if not isinstance(s, dict):
            continue
        p = s.get("properties") if isinstance(s.get("properties"), dict) else {}
        if p.get("title") == sheet_name:
            target = p
            break
    if not target:
        return
    sheet_id = target.get("sheetId")
    grid = target.get("gridProperties") if isinstance(target.get("gridProperties"), dict) else {}
    cur = grid.get("frozenRowCount")
    try:
        sid = int(sheet_id)
    except Exception:
        return
    try:
        cur_n = int(cur) if cur is not None else 0
    except Exception:
        cur_n = 0
    if cur_n == n:
        return
    req = {
        "requests": [
            {
                "updateSheetProperties": {
                    "properties": {"sheetId": sid, "gridProperties": {"frozenRowCount": n}},
                    "fields": "gridProperties.frozenRowCount",
                }
            }
        ]
    }
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=req).execute()


def clear_values(svc, spreadsheet_id: str, sheet_name: str) -> None:
    svc.spreadsheets().values().clear(spreadsheetId=spreadsheet_id, range=sheet_name, body={}).execute()


def get_values(svc, spreadsheet_id: str, rng: str) -> list[list[str]]:
    res = svc.spreadsheets().values().get(spreadsheetId=spreadsheet_id, range=rng).execute()
    values = res.get("values") or []
    out: list[list[str]] = []
    for row in values:
        if isinstance(row, list):
            out.append([str(x) for x in row])
    return out


def _col_letter(n: int) -> str:
    if n <= 0:
        raise ValueError("n must be >= 1")
    s = ""
    x = n
    while x > 0:
        x, r = divmod(x - 1, 26)
        s = chr(ord("A") + r) + s
    return s


def update_values(svc, spreadsheet_id: str, sheet_name: str, values: List[List[str]], chunk_rows: int = 800) -> None:
    if not values:
        # clear는 호출자가 수행. 여기서는 noop.
        return

    # 모든 row 길이를 동일하게 맞춰야 range 계산이 단순해진다.
    max_cols = 1
    for row in values:
        if isinstance(row, list):
            max_cols = max(max_cols, len(row))
    max_cols = max(1, max_cols)
    last_col = _col_letter(max_cols)

    # pad rows
    norm: List[List[str]] = []
    for row in values:
        r = [str(x) for x in (row or [])]
        if len(r) < max_cols:
            r = r + [""] * (max_cols - len(r))
        norm.append(r)

    chunk = max(10, int(chunk_rows))
    for i in range(0, len(norm), chunk):
        part = norm[i : i + chunk]
        start_row = i + 1
        end_row = i + len(part)
        rng = f"{sheet_name}!A{start_row}:{last_col}{end_row}"
        body = {"range": rng, "majorDimension": "ROWS", "values": part}
        svc.spreadsheets().values().update(
            spreadsheetId=spreadsheet_id,
            range=rng,
            valueInputOption="RAW",
            body=body,
        ).execute()


def batch_update_rows(
    svc,
    spreadsheet_id: str,
    sheet_name: str,
    items: list[tuple[int, list[str]]],
    last_col: str,
    chunk: int = 400,
) -> None:
    # items: (row_number, values[A..last_col])
    if not items:
        return

    chunk_n = max(50, int(chunk))
    for i in range(0, len(items), chunk_n):
        part = items[i : i + chunk_n]
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
