import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


class SafeRotatingFileHandler(RotatingFileHandler):
    """Windows 환경에서 파일 잠금(WinError 32)로 로깅 자체가 깨지는 것을 방지한다.

    RotatingFileHandler는 rollover 시 rename을 하는데, 다른 프로세스가 로그 파일을 열고 있으면
    Windows에서는 rename이 실패할 수 있다. 이 경우 rollover를 포기하고 같은 파일에 계속 쓴다.
    """

    def doRollover(self) -> None:  # pragma: no cover - OS/상황 의존
        try:
            super().doRollover()
        except OSError as e:
            winerr = getattr(e, "winerror", None)
            if winerr == 32 or isinstance(e, PermissionError):
                try:
                    if self.stream:
                        self.stream.close()
                except Exception:
                    pass
                try:
                    self.stream = self._open()
                except Exception:
                    pass
                return
            raise


def get_logger(name: str = "kb") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    level = os.getenv("KB_LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))

    log_dir = Path("logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    # Windows에서 다중 프로세스가 같은 파일을 rotate하려고 하면 WinError 32가 자주 발생한다.
    # 작업/서비스별로 파일을 분리할 수 있도록 env로 오버라이드한다.
    # 기본값은 'kb.log'로 두고, 서비스는 windows/kb_service.ps1에서 'kb_service.log'로 지정한다.
    log_file = os.getenv("KB_LOG_FILE", "kb.log").strip() or "kb.log"
    log_path = (log_dir / log_file) if not os.path.isabs(log_file) else Path(log_file)
    handler = SafeRotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    handler.setFormatter(fmt)
    logger.addHandler(handler)

    # Also log to stdout in dev
    if os.getenv("KB_LOG_STDOUT", "1") == "1":
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        logger.addHandler(sh)

    return logger
