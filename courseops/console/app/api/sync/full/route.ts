import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const Body = z.object({ courseId: z.string().min(1) });

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "입력값이 올바르지 않아요." }, { status: 400 });

  const store = await coursesStore();
  const course = await store.getCourse(parsed.data.courseId);
  if (!course) return NextResponse.json({ error: "강의를 찾지 못했어요." }, { status: 404 });

  const job = await store.enqueueJob({
    courseId: course.id,
    kind: "SYNC_FULL",
    requestedBy: session.name,
    payload: {},
  });
  return NextResponse.json({ job });
}
