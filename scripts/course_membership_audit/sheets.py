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


def _get_sheet_id(svc, spreadsheet_id: str, sheet_name: str) -> int | None:
    meta = svc.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    sheets = meta.get("sheets") or []
    for s in sheets:
        if not isinstance(s, dict):
            continue
        p = s.get("properties") if isinstance(s.get("properties"), dict) else {}
        if p.get("title") != sheet_name:
            continue
        sid = p.get("sheetId")
        try:
            return int(sid)
        except Exception:
            return None
    return None


def delete_rows_range(svc, spreadsheet_id: str, sheet_name: str, start_row: int, end_row: int) -> None:
    """
    Delete row range in a sheet.

    Args:
        start_row: 1-based inclusive
        end_row: 1-based inclusive
    """
    s = max(1, int(start_row))
    e = max(s, int(end_row))
    if e < s:
        return

    sheet_id = _get_sheet_id(svc, spreadsheet_id, sheet_name)
    if sheet_id is None:
        return

    # Google Sheets API uses 0-based indices and endIndex is exclusive.
    start_index = s - 1
    end_index = e
    req = {
        "requests": [
            {
                "deleteDimension": {
                    "range": {
                        "sheetId": sheet_id,
                        "dimension": "ROWS",
                        "startIndex": start_index,
                        "endIndex": end_index,
                    }
                }
            }
        ]
    }
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body=req).execute()


def _hex_color(hex_str: str) -> dict:
    h = str(hex_str or "").strip().lstrip("#")
    if len(h) != 6:
        return {"red": 1.0, "green": 1.0, "blue": 1.0}
    try:
        r = int(h[0:2], 16) / 255.0
        g = int(h[2:4], 16) / 255.0
        b = int(h[4:6], 16) / 255.0
    except Exception:
        return {"red": 1.0, "green": 1.0, "blue": 1.0}
    return {"red": r, "green": g, "blue": b}


def apply_overview_sheet_format(
    svc,
    spreadsheet_id: str,
    sheet_name: str,
    values: List[List[str]],
    *,
    frozen_rows: int = 16,
) -> None:
    """
    OVERVIEW 탭을 '프로그램 화면'처럼 보기 좋게 만드는 최소 서식 적용.
    - gridlines 숨김
    - 상단 타이틀/갱신 행 강조
    - 섹션 헤더/테이블 헤더 강조
    - 컬럼 폭/행 높이 기본값 지정

    NOTE: 값 자체는 update_values로 먼저 반영되어 있어야 한다.
    """
    if not values:
        return

    sheet_id = _get_sheet_id(svc, spreadsheet_id, sheet_name)
    if sheet_id is None:
        return

    max_cols = 1
    for r in values:
        if isinstance(r, list):
            max_cols = max(max_cols, len(r))
    max_cols = max(1, max_cols)
    end_row = max(1, len(values))

    def _cell(row: list[str], idx: int) -> str:
        return str(row[idx] if idx < len(row) else "").strip()

    # section header rows: single cell starting with emoji markers we use in audit.py
    section_prefixes = ("🧭", "📌", "🧩", "🧾")
    section_rows: list[int] = []
    table_header_rows: list[int] = []
    for i, row in enumerate(values):
        if not isinstance(row, list) or not row:
            continue
        a0 = _cell(row, 0)
        if len(row) == 1 and a0.startswith(section_prefixes):
            section_rows.append(i)
        if a0 in ("상태", "방", "시간", "우선", "항목", "카페닉"):
            table_header_rows.append(i)

    first_section = min(section_rows) if section_rows else None

    bg_dark = _hex_color("#0F172A")  # slate-900
    bg_section = _hex_color("#111827")  # gray-900
    bg_header = _hex_color("#E2E8F0")  # slate-200
    bg_summary = _hex_color("#F8FAFC")  # slate-50
    fg_white = _hex_color("#FFFFFF")
    fg_dark = _hex_color("#0F172A")
    fg_muted = _hex_color("#CBD5E1")  # slate-300

    def _range(sr: int, er: int, sc: int = 0, ec: int | None = None) -> dict:
        return {
            "sheetId": sheet_id,
            "startRowIndex": max(0, int(sr)),
            "endRowIndex": max(0, int(er)),
            "startColumnIndex": max(0, int(sc)),
            "endColumnIndex": max(0, int(ec if ec is not None else max_cols)),
        }

    requests: list[dict] = []

    # sheet properties
    requests.append(
        {
            "updateSheetProperties": {
                "properties": {
                    "sheetId": sheet_id,
                    "gridProperties": {"hideGridlines": True, "frozenRowCount": max(0, int(frozen_rows))},
                },
                "fields": "gridProperties.hideGridlines,gridProperties.frozenRowCount",
            }
        }
    )

    # unmerge+merge title/meta rows (A1..max_cols, A2..max_cols)
    if max_cols > 1:
        requests.append({"unmergeCells": {"range": _range(0, min(2, end_row), 0, max_cols)}})
        requests.append({"mergeCells": {"range": _range(0, 1, 0, max_cols), "mergeType": "MERGE_ALL"}})
        requests.append({"mergeCells": {"range": _range(1, 2, 0, max_cols), "mergeType": "MERGE_ALL"}})

    # column widths (defaults + overrides)
    requests.append(
        {
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": max_cols},
                "properties": {"pixelSize": 160},
                "fields": "pixelSize",
            }
        }
    )
    # A/B/F/J are the most important readability columns for our overview tables.
    requests.append(
        {
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 0, "endIndex": 1},
                "properties": {"pixelSize": 190},
                "fields": "pixelSize",
            }
        }
    )
    if max_cols >= 2:
        requests.append(
            {
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 1, "endIndex": 2},
                    "properties": {"pixelSize": 220},
                    "fields": "pixelSize",
                }
            }
        )
    if max_cols >= 6:
        requests.append(
            {
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 5, "endIndex": 6},
                    "properties": {"pixelSize": 520},
                    "fields": "pixelSize",
                }
            }
        )
    if max_cols >= 10:
        requests.append(
            {
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "COLUMNS", "startIndex": 9, "endIndex": 10},
                    "properties": {"pixelSize": 520},
                    "fields": "pixelSize",
                }
            }
        )

    # row heights (title/meta)
    requests.append(
        {
            "updateDimensionProperties": {
                "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 0, "endIndex": min(1, end_row)},
                "properties": {"pixelSize": 44},
                "fields": "pixelSize",
            }
        }
    )
    if end_row >= 2:
        requests.append(
            {
                "updateDimensionProperties": {
                    "range": {"sheetId": sheet_id, "dimension": "ROWS", "startIndex": 1, "endIndex": 2},
                    "properties": {"pixelSize": 28},
                    "fields": "pixelSize",
                }
            }
        )

    def _repeat(sr: int, er: int, sc: int, ec: int, fmt: dict, fields: str) -> dict:
        return {
            "repeatCell": {
                "range": _range(sr, er, sc, ec),
                "cell": {"userEnteredFormat": fmt},
                "fields": fields,
            }
        }

    # Title row
    requests.append(
        _repeat(
            0,
            1,
            0,
            max_cols,
            {
                "backgroundColor": bg_dark,
                "textFormat": {"foregroundColor": fg_white, "fontSize": 14, "bold": True},
                "horizontalAlignment": "LEFT",
                "verticalAlignment": "MIDDLE",
                "wrapStrategy": "WRAP",
            },
            "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
        )
    )
    # Meta row
    if end_row >= 2:
        requests.append(
            _repeat(
                1,
                2,
                0,
                max_cols,
                {
                    "backgroundColor": bg_section,
                    "textFormat": {"foregroundColor": fg_muted, "fontSize": 10, "bold": False},
                    "horizontalAlignment": "LEFT",
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP",
                },
                "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
            )
        )

    # Summary block (before first section header)
    if first_section is not None and first_section > 2:
        requests.append(
            _repeat(
                2,
                first_section,
                0,
                max_cols,
                {
                    "backgroundColor": bg_summary,
                    "textFormat": {"foregroundColor": fg_dark, "fontSize": 10},
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP",
                },
                "userEnteredFormat(backgroundColor,textFormat,verticalAlignment,wrapStrategy)",
            )
        )
        # make label column bold
        requests.append(
            _repeat(
                2,
                first_section,
                0,
                1,
                {"textFormat": {"bold": True}},
                "userEnteredFormat.textFormat.bold",
            )
        )

    # Section headers
    for r in section_rows:
        requests.append(
            _repeat(
                r,
                r + 1,
                0,
                max_cols,
                {
                    "backgroundColor": bg_section,
                    "textFormat": {"foregroundColor": fg_white, "bold": True, "fontSize": 11},
                    "horizontalAlignment": "LEFT",
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP",
                },
                "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
            )
        )

    # Table header rows
    for r in table_header_rows:
        requests.append(
            _repeat(
                r,
                r + 1,
                0,
                max_cols,
                {
                    "backgroundColor": bg_header,
                    "textFormat": {"foregroundColor": fg_dark, "bold": True, "fontSize": 10},
                    "horizontalAlignment": "CENTER",
                    "verticalAlignment": "MIDDLE",
                    "wrapStrategy": "WRAP",
                },
                "userEnteredFormat(backgroundColor,textFormat,horizontalAlignment,verticalAlignment,wrapStrategy)",
            )
        )

    # Apply
    svc.spreadsheets().batchUpdate(spreadsheetId=spreadsheet_id, body={"requests": requests}).execute()
