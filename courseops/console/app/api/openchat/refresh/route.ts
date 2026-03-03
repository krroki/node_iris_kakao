import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const REQUEST_KEY = "openchat_overview";
const COOLDOWN_SEC = 30;

export async function POST() {
  let session: { name: string } | null = null;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = await coursesStore();
  const prev = await store.getAgentRequest(REQUEST_KEY);
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

  const next = await store.upsertAgentRequest({ key: REQUEST_KEY, requestedBy: session?.name || null });
  return NextResponse.json({ ok: true, requestedAt: next.requestedAt });
}

