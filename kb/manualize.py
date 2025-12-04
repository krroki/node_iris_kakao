from __future__ import annotations

import os
from collections import defaultdict
from typing import Dict, List

from sqlalchemy import text
from kb.db import db_session
from kb.jobs import start, finish


def _fetch_recent_posts(limit_total: int):
    with db_session() as s:
        rows = s.execute(text(
            """
            SELECT post_id, menu_id, COALESCE(title,'') AS title, COALESCE(url,'') AS url, created_at
            FROM sources_post
            WHERE status = 'clean'
            ORDER BY created_at DESC NULLS LAST
            LIMIT :lim
            """
        ), {"lim": limit_total}).fetchall()
    return rows


def _group_by_menu(rows, per_menu: int) -> Dict[str, List]:
    grouped: Dict[str, List] = defaultdict(list)
    for r in rows:
        key = r.menu_id if r.menu_id is not None else "unknown"
        if len(grouped[key]) >= per_menu:
            continue
        grouped[key].append(r)
    return grouped


def _build_body_md(menu_id, posts) -> str:
    lines: List[str] = [f"## 메뉴 {menu_id}"]
    for p in posts:
        title = p.title or "(제목 없음)"
        url = p.url or ""
        lines.append(f"- [{title}]({url})" if url else f"- {title}")
    return "\n".join(lines)


def _upsert_manual(menu_id, body_md: str):
    title = f"[KB] 메뉴 {menu_id} 최근 모음"
    summary = body_md[:240]
    with db_session() as s:
        # 1) 업데이트 시도
        result = s.execute(text(
            """
            UPDATE manual_doc
            SET body_md = :b, summary = :s, status = 'published', updated_at = now()
            WHERE title = :t
            """
        ), {"t": title, "b": body_md, "s": summary})
        if result.rowcount == 0:
            # 2) 없으면 신규 삽입
            s.execute(text(
                """
                INSERT INTO manual_doc (title, body_md, summary, status)
                VALUES (:t, :b, :s, 'published')
                """
            ), {"t": title, "b": body_md, "s": summary})


def run():
    jid = start("manualize")
    try:
        total = int(os.getenv("KB_MANUAL_TOTAL", "200"))
        per_menu = int(os.getenv("KB_MANUAL_PER_MENU", "20"))
        rows = _fetch_recent_posts(total)
        if not rows:
            finish(jid, "done", {"menus": 0, "posts": 0, "note": "no posts"})
            print("[manualize] no posts to manualize")
            return
        grouped = _group_by_menu(rows, per_menu)
        for menu_id, posts in grouped.items():
            body_md = _build_body_md(menu_id, posts)
            _upsert_manual(menu_id, body_md)
        finish(jid, "done", {"menus": len(grouped), "posts": sum(len(v) for v in grouped.values())})
        print(f"[manualize] upserted manuals for {len(grouped)} menus")
    except Exception as e:  # pragma: no cover
        finish(jid, "error", {"error": str(e)})
        raise


if __name__ == "__main__":
    run()
