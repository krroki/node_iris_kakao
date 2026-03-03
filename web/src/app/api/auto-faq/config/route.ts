export const runtime = "nodejs";

import { NextResponse } from "next/server";
import path from "path";
import { readJsonIfExists, repoRoot, writeJsonAtomic } from "../_util";

export const dynamic = "force-dynamic";

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function normalizeLines(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => safeString(x)).filter(Boolean);
  const s = safeString(v);
  if (!s) return [];
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isSafeAutoFaqImageRelPath(rel: string): boolean {
  const s = safeString(rel);
  if (!s) return false;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return false;
  if (s.startsWith("\\\\") || s.startsWith("//")) return false;
  if (/^[a-zA-Z]+:\/\//.test(s)) return false;
  if (s.includes("..")) return false;
  // auto-faq 이미지는 UI 업로드(templates assets) 경로만 허용
  return s.startsWith("assets/auto_faq/");
}

function normalizeTrigger(v: any) {
  const id = safeString(v?.id) || cryptoRandomId();
  const enabled = v?.enabled === undefined ? true : Boolean(v?.enabled);
  const label = safeString(v?.label) || "";
  const priority = Number.isFinite(Number(v?.priority)) ? Number(v.priority) : 100;
  const cooldownSecRaw = Number(v?.cooldownSec);
  const cooldownSec = Number.isFinite(cooldownSecRaw)
    ? Math.max(30, Math.min(24 * 60 * 60, Math.floor(cooldownSecRaw)))
    : undefined;
  const matchType = safeString(v?.matchType || v?.match?.type || "exact").toLowerCase();
  const patterns = normalizeLines(v?.patterns ?? v?.match?.patterns);
  const negativePatterns = normalizeLines(v?.negativePatterns ?? v?.match?.negativePatterns);
  const requireQuestionSignal = v?.requireQuestionSignal === undefined ? true : Boolean(v?.requireQuestionSignal);

  const actionType = safeString(v?.actionType || v?.action?.type || "static").toLowerCase();
  const kbMenuIds = normalizeLines(v?.kbMenuIds ?? v?.action?.menuIds).join(","); // stored as string
  const kbLimit = Math.max(1, Math.min(10, Number(v?.kbLimit ?? v?.action?.limit ?? 3) || 3));
  const kbKeywords = normalizeLines(v?.kbKeywords ?? v?.action?.keywords);
  const includeNormText = Boolean(v?.includeNormText ?? v?.action?.includeNormText ?? false);

  const titleLine = safeString(v?.titleLine || v?.replyTemplate?.titleLine || "");
  const bodyLines = normalizeLines(v?.bodyLines || v?.replyTemplate?.bodyLines);
  const footerLinksMode = safeString(v?.footerLinksMode || v?.replyTemplate?.footerLinksMode || "kb_posts").toLowerCase();

  const responseText = safeString(v?.responseText || v?.action?.responseText || "");
  const images = normalizeLines(v?.images).filter(isSafeAutoFaqImageRelPath);

  return {
    id,
    enabled,
    label,
    priority,
    ...(cooldownSec !== undefined ? { cooldownSec } : {}),
    match: {
      type: matchType === "regex" ? "regex" : "exact_norm",
      patterns,
      negativePatterns,
      requireQuestionSignal,
    },
    action: {
      type:
        actionType === "kb_recent_posts_filtered"
          ? "kb_recent_posts_filtered"
          : actionType === "kb_recent_posts"
            ? "kb_recent_posts"
            : "static_text",
      menuIds: kbMenuIds,
      limit: kbLimit,
      keywords: kbKeywords,
      includeNormText,
      responseText,
    },
    replyTemplate: {
      titleLine,
      bodyLines,
      footerLinksMode: footerLinksMode === "none" ? "none" : footerLinksMode === "explicit" ? "explicit" : "kb_posts",
    },
    images,
  };
}

function cryptoRandomId(): string {
  // Next.js node runtime: global crypto is available in modern Node; fallback is timestamp
  try {
    // @ts-ignore
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {}
  return `t_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function normalizeConfig(input: any) {
  const version = Number(input?.version) || 1;

  const globalObj = input?.global && typeof input.global === "object" ? input.global : {};
  const lecturesObj = input?.lectures && typeof input.lectures === "object" ? input.lectures : {};
  const roomsObj = input?.rooms && typeof input.rooms === "object" ? input.rooms : {};

  const outGlobal = {
    enabled: globalObj?.enabled === undefined ? true : Boolean(globalObj?.enabled),
    triggers: Array.isArray(globalObj?.triggers) ? globalObj.triggers.map(normalizeTrigger) : [],
  };

  const outLectures: Record<string, any> = {};
  for (const [lidRaw, v] of Object.entries(lecturesObj || {})) {
    const lectureId = safeString(lidRaw);
    if (!lectureId) continue;
    const vv: any = v;
    outLectures[lectureId] = {
      enabled: vv?.enabled === undefined ? true : Boolean(vv?.enabled),
      title: safeString(vv?.title),
      triggers: Array.isArray(vv?.triggers) ? vv.triggers.map(normalizeTrigger) : [],
    };
  }

  const outRooms: Record<string, any> = {};
  for (const [ridRaw, v] of Object.entries(roomsObj || {})) {
    const roomId = safeString(ridRaw);
    if (!roomId) continue;
    const vv: any = v;
    outRooms[roomId] = {
      enabled: vv?.enabled === undefined ? true : Boolean(vv?.enabled),
      lectureId: safeString(vv?.lectureId),
      triggers: Array.isArray(vv?.triggers) ? vv.triggers.map(normalizeTrigger) : [],
    };
  }

  return { version, global: outGlobal, lectures: outLectures, rooms: outRooms, updatedAt: new Date().toISOString() };
}

function validateRegexConfig(cfg: any): Array<{ scope: string; scopeId?: string; triggerId?: string; label?: string; where: string; pattern: string; error: string }> {
  const out: Array<{ scope: string; scopeId?: string; triggerId?: string; label?: string; where: string; pattern: string; error: string }> = [];
  const pushErr = (meta: any, where: string, pattern: string, e: unknown) => {
    out.push({
      scope: safeString(meta?.scope),
      scopeId: safeString(meta?.scopeId) || undefined,
      triggerId: safeString(meta?.triggerId) || undefined,
      label: safeString(meta?.label) || undefined,
      where,
      pattern: safeString(pattern),
      error: safeString((e as any)?.message || e),
    });
  };

  const validateTrigger = (meta: any, t: any) => {
    const match = t?.match && typeof t.match === "object" ? t.match : {};
    if (safeString(match?.type) !== "regex") return;
    const patterns = Array.isArray(match?.patterns) ? match.patterns : [];
    const negativePatterns = Array.isArray(match?.negativePatterns) ? match.negativePatterns : [];
    for (const p of patterns) {
      const s = safeString(p);
      if (!s) continue;
      try {
        // worker와 동일: i 플래그
        // eslint-disable-next-line no-new
        new RegExp(s, "i");
      } catch (e) {
        pushErr(meta, "match.patterns", s, e);
      }
    }
    for (const p of negativePatterns) {
      const s = safeString(p);
      if (!s) continue;
      try {
        // eslint-disable-next-line no-new
        new RegExp(s, "i");
      } catch (e) {
        pushErr(meta, "match.negativePatterns", s, e);
      }
    }
  };

  const globalTriggers = Array.isArray(cfg?.global?.triggers) ? cfg.global.triggers : [];
  for (const t of globalTriggers) validateTrigger({ scope: "global", triggerId: t?.id, label: t?.label }, t);

  const lecturesObj = cfg?.lectures && typeof cfg.lectures === "object" ? cfg.lectures : {};
  for (const [lid, v] of Object.entries(lecturesObj)) {
    const triggers = Array.isArray((v as any)?.triggers) ? (v as any).triggers : [];
    for (const t of triggers) validateTrigger({ scope: "lecture", scopeId: safeString(lid), triggerId: t?.id, label: t?.label }, t);
  }

  const roomsObj = cfg?.rooms && typeof cfg.rooms === "object" ? cfg.rooms : {};
  for (const [rid, v] of Object.entries(roomsObj)) {
    const triggers = Array.isArray((v as any)?.triggers) ? (v as any).triggers : [];
    for (const t of triggers) validateTrigger({ scope: "room", scopeId: safeString(rid), triggerId: t?.id, label: t?.label }, t);
  }

  return out;
}

export async function GET() {
  const root = repoRoot();
  const cfgPath = path.join(root, "node-iris-app", "data", "auto_faq_config.json");

  const cfg = await readJsonIfExists(cfgPath);
  if (cfg.error) {
    return NextResponse.json(
      { ok: false, error: `auto_faq_config.json 읽기 실패: ${cfg.error}`, exists: true, path: cfgPath },
      { status: 200 },
    );
  }

  return NextResponse.json(
    {
      ok: true,
      exists: cfg.exists,
      path: cfgPath,
      config: cfg.json && typeof cfg.json === "object" ? cfg.json : null,
    },
    { status: 200 },
  );
}

export async function POST(req: Request) {
  const root = repoRoot();
  const cfgPath = path.join(root, "node-iris-app", "data", "auto_faq_config.json");

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

  const out = normalizeConfig(input);
  const regexErrors = validateRegexConfig(out);
  if (regexErrors.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "invalid regex pattern(s)",
        details: regexErrors.slice(0, 50),
        total: regexErrors.length,
      },
      { status: 400 },
    );
  }

  try {
    await writeJsonAtomic(cfgPath, out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: cfgPath }, { status: 200 });
}
