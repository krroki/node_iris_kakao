import crypto from "crypto";
import fs from "fs";
import path from "path";
import postgres from "postgres";

function readJsonStrict(p) {
  const raw = fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "");
  if (!raw.trim()) throw new Error(`empty json: ${p}`);
  return JSON.parse(raw);
}

function parseClubId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m1 = s.match(/[?&]clubid=(\d+)/i);
  if (m1) return String(m1[1] || "").trim();
  const m2 = s.match(/\/ca-fe\/cafes\/(\d+)(?:\/|$)/i);
  if (m2) return String(m2[1] || "").trim();
  const m3 = s.match(/\/cafes\/(\d+)(?:\/|$)/i);
  if (m3) return String(m3[1] || "").trim();
  const m4 = s.match(/^\d+$/);
  if (m4) return s;
  return "";
}

function normalizeSheetId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (m) return String(m[1] || "").trim();
  return s;
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}

async function main() {
  const courseKey = String(process.argv.slice(2).join(" ").trim() || "");
  if (!courseKey) {
    throw new Error("usage: node scripts/upsert-course-from-local-audit.mjs <COURSE_KEY>");
  }

  const repoRoot = path.resolve(process.cwd(), "..", "..");
  const secretsPath = path.join(repoRoot, "data", "courseops_console_secrets.json");
  const supabaseSecretsPath = path.join(repoRoot, "data", "courseops_supabase_secrets.json");
  const auditPath = path.join(repoRoot, "data", "course_membership_audit.json");

  const secrets = readJsonStrict(secretsPath);
  let databaseUrl = String(secrets?.courseops?.databaseUrlPooler || "").trim();
  if (!databaseUrl || databaseUrl.startsWith("(")) {
    const supa = readJsonStrict(supabaseSecretsPath);
    const projectRef = String(supa?.supabase?.projectRef || "").trim();
    const region = String(supa?.supabase?.region || "").trim();
    const dbPassword = String(supa?.supabase?.dbPassword || "").trim();
    if (!projectRef || !region || !dbPassword) {
      throw new Error("missing supabase secrets (projectRef/region/dbPassword).");
    }
    const user = `postgres.${projectRef}`;
    const host = `aws-1-${region}.pooler.supabase.com`;
    databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(dbPassword)}@${host}:6543/postgres?sslmode=require`;
  }

  const audit = readJsonStrict(auditPath);
  const course = audit?.courses?.[courseKey];
  if (!course) throw new Error(`course not found in local audit config: ${courseKey}`);

  const clubId = String(course?.clubId || "").trim() || parseClubId(course?.cafeUrl || "");
  const cafeUrl = String(course?.cafeUrl || "").trim() || (clubId ? `https://cafe.naver.com/ManageWholeMember.nhn?clubid=${clubId}` : "");

  const rooms = typeof course?.rooms === "object" && course.rooms ? course.rooms : {};
  const chatRoomId = String(rooms?.chat || "").trim();
  const noticeRoomId = String(rooms?.notice || "").trim();
  const premiumRoomId = String(rooms?.premium || "").trim();
  const vipRoomId = String(rooms?.vip || "").trim();

  if (!chatRoomId) throw new Error(`missing rooms.chat for ${courseKey}`);
  if (!noticeRoomId) throw new Error(`missing rooms.notice for ${courseKey}`);

  const premiumEnabled = Boolean(premiumRoomId);
  const vipEnabled = Boolean(vipRoomId);

  const payment = typeof course?.paymentSsot === "object" && course.paymentSsot ? course.paymentSsot : null;
  const paymentSheetId = payment ? normalizeSheetId(payment.spreadsheetId) : "";
  const paymentSheetName = payment ? String(payment.sheetName || "종합").trim() : "";
  const paymentHeaderRow = payment ? Math.max(1, Number(payment.headerRow || 19) || 19) : 19;
  const paymentGradeCol = payment ? String(payment.gradeCol || "카페 등급").trim() : "카페 등급";
  const paymentNicknameCol = payment ? String(payment.nicknameCol || "닉네임").trim() : "닉네임";
  const paymentNameCol = payment ? String(payment.nameCol || "성함").trim() : "성함";
  const paymentIdCol = payment ? String(payment.idCol || "아이디").trim() : "아이디";
  const paymentKindCol = payment ? String(payment.kindCol || "구분").trim() : "구분";
  const paymentExcludeKinds = payment
    ? Array.isArray(payment.excludeKinds)
      ? payment.excludeKinds.map((x) => String(x || "").trim()).filter(Boolean).join(", ") || "환불"
      : String(payment.excludeKinds || "환불").trim() || "환불"
    : "환불";

  const sql = postgres(databaseUrl, { max: 1, prepare: false });
  try {
    const existing = await sql`select id from courseops_courses where course_key=${courseKey} limit 1`;
    const existed = existing.length > 0;

    const courseId = existed ? String(existing[0]?.id || "") : id("course");

    await sql`
      insert into courseops_courses (
        id, course_key, club_id, sheet_id,
        cafe_url,
        openchat_chat_room_id, openchat_notice_room_id,
        premium_enabled, openchat_premium_room_id,
        vip_enabled, openchat_vip_room_id,
        payment_sheet_id, payment_sheet_name, payment_header_row,
        payment_grade_col, payment_nickname_col, payment_name_col,
        payment_id_col, payment_kind_col, payment_exclude_kinds,
        archived, archived_at, archived_by
      )
      values (
        ${courseId}, ${courseKey}, ${clubId || null}, 'DISABLED',
        ${cafeUrl || null},
        ${chatRoomId || null}, ${noticeRoomId || null},
        ${premiumEnabled}, ${premiumRoomId || null},
        ${vipEnabled}, ${vipRoomId || null},
        ${paymentSheetId || null}, ${paymentSheetId ? paymentSheetName || null : null}, ${paymentHeaderRow},
        ${paymentGradeCol}, ${paymentNicknameCol}, ${paymentNameCol},
        ${paymentIdCol}, ${paymentKindCol}, ${paymentExcludeKinds},
        false, null, null
      )
      on conflict (course_key) do update
      set club_id=excluded.club_id,
          cafe_url=excluded.cafe_url,
          openchat_chat_room_id=excluded.openchat_chat_room_id,
          openchat_notice_room_id=excluded.openchat_notice_room_id,
          premium_enabled=excluded.premium_enabled,
          openchat_premium_room_id=excluded.openchat_premium_room_id,
          vip_enabled=excluded.vip_enabled,
          openchat_vip_room_id=excluded.openchat_vip_room_id,
          payment_sheet_id=coalesce(excluded.payment_sheet_id, courseops_courses.payment_sheet_id),
          payment_sheet_name=coalesce(excluded.payment_sheet_name, courseops_courses.payment_sheet_name),
          payment_header_row=case when excluded.payment_sheet_id is null then courseops_courses.payment_header_row else excluded.payment_header_row end,
          payment_grade_col=case when excluded.payment_sheet_id is null then courseops_courses.payment_grade_col else excluded.payment_grade_col end,
          payment_nickname_col=case when excluded.payment_sheet_id is null then courseops_courses.payment_nickname_col else excluded.payment_nickname_col end,
          payment_name_col=case when excluded.payment_sheet_id is null then courseops_courses.payment_name_col else excluded.payment_name_col end,
          payment_id_col=case when excluded.payment_sheet_id is null then courseops_courses.payment_id_col else excluded.payment_id_col end,
          payment_kind_col=case when excluded.payment_sheet_id is null then courseops_courses.payment_kind_col else excluded.payment_kind_col end,
          payment_exclude_kinds=case when excluded.payment_sheet_id is null then courseops_courses.payment_exclude_kinds else excluded.payment_exclude_kinds end,
          archived=false,
          archived_at=null,
          archived_by=null
    `;

    // eslint-disable-next-line no-console
    console.log(`${existed ? "updated" : "created"}: ${courseKey}`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(String(e?.message || e));
  process.exit(1);
});
