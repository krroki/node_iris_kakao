from __future__ import annotations

# 수집/조회에서 완전히 제외할 게시판(메뉴) 목록
#
# - 운영 정책상 "KB에 비어 있는 게시판"은 수집/조회 모두 막아 불필요한 호출/혼선을 방지한다.
# - 여기의 메뉴는 ingest/vector_search/recent_posts 등 모든 경로에서 공통으로 제외된다.
DISABLED_MENU_IDS: dict[int, str] = {
    172: "강사들의 꿀팁(현재 수집/조회 제외)",
}

