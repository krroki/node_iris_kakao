import { Logger } from "@tsuki-chat/node-iris";
import { randomInt } from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { resolveWelcomeTemplateSelection } from "../utils/welcomeTemplatePolicy";
import { tryServerTalkApiDispatch, tryServerTalkApiDispatchRaw } from "../utils/talkapi";
import { tryServerIrisReplyMedia, tryServerIrisReplyText } from "../utils/iris";
import { APP_ROOT } from "../utils/paths";
import { resolveTemplateImageUrls } from "../utils/sender";
import { stripAtMentionsForFallback } from "../utils/mentions";
import DedupCache from "../services/dedupCache";

type WelcomeEntrant = { name: string; senderId: string; joinedAt: number };

type StreamEntry = {
  ts?: string;
  roomId?: string;
  roomName?: string;
  sender?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
  mid?: string;
  uid?: string | null;
  payloadType?: string;
  messageType?: unknown;
  entrants?: unknown;
};

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
  welcome?: Record<string, unknown> | undefined;
};

type PendingFollowUp = {
  roomId: string;
  userId: string;
  userName: string;
  joinedAt: number;
  welcomeSentAt: number;
  expiresAt: number;
};

type WorkerState = {
  lastSeenMs: number;
  pending: PendingFollowUp[];
  updatedAt: string;
};

const logger = new Logger("welcome-worker");

const STATE_PATH = path.join(APP_ROOT, "data", "welcome_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "welcome_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "welcome_worker.lock");

const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분
const PHOTO_DEDUP = new DedupCache(10 * 60 * 1000); // 10분
// join 이벤트 중복 방지:
// - 일부 방에서는 member_joined(payloadType) 이벤트가 누락되고, feedType=4가 "message(messageType=0)"로만 들어오는 경우가 있다.
// - 반대로 둘 다 들어오는 경우도 있으므로, roomId+messageId 기반으로 1회만 처리한다.
const JOIN_DEDUP = new DedupCache(10 * 60 * 1000); // 10분
const SKIP_LOG_DEDUP = new DedupCache(60 * 1000); // 1분

// roomId -> join batch
type JoinBatch = {
  roomId: string;
  roomName: string;
  entrants: WelcomeEntrant[];
  timer: NodeJS.Timeout;
  createdAt: number;
  delayMs: number;
};
const joinBatches = new Map<string, JoinBatch>();

// roomId:userId -> pending follow-up
const pendingByUser = new Map<string, PendingFollowUp>();

// roomId -> linkId cache (reply attachment requires src_linkId)
const linkIdByRoom = new Map<string, { linkId: string; at: number }>();
const LINK_ID_CACHE_MS = 30 * 60 * 1000;

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
const RUNTIME_CACHE_MS = 1500;
const STREAM_TTL_MS = Number.parseInt(String(process.env.WELCOME_WORKER_STREAM_TTL_MS || "").trim(), 10) || 60_000;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function isPidAlive(pidRaw: unknown): boolean {
  const pid = Number(pidRaw);
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function acquireSingletonLock(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
    await fs.writeFile(LOCK_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
    return;
  } catch (e: any) {
    const code = String(e?.code || "");
    if (code !== "EEXIST") {
      logger.warn("[lock] lock 파일 생성 실패 (중복 실행 방지 비활성화)", { lockPath: LOCK_PATH, err: String(e) });
      return;
    }

    let oldPid: number | null = null;
    try {
      const raw = await fs.readFile(LOCK_PATH, "utf8");
      const n = Number.parseInt(String(raw || "").trim(), 10);
      oldPid = Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      oldPid = null;
    }

    if (oldPid && isPidAlive(oldPid)) {
      logger.warn("[lock] 다른 welcome-worker가 이미 실행 중이므로 종료합니다.", { pid: oldPid, lockPath: LOCK_PATH });
      process.exit(0);
    }

    // stale lock: remove and retry once
    try {
      await fs.unlink(LOCK_PATH);
    } catch {}
    try {
      await fs.writeFile(LOCK_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
      logger.warn("[lock] stale lock 정리 후 재획득", { stalePid: oldPid, lockPath: LOCK_PATH });
    } catch (e2) {
      logger.warn("[lock] lock 재획득 실패로 종료합니다.", { lockPath: LOCK_PATH, err: String(e2) });
      process.exit(1);
    }
  }
}

function logSkipOnce(roomId: string, reason: string, extra?: Record<string, unknown>): void {
  const key = `${roomId}:${reason}`;
  if (SKIP_LOG_DEDUP.isDuplicate(key)) return;
  logger.warn("[welcome] 스킵", { roomId, reason, ...(extra || {}) });
}

function resolveWorkerImageUrls(images: string[]): string[] {
  const kinds: Array<"abs" | "rel"> = [];
  const abs: string[] = [];
  const rel: string[] = [];
  for (const img of images || []) {
    const s = safeString(img);
    if (!s) continue;
    if (s.startsWith("http://") || s.startsWith("https://")) {
      abs.push(s);
      kinds.push("abs");
    } else {
      rel.push(s);
      kinds.push("rel");
    }
  }
  const resolvedRel = resolveTemplateImageUrls(rel);
  const out: string[] = [];
  let ai = 0;
  let ri = 0;
  for (const k of kinds) {
    out.push(k === "abs" ? abs[ai++]! : resolvedRel[ri++]!);
  }
  return out;
}

async function downloadUrlAsBase64(url: string, timeoutMs: number): Promise<string> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  const res = await fetch(url, { method: "GET", signal: ctrl.signal });
  clearTimeout(t);
  if (!res.ok) {
    throw new Error(`image_download_failed: HTTP ${res.status}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString("base64");
}

function tsToMs(ts: string | undefined): number {
  const t = String(ts || "").trim();
  if (!t) return 0;
  try {
    const dt = new Date(t);
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

async function loadRuntime(): Promise<RuntimeConfig> {
  const now = Date.now();
  if (runtimeCache && now - runtimeCache.at < RUNTIME_CACHE_MS) {
    return runtimeCache.data;
  }
  try {
    const raw = await fs.readFile(RUNTIME_PATH, "utf8");
    const parsed = JSON.parse(raw) as RuntimeConfig;
    runtimeCache = { at: now, data: parsed && typeof parsed === "object" ? parsed : {} };
    return runtimeCache.data;
  } catch (e) {
    runtimeCache = { at: now, data: {} };
    logger.warn("[runtime] load failed; treat as empty", { err: String(e) });
    return {};
  }
}

function isRoomAllowed(runtime: RuntimeConfig, roomId: string): boolean {
  const list = Array.isArray(runtime.allowedRoomIds)
    ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (list.length === 0) return false;
  return list.includes(String(roomId));
}

function isSafeModeOn(runtime: RuntimeConfig): boolean {
  // SAFE_MODE 기본값은 true(발신 차단)이며, 명시적으로 false일 때만 발신을 허용한다.
  // server/load_runtime().get('safeMode', True) 와 동일한 의미로 맞춘다.
  return runtime.safeMode !== false;
}

function isFeatureEnabled(runtime: RuntimeConfig, roomId: string, feature: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[String(roomId)];
  if (!flags || typeof flags !== "object") return false;
  const v = (flags as any)[feature];
  // 기본값 false: 명시적으로 true인 방만
  return v === true;
}

function isWelcomeFollowUpEnabledForRoom(runtime: RuntimeConfig, roomId: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[String(roomId)];
  if (flags && typeof flags === "object" && (flags as any).welcomeFollowUp === false) {
    return false;
  }
  return true;
}

function getWelcomeDelayRange(runtime: RuntimeConfig): { minMs: number; maxMs: number } {
  const w = runtime.welcome && typeof runtime.welcome === "object" ? runtime.welcome : {};
  const minRaw = (w as any).sendDelayMinMs;
  const maxRaw = (w as any).sendDelayMaxMs;

  const minMs = typeof minRaw === "number" && Number.isFinite(minRaw) ? Math.max(0, Math.floor(minRaw)) : 3000;
  const maxMs = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.floor(maxRaw)) : 5000;
  return { minMs, maxMs: Math.max(minMs, maxMs) };
}

type FollowUpConfig = {
  enabled: boolean;
  windowMs: number;
  maxPendingPerRoom: number;
  replies: string[];
};

function parseFollowUpConfig(runtime: RuntimeConfig): { ok: true; cfg: FollowUpConfig } | { ok: false; error: string } {
  const w = runtime.welcome && typeof runtime.welcome === "object" ? runtime.welcome : null;
  const fu = w && typeof w === "object" ? (w as any).followUp : null;
  if (!fu || typeof fu !== "object") return { ok: false, error: "welcome.followUp missing" };

  const enabled = (fu as any).enabled;
  if (typeof enabled !== "boolean") return { ok: false, error: "welcome.followUp.enabled must be boolean" };

  const windowMsRaw = (fu as any).windowMs;
  const maxRaw = (fu as any).maxPendingPerRoom;
  const repliesRaw = (fu as any).replies;

  const windowMs = typeof windowMsRaw === "number" && Number.isFinite(windowMsRaw) ? Math.max(0, Math.floor(windowMsRaw)) : 0;
  const maxPendingPerRoom = typeof maxRaw === "number" && Number.isFinite(maxRaw) ? Math.max(0, Math.floor(maxRaw)) : 0;
  const replies = Array.isArray(repliesRaw) ? repliesRaw.map((x) => safeString(x)).filter(Boolean) : [];

  if (enabled && windowMs <= 0) return { ok: false, error: "welcome.followUp.windowMs must be > 0" };
  if (enabled && maxPendingPerRoom <= 0) return { ok: false, error: "welcome.followUp.maxPendingPerRoom must be > 0" };
  if (enabled && replies.length === 0) return { ok: false, error: "welcome.followUp.replies must be non-empty" };

  return { ok: true, cfg: { enabled, windowMs, maxPendingPerRoom, replies } };
}

function normalizeKakaoMessageType(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 16384) return n - 16384;
  return n;
}

function pickRandom(replies: string[]): string {
  const list = Array.isArray(replies) ? replies.map((s) => safeString(s)).filter(Boolean) : [];
  if (list.length === 0) return "";
  if (list.length === 1) return list[0]!;
  const idx = randomInt(0, list.length);
  return list[idx]!;
}

async function loadState(): Promise<WorkerState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkerState>;
    const lastSeenMs = typeof parsed.lastSeenMs === "number" && Number.isFinite(parsed.lastSeenMs) ? parsed.lastSeenMs : 0;
    const pending = Array.isArray(parsed.pending) ? (parsed.pending as PendingFollowUp[]) : [];
    const updatedAt = typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString();
    return { lastSeenMs, pending, updatedAt };
  } catch {
    return { lastSeenMs: 0, pending: [], updatedAt: new Date().toISOString() };
  }
}

async function saveState(state: WorkerState): Promise<void> {
  await writeJsonAtomic(STATE_PATH, state);
}

async function updateStatus(partial: Record<string, unknown>): Promise<void> {
  try {
    const cur = await readJsonSafe(STATUS_PATH);
    const next = { ...cur, ...partial, pid: process.pid, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(STATUS_PATH, next);
  } catch (e) {
    logger.warn("[status] update failed", { err: String(e) });
  }
}

async function readJsonSafe(p: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(p, "utf8");
    const obj = JSON.parse(raw || "{}");
    return obj && typeof obj === "object" ? (obj as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

async function writeJsonAtomic(dst: string, data: unknown): Promise<void> {
  const dir = path.dirname(dst);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");

  const bak = `${dst}.bak`;
  try {
    await fs.unlink(bak);
  } catch (e: any) {
    if (e && String(e.code || "") !== "ENOENT") throw e;
  }
  try {
    await fs.rename(dst, bak);
  } catch (e: any) {
    if (e && String(e.code || "") !== "ENOENT") throw e;
  }
  try {
    await fs.rename(tmp, dst);
  } finally {
    try {
      await fs.unlink(tmp);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") {
        logger.warn("[fs] cleanup tmp failed", { dst, err: String(e) });
      }
    }
  }
}

async function loadWelcomeTemplate(name: string): Promise<{ text: string; images: string[] }> {
  if (!name) throw new Error("welcome template name is empty");
  const p = path.join(APP_ROOT, "config", "templates", "welcome", `${name}.json`);
  const raw = await fs.readFile(p, "utf8");
  const parsed: any = JSON.parse(raw);

  const text =
    typeof parsed?.messages?.text === "string"
      ? parsed.messages.text
      : typeof parsed?.content === "string"
        ? parsed.content
        : typeof parsed?.text === "string"
          ? parsed.text
          : "";
  if (!text || !String(text).trim()) {
    throw new Error(`welcome template has empty text: ${p}`);
  }

  const images: string[] = [];
  if (typeof parsed?.messages?.image === "string" && parsed.messages.image.trim()) {
    images.push(parsed.messages.image.trim());
  }
  if (Array.isArray(parsed?.images)) {
    for (const img of parsed.images) {
      if (typeof img === "string" && img.trim()) images.push(img.trim());
    }
  }

  return { text: String(text), images: Array.from(new Set(images)) };
}

function buildVars(entrants: WelcomeEntrant[], roomName: string): Record<string, string> {
  const now = new Date();
  const names = entrants.map((e) => safeString(e?.name) || "Guest");
  const vars: Record<string, string> = {
    userName: names[0] || "Guest",
    roomName: roomName || "this room",
    time: now.toLocaleTimeString("ko-KR"),
    date: now.toLocaleDateString("ko-KR"),
    entrant: names[0] || "Guest",
    entrance: names[0] || "Guest",
    entranceCount: String(names.length),
    entranceList: names.join(", "),
    entrantList: names.join(", "),
  };
  for (let i = 0; i < names.length; i += 1) {
    const idx = i + 1;
    vars[`entrance${idx}`] = names[i]!;
    vars[`entrant${idx}`] = names[i]!;
  }
  return vars;
}

function renderWelcomeText(templateText: string, entrants: WelcomeEntrant[], roomName: string): { text: string; hasMention: boolean } {
  const vars = buildVars(entrants, roomName);
  let out = safeString(templateText || "");

  // Multi-entrant: replace @-placeholders for entrance/entrant/userName to mention all entrants.
  if (entrants.length > 1) {
    const names = entrants.map((e) => safeString(e?.name) || "Guest");
    const mentionPlain = names.map((n) => `@${n}`).join(", ");
    const mentionWithNim = `${mentionPlain} 님`;
    out = out.replace(/@\{(?:entrant|entrance|userName)\}님/g, mentionWithNim);
    out = out.replace(/@\{(?:entrant|entrance|userName)\}/g, mentionPlain);
  }

  let hasMention = false;
  const isOptionalIndexed = (key: string) => /^(entrance|entrant)\d+$/.test(key);

  out = out.replace(/@\{([^}]+)\}/g, (_m, k) => {
    const key = safeString(k);
    const aliases = key === "entrant" || key === "entrance" ? [key, "userName"] : [key];
    for (const a of aliases) {
      if (vars[a]) {
        hasMention = true;
        return "@" + vars[a];
      }
    }
    if (isOptionalIndexed(key)) return "";
    return "@{" + key + "}";
  });

  out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, k) => {
    const key = safeString(k);
    if (vars[key] != null) return String(vars[key]);
    if (isOptionalIndexed(key)) return "";
    return "{{" + key + "}}";
  });
  out = out.replace(/\{([^}]+)\}/g, (_m, k) => {
    const key = safeString(k);
    if (vars[key] != null) return String(vars[key]);
    if (isOptionalIndexed(key)) return "";
    return "{" + key + "}";
  });

  // Mention list inserted as plain @name tokens should still be treated as "hasMention"
  if (!hasMention && entrants.some((e) => out.includes("@" + safeString(e?.name)))) {
    hasMention = true;
  }
  return { text: out, hasMention };
}

function normalizeEntrantsFromEntry(e: StreamEntry): WelcomeEntrant[] {
  const list: WelcomeEntrant[] = [];
  if (Array.isArray(e.entrants)) {
    for (const it of e.entrants) {
      if (!it || typeof it !== "object") continue;
      const name = safeString((it as any).name) || "Guest";
      const senderId = safeString((it as any).senderId);
      const joinedAtRaw = Number((it as any).joinedAt);
      const joinedAt = Number.isFinite(joinedAtRaw) && joinedAtRaw > 0 ? Math.floor(joinedAtRaw) : Date.now();
      list.push({ name, senderId, joinedAt });
    }
  }
  if (list.length > 0) {
    // senderId가 없는 항목은 제거(멘션/트래킹 불가)
    return list.filter((x) => x.senderId);
  }
  const senderId = safeString(e.senderId);
  const name = safeString(e.senderName || e.sender) || "Guest";
  return senderId ? [{ name, senderId, joinedAt: Date.now() }] : [];
}

function buildJoinDedupKey(roomId: string, entryMid: string, entrants: WelcomeEntrant[], tsMs: number): string {
  const rid = safeString(roomId);
  const mid = safeString(entryMid);
  if (rid && mid) return `join:${rid}:${mid}`;

  const ids = (entrants || [])
    .map((e) => safeString(e?.senderId))
    .filter(Boolean)
    .sort()
    .join(",");
  const bucket = tsMs > 0 ? Math.floor(tsMs / 1000) : Math.floor(Date.now() / 1000);
  return `join:${rid}:${ids || "unknown"}:${bucket}`;
}

function parseJoinFeedEntrantsFromMessageText(text: string, joinedAtMs: number): WelcomeEntrant[] {
  const raw = safeString(text);
  if (!raw || !raw.trim().startsWith("{")) return [];
  let parsed: any = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const ft = Number(parsed?.feedType);
  if (!Number.isFinite(ft) || ft !== 4) return [];

  const members = Array.isArray(parsed?.members)
    ? parsed.members
    : parsed?.member && typeof parsed.member === "object"
      ? [parsed.member]
      : [];
  if (!members.length) return [];

  const out: WelcomeEntrant[] = [];
  for (const m of members) {
    if (!m || typeof m !== "object") continue;
    const senderId = safeString((m as any).userId);
    const name = safeString((m as any).nickName) || "Guest";
    if (!senderId) continue;
    out.push({ name, senderId, joinedAt: joinedAtMs > 0 ? joinedAtMs : Date.now() });
  }
  return out;
}

function countPendingByRoom(roomId: string): number {
  let n = 0;
  for (const it of pendingByUser.values()) {
    if (it.roomId === roomId) n += 1;
  }
  return n;
}

async function resolveOpenLinkIdForRoom(roomId: string): Promise<string | null> {
  const now = Date.now();
  const cached = linkIdByRoom.get(roomId);
  if (cached && now - cached.at < LINK_ID_CACHE_MS) {
    return cached.linkId;
  }

  const base = safeString(process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
  const url = `${base}/query`;
  const body = {
    query: "select link_id from chat_rooms where id=?",
    bind: [roomId],
  };

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);

    const j: any = await res.json().catch(() => null);
    const linkId = safeString(j?.data?.[0]?.link_id ?? j?.data?.[0]?.linkId ?? "");
    if (!linkId) {
      logger.warn("[followup] resolveOpenLinkIdForRoom: empty link_id", { roomId, httpStatus: res?.status });
      return null;
    }

    linkIdByRoom.set(roomId, { linkId, at: now });
    return linkId;
  } catch (e) {
    logger.warn("[followup] resolveOpenLinkIdForRoom failed", { roomId, err: String(e) });
    return null;
  }
}

async function enqueueWelcome(roomId: string, roomName: string, entrants: WelcomeEntrant[]): Promise<void> {
  if (entrants.length === 0) return;

  const runtime = await loadRuntime();
  if (!isRoomAllowed(runtime, roomId)) {
    logSkipOnce(roomId, "ROOM_NOT_ALLOWED");
    return;
  }
  if (!isFeatureEnabled(runtime, roomId, "welcome")) {
    logSkipOnce(roomId, "WELCOME_DISABLED");
    return;
  }

  // 너무 오래된 join 이벤트는 복구/재연결 시 스팸이 될 수 있으므로 스킵한다.
  const now = Date.now();
  const maxAgeMs = 120_000;
  const newestJoined = Math.max(...entrants.map((x) => x.joinedAt || 0));
  if (newestJoined && now - newestJoined > maxAgeMs) {
    logger.warn("[welcome] skip stale join", { roomId, ageSec: Math.floor((now - newestJoined) / 1000) });
    return;
  }

  // 기존 batch가 있으면 합친다.
  const existing = joinBatches.get(roomId);
  if (existing) {
    existing.entrants.push(...entrants);
    return;
  }

  const { minMs, maxMs } = getWelcomeDelayRange(runtime);
  const jitter = Math.max(0, maxMs - minMs);
  const extraDelayMs = jitter > 0 ? randomInt(0, jitter + 1) : 0;
  const delayMs = minMs + extraDelayMs;

  const timer = setTimeout(() => {
    void flushWelcome(roomId).catch(() => {});
  }, delayMs);
  try {
    const t: any = timer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {
    // ignore
  }

  joinBatches.set(roomId, {
    roomId,
    roomName,
    entrants: [...entrants],
    timer,
    createdAt: Date.now(),
    delayMs,
  });
}

function uniqEntrants(entrants: WelcomeEntrant[]): WelcomeEntrant[] {
  const seen = new Set<string>();
  const out: WelcomeEntrant[] = [];
  for (const e of entrants) {
    const id = safeString(e?.senderId);
    const nm = safeString(e?.name) || "Guest";
    if (!id) continue;
    const k = `${id}:${nm}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ name: nm, senderId: id, joinedAt: Number(e?.joinedAt || 0) || Date.now() });
  }
  out.sort((a, b) => a.joinedAt - b.joinedAt);
  return out;
}

function compileDefaultNickRegexes(runtime: RuntimeConfig): RegExp[] | null {
  const w = runtime.welcome && typeof runtime.welcome === "object" ? runtime.welcome : null;
  const sets = w && typeof w === "object" ? (w as any).templateSets : null;
  if (!sets || typeof sets !== "object") return null; // set-mode가 아니면 필요 없음

  const raw = (w as any).kakaoDefaultNicknameRegexes;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const list = raw.map((x: any) => String(x || "").trim()).filter(Boolean);
  if (list.length === 0) return null;
  try {
    return list.map((s) => new RegExp(s, "u"));
  } catch (e) {
    logger.warn("[welcome] invalid kakaoDefaultNicknameRegexes; fallback to first entrant for template selection", { err: String(e) });
    return null;
  }
}

function isKakaoDefaultNickname(nameRaw: string, regexes: RegExp[] | null): boolean | null {
  if (!regexes) return null;
  const name = String(nameRaw || "").trim();
  if (!name) return true;
  return regexes.some((re) => re.test(name));
}

function pickTemplateSelectionHint(entrants: WelcomeEntrant[], runtime: RuntimeConfig): WelcomeEntrant {
  // 요구(ADR-0022): 기본닉/커스텀닉이 섞여도 welcome은 1회로 통합하되,
  // 템플릿 선택은 가능하면 커스텀닉 기준으로 수행해 "기본닉 변경 유도" 문구가 커스텀 사용자에게 섞이지 않게 한다.
  if (entrants.length <= 1) return entrants[0]!;

  const regexes = compileDefaultNickRegexes(runtime);
  for (const e of entrants) {
    const klass = isKakaoDefaultNickname(safeString(e?.name), regexes);
    if (klass === false) return e; // custom nickname
  }
  return entrants[0]!;
}

async function flushWelcome(roomId: string): Promise<void> {
  const batch = joinBatches.get(roomId);
  if (!batch) return;
  joinBatches.delete(roomId);
  try {
    clearTimeout(batch.timer);
  } catch {}

  const entrants = uniqEntrants(batch.entrants);
  if (entrants.length === 0) return;

  const runtime = await loadRuntime();
  if (isSafeModeOn(runtime)) {
    logger.warn("[welcome] SAFE_MODE: skip send", { roomId, entrants: entrants.length });
    return;
  }
  if (!isRoomAllowed(runtime, roomId)) {
    logSkipOnce(roomId, "ROOM_NOT_ALLOWED");
    return;
  }
  if (!isFeatureEnabled(runtime, roomId, "welcome")) {
    logSkipOnce(roomId, "WELCOME_DISABLED");
    return;
  }

  let selection: Awaited<ReturnType<typeof resolveWelcomeTemplateSelection>> = null;
  try {
    const hint = pickTemplateSelectionHint(entrants, runtime);
    selection = await resolveWelcomeTemplateSelection({ userName: hint.name || "", senderId: hint.senderId });
  } catch (e) {
    logger.error("[welcome] template selection failed; skip", { roomId, err: String(e) });
    return;
  }
  if (!selection?.templateName) {
    logger.warn("[welcome] no template configured; skip", { roomId });
    return;
  }

  let tpl: { text: string; images: string[] };
  try {
    tpl = await loadWelcomeTemplate(selection.templateName);
  } catch (e) {
    logger.warn("[welcome] template load failed; skip", { roomId, template: selection.templateName, err: String(e) });
    return;
  }

  const { text: message, hasMention } = renderWelcomeText(tpl.text, entrants, batch.roomName);
  const mentionees = entrants
    .map((e) => ({ name: e.name, userId: e.senderId }))
    .filter((m) => m.userId && m.name && message.includes("@" + m.name));
  const capped = mentionees.length > 15 ? mentionees.slice(0, 15) : mentionees;
  const imageUrls = resolveWorkerImageUrls(tpl.images || []);

  if (imageUrls.length > 0) {
    // 템플릿 이미지는 Realtime API를 통해 IRIS /reply로 전송한다. (ADR-0030)
    logger.info("[welcome] template images detected", {
      roomId,
      images: imageUrls.length,
      template: selection.templateName,
    });
  }

  let okTalk = false;
  let okIris = false;
  try {
    if (hasMention && capped.length) {
      okTalk = await tryServerTalkApiDispatch(logger, roomId, message, capped, 12000);
    } else {
      okTalk = await tryServerTalkApiDispatch(logger, roomId, message, [], 12000);
    }
  } catch (e) {
    okTalk = false;
    logger.warn("[welcome] dispatch threw", { roomId, err: String(e) });
  }

  if (!okTalk) {
    // Talk-API가 불안정할 때 운영 연속성을 위해 IRIS /reply(text)로 대체 발신한다.
    // (멘션/Reply는 불가, 단순 텍스트만)
    const fallbackText = hasMention && capped.length ? stripAtMentionsForFallback(message, capped) : message;
    okIris = await tryServerIrisReplyText(logger, roomId, fallbackText, 12000);
  }

  const ok = okTalk || okIris;
  await updateStatus({
    lastWelcomeAttemptTs: new Date().toISOString(),
    lastWelcomeRoomId: roomId,
    lastWelcomeOk: ok,
    lastWelcomeTemplate: selection.templateName,
  });

  if (!ok) return;

  // Follow-up tracking starts after welcome text sent (ADR-0026 Decision A).
  const cfgRes = parseFollowUpConfig(runtime);
  if (!cfgRes.ok) return;
  const cfg = cfgRes.cfg;
  if (!cfg.enabled) return;
  if (!isWelcomeFollowUpEnabledForRoom(runtime, roomId)) return;

  const now = Date.now();
  const current = countPendingByRoom(roomId);
  let roomPending = current;
  for (const e of entrants) {
    if (roomPending >= cfg.maxPendingPerRoom) break;
    const userId = safeString(e.senderId);
    if (!userId) continue;
    const key = `${roomId}:${userId}`;
    const expiresAt = (Number(e.joinedAt || 0) || now) + cfg.windowMs;
    if (expiresAt <= now) continue;
    pendingByUser.set(key, {
      roomId,
      userId,
      userName: safeString(e.name) || "Guest",
      joinedAt: Number(e.joinedAt || 0) || now,
      welcomeSentAt: now,
      expiresAt,
    });
    roomPending += 1;
  }

  // Image send failure must not block follow-up tracking (aligned with legacy bot path).
  if (imageUrls.length > 0) {
    const limited = imageUrls.slice(0, 6);
    const imagesBase64: string[] = [];
    for (const url of limited) {
      try {
        imagesBase64.push(await downloadUrlAsBase64(url, 15000));
      } catch (e) {
        logger.warn("[welcome] image download failed", { roomId, url, err: String(e) });
      }
    }
    if (imagesBase64.length > 0) {
      const okImg = await tryServerIrisReplyMedia(logger, roomId, imagesBase64, 30000);
      if (!okImg) {
        logger.warn("[welcome] image send failed", { roomId, template: selection.templateName, count: imagesBase64.length });
      }
    } else {
      logger.warn("[welcome] no images downloaded; skip send", { roomId, template: selection.templateName, count: imageUrls.length });
    }
  }
}

async function handleFollowUpMessage(entry: StreamEntry): Promise<void> {
  const roomId = safeString(entry.roomId);
  const senderId = safeString(entry.senderId);
  if (!roomId || !senderId) return;

  const key = `${roomId}:${senderId}`;
  const pending = pendingByUser.get(key);
  if (!pending) return;

  const now = Date.now();
  if (now >= pending.expiresAt) {
    pendingByUser.delete(key);
    return;
  }

  const runtime = await loadRuntime();
  const cfgRes = parseFollowUpConfig(runtime);
  if (!cfgRes.ok) {
    pendingByUser.delete(key);
    return;
  }
  const cfg = cfgRes.cfg;
  if (!cfg.enabled) {
    pendingByUser.delete(key);
    return;
  }
  if (!isWelcomeFollowUpEnabledForRoom(runtime, roomId)) {
    pendingByUser.delete(key);
    return;
  }

  const normalizedType = normalizeKakaoMessageType(entry.messageType);
  const isImageType = normalizedType === 2 || normalizedType === 27 || normalizedType === 71;
  if (!isImageType) return;

  const photoLogId = safeString(entry.mid);
  if (!photoLogId) {
    pendingByUser.delete(key);
    return;
  }

  if (PHOTO_DEDUP.isDuplicate(`${roomId}:${photoLogId}`)) {
    return;
  }

  // Guardrails
  if (isSafeModeOn(runtime)) {
    pendingByUser.delete(key);
    return;
  }
  if (!isRoomAllowed(runtime, roomId)) {
    pendingByUser.delete(key);
    return;
  }

  const replyText = pickRandom(cfg.replies);
  if (!replyText) {
    pendingByUser.delete(key);
    return;
  }

  const srcLinkId = await resolveOpenLinkIdForRoom(roomId);
  if (!srcLinkId) {
    pendingByUser.delete(key);
    return;
  }

  const srcMessage = safeString(entry.text) || "사진";
  const replyAttachment: Record<string, unknown> = {
    src_logId: photoLogId,
    src_userId: senderId,
    src_linkId: srcLinkId,
    src_type: safeString(Math.floor(normalizedType || 0)),
    src_message: srcMessage,
  };

  let ok = false;
  try {
    ok = await tryServerTalkApiDispatchRaw(logger, roomId, replyText, 26, replyAttachment, 12000);
  } catch (e) {
    ok = false;
    logger.warn("[followup] dispatch_raw threw", { roomId, userId: senderId, err: String(e) });
  } finally {
    pendingByUser.delete(key);
  }

  await updateStatus({
    lastFollowUpAttemptTs: new Date().toISOString(),
    lastFollowUpRoomId: roomId,
    lastFollowUpOk: ok,
  });
}

async function processEntry(entry: StreamEntry, lastSeenMsRef: { v: number }): Promise<void> {
  const roomId = safeString(entry.roomId);
  if (!roomId) return;

  const tsMs = tsToMs(entry.ts);
  if (tsMs && tsMs > lastSeenMsRef.v) lastSeenMsRef.v = tsMs;

  const payloadType = safeString(entry.payloadType);
  const dedupKey = safeString(entry.uid) || `${roomId}:${payloadType}:${safeString(entry.senderId)}:${safeString(entry.mid)}:${safeString(entry.ts)}`;
  if (EVENT_DEDUP.isDuplicate(dedupKey)) return;

  if (payloadType === "member_joined") {
    const roomName = safeString(entry.roomName) || roomId;
    const entrants = normalizeEntrantsFromEntry(entry);
    if (entrants.length) {
      const joinKey = buildJoinDedupKey(roomId, safeString(entry.mid), entrants, tsMs);
      if (JOIN_DEDUP.isDuplicate(joinKey)) return;
      await enqueueWelcome(roomId, roomName, entrants);
    }
    return;
  }

  if (payloadType === "message") {
    // Fallback: 일부 방에서 join 이벤트가 NewMemberController로 전달되지 않아
    // member_joined 로그가 생성되지 않는 경우가 있다.
    // 이 때는 join(feedType=4) 메시지를 직접 파싱해 welcome을 트리거한다.
    const normalizedType = normalizeKakaoMessageType(entry.messageType);
    if (normalizedType === 0) {
      const entrants = parseJoinFeedEntrantsFromMessageText(safeString(entry.text), tsMs || Date.now());
      if (entrants.length) {
        const roomName = safeString(entry.roomName) || roomId;
        const joinKey = buildJoinDedupKey(roomId, safeString(entry.mid), entrants, tsMs);
        if (!JOIN_DEDUP.isDuplicate(joinKey)) {
          await enqueueWelcome(roomId, roomName, entrants);
        }
        return;
      }
    }
    await handleFollowUpMessage(entry);
    return;
  }
}

async function connectAndRun(): Promise<void> {
  const state = await loadState();
  // restore pending entries (within TTL)
  const now = Date.now();
  for (const p of state.pending || []) {
    if (!p || !p.roomId || !p.userId) continue;
    if (typeof p.expiresAt === "number" && p.expiresAt > now) {
      pendingByUser.set(`${p.roomId}:${p.userId}`, p);
    }
  }

  let lastSeenMs = state.lastSeenMs || 0;
  const lastSeenMsRef = { v: lastSeenMs };

  // status heartbeat
  const startedAt = new Date().toISOString();
  await updateStatus({ startedAt, heartbeatTs: startedAt, lastSeenMs: lastSeenMsRef.v });
  const hbTimer = setInterval(() => {
    void updateStatus({ heartbeatTs: new Date().toISOString(), lastSeenMs: lastSeenMsRef.v, pending: pendingByUser.size });
  }, 30_000);
  try {
    const t: any = hbTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  // periodic state save + cleanup
  const stateTimer = setInterval(() => {
    const now2 = Date.now();
    for (const [k, v] of pendingByUser.entries()) {
      if (now2 >= v.expiresAt) pendingByUser.delete(k);
    }
    const snapshot: WorkerState = {
      lastSeenMs: lastSeenMsRef.v,
      pending: Array.from(pendingByUser.values()),
      updatedAt: new Date().toISOString(),
    };
    void saveState(snapshot).catch((e) => logger.warn("[state] save failed", { err: String(e) }));
  }, 15_000);
  try {
    const t: any = stateTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  // reconnect loop
  while (true) {
    const runtime = await loadRuntime();
    const rooms = Array.isArray(runtime.allowedRoomIds)
      ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
      : [];

    if (rooms.length === 0) {
      logger.warn("[stream] allowedRoomIds empty; sleeping");
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
    const since = Math.max(0, Math.floor(lastSeenMsRef.v > 0 ? lastSeenMsRef.v - 1000 : 0));
    const url = `${base}/logs/stream?rooms=${encodeURIComponent(rooms.join(","))}&limit=200&since=${since}&interval=1000`;
    logger.info("[stream] connect", { url });

    const ttlMs = Math.max(10_000, STREAM_TTL_MS);
    const ctrl = new AbortController();
    let aborted = false;
    const ttlTimer = setTimeout(() => {
      aborted = true;
      try {
        ctrl.abort();
      } catch {}
    }, ttlMs);
    try {
      const t: any = ttlTimer as any;
      if (t && typeof t.unref === "function") t.unref();
    } catch {}

    try {
      const res = await fetch(url, { method: "GET", headers: { Accept: "text/event-stream" }, signal: ctrl.signal });
      if (!res.ok || !res.body) {
        logger.warn("[stream] non-OK", { httpStatus: res.status });
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const reader = (res.body as any).getReader();
      const decoder = new TextDecoder("utf-8");
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        while (true) {
          const sep = buf.indexOf("\n\n");
          if (sep < 0) break;
          const chunk = buf.slice(0, sep);
          buf = buf.slice(sep + 2);

          const lines = chunk.split(/\r?\n/);
          for (const ln of lines) {
            const line = ln.trimEnd();
            if (!line || line.startsWith(":")) continue;
            if (!line.startsWith("data:")) continue;
            const jsonText = line.slice(5).trim();
            if (!jsonText) continue;
            try {
              const payload = JSON.parse(jsonText) as any;
              const roomsObj = payload?.rooms;
              if (roomsObj && typeof roomsObj === "object") {
                for (const [rid, entries] of Object.entries(roomsObj as Record<string, unknown>)) {
                  if (!Array.isArray(entries)) continue;
                  for (const ent of entries as any[]) {
                    if (!ent || typeof ent !== "object") continue;
                    await processEntry({ ...(ent as any), roomId: rid }, lastSeenMsRef);
                  }
                }
              }
            } catch (e) {
              logger.warn("[stream] parse error", { err: String(e) });
            }
          }
        }
      }
    } catch (e) {
      if (aborted) {
        logger.info("[stream] reconnect tick (ttl)", { ttlMs });
      } else {
        logger.warn("[stream] connection error", { err: String(e) });
      }
    } finally {
      try {
        clearTimeout(ttlTimer);
      } catch {}
    }

    // backoff before reconnect
    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  await acquireSingletonLock();
  logger.info("welcome-worker start", {
    pid: process.pid,
    realtime: process.env.REALTIME_API_BASE || "http://127.0.0.1:8650",
    irisQuery: process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050",
  });
  await connectAndRun();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[welcome-worker] fatal:", e);
    process.exit(1);
  });
}
