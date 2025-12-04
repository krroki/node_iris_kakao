from __future__ import annotations

import os
import time
from typing import Any, Dict, Iterable, List, Optional
import requests
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type
from kb.logging_util import get_logger
from kb.db import db_session
from sqlalchemy import text


CAFE_ID = 30819883
HTTP_TIMEOUT = float(os.getenv("KB_HTTP_TIMEOUT", "6"))
logger = get_logger("kb.cafe_api")
UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0 Safari/537.36"
)


def _cookie_jar() -> Dict[str, str]:
    raw = os.getenv("CAFE_COOKIES", "")
    # Fallback: read from DB secrets if env not set
    if not raw:
        try:
            with db_session() as s:
                row = s.execute(text("SELECT value FROM secrets WHERE key='CAFE_COOKIES'" )).first()
                if row and row[0]:
                    raw = row[0]
        except Exception:
            pass
    jar: Dict[str, str] = {}
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        jar[k.strip()] = v.strip()
    return jar


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Referer": f"https://cafe.naver.com/{CAFE_ID}",
        "Origin": "https://cafe.naver.com",
    })
    cj = _cookie_jar()
    if cj:
        s.cookies.update(cj)
    return s


@retry(stop=stop_after_attempt(int(os.getenv("KB_HTTP_RETRY", "2"))), wait=wait_exponential(min=0.5, max=4), reraise=True,
       retry=retry_if_exception_type((requests.RequestException,)))
def list_articles(menu_id: int, page: int = 1, per_page: int = 50) -> List[Dict[str, Any]]:
    """Fetch article summaries for a menu.

    Uses Naver cafe-web ArticleList API. Requires valid cookies.
    Returns list of dicts with at least articleId, subject, writerNickname, writeDateTimestamp.
    """
    url = (
        "https://apis.naver.com/cafe-web/cafe2/ArticleListV2.json"
        f"?search.clubid={CAFE_ID}&search.menuid={menu_id}&search.page={page}&search.perPage={per_page}"
    )
    s = _session()
    logger.info(f"GET ArticleList menu={menu_id} page={page}")
    r = s.get(url, timeout=HTTP_TIMEOUT)
    r.raise_for_status()
    data = r.json()
    result = data.get("message", {}).get("result", {})
    articles = result.get("articleList", []) or result.get("articles", [])
    return articles


@retry(stop=stop_after_attempt(int(os.getenv("KB_HTTP_RETRY", "2"))), wait=wait_exponential(min=0.5, max=4), reraise=True,
       retry=retry_if_exception_type((requests.RequestException,)))
def get_article(article_id: int, menu_id: Optional[int] = None) -> Dict[str, Any]:
    """Fetch article detail including HTML content and attachments.

    Tries multiple cafe-articleapi versions; requires cookies.
    """
    s = _session()
    params = "useCafeId=true&requestFrom=A"
    if menu_id:
        params += f"&menuId={menu_id}"
    urls = [
        f"https://apis.naver.com/cafe-web/cafe-articleapi/v2.1/cafes/{CAFE_ID}/articles/{article_id}?{params}",
        f"https://apis.naver.com/cafe-web/cafe-articleapi/v2/cafes/{CAFE_ID}/articles/{article_id}?{params}",
        f"https://apis.naver.com/cafe-web/cafe-articleapi/cafes/{CAFE_ID}/articles/{article_id}?{params}",
    ]
    last = None
    for url in urls:
        logger.info(f"GET Article id={article_id} url_ver={url.split('/')[6]}")
        last = s.get(url, timeout=HTTP_TIMEOUT)
        if last.status_code == 200:
            return last.json()
        # Retry next variant on 4xx/5xx
    last.raise_for_status()
    return last.json()


def wait_for_server(url: str, timeout_sec: int = 60):
    deadline = time.time() + timeout_sec
    while time.time() < deadline:
        try:
            r = requests.get(url, timeout=3)
            if r.ok:
                return True
        except Exception:
            pass
        time.sleep(1)
    return False
