from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_CONFIG_PATH = "data/course_membership_audit.json"


def repo_root() -> Path:
    # scripts/course_membership_audit 기준 상위 2단계가 repo root
    return Path(__file__).resolve().parent.parent.parent


def parse_spreadsheet_id(raw: str) -> str:
    s = str(raw or "").strip()
    if not s:
        return ""
    m = re.search(r"/spreadsheets/d/([a-zA-Z0-9-_]+)", s)
    return m.group(1) if m else s


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except FileNotFoundError:
        return ""


def read_json(path: Path) -> dict:
    raw = _read_text(path).strip()
    if not raw:
        return {}
    try:
        obj = json.loads(raw)
    except Exception as e:
        raise SystemExit(f"[오류] JSON 파싱 실패: {path} ({e})")
    if not isinstance(obj, dict):
        raise SystemExit(f"[오류] JSON 형식 오류(object 필요): {path}")
    return obj


def _safe_int(v: object, default: int) -> int:
    try:
        if v is None:
            return default
        if isinstance(v, bool):
            return default
        if isinstance(v, int):
            return v
        return int(str(v).strip())
    except Exception:
        return default


def _safe_str(v: object) -> str:
    return str(v or "").strip()


def _norm_str_list(v: object) -> list[str]:
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for it in v:
        s = _safe_str(it)
        if s:
            out.append(s)
    # 순서가 의미가 없으므로 안정적으로 정렬
    return sorted(set(out))


@dataclass(frozen=True)
class CrawlerConfig:
    repo_path: str
    python_exe: str
    settings_path: str


@dataclass(frozen=True)
class WorkerConfig:
    enabled: bool
    hot_interval_sec: int
    hot_days: int
    steady_interval_sec: int
    crawler: CrawlerConfig


@dataclass(frozen=True)
class TabsConfig:
    cafe_raw: str
    openchat_raw: str
    rules_raw: str
    audit: str
    audit_log: str


@dataclass(frozen=True)
class GradeRules:
    premium_grades: list[str]
    staff_grades: list[str]


@dataclass(frozen=True)
class RoomsOverride:
    chat: str
    notice: str
    premium: str

    def any_set(self) -> bool:
        return bool(self.chat or self.notice or self.premium)


@dataclass(frozen=True)
class CourseConfig:
    course_key: str
    enabled: bool
    club_id: str
    spreadsheet_id_raw: str
    spreadsheet_id: str
    tabs: TabsConfig
    grade_rules: GradeRules
    rooms: RoomsOverride


@dataclass(frozen=True)
class AuditConfig:
    version: int
    worker: WorkerConfig
    courses: dict[str, CourseConfig]


def load_config(path_raw: str) -> tuple[Path, AuditConfig]:
    root = repo_root()
    p = Path(str(path_raw or "").strip() or DEFAULT_CONFIG_PATH)
    if not p.is_absolute():
        p = (root / p).resolve()

    if not p.exists():
        raise SystemExit(f"[오류] config가 없습니다: {p}")

    raw = read_json(p)
    version = _safe_int(raw.get("version"), 1)

    worker_raw = raw.get("worker") if isinstance(raw.get("worker"), dict) else {}
    enabled = bool(worker_raw.get("enabled"))
    hot_interval_sec = max(30, _safe_int(worker_raw.get("hotIntervalSec"), 600))
    hot_days = max(0, _safe_int(worker_raw.get("hotDays"), 14))
    steady_interval_sec = max(60, _safe_int(worker_raw.get("steadyIntervalSec"), 10800))

    crawler_raw = worker_raw.get("crawler") if isinstance(worker_raw.get("crawler"), dict) else {}
    crawler_repo = _safe_str(crawler_raw.get("repoPath")) or str(os.getenv("NAVER_CAFE_CRAWLER_REPO") or "").strip()
    crawler_py = _safe_str(crawler_raw.get("pythonExe")) or str(os.getenv("NAVER_CAFE_CRAWLER_PYTHON") or "").strip()
    crawler_settings = _safe_str(crawler_raw.get("settingsPath")) or str(os.getenv("NAVER_CAFE_CRAWLER_SETTINGS") or "").strip()
    crawler = CrawlerConfig(repo_path=crawler_repo, python_exe=crawler_py, settings_path=crawler_settings)

    worker = WorkerConfig(
        enabled=enabled,
        hot_interval_sec=hot_interval_sec,
        hot_days=hot_days,
        steady_interval_sec=steady_interval_sec,
        crawler=crawler,
    )

    courses_raw = raw.get("courses") if isinstance(raw.get("courses"), dict) else {}
    courses: dict[str, CourseConfig] = {}
    for k, v in courses_raw.items():
        ck = _safe_str(k)
        if not ck or not isinstance(v, dict):
            continue
        if bool(v.get("enabled")) is False:
            # enabled=false인 코스도 config에는 남겨두되, 워커는 수행하지 않는다.
            enabled_course = False
        else:
            enabled_course = True

        cafe_raw = v.get("cafe") if isinstance(v.get("cafe"), dict) else {}
        club_id = _safe_str(
            v.get("clubId")
            or v.get("club_id")
            or cafe_raw.get("clubId")
            or cafe_raw.get("club_id")
            or ""
        )
        spreadsheet_raw = _safe_str(v.get("spreadsheetId") or v.get("spreadsheet_id") or v.get("sheetId") or "")
        spreadsheet_id = parse_spreadsheet_id(spreadsheet_raw)

        sheets_raw = v.get("sheets") if isinstance(v.get("sheets"), dict) else {}
        tabs_raw = v.get("tabs") if isinstance(v.get("tabs"), dict) else (sheets_raw.get("tabs") if isinstance(sheets_raw.get("tabs"), dict) else {})
        cafe_tab = _safe_str((tabs_raw or {}).get("cafeRaw")) or "CAFE_RAW"
        openchat_tab = _safe_str((tabs_raw or {}).get("openchatRaw")) or "OPENCHAT_RAW"
        rules_tab = _safe_str((tabs_raw or {}).get("rulesRaw")) or "RULES_RAW"
        audit_tab = _safe_str((tabs_raw or {}).get("audit")) or "AUDIT_VIEW"
        audit_log_tab = _safe_str((tabs_raw or {}).get("auditLog") or (tabs_raw or {}).get("audit_log") or (tabs_raw or {}).get("log")) or "AUDIT_LOG"
        tabs = TabsConfig(
            cafe_raw=cafe_tab,
            openchat_raw=openchat_tab,
            rules_raw=rules_tab,
            audit=audit_tab,
            audit_log=audit_log_tab,
        )

        grade_raw = v.get("gradeRules") if isinstance(v.get("gradeRules"), dict) else {}
        premium_grades = _norm_str_list(grade_raw.get("premiumGrades"))
        staff_grades = _norm_str_list(grade_raw.get("staffGrades"))
        grade_rules = GradeRules(premium_grades=premium_grades, staff_grades=staff_grades)

        rooms_raw = v.get("rooms") if isinstance(v.get("rooms"), dict) else {}
        rooms = RoomsOverride(
            chat=_safe_str(rooms_raw.get("chat")),
            notice=_safe_str(rooms_raw.get("notice")),
            premium=_safe_str(rooms_raw.get("premium")),
        )

        courses[ck] = CourseConfig(
            course_key=ck,
            enabled=enabled_course,
            club_id=club_id,
            spreadsheet_id_raw=spreadsheet_raw,
            spreadsheet_id=spreadsheet_id,
            tabs=tabs,
            grade_rules=grade_rules,
            rooms=rooms,
        )

    return p, AuditConfig(version=version, worker=worker, courses=courses)
