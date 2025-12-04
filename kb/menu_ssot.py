"""KB 메뉴 SSOT 로더 (Phase 3)

config/menus_dinohighclass.json을 단일 진실의 소스(SSOT)로 사용하여
메뉴 정보를 로드하고 검증하는 모듈.

profiles.yaml의 menu_ids와 SSOT의 profile 필드를 교차 검증한다.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Any
from functools import lru_cache

from kb.logging_util import get_logger

logger = get_logger("kb.menu_ssot")

# 유효한 프로필 목록
VALID_PROFILES = ["main", "free", "paid", "tips", "community"]


def _ssot_path() -> Path:
    """SSOT 파일 경로 반환"""
    return Path(__file__).parent.parent / "config" / "menus_dinohighclass.json"


@lru_cache(maxsize=1)
def load_ssot() -> Dict[str, Any]:
    """SSOT JSON 로드 (캐시됨)"""
    path = _ssot_path()
    if not path.exists():
        raise FileNotFoundError(f"Menu SSOT not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def reload_ssot():
    """SSOT 캐시 초기화"""
    load_ssot.cache_clear()


def get_cafe_id() -> int:
    """SSOT에서 cafe_id 반환"""
    return load_ssot().get("cafe_id", 30819883)


def get_all_menus() -> List[Dict[str, Any]]:
    """전체 메뉴 목록 반환"""
    return load_ssot().get("menus", [])


def get_menu_by_id(menu_id: int) -> Optional[Dict[str, Any]]:
    """특정 menu_id의 메뉴 정보 반환"""
    for m in get_all_menus():
        if m.get("menu_id") == menu_id:
            return m
    return None


def get_menu_name(menu_id: int) -> str:
    """메뉴 이름 반환"""
    m = get_menu_by_id(menu_id)
    return m.get("name", f"메뉴 {menu_id}") if m else f"메뉴 {menu_id}"


def get_collect_menu_ids() -> List[int]:
    """수집 대상(collect=true) 메뉴 ID 목록"""
    return [m["menu_id"] for m in get_all_menus() if m.get("collect")]


def get_menu_ids_by_profile(profile: str) -> List[int]:
    """특정 프로필에 속한 메뉴 ID 목록

    Args:
        profile: free, paid, tips, community 중 하나

    Returns:
        해당 프로필의 menu_id 목록
    """
    if profile == "main":
        # main은 모든 수집 대상 메뉴
        return get_collect_menu_ids()

    return [
        m["menu_id"]
        for m in get_all_menus()
        if m.get("profile") == profile
    ]


def get_profile_for_menu(menu_id: int) -> Optional[str]:
    """메뉴의 프로필 반환"""
    m = get_menu_by_id(menu_id)
    return m.get("profile") if m else None


def validate_against_profiles_yaml() -> List[str]:
    """profiles.yaml과 SSOT의 일관성 검증

    Returns:
        경고/에러 메시지 목록 (빈 목록이면 정상)
    """
    from kb.profile_config import load_profiles_config, VALID_PROFILES as YAML_PROFILES

    issues = []

    # SSOT의 수집 대상 메뉴
    ssot_collect_ids = set(get_collect_menu_ids())

    # profiles.yaml 로드
    try:
        yaml_cfg = load_profiles_config()
        profiles = yaml_cfg.get("profiles", {})
    except Exception as e:
        issues.append(f"profiles.yaml 로드 실패: {e}")
        return issues

    # 각 프로필 검증
    for profile_name, profile_data in profiles.items():
        yaml_menu_ids = set(profile_data.get("menu_ids", []))
        ssot_menu_ids = set(get_menu_ids_by_profile(profile_name))

        # YAML에는 있지만 SSOT에는 없는 메뉴
        yaml_only = yaml_menu_ids - ssot_collect_ids
        if yaml_only:
            issues.append(
                f"[{profile_name}] YAML에 있지만 SSOT에서 collect=false: {yaml_only}"
            )

        # SSOT profile과 YAML menu_ids 불일치
        if profile_name != "main" and yaml_menu_ids != ssot_menu_ids:
            diff = yaml_menu_ids.symmetric_difference(ssot_menu_ids)
            if diff:
                issues.append(
                    f"[{profile_name}] YAML↔SSOT 불일치: YAML={yaml_menu_ids}, SSOT={ssot_menu_ids}"
                )

    # 중복 프로필 체크 (하나의 메뉴가 여러 프로필에 할당)
    profile_assignments: Dict[int, List[str]] = {}
    for m in get_all_menus():
        p = m.get("profile")
        if p and p != "main":
            mid = m["menu_id"]
            if mid not in profile_assignments:
                profile_assignments[mid] = []
            profile_assignments[mid].append(p)

    for mid, profiles_list in profile_assignments.items():
        if len(profiles_list) > 1:
            issues.append(f"메뉴 {mid}이 여러 프로필에 할당됨: {profiles_list}")

    return issues


def build_menu_map() -> Dict[int, Dict[str, Any]]:
    """menu_id → 메뉴 정보 맵 생성"""
    return {m["menu_id"]: m for m in get_all_menus()}


# 모듈 로드 시 검증 (선택적)
if os.getenv("KB_VALIDATE_SSOT", "").lower() in ("1", "true"):
    issues = validate_against_profiles_yaml()
    if issues:
        logger.warning(f"SSOT 검증 이슈: {issues}")
