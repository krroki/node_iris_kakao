"""간단한 KB 검색 헬스체크 스크립트.

사용법:
    python -m scripts.kb_health

전제:
    - PYTHONPATH="." 설정
    - DB/임베딩 준비 완료
    - EMBED_PROVIDER/키 환경변수 설정
"""
from __future__ import annotations

from kb.search import vector_search

SMOKE_QUERIES = [
    "사알못 다시보기 링크",
    "12월 3일 강의 있나",
    "무료특강 일정",
]


def main() -> None:
    for q in SMOKE_QUERIES:
        res = vector_search(q, top_k=3)
        posts = res.get("posts", [])
        print(f"\n[query] {q}")
        for p in posts:
            title = p.get("title")
            dist = p.get("dist")
            url = p.get("url")
            print(f"  - dist={dist:.4f} | {title} | {url}")


if __name__ == "__main__":
    main()
