export const runtime = "nodejs";

import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";

export const dynamic = "force-dynamic";

const ROOT = path.resolve(process.cwd(), "..");

const SCRIPT_BY_KIND = {
  "welcome-worker": "start_welcome_worker.ps1",
  "ai-worker": "start_ai_worker.ps1",
  "broadcast-worker": "start_broadcast_worker.ps1",
  "command-worker": "start_command_worker.ps1",
  "nickname-reminder-worker": "start_nickname_reminder_worker.ps1",
  "image-worker": "start_image_worker.ps1",
  "video-worker": "start_video_worker.ps1",
  "auto-faq-worker": "start_auto_faq_worker.ps1",
} as const;

function normKind(v: unknown): string {
  return String(v || "").trim();
}

function toUniqueKinds(body: any): string[] {
  const single = normKind(body?.kind);
  const list = Array.isArray(body?.kinds) ? body.kinds.map(normKind) : [];
  const merged = [...(single ? [single] : []), ...list].map(normKind).filter(Boolean);
  return Array.from(new Set(merged));
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    const kinds = toUniqueKinds(body);
    if (!kinds.length) {
      return NextResponse.json({ ok: false, error: "kind(s) is required" }, { status: 400 });
    }

    if (kinds.some((k) => k === "bot")) {
      return NextResponse.json({ ok: false, error: "bot restart is not supported here (use /api/bot/restart)" }, { status: 400 });
    }

    const results: Array<{ kind: string; pid: number | null; script: string }> = [];

    for (const kind of kinds) {
      const scriptName = (SCRIPT_BY_KIND as any)[kind] as string | undefined;
      if (!scriptName) {
        return NextResponse.json({ ok: false, error: `unsupported kind: ${kind}` }, { status: 400 });
      }

      const scriptPath = path.join(ROOT, "windows", scriptName);
      if (!fs.existsSync(scriptPath)) {
        return NextResponse.json({ ok: false, error: `script not found: ${scriptName}` }, { status: 500 });
      }

      const child = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Restart"],
        {
          cwd: ROOT,
          detached: true,
          stdio: "ignore",
          shell: true,
        },
      );
      child.unref();

      results.push({ kind, pid: child.pid ?? null, script: `windows/${scriptName}` });
    }

    return NextResponse.json({ ok: true, results }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

