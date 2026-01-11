import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

function safeString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function safeNumber(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v || ""));
  return Number.isFinite(n) ? n : 0;
}

type OpenchatRoomSnapshot = {
  roomId: string;
  roomName: string;
  activeMembersCount: number | null;
  lastMessageTs: string | null;
  today: { total: number; text: number; image: number; other: number };
  yesterday: { total: number };
  avg7d: { total: number };
  sparkTodayHourly: number[];
  spark7dDaily: number[];
  hostNames: string[];
  subhostNames: string[];
  hostCount: number;
  subhostCount: number;
  adminsLoadedMembersCount: number;
  adminsActiveMembersCount: number | null;
  adminsHint: string | null;
};

function normalizeNameList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => safeString(x).trim())
    .filter(Boolean)
    .filter((x) => x !== "어떤 분" && !/^\d{6,}$/.test(x))
    .slice(0, 30);
}

function normalizeRoom(raw: any): OpenchatRoomSnapshot | null {
  const roomId = safeString(raw?.roomId).trim();
  if (!roomId) return null;
  const roomName = safeString(raw?.roomName).trim() || "오픈채팅방";
  const activeMembersCountRaw = raw?.activeMembersCount;
  const activeMembersCount =
    activeMembersCountRaw == null ? null : Math.max(0, safeNumber(activeMembersCountRaw));
  const lastMessageTs = safeString(raw?.lastMessageTs || "").trim() || null;

  const today = raw?.today && typeof raw.today === "object" ? raw.today : {};
  const yesterday = raw?.yesterday && typeof raw.yesterday === "object" ? raw.yesterday : {};
  const avg7d = raw?.avg7d && typeof raw.avg7d === "object" ? raw.avg7d : {};

  const sparkTodayHourly = Array.isArray(raw?.sparkTodayHourly) ? raw.sparkTodayHourly : [];
  const spark7dDaily = Array.isArray(raw?.spark7dDaily) ? raw.spark7dDaily : [];
  const hostCount = Math.max(0, safeNumber(raw?.hostCount));
  const subhostCount = Math.max(0, safeNumber(raw?.subhostCount));
  const adminsLoadedMembersCount = Math.max(0, safeNumber(raw?.adminsLoadedMembersCount));
  const adminsActiveMembersCountRaw = raw?.adminsActiveMembersCount;
  const adminsActiveMembersCount =
    adminsActiveMembersCountRaw == null ? null : Math.max(0, safeNumber(adminsActiveMembersCountRaw));

  return {
    roomId,
    roomName,
    activeMembersCount,
    lastMessageTs,
    today: {
      total: Math.max(0, safeNumber(today?.total)),
      text: Math.max(0, safeNumber(today?.text)),
      image: Math.max(0, safeNumber(today?.image)),
      other: Math.max(0, safeNumber(today?.other)),
    },
    yesterday: { total: Math.max(0, safeNumber(yesterday?.total)) },
    avg7d: { total: Math.max(0, safeNumber(avg7d?.total)) },
    sparkTodayHourly: sparkTodayHourly.map(safeNumber).slice(0, 24),       
    spark7dDaily: spark7dDaily.map(safeNumber).slice(0, 7),
    hostNames: normalizeNameList(raw?.hostNames),
    subhostNames: normalizeNameList(raw?.subhostNames),
    hostCount,
    subhostCount,
    adminsLoadedMembersCount,
    adminsActiveMembersCount,
    adminsHint: safeString(raw?.adminsHint || "").trim() || null,
  };
}

function orderRooms(
  rooms: OpenchatRoomSnapshot[],
  watch: Map<string, { pinned: boolean; hidden: boolean; sortOrder: number }>,
) {
  const withFlags = rooms.map((r) => {
    const w = watch.get(r.roomId);
    return {
      ...r,
      pinned: Boolean(w?.pinned),
      hidden: Boolean(w?.hidden),
      sortOrder: Number(w?.sortOrder ?? 0),
    };
  });

  const visible = withFlags.filter((r) => !r.hidden);
  const hidden = withFlags.filter((r) => r.hidden);

  const sortFn = (a: any, b: any) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : 0;
    const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : 0;
    if (ao !== bo) return ao - bo;
    return String(a.roomName).localeCompare(String(b.roomName), "ko");
  };

  visible.sort(sortFn);
  hidden.sort(sortFn);
  return { visible, hidden };
}

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = await coursesStore();
  const snap = await store.getGlobalSnapshot("openchat_overview");
  if (!snap) {
    return NextResponse.json({
      ok: true,
      fetchedAt: null,
      updatedAt: null,
      summary: null,
      rooms: [],
      hiddenRooms: [],
    });
  }

  const payload = snap.payload ?? {};
  const fetchedAt = safeString(payload?.fetchedAt || snap.fetchedAt || "").trim() || null;
  const roomsRaw = Array.isArray(payload?.rooms) ? payload.rooms : [];
  const normalized = roomsRaw.map(normalizeRoom).filter(Boolean) as OpenchatRoomSnapshot[];

  await store.ensureOpenchatWatchlistRooms(normalized.map((r) => r.roomId));
  const watchRows = await store.listOpenchatWatchlist();
  const watch = new Map(
    watchRows.map((r) => [r.roomId, { pinned: r.pinned, hidden: r.hidden, sortOrder: r.sortOrder }]),
  );

  const { visible, hidden } = orderRooms(normalized, watch);

  const summary = {
    rooms: visible.length,
    hiddenRooms: hidden.length,
    totalMembers: visible.reduce((acc, r) => acc + (r.activeMembersCount ?? 0), 0),
    todayTotal: visible.reduce((acc, r) => acc + (r.today?.total ?? 0), 0),
  };

  return NextResponse.json({
    ok: true,
    fetchedAt,
    updatedAt: snap.updatedAt ?? null,
    summary,
    rooms: visible,
    hiddenRooms: hidden,
  });
}

