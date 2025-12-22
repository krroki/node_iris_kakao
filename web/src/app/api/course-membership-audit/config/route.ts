export const runtime = "nodejs";

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { parseSpreadsheetId, readJsonIfExists, repoRoot, writeJsonAtomic } from "../_util";

export const dynamic = "force-dynamic";

function normStr(v: any): string {
  return String(v || "").trim();
}

function normStrList(v: any): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const it of v) {
    const s = normStr(it);
    if (s) out.push(s);
  }
  return Array.from(new Set(out)).sort();
}

function normalizeWorker(v: any) {
  const enabled = Boolean(v?.enabled);
  const hotIntervalSec = Math.max(30, Number(v?.hotIntervalSec) || 600);
  const hotDays = Math.max(0, Number(v?.hotDays) || 14);
  const steadyIntervalSec = Math.max(60, Number(v?.steadyIntervalSec) || 10800);
  const crawler = {
    repoPath: normStr(v?.crawler?.repoPath),
    pythonExe: normStr(v?.crawler?.pythonExe),
    settingsPath: normStr(v?.crawler?.settingsPath),
  };
  const openchatAutoLoad = {
    enabled: Boolean(v?.openchatAutoLoad?.enabled),
    serial: normStr(v?.openchatAutoLoad?.serial || v?.openchatAutoLoad?.adbSerial),
    scrolls: Math.max(50, Number(v?.openchatAutoLoad?.scrolls) || 650),
    scrollPauseMs: Math.max(150, Number(v?.openchatAutoLoad?.scrollPauseMs || v?.openchatAutoLoad?.scroll_pause_ms) || 400),
    timeoutSec: Math.max(60, Number(v?.openchatAutoLoad?.timeoutSec || v?.openchatAutoLoad?.timeout_sec) || 900),
    cooldownRoomSec: Math.max(0, Number(v?.openchatAutoLoad?.cooldownRoomSec) || 900),
    cooldownGlobalSec: Math.max(0, Number(v?.openchatAutoLoad?.cooldownGlobalSec) || 120),
    maxAttempts: Math.max(1, Number(v?.openchatAutoLoad?.maxAttempts) || 1),
  };
  return { enabled, hotIntervalSec, hotDays, steadyIntervalSec, crawler, openchatAutoLoad };
}

function normalizeTabs(v: any) {
  const cafeRaw = normStr(v?.cafeRaw) || "CAFE_RAW";
  const openchatRaw = normStr(v?.openchatRaw) || "OPENCHAT_RAW";
  const ssotRaw = normStr(v?.ssotRaw || v?.paymentRaw || v?.ssot || v?.payment) || "SSOT_RAW";
  const rulesRaw = normStr(v?.rulesRaw) || "RULES_RAW";
  const audit = normStr(v?.audit) || "AUDIT_VIEW";
  const overview = normStr(v?.overview) || "OVERVIEW";
  const actions = normStr(v?.actions || v?.action) || "ACTIONS";
  const auditLog = normStr(v?.auditLog || v?.audit_log || v?.log) || "AUDIT_LOG";
  return { cafeRaw, openchatRaw, ssotRaw, rulesRaw, audit, overview, actions, auditLog };
}

function normalizePaymentSsot(v: any) {
  if (!v || typeof v !== "object") return null;
  const spreadsheetId = normStr(v?.spreadsheetId || v?.sheetId || v?.spreadsheet_id);
  if (!spreadsheetId) return null;
  const out: any = { spreadsheetId };

  const sheetName = normStr(v?.sheetName || v?.tab || v?.sheet);
  const headerRow = Number(v?.headerRow || v?.header_row);
  const gradeCol = normStr(v?.gradeCol || v?.gradeColumn);
  const nicknameCol = normStr(v?.nicknameCol || v?.nicknameColumn);
  const idCol = normStr(v?.idCol || v?.idColumn || v?.userIdCol);
  const kindCol = normStr(v?.kindCol || v?.kindColumn);
  const excludeKinds = normStrList(v?.excludeKinds);

  if (sheetName) out.sheetName = sheetName;
  if (Number.isFinite(headerRow) && headerRow >= 1) out.headerRow = Math.max(1, Math.floor(headerRow));
  if (gradeCol) out.gradeCol = gradeCol;
  if (nicknameCol) out.nicknameCol = nicknameCol;
  if (idCol) out.idCol = idCol;
  if (kindCol) out.kindCol = kindCol;
  if (excludeKinds.length) out.excludeKinds = excludeKinds;

  return out;
}

function normalizeCourseConfig(v: any) {
  const enabled = v?.enabled === false ? false : true;
  const clubId = normStr(v?.clubId || v?.club_id || v?.cafe?.clubId || v?.cafe?.club_id);
  const spreadsheetId = normStr(v?.spreadsheetId || v?.spreadsheet_id || v?.sheetId);
  const joinUrl = normStr(v?.joinUrl || v?.join_url || v?.joinUri || v?.join_uri);
  const parsedSpreadsheetId = parseSpreadsheetId(spreadsheetId);
  const tabs = normalizeTabs(v?.tabs || v?.sheets?.tabs || {});
  const gradeRules = {
    premiumGrades: normStrList(v?.gradeRules?.premiumGrades),
    staffGrades: normStrList(v?.gradeRules?.staffGrades),
  };
  const rooms = {
    chat: normStr(v?.rooms?.chat),
    notice: normStr(v?.rooms?.notice),
    premium: normStr(v?.rooms?.premium),
  };
  const paymentSsot = normalizePaymentSsot(v?.paymentSsot);
  return { enabled, clubId, spreadsheetId, joinUrl, parsedSpreadsheetId, tabs, gradeRules, rooms, paymentSsot };
}

export async function GET() {
  const root = repoRoot();
  const cfgPath = path.join(root, "data", "course_membership_audit.json");
  const saPath = path.join(root, "data", "gcp_service_account.json");

  const cfg = await readJsonIfExists(cfgPath);
  if (cfg.error) {
    return NextResponse.json(
      { ok: false, error: `course_membership_audit.json 읽기 실패: ${cfg.error}`, exists: true, path: cfgPath },
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
  const coursesObj =
    config && typeof (config as any).courses === "object" && (config as any).courses ? (config as any).courses : {};

  const courses: Record<string, any> = {};
  for (const [k, v] of Object.entries(coursesObj || {})) {
    const ck = normStr(k);
    if (!ck || typeof v !== "object" || !v) continue;
    courses[ck] = normalizeCourseConfig(v);
  }

  const worker = normalizeWorker((config as any)?.worker);

  return NextResponse.json(
    {
      ok: true,
      exists: cfg.exists,
      path: cfgPath,
      config: config
        ? {
          ...config,
          version: Number((config as any)?.version) || 1,
          worker,
          courses,
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
  const cfgPath = path.join(root, "data", "course_membership_audit.json");

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

  const inWorker = (input as any).worker;
  const outWorker = {
    enabled: Boolean(inWorker?.enabled),
    hotIntervalSec: Math.max(30, Number(inWorker?.hotIntervalSec) || 600),
    hotDays: Math.max(0, Number(inWorker?.hotDays) || 14),
    steadyIntervalSec: Math.max(60, Number(inWorker?.steadyIntervalSec) || 10800),
    crawler: {
      repoPath: normStr(inWorker?.crawler?.repoPath),
      pythonExe: normStr(inWorker?.crawler?.pythonExe),
      settingsPath: normStr(inWorker?.crawler?.settingsPath),
    },
    openchatAutoLoad: {
      enabled: Boolean(inWorker?.openchatAutoLoad?.enabled),
      serial: normStr(inWorker?.openchatAutoLoad?.serial || inWorker?.openchatAutoLoad?.adbSerial),
      scrolls: Math.max(50, Number(inWorker?.openchatAutoLoad?.scrolls) || 650),
      scrollPauseMs: Math.max(150, Number(inWorker?.openchatAutoLoad?.scrollPauseMs || inWorker?.openchatAutoLoad?.scroll_pause_ms) || 400),
      timeoutSec: Math.max(60, Number(inWorker?.openchatAutoLoad?.timeoutSec || inWorker?.openchatAutoLoad?.timeout_sec) || 900),
      cooldownRoomSec: Math.max(0, Number(inWorker?.openchatAutoLoad?.cooldownRoomSec) || 900),
      cooldownGlobalSec: Math.max(0, Number(inWorker?.openchatAutoLoad?.cooldownGlobalSec) || 120),
      maxAttempts: Math.max(1, Number(inWorker?.openchatAutoLoad?.maxAttempts) || 1),
    },
  };

  const inCourses = (input as any).courses;
  if (inCourses !== undefined && (typeof inCourses !== "object" || !inCourses)) {
    return NextResponse.json({ ok: false, error: "courses must be an object" }, { status: 400 });
  }

  const outCourses: Record<string, any> = {};
  for (const [k, v] of Object.entries(inCourses || {})) {
    const ck = normStr(k);
    if (!ck || typeof v !== "object" || !v) continue;
    const vv: any = v;
    outCourses[ck] = {
      enabled: vv?.enabled === false ? false : true,
      clubId: normStr(vv?.clubId),
      spreadsheetId: normStr(vv?.spreadsheetId),
      joinUrl: normStr(vv?.joinUrl),
      tabs: normalizeTabs(vv?.tabs || {}),
      gradeRules: {
        premiumGrades: normStrList(vv?.gradeRules?.premiumGrades),
        staffGrades: normStrList(vv?.gradeRules?.staffGrades),
      },
      rooms: {
        chat: normStr(vv?.rooms?.chat),
        notice: normStr(vv?.rooms?.notice),
        premium: normStr(vv?.rooms?.premium),
      },
    };
    const paymentSsot = normalizePaymentSsot(vv?.paymentSsot);
    if (paymentSsot) outCourses[ck].paymentSsot = paymentSsot;
  }

  const out = {
    version: Number((input as any).version) || 1,
    worker: outWorker,
    courses: outCourses,
  };

  try {
    await writeJsonAtomic(cfgPath, out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: cfgPath }, { status: 200 });
}
