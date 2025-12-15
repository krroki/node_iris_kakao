export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseSpreadsheetId, readJsonIfExists, repoRoot, writeJsonAtomic } from "../_util";

export const dynamic = "force-dynamic";

function normalizeWorker(v: any) {
  const enabled = Boolean(v?.enabled);
  const intervalSecRaw = Number(v?.intervalSec ?? v?.interval_sec);
  const intervalSec = Number.isFinite(intervalSecRaw) ? Math.max(60, Math.floor(intervalSecRaw)) : 3600;
  return { enabled, intervalSec };
}

function normalizeRoomConfig(v: any) {
  const enabled = Boolean(v?.enabled);
  const spreadsheetId = String(v?.spreadsheetId || v?.sheetId || "").trim();
  const sheetName = String(v?.sheetName || v?.sheet_name || "").trim();
  const intervalSecRaw = Number(v?.intervalSec ?? v?.interval_sec);
  const intervalSec = Number.isFinite(intervalSecRaw) ? Math.max(60, Math.floor(intervalSecRaw)) : null;
  const allowIncomplete = Boolean(v?.allowIncomplete ?? v?.allow_incomplete);
  const serviceAccountJson = String(v?.serviceAccountJson || v?.service_account_json || "").trim();
  return {
    enabled,
    spreadsheetId,
    parsedSpreadsheetId: parseSpreadsheetId(spreadsheetId),
    sheetName,
    intervalSec,
    allowIncomplete,
    serviceAccountJson,
  };
}

export async function GET() {
  const root = repoRoot();
  const cfgPath = path.join(root, "data", "openchat_members_sheets.json");
  const saPath = path.join(root, "data", "gcp_service_account.json");

  const cfg = await readJsonIfExists(cfgPath);
  if (cfg.error) {
    return NextResponse.json(
      { ok: false, error: `openchat_members_sheets.json 읽기 실패: ${cfg.error}`, exists: true, path: cfgPath },
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
  const roomsObj =
    config && typeof (config as any).rooms === "object" && (config as any).rooms ? (config as any).rooms : {};
  const rooms: Record<string, any> = {};
  for (const [rid, v] of Object.entries(roomsObj || {})) {
    const rid2 = String(rid || "").trim();
    if (!rid2 || typeof v !== "object" || !v) continue;
    rooms[rid2] = normalizeRoomConfig(v);
  }

  const worker = normalizeWorker((config as any)?.worker);
  const spreadsheetId = String((config as any)?.spreadsheetId || (config as any)?.spreadsheet_id || "").trim();
  const sheetName = String((config as any)?.sheetName || (config as any)?.sheet_name || "").trim();
  const serviceAccountJson = String((config as any)?.serviceAccountJson || (config as any)?.service_account_json || "").trim();

  return NextResponse.json(
    {
      ok: true,
      exists: cfg.exists,
      path: cfgPath,
      config: config
        ? {
          ...config,
          version: Number((config as any)?.version) || 1,
          spreadsheetId,
          parsedSpreadsheetId: parseSpreadsheetId(spreadsheetId),
          sheetName,
          serviceAccountJson,
          worker,
          rooms,
        }
        : null,
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
  const cfgPath = path.join(root, "data", "openchat_members_sheets.json");

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
      enabled: Boolean(vv?.enabled),
      spreadsheetId: String(vv?.spreadsheetId || "").trim(),
      sheetName: String(vv?.sheetName || "").trim(),
      intervalSec: vv?.intervalSec === undefined || vv?.intervalSec === null ? undefined : Math.max(60, Number(vv.intervalSec) || 0),
      allowIncomplete: Boolean(vv?.allowIncomplete),
      serviceAccountJson: String(vv?.serviceAccountJson || "").trim(),
    };
  }

  const inWorker = (input as any).worker;
  const outWorker = {
    enabled: Boolean(inWorker?.enabled),
    intervalSec: Math.max(60, Number(inWorker?.intervalSec) || 3600),
  };

  const out = {
    version: Number((input as any).version) || 1,
    spreadsheetId: String((input as any).spreadsheetId || "").trim(),
    sheetName: String((input as any).sheetName || "").trim(),
    serviceAccountJson: String((input as any).serviceAccountJson || "").trim(),
    worker: outWorker,
    rooms: outRooms,
  };

  try {
    await writeJsonAtomic(cfgPath, out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: cfgPath }, { status: 200 });
}

