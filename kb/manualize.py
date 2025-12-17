from __future__ import annotations

import os
import re
from collections import defaultdict
from datetime import datetime as _dt
from typing import Dict, List

from sqlalchemy import text
from kb.db import db_session
from kb.jobs import start, finish
from kb.menu_ssot import get_cafe_id, get_cafe_url
from kb.lock import lock_scope


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


def _upsert_manual_doc(title: str, body_md: str, status: str = "published"):
    """정적/운영용 매뉴얼 문서를 upsert한다."""
    title = (title or "").strip()
    body_md = (body_md or "").strip()
    if not title or not body_md:
        return
    summary = body_md[:240]
    with db_session() as s:
        result = s.execute(
            text(
                """
                UPDATE manual_doc
                SET body_md = :b, summary = :s, status = :st, updated_at = now()
                WHERE title = :t
                """
            ),
            {"t": title, "b": body_md, "s": summary, "st": status},
        )
        if result.rowcount == 0:
            s.execute(
                text(
                    """
                    INSERT INTO manual_doc (title, body_md, summary, status)
                    VALUES (:t, :b, :s, :st)
                    """
                ),
                {"t": title, "b": body_md, "s": summary, "st": status},
            )


def _fetch_posts_for_menu(menu_id: int, limit: int) -> list:
    with db_session() as s:
        rows = s.execute(
            text(
                """
                SELECT post_id, menu_id, COALESCE(title,'') AS title, COALESCE(url,'') AS url, created_at
                FROM sources_post
                WHERE status='clean' AND menu_id = :mid
                ORDER BY created_at DESC NULLS LAST, post_id DESC
                LIMIT :lim
                """
            ),
            {"mid": int(menu_id), "lim": int(limit)},
        ).fetchall()
    return rows


def _extract_instructor_from_title(title: str) -> str:
    t = (title or "").strip()
    if not t:
        return ""
    m = re.search(r"\(([^()]{2,30})\)\s*$", t)
    if not m:
        return ""
    cand = (m.group(1) or "").strip()
    if not cand:
        return ""
    # 강사명으로 보기 어려운 키워드는 제외 (오탐 방지)
    if re.search(r"(실습|보너스|다시보기|vod|무료|정규|특강|신청)", cand, flags=re.IGNORECASE):
        return ""
    if re.search(r"https?://", cand):
        return ""
    return cand


def _fmt_date(v) -> str:
    if isinstance(v, _dt):
        try:
            return v.date().isoformat()
        except Exception:
            return ""
    return ""


def _build_schedule_instructor_index_md(
    free_rows: list,
    paid_rows: list,
    scan_rows: list,
    *,
    scan_limit: int,
    instructors_limit: int,
    per_instructor_posts: int,
) -> str:
    cafe_id = get_cafe_id()
    cafe_url = get_cafe_url()

    lines: list[str] = []
    lines.append("# [KB] 강의/강사 인덱스 (신청 게시판)")
    lines.append("")
    lines.append("본 문서는 신청 게시판(무료특강 23 / 정규강의 42)의 최근 글을 기반으로 **자동 생성**됩니다.")
    lines.append("- 강사명은 글 제목 끝의 `(닉네임)` 표기에서만 추출합니다(누락 가능).")
    lines.append("- 실명/외부 프로필/경력/수익 등은 자료에 없으면 추측하지 않습니다.")
    lines.append("")
    lines.append("## 카페 SSOT")
    lines.append(f"- cafe_id: {cafe_id}")
    lines.append(f"- cafe_url: {cafe_url}")
    lines.append("- 신청 게시판 SSOT: 무료특강 신청(23), 정규강의 신청(42)")
    lines.append("")

    def _append_rows(title: str, rows: list):
        lines.append(f"## {title}")
        if not rows:
            lines.append("- (자료 없음)")
            lines.append("")
            return
        for r in rows:
            d = _fmt_date(r.created_at)
            t = (r.title or "").strip() or "(제목 없음)"
            url = (r.url or "").strip()
            prefix = f"{d} " if d else ""
            if url:
                lines.append(f"- {prefix}[{t}]({url})")
            else:
                lines.append(f"- {prefix}{t}")
        lines.append("")

    _append_rows("무료특강 신청(23) 최신", free_rows)
    _append_rows("정규강의 신청(42) 최신", paid_rows)

    # 강사 인덱스: scan_rows에서 (닉네임) 추출
    instr_posts: dict[str, list] = defaultdict(list)
    instr_latest: dict[str, _dt] = {}
    for r in scan_rows or []:
        name = _extract_instructor_from_title(r.title or "")
        if not name:
            continue
        instr_posts[name].append(r)
        ts = r.created_at if isinstance(r.created_at, _dt) else None
        if ts is not None:
            prev = instr_latest.get(name)
            if (prev is None) or (ts > prev):
                instr_latest[name] = ts

    sorted_names = sorted(
        instr_posts.keys(),
        key=lambda n: (instr_latest.get(n) or _dt.min),
        reverse=True,
    )
    total_found = len(sorted_names)
    top_names = sorted_names[: max(0, int(instructors_limit))]

    lines.append("## 강사 인덱스(최근 신청글 제목 표기 기준)")
    lines.append(
        f"- 기준: 메뉴 23/42 최근 {int(scan_limit)}개 글에서 제목 끝 '(강사명)' 표기를 스캔 (총 {total_found}명 확인)"
    )
    if not top_names:
        lines.append("- (강사 표기 추출 결과 없음)")
        return "\n".join(lines).strip()

    for name in top_names:
        rows = instr_posts.get(name) or []
        rows_sorted = sorted(
            rows,
            key=lambda r: (
                r.created_at if isinstance(r.created_at, _dt) else _dt.min,
                int(getattr(r, "post_id", 0) or 0),
            ),
            reverse=True,
        )[: max(1, int(per_instructor_posts))]
        lines.append(f"- {name}")
        for r in rows_sorted:
            d = _fmt_date(r.created_at)
            t = (r.title or "").strip() or "(제목 없음)"
            url = (r.url or "").strip()
            if url:
                lines.append(f"  - {d} [{t}]({url})".rstrip())
            else:
                lines.append(f"  - {d} {t}".rstrip())

    return "\n".join(lines).strip()


def _repair_short_post_urls() -> int:
    """url이 `https://cafe.naver.com/<post_id>` 형태로 저장된 경우를 SSOT cafe_url로 보정한다.

    NOTE:
    - 일부 수집 경로에서 permalink가 짧게 내려오는 케이스가 있어, 운영 답변/인덱스에서 링크가 깨지는 문제를 방지한다.
    - post_id(글 번호) + cafe_url 조합은 네이버 카페의 표준 공유 링크 형태다.
    """
    cafe_url = get_cafe_url().rstrip("/")
    if not cafe_url:
        return 0
    with db_session() as s:
        res = s.execute(
            text(
                r"""
                UPDATE sources_post
                SET url = :base || '/' || post_id::text
                WHERE url ~ '^https?://cafe\.naver\.com/\d+$'
                """
            ),
            {"base": cafe_url},
        )
        return int(res.rowcount or 0)


def run():
    stale_sec = int(os.getenv("KB_MANUAL_LOCK_STALE_SEC", str(3 * 60 * 60)) or str(3 * 60 * 60))
    with lock_scope("manualize", stale_sec=stale_sec) as acquired:
        if not acquired:
            print("[manualize] already running; skip")
            return

        jid = start("manualize")
        try:
            # 링크 보정(짧은 permalink) - 실행 비용이 낮아 주기적으로 보정해도 안전하다.
            try:
                fixed = _repair_short_post_urls()
                if fixed:
                    print(f"[manualize] repaired short post urls: {fixed}")
            except Exception as e:
                print(f"[manualize] short url repair skipped: {e}")

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

            # 운영/용어 정의(SSOT) 문서 upsert: RAG가 용어(예: 다시보기) 의미를 안정적으로 이해하도록 한다.
            root = os.path.dirname(os.path.dirname(__file__))
            glossary_path = os.path.join(root, "docs", "kb_glossary.md")
            if os.path.exists(glossary_path):
                try:
                    body = open(glossary_path, "r", encoding="utf-8").read().strip()
                    if body:
                        _upsert_manual_doc("[KB] 운영 용어/인물 정의", body, status="published")
                except Exception as e:
                    # manualize 전체를 실패시키지 않되, 로그/잡 이력으로 남긴다.
                    print(f"[manualize] static glossary upsert skipped: {e}")

            # 카페 기본 정보(SSOT) 문서 upsert
            cafe_profile_path = os.path.join(root, "docs", "cafe_profile.md")
            if os.path.exists(cafe_profile_path):
                try:
                    body = open(cafe_profile_path, "r", encoding="utf-8").read().strip()
                    if body:
                        _upsert_manual_doc("[KB] 디하클 카페 기본 정보", body, status="published")
                except Exception as e:
                    print(f"[manualize] cafe profile upsert skipped: {e}")

            # 신청 게시판(23/42) 기반 강의/강사 인덱스 자동 생성
            try:
                schedule_per_menu = int(os.getenv("KB_SCHEDULE_INDEX_PER_MENU", "15"))
                schedule_scan_total = int(os.getenv("KB_SCHEDULE_INSTRUCTORS_SCAN_TOTAL", "300"))
                schedule_instructors_limit = int(os.getenv("KB_SCHEDULE_INSTRUCTORS_LIMIT", "30"))
                schedule_posts_per_instructor = int(os.getenv("KB_SCHEDULE_POSTS_PER_INSTRUCTOR", "2"))

                free_rows = _fetch_posts_for_menu(23, schedule_per_menu)
                paid_rows = _fetch_posts_for_menu(42, schedule_per_menu)
                scan_half = max(1, schedule_scan_total // 2)
                scan_rows = _fetch_posts_for_menu(23, scan_half) + _fetch_posts_for_menu(42, scan_half)
                scan_rows = sorted(
                    scan_rows,
                    key=lambda r: (
                        r.created_at if isinstance(r.created_at, _dt) else _dt.min,
                        int(getattr(r, "post_id", 0) or 0),
                    ),
                    reverse=True,
                )[:schedule_scan_total]

                body_md = _build_schedule_instructor_index_md(
                    free_rows,
                    paid_rows,
                    scan_rows,
                    scan_limit=schedule_scan_total,
                    instructors_limit=schedule_instructors_limit,
                    per_instructor_posts=schedule_posts_per_instructor,
                )
                if body_md:
                    _upsert_manual_doc("[KB] 강의/강사 인덱스 (신청 게시판)", body_md, status="published")
            except Exception as e:
                print(f"[manualize] schedule/instructor index skipped: {e}")

            finish(jid, "done", {"menus": len(grouped), "posts": sum(len(v) for v in grouped.values())})
            print(f"[manualize] upserted manuals for {len(grouped)} menus")
        except Exception as e:  # pragma: no cover
            finish(jid, "error", {"error": str(e)})
            raise


if __name__ == "__main__":
    run()
