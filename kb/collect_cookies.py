from __future__ import annotations

import os
import time
import json
import requests
from pathlib import Path
from playwright.sync_api import sync_playwright
import shutil
import tempfile


def _launch_ephemeral(p):
    # Try Chrome → Edge → bundled Chromium
    for channel in ("chrome", "msedge", None):
        try:
            ctx = p.chromium.launch_persistent_context(  # ephemeral replacement: use temp dir per launch
                user_data_dir=str(Path(tempfile.mkdtemp(prefix="kb-cafe-"))),
                headless=False,
                channel=channel,
                args=["--no-first-run", "--no-default-browser-check"],
            )
            return ctx
        except Exception:
            continue
    raise RuntimeError("No Chromium/Chrome/Edge available for Playwright")


def main():
    api_base = os.getenv("KB_URL", "http://127.0.0.1:8610")
    # Clean any stale profile dir that may cause Chrome 'profile error'
    stale = Path("tmp/playwright-cafe-profile")
    if stale.exists():
        try:
            shutil.rmtree(stale, ignore_errors=True)
        except Exception:
            pass
    with sync_playwright() as p:
        ctx = _launch_ephemeral(p)
        page = ctx.new_page()
        try:
            page.goto("https://cafe.naver.com", timeout=60_000, wait_until="load")
            started = time.time()
            got = None
            while time.time() - started < 180:  # 3 minutes
                cks = ctx.cookies()
                rel = [c for c in cks if c["domain"].endswith("naver.com")]
                has_login = any(c["name"] in ("NID_SES", "NID_AUT", "NVME") for c in rel)
                if has_login:
                    cookie_header = "; ".join(f"{c['name']}={c['value']}" for c in rel)
                    got = cookie_header
                    break
                page.wait_for_timeout(1500)
            if not got:
                print("[cookie] Login not detected; aborting")
                return
            r = requests.post(f"{api_base}/cookies", json={"cookies": got}, timeout=15)
            r.raise_for_status()
            print("[cookie] saved to KB service")
        finally:
            page.wait_for_timeout(1500)
            ctx.close()


if __name__ == "__main__":
    main()
