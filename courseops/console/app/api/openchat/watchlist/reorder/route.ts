import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const Body = z.object({
  pinned: z.boolean(),
  roomIds: z.array(z.string().trim().min(1)).min(1).max(500),
});

export async function POST(req: Request) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const store = await coursesStore();
  await store.reorderOpenchatWatchlist(parsed.data);
  return NextResponse.json({ ok: true });
}

