import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const CreateBody = z.object({
  courseKey: z.string().trim().min(1, "강의 이름을 입력해 주세요."),
  sheetIdOrUrl: z.string().trim().min(1, "스프레드시트 URL 또는 ID를 입력해 주세요."),
  actionsTab: z.string().trim().min(1).default("ACTIONS"),
});

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await coursesStore();
  const courses = await store.listCourses();
  return NextResponse.json({ courses });
}

export async function POST(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "입력값이 올바르지 않아요." }, { status: 400 });
  }
  const store = await coursesStore();
  const course = await store.createCourse(parsed.data);
  return NextResponse.json({ course });
}
