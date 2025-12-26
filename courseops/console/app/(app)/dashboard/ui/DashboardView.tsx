"use client";

import { useEffect, useMemo, useState } from "react";

import { useSelectedCourse } from "@/app/(app)/ui/useSelectedCourse";

type DashboardData = {
  updatedAt: string | null;
  members: {
    ssot: number;
    normal: number;
    premium: number;
    staff: number;
    complianceRate: number;
    auditStatusCounts: Record<string, number>;
  };
  actions: {
    pending: number;
    confirmWaiting: number;
    pendingByType: Array<{ type: string; count: number }>;
  };
};

type MainCafeData = {
  snapshot: {
    ok: boolean;
    fetchedAt: string | null;
    clubId: string | null;
    cafeName: string;
    cafeUrl: string | null;
    error: string | null;
  } | null;
  metrics: {
    total: number;
    gradesTop: Array<{ grade: string; count: number }>;
    joined7d: number;
    visited7d: number;
    visited30d: number;
    activeRate7d: number;
  } | null;
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
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
      {sub ? <div className="mt-1 text-xs text-slate-500">{sub}</div> : null}
    </div>
  );
}

export default function DashboardView() {
  const { courses, courseId } = useSelectedCourse();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [mainCafe, setMainCafe] = useState<MainCafeData | null>(null);
  const [mainCafeError, setMainCafeError] = useState("");

  const load = async (cid: string) => {
    if (!cid) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(cid)}/dashboard`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      setData(j as DashboardData);
    } catch (e: any) {
      setError(String(e?.message || "불러오지 못했어요."));
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  const loadMainCafe = async () => {
    setMainCafeError("");
    try {
      const res = await fetch("/api/global/main-cafe", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      setMainCafe(j as MainCafeData);
    } catch (e: any) {
      setMainCafe(null);
      setMainCafeError(String(e?.message || "불러오지 못했어요."));
    }
  };

  useEffect(() => {
    if (!courseId) return;
    load(courseId);
    const t = setInterval(() => load(courseId), 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  useEffect(() => {
    loadMainCafe();
    const t = setInterval(() => loadMainCafe(), 30000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pendingByTypeTop = useMemo(() => {
    const list = data?.actions?.pendingByType || [];
    return list.slice(0, 6);
  }, [data]);

  if (courses.length === 0) {
    return <div className="rounded-2xl border bg-white p-10 text-center text-sm text-slate-600">등록된 강의가 없어요. 설정에서 먼저 강의를 등록해 주세요.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-xl font-semibold">대시보드</h1>
          <div className="mt-1 text-sm text-slate-600">현재 강의의 운영 상태를 빠르게 확인해요.</div>
        </div>
        <div className="text-sm text-slate-600">
          마지막 동기화: <span className="font-medium text-slate-900">{formatTs(data?.updatedAt ?? null)}</span>
        </div>
      </div>

      {error ? <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card title="총 인원(결제 기준)" value={String(data?.members?.ssot ?? "-")} sub="결제 SSOT에 포함된 인원" />
        <Card title="대기 중 작업" value={String(data?.actions?.pending ?? "-")} sub="조치가 필요한 항목" />
        <Card title="프리미엄 트랙" value={String(data?.members?.premium ?? "-")} sub="결제 SSOT 기준" />
        <Card title="운영 준수율" value={data ? `${data.members.complianceRate}%` : "-"} sub="필수 방 참여(운영진 제외)" />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">유형별 대기 작업</div>
            <div className="text-xs text-slate-500">상위 6개</div>
          </div>
          <div className="mt-4 space-y-3">
            {pendingByTypeTop.map((x) => (
              <div key={x.type} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-slate-900">{x.type}</div>
                </div>
                <div className="w-40 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-2 bg-brand-600"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round((x.count / Math.max(1, data?.actions?.pending ?? 1)) * 100),
                      )}%`,
                    }}
                  />
                </div>
                <div className="w-10 text-right text-sm font-semibold text-slate-900">{x.count}</div>
              </div>
            ))}
            {!loading && (pendingByTypeTop.length === 0 || (data?.actions?.pending ?? 0) === 0) ? (
              <div className="text-sm text-slate-600">대기 중 작업이 없어요.</div>
            ) : null}
            {loading && !data ? <div className="text-sm text-slate-600">불러오는 중...</div> : null}
          </div>
        </div>

        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="text-sm font-semibold">트랙별 인원 분포</div>
          <div className="mt-4 space-y-3">
            {[
              { label: "프리미엄", value: data?.members?.premium ?? 0, color: "bg-brand-600" },
              { label: "일반", value: data?.members?.normal ?? 0, color: "bg-slate-700" },
              { label: "운영진", value: data?.members?.staff ?? 0, color: "bg-emerald-600" },
            ].map((x) => (
              <div key={x.label} className="flex items-center gap-3">
                <div className="w-14 text-sm font-medium text-slate-700">{x.label}</div>
                <div className="flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={["h-2", x.color].join(" ")}
                    style={{
                      width: `${Math.min(100, Math.round((x.value / Math.max(1, data?.members?.ssot ?? 1)) * 100))}%`,
                    }}
                  />
                </div>
                <div className="w-10 text-right text-sm font-semibold text-slate-900">{x.value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
            팁: 작업 대기열에서 “처리 완료” 후, 상단의 “반영 확인”으로 실제 반영 여부를 확인할 수 있어요.
          </div>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="text-sm font-semibold">메인 카페</div>
            <div className="mt-1 text-sm text-slate-600">
              강의 카페 활동이 줄어들어도, 메인 카페는 계속 관리가 필요해요.
            </div>
          </div>
          <div className="text-sm text-slate-600">
            마지막 갱신:{" "}
            <span className="font-medium text-slate-900">
              {formatTs(mainCafe?.snapshot?.fetchedAt ?? null)}
            </span>
          </div>
        </div>

        {mainCafeError ? (
          <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
            메인 카페를 불러오지 못했어요.
          </div>
        ) : null}

        {!mainCafe?.snapshot ? (
          <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">
            아직 메인 카페 데이터가 없어요. 잠시 후 자동으로 채워져요.
          </div>
        ) : (
          <>
            {!mainCafe.snapshot.ok ? (
              <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                지금은 메인 카페 정보를 가져오지 못했어요. 잠시 후 다시 시도할게요.
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 md:grid-cols-4">
              <Card
                title="총 멤버"
                value={String(mainCafe?.metrics?.total ?? "-")}
                sub={mainCafe?.snapshot?.cafeName || "메인 카페"}
              />
              <Card title="최근 7일 신규" value={String(mainCafe?.metrics?.joined7d ?? "-")} sub="카페 가입 기준" />
              <Card title="최근 7일 활동" value={String(mainCafe?.metrics?.visited7d ?? "-")} sub="최근 방문 기준" />
              <Card title="7일 활동률" value={mainCafe?.metrics ? `${mainCafe.metrics.activeRate7d}%` : "-"} sub="전체 대비" />
            </div>

            {mainCafe?.snapshot?.cafeUrl ? (
              <div className="mt-4">
                <a
                  href={mainCafe.snapshot.cafeUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border bg-white px-3 py-2 text-sm font-medium text-slate-900 shadow-sm hover:bg-slate-50"
                >
                  카페 관리 화면 열기
                  <span className="text-slate-400">↗</span>
                </a>
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              {(mainCafe?.metrics?.gradesTop || []).map((g) => (
                <span
                  key={g.grade}
                  className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
                >
                  <span className="max-w-[160px] truncate">{g.grade}</span>
                  <span className="rounded-full bg-white px-2 py-0.5 text-xs font-semibold text-slate-900">
                    {g.count}
                  </span>
                </span>
              ))}
            </div>

            <div className="mt-4 rounded-xl bg-slate-50 px-3 py-3 text-xs text-slate-600">
              <div className="font-semibold text-slate-700">여기서 보는 것</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>메인 카페 멤버 수 / 등급 분포</li>
                <li>최근 7일 신규 가입 / 최근 7일·30일 활동</li>
                <li>강의별 작업 대기열: 톡방 참여 누락, 권한 정리, 닉네임 규칙 등</li>
              </ul>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
