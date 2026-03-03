from __future__ import annotations

import logging
import os
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from kb.db import db_session
from kb.disabled_menus import DISABLED_MENU_IDS
from kb.embed import embed_texts

logger = logging.getLogger("kb.search")

# 기본 설정값
DEFAULT_CAFE_ID = 30819883  # dinohighclass
DEFAULT_DAYS_LIMIT = 180  # 6개월

# 유효한 프로필 목록
VALID_PROFILES = ["main", "free", "paid", "tips", "community"]

_QUERY_STOPWORDS = {
    # 카페/도메인 일반어
    "디하클",
    "카페",
    "공지",
    "공지사항",
    "최신",
    "최근",
    "관련",
    # 질문형/기능어
    "누구",
    "누구야",
    "뭐",
    "뭐야",
    "무엇",
    "어떤",
    "왜",
    "어디",
    "어떻게",
    "방법",
    "정리",
    "설명",
    "알려줘",
    "알려주",
    "좀",
    "대해",
    "대해서",
    # 링크류(질의 키워드로는 유지할 수도 있지만, 기본 토큰에서 너무 자주 나와 노이즈가 큼)
    "url",
    "주소",
}


def _extract_keywords_for_fallback(query: str) -> list[str]:
    q = (query or "").strip()
    if not q:
        return []
    raw = re.findall(r"[A-Za-z0-9가-힣]{2,}", q)
    out: list[str] = []
    seen: set[str] = set()
    for tok in raw:
        t = tok.strip()
        if not t:
            continue
        tl = t.lower()
        if tl in seen:
            continue
        if t in _QUERY_STOPWORDS or tl in _QUERY_STOPWORDS:
            continue
        seen.add(tl)
        out.append(t)
    return out[:6]


def _keyword_fallback_search(
    query: str,
    top_k: int,
    days_limit: int,
    cafe_id: int,
    effective_menu_ids: Optional[List[int]],
) -> Dict[str, Any]:
    """임베딩 생성 실패 시(쿼터/네트워크/키 문제 등) 키워드 기반으로 후보를 뽑는다.

    목적:
    - 테스트/개발 환경에서 외부 임베딩 API가 불가해도 /ask_llm이 500으로 터지지 않게 한다.
    - 최소한의 deterministic 후보(posts/manuals)를 제공해 상위 로직(필터링/결정적 답변)이 동작하게 한다.
    """
    kws = _extract_keywords_for_fallback(query)
    if not kws:
        return {"manuals": [], "posts": [], "meta": {"fallback": "keyword", "error": "no_keywords"}}

    def _mk_like_params(prefix: str, items: list[str]) -> tuple[list[str], dict[str, Any]]:
        conds: list[str] = []
        params: dict[str, Any] = {}
        for i, k in enumerate(items):
            key = f"{prefix}{i}"
            params[key] = f"%{k}%"
            conds.append(key)
        return conds, params

    use_menu_filter = effective_menu_ids is not None and len(effective_menu_ids) > 0

    q_lower = (query or "").lower()
    required_terms: list[str] = []
    # 강한 의도 키워드(다시보기/녹화)가 포함된 경우에는 후보에 반드시 포함되도록 강제한다.
    if "다시보기" in q_lower:
        required_terms.append("다시보기")
    if "녹화" in q_lower:
        required_terms.append("녹화")

    manuals: list[dict[str, Any]] = []
    posts: list[dict[str, Any]] = []
    with db_session() as s:
        # manuals
        cond_keys, mparams = _mk_like_params("m", kws[:6])
        if cond_keys:
            # NOTE:
            # - manual_doc.status는 'published'가 기본값인 경우가 많다.
            # - 요약/정책 숫자(가격/포인트 등)는 body_md에만 존재할 수 있으므로 body_md도 함께 로드한다.
            or_parts = [
                f"(m.title ILIKE :{k} OR COALESCE(m.summary,'') ILIKE :{k} OR COALESCE(m.body_md,'') ILIKE :{k})"
                for k in cond_keys
            ]
            sql = (
                "SELECT m.doc_id, m.title, m.summary, substring(COALESCE(m.body_md,''), 1, 6000) as body_md, m.status, 0.0 as dist "
                "FROM manual_doc m "
                "WHERE (m.status IS NULL OR m.status IN ('clean','published')) AND (" + " OR ".join(or_parts) + ") "
                "LIMIT :k"
            )
            mparams["k"] = max(8, top_k * 3)
            rows = s.execute(text(sql), mparams).mappings().all()
            manuals = [dict(r) for r in rows]

        # posts
        cond_keys, pparams = _mk_like_params("p", kws[:6])
        base_conditions = "p.status='clean' AND p.cafe_id = :cafe_id"
        if days_limit > 0:
            base_conditions += " AND p.created_at >= now() - make_interval(days => :days)"
        if use_menu_filter:
            base_conditions += " AND p.menu_id = ANY(:menu_ids)"
            pparams["menu_ids"] = effective_menu_ids

        # required_terms는 각각 반드시 포함되도록 AND로 강제한다.
        for i, rt in enumerate(required_terms[:2]):
            key = f"r{i}"
            pparams[key] = f"%{rt}%"
            base_conditions += f" AND (p.title ILIKE :{key} OR p.norm_text ILIKE :{key})"

        if cond_keys:
            or_parts = [f"(p.title ILIKE :{k} OR p.norm_text ILIKE :{k})" for k in cond_keys]
            base_conditions += " AND (" + " OR ".join(or_parts) + ")"

        pparams["cafe_id"] = cafe_id
        pparams["days"] = days_limit
        pparams["k"] = max(60, top_k * 12)
        rows = s.execute(
            text(
                f"""
                SELECT p.post_id, p.menu_id, p.title, p.url, p.created_at,
                       substring(p.norm_text, 1, 500) as norm_text,
                       0.0 as dist
                FROM sources_post p
                WHERE {base_conditions}
                ORDER BY p.created_at DESC NULLS LAST, p.post_id DESC
                LIMIT :k
                """
            ),
            pparams,
        ).mappings().all()
        posts = [dict(r) for r in rows]

    # 수집/조회 제외 메뉴는 검색 결과에서 완전히 제거한다.
    if DISABLED_MENU_IDS:
        posts = [p for p in posts if p.get("menu_id") not in DISABLED_MENU_IDS]

    # overlap 점수로 재정렬(완전 deterministic)
    terms = [k.lower() for k in kws[:6] if k]

    def _post_score(p: Dict[str, Any]) -> tuple[int, datetime, int]:
        title = (p.get("title") or "").lower()
        body = (p.get("norm_text") or "").lower()
        score = 0
        for t in terms:
            if t in title:
                score += 3
            elif t in body:
                score += 1
        created_at = p.get("created_at") if isinstance(p.get("created_at"), datetime) else datetime.min
        pid = int(p.get("post_id") or 0)
        return score, created_at, pid

    posts = sorted(posts, key=_post_score, reverse=True)[:top_k]

    def _manual_score(m: Dict[str, Any]) -> int:
        text_ = ((m.get("title") or "") + " " + (m.get("summary") or "")).lower()
        score = 0
        for t in terms:
            if t in text_:
                score += 1
        return score

    manuals = sorted(manuals, key=_manual_score, reverse=True)[:top_k]

    return {
        "manuals": manuals,
        "posts": posts,
        "meta": {
            "fallback": "keyword",
            "fallback_keywords": kws,
            "fallback_required": required_terms,
            "days_limit": days_limit,
            "cafe_id": cafe_id,
            "menu_ids": effective_menu_ids,
        },
    }


def vector_search(
    query: str,
    top_k: int = 6,
    days_limit: Optional[int] = None,
    cafe_id: Optional[int] = None,
    profile: Optional[str] = None,
    menu_ids: Optional[List[int]] = None,
) -> Dict[str, Any]:
    """KB 벡터 검색을 수행한다."""

    # ADR-0007/0014: 벡터 거리 기본 임계값은 1.5를 기준으로 하고,
    # 환경변수 KB_DIST_MAX로만 조정한다. (너무 큰 기본값은 노이즈를 초래함)
    dist_max = float(os.getenv("KB_DIST_MAX", "1.5"))

    try:
        qvec = embed_texts([query])[0]
    except Exception as e:
        logger.warning(f"[vector_search] embed failed; using keyword fallback: {e}")
        # 날짜 제한 결정
        if days_limit is None:
            days_limit = int(os.getenv("KB_SEARCH_DAYS", str(DEFAULT_DAYS_LIMIT)))
        if cafe_id is None:
            cafe_id = int(os.getenv("KB_CAFE_ID", str(DEFAULT_CAFE_ID)))
        # menu_ids 결정: 직접 지정 > profile > 전체
        effective_menu_ids: Optional[List[int]] = None
        if menu_ids:
            effective_menu_ids = menu_ids
        elif profile and profile in VALID_PROFILES and profile != "main":
            try:
                from kb.menu_ssot import get_menu_ids_by_profile

                effective_menu_ids = get_menu_ids_by_profile(profile)
            except Exception:
                effective_menu_ids = None
        return _keyword_fallback_search(
            query=query,
            top_k=top_k,
            days_limit=days_limit,
            cafe_id=cafe_id,
            effective_menu_ids=effective_menu_ids,
        )
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
                SELECT m.doc_id, m.title, m.summary, substring(COALESCE(m.body_md,''), 1, 6000) as body_md, m.status, (e.vec <-> (:q)::vector) AS dist
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
                   substring(p.norm_text, 1, 500) as norm_text,
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

    # 수집/조회 제외 메뉴는 검색 결과에서 완전히 제거한다.
    if DISABLED_MENU_IDS:
        posts = [p for p in posts if p.get("menu_id") not in DISABLED_MENU_IDS]

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
