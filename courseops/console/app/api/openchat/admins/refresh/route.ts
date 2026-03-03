import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const Body = z.object({
  roomId: z.string().trim().min(1),
});

const REQUEST_PREFIX = "openchat_admins_refresh:";
const COOLDOWN_SEC = 15 * 60;

export async function POST(req: Request) {
  let session: { name: string } | null = null;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });

  const key = `${REQUEST_PREFIX}${parsed.data.roomId}`;
  const store = await coursesStore();

  const prev = await store.getAgentRequest(key);
  if (prev?.requestedAt) {
    const prevMs = new Date(prev.requestedAt).getTime();
    if (Number.isFinite(prevMs)) {
      const waitMs = COOLDOWN_SEC * 1000 - (Date.now() - prevMs);
      if (waitMs > 0) {
        return NextResponse.json(
          { ok: false, error: "too_many_requests", retryAfterSec: Math.ceil(waitMs / 1000) },
          { status: 429 },
        );
      }
    }
  }

  const next = await store.upsertAgentRequest({ key, requestedBy: session?.name || null });
  return NextResponse.json({ ok: true, requestedAt: next.requestedAt });
}

