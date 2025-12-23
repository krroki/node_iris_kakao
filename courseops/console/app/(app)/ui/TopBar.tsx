"use client";

import { useEffect, useMemo, useState } from "react";

type Job = {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  kind: "SYNC_FULL" | "REVERIFY_PENDING";
  courseId: string;
  progressPct: number | null;
  progressMessage: string | null;
  updatedAt: string | null;
};

export default function TopBar({ userName }: { userName: string }) {
  const [courseId, setCourseId] = useState<string>("");
  const [job, setJob] = useState<Job | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reverifying, setReverifying] = useState(false);

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/courses", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      const courses = Array.isArray(j?.courses) ? j.courses : [];
      const saved = typeof window !== "undefined" ? window.localStorage.getItem("courseops_selected_course_id") : "";
      const picked = saved && courses.some((c: any) => String(c?.id) === String(saved)) ? String(saved) : "";
      if (picked) setCourseId(picked);
      else if (courses.length > 0) setCourseId(String(courses[0].id || ""));
    })();
  }, []);

  const refreshJob = async (cid: string) => {
    if (!cid) return;
    const res = await fetch(`/api/jobs/latest?courseId=${encodeURIComponent(cid)}`, { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as any;
    if (j?.job) setJob(j.job as Job);
  };

  useEffect(() => {
    if (!courseId) return;
    refreshJob(courseId);
    const t = setInterval(() => refreshJob(courseId), 2500);
    return () => clearInterval(t);
  }, [courseId]);

  const badge = useMemo(() => {
    if (!job) return null;
    if (job.status === "RUNNING") return { text: "동기화 진행 중", cls: "bg-brand-50 text-brand-700" };
    if (job.status === "QUEUED") return { text: "대기 중", cls: "bg-slate-100 text-slate-700" };
    if (job.status === "FAILED") return { text: "실패", cls: "bg-red-50 text-red-700" };
    if (job.status === "DONE") return { text: "완료", cls: "bg-emerald-50 text-emerald-700" };
    return null;
  }, [job]);

  const runSync = async () => {
    if (!courseId) return;
    setSyncing(true);
    try {
      const res = await fetch("/api/sync/full", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      await res.json().catch(() => ({}));
      await refreshJob(courseId);
    } finally {
      setSyncing(false);
    }
  };

  const runReverify = async () => {
    if (!courseId) return;
    setReverifying(true);
    try {
      const res = await fetch("/api/sync/reverify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId }),
      });
      await res.json().catch(() => ({}));
      await refreshJob(courseId);
    } finally {
      setReverifying(false);
    }
  };

  return (
    <div className="sticky top-0 z-10 border-b bg-white/90 backdrop-blur">
      <div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <div className="hidden text-sm text-slate-500 md:block">담당</div>
          <div className="truncate text-sm font-medium">{userName}</div>
          {badge ? (
            <div className={["rounded-full px-2 py-1 text-xs font-medium", badge.cls].join(" ")}>{badge.text}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {job?.status === "RUNNING" ? (
            <div className="hidden max-w-[380px] items-center gap-2 text-sm text-slate-600 md:flex">
              <div className="w-48 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-2 bg-brand-600"
                  style={{ width: `${Math.max(0, Math.min(100, job.progressPct ?? 0))}%` }}
                />
              </div>
              <div className="truncate">{job.progressMessage || "진행 중"}</div>
            </div>
          ) : null}
          <button
            onClick={runSync}
            disabled={syncing || reverifying || !courseId}
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? "요청 중..." : "데이터 동기화"}
          </button>
          <button
            onClick={runReverify}
            disabled={syncing || reverifying || !courseId}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {reverifying ? "확인 중..." : "빠른 재검증"}
          </button>
        </div>
      </div>
    </div>
  );
}
