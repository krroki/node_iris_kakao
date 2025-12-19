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
  return { enabled, hotIntervalSec, hotDays, steadyIntervalSec, crawler };
}

function normalizeTabs(v: any) {
  const cafeRaw = normStr(v?.cafeRaw) || "CAFE_RAW";
  const openchatRaw = normStr(v?.openchatRaw) || "OPENCHAT_RAW";
  const rulesRaw = normStr(v?.rulesRaw) || "RULES_RAW";
  const audit = normStr(v?.audit) || "AUDIT_VIEW";
  const auditLog = normStr(v?.auditLog || v?.audit_log || v?.log) || "AUDIT_LOG";
  return { cafeRaw, openchatRaw, rulesRaw, audit, auditLog };
}

function normalizeCourseConfig(v: any) {
  const enabled = v?.enabled === false ? false : true;
  const clubId = normStr(v?.clubId || v?.club_id || v?.cafe?.clubId || v?.cafe?.club_id);
  const spreadsheetId = normStr(v?.spreadsheetId || v?.spreadsheet_id || v?.sheetId);
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
  return { enabled, clubId, spreadsheetId, parsedSpreadsheetId, tabs, gradeRules, rooms };
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
