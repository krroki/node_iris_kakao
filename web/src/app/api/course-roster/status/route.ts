export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readJsonIfExists, repoRoot } from "../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  const root = repoRoot();
  const statusPath = path.join(root, "node-iris-app", "data", "roster_worker_status.json");
  const statePath = path.join(root, "node-iris-app", "data", "roster_worker_state.json");
  const lockPath = path.join(root, "node-iris-app", "data", "locks", "roster_worker.lock");

  const status = await readJsonIfExists(statusPath);
  if (status.error) {
    return NextResponse.json(
      { ok: false, error: `status 읽기 실패: ${status.error}`, exists: true, path: statusPath },
      { status: 200 },
    );
  }

  let statusMtime: string | null = null;
  try {
    const st = await fs.promises.stat(statusPath).catch(() => null);
    statusMtime = st ? st.mtime.toISOString() : null;
  } catch {
    statusMtime = null;
  }

  const state = await readJsonIfExists(statePath);
  let stateSummary: any = null;
  if (state.exists && state.json && typeof state.json === "object") {
    const pending = Array.isArray((state.json as any).pending) ? (state.json as any).pending : [];
    stateSummary = {
      pending: pending.length,
      updatedAt: typeof (state.json as any).updatedAt === "string" ? (state.json as any).updatedAt : null,
      lastSeenMs: typeof (state.json as any).lastSeenMs === "number" ? (state.json as any).lastSeenMs : null,
    };
  } else if (state.error) {
    stateSummary = { error: state.error };
  }

  const lockExists = fs.existsSync(lockPath);
  let lockPid: string | null = null;
  try {
    if (lockExists) {
      lockPid = String((await fs.promises.readFile(lockPath, "utf8")) || "").trim() || null;
    }
  } catch {
    lockPid = null;
  }

  return NextResponse.json(
    {
      ok: true,
      status: status.json,
      statusMtime,
      statusExists: status.exists,
      state: stateSummary,
      lock: { exists: lockExists, pid: lockPid, path: lockPath },
      paths: { statusPath, statePath },
    },
    { status: 200 },
  );
}
