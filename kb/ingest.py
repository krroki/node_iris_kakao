from __future__ import annotations

import os
from typing import List

from kb.cafe_api import list_articles, get_article
from kb.auto_login import login_and_store
from kb.rules import load_rules, should_keep
from kb.collect_detail import upsert_post
from kb.normalize import html_to_text
from kb.jobs import start, finish
from sqlalchemy import text
from kb.db import db_session
from kb.logging_util import get_logger

logger = get_logger("kb.ingest")

DEFAULT_RULES = os.getenv("KB_RULES", "config/collect_rules.yaml")
CAFE_ID = int(os.getenv("KB_CAFE_ID", "30819883"))  # dinohighclass default


def _parse_menus_from_env() -> List[int]:
    """메뉴 ID 목록 결정

    우선순위:
    1. KB_MENUS 환경변수 (직접 지정)
    2. SSOT (config/menus_dinohighclass.json)의 collect=true 메뉴
    """
    raw = os.getenv("KB_MENUS", "").strip()
    if raw:
        # 환경변수가 설정된 경우 직접 파싱
        menus: List[int] = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            try:
                menus.append(int(part))
            except Exception as e:
                raise ValueError(f"KB_MENUS has non-integer entry: {part}") from e
        if menus:
            logger.info(f"Using KB_MENUS env: {menus}")
            return menus

    # KB_MENUS 미설정 → SSOT에서 collect=true 메뉴 가져오기
    try:
        from kb.menu_ssot import get_collect_menu_ids, get_cafe_id
        ssot_menus = get_collect_menu_ids()
        if ssot_menus:
            ssot_cafe_id = get_cafe_id()
            logger.info(f"Using SSOT collect menus ({ssot_cafe_id}): {ssot_menus}")
            return ssot_menus
    except Exception as e:
        logger.warning(f"SSOT load failed, falling back to error: {e}")

    raise ValueError("KB_MENUS is not set and SSOT unavailable; provide comma-separated menu ids")


def _max_known_post_id(menu_id: int) -> int:
    with db_session() as s:
        m = s.execute(text("SELECT COALESCE(MAX(post_id),0) FROM sources_post WHERE menu_id=:m"), {"m": menu_id}).scalar()
        return int(m or 0)


def ingest(cafe_id: int, menus: List[int], pages: int = 3):
    rules = load_rules(DEFAULT_RULES)
    kept = 0
    skipped = 0
    known = 0
    try_login = os.getenv("KB_LOGIN_ON_DEMAND", "1") == "1"

    def ensure_login_once():
        nonlocal try_login
        if not try_login:
            return False
        ok = login_and_store()
        try_login = False
        return ok

    for mid in menus:
        max_known = _max_known_post_id(mid)
        break_on_known = os.getenv("KB_DELTA_BREAK", "1") == "1"
        reached_old = False
        for page in range(1, pages + 1):
            try:
                arts = list_articles(menu_id=mid, page=page, per_page=50)
            except Exception:
                if ensure_login_once():
                    arts = list_articles(menu_id=mid, page=page, per_page=50)
                else:
                    raise
            if not arts:
                break
            for a in arts:
                aid = a.get("articleId") or a.get("articleIdLong") or a.get("articleIdStr")
                title = a.get("subject") or a.get("title") or ""
                url = a.get("permalink") or a.get("articleUrl") or f"https://cafe.naver.com/dinohighclass/{aid}"
                if not aid:
                    continue
                try:
                    aid_int = int(aid)
                except Exception:
                    continue
                if max_known and aid_int <= max_known:
                    known += 1
                    reached_old = True
                    continue
                try:
                    try:
                        detail = get_article(aid_int)
                    except Exception:
                        if ensure_login_once():
                            detail = get_article(aid_int)
                        else:
                            raise
                    article = detail.get("result", {}).get("article") or detail.get("article") or {}
                    html = article.get("contentHtml") or article.get("content") or ""
                    ts = a.get("writeDateTimestamp") or a.get("regDateTimestamp")
                    created_iso = None
                    try:
                        if ts:
                            t = int(ts)
                            if t < 10_000_000_000:
                                t = t * 1000
                            import datetime as _dt
                            created_iso = _dt.datetime.utcfromtimestamp(t/1000.0).isoformat()+"Z"
                    except Exception:
                        created_iso = None
                    text = html_to_text(html)
                    if not should_keep(mid, title, text, rules):
                        skipped += 1
                        continue
                    upsert_post(cafe_id, mid, aid_int, url, title, html, created_iso)
                    kept += 1
                except Exception:
                    skipped += 1
                    continue
            if break_on_known and reached_old:
                break
    return {"kept": kept, "skipped": skipped, "known": known}


def main():
    menus = _parse_menus_from_env()
    pages = int(os.getenv("KB_PAGES", "3"))
    jid = start("ingest", {"menus": menus, "pages": pages, "cafe_id": CAFE_ID})
    try:
        res = ingest(CAFE_ID, menus, pages=pages)
        finish(jid, "done", {"summary": res})
        print(f"[ingest] kept={res['kept']} skipped={res['skipped']} known={res.get('known',0)}")
    except Exception as e:  # pragma: no cover
        finish(jid, "error", {"error": str(e)})
        raise


if __name__ == "__main__":
    main()
