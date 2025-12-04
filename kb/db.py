import os
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
    return os.getenv("DATABASE_URL", "postgresql+psycopg://iris:iris@127.0.0.1:5433/iris")


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
