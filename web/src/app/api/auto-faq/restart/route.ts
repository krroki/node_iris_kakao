export const runtime = "nodejs";

import { NextResponse } from "next/server";
import path from "path";
import { promisify } from "util";
import { execFile } from "child_process";
import { repoRoot } from "../_util";

export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

export async function POST() {
  const root = repoRoot();
  const script = path.join(root, "windows", "start_auto_faq_worker.ps1");
  try {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-Restart"],
      { timeout: 60_000 },
    );
    return NextResponse.json({ ok: true, output: String(stdout || "") }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

