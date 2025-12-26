import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";

function readJsonStrict(p) {
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) throw new Error(`empty json: ${p}`);
  return JSON.parse(raw);
}

function normalizeSheetId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return String(m[1] || "").trim();
  return s;
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
  const args = [...argv];
  const courseKeyParts = [];
  while (args.length > 0 && !String(args[0]).startsWith("--")) {
    courseKeyParts.push(args.shift());
  }
  const courseKey = courseKeyParts.join(" ").trim();

  const flags = {};
  while (args.length > 0) {
    const k = String(args.shift() || "");
    if (!k.startsWith("--")) continue;
    const key = k.slice(2);
    const v = args.length > 0 && !String(args[0]).startsWith("--") ? String(args.shift()) : "";
    flags[key] = v;
  }
  return { courseKey, flags };
}

async function main() {
  const { courseKey, flags } = parseArgs(process.argv.slice(2));
  if (!courseKey) {
    throw new Error(
      "usage: node scripts/set-course-payment-ssot.mjs <COURSE_KEY> --sheet <URL_OR_ID> --tab <TAB> --headerRow <N> --kindCol <NAME>",
    );
  }

  const sheetId = normalizeSheetId(flags.sheet);
  if (!sheetId) throw new Error("--sheet is required (google sheets URL or ID)");

  const sheetName = String(flags.tab || flags.sheetName || "종합").trim() || "종합";
  const headerRow = Math.max(1, Number(flags.headerRow || 19) || 19);
  const gradeCol = String(flags.gradeCol || "카페 등급").trim() || "카페 등급";
  const nicknameCol = String(flags.nicknameCol || "닉네임").trim() || "닉네임";
  const nameCol = String(flags.nameCol || "성함").trim() || "성함";
  const idCol = String(flags.idCol || "아이디").trim() || "아이디";
  const kindCol = String(flags.kindCol || "구분").trim() || "구분";
  const excludeKinds = String(flags.excludeKinds || "환불").trim() || "환불";

  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (or data/courseops_supabase_secrets.json)");
  }

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const rows = await sql`select id, course_key from courseops_courses where course_key=${courseKey} limit 1`;
    const course = rows[0];
    if (!course) throw new Error(`course not found: ${courseKey}`);

    await sql`
      update courseops_courses
      set payment_sheet_id=${sheetId},
          payment_sheet_name=${sheetName},
          payment_header_row=${headerRow},
          payment_grade_col=${gradeCol},
          payment_nickname_col=${nicknameCol},
          payment_name_col=${nameCol},
          payment_id_col=${idCol},
          payment_kind_col=${kindCol},
          payment_exclude_kinds=${excludeKinds}
      where id=${String(course.id)}
    `;

    // eslint-disable-next-line no-console
    console.log(`updated payment SSOT: ${courseKey}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(String(e?.message || e));
  process.exit(1);
});

