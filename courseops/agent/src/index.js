import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const consoleBase = String(process.env.COURSEOPS_CONSOLE_BASE_URL || "").replace(/\/$/, "");
const agentToken = String(process.env.COURSEOPS_AGENT_TOKEN || "");
const agentName = String(process.env.COURSEOPS_AGENT_NAME || "courseops-agent");
const pollSec = Math.max(1, Number(process.env.COURSEOPS_POLL_SEC || "2"));
const repoRoot = String(process.env.COURSEOPS_REPO_ROOT || "C:\\dev\\12.kakao");

if (!consoleBase) throw new Error("COURSEOPS_CONSOLE_BASE_URL is required");
if (!agentToken) throw new Error("COURSEOPS_AGENT_TOKEN is required");

const statePath = path.join(repoRoot, "node-iris-app", "data", "course_membership_audit_worker_state.json");
const agentStatusPath = path.join(repoRoot, "node-iris-app", "data", "courseops_agent_status.json");
const uploaderStatePath = path.join(repoRoot, "node-iris-app", "data", "courseops_agent_uploader_state.json");
const openchatOverviewStatePath = path.join(repoRoot, "node-iris-app", "data", "courseops_openchat_overview_state.json");
const agentStartedTs = new Date().toISOString();
let lastHeartbeatMs = 0;
let lastMainCafeSyncMs = 0;
let lastMainCafeAttemptMs = 0;
let mainCafeInFlight = false;
let lastOpenchatSyncMs = 0;
let lastOpenchatAttemptMs = 0;
let openchatInFlight = false;
let lastRequestsPollMs = 0;
let lastOpenchatRequestSeenMs = 0;
let lastCoursesSyncAttemptMs = 0;
let lastCoursesSyncOkMs = 0;
let lastSnapshotUploadScanMs = 0;
let coursesByKey = new Map();
let uploaderState = null;
let openchatOverviewState = null;

function envBool(name, fallback = false) {
  const raw = String(process.env[name] ?? "").trim();
  if (!raw) return fallback;
  const v = raw.toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return fallback;
}

function envInt(name, fallback, min, max) {
  const raw = String(process.env[name] ?? "").trim();
  let n = raw ? Number(raw) : fallback;
  if (!Number.isFinite(n)) n = fallback;
  n = Math.floor(n);
  if (typeof min === "number") n = Math.max(min, n);
  if (typeof max === "number") n = Math.min(max, n);
  return n;
}

const COURSES_AUTO_SYNC_ENABLED = envBool("COURSEOPS_COURSES_AUTO_SYNC", true);
const COURSES_SYNC_INTERVAL_MS = envInt("COURSEOPS_COURSES_SYNC_INTERVAL_SEC", 60, 15, 3600) * 1000;
const COURSES_SYNC_RETRY_INTERVAL_MS = envInt("COURSEOPS_COURSES_SYNC_RETRY_SEC", 20, 5, 600) * 1000;

const SNAPSHOT_AUTO_UPLOAD_ENABLED = envBool("COURSEOPS_SNAPSHOT_AUTO_UPLOAD", true);
const SNAPSHOT_UPLOAD_SCAN_INTERVAL_MS = envInt("COURSEOPS_SNAPSHOT_UPLOAD_INTERVAL_SEC", 10, 5, 3600) * 1000;
const SNAPSHOT_UPLOAD_MAX_PER_SCAN = envInt("COURSEOPS_SNAPSHOT_UPLOAD_MAX_PER_SCAN", 1, 1, 5);

const MAIN_CAFE_SNAPSHOT_KEY = "main_cafe";
const MAIN_CAFE_CLUB_ID = parseClubId(
  String(process.env.COURSEOPS_MAIN_CAFE_CLUB_ID || process.env.COURSEOPS_MAIN_CAFE_URL || "30819883"),
);
const MAIN_CAFE_NAME = String(process.env.COURSEOPS_MAIN_CAFE_NAME || "메인 카페").trim() || "메인 카페";
const MAIN_CAFE_ENABLED = envBool("COURSEOPS_MAIN_CAFE_ENABLED", true) && Boolean(MAIN_CAFE_CLUB_ID);
const MAIN_CAFE_SYNC_INTERVAL_MS =
  envInt("COURSEOPS_MAIN_CAFE_SYNC_INTERVAL_SEC", 6 * 3600, 60, 7 * 24 * 3600) * 1000;
const MAIN_CAFE_RETRY_INTERVAL_MS =
  envInt("COURSEOPS_MAIN_CAFE_RETRY_INTERVAL_SEC", 10 * 60, 30, 24 * 3600) * 1000;
const MAIN_CAFE_SNAPSHOT_PATH = path.join(
  repoRoot,
  "node-iris-app",
  "data",
  "courseops_global_snapshots",
  "main_cafe.json",
);

try {
  lastMainCafeSyncMs = fs.statSync(MAIN_CAFE_SNAPSHOT_PATH).mtimeMs || 0;    
} catch {}

const OPENCHAT_OVERVIEW_SNAPSHOT_KEY = "openchat_overview";
const LOCAL_API_BASE = String(process.env.COURSEOPS_LOCAL_API_BASE_URL || "http://127.0.0.1:8650").replace(/\/$/, "");
const OPENCHAT_OVERVIEW_ENABLED = envBool("COURSEOPS_OPENCHAT_OVERVIEW_ENABLED", true);
const OPENCHAT_OVERVIEW_SYNC_INTERVAL_MS =
  envInt("COURSEOPS_OPENCHAT_OVERVIEW_SYNC_INTERVAL_SEC", 30, 10, 300) * 1000;
const OPENCHAT_OVERVIEW_RETRY_INTERVAL_MS =
  envInt("COURSEOPS_OPENCHAT_OVERVIEW_RETRY_INTERVAL_SEC", 10, 5, 120) * 1000;
const OPENCHAT_ADMINS_REFRESH_INTERVAL_MS =
  envInt("COURSEOPS_OPENCHAT_ADMINS_REFRESH_INTERVAL_SEC", 10 * 60, 60, 6 * 3600) * 1000;
const OPENCHAT_ADMINS_AUTOLOAD_ENABLED = envBool("COURSEOPS_OPENCHAT_ADMINS_AUTOLOAD_ENABLED", true);
const OPENCHAT_ADMINS_AUTOLOAD_GLOBAL_COOLDOWN_MS =
  envInt("COURSEOPS_OPENCHAT_ADMINS_AUTOLOAD_GLOBAL_COOLDOWN_SEC", 3 * 60, 60, 30 * 60) * 1000;
const OPENCHAT_ADMINS_AUTOLOAD_ROOM_COOLDOWN_MS =
  envInt("COURSEOPS_OPENCHAT_ADMINS_AUTOLOAD_ROOM_COOLDOWN_SEC", 15 * 60, 60, 6 * 3600) * 1000;
const OPENCHAT_ADMINS_FORCE_REFRESH_MS =
  envInt("COURSEOPS_OPENCHAT_ADMINS_FORCE_REFRESH_SEC", 5 * 60, 30, 30 * 60) * 1000;
const OPENCHAT_REQUESTS_POLL_INTERVAL_MS =
  envInt("COURSEOPS_REQUESTS_POLL_INTERVAL_SEC", 3, 1, 60) * 1000;
const LOGS_BASE_DIR = path.join(repoRoot, "node-iris-app", "data", "logs");

const OPENCHAT_ADMIN_NICK_BACKFILL_ENABLED = envBool("COURSEOPS_OPENCHAT_ADMIN_NICK_BACKFILL_ENABLED", true);
const OPENCHAT_ADMIN_NICK_BACKFILL_GLOBAL_COOLDOWN_MS =
  envInt("COURSEOPS_OPENCHAT_ADMIN_NICK_BACKFILL_GLOBAL_COOLDOWN_SEC", 60, 10, 30 * 60) * 1000;
const OPENCHAT_ADMIN_NICK_BACKFILL_ROOM_COOLDOWN_MS =
  envInt("COURSEOPS_OPENCHAT_ADMIN_NICK_BACKFILL_ROOM_COOLDOWN_SEC", 10 * 60, 60, 6 * 3600) * 1000;
const OPENCHAT_ADMIN_NICK_BACKFILL_MAX_FILES = envInt("COURSEOPS_OPENCHAT_ADMIN_NICK_BACKFILL_MAX_FILES", 60, 1, 365);
const OPENCHAT_ADMIN_NICK_BACKFILL_TAIL_BYTES_PER_FILE =
  envInt("COURSEOPS_OPENCHAT_ADMIN_NICK_BACKFILL_TAIL_BYTES_PER_FILE", 256_000, 16_000, 2_000_000);
const OPENCHAT_ADMIN_NICK_BACKFILL_MAX_TOTAL_BYTES =
  envInt("COURSEOPS_OPENCHAT_ADMIN_NICK_BACKFILL_MAX_TOTAL_BYTES", 2_000_000, 200_000, 20_000_000);

const DEFAULT_IRIS_DECRYPT_USER_ID = envInt("IRIS_DECRYPT_USER_ID", 435780965, 1, 2_147_483_647);
const IRIS_BOT_ID_CACHE_TTL_MS = envInt("COURSEOPS_IRIS_BOT_ID_CACHE_TTL_SEC", 600, 30, 24 * 3600) * 1000;
const IRIS_DECRYPT_CACHE_MAX = envInt("COURSEOPS_IRIS_DECRYPT_CACHE_MAX", 2000, 100, 20_000);
const IRIS_MEMBER_NICK_CACHE_MAX = envInt("COURSEOPS_IRIS_MEMBER_NICK_CACHE_MAX", 5000, 100, 100_000);
let irisBotId = null;
let irisBotIdFetchedMs = 0;
const irisDecryptCache = new Map();
const irisMemberNickCache = new Map();

function writeAgentStatus(extra = {}) {
  const now = new Date().toISOString();
  let prev = {};
  try {
    if (fs.existsSync(agentStatusPath)) {
      const raw = fs.readFileSync(agentStatusPath, "utf8").replace(/^\uFEFF/, "").trim();
      const parsed = raw ? JSON.parse(raw) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) prev = parsed;
    }
  } catch {}

  const j = {
    ...prev,
    pid: process.pid,
    agentName,
    consoleBase,
    startedTs: agentStartedTs,
    heartbeatTs: now,
    ...extra,
  };
  try {
    writeJsonAtomic(agentStatusPath, j);
  } catch {}
}

function heartbeat(extra = {}) {
  const nowMs = Date.now();
  if (nowMs - lastHeartbeatMs < 1500) return;
  lastHeartbeatMs = nowMs;
  writeAgentStatus(extra);
}

function resolveAuditConfigPath() {
  const raw = String(process.env.COURSE_MEMBERSHIP_AUDIT_CONFIG || "").trim();
  if (!raw) return path.join(repoRoot, "data", "course_membership_audit.json");
  return path.isAbsolute(raw) ? raw : path.join(repoRoot, raw);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function readText(p) {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

function readJson(p) {
  try {
    const s = fs.readFileSync(p, "utf8");
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function writeJsonAtomic(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, p);
}

function readJsonStrict(p) {
  const s = readText(p).trim();
  if (!s) return {};
  let j = null;
  try {
    j = JSON.parse(s);
  } catch {
    throw new Error("설정 파일(JSON) 파싱에 실패했어요.");
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) {
    throw new Error("설정 파일(JSON) 형식이 올바르지 않아요.");
  }
  return j;
}

function parseClubId(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  try {
    const u = new URL(s);
    const qp = String(u.searchParams.get("clubid") || u.searchParams.get("clubId") || "").trim();
    if (/^\d+$/.test(qp)) return qp;
    const m2 = u.pathname.match(/\/ca-fe\/cafes\/(\d+)(?:\/|$)/i);
    if (m2) return String(m2[1] || "").trim();
    const m3 = u.pathname.match(/\/cafes\/(\d+)(?:\/|$)/i);
    if (m3) return String(m3[1] || "").trim();
  } catch {}
  const m1 = s.match(/[?&]clubid=(\d+)/i);
  if (m1) return String(m1[1] || "").trim();
  const m4 = s.match(/\/ca-fe\/cafes\/(\d+)(?:\/|$)/i);
  if (m4) return String(m4[1] || "").trim();
  const m5 = s.match(/\/cafes\/(\d+)(?:\/|$)/i);
  if (m5) return String(m5[1] || "").trim();
  if (/^\d+$/.test(s)) return s;
  return "";
}

function parseYmdDate(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function buildCafeSummary(payload) {
  const members = Array.isArray(payload?.members) ? payload.members : [];
  const totalCount = Math.max(0, Number(payload?.totalCount || payload?.total_count || members.length || 0) || 0);

  const fetchedAt = String(payload?.fetchedAt || "").trim() || "";
  const ref = fetchedAt ? new Date(fetchedAt) : new Date();
  const refMs = Number.isNaN(ref.getTime()) ? Date.now() : ref.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const withinDays = (dt, days) => (dt ? refMs - dt.getTime() <= days * dayMs : false);

  const gradeCounts = {};
  let joined7d = 0;
  let visited7d = 0;
  let visited30d = 0;

  for (const m of members) {
    const grade = String(m?.grade || "").trim() || "기타";
    gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;

    const joinDate = parseYmdDate(String(m?.joinDate || m?.join_date || ""));
    const lastVisit = parseYmdDate(String(m?.lastVisit || m?.last_visit || ""));
    if (withinDays(joinDate, 7)) joined7d += 1;
    if (withinDays(lastVisit, 7)) visited7d += 1;
    if (withinDays(lastVisit, 30)) visited30d += 1;
  }

  const gradesTop = Object.entries(gradeCounts)
    .map(([grade, count]) => ({ grade, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const activeRate7d = totalCount > 0 ? Math.round((visited7d / totalCount) * 100) : 0;

  return {
    total: totalCount,
    gradesTop,
    joined7d,
    visited7d,
    visited30d,
    activeRate7d,
  };
}

function upsertLocalCourseConfig(course) {
  const p = resolveAuditConfigPath();
  const courseKey = String(course?.courseKey || course?.course_key || "").trim();
  if (!courseKey) return { ok: false, error: "강의 정보를 찾지 못했어요." };

  let cfg;
  try {
    cfg = readJsonStrict(p);
  } catch (e) {
    return { ok: false, error: String(e?.message || "로컬 설정 파일을 읽지 못했어요.") };
  }
  if (!cfg || typeof cfg !== "object") cfg = {};
  const courses = typeof cfg.courses === "object" && cfg.courses ? cfg.courses : {};

  const prev = typeof courses[courseKey] === "object" && courses[courseKey] ? courses[courseKey] : {};
  const next = { ...prev };

  const archived = Boolean(course?.archived ?? course?.archived_at ?? false);
  next.enabled = !archived;

  const clubId =
    String(prev.clubId || prev.club_id || "").trim() ||
    String(prev?.cafe?.clubId || prev?.cafe?.club_id || "").trim() ||
    parseClubId(course?.clubId || course?.club_id || course?.cafeUrl || course?.cafe_url || "");
  if (clubId) next.clubId = clubId;

  const rooms = typeof next.rooms === "object" && next.rooms ? { ...next.rooms } : {};
  const chatRoomId = String(course?.openchatChatRoomId || course?.openchat_chat_room_id || "").trim();
  const noticeRoomId = String(course?.openchatNoticeRoomId || course?.openchat_notice_room_id || "").trim();
  const premiumEnabled = course?.premiumEnabled ?? course?.premium_enabled ?? true;
  const premiumRoomId = String(course?.openchatPremiumRoomId || course?.openchat_premium_room_id || "").trim();
  const vipEnabled = Boolean(course?.vipEnabled ?? course?.vip_enabled ?? false);
  const vipRoomId = String(course?.openchatVipRoomId || course?.openchat_vip_room_id || "").trim();

  if (chatRoomId) rooms.chat = chatRoomId;
  if (noticeRoomId) rooms.notice = noticeRoomId;
  rooms.premium = premiumEnabled ? premiumRoomId : "";
  // NOTE: 현 워커(v2 audit)는 vip 룸을 사용하지 않지만, 설정을 미리 보관한다.
  if (vipEnabled) rooms.vip = vipRoomId;
  if (Object.keys(rooms).length > 0) next.rooms = rooms;

  const cafeUrl = String(course?.cafeUrl || course?.cafe_url || "").trim();
  if (cafeUrl) next.cafeUrl = cafeUrl;

  const paymentSheetId = String(course?.paymentSheetId || course?.payment_sheet_id || "").trim();
  const paymentSheetName = String(course?.paymentSheetName || course?.payment_sheet_name || "").trim();
  const paymentHeaderRowRaw = course?.paymentHeaderRow ?? course?.payment_header_row ?? null;
  const paymentHeaderRow = Math.max(1, Number(paymentHeaderRowRaw || 19) || 19);
  const paymentGradeCol = String(course?.paymentGradeCol || course?.payment_grade_col || "").trim() || "카페 등급";
  const paymentNicknameCol = String(course?.paymentNicknameCol || course?.payment_nickname_col || "").trim() || "닉네임";
  const paymentNameCol = String(course?.paymentNameCol || course?.payment_name_col || "").trim() || "성함";
  const paymentIdCol = String(course?.paymentIdCol || course?.payment_id_col || "").trim() || "아이디";
  const paymentKindCol = String(course?.paymentKindCol || course?.payment_kind_col || "").trim() || "구분";
  const paymentExcludeKindsRaw = String(course?.paymentExcludeKinds || course?.payment_exclude_kinds || "").trim() || "환불";
  const paymentExcludeKinds = paymentExcludeKindsRaw
    .split(/[,\n\r]+/g)
    .map((x) => String(x || "").trim())
    .filter(Boolean)
    .slice(0, 20);

  if (paymentSheetId) {
    next.paymentSsot = {
      spreadsheetId: paymentSheetId,
      sheetName: paymentSheetName || "종합",
      headerRow: paymentHeaderRow,
      gradeCol: paymentGradeCol,
      nicknameCol: paymentNicknameCol,
      nameCol: paymentNameCol,
      idCol: paymentIdCol,
      kindCol: paymentKindCol,
      excludeKinds: paymentExcludeKinds.length > 0 ? paymentExcludeKinds : ["환불"],
    };
  }

  courses[courseKey] = next;
  cfg.courses = courses;
  if (!cfg.version) cfg.version = 1;
  writeJsonAtomic(p, cfg);

  const okClubId = Boolean(String(next.clubId || "").trim());
  return { ok: true, path: p, courseKey, clubId: okClubId ? String(next.clubId || "") : "" };
}

async function postJson(url, body, timeoutMs = 45000) {
  const ms = Math.max(1000, Number(timeoutMs || 0) || 45000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-courseops-agent-token": agentToken },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }
    return { ok: res.ok, status: res.status, json: j };
  } finally {
    clearTimeout(t);
  }
}

async function getJson(url, timeoutMs = 45000) {
  const ms = Math.max(1000, Number(timeoutMs || 0) || 45000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "x-courseops-agent-token": agentToken },
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }
    return { ok: res.ok, status: res.status, json: j };
  } finally {
    clearTimeout(t);
  }
}

function readUploaderState() {
  const j = readJson(uploaderStatePath);
  const courses = j && typeof j.courses === "object" && j.courses && !Array.isArray(j.courses) ? j.courses : {};
  return { courses };
}

function writeUploaderState(next) {
  const safe = next && typeof next === "object" && !Array.isArray(next) ? next : {};
  writeJsonAtomic(uploaderStatePath, { ...safe, updatedAt: new Date().toISOString() });
}

function readOpenchatOverviewState() {
  const j = readJson(openchatOverviewStatePath);
  const rooms = j && typeof j.rooms === "object" && j.rooms && !Array.isArray(j.rooms) ? j.rooms : {};
  const meta = j && typeof j.meta === "object" && j.meta && !Array.isArray(j.meta) ? j.meta : {};
  return { rooms, meta };
}

function writeOpenchatOverviewState(next) {
  const safe = next && typeof next === "object" && !Array.isArray(next) ? next : {};
  writeJsonAtomic(openchatOverviewStatePath, { ...safe, updatedAt: new Date().toISOString() });
}

async function getLocalJson(url, timeoutMs = 15000) {
  const ms = Math.max(1000, Number(timeoutMs || 0) || 15000);
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { method: "GET", signal: ctrl.signal });
    const text = await res.text().catch(() => "");
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }
    return { ok: res.ok, status: res.status, json: j };
  } finally {
    clearTimeout(t);
  }
}

function kstYmd(dt = new Date()) {
  try {
    // en-CA: YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(dt);
  } catch {
    // fallback: local timezone
    return dt.toISOString().slice(0, 10);
  }
}

function kstHourIndex(isoTs) {
  const s = String(isoTs || "").trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  try {
    const hh = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Seoul", hour: "2-digit", hour12: false }).format(d);
    const n = Number(hh);
    return Number.isFinite(n) ? Math.max(0, Math.min(23, Math.floor(n))) : null;
  } catch {
    return d.getHours();
  }
}

function clampInt(n, min, max) {
  const x = Math.floor(Number(n) || 0);
  return Math.max(min, Math.min(max, x));
}

function normalizeMessageType(raw) {
  let mt = Number(raw);
  if (!Number.isFinite(mt)) return null;
  mt = Math.floor(mt);
  // 일부 환경에서 플래그가 섞여 들어오는 케이스(예: 16384)가 있어 제거한다.
  if (mt >= 16384) mt = mt & ~16384;
  return mt;
}

function classifyMessage(mt) {
  if (mt === 1) return "text";
  if (mt === 2 || mt === 27 || mt === 71) return "image";
  return "other";
}

function roomLogFilePath(roomId, ymd) {
  const rid = String(roomId || "").trim();
  const day = String(ymd || "").trim();
  if (!rid || !day) return "";
  return path.join(LOGS_BASE_DIR, rid, `${day}.log`);
}

function roomLogDirPath(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return "";
  return path.join(LOGS_BASE_DIR, rid);
}

async function statSafe(p) {
  try {
    return await fs.promises.stat(p);
  } catch {
    return null;
  }
}

async function scanJsonlFileFromOffset(filePath, startOffset, onLine) {
  const start = Math.max(0, Number(startOffset || 0) || 0);
  const st = await statSafe(filePath);
  if (!st) return { ok: false, size: 0, scannedBytes: 0 };
  const size = Number(st.size || 0) || 0;
  if (start >= size) return { ok: true, size, scannedBytes: 0 };

  return await new Promise((resolve, reject) => {
    let buf = "";
    let scanned = 0;
    const stream = fs.createReadStream(filePath, { start, encoding: "utf8" });
    stream.on("data", (chunk) => {
      scanned += Buffer.byteLength(chunk, "utf8");
      buf += chunk;
      while (true) {
        const idx = buf.indexOf("\n");
        if (idx < 0) break;
        const line = buf.slice(0, idx);
        buf = buf.slice(idx + 1);
        const trimmed = String(line || "").trim();
        if (!trimmed) continue;
        try {
          onLine(trimmed);
        } catch {}
      }
    });
    stream.on("end", () => {
      const trimmed = String(buf || "").trim();
      if (trimmed) {
        try {
          onLine(trimmed);
        } catch {}
      }
      resolve({ ok: true, size, scannedBytes: scanned });
    });
    stream.on("error", (e) => reject(e));
  });
}

function computeMissingNicknames(roomState, wantedUserIdsSet) {
  const missing = new Set();
  if (!wantedUserIdsSet || !(wantedUserIdsSet instanceof Set) || wantedUserIdsSet.size === 0) return missing;
  const m = ensureRoomNickMap(roomState);
  for (const uid of wantedUserIdsSet) {
    const name = uid && m && m[uid] ? String(m[uid]?.name || "").trim() : "";
    if (!name || isSuspiciousNickname(name)) missing.add(uid);
  }
  return missing;
}

async function maybeBackfillAdminNicknamesFromLogHistory(roomId, roomState, wantedUserIdsSet, meta) {
  if (!OPENCHAT_ADMIN_NICK_BACKFILL_ENABLED) return { ok: false, found: 0 };
  if (!roomState || typeof roomState !== "object" || Array.isArray(roomState)) return { ok: false, found: 0 };
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return { ok: false, found: 0 };

  const nowMs = Date.now();
  const lastGlobalMs = Number(meta.openchatAdminNickBackfillLastMs || 0) || 0;
  const lastRoomMs = Number(roomState.openchatAdminNickBackfillLastMs || 0) || 0;
  if (nowMs - lastGlobalMs < OPENCHAT_ADMIN_NICK_BACKFILL_GLOBAL_COOLDOWN_MS) return { ok: false, found: 0 };
  if (nowMs - lastRoomMs < OPENCHAT_ADMIN_NICK_BACKFILL_ROOM_COOLDOWN_MS) return { ok: false, found: 0 };

  const missing = computeMissingNicknames(roomState, wantedUserIdsSet);
  const missingBefore = missing.size;
  if (missingBefore === 0) return { ok: false, found: 0 };

  meta.openchatAdminNickBackfillLastMs = nowMs;
  roomState.openchatAdminNickBackfillLastMs = nowMs;

  const roomDir = roomLogDirPath(roomId);
  if (!roomDir) return { ok: false, found: 0 };

  let names = [];
  try {
    names = await fs.promises.readdir(roomDir);
  } catch {
    return { ok: false, found: 0 };
  }

  const files = names
    .filter((x) => /^\d{4}-\d{2}-\d{2}\.log$/.test(String(x || "").trim()))
    .sort()
    .reverse()
    .slice(0, OPENCHAT_ADMIN_NICK_BACKFILL_MAX_FILES);

  const m = ensureRoomNickMap(roomState);
  let scannedTotal = 0;
  for (const name of files) {
    if (missing.size === 0) break;
    if (scannedTotal >= OPENCHAT_ADMIN_NICK_BACKFILL_MAX_TOTAL_BYTES) break;
    const filePath = path.join(roomDir, name);
    const st = await statSafe(filePath);
    if (!st) continue;
    const size = Number(st.size || 0) || 0;
    const startOffset = Math.max(0, size - OPENCHAT_ADMIN_NICK_BACKFILL_TAIL_BYTES_PER_FILE);

    await scanJsonlFileFromOffset(filePath, startOffset, (line) => {
      let obj = null;
      try {
        obj = JSON.parse(line);
      } catch {
        obj = null;
      }
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
      const sid = String(obj?.snapshot?.senderId || obj?.snapshot?.sender_id || "").trim();
      if (!sid || !missing.has(sid)) return;
      const sname = String(obj?.snapshot?.senderName || obj?.snapshot?.sender_name || "").trim();
      if (!sname) return;
      rememberRoomNickname(roomState, sid, sname, String(obj?.timestamp || "").trim());
      const stored = sid && m && m[sid] ? String(m[sid]?.name || "").trim() : "";
      if (stored && !isSuspiciousNickname(stored)) missing.delete(sid);
    });

    scannedTotal += Math.max(0, size - startOffset);
  }

  const missingAfter = computeMissingNicknames(roomState, wantedUserIdsSet).size;
  const found = Math.max(0, missingBefore - missingAfter);
  return { ok: found > 0, found };
}

function ensureRoomStateContainer(roomId) {
  if (!openchatOverviewState) openchatOverviewState = readOpenchatOverviewState();
  if (!openchatOverviewState.rooms || typeof openchatOverviewState.rooms !== "object" || Array.isArray(openchatOverviewState.rooms)) {
    openchatOverviewState.rooms = {};
  }
  const rid = String(roomId || "").trim();
  if (!rid) return null;
  const cur = openchatOverviewState.rooms[rid];
  if (cur && typeof cur === "object" && !Array.isArray(cur)) {
    if (!cur.nickByUserId || typeof cur.nickByUserId !== "object" || Array.isArray(cur.nickByUserId)) {
      cur.nickByUserId = {};
    }
    return cur;
  }
  openchatOverviewState.rooms[rid] = { days: {}, utcFiles: {}, admins: null, nickByUserId: {} };
  return openchatOverviewState.rooms[rid];
}

function ensureKstDayState(roomState, ymd) {
  if (!roomState.days || typeof roomState.days !== "object" || Array.isArray(roomState.days)) {
    roomState.days = {};
  }
  const day = String(ymd || "").trim();
  if (!day) return null;
  if (!roomState.days[day] || typeof roomState.days[day] !== "object" || Array.isArray(roomState.days[day])) {
    roomState.days[day] = {
      total: 0,
      text: 0,
      image: 0,
      other: 0,
      hourly: Array.from({ length: 24 }, () => 0),
      lastMessageTs: null,
      updatedAt: null,
    };
  }
  const ds = roomState.days[day];
  if (!Array.isArray(ds.hourly) || ds.hourly.length !== 24) {
    ds.hourly = Array.from({ length: 24 }, () => 0);
  }
  return ds;
}

function ensureUtcFileState(roomState, utcYmd) {
  if (!roomState.utcFiles || typeof roomState.utcFiles !== "object" || Array.isArray(roomState.utcFiles)) {
    roomState.utcFiles = {};
  }
  const day = String(utcYmd || "").trim();
  if (!day) return null;
  if (!roomState.utcFiles[day] || typeof roomState.utcFiles[day] !== "object" || Array.isArray(roomState.utcFiles[day])) {
    roomState.utcFiles[day] = {
      offsetBytes: 0,
      sizeBytes: 0,
      lastMessageTs: null,
      updatedAt: null,
    };
  }
  return roomState.utcFiles[day];
}

function resetKstDayState(ds) {
  if (!ds || typeof ds !== "object" || Array.isArray(ds)) return;
  ds.total = 0;
  ds.text = 0;
  ds.image = 0;
  ds.other = 0;
  ds.hourly = Array.from({ length: 24 }, () => 0);
  ds.lastMessageTs = null;
  ds.updatedAt = null;
}

function kstYmdFromIso(isoTs) {
  const s = String(isoTs || "").trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return kstYmd(d);
}

function utcYmdFromDate(dt) {
  if (!dt || Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

function parseKstMidnight(kstDayYmd) {
  const s = String(kstDayYmd || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00+09:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function buildUtcYmdsForKstDays(kstYmds) {
  const set = new Set();
  const dayMs = 24 * 60 * 60 * 1000;
  for (const kstDay of Array.isArray(kstYmds) ? kstYmds : []) {
    const startKst = parseKstMidnight(kstDay);
    if (!startKst) continue;
    const startUtc = utcYmdFromDate(startKst);
    const endUtc = utcYmdFromDate(new Date(startKst.getTime() + dayMs));
    if (startUtc) set.add(startUtc);
    if (endUtc) set.add(endUtc);
  }
  return Array.from(set).sort();
}

function applyMessageToRoomState(roomState, obj, allowedKstDaysSet, wantedUserIdsSet) {
  const payload = obj?.payload && typeof obj.payload === "object" ? obj.payload : null;
  if (!payload) return;
  if (String(payload.type || "") !== "message") return;

  const ts = String(obj?.timestamp || "").trim();
  const kstDay = kstYmdFromIso(ts);
  if (!kstDay) return;
  if (allowedKstDaysSet && allowedKstDaysSet instanceof Set && !allowedKstDaysSet.has(kstDay)) return;

  const dayState = ensureKstDayState(roomState, kstDay);
  if (!dayState) return;

  const mt = normalizeMessageType(payload?.messageType);
  const kind = classifyMessage(mt);

  dayState.total = (Number(dayState.total) || 0) + 1;
  if (kind === "text") dayState.text = (Number(dayState.text) || 0) + 1;
  else if (kind === "image") dayState.image = (Number(dayState.image) || 0) + 1;
  else dayState.other = (Number(dayState.other) || 0) + 1;

  const hi = kstHourIndex(ts);
  if (typeof hi === "number" && hi >= 0 && hi <= 23) {
    const hourly = Array.isArray(dayState.hourly) ? dayState.hourly : [];
    hourly[hi] = (Number(hourly[hi]) || 0) + 1;
    dayState.hourly = hourly;
  }

  if (ts) dayState.lastMessageTs = ts;
  maybeCaptureSenderNickname(roomState, obj, wantedUserIdsSet);
}

async function updateRoomUtcFileFromLog(roomId, utcYmd, opts = {}) {
  const rid = String(roomId || "").trim();
  const day = String(utcYmd || "").trim();
  if (!rid || !day) return null;

  const roomState = ensureRoomStateContainer(rid);
  if (!roomState) return null;
  const fsState = ensureUtcFileState(roomState, day);
  if (!fsState) return null;

  const filePath = roomLogFilePath(rid, day);
  if (!filePath) return fsState;

  const st = await statSafe(filePath);
  if (!st) return fsState;
  const size = Number(st.size || 0) || 0;

  const forceFull = Boolean(opts.forceFull);
  const onlyIfStale = Boolean(opts.onlyIfStale);
  const prevSize = Number(fsState.sizeBytes || 0) || 0;
  const prevOffset = Number(fsState.offsetBytes || 0) || 0;
  const allowedKstDaysSet = opts.allowedKstDaysSet && opts.allowedKstDaysSet instanceof Set ? opts.allowedKstDaysSet : null;
  const wantedUserIdsSet = opts.wantedUserIdsSet && opts.wantedUserIdsSet instanceof Set ? opts.wantedUserIdsSet : null;

  if (onlyIfStale && prevSize === size && prevOffset === size) return fsState;

  if (forceFull || prevOffset > size) {
    fsState.offsetBytes = 0;
    fsState.sizeBytes = 0;
    fsState.lastMessageTs = null;
  }

  const startOffset = forceFull ? 0 : prevOffset;
  await scanJsonlFileFromOffset(filePath, startOffset, (line) => {
    let obj = null;
    try {
      obj = JSON.parse(line);
    } catch {
      obj = null;
    }
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    applyMessageToRoomState(roomState, obj, allowedKstDaysSet, wantedUserIdsSet);
    const ts = String(obj?.timestamp || "").trim();
    if (ts) fsState.lastMessageTs = ts;
  });

  fsState.sizeBytes = size;
  fsState.offsetBytes = size;
  fsState.updatedAt = new Date().toISOString();
  return fsState;
}

function normalizeBase64Ciphertext(raw) {
  const s = String(raw || "").trim();
  if (!s) return null;

  // base64url(-_) -> base64(+/)
  let v = s.replace(/-/g, "+").replace(/_/g, "/");

  // padding
  const mod = v.length % 4;
  if (mod === 2) v += "==";
  else if (mod === 3) v += "=";
  else if (mod === 1) return null;

  if (v.length < 8) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  return v;
}

function looksLikeBase64Ciphertext(s) {
  const v = normalizeBase64Ciphertext(s);
  if (!v) return false;
  try {
    const buf = Buffer.from(v, "base64");
    if (!buf || buf.length < 16) return false;
    if (buf.length % 16 !== 0) return false;
    return true;
  } catch {
    return false;
  }
}

function isSuspiciousNickname(nickname) {
  const s = String(nickname || "").trim();
  if (!s) return true;
  if (s.length > 80) return true;
  if (s.includes("\uFFFD")) return true; // replacement char
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(s)) return true; // control chars
  if (/[가-힣]/.test(s)) return false;
  if (/^\d{6,}$/.test(s)) return true;
  if (s.length >= 12 && looksLikeBase64Ciphertext(s)) return true;
  if (s.length >= 24 && /^[0-9a-fA-F]+$/.test(s)) return true;
  if (s.length >= 30 && /^[A-Za-z0-9_-]+$/.test(s)) return true;
  return false;
}

async function getIrisBotId() {
  const now = Date.now();
  if (irisBotId && now - irisBotIdFetchedMs < IRIS_BOT_ID_CACHE_TTL_MS) return irisBotId;
  irisBotIdFetchedMs = now;

  const base = readIrisBase();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(`${base}/config`, { method: "GET", signal: ctrl.signal });
    const text = await res.text().catch(() => "");
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }

    const botIdRaw = Number(j?.bot_id ?? j?.botId ?? 0);
    if (Number.isFinite(botIdRaw) && botIdRaw > 0) irisBotId = Math.floor(botIdRaw);
  } catch {} finally {
    clearTimeout(t);
  }

  return irisBotId || DEFAULT_IRIS_DECRYPT_USER_ID;
}

async function irisDecryptNickname(decryptUserId, enc, b64Ciphertext) {
  const raw = normalizeBase64Ciphertext(b64Ciphertext);
  const uid = String(decryptUserId || "").trim();
  const encNum = Math.floor(Number(enc || 0) || 0);
  if (!raw || !encNum) return null;

  const cacheUid = uid || "__bot__";
  const key = `${cacheUid}:${encNum}:${raw}`;
  if (irisDecryptCache.has(key)) return irisDecryptCache.get(key) || null;

  const base = readIrisBase();
  const userId = uid || (await getIrisBotId());
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${base}/decrypt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId, enc: encNum, b64_ciphertext: raw }),
      signal: ctrl.signal,
    });
    const text = await res.text().catch(() => "");
    let j = {};
    try {
      j = text ? JSON.parse(text) : {};
    } catch {
      j = {};
    }
    const plain = String(j?.plain_text || "").trim();
    if (plain) {
      irisDecryptCache.set(key, plain);
      while (irisDecryptCache.size > IRIS_DECRYPT_CACHE_MAX) {
        const first = irisDecryptCache.keys().next().value;
        irisDecryptCache.delete(first);
      }
      return plain;
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function irisQuerySafe(query, bind, timeoutMs = 12000) {
  try {
    const rows = await irisQuery(query, bind, timeoutMs);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

async function fetchOpenchatNicknameFromIris(roomId, userId) {
  const rid = String(roomId || "").trim();
  const uid = String(userId || "").trim();
  if (!rid || !uid) return null;

  const cacheKey = `${rid}:${uid}`;
  if (irisMemberNickCache.has(cacheKey)) {
    const cached = String(irisMemberNickCache.get(cacheKey) || "").trim();
    return cached || null;
  }

  const cacheSet = (v) => {
    irisMemberNickCache.set(cacheKey, String(v || "").trim());
    while (irisMemberNickCache.size > IRIS_MEMBER_NICK_CACHE_MAX) {
      const first = irisMemberNickCache.keys().next().value;
      irisMemberNickCache.delete(first);
    }
  };

  const pickName = async (row) => {
    if (!row || typeof row !== "object") return null;
    const enc = Math.floor(Number(row?.enc ?? 31) || 31);
    let nickname = decodeNickname(row?.nickname);

    const s0 = String(nickname || "").trim();
    if (s0 && isSuspiciousNickname(s0)) {
      const candidates = [
        String(row?.profile_link_id || "").trim(),
        String(row?.user_id || "").trim(),
        uid,
      ].filter(Boolean);
      const seen = new Set();
      for (const decryptUserId of candidates) {
        if (seen.has(decryptUserId)) continue;
        seen.add(decryptUserId);
        const plain = await irisDecryptNickname(decryptUserId, enc, s0);
        if (plain) {
          nickname = plain;
          break;
        }
      }
    }
    const s = String(nickname || "").trim();
    if (!s || isSuspiciousNickname(s)) return null;
    return s;
  };

  // 1) involved_chat_id
  let rows = await irisQuerySafe(
    "select nickname, enc, user_id, profile_link_id from db2.open_chat_member where involved_chat_id=? and user_id=? order by rowid desc limit 1",
    [rid, uid],
    15000,
  );
  let name = rows && rows[0] ? await pickName(rows[0]) : null;
  if (name) {
    cacheSet(name);
    return name;
  }

  // 2) link_id from chat_rooms or open_chat_member
  let linkId = "";
  rows = await irisQuerySafe("select link_id from chat_rooms where id=? limit 1", [rid], 12000);
  linkId = rows && rows[0] ? String(rows[0]?.link_id || "").trim() : "";
  if (!linkId) {
    rows = await irisQuerySafe(
      "select link_id from db2.open_chat_member where involved_chat_id=? and link_id is not null limit 1",
      [rid],
      12000,
    );
    linkId = rows && rows[0] ? String(rows[0]?.link_id || "").trim() : "";
  }

  if (linkId) {
    rows = await irisQuerySafe(
      "select nickname, enc, user_id, profile_link_id from db2.open_chat_member where link_id=? and user_id=? order by rowid desc limit 1",
      [linkId, uid],
      15000,
    );
    name = rows && rows[0] ? await pickName(rows[0]) : null;
    if (name) {
      cacheSet(name);
      return name;
    }
  }

  cacheSet("");
  return null;
}

function ensureRoomNickMap(roomState) {
  if (!roomState || typeof roomState !== "object" || Array.isArray(roomState)) return null;
  if (!roomState.nickByUserId || typeof roomState.nickByUserId !== "object" || Array.isArray(roomState.nickByUserId)) {
    roomState.nickByUserId = {};
  }
  return roomState.nickByUserId;
}

function pruneRoomNickMap(roomState, keepUserIdsSet) {
  if (!keepUserIdsSet || !(keepUserIdsSet instanceof Set)) return;
  const m = ensureRoomNickMap(roomState);
  if (!m) return;
  for (const k of Object.keys(m)) {
    if (!keepUserIdsSet.has(k)) delete m[k];
  }
}

function rememberRoomNickname(roomState, userId, nickname, ts) {
  const uid = String(userId || "").trim();
  const name = String(nickname || "").trim();
  if (!uid || !name) return;
  if (isSuspiciousNickname(name)) return;

  const m = ensureRoomNickMap(roomState);
  if (!m) return;
  const prev = m[uid] && typeof m[uid] === "object" ? m[uid] : null;
  const prevTs = prev ? String(prev.ts || "").trim() : "";
  const nextTs = String(ts || "").trim();
  if (prev && prevTs && nextTs && nextTs <= prevTs) return;
  m[uid] = { name, ts: nextTs || null };
}

function maybeCaptureSenderNickname(roomState, obj, wantedUserIdsSet) {
  if (!wantedUserIdsSet || !(wantedUserIdsSet instanceof Set) || wantedUserIdsSet.size === 0) return;
  const sid = String(obj?.snapshot?.senderId || obj?.snapshot?.sender_id || "").trim();
  if (!sid || !wantedUserIdsSet.has(sid)) return;
  const sname = String(obj?.snapshot?.senderName || obj?.snapshot?.sender_name || "").trim();
  if (!sname) return;
  rememberRoomNickname(roomState, sid, sname, String(obj?.timestamp || "").trim());
}

async function normalizeOpenchatAdminEntries(roomId, list) {
  const rid = String(roomId || "").trim();
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const it of list) {
    const userId = String(it?.userId || it?.user_id || "").trim() || null;
    let nickname = decodeNickname(it?.nickname);

    const nickNow = String(nickname || "").trim();
    const shouldLookup = Boolean(userId) && (!nickNow || isSuspiciousNickname(nickNow));
    if (shouldLookup) {
      const resolved = await fetchOpenchatNicknameFromIris(rid, userId);
      if (resolved && !isSuspiciousNickname(resolved)) nickname = resolved;
    }

    let nick2 = String(nickname || "").trim();
    if (nick2 && isSuspiciousNickname(nick2)) nick2 = "";
    const nickFinal = nick2 || null;

    if (!userId && !nickFinal) continue;
    out.push({ userId, nickname: nickFinal });
  }
  return out.slice(0, 30);
}

function resolveAdminDisplayName(roomState, entry) {
  const uid = String(entry?.userId || "").trim();
  const m = ensureRoomNickMap(roomState);
  const fromLog = uid && m && m[uid] ? String(m[uid]?.name || "").trim() : "";
  if (fromLog && !isSuspiciousNickname(fromLog)) return fromLog;
  const raw = String(entry?.nickname || "").trim();
  if (raw && !isSuspiciousNickname(raw)) return raw;
  return "";
}

function buildAdminNameList(roomState, entries) {
  if (!Array.isArray(entries)) return [];
  const out = [];
  const seen = new Set();
  for (const e of entries) {
    const name = resolveAdminDisplayName(roomState, e);
    const s = String(name || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  // 숫자 식별자/플레이스홀더는 이름으로 쓰지 않는다(닉네임은 수집/복호화로 해결한다).
  return out.filter((x) => x !== "어떤 분" && !/^\d{6,}$/.test(x)).slice(0, 30);
}

function buildAdminsHint(raw) {
  const loaded = Number(raw?.loadedMembersCount ?? raw?.loaded_members_count ?? 0) || 0;
  const active = Number(raw?.activeMembersCount ?? raw?.active_members_count ?? 0) || 0;
  if (!loaded) return "멤버 목록을 아직 불러오지 못했어요. 운영진/닉네임을 확인하려면 ‘운영진 불러오기’를 눌러주세요.";
  if (active > 0 && loaded < active) return "멤버 목록이 일부만 불러와졌어요. 운영진/닉네임이 비어 보이면 ‘운영진 불러오기’로 보강해요.";
  return null;
}

async function fetchLocalOpenchatRooms() {
  // NOTE: 오픈채팅 대시보드는 "오픈채팅(link_id 보유)"만 다룬다.
  // - 일반 단톡방은 방장/부방장 개념이 없어서 여기서 섞이면 "비어 보이는 방"이 대량으로 발생한다.
  const r = await getLocalJson(`${LOCAL_API_BASE}/rooms?openchat=1`, 15000);
  if (!r.ok) {
    const msg = String(r?.json?.detail || r?.json?.error || "").trim();
    throw new Error(msg ? `방 목록을 가져오지 못했어요(${msg}).` : `방 목록을 가져오지 못했어요(HTTP ${r.status}).`);
  }
  const list = Array.isArray(r.json) ? r.json : [];
  return list
    .map((x) => ({
      roomId: String(x?.roomId || "").trim(),
      roomName: String(x?.roomName || "").trim(),
      activeMembersCount: x?.activeMembersCount ?? null,
      isOpenChat: Boolean(x?.isOpenChat) || Math.max(0, Number(x?.linkId || 0) || 0) > 0,
    }))
    .filter((x) => Boolean(x.roomId) && x.isOpenChat);
}

async function fetchLocalOpenchatAdmins(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return { host: [], subhosts: [], hint: "멤버 목록을 확인하지 못했어요.", loadedMembersCount: 0, activeMembersCount: null };
  const r = await getLocalJson(`${LOCAL_API_BASE}/rooms/${encodeURIComponent(rid)}/admins`, 15000);
  if (!r.ok) {
    return { host: [], subhosts: [], hint: "운영진 정보를 확인하지 못했어요.", loadedMembersCount: 0, activeMembersCount: null };
  }
  const raw = r.json && typeof r.json === "object" ? r.json : {};
  const host = await normalizeOpenchatAdminEntries(rid, raw?.host);
  const subhosts = await normalizeOpenchatAdminEntries(rid, raw?.subhosts);
  const loadedMembersCount = Number(raw?.loadedMembersCount ?? raw?.loaded_members_count ?? 0) || 0;
  const activeMembersCountRaw = raw?.activeMembersCount ?? raw?.active_members_count;
  const activeMembersCount =
    activeMembersCountRaw === 0 || activeMembersCountRaw
      ? Math.max(0, Number(activeMembersCountRaw) || 0)
      : null;
  return {
    host,
    subhosts,
    hint: buildAdminsHint(raw),
    loadedMembersCount,
    activeMembersCount,
  };
}

function getRecent7DaysYmds() {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const out = [];
  for (let i = 6; i >= 0; i -= 1) {
    out.push(kstYmd(new Date(now - i * dayMs)));
  }
  return out;
}

function pruneRoomDays(roomState, keepDaysSet) {
  if (!roomState || typeof roomState !== "object" || Array.isArray(roomState)) return;
  if (!roomState.days || typeof roomState.days !== "object" || Array.isArray(roomState.days)) return;
  if (!keepDaysSet || !(keepDaysSet instanceof Set)) return;
  for (const k of Object.keys(roomState.days)) {
    if (!keepDaysSet.has(k)) delete roomState.days[k];
  }
}

function pruneRoomUtcFiles(roomState, keepUtcDaysSet) {
  if (!roomState || typeof roomState !== "object" || Array.isArray(roomState)) return;
  if (!roomState.utcFiles || typeof roomState.utcFiles !== "object" || Array.isArray(roomState.utcFiles)) return;
  if (!keepUtcDaysSet || !(keepUtcDaysSet instanceof Set)) return;
  for (const k of Object.keys(roomState.utcFiles)) {
    if (!keepUtcDaysSet.has(k)) delete roomState.utcFiles[k];
  }
}

function pickLastMessageTs(days) {
  const keys = Object.keys(days || {}).sort();
  for (let i = keys.length - 1; i >= 0; i -= 1) {
    const ds = days[keys[i]];
    const ts = String(ds?.lastMessageTs || "").trim();
    if (ts) return ts;
  }
  return null;
}

async function syncOpenchatOverviewOnce(opts = {}) {
  const forceAdmins = Boolean(opts.forceAdmins);
  const forceFullWindow = Boolean(opts.forceFullWindow || opts.forceFullToday);

  const fetchedAt = new Date().toISOString();
  const todayYmd = kstYmd(new Date());
  const ymds7 = getRecent7DaysYmds(); // oldest -> newest (includes today)
  const yesterdayYmd = ymds7.length >= 2 ? ymds7[ymds7.length - 2] : null;
  const utcYmds = buildUtcYmdsForKstDays(ymds7);
  const keepDaysSet = new Set(ymds7);
  const keepUtcDaysSet = new Set(utcYmds);

  const rooms = await fetchLocalOpenchatRooms();
  const payloadRooms = [];

  if (!openchatOverviewState) openchatOverviewState = { rooms: {}, meta: {} };
  if (!openchatOverviewState.meta || typeof openchatOverviewState.meta !== "object" || Array.isArray(openchatOverviewState.meta)) {
    openchatOverviewState.meta = {};
  }
  const meta = openchatOverviewState.meta;
  let autoLoadStarted = false;
  let nickBackfillStarted = false;
  const openchatIdsSet = new Set(rooms.map((x) => String(x?.roomId || "").trim()).filter(Boolean));
  if (openchatOverviewState.rooms && typeof openchatOverviewState.rooms === "object" && !Array.isArray(openchatOverviewState.rooms)) {
    for (const k of Object.keys(openchatOverviewState.rooms)) {
      if (!openchatIdsSet.has(k)) delete openchatOverviewState.rooms[k];
    }
  }

  for (const r of rooms) {
    const rid = String(r.roomId || "").trim();
    if (!rid) continue;
    const roomState = ensureRoomStateContainer(rid);
    if (!roomState) continue;

    // admins (cached)
    // - IRIS DB의 open_chat_member.nickname 이 해시/토큰 형태일 수 있어, userId 기준으로
    //   로그에서 본 senderName 을 우선 사용한다.
    const nowMs = Date.now();
    const forceUntilMs = Number(roomState.adminsForceUntilMs || 0) || 0;
    const prevAdmins = roomState.admins && typeof roomState.admins === "object" ? roomState.admins : null;
    const prevAt = Number(prevAdmins?.fetchedAtMs || 0) || 0;
    const prevHasEntries = Array.isArray(prevAdmins?.host) || Array.isArray(prevAdmins?.subhosts);
    const shouldRefresh =
      forceAdmins ||
      !prevAdmins ||
      !prevHasEntries ||
      nowMs - prevAt > OPENCHAT_ADMINS_REFRESH_INTERVAL_MS ||
      (forceUntilMs > 0 && nowMs < forceUntilMs);
    let admins = prevAdmins;
    if (shouldRefresh) {
      const a = await fetchLocalOpenchatAdmins(rid);
      admins = {
        fetchedAtMs: nowMs,
        host: Array.isArray(a.host) ? a.host : [],
        subhosts: Array.isArray(a.subhosts) ? a.subhosts : [],
        hint: a.hint || null,
        loadedMembersCount: Math.max(0, Number(a.loadedMembersCount || 0) || 0),
        activeMembersCount: a.activeMembersCount == null ? null : Math.max(0, Number(a.activeMembersCount) || 0),
      };
      roomState.admins = admins;
    }

    const hostEntries = Array.isArray(admins?.host) ? admins.host : [];
    const subhostEntries = Array.isArray(admins?.subhosts) ? admins.subhosts : [];
    const wantedUserIdsSet = new Set(
      [...hostEntries, ...subhostEntries].map((x) => String(x?.userId || "").trim()).filter(Boolean),
    );
    pruneRoomNickMap(roomState, wantedUserIdsSet);

    // logs
    for (const kstDay of ymds7) ensureKstDayState(roomState, kstDay);     
    const hasUtcFiles =
      roomState.utcFiles && typeof roomState.utcFiles === "object" && !Array.isArray(roomState.utcFiles);

    const rebuildWindow = async () => {
      // KST 기준 7일치만 안전하게 재집계한다(중복 카운트 방지).
      for (const kstDay of ymds7) resetKstDayState(ensureKstDayState(roomState, kstDay));
      roomState.utcFiles = {};
      for (const utcDay of utcYmds) {
        await updateRoomUtcFileFromLog(rid, utcDay, {
          forceFull: true,
          onlyIfStale: false,
          allowedKstDaysSet: keepDaysSet,
          wantedUserIdsSet,
        });
      }
    };

    if (forceFullWindow || !hasUtcFiles) {
      await rebuildWindow();
    } else {
      pruneRoomDays(roomState, keepDaysSet);
      pruneRoomUtcFiles(roomState, keepUtcDaysSet);

      let needsRebuild = false;
      for (const utcDay of utcYmds) {
        const fsState = ensureUtcFileState(roomState, utcDay);
        const prevOffset = Number(fsState?.offsetBytes || 0) || 0;
        const st = await statSafe(roomLogFilePath(rid, utcDay));
        const size = Number(st?.size || 0) || 0;
        if (st && prevOffset > size) {
          needsRebuild = true;
          break;
        }
      }

      if (needsRebuild) {
        await rebuildWindow();
      } else {
        for (const utcDay of utcYmds) {
          await updateRoomUtcFileFromLog(rid, utcDay, {
            forceFull: false,
            onlyIfStale: true,
            allowedKstDaysSet: keepDaysSet,
            wantedUserIdsSet,
          });
        }
      }
    }

    const days = roomState.days || {};
    const todayState = days[todayYmd] || {};
    const yesterdayState = yesterdayYmd ? days[yesterdayYmd] || {} : {};  
    const totals7 = ymds7.map((d) => Math.max(0, Number(days?.[d]?.total || 0) || 0));
    const sum7 = totals7.reduce((acc, x) => acc + x, 0);
    const avg7 = totals7.length > 0 ? Math.round(sum7 / totals7.length) : 0;
    const sparkTodayHourly = Array.isArray(todayState.hourly) ? todayState.hourly.map((x) => Math.max(0, Number(x) || 0)).slice(0, 24) : [];
    while (sparkTodayHourly.length < 24) sparkTodayHourly.push(0);        

    let hostNames = buildAdminNameList(roomState, hostEntries);
    let subhostNames = buildAdminNameList(roomState, subhostEntries);
    const hostCount = hostEntries.length;
    const subhostCount = subhostEntries.length;
    let needsAdmins =
      hostCount === 0 ||
      (hostCount > 0 && hostNames.length === 0) ||
      (subhostCount > 0 && subhostNames.length === 0);

    // 1) 운영진 닉네임은 로그(senderName)가 SSOT다.
    // - 최근 7일 로그에 없을 수 있어, 필요할 때만 과거 로그 tail을 스캔해 보강한다.
    if (needsAdmins && !nickBackfillStarted && OPENCHAT_ADMIN_NICK_BACKFILL_ENABLED && wantedUserIdsSet.size > 0) {
      const bf = await maybeBackfillAdminNicknamesFromLogHistory(rid, roomState, wantedUserIdsSet, meta);
      if (bf && bf.ok) {
        nickBackfillStarted = true;
        hostNames = buildAdminNameList(roomState, hostEntries);
        subhostNames = buildAdminNameList(roomState, subhostEntries);
        needsAdmins =
          hostCount === 0 ||
          (hostCount > 0 && hostNames.length === 0) ||
          (subhostCount > 0 && subhostNames.length === 0);
      }
    }

    if (needsAdmins) {
      roomState.adminsForceUntilMs = Math.max(Number(roomState.adminsForceUntilMs || 0) || 0, nowMs + OPENCHAT_ADMINS_FORCE_REFRESH_MS);

      if (!autoLoadStarted && OPENCHAT_ADMINS_AUTOLOAD_ENABLED) {
        const lastGlobalMs = Number(meta.openchatAdminsAutoLoadLastMs || 0) || 0;
        const lastRoomMs = Number(roomState.openchatAdminsAutoLoadLastMs || 0) || 0;
        const canGlobal = nowMs - lastGlobalMs >= OPENCHAT_ADMINS_AUTOLOAD_GLOBAL_COOLDOWN_MS;
        const canRoom = nowMs - lastRoomMs >= OPENCHAT_ADMINS_AUTOLOAD_ROOM_COOLDOWN_MS;

        if (canGlobal && canRoom) {
          autoLoadStarted = true;
          meta.openchatAdminsAutoLoadLastMs = nowMs;
          roomState.openchatAdminsAutoLoadLastMs = nowMs;

          const opts = readOpenchatLoadOpts();
          const refresh = await postJson(
            `${LOCAL_API_BASE}/rooms/${encodeURIComponent(rid)}/admins/refresh`,
            { serial: opts.serial || null, scrolls: opts.scrolls, pauseMs: opts.scrollPauseMs },
            20000,
          ).catch(() => null);

          if (refresh && refresh.ok) {
            if (roomState.admins && typeof roomState.admins === "object") {
              roomState.admins.fetchedAtMs = 0;
              roomState.admins.hint = "운영진 정보를 불러오는 중이에요.";
            }
          }
        }
      }
    } else if (Number(roomState.adminsForceUntilMs || 0) > 0) {
      roomState.adminsForceUntilMs = 0;
    }

    const adminsHint = needsAdmins ? (String(admins?.hint || "").trim() || "운영진/닉네임을 확인하고 있어요.") : null;
    const adminsLoadedMembersCount = Math.max(0, Number(admins?.loadedMembersCount || 0) || 0);
    const adminsActiveMembersCount = admins?.activeMembersCount == null ? null : Math.max(0, Number(admins.activeMembersCount) || 0);

    payloadRooms.push({
      roomId: rid,
      roomName: String(r.roomName || "").trim() || "오픈채팅방",
      activeMembersCount: r.activeMembersCount == null ? null : Math.max(0, Number(r.activeMembersCount) || 0),
      lastMessageTs: pickLastMessageTs(days),
      today: {
        total: Math.max(0, Number(todayState.total || 0) || 0),
        text: Math.max(0, Number(todayState.text || 0) || 0),
        image: Math.max(0, Number(todayState.image || 0) || 0),
        other: Math.max(0, Number(todayState.other || 0) || 0),
      },
      yesterday: { total: Math.max(0, Number(yesterdayState.total || 0) || 0) },
      avg7d: { total: avg7 },
      sparkTodayHourly,
      spark7dDaily: totals7.slice(0, 7),
      hostNames,
      subhostNames,
      hostCount,
      subhostCount,
      adminsLoadedMembersCount,
      adminsActiveMembersCount,
      adminsHint,
    });
  }

  payloadRooms.sort((a, b) => String(a.roomName).localeCompare(String(b.roomName), "ko"));

  const uploadPayload = {
    ok: true,
    fetchedAt,
    rooms: payloadRooms,
  };

  const up = await postJson(
    `${consoleBase}/api/agent/global-snapshot`,
    { key: OPENCHAT_OVERVIEW_SNAPSHOT_KEY, fetchedAt, payload: uploadPayload },
    60000,
  );
  if (!up.ok) {
    const msg = String(up?.json?.error || "").trim();
    throw new Error(msg || `오픈채팅 업로드에 실패했어요(HTTP ${up.status}).`);
  }

  return { ok: true, fetchedAt, rooms: payloadRooms.length };
}

async function maybeSyncOpenchatOverview(opts = {}) {
  if (!OPENCHAT_OVERVIEW_ENABLED) return;
  if (openchatInFlight) return;

  const force = Boolean(opts.force);
  const now = Date.now();
  if (!force) {
    if (lastOpenchatSyncMs && now - lastOpenchatSyncMs < OPENCHAT_OVERVIEW_SYNC_INTERVAL_MS) return;
    if (lastOpenchatAttemptMs && now - lastOpenchatAttemptMs < OPENCHAT_OVERVIEW_RETRY_INTERVAL_MS) return;
  }

  openchatInFlight = true;
  lastOpenchatAttemptMs = now;
  try {
    writeAgentStatus({ state: "OPENCHAT_OVERVIEW_SYNC" });
    const r = await syncOpenchatOverviewOnce({ forceAdmins: force });
    lastOpenchatSyncMs = Date.now();
    writeAgentStatus({
      state: "POLLING",
      openchatOverview: { ok: true, fetchedAt: r.fetchedAt, rooms: r.rooms, lastSyncTs: new Date().toISOString() },
    });
    if (openchatOverviewState) {
      writeOpenchatOverviewState(openchatOverviewState);
    }
  } catch (e) {
    const msg = String(e?.message || "오픈채팅 갱신에 실패했어요.").trim();
    writeAgentStatus({
      state: "POLLING",
      openchatOverview: { ok: false, lastError: msg.slice(0, 200), lastSyncTs: new Date().toISOString() },
    });
  } finally {
    lastOpenchatAttemptMs = Date.now();
    openchatInFlight = false;
  }
}

async function maybeConsumeConsoleRequests() {
  if (!OPENCHAT_OVERVIEW_ENABLED) return;
  const now = Date.now();
  if (now - lastRequestsPollMs < OPENCHAT_REQUESTS_POLL_INTERVAL_MS) return;
  lastRequestsPollMs = now;

  const r = await getJson(`${consoleBase}/api/agent/requests`, 15000);
  if (!r.ok) return;

  // 1) 오픈채팅 대시보드 즉시 갱신
  const req = r?.json?.requests?.openchat_overview || null;
  const ts = String(req?.requestedAt || req?.requested_at || "").trim();
  if (ts) {
    const ms = new Date(ts).getTime();
    if (Number.isFinite(ms) && ms > lastOpenchatRequestSeenMs) {
      lastOpenchatRequestSeenMs = ms;
      await maybeSyncOpenchatOverview({ force: true });
    }
  }

  // 2) 특정 방 멤버/운영진 정보 보강(단말 스크롤)
  const prefix = "openchat_admins_refresh:";
  const list = Array.isArray(r?.json?.requests?.openchat_admins_refresh) ? r.json.requests.openchat_admins_refresh : [];
  const next = list && list.length > 0 ? list[0] : null;
  const key = String(next?.key || "").trim();
  if (!key || !key.startsWith(prefix)) return;
  const roomId = key.slice(prefix.length).trim();
  if (!roomId) {
    await postJson(`${consoleBase}/api/agent/requests/ack`, { key }, 15000).catch(() => {});
    return;
  }

  const opts = readOpenchatLoadOpts();
  const refresh = await postJson(
    `${LOCAL_API_BASE}/rooms/${encodeURIComponent(roomId)}/admins/refresh`,
    { serial: opts.serial || null, scrolls: opts.scrolls, pauseMs: opts.scrollPauseMs },
    20000,
  ).catch(() => null);

  // 운영진 갱신 요청이 들어오면, 해당 방 admins 캐시를 강제로 새로고침하도록 상태를
  // 마킹한다(단말 스크롤이 끝나면 다음 오픈채팅 스냅샷에서 자연스럽게 반영됨).
  try {
    if (!openchatOverviewState) openchatOverviewState = { rooms: {}, meta: {} };
    if (!openchatOverviewState.meta || typeof openchatOverviewState.meta !== "object" || Array.isArray(openchatOverviewState.meta)) {
      openchatOverviewState.meta = {};
    }
    const rs = ensureRoomStateContainer(roomId);
    if (rs) {
      const nowMs = Date.now();
      rs.adminsForceUntilMs = Math.max(Number(rs.adminsForceUntilMs || 0) || 0, nowMs + OPENCHAT_ADMINS_FORCE_REFRESH_MS);
      rs.openchatAdminsAutoLoadLastMs = nowMs;
      openchatOverviewState.meta.openchatAdminsAutoLoadLastMs = nowMs;
      if (refresh && refresh.ok && rs.admins && typeof rs.admins === "object") {
        rs.admins.fetchedAtMs = 0;
        rs.admins.hint = "운영진 정보를 불러오는 중이에요.";
      }
    }
  } catch {}

  // NOTE: refresh 성공/실패와 무관하게, 동일 요청을 반복 처리하지 않도록 ack 한다.
  await postJson(`${consoleBase}/api/agent/requests/ack`, { key }, 15000).catch(() => {});

  // 즉시 반영은 보장되지 않는다(단말 스크롤이 끝난 뒤 1~2분 내 자동 반영됨).
  if (refresh && refresh.ok) heartbeat({ openchatAdminsRefresh: { ok: true, requestedAt: ts || null } });
}

async function fetchCoursesFromConsole() {
  const r = await getJson(`${consoleBase}/api/agent/courses`, 45000);
  if (!r.ok) {
    const msg = String(r?.json?.error || "").trim();
    throw new Error(msg ? `코스 목록 조회에 실패했어요(${msg}).` : `코스 목록 조회에 실패했어요(HTTP ${r.status}).`);
  }
  const list = Array.isArray(r?.json?.courses) ? r.json.courses : [];
  return list.filter((c) => c && typeof c === "object");
}

function rebuildCoursesByKey(list) {
  const m = new Map();
  for (const course of list) {
    const key = String(course?.courseKey || course?.course_key || "").trim();
    if (!key) continue;
    m.set(key, course);
  }
  coursesByKey = m;
}

async function maybeSyncCoursesFromConsole() {
  if (!COURSES_AUTO_SYNC_ENABLED) return;

  const nowMs = Date.now();
  if (nowMs - lastCoursesSyncOkMs < COURSES_SYNC_INTERVAL_MS) return;
  if (nowMs - lastCoursesSyncAttemptMs < COURSES_SYNC_RETRY_INTERVAL_MS) return;

  lastCoursesSyncAttemptMs = nowMs;
  try {
    const list = await fetchCoursesFromConsole();
    rebuildCoursesByKey(list);
    for (const course of list) {
      try {
        upsertLocalCourseConfig(course);
      } catch {}
    }
    lastCoursesSyncOkMs = nowMs;
  } catch (e) {
    const msg = String(e?.message || "코스 목록 동기화에 실패했어요.").trim();
    heartbeat({ coursesSyncError: msg.slice(0, 200) });
  }
}

async function maybeUploadCourseSnapshots() {
  if (!SNAPSHOT_AUTO_UPLOAD_ENABLED) return;
  if (coursesByKey.size === 0) return;

  const nowMs = Date.now();
  if (nowMs - lastSnapshotUploadScanMs < SNAPSHOT_UPLOAD_SCAN_INTERVAL_MS) return;
  lastSnapshotUploadScanMs = nowMs;

  if (!uploaderState) uploaderState = readUploaderState();
  if (!uploaderState || typeof uploaderState !== "object") uploaderState = { courses: {} };
  if (!uploaderState.courses || typeof uploaderState.courses !== "object" || Array.isArray(uploaderState.courses)) {
    uploaderState.courses = {};
  }

  const st = readJson(statePath);
  const csMap = st && typeof st.courses === "object" && st.courses ? st.courses : {};
  const entries = Object.entries(csMap)
    .map(([k, v]) => [String(k), v])
    .filter(([k]) => Boolean(k))
    .sort((a, b) => Number(b?.[1]?.lastRunMs || b?.[1]?.lastOkMs || 0) - Number(a?.[1]?.lastRunMs || a?.[1]?.lastOkMs || 0));

  let uploaded = 0;
  for (const [courseKey, cs] of entries) {
    if (uploaded >= SNAPSHOT_UPLOAD_MAX_PER_SCAN) break;

    const course = coursesByKey.get(courseKey) || null;
    const courseId = String(course?.id || "").trim();
    if (!courseId) continue;

    const runMs = Number(cs?.lastRunMs || cs?.lastOkMs || 0);
    if (!runMs) continue;

    const prev = uploaderState.courses?.[courseKey] || {};
    const lastUploadedRunMs = Number(prev?.lastRunMs || 0);
    if (runMs <= lastUploadedRunMs) continue;

    const snapshotPath =
      String(cs?.lastSnapshotPath || "").trim() ||
      path.join(repoRoot, "node-iris-app", "data", "courseops_snapshots", `${safeFilename(courseKey)}.json`);
    if (!fs.existsSync(snapshotPath)) continue;

    let payload = null;
    try {
      payload = readJsonFileStrict(snapshotPath);
    } catch (e) {
      const msg = String(e?.message || "스냅샷 파일을 읽지 못했어요.").trim();
      uploaderState.courses[courseKey] = {
        ...(prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {}),
        lastError: msg.slice(0, 200),
        lastAttemptAt: new Date().toISOString(),
      };
      try {
        writeUploaderState(uploaderState);
      } catch {}
      continue;
    }

    const fetchedAt =
      String(payload?.fetchedAt || cs?.lastSnapshotFetchedAt || cs?.lastOkTs || "").trim() || null;

    try {
      const up = await postJson(`${consoleBase}/api/agent/snapshot`, { courseId, fetchedAt, payload }, 180000);
      if (!up.ok) {
        const msg = String(up?.json?.error || "").trim();
        throw new Error(msg ? `스냅샷 업로드에 실패했어요(${msg}).` : `스냅샷 업로드에 실패했어요(HTTP ${up.status}).`);
      }

      uploaderState.courses[courseKey] = {
        courseId,
        lastRunMs: runMs,
        fetchedAt,
        uploadedAt: new Date().toISOString(),
      };
      try {
        writeUploaderState(uploaderState);
      } catch {}
      uploaded += 1;
    } catch (e) {
      const msg = String(e?.message || "스냅샷 업로드에 실패했어요.").trim();
      uploaderState.courses[courseKey] = {
        ...(prev && typeof prev === "object" && !Array.isArray(prev) ? prev : {}),
        lastError: msg.slice(0, 200),
        lastAttemptAt: new Date().toISOString(),
      };
      try {
        writeUploaderState(uploaderState);
      } catch {}
    }
  }

  if (uploaded > 0) {
    heartbeat({ lastSnapshotUploadTs: new Date().toISOString(), lastSnapshotUploadCount: uploaded });
  }
}

function safeFilename(s) {
  const bad = /[<>:"/\\|?*]/g;
  const out = String(s || "").trim().replace(bad, "_");
  return out || "course";
}

function readJsonFileStrict(p) {
  const s = readText(p).trim();
  if (!s) throw new Error("스냅샷 파일이 비어 있어요.");
  try {
    return JSON.parse(s);
  } catch {
    throw new Error("스냅샷 파일(JSON) 파싱에 실패했어요.");
  }
}

function runPowershell(scriptPath, args = []) {
  return new Promise((resolve) => {
    const psArgs = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, ...args];
    const child = spawn("powershell.exe", psArgs, { cwd: repoRoot, windowsHide: true });
    child.on("exit", (code) => resolve({ code: code ?? 0 }));
  });
}

function resolvePythonExe() {
  const fromEnv = String(process.env.COURSEOPS_PYTHON_EXE || "").trim();
  if (fromEnv) return fromEnv;
  const venv = path.join(repoRoot, ".venv_cafe", "Scripts", "python.exe");
  if (fs.existsSync(venv)) return venv;
  return "python";
}

function runCommand(exe, args = [], timeoutMs = 30_000) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd: repoRoot, windowsHide: true });
    let stdout = "";
    let stderr = "";
    let done = false;

    const t = setTimeout(() => {
      if (done) return;
      done = true;
      try {
        child.kill();
      } catch {}
      resolve({ code: 124, stdout, stderr, timeout: true });
    }, Math.max(1000, Number(timeoutMs || 0) || 30_000));

    child.stdout?.on("data", (d) => {
      stdout += String(d || "");
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d || "");
    });
    child.on("exit", (code) => {
      if (done) return;
      done = true;
      clearTimeout(t);
      resolve({ code: code ?? 0, stdout, stderr, timeout: false });
    });
  });
}

async function ensureWorkerRunning() {
  const script = path.join(repoRoot, "windows", "start_course_membership_audit_worker.ps1");
  await runPowershell(script, []);
}

function readIrisBase() {
  const envUrl = String(process.env.IRIS_URL || process.env.IRIS_QUERY_BASE || process.env.IRIS_BRIDGE_URL || "").trim();
  if (envUrl) return envUrl.replace(/\/$/, "");
  const p = path.join(repoRoot, "config", "windows", "iris_url.txt");
  const s = readText(p).trim();
  return (s || "http://127.0.0.1:5050").replace(/\/$/, "");
}

async function irisQuery(query, bind, timeoutMs = 20000) {
  const irisBase = readIrisBase();
  const url = `${irisBase}/query`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, bind }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`IRIS /query 실패(HTTP ${res.status})`);
    const j = await res.json().catch(() => ({}));
    const data = Array.isArray(j?.data) ? j.data : [];
    return data.filter((x) => x && typeof x === "object");
  } finally {
    clearTimeout(t);
  }
}

const KOREAN_RE = /[가-힣ㄱ-ㅎㅏ-ㅣ]/;

function decodeNickname(raw) {
  const s = String(raw || "").trim();
  if (!s) return "";
  if (KOREAN_RE.test(s)) return s;
  try {
    const decoded = Buffer.from(s, "latin1").toString("utf8").trim();
    if (decoded && KOREAN_RE.test(decoded)) return decoded;
  } catch {}
  try {
    if (s.length >= 16 && s.length % 4 === 0 && /^[A-Za-z0-9+/=]+$/.test(s)) {
      const decoded = Buffer.from(s, "base64").toString("utf8").trim();
      if (decoded && KOREAN_RE.test(decoded)) return decoded;
    }
  } catch {}
  return s;
}

function extractCafeNickFromOpenchatNickname(nick) {
  const s = String(nick || "").trim();
  if (!s) return "";
  const m1 = s.match(/[（(]([^（）()\n\r]{1,100})[）)]\s*$/);
  if (m1 && m1[1]) return String(m1[1]).trim();
  // 괄호가 끝에 없거나(뒤에 이모지/추가 텍스트), 괄호가 여러 번 들어가는 변형 케이스
  try {
    let last = "";
    for (const m of s.matchAll(/[（(]([^（）()\n\r]{1,100})[）)]/g)) {
      if (m && m[1]) last = String(m[1]).trim();
    }
    if (last) return last;
  } catch {}
  const m2 = s.match(/[/／]\s*([^/／\s]{1,100})\s*$/);
  if (m2 && m2[1]) return String(m2[1]).trim();
  // 슬래시도 끝에 이모지/추가 텍스트가 붙을 수 있어 마지막 토큰을 보조로 사용
  const parts = s.split(/[/／]/g).map((x) => String(x || "").trim()).filter(Boolean);
  if (parts.length >= 2) {
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return "";
}

function normalizeCafeNick(s) {
  return String(s || "")
    .normalize("NFKC")
    .replace(/[\s\u200b\u200c\u200d\ufeff\u2060]+/gu, "")
    .trim()
    .toLowerCase();
}

async function fetchOpenchatMembers(roomId) {
  const rid = String(roomId || "").trim();
  if (!rid) return [];

  const rows = await irisQuery("select link_id from chat_rooms where id=?", [rid], 10000);
  const linkIdRaw = rows?.[0]?.link_id;
  const linkId = linkIdRaw === 0 || linkIdRaw ? String(linkIdRaw).trim() : "";
  if (!linkId) return [];

  const out = new Map();
  let offset = 0;
  const pageSize = 500;
  while (true) {
    const chunk = await irisQuery(
      "select user_id, nickname, enc from db2.open_chat_member where link_id=? order by nickname limit ? offset ?",
      [Number(linkId), pageSize, offset],
      30000,
    );
    if (!chunk || chunk.length === 0) break;
    for (const row of chunk) {
      const uid = String(row.user_id || "").trim();
      if (!uid) continue;
      const nick = decodeNickname(row.nickname);
      if (!out.has(uid)) out.set(uid, { userId: uid, nickname: nick });
      else if (nick && !out.get(uid).nickname) out.get(uid).nickname = nick;
    }
    if (chunk.length < pageSize) break;
    offset += pageSize;
  }

  return Array.from(out.values());
}

function triggerCourseRunOnce(courseKey) {
  const now = Date.now();
  const j = readJson(statePath);
  const courses = typeof j.courses === "object" && j.courses ? j.courses : {};
  const cs = typeof courses[courseKey] === "object" && courses[courseKey] ? courses[courseKey] : {};
  cs.nextRunMs = now;
  cs.nextRunTs = new Date(now).toISOString();
  courses[courseKey] = cs;
  j.courses = courses;
  writeJsonAtomic(statePath, j);
  return now;
}

function pickCourseKey(job) {
  const courseKey = job?.course?.courseKey || job?.course?.course_key || job?.courseKey;
  return String(courseKey || "").trim();
}

function getCourseState(courseKey) {
  const j = readJson(statePath);
  const cs = j?.courses?.[courseKey];
  return typeof cs === "object" && cs ? cs : null;
}

async function report(jobId, payload) {
  const r = await postJson(`${consoleBase}/api/agent/report`, { jobId, ...payload }, 45000);
  if (!r.ok) {
    const msg = String(r?.json?.error || "").trim();
    throw new Error(msg ? `작업 상태 전송에 실패했어요(${msg}).` : `작업 상태 전송에 실패했어요(HTTP ${r.status}).`);
  }
}

async function runSyncFull(job) {
  const courseKey = pickCourseKey(job);
  if (!courseKey) {
    await report(job.id, { status: "FAILED", resultMessage: "강의를 찾지 못했어요." });
    return;
  }

  try {
    const r = upsertLocalCourseConfig(job.course || job?.payload?.course || {});
    if (!r.ok) {
      await report(job.id, { status: "FAILED", resultMessage: String(r.error || "설정에 실패했어요.") });
      return;
    }
    if (!r.clubId) {
      await report(job.id, {
        status: "FAILED",
        resultMessage: "카페 clubId가 필요해요. 설정에서 clubId를 입력해 주세요.",
        events: [
          {
            level: "ERROR",
            message: "코스 설정에 clubId가 없어요. (카페 URL에 clubid=가 포함된 주소면 clubId 입력을 생략할 수 있어요.)",
            ts: new Date().toISOString(),
          },
        ],
      });
      return;
    }
  } catch (e) {
    await report(job.id, { status: "FAILED", resultMessage: "로컬 설정을 업데이트하지 못했어요." });
    return;
  }

  await ensureWorkerRunning();

  const startedAt = triggerCourseRunOnce(courseKey);
  await report(job.id, {
    status: "RUNNING",
    progressPct: 1,
    progressMessage: "동기화를 시작했어요.",
    events: [{ level: "INFO", message: `${courseKey} 동기화를 시작했어요.`, ts: new Date().toISOString() }],
  });

  const deadline = Date.now() + 25 * 60 * 1000;
  let lastMsg = "";
  let lastLogMs = 0;

  while (Date.now() < deadline) {
    const cs = getCourseState(courseKey);
    const progress = cs?.progress || {};
    const msg = String(progress?.message || "").trim();
    const pct = typeof progress?.pct === "number" ? progress.pct : null;
    const progressTs = typeof progress?.ts === "string" ? String(progress.ts).trim() : "";
    const evTs = progressTs || new Date().toISOString();
    const nowMs = Date.now();

    if (msg && (msg !== lastMsg || nowMs - lastLogMs >= 60 * 1000)) {
      lastMsg = msg;
      lastLogMs = nowMs;
      await report(job.id, {
        status: "RUNNING",
        progressPct: pct,
        progressMessage: msg,
        events: [{ level: "INFO", message: msg, ts: evTs }],
      });
    } else {
      await report(job.id, { status: "RUNNING", progressPct: pct, progressMessage: msg || null, events: [] });
    }

    const lastRunMs = Number(cs?.lastRunMs || 0);
    const lastResult = String(cs?.lastResult || "").trim();
    if (lastRunMs && lastRunMs >= startedAt && (lastResult === "OK" || lastResult === "ERROR")) {
      if (lastResult === "OK") {
        // 스냅샷 업로드까지 성공해야 웹 콘솔에 결과가 반영된다.
        try {
          await report(job.id, {
            status: "RUNNING",
            progressPct: 99,
            progressMessage: "웹 콘솔로 결과를 전송하는 중...",
            events: [{ level: "INFO", message: "웹 콘솔로 결과를 전송하는 중...", ts: new Date().toISOString() }],
          });

          const courseId = String(job?.course?.id || job?.courseId || "").trim();
          if (!courseId) throw new Error("courseId를 찾지 못했어요.");

          const snapshotPath =
            String(cs?.lastSnapshotPath || "").trim() ||
            path.join(repoRoot, "node-iris-app", "data", "courseops_snapshots", `${safeFilename(courseKey)}.json`);
          const payload = readJsonFileStrict(snapshotPath);
          const fetchedAt = String(payload?.fetchedAt || cs?.lastSnapshotFetchedAt || cs?.lastOkTs || "").trim() || null;

          const up = await postJson(`${consoleBase}/api/agent/snapshot`, { courseId, fetchedAt, payload }, 180000);
          if (!up.ok) throw new Error(`스냅샷 업로드에 실패했어요(HTTP ${up.status}).`);

          await report(job.id, {
            status: "DONE",
            progressPct: 100,
            progressMessage: "완료됐어요.",
            resultMessage: "완료됐어요.",
            events: [{ level: "INFO", message: "완료됐어요.", ts: new Date().toISOString() }],
          });
        } catch (e) {
          const msg = String(e?.message || "스냅샷 업로드에 실패했어요.");
          await report(job.id, {
            status: "FAILED",
            progressPct: 100,
            progressMessage: msg,
            resultMessage: msg,
            events: [{ level: "ERROR", message: msg, ts: new Date().toISOString() }],
          });
        }
      } else {
        const errUser = String(cs?.lastErrorUser || cs?.lastError || "").trim() || "실패했어요.";
        await report(job.id, {
          status: "FAILED",
          progressPct: 100,
          progressMessage: errUser,
          resultMessage: errUser,
          events: [{ level: "ERROR", message: errUser, ts: new Date().toISOString() }],
        });
      }
      return;
    }

    await sleep(2500);
  }

  await report(job.id, {
    status: "FAILED",
    progressPct: 100,
    progressMessage: "시간이 오래 걸려서 중단됐어요.",
    resultMessage: "시간이 오래 걸려서 중단됐어요.",
    events: [{ level: "ERROR", message: "시간이 오래 걸려서 중단됐어요.", ts: new Date().toISOString() }],
  });
}

function parseRoomLabels(s) {
  const t = String(s || "")
    .split(/[,，\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  return Array.from(new Set(t));
}

function roomTypeFromLabel(label) {
  const s = String(label || "").trim();
  if (s === "사담방") return "chat";
  if (s === "공지방") return "notice";
  if (s === "프리미엄방") return "premium";
  return "";
}

function readOpenchatLoadOpts() {
  const fallback = { serial: "", scrolls: 200, scrollPauseMs: 400, timeoutSec: 300 };
  try {
    const cfg = readJsonStrict(resolveAuditConfigPath());
    const w = cfg?.worker && typeof cfg.worker === "object" ? cfg.worker : {};
    const o = w?.openchatAutoLoad && typeof w.openchatAutoLoad === "object" ? w.openchatAutoLoad : {};
    const serial = String(o.serial || o.adbSerial || o.adb_serial || "").trim();
    const scrolls = Math.max(50, Math.min(3000, Number(o.scrolls || 200)));
    const scrollPauseMs = Math.max(150, Math.min(2000, Number(o.scrollPauseMs || 400)));
    const timeoutSec = Math.max(60, Math.min(1800, Number(o.timeoutSec || 300)));
    return { serial, scrolls, scrollPauseMs, timeoutSec };
  } catch {
    return fallback;
  }
}

async function refreshRoomMembers(roomId, label, jobId) {
  const script = path.join(repoRoot, "scripts", "openchat_load_members.ps1");
  if (!fs.existsSync(script)) return { ok: false, code: 404 };

  const opts = readOpenchatLoadOpts();
  await report(jobId, {
    status: "RUNNING",
    progressMessage: `${label} 멤버를 새로 불러오는 중...`,
    events: [{ level: "INFO", message: `${label} 멤버 DB 갱신을 시작했어요.`, ts: new Date().toISOString() }],
  });

  const args = [
    "-RoomId",
    String(roomId),
    "-Scrolls",
    String(opts.scrolls),
    "-ScrollPauseMs",
    String(opts.scrollPauseMs),
    "-IrisQueryBase",
    readIrisBase(),
  ];
  if (opts.serial) args.push("-Serial", opts.serial);
  const r = await runPowershell(script, args);
  const ok = r.code === 0;
  await report(jobId, {
    status: "RUNNING",
    progressMessage: ok ? `${label} 멤버 갱신 완료` : `${label} 멤버 갱신이 미완료예요`,
    events: [
      {
        level: ok ? "INFO" : "WARN",
        message: ok ? `${label} 멤버 DB 갱신이 끝났어요.` : `${label} 멤버 DB 갱신이 미완료예요. (데이터 미완전으로 처리될 수 있어요.)`,
        ts: new Date().toISOString(),
      },
    ],
  });
  return { ok, code: r.code };
}

async function runReverifyPending(job) {
  const courseKey = pickCourseKey(job);
  const items = Array.isArray(job?.payload?.items) ? job.payload.items : [];
  if (!courseKey || items.length === 0) {
    await report(job.id, {
      status: "DONE",
      progressPct: 100,
      progressMessage: "확인할 항목이 없어요.",
      resultMessage: "확인할 항목이 없어요.",
      events: [{ level: "INFO", message: "확인할 항목이 없어요.", ts: new Date().toISOString() }],
      actionUpdates: [],
    });
    return;
  }

  try {
    upsertLocalCourseConfig(job.course || job?.payload?.course || {});
  } catch {}

  const cs = getCourseState(courseKey);
  let lastRooms = cs?.lastRooms || cs?.last_rooms || null;
  if (!lastRooms || typeof lastRooms !== "object") {
    lastRooms = {};
    await report(job.id, {
      status: "RUNNING",
      progressPct: 1,
      progressMessage: "방 정보가 없어 코스 설정의 roomId로 재검증해요.",
      events: [
        {
          level: "WARN",
          message: "최근 동기화 정보가 없어서 코스 설정(roomId) 기준으로 재검증을 진행해요.",
          ts: new Date().toISOString(),
        },
      ],
    });
  }

  const updates = [];
  const memberCache = new Map();

  const course = job?.course || null;
  const courseRooms = {
    chat: String(course?.openchatChatRoomId || course?.openchat_chat_room_id || "").trim(),
    notice: String(course?.openchatNoticeRoomId || course?.openchat_notice_room_id || "").trim(),
    premium: Boolean(course?.premiumEnabled ?? course?.premium_enabled ?? true)
      ? String(course?.openchatPremiumRoomId || course?.openchat_premium_room_id || "").trim()
      : "",
  };

  const neededRoomTypes = new Set();
  for (const it of items) {
    const labels = parseRoomLabels(String(it.rooms || ""));
    for (const l of labels) {
      const rt = roomTypeFromLabel(l);
      if (rt) neededRoomTypes.add(rt);
    }
  }

  // 1) 빠른 재검증은 '필요한 방'만 멤버 DB를 먼저 갱신한다.
  const roomRefresh = new Map();
  for (const rt of Array.from(neededRoomTypes)) {
    const info = (lastRooms && typeof lastRooms === "object" ? lastRooms?.[rt] : null) || null;
    const roomId = String(info?.roomId || courseRooms?.[rt] || "").trim();
    if (!roomId) {
      roomRefresh.set(rt, { ok: false, code: 400, roomId: "" });
      continue;
    }
    const label = rt === "chat" ? "사담방" : rt === "notice" ? "공지방" : "프리미엄방";
    const rr = await refreshRoomMembers(roomId, label, job.id);
    roomRefresh.set(rt, { ...rr, roomId });
  }

  const total = items.length;
  let processed = 0;

  for (const it of items) {
    processed += 1;
    const actionKey = String(it.actionKey || "").trim();
    const action = String(it.action || "").trim();
    const target = String(it.target || "").trim();
    const roomsText = String(it.rooms || "").trim();

    const pct = Math.floor((processed / Math.max(1, total)) * 100);
    await report(job.id, {
      status: "RUNNING",
      progressPct: pct,
      progressMessage: `확인 중 ${processed}/${total}`,
      events: [],
    });

    if (!actionKey || !target) continue;

    const expect =
      action === "프리미엄방 정리"
        ? "absent"
        : action === "톡방 입장 안내" || action === "카페 가입 확인 후 톡방 입장 안내"
          ? "present"
          : null;
    if (!expect) continue;

    const labels = parseRoomLabels(roomsText);
    const roomTypes = labels.map(roomTypeFromLabel).filter(Boolean);
    if (roomTypes.length === 0) continue;

    let unknown = false;
    const roomIds = [];
    for (const rt of roomTypes) {
      const rr = roomRefresh.get(rt) || null;
      const roomId = String(rr?.roomId || "").trim();
      const incomplete = rr && rr.ok === false;
      if (!roomId || incomplete) {
        unknown = true;
        break;
      }
      roomIds.push(roomId);
    }
    if (unknown) {
      updates.push({ actionKey, status: "확인 불가(데이터 미완전)" });
      continue;
    }

    const targetKey = normalizeCafeNick(target);
    let ok = true;
    for (const roomId of roomIds) {
      if (!memberCache.has(roomId)) {
        const members = await fetchOpenchatMembers(roomId);
        memberCache.set(roomId, members);
      }
      const members = memberCache.get(roomId) || [];
      const present = members.some((m) => normalizeCafeNick(extractCafeNickFromOpenchatNickname(m.nickname)) === targetKey);
      if (expect === "present" && !present) ok = false;
      if (expect === "absent" && present) ok = false;
    }

    updates.push({ actionKey, status: ok ? "완료(검증됨)" : "미해결(재확인)" });
  }

  await report(job.id, {
    status: "DONE",
    progressPct: 100,
    progressMessage: "확인이 끝났어요.",
    resultMessage: "확인이 끝났어요.",
    events: [{ level: "INFO", message: "확인이 끝났어요.", ts: new Date().toISOString() }],
    actionUpdates: updates,
  });
}

  async function syncMainCafeOnce() {
    if (!MAIN_CAFE_ENABLED) return;
    if (!MAIN_CAFE_CLUB_ID) return;

    const py = resolvePythonExe();
    const script = path.join(repoRoot, "scripts", "crawl_naver_cafe_members.py");
    const timeoutMs = envInt("COURSEOPS_MAIN_CAFE_CRAWL_TIMEOUT_SEC", 60 * 60, 60, 4 * 60 * 60) * 1000;

    const args = [
      script,
      "--club-id",
      MAIN_CAFE_CLUB_ID,
      "--cafe-name",
      MAIN_CAFE_NAME,
      "--output",
      MAIN_CAFE_SNAPSHOT_PATH,
      "--headless",
    ];

    const r = await runCommand(py, args, timeoutMs);
    if (r.timeout) {
      const fetchedAt = new Date().toISOString();
      const uploadPayload = {
        ok: false,
        clubId: MAIN_CAFE_CLUB_ID,
        cafeName: MAIN_CAFE_NAME,
        fetchedAt,
        totalCount: 0,
        error: "메인 카페 동기화가 너무 오래 걸려 중단했어요.",
        summary: null,
      };
      const up = await postJson(
        `${consoleBase}/api/agent/global-snapshot`,
        { key: MAIN_CAFE_SNAPSHOT_KEY, fetchedAt, payload: uploadPayload },
        180000,
      );
      if (!up.ok) {
        const msg = String(up?.json?.error || "").trim();
        throw new Error(msg || `메인 카페 업로드에 실패했어요(HTTP ${up.status}).`);
      }
      return { fetchedAt, ok: false, exitCode: r.code, summary: null };
    }

    let payload = null;
    try {
      payload = readJsonFileStrict(MAIN_CAFE_SNAPSHOT_PATH);
    } catch {}
    if (!payload) {
      const fetchedAt = new Date().toISOString();
      const uploadPayload = {
        ok: false,
        clubId: MAIN_CAFE_CLUB_ID,
        cafeName: MAIN_CAFE_NAME,
        fetchedAt,
        totalCount: 0,
        error: "메인 카페 결과 파일을 읽지 못했어요.",
        summary: null,
      };
      const up = await postJson(
        `${consoleBase}/api/agent/global-snapshot`,
        { key: MAIN_CAFE_SNAPSHOT_KEY, fetchedAt, payload: uploadPayload },
        180000,
      );
      if (!up.ok) {
        const msg = String(up?.json?.error || "").trim();
        throw new Error(msg || `메인 카페 업로드에 실패했어요(HTTP ${up.status}).`);
      }
      return { fetchedAt, ok: false, exitCode: r.code, summary: null };
    }

    const fetchedAt = String(payload?.fetchedAt || "").trim() || null;

    const summary = buildCafeSummary(payload);
    const uploadPayload = {
      ok: Boolean(payload?.ok),
      clubId: String(payload?.clubId || payload?.club_id || MAIN_CAFE_CLUB_ID).trim() || MAIN_CAFE_CLUB_ID,
      cafeName: String(payload?.cafeName || payload?.cafe_name || MAIN_CAFE_NAME).trim() || MAIN_CAFE_NAME,
      fetchedAt: String(payload?.fetchedAt || "").trim() || null,
      totalCount: summary.total,
      error: String(payload?.error || "").trim() || "",
      summary,
    };

    const up = await postJson(
      `${consoleBase}/api/agent/global-snapshot`,
      { key: MAIN_CAFE_SNAPSHOT_KEY, fetchedAt, payload: uploadPayload },
      180000,
    );
    if (!up.ok) {
      const msg = String(up?.json?.error || "").trim();
      throw new Error(msg || `메인 카페 업로드에 실패했어요(HTTP ${up.status}).`);
    }

    return { fetchedAt, ok: Boolean(payload?.ok), exitCode: r.code, summary };
  }

  async function maybeSyncMainCafe() {
    if (!MAIN_CAFE_ENABLED) return;
    if (mainCafeInFlight) return;

    const now = Date.now();
    if (lastMainCafeSyncMs && now - lastMainCafeSyncMs < MAIN_CAFE_SYNC_INTERVAL_MS) return;
    // 실패/배포 지연 등으로 업로드가 안 될 때 너무 자주 재시도하면
    // 로그인 반복/브라우저 다중 실행 같은 운영 사고로 이어질 수 있어 백오프를 둔다.
    if (lastMainCafeAttemptMs && now - lastMainCafeAttemptMs < MAIN_CAFE_RETRY_INTERVAL_MS) return;

    mainCafeInFlight = true;
    lastMainCafeAttemptMs = now;
    try {
      writeAgentStatus({ state: "MAIN_CAFE_SYNC" });
      const r = await syncMainCafeOnce();
      lastMainCafeSyncMs = Date.now();
      writeAgentStatus({
        state: "POLLING",
        mainCafe: {
          ok: Boolean(r?.ok),
          fetchedAt: String(r?.fetchedAt || "").trim() || null,
          lastSyncTs: new Date().toISOString(),
          summary: r?.summary || null,
        },
      });
    } catch (e) {
      const msg = String(e?.message || "메인 카페 동기화에 실패했어요.").trim();
      writeAgentStatus({
        state: "POLLING",
        mainCafe: {
          ok: false,
          lastError: msg.slice(0, 200),
          lastSyncTs: new Date().toISOString(),
        },
      });
    } finally {
      // 다음 시도 간격은 "시작"이 아니라 "끝" 기준으로 계산한다(장시간 크롤링 실패 시 즉시 재시도 루프 방지).
      lastMainCafeAttemptMs = Date.now();
      mainCafeInFlight = false;
    }
  }

  async function handleJob(job) {
    if (!job) return;
    heartbeat({ lastJobId: String(job.id || ""), lastJobKind: String(job.kind || "") });
    if (job.kind === "SYNC_FULL") {
      await runSyncFull(job);
      return;
    }
    if (job.kind === "REVERIFY_PENDING") {
      await runReverifyPending(job);
      return;
    }
    await report(job.id, { status: "FAILED", resultMessage: "지원하지 않는 작업이에요." });
  }

async function main() {
  writeAgentStatus({ state: "STARTING" });
  try {
    uploaderState = readUploaderState();
  } catch {
    uploaderState = { courses: {} };
  }
  try {
    openchatOverviewState = readOpenchatOverviewState();
  } catch {
    openchatOverviewState = { rooms: {}, meta: {} };
  }
  try {
    await maybeSyncCoursesFromConsole();
  } catch {}
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      heartbeat({ state: "POLLING" });
      const r = await postJson(`${consoleBase}/api/agent/poll`, { agentName, version: "0.1" }, 30000);
      if (!r.ok) {
        const msg = String(r?.json?.error || "").trim();
        throw new Error(msg ? `작업 확인에 실패했어요(${msg}).` : `작업 확인에 실패했어요(HTTP ${r.status}).`);
      }

      if (r.json?.job) {
        heartbeat({ state: "WORKING" });
        try {
          await handleJob(r.json.job);
        } catch (e) {
          const msg = String(e?.message || "작업 중 문제가 생겼어요.");
          try {
            await report(r.json.job.id, {
              status: "FAILED",
              progressPct: 100,
              progressMessage: msg,
              resultMessage: msg,
              events: [{ level: "ERROR", message: msg, ts: new Date().toISOString() }],
            });
          } catch {}
        }
        } else {
          try {
            await maybeSyncCoursesFromConsole();
          } catch {}
          try {
            await maybeUploadCourseSnapshots();
          } catch {}
          try {
            await maybeSyncMainCafe();
          } catch {}
          try {
            await maybeConsumeConsoleRequests();
          } catch {}
          try {
            await maybeSyncOpenchatOverview();
          } catch {}
          await sleep(pollSec * 1000);
        }
      } catch (e) {
      const msg = String(e?.message || "ERROR").trim();
      heartbeat({ state: "ERROR", lastError: msg.slice(0, 200) });
      await sleep(Math.max(2, pollSec) * 1000);
    }
  }
}

main();
