"""구조화된 로깅 시스템"""

import json
import logging
import logging.handlers
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional


class StructuredFormatter(logging.Formatter):
    """구조화된 JSON 로그 포매터"""

    def format(self, record: logging.LogRecord) -> str:
        """로그 레코드를 JSON 형식으로 포맷팅"""
        # 기본 로그 정보
        log_data = {
            "timestamp": datetime.fromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "module": record.module,
            "function": record.funcName,
            "line": record.lineno,
            "thread": record.thread,
            "process": record.process
        }

        # 예외 정보 추가
        if record.exc_info:
            log_data["exception"] = self.formatException(record.exc_info)

        # 추가 필드가 있는 경우
        if hasattr(record, 'extra_fields'):
            log_data.update(record.extra_fields)

        # 서비스 관련 필드가 있는 경우
        if hasattr(record, 'service_fields'):
            log_data.update(record.service_fields)

        return json.dumps(log_data, ensure_ascii=False, separators=(',', ':'))


class StructuredLogger:
    """구조화된 로거"""

    def __init__(self, name: str, log_dir: str = "logs", service: str = None):
        self.logger = logging.getLogger(name)
        self.log_dir = Path(log_dir)
        self.service = service or name
        self._setup_logger()

    def log(self, level: int, message: str, extra: dict = None):
        """로깅 메서드"""
        try:
            if extra:
                self.logger.log(level, message, extra=extra)
            else:
                self.logger.log(level, message)
        except:
            # 실패시 기본 로거 사용
            logging.log(level, message)

    def _setup_logger(self) -> None:
        """로거 설정"""
        # 로그 레벨 설정
        self.logger.setLevel(logging.DEBUG)

        # 기존 핸들러 제거
        self.logger.handlers.clear()

        # 콘솔 핸들러 (간단한 포맷)
        console_handler = logging.StreamHandler(sys.stdout)
        console_formatter = logging.Formatter(
            '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
        )
        console_handler.setFormatter(console_formatter)
        console_handler.setLevel(logging.INFO)
        self.logger.addHandler(console_handler)

        # 파일 핸들러 (구조화된 JSON 포맷)
        log_file = self.log_dir / f"{self.service}.log"
        file_handler = logging.handlers.RotatingFileHandler(
            log_file,
            maxBytes=50 * 1024 * 1024,  # 50MB
            backupCount=10,
            encoding='utf-8'
        )
        file_handler.setFormatter(StructuredFormatter())
        file_handler.setLevel(logging.DEBUG)
        self.logger.addHandler(file_handler)

        # 에러 전용 핸들러
        error_log_file = self.log_dir / f"{self.service}_error.log"
        error_handler = logging.handlers.RotatingFileHandler(
            error_log_file,
            maxBytes=10 * 1024 * 1024,  # 10MB
            backupCount=5,
            encoding='utf-8'
        )
        error_handler.setFormatter(StructuredFormatter())
        error_handler.setLevel(logging.ERROR)
        self.logger.addHandler(error_handler)

        # 디렉터리 생성
        self.log_dir.mkdir(exist_ok=True)

    def _log_with_extra(self, level: int, message: str, **kwargs):
        """추가 필드와 함께 로그 기록"""
        extra = {'extra_fields': kwargs} if kwargs else {}
        self.logger.log(level, message, extra=extra)

    def debug(self, message: str, **kwargs):
        """DEBUG 레벨 로그"""
        self._log_with_extra(logging.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs):
        """INFO 레벨 로그"""
        self._log_with_extra(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs):
        """WARNING 레벨 로그"""
        self._log_with_extra(logging.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs):
        """ERROR 레벨 로그"""
        self._log_with_extra(logging.ERROR, message, **kwargs)

    def critical(self, message: str, **kwargs):
        """CRITICAL 레벨 로그"""
        self._log_with_extra(logging.CRITICAL, message, **kwargs)


class ServiceLogger:
    """서비스별 로거 - 특정 서비스에 특화된 로깅"""

    def __init__(self, service_name: str, log_dir: str = "logs"):
        self.logger = StructuredLogger(f"service.{service_name}", log_dir, service_name)
        self.service_name = service_name

    def _log_with_extra(self, level: int, message: str, **kwargs):
        """추가 필드와 함께 로그 기록"""
        extra = {'extra_fields': kwargs} if kwargs else {}
        self.logger.log(level, message, extra=extra)

    def debug(self, message: str, **kwargs):
        """DEBUG 레벨 로그"""
        self._log_with_extra(logging.DEBUG, message, **kwargs)

    def info(self, message: str, **kwargs):
        """INFO 레벨 로그"""
        self._log_with_extra(logging.INFO, message, **kwargs)

    def warning(self, message: str, **kwargs):
        """WARNING 레벨 로그"""
        self._log_with_extra(logging.WARNING, message, **kwargs)

    def error(self, message: str, **kwargs):
        """ERROR 레벨 로그"""
        self._log_with_extra(logging.ERROR, message, **kwargs)

    def critical(self, message: str, **kwargs):
        """CRITICAL 레벨 로그"""
        self._log_with_extra(logging.CRITICAL, message, **kwargs)

    def log_event(self, event_type: str, room_id: str = None, user_id: str = None, **kwargs):
        """이벤트 로그 기록"""
        event_data = {
            "event_type": event_type,
            "service": self.service_name
        }

        if room_id:
            event_data["room_id"] = room_id
        if user_id:
            event_data["user_id"] = user_id

        event_data.update(kwargs)
        self.logger.info(f"Event: {event_type}", **event_data)

    def log_performance(self, operation: str, duration_ms: float, **kwargs):
        """성능 로그 기록"""
        perf_data = {
            "operation": operation,
            "duration_ms": duration_ms,
            "service": self.service_name
        }
        perf_data.update(kwargs)
        self.logger.info(f"Performance: {operation}", **perf_data)

    def log_error_with_context(self, error: Exception, context: Dict[str, Any] = None):
        """컨텍스트와 함께 에러 로그 기록"""
        error_data = {
            "error_type": type(error).__name__,
            "error_message": str(error),
            "service": self.service_name
        }

        if context:
            error_data["context"] = context

        self.logger.error(f"Error in {self.service_name}", **error_data)


# 로거 팩토리
def get_logger(name: str, service: str = None) -> StructuredLogger:
    """로거 인스턴스 생성"""
    return StructuredLogger(name, service=service)


def get_service_logger(service_name: str) -> ServiceLogger:
    """서비스 로거 인스턴스 생성"""
    return ServiceLogger(service_name)


# 전역 로거 설정
def setup_global_logging(log_level: str = "INFO", log_dir: str = "logs"):
    """전역 로깅 시스템 설정"""
    log_dir = Path(log_dir)
    log_dir.mkdir(exist_ok=True)

    # 루트 로거 설정
    root_logger = logging.getLogger()
    root_logger.setLevel(getattr(logging, log_level.upper()))

    # 기존 핸들러 제거
    root_logger.handlers.clear()

    # 콘솔 핸들러
    console_handler = logging.StreamHandler(sys.stdout)
    console_formatter = logging.Formatter(
        '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )
    console_handler.setFormatter(console_formatter)
    root_logger.addHandler(console_handler)

    # 파일 핸들러
    log_file = log_dir / "app.log"
    file_handler = logging.handlers.RotatingFileHandler(
        log_file,
        maxBytes=100 * 1024 * 1024,  # 100MB
        backupCount=10,
        encoding='utf-8'
    )
    file_handler.setFormatter(StructuredFormatter())
    root_logger.addHandler(file_handler)


# 로그 데코레이터
def log_execution_time(logger: ServiceLogger = None):
    """함수 실행 시간 로깅 데코레이터"""
    def decorator(func):
        def wrapper(*args, **kwargs):
            start_time = time.time()
            function_name = f"{func.__module__}.{func.__name__}"

            try:
                result = func(*args, **kwargs)
                duration_ms = (time.time() - start_time) * 1000

                if logger:
                    logger.log_performance(
                        operation=function_name,
                        duration_ms=duration_ms,
                        status="success"
                    )
                return result

            except Exception as e:
                duration_ms = (time.time() - start_time) * 1000

                if logger:
                    logger.log_error_with_context(
                        error=e,
                        context={
                            "function": function_name,
                            "duration_ms": duration_ms,
                            "args": str(args)[:200],
                            "kwargs": str(kwargs)[:200]
                        }
                    )
                raise

        return wrapper
    return decorator


# 로그 검증기
class LogValidator:
    """로그 형식 검증기"""

    @staticmethod
    def validate_json_log(log_line: str) -> bool:
        """JSON 로그 형식 검증"""
        try:
            log_data = json.loads(log_line)
            required_fields = ["timestamp", "level", "logger", "message"]
            return all(field in log_data for field in required_fields)
        except (json.JSONDecodeError, TypeError):
            return False

    @staticmethod
    def validate_log_file(file_path: Path) -> Dict[str, Any]:
        """로그 파일 검증"""
        if not file_path.exists():
            return {"valid": False, "error": "File does not exist"}

        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()

            total_lines = len(lines)
            valid_lines = 0
            invalid_lines = 0

            for line in lines:
                line = line.strip()
                if not line:
                    continue
                if LogValidator.validate_json_log(line):
                    valid_lines += 1
                else:
                    invalid_lines += 1

            return {
                "valid": invalid_lines == 0,
                "total_lines": total_lines,
                "valid_lines": valid_lines,
                "invalid_lines": invalid_lines,
                "validity_rate": (valid_lines / total_lines * 100) if total_lines > 0 else 0
            }

        except Exception as e:
            return {"valid": False, "error": str(e)}


if __name__ == "__main__":
    # 로깅 시스템 테스트
    setup_global_logging("DEBUG")

    logger = get_logger("test_logger")
    service_logger = get_service_logger("test_service")

    logger.info("테스트 로그 메시지", test_field="test_value")
    service_logger.log_event("test_event", room_id="123", user_id="456")
    service_logger.log_performance("test_operation", 150.5, status="success")

    print("✅ 로깅 시스템 테스트 완료")