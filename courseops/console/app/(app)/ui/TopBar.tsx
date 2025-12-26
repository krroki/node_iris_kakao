"use client";

import { useEffect, useMemo, useState } from "react";

type Course = { id: string; courseKey: string };
type Job = {
  id: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED";
  kind: "SYNC_FULL" | "REVERIFY_PENDING";
  courseId: string;
  progressPct: number | null;
  progressMessage: string | null;
  updatedAt: string | null;
};

type JobEvent = { level: "INFO" | "WARN" | "ERROR"; message: string; ts: string };

export default function TopBar({ userName, canSync }: { userName: string; canSync: boolean }) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string>("");
  const [job, setJob] = useState<Job | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [reverifying, setReverifying] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [events, setEvents] = useState<JobEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsError, setEventsError] = useState("");

  useEffect(() => {
    (async () => {
      const res = await fetch("/api/courses", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      const courses = Array.isArray(j?.courses) ? j.courses : [];
      setCourses(courses as Course[]);
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

  const refreshEvents = async (jobId: string) => {
    if (!jobId) return;
    setEventsError("");
    setEventsLoading(true);
    try {
      const res = await fetch(`/api/jobs/events?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "로그를 불러오지 못했어요."));
      const list: JobEvent[] = Array.isArray(j?.events) ? j.events : [];
      setEvents(list);
    } catch (e: any) {
      setEventsError(String(e?.message || "로그를 불러오지 못했어요."));
    } finally {
      setEventsLoading(false);
    }
  };

  useEffect(() => {
    if (!courseId) return;
    refreshJob(courseId);
    const t = setInterval(() => refreshJob(courseId), 2500);
    return () => clearInterval(t);
  }, [courseId]);

  useEffect(() => {
    if (!logOpen || !job?.id) return;
    refreshEvents(job.id);
    const intervalMs = job.status === "RUNNING" || job.status === "QUEUED" ? 2500 : 8000;
    const t = setInterval(() => refreshEvents(job.id), intervalMs);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [logOpen, job?.id, job?.status]);

  const badge = useMemo(() => {
    if (!job) return null;
    const kind = job.kind === "REVERIFY_PENDING" ? "반영 확인" : "동기화";
    if (job.status === "RUNNING") return { text: `${kind} 진행 중`, cls: "bg-brand-50 text-brand-700" };
    if (job.status === "QUEUED") return { text: `${kind} 대기 중`, cls: "bg-slate-100 text-slate-700" };
    if (job.status === "FAILED") return { text: `${kind} 실패`, cls: "bg-red-50 text-red-700" };
    if (job.status === "DONE") return { text: `${kind} 완료`, cls: "bg-emerald-50 text-emerald-700" };
    return null;
  }, [job]);

  const runSync = async () => {
    if (!courseId || !canSync) return;
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
    if (!courseId || !canSync) return;
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
          <div className="hidden text-sm text-slate-500 md:block">강의</div>
          <select
            className="max-w-[360px] rounded-lg border bg-white px-3 py-2 text-sm"
            value={courseId}
            onChange={(e) => {
              const v = e.target.value;
              setCourseId(v);
              setJob(null);
              try {
                window.localStorage.setItem("courseops_selected_course_id", v);
              } catch {}
              try {
                window.dispatchEvent(new CustomEvent("courseops:selectedCourseChanged", { detail: { courseId: v } }));
              } catch {}
              refreshJob(v);
            }}
          >
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.courseKey}
              </option>
            ))}
          </select>
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
            onClick={() => {
              const next = !logOpen;
              setLogOpen(next);
              if (next && job?.id) refreshEvents(job.id);
            }}
            disabled={!job?.id}
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            작업 로그
          </button>
          <button
            onClick={runSync}
            disabled={syncing || reverifying || !courseId || !canSync}
            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            {syncing ? "요청 중..." : "전체 동기화"}
          </button>
          <button
            onClick={runReverify}
            disabled={syncing || reverifying || !courseId || !canSync}
            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {reverifying ? "확인 중..." : "반영 확인"}
          </button>
        </div>
      </div>

      {!canSync ? (
        <div className="border-t bg-amber-50 px-4 py-2 text-sm text-amber-800 md:px-8">이 계정은 동기화 권한이 없어요.</div>
      ) : null}

      {logOpen ? (
        <div className="border-t bg-white px-4 py-3 md:px-8">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-semibold">작업 로그</div>
            <button
              className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
              onClick={() => (job?.id ? refreshEvents(job.id) : null)}
              disabled={!job?.id || eventsLoading}
            >
              {eventsLoading ? "불러오는 중..." : "새로고침"}
            </button>
          </div>
          {eventsError ? <div className="mt-2 text-sm text-red-700">{eventsError}</div> : null}
          <div className="mt-3 space-y-2">
            {events.map((ev, idx) => (
              <div key={`${ev.ts}-${idx}`} className="flex items-start gap-2 text-sm">
                <div
                  className={[
                    "mt-0.5 h-2 w-2 shrink-0 rounded-full",
                    ev.level === "ERROR" ? "bg-red-500" : ev.level === "WARN" ? "bg-amber-500" : "bg-emerald-500",
                  ].join(" ")}
                />
                <div className="min-w-0 whitespace-pre-wrap text-slate-700">{ev.message}</div>
              </div>
            ))}
            {!eventsLoading && events.length === 0 ? <div className="text-sm text-slate-600">표시할 로그가 없어요.</div> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
