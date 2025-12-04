import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path


def get_logger(name: str = "kb") -> logging.Logger:
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger

    level = os.getenv("KB_LOG_LEVEL", "INFO").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))

    log_dir = Path("logs")
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / "kb_service.log"
    handler = RotatingFileHandler(log_path, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8")
    fmt = logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s")
    handler.setFormatter(fmt)
    logger.addHandler(handler)

    # Also log to stdout in dev
    if os.getenv("KB_LOG_STDOUT", "1") == "1":
        sh = logging.StreamHandler()
        sh.setFormatter(fmt)
        logger.addHandler(sh)

    return logger

