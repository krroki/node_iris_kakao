"use client";

import { useEffect, useState } from "react";

type Course = { id: string; courseKey: string; sheetId: string; actionsTab: string };

export default function SettingsView() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [sheetIdOrUrl, setSheetIdOrUrl] = useState("");
  const [actionsTab, setActionsTab] = useState("ACTIONS");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const res = await fetch("/api/courses", { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as any;
    setCourses(Array.isArray(j?.courses) ? j.courses : []);
  };

  useEffect(() => {
    load();
  }, []);

  const addCourse = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey, sheetIdOrUrl, actionsTab }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        setError(String(j?.error || "저장에 실패했어요."));
        return;
      }
      setCourseKey("");
      setSheetIdOrUrl("");
      setActionsTab("ACTIONS");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">강의 추가</div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs font-medium text-slate-500">강의 이름</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={courseKey}
              onChange={(e) => setCourseKey(e.target.value)}
              placeholder="예: 사알못사주자동화 [카라반]"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">스프레드시트 URL 또는 ID</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={sheetIdOrUrl}
              onChange={(e) => setSheetIdOrUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">ACTIONS 탭 이름</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={actionsTab}
              onChange={(e) => setActionsTab(e.target.value)}
              placeholder="ACTIONS"
            />
          </div>
        </div>
        {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-3">
          <button
            onClick={addCourse}
            disabled={saving}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">등록된 강의</div>
        <div className="mt-3 space-y-2">
          {courses.map((c) => (
            <div key={c.id} className="rounded-xl border bg-slate-50 p-3 text-sm">
              <div className="font-semibold">{c.courseKey}</div>
              <div className="mt-1 text-slate-600">시트: {c.sheetId}</div>
              <div className="text-slate-600">탭: {c.actionsTab}</div>
            </div>
          ))}
          {courses.length === 0 ? <div className="text-sm text-slate-600">아직 등록된 강의가 없어요.</div> : null}
        </div>
      </div>
    </div>
  );
}

