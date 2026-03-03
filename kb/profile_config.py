"""KB 프로필 설정 로더 (ADR-0006)

프로필 설정을 로드하고 테이블명/obj_type 등을 반환하는 헬퍼 함수 제공.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Literal, List, Dict, Any, Optional

import yaml

ProfileName = Literal["main", "free", "paid", "lectures"]
VALID_PROFILES: List[ProfileName] = ["main", "free", "paid", "lectures"]

_config_cache: Optional[Dict[str, Any]] = None


def _config_path() -> Path:
    return Path(__file__).parent / "profiles.yaml"


def load_profiles_config() -> Dict[str, Any]:
    """profiles.yaml 로드 (캐시됨)"""
    global _config_cache
    if _config_cache is not None:
        return _config_cache

    path = _config_path()
    if not path.exists():
        raise FileNotFoundError(f"profiles.yaml not found: {path}")

    with open(path, "r", encoding="utf-8") as f:
        _config_cache = yaml.safe_load(f)

    return _config_cache


def get_profile(name: ProfileName) -> Dict[str, Any]:
    """특정 프로필 설정 반환"""
    cfg = load_profiles_config()
    profiles = cfg.get("profiles", {})
    if name not in profiles:
        raise ValueError(f"Unknown profile: {name}. Valid: {VALID_PROFILES}")
    return profiles[name]


def get_backfill_config() -> Dict[str, Any]:
    """백필 설정 반환"""
    cfg = load_profiles_config()
    return cfg.get("backfill", {
        "max_days": 30,
        "max_pages": 50,
        "chunk_size": 100,
        "check_on_startup": True,
    })


def post_table(profile: ProfileName) -> str:
    """프로필별 게시글 테이블명

    main 프로필은 기존 sources_post 테이블 사용 (호환성 유지)
    다른 프로필은 kb_{profile}_post 테이블 사용
    """
    if profile not in VALID_PROFILES:
        raise ValueError(f"Invalid profile: {profile}")
    if profile == "main":
        return "sources_post"  # 기존 테이블 사용
    return f"kb_{profile}_post"


def manual_table(profile: ProfileName) -> str:
    """프로필별 매뉴얼 테이블명

    main 프로필은 기존 manual_doc 테이블 사용 (호환성 유지)
    """
    if profile not in VALID_PROFILES:
        raise ValueError(f"Invalid profile: {profile}")
    if profile == "main":
        return "manual_doc"  # 기존 테이블 사용
    return f"kb_{profile}_manual"


def embedding_obj_type(profile: ProfileName, doc_type: Literal["post", "manual"]) -> str:
    """임베딩 obj_type 문자열 (예: 'main_post', 'free_manual')"""
    if profile not in VALID_PROFILES:
        raise ValueError(f"Invalid profile: {profile}")
    return f"{profile}_{doc_type}"


def get_menu_ids(profile: ProfileName) -> List[int]:
    """프로필의 menu_id 목록 반환"""
    p = get_profile(profile)
    return p.get("menu_ids", [])


def get_cafe_id(profile: ProfileName) -> int:
    """프로필의 cafe_id 반환"""
    p = get_profile(profile)
    return p.get("cafe_id", 30819883)


def get_all_profile_menus() -> Dict[ProfileName, List[int]]:
    """모든 프로필의 menu_id 매핑 반환"""
    result = {}
    for name in VALID_PROFILES:
        result[name] = get_menu_ids(name)
    return result


def reload_config():
    """설정 캐시 초기화 (테스트/리로드용)"""
    global _config_cache
    _config_cache = None
