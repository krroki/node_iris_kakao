import { NextResponse } from "next/server";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

export async function GET(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const courseId = String(url.searchParams.get("courseId") || "");
  if (!courseId) return NextResponse.json({ job: null });
  const store = await coursesStore();
  const job = await store.getLatestJob(courseId);
  return NextResponse.json({ job });
}
