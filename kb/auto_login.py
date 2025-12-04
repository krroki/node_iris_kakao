import os
import subprocess
import sys
import tempfile
from pathlib import Path

from kb.db import db_session
from kb.logging_util import get_logger
from sqlalchemy import text
from kb.creds import load_creds


log = get_logger("kb.auto_login")


def login_and_store(force: bool = False) -> bool:
    """
    자동 로그인(Node Playwright 사용) 후 쿠키를 KB 서비스에 저장.
    - 환경변수 NAVER_ID / NAVER_PW 필요
    - KB 서비스가 같은 프로세스이므로, 여기서는 Node 스크립트를 호출하여
      쿠키를 수집하고 직접 DB(secrets)에 저장한다.
    - force=True면 기존 쿠키 무시하고 새로 로그인
    """
    # 1) 이미 저장된 쿠키가 있으면 그대로 재사용 (force가 아닐 때만)
    if not force:
        with db_session() as s:
            existing = s.execute(
                text("SELECT value FROM secrets WHERE key='CAFE_COOKIES'")
            ).scalar()
        if existing:
            os.environ["CAFE_COOKIES"] = existing
            return True

    nid = os.environ.get("NAVER_ID", "").strip()
    npw = os.environ.get("NAVER_PW", "").strip()
    if not nid or not npw:
        pair = load_creds()
        if not pair:
            return False
        nid, npw = pair

    root = Path(__file__).resolve().parents[1]
    node = "node"
    script = root / "scripts" / "auto_login_naver.js"
    # Node 스크립트가 쿠키 문자열을 stdout으로 출력하도록 하고, 여기서 DB에 저장
    env = os.environ.copy()
    env.setdefault("KB_LOGIN_HEADLESS", "1")
    env["NAVER_ID"] = nid
    env["NAVER_PW"] = npw
    cookie_out = tempfile.NamedTemporaryFile(delete=False, suffix=".cookie").name
    env["COOKIE_OUT"] = cookie_out
    try:
        proc = subprocess.run([node, str(script)], cwd=root, env=env, timeout=180)
    except Exception as e:
        log.exception(f"auto_login spawn failed: {e}")
        return False

    cookies = None
    try:
        if Path(cookie_out).exists():
            cookies = Path(cookie_out).read_text(encoding="utf-8").strip()
    finally:
        try:
            Path(cookie_out).unlink(missing_ok=True)
        except Exception:
            pass

    if proc.returncode != 0:
        log.warning(f"auto_login failed rc={proc.returncode}")
        return False

    # stdout 에서 'COOKIE: ' 프리픽스 라인도 보조로 확인
    if not cookies and proc.stdout:
        for line in (proc.stdout or "").splitlines():
            if line.startswith("COOKIE: "):
                cookies = line.split("COOKIE: ", 1)[1].strip()
                break
    if not cookies:
        log.warning(f"auto_login no cookies in stdout: {proc.stdout!r}")
        return False

    with db_session() as s:
        s.execute(text(
            "INSERT INTO secrets(key,value,updated_at) VALUES('CAFE_COOKIES', :v, now())\n"
            "ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=now()"
        ), {"v": cookies})
    os.environ["CAFE_COOKIES"] = cookies
    return True
