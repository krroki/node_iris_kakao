"use client";

import { useEffect, useMemo, useState } from "react";

import { useSelectedCourse } from "@/app/(app)/ui/useSelectedCourse";

type MemberRoom = {
  required: boolean;
  present: boolean;
  nicknames: string[];
  needsNicknameChange: boolean;
};

type Member = {
  key: string;
  cafeNickname: string;
  track: string;
  trackLabel: string;
  ssotPresent: boolean;
  ssot: null | { userId: string; nickname: string; name: string; grade: string; track: string; kind: string };
  inCafe: boolean;
  auditStatus: string;
  missingRooms: string[];
  rooms: {
    chat: MemberRoom;
    notice: MemberRoom;
    premium: MemberRoom;
  };
};

type RosterData = {
  updatedAt: string | null;
  stats: { members: number; ssot: number; normal: number; premium: number; staff: number };
  members: Member[];
};

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

function TrackBadge({ label }: { label: string }) {
  const cls =
    label === "프리미엄"
      ? "bg-brand-50 text-brand-700"
      : label === "일반"
        ? "bg-slate-100 text-slate-700"
        : label === "운영진"
          ? "bg-emerald-50 text-emerald-700"
          : "bg-slate-100 text-slate-700";
  return <span className={["rounded-full px-2 py-1 text-xs font-medium", cls].join(" ")}>{label}</span>;
}

function RoomCell({ label, room }: { label: string; room: MemberRoom }) {
  const icon = !room.required ? (
    <span className="text-slate-400">—</span>
  ) : room.present ? (
    <span className="text-emerald-600">✓</span>
  ) : (
    <span className="text-red-600">✕</span>
  );
  const nick = room.nicknames[0] || "";
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-slate-50">{icon}</span>
        <div className="text-sm font-medium text-slate-700">{label}</div>
        {room.needsNicknameChange ? (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">닉네임 확인</span>
        ) : null}
      </div>
      {nick ? <div className="truncate text-xs text-slate-500">{nick}</div> : <div className="text-xs text-slate-400"> </div>}
    </div>
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const escape = (s: string) => {
    const v = String(s ?? "");
    if (/[\",\n\r]/.test(v)) return `"${v.replace(/\"/g, '""')}"`;
    return v;
  };
  const csv = rows.map((r) => r.map(escape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function RosterView() {
  const { courses, courseId } = useSelectedCourse();
  const [data, setData] = useState<RosterData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [trackFilter, setTrackFilter] = useState<"전체" | "일반" | "프리미엄" | "운영진">("전체");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const load = async (cid: string) => {
    if (!cid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(cid)}/roster`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      setData(j as RosterData);
    } catch (e: any) {
      setError(String(e?.message || "불러오지 못했어요."));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId) return;
    load(courseId);
    const t = setInterval(() => load(courseId), 12000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const hasIssue = (m: Member) => {
      if (m.trackLabel === "운영진") return false;
      const missingRequired = (r: MemberRoom) => r.required && !r.present;
      const miss = missingRequired(m.rooms.chat) || missingRequired(m.rooms.notice) || missingRequired(m.rooms.premium);
      const nick = m.rooms.chat.needsNicknameChange || m.rooms.notice.needsNicknameChange || m.rooms.premium.needsNicknameChange;
      return miss || nick;
    };
    const matches = (m: Member) => {
      if (!term) return true;
      const fields = [
        m.cafeNickname,
        m.ssot?.name || "",
        m.ssot?.userId || "",
        m.ssot?.nickname || "",
        ...m.rooms.chat.nicknames,
        ...m.rooms.notice.nicknames,
        ...m.rooms.premium.nicknames,
      ];
      return fields.some((x) => String(x || "").toLowerCase().includes(term));
    };
    return (data?.members || [])
      .filter((m) => (trackFilter === "전체" ? true : m.trackLabel === trackFilter))
      .filter((m) => (onlyIssues ? hasIssue(m) : true))
      .filter(matches);
  }, [data, q, trackFilter, onlyIssues]);

  if (courses.length === 0) {
    return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-600">등록된 강의가 없어요. 설정에서 먼저 강의를 등록해 주세요.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">전체 명단</h1>
          <div className="mt-1 text-sm text-slate-600">멤버별 필수 방 참여/닉네임 상태를 한눈에 확인해요.</div>
        </div>
        <div className="text-sm text-slate-600">
          마지막 동기화: <span className="font-medium text-slate-900">{formatTs(data?.updatedAt ?? null)}</span>
        </div>
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            <input
              className="w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand-200 md:w-96"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="이름/카페닉/아이디/톡방닉 검색"
            />
            <select
              className="rounded-lg border px-3 py-2 text-sm"
              value={trackFilter}
              onChange={(e) => setTrackFilter(e.target.value as any)}
            >
              {["전체", "일반", "프리미엄", "운영진"].map((x) => (
                <option key={x} value={x}>
                  {x === "전체" ? "모든 트랙" : x}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              조치 필요한 항목만
            </label>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
              onClick={() => load(courseId)}
              disabled={loading}
            >
              {loading ? "불러오는 중..." : "새로고침"}
            </button>
            <button
              className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
              disabled={!data || filtered.length === 0}
              onClick={() => {
                const rows: string[][] = [
                  ["이름", "아이디", "카페 닉네임", "트랙", "사담방", "공지방", "프리미엄방", "사담방 톡방닉", "공지방 톡방닉", "프리미엄방 톡방닉"],
                  ...filtered.map((m) => [
                    m.ssot?.name || "",
                    m.ssot?.userId || "",
                    m.cafeNickname || "",
                    m.trackLabel || "",
                    m.rooms.chat.required ? (m.rooms.chat.present ? "O" : "X") : "-",
                    m.rooms.notice.required ? (m.rooms.notice.present ? "O" : "X") : "-",
                    m.rooms.premium.required ? (m.rooms.premium.present ? "O" : "X") : "-",
                    m.rooms.chat.nicknames[0] || "",
                    m.rooms.notice.nicknames[0] || "",
                    m.rooms.premium.nicknames[0] || "",
                  ]),
                ];
                downloadCsv("roster.csv", rows);
              }}
            >
              CSV 내보내기
            </button>
          </div>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          총 {data?.stats?.ssot ?? 0}명(결제 기준) · 일반 {data?.stats?.normal ?? 0} · 프리미엄 {data?.stats?.premium ?? 0} · 운영진 {data?.stats?.staff ?? 0}
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[1100px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-3">이름 / 아이디</th>
              <th className="px-4 py-3">카페 닉네임</th>
              <th className="px-4 py-3">트랙</th>
              <th className="px-4 py-3">사담방</th>
              <th className="px-4 py-3">공지방</th>
              <th className="px-4 py-3">프리미엄방</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => {
              const isStaff = m.trackLabel === "운영진";
              const missingRequired = (r: MemberRoom) => r.required && !r.present;
              const hasIssue =
                !isStaff &&
                (missingRequired(m.rooms.chat) ||
                  missingRequired(m.rooms.notice) ||
                  missingRequired(m.rooms.premium) ||
                  m.rooms.chat.needsNicknameChange ||
                  m.rooms.notice.needsNicknameChange ||
                  m.rooms.premium.needsNicknameChange);
              return (
                <tr key={m.key} className={["border-t", hasIssue ? "bg-amber-50/30" : ""].join(" ")}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{m.ssot?.name || (m.ssotPresent ? "(이름 없음)" : "-")}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{m.ssot?.userId || ""}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{m.cafeNickname}</div>
                    {!m.ssotPresent ? <div className="mt-0.5 text-xs text-slate-500">결제 SSOT 없음</div> : null}
                  </td>
                  <td className="px-4 py-3">
                    <TrackBadge label={m.trackLabel} />
                  </td>
                  <td className="px-4 py-3">
                    <RoomCell label="사담" room={m.rooms.chat} />
                  </td>
                  <td className="px-4 py-3">
                    <RoomCell label="공지" room={m.rooms.notice} />
                  </td>
                  <td className="px-4 py-3">
                    <RoomCell label="프리미엄" room={m.rooms.premium} />
                  </td>
                </tr>
              );
            })}
            {!loading && filtered.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-600">
                  표시할 항목이 없어요.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

