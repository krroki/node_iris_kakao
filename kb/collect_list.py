"""Collect new post IDs from whitelisted boards.

This is a skeleton. Real implementation must authenticate to Naver Cafe
and call official endpoints used by web/mobile. Provide cookie via env CAFE_COOKIES.
"""
from __future__ import annotations

import os
import time
from typing import Iterable
import requests
from tenacity import retry, stop_after_attempt, wait_exponential
from kb.cafe_api import list_articles
from kb.jobs import job_scope

WHITELIST_MENUS = [192, 23, 42, 136]


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=8))
def fetch_menu_list(menu_id: int) -> Iterable[int]:
    page = 1
    while True:
        arts = list_articles(menu_id=menu_id, page=page, per_page=50)
        if not arts:
            break
        for a in arts:
            aid = a.get("articleId") or a.get("articleIdLong") or a.get("articleIdStr")
            if aid is None:
                continue
            try:
                yield int(aid)
            except Exception:
                continue
        # stop after first 3 pages on list crawl to keep it light
        page += 1
        if page > 3:
            break


def main():
    if not os.getenv("CAFE_COOKIES"):
        print("[collect_list] Warning: CAFE_COOKIES is empty; login-required endpoints may fail.")
    with job_scope("collect_list", {"menus": WHITELIST_MENUS}) as jid:
        seen = 0
        for mid in WHITELIST_MENUS:
            for pid in fetch_menu_list(mid):
                print(f"FOUND {mid}/{pid}")
                seen += 1
        print(f"[collect_list] discovered={seen}")


if __name__ == "__main__":
    main()
