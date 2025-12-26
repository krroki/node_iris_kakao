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

const databaseUrl = resolveDatabaseUrl();
if (!databaseUrl) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const sql = postgres(databaseUrl, { max: 1, prepare: false });
const schemaPath = path.join(process.cwd(), "sql", "schema.sql");
const schema = fs.readFileSync(schemaPath, "utf8");

await sql.unsafe(schema);
await sql.end();
console.log("DB init done");

