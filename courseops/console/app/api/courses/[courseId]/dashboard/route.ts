import { NextResponse } from "next/server";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";
import { parseActionsFromValues } from "@/lib/actions";
import { asTable, getSnapshotTables } from "@/lib/snapshot";

function asBool(input: string) {
  return String(input || "").trim().toUpperCase() === "TRUE";
}

function trackLabel(track: string) {
  const t = String(track || "").trim().toLowerCase();
  if (t === "premium") return "프리미엄";
  if (t === "normal") return "일반";
  if (t === "staff") return "운영진";
  return t || "-";
}

function addCount(map: Record<string, number>, key: string, by = 1) {
  const k = String(key || "").trim();
  if (!k) return;
  map[k] = (map[k] || 0) + by;
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
  const rawActions = parseActionsFromValues({ courseId: course.id, values: tables.actions });

  // --- 멤버/준수율(SSOT 기준) ---
  const idx = (name: string) => audit.header.indexOf(name);
  const idxSsotPresent = idx("ssotPresent");
  const idxTrack = idx("track");
  const idxAuditStatus = idx("auditStatus");

  let ssotMembers = 0;
  let normalMembers = 0;
  let premiumMembers = 0;
  let staffMembers = 0;
  let okMembers = 0;

  const auditStatusCounts: Record<string, number> = {};

  for (const r of audit.rows) {
    const isSsot = idxSsotPresent >= 0 ? asBool(r[idxSsotPresent] || "") : false;
    if (!isSsot) continue;
    ssotMembers += 1;

    const track = idxTrack >= 0 ? String(r[idxTrack] || "").trim().toLowerCase() : "";
    if (track === "premium") premiumMembers += 1;
    else if (track === "normal") normalMembers += 1;
    else if (track === "staff") staffMembers += 1;

    const status = idxAuditStatus >= 0 ? String(r[idxAuditStatus] || "").trim() : "";
    addCount(auditStatusCounts, status || "UNKNOWN");
    if ((track === "premium" || track === "normal") && status === "OK") okMembers += 1;
  }

  const denom = normalMembers + premiumMembers;
  const complianceRate = denom > 0 ? Math.round((okMembers / denom) * 100) : 0;

  // --- 작업 대기열(시트 ACTIONS + DB 상태) ---
  const states = await store.getActionStates(course.id, rawActions.items.map((it) => it.key));
  const byKey = new Map(states.map((s) => [s.actionKey, s]));

  const pendingStatuses = new Set(["대기", "미해결(재확인)", "확인 불가(데이터 미완전)"]);
  const confirmWaitingStatuses = new Set(["확인 대기"]);

  let pendingActions = 0;
  let confirmWaitingActions = 0;
  const pendingByType: Record<string, number> = {};

  for (const it of rawActions.items) {
    const st = byKey.get(it.key);
    const status = (st?.status || "대기") as string;
    if (pendingStatuses.has(status)) {
      pendingActions += 1;
      addCount(pendingByType, it.action || "기타");
    } else if (confirmWaitingStatuses.has(status)) {
      confirmWaitingActions += 1;
    }
  }

  const actionTypes = Object.entries(pendingByType)
    .map(([k, v]) => ({ type: k, count: v }))
    .sort((a, b) => b.count - a.count);

  return NextResponse.json({
    course: {
      id: course.id,
      courseKey: course.courseKey,
    },
    updatedAt: String(snap?.fetchedAt || rawActions.lastUpdatedAt || "").trim() || null,
    members: {
      ssot: ssotMembers,
      normal: normalMembers,
      premium: premiumMembers,
      staff: staffMembers,
      complianceRate,
      auditStatusCounts,
    },
    actions: {
      pending: pendingActions,
      confirmWaiting: confirmWaitingActions,
      pendingByType: actionTypes,
    },
    labels: {
      tracks: {
        normal: trackLabel("normal"),
        premium: trackLabel("premium"),
        staff: trackLabel("staff"),
      },
    },
  });
}
