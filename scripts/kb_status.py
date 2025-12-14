#!/usr/bin/env python3
"""
KB 시스템 상태 모니터링 스크립트 (Phase 4)

실행:
    python scripts/kb_status.py
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from kb.db import db_session
from sqlalchemy import text


def print_header(title: str):
    print(f"\n{'=' * 60}")
    print(f"  {title}")
    print(f"{'=' * 60}")


def check_counts():
    """기본 통계"""
    print_header("📊 기본 통계")
    with db_session() as s:
        posts = s.execute(text("SELECT count(*) FROM sources_post WHERE status='clean'")).scalar() or 0
        emb_posts = s.execute(text("SELECT count(*) FROM embeddings WHERE obj_type='post'")).scalar() or 0
        manuals = s.execute(text("SELECT count(*) FROM manual_doc")).scalar() or 0
        emb_manuals = s.execute(text("SELECT count(*) FROM embeddings WHERE obj_type='manual'")).scalar() or 0

    emb_posts_status = "✅" if posts == emb_posts else f"⚠️ {posts - emb_posts}개 누락"
    emb_manuals_status = "✅" if manuals == emb_manuals else f"⚠️ {manuals - emb_manuals}개 누락"

    print(f"  포스트:     {posts:>6}개  (임베딩: {emb_posts}) {emb_posts_status}")
    print(f"  매뉴얼:     {manuals:>6}개  (임베딩: {emb_manuals}) {emb_manuals_status}")


def check_menu_stats():
    """게시판별 수집 현황"""
    print_header("📋 게시판별 수집 현황")

    from kb.menu_ssot import load_ssot, get_menu_ids_by_profile

    ssot = load_ssot()
    menus = {m["menu_id"]: m["name"] for m in ssot.get("menus", [])}
    collect_menu_ids = [m["menu_id"] for m in ssot.get("menus", []) if m.get("collect")]

    with db_session() as s:
        rows = s.execute(text("""
            SELECT menu_id, count(*) as cnt, max(created_at) as newest
            FROM sources_post
            WHERE status='clean' AND menu_id = ANY(:ids)
            GROUP BY menu_id
            ORDER BY menu_id
        """), {"ids": collect_menu_ids}).fetchall()

    row_by_menu = {int(r[0]): (int(r[1] or 0), r[2]) for r in rows}

    now = datetime.now(timezone.utc)
    # SSOT collect=true 메뉴 전체를 표시(0개 포함)해서 누락/권한 문제를 쉽게 파악한다.
    for menu_id in collect_menu_ids:
        cnt, newest = row_by_menu.get(int(menu_id), (0, None))
        menu_name = menus.get(menu_id, f"#{menu_id}")[:25]
        gap = -1
        if newest:
            # timezone-naive datetime 처리
            if newest.tzinfo is None:
                newest = newest.replace(tzinfo=timezone.utc)
            gap = (now - newest).days
        gap_status = "🟢" if gap == 0 else "🟡" if gap <= 2 else "🔴"
        gap_str = "오늘" if gap == 0 else f"{gap}일 전" if gap > 0 else "?"
        print(f"  {menu_id:>3} {menu_name:<26} {cnt:>4}개  최근: {gap_str:<8} {gap_status}")


def check_dist_stats():
    """벡터 거리 분포"""
    print_header("📐 벡터 거리 분포 (최근 검색)")

    with db_session() as s:
        # 임베딩 벡터 간 거리 샘플링 (무작위 10쌍)
        rows = s.execute(text("""
            SELECT
                (e1.vec <-> e2.vec) as dist
            FROM embeddings e1
            CROSS JOIN LATERAL (
                SELECT vec FROM embeddings
                WHERE obj_type = 'post' AND obj_id != e1.obj_id
                ORDER BY random() LIMIT 1
            ) e2
            WHERE e1.obj_type = 'post'
            LIMIT 100
        """)).fetchall()

    if rows:
        dists = [r[0] for r in rows]
        print(f"  샘플 100쌍 거리 통계:")
        print(f"    최소: {min(dists):.3f}")
        print(f"    최대: {max(dists):.3f}")
        print(f"    평균: {sum(dists)/len(dists):.3f}")
    else:
        print("  (데이터 없음)")

    # KB_DIST_MAX 설정값
    dist_max = float(os.getenv("KB_DIST_MAX", "1.5"))
    print(f"\n  현재 KB_DIST_MAX: {dist_max}")


def check_jobs():
    """최근 작업 이력"""
    print_header("🔧 최근 작업 이력")

    with db_session() as s:
        rows = s.execute(text("""
            SELECT job_type, status, started_at, finished_at, result
            FROM job_log
            ORDER BY started_at DESC
            LIMIT 10
        """)).mappings().all()

    if not rows:
        print("  (작업 이력 없음)")
        return

    for r in rows:
        job_type = r["job_type"]
        status = r["status"]
        started = r["started_at"].strftime("%m-%d %H:%M") if r["started_at"] else "?"
        status_icon = "✅" if status == "done" else "🔄" if status == "running" else "❌"
        result_summary = ""
        if r.get("result"):
            res = r["result"]
            if isinstance(res, dict):
                if res.get("new_count") is not None:
                    result_summary = f"+{res['new_count']}"
                elif res.get("error"):
                    result_summary = f"err: {res['error'][:20]}"
        print(f"  {status_icon} {job_type:<10} {started}  {result_summary}")


def check_schedule():
    """스케줄 상태"""
    print_header("⏰ 스케줄 상태")

    import requests
    from datetime import datetime, timezone

    try:
        r = requests.get("http://127.0.0.1:8610/schedule", timeout=3)
        j = r.json()
        if j.get("ok") and j.get("schedule"):
            for task, cfg in j["schedule"].items():
                interval = cfg.get("interval_minutes", 0)
                status = f"매 {interval}분" if interval > 0 else "중지"
                next_run = cfg.get("next", "-")
                next_run_disp = "-"
                if next_run and next_run != "-":
                    # KB 서비스는 UTC(Z)로 내려준다.
                    try:
                        dt_utc = datetime.fromisoformat(str(next_run).replace("Z", "+00:00")).astimezone(timezone.utc)
                        dt_local = dt_utc.astimezone()
                        next_run_disp = f"{dt_local.strftime('%Y-%m-%d %H:%M:%S %Z')} (UTC {dt_utc.strftime('%H:%M:%S')})"
                    except Exception:
                        next_run_disp = str(next_run).replace("T", " ")[:19]
                print(f"  {task:<10} {status:<12} 다음: {next_run_disp}")
    except Exception as e:
        print(f"  (KB 서비스 연결 실패: {e})")


def main():
    print(f"\n🔍 KB 시스템 상태 ({datetime.now().strftime('%Y-%m-%d %H:%M:%S')})")

    check_counts()
    check_menu_stats()
    check_dist_stats()
    check_jobs()
    check_schedule()

    print("\n" + "=" * 60)
    print("  상태 확인 완료")
    print("=" * 60 + "\n")


if __name__ == "__main__":
    main()
