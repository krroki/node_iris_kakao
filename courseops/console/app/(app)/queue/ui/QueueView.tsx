"use client";

import { useEffect, useMemo, useState } from "react";

import { useSelectedCourse } from "@/app/(app)/ui/useSelectedCourse";

const LS_HIDE_HIDDEN = "courseops_pref_hide_hidden_actions";
const LS_HIDE_INCOMPLETE = "courseops_pref_hide_incomplete_actions";
const LS_TYPE_FILTERS = "courseops_pref_action_type_filters";

function readBool(key: string, fallback: boolean) {
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1" || v === "true";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean) {
  try {
    window.localStorage.setItem(key, v ? "1" : "0");
  } catch {}
}

function readStringArray(key: string) {
  try {
    const v = window.localStorage.getItem(key);
    if (!v) return [] as string[];
    const parsed = JSON.parse(v);
    if (!Array.isArray(parsed)) return [] as string[];
    return parsed.map((x) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [] as string[];
  }
}

function writeStringArray(key: string, v: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v || []));
  } catch {}
}

type ActionStatus = "대기" | "확인 대기" | "완료(검증됨)" | "미해결(재확인)" | "확인 불가(데이터 미완전)";

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
    status: ActionStatus;
    hidden?: boolean;
    hiddenBy?: string | null;
    hiddenAt?: string | null;
    handledBy?: string | null;
    handledAt?: string | null;
    memo?: string | null;
  };
};

type ActionItemWithType = ActionItem & {
  typeLabel: string;
};

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

const PRIORITY_LABEL: Record<ActionItem["priority"], string> = {
  지금: "긴급",
  오늘: "오늘",
  확인: "확인",
  정리: "나중에",
};

function formatPriority(p: ActionItem["priority"]) {
  return PRIORITY_LABEL[p] || p;
}

function formatStatus(status: ActionStatus) {
  if (status === "완료(검증됨)") return "확인 완료";
  if (status === "미해결(재확인)") return "재확인 필요";
  if (status === "확인 불가(데이터 미완전)") return "데이터 부족";
  return status || "대기";
}

function splitActionLabel(action: string): { label: string; hint: string } {
  const canonical = (label: string) => {
    const x = String(label || "").trim();
    const norm = x.replace(/\s+/g, "");
    if (!x) return "";
    if (norm.includes("바꿀닉네임으로변경요청")) return "닉네임 변경 요청";
    if (norm.includes("닉네임변경요청")) return "닉네임 변경 요청";
    if (norm.includes("입장안내")) return "필수 방 입장 안내";
    if (norm.includes("결제") && norm.includes("확인")) return "결제 기록 확인";
    if (norm.includes("카페") && norm.includes("닉네임") && norm.includes("확인")) return "카페 닉네임 확인";
    if (norm.includes("권한") && norm.includes("확인")) return "권한 확인";
    return x;
  };

  const a = String(action || "").trim();
  if (!a) return { label: "", hint: "" };
  const mParen = a.match(/^(.*?)(?:\s*[\(\[]([^)\]]{1,40})[\)\]]\s*)$/);
  if (mParen) return { label: canonical(String(mParen[1] || "")), hint: String(mParen[2] || "").trim() };
  const mDash = a.match(/^(.*?)(?:\s*-\s*(.{1,40})\s*)$/);
  if (mDash) return { label: canonical(String(mDash[1] || "")), hint: String(mDash[2] || "").trim() };
  return { label: canonical(a), hint: "" };
}

function cardAccentCls(priority: ActionItem["priority"]) {
  if (priority === "지금") return "border-l-4 border-l-red-500 bg-red-50/20";
  if (priority === "오늘") return "border-l-4 border-l-amber-500 bg-amber-50/20";
  if (priority === "확인") return "border-l-4 border-l-slate-300";
  return "border-l-4 border-l-transparent";
}

function parseRooms(rooms: string) {
  const raw = String(rooms || "").trim();
  if (!raw) return [] as string[];
  return raw
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function formatReasonText(reason: string) {
  const raw = String(reason || "").trim();
  if (!raw) return "-";

  const mapOne = (token: string) => {
    const t = String(token || "").trim();
    const n = t.replace(/\s+/g, "");
    if (!n) return "";
    if (n.includes("멤버목록이덜불러와짐")) return "멤버 목록이 비어 있어요";
    if (n.includes("닉네임이???로표시됨")) return "닉네임이 깨져 보여요";
    if (n.includes("카페미가입")) return "카페 미가입";
    if (n.includes("톡방미입장")) return "필수 방에 아직 없어요";
    if (n.includes("동명이인의심")) return "동명이인 가능성이 있어요";
    if (n.includes("일반반인데프리미엄방참여중")) return "일반반인데 프리미엄방에 있어요";
    if (n.includes("결제기록없음")) return "결제 기록이 없어요";
    if (n.includes("카페명단에없음")) return "카페 명단에서 찾지 못했어요";
    if (n.includes("괄호(카페닉)없음")) return "카페 닉네임(괄호)이 없어요";
    if (n.includes("슬래시포함")) return "닉네임에 '/'가 있어요";
    if (n.includes("이름마스킹규칙불일치")) return "이름(@) 규칙이 달라요";
    if (n.includes("형식불일치")) return "닉네임 형식이 달라요";
    return t;
  };

  // "A / B" 형태(카페/톡방 등)는 + 로 합쳐서 짧게 표현
  if (raw.includes("/")) {
    const parts = raw
      .split("/")
      .map((x) => mapOne(x))
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    return parts.length ? parts.join(" + ") : "-";
  }

  // 이슈 목록은 "·"로 묶어 표시
  if (raw.includes(",")) {
    const parts = raw
      .split(",")
      .map((x) => mapOne(x))
      .map((x) => String(x || "").trim())
      .filter(Boolean);
    return parts.length ? parts.join(" · ") : "-";
  }

  return mapOne(raw) || "-";
}

function PriorityBadge({ p }: { p: ActionItem["priority"] }) {
  const cls =
    p === "지금"
      ? "bg-red-50 text-red-700"
      : p === "오늘"
        ? "bg-amber-50 text-amber-800"
        : p === "확인"
          ? "bg-slate-100 text-slate-700"
          : "bg-slate-50 text-slate-600";
  return <span className={["rounded-full px-2 py-1 text-xs font-medium", cls].join(" ")}>{formatPriority(p)}</span>;
}

function ActionTypeBadge({ action }: { action: string }) {
  const a = String(action || "").trim();
  if (!a) return null;
  const norm = a.replace(/\s+/g, "");
  const kind =
    norm.includes("입장안내")
      ? { label: "입장", cls: "bg-blue-50 text-blue-700" }
      : norm.includes("닉네임")
        ? { label: "닉네임", cls: "bg-purple-50 text-purple-700" }
        : norm.includes("결제")
          ? { label: "결제", cls: "bg-amber-50 text-amber-800" }
          : norm.includes("권한") || norm.includes("정리")
            ? { label: "권한", cls: "bg-rose-50 text-rose-700" }
            : norm.includes("카페")
              ? { label: "카페", cls: "bg-slate-100 text-slate-700" }
              : { label: "확인", cls: "bg-slate-100 text-slate-700" };
  return <span className={["rounded-full px-2 py-1 text-xs font-medium", kind.cls].join(" ")}>{kind.label}</span>;
}

function StatusBadge({ status }: { status: ActionStatus }) {
  const s = String(status || "").trim() as ActionStatus;
  const label = formatStatus(s);
  const cls =
    s === "완료(검증됨)"
      ? "bg-emerald-50 text-emerald-700"
      : s === "미해결(재확인)"
        ? "bg-amber-50 text-amber-800"
        : s === "확인 불가(데이터 미완전)"
          ? "bg-rose-50 text-rose-700"
          : s === "확인 대기"
            ? "bg-blue-50 text-blue-700"
            : "bg-slate-100 text-slate-700";
  return <span className={["rounded-full px-3 py-1 text-xs font-medium", cls].join(" ")}>{label}</span>;
}

export default function QueueView() {
  const { courses, courseId } = useSelectedCourse();
  const [items, setItems] = useState<ActionItem[]>([]);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [filterPriority, setFilterPriority] = useState<string>("전체");
  const [typeFilters, setTypeFilters] = useState<string[]>([]);
  const [hideHidden, setHideHidden] = useState(true);
  const [hideIncomplete, setHideIncomplete] = useState(true);
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
    setHideHidden(readBool(LS_HIDE_HIDDEN, true));
    setHideIncomplete(readBool(LS_HIDE_INCOMPLETE, true));
    setTypeFilters(readStringArray(LS_TYPE_FILTERS));
  }, []);

  useEffect(() => {
    if (!courseId) return;
    loadActions(courseId);
    const t = setInterval(() => loadActions(courseId), 7000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const itemsWithType = useMemo<ActionItemWithType[]>(() => {
    return items.map((it) => {
      const info = splitActionLabel(it.action);
      const label = info.label || String(it.action || "").trim() || "기타";
      return { ...it, typeLabel: label };
    });
  }, [items]);

  const typeLabels = useMemo(() => {
    const s = new Set<string>();
    for (const it of itemsWithType) s.add(it.typeLabel);
    return Array.from(s).sort((a, b) => a.localeCompare(b, "ko"));
  }, [itemsWithType]);

  const hiddenCount = useMemo(() => items.filter((it) => Boolean(it.state?.hidden)).length, [items]);
  const incompleteCount = useMemo(
    () => items.filter((it) => it.state?.status === "확인 불가(데이터 미완전)").length,
    [items],
  );

  const baseFiltered = useMemo(() => {
    return itemsWithType.filter((it) => {
      if (filterPriority !== "전체" && it.priority !== filterPriority) return false;
      if (hideHidden && it.state?.hidden) return false;
      if (hideIncomplete && it.state?.status === "확인 불가(데이터 미완전)") return false;
      return true;
    });
  }, [itemsWithType, filterPriority, hideHidden, hideIncomplete]);

  const typeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of baseFiltered) m.set(it.typeLabel, (m.get(it.typeLabel) || 0) + 1);
    return m;
  }, [baseFiltered]);

  const selectedTypeSet = useMemo(() => new Set(typeFilters), [typeFilters]);

  useEffect(() => {
    if (typeFilters.length === 0) return;
    const next = typeFilters.filter((x) => typeLabels.includes(x));
    if (next.length === typeFilters.length) return;
    setTypeFilters(next);
    writeStringArray(LS_TYPE_FILTERS, next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeLabels.join("|")]);

  const filtered = useMemo(() => {
    if (selectedTypeSet.size === 0) return baseFiltered;
    return baseFiltered.filter((it) => selectedTypeSet.has(it.typeLabel));
  }, [baseFiltered, selectedTypeSet]);

  const toggleType = (label: string) => {
    setTypeFilters((prev) => {
      const s = new Set(prev);
      if (s.has(label)) s.delete(label);
      else s.add(label);
      const next = Array.from(s);
      writeStringArray(LS_TYPE_FILTERS, next);
      return next;
    });
  };

  const clearTypes = () => {
    setTypeFilters([]);
    writeStringArray(LS_TYPE_FILTERS, []);
  };

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

  const setHiddenForAction = async (actionKey: string, hidden: boolean) => {
    if (!courseId) return;
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}/actions/${encodeURIComponent(actionKey)}/hide`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hidden }),
    });
    await res.json().catch(() => ({}));
    await loadActions(courseId);
  };

  if (courses.length === 0) {
    return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-600">등록된 강의가 없어요. 설정에서 먼저 강의를 등록해 주세요.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">사용 방법</div>
        <div className="mt-2 space-y-1 text-sm text-slate-700">
          <div>
            1) 오른쪽 위 <span className="font-medium">전체 동기화</span>로 최신 데이터를 불러와요.
          </div>
          <div>
            2) 카드에 적힌 대로 처리한 뒤 <span className="font-medium">처리 완료</span>를 눌러요.
          </div>
          <div>
            3) <span className="font-medium">반영 확인</span>으로 실제 반영 여부를 확인해요.
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border bg-white p-4 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-slate-600">
          마지막 동기화: <span className="font-medium text-slate-900">{formatTs(lastUpdatedAt)}</span>
        </div>
        <div className="flex flex-col gap-2 md:flex-row md:items-center">
          <select className="rounded-lg border px-3 py-2 text-sm" value={filterPriority} onChange={(e) => setFilterPriority(e.target.value)}>
            {[
              { value: "전체", label: "모든 우선순위" },
              { value: "지금", label: formatPriority("지금") },
              { value: "오늘", label: formatPriority("오늘") },
              { value: "확인", label: formatPriority("확인") },
              { value: "정리", label: formatPriority("정리") },
            ].map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideHidden}
              onChange={(e) => {
                const v = e.target.checked;
                setHideHidden(v);
                writeBool(LS_HIDE_HIDDEN, v);
              }}
            />
            숨김 항목 숨기기
          </label>
          <label className="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={hideIncomplete}
              onChange={(e) => {
                const v = e.target.checked;
                setHideIncomplete(v);
                writeBool(LS_HIDE_INCOMPLETE, v);
              }}
            />
            데이터 부족 숨기기
          </label>
          <button
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
            onClick={() => loadActions(courseId)}
            disabled={loading}
          >
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold">작업 유형</div>
          <div className="text-xs text-slate-600">클릭해서 필터를 켜고/끌 수 있어요.</div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            aria-pressed={typeFilters.length === 0}
            onClick={clearTypes}
            className={[
              "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
              typeFilters.length === 0
                ? "border-brand-600 bg-brand-600 text-white"
                : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
            ].join(" ")}
          >
            전체
            <span
              className={[
                "rounded-full px-2 py-0.5 text-xs font-semibold",
                typeFilters.length === 0 ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700",
              ].join(" ")}
            >
              {baseFiltered.length}
            </span>
          </button>
          {typeLabels.map((label) => {
            const count = typeCounts.get(label) || 0;
            const active = selectedTypeSet.has(label);
            const disabled = count === 0 && !active;
            return (
              <button
                key={label}
                type="button"
                aria-pressed={active}
                disabled={disabled}
                onClick={() => toggleType(label)}
                className={[
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium",
                  active
                    ? "border-brand-600 bg-brand-600 text-white"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
                  disabled ? "cursor-not-allowed opacity-40 hover:bg-white" : "",
                ].join(" ")}
              >
                {label}
                <span
                  className={[
                    "rounded-full px-2 py-0.5 text-xs font-semibold",
                    active ? "bg-white/20 text-white" : "bg-slate-100 text-slate-700",
                  ].join(" ")}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="text-xs text-slate-600">
        현재 표시 {filtered.length}건 · 전체 {items.length}건
        {hiddenCount ? ` · 숨김 ${hiddenCount}건` : ""}
        {incompleteCount ? ` · 데이터 부족 ${incompleteCount}건` : ""}
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="space-y-3">
        {filtered.map((it) => {
          const status: ActionStatus = it.state?.status || "대기";
          const actionInfo = splitActionLabel(it.action);
          const actionLabel = actionInfo.label || it.action || "";
          const actionHint = actionInfo.hint;
          const rooms = parseRooms(it.rooms);
          return (
            <div
              key={it.key}
              className={["rounded-2xl border border-slate-200 p-4 shadow-sm", cardAccentCls(it.priority)].join(" ")}
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <PriorityBadge p={it.priority} />
                    <ActionTypeBadge action={it.action} />
                    {actionHint ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">{actionHint}</span>
                    ) : null}
                    {it.state?.hidden ? (
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700">숨김</span>
                    ) : null}
                  </div>

                  <div className="mt-2 space-y-1">
                    <div className="truncate text-lg font-semibold text-slate-900">{it.target || "대상 없음"}</div>
                    <div className="text-sm font-medium text-slate-800">{actionLabel || "조치"}</div>
                    <div className="text-sm text-slate-600">사유: {formatReasonText(it.reason)}</div>
                  </div>

                  {rooms.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {rooms.map((r) => (
                        <span key={r} className="rounded-full bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">
                          {r}
                        </span>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-4 grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 p-3">
                      <div className="text-xs font-medium text-slate-500">현재 톡방 닉네임</div>
                      <div className="mt-1 whitespace-pre-wrap text-sm text-slate-900">{it.currentNicknames || "-"}</div>
                    </div>
                    <div className={["rounded-xl p-3", it.recommendedNickname ? "bg-brand-50" : "bg-slate-50"].join(" ")}>
                      <div className={["text-xs font-medium", it.recommendedNickname ? "text-brand-700" : "text-slate-500"].join(" ")}>
                        요청 닉네임
                      </div>
                      {it.recommendedNickname ? (
                        <div className="mt-1 text-sm font-semibold text-brand-700">{it.recommendedNickname}</div>
                      ) : (
                        <div className="mt-1 text-sm text-slate-400">-</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-2 md:flex-col md:items-end">
                  <StatusBadge status={status} />
                  <button
                    onClick={() => markDone(it.key)}
                    className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    처리 완료
                  </button>
                  <button
                    onClick={() => setHiddenForAction(it.key, !Boolean(it.state?.hidden))}
                    className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                  >
                    {it.state?.hidden ? "숨김 해제" : "숨김"}
                  </button>
                </div>
              </div>

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
