#!/usr/bin/env python3
"""
Android Jetpack DataStore(Preferences) 바이너리 파일(.preferences_pb) 파서.

목적
- KakaoTalk 로컬 파일에서 (예: LocalUser_DataStore.pref.preferences_pb) 키/값을 추출해
  Talk-API authHeader(accessToken-deviceUUID) 후보 생성에 활용한다.

주의
- 이 스크립트는 민감한 값(토큰 등)을 포함할 수 있으므로, 기본적으로 stdout에
  전체 덤프를 출력하지 않는다. 필요한 키만 --keys로 지정해 추출한다.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple


def _read_varint(buf: bytes, pos: int) -> Tuple[int, int]:
    shift = 0
    result = 0
    while True:
        if pos >= len(buf):
            raise EOFError("varint")
        b = buf[pos]
        pos += 1
        result |= (b & 0x7F) << shift
        if not (b & 0x80):
            return result, pos
        shift += 7
        if shift > 70:
            raise ValueError("varint too long")


def _parse_fields(buf: bytes) -> List[Tuple[int, int, Any]]:
    """Return list of (field_no, wire_type, value)."""
    pos = 0
    out: List[Tuple[int, int, Any]] = []
    while pos < len(buf):
        tag, pos = _read_varint(buf, pos)
        field_no = tag >> 3
        wire_type = tag & 0x7
        if wire_type == 0:  # varint
            val, pos = _read_varint(buf, pos)
            out.append((field_no, wire_type, val))
        elif wire_type == 1:  # fixed64
            if pos + 8 > len(buf):
                raise EOFError("fixed64")
            val = int.from_bytes(buf[pos : pos + 8], "little", signed=False)
            pos += 8
            out.append((field_no, wire_type, val))
        elif wire_type == 2:  # length-delimited
            ln, pos = _read_varint(buf, pos)
            if pos + ln > len(buf):
                raise EOFError("len")
            val = buf[pos : pos + ln]
            pos += ln
            out.append((field_no, wire_type, val))
        elif wire_type == 5:  # fixed32
            if pos + 4 > len(buf):
                raise EOFError("fixed32")
            val = int.from_bytes(buf[pos : pos + 4], "little", signed=False)
            pos += 4
            out.append((field_no, wire_type, val))
        else:
            # Unsupported wire type -> stop to avoid mis-parse.
            break
    return out


def parse_datastore_preferences(path: Path) -> Dict[str, Any]:
    """Parse DataStore PreferencesProto-like structure into dict of key->value.

    Data format (assumed):
      message Preferences { repeated Preference preferences = 1; }
      message Preference { string name = 1; Value value = 2; }
      message Value { oneof { bool=1, int32=2, float=3, int64=4, string=5, bytes=6, double=7 } }
    """
    data = path.read_bytes()
    root = _parse_fields(data)

    prefs: Dict[str, Any] = {}
    for field_no, wire_type, val in root:
        if field_no != 1 or wire_type != 2:
            continue
        pref_fields = _parse_fields(val)
        name = None
        value_raw = None
        for f, wt, v in pref_fields:
            if f == 1 and wt == 2:
                name = v.decode("utf-8", errors="ignore")
            elif f == 2 and wt == 2:
                value_raw = v
        if not name:
            continue

        parsed_value: Any = None
        if value_raw is not None:
            for f, wt, v in _parse_fields(value_raw):
                if f == 1 and wt == 0:
                    parsed_value = bool(v)
                    break
                if f == 2 and wt == 0:
                    parsed_value = int(v)
                    break
                if f == 3 and wt == 5:
                    parsed_value = int(v)  # float32 raw bits (caller can reinterpret if needed)
                    break
                if f == 4 and wt == 0:
                    parsed_value = int(v)
                    break
                if f == 5 and wt == 2:
                    parsed_value = v.decode("utf-8", errors="ignore")
                    break
                if f == 6 and wt == 2:
                    parsed_value = bytes(v)
                    break
                if f == 7 and wt == 1:
                    parsed_value = int(v)  # double64 raw bits
                    break
        prefs[name] = parsed_value
    return prefs


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="Parse Android DataStore Preferences(.preferences_pb)")
    ap.add_argument("--in", dest="in_path", required=True, help="Input .preferences_pb file path")
    ap.add_argument("--keys", default="", help="Comma-separated keys to output (required for safety)")
    ap.add_argument("--list-keys", action="store_true", help="키 이름만 출력(값 미출력, 안전)")
    ap.add_argument("--out", default="", help="Write JSON to file instead of stdout")
    args = ap.parse_args(argv)

    in_path = Path(args.in_path)
    if not in_path.exists():
        print(f"[오류] 입력 파일이 없습니다: {in_path}", file=sys.stderr)
        return 2

    prefs = parse_datastore_preferences(in_path)

    if args.list_keys:
        names = sorted([str(k) for k in prefs.keys()])
        payload = json.dumps(names, ensure_ascii=False, indent=2) + "\n"
        if args.out:
            Path(args.out).write_text(payload, encoding="utf-8")
            return 0
        sys.stdout.write(payload)
        return 0

    keys = [k.strip() for k in str(args.keys or "").split(",") if k.strip()]
    if not keys:
        print("[오류] 안전을 위해 --keys 는 필수입니다(전체 덤프 출력 금지).", file=sys.stderr)
        return 2

    out: Dict[str, Any] = {k: prefs.get(k) for k in keys}

    payload = json.dumps(out, ensure_ascii=False)
    if args.out:
        Path(args.out).write_text(payload, encoding="utf-8")
        return 0
    sys.stdout.write(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
