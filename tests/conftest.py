import os
import sys


def pytest_configure() -> None:
    """테스트 실행 시 레포 루트를 sys.path에 추가해 src 패키지 import가 되도록 한다."""
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

