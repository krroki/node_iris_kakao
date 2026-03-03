"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Room = {
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
  pinned?: boolean;
};

type Rankings = {
  todayTopRooms: Array<{ roomId: string; roomName: string; total: number }>;
  last1hTopRooms: Array<{ roomId: string; roomName: string; total: number }>;
  surgeTopRooms: Array<{
    roomId: string;
    roomName: string;
    pct: number;
    delta: number;
    baseline: number;
  }>;
  topTalkersToday: Array<{
    roomId: string;
    roomName: string;
    nickname: string;
    total: number;
  }>;
};

type Response = {
  ok: boolean;
  fetchedAt: string | null;
  updatedAt: string | null;
  range: null | { todayYmd: string | null; prev7Ymds: string[] };
  rankings: Rankings | null;
  summary: null | {
    rooms: number;
    hiddenRooms: number;
    totalMembers: number;
    todayTotal: number;
    last1hTotal: number;
  };
  rooms: Room[];
  hiddenRooms: Room[];
};

type SortMode = "base" | "today" | "surge" | "members";

function cn(...v: Array<string | false | null | undefined>) {
  return v.filter(Boolean).join(" ");
}

const numberFmt = new Intl.NumberFormat("ko-KR");
function formatNumber(v: unknown) {
  const n = typeof v === "number" ? v : Number(String(v ?? ""));
  if (!Number.isFinite(n)) return "-";
  return numberFmt.format(n);
}

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

function formatRelative(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const diffMs = Date.now() - d.getTime();
  const diffSec = Math.max(0, Math.floor(diffMs / 1000));
  if (diffSec < 60) return "방금";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}분 전`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}시간 전`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}일 전`;
}

function normalizeNames(list: string[]) {
  const names = Array.isArray(list) ? list : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of names) {
    const s = String(x || "").trim();
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

function hashString(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickInitial(roomName: string) {
  const s = String(roomName || "").trim();
  if (!s) return "?";
  return s[0]?.toUpperCase?.() || s[0];
}

function Icon({ path, className }: { path: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={cn("h-4 w-4", className)}
      aria-hidden
    >
      <path
        d={path}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs">
      <div className="text-slate-300">{label}</div>
      <div className="font-semibold text-slate-100">{value}</div>
    </div>
  );
}

function Avatar({ room }: { room: Room }) {
  if (room.thumbnailUrl) {
    return (
      <img
        src={room.thumbnailUrl}
        alt=""
        className="h-10 w-10 shrink-0 rounded-xl border border-white/10 bg-white/5 object-cover"
        loading="lazy"
        referrerPolicy="no-referrer"
      />
    );
  }

  const palette = [
    "bg-violet-500/15 text-violet-200 border-violet-500/20",
    "bg-sky-500/15 text-sky-200 border-sky-500/20",
    "bg-emerald-500/15 text-emerald-200 border-emerald-500/20",
    "bg-amber-500/15 text-amber-200 border-amber-500/20",
    "bg-rose-500/15 text-rose-200 border-rose-500/20",
  ];
  const idx = hashString(room.roomName || room.roomId) % palette.length;
  const initial = pickInitial(room.roomName);
  return (
    <div
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border font-semibold",
        palette[idx],
      )}
    >
      {initial}
    </div>
  );
}

function SparkLine({ values }: { values: number[] }) {
  const v = Array.isArray(values)
    ? values.slice(0, 7).map((x) => Math.max(0, Number(x) || 0))
    : [];
  while (v.length < 7) v.push(0);
  const max = Math.max(1, ...v);

  const width = 240;
  const height = 44;
  const padX = 6;
  const padY = 6;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  const points = v
    .map((n, i) => {
      const x = padX + (innerW * i) / Math.max(1, v.length - 1);
      const y = padY + (1 - n / max) * innerH;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-10 w-full">
      <polyline
        points={points}
        fill="none"
        stroke="rgb(139 92 246)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function RankingCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "today" | "hot" | "surge";
  children: React.ReactNode;
}) {
  const iconPath =
    tone === "today"
      ? "M9 19l-2 2-2-2M7 21V3m10 18l-2 2-2-2m2 2V3"
      : tone === "hot"
        ? "M12 2c2 3 2 5 0 7 3-1 5 1 5 4a5 5 0 11-10 0c0-3 2-5 5-11z"
        : "M13 3L4 14h7l-1 7 9-11h-7l1-7z";
  const iconColor =
    tone === "today"
      ? "text-violet-300"
      : tone === "hot"
        ? "text-emerald-300"
        : "text-rose-300";
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/30 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
      <div className="flex items-center gap-2">
        <Icon path={iconPath} className={cn(iconColor, "h-5 w-5")} />
        <div className="text-sm font-semibold text-slate-100">{title}</div>
      </div>
      <div className="mt-3 space-y-2">{children}</div>
    </div>
  );
}

function RankRow({
  rank,
  name,
  right,
  subRight,
  tone,
}: {
  rank: number;
  name: string;
  right: string;
  subRight?: string;
  tone: "today" | "hot" | "surge";
}) {
  const badge =
    rank <= 3
      ? "bg-amber-500/15 text-amber-200"
      : "bg-white/5 text-slate-300";
  const rightTone =
    tone === "hot"
      ? "text-emerald-300"
      : tone === "surge"
        ? "text-rose-300"
        : "text-violet-200";
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl bg-white/5 px-3 py-2">
      <div className="flex min-w-0 items-center gap-3">
        <div
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
            badge,
          )}
        >
          {rank}
        </div>
        <div className="min-w-0 truncate text-sm font-medium text-slate-100">
          {name}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className={cn("text-sm font-semibold", rightTone)}>{right}</div>
        {subRight ? (
          <div className="text-[11px] text-slate-400">{subRight}</div>
        ) : null}
      </div>
    </div>
  );
}

function HeavyUsers({
  items,
}: {
  items: Array<{ roomId: string; roomName: string; nickname: string; total: number }>;
}) {
  const list = (items || []).slice(0, 25);
  const max = Math.max(
    1,
    ...list.map((x) => Math.max(0, Number(x.total) || 0)),
  );
  return (
    <div className="rounded-3xl border border-white/10 bg-slate-950/30 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]">
      <div>
        <div className="text-sm font-semibold text-slate-100">오늘의 헤비 유저</div>
        <div className="mt-1 text-xs text-slate-400">전체 관리방 통합 랭킹</div>
      </div>

      <div className="mt-4 max-h-[560px] space-y-3 overflow-auto pr-2">
        {list.length === 0 ? (
          <div className="text-sm text-slate-400">아직 데이터가 없어요.</div>
        ) : null}
        {list.map((x, i) => {
          const pct = Math.round((Math.max(0, Number(x.total) || 0) / max) * 100);
          return (
            <div
              key={`${x.roomId}:${x.nickname}:${i}`}
              className="flex items-center gap-3"
            >
              <div className="w-7 text-right text-xs font-semibold text-slate-500">
                {i + 1}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-100">
                  {x.nickname}
                </div>
                <div className="truncate text-xs text-slate-500">{x.roomName}</div>
              </div>
              <div className="w-16 text-right text-sm font-semibold text-slate-100">
                {formatNumber(x.total)}
              </div>
              <div className="h-2 w-24 overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-2 rounded-full bg-violet-500"
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoomCard({
  room,
  pinned,
  disabled,
  canDragReorder,
  onDragStart,
  onDrop,
  onTogglePin,
  onHide,
  onAdminsRefresh,
}: {
  room: Room;
  pinned: boolean;
  disabled: boolean;
  canDragReorder: boolean;
  onDragStart: (roomId: string) => void;
  onDrop: (toRoomId: string) => void;
  onTogglePin: (roomId: string, next: boolean) => void;
  onHide: (roomId: string) => void;
  onAdminsRefresh: (roomId: string) => void;
}) {
  const host = normalizeNames(room.hostNames);
  const sub = normalizeNames(room.subhostNames);
  const hasSurge =
    typeof room.surge?.pct === "number" &&
    Number.isFinite(room.surge.pct) &&
    room.surge.pct > 0;

  const subText =
    sub.length === 0
      ? "미확인"
      : sub.length <= 2
        ? sub.join(", ")
        : `${sub.slice(0, 2).join(", ")} +${sub.length - 2}명`;

  return (
    <div
      onDragOver={(e) => {
        if (!canDragReorder) return;
        e.preventDefault();
      }}
      onDrop={() => onDrop(room.roomId)}
      className={cn(
        "group relative overflow-hidden rounded-3xl border border-white/10 bg-slate-950/30 p-4 shadow-[0_0_0_1px_rgba(255,255,255,0.03)] transition",
        "hover:bg-slate-950/40",
        disabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <Avatar room={room} />
          <div
            draggable={canDragReorder}
            onDragStart={() => onDragStart(room.roomId)}
            className={cn(
              "absolute -bottom-2 -right-2 hidden h-7 w-7 items-center justify-center rounded-xl border border-white/10 bg-slate-950/70 text-slate-300 md:flex",
              canDragReorder
                ? "cursor-grab hover:bg-slate-900/60 active:cursor-grabbing"
                : "opacity-40",
            )}
            title={
              canDragReorder
                ? "드래그해서 순서를 바꿀 수 있어요"
                : "지금은 순서를 바꿀 수 없어요"
            }
          >
            <Icon
              path="M10 5h1M10 12h1M10 19h1M14 5h1M14 12h1M14 19h1"
              className="h-4 w-4"
            />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="min-w-0 truncate text-sm font-semibold text-slate-100">
                  {room.roomName}
                </div>
                {hasSurge ? (
                  <span className="rounded-lg bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-200">
                    급상승
                  </span>
                ) : null}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1">
                  <Icon
                    path="M20 21V7a2 2 0 00-2-2H6a2 2 0 00-2 2v14"
                    className="h-4 w-4 text-slate-500"
                  />
                  {room.activeMembersCount == null
                    ? "-"
                    : `${formatNumber(room.activeMembersCount)}명`}
                </span>
                <span className="text-slate-600">•</span>
                <span className="inline-flex items-center gap-1 text-emerald-200">
                  <Icon
                    path="M12 2c2 3 2 5 0 7 3-1 5 1 5 4a5 5 0 11-10 0c0-3 2-5 5-11z"
                    className="h-4 w-4"
                  />
                  1시간내 {formatNumber(room.last1h?.total ?? 0)}건
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => onTogglePin(room.roomId, !pinned)}
                disabled={disabled}
                className={cn(
                  "rounded-xl border px-2 py-2 text-slate-200 hover:bg-white/5 disabled:opacity-60",
                  pinned
                    ? "border-violet-500/30 bg-violet-500/10"
                    : "border-white/10",
                )}
                title={pinned ? "고정 해제" : "고정"}
              >
                <Icon
                  path="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"
                  className="h-4 w-4"
                />
              </button>
              <button
                onClick={() => onHide(room.roomId)}
                disabled={disabled}
                className="rounded-xl border border-white/10 px-2 py-2 text-slate-200 hover:bg-white/5 disabled:opacity-60"
                title="숨기기"
              >
                <Icon
                  path="M3 3l18 18M10.73 5.08A10.43 10.43 0 0112 5c7 0 10 7 10 7a16.62 16.62 0 01-3.17 4.21M6.53 6.53A16.45 16.45 0 002 12s3 7 10 7a10.43 10.43 0 004.27-.92M9.88 9.88a3 3 0 004.24 4.24"
                  className="h-4 w-4"
                />
              </button>
            </div>
          </div>

          <div className="mt-3 flex items-end justify-between gap-3">
            <div>
              <div className="text-2xl font-semibold text-slate-100">
                오늘 {formatNumber(room.today?.total ?? 0)}건
              </div>
              <div className="mt-1 text-xs text-slate-400">
                어제 {formatNumber(room.yesterday?.total ?? 0)} · 7일 평균{" "}
                {formatNumber(room.avg7d?.total ?? 0)}
              </div>
            </div>
            <div
              className="text-xs text-slate-400"
              title={formatTs(room.lastMessageTs)}
            >
              {formatRelative(room.lastMessageTs)}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="min-w-0">
              <div className="text-xs text-slate-500">방장</div>
              <div className="truncate text-sm font-medium text-slate-100">
                {host.length > 0 ? host[0] : "미확인"}
              </div>
            </div>
            <div className="min-w-0">
              <div className="text-xs text-slate-500">부방장</div>
              <div className="truncate text-sm font-medium text-slate-100">
                {subText}
              </div>
            </div>
          </div>

          <div className="mt-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-600">
                Weekly Activity Trend
              </div>
              {room.adminsHint ? (
                <button
                  onClick={() => onAdminsRefresh(room.roomId)}
                  disabled={disabled}
                  className="rounded-xl border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/15 disabled:opacity-60"
                  title={room.adminsHint}
                >
                  운영진 불러오기
                </button>
              ) : null}
            </div>
            <div className="mt-2">
              <SparkLine values={room.spark7dDaily} />
            </div>
            {room.adminsHint ? (
              <div className="mt-2 text-xs text-slate-400">{room.adminsHint}</div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function OpenchatView() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("today");
  const [busyRoomId, setBusyRoomId] = useState<string>("");
  const [savingOrder, setSavingOrder] = useState(false);
  const [refreshingNow, setRefreshingNow] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState("");
  const lastUpdatedAtRef = useRef<string | null>(null);
  const [isTouch, setIsTouch] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/global/openchat", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      setData(j as Response);
      lastUpdatedAtRef.current = (j as Response)?.updatedAt ?? null;
    } catch (e: any) {
      setError(String(e?.message || "불러오지 못했어요."));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const touch =
        typeof navigator !== "undefined" &&
        (Number((navigator as any).maxTouchPoints || 0) > 0 ||
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          Boolean((window as any).ontouchstart));
      setIsTouch(Boolean(touch));
    } catch {
      setIsTouch(false);
    }
  }, []);

  const normalizedQuery = query.trim().toLowerCase();
  const canReorder = sortMode === "base" && !normalizedQuery && !savingOrder && !busyRoomId;

  const roomsAll = useMemo(
    () => (Array.isArray(data?.rooms) ? data!.rooms : []),
    [data],
  );
  const hiddenRooms = useMemo(
    () => (Array.isArray(data?.hiddenRooms) ? data!.hiddenRooms : []),
    [data],
  );

  const roomsFiltered = useMemo(() => {
    if (!normalizedQuery) return roomsAll;
    return roomsAll.filter((r) =>
      String(r.roomName || "").toLowerCase().includes(normalizedQuery),
    );
  }, [roomsAll, normalizedQuery]);

  const pinnedRooms = useMemo(
    () => roomsFiltered.filter((r) => (r as any).pinned),
    [roomsFiltered],
  );
  const normalRoomsBase = useMemo(
    () => roomsFiltered.filter((r) => !(r as any).pinned),
    [roomsFiltered],
  );

  const normalRooms = useMemo(() => {
    if (sortMode === "base") return normalRoomsBase;
    if (sortMode === "members") {
      return [...normalRoomsBase].sort(
        (a, b) => (b.activeMembersCount ?? 0) - (a.activeMembersCount ?? 0),
      );
    }
    if (sortMode === "surge") {
      return [...normalRoomsBase].sort((a, b) => {
        const ap = typeof a.surge?.pct === "number" ? a.surge.pct : -999999;
        const bp = typeof b.surge?.pct === "number" ? b.surge.pct : -999999;
        if (bp !== ap) return bp - ap;
        const ad = Number(a.surge?.delta || 0) || 0;
        const bd = Number(b.surge?.delta || 0) || 0;
        if (bd !== ad) return bd - ad;
        return String(a.roomName).localeCompare(String(b.roomName), "ko");
      });
    }
    return [...normalRoomsBase].sort((a, b) => {
      const dt = (b.today?.total ?? 0) - (a.today?.total ?? 0);
      if (dt) return dt;
      return String(a.roomName).localeCompare(String(b.roomName), "ko");
    });
  }, [normalRoomsBase, sortMode]);

  const patchWatch = async (
    roomId: string,
    patch: { pinned?: boolean; hidden?: boolean },
  ) => {
    setBusyRoomId(roomId);
    try {
      const res = await fetch("/api/openchat/watchlist/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, ...patch }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "처리하지 못했어요."));
      await load();
    } catch (e: any) {
      setError(String(e?.message || "처리하지 못했어요."));
    } finally {
      setBusyRoomId("");
    }
  };

  const saveOrder = async (pinned: boolean, roomIds: string[]) => {
    setSavingOrder(true);
    try {
      const res = await fetch("/api/openchat/watchlist/reorder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned, roomIds }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "순서를 저장하지 못했어요."));
      await load();
    } catch (e: any) {
      setError(String(e?.message || "순서를 저장하지 못했어요."));
    } finally {
      setSavingOrder(false);
    }
  };

  const requestRefreshNow = async () => {
    setRefreshingNow(true);
    setRefreshMessage("");
    try {
      const res = await fetch("/api/openchat/refresh", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (res.status === 429) {
        const sec = Number(j?.retryAfterSec || 0) || 0;
        setRefreshMessage(
          sec > 0
            ? `조금만 기다려주세요. ${sec}초 후에 다시 시도할 수 있어요.`
            : "조금만 기다려주세요.",
        );
        return;
      }
      if (!res.ok) throw new Error(String(j?.error || "요청하지 못했어요."));
      setRefreshMessage("지금 갱신을 요청했어요. 잠시만 기다려주세요.");

      const startedAt = Date.now();
      const maxWaitMs = 20000;
      while (Date.now() - startedAt < maxWaitMs) {
        await new Promise((r) => setTimeout(r, 2000));
        const res2 = await fetch("/api/global/openchat", { cache: "no-store" });
        const j2 = (await res2.json().catch(() => ({}))) as any;
        if (res2.ok) {
          const nextUpdatedAt = String(j2?.updatedAt || "").trim() || null;
          if (nextUpdatedAt && nextUpdatedAt !== lastUpdatedAtRef.current) {
            setData(j2 as Response);
            lastUpdatedAtRef.current = nextUpdatedAt;
            setRefreshMessage("갱신이 반영됐어요.");
            return;
          }
        }
      }
      setRefreshMessage("곧 갱신돼요. 잠시만 기다려주세요.");
    } catch (e: any) {
      setError(String(e?.message || "요청하지 못했어요."));
    } finally {
      setRefreshingNow(false);
    }
  };

  const requestAdminsRefresh = async (roomId: string) => {
    const rid = String(roomId || "").trim();
    if (!rid) return;
    setBusyRoomId(rid);
    setRefreshMessage("");
    try {
      const res = await fetch("/api/openchat/admins/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: rid }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (res.status === 429) {
        const sec = Number(j?.retryAfterSec || 0) || 0;
        setRefreshMessage(
          sec > 0
            ? `조금만 기다려주세요. ${sec}초 후에 다시 시도할 수 있어요.`
            : "조금만 기다려주세요.",
        );
        return;
      }
      if (!res.ok) throw new Error(String(j?.error || "요청하지 못했어요."));
      setRefreshMessage("운영진 불러오기를 요청했어요. 잠시만 기다려주세요.");
    } catch (e: any) {
      setError(String(e?.message || "요청하지 못했어요."));
    } finally {
      setBusyRoomId("");
    }
  };

  const draggingIdRef = useRef<string>("");
  const onDragStart = (roomId: string) => {
    if (!canReorder) return;
    draggingIdRef.current = roomId;
  };
  const onDropReorder = async (pinned: boolean, toRoomId: string) => {
    if (!canReorder) return;
    const fromId = draggingIdRef.current;
    draggingIdRef.current = "";
    if (!fromId || fromId === toRoomId) return;
    const list = pinned ? pinnedRooms : normalRooms;
    const ids = list.map((r) => r.roomId);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toRoomId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    await saveOrder(pinned, next);
  };

  const summary = data?.summary;
  const rankings = data?.rankings;

  return (
    <div
      className={cn(
        "-mx-4 -my-4 md:-mx-8 md:-my-8 min-h-[calc(100vh-88px)] bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950 p-4 md:p-8 text-slate-100",
        "space-y-6",
      )}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">오픈채팅 현황</h1>
          <div className="mt-1 text-sm text-slate-300">
            방별 인원/운영진/대화 흐름을 한눈에 봐요.
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-3">
          <Chip label="총관리 방" value={summary ? `${formatNumber(summary.rooms)}개` : "-"} />
          <Chip
            label="총 인원"
            value={summary ? `${formatNumber(summary.totalMembers)}명` : "-"}
          />
          <Chip
            label="오늘 총대화"
            value={summary ? `${formatNumber(summary.todayTotal)}건` : "-"}
          />

          <div className="ml-auto flex items-center gap-3">
            <div className="text-right text-xs text-slate-400">
              LAST SYNC{" "}
              <span className="font-medium text-slate-200">
                {formatTs(data?.fetchedAt ?? null)}
              </span>
            </div>
            <button
              onClick={requestRefreshNow}
              disabled={refreshingNow}
              className="inline-flex items-center gap-2 rounded-2xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
            >
              <Icon
                path="M21 12a9 9 0 11-3-6.7M21 3v6h-6"
                className="h-4 w-4"
              />
              {refreshingNow ? "갱신 중" : "지금 갱신"}
            </button>
          </div>
        </div>
      </div>

      {refreshMessage ? (
        <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-slate-200">
          {refreshMessage}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}
      {loading && !data ? <div className="text-sm text-slate-300">불러오는 중..</div> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <RankingCard title="오늘 대화 TOP 5" tone="today">
          {(rankings?.todayTopRooms || []).slice(0, 5).map((x, i) => (
            <RankRow
              key={x.roomId}
              rank={i + 1}
              name={x.roomName}
              right={`${formatNumber(x.total)}건`}
              tone="today"
            />
          ))}
          {(rankings?.todayTopRooms || []).length === 0 ? (
            <div className="text-sm text-slate-400">아직 데이터가 없어요.</div>
          ) : null}
        </RankingCard>

        <RankingCard title="최근 1시간 (Hot Live)" tone="hot">
          {(rankings?.last1hTopRooms || []).slice(0, 5).map((x, i) => (
            <RankRow
              key={x.roomId}
              rank={i + 1}
              name={x.roomName}
              right={`${formatNumber(x.total)}건`}
              tone="hot"
            />
          ))}
          {(rankings?.last1hTopRooms || []).length === 0 ? (
            <div className="text-sm text-slate-400">아직 데이터가 없어요.</div>
          ) : null}
        </RankingCard>

        <RankingCard title="급상승 (Surge) 감지" tone="surge">
          {(rankings?.surgeTopRooms || []).slice(0, 5).map((x, i) => (
            <RankRow
              key={x.roomId}
              rank={i + 1}
              name={x.roomName}
              right={`${x.pct >= 0 ? "+" : ""}${formatNumber(x.pct)}%`}
              subRight={`증가량: ${x.delta >= 0 ? "+" : ""}${formatNumber(x.delta)}건`}
              tone="surge"
            />
          ))}
          {(rankings?.surgeTopRooms || []).length === 0 ? (
            <div className="text-sm text-slate-400">조건을 만족하는 급상승이 없어요.</div>
          ) : null}
        </RankingCard>
      </div>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex w-full items-center gap-3 rounded-3xl border border-white/10 bg-slate-950/30 px-4 py-3 lg:max-w-xl">
          <Icon
            path="M21 21l-4.35-4.35M10 18a8 8 0 110-16 8 8 0 010 16z"
            className="text-slate-400"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="방 이름으로 검색…"
            className="w-full bg-transparent text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {[
            { k: "today", label: "대화량순" },
            { k: "surge", label: "급상승" },
            { k: "members", label: "인원순" },
            { k: "base", label: "기본순" },
          ].map((x) => {
            const on = sortMode === (x.k as SortMode);
            return (
              <button
                key={x.k}
                onClick={() => setSortMode(x.k as SortMode)}
                className={cn(
                  "rounded-2xl px-4 py-2 text-xs font-semibold transition",
                  on
                    ? "bg-violet-600 text-white"
                    : "border border-white/10 bg-slate-950/30 text-slate-300 hover:bg-white/5",
                )}
              >
                {x.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          {pinnedRooms.length > 0 ? (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">고정된 방</div>
                <div className="mt-1 text-xs text-slate-400">고정된 방은 항상 위에 보여요.</div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pinnedRooms.map((r) => (
                  <RoomCard
                    key={r.roomId}
                    room={r}
                    pinned
                    disabled={busyRoomId === r.roomId}
                    canDragReorder={canReorder && !isTouch}
                    onDragStart={onDragStart}
                    onDrop={(to) => onDropReorder(true, to)}
                    onTogglePin={(rid, next) => patchWatch(rid, { pinned: next })}
                    onHide={(rid) => patchWatch(rid, { hidden: true })}
                    onAdminsRefresh={requestAdminsRefresh}
                  />
                ))}
              </div>
            </div>
          ) : null}

          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-100">방 목록</div>
                <div className="mt-1 text-xs text-slate-400">
                  {canReorder
                    ? "드래그로 순서를 바꿀 수 있어요."
                    : "정렬/검색 중에는 순서 변경이 잠깐 꺼져요."}
                </div>
              </div>
              <div className="text-xs text-slate-400">{formatNumber(normalRooms.length)}개</div>
            </div>

            {normalRooms.length === 0 ? (
              <div className="rounded-3xl border border-white/10 bg-slate-950/30 p-10 text-center text-sm text-slate-300">
                표시할 방이 없어요.
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {normalRooms.map((r) => (
                  <RoomCard
                    key={r.roomId}
                    room={r}
                    pinned={false}
                    disabled={busyRoomId === r.roomId}
                    canDragReorder={canReorder && !isTouch}
                    onDragStart={onDragStart}
                    onDrop={(to) => onDropReorder(false, to)}
                    onTogglePin={(rid, next) => patchWatch(rid, { pinned: next })}
                    onHide={(rid) => patchWatch(rid, { hidden: true })}
                    onAdminsRefresh={requestAdminsRefresh}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <HeavyUsers items={rankings?.topTalkersToday || []} />
      </div>

      <div className="space-y-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-100">숨긴 방</div>
            <div className="mt-1 text-xs text-slate-400">숨긴 방은 여기에서 다시 추가할 수 있어요.</div>
          </div>
          <div className="text-xs text-slate-400">{formatNumber(hiddenRooms.length)}개</div>
        </div>

        {hiddenRooms.length === 0 ? (
          <div className="rounded-3xl border border-white/10 bg-slate-950/30 p-6 text-sm text-slate-300">
            숨긴 방이 없어요.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {hiddenRooms.map((r) => (
              <div
                key={r.roomId}
                className="flex items-center justify-between gap-3 rounded-3xl border border-white/10 bg-slate-950/30 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-3">
                    <Avatar room={r} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-100">
                        {r.roomName}
                      </div>
                      <div className="mt-1 text-xs text-slate-400">
                        오늘 {formatNumber(r.today?.total ?? 0)} · 어제{" "}
                        {formatNumber(r.yesterday?.total ?? 0)}
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  disabled={busyRoomId === r.roomId}
                  onClick={() => patchWatch(r.roomId, { hidden: false })}
                  className="shrink-0 rounded-2xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-slate-100 hover:bg-white/10 disabled:opacity-60"
                >
                  다시 추가
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
