"use client";

import { useEffect, useMemo, useState } from "react";

import { useSelectedCourse } from "@/app/(app)/ui/useSelectedCourse";

type ActionItem = {
  key: string;
  priority: "지금" | "오늘" | "확인" | "정리";
  action: string;
  reason: string;
  target: string;
  rooms: string;
  recommendedNickname: string;
  currentNicknames: string;
  state?: {
    status: "대기" | "확인 대기" | "완료(검증됨)" | "미해결(재확인)" | "확인 불가(데이터 미완전)";
    handledBy?: string | null;
    handledAt?: string | null;
    memo?: string | null;
  };
};

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

function PriorityBadge({ p }: { p: ActionItem["priority"] }) {
  const cls =
    p === "지금"
      ? "bg-red-50 text-red-700"
      : p === "오늘"
        ? "bg-amber-50 text-amber-800"
        : p === "확인"
          ? "bg-slate-100 text-slate-700"
          : "bg-emerald-50 text-emerald-700";
  return <span className={["rounded-full px-2 py-1 text-xs font-medium", cls].join(" ")}>{p}</span>;
}

export default function QueueView() {
  const { courses, courseId } = useSelectedCourse();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>("전체");
  const [filterType, setFilterType] = useState<string>("전체");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [memoByKey, setMemoByKey] = useState<Record<string, string>>({});

  const loadActions = async (cid: string) => {
    if (!cid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(cid)}/actions`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      const list: ActionItem[] = Array.isArray(j?.items) ? j.items : [];
      setItems(list);
      setLastUpdatedAt(j?.lastUpdatedAt ? String(j.lastUpdatedAt) : null);
    } catch (e: any) {
      setError(String(e?.message || "불러오지 못했어요."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId) return;
    loadActions(courseId);
    const t = setInterval(() => loadActions(courseId), 7000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const types = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) if (it.action) s.add(it.action);
    return ["전체", ...Array.from(s).sort((a, b) => a.localeCompare(b, "ko"))];
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((it) => {
      if (filterPriority !== "전체" && it.priority !== filterPriority) return false;
      if (filterType !== "전체" && it.action !== filterType) return false;
      return true;
    });
  }, [items, filterPriority, filterType]);

  const markDone = async (actionKey: string) => {
    if (!courseId) return;
    const memo = (memoByKey[actionKey] || "").trim();
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/actions/${encodeURIComponent(actionKey)}/done`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memo }),
    });
    await res.json().catch(() => ({}));
    await loadActions(courseId);
  };

  if (courses.length === 0) {
    return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-600">등록된 강의가 없어요. 설정에서 먼저 강의를 등록해 주세요.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-600">
          마지막 동기화: <span className="font-medium text-slate-900">{formatTs(lastUpdatedAt)}</span>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select className="rounded-lg border px-3 py-2 text-sm" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            {["전체", "지금", "오늘", "확인", "정리"].map((x) => (
              <option key={x} value={x}>
                {x === "전체" ? "모든 우선순위" : x}
              </option>
            ))}
          </select>
          <select className="rounded-lg border px-3 py-2 text-sm" value={filterType} onChange={(e) => setFilterType(e.target.value)}>
            {types.map((x) => (
              <option key={x} value={x}>
                {x === "전체" ? "모든 유형" : x}
              </option>
            ))}
          </select>
          <button
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={() => loadActions(courseId)}
            disabled={loading}
          >
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="space-y-3">
        {filtered.map((it) => {
          const status = it.state?.status || "대기";
          return (
            <div key={it.key} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <PriorityBadge p={it.priority} />
                    <div className="truncate text-base font-semibold">{it.action}</div>
                  </div>
                  <div className="text-sm text-slate-600">{it.reason}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">{status}</div>
                  <button onClick={() => markDone(it.key)} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700">
                    처리 완료
                  </button>
                </div>
              </div>

              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-500">대상</div>
                  <div className="mt-1 text-sm font-medium text-slate-900">{it.target || "-"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-500">필요한 방</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm font-medium text-slate-900">{it.rooms || "-"}</div>
                </div>
                <div className="rounded-xl bg-slate-50 p-3">
                  <div className="text-xs font-medium text-slate-500">현재 닉네임</div>
                  <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{it.currentNicknames || "-"}</div>
                </div>
              </div>

              {it.recommendedNickname ? (
                <div className="mt-3 rounded-xl bg-brand-50 p-3">
                  <div className="text-xs font-medium text-brand-700">요청 닉네임</div>
                  <div className="mt-1 text-sm font-semibold text-brand-700">{it.recommendedNickname}</div>
                </div>
              ) : null}

              <div className="mt-3">
                <label className="block text-xs font-medium text-slate-500">메모(선택)</label>
                <input
                  className="mt-1 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200"
                  value={memoByKey[it.key] ?? it.state?.memo ?? ""}
                  onChange={(e) => setMemoByKey((p) => ({ ...p, [it.key]: e.target.value }))}
                  placeholder="필요한 경우에만 적어두세요."
                />
                {it.state?.handledBy ? (
                  <div className="mt-2 text-xs text-slate-500">
                    처리 기록: {it.state.handledBy}
                    {it.state.handledAt ? ` · ${new Date(it.state.handledAt).toLocaleString("ko-KR")}` : ""}
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {!loading && filtered.length === 0 ? (
          <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-600">표시할 항목이 없어요.</div>
        ) : null}
      </div>
    </div>
  );
}

