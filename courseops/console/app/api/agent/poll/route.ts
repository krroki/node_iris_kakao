import { NextResponse } from "next/server";
import { z } from "zod";

import { coursesStore } from "@/lib/store";

const Body = z.object({
  agentName: z.string().trim().min(1),
  version: z.string().trim().optional().default(""),
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
  const job = await store.claimNextJob(parsed.data.agentName);
  if (!job) return NextResponse.json({ job: null });

  const course = await store.getCourse(job.courseId);
  return NextResponse.json({ job: { ...job, course } });
}

