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
  const jobId = String(url.searchParams.get("jobId") || "").trim();
  if (!jobId) return NextResponse.json({ events: [] });

  const store = await coursesStore();
  const events = await store.listJobEvents(jobId, 80);
  return NextResponse.json({ events });
}

