from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from kb.db import db_session
from kb.embed import embed_texts

logger = logging.getLogger("kb.search")

# 기본 설정값
DEFAULT_CAFE_ID = 30819883  # dinohighclass
DEFAULT_DAYS_LIMIT = 180  # 6개월

# 유효한 프로필 목록
VALID_PROFILES = ["main", "free", "paid", "tips", "community"]


def vector_search(
    query: str,
    top_k: int = 6,
    days_limit: Optional[int] = None,
    cafe_id: Optional[int] = None,
    profile: Optional[str] = None,
    menu_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """KB 벡터 검색을 수행한다."""

    dist_max = float(os.getenv("KB_DIST_MAX", "0.85"))

    qvec = embed_texts([query])[0]
    dim = len(qvec)
    if dim == 0:
        logger.warning("[vector_search] 빈 임베딩 반환 -> 결과 0건", extra={"query": query})
        return {"manuals": [], "posts": [], "meta": {"error": "empty_embedding"}}

    # 날짜 제한 결정
    if days_limit is None:
        days_limit = int(os.getenv("KB_SEARCH_DAYS", str(DEFAULT_DAYS_LIMIT)))

    # cafe_id 기본값
    if cafe_id is None:
        cafe_id = int(os.getenv("KB_CAFE_ID", str(DEFAULT_CAFE_ID)))

    # menu_ids 결정: 직접 지정 > profile > 전체
    effective_menu_ids: Optional[List[int]] = None
    if menu_ids:
        effective_menu_ids = menu_ids
    elif profile and profile in VALID_PROFILES and profile != "main":
        # profile이 지정되면 SSOT에서 해당 프로필의 메뉴 ID 가져오기
        try:
            from kb.menu_ssot import get_menu_ids_by_profile

            effective_menu_ids = get_menu_ids_by_profile(profile)
        except Exception:
            # SSOT 로드 실패 시 필터 없이 진행
            pass

    results: Dict[str, Any] = {"manuals": [], "posts": [], "meta": {}}
    results["meta"]["days_limit"] = days_limit
    results["meta"]["cafe_id"] = cafe_id
    results["meta"]["profile"] = profile
    results["meta"]["menu_ids"] = effective_menu_ids
    results["meta"]["query_dim"] = dim

    with db_session() as s:
        # 매뉴얼 검색 (날짜 제한 없음)
        rows = s.execute(
            text(
                """
                SELECT m.doc_id, m.title, m.summary, m.status, (e.vec <-> (:q)::vector) AS dist
                FROM manual_doc m
                JOIN embeddings e ON e.obj_type='manual' AND e.obj_id=m.doc_id AND e.dim = :d
                ORDER BY dist ASC
                LIMIT :k
                """
            ),
            {"q": qvec, "k": top_k, "d": dim},
        ).mappings().all()
        results["manuals"] = [dict(r) for r in rows]

        # 게시글 검색 (날짜 제한 + cafe_id + menu_ids 필터 적용)
        use_menu_filter = effective_menu_ids is not None and len(effective_menu_ids) > 0

        base_conditions = "p.status='clean' AND p.cafe_id = :cafe_id"
        if days_limit > 0:
            base_conditions += " AND p.created_at >= now() - make_interval(days => :days)"
        if use_menu_filter:
            base_conditions += " AND p.menu_id = ANY(:menu_ids)"

        post_sql = f"""
            SELECT p.post_id, p.menu_id, p.title, p.url, p.created_at,
                   (e.vec <-> (:q)::vector) AS dist
            FROM sources_post p
            JOIN embeddings e ON e.obj_type='post' AND e.obj_id=p.post_id AND e.dim = :d
            WHERE {base_conditions}
            ORDER BY dist ASC
            LIMIT :k
        """

        params = {
            "q": qvec,
            "k": top_k,
            "d": dim,
            "cafe_id": cafe_id,
            "days": days_limit,
        }
        if use_menu_filter:
            params["menu_ids"] = effective_menu_ids

        rows = s.execute(text(post_sql), params).mappings().all()
        posts = [dict(r) for r in rows]

    # dist 컷오프 적용 (과도한 노이즈 제거)
    posts = [p for p in posts if p.get("dist") is not None and p["dist"] <= dist_max]

    # 간단한 키워드 보정: 질의 토큰과 제목에 겹치는 개수로 미세 재정렬 (추측/폴백 아님, deterministic)
    query_terms = {t for t in query.replace(",", " ").split() if t}

    def _score(post: Dict[str, Any]) -> float:
        title = (post.get("title") or "").replace(",", " ")
        overlap = len(query_terms.intersection(title.split()))
        return post.get("dist", 0.0) - 0.05 * overlap  # dist가 낮을수록 좋음

    posts = sorted(posts, key=_score)[:top_k]
    results["posts"] = posts
    results["meta"]["dist_max"] = dist_max

    logger.info(
        "[vector_search] query='%s' dim=%s days=%s manuals=%d posts=%d dist_max=%.3f",
        query,
        dim,
        days_limit,
        len(results["manuals"]),
        len(results["posts"]),
        dist_max,
    )
    return results
