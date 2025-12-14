import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const repoRoot = path.resolve(process.cwd(), "..");
    const logPath = path.join(repoRoot, "windows", "watchdog.log");
    const stat = await fs.promises.stat(logPath);
    const raw = await fs.promises.readFile(logPath, "utf8");
    const lines = raw.trim().split(/\r?\n/).slice(-80); // 마지막 80줄만
    return NextResponse.json(
      {
        ok: true,
        mtime: stat.mtime.toISOString(),
        lines,
      },
      { status: 200 },
    );
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: String(e?.message || e),
        lines: [],
      },
      { status: 200 },
    );
  }
}
