from __future__ import annotations

import re
from typing import Any, Dict, List, Tuple

from .config import GradeRules


ROOM_LABEL: dict[str, str] = {
    "chat": "사담방",
    "notice": "공지방",
    "premium": "프리미엄방",
}


_CAFE_NICK_RE = re.compile(r"\\(([^()\\n\\r]{1,100})\\)\\s*$")


def extract_cafe_nickname_from_openchat(nickname: str) -> str:
    s = str(nickname or "").strip()
    if not s:
        return ""
    m = _CAFE_NICK_RE.search(s)
    if m:
        inner = str(m.group(1) or "").strip()
        return inner
    return ""


def classify_track(grade: str, rules: GradeRules) -> str:
    g = str(grade or "").strip()
    if g and g in set(rules.staff_grades):
        return "staff"
    if g and g in set(rules.premium_grades):
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
) -> List[List[str]]:
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
            parsed = extract_cafe_nickname_from_openchat(nick)
            rows.append([course_key, fetched_at, room_type, label, room_id, room_name, active, loaded, uid, nick, parsed])

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

    # room completeness
    incomplete = False
    for rt in ["chat", "notice", "premium"]:
        info = room_infos.get(rt) if isinstance(room_infos.get(rt), dict) else {}
        if bool(info.get("incomplete")):
            incomplete = True

    # build membership maps: cafeNick -> count
    counts: dict[str, dict[str, int]] = {"chat": {}, "notice": {}, "premium": {}}
    for rt in ["chat", "notice", "premium"]:
        for m in members_by_room.get(rt, []) or []:
            if not isinstance(m, dict):
                continue
            nick = str(m.get("nickname") or "").strip()
            cafe_nick = extract_cafe_nickname_from_openchat(nick)
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
        if "chat" in required and not in_chat:
            missing.append(ROOM_LABEL["chat"])
        if "notice" in required and not in_notice:
            missing.append(ROOM_LABEL["notice"])
        if "premium" in required and not in_premium:
            missing.append(ROOM_LABEL["premium"])

        ambiguous = (c_chat > 1) or (c_notice > 1) or (c_premium > 1)

        if track == "staff":
            audit_status = "STAFF"
        elif incomplete:
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
