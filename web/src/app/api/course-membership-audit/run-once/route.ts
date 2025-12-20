export const runtime = "nodejs";

import { NextResponse } from "next/server";
import path from "path";
import { readJsonIfExists, repoRoot, writeJsonAtomic } from "../_util";

export const dynamic = "force-dynamic";

function normStr(v: unknown): string {
  return String(v ?? "").trim();
}

function uniqueList(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of xs || []) {
    const v = normStr(raw);
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export async function POST(req: Request) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const courseKey = normStr(body?.courseKey);
  const courseKeys = uniqueList([
    ...(Array.isArray(body?.courseKeys) ? body.courseKeys : []),
    ...(courseKey ? [courseKey] : []),
  ]);

  if (!courseKeys.length) {
    return NextResponse.json({ ok: false, error: "courseKey(or courseKeys) required" }, { status: 400 });
  }

  const root = repoRoot();
  const statePath = path.join(root, "node-iris-app", "data", "course_membership_audit_worker_state.json");

  const stateRead = await readJsonIfExists(statePath);
  if (stateRead.error) {
    return NextResponse.json({ ok: false, error: `state 읽기 실패: ${stateRead.error}`, path: statePath }, { status: 500 });
  }

  const nowMs = Date.now();
  const nowTs = new Date(nowMs).toISOString();

  const state = (stateRead.json && typeof stateRead.json === "object") ? stateRead.json : {};
  const coursesObj = (state && typeof state === "object" && (state as any).courses && typeof (state as any).courses === "object")
    ? (state as any).courses
    : {};

  for (const ck of courseKeys) {
    const cur = (coursesObj[ck] && typeof coursesObj[ck] === "object") ? coursesObj[ck] : {};
    coursesObj[ck] = {
      ...cur,
      manualTriggerMs: nowMs,
      manualTriggerTs: nowTs,
      nextRunMs: nowMs,
      nextRunTs: nowTs,
    };
  }

  const out = {
    ...(state && typeof state === "object" ? state : {}),
    courses: coursesObj,
    updatedAt: nowTs,
  };

  try {
    await writeJsonAtomic(statePath, out);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e), path: statePath }, { status: 500 });
  }

  return NextResponse.json({ ok: true, path: statePath, courseKeys, nowMs, nowTs }, { status: 200 });
}

