import { NextResponse } from "next/server";
import { z } from "zod";

import { coursesStore } from "@/lib/store";

const Body = z.object({
  courseId: z.string().min(1),
  fetchedAt: z.string().max(64).nullable().optional(),
  payload: z.any(),
});

function requireAgent(req: Request) {
  const expected = String(process.env.COURSEOPS_AGENT_TOKEN || "");
  const got = String(req.headers.get("x-courseops-agent-token") || "");
  if (!expected || got !== expected) {
    throw new Error("unauthorized");
  }
}

export async function POST(req: Request) {
  try {
    requireAgent(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const store = await coursesStore();
  const course = await store.getCourse(parsed.data.courseId);
  if (!course) return NextResponse.json({ error: "course_not_found" }, { status: 404 });

  await store.upsertCourseSnapshot({
    courseId: course.id,
    fetchedAt: parsed.data.fetchedAt ?? null,
    payload: parsed.data.payload ?? {},
  });

  return NextResponse.json({ ok: true });
}

