export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { repoRoot } from "../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  const root = repoRoot();
  const p = path.join(root, "node-iris-app", "data", "auto_faq_worker_status.json");
  try {
    const raw = await fs.promises.readFile(p, "utf8");
    const obj = JSON.parse(raw || "{}");
    return NextResponse.json({ ok: true, exists: true, path: p, status: obj }, { status: 200 });
  } catch (e: any) {
    if (String(e?.code || "") === "ENOENT") {
      return NextResponse.json({ ok: true, exists: false, path: p, status: null }, { status: 200 });
    }
    return NextResponse.json({ ok: false, exists: false, path: p, error: String(e?.message || e) }, { status: 200 });
  }
}

