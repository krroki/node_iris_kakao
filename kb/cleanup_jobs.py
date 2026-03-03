from kb.db import db_session
from sqlalchemy import text


def cleanup_stale_running(max_minutes: int = 60) -> int:
  """
  status='running' 인 잡 중에서 오래된 것들을 'failed'로 정리한다.
  기본 기준: started_at 이 현재 시각 - max_minutes 분보다 이전인 것.
  """
  with db_session() as s:
    res = s.execute(
      text(
        """
        UPDATE job_log
        SET status = 'failed',
            finished_at = NOW(),
            result = COALESCE(result, '') || '; stale_running_cleanup'
        WHERE status = 'running'
          AND started_at < NOW() - (:mins || ' minutes')::interval
        """
      ),
      {"mins": max_minutes},
    )
    s.commit()
    return res.rowcount


def main() -> None:
  count = cleanup_stale_running(60)
  print(f"cleaned {count} stale running jobs")


if __name__ == "__main__":
  main()

