"""Manualization pipeline skeleton: turn posts into manual docs.

Algorithm outline:
- select candidate posts (filtered, recent)
- cluster by topic (TODO)
- generate/update manual docs with LLM
"""
from __future__ import annotations

from sqlalchemy import text
from kb.db import db_session
from kb.jobs import start, finish


def create_sample_manual():
    with db_session() as s:
        s.execute(text(
            """
            INSERT INTO manual_doc (title, body_md, summary, status)
            VALUES (:title, :body, :summary, 'draft')
            ON CONFLICT DO NOTHING
            """
        ), {
            "title": "운영 정책 샘플",
            "body": "## 개요\n- 공지 고정 운영 샘플\n\n## 체크리스트\n- 평일 18:00 예약\n- 배너 A/B 2주 시험",
            "summary": "카페 가이드 샘플: 공지 고정 운영",
        })


def main():
    jid = start("manualize")
    try:
        create_sample_manual()
        finish(jid, "done", {"created": 1})
        print("[manualize] sample manual created/kept")
    except Exception as e:  # pragma: no cover
        finish(jid, "error", {"error": str(e)})
        raise


if __name__ == "__main__":
    main()

