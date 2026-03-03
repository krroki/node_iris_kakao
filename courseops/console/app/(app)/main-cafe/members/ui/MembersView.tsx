"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type PersonCourse = {
  courseId: string;
  courseKey: string;
  ssotPresent: boolean;
  inCafe: boolean;
  auditStatus: string;
  missingRooms: string[];
};

type Person = {
  key: string;
  displayName: string;
  ssotUserId: string | null;
  cafeUserId: string | null;
  ssotName: string | null;
  ssotNickname: string | null;
  cafeNickname: string | null;
  counts: { courses: number; ssotPresent: number; inCafe: number; issues: number };
  courses: PersonCourse[];
};

type MembersResponse = {
  ok: boolean;
  updatedAt: string;
  stats: { courses: number; peopleTotal: number; returned: number };
  people: Person[];
};

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

export default function MembersView() {
  const [data, setData] = useState<MembersResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [limit, setLimit] = useState(500);
  const [onlyIssues, setOnlyIssues] = useState(false);

  const url = useMemo(() => {
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    sp.set("limit", String(limit));
    if (onlyIssues) sp.set("onlyIssues", "1");
    return `/api/analytics/members?${sp.toString()}`;
  }, [q, limit, onlyIssues]);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(url, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      setData(j as MembersResponse);
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
  }, [url]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">멤버 분석</h1>
            <Link href="/main-cafe" className="text-sm text-slate-600 hover:underline">
              ← 메인 카페
            </Link>
          </div>
          <div className="mt-1 text-sm text-slate-600">
            지금까지 진행한 강의(카페/결제SSOT/오픈채팅)를 합쳐, 멤버별 참여/수강 현황을 요약해요.
          </div>
        </div>
        <div className="text-sm text-slate-600">
          마지막 갱신 <span className="font-medium text-slate-900">{formatTs(data?.updatedAt ?? null)}</span>
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
              placeholder="이름/닉네임/아이디 검색(띄어쓰기 무시)"
            />
            <select className="rounded-lg border px-3 py-2 text-sm" value={String(limit)} onChange={(e) => setLimit(Number(e.target.value) || 500)}>
              {[100, 300, 500, 1000, 2000].map((n) => (
                <option key={n} value={String(n)}>
                  {n}명
                </option>
              ))}
            </select>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={onlyIssues} onChange={(e) => setOnlyIssues(e.target.checked)} />
              이슈만
            </label>
          </div>
          <button
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
            onClick={load}
            disabled={loading}
          >
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>
        <div className="mt-3 text-xs text-slate-600">
          코스 {data?.stats?.courses ?? 0}개 · 사람 {data?.stats?.peopleTotal ?? 0}명 · 표시 {data?.stats?.returned ?? 0}명
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-white shadow-sm">
        <table className="min-w-[1100px] w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600">
            <tr>
              <th className="px-4 py-3">멤버</th>
              <th className="px-4 py-3">수강(SSOT)</th>
              <th className="px-4 py-3">카페</th>
              <th className="px-4 py-3">총 코스</th>
              <th className="px-4 py-3">이슈</th>
              <th className="px-4 py-3">코스</th>
            </tr>
          </thead>
          <tbody>
            {(data?.people || []).map((p) => {
              const courses = p.courses || [];
              const chips = courses.slice(0, 6);
              const more = Math.max(0, courses.length - chips.length);
              return (
                <tr key={p.key} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{p.displayName}</div>
                    <div className="mt-0.5 text-xs text-slate-500">
                      {p.ssotNickname ? `SSOT 닉네임: ${p.ssotNickname}` : p.cafeNickname ? `카페 닉네임: ${p.cafeNickname}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">{p.counts.ssotPresent}</td>
                  <td className="px-4 py-3">{p.counts.inCafe}</td>
                  <td className="px-4 py-3">{p.counts.courses}</td>
                  <td className="px-4 py-3">
                    {p.counts.issues > 0 ? <span className="rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">{p.counts.issues}</span> : "-"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-2">
                      {chips.map((c) => (
                        <span key={c.courseId} className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                          {c.courseKey}
                        </span>
                      ))}
                      {more > 0 ? <span className="text-xs text-slate-500">+{more}</span> : null}
                    </div>
                  </td>
                </tr>
              );
            })}
            {!loading && (data?.people?.length || 0) === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-600">
                  표시할 결과가 없어요.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

