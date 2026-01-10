import { NextResponse } from "next/server";
import { coursesStore } from "@/lib/store";

function requireAgent(req: Request) {
  const expected = String(process.env.COURSEOPS_AGENT_TOKEN || "").trim();
  const got = String(req.headers.get("x-courseops-agent-token") || "").trim();
  if (!expected || got !== expected) {
    throw new Error("unauthorized");
  }
}

export async function GET(req: Request) {
  try {
    requireAgent(req);
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = await coursesStore();
  const reqOpenchat = await store.getAgentRequest("openchat_overview");
  return NextResponse.json({
    ok: true,
    requests: {
      openchat_overview: reqOpenchat,
    },
  });
}

