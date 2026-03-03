"use client";

import { useEffect, useState } from "react";

type Course = { id: string; courseKey: string };

const STORAGE_KEY = "courseops_selected_course_id";

export function useSelectedCourse() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState<string>("");

  const loadCourses = async () => {
    const res = await fetch("/api/courses", { cache: "no-store" });
    const j = (await res.json().catch(() => ({}))) as any;
    const list: Course[] = Array.isArray(j?.courses) ? j.courses : [];
    setCourses(list);

    const saved = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : "";
    const picked = saved && list.some((c) => String(c.id) === String(saved)) ? String(saved) : "";
    if (picked) {
      setCourseId(picked);
      return;
    }
    const first = String(list[0]?.id || "");
    if (first) {
      setCourseId(first);
      try {
        window.localStorage.setItem(STORAGE_KEY, first);
      } catch {}
    }
  };

  useEffect(() => {
    loadCourses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onChanged = (ev: any) => {
      const cid = String(ev?.detail?.courseId || "").trim();
      if (!cid) return;
      setCourseId(cid);
      try {
        window.localStorage.setItem(STORAGE_KEY, cid);
      } catch {}
    };
    window.addEventListener("courseops:selectedCourseChanged", onChanged);
    return () => window.removeEventListener("courseops:selectedCourseChanged", onChanged);
  }, []);

  return { courses, courseId, reloadCourses: loadCourses };
}

