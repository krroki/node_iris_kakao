export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseSpreadsheetId, readJsonIfExists, repoRoot, writeJsonAtomic } from "../_util";

export const dynamic = "force-dynamic";

function normalizeRoomConfig(v: any) {
  const enabled = v?.enabled === undefined ? true : Boolean(v?.enabled);
  const spreadsheetId = String(v?.spreadsheetId || v?.sheetId || "").trim();
  const rosterSheetName = String(v?.rosterSheetName || v?.rosterSheet || "ROSTER_RAW").trim() || "ROSTER_RAW";
  const cafeCsvPath = String(v?.cafeCsvPath || "").trim();
  const joinUrl = String(v?.joinUrl || "").trim();
  return {
    enabled,
    spreadsheetId,
    rosterSheetName,
    cafeCsvPath,
    joinUrl,
    parsedSpreadsheetId: parseSpreadsheetId(spreadsheetId),
    cafeCsvExists: cafeCsvPath ? fs.existsSync(cafeCsvPath) : false,
  };
}

export async function GET() {
  const root = repoRoot();
  const cfgPath = path.join(root, "data", "course_roster_worker.json");
  const saPath = path.join(root, "data", "gcp_service_account.json");

  const cfg = await readJsonIfExists(cfgPath);
  if (cfg.error) {
    return NextResponse.json(
      { ok: false, error: `course_roster_worker.json 읽기 실패: ${cfg.error}`, exists: true, path: cfgPath },
      { status: 200 },
    );
  }

  let serviceAccountEmail: string | null = null;
  let serviceAccountError: string | null = null;
  try {
    if (fs.existsSync(saPath)) {
      const raw = await fs.promises.readFile(saPath, "utf8");
      const j = JSON.parse(raw || "{}");
      serviceAccountEmail = typeof j?.client_email === "string" ? j.client_email : null;
    }
  } catch (e: any) {
    serviceAccountError = String(e?.message || e);
  }

  const config = cfg.json && typeof cfg.json === "object" ? cfg.json : null;
  const roomsObj = config && typeof (config as any).rooms === "object" && (config as any).rooms ? (config as any).rooms : {};
  const rooms: Record<string, any> = {};
  for (const [rid, v] of Object.entries(roomsObj || {})) {
    const rid2 = String(rid || "").trim();
    if (!rid2 || typeof v !== "object" || !v) continue;
    rooms[rid2] = normalizeRoomConfig(v);
  }

  return NextResponse.json(
    {
      ok: true,
      exists: cfg.exists,
      path: cfgPath,
      config: config ? { ...config, rooms } : null,
      serviceAccount: {
        exists: fs.existsSync(saPath),
        path: saPath,
        clientEmail: serviceAccountEmail,
        error: serviceAccountError,
      },
    },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  const root = repoRoot();
  const cfgPath = path.join(root, "data", "course_roster_worker.json");

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const input = body && typeof body === "object" && body.config && typeof body.config === "object" ? body.config : body;
  if (!input || typeof input !== "object") {
    return NextResponse.json({ ok: false, error: "config must be an object" }, { status: 400 });
  }

  const inRooms = (input as any).rooms;
  if (inRooms !== undefined && (typeof inRooms !== "object" || !inRooms)) {
    return NextResponse.json({ ok: false, error: "rooms must be an object" }, { status: 400 });
  }

  const outRooms: Record<string, any> = {};
  for (const [rid, v] of Object.entries(inRooms || {})) {
    const rid2 = String(rid || "").trim();
    if (!rid2 || typeof v !== "object" || !v) continue;
    const vv: any = v;
    outRooms[rid2] = {
      enabled: vv?.enabled === undefined ? true : Boolean(vv?.enabled),
      spreadsheetId: String(vv?.spreadsheetId || "").trim(),
      rosterSheetName: String(vv?.rosterSheetName || "ROSTER_RAW").trim() || "ROSTER_RAW",
      cafeCsvPath: String(vv?.cafeCsvPath || "").trim(),
      joinUrl: String(vv?.joinUrl || "").trim(),
    };
  }

  const out = {
    version: Number((input as any).version) || 1,
    rooms: outRooms,
  };

  try {
    await writeJsonAtomic(cfgPath, out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: cfgPath }, { status: 200 });
}
