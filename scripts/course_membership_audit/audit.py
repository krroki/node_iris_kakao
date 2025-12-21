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


def classify_track_from_payment(ssot_grade: str, ssot_kind: str) -> str:
    """
    결제 SSOT(구글 시트) 기준 트랙 판별.

    - staff: kind에 STAFF/스태프/운영/조교 등 포함
    - premium: grade에 프리미엄 포함 또는 kind에 비지니스 포함
    - default: normal

    NOTE:
    - 결제 시트의 "카페 등급"은 강의/기간에 따라 표기가 바뀔 수 있어 보수적으로 처리한다.
    """
    k_raw = str(ssot_kind or "").strip()
    g_raw = str(ssot_grade or "").strip()
    k = normalize_cafe_nickname(k_raw).lower()
    g = normalize_cafe_nickname(g_raw).lower()

    if "staff" in k or ("스태프" in k_raw) or ("스탭" in k_raw) or ("조교" in k_raw) or ("운영" in k_raw):
        return "staff"

    if ("프리미엄" in g_raw) or ("프리미엄" in k_raw) or ("비지니스" in k_raw) or ("business" in k):
        return "premium"

    # 새싹/일반/기타는 모두 normal 취급
    return "normal"


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


def build_canonical_cafe_nick_set(cafe_nicks: set[str], ssot_nicks: set[str]) -> set[str]:
    """
    공백 차이로 동일 닉이 중복 등록되면(norm key가 2개 이상) 매칭이 '유일' 조건을 만족하지 못해
    참여 인식이 깨지는 문제가 있어, norm(공백 제거) 기준으로 1개만 남긴 canonical set을 만든다.

    우선순위: ssot(결제) 닉네임 > 카페 스냅샷 닉네임
    """
    by_norm: dict[str, str] = {}
    for raw in cafe_nicks or set():
        nick = str(raw or "").strip()
        if not nick:
            continue
        k = normalize_cafe_nickname(nick)
        if not k:
            continue
        if k not in by_norm:
            by_norm[k] = nick

    for raw in ssot_nicks or set():
        nick = str(raw or "").strip()
        if not nick:
            continue
        k = normalize_cafe_nickname(nick)
        if not k:
            continue
        by_norm[k] = nick

    return set(by_norm.values())


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

    # "(카페닉)" 패턴이 맞지만, 괄호 안이 카페닉이 아닌 경우(역전):
    # - 예: "카페닉(이름마스킹)" 형태로 들어오는 케이스가 있어 prefix를 카페닉 후보로 본다.
    # - 단, 후보가 cafe_nick_set에 존재(또는 공백 정규화로 유일 매칭)할 때만 사용한다.
    if "(" in s and ")" in s and s.endswith(")"):
        prefix = s.rsplit("(", 1)[0].strip()
        if prefix and prefix in cafe_nick_set:
            return prefix, "prefix_before_paren"
        nu = _norm_unique(prefix)
        if nu:
            nick, label = nu
            return nick, f"prefix_before_paren_{label}"

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


def build_ssot_raw_rows(*, course_key: str, fetched_at: str, ssot_records: list[dict]) -> List[List[str]]:
    rows: List[List[str]] = [
        [
            "courseKey",
            "fetchedAt",
            "ssotUserId",
            "ssotNickname",
            "ssotGrade",
            "ssotTrack",
            "ssotKind",
            "sourceRow",
        ]
    ]
    for r in ssot_records or []:
        if not isinstance(r, dict):
            continue
        rows.append(
            [
                str(course_key or "").strip(),
                str(fetched_at or "").strip(),
                str(r.get("ssotUserId") or "").strip(),
                str(r.get("ssotNickname") or "").strip(),
                str(r.get("ssotGrade") or "").strip(),
                str(r.get("ssotTrack") or "").strip(),
                str(r.get("ssotKind") or "").strip(),
                str(r.get("sourceRow") or "").strip(),
            ]
        )
    return rows


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
    ssot_records: list[dict] | None = None,
) -> List[List[str]]:
    cafe_fetched_at = str(cafe_snapshot.get("fetchedAt") or "").strip()
    club_id = str(cafe_snapshot.get("clubId") or "").strip()
    cafe_members = cafe_snapshot.get("members") if isinstance(cafe_snapshot.get("members"), list) else []
    cafe_nick_set = {
        str(it.get("cafeNickname") or "").strip()
        for it in cafe_members
        if isinstance(it, dict) and str(it.get("cafeNickname") or "").strip()
    }
    ssot_list = [r for r in (ssot_records or []) if isinstance(r, dict)]
    ssot_nick_set = {str(r.get("ssotNickname") or "").strip() for r in ssot_list if str(r.get("ssotNickname") or "").strip()}
    canonical_cafe_nick_set = build_canonical_cafe_nick_set(cafe_nick_set, ssot_nick_set)
    cafe_nick_index = build_cafe_nickname_index(canonical_cafe_nick_set)

    # room completeness(방 단위): requiredRooms에만 적용해야 normal/premium 판정이 과도하게 INCOMPLETE로 굳지 않는다.
    incomplete_by_room: dict[str, bool] = {}
    for rt in ["chat", "notice", "premium"]:
        info = room_infos.get(rt) if isinstance(room_infos.get(rt), dict) else {}
        incomplete_by_room[rt] = bool(info.get("incomplete"))

    # build membership maps: norm(cafeNick) -> count
    counts: dict[str, dict[str, int]] = {"chat": {}, "notice": {}, "premium": {}}
    for rt in ["chat", "notice", "premium"]:
        for m in members_by_room.get(rt, []) or []:
            if not isinstance(m, dict):
                continue
            nick = str(m.get("nickname") or "").strip()
            cafe_nick, _src = resolve_cafe_nickname_from_openchat(nick, canonical_cafe_nick_set, cafe_nick_index)
            if not cafe_nick:
                continue
            k = normalize_cafe_nickname(cafe_nick)
            if not k:
                continue
            bucket = counts[rt]
            bucket[k] = int(bucket.get(k) or 0) + 1

    rows: List[List[str]] = [
        [
            "courseKey",
            "clubId",
            "auditKey",
            "cafeNickname",
            "grade",
            "track",
            "ssotPresent",
            "inCafe",
            "requiredRooms",
            "in_chat",
            "in_notice",
            "in_premium",
            "missingRooms",
            "auditStatus",
            "chatCount",
            "noticeCount",
            "premiumCount",
            "ssotUserId",
            "ssotKind",
            "ssotGrade",
            "ssotTrack",
            "cafeUserId",
            "cafeGrade",
            "cafeUpdatedAt",
            "openchatUpdatedAt",
        ]
    ]

    # helpers
    def _required_rooms(track: str) -> list[str]:
        t = str(track or "").strip().lower()
        if t == "premium":
            return ["chat", "notice", "premium"]
        if t == "normal":
            return ["chat", "notice"]
        return []

    def _audit_status(*, track: str, required: list[str], counts_chat: int, counts_notice: int, counts_premium: int) -> str:
        t = str(track or "").strip().lower()
        if t == "staff":
            return "STAFF"
        required_incomplete = any(incomplete_by_room.get(x, False) for x in required)
        if required_incomplete:
            return "INCOMPLETE"
        if (counts_chat > 1) or (counts_notice > 1) or (counts_premium > 1):
            return "AMBIGUOUS"
        return "MISSING" if _missing_rooms(required, counts_chat, counts_notice, counts_premium) else "OK"

    def _missing_rooms(required: list[str], c_chat: int, c_notice: int, c_premium: int) -> list[str]:
        missing: list[str] = []
        if "chat" in required and not incomplete_by_room.get("chat", False) and (c_chat <= 0):
            missing.append(ROOM_LABEL["chat"])
        if "notice" in required and not incomplete_by_room.get("notice", False) and (c_notice <= 0):
            missing.append(ROOM_LABEL["notice"])
        if "premium" in required and not incomplete_by_room.get("premium", False) and (c_premium <= 0):
            missing.append(ROOM_LABEL["premium"])
        return missing

    # cafe index: norm nick -> cafe member dict(첫 항목)
    cafe_by_norm: dict[str, list[dict]] = {}
    for it in cafe_members:
        if not isinstance(it, dict):
            continue
        nn = str(it.get("cafeNickname") or "").strip()
        k = normalize_cafe_nickname(nn)
        if not k:
            continue
        cafe_by_norm.setdefault(k, []).append(it)

    # ssot index: norm nick -> record
    ssot_by_norm: dict[str, dict] = {}
    for r in ssot_list:
        nn = str(r.get("ssotNickname") or "").strip()
        k = normalize_cafe_nickname(nn)
        if not k:
            continue
        if k not in ssot_by_norm:
            ssot_by_norm[k] = r

    # 1) SSOT(결제) 기준 멤버
    for r in ssot_list:
        ssot_user_id = str(r.get("ssotUserId") or "").strip()
        ssot_kind = str(r.get("ssotKind") or "").strip()
        ssot_grade = str(r.get("ssotGrade") or "").strip()
        ssot_track = str(r.get("ssotTrack") or "").strip() or classify_track_from_payment(ssot_grade, ssot_kind)
        ssot_nick = str(r.get("ssotNickname") or "").strip()
        norm = normalize_cafe_nickname(ssot_nick)

        cafe_match = (cafe_by_norm.get(norm) or []) if norm else []
        in_cafe = bool(cafe_match)
        cafe_user_id = str((cafe_match[0].get("cafeUserId") if cafe_match else "") or "").strip()
        cafe_grade_actual = str((cafe_match[0].get("grade") if cafe_match else "") or "").strip()

        c_chat = int(counts["chat"].get(norm) or 0) if norm else 0
        c_notice = int(counts["notice"].get(norm) or 0) if norm else 0
        c_premium = int(counts["premium"].get(norm) or 0) if norm else 0

        in_chat = c_chat > 0
        in_notice = c_notice > 0
        in_premium = c_premium > 0

        required = _required_rooms(ssot_track)
        missing = _missing_rooms(required, c_chat, c_notice, c_premium)
        audit_status = _audit_status(track=ssot_track, required=required, counts_chat=c_chat, counts_notice=c_notice, counts_premium=c_premium)

        audit_key = f"SSOT:{ssot_user_id}" if ssot_user_id else (f"SSOT_NICK:{norm}" if norm else "SSOT:UNKNOWN")

        rows.append(
            [
                course_key,
                club_id,
                audit_key,
                ssot_nick,
                ssot_grade,
                ssot_track,
                "TRUE",
                "TRUE" if in_cafe else "FALSE",
                ",".join([ROOM_LABEL.get(x, x) for x in required]),
                "TRUE" if in_chat else "FALSE",
                "TRUE" if in_notice else "FALSE",
                "TRUE" if in_premium else "FALSE",
                ",".join(missing),
                audit_status,
                str(c_chat),
                str(c_notice),
                str(c_premium),
                ssot_user_id,
                ssot_kind,
                ssot_grade,
                ssot_track,
                cafe_user_id,
                cafe_grade_actual,
                cafe_fetched_at,
                openchat_fetched_at,
            ]
        )

    # 2) 카페에는 있으나 SSOT에 없는 멤버(참고용)
    seen_cafe_norm: set[str] = set()
    ssot_norm_set = set(ssot_by_norm.keys())
    for it in cafe_members:
        if not isinstance(it, dict):
            continue
        cafe_nick = str(it.get("cafeNickname") or "").strip()
        norm = normalize_cafe_nickname(cafe_nick)
        if not norm or norm in seen_cafe_norm:
            continue
        seen_cafe_norm.add(norm)
        if norm in ssot_norm_set:
            continue

        cafe_grade = str(it.get("grade") or "").strip()
        track = classify_track(cafe_grade, rules)

        c_chat = int(counts["chat"].get(norm) or 0)
        c_notice = int(counts["notice"].get(norm) or 0)
        c_premium = int(counts["premium"].get(norm) or 0)

        in_chat = c_chat > 0
        in_notice = c_notice > 0
        in_premium = c_premium > 0

        required = _required_rooms(track)
        missing = _missing_rooms(required, c_chat, c_notice, c_premium)
        audit_status = _audit_status(track=track, required=required, counts_chat=c_chat, counts_notice=c_notice, counts_premium=c_premium)

        cafe_user_id = str(it.get("cafeUserId") or "").strip()
        audit_key = f"CAFE:{cafe_user_id}" if cafe_user_id else (f"CAFE_NICK:{norm}" if norm else "CAFE:UNKNOWN")

        rows.append(
            [
                course_key,
                club_id,
                audit_key,
                cafe_nick,
                cafe_grade,
                track,
                "FALSE",
                "TRUE",
                ",".join([ROOM_LABEL.get(x, x) for x in required]),
                "TRUE" if in_chat else "FALSE",
                "TRUE" if in_notice else "FALSE",
                "TRUE" if in_premium else "FALSE",
                ",".join(missing),
                audit_status,
                str(c_chat),
                str(c_notice),
                str(c_premium),
                "",
                "",
                "",
                "",
                cafe_user_id,
                cafe_grade,
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
    ssot_records: list[dict] | None = None,
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
            return "⏳ 목록 불완료"
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
                return "⏳ 목록 불완료"
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
    idx_ssot_present = ai.get("ssotPresent")
    idx_in_cafe = ai.get("inCafe")

    records: list[dict[str, str]] = []
    for r in audit_rows[1:] if len(audit_rows) > 1 else []:
        st = _cell(r, idx_status)
        tr = _cell(r, idx_track)

        records.append(
            {
                "status": st,
                "cafeNickname": _cell(r, idx_nick),
                "grade": _cell(r, idx_grade),
                "track": tr,
                "ssotPresent": _cell(r, idx_ssot_present),
                "inCafe": _cell(r, idx_in_cafe),
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

    # 결제 SSOT가 연결된 코스라면, 운영 표/액션은 "SSOT present"만 기준으로 한다.
    has_ssot = idx_ssot_present is not None
    view_records = [d for d in records if _is_true(d.get("ssotPresent", ""))] if has_ssot else list(records)
    cafe_only_cnt = (len(records) - len(view_records)) if has_ssot else 0

    # 집계는 view_records(SSOT 기준)로만 수행
    for d in view_records:
        st = str(d.get("status") or "").strip().upper()
        tr = str(d.get("track") or "").strip().lower()
        status_counts[st] = int(status_counts.get(st) or 0) + 1
        track_counts[tr] = int(track_counts.get(tr) or 0) + 1

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

    view_records.sort(key=_record_sort_key)

    ok_cnt = int(status_counts.get("OK") or 0)
    missing_cnt = int(status_counts.get("MISSING") or 0)
    ambiguous_cnt = int(status_counts.get("AMBIGUOUS") or 0)
    incomplete_cnt = int(status_counts.get("INCOMPLETE") or 0)
    staff_cnt = int(status_counts.get("STAFF") or 0)
    total_cnt = len(view_records)
    premium_cnt = int(track_counts.get("premium") or 0)
    normal_cnt = int(track_counts.get("normal") or 0)

    cafe_missing_cnt = 0
    for d in view_records:
        if not _is_true(d.get("inCafe", "TRUE")):
            cafe_missing_cnt += 1

    ssot_missing_cnt = 0
    if has_ssot:
        for d in records:
            if _is_true(d.get("ssotPresent", "")):
                continue
            tr = str(d.get("track") or "").strip().lower()
            if tr == "staff":
                continue
            ssot_missing_cnt += 1

    unexpected_premium_set: set[str] = set()
    for d in view_records:
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
        if ("스태프" in x) or ("스탭" in x):
            return True
        if ("운영진" in x) or ("운영자" in x) or ("부운영" in x):
            return True
        if "매니저" in x:
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

    ssot_norm_set: set[str] = set()
    for r in (ssot_records or []):
        if not isinstance(r, dict):
            continue
        nn = str(r.get("ssotNickname") or "").strip()
        k = normalize_cafe_nickname(nn)
        if k:
            ssot_norm_set.add(k)

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
            if ssot_norm_set:
                rk = normalize_cafe_nickname(resolved)
                if rk and rk not in ssot_norm_set:
                    continue
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
    rows.append([f"강의 운영 v2 (결제 SSOT 기반 참여 점검) - {course_key}"])
    rows.append([f"최종 갱신: {now_iso}"])
    rows.append(
        [
            "결제 SSOT",
            str(total_cnt),
            "OK",
            str(ok_cnt),
            "누락",
            str(missing_cnt),
            "중복",
            str(ambiguous_cnt),
            "목록 불완료",
            str(incomplete_cnt),
            "운영진",
            str(staff_cnt),
        ]
    )
    rows.append(["트랙", "일반", str(normal_cnt), "프리미엄", str(premium_cnt), "운영진", str(staff_cnt)])
    if has_ssot:
        rows.append(
            [
                "참고",
                "카페에만 있는 멤버",
                str(cafe_only_cnt),
                "카페 미가입(SSOT)",
                str(cafe_missing_cnt),
                "결제/SSOT 누락(카페)",
                str(ssot_missing_cnt),
            ]
        )
    rows.append(
        [
            "멤버 목록(톡방)",
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
            "데이터 소스(톡방)",
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
            "매칭(톡방→카페, 현재)",
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
            "닉네임 이슈(현재)",
            "",
            "변경요청(매칭됨)",
            str(len(nick_change_set)),
            "카페명단 불일치",
            str(len(unknown_set)),
            "매칭불가",
            str(len(unmatched_nick_set)),
        ]
    )
    rows.append(["표기", "✅ 참여", "❌ 미참여(필수)", "✅ 정상(비대상)", "⚠️ 참여(비정상)", "⏳ 목록 불완료"])
    if any_incomplete:
        rows.append(["주의", "멤버 목록을 끝까지 불러오지 못한 방이 있어 일부 결과가 '목록 불완료'로 표시될 수 있어요."])
    elif cipher_cnt > 0 and total_openchat_rows > 0 and (cipher_cnt / max(1, total_openchat_rows)) >= 0.6:
        rows.append(["주의", "톡방 닉네임이 암호화 형태로 저장되어 괄호(카페닉) 점검이 제한될 수 있어요."])
    else:
        rows.append(["", ""])

    rows.append(["🧭 운영자 액션(우선 처리)"])
    rows.append(
        [
            "필수방 미참여(SSOT)",
            str(missing_cnt),
            "카페 미가입(SSOT)",
            str(cafe_missing_cnt),
            "결제/SSOT 누락(카페)",
            str(ssot_missing_cnt),
        ]
    )
    rows.append(
        [
            "닉네임 변경 요청(SSOT)",
            str(len(nick_change_set)),
            "중복/동명이인(SSOT)",
            str(ambiguous_cnt),
            "일반반 프리미엄 참여(SSOT)",
            str(len(unexpected_premium_set)),
        ]
    )

    rows.append([""])
    rows.append(["📌 멤버별 방 참여 현황(SSOT 기준)"])
    rows.append(["상태", "카페닉", "SSOT 등급", "트랙", "카페", "필수방", "사담방", "공지방", "프리미엄방", "누락", "메모"])

    for d in view_records:
        st = d.get("status", "")
        st_u = str(st or "").strip().upper()
        track = str(d.get("track", "") or "").strip().lower()
        in_chat = _is_true(d.get("in_chat", ""))
        in_notice = _is_true(d.get("in_notice", ""))
        in_premium = _is_true(d.get("in_premium", ""))
        in_cafe = _is_true(d.get("inCafe", "TRUE"))

        status_display = _status_label(st)
        memo = ""
        if st_u == "AMBIGUOUS":
            memo = (
                "중복 매칭 "
                f"(사담 {d.get('chatCount','')}, 공지 {d.get('noticeCount','')}, 프리미엄 {d.get('premiumCount','')})"
            ).strip()
        elif st_u == "INCOMPLETE":
            memo = "톡방 멤버 목록을 아직 다 불러오지 못했어요."

        if (not in_cafe) and track != "staff":
            status_display = "⚠️ 카페 확인"
            memo = (memo + "; " if memo else "") + "SSOT에는 있는데 카페 명단에 없어요."

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
        cafe_display = "✅ 가입" if in_cafe else "❌ 미가입"

        rows.append(
            [
                status_display,
                d.get("cafeNickname", ""),
                d.get("grade", ""),
                _track_label(track),
                cafe_display,
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


def build_actions_rows(
    *,
    course_key: str,
    now_iso: str,
    cafe_snapshot: dict,
    room_infos: dict[str, dict],
    audit_rows: List[List[str]],
    openchat_rows: List[List[str]],
    ssot_records: list[dict] | None = None,
    max_rows_per_section: int = 300,
    max_nickname_issue_rows: int = 600,
) -> List[List[str]]:
    """
    ACTIONS 탭(derived view):
    - 운영진이 "지금 당장 해야 할 일"을 우선순위/카테고리로 정리해준다.
    - 값은 매번 clear + 전체 재작성한다(수동 편집 컬럼을 두지 않는다).
    """

    cafe_members = cafe_snapshot.get("members") if isinstance(cafe_snapshot.get("members"), list) else []
    cafe_nick_set = {
        str(it.get("cafeNickname") or "").strip()
        for it in cafe_members
        if isinstance(it, dict) and str(it.get("cafeNickname") or "").strip()
    }
    ssot_list = [r for r in (ssot_records or []) if isinstance(r, dict)]
    ssot_nick_set = {str(r.get("ssotNickname") or "").strip() for r in ssot_list if str(r.get("ssotNickname") or "").strip()}
    cafe_nick_set = build_canonical_cafe_nick_set(cafe_nick_set, ssot_nick_set)

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

    def _track_label(s: str) -> str:
        x = str(s or "").strip().lower()
        if x == "premium":
            return "프리미엄"
        if x == "staff":
            return "운영진"
        if x == "normal":
            return "일반"
        return x or ""

    def _priority_label(p: int) -> str:
        n = int(p)
        if n <= 0:
            return "🚨 먼저(P0)"
        if n == 1:
            return "🟥 오늘(P1)"
        if n == 2:
            return "🟧 확인(P2)"
        return "🟦 정리(P3)"

    def _join_short(xs: list[str], *, limit: int = 2) -> str:
        ys = [str(x).strip() for x in (xs or []) if str(x).strip()]
        if not ys:
            return ""
        if len(ys) <= limit:
            return ", ".join(ys)
        return ", ".join(ys[:limit]) + f" 외 {len(ys) - limit}명"

    # room states
    def _room_state(rt: str) -> dict[str, object]:
        info = room_infos.get(rt) if isinstance(room_infos.get(rt), dict) else {}
        room_id = str(info.get("roomId") or "").strip()
        room_name = str(info.get("roomName") or "").strip() or ROOM_LABEL.get(rt, rt)
        active = info.get("activeMembersCount")
        loaded = info.get("loadedMembersCount")
        try:
            a = int(active) if active is not None and str(active).strip() != "" else None
        except Exception:
            a = None
        try:
            l = int(loaded) if loaded is not None and str(loaded).strip() != "" else None
        except Exception:
            l = None
        incomplete = bool(info.get("incomplete")) or (a is not None and l is not None and l < a)
        if a is None and l is None:
            disp = "?"
        elif a is None:
            disp = f"{l}/?"
        elif l is None:
            disp = f"?/{a}"
        else:
            disp = f"{l}/{a}"
        return {
            "roomType": rt,
            "roomLabel": ROOM_LABEL.get(rt, rt),
            "roomId": room_id,
            "roomName": room_name,
            "active": a,
            "loaded": l,
            "incomplete": incomplete,
            "loadDisplay": disp,
        }

    room_chat = _room_state("chat")
    room_notice = _room_state("notice")
    room_premium = _room_state("premium")

    # audit records
    audit_header = audit_rows[0] if audit_rows else []
    ai = _h2i(audit_header)
    records: list[dict[str, str]] = []
    for r in audit_rows[1:] if len(audit_rows) > 1 else []:
        records.append(
            {
                "status": _cell(r, ai.get("auditStatus")),
                "cafeNickname": _cell(r, ai.get("cafeNickname")),
                "grade": _cell(r, ai.get("grade")),
                "track": _cell(r, ai.get("track")),
                "ssotPresent": _cell(r, ai.get("ssotPresent")),
                "inCafe": _cell(r, ai.get("inCafe")),
                "requiredRooms": _cell(r, ai.get("requiredRooms")),
                "missingRooms": _cell(r, ai.get("missingRooms")),
                "in_chat": _cell(r, ai.get("in_chat")),
                "in_notice": _cell(r, ai.get("in_notice")),
                "in_premium": _cell(r, ai.get("in_premium")),
                "chatCount": _cell(r, ai.get("chatCount")),
                "noticeCount": _cell(r, ai.get("noticeCount")),
                "premiumCount": _cell(r, ai.get("premiumCount")),
            }
        )

    has_ssot = ai.get("ssotPresent") is not None
    view_records = [d for d in records if _is_true(d.get("ssotPresent", ""))] if has_ssot else list(records)

    missing_records = [
        d
        for d in view_records
        if str(d.get("status", "")).strip().upper() == "MISSING" and str(d.get("track") or "").strip().lower() != "staff"
    ]
    ambiguous_records = [
        d
        for d in view_records
        if str(d.get("status", "")).strip().upper() == "AMBIGUOUS" and str(d.get("track") or "").strip().lower() != "staff"
    ]
    incomplete_records = [
        d
        for d in view_records
        if str(d.get("status", "")).strip().upper() == "INCOMPLETE" and str(d.get("track") or "").strip().lower() != "staff"
    ]

    cafe_missing_records = [
        d
        for d in view_records
        if (not _is_true(d.get("inCafe", "TRUE"))) and str(d.get("track") or "").strip().lower() != "staff"
    ]
    ssot_missing_records = [
        d
        for d in records
        if has_ssot and (not _is_true(d.get("ssotPresent", ""))) and str(d.get("track") or "").strip().lower() != "staff"
    ]

    staff_norm_set = {
        normalize_cafe_nickname(str(d.get("cafeNickname") or "").strip())
        for d in view_records
        if str(d.get("track") or "").strip().lower() == "staff" and str(d.get("cafeNickname") or "").strip()
    }

    unexpected_premium_records: list[dict[str, str]] = []
    for d in view_records:
        tr = str(d.get("track") or "").strip().lower()
        if tr != "normal":
            continue
        if _is_true(d.get("in_premium", "")):
            unexpected_premium_records.append(d)

    # openchat -> cafeNick -> nicks by room (참고용)
    oc_header = openchat_rows[0] if openchat_rows else []
    oi = _h2i(oc_header)
    idx_room_type = oi.get("roomType")
    idx_room_label = oi.get("roomLabel")
    idx_openchat_nick = oi.get("openchatNickname")
    idx_parsed = oi.get("parsedCafeNickname")
    idx_parsed_src = oi.get("parsedCafeNicknameSource")
    idx_resolved = oi.get("resolvedCafeNickname")
    idx_needs_change = oi.get("needsNicknameChange")
    idx_name_mask_prefix = oi.get("nameMaskPrefix")
    idx_name_mask_ok = oi.get("nameMaskOk")

    ssot_norm_set: set[str] = set()
    for r in (ssot_records or []):
        if not isinstance(r, dict):
            continue
        nn = str(r.get("ssotNickname") or "").strip()
        k = normalize_cafe_nickname(nn)
        if k:
            ssot_norm_set.add(k)

    openchat_by_cafe: dict[str, dict[str, list[str]]] = {}

    def _attach_openchat(cafe_nick: str, rt: str, openchat_nick: str) -> None:
        cn = str(cafe_nick or "").strip()
        if not cn:
            return
        t = str(rt or "").strip().lower()
        if t not in ("chat", "notice", "premium"):
            return
        nn = str(openchat_nick or "").strip()
        if not nn:
            return
        if cn not in openchat_by_cafe:
            openchat_by_cafe[cn] = {"chat": [], "notice": [], "premium": []}
        openchat_by_cafe[cn][t].append(nn)

    # nickname issues
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
        if ("=" in x) or ("/" in x) or ("+" in x):
            return True
        return False

    def _looks_like_staff_nick(s: str) -> bool:
        x = str(s or "").strip()
        if not x:
            return False
        if "STAFF" in x.upper():
            return True
        if ("스태프" in x) or ("스탭" in x):
            return True
        if ("운영진" in x) or ("운영자" in x) or ("부운영" in x):
            return True
        if "매니저" in x:
            return True
        if x.startswith("조교"):
            return True
        return False

    def _coerce_name_mask_prefix(raw_prefix: str) -> str:
        s = str(raw_prefix or "").strip()
        if not s:
            return ""
        if is_valid_name_mask_prefix(s):
            return s
        # 흔한 오류(*,0 등) → '@'로 치환 가능한 형태면 보수적으로 보정한다.
        s2 = re.sub(r"\s+", "", s)
        if not s2:
            return ""
        # prefix는 '@'를 포함할 수 있으므로, '@'가 아닌 문자를 기준으로 양끝을 잡는다.
        chars = [ch for ch in s2 if ch != "@"]
        if len(chars) < 2:
            return ""
        first = chars[0]
        last = chars[-1]
        if first == "@" or last == "@":
            return ""
        at_cnt = max(1, len(chars) - 2)
        cand = f"{first}{'@' * at_cnt}{last}"
        return cand if is_valid_name_mask_prefix(cand) else ""

    def _recommend_nickname(openchat_nick: str, parsed_src: str, resolved_cafe_nick: str, name_mask_prefix: str) -> str:
        cafe_nick = str(resolved_cafe_nick or "").strip()
        if not cafe_nick:
            return ""
        src = str(parsed_src or "").strip().lower()

        raw_prefix = ""
        if src == "slash" and "/" in str(openchat_nick or ""):
            raw_prefix = str(openchat_nick).rsplit("/", 1)[0].strip()
        elif src == "paren":
            raw_prefix = str(name_mask_prefix or "").strip()

        prefix = _coerce_name_mask_prefix(raw_prefix) or raw_prefix
        prefix = prefix.strip()
        if prefix and is_valid_name_mask_prefix(prefix):
            return f"{prefix}({cafe_nick})"
        return f"이름마스킹(@)({cafe_nick})"

    nick_change: list[list[str]] = []
    nick_unmatched: list[list[str]] = []
    nick_unknown: list[list[str]] = []
    cipher_cnt = 0

    total_openchat_rows = max(0, len(openchat_rows) - 1)

    for r in openchat_rows[1:] if len(openchat_rows) > 1 else []:
        rt = _cell(r, idx_room_type)
        room_label = _cell(r, idx_room_label) or ROOM_LABEL.get(str(rt or "").strip().lower(), str(rt or "").strip())
        nick = _cell(r, idx_openchat_nick)
        parsed = _cell(r, idx_parsed)
        parsed_src = _cell(r, idx_parsed_src)
        resolved = _cell(r, idx_resolved)
        needs_change = _is_true(_cell(r, idx_needs_change))
        name_mask_prefix = _cell(r, idx_name_mask_prefix)
        name_mask_ok = _cell(r, idx_name_mask_ok).upper()

        # mapping(참고용)
        if resolved:
            _attach_openchat(resolved, rt, nick)
        elif parsed and parsed in cafe_nick_set:
            _attach_openchat(parsed, rt, nick)

        staff_like = _looks_like_staff_nick(nick)
        if resolved:
            rk = normalize_cafe_nickname(resolved)
            if rk and rk in staff_norm_set:
                continue
        if staff_like:
            continue

        if resolved and needs_change:
            if ssot_norm_set:
                rk = normalize_cafe_nickname(resolved)
                if rk and rk not in ssot_norm_set:
                    continue
            reason = ""
            src = str(parsed_src or "").strip().lower()
            if src == "paren":
                reason = "이름 사이에 @ 규칙이 맞지 않아요."
            elif src == "slash":
                reason = "슬래시(/) 대신 괄호( )로 바꿔주세요."
            else:
                reason = "끝에 (카페닉)이 없거나 위치가 달라요."
            rec = _recommend_nickname(nick, parsed_src, resolved, name_mask_prefix)
            nick_change.append([room_label, nick, resolved, reason, rec])
            continue

        if not resolved:
            if parsed:
                # 추출된 카페닉은 있으나, 카페 명단에 없음(오타/탈퇴/미가입 가능)
                nick_unknown.append([room_label, nick, parsed, "카페 명단에 없는 카페닉이에요(오타/변경 가능)."])
            else:
                if _looks_like_cipher_nick(nick):
                    cipher_cnt += 1
                else:
                    nick_unmatched.append(
                        [
                            room_label,
                            nick,
                            "카페닉을 추출/매칭할 수 없어요.",
                            "예) 정@록(나물쓰) / 유@비(냥댕)",
                        ]
                    )

    if max_nickname_issue_rows > 0:
        nick_change = nick_change[: int(max_nickname_issue_rows)]
        nick_unmatched = nick_unmatched[: int(max_nickname_issue_rows)]
        nick_unknown = nick_unknown[: int(max_nickname_issue_rows)]

    # helpers: per-member room marks + matched nicks
    inc_chat = bool(room_chat.get("incomplete"))
    inc_notice = bool(room_notice.get("incomplete"))
    inc_premium = bool(room_premium.get("incomplete"))

    def _room_mark(rt: str, track: str, in_room: bool) -> str:
        t = str(track or "").strip().lower()
        r = str(rt or "").strip().lower()
        required = False
        forbidden = False
        inc = False
        if r == "chat":
            inc = inc_chat
            required = t in ("normal", "premium")
        elif r == "notice":
            inc = inc_notice
            required = t in ("normal", "premium")
        elif r == "premium":
            inc = inc_premium
            required = t == "premium"
            forbidden = t == "normal"

        if required:
            if inc:
                return "⏳ 목록 불완료"
            return "✅ 참여" if in_room else "❌ 미참여"
        if forbidden:
            return "⚠️ 들어옴(확인)" if in_room else "—"
        return "✅ 참여(참고)" if in_room else "—"

    def _matched_nicks_for(cafe_nick: str) -> str:
        cn = str(cafe_nick or "").strip()
        m = openchat_by_cafe.get(cn) if cn else None
        if not isinstance(m, dict):
            return ""
        parts: list[str] = []
        for rt in ["chat", "notice", "premium"]:
            xs = m.get(rt) if isinstance(m.get(rt), list) else []
            if not xs:
                continue
            parts.append(f"{ROOM_LABEL.get(rt, rt)}: {_join_short([str(x) for x in xs], limit=2)}")
        return "\n".join(parts)

    # sort records (prioritize premium missing premium first)
    def _miss_sort(d: dict[str, str]) -> tuple[int, str]:
        miss = str(d.get("missingRooms") or "")
        pr = 0 if ("프리미엄방" in miss) else 1
        return pr, str(d.get("cafeNickname") or "")

    missing_records.sort(key=_miss_sort)
    ambiguous_records.sort(key=lambda d: str(d.get("cafeNickname") or ""))
    unexpected_premium_records.sort(key=lambda d: str(d.get("cafeNickname") or ""))
    cafe_missing_records.sort(key=lambda d: str(d.get("cafeNickname") or ""))
    ssot_missing_records.sort(key=lambda d: str(d.get("cafeNickname") or ""))

    # build sheet rows
    rows: List[List[str]] = []
    rows.append([f"강의 운영 v2 - ACTIONS - {course_key}"])
    rows.append([f"최종 갱신: {now_iso}"])
    rows.append([""])

    # 운영자(비개발자)용: 처리 순서 안내
    nick_change_people = {
        str(r[2] or "").strip()
        for r in (nick_change or [])
        if isinstance(r, list) and len(r) >= 3 and str(r[2] or "").strip()
    }
    nick_unknown_keys = {
        str(r[2] or "").strip()
        for r in (nick_unknown or [])
        if isinstance(r, list) and len(r) >= 3 and str(r[2] or "").strip()
    }

    rows.append(["📌 사용 방법(처리 순서)"])
    rows.append(["1) 먼저 아래 '0) 데이터 준비'에서 '불완료'가 있으면, 해당 톡방에서 멤버 목록을 끝까지 불러온 뒤 다시 업데이트하세요."])
    rows.append([f"2) '1) 카페 미가입(SSOT)' {len(cafe_missing_records)}명 처리: 카페 가입/닉네임 확인 + 가입 링크 안내"])
    rows.append([f"3) '2) 참여 누락' {len(missing_records)}명 처리: 해당 방 입장 링크 안내/초대"])
    rows.append([f"4) '5) 결제/SSOT 누락(카페)' {len(ssot_missing_records)}명 처리: 결제/운영진 여부 확인(필요 시 방 정리)"])
    rows.append([f"5) '6) 닉네임 변경 요청' {len(nick_change_people)}명 처리: 형식 '이름 사이 @ + (카페닉)' 요청"])
    rows.append([""])

    # summary
    rows.append(["🧭 지금 처리할 일(요약)"])
    rows.append(["우선", "항목", "건수", "설명"])

    p0_items: list[tuple[str, int, str]] = []
    if inc_chat or inc_notice or inc_premium:
        inc_rooms = [ROOM_LABEL["chat"] if inc_chat else "", ROOM_LABEL["notice"] if inc_notice else "", ROOM_LABEL["premium"] if inc_premium else ""]
        inc_rooms = [x for x in inc_rooms if x]
        p0_items.append(("톡방 멤버 목록 불러오기 필요", len(inc_rooms), f"멤버 목록이 덜 불러와진 방({', '.join(inc_rooms)})이 있으면 결과가 틀릴 수 있어요. 먼저 멤버 목록을 끝까지 불러오고 다시 업데이트하세요."))
    if cipher_cnt > 0 and total_openchat_rows > 0 and (cipher_cnt / max(1, total_openchat_rows)) >= 0.6:
        p0_items.append(("톡방 닉네임이 이상하게 깨져 보여요", cipher_cnt, "닉네임이 기호/영문 토큰처럼 보여 매칭이 어려울 수 있어요. 오픈채팅 앱 화면에서 닉네임이 정상인지 확인이 필요해요."))

    if p0_items:
        for title, cnt, desc in p0_items:
            rows.append([_priority_label(0), title, str(cnt), desc])
    else:
        rows.append([_priority_label(0), "(없음)", "0", ""])

    rows.append([_priority_label(1), "카페 미가입(SSOT)", f"{len(cafe_missing_records)}명", "결제 SSOT에는 있는데 카페 명단에 없어요. 카페 가입/닉네임 변경 여부를 먼저 확인하세요."])
    rows.append([_priority_label(1), "필수방 미참여(SSOT)", f"{len(missing_records)}명", "필수 방에 참여하지 않은 멤버예요. 해당 방 입장 링크 안내/초대가 필요해요."])
    rows.append([_priority_label(2), "결제/SSOT 누락(카페)", f"{len(ssot_missing_records)}명", "카페에는 있는데 결제 SSOT에 없어요. 결제/운영진 여부를 확인하세요."])
    rows.append([_priority_label(2), "동명이인/중복 매칭(SSOT)", f"{len(ambiguous_records)}명", "같은 카페닉이 2명 이상 매칭된 케이스예요. 톡닉/카페닉 확인 후 정리가 필요해요."])
    rows.append([_priority_label(2), "일반반 프리미엄방 참여(권한 확인, SSOT)", f"{len(unexpected_premium_records)}명", "일반반인데 프리미엄방에 있는 케이스예요. 권한을 확인하세요."])
    rows.append([_priority_label(2), "닉네임 변경 요청(SSOT)", f"{len(nick_change_people)}명", f"닉네임 형식이 규칙과 달라요. (방별 {len(nick_change)}건)"])
    rows.append([_priority_label(3), "닉네임 매칭 불가", f"{len(nick_unmatched)}건", "카페닉을 추출/매칭할 수 없어 참여 인식이 안 돼요. 닉네임 수정이 필요해요."])
    rows.append([_priority_label(3), "카페 명단 불일치", f"{len(nick_unknown_keys)}개", f"톡닉에서 추출된 카페닉이 카페 명단에 없어요. (방별 {len(nick_unknown)}건)"])

    rows.append([""])

    # data readiness
    rows.append(["🧭 0) 데이터 준비(필수)"])
    rows.append(["체크 항목", "현재 상태", "정상/주의", "문제면 이렇게 해요"])

    def _row_db(room: dict[str, object]) -> list[str]:
        label = str(room.get("roomLabel") or "")
        name = str(room.get("roomName") or "")
        active = room.get("active")
        loaded = room.get("loaded")
        inc = bool(room.get("incomplete"))
        try:
            a = int(active) if active is not None else None
        except Exception:
            a = None
        try:
            l = int(loaded) if loaded is not None else None
        except Exception:
            l = None

        if inc:
            if a is not None and l is not None:
                cur = f"{a}명 중 {l}명만 확인됨 ({name})"
            else:
                cur = f"일부만 확인됨 ({name})"
            decision = "⚠️ 불완료"
            action = "Redroid에서 해당 톡방 > 멤버 목록을 맨 아래까지 스크롤해서 불러온 뒤, 다시 업데이트하세요."
        else:
            if a is not None:
                cur = f"확인 완료 (표시 {a}명, {name})"
            else:
                cur = f"확인 완료 ({name})"
            decision = "✅ 완료"
            action = ""

        return [f"{label} 멤버 목록", cur, decision, action]

    rows.append(_row_db(room_chat))
    rows.append(_row_db(room_notice))
    rows.append(_row_db(room_premium))
    if incomplete_records:
        rows.append(["참고", f"결과 확정 불가 멤버: {len(incomplete_records)}명", "⚠️ 목록 불완료", "멤버 목록을 다 불러온 뒤 다시 업데이트하면 정상/누락/중복으로 정리돼요."])

    rows.append([""])

    # cafe missing (SSOT present but not in cafe roster)
    rows.append(["🧭 1) 카페 미가입(SSOT)"])
    rows.append(["우선", "카페닉", "SSOT 등급", "트랙", "사담방", "공지방", "프리미엄방", "조치", "참고(현재 톡닉)"])
    if cafe_missing_records:
        limit = max(0, int(max_rows_per_section))
        for d in (cafe_missing_records[:limit] if limit else []):
            cafe_nick = str(d.get("cafeNickname") or "").strip()
            grade = str(d.get("grade") or "").strip()
            track = str(d.get("track") or "").strip().lower()
            in_chat = _is_true(d.get("in_chat", ""))
            in_notice = _is_true(d.get("in_notice", ""))
            in_premium = _is_true(d.get("in_premium", ""))

            action = "카페 가입/닉네임 확인 + 가입 링크 안내"
            rows.append(
                [
                    _priority_label(1),
                    cafe_nick,
                    grade,
                    _track_label(track),
                    _room_mark("chat", track, in_chat),
                    _room_mark("notice", track, in_notice),
                    _room_mark("premium", track, in_premium),
                    action,
                    _matched_nicks_for(cafe_nick),
                ]
            )
        if limit and len(cafe_missing_records) > limit:
            rows.append([f"(표시 제한: {limit}건 / 전체 {len(cafe_missing_records)}건)", "", "", "", "", "", "", "", ""])
    else:
        rows.append(["(없음)", "", "", "", "", "", "", "", ""])

    rows.append([""])

    # missing required rooms
    rows.append(["🧭 2) 참여 누락(즉시)"])
    rows.append(["우선", "카페닉", "SSOT 등급", "트랙", "누락 방", "사담방", "공지방", "프리미엄방", "조치", "참고(현재 톡닉)"])
    if missing_records:
        limit = max(0, int(max_rows_per_section))
        for d in (missing_records[:limit] if limit else []):
            cafe_nick = str(d.get("cafeNickname") or "").strip()
            grade = str(d.get("grade") or "").strip()
            track = str(d.get("track") or "").strip().lower()
            miss = str(d.get("missingRooms") or "").strip()
            in_chat = _is_true(d.get("in_chat", ""))
            in_notice = _is_true(d.get("in_notice", ""))
            in_premium = _is_true(d.get("in_premium", ""))

            action = "해당 방 입장 링크 안내/초대"
            if track == "premium" and "프리미엄방" in miss:
                action = "프리미엄방 입장 링크 안내/초대"
            rows.append(
                [
                    _priority_label(1),
                    cafe_nick,
                    grade,
                    _track_label(track),
                    miss,
                    _room_mark("chat", track, in_chat),
                    _room_mark("notice", track, in_notice),
                    _room_mark("premium", track, in_premium),
                    action,
                    _matched_nicks_for(cafe_nick),
                ]
            )
        if limit and len(missing_records) > limit:
            rows.append([f"(표시 제한: {limit}건 / 전체 {len(missing_records)}건)", "", "", "", "", "", "", "", "", ""])
    else:
        rows.append(["(없음)", "", "", "", "", "", "", "", "", ""])

    rows.append([""])

    # ambiguous
    rows.append(["🧭 3) 동명이인/중복 매칭(확인 필요)"])
    rows.append(["카페닉", "트랙", "사담 매칭수", "공지 매칭수", "프리미엄 매칭수", "조치", "참고(현재 톡닉)"])
    if ambiguous_records:
        limit = max(0, int(max_rows_per_section))
        for d in (ambiguous_records[:limit] if limit else []):
            cafe_nick = str(d.get("cafeNickname") or "").strip()
            track = str(d.get("track") or "").strip().lower()
            rows.append(
                [
                    cafe_nick,
                    _track_label(track),
                    str(d.get("chatCount") or ""),
                    str(d.get("noticeCount") or ""),
                    str(d.get("premiumCount") or ""),
                    "동명이인/중복 가능 → 톡닉 확인 후 정리",
                    _matched_nicks_for(cafe_nick),
                ]
            )
        if limit and len(ambiguous_records) > limit:
            rows.append([f"(표시 제한: {limit}건 / 전체 {len(ambiguous_records)}건)", "", "", "", "", "", ""])
    else:
        rows.append(["(없음)", "", "", "", "", "", ""])

    rows.append([""])

    # unexpected premium participants
    rows.append(["🧭 4) 권한 이상(일반반이 프리미엄방 참여)"])
    rows.append(["카페닉", "SSOT 등급", "프리미엄방 톡닉(참고)", "조치"])
    if unexpected_premium_records:
        limit = max(0, int(max_rows_per_section))
        for d in (unexpected_premium_records[:limit] if limit else []):
            cafe_nick = str(d.get("cafeNickname") or "").strip()
            grade = str(d.get("grade") or "").strip()
            premium_nicks = ""
            m = openchat_by_cafe.get(cafe_nick) if cafe_nick else None
            if isinstance(m, dict):
                premium_nicks = _join_short([str(x) for x in (m.get("premium") if isinstance(m.get("premium"), list) else [])], limit=3)
            rows.append([cafe_nick, grade, premium_nicks, "일반반인데 프리미엄방에 있어요 → 권한 확인/정리"])
        if limit and len(unexpected_premium_records) > limit:
            rows.append([f"(표시 제한: {limit}건 / 전체 {len(unexpected_premium_records)}건)", "", "", ""])
    else:
        rows.append(["(없음)", "", "", ""])

    rows.append([""])

    # cafe has member but payment ssot missing (참고/확인)
    rows.append(["🧭 5) 결제/SSOT 누락(카페)"])
    rows.append(["카페닉", "카페 등급(참고)", "사담방", "공지방", "프리미엄방", "조치", "참고(현재 톡닉)"])
    if ssot_missing_records:
        limit = max(0, int(max_rows_per_section))
        for d in (ssot_missing_records[:limit] if limit else []):
            cafe_nick = str(d.get("cafeNickname") or "").strip()
            grade = str(d.get("grade") or "").strip()
            track = str(d.get("track") or "").strip().lower()
            in_chat = _is_true(d.get("in_chat", ""))
            in_notice = _is_true(d.get("in_notice", ""))
            in_premium = _is_true(d.get("in_premium", ""))
            rows.append(
                [
                    cafe_nick,
                    grade,
                    _room_mark("chat", track, in_chat),
                    _room_mark("notice", track, in_notice),
                    _room_mark("premium", track, in_premium),
                    "결제/운영진 여부 확인 → 필요 시 방 정리",
                    _matched_nicks_for(cafe_nick),
                ]
            )
        if limit and len(ssot_missing_records) > limit:
            rows.append([f"(표시 제한: {limit}건 / 전체 {len(ssot_missing_records)}건)", "", "", "", "", "", ""])
    else:
        rows.append(["(없음)", "", "", "", "", "", ""])

    rows.append([""])

    # nickname change requests (운영자 관점: 사람별로 묶어서 보여준다)
    rows.append(["🧩 6) 닉네임 변경 요청(사람별)"])
    rows.append(["우선", "카페닉", "문제", "해당 방", "현재 톡닉 예시", "요청 문구(복붙)", "권장 형식"])

    nick_change_groups: dict[str, dict[str, object]] = {}
    for r in nick_change:
        if not isinstance(r, list) or len(r) < 5:
            continue
        room_label, openchat_nick, cafe_nick, reason, rec = r[:5]
        cn = str(cafe_nick or "").strip()
        if not cn:
            continue
        g = nick_change_groups.get(cn)
        if not isinstance(g, dict):
            g = {"rooms": set(), "examples": {}, "problems": set(), "bestRec": ""}
            nick_change_groups[cn] = g
        rooms = g.get("rooms")
        if isinstance(rooms, set):
            rooms.add(str(room_label or "").strip())
        examples = g.get("examples")
        if isinstance(examples, dict):
            rl = str(room_label or "").strip()
            if rl and rl not in examples:
                examples[rl] = str(openchat_nick or "").strip()
        probs = g.get("problems")
        if isinstance(probs, set):
            rs = str(reason or "").strip()
            if "슬래시" in rs or "/" in rs:
                probs.add("슬래시(/)")
            elif "이름 사이" in rs or "이름마스킹" in rs or "@" in rs:
                probs.add("이름마스킹(@)")
            else:
                probs.add("(카페닉) 위치/형식")
        best = str(g.get("bestRec") or "").strip()
        cand = str(rec or "").strip()
        # "이름마스킹(@)(카페닉)" 같은 placeholder보다 실제 추천(예: 김@주(...))을 우선
        if cand:
            if (not best) or (best.startswith("이름마스킹") and not cand.startswith("이름마스킹")):
                g["bestRec"] = cand

    if nick_change_groups:
        # 방 표기 순서 고정
        room_order = {"사담방": 1, "공지방": 2, "프리미엄방": 3}

        def _sort_rooms(xs: list[str]) -> list[str]:
            return sorted([str(x).strip() for x in xs if str(x).strip()], key=lambda x: (room_order.get(x, 9), x))

        for cn in sorted(nick_change_groups.keys()):
            g = nick_change_groups.get(cn) or {}
            rooms = _sort_rooms(list(g.get("rooms") or []))
            rooms_text = ", ".join(rooms)

            examples = g.get("examples") if isinstance(g.get("examples"), dict) else {}
            ex_lines: list[str] = []
            for rl in rooms:
                nn = str(examples.get(rl) or "").strip()
                if nn:
                    ex_lines.append(f"{rl}: {nn}")
            examples_text = "\n".join(ex_lines[:3])
            if len(ex_lines) > 3:
                examples_text = examples_text + f"\n외 {len(ex_lines) - 3}건"

            probs = sorted([str(x) for x in (g.get("problems") or []) if str(x).strip()])
            probs_text = ", ".join(probs) if probs else "형식 확인"

            best_rec = str(g.get("bestRec") or "").strip() or f"이름마스킹(@)({cn})"
            if best_rec.startswith("이름마스킹"):
                best_rec = f"이름 사이 @ + ({cn})"

            if "슬래시(/)" in probs_text:
                msg = f"닉네임 끝을 슬래시(/)가 아니라 괄호({cn})로 바꿔주세요.\n예: 정@록({cn})"
            else:
                msg = f"닉네임을 '이름 사이 @ + ({cn})' 형태로 변경해주세요.\n예: 정@록({cn})"

            rows.append([_priority_label(2), cn, probs_text, rooms_text, examples_text, msg, best_rec])
    else:
        rows.append(["(없음)", "", "", "", "", "", ""])

    rows.append([""])

    # nickname unmatched
    rows.append(["🧩 7) 카페닉을 찾을 수 없는 톡닉(참여 확인 불가)"])
    rows.append(["방", "톡닉", "사유", "예시"])
    if cipher_cnt > 0:
        rows.append(["(참고)", f"닉네임이 이상하게 깨져 보이는 인원: {cipher_cnt}명", "앱 화면에서 닉네임이 정상인지 확인이 필요해요.", ""])
    if nick_unmatched:
        limit = max(0, int(max_rows_per_section))
        for r in (nick_unmatched[:limit] if limit else []):
            rows.append(r)
        if limit and len(nick_unmatched) > limit:
            rows.append([f"(표시 제한: {limit}건 / 전체 {len(nick_unmatched)}건)", "", "", ""])
    elif cipher_cnt <= 0:
        rows.append(["(없음)", "", "", ""])

    rows.append([""])

    # parsed cafe nick but not in cafe roster (운영자 관점: 카페닉(추출) 기준으로 묶어서 보여준다)
    rows.append(["🧩 8) 카페 명단에 없는 카페닉(확인 필요)"])
    rows.append(["카페닉(추출)", "해당 방", "현재 톡닉 예시", "가능한 원인", "조치"])

    unknown_groups: dict[str, dict[str, object]] = {}
    for r in nick_unknown:
        if not isinstance(r, list) or len(r) < 4:
            continue
        room_label, openchat_nick, parsed_cafe_nick, _msg = r[:4]
        key = str(parsed_cafe_nick or "").strip()
        if not key:
            continue
        g = unknown_groups.get(key)
        if not isinstance(g, dict):
            g = {"rooms": set(), "examples": {}}
            unknown_groups[key] = g
        rooms = g.get("rooms")
        if isinstance(rooms, set):
            rooms.add(str(room_label or "").strip())
        ex = g.get("examples")
        if isinstance(ex, dict):
            rl = str(room_label or "").strip()
            if rl and rl not in ex:
                ex[rl] = str(openchat_nick or "").strip()

    if unknown_groups:
        room_order = {"사담방": 1, "공지방": 2, "프리미엄방": 3}
        for key in sorted(unknown_groups.keys()):
            g = unknown_groups.get(key) or {}
            rooms = sorted([str(x).strip() for x in (g.get("rooms") or []) if str(x).strip()], key=lambda x: (room_order.get(x, 9), x))
            rooms_text = ", ".join(rooms)
            ex = g.get("examples") if isinstance(g.get("examples"), dict) else {}
            ex_lines: list[str] = []
            for rl in rooms:
                nn = str(ex.get(rl) or "").strip()
                if nn:
                    ex_lines.append(f"{rl}: {nn}")
            examples_text = "\n".join(ex_lines[:3])
            if len(ex_lines) > 3:
                examples_text = examples_text + f"\n외 {len(ex_lines) - 3}건"
            cause = "카페 닉네임 오타/변경, 카페 탈퇴, 아직 가입 전 가능"
            action = f"카페 닉네임이 맞는지 확인 → 맞으면 닉네임 형식(이름 사이 @ + ({key}))으로 변경 요청"
            rows.append([key, rooms_text, examples_text, cause, action])
    else:
        rows.append(["(없음)", "", "", "", ""])

    return rows
