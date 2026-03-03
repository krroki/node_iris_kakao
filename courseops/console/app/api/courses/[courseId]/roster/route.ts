import { NextResponse } from "next/server";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";
import { asTable, getSnapshotTables } from "@/lib/snapshot";
import { normalizeNick, splitCsv } from "@/lib/textUtil";

function asBool(input: string) {
  return String(input || "").trim().toUpperCase() === "TRUE";
}

function uniqPush(list: string[], value: string) {
  const v = String(value || "").trim();
  if (!v) return;
  if (!list.includes(v)) list.push(v);
}

function extractCafeNickFromOpenchatNickname(nick: string) {
  const s = String(nick || "").trim();
  if (!s) return "";
  const m1 = s.match(/[（(]([^（）()\n\r]{1,100})[）)]\s*$/);
  if (m1 && m1[1]) return String(m1[1]).trim();
  // 괄호가 끝이 아니거나(뒤에 이모지/추가 텍스트), 괄호가 여러 번 들어가는 변형 케이스
  try {
    let last = "";
    for (const m of s.matchAll(/[（(]([^（）()\n\r]{1,100})[）)]/g)) {
      if (m && m[1]) last = String(m[1]).trim();
    }
    if (last) return last;
  } catch {}
  const m2 = s.match(/[/／]\s*([^/／\s]{1,100})\s*$/);
  if (m2 && m2[1]) return String(m2[1]).trim();
  // 슬래시도 끝에 이모지/추가 텍스트가 붙을 수 있어 마지막 토큰을 보조로 사용
  const parts = s
    .split(/[/／]/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "";
}

function parseAliasesCell(cell: string) {
  const raw = String(cell || "").trim();
  if (!raw) return [] as string[];
  try {
    const j = JSON.parse(raw);
    if (Array.isArray(j)) return j.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {}
  return splitCsv(raw);
}

function trackLabel(track: string) {
  const t = String(track || "").trim().toLowerCase();
  if (t === "premium") return "프리미엄";
  if (t === "normal") return "일반";
  if (t === "staff") return "운영진";
  return t || "-";
}

export async function GET(_req: Request, { params }: { params: { courseId: string } }) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = await coursesStore();
  const course = await store.getCourse(params.courseId);
  if (!course) return NextResponse.json({ error: "강의를 찾지 못했어요." }, { status: 404 });

  const snap = await store.getCourseSnapshot(course.id);
  const tables = getSnapshotTables(snap?.payload);
  const audit = asTable(tables.auditView);
  const openchat = asTable(tables.openchatRaw);
  const ssot = asTable(tables.ssotRaw);

  // --- SSOT 인덱스(닉 변경: old->new 포함) ---
  const idxSsot = (name: string) => ssot.header.indexOf(name);
  const idxSsotUserId = idxSsot("ssotUserId");
  const idxSsotNick = idxSsot("ssotNickname");
  const idxSsotAliases = idxSsot("ssotNicknameAliases");
  const idxSsotName = idxSsot("ssotName");
  const idxSsotGrade = idxSsot("ssotGrade");
  const idxSsotTrack = idxSsot("ssotTrack");
  const idxSsotKind = idxSsot("ssotKind");

  const ssotByUserId = new Map<
    string,
    {
      userId: string;
      nickname: string;
      aliases: string[];
      name: string;
      grade: string;
      track: string;
      kind: string;
    }
  >();
  const nickNormToUserId = new Map<string, string>();

  for (const r of ssot.rows) {
    const userId = idxSsotUserId >= 0 ? String(r[idxSsotUserId] || "").trim() : "";
    if (!userId) continue;
    const nickname = idxSsotNick >= 0 ? String(r[idxSsotNick] || "").trim() : "";
    const aliases = idxSsotAliases >= 0 ? parseAliasesCell(String(r[idxSsotAliases] || "")) : [];
    const name = idxSsotName >= 0 ? String(r[idxSsotName] || "").trim() : "";
    const grade = idxSsotGrade >= 0 ? String(r[idxSsotGrade] || "").trim() : "";
    const track = idxSsotTrack >= 0 ? String(r[idxSsotTrack] || "").trim() : "";
    const kind = idxSsotKind >= 0 ? String(r[idxSsotKind] || "").trim() : "";

    ssotByUserId.set(userId, { userId, nickname, aliases, name, grade, track, kind });
    const variants = [nickname, ...aliases].map((x) => normalizeNick(x)).filter(Boolean);
    for (const v of variants) if (!nickNormToUserId.has(v)) nickNormToUserId.set(v, userId);
  }

  // --- AUDIT_VIEW(통합 판정) ---
  const idxAudit = (name: string) => audit.header.indexOf(name);
  const idxAuditKey = idxAudit("auditKey");
  const idxCafeNick = idxAudit("cafeNickname");
  const idxTrack = idxAudit("track");
  const idxSsotPresent = idxAudit("ssotPresent");
  const idxInCafe = idxAudit("inCafe");
  const idxRequiredRooms = idxAudit("requiredRooms");
  const idxInChat = idxAudit("in_chat");
  const idxInNotice = idxAudit("in_notice");
  const idxInPremium = idxAudit("in_premium");
  const idxMissingRooms = idxAudit("missingRooms");
  const idxAuditStatus = idxAudit("auditStatus");
  const idxSsotUserId2 = idxAudit("ssotUserId");

  type MemberRoom = {
    required: boolean;
    present: boolean;
    nicknames: string[];
    needsNicknameChange: boolean;
  };
  type MemberRow = {
    key: string;
    cafeNickname: string;
    track: string;
    trackLabel: string;
    ssotPresent: boolean;
    ssot: null | { userId: string; nickname: string; name: string; grade: string; track: string; kind: string };
    inCafe: boolean;
    requiredRooms: string[];
    missingRooms: string[];
    auditStatus: string;
    rooms: {
      chat: MemberRoom;
      notice: MemberRoom;
      premium: MemberRoom;
    };
  };

  const members: MemberRow[] = [];
  const bySsotUserId = new Map<string, MemberRow>();
  const byCafeNickNorm = new Map<string, MemberRow>();

  for (const r of audit.rows) {
    const cafeNickname = idxCafeNick >= 0 ? String(r[idxCafeNick] || "").trim() : "";
    if (!cafeNickname) continue;
    const ssotPresent = idxSsotPresent >= 0 ? asBool(r[idxSsotPresent] || "") : false;
    const ssotUserId = idxSsotUserId2 >= 0 ? String(r[idxSsotUserId2] || "").trim() : "";
    const ssotRec = ssotUserId ? ssotByUserId.get(ssotUserId) || null : null;

    const required = splitCsv(idxRequiredRooms >= 0 ? String(r[idxRequiredRooms] || "") : "");
    const requiredSet = new Set(required);

    const room = (label: string, present: boolean): MemberRoom => ({
      required: requiredSet.has(label),
      present,
      nicknames: [],
      needsNicknameChange: false,
    });

    const row: MemberRow = {
      key: idxAuditKey >= 0 ? String(r[idxAuditKey] || "").trim() : cafeNickname,
      cafeNickname,
      track: idxTrack >= 0 ? String(r[idxTrack] || "").trim() : "",
      trackLabel: trackLabel(idxTrack >= 0 ? String(r[idxTrack] || "") : ""),
      ssotPresent,
      ssot: ssotRec
        ? {
            userId: ssotRec.userId,
            nickname: ssotRec.nickname,
            name: ssotRec.name,
            grade: ssotRec.grade,
            track: ssotRec.track,
            kind: ssotRec.kind,
          }
        : null,
      inCafe: idxInCafe >= 0 ? asBool(r[idxInCafe] || "") : false,
      requiredRooms: required,
      missingRooms: splitCsv(idxMissingRooms >= 0 ? String(r[idxMissingRooms] || "") : ""),
      auditStatus: idxAuditStatus >= 0 ? String(r[idxAuditStatus] || "").trim() : "",
      rooms: {
        chat: room("사담방", idxInChat >= 0 ? asBool(r[idxInChat] || "") : false),
        notice: room("공지방", idxInNotice >= 0 ? asBool(r[idxInNotice] || "") : false),
        premium: room("프리미엄방", idxInPremium >= 0 ? asBool(r[idxInPremium] || "") : false),
      },
    };
    members.push(row);

    if (ssotUserId) bySsotUserId.set(ssotUserId, row);
    const norm = normalizeNick(cafeNickname);
    if (norm && !byCafeNickNorm.has(norm)) byCafeNickNorm.set(norm, row);
  }

  // --- OPENCHAT_RAW(닉네임 표시/규칙 위반 표시) ---
  const idxOpen = (name: string) => openchat.header.indexOf(name);
  const idxRoomType = idxOpen("roomType");
  const idxOpenNick = idxOpen("openchatNickname");
  const idxResolvedCafeNick = idxOpen("resolvedCafeNickname");
  const idxParsedCafeNick = idxOpen("parsedCafeNickname");
  const idxNeedsChange = idxOpen("needsNicknameChange");

  for (const r of openchat.rows) {
    const roomType = idxRoomType >= 0 ? String(r[idxRoomType] || "").trim() : "";
    if (!roomType) continue;
    const openchatNickname = idxOpenNick >= 0 ? String(r[idxOpenNick] || "").trim() : "";
    if (!openchatNickname) continue;

    const resolved = idxResolvedCafeNick >= 0 ? String(r[idxResolvedCafeNick] || "").trim() : "";
    const parsed = idxParsedCafeNick >= 0 ? String(r[idxParsedCafeNick] || "").trim() : "";
    const extracted = extractCafeNickFromOpenchatNickname(openchatNickname);
    const candidate = resolved || parsed || extracted;
    const norm = normalizeNick(candidate);

    let member: MemberRow | undefined;
    if (norm) {
      const ssotUserId = nickNormToUserId.get(norm);
      if (ssotUserId) member = bySsotUserId.get(ssotUserId);
      if (!member) member = byCafeNickNorm.get(norm);
    }
    if (!member) continue;

    const roomKey: "chat" | "notice" | "premium" | null =
      roomType === "chat" ? "chat" : roomType === "notice" ? "notice" : roomType === "premium" ? "premium" : null;
    if (!roomKey) continue;
    uniqPush(member.rooms[roomKey].nicknames, openchatNickname);
    const needsChange = idxNeedsChange >= 0 ? asBool(r[idxNeedsChange] || "") : false;
    if (needsChange) member.rooms[roomKey].needsNicknameChange = true;
  }

  members.sort((a, b) => {
    const w = (t: string) => (t === "premium" ? 0 : t === "normal" ? 1 : t === "staff" ? 2 : 3);
    const wa = w(a.track.toLowerCase());
    const wb = w(b.track.toLowerCase());
    if (wa !== wb) return wa - wb;
    return a.cafeNickname.localeCompare(b.cafeNickname, "ko");
  });

  let ssotCount = 0;
  let premiumCount = 0;
  let normalCount = 0;
  let staffCount = 0;
  for (const m of members) {
    if (!m.ssotPresent) continue;
    ssotCount += 1;
    const t = String(m.track || "").toLowerCase();
    if (t === "premium") premiumCount += 1;
    else if (t === "normal") normalCount += 1;
    else if (t === "staff") staffCount += 1;
  }

  return NextResponse.json({
    course: { id: course.id, courseKey: course.courseKey },
    updatedAt: String(snap?.fetchedAt || "").trim() || null,
    stats: {
      members: members.length,
      ssot: ssotCount,
      normal: normalCount,
      premium: premiumCount,
      staff: staffCount,
    },
    members,
  });
}
