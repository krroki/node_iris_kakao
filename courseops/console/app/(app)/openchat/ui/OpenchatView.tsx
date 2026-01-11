"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Room = {
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
  adminsHint: string | null;
  pinned?: boolean;
};

type Response = {
  ok: boolean;
  fetchedAt: string | null;
  updatedAt: string | null;
  summary: null | { rooms: number; hiddenRooms: number; totalMembers: number; todayTotal: number };
  rooms: Room[];
  hiddenRooms: Room[];
};

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

function normalizeBase64Ciphertext(raw: string) {
  const s = String(raw || "").trim();
  if (!s) return null;
  let v = s.replace(/-/g, "+").replace(/_/g, "/");
  const mod = v.length % 4;
  if (mod === 2) v += "==";
  else if (mod === 3) v += "=";
  else if (mod === 1) return null;
  if (v.length < 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  return v;
}

function looksLikeCiphertext(raw: string) {
  const v = normalizeBase64Ciphertext(raw);
  if (!v) return false;
  try {
    const bin = atob(v);
    return bin.length >= 16 && bin.length % 16 === 0;
  } catch {
    return false;
  }
}

function hasHangul(s: string) {
  try {
    return /\p{Script=Hangul}/u.test(String(s || ""));
  } catch {
    return /[가-힣]/.test(String(s || ""));
  }
}

function isSuspiciousName(name: string) {
  const s = String(name || "").trim();
  if (!s) return true;
  if (s.length > 80) return true;
  if (s.includes("\uFFFD")) return true;
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s)) return true;
  if (hasHangul(s)) return false;
  if (/^\d{6,}$/.test(s)) return true;
  if (s.length >= 12 && looksLikeCiphertext(s)) return true;
  if (s.length >= 24 && /^[0-9a-fA-F]+$/.test(s)) return true;
  if (s.length >= 30 && /^[A-Za-z0-9_-]+$/.test(s)) return true;
  return false;
}

function normalizeNames(list: string[]) {
  const names = Array.isArray(list) ? list : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of names) {
    const s = String(x || "").trim();
    if (!s) continue;
    if (isSuspiciousName(s)) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function SparkBars({
  values,
  bars,
}: {
  values: number[];
  bars: number;
}) {
  const v = Array.isArray(values) ? values.slice(0, bars) : [];
  while (v.length < bars) v.push(0);
  const max = Math.max(1, ...v.map((x) => Math.max(0, Number(x) || 0)));
  return (
    <div className="flex h-6 items-end gap-[2px]">
      {v.map((x, idx) => {
        const n = Math.max(0, Number(x) || 0);
        const h = Math.max(2, Math.round((n / max) * 24));
        return (
          <div
            key={idx}
            className="w-[4px] rounded-sm bg-slate-200"
            style={{ height: `${h}px` }}
            title={String(n)}
          />
        );
      })}
    </div>
  );
}

function IconPin({ on }: { on: boolean }) {
  return (
    <span
      className={[
        "inline-flex h-8 w-8 items-center justify-center rounded-lg border bg-white text-sm",
        on ? "border-brand-300 text-brand-700" : "border-slate-200 text-slate-600",
      ].join(" ")}
      aria-label={on ? "고정됨" : "고정"}
    >
      📌
    </span>
  );
}

export default function OpenchatView() {
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
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
  const canReorder = !normalizedQuery && !savingOrder && !busyRoomId;
  const rooms = useMemo(() => {
    const list = Array.isArray(data?.rooms) ? data!.rooms : [];
    if (!normalizedQuery) return list;
    return list.filter((r) => String(r.roomName || "").toLowerCase().includes(normalizedQuery));
  }, [data, normalizedQuery]);

  const hiddenRooms = useMemo(() => {
    const list = Array.isArray(data?.hiddenRooms) ? data!.hiddenRooms : [];
    if (!normalizedQuery) return list;
    return list.filter((r) => String(r.roomName || "").toLowerCase().includes(normalizedQuery));
  }, [data, normalizedQuery]);

  const pinnedRooms = useMemo(() => rooms.filter((r) => (r as any).pinned), [rooms]);
  const normalRooms = useMemo(() => rooms.filter((r) => !(r as any).pinned), [rooms]);

  const patchWatch = async (roomId: string, patch: { pinned?: boolean; hidden?: boolean }) => {
    setBusyRoomId(roomId);
    try {
      const res = await fetch("/api/openchat/watchlist/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, ...patch }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "저장하지 못했어요."));
      await load();
    } catch (e: any) {
      setError(String(e?.message || "저장하지 못했어요."));
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

  const onDropReorder = async (pinned: boolean, fromId: string, toId: string) => {
    const list = pinned ? pinnedRooms : normalRooms;
    const ids = list.map((r) => r.roomId);
    const fromIdx = ids.indexOf(fromId);
    const toIdx = ids.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    const next = [...ids];
    const [moved] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, moved);
    await saveOrder(pinned, next);
  };

  const requestRefreshNow = async () => {
    setRefreshingNow(true);
    setRefreshMessage("");
    try {
      const res = await fetch("/api/openchat/refresh", { method: "POST" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (res.status === 429) {
        const sec = Number(j?.retryAfterSec || 0) || 0;
        setRefreshMessage(sec > 0 ? `조금만 기다려주세요. ${sec}초 후에 다시 시도할 수 있어요.` : "조금만 기다려주세요.");
        return;
      }
      if (!res.ok) throw new Error(String(j?.error || "요청하지 못했어요."));
      setRefreshMessage("지금 갱신을 요청했어요. 잠시만 기다려주세요.");

      const startedAt = Date.now();
      const maxWaitMs = 20000;
      // 갱신 반영이 느릴 수 있어 잠깐만 더 자주 확인한다.
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
    setBusyRoomId(roomId);
    setRefreshMessage("");
    try {
      const res = await fetch("/api/openchat/admins/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (res.status === 429) {
        const sec = Math.max(1, Number(j?.retryAfterSec || 0) || 0);
        throw new Error(`잠깐만요. ${sec}초 후 다시 시도해 주세요.`);
      }
      if (!res.ok) throw new Error(String(j?.error || "요청하지 못했어요."));
      setRefreshMessage("운영진 불러오기를 요청했어요. 1~2분 뒤 “지금 갱신”을 눌러 확인해요.");
    } catch (e: any) {
      setError(String(e?.message || "요청하지 못했어요."));
    } finally {
      setBusyRoomId("");
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">오픈채팅 현황</h1>
          <div className="mt-1 text-sm text-slate-600">
            방별 인원/운영진/대화 흐름을 한눈에 봐요.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <div>
            마지막 갱신 <span className="font-medium text-slate-900">{formatTs(data?.fetchedAt ?? null)}</span>
          </div>
          <button
            onClick={requestRefreshNow}
            disabled={refreshingNow}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {refreshingNow ? "요청 중..." : "지금 갱신"}
          </button>
        </div>
      </div>

      {refreshMessage ? (
        <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">{refreshMessage}</div>
      ) : null}
      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading && !data ? <div className="text-sm text-slate-600">불러오는 중...</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">감시 중 방</div>
          <div className="mt-1 text-2xl font-semibold">{summary ? summary.rooms : "-"}</div>
          <div className="mt-1 text-xs text-slate-500">숨긴 방 {summary ? summary.hiddenRooms : "-"}개</div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">총 인원</div>
          <div className="mt-1 text-2xl font-semibold">{summary ? summary.totalMembers : "-"}</div>
          <div className="mt-1 text-xs text-slate-500">현재 인원 합계</div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">오늘 대화수</div>
          <div className="mt-1 text-2xl font-semibold">{summary ? summary.todayTotal : "-"}</div>
          <div className="mt-1 text-xs text-slate-500">자정~현재, 봇 포함</div>
        </div>
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-xs font-medium text-slate-500">다음 행동</div>
          <div className="mt-1 text-sm font-medium text-slate-900">순서를 바꾸거나, 고정/숨김을 조정해요.</div>
          <div className="mt-1 text-xs text-slate-500">운영진이 “미확인”이면 “운영진 불러오기”를 누른 뒤 1~2분 후 “지금 갱신”을 눌러요.</div>
        </div>
      </div>

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="방 이름으로 검색"
            className="w-full max-w-[360px] rounded-lg border bg-white px-3 py-2 text-sm"
          />
          <button
            onClick={load}
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
          >
            새로고침
          </button>
          {normalizedQuery ? (
            <button
              onClick={() => setQuery("")}
              className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            >
              검색 지우기
            </button>
          ) : null}
        </div>
        {savingOrder ? <div className="text-sm text-slate-600">순서를 저장하는 중...</div> : null}
      </div>

      {normalizedQuery ? (
        <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">
          검색 중에는 순서 변경이 잠깐 꺼져요.
        </div>
      ) : null}

      {rooms.length === 0 && !loading ? (
        <div className="rounded-2xl border bg-white p-8 text-sm text-slate-600 shadow-sm">
          아직 표시할 방이 없어요.
          <div className="mt-2">
            <button onClick={requestRefreshNow} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
              지금 갱신
            </button>
          </div>
        </div>
      ) : null}

      <Section
        title={pinnedRooms.length > 0 ? `고정된 방 (${pinnedRooms.length})` : "고정된 방"}
        hint="고정된 방은 항상 위에 보여요. 드래그로 순서를 바꿀 수 있어요."
      >
        <RoomList
          pinned
          rooms={pinnedRooms}
          busyRoomId={busyRoomId}
          canReorder={canReorder}
          canDragReorder={canReorder && !isTouch}
          onTogglePin={(rid, next) => patchWatch(rid, { pinned: next })}
          onHide={(rid) => patchWatch(rid, { hidden: true })}
          onDropReorder={onDropReorder}
          onSaveOrder={saveOrder}
        />
      </Section>

      <Section title={`방 목록 (${normalRooms.length})`} hint="드래그로 순서를 바꿀 수 있어요. 필요 없는 방은 숨겨둘 수 있어요.">
        <RoomList
          pinned={false}
          rooms={normalRooms}
          busyRoomId={busyRoomId}
          canReorder={canReorder}
          canDragReorder={canReorder && !isTouch}
          onTogglePin={(rid, next) => patchWatch(rid, { pinned: next })}
          onHide={(rid) => patchWatch(rid, { hidden: true })}
          onDropReorder={onDropReorder}
          onSaveOrder={saveOrder}
        />
      </Section>

      <Section title={`숨긴 방 (${hiddenRooms.length})`} hint="숨긴 방은 여기서 다시 추가할 수 있어요.">
        <div className="space-y-2">
          {hiddenRooms.length === 0 ? (
            <div className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">숨긴 방이 없어요.</div>
          ) : (
            hiddenRooms.map((r) => (
              <div key={r.roomId} className="flex items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-slate-900">{r.roomName}</div>
                  <div className="mt-1 text-xs text-slate-500">오늘 {r.today.total} · 어제 {r.yesterday.total}</div>
                </div>
                <button
                  disabled={busyRoomId === r.roomId}
                  onClick={() => patchWatch(r.roomId, { hidden: false })}
                  className="shrink-0 rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  다시 추가
                </button>
              </div>
            ))
          )}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">{title}</div>
        <div className="mt-1 text-sm text-slate-600">{hint}</div>
      </div>
      {children}
    </div>
  );
}

function RoomList({
  pinned,
  rooms,
  busyRoomId,
  canReorder,
  canDragReorder,
  onTogglePin,
  onHide,
  onDropReorder,
  onSaveOrder,
}: {
  pinned: boolean;
  rooms: Room[];
  busyRoomId: string;
  canReorder: boolean;
  canDragReorder: boolean;
  onTogglePin: (roomId: string, next: boolean) => void;
  onHide: (roomId: string) => void;
  onDropReorder: (pinned: boolean, fromId: string, toId: string) => void;
  onSaveOrder: (pinned: boolean, roomIds: string[]) => Promise<void>;
}) {
  const draggingIdRef = useRef<string>("");

  const move = async (roomId: string, dir: -1 | 1) => {
    if (!canReorder) return;
    const ids = rooms.map((r) => r.roomId);
    const idx = ids.indexOf(roomId);
    if (idx < 0) return;
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(idx, 1);
    next.splice(nextIdx, 0, moved);
    await onSaveOrder(pinned, next);
  };

  if (rooms.length === 0) {
    return <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600 shadow-sm">표시할 방이 없어요.</div>;
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm">
      <div className="hidden grid-cols-[56px_1.2fr_120px_1fr_1fr_140px_120px_120px] gap-0 border-b bg-slate-50 px-4 py-3 text-xs font-medium text-slate-500 md:grid">
        <div>고정</div>
        <div>방</div>
        <div className="text-right">인원</div>
        <div>방장/부방장</div>
        <div>대화수</div>
        <div>오늘 흐름</div>
        <div>최근 7일</div>
        <div>최근 대화</div>
      </div>
      <div className="divide-y">
        {rooms.map((r) => {
          const host = normalizeNames(r.hostNames);
          const sub = normalizeNames(r.subhostNames);
          const disabled = busyRoomId === r.roomId;
          const needsAdmins = Boolean(r.adminsHint) || host.length === 0 || sub.length === 0;
          return (
            <div
              key={r.roomId}
              onDragOver={(e) => {
                if (!canDragReorder) return;
                e.preventDefault();
              }}
              onDrop={() => {
                if (!canDragReorder) return;
                const from = draggingIdRef.current;
                const to = r.roomId;
                draggingIdRef.current = "";
                if (from && to && from !== to) onDropReorder(pinned, from, to);
              }}
              className="grid grid-cols-1 gap-3 px-4 py-4 md:grid-cols-[56px_1.2fr_120px_1fr_1fr_140px_120px_120px] md:items-center md:gap-0"
            >
              <div className="flex items-center gap-2">
                <button
                  onClick={() => onTogglePin(r.roomId, !pinned)}
                  disabled={disabled}
                  className="w-fit disabled:opacity-60"
                  title={pinned ? "고정 해제" : "고정"}
                >
                  <IconPin on={pinned} />
                </button>
                <div
                  draggable={canDragReorder}
                  onDragStart={() => {
                    if (!canDragReorder) return;
                    draggingIdRef.current = r.roomId;
                  }}
                  className={[
                    "hidden h-8 w-8 items-center justify-center rounded-lg border bg-white text-sm text-slate-600 md:flex",
                    canDragReorder ? "cursor-grab hover:bg-slate-50 active:cursor-grabbing" : "opacity-50",
                  ].join(" ")}
                  title={canDragReorder ? "드래그해서 순서를 바꿔요" : "지금은 순서를 바꿀 수 없어요"}
                >
                  ⋮⋮
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate text-sm font-semibold text-slate-900">{r.roomName}</div>
                  {r.adminsHint ? (
                    <span
                      className="hidden cursor-help rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 md:inline"
                      title={r.adminsHint}
                    >
                      운영진 확인 중
                    </span>
                  ) : null}
                </div>
                <div className="mt-1 text-xs text-slate-500 md:hidden">
                  최근 대화 {formatRelative(r.lastMessageTs)} · 오늘 {r.today.total} · 어제 {r.yesterday.total} · 7일 평균 {r.avg7d.total}
                </div>
              </div>

              <div className="text-right text-sm font-semibold text-slate-900">
                {r.activeMembersCount == null ? "-" : r.activeMembersCount}
              </div>

              <div className="min-w-0">
                <div className="truncate text-sm text-slate-900">
                  <span className="text-slate-500">방장</span>{" "}
                  {host.length > 0 ? host.join(", ") : <span className="text-slate-400">미확인</span>}
                </div>
                <div className="mt-1 truncate text-xs text-slate-600">
                  <span className="text-slate-500">부방장</span>{" "}
                  {sub.length > 0 ? sub.join(", ") : <span className="text-slate-400">미확인</span>}
                </div>
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-semibold text-slate-900">오늘 {r.today.total}</span>
                  <span className="text-xs text-slate-500">
                    (텍스트 {r.today.text} · 사진 {r.today.image} · 기타 {r.today.other})
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-600">
                  어제 {r.yesterday.total} · 7일 평균 {r.avg7d.total}
                </div>
              </div>

              <div className="hidden md:block">
                <SparkBars values={r.sparkTodayHourly} bars={24} />
              </div>
              <div className="hidden md:block">
                <SparkBars values={r.spark7dDaily} bars={7} />
              </div>
              <div className="hidden md:block text-sm text-slate-700" title={formatTs(r.lastMessageTs)}>
                {formatRelative(r.lastMessageTs)}
              </div>

              <div className="flex flex-wrap gap-2 md:col-span-8">
                {needsAdmins ? (
                  <button
                    onClick={() => requestAdminsRefresh(r.roomId)}
                    disabled={disabled}
                    className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                    title="단말에서 멤버 목록을 불러와 운영진/닉네임 정보를 보강해요."
                  >
                    운영진 불러오기
                  </button>
                ) : null}
                <button
                  onClick={() => move(r.roomId, -1)}
                  disabled={disabled || !canReorder}
                  className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 md:hidden"
                >
                  위로
                </button>
                <button
                  onClick={() => move(r.roomId, 1)}
                  disabled={disabled || !canReorder}
                  className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60 md:hidden"
                >
                  아래로
                </button>
                <button
                  onClick={() => onHide(r.roomId)}
                  disabled={disabled}
                  className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
                >
                  숨기기
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
