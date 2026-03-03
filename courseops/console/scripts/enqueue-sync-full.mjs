import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import postgres from "postgres";

function readJsonStrict(p) {
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) throw new Error(`empty json: ${p}`);
  return JSON.parse(raw);
}

function resolveDatabaseUrl() {
  const fromEnv = String(process.env.DATABASE_URL || "").trim();
  if (fromEnv) return fromEnv;

  // 로컬 편의: `data/courseops_supabase_secrets.json`에서 pooler URL 구성
  try {
    const repoRoot = path.resolve(process.cwd(), "..", "..");
    const supabaseSecretsPath = path.join(repoRoot, "data", "courseops_supabase_secrets.json");
    const supa = readJsonStrict(supabaseSecretsPath);
    const projectRef = String(supa?.supabase?.projectRef || "").trim();
    const region = String(supa?.supabase?.region || "").trim();
    const dbPassword = String(supa?.supabase?.dbPassword || "").trim();
    if (!projectRef || !region || !dbPassword) return "";

    const user = `postgres.${projectRef}`;
    const host = `aws-1-${region}.pooler.supabase.com`;
    return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:6543/postgres?sslmode=require`;
  } catch {
    return "";
  }
}

function parseArgs(argv) {
  const out = { courseKey: "", requestedBy: "system" };
  for (let i = 0; i < argv.length; i += 1) {
    const a = String(argv[i] || "");
    if (a === "--course-key") out.courseKey = String(argv[i + 1] || "").trim();
    if (a === "--requested-by") out.requestedBy = String(argv[i + 1] || "").trim() || "system";
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.courseKey) {
  console.error('Usage: node courseops/console/scripts/enqueue-sync-full.mjs --course-key "<COURSE_KEY>" [--requested-by "<NAME>"]');
  process.exit(2);
}

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const rows = await sql`select id from courseops_courses where course_key=${args.courseKey} limit 1`;
  const courseId = String(rows?.[0]?.id || "").trim();
  if (!courseId) {
    console.error(`course not found: ${args.courseKey}`);
    process.exit(1);
  }

  const jobId = `job_${crypto.randomUUID()}`;
  await sql`
    insert into courseops_jobs (id, course_id, kind, status, requested_by, payload, requested_at)
    values (${jobId}, ${courseId}, 'SYNC_FULL', 'QUEUED', ${args.requestedBy}, ${JSON.stringify({})}, now())
  `;
  console.log(JSON.stringify({ ok: true, jobId, courseId, courseKey: args.courseKey }, null, 2));
} finally {
  await sql.end();
}

