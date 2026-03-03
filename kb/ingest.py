from __future__ import annotations

import datetime as dt
import os
from typing import List

from kb.cafe_api import list_articles, get_article
from kb.auto_login import login_and_store
from kb.rules import load_rules, should_keep
from kb.collect_detail import upsert_post
from kb.normalize import html_to_text
from kb.disabled_menus import DISABLED_MENU_IDS
from kb.jobs import start, finish
from sqlalchemy import text
from kb.db import db_session
from kb.logging_util import get_logger
from kb.ocr import extract_image_urls_from_html, filter_ocr_candidate_urls, openai_ocr_images
from kb.lock import lock_scope

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
    menus = [m for m in (menus or []) if m not in DISABLED_MENU_IDS]
    if not menus:
        logger.info("[ingest] no menus to ingest after disabled filter")
        return {"kept": 0, "skipped": 0, "known": 0}

    rules = load_rules(DEFAULT_RULES)
    kept = 0
    skipped = 0
    known = 0
    try_login = os.getenv("KB_LOGIN_ON_DEMAND", "1") == "1"

    # OCR(메뉴 23/42 기본): 가격/수강료가 이미지에만 있는 신청 글을 학습시키기 위함
    def _env_truthy(name: str, default: str = "1") -> bool:
        v = str(os.getenv(name, default)).strip().lower()
        return v not in {"0", "false", "no", "off", ""}

    ocr_enabled = _env_truthy("KB_OCR_ENABLED", "1")
    ocr_menu_ids_raw = str(os.getenv("KB_OCR_MENU_IDS", "23,42") or "").strip()
    ocr_menu_ids: set[int] = set()
    for part in ocr_menu_ids_raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            ocr_menu_ids.add(int(part))
        except Exception:
            continue
    ocr_backfill_days = int(os.getenv("KB_OCR_BACKFILL_DAYS", "14") or "14")
    ocr_backfill_per_run = int(os.getenv("KB_OCR_BACKFILL_PER_RUN", "6") or "6")
    ocr_max_images = int(os.getenv("KB_OCR_MAX_IMAGES_PER_POST", "6") or "6")
    ocr_sleep_sec = float(os.getenv("KB_OCR_SLEEP_SEC", "0") or "0")

    def _post_has_ocr_marker(post_id: int) -> bool:
        try:
            with db_session() as s:
                row = s.execute(
                    text("SELECT 1 FROM sources_post WHERE post_id=:id AND norm_text LIKE '%[OCR]%' LIMIT 1"),
                    {"id": post_id},
                ).first()
            return row is not None
        except Exception:
            return False

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
        want_ocr = bool(ocr_enabled and (mid in ocr_menu_ids))
        ocr_backfill_budget = ocr_backfill_per_run
        ocr_cutoff_dt = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=max(0, ocr_backfill_days))
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
                is_known = bool(max_known and aid_int <= max_known)
                try:
                    try:
                        detail = get_article(aid_int, menu_id=mid)
                    except Exception:
                        if ensure_login_once():
                            detail = get_article(aid_int, menu_id=mid)
                        else:
                            raise
                    article = detail.get("result", {}).get("article") or detail.get("article") or {}
                    html = article.get("contentHtml") or article.get("content") or ""
                    ts = a.get("writeDateTimestamp") or a.get("regDateTimestamp")
                    created_iso = None
                    created_dt: dt.datetime | None = None
                    try:
                        if ts:
                            t = int(ts)
                            if t < 10_000_000_000:
                                t = t * 1000
                            created_iso = (
                                dt.datetime.fromtimestamp(t / 1000.0, tz=dt.timezone.utc)
                                .isoformat()
                                .replace("+00:00", "Z")
                            )
                            created_dt = dt.datetime.fromtimestamp(t / 1000.0, tz=dt.timezone.utc)
                    except Exception:
                        created_iso = None
                        created_dt = None

                    # 이미 수집된 글이라도, OCR 대상 메뉴(23/42)이고 최근 글이며 OCR 마커가 없으면 재수집(OCR 보강)한다.
                    needs_ocr_refresh = False
                    if want_ocr and is_known and (ocr_backfill_budget > 0) and created_dt and (created_dt >= ocr_cutoff_dt):
                        if not _post_has_ocr_marker(aid_int):
                            needs_ocr_refresh = True

                    if is_known and not needs_ocr_refresh:
                        known += 1
                        reached_old = True
                        continue

                    text = html_to_text(html)
                    if not should_keep(mid, title, text, rules):
                        skipped += 1
                        continue

                    ocr_text = None
                    if want_ocr:
                        urls = filter_ocr_candidate_urls(extract_image_urls_from_html(html), limit=ocr_max_images)
                        if urls:
                            ocr_text = openai_ocr_images(urls, sleep_sec=ocr_sleep_sec)
                    upsert_post(cafe_id, mid, aid_int, url, title, html, created_iso, ocr_text=ocr_text)
                    kept += 1
                    if needs_ocr_refresh and ocr_backfill_budget > 0:
                        ocr_backfill_budget -= 1
                except Exception:
                    skipped += 1
                    continue
            if break_on_known and reached_old:
                break
    return {"kept": kept, "skipped": skipped, "known": known}


def main():
    stale_sec = int(os.getenv("KB_INGEST_LOCK_STALE_SEC", str(3 * 60 * 60)) or str(3 * 60 * 60))
    with lock_scope("ingest", stale_sec=stale_sec) as acquired:
        if not acquired:
            print("[ingest] already running; skip")
            return

        menus = _parse_menus_from_env()
        before = list(menus)
        menus = [m for m in menus if m not in DISABLED_MENU_IDS]
        if before != menus:
            logger.info(f"[ingest] disabled menus filtered: before={before} after={menus}")
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
