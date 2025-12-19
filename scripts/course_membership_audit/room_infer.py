from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Optional, Tuple


@dataclass(frozen=True)
class InferredRoom:
    room_id: str
    room_name: str
    room_type: str  # chat | notice | premium
    course_key: str


_PREFIX_RE = re.compile(r"^(?:\d+\.)?\s*(?:\(([^)]+)\)|\[([^\]]+)\])\s*(.+)$")


def infer_room_type_and_course_key(room_name: str) -> Tuple[Optional[str], Optional[str]]:
    name = str(room_name or "").strip()
    if not name:
        return None, None
    m = _PREFIX_RE.match(name)
    if not m:
        return None, None
    prefix = str(m.group(1) or m.group(2) or "").strip()
    base = str(m.group(3) or "").strip()
    if not prefix or not base:
        return None, None

    p = re.sub(r"\s+", "", prefix)
    if "사담" in p:
        return "chat", base
    if "공지" in p:
        return "notice", base
    if "프리미엄" in p:
        return "premium", base
    return None, None

