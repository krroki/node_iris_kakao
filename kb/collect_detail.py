"""Fetch post details (html, attachments) and store into DB.

Skeleton implementation with placeholders for Naver Cafe API.
"""
from __future__ import annotations

import os
import requests
from sqlalchemy import text
from kb.db import db_session
from kb.normalize import html_to_text, sha256
from kb.cafe_api import get_article
from kb.jobs import job_scope


def get_cookies_from_env() -> dict:
    raw = os.getenv("CAFE_COOKIES", "")
    jar = {}
    for part in raw.split(";"):
        part = part.strip()
        if not part or "=" not in part:
            continue
        k, v = part.split("=", 1)
        jar[k.strip()] = v.strip()
    return jar


def fetch_post_html(cafe_id: int, post_id: int) -> str:
    data = get_article(post_id)
    article = data.get("result", {}).get("article") or data.get("article") or {}
    html = article.get("contentHtml") or article.get("content") or ""
    return html


def upsert_post(cafe_id: int, menu_id: int, post_id: int, url: str, title: str, html: str, created_at_iso: str | None = None):
    text_ = html_to_text(html)
    text_hash = sha256(text_)
    dedup_key = sha256(f"{title}|{cafe_id}|{menu_id}")
    with db_session() as s:
        s.execute(text(
            """
            INSERT INTO sources_post (post_id, cafe_id, menu_id, url, title, html, norm_text, text_hash, dedup_key, status, created_at, last_crawled_at, updated_at)
            VALUES (:post_id,:cafe_id,:menu_id,:url,:title,:html,:norm,:hash,:dup,'clean', :created_at, now(), now())
            ON CONFLICT (post_id) DO UPDATE SET
              url=EXCLUDED.url,
              title=EXCLUDED.title,
              html=EXCLUDED.html,
              norm_text=EXCLUDED.norm_text,
              text_hash=EXCLUDED.text_hash,
              dedup_key=EXCLUDED.dedup_key,
              last_crawled_at=now(),
              updated_at=now(),
              created_at=COALESCE(sources_post.created_at, EXCLUDED.created_at)
            """
        ), {
            "post_id": post_id,
            "cafe_id": cafe_id,
            "menu_id": menu_id,
            "url": url,
            "title": title,
            "html": html,
            "norm": text_,
            "hash": text_hash,
            "dup": dedup_key,
            "created_at": created_at_iso,
        })


def main():
    with job_scope("collect_detail"):
        # Example: pull a single article ID from env for testing
        post_id = int(os.getenv("TEST_POST_ID", "0"))
        menu_id = int(os.getenv("TEST_MENU_ID", "192"))
        if post_id:
            html = fetch_post_html(30819883, post_id)
            upsert_post(30819883, menu_id, post_id, f"https://cafe.naver.com/f-e/articles/{post_id}", f"post {post_id}", html)
            print(f"[collect_detail] upsert post {post_id} ok")
        else:
            print("[collect_detail] set TEST_POST_ID to fetch a real post")


if __name__ == "__main__":
    main()
