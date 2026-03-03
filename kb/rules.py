import yaml
import re
from dataclasses import dataclass
import os
from typing import Any, Dict


@dataclass
class CollectRules:
    boards_include: list[int]
    title_allow: list[str]
    body_deny: list[str]
    min_length: int
    link_whitelist: list[str]


def load_rules(path: str) -> CollectRules:
    with open(path, "r", encoding="utf-8") as f:
        y = yaml.safe_load(f)
    return CollectRules(
        boards_include=list(map(int, y.get("boards", {}).get("include", []))),
        title_allow=y.get("title", {}).get("allow", []),
        body_deny=y.get("body", {}).get("deny", []),
        min_length=int(y.get("min_length", 0)),
        link_whitelist=y.get("link", {}).get("whitelist", []),
    )


def match_any(patterns: list[str], text: str) -> bool:
    for p in patterns:
        if re.search(p, text or "", re.IGNORECASE):
            return True
    return False


def should_keep(menu_id: int, title: str, body_text: str, rules: CollectRules) -> bool:
    if menu_id not in rules.boards_include:
        return False
    bypass = os.getenv("KB_IGNORE_RULES", "0") == "1"
    text = (body_text or "").strip()
    if not bypass and rules.min_length and (len(text) < rules.min_length):
        # Short notices can be kept if title matches allow patterns
        if not match_any(rules.title_allow, title or ""):
            return False
    if not bypass and match_any(rules.body_deny, body_text or ""):
        return False
    return True
