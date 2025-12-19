#!/usr/bin/env python3
"""
네이버 카페 멤버(등급 포함) 스냅샷을 크롤링해 JSON으로 저장한다.

의도
- 12.kakao 쪽 워커에서 주기적으로 호출해 "카페 멤버 자동 갱신"을 구현한다.
- 크롤링 로직은 `C:\\dev\\naver-cafe-member-crawler` 레포의 Playwright 기반 구현을 재사용한다.

주의
- 이 스크립트는 계정/비밀번호를 출력/로그로 남기지 않는다.
- 설정 파일에는 민감정보가 들어갈 수 있으니 git 커밋 금지(외부 레포 포함).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional


def _iso_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _read_json(path: Path) -> dict:
    try:
        raw = path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        raise SystemExit(f"[오류] 설정 파일이 없습니다: {path}")
    except Exception as e:
        raise SystemExit(f"[오류] 설정 파일 읽기 실패: {path} ({e})")
    try:
        obj = json.loads(raw or "{}")
    except Exception as e:
        raise SystemExit(f"[오류] 설정 JSON 파싱 실패: {path} ({e})")
    if not isinstance(obj, dict):
        raise SystemExit(f"[오류] 설정 JSON 형식 오류(object 필요): {path}")
    return obj


def _default_settings_path(crawler_repo: Path) -> Path:
    # EXE/운영 기본 경로 (v1.4+): %LOCALAPPDATA%\\NaverCafeMemberCrawler\\config\\settings.json
    lad = str(os.getenv("LOCALAPPDATA") or "").strip()
    if lad:
        p = (Path(lad) / "NaverCafeMemberCrawler" / "config" / "settings.json").resolve()
        if p.exists():
            return p

    # 개발 레포 경로: <repo>\\config\\settings.json
    p2 = (crawler_repo / "config" / "settings.json").resolve()
    if p2.exists():
        return p2

    raise SystemExit(
        "[오류] naver-cafe-member-crawler 설정(settings.json)을 찾지 못했습니다.\n"
        f"- 기대 경로(운영): %LOCALAPPDATA%\\NaverCafeMemberCrawler\\config\\settings.json\n"
        f"- 기대 경로(레포): {p2}"
    )


def _safe_str(v: object) -> str:
    s = str(v or "").strip()
    return s


def _load_account(settings: dict) -> tuple[str, str]:
    acc = settings.get("account")
    if not isinstance(acc, dict):
        acc = {}
    naver_id = _safe_str(acc.get("naver_id"))
    naver_pw = _safe_str(acc.get("naver_pw"))
    if not naver_id or not naver_pw:
        raise SystemExit("[오류] settings.json에 naver_id/naver_pw가 비어 있습니다.")
    return naver_id, naver_pw


def _resolve_headless(settings: dict, headless_flag: Optional[bool]) -> bool:
    if headless_flag is not None:
        return bool(headless_flag)
    opts = settings.get("options")
    if isinstance(opts, dict) and opts.get("headless") is not None:
        return bool(opts.get("headless"))
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="네이버 카페 멤버 스냅샷 크롤링(JSON 출력)")
    ap.add_argument(
        "--crawler-repo",
        default=str(os.getenv("NAVER_CAFE_CRAWLER_REPO") or "C:\\dev\\naver-cafe-member-crawler"),
        help="naver-cafe-member-crawler 레포 경로",
    )
    ap.add_argument(
        "--settings",
        default=str(os.getenv("NAVER_CAFE_CRAWLER_SETTINGS") or "").strip(),
        help="settings.json 경로(비우면 기본 경로 자동 탐색)",
    )
    ap.add_argument("--club-id", required=True, help="네이버 카페 club_id")
    ap.add_argument("--cafe-name", default="", help="카페 이름(로그/출력용, 옵션)")
    ap.add_argument(
        "--headless",
        action="store_true",
        help="헤드리스 강제 ON(기본은 settings.json options.headless를 우선, 없으면 True)",
    )
    ap.add_argument(
        "--headed",
        action="store_true",
        help="헤드리스 강제 OFF(디버그용)",
    )
    ap.add_argument("--output", required=True, help="출력 JSON 파일 경로")
    args = ap.parse_args()

    crawler_repo = Path(str(args.crawler_repo)).resolve()
    if not crawler_repo.exists():
        raise SystemExit(f"[오류] crawler repo 경로가 없습니다: {crawler_repo}")

    settings_path = Path(str(args.settings)).resolve() if str(args.settings).strip() else _default_settings_path(crawler_repo)
    settings = _read_json(settings_path)

    naver_id, naver_pw = _load_account(settings)

    headless_flag: Optional[bool] = None
    if bool(args.headed):
        headless_flag = False
    elif bool(args.headless):
        headless_flag = True
    headless = _resolve_headless(settings, headless_flag)

    src_dir = (crawler_repo / "src").resolve()
    if not src_dir.exists():
        raise SystemExit(f"[오류] crawler src 경로가 없습니다: {src_dir}")

    # naver-cafe-member-crawler/src 를 모듈 경로에 추가
    sys.path.insert(0, str(src_dir))

    out_path = Path(str(args.output)).resolve()
    out_path.parent.mkdir(parents=True, exist_ok=True)

    try:
        from crawler import run_crawl  # type: ignore
    except Exception as e:
        raise SystemExit(f"[오류] crawler 모듈 import 실패: {e}")

    club_id = _safe_str(args.club_id)
    cafe_name = _safe_str(args.cafe_name) or f"cafe_{club_id}"

    try:
        result = run_crawl(naver_id=naver_id, naver_pw=naver_pw, cafe_id=club_id, cafe_name=cafe_name, headless=headless)
    except SystemExit as e:
        payload: Dict[str, Any] = {
            "ok": False,
            "clubId": club_id,
            "cafeName": cafe_name,
            "fetchedAt": _iso_now(),
            "error": str(e),
            "members": [],
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 1
    except Exception as e:
        payload = {
            "ok": False,
            "clubId": club_id,
            "cafeName": cafe_name,
            "fetchedAt": _iso_now(),
            "error": str(e),
            "members": [],
        }
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        return 1

    members_out: list[dict] = []
    try:
        for m in getattr(result, "members", []) or []:
            members_out.append(
                {
                    "cafeUserId": _safe_str(getattr(m, "user_id", "")),
                    "cafeNickname": _safe_str(getattr(m, "nickname", "")),
                    "grade": _safe_str(getattr(m, "grade", "")),
                    "joinDate": _safe_str(getattr(m, "join_date", "")),
                    "lastVisit": _safe_str(getattr(m, "last_visit", "")),
                    "visitCount": _safe_str(getattr(m, "visit_count", "")),
                    "articleCount": _safe_str(getattr(m, "article_count", "")),
                    "commentCount": _safe_str(getattr(m, "comment_count", "")),
                    "gender": _safe_str(getattr(m, "gender", "")),
                }
            )
    except Exception:
        members_out = []

    payload = {
        "ok": bool(getattr(result, "success", False)),
        "clubId": _safe_str(getattr(result, "club_id", club_id)),
        "cafeName": _safe_str(getattr(result, "cafe_name", cafe_name)),
        "totalCount": int(getattr(result, "total_count", 0) or 0),
        "fetchedAt": _iso_now(),
        "error": _safe_str(getattr(result, "error", "")),
        "logFile": _safe_str(getattr(result, "log_file", "")),
        "members": members_out,
    }

    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if payload["ok"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

