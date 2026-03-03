#!/usr/bin/env python3
"""KB 마이그레이션 실행 스크립트 (ADR-0006)

주의: 이 스크립트는 DDL(CREATE TABLE, CREATE INDEX 등) 전용입니다.
세미콜론(;) 기준으로 SQL 문을 분리하므로, 프로시저/함수 정의처럼
본문에 세미콜론이 포함된 SQL은 별도 처리가 필요합니다.
"""

import os
import sys
from pathlib import Path

# kb 모듈 import를 위해 상위 경로 추가
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from kb.db import db_session
from sqlalchemy import text


def run_migrations():
    migrations_dir = Path(__file__).parent
    sql_files = sorted(migrations_dir.glob("*.sql"))

    if not sql_files:
        print("No migration files found")
        return

    print(f"Found {len(sql_files)} migration file(s)")

    with db_session() as session:
        for sql_file in sql_files:
            print(f"Running {sql_file.name}...")
            sql = sql_file.read_text(encoding="utf-8")

            # 여러 SQL 문 분리 실행
            statements = [s.strip() for s in sql.split(";") if s.strip() and not s.strip().startswith("--")]

            for stmt in statements:
                if not stmt:
                    continue
                try:
                    session.execute(text(stmt))
                except Exception as e:
                    # 이미 존재하는 경우 무시 (IF NOT EXISTS)
                    if "already exists" in str(e).lower():
                        print(f"  (skipped - already exists)")
                    else:
                        print(f"  Error: {e}")
                        raise

            print(f"  Done: {sql_file.name}")

    print("All migrations completed!")


if __name__ == "__main__":
    run_migrations()
