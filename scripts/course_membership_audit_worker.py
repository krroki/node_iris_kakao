#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path


def main() -> int:
    scripts_dir = Path(__file__).resolve().parent
    sys.path.insert(0, str(scripts_dir))

    from course_membership_audit.worker import main as _main  # type: ignore

    return int(_main())


if __name__ == "__main__":
    raise SystemExit(main())
