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
class OpenchatAutoLoadConfig:
    enabled: bool
    adb_serial: str
    scrolls: int
    scroll_pause_ms: int
    timeout_sec: int
    cooldown_room_sec: int
    cooldown_global_sec: int
    max_attempts: int


@dataclass(frozen=True)
class WorkerConfig:
    enabled: bool
    hot_interval_sec: int
    hot_days: int
    steady_interval_sec: int
    crawler: CrawlerConfig
    openchat_auto_load: OpenchatAutoLoadConfig


@dataclass(frozen=True)
class TabsConfig:
    cafe_raw: str
    openchat_raw: str
    ssot_raw: str
    rules_raw: str
    audit: str
    audit_log: str
    overview: str = "OVERVIEW"
    actions: str = "ACTIONS"


@dataclass(frozen=True)
class GradeRules:
    premium_grades: list[str]
    staff_grades: list[str]


@dataclass(frozen=True)
class PaymentSsotConfig:
    spreadsheet_id_raw: str
    spreadsheet_id: str
    sheet_name: str
    header_row: int
    grade_col: str
    nickname_col: str
    name_col: str
    id_col: str
    kind_col: str
    exclude_kinds: list[str]


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
    payment_ssot: Optional[PaymentSsotConfig] = None


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

    openchat_raw = worker_raw.get("openchatAutoLoad") if isinstance(worker_raw.get("openchatAutoLoad"), dict) else {}
    openchat_enabled = bool(openchat_raw.get("enabled"))
    openchat_serial = (
        _safe_str(openchat_raw.get("serial") or openchat_raw.get("adbSerial") or "")
        or str(os.getenv("REDROID_ADB_SERIAL") or "").strip()
    )
    openchat_scrolls = max(50, min(_safe_int(openchat_raw.get("scrolls"), 600), 3000))
    openchat_pause = max(150, min(_safe_int(openchat_raw.get("scrollPauseMs") or openchat_raw.get("scroll_pause_ms"), 400), 2000))
    openchat_timeout_sec = max(60, min(_safe_int(openchat_raw.get("timeoutSec") or openchat_raw.get("timeout_sec"), 900), 3600))
    openchat_cd_room = max(0, min(_safe_int(openchat_raw.get("cooldownRoomSec"), 900), 86400))
    openchat_cd_global = max(0, min(_safe_int(openchat_raw.get("cooldownGlobalSec"), 120), 86400))
    openchat_max_attempts = max(1, min(_safe_int(openchat_raw.get("maxAttempts"), 1), 5))
    openchat_auto_load = OpenchatAutoLoadConfig(
        enabled=openchat_enabled,
        adb_serial=openchat_serial,
        scrolls=openchat_scrolls,
        scroll_pause_ms=openchat_pause,
        timeout_sec=openchat_timeout_sec,
        cooldown_room_sec=openchat_cd_room,
        cooldown_global_sec=openchat_cd_global,
        max_attempts=openchat_max_attempts,
    )

    worker = WorkerConfig(
        enabled=enabled,
        hot_interval_sec=hot_interval_sec,
        hot_days=hot_days,
        steady_interval_sec=steady_interval_sec,
        crawler=crawler,
        openchat_auto_load=openchat_auto_load,
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
        ssot_tab = _safe_str((tabs_raw or {}).get("ssotRaw") or (tabs_raw or {}).get("paymentRaw") or (tabs_raw or {}).get("ssot") or (tabs_raw or {}).get("payment") or "") or "SSOT_RAW"
        rules_tab = _safe_str((tabs_raw or {}).get("rulesRaw")) or "RULES_RAW"
        audit_tab = _safe_str((tabs_raw or {}).get("audit")) or "AUDIT_VIEW"
        audit_log_tab = _safe_str((tabs_raw or {}).get("auditLog") or (tabs_raw or {}).get("audit_log") or (tabs_raw or {}).get("log")) or "AUDIT_LOG"
        overview_tab = _safe_str((tabs_raw or {}).get("overview")) or "OVERVIEW"
        actions_tab = _safe_str((tabs_raw or {}).get("actions") or (tabs_raw or {}).get("action")) or "ACTIONS"
        tabs = TabsConfig(
            cafe_raw=cafe_tab,
            openchat_raw=openchat_tab,
            ssot_raw=ssot_tab,
            rules_raw=rules_tab,
            audit=audit_tab,
            audit_log=audit_log_tab,
            overview=overview_tab,
            actions=actions_tab,
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

        pay_raw = v.get("paymentSsot") if isinstance(v.get("paymentSsot"), dict) else {}
        pay_spreadsheet_raw = _safe_str(pay_raw.get("spreadsheetId") or pay_raw.get("sheetId") or pay_raw.get("spreadsheet_id") or "")
        pay_spreadsheet_id = parse_spreadsheet_id(pay_spreadsheet_raw)
        payment_ssot = None
        if pay_spreadsheet_id:
            payment_ssot = PaymentSsotConfig(
                spreadsheet_id_raw=pay_spreadsheet_raw,
                spreadsheet_id=pay_spreadsheet_id,
                sheet_name=_safe_str(pay_raw.get("sheetName") or pay_raw.get("tab") or pay_raw.get("sheet") or "종합") or "종합",
                header_row=max(1, _safe_int(pay_raw.get("headerRow") or pay_raw.get("header_row"), 19)),
                grade_col=_safe_str(pay_raw.get("gradeCol") or pay_raw.get("gradeColumn") or "카페 등급") or "카페 등급",
                nickname_col=_safe_str(pay_raw.get("nicknameCol") or pay_raw.get("nicknameColumn") or "닉네임") or "닉네임",
                name_col=_safe_str(pay_raw.get("nameCol") or pay_raw.get("nameColumn") or pay_raw.get("name") or "성함") or "성함",
                id_col=_safe_str(pay_raw.get("idCol") or pay_raw.get("idColumn") or pay_raw.get("userIdCol") or "아이디") or "아이디",
                kind_col=_safe_str(pay_raw.get("kindCol") or pay_raw.get("kindColumn") or "구분") or "구분",
                exclude_kinds=_norm_str_list(pay_raw.get("excludeKinds")) or ["환불"],
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
            payment_ssot=payment_ssot,
        )

    return p, AuditConfig(version=version, worker=worker, courses=courses)
