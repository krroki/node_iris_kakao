import { NextResponse } from "next/server";
import { z } from "zod";

import { coursesStore } from "@/lib/store";

const Body = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_:-]+$/i),
  fetchedAt: z.string().max(64).nullable().optional(),
  payload: z.any(),
});

function requireAgent(req: Request) {
  const expected = String(process.env.COURSEOPS_AGENT_TOKEN || "").trim();
  const got = String(req.headers.get("x-courseops-agent-token") || "").trim();
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
  await store.upsertGlobalSnapshot({
    key: parsed.data.key,
    fetchedAt: parsed.data.fetchedAt ?? null,
    payload: parsed.data.payload ?? {},
  });

  return NextResponse.json({ ok: true });
}

