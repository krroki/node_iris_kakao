import { NextResponse } from "next/server";
import { z } from "zod";

import { coursesStore } from "@/lib/store";

const Body = z.object({
  jobId: z.string().min(1),
  status: z.enum(["RUNNING", "DONE", "FAILED"]),
  progressPct: z.number().int().min(0).max(100).nullable().optional(),
  progressMessage: z.string().max(500).nullable().optional(),
  actionUpdates: z
    .array(
      z.object({
        actionKey: z.string().min(1),
        status: z.enum(["확인 대기", "완료(검증됨)", "미해결(재확인)", "확인 불가(데이터 미완전)"]),
      }),
    )
    .optional()
    .default([]),
  events: z
    .array(
      z.object({
        level: z.enum(["INFO", "WARN", "ERROR"]).default("INFO"),
        message: z.string().max(300),
        ts: z.string().max(64).optional(),
      }),
    )
    .optional()
    .default([]),
  resultMessage: z.string().max(800).optional().default(""),
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
  await store.updateJobProgress(parsed.data);
  return NextResponse.json({ ok: true });
}
