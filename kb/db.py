import os
import re
from contextlib import contextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy import event

# Prefer psycopg3 ("psycopg") registration; fall back to psycopg2 if needed.
register_vector = None
try:  # psycopg3
    from pgvector.psycopg import register_vector as _register_psycopg  # type: ignore

    def register_vector(dbapi_conn):  # type: ignore
        try:
            _register_psycopg(dbapi_conn)
        except Exception:
            pass
except Exception:
    try:  # psycopg2
        from pgvector.psycopg2 import register_vector as _register_psycopg2  # type: ignore

        def register_vector(dbapi_conn):  # type: ignore
            try:
                _register_psycopg2(dbapi_conn)
            except Exception:
                pass
    except Exception:
        register_vector = None


def _default_db_url() -> str:
    # Default to local pgvector container mapping (host 127.0.0.1:5433)
    # NOTE: SQLAlchemy 1.4 환경에서는 psycopg3(dialect=psycopg)가 로딩되지 않을 수 있어 기본은 psycopg2로 둔다.
    url = (os.getenv("DATABASE_URL") or "").strip()
    if not url:
        return "postgresql+psycopg2://iris:iris@127.0.0.1:5433/iris"

    # 환경/툴에 따라 DATABASE_URL이 postgresql+psycopg(=psycopg3)로 설정되어 들어오는 경우가 있는데,
    # 이 저장소 기본 설치(Windows 스크립트)는 psycopg2-binary를 사용하므로, 드라이버 미설치로 서비스가
    # 죽지 않도록 psycopg2로 안전하게 변환한다.
    url = re.sub(r"^postgresql\\+psycopg://", "postgresql+psycopg2://", url, flags=re.IGNORECASE)
    return url


engine = create_engine(_default_db_url(), pool_pre_ping=True, future=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


@contextmanager
def db_session():
    session = SessionLocal()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


if register_vector is not None:
    @event.listens_for(engine, "connect")
    def _on_connect(dbapi_conn, conn_record):  # type: ignore
        try:
            register_vector(dbapi_conn)
        except Exception:
            pass
