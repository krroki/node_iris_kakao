"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type MainCafeResponse = {
  ok: boolean;
  snapshot: null | {
    ok: boolean;
    fetchedAt: string | null;
    clubId: string | null;
    cafeName: string;
    cafeUrl: string | null;
    error: string | null;
  };
  metrics: null | {
    total: number;
    gradesTop: Array<{ grade: string; count: number }>;
    joined7d: number;
    visited7d: number;
    visited30d: number;
    activeRate7d: number;
  };
};

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

function Card({ title, value, sub }: { title: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="text-xs font-medium text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function MainCafeView() {
  const [data, setData] = useState<MainCafeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/global/main-cafe", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      setData(j as MainCafeResponse);
    } catch (e: any) {
      setError(String(e?.message || "불러오지 못했어요."));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cafeName = data?.snapshot?.cafeName || "메인 카페";
  const fetchedAt = data?.snapshot?.fetchedAt ?? null;

  const gradesTop = useMemo(() => data?.metrics?.gradesTop || [], [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">메인 카페</h1>
          <div className="mt-1 text-sm text-slate-600">
            강의와 무관하게 메인 카페의 상태/지표를 확인해요.
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <Link
            href="/main-cafe/members"
            className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-1 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50"
          >
            멤버 분석
            <span className="text-slate-400">↗</span>
          </Link>
          <div>
            마지막 갱신{" "}
            <span className="font-medium text-slate-900">{formatTs(fetchedAt)}</span>
          </div>
        </div>
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}
      {loading && !data ? <div className="text-sm text-slate-600">불러오는 중...</div> : null}

      {!data?.snapshot ? (
        <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600 shadow-sm">아직 메인 카페 데이터가 없어요.</div>
      ) : (
        <div className="space-y-4">
          {!data.snapshot.ok ? (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              지금은 메인 카페 데이터를 가져오지 못했어요.
              {data.snapshot.error ? <div className="mt-1 text-xs">{data.snapshot.error}</div> : null}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-5">
            <Card title="총 멤버" value={String(data?.metrics?.total ?? "-")} sub={cafeName} />
            <Card title="최근 7일 가입" value={String(data?.metrics?.joined7d ?? "-")} sub="카페 가입일 기준" />
            <Card title="최근 7일 활동" value={String(data?.metrics?.visited7d ?? "-")} sub="최종 방문일 기준" />
            <Card title="최근 30일 활동" value={String(data?.metrics?.visited30d ?? "-")} sub="최종 방문일 기준" />
            <Card title="7일 활동률" value={data?.metrics ? `${data.metrics.activeRate7d}%` : "-"} sub="최근 7일 / 전체" />
          </div>

          {data?.snapshot?.cafeUrl ? (
            <div>
              <a
                href={data.snapshot.cafeUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50"
              >
                카페 관리 화면 열기
                <span className="text-slate-400">↗</span>
              </a>
            </div>
          ) : null}

          <div className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">등급 TOP</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {gradesTop.length === 0 ? (
                <div className="text-sm text-slate-600">표시할 등급 정보가 없어요.</div>
              ) : (
                gradesTop.map((g) => (
                  <span
                    key={g.grade}
                    className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                  >
                    <span className="max-w-[180px] truncate">{g.grade}</span>
                    <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">
                      {g.count}
                    </span>
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
