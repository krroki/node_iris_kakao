from __future__ import annotations

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

    def _room_mark(in_room: bool, required: bool, incomplete: bool) -> str:
        if in_room:
            return "✅"
        if required and incomplete:
            return "⏳"
        if required:
            return "❌"
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

    records.sort(key=lambda d: (_severity_key(d.get("status", "")), d.get("cafeNickname", "")))

    ok_cnt = int(status_counts.get("OK") or 0)
    missing_cnt = int(status_counts.get("MISSING") or 0)
    ambiguous_cnt = int(status_counts.get("AMBIGUOUS") or 0)
    incomplete_cnt = int(status_counts.get("INCOMPLETE") or 0)
    staff_cnt = int(status_counts.get("STAFF") or 0)
    total_cnt = len(records)
    premium_cnt = int(track_counts.get("premium") or 0)
    normal_cnt = int(track_counts.get("normal") or 0)

    # openchat nickname format issues
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

    oc_header = openchat_rows[0] if openchat_rows else []
    oi = _h2i(oc_header)
    idx_room_label = oi.get("roomLabel")
    idx_room_type = oi.get("roomType")
    idx_openchat_nick = oi.get("openchatNickname")
    idx_parsed = oi.get("parsedCafeNickname")

    nick_bad: list[list[str]] = []
    nick_unknown: list[list[str]] = []
    cipher_cnt = 0
    total_openchat_rows = 0

    for r in openchat_rows[1:] if len(openchat_rows) > 1 else []:
        room_label = _cell(r, idx_room_label) or ROOM_LABEL.get(_cell(r, idx_room_type), _cell(r, idx_room_type))
        nick = _cell(r, idx_openchat_nick)
        parsed = _cell(r, idx_parsed)
        if not nick:
            continue
        total_openchat_rows += 1
        if not parsed:
            if _looks_like_cipher_nick(nick):
                cipher_cnt += 1
            else:
                nick_bad.append([room_label, nick, "", "괄호(카페닉) 형식이 아니에요. 예: 홍길동(카페닉)"])
            continue
        if parsed not in cafe_nick_set:
            nick_unknown.append([room_label, nick, parsed, "카페 명단에 없는 카페닉이에요(닉네임 불일치/미가입 가능)."])

    if max_nickname_issue_rows > 0:
        nick_bad = nick_bad[: int(max_nickname_issue_rows)]
        nick_unknown = nick_unknown[: int(max_nickname_issue_rows)]

    # compose overview sheet rows
    rows: List[List[str]] = []
    rows.append(["강의 운영 Overview", course_key])
    rows.append(["최종 갱신", now_iso])
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
    rows.append(["표기", "✅ 참여", "❌ 필수 누락", "— 비대상", "⏳ DB미완전(판정불가)"])
    if any_incomplete:
        rows.append(["주의", "loaded < active 상태면 결과가 DB미완전(INCOMPLETE)로 표시될 수 있어요."])
    elif cipher_cnt > 0 and total_openchat_rows > 0 and (cipher_cnt / max(1, total_openchat_rows)) >= 0.6:
        rows.append(["주의", "톡방 닉네임이 암호화 형태로 저장되어 괄호(카페닉) 점검이 제한될 수 있어요."])
    else:
        rows.append(["", ""])

    rows.append([""])
    rows.append(["📌 멤버별 방 참여 현황(카페 기준)"])
    rows.append(["상태", "카페닉", "등급", "트랙", "필수방", "사담방", "공지방", "프리미엄방", "누락", "메모"])

    chat_label = ROOM_LABEL["chat"]
    notice_label = ROOM_LABEL["notice"]
    premium_label = ROOM_LABEL["premium"]

    for d in records:
        st = d.get("status", "")
        st_u = str(st or "").strip().upper()
        required = {
            x.strip()
            for x in str(d.get("requiredRooms", "") or "").split(",")
            if str(x).strip()
        }
        in_chat = _is_true(d.get("in_chat", ""))
        in_notice = _is_true(d.get("in_notice", ""))
        in_premium = _is_true(d.get("in_premium", ""))

        memo = ""
        if st_u == "AMBIGUOUS":
            memo = (
                "중복 매칭 "
                f"(사담 {d.get('chatCount','')}, 공지 {d.get('noticeCount','')}, 프리미엄 {d.get('premiumCount','')})"
            ).strip()
        elif st_u == "INCOMPLETE":
            memo = "톡방 DB 미완전(loaded < active)"
        missing_display = d.get("missingRooms", "")

        rows.append(
            [
                _status_label(st),
                d.get("cafeNickname", ""),
                d.get("grade", ""),
                _track_label(d.get("track", "")),
                d.get("requiredRooms", ""),
                _room_mark(in_chat, chat_label in required, chat_inc),
                _room_mark(in_notice, notice_label in required, notice_inc),
                _room_mark(in_premium, premium_label in required, premium_inc),
                missing_display,
                memo,
            ]
        )

    rows.append([""])
    rows.append(["🧩 톡방 닉네임 형식 이상(괄호 카페닉 없음)"])
    rows.append(["방", "닉네임", "추출된 카페닉", "안내"])
    if cipher_cnt > 0:
        rows.append(["(참고)", f"닉네임이 암호화 형태로 저장된 항목: {cipher_cnt}명", "", "형식 점검 불가"])
    if nick_bad:
        rows.extend(nick_bad)
    elif cipher_cnt <= 0:
        rows.append(["(없음)", "", "", ""])

    rows.append([""])
    rows.append(["🔎 카페 명단에 없는 카페닉(톡방 닉네임 기준)"])
    rows.append(["방", "닉네임", "추출된 카페닉", "안내"])
    if nick_unknown:
        rows.extend(nick_unknown)
    else:
        rows.append(["(없음)", "", "", ""])

    return rows
