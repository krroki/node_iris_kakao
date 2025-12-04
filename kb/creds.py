import os
import subprocess
from typing import Optional, Tuple
from sqlalchemy import text
from kb.db import db_session
from kb.logging_util import get_logger

log = get_logger("kb.creds")


def _ps_run(script: str, stdin: Optional[str] = None) -> str:
    try:
        p = subprocess.run(
            ["powershell", "-NoProfile", "-Command", script],
            input=stdin or "",
            text=True,
            capture_output=True,
            timeout=15,
        )
        if p.returncode != 0:
            raise RuntimeError(p.stderr.strip() or f"ps rc={p.returncode}")
        return p.stdout
    except Exception as e:
        raise RuntimeError(f"ps_run failed: {e}")


def _protect_dpapi(plain: str) -> str:
    # ConvertTo/From-SecureString uses DPAPI for current user by default
    script = (
        "$plain = [Console]::In.ReadToEnd(); "
        "$ss = ConvertTo-SecureString $plain -AsPlainText -Force; "
        "$enc = ConvertFrom-SecureString $ss; "
        "[Console]::Out.Write($enc)"
    )
    return _ps_run(script, stdin=plain)


def _unprotect_dpapi(enc: str) -> str:
    script = (
        "$enc = [Console]::In.ReadToEnd(); "
        "$ss = ConvertTo-SecureString $enc; "
        "$b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ss); "
        "$out = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b); "
        "[Console]::Out.Write($out)"
    )
    return _ps_run(script, stdin=enc)


def save_creds(naver_id: str, naver_pw: str) -> None:
    enc_id = _protect_dpapi(naver_id)
    enc_pw = _protect_dpapi(naver_pw)
    with db_session() as s:
        s.execute(text(
            "INSERT INTO secrets(key,value,updated_at) VALUES('NAVER_ID_DPAPI', :v, now())\n"
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()"
        ), {"v": enc_id})
        s.execute(text(
            "INSERT INTO secrets(key,value,updated_at) VALUES('NAVER_PW_DPAPI', :v, now())\n"
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()"
        ), {"v": enc_pw})


def load_creds() -> Optional[Tuple[str, str]]:
    with db_session() as s:
        rid = s.execute(text("SELECT value FROM secrets WHERE key='NAVER_ID_DPAPI'" )).scalar()
        rpw = s.execute(text("SELECT value FROM secrets WHERE key='NAVER_PW_DPAPI'" )).scalar()
    if not rid or not rpw:
        return None
    try:
        return _unprotect_dpapi(rid), _unprotect_dpapi(rpw)
    except Exception as e:
        log.warning(f"load_creds failed: {e}")
        return None


def load_meta() -> dict:
    with db_session() as s:
        rid = s.execute(text("SELECT value, updated_at FROM secrets WHERE key='NAVER_ID_DPAPI'" )).first()
    if not rid:
        return {"saved": False}
    try:
        nid = _unprotect_dpapi(rid[0])
        masked = nid[:3] + "***" if len(nid) >= 3 else "***"
        return {"saved": True, "id_masked": masked, "updated_at": rid[1].isoformat() if rid[1] else None}
    except Exception:
        return {"saved": True, "id_masked": None, "updated_at": rid[1].isoformat() if rid[1] else None}

