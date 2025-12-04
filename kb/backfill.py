"""KB 백필 모듈 (ADR-0006)

서비스 중단 후 공백 기간의 게시글을 자동으로 수집한다.
kb_cursor 테이블을 기준으로 마지막 수집 시점부터 현재까지의 글을 채운다.

Invariants:
- 동일 (profile, menu_id)에 대해 백필은 한 번에 하나만 실행
- 에러 발생 시 cursor 롤백하지 않음 (idempotent 재시도)
- 최대 max_days, max_pages 제한
"""

from __future__ import annotations

import datetime as dt
from typing import Dict, Any, List, Optional, Literal

from sqlalchemy import text

from kb.db import db_session
from kb.profile_config import (
    ProfileName,
    VALID_PROFILES,
    get_profile,
    get_backfill_config,
    get_menu_ids,
    get_cafe_id,
    post_table,
)
from kb.cafe_api import list_articles, get_article
from kb.normalize import html_to_text
from kb.jobs import start, finish
from kb.logging_util import get_logger

log = get_logger("kb.backfill")


class BackfillResult:
    def __init__(self):
        self.kept = 0
        self.skipped = 0
        self.known = 0
        self.errors = 0
        self.menus_processed = 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "kept": self.kept,
            "skipped": self.skipped,
            "known": self.known,
            "errors": self.errors,
            "menus_processed": self.menus_processed,
        }


def get_cursor(profile: ProfileName, cafe_id: int, menu_id: int) -> Optional[Dict[str, Any]]:
    """특정 프로필/메뉴의 커서 조회"""
    with db_session() as s:
        row = s.execute(
            text("""
                SELECT id, profile, cafe_id, menu_id, last_post_id, last_created_at, updated_at
                FROM kb_cursor
                WHERE profile = :profile AND cafe_id = :cafe_id AND menu_id = :menu_id
            """),
            {"profile": profile, "cafe_id": cafe_id, "menu_id": menu_id}
        ).mappings().first()
        return dict(row) if row else None


def get_cursors(profile: ProfileName) -> List[Dict[str, Any]]:
    """프로필의 모든 커서 조회"""
    cafe_id = get_cafe_id(profile)
    with db_session() as s:
        rows = s.execute(
            text("""
                SELECT id, profile, cafe_id, menu_id, last_post_id, last_created_at, updated_at
                FROM kb_cursor
                WHERE profile = :profile AND cafe_id = :cafe_id
                ORDER BY menu_id
            """),
            {"profile": profile, "cafe_id": cafe_id}
        ).mappings().all()
        return [dict(r) for r in rows]


def upsert_cursor(
    profile: ProfileName,
    cafe_id: int,
    menu_id: int,
    last_post_id: int,
    last_created_at: Optional[dt.datetime]
):
    """커서 upsert"""
    with db_session() as s:
        s.execute(
            text("""
                INSERT INTO kb_cursor (profile, cafe_id, menu_id, last_post_id, last_created_at, updated_at)
                VALUES (:profile, :cafe_id, :menu_id, :last_post_id, :last_created_at, NOW())
                ON CONFLICT (profile, cafe_id, menu_id)
                DO UPDATE SET
                    last_post_id = GREATEST(kb_cursor.last_post_id, EXCLUDED.last_post_id),
                    last_created_at = GREATEST(kb_cursor.last_created_at, EXCLUDED.last_created_at),
                    updated_at = NOW()
            """),
            {
                "profile": profile,
                "cafe_id": cafe_id,
                "menu_id": menu_id,
                "last_post_id": last_post_id,
                "last_created_at": last_created_at,
            }
        )


def init_cursors_for_profile(profile: ProfileName):
    """프로필의 모든 메뉴에 대해 커서 초기화 (없으면 생성)"""
    menu_ids = get_menu_ids(profile)
    cafe_id = get_cafe_id(profile)

    if not menu_ids:
        log.warning(f"[{profile}] No menu_ids configured, skipping cursor init")
        return

    with db_session() as s:
        for menu_id in menu_ids:
            s.execute(
                text("""
                    INSERT INTO kb_cursor (profile, cafe_id, menu_id, last_post_id, last_created_at, updated_at)
                    VALUES (:profile, :cafe_id, :menu_id, NULL, NULL, NOW())
                    ON CONFLICT (profile, cafe_id, menu_id) DO NOTHING
                """),
                {"profile": profile, "cafe_id": cafe_id, "menu_id": menu_id}
            )
    log.info(f"[{profile}] Initialized cursors for {len(menu_ids)} menus")


def check_gap(profile: ProfileName) -> Dict[str, Any]:
    """프로필의 백필 필요 여부 체크

    Returns:
        {
            "needs_backfill": bool,
            "gap_days": int,  # 가장 오래 방치된 메뉴 기준
            "oldest_cursor_at": datetime | None,  # 가장 오래된 cursor 시점
            "newest_cursor_at": datetime | None,  # 가장 최근 cursor 시점
            "menus_without_cursor": List[int],
        }
    """
    menu_ids = get_menu_ids(profile)
    cursors = get_cursors(profile)

    cursor_menus = {c["menu_id"] for c in cursors}
    menus_without_cursor = [m for m in menu_ids if m not in cursor_menus]

    if not cursors:
        return {
            "needs_backfill": bool(menu_ids),
            "gap_days": None,
            "oldest_cursor_at": None,
            "newest_cursor_at": None,
            "menus_without_cursor": menus_without_cursor,
        }

    # 가장 오래된/최신 last_created_at 기준
    oldest = None
    newest = None
    for c in cursors:
        ts = c.get("last_created_at")
        if ts:
            if oldest is None or ts < oldest:
                oldest = ts
            if newest is None or ts > newest:
                newest = ts

    if oldest is None:
        return {
            "needs_backfill": True,
            "gap_days": None,
            "oldest_cursor_at": None,
            "newest_cursor_at": None,
            "menus_without_cursor": menus_without_cursor,
        }

    now = dt.datetime.now(dt.timezone.utc)
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=dt.timezone.utc)
    if newest and newest.tzinfo is None:
        newest = newest.replace(tzinfo=dt.timezone.utc)

    gap_days = (now - oldest).days

    return {
        "needs_backfill": gap_days >= 1 or len(menus_without_cursor) > 0,
        "gap_days": gap_days,
        "oldest_cursor_at": oldest.isoformat(),
        "newest_cursor_at": newest.isoformat() if newest else None,
        "menus_without_cursor": menus_without_cursor,
    }


def is_backfill_running(profile: ProfileName) -> bool:
    """job_log에서 해당 프로필 백필이 실행 중인지 확인 (Invariant #6)

    TODO: payload::text LIKE 대신 payload->>'profile' = :profile 로 변경 권장
          (현재는 동작하지만, payload 구조 변경 시 깨질 수 있음)
    """
    with db_session() as s:
        row = s.execute(
            text("""
                SELECT job_id FROM job_log
                WHERE job_type = 'backfill'
                  AND status = 'running'
                  AND payload::text LIKE :pattern
                ORDER BY started_at DESC
                LIMIT 1
            """),
            {"pattern": f'%"profile": "{profile}"%'}
        ).first()
        return row is not None


def _upsert_post(profile: ProfileName, cafe_id: int, menu_id: int,
                 post_id: int, url: str, title: str, html: str,
                 created_at: Optional[dt.datetime]):
    """프로필 테이블에 게시글 upsert"""
    table = post_table(profile)
    norm = html_to_text(html) if html else ""

    with db_session() as s:
        s.execute(
            text(f"""
                INSERT INTO {table} (post_id, cafe_id, menu_id, url, title, html, norm_text, created_at, status, last_crawled_at)
                VALUES (:post_id, :cafe_id, :menu_id, :url, :title, :html, :norm_text, :created_at, 'clean', NOW())
                ON CONFLICT (post_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    html = EXCLUDED.html,
                    norm_text = EXCLUDED.norm_text,
                    last_crawled_at = NOW()
            """),
            {
                "post_id": post_id,
                "cafe_id": cafe_id,
                "menu_id": menu_id,
                "url": url,
                "title": title,
                "html": html,
                "norm_text": norm,
                "created_at": created_at,
            }
        )


def _get_max_post_id(profile: ProfileName, menu_id: int) -> int:
    """프로필 테이블에서 해당 메뉴의 최대 post_id"""
    table = post_table(profile)
    with db_session() as s:
        row = s.execute(
            text(f"SELECT COALESCE(MAX(post_id), 0) FROM {table} WHERE menu_id = :menu_id"),
            {"menu_id": menu_id}
        ).scalar()
        return int(row or 0)


def backfill(
    profile: ProfileName,
    max_days: Optional[int] = None,
    max_pages: Optional[int] = None
) -> BackfillResult:
    """프로필에 대해 백필 실행

    Args:
        profile: 대상 프로필 ('main', 'free', 'paid')
        max_days: 최대 백필 기간 (기본값: profiles.yaml에서 로드)
        max_pages: 최대 페이지 수 (기본값: profiles.yaml에서 로드)

    Returns:
        BackfillResult
    """
    if profile not in VALID_PROFILES:
        raise ValueError(f"Invalid profile: {profile}")

    # 동시 백필 방지 (Invariant #6)
    if is_backfill_running(profile):
        log.warning(f"[{profile}] Backfill already running, skipping")
        result = BackfillResult()
        result.skipped = -1  # 스킵 표시
        return result

    cfg = get_backfill_config()
    max_days = max_days or cfg.get("max_days", 30)
    max_pages = max_pages or cfg.get("max_pages", 50)

    cafe_id = get_cafe_id(profile)
    menu_ids = get_menu_ids(profile)

    if not menu_ids:
        log.warning(f"[{profile}] No menu_ids configured")
        return BackfillResult()

    # 커서 초기화
    init_cursors_for_profile(profile)

    # job 시작
    job_id = start("backfill", {"profile": profile, "max_days": max_days, "max_pages": max_pages})
    result = BackfillResult()

    try:
        cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=max_days)

        for menu_id in menu_ids:
            cursor = get_cursor(profile, cafe_id, menu_id)
            last_post_id = cursor.get("last_post_id") if cursor else None
            last_created = cursor.get("last_created_at") if cursor else None

            # 테이블에서 최대 post_id도 확인 (idempotent)
            max_known = _get_max_post_id(profile, menu_id)
            if last_post_id:
                max_known = max(max_known, last_post_id)

            log.info(f"[{profile}] Backfilling menu={menu_id}, max_known={max_known}, last_created={last_created}")

            newest_post_id = max_known
            newest_created = last_created

            for page in range(1, max_pages + 1):
                try:
                    arts = list_articles(menu_id=menu_id, page=page, per_page=50)
                except Exception as e:
                    log.error(f"[{profile}] list_articles failed menu={menu_id} page={page}: {e}")
                    result.errors += 1
                    break

                if not arts:
                    break

                reached_old = False
                for a in arts:
                    aid = a.get("articleId") or a.get("articleIdLong") or a.get("articleIdStr")
                    if not aid:
                        continue

                    try:
                        aid_int = int(aid)
                    except Exception:
                        continue

                    # 이미 수집한 글이면 스킵
                    if max_known and aid_int <= max_known:
                        result.known += 1
                        reached_old = True
                        continue

                    # 상세 조회
                    try:
                        detail = get_article(aid_int)
                        article = detail.get("result", {}).get("article") or detail.get("article") or {}
                        html = article.get("contentHtml") or article.get("content") or ""
                        title = a.get("subject") or a.get("title") or ""
                        url = a.get("permalink") or a.get("articleUrl") or f"https://cafe.naver.com/{aid}"

                        # 작성일 파싱
                        ts = a.get("writeDateTimestamp") or a.get("regDateTimestamp")
                        created_at = None
                        if ts:
                            try:
                                t = int(ts)
                                if t < 10_000_000_000:
                                    t = t * 1000
                                created_at = dt.datetime.fromtimestamp(t / 1000.0, tz=dt.timezone.utc)
                            except Exception:
                                pass

                        # cutoff 이전 글은 무시
                        if created_at and created_at < cutoff:
                            reached_old = True
                            continue

                        _upsert_post(profile, cafe_id, menu_id, aid_int, url, title, html, created_at)
                        result.kept += 1

                        # 커서 업데이트용 최신 값 추적
                        if aid_int > newest_post_id:
                            newest_post_id = aid_int
                        if created_at and (newest_created is None or created_at > newest_created):
                            newest_created = created_at

                    except Exception as e:
                        log.error(f"[{profile}] get_article failed aid={aid_int}: {e}")
                        result.errors += 1
                        result.skipped += 1

                if reached_old:
                    break

            # 커서 업데이트
            if newest_post_id > (max_known or 0):
                upsert_cursor(profile, cafe_id, menu_id, newest_post_id, newest_created)

            result.menus_processed += 1

        finish(job_id, "done", result.to_dict())
        log.info(f"[{profile}] Backfill done: {result.to_dict()}")

    except Exception as e:
        log.exception(f"[{profile}] Backfill failed: {e}")
        finish(job_id, "error", {"error": str(e)})
        raise

    return result


def backfill_all_profiles() -> Dict[ProfileName, BackfillResult]:
    """모든 프로필에 대해 백필 실행"""
    results = {}
    for profile in VALID_PROFILES:
        try:
            results[profile] = backfill(profile)
        except Exception as e:
            log.error(f"[{profile}] Backfill failed: {e}")
            r = BackfillResult()
            r.errors = -1
            results[profile] = r
    return results


def main():
    """CLI 진입점"""
    import sys
    profile = sys.argv[1] if len(sys.argv) > 1 else "main"
    if profile == "all":
        results = backfill_all_profiles()
        for p, r in results.items():
            print(f"[{p}] {r.to_dict()}")
    else:
        if profile not in VALID_PROFILES:
            print(f"Invalid profile: {profile}. Valid: {VALID_PROFILES}")
            sys.exit(1)
        result = backfill(profile)  # type: ignore
        print(f"[{profile}] {result.to_dict()}")


if __name__ == "__main__":
    main()
