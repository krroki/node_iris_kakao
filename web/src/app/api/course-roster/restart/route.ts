export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { spawn } from "child_process";
import path from "path";
import { repoRoot } from "../_util";

export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const root = repoRoot();
    const script = path.join(root, "windows", "start_roster_worker.ps1");

    const child = spawn(
      "powershell.exe",
      ["-ExecutionPolicy", "Bypass", "-File", script, "-Restart"],
      {
        cwd: root,
        detached: true,
        stdio: "ignore",
        shell: true,
      },
    );
    child.unref();

    return NextResponse.json({ ok: true, pid: child.pid }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
