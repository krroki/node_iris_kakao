#!/usr/bin/env python3
"""
Talk-API authHeader(accessToken-deviceUUID) 후보를 실제 전송으로 검증하는 스크립트.

중요(운영 가드레일)
- 이 스크립트는 실제로 메시지를 전송할 수 있다.
- 실수 방지를 위해 `--confirm-send` 플래그가 없으면 즉시 종료한다.
- 토큰/UUID는 콘솔에 그대로 출력하지 않는다(레드랙트만 출력).

배경
- Talk-API 문서(OpenAPI): https://talk-api.naijun.dev/swagger/documentation.yaml
- Authorization: accessToken-deviceUUID
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Tuple

import urllib.error
import urllib.request


def _redact(s: str) -> str:
    s = str(s or "").strip()
    if not s:
        return ""
    if len(s) <= 8:
        return "***"
    return s[:4] + "…" + s[-4:]


def _adb(serial: str, *args: str, timeout: int = 20) -> str:
    cmd = ["adb"]
    if serial:
        cmd += ["-s", serial]
    cmd += list(args)
    out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=timeout)
    return out.decode("utf-8", errors="ignore")


def _resolve_serial(preferred: str | None) -> str:
    if preferred and preferred.strip():
        return preferred.strip()
    out = _adb("", "devices", timeout=10)
    lines = [ln.strip() for ln in out.splitlines() if ln.strip()]
    devices: List[str] = []
    for ln in lines:
        if ln.lower().startswith("list of devices"):
            continue
        if ln.endswith("\tdevice"):
            devices.append(ln.split("\t", 1)[0].strip())
    if not devices:
        raise SystemExit("adb devices 에 연결된 디바이스가 없습니다.")
    return devices[0]


def _ensure_root(serial: str) -> None:
    uid = _adb(serial, "shell", "su", "0", "id", "-u", timeout=10).strip().splitlines()[:1]
    if not uid or uid[0].strip() != "0":
        raise SystemExit(f"su(0) root 권한 확보 실패: id -u={uid[0] if uid else ''}")


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
    pos = 0
    out: List[Tuple[int, int, Any]] = []
    while pos < len(buf):
        tag, pos = _read_varint(buf, pos)
        field_no = tag >> 3
        wire_type = tag & 0x7
        if wire_type == 0:
            val, pos = _read_varint(buf, pos)
            out.append((field_no, wire_type, val))
        elif wire_type == 1:
            if pos + 8 > len(buf):
                raise EOFError("fixed64")
            val = int.from_bytes(buf[pos : pos + 8], "little", signed=False)
            pos += 8
            out.append((field_no, wire_type, val))
        elif wire_type == 2:
            ln, pos = _read_varint(buf, pos)
            if pos + ln > len(buf):
                raise EOFError("len")
            val = buf[pos : pos + ln]
            pos += ln
            out.append((field_no, wire_type, val))
        elif wire_type == 5:
            if pos + 4 > len(buf):
                raise EOFError("fixed32")
            val = int.from_bytes(buf[pos : pos + 4], "little", signed=False)
            pos += 4
            out.append((field_no, wire_type, val))
        else:
            break
    return out


def _parse_datastore_preferences_bytes(data: bytes) -> Dict[str, Any]:
    prefs: Dict[str, Any] = {}
    root = _parse_fields(data)
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
                if f in (2, 4) and wt == 0:
                    parsed_value = int(v)
                    break
                if f == 5 and wt == 2:
                    parsed_value = v.decode("utf-8", errors="ignore")
                    break
                if f == 6 and wt == 2:
                    parsed_value = bytes(v)
                    break
        prefs[name] = parsed_value
    return prefs


def _pull_root_file_to_local(serial: str, remote_path: str, local_path: Path) -> None:
    local_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_name = f"talkapi_tmp_{int(time.time())}_{local_path.name}"
    remote_tmp = f"/sdcard/Download/{tmp_name}"
    # 공백은 백슬래시로 이스케이프(간단 케이스)
    remote_src = remote_path.replace(" ", "\\ ")
    _adb(serial, "shell", "su", "0", "cp", remote_src, remote_tmp, timeout=20)
    _adb(serial, "shell", "su", "0", "chmod", "666", remote_tmp, timeout=10)
    _adb(serial, "pull", remote_tmp, str(local_path), timeout=30)
    _adb(serial, "shell", "su", "0", "rm", "-f", remote_tmp, timeout=10)


def _talkapi_send(auth_header: str, chat_id: int, message: str, timeout_s: int = 8) -> Tuple[int, Dict[str, Any] | None, str]:
    url = "https://talk-api.naijun.dev/api/v1/send"
    req = urllib.request.Request(url, method="POST")
    req.add_header("Authorization", auth_header)
    req.add_header("Content-Type", "application/json")
    body = json.dumps({"chatId": chat_id, "message": message, "attachment": {}}, ensure_ascii=False).encode("utf-8")
    try:
        with urllib.request.urlopen(req, data=body, timeout=timeout_s) as resp:
            status = resp.getcode()
            txt = resp.read().decode("utf-8", errors="ignore")
    except urllib.error.HTTPError as e:
        status = e.code
        txt = e.read().decode("utf-8", errors="ignore")
    except Exception as e:
        return 0, None, str(e)

    try:
        j = json.loads(txt) if txt else None
    except Exception:
        j = None
    return status, j, txt


def _apply_runtime(realtime_base: str, auth_header: str) -> None:
    url = realtime_base.rstrip("/") + "/runtime"
    body = json.dumps({"talkApi": {"authHeader": auth_header}}, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, method="POST")
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data=body, timeout=6) as resp:
        _ = resp.read()


def main(argv: List[str]) -> int:
    ap = argparse.ArgumentParser(description="Talk-API authHeader 후보 검증(실발송)")
    ap.add_argument("--chat-id", required=True, help="테스트 전송 대상 roomId/chatId (정수)")
    ap.add_argument("--serial", default="", help="adb serial (미지정 시 첫 device 사용)")
    ap.add_argument("--message", default="", help="전송 메시지(미지정 시 자동 생성)")
    ap.add_argument("--confirm-send", action="store_true", help="실제 발송 동의(필수)")
    ap.add_argument("--out-file", default="data/talkapi_auth.txt", help="성공 시 authHeader 저장 경로")
    ap.add_argument("--apply-runtime", action="store_true", help="성공 시 Realtime API(/runtime)에 authHeader 반영")
    ap.add_argument("--realtime-api-base", default="http://127.0.0.1:8650", help="Realtime API base URL")
    ap.add_argument("--auth-header", default="", help="직접 authHeader(accessToken-deviceUUID) 지정(ADB 불필요)")
    ap.add_argument("--auth-header-file", default="", help="authHeader 파일 경로(첫 줄 사용, ADB 불필요)")
    args = ap.parse_args(argv)

    if not args.confirm_send:
        print("[오류] 이 스크립트는 실제 메시지를 전송합니다. --confirm-send 없이는 실행하지 않습니다.", file=sys.stderr)
        return 2

    try:
        chat_id = int(str(args.chat_id).strip())
    except Exception:
        print("[오류] --chat-id 는 정수여야 합니다.", file=sys.stderr)
        return 2

    # authHeader를 직접 제공한 경우: ADB 없이 검증 가능
    direct_auth = str(getattr(args, "auth_header", "") or "").strip()
    if not direct_auth and getattr(args, "auth_header_file", ""):
        try:
            direct_auth = Path(str(args.auth_header_file)).read_text(encoding="utf-8").splitlines()[0].strip()
        except Exception as e:
            print(f"[오류] --auth-header-file 읽기 실패: {e}", file=sys.stderr)
            return 2

    if direct_auth:
        msg = args.message.strip() or f"[talkapi-auth-verify] {time.strftime('%Y-%m-%d %H:%M:%S')}"
        http_status, body, raw = _talkapi_send(direct_auth, chat_id=chat_id, message=msg, timeout_s=10)
        talk_status = None
        err = None
        if isinstance(body, dict):
            talk_status = body.get("status")
            err = body.get("errMsg") or body.get("message") or body.get("error")

        ok = False
        try:
            ok = int(talk_status) == 0
        except Exception:
            ok = False

        try:
            a, d = direct_auth.split("-", 1)
        except Exception:
            a, d = direct_auth, ""
        print(
            f"[INFO] authHeader(직접) -> http={http_status} status={talk_status} err={err} "
            f"(Authorization={_redact(a)}, Duuid={_redact(d)})"
        )

        if not ok:
            print("[ERROR] authHeader 검증 실패(status==0 아님)", file=sys.stderr)
            return 1

        out_path = Path(args.out_file)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(direct_auth + "\n", encoding="utf-8")
        print(f"[OK] authHeader 저장 완료: {out_path} (값은 미출력)")
        if args.apply_runtime:
            try:
                _apply_runtime(args.realtime_api_base, direct_auth)
                print("[OK] Realtime API(/runtime) authHeader 반영 완료")
            except Exception as e:
                print(f"[WARN] Realtime API 반영 실패: {e}")
        return 0

    serial = _resolve_serial(args.serial)
    print(f"[INFO] ADB 디바이스: {serial}")
    _ensure_root(serial)
    print("[INFO] 루트 권한 OK(su 0)")

    # accessToken 후보 추출
    src_pb = Path("data/talkapi_sources/LocalUser_DataStore.pref.preferences_pb")
    _pull_root_file_to_local(serial, "/data/data/com.kakao.talk/files/datastore/LocalUser_DataStore.pref.preferences_pb", src_pb)
    prefs = _parse_datastore_preferences_bytes(src_pb.read_bytes())
    access = prefs.get("encrypted_auth_token_v2") or prefs.get("encrypted_auth_token")
    if not isinstance(access, str) or not access.strip():
        print("[오류] accessToken 후보를 찾지 못했습니다(LocalUser_DataStore.encrypted_auth_token_v2/_token).", file=sys.stderr)
        return 1
    access = access.strip()
    print(f"[INFO] accessToken 후보: {_redact(access)} (source=LocalUser_DataStore)")

    device_candidates: List[Tuple[str, str]] = []
    try:
        android_id = _adb(serial, "shell", "su", "0", "settings", "get", "secure", "android_id", timeout=10).strip()
        if android_id and android_id.lower() != "null":
            device_candidates.append(("android_id", android_id))
    except Exception:
        pass
    try:
        installation = _adb(serial, "shell", "su", "0", "cat", "/data/data/com.kakao.talk/files/INSTALLATION", timeout=10).strip()
        if installation:
            device_candidates.append(("INSTALLATION", installation))
    except Exception:
        pass

    # dedupe by value
    uniq: Dict[str, str] = {}
    for src, val in device_candidates:
        val = str(val or "").strip()
        if not val:
            continue
        uniq.setdefault(val, src)
    candidates = [(src, val) for val, src in uniq.items()]
    if not candidates:
        print("[오류] deviceUUID 후보를 찾지 못했습니다(android_id/INSTALLATION).", file=sys.stderr)
        return 1
    print(f"[INFO] deviceUUID 후보 {len(candidates)}개:")
    for src, val in candidates:
        print(f"  - {src}: {_redact(val)}")

    msg = args.message.strip() or f"[talkapi-auth-verify] {time.strftime('%Y-%m-%d %H:%M:%S')}"

    # Try each candidate
    for src, dev in candidates:
        auth = f"{access}-{dev}"
        http_status, body, raw = _talkapi_send(auth, chat_id=chat_id, message=msg, timeout_s=10)
        talk_status = None
        err = None
        if isinstance(body, dict):
            talk_status = body.get("status")
            err = body.get("errMsg") or body.get("message") or body.get("error")

        ok = False
        try:
            ok = int(talk_status) == 0
        except Exception:
            ok = False

        print(f"[INFO] 후보={src} device={_redact(dev)} -> http={http_status} status={talk_status} err={err}")
        if ok:
            out_path = Path(args.out_file)
            out_path.parent.mkdir(parents=True, exist_ok=True)
            out_path.write_text(auth + "\n", encoding="utf-8")
            print(f"[OK] authHeader 확정 및 저장 완료: {out_path} (값은 미출력)")
            if args.apply_runtime:
                try:
                    _apply_runtime(args.realtime_api_base, auth)
                    print("[OK] Realtime API(/runtime) authHeader 반영 완료")
                except Exception as e:
                    print(f"[WARN] Realtime API 반영 실패: {e}")
            return 0

    print("[ERROR] 모든 후보가 실패했습니다. (status==0인 후보 없음)", file=sys.stderr)
    print("  - talk-api 서버 상태/차단/토큰 포맷 변화 가능성이 있습니다.", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
