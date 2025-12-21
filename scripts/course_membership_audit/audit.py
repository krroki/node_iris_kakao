from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple

from .config import GradeRules


ROOM_LABEL: dict[str, str] = {
    "chat": "사담방",
    "notice": "공지방",
    "premium": "프리미엄방",
}


# 오픈채팅 닉네임 규칙: "<이름 마스킹>@ + (카페닉)" 형태에서 괄호 안 카페닉만 추출한다.
# 예) "정@록(나물쓰)" -> "나물쓰"
# 예) "정@@록(나물쓰)" -> "나물쓰"
# NOTE: 일부 사용자는 전각 괄호(（ ）)를 쓰기도 해서 함께 허용한다.
_CAFE_NICK_RE = re.compile(r"[（(]([^（）()\n\r]{1,100})[）)]\s*$")
_CAFE_NICK_SLASH_RE = re.compile(r"[/／]\s*([^/／\s]{1,100})\s*$")
_WS_RE = re.compile(r"\s+")


def normalize_cafe_nickname(s: str) -> str:
    # NOTE: 카페/오픈채팅 닉네임은 공백 유무가 흔히 흔들리므로(예: "오남매워킹맘" vs "오남매 워킹맘")
    # 안전하게 "공백 제거" 정규화 키를 추가로 사용한다(단, 정규화 매칭은 유니크할 때만 적용).
    return _WS_RE.sub("", str(s or "").strip())


def build_cafe_nickname_index(cafe_nick_set: set[str]) -> dict[str, list[str]]:
    index: dict[str, set[str]] = {}
    for nick in cafe_nick_set or set():
        k = normalize_cafe_nickname(nick)
        if not k:
            continue
        if k not in index:
            index[k] = set()
        index[k].add(nick)
    return {k: sorted(list(v)) for k, v in index.items()}


def parse_cafe_nickname_from_openchat(nickname: str) -> tuple[str, str]:
    """
    Returns:
        (cafeNickname, source)
        - source: paren|slash|none
    """
    s = str(nickname or "").strip()
    if not s:
        return "", "none"

    m = _CAFE_NICK_RE.search(s)
    if m:
        inner = str(m.group(1) or "").strip()
        return inner, "paren"

    m = _CAFE_NICK_SLASH_RE.search(s)
    if m:
        inner = str(m.group(1) or "").strip()
        return inner, "slash"

    return "", "none"


def extract_cafe_nickname_from_openchat(nickname: str) -> str:
    cafe_nick, _src = parse_cafe_nickname_from_openchat(nickname)
    return cafe_nick


def resolve_cafe_nickname_from_openchat(
    nickname: str,
    cafe_nick_set: set[str],
    cafe_nick_index: dict[str, list[str]] | None = None,
) -> tuple[str, str]:
    """
    Tries to resolve openchat nickname -> cafeNickname using strict rules first,
    then safe heuristics only when the candidate exists in cafe_nick_set.

    Returns:
        (cafeNickname, source)
        - source: paren|slash|exact|token|after_paren|broken_paren|none
    """
    def _norm_unique(candidate: str) -> tuple[str, str] | None:
        if not cafe_nick_index:
            return None
        key = normalize_cafe_nickname(candidate)
        if not key:
            return None
        hits = cafe_nick_index.get(key) if isinstance(cafe_nick_index.get(key), list) else None
        if not hits or len(hits) != 1:
            return None
        return hits[0], "norm_space"

    parsed, src = parse_cafe_nickname_from_openchat(nickname)
    if parsed and parsed in cafe_nick_set:
        return parsed, src
    if parsed:
        nu = _norm_unique(parsed)
        if nu:
            nick, label = nu
            return nick, f"{src}_{label}"

    s = str(nickname or "").strip()
    if (not s) or (not cafe_nick_set):
        return "", "none"

    if s in cafe_nick_set:
        return s, "exact"
    nu = _norm_unique(s)
    if nu:
        nick, label = nu
        return nick, f"exact_{label}"

    # "(홍*동)카페닉" 처럼 이름 괄호가 앞에 오는 변형 케이스: ')' 이후 텍스트가 cafeNickname이면 사용
    if ")" in s:
        tail = s.rsplit(")", 1)[-1].strip()
        if tail and tail in cafe_nick_set:
            return tail, "after_paren"
        nu = _norm_unique(tail)
        if nu:
            nick, label = nu
            return nick, f"after_paren_{label}"

    # "박@희(카페닉" 처럼 닫는 괄호가 누락된 케이스: '(' 이후 텍스트가 cafeNickname이면 사용
    if "(" in s and ")" not in s:
        tail = s.rsplit("(", 1)[-1].strip()
        if tail and tail in cafe_nick_set:
            return tail, "broken_paren"
        nu = _norm_unique(tail)
        if nu:
            nick, label = nu
            return nick, f"broken_paren_{label}"

    # 공백 토큰 중 정확히 1개만 cafeNickname과 일치하면 사용 (예: "조교 카페닉", "카페닉 2")
    tokens = [t.strip() for t in re.split(r"\s+", s) if t.strip()]
    hits = sorted({t for t in tokens if t in cafe_nick_set})
    if len(hits) == 1:
        return hits[0], "token"

    return "", "none"


# 이름 마스킹 규칙(권장): "첫 글자 + @ 반복 + 마지막 글자"
# - 3글자 이름: 정@록
# - 4글자 이름: 정@@록
_NAME_MASK_RE = re.compile(r"^[^@\s]{1}[@]{1,10}[^@\s]{1}$")


def extract_name_mask_prefix(nickname: str) -> str:
    s = str(nickname or "").strip()
    if not s:
        return ""
    m = _CAFE_NICK_RE.search(s)
    if not m:
        return ""
    return s[: m.start()].strip()


def is_valid_name_mask_prefix(prefix: str) -> bool:
    s = str(prefix or "").strip()
    if not s:
        return False
    return bool(_NAME_MASK_RE.match(s))


def classify_track(grade: str, rules: GradeRules) -> str:
    def _ng(s: str) -> str:
        return normalize_cafe_nickname(str(s or "")).lower()

    g_raw = str(grade or "").strip()
    g = _ng(g_raw)
    staff_norm = {_ng(x) for x in (rules.staff_grades or []) if str(x or "").strip()}
    premium_norm = {_ng(x) for x in (rules.premium_grades or []) if str(x or "").strip()}

    if g and g in staff_norm:
        return "staff"
    # 운영진 grade는 강의/카페마다 이름이 흔들릴 수 있어, 최소한의 보조 규칙을 적용한다.
    # (예: "부 매니저" / "카페스탭" 등)
    if g and (("매니저" in g) or ("스탭" in g) or ("스텝" in g) or ("운영" in g)):
        return "staff"
    if g and g in premium_norm:
        return "premium"
    return "normal"


def build_cafe_raw_rows(
    *,
    course_key: str,
    cafe_snapshot: dict,
    rules: GradeRules,
) -> List[List[str]]:
    fetched_at = str(cafe_snapshot.get("fetchedAt") or "").strip()
    club_id = str(cafe_snapshot.get("clubId") or "").strip()
    cafe_name = str(cafe_snapshot.get("cafeName") or "").strip()
    members = cafe_snapshot.get("members") if isinstance(cafe_snapshot.get("members"), list) else []

    rows: List[List[str]] = [
        [
            "courseKey",
            "clubId",
            "cafeName",
            "fetchedAt",
            "cafeUserId",
            "cafeNickname",
            "grade",
            "track",
            "joinDate",
            "lastVisit",
            "visitCount",
            "articleCount",
            "commentCount",
            "gender",
        ]
    ]
    for it in members:
        if not isinstance(it, dict):
            continue
        grade = str(it.get("grade") or "").strip()
        track = classify_track(grade, rules)
        rows.append(
            [
                course_key,
                club_id,
                cafe_name,
                fetched_at,
                str(it.get("cafeUserId") or "").strip(),
                str(it.get("cafeNickname") or "").strip(),
                grade,
                track,
                str(it.get("joinDate") or "").strip(),
                str(it.get("lastVisit") or "").strip(),
                str(it.get("visitCount") or "").strip(),
                str(it.get("articleCount") or "").strip(),
                str(it.get("commentCount") or "").strip(),
                str(it.get("gender") or "").strip(),
            ]
        )
    return rows


def build_openchat_raw_rows(
    *,
    course_key: str,
    fetched_at: str,
    room_infos: dict[str, dict],
    members_by_room: dict[str, list[dict]],
    cafe_nick_set: set[str] | None = None,
) -> List[List[str]]:
    cafe_nick_index = build_cafe_nickname_index(cafe_nick_set) if cafe_nick_set else None
    rows: List[List[str]] = [
        [
            "courseKey",
            "fetchedAt",
            "roomType",
            "roomLabel",
            "roomId",
            "roomName",
            "activeMembersCount",
            "loadedMembersCount",
            "openchatUserId",
            "openchatNickname",
            "parsedCafeNickname",
            "parsedCafeNicknameSource",
            "resolvedCafeNickname",
            "resolvedCafeNicknameSource",
            "needsNicknameChange",
            "nameMaskPrefix",
            "nameMaskOk",
        ]
    ]

    for room_type in ["chat", "notice", "premium"]:
        info = room_infos.get(room_type) if isinstance(room_infos.get(room_type), dict) else {}
        room_id = str(info.get("roomId") or "").strip()
        room_name = str(info.get("roomName") or "").strip()
        active = str(info.get("activeMembersCount") or "").strip()
        loaded = str(info.get("loadedMembersCount") or "").strip()
        label = ROOM_LABEL.get(room_type, room_type)

        for m in members_by_room.get(room_type, []) or []:
            if not isinstance(m, dict):
                continue
            uid = str(m.get("userId") or "").strip()
            nick = str(m.get("nickname") or "").strip()
            parsed, parsed_src = parse_cafe_nickname_from_openchat(nick)
            resolved = ""
            resolved_src = ""
            if cafe_nick_set:
                resolved, resolved_src = resolve_cafe_nickname_from_openchat(nick, cafe_nick_set, cafe_nick_index)

            name_mask_prefix = ""
            name_mask_ok = ""
            if parsed_src == "paren":
                name_mask_prefix = extract_name_mask_prefix(nick)
                name_mask_ok = "TRUE" if name_mask_prefix and is_valid_name_mask_prefix(name_mask_prefix) else "FALSE"

            # needs change if:
            # - cafeNickname isn't in "(...)" OR
            # - name mask prefix exists but invalid
            needs_change = "TRUE"
            if parsed_src == "paren" and name_mask_ok == "TRUE":
                needs_change = "FALSE"

            rows.append(
                [
                    course_key,
                    fetched_at,
                    room_type,
                    label,
                    room_id,
                    room_name,
                    active,
                    loaded,
                    uid,
                    nick,
                    parsed,
                    parsed_src,
                    resolved,
                    resolved_src,
                    needs_change,
                    name_mask_prefix,
                    name_mask_ok,
                ]
            )

    return rows


def build_rules_raw_rows(
    *,
    course_key: str,
    now_iso: str,
    worker_info: dict[str, str],
    course_info: dict[str, str],
    room_infos: dict[str, dict],
    rules: GradeRules,
    cafe_snapshot: dict,
    openchat_fetched_at: str,
) -> List[List[str]]:
    # 사람이 읽기 쉬운 key/value 형식(2열)
    def kv(k: str, v: object) -> list[str]:
        return [str(k), str(v if v is not None else "")]

    rows: List[List[str]] = [["key", "value"]]
    rows.append(kv("updatedAt", now_iso))
    rows.append(kv("courseKey", course_key))
    for k, v in worker_info.items():
        rows.append(kv(f"worker.{k}", v))
    for k, v in course_info.items():
        rows.append(kv(f"course.{k}", v))

    rows.append(kv("grades.premiumGrades", ", ".join(rules.premium_grades)))
    rows.append(kv("grades.staffGrades", ", ".join(rules.staff_grades)))

    cafe_fetched_at = str(cafe_snapshot.get("fetchedAt") or "").strip()
    cafe_total = str(cafe_snapshot.get("totalCount") or "").strip()
    cafe_ok = str(cafe_snapshot.get("ok") or "").strip()
    cafe_err = str(cafe_snapshot.get("error") or "").strip()
    rows.append(kv("cafe.ok", cafe_ok))
    rows.append(kv("cafe.totalCount", cafe_total))
    rows.append(kv("cafe.fetchedAt", cafe_fetched_at))
    if cafe_err:
        rows.append(kv("cafe.error", cafe_err))

    rows.append(kv("openchat.fetchedAt", openchat_fetched_at))

    for room_type in ["chat", "notice", "premium"]:
        info = room_infos.get(room_type) if isinstance(room_infos.get(room_type), dict) else {}
        rows.append(kv(f"rooms.{room_type}.id", str(info.get("roomId") or "").strip()))
        rows.append(kv(f"rooms.{room_type}.name", str(info.get("roomName") or "").strip()))
        rows.append(kv(f"rooms.{room_type}.activeMembersCount", str(info.get("activeMembersCount") or "").strip()))
        rows.append(kv(f"rooms.{room_type}.loadedMembersCount", str(info.get("loadedMembersCount") or "").strip()))
        rows.append(kv(f"rooms.{room_type}.incomplete", str(info.get("incomplete") or "").strip()))
    return rows


def build_audit_view_rows(
    *,
    course_key: str,
    cafe_snapshot: dict,
    rules: GradeRules,
    room_infos: dict[str, dict],
    members_by_room: dict[str, list[dict]],
    openchat_fetched_at: str,
) -> List[List[str]]:
    cafe_fetched_at = str(cafe_snapshot.get("fetchedAt") or "").strip()
    club_id = str(cafe_snapshot.get("clubId") or "").strip()
    cafe_members = cafe_snapshot.get("members") if isinstance(cafe_snapshot.get("members"), list) else []
    cafe_nick_set = {
        str(it.get("cafeNickname") or "").strip()
        for it in cafe_members
        if isinstance(it, dict) and str(it.get("cafeNickname") or "").strip()
    }
    cafe_nick_index = build_cafe_nickname_index(cafe_nick_set)

    # room completeness(방 단위): requiredRooms에만 적용해야 normal/premium 판정이 과도하게 INCOMPLETE로 굳지 않는다.
    incomplete_by_room: dict[str, bool] = {}
    for rt in ["chat", "notice", "premium"]:
        info = room_infos.get(rt) if isinstance(room_infos.get(rt), dict) else {}
        incomplete_by_room[rt] = bool(info.get("incomplete"))

    # build membership maps: cafeNick -> count
    counts: dict[str, dict[str, int]] = {"chat": {}, "notice": {}, "premium": {}}
    for rt in ["chat", "notice", "premium"]:
        for m in members_by_room.get(rt, []) or []:
            if not isinstance(m, dict):
                continue
            nick = str(m.get("nickname") or "").strip()
            cafe_nick, _src = resolve_cafe_nickname_from_openchat(nick, cafe_nick_set, cafe_nick_index)
            if not cafe_nick:
                continue
            bucket = counts[rt]
            bucket[cafe_nick] = int(bucket.get(cafe_nick) or 0) + 1

    rows: List[List[str]] = [
        [
            "courseKey",
            "clubId",
            "cafeNickname",
            "grade",
            "track",
            "requiredRooms",
            "in_chat",
            "in_notice",
            "in_premium",
            "missingRooms",
            "auditStatus",
            "chatCount",
            "noticeCount",
            "premiumCount",
            "cafeUserId",
            "cafeUpdatedAt",
            "openchatUpdatedAt",
        ]
    ]

    for it in cafe_members:
        if not isinstance(it, dict):
            continue
        cafe_nick = str(it.get("cafeNickname") or "").strip()
        grade = str(it.get("grade") or "").strip()
        track = classify_track(grade, rules)

        c_chat = int(counts["chat"].get(cafe_nick) or 0)
        c_notice = int(counts["notice"].get(cafe_nick) or 0)
        c_premium = int(counts["premium"].get(cafe_nick) or 0)

        in_chat = c_chat > 0
        in_notice = c_notice > 0
        in_premium = c_premium > 0

        required: list[str] = []
        if track == "premium":
            required = ["chat", "notice", "premium"]
        elif track == "normal":
            required = ["chat", "notice"]
        else:
            required = []

        missing: list[str] = []
        if "chat" in required and not incomplete_by_room.get("chat", False) and not in_chat:
            missing.append(ROOM_LABEL["chat"])
        if "notice" in required and not incomplete_by_room.get("notice", False) and not in_notice:
            missing.append(ROOM_LABEL["notice"])
        if "premium" in required and not incomplete_by_room.get("premium", False) and not in_premium:
            missing.append(ROOM_LABEL["premium"])

        ambiguous = (c_chat > 1) or (c_notice > 1) or (c_premium > 1)
        required_incomplete = any(incomplete_by_room.get(x, False) for x in required)

        if track == "staff":
            audit_status = "STAFF"
        elif required_incomplete:
            audit_status = "INCOMPLETE"
        elif ambiguous:
            audit_status = "AMBIGUOUS"
        elif missing:
            audit_status = "MISSING"
        else:
            audit_status = "OK"

        rows.append(
            [
                course_key,
                club_id,
                cafe_nick,
                grade,
                track,
                ",".join([ROOM_LABEL.get(x, x) for x in required]),
                "TRUE" if in_chat else "FALSE",
                "TRUE" if in_notice else "FALSE",
                "TRUE" if in_premium else "FALSE",
                ",".join(missing),
                audit_status,
                str(c_chat),
                str(c_notice),
                str(c_premium),
                str(it.get("cafeUserId") or "").strip(),
                cafe_fetched_at,
                openchat_fetched_at,
            ]
        )

    return rows


def build_overview_rows(
    *,
    course_key: str,
    now_iso: str,
    cafe_snapshot: dict,
    room_infos: dict[str, dict],
    audit_rows: List[List[str]],
    openchat_rows: List[List[str]],
    recent_audit_log_rows: List[List[str]] | None = None,
    max_recent_audit_log_rows: int = 60,
    max_nickname_issue_rows: int = 300,
) -> List[List[str]]:
    # Overview는 "보기용" 시트이므로, 매 실행 시 전체 재작성(clear + update)을 전제로 한다.
    cafe_members = cafe_snapshot.get("members") if isinstance(cafe_snapshot.get("members"), list) else []
    cafe_nick_set = {
        str(it.get("cafeNickname") or "").strip()
        for it in cafe_members
        if isinstance(it, dict) and str(it.get("cafeNickname") or "").strip()
    }

    # helpers
    def _h2i(header: list[str]) -> dict[str, int]:
        return {str(h).strip(): i for i, h in enumerate(header or []) if str(h).strip()}

    def _cell(row: list[str], idx: int | None) -> str:
        if idx is None:
            return ""
        return str(row[idx] if idx < len(row) else "").strip()

    def _is_true(v: str) -> bool:
        s = str(v or "").strip().upper()
        if s == "":
            return False
        return s == "TRUE"

    def _status_label(s: str) -> str:
        x = str(s or "").strip().upper()
        if x == "OK":
            return "✅ OK"
        if x == "MISSING":
            return "❌ 누락"
        if x == "AMBIGUOUS":
            return "⚠️ 중복"
        if x == "INCOMPLETE":
            return "⏳ DB미완전"
        if x == "STAFF":
            return "👤 운영진"
        return x or ""

    def _track_label(s: str) -> str:
        x = str(s or "").strip().lower()
        if x == "premium":
            return "프리미엄"
        if x == "staff":
            return "운영진"
        if x == "normal":
            return "일반"
        return x or ""

    def _room_mark(in_room: bool, mode: str, incomplete: bool) -> str:
        """
        mode:
          - required: 반드시 참여해야 함(필수방)
          - optional: 참여해도 되고 안 해도 됨(참고)
          - forbidden: 참여하면 안 됨(권한 확인 필요)
        """
        m = str(mode or "").strip().lower()
        if m == "required":
            if in_room:
                return "✅ 참여"
            if incomplete:
                return "⏳ DB미완전"
            return "❌ 미참여"
        if m == "forbidden":
            if in_room:
                return "⚠️ 참여(비정상)"
            return "✅ 정상"
        # optional
        if in_room:
            return "✅ 참여(참고)"
        return "—"

    # room completeness
    def _room_load(rt: str) -> tuple[str, bool]:
        info = room_infos.get(rt) if isinstance(room_infos.get(rt), dict) else {}
        active = info.get("activeMembersCount")
        loaded = info.get("loadedMembersCount")
        try:
            a = int(active) if active is not None else None
        except Exception:
            a = None
        try:
            l = int(loaded) if loaded is not None else None
        except Exception:
            l = None
        incomplete = bool(info.get("incomplete")) or (a is not None and l is not None and l < a)
        if a is None and l is None:
            return "—", incomplete
        if a is None:
            return f"{l}/—", incomplete
        if l is None:
            return f"—/{a}", incomplete
        return f"{l}/{a}", incomplete

    chat_load, chat_inc = _room_load("chat")
    notice_load, notice_inc = _room_load("notice")
    premium_load, premium_inc = _room_load("premium")
    any_incomplete = chat_inc or notice_inc or premium_inc

    # audit rows → member issues table
    status_counts: dict[str, int] = {}
    track_counts: dict[str, int] = {}

    audit_header = audit_rows[0] if audit_rows else []
    ai = _h2i(audit_header)
    # expected cols (best-effort)
    idx_status = ai.get("auditStatus")
    idx_nick = ai.get("cafeNickname")
    idx_grade = ai.get("grade")
    idx_track = ai.get("track")
    idx_required = ai.get("requiredRooms")
    idx_in_chat = ai.get("in_chat")
    idx_in_notice = ai.get("in_notice")
    idx_in_premium = ai.get("in_premium")
    idx_missing = ai.get("missingRooms")
    idx_chat_cnt = ai.get("chatCount")
    idx_notice_cnt = ai.get("noticeCount")
    idx_premium_cnt = ai.get("premiumCount")

    records: list[dict[str, str]] = []
    for r in audit_rows[1:] if len(audit_rows) > 1 else []:
        st = _cell(r, idx_status)
        tr = _cell(r, idx_track)
        status_counts[st] = int(status_counts.get(st) or 0) + 1
        track_counts[tr] = int(track_counts.get(tr) or 0) + 1

        records.append(
            {
                "status": st,
                "cafeNickname": _cell(r, idx_nick),
                "grade": _cell(r, idx_grade),
                "track": tr,
                "requiredRooms": _cell(r, idx_required),
                "in_chat": _cell(r, idx_in_chat),
                "in_notice": _cell(r, idx_in_notice),
                "in_premium": _cell(r, idx_in_premium),
                "missingRooms": _cell(r, idx_missing),
                "chatCount": _cell(r, idx_chat_cnt),
                "noticeCount": _cell(r, idx_notice_cnt),
                "premiumCount": _cell(r, idx_premium_cnt),
            }
        )

    def _severity_key(st: str) -> int:
        x = str(st or "").strip().upper()
        # issues first
        if x == "MISSING":
            return 1
        if x == "AMBIGUOUS":
            return 2
        if x == "INCOMPLETE":
            return 3
        if x == "OK":
            return 4
        if x == "STAFF":
            return 5
        return 9

    def _record_sort_key(d: dict[str, str]) -> tuple[int, str]:
        base = _severity_key(d.get("status", ""))
        tr = str(d.get("track", "") or "").strip().lower()
        in_premium = _is_true(d.get("in_premium", ""))
        # 일반반이 프리미엄방에 들어온 케이스는 "OK"라도 우선 확인 대상(권한 확인)
        if base >= 4 and tr == "normal" and in_premium:
            base = 2
        return base, d.get("cafeNickname", "")

    records.sort(key=_record_sort_key)

    ok_cnt = int(status_counts.get("OK") or 0)
    missing_cnt = int(status_counts.get("MISSING") or 0)
    ambiguous_cnt = int(status_counts.get("AMBIGUOUS") or 0)
    incomplete_cnt = int(status_counts.get("INCOMPLETE") or 0)
    staff_cnt = int(status_counts.get("STAFF") or 0)
    total_cnt = len(records)
    premium_cnt = int(track_counts.get("premium") or 0)
    normal_cnt = int(track_counts.get("normal") or 0)
    unexpected_premium_set: set[str] = set()
    for d in records:
        tr = str(d.get("track", "") or "").strip().lower()
        if tr != "normal":
            continue
        if not _is_true(d.get("in_premium", "")):
            continue
        cafe_nick = str(d.get("cafeNickname", "") or "").strip()
        if cafe_nick:
            unexpected_premium_set.add(cafe_nick)

    # openchat nickname / matching issues
    _cipher_re = re.compile(r"^[A-Za-z0-9+/=]{16,}$")

    def _looks_like_cipher_nick(s: str) -> bool:
        x = str(s or "").strip()
        if not x:
            return False
        if "(" in x or ")" in x:
            return False
        if " " in x or "\n" in x or "\r" in x or "\t" in x:
            return False
        if re.search(r"[가-힣ㄱ-ㅎㅏ-ㅣ]", x):
            return False
        if not _cipher_re.match(x):
            return False
        # 짧은 토큰/영문 닉네임(일반 텍스트)과 구분하기 위해 '='나 '/'/'+' 중 하나가 포함될 때만 cipher로 본다.
        if ("=" in x) or ("/" in x) or ("+" in x):
            return True
        return False

    def _looks_like_staff_nick(s: str) -> bool:
        x = str(s or "").strip()
        if not x:
            return False
        if "STAFF" in x.upper():
            return True
        if x.startswith("조교"):
            return True
        return False

    oc_header = openchat_rows[0] if openchat_rows else []
    oi = _h2i(oc_header)
    idx_room_label = oi.get("roomLabel")
    idx_room_type = oi.get("roomType")
    idx_openchat_nick = oi.get("openchatNickname")
    idx_parsed = oi.get("parsedCafeNickname")
    idx_parsed_src = oi.get("parsedCafeNicknameSource")
    idx_resolved = oi.get("resolvedCafeNickname")
    idx_resolved_src = oi.get("resolvedCafeNicknameSource")
    idx_needs_change = oi.get("needsNicknameChange")
    idx_name_mask_ok = oi.get("nameMaskOk")

    nick_change: list[list[str]] = []
    nick_unmatched: list[list[str]] = []
    nick_unknown: list[list[str]] = []
    nick_change_set: set[str] = set()
    unknown_set: set[str] = set()
    unmatched_nick_set: set[str] = set()

    cipher_cnt = 0
    total_openchat_rows = 0

    by_room: dict[str, dict[str, int]] = {
        "chat": {"total": 0, "matched": 0, "needsChange": 0, "unmatched": 0},
        "notice": {"total": 0, "matched": 0, "needsChange": 0, "unmatched": 0},
        "premium": {"total": 0, "matched": 0, "needsChange": 0, "unmatched": 0},
    }

    def _nick_change_reason(*, parsed_src: str, resolved_src: str, name_mask_ok: str) -> str:
        ps = str(parsed_src or "").strip().lower()
        rs = str(resolved_src or "").strip().lower()
        mk = str(name_mask_ok or "").strip().upper()
        if ps == "paren" and mk == "FALSE":
            return "이름 마스킹(@) 형식"
        if rs == "slash" or ps == "slash":
            return "슬래시(/) 형식"
        if rs == "exact":
            return "괄호(카페닉) 누락"
        if rs == "token":
            return "공백 토큰 형식"
        if rs == "after_paren":
            return "괄호 위치 변형"
        if rs == "broken_paren":
            return "괄호 누락"
        return rs or ps or "형식"

    for r in openchat_rows[1:] if len(openchat_rows) > 1 else []:
        rt = _cell(r, idx_room_type)
        room_label = _cell(r, idx_room_label) or ROOM_LABEL.get(rt, rt)
        nick = _cell(r, idx_openchat_nick)
        parsed = _cell(r, idx_parsed)
        parsed_src = _cell(r, idx_parsed_src)
        resolved = _cell(r, idx_resolved)
        resolved_src = _cell(r, idx_resolved_src)
        needs_change = _is_true(_cell(r, idx_needs_change))
        name_mask_ok = _cell(r, idx_name_mask_ok)

        if not nick:
            continue

        total_openchat_rows += 1
        staff_like = _looks_like_staff_nick(nick)

        if rt in by_room:
            by_room[rt]["total"] = int(by_room[rt].get("total") or 0) + 1
            if resolved:
                by_room[rt]["matched"] = int(by_room[rt].get("matched") or 0) + 1
            if (not staff_like) and resolved and needs_change:
                by_room[rt]["needsChange"] = int(by_room[rt].get("needsChange") or 0) + 1
            if (not staff_like) and (not resolved) and (not _looks_like_cipher_nick(nick)):
                by_room[rt]["unmatched"] = int(by_room[rt].get("unmatched") or 0) + 1

        if (not staff_like) and parsed and (not resolved):
            unknown_set.add(parsed)
            nick_unknown.append([room_label, nick, parsed, "카페 명단에 없는 카페닉이에요(오타/변경 가능)."])

        if (not staff_like) and resolved and needs_change:
            nick_change_set.add(resolved)
            reason = _nick_change_reason(parsed_src=parsed_src, resolved_src=resolved_src, name_mask_ok=name_mask_ok)
            nick_change.append(
                [
                    room_label,
                    nick,
                    resolved,
                    reason,
                    "예) 정@록(카페닉), 정@@록(카페닉)",
                ]
            )
            continue

        if (not staff_like) and (not resolved):
            if _looks_like_cipher_nick(nick):
                cipher_cnt += 1
            else:
                unmatched_nick_set.add(nick)
                nick_unmatched.append(
                    [
                        room_label,
                        nick,
                        "",
                        "닉네임 끝에 (카페닉) 형식이 필요해요.",
                        "예) 정@록(카페닉), 정@@록(카페닉)",
                    ]
                )

    if max_nickname_issue_rows > 0:
        nick_change = nick_change[: int(max_nickname_issue_rows)]
        nick_unmatched = nick_unmatched[: int(max_nickname_issue_rows)]
        nick_unknown = nick_unknown[: int(max_nickname_issue_rows)]

    # compose overview sheet rows
    rows: List[List[str]] = []
    rows.append([f"강의 운영 v2 (등급 기반 참여 점검) - {course_key}"])
    rows.append([f"최종 갱신: {now_iso}"])
    rows.append(
        [
            "카페 멤버",
            str(total_cnt),
            "OK",
            str(ok_cnt),
            "누락",
            str(missing_cnt),
            "중복",
            str(ambiguous_cnt),
            "DB미완전",
            str(incomplete_cnt),
            "운영진",
            str(staff_cnt),
        ]
    )
    rows.append(["트랙", "일반", str(normal_cnt), "프리미엄", str(premium_cnt), "운영진", str(staff_cnt)])
    rows.append(
        [
            "톡방 DB 로딩",
            "",
            "사담방",
            chat_load,
            "공지방",
            notice_load,
            "프리미엄방",
            premium_load,
        ]
    )
    rows.append(
        [
            "톡방 데이터 소스",
            "",
            "사담방",
            "DB(IRIS)",
            "공지방",
            "DB(IRIS)",
            "프리미엄방",
            "DB(IRIS)",
        ]
    )
    rows.append(
        [
            "톡방-카페 매칭(현재)",
            "",
            "사담방",
            f"{by_room['chat']['matched']}/{by_room['chat']['total']}",
            "공지방",
            f"{by_room['notice']['matched']}/{by_room['notice']['total']}",
            "프리미엄방",
            f"{by_room['premium']['matched']}/{by_room['premium']['total']}",
        ]
    )
    rows.append(
        [
            "톡방 닉네임 이슈(현재)",
            "",
            "변경요청(매칭됨)",
            str(len(nick_change_set)),
            "카페명단 불일치",
            str(len(unknown_set)),
            "매칭불가",
            str(len(unmatched_nick_set)),
        ]
    )
    rows.append(["표기", "✅ 참여", "❌ 미참여(필수)", "✅ 정상(비대상)", "⚠️ 참여(비정상)", "⏳ DB미완전"])
    if any_incomplete:
        rows.append(["주의", "loaded < active 상태면 결과가 DB미완전(INCOMPLETE)로 표시될 수 있어요."])
    elif cipher_cnt > 0 and total_openchat_rows > 0 and (cipher_cnt / max(1, total_openchat_rows)) >= 0.6:
        rows.append(["주의", "톡방 닉네임이 암호화 형태로 저장되어 괄호(카페닉) 점검이 제한될 수 있어요."])
    else:
        rows.append(["", ""])

    rows.append(["🧭 운영자 액션(우선 처리)"])
    rows.append(
        [
            "필수방 미참여",
            str(missing_cnt),
            "닉네임 변경 요청",
            str(len(nick_change_set)),
            "일반반 프리미엄 참여",
            str(len(unexpected_premium_set)),
        ]
    )
    rows.append(
        [
            "중복/동명이인",
            str(ambiguous_cnt),
            "카페명단 불일치",
            str(len(unknown_set)),
            "톡방 매칭불가",
            str(len(unmatched_nick_set)),
        ]
    )

    rows.append([""])
    rows.append(["📌 멤버별 방 참여 현황(카페 기준)"])
    rows.append(["상태", "카페닉", "등급", "트랙", "필수방", "사담방", "공지방", "프리미엄방", "누락", "메모"])

    for d in records:
        st = d.get("status", "")
        st_u = str(st or "").strip().upper()
        track = str(d.get("track", "") or "").strip().lower()
        in_chat = _is_true(d.get("in_chat", ""))
        in_notice = _is_true(d.get("in_notice", ""))
        in_premium = _is_true(d.get("in_premium", ""))

        status_display = _status_label(st)
        memo = ""
        if st_u == "AMBIGUOUS":
            memo = (
                "중복 매칭 "
                f"(사담 {d.get('chatCount','')}, 공지 {d.get('noticeCount','')}, 프리미엄 {d.get('premiumCount','')})"
            ).strip()
        elif st_u == "INCOMPLETE":
            memo = "톡방 DB 미완전(loaded < active)"

        if track == "normal" and in_premium:
            status_display = "⚠️ 권한 확인"
            memo = (memo + "; " if memo else "") + "일반반인데 프리미엄방 참여(권한 확인)"

        mode_chat = "required" if track in ("normal", "premium") else "optional"
        mode_notice = "required" if track in ("normal", "premium") else "optional"
        if track == "premium":
            mode_premium = "required"
        elif track == "normal":
            mode_premium = "forbidden"
        else:
            mode_premium = "optional"

        missing_display = d.get("missingRooms", "")

        rows.append(
            [
                status_display,
                d.get("cafeNickname", ""),
                d.get("grade", ""),
                _track_label(track),
                d.get("requiredRooms", ""),
                _room_mark(in_chat, mode_chat, chat_inc),
                _room_mark(in_notice, mode_notice, notice_inc),
                _room_mark(in_premium, mode_premium, premium_inc),
                missing_display,
                memo,
            ]
        )

    rows.append([""])
    rows.append(["🧩 닉네임 변경 요청(참여 인식됨)"])
    rows.append(["방", "닉네임", "매칭된 카페닉", "사유", "예시"])
    if nick_change:
        rows.extend(nick_change)
    else:
        rows.append(["(없음)", "", "", "", ""])

    rows.append([""])
    rows.append(["🧩 톡방 닉네임 매칭 불가"])
    rows.append(["방", "닉네임", "추출된 카페닉", "안내", "예시"])
    if cipher_cnt > 0:
        rows.append(["(참고)", f"닉네임이 암호화 형태로 저장된 항목: {cipher_cnt}명", "", "형식 점검 불가", ""])
    if nick_unmatched:
        rows.extend(nick_unmatched)
    elif cipher_cnt <= 0:
        rows.append(["(없음)", "", "", "", ""])

    rows.append([""])
    rows.append(["🔎 카페 명단에 없는 카페닉(톡방 닉네임 기준)"])
    rows.append(["방", "닉네임", "추출된 카페닉", "안내"])
    if nick_unknown:
        rows.extend(nick_unknown)
    else:
        rows.append(["(없음)", "", "", ""])

    # 최근 변경 이력(AUDIT_LOG) 프리뷰(통합 탭에서 바로 확인)
    logs = [r for r in (recent_audit_log_rows or []) if isinstance(r, list) and len(r) >= 8]
    if logs:
        def _parse_map(s: str) -> dict[str, str]:
            try:
                obj = json.loads(str(s or "").strip() or "{}")
            except Exception:
                return {}
            if not isinstance(obj, dict):
                return {}
            return {str(k): str(v) for k, v in obj.items()}

        def _action_label(s: str) -> str:
            x = str(s or "").strip().upper()
            if x == "INSERT":
                return "추가"
            if x == "UPDATE":
                return "변경"
            if x == "LEFT":
                return "이탈"
            if x == "REJOIN":
                return "재참여"
            if x == "WARN":
                return "경고"
            if x == "SUMMARY":
                return "요약"
            if x == "INIT":
                return "초기"
            return x

        max_n = max(0, int(max_recent_audit_log_rows))
        logs = logs[-max_n:] if max_n > 0 else []

        # 요약(SUMMARY/WARN) 먼저, 상세(INSERT/UPDATE/LEFT/REJOIN) 다음
        summary_rows = [r for r in logs if str(r[3] or "").strip().upper() in ("SUMMARY", "WARN")]
        detail_rows = [r for r in logs if str(r[3] or "").strip().upper() in ("INSERT", "UPDATE", "LEFT", "REJOIN")]

        rows.append([""])
        rows.append(["🧾 최근 변경 이력(AUDIT_LOG)"])
        rows.append(["시간", "대상", "탭", "동작", "변경 필드", "변경 요약"])

        for r in (summary_rows + detail_rows):
            ts = str(r[0] or "").strip()
            tab = str(r[2] or "").strip()
            action = str(r[3] or "").strip()
            fields = str(r[5] or "").strip()
            old_map = _parse_map(str(r[6] or ""))
            new_map = _parse_map(str(r[7] or ""))

            target = (
                str(new_map.get("cafeNickname") or old_map.get("cafeNickname") or "").strip()
                or str(new_map.get("openchatNickname") or old_map.get("openchatNickname") or "").strip()
            )
            if not target:
                target = "-"

            parts: list[str] = []
            for f in [x.strip() for x in (fields.split(",") if fields else []) if x.strip()]:
                o = str(old_map.get(f, "") or "").strip()
                n = str(new_map.get(f, "") or "").strip()
                if o == n:
                    continue
                if o and n:
                    parts.append(f"{f}: {o} → {n}")
                elif n:
                    parts.append(f"{f}: {n}")
                elif o:
                    parts.append(f"{f}: (삭제됨)")
                else:
                    parts.append(f"{f}")
            summary = "; ".join(parts).strip()
            if not summary:
                # SUMMARY/WARN 등은 fields에 요약 문자열이 들어오기도 한다.
                summary = fields
            if len(summary) > 220:
                summary = summary[:220] + "…"

            rows.append([ts, target, tab, _action_label(action), fields, summary])

    return rows
