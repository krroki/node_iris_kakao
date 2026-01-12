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

function safeNullableNumber(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v || ""));
  return Number.isFinite(n) ? n : null;
}

type OpenchatRoomSnapshot = {
  roomId: string;
  roomName: string;
  thumbnailUrl: string | null;
  activeMembersCount: number | null;
  lastMessageTs: string | null;
  last1h: { total: number };
  surge: { pct: number | null; delta: number; baseline: number };
  today: { total: number; text: number; image: number; other: number };
  yesterday: { total: number };
  avg7d: { total: number };
  sparkTodayHourly: number[];
  spark7dDaily: number[];
  topTalkersToday: Array<{ nickname: string; total: number }>;
  hostNames: string[];
  subhostNames: string[];
  adminsHint: string | null;
};

function normalizeNameList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const s = safeString(raw).trim();
    if (!s) continue;
    const compact = s
      .normalize("NFKC")
      .replace(/[\s\u200b\u200c\u200d\ufeff\u2060]+/gu, "");
    if (compact === "어떤분") continue;
    if (/^\d{6,}$/.test(compact)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
    if (out.length >= 30) break;
  }
  return out;
}

function normalizeTalkers(v: unknown): Array<{ nickname: string; total: number }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ nickname: string; total: number }> = [];
  const seen = new Set<string>();
  for (const raw of v) {
    const o = raw && typeof raw === "object" ? (raw as any) : null;
    const nickname = safeString(o?.nickname).trim();
    const total = Math.max(0, safeNumber(o?.total));
    if (!nickname || total <= 0) continue;
    const compact = nickname
      .normalize("NFKC")
      .replace(/[\s\u200b\u200c\u200d\ufeff\u2060]+/gu, "");
    if (compact === "어떤분") continue;
    if (/^\d{6,}$/.test(compact)) continue;
    if (isBotLikeName(nickname)) continue;
    if (seen.has(nickname)) continue;
    seen.add(nickname);
    out.push({ nickname, total });
    if (out.length >= 50) break;
  }
  return out;
}

function isBotLikeName(name: string) {
  const s = safeString(name).trim();
  if (!s) return false;
  const compact = s
    .normalize("NFKC")
    .replace(/[\s\u200b\u200c\u200d\ufeff\u2060]+/gu, "");
  const lower = compact.toLowerCase();
  if (compact.includes("오픈채팅봇")) return true;
  if (lower.includes("openchatbot")) return true;
  return false;
}

function normalizeRoom(raw: any): OpenchatRoomSnapshot | null {
  const roomId = safeString(raw?.roomId).trim();
  if (!roomId) return null;
  const roomName = safeString(raw?.roomName).trim() || "오픈채팅방";
  const thumbnailUrlRaw = safeString(raw?.thumbnailUrl || raw?.thumbnail_url || "").trim();
  const thumbnailUrl = thumbnailUrlRaw && /^https?:\/\//.test(thumbnailUrlRaw) ? thumbnailUrlRaw : null;
  const activeMembersCountRaw = raw?.activeMembersCount;
  const activeMembersCount =
    activeMembersCountRaw == null ? null : Math.max(0, safeNumber(activeMembersCountRaw));
  const lastMessageTs = safeString(raw?.lastMessageTs || "").trim() || null;

  const today = raw?.today && typeof raw.today === "object" ? raw.today : {};
  const yesterday = raw?.yesterday && typeof raw.yesterday === "object" ? raw.yesterday : {};
  const avg7d = raw?.avg7d && typeof raw.avg7d === "object" ? raw.avg7d : {};
  const last1h = raw?.last1h && typeof raw.last1h === "object" ? raw.last1h : {};
  const surge = raw?.surge && typeof raw.surge === "object" ? raw.surge : {};

  const sparkTodayHourly = Array.isArray(raw?.sparkTodayHourly) ? raw.sparkTodayHourly : [];
  const spark7dDaily = Array.isArray(raw?.spark7dDaily) ? raw.spark7dDaily : [];

  return {
    roomId,
    roomName,
    thumbnailUrl,
    activeMembersCount,
    lastMessageTs,
    last1h: { total: Math.max(0, safeNumber(last1h?.total)) },
    surge: {
      pct: safeNullableNumber(surge?.pct),
      delta: safeNumber(surge?.delta),
      baseline: Math.max(0, safeNumber(surge?.baseline)),
    },
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
    topTalkersToday: normalizeTalkers(raw?.topTalkersToday),
    hostNames: normalizeNameList(raw?.hostNames),
    subhostNames: normalizeNameList(raw?.subhostNames),
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
      range: null,
      rankings: null,
      summary: null,
      rooms: [],
      hiddenRooms: [],
    });
  }

  const payload = snap.payload ?? {};
  const fetchedAt = safeString(payload?.fetchedAt || snap.fetchedAt || "").trim() || null;
  const rangeRaw = payload?.range && typeof payload.range === "object" ? payload.range : null;
  const range = rangeRaw
    ? {
        todayYmd: safeString((rangeRaw as any)?.todayYmd).trim() || null,
        prev7Ymds: Array.isArray((rangeRaw as any)?.prev7Ymds)
          ? (rangeRaw as any).prev7Ymds.map(safeString).map((s: string) => s.trim()).filter(Boolean).slice(0, 7)
          : [],
      }
    : null;
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
    last1hTotal: visible.reduce((acc, r) => acc + (r.last1h?.total ?? 0), 0),
  };

  const todayTopRooms = [...visible]
    .sort((a, b) => {
      const dt = (b.today?.total ?? 0) - (a.today?.total ?? 0);
      if (dt) return dt;
      return String(a.roomName).localeCompare(String(b.roomName), "ko");
    })
    .slice(0, 5)
    .map((r) => ({ roomId: r.roomId, roomName: r.roomName, total: r.today.total }));

  const last1hTopRooms = [...visible]
    .sort((a, b) => {
      const dt = (b.last1h?.total ?? 0) - (a.last1h?.total ?? 0);
      if (dt) return dt;
      return String(a.roomName).localeCompare(String(b.roomName), "ko");
    })
    .slice(0, 5)
    .map((r) => ({ roomId: r.roomId, roomName: r.roomName, total: r.last1h.total }));

  const surgeTopRooms = [...visible]
    .filter((r) => typeof r.surge?.pct === "number" && Number.isFinite(r.surge.pct) && r.surge.pct > 0)
    .sort((a, b) => {
      const dp = (b.surge?.pct ?? 0) - (a.surge?.pct ?? 0);
      if (dp) return dp;
      const dd = (b.surge?.delta ?? 0) - (a.surge?.delta ?? 0);
      if (dd) return dd;
      return String(a.roomName).localeCompare(String(b.roomName), "ko");
    })
    .slice(0, 5)
    .map((r) => ({
      roomId: r.roomId,
      roomName: r.roomName,
      pct: r.surge.pct,
      delta: r.surge.delta,
      baseline: r.surge.baseline,
    }));

  const topTalkersToday = visible
    .flatMap((r) =>
      (r.topTalkersToday || []).map((t) => ({
        roomId: r.roomId,
        roomName: r.roomName,
        nickname: t.nickname,
        total: t.total,
      })),
    )
    .filter((x) => x.nickname && x.total > 0 && !isBotLikeName(x.nickname))
    .sort((a, b) => {
      const dt = b.total - a.total;
      if (dt) return dt;
      return String(a.roomName).localeCompare(String(b.roomName), "ko");
    })
    .slice(0, 50);

  const rankings = {
    todayTopRooms,
    last1hTopRooms,
    surgeTopRooms,
    topTalkersToday,
  };

  return NextResponse.json({
    ok: true,
    fetchedAt,
    updatedAt: snap.updatedAt ?? null,
    range,
    rankings,
    summary,
    rooms: visible,
    hiddenRooms: hidden,
  });
}
