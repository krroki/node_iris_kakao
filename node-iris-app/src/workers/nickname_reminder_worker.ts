import { Logger } from "@tsuki-chat/node-iris";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { tryServerIrisReplyText } from "../utils/iris";
import { APP_ROOT } from "../utils/paths";
import { tryServerTalkApiDispatch } from "../utils/talkapi";
import { isKakaoDefaultNickname, resolveKakaoDefaultNicknameRegexesFromRuntime } from "../utils/welcomeTemplatePolicy";

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
  talkApi?: { enabled?: boolean } | undefined;
  nicknameReminder?: {
    enabled?: boolean;
    // 워커 tick(주기적으로 스캔). 기본은 60초.
    tickSec?: number;
    // 방별 발신 최소 간격(도배 방지). 기본은 24시간.
    perRoomMinSendIntervalSec?: number;
    // 한 번에 발신하는 멘션 수(카카오 제한 15). 기본 15.
    maxMentionsPerMessage?: number;
    // 메시지 간 딜레이(ms). 기본 1500ms.
    betweenMessagesDelayMs?: number;
    // 멤버 로딩(스크롤) 후 완전성 재확인 대기(ms). 기본 90초.
    memberLoadWaitMs?: number;
    // 멤버 로딩 스크롤 횟수(override). 미설정이면 activeMembersCount 기반으로 자동 결정.
    memberLoadScrolls?: number;
    // 경고(안내) 스케줄 (초)
    // - level1.afterFirstSeenSec: 기본닉으로 처음 관측된 후 1차 안내까지 지연
    // - level2.afterLastWarnSec: 1차 안내 후 2차 안내까지 지연
    // - level3.afterLastWarnSec: 2차 안내 후 3차 안내까지 지연
    warningSchedule?: {
      level1?: { afterFirstSeenSec?: number };
      level2?: { afterLastWarnSec?: number };
      level3?: { afterLastWarnSec?: number };
    };
    // 안내 메시지(레벨별)
    warningMessageByLevel?: {
      "1"?: string;
      "2"?: string;
      "3"?: string;
    };
  };
};

type UserWarnState = {
  nickname?: string;
  firstSeenAtMs?: number;
  lastSeenAtMs?: number;
  warningCount?: number; // 0..3
  lastWarnAtMs?: number;
  resolvedAtMs?: number;
};

type RoomState = {
  lastRunAtMs?: number;
  lastMemberLoadAtMs?: number;
  lastSendAtMs?: number;
  lastLevelSent?: number;
  users?: Record<string, UserWarnState>;
};

type WorkerState = {
  updatedAt?: string;
  rooms?: Record<string, RoomState>;
};

const logger = new Logger("nickname-reminder-worker");

const STATE_PATH = path.join(APP_ROOT, "data", "nickname_reminder_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "nickname_reminder_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "nickname_reminder_worker.lock");

// 운영 진단/알림 로그는 항상 "테스트용 오픈채팅방"으로만 발신한다(운영방 오염 방지).
const OPS_LOG_ROOM_ID = "18462226881291012";

const ROOM_LOG_DIR = path.join(APP_ROOT, "data", "nickname_reminder_logs");

const OPS_BATCH_WINDOW_MS = 800;
const OPS_MAX_CHARS = 1600;
let opsBuf: string[] = [];
let opsTimer: NodeJS.Timeout | null = null;
let opsLastRuntime: RuntimeConfig | null = null;
let opsFlushInProgress = false;

const MEMBER_LOAD_DEDUP = new DedupCache(15 * 60 * 1000); // roomId 기준 15분
const MEMBER_LOAD_GLOBAL_DEDUP = new DedupCache(3 * 60 * 1000); // 전역 3분 (ADB 과밀 방지)

const STREAM_TTL_MS = Number.parseInt(String(process.env.NICKNAME_REMINDER_STREAM_TTL_MS || "").trim(), 10) || 60_000;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function isSafeModeOn(runtime: RuntimeConfig): boolean {
  return runtime.safeMode !== false;
}

function isTalkApiEnabled(runtime: RuntimeConfig): boolean {
  return !!runtime?.talkApi?.enabled;
}

function isRoomAllowed(runtime: RuntimeConfig, roomId: string): boolean {
  const rid = safeString(roomId);
  if (!rid) return false;
  const ex = Array.isArray(runtime.excludedRoomIds) ? runtime.excludedRoomIds.map(String) : [];
  if (ex.includes(rid)) return false;
  const allow = Array.isArray(runtime.allowedRoomIds) ? runtime.allowedRoomIds.map(String) : [];
  return allow.includes(rid);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOps(title: string, lines: Array<string | null | undefined>): string {
  const out: string[] = [];
  const head = String(title || "").trim();
  out.push(head ? `[운영 알림] ${head}` : "[운영 알림]");
  for (const ln of lines) {
    const s = String(ln || "").trim();
    if (!s) continue;
    out.push(`- ${s}`);
  }
  return out.join("\n").trim();
}

function trimOpsText(text: string): string {
  const s = String(text || "").trim();
  if (!s) return "";
  if (s.length <= OPS_MAX_CHARS) return s;
  return s.slice(0, OPS_MAX_CHARS - 20).trimEnd() + "\n...(길어서 일부 생략)";
}

async function flushOpsLogs(): Promise<void> {
  if (opsFlushInProgress) return;
  const runtime = opsLastRuntime;
  const batch = opsBuf;
  opsBuf = [];
  opsLastRuntime = null;
  if (!runtime || batch.length === 0) return;

  opsFlushInProgress = true;
  try {
    const combined = trimOpsText(batch.join("\n\n---\n\n"));
    if (!combined) return;
    const okTalk = isTalkApiEnabled(runtime) ? await tryServerTalkApiDispatch(logger, OPS_LOG_ROOM_ID, combined, [], 12000) : false;
    if (!okTalk) {
      await tryServerIrisReplyText(logger, OPS_LOG_ROOM_ID, combined, 12000);
    }
  } catch (e) {
    logger.warn("[ops] flush failed", { err: String(e) });
  } finally {
    opsFlushInProgress = false;
    if (opsBuf.length > 0 && !opsTimer) {
      opsTimer = setTimeout(() => {
        opsTimer = null;
        void flushOpsLogs();
      }, OPS_BATCH_WINDOW_MS);
    }
  }
}

async function sendOpsLog(runtime: RuntimeConfig, msg: string): Promise<void> {
  const text = trimOpsText(msg);
  if (!text) return;
  if (isSafeModeOn(runtime)) return;
  if (!OPS_LOG_ROOM_ID) return;

  opsLastRuntime = runtime;
  opsBuf.push(text);

  const roughLen = opsBuf.reduce((n, s) => n + s.length + 6, 0);
  if (roughLen >= OPS_MAX_CHARS) {
    if (opsTimer) {
      clearTimeout(opsTimer);
      opsTimer = null;
    }
    void flushOpsLogs();
    return;
  }

  if (!opsTimer) {
    opsTimer = setTimeout(() => {
      opsTimer = null;
      void flushOpsLogs();
    }, OPS_BATCH_WINDOW_MS);
  }
}

function nowIso(): string {
  return new Date().toISOString();
}

function parseRoomNameFromMeta(metaRaw: unknown): string | null {
  const s = safeString(metaRaw);
  if (!s) return null;
  if (!s.startsWith("{") && !s.startsWith("[")) return null;
  try {
    const j: any = JSON.parse(s);
    const contents: string[] = [];
    if (Array.isArray(j)) {
      for (const it of j) {
        if (it && typeof it === "object" && typeof (it as any).content === "string") {
          const c = String((it as any).content).trim();
          if (c) contents.push(c);
        }
      }
    } else if (j && typeof j === "object") {
      const c = typeof (j as any).content === "string" ? String((j as any).content).trim() : "";
      if (c) contents.push(c);
    }
    for (const c of contents) {
      const m = c.match(/Welcome to\s+['"](.+?)['"]/);
      if (m && m[1]) return String(m[1]).trim() || null;
    }
  } catch {
    return null;
  }
  return null;
}

function clampInt(n: number, min: number, max: number): number {
  const v = Number.isFinite(n) ? Math.floor(n) : min;
  return Math.max(min, Math.min(max, v));
}

function repoRoot(): string {
  return path.resolve(APP_ROOT, "..");
}

async function readJsonSafe<T extends object>(p: string): Promise<T> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const j = JSON.parse(raw || "{}");
    return (j && typeof j === "object" ? j : {}) as T;
  } catch {
    return {} as T;
  }
}

async function writeJsonAtomic(dst: string, obj: unknown): Promise<void> {
  const dir = path.dirname(dst);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2), "utf8");
  await fs.rename(tmp, dst);
}

async function loadRuntime(): Promise<RuntimeConfig> {
  const j = await readJsonSafe<RuntimeConfig>(RUNTIME_PATH);
  if (!j || typeof j !== "object") return {};
  return j;
}

async function irisQuery(query: string, bind: unknown[], timeoutMs = 10000): Promise<{ ok: boolean; rows: any[]; err?: string }> {
  const base = (process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
  const url = `${base}/query`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, bind }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, rows: [], err: String(j?.message || j?.detail || `HTTP ${res.status}`) };
    const rows = Array.isArray(j?.data) ? j.data : [];
    return { ok: true, rows };
  } catch (e) {
    clearTimeout(t);
    return { ok: false, rows: [], err: String(e) };
  }
}

async function resolveRoomName(roomId: string): Promise<string | null> {
  const rid = safeString(roomId);
  if (!rid) return null;
  const r0 = await irisQuery("select meta, active_members_count, link_id from chat_rooms where id=?", [rid], 12000);
  if (!r0.ok || !r0.rows?.[0]) return null;
  const row: any = r0.rows[0] || {};
  const nameFromMeta = parseRoomNameFromMeta(row?.meta);
  if (nameFromMeta) return nameFromMeta;

  const linkId = safeString(row?.link_id);
  if (!linkId) return rid;
  const r2 = await irisQuery("select name from db2.open_link where id=?", [linkId], 12000);
  const nm = safeString(r2.rows?.[0]?.name);
  return nm || rid;
}

async function fetchCounts(roomId: string): Promise<{ active: number | null; loaded: number; roomName: string | null }> {
  const rid = safeString(roomId);
  if (!rid) return { active: null, loaded: 0, roomName: null };

  const roomName = await resolveRoomName(rid);
  const r0 = await irisQuery("select active_members_count as cnt from chat_rooms where id=?", [rid], 12000);
  let active: number | null = null;
  if (r0.ok) {
    const v = Number(r0.rows?.[0]?.cnt ?? r0.rows?.[0]?.active_members_count);
    if (Number.isFinite(v) && v >= 0) active = v;
  }
  const r1 = await irisQuery(
    "select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?",
    [rid],
    20000,
  );
  let loaded = 0;
  if (r1.ok) {
    const v = Number(r1.rows?.[0]?.cnt);
    if (Number.isFinite(v) && v >= 0) loaded = v;
  }
  return { active, loaded, roomName };
}

function computeScrolls(activeMembersCount: number | null, runtime: RuntimeConfig): number {
  const conf = runtime.nicknameReminder || {};
  const raw = Number(conf.memberLoadScrolls);
  if (Number.isFinite(raw) && raw > 0) return clampInt(raw, 50, 1200);
  if (!activeMembersCount || !Number.isFinite(activeMembersCount) || activeMembersCount <= 0) return 300;
  // 대형 방(수천명)은 더 많이 스크롤해야 DB가 채워질 수 있다.
  return clampInt(Math.ceil(activeMembersCount / 6), 200, 800);
}

function computeMemberLoadWaitMs(runtime: RuntimeConfig): number {
  const conf = runtime.nicknameReminder || {};
  const raw = Number(conf.memberLoadWaitMs);
  if (Number.isFinite(raw) && raw >= 0) return clampInt(raw, 0, 10 * 60 * 1000);
  // 기본: 짧게 90초만 대기(대형 방은 다음 주기에 재검증)
  return 90_000;
}

async function triggerMemberLoad(roomId: string, roomName: string, runtime: RuntimeConfig, reason: string): Promise<void> {
  if (isSafeModeOn(runtime)) return;
  if (!isRoomAllowed(runtime, roomId)) return;
  if (MEMBER_LOAD_DEDUP.isDuplicate(roomId)) return;
  if (MEMBER_LOAD_GLOBAL_DEDUP.isDuplicate("global")) return;

  const root = repoRoot();
  const scriptPath = path.join(root, "scripts", "openchat_load_members.ps1");
  const logsDir = path.join(root, "windows", "logs");
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const outLog = path.join(logsDir, `openchat_load_members.nickname_reminder.${ts}.out.log`);
  const errLog = path.join(logsDir, `openchat_load_members.nickname_reminder.${ts}.err.log`);

  try {
    await fs.mkdir(logsDir, { recursive: true });
    await fs.writeFile(outLog, `[${nowIso()}] start openchat_load_members (nickname_reminder)\n`, "utf8");
    await fs.writeFile(errLog, `[${nowIso()}] start openchat_load_members (nickname_reminder)\n`, "utf8");
    const outFd = await fs.open(outLog, "a");
    const errFd = await fs.open(errLog, "a");

    const { active } = await fetchCounts(roomId);
    const scrolls = computeScrolls(active, runtime);
    const args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-RoomId", String(roomId), "-Scrolls", String(scrolls)];
    const p = spawn("powershell", args, {
      detached: true,
      stdio: ["ignore", outFd.fd, errFd.fd],
      windowsHide: true,
      cwd: root,
    });
    p.unref();
    try {
      await outFd.close();
      await errFd.close();
    } catch {}

    await sendOpsLog(
      runtime,
      formatOps("기본 닉네임 안내(멘션) - 멤버 목록 로딩 시작", [
        `방: ${roomName}`,
        `사유: ${reason}`,
        "Redroid에서 멤버 목록을 열고 스크롤 중입니다(송신 없음).",
        "1~3분 후 다시 시도됩니다.",
      ]),
    );
  } catch (e) {
    await sendOpsLog(
      runtime,
      formatOps("기본 닉네임 안내(멘션) - 멤버 목록 로딩 실패", [
        `방: ${roomName}`,
        `사유: ${reason}`,
        `오류: ${String(e)}`,
      ]),
    );
  }
}

function normalizeNameForMention(raw: string): string {
  // 멘션 토큰은 message 안의 "@<name>"를 기반으로 매칭되므로,
  // 동일한 문자열이 되도록 줄바꿈/연속 공백만 정리한다(과도한 변형 금지).
  return String(raw || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeNicknameFromDb(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  // IRIS /query가 open_chat_member.nickname을 UTF-8 bytes를 latin1로 잘못 디코딩해 내리는 케이스가 있다.
  // 예: "ìµì°" → Buffer(latin1) → utf8 → "융쓰"
  // - 이미 한글이 포함되어 있으면 그대로 사용.
  // - 그렇지 않으면 latin1→utf8을 시도하고, 결과에 한글이 있으면 교체.
  if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(s)) return s;
  try {
    const decoded = Buffer.from(s, "latin1").toString("utf8").trim();
    if (decoded && /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(decoded)) return decoded;
  } catch {
    // ignore
  }
  return s;
}

async function fetchMembers(roomId: string): Promise<Array<{ userId: string; nickname: string }>> {
  const rid = safeString(roomId);
  if (!rid) return [];
  const out: Array<{ userId: string; nickname: string }> = [];
  const seen = new Set<string>();
  let offset = 0;
  const limit = 500;
  while (true) {
    const r = await irisQuery(
      "select user_id, nickname from db2.open_chat_member where involved_chat_id=? order by nickname limit ? offset ?",
      [rid, limit, offset],
      20000,
    );
    if (!r.ok) break;
    const rows = Array.isArray(r.rows) ? r.rows : [];
    if (rows.length === 0) break;
    for (const row of rows) {
      const uid = safeString((row as any)?.user_id);
      if (!uid) continue;
      if (seen.has(uid)) continue;
      seen.add(uid);
      const nick0 = decodeNicknameFromDb(safeString((row as any)?.nickname));
      const nick = normalizeNameForMention(nick0);
      out.push({ userId: uid, nickname: nick || uid });
    }
    offset += rows.length;
    if (rows.length < limit) break;
    if (out.length >= 30_000) break; // safety
  }
  return out;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function computeTickMs(runtime: RuntimeConfig): number {
  const conf = runtime.nicknameReminder || {};
  const raw = Number(conf.tickSec);
  if (Number.isFinite(raw) && raw > 0) return clampInt(raw, 10, 60 * 60) * 1000;
  return 60_000;
}

function computePerRoomMinSendIntervalMs(runtime: RuntimeConfig): number {
  const conf = runtime.nicknameReminder || {};
  const raw = Number(conf.perRoomMinSendIntervalSec);
  if (Number.isFinite(raw) && raw >= 0) return clampInt(raw, 0, 30 * 24 * 60 * 60) * 1000;
  return 24 * 60 * 60 * 1000;
}

function computeMaxMentionsPerMessage(runtime: RuntimeConfig): number {
  const conf = runtime.nicknameReminder || {};
  const raw = Number(conf.maxMentionsPerMessage);
  if (Number.isFinite(raw) && raw > 0) return clampInt(raw, 1, 15);
  return 15;
}

function computeBetweenMessagesDelayMs(runtime: RuntimeConfig): number {
  const conf = runtime.nicknameReminder || {};
  const raw = Number(conf.betweenMessagesDelayMs);
  if (Number.isFinite(raw) && raw >= 0) return clampInt(raw, 0, 10_000);
  return 1500;
}

function scheduleAfterFirstSeenMs(runtime: RuntimeConfig): number {
  const v = Number(runtime.nicknameReminder?.warningSchedule?.level1?.afterFirstSeenSec);
  if (Number.isFinite(v) && v >= 0) return clampInt(v, 0, 30 * 24 * 60 * 60) * 1000;
  return 0;
}

function scheduleAfterLastWarnMsForLevel(runtime: RuntimeConfig, level: 2 | 3): number {
  const v =
    level === 2
      ? Number(runtime.nicknameReminder?.warningSchedule?.level2?.afterLastWarnSec)
      : Number(runtime.nicknameReminder?.warningSchedule?.level3?.afterLastWarnSec);
  if (Number.isFinite(v) && v >= 0) return clampInt(v, 0, 30 * 24 * 60 * 60) * 1000;
  // 기본: 2차=24h, 3차=48h
  return (level === 2 ? 24 : 48) * 60 * 60 * 1000;
}

function messageTextForLevel(runtime: RuntimeConfig, level: 1 | 2 | 3): string {
  const conf = runtime.nicknameReminder || {};
  const raw = conf.warningMessageByLevel && typeof conf.warningMessageByLevel === "object" ? (conf.warningMessageByLevel as any)[String(level)] : "";
  const s = safeString(raw);
  if (s) return s;
  if (level === 1) return "닉네임을 소통 편한 걸로 변경 부탁드립니다! (1차 안내)";
  if (level === 2) return "닉네임 변경을 다시 한 번 부탁드립니다 🙏 (2차 안내)";
  return "마지막 안내입니다. 닉네임 변경 부탁드립니다. (3차 안내)";
}

function isFeatureEnabledForRoom(runtime: RuntimeConfig, roomId: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const f = feats[roomId];
  if (!f || typeof f !== "object") return false;
  return (f as any).nicknameReminder === true;
}

function pruneState(state: WorkerState, nowMs: number): WorkerState {
  const rooms = state.rooms && typeof state.rooms === "object" ? state.rooms : {};
  const nextRooms: WorkerState["rooms"] = {};
  const keepAfter = nowMs - 14 * 24 * 60 * 60 * 1000; // 14일
  for (const [rid, r] of Object.entries(rooms)) {
    if (!r || typeof r !== "object") continue;
    const rr = r as RoomState;
    const users = rr.users && typeof rr.users === "object" ? rr.users : {};
    const nextUsers: Record<string, UserWarnState> = {};
    for (const [uid, u] of Object.entries(users)) {
      if (!u || typeof u !== "object") continue;
      const uu = u as UserWarnState;
      const lastSeen = Number(uu.lastSeenAtMs || 0);
      const resolved = Number(uu.resolvedAtMs || 0);
      const lastRelevant = Math.max(lastSeen, resolved);
      if (lastRelevant && lastRelevant < keepAfter) continue;
      nextUsers[uid] = uu;
    }
    nextRooms[rid] = {
      lastRunAtMs: rr.lastRunAtMs,
      lastMemberLoadAtMs: rr.lastMemberLoadAtMs,
      lastSendAtMs: rr.lastSendAtMs,
      lastLevelSent: rr.lastLevelSent,
      users: nextUsers,
    };
  }
  return { ...state, rooms: nextRooms, updatedAt: nowIso() };
}

async function acquireLock(): Promise<void> {
  await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
  try {
    const raw = await fs.readFile(LOCK_PATH, "utf8").catch(() => "");
    const oldPid = Number.parseInt(String(raw || "").trim(), 10);
    if (Number.isFinite(oldPid) && oldPid > 0) {
      try {
        process.kill(oldPid, 0);
        throw new Error(`nickname-reminder-worker already running (lock pid=${oldPid})`);
      } catch {
        // stale
      }
    }
  } catch {
    // ignore
  }
  await fs.writeFile(LOCK_PATH, String(process.pid), "utf8");
}

async function releaseLock(): Promise<void> {
  try {
    const raw = await fs.readFile(LOCK_PATH, "utf8").catch(() => "");
    const pid = Number.parseInt(String(raw || "").trim(), 10);
    if (pid === process.pid) {
      await fs.unlink(LOCK_PATH).catch(() => {});
    }
  } catch {
    // ignore
  }
}

async function writeStatus(payload: Record<string, unknown>): Promise<void> {
  const out = {
    pid: process.pid,
    heartbeatTs: nowIso(),
    ...payload,
  };
  await writeJsonAtomic(STATUS_PATH, out);
}

async function appendRoomLog(roomId: string, rec: Record<string, unknown>): Promise<void> {
  const rid = safeString(roomId);
  if (!rid) return;
  const day = new Date().toISOString().slice(0, 10);
  const dir = path.join(ROOM_LOG_DIR, rid);
  const file = path.join(dir, `${day}.log`);
  const line = JSON.stringify({ ts: nowIso(), roomId: rid, ...rec }) + "\n";
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.appendFile(file, line, "utf8");
  } catch {
    // ignore (room log is best-effort; 운영 알림/스킵은 별도로 남긴다)
  }
}

function chooseLevelToSend(dueByLevel: Record<number, any[]>, lastLevelSent?: number): 1 | 2 | 3 | null {
  const has = (n: number) => Array.isArray(dueByLevel[n]) && dueByLevel[n].length > 0;
  const levels: Array<1 | 2 | 3> = [3, 2, 1];
  const avail = levels.filter((lv) => has(lv));
  if (avail.length === 0) return null;
  if (!lastLevelSent || !levels.includes(lastLevelSent as any)) return avail[0]!;
  const idx = levels.indexOf(lastLevelSent as any);
  for (let i = 1; i <= levels.length; i += 1) {
    const cand = levels[(idx + i) % levels.length]!;
    if (has(cand)) return cand;
  }
  return avail[0]!;
}

async function runRoom(runtime: RuntimeConfig, state: WorkerState, roomId: string): Promise<void> {
  const rid = safeString(roomId);
  if (!rid) return;
  if (!isRoomAllowed(runtime, rid)) return;
  if (!isFeatureEnabledForRoom(runtime, rid)) return;

  const roomState: RoomState = (state.rooms && state.rooms[rid]) || {};
  const nowMs = Date.now();
  const lastRunAt = Number(roomState.lastRunAtMs || 0);
  const perRoomMinSendMs = computePerRoomMinSendIntervalMs(runtime);
  const lastSendAt = Number(roomState.lastSendAtMs || 0);

  const { active, loaded, roomName } = await fetchCounts(rid);
  const rn = roomName || "알 수 없는 방";
  await appendRoomLog(rid, { type: "scan", roomName: rn, activeMembersCount: active, loadedMembersCount: loaded });

  if (active == null || !Number.isFinite(active) || active <= 0) {
    await sendOpsLog(runtime, formatOps("기본 닉네임 안내(멘션) 스킵", [`방: ${rn}`, "사유: 방 인원 수를 가져올 수 없어 멤버 완전성 확인이 불가합니다."]));
    await appendRoomLog(rid, { type: "skip", reason: "MISSING_ACTIVE_COUNT" });
    (state.rooms ||= {})[rid] = { ...(state.rooms?.[rid] || {}), lastRunAtMs: nowMs };
    return;
  }

  if (loaded < active) {
    await triggerMemberLoad(rid, rn, runtime, `멤버 목록이 아직 완전히 로딩되지 않음(현재 ${loaded}/${active})`);
    (state.rooms ||= {})[rid] = { ...(state.rooms?.[rid] || {}), lastRunAtMs: nowMs, lastMemberLoadAtMs: nowMs };
    await appendRoomLog(rid, { type: "member_load_triggered", loadedMembersCount: loaded, activeMembersCount: active });
    const waitMs = computeMemberLoadWaitMs(runtime);
    if (waitMs > 0) {
      const deadline = Date.now() + waitMs;
      while (Date.now() < deadline) {
        await sleep(15_000);
        const c2 = await fetchCounts(rid);
        if (c2.active != null && c2.loaded >= c2.active) break;
      }
    }
  }

  const counts2 = await fetchCounts(rid);
  const active2 = counts2.active;
  const loaded2 = counts2.loaded;
  if (active2 == null || loaded2 < active2) {
    await sendOpsLog(
      runtime,
      formatOps("기본 닉네임 안내(멘션) 스킵", [
        `방: ${rn}`,
        `사유: 멤버 목록이 아직 완전히 로딩되지 않았어요(현재 ${loaded2}/${active2 ?? "N/A"})`,
        "참고: 방 카드의 '운영진/멤버 갱신'을 누르면 Redroid에서 스크롤 로딩이 시작됩니다.",
      ]),
    );
    await appendRoomLog(rid, { type: "skip", reason: "MEMBERS_INCOMPLETE", loadedMembersCount: loaded2, activeMembersCount: active2 });
    (state.rooms ||= {})[rid] = { ...(state.rooms?.[rid] || {}), lastRunAtMs: nowMs };
    return;
  }

  if (!isTalkApiEnabled(runtime)) {
    await sendOpsLog(
      runtime,
      formatOps("기본 닉네임 안내(멘션) 스킵", [
        `방: ${rn}`,
        "사유: Talk-API가 꺼져 있어 멘션 안내를 보낼 수 없습니다(설정에서 Talk-API를 켜주세요).",
      ]),
    );
    await appendRoomLog(rid, { type: "skip", reason: "TALKAPI_DISABLED" });
    (state.rooms ||= {})[rid] = { ...(state.rooms?.[rid] || {}), lastRunAtMs: nowMs };
    return;
  }

  // room-level anti-spam
  if (perRoomMinSendMs > 0 && lastSendAt && nowMs - lastSendAt < perRoomMinSendMs) {
    (state.rooms ||= {})[rid] = { ...(state.rooms?.[rid] || {}), lastRunAtMs: nowMs };
    await appendRoomLog(rid, { type: "skip", reason: "ROOM_SEND_COOLDOWN", remainSec: Math.ceil((perRoomMinSendMs - (nowMs - lastSendAt)) / 1000) });
    return;
  }

  // member list (완전성 확인 후)
  const members = await fetchMembers(rid);
  const regexes = resolveKakaoDefaultNicknameRegexesFromRuntime(runtime);
  const maxMentionsPerMessage = computeMaxMentionsPerMessage(runtime);
  const delayMs = computeBetweenMessagesDelayMs(runtime);

  const users = roomState.users && typeof roomState.users === "object" ? roomState.users : {};
  const nextUsers: Record<string, UserWarnState> = { ...users };
  const defaultNow = new Set<string>();

  for (const m of members) {
    const uid = safeString(m.userId);
    const nick = normalizeNameForMention(m.nickname);
    if (!uid) continue;
    const isDefault = isKakaoDefaultNickname(nick, regexes);
    if (isDefault) {
      defaultNow.add(uid);
      const prev: UserWarnState = nextUsers[uid] || {};
      const warningCount = Number(prev.warningCount || 0);
      nextUsers[uid] = {
        ...prev,
        nickname: nick,
        firstSeenAtMs: Number(prev.firstSeenAtMs || 0) || nowMs,
        lastSeenAtMs: nowMs,
        warningCount: Number.isFinite(warningCount) ? Math.max(0, Math.min(3, Math.floor(warningCount))) : 0,
        resolvedAtMs: undefined,
      };
    } else {
      const prev = nextUsers[uid];
      if (prev && typeof prev === "object" && (Number(prev.warningCount || 0) > 0 || prev.firstSeenAtMs)) {
        nextUsers[uid] = { ...prev, nickname: nick, lastSeenAtMs: nowMs, resolvedAtMs: nowMs };
      }
    }
  }

  const dueByLevel: Record<number, Array<{ userId: string; name: string; baseAtMs: number }>> = { 1: [], 2: [], 3: [] };
  const firstDelayMs = scheduleAfterFirstSeenMs(runtime);
  const delay2 = scheduleAfterLastWarnMsForLevel(runtime, 2);
  const delay3 = scheduleAfterLastWarnMsForLevel(runtime, 3);

  for (const [uid, u] of Object.entries(nextUsers)) {
    if (!defaultNow.has(uid)) continue;
    const wc = Number(u.warningCount || 0);
    const count = Number.isFinite(wc) ? Math.max(0, Math.min(3, Math.floor(wc))) : 0;
    if (count >= 3) continue;
    const name = normalizeNameForMention(safeString(u.nickname));
    if (!name) continue;

    if (count === 0) {
      const baseAt = Number(u.firstSeenAtMs || 0) || nowMs;
      if (nowMs - baseAt >= firstDelayMs) dueByLevel[1].push({ userId: uid, name, baseAtMs: baseAt });
    } else if (count === 1) {
      const baseAt = Number(u.lastWarnAtMs || 0);
      if (baseAt && nowMs - baseAt >= delay2) dueByLevel[2].push({ userId: uid, name, baseAtMs: baseAt });
    } else if (count === 2) {
      const baseAt = Number(u.lastWarnAtMs || 0);
      if (baseAt && nowMs - baseAt >= delay3) dueByLevel[3].push({ userId: uid, name, baseAtMs: baseAt });
    }
  }

  // sort oldest-first for fairness
  for (const lv of [1, 2, 3] as const) {
    dueByLevel[lv].sort((a, b) => a.baseAtMs - b.baseAtMs);
  }

  const chosen = chooseLevelToSend(dueByLevel, roomState.lastLevelSent);
  if (!chosen) {
    (state.rooms ||= {})[rid] = { ...roomState, lastRunAtMs: nowMs, users: nextUsers };
    await appendRoomLog(rid, { type: "noop", roomName: rn });
    return;
  }

  const due = dueByLevel[chosen].slice(0, maxMentionsPerMessage);
  const mentionees = due.map((it) => ({ name: it.name, userId: it.userId }));
  const mentionLine = due.map((it) => `@${it.name}`).join(" ");
  const body = messageTextForLevel(runtime, chosen);
  const msg = `${mentionLine}\n${body}`.trim();

  const ok = await tryServerTalkApiDispatch(logger, rid, msg, mentionees, 12000);
  if (!ok) {
    await sendOpsLog(runtime, formatOps("기본 닉네임 안내(멘션) 실패", [`방: ${rn}`, "사유: 멘션 발신이 실패했습니다(Talk-API 상태/허용방/SAFE_MODE를 확인)."]));
    await appendRoomLog(rid, {
      type: "send_failed",
      level: chosen,
      targets: due.length,
      targetUserIds: due.map((x) => x.userId),
    });
    (state.rooms ||= {})[rid] = { ...roomState, lastRunAtMs: nowMs, users: nextUsers };
    return;
  }

  const escalated: string[] = [];
  const escalatedUserIds: string[] = [];
  for (const it of due) {
    const prev = nextUsers[it.userId] || {};
    const wc = Number(prev.warningCount || 0);
    const nextCount = Math.max(0, Math.min(3, Math.floor(wc) + 1));
    nextUsers[it.userId] = { ...prev, warningCount: nextCount, lastWarnAtMs: nowMs, lastSeenAtMs: nowMs, nickname: it.name };
    if (nextCount >= 3) {
      escalated.push(it.name);
      escalatedUserIds.push(it.userId);
    }
  }

  if (escalated.length > 0) {
    await sendOpsLog(
      runtime,
      formatOps("기본 닉네임 3차 안내 완료(수동 강퇴 후보)", [
        `방: ${rn}`,
        `대상: ${escalated.length}명`,
        ...escalated.slice(0, 30).map((n) => `- ${n}`),
        escalated.length > 30 ? `...(외 ${escalated.length - 30}명)` : null,
      ]),
    );
  }

  if (delayMs > 0) await sleep(delayMs);

  (state.rooms ||= {})[rid] = {
    ...roomState,
    lastRunAtMs: nowMs,
    lastSendAtMs: nowMs,
    lastLevelSent: chosen,
    users: nextUsers,
  };

  await appendRoomLog(rid, {
    type: "send_ok",
    level: chosen,
    targets: due.length,
    targetUserIds: due.map((x) => x.userId),
    escalated: escalated.length,
    escalatedUserIds,
  });
  logger.info("[nickname-reminder] sent", { roomId: rid, roomName: rn, level: chosen, targets: due.length, escalated: escalated.length });
}

async function main(): Promise<void> {
  await acquireLock();

  let state = await readJsonSafe<WorkerState>(STATE_PATH);
  if (!state || typeof state !== "object") state = {};
  if (!state.rooms || typeof state.rooms !== "object") state.rooms = {};

  let lastRuntimeAt = 0;
  let runtime: RuntimeConfig = {};
  let nextCycleAt = 0;

  const shutdown = async () => {
    try {
      if (opsTimer) {
        clearTimeout(opsTimer);
        opsTimer = null;
      }
      await flushOpsLogs();
    } catch {}
    try {
      await writeJsonAtomic(STATE_PATH, pruneState(state, Date.now()));
    } catch {}
    await releaseLock();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  while (true) {
    const nowMs = Date.now();
    try {
      if (!lastRuntimeAt || nowMs - lastRuntimeAt > 1500) {
        runtime = await loadRuntime();
        lastRuntimeAt = nowMs;
      }

      const conf = runtime.nicknameReminder || {};
      const globallyEnabled = conf.enabled !== false; // default on(방별 토글이 없으면 동작하지 않음)

      if (!globallyEnabled || isSafeModeOn(runtime)) {
        await writeStatus({ ok: true, disabled: true, reason: globallyEnabled ? "SAFE_MODE" : "DISABLED", nextCycleAt: null });
        await sleep(1500);
        continue;
      }

      const tickMs = computeTickMs(runtime);
      if (!nextCycleAt || nowMs >= nextCycleAt) {
        const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
        const roomIds = Object.keys(feats);
        let enabledRooms = 0;
        for (const rid of roomIds) {
          if (!isFeatureEnabledForRoom(runtime, rid)) continue;
          enabledRooms += 1;
          try {
            await runRoom(runtime, state, rid);
          } catch (e) {
            logger.warn("[nickname-reminder] room run error", { roomId: rid, err: String(e) });
          }
        }

        state = pruneState(state, Date.now());
        await writeJsonAtomic(STATE_PATH, state);

        nextCycleAt = Date.now() + tickMs;
        await writeStatus({
          ok: true,
          enabledRooms,
          nextCycleAt,
          tickMs,
          perRoomMinSendIntervalMs: computePerRoomMinSendIntervalMs(runtime),
        });
      } else {
        await writeStatus({
          ok: true,
          nextCycleAt,
          tickMs: computeTickMs(runtime),
          perRoomMinSendIntervalMs: computePerRoomMinSendIntervalMs(runtime),
        });
      }
    } catch (e) {
      logger.warn("[nickname-reminder] loop error", { err: String(e) });
      await writeStatus({ ok: false, error: String(e), nextCycleAt });
      await sleep(2000);
    }

    // keep loop responsive but not busy
    await sleep(Math.min(2000, STREAM_TTL_MS));
  }
}

void main().catch((e) => {
  logger.error("[nickname-reminder] fatal", { err: String(e) });
  void writeStatus({ ok: false, error: String(e) }).finally(() => process.exit(1));
});
