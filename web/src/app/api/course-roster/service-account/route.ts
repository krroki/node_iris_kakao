export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { readJsonIfExists, repoRoot, writeJsonAtomic } from "../_util";

export const dynamic = "force-dynamic";

export async function GET() {
  const root = repoRoot();
  const saPath = path.join(root, "data", "gcp_service_account.json");
  const j = await readJsonIfExists(saPath);
  if (j.error) {
    return NextResponse.json({ ok: false, error: j.error, exists: true, path: saPath }, { status: 200 });
  }
  const clientEmail = j.json && typeof (j.json as any)?.client_email === "string" ? (j.json as any).client_email : null;
  return NextResponse.json({ ok: true, exists: j.exists, path: saPath, clientEmail }, { status: 200 });
}

export async function POST(req: Request) {
  const root = repoRoot();
  const saPath = path.join(root, "data", "gcp_service_account.json");

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid multipart form" }, { status: 400 });
  }

  const f = form.get("file");
  if (!f || typeof (f as any).arrayBuffer !== "function") {
    return NextResponse.json({ ok: false, error: "file is required" }, { status: 400 });
  }

  let raw = "";
  try {
    const buf = Buffer.from(await (f as any).arrayBuffer());
    raw = buf.toString("utf8");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `file read failed: ${String(e?.message || e)}` }, { status: 400 });
  }

  let obj: any = null;
  try {
    obj = JSON.parse(raw || "{}");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: `invalid json: ${String(e?.message || e)}` }, { status: 400 });
  }

  const clientEmail = typeof obj?.client_email === "string" ? obj.client_email : "";
  const privateKey = typeof obj?.private_key === "string" ? obj.private_key : "";
  if (!clientEmail || !privateKey) {
    return NextResponse.json(
      { ok: false, error: "service account json must include client_email and private_key" },
      { status: 400 },
    );
  }

  try {
    await writeJsonAtomic(saPath, obj);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  // Basic sanity: ensure file exists.
  try {
    if (!fs.existsSync(saPath)) {
      return NextResponse.json({ ok: false, error: "write failed" }, { status: 500 });
    }
  } catch {}

  return NextResponse.json({ ok: true, path: saPath, clientEmail }, { status: 200 });
}
