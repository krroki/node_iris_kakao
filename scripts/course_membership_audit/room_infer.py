from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass(frozen=True)
class InferredRoom:
    room_id: str
    room_name: str
    room_type: str  # chat | notice | premium
    course_key: str


_PREFIXES: list[tuple[str, str]] = [
    ("chat", "(사담방)"),
    ("notice", "(공지방)"),
    ("premium", "(프리미엄방)"),
]


def infer_room_type_and_course_key(room_name: str) -> Tuple[Optional[str], Optional[str]]:
    name = str(room_name or "").strip()
    if not name:
        return None, None
    for room_type, prefix in _PREFIXES:
        if name.startswith(prefix):
            base = name[len(prefix) :].strip()
            if not base:
                return None, None
            return room_type, base
    return None, None

