import { Logger } from "@tsuki-chat/node-iris";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { APP_ROOT } from "../utils/paths";
import { tryServerIrisReplyText } from "../utils/iris";
import { tryServerTalkApiDispatch, tryServerTalkApiDispatchRaw } from "../utils/talkapi";

type StreamEntry = {
  ts?: string;
  roomId?: string;
  roomName?: string;
  senderId?: string;
  senderName?: string;
  text?: string;
  mid?: string;
  payloadType?: string;
  messageType?: unknown;
  uid?: string | null;
};

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
  talkApi?: { enabled?: boolean } | undefined;
  // "iris 계정" 판단 (우선순위: ids > names > senderName=='iris')
  irisAdminSenderIds?: string[] | undefined;
  irisAdminSenderNames?: string[] | undefined;
  // command 등록/수정/삭제 권한 오버라이드(우선순위: ids > names)
  // - 멤버 DB(open_chat_member)가 비어있거나 role 확인이 불안정한 방에서 운영자가 수동으로 허용 가능
  commandAdminSenderIds?: string[] | undefined;
  commandAdminSenderNames?: string[] | undefined;
};

type WorkerState = {
  lastSeenMs: number;
  updatedAt: string;
};

type ParsedCommand =
  | { kind: "register"; key: string; body: string }
  | { kind: "update"; key: string; body: string }
  | { kind: "delete"; key: string }
  | { kind: "list" }
  | { kind: "global_register"; key: string; body: string }
  | { kind: "trigger"; key: string };

type TriggerScope = "room" | "global";

type TriggerRecord = {
  scope: TriggerScope;
  roomId: string; // global이면 "__global__"
  keyNorm: string;
  keyDisplay: string;
  body: string;
};

const logger = new Logger("command-worker");

// 운영 알림/진단 메시지 중복 방지(운영자 알림 스팸 방지)
const ALERT_DEDUP = new DedupCache(5 * 60 * 1000); // 5분

const STATE_PATH = path.join(APP_ROOT, "data", "command_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "command_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "command_worker.lock");

const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분

const LINK_ID_CACHE_MS = 30 * 60 * 1000; // 30분
const linkIdByRoom = new Map<string, { linkId: string; at: number }>();
const ownerIdByRoom = new Map<string, { ownerId: string; at: number }>();

// 운영 진단/알림 로그는 항상 "테스트용 오픈채팅방"으로만 발신한다(운영방 오염 방지).
const OPS_LOG_ROOM_ID = "18462226881291012";
const MEMBER_LOAD_DEDUP = new DedupCache(15 * 60 * 1000); // 15분 (roomId 기준)
const MEMBER_LOAD_GLOBAL_DEDUP = new DedupCache(3 * 60 * 1000); // 3분 (전역; ADB 동작 과밀 방지)
const ROOM_ADMINS_REFRESH_DEDUP = new DedupCache(10 * 60 * 1000); // 10분 (roomId 기준)
const AUTO_FEATURES_DEDUP = new DedupCache(60 * 1000); // 60초 (features auto-patch 폭주 방지)

const ROOM_ADMINS_PATH = path.join(APP_ROOT, "data", "room_admins.json");

// Kakao openchat role (observed)
// - 8: 방장(호스트) (room당 보통 1명)
// - 4: 부방장/운영진 (여러 명 가능)
// - 1: 일부 방에서 운영진/특수 role로 관측됨(보수적으로 admin 취급)
const ROOM_ADMIN_TYPES = new Set<number>([8, 4, 1]);
const ROOM_OWNER_TYPE = 8;
const ROOM_SUBHOST_TYPES = new Set<number>([4, 1]);

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
const RUNTIME_CACHE_MS = 1500;
const STREAM_TTL_MS = Number.parseInt(String(process.env.COMMAND_WORKER_STREAM_TTL_MS || "").trim(), 10) || 60_000;

const RECENT_ACTIVITY_HOURS = (() => {
  const raw = safeString(process.env.AUTO_MEMBER_LOAD_RECENT_HOURS || process.env.AUTO_FEATURES_RECENT_HOURS);
  const n = Number(raw);
  // 기본: 72h(3일) 내 메시지 기록이 있으면 “최근 활동”으로 간주
  if (Number.isFinite(n) && n > 0 && n <= 24 * 30) return n;
  return 72;
})();

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function looksLikeUserId(s: string, senderId: string): boolean {
  const v = safeString(s);
  if (!v) return false;
  const sid = safeString(senderId);
  if (sid && v === sid) return true;
  // 숫자-only는 userId일 가능성이 높으므로 노출 금지
  if (/^\d{5,}$/.test(v)) return true;
  return false;
}

function resolveSafeSenderDisplayName(senderName: string, senderId: string): string {
  const sn = safeString(senderName);
  if (sn && !looksLikeUserId(sn, senderId)) return sn;
  return "";
}

function normalizeKey(raw: string): string {
  const s = safeString(raw);
  if (!s) return "";
  return s.replace(/\s+/g, " ").trim().toLowerCase();
}

function normalizeKakaoMessageType(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Kakao message.type는 환경에 따라 16384 플래그가 붙는 케이스가 있어 base type으로 정규화한다.
  if (n >= 16384) return n - 16384;
  return n;
}

function tsToMs(ts: unknown): number {
  const t = safeString(ts);
  if (!t) return 0;
  try {
    const dt = new Date(t);
    const ms = dt.getTime();
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

function isDigitsOnly(id: unknown): boolean {
  const s = safeString(id);
  if (!s) return false;
  return /^[0-9]+$/.test(s);
}

async function fetchRuntimeFromRealtime(timeoutMs = 4000): Promise<RuntimeConfig | null> {
  const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
  const url = `${base}/runtime`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return null;
    return data as RuntimeConfig;
  } catch {
    return null;
  }
}

async function fetchLatestLogMsByRoom(roomIds: string[], timeoutMs = 4500): Promise<Map<string, number>> {
  const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
  const ids = roomIds.map((x) => safeString(x)).filter(Boolean);
  const out = new Map<string, number>();
  if (ids.length === 0) return out;

  // GET 쿼리 길이 제한을 피하려고 배치 처리
  const batchSize = 40;
  for (let i = 0; i < ids.length; i += batchSize) {
    const batch = ids.slice(i, i + batchSize);
    const url = `${base}/logs/bulk?rooms=${encodeURIComponent(batch.join(","))}&limit=1`;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" } });
      clearTimeout(t);
      if (!res.ok) continue;
      const data: any = await res.json().catch(() => null);
      const roomsObj = data?.rooms;
      if (!roomsObj || typeof roomsObj !== "object") continue;
      for (const [rid, entries] of Object.entries(roomsObj as Record<string, unknown>)) {
        if (!Array.isArray(entries) || entries.length === 0) continue;
        const e0: any = (entries as any[])[0];
        const ms = tsToMs(e0?.ts ?? e0?.timestamp ?? e0?.time ?? e0?.at);
        if (ms > 0) out.set(String(rid), ms);
      }
    } catch {
      // ignore
    }
  }
  return out;
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
      logger.warn("[lock] 다른 command-worker가 이미 실행 중이므로 종료합니다.", { pid: oldPid, lockPath: LOCK_PATH });
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
        console.error("[command-worker] cleanup tmp failed:", e);
      }
    }
  }
}

type RoomAdminInfo = {
  updatedAt: string;
  hostUserIds: string[];
  subHostUserIds: string[];
  adminUserIds: string[];
  loadedMembersCount?: number;
  activeMembersCount?: number;
  note?: string | null;
};

type RoomAdminsSnapshot = {
  updatedAt: string;
  rooms: Record<string, RoomAdminInfo>;
};

let roomAdminsCache: RoomAdminsSnapshot | null = null;
let roomAdminsWriteChain: Promise<void> = Promise.resolve();

async function loadRoomAdminsSnapshot(): Promise<RoomAdminsSnapshot> {
  try {
    const raw = await fs.readFile(ROOM_ADMINS_PATH, "utf8");
    const parsed = JSON.parse(raw || "{}") as Partial<RoomAdminsSnapshot>;
    const rooms = parsed.rooms && typeof parsed.rooms === "object" ? (parsed.rooms as Record<string, RoomAdminInfo>) : {};
    const updatedAt = typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString();
    return { updatedAt, rooms };
  } catch {
    // best-effort: fallback to .bak
    try {
      const raw = await fs.readFile(`${ROOM_ADMINS_PATH}.bak`, "utf8");
      const parsed = JSON.parse(raw || "{}") as Partial<RoomAdminsSnapshot>;
      const rooms = parsed.rooms && typeof parsed.rooms === "object" ? (parsed.rooms as Record<string, RoomAdminInfo>) : {};
      const updatedAt = typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString();
      return { updatedAt, rooms };
    } catch {
      return { updatedAt: new Date().toISOString(), rooms: {} };
    }
  }
}

async function saveRoomAdminsSnapshot(s: RoomAdminsSnapshot): Promise<void> {
  // room_admins.json은 운영상 관측/가이드 목적의 스냅샷 파일이며,
  // Windows 환경에서 rename 기반 atomic write가 드물게 꼬여 tail이 남는 케이스가 있어(파일이 깨짐),
  // 여기서는 "truncate 보장"을 우선한다.
  const dir = path.dirname(ROOM_ADMINS_PATH);
  await fs.mkdir(dir, { recursive: true });
  const payload = JSON.stringify(s, null, 2);
  const tmp = `${ROOM_ADMINS_PATH}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, payload, "utf8");
  try {
    // best-effort backup
    const bak = `${ROOM_ADMINS_PATH}.bak`;
    try {
      await fs.unlink(bak);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") throw e;
    }
    try {
      await fs.rename(ROOM_ADMINS_PATH, bak);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") throw e;
    }
    // copyFile은 dst를 "덮어쓰기+truncate" 하므로 tail 잔존을 방지한다.
    await fs.copyFile(tmp, ROOM_ADMINS_PATH);
  } finally {
    try {
      await fs.unlink(tmp);
    } catch {
      // ignore
    }
  }
}

async function getRoomAdminsSnapshotCached(): Promise<RoomAdminsSnapshot> {
  if (roomAdminsCache) return roomAdminsCache;
  roomAdminsCache = await loadRoomAdminsSnapshot();
  return roomAdminsCache;
}

async function updateRoomAdmins(roomId: string, info: RoomAdminInfo): Promise<void> {
  roomAdminsWriteChain = roomAdminsWriteChain
    .then(async () => {
      const snap = await getRoomAdminsSnapshotCached();
      snap.rooms[String(roomId)] = info;
      snap.updatedAt = info.updatedAt || new Date().toISOString();
      await saveRoomAdminsSnapshot(snap);
    })
    .catch((e) => {
      logger.warn("[room-admins] update chain failed", { err: String(e) });
    });
  await roomAdminsWriteChain;
}

async function loadState(): Promise<WorkerState> {
  try {
    const raw = await fs.readFile(STATE_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<WorkerState>;
    const lastSeenMs = typeof parsed.lastSeenMs === "number" && Number.isFinite(parsed.lastSeenMs) ? parsed.lastSeenMs : 0;
    const updatedAt = typeof parsed.updatedAt === "string" && parsed.updatedAt ? parsed.updatedAt : new Date().toISOString();
    return { lastSeenMs, updatedAt };
  } catch {
    return { lastSeenMs: 0, updatedAt: new Date().toISOString() };
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

async function loadRuntime(): Promise<RuntimeConfig> {
  const now = Date.now();
  if (runtimeCache && now - runtimeCache.at < RUNTIME_CACHE_MS) return runtimeCache.data;
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

function isSafeModeOn(runtime: RuntimeConfig): boolean {
  return runtime.safeMode !== false;
}

function isTalkApiEnabled(runtime: RuntimeConfig): boolean {
  const t = runtime.talkApi && typeof runtime.talkApi === "object" ? runtime.talkApi : {};
  return (t as any).enabled === true;
}

function isRoomAllowed(runtime: RuntimeConfig, roomId: string): boolean {
  const list = Array.isArray(runtime.allowedRoomIds)
    ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (list.length === 0) return false;
  const rid = String(roomId);
  if (!list.includes(rid)) return false;
  const ex = Array.isArray(runtime.excludedRoomIds)
    ? runtime.excludedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (ex.includes(rid)) return false;
  return true;
}

function isFeatureEnabled(runtime: RuntimeConfig, roomId: string, feature: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[String(roomId)];
  if (!flags || typeof flags !== "object") return false;
  return (flags as any)[feature] === true;
}

function isIrisAdmin(runtime: RuntimeConfig, senderId: string, senderName: string): boolean {
  const ids = Array.isArray(runtime.irisAdminSenderIds)
    ? runtime.irisAdminSenderIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (ids.length > 0) return ids.includes(String(senderId));

  const names = Array.isArray(runtime.irisAdminSenderNames)
    ? runtime.irisAdminSenderNames.map((x) => safeString(x).toLowerCase()).filter(Boolean)
    : [];
  const sn = safeString(senderName).toLowerCase();
  if (names.length > 0) return names.includes(sn);

  return sn === "iris";
}

function isCommandAdminOverride(runtime: RuntimeConfig, roomId: string, senderId: string, senderName: string): boolean {
  const sn = safeString(senderName).toLowerCase();
  const rid = String(roomId);
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[rid];

  const roomIds = Array.isArray((flags as any)?.commandAdminSenderIds)
    ? (flags as any).commandAdminSenderIds.map((x: unknown) => safeString(x)).filter(Boolean)
    : [];
  if (roomIds.length > 0) return roomIds.includes(String(senderId));

  const roomNames = Array.isArray((flags as any)?.commandAdminSenderNames)
    ? (flags as any).commandAdminSenderNames.map((x: unknown) => safeString(x).toLowerCase()).filter(Boolean)
    : [];
  if (roomNames.length > 0) return roomNames.includes(sn);

  const ids = Array.isArray(runtime.commandAdminSenderIds)
    ? runtime.commandAdminSenderIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (ids.length > 0) return ids.includes(String(senderId));

  const names = Array.isArray(runtime.commandAdminSenderNames)
    ? runtime.commandAdminSenderNames.map((x) => safeString(x).toLowerCase()).filter(Boolean)
    : [];
  if (names.length > 0) return names.includes(sn);

  return false;
}

function escapePwshSingleQuotes(v: string): string {
  return String(v || "").replace(/'/g, "''");
}

function shouldAutoLoadMembersOnMissing(runtime: RuntimeConfig, roomId: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[String(roomId)];
  if (flags && typeof flags === "object" && (flags as any).commandAutoLoadMembersOnMissing === false) return false;

  const global = (runtime as any)?.commandWorker?.autoLoadMembersOnMissing;
  if (typeof global === "boolean") return global;

  // 운영 기본: 켜둔다(멤버 DB가 비면 즉시 갱신 트리거)
  return true;
}

async function fetchRoomsFromRealtime(
  timeoutMs = 4000,
): Promise<Array<{ roomId: string; roomName: string }>> {
  const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
  const url = `${base}/rooms`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "GET", signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return [];
    const data: any = await res.json().catch(() => null);
    if (!Array.isArray(data)) return [];
    const out: Array<{ roomId: string; roomName: string }> = [];
    for (const it of data) {
      if (!it || typeof it !== "object") continue;
      const rid = safeString((it as any).roomId);
      if (!rid) continue;
      const rn = safeString((it as any).roomName) || rid;
      out.push({ roomId: rid, roomName: rn });
    }
    return out;
  } catch {
    return [];
  }
}

async function ensureAllowlistHasRooms(runtime: RuntimeConfig, roomIds: string[]): Promise<void> {
  const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
  const url = `${base}/runtime`;

  const curAllowed = Array.isArray(runtime.allowedRoomIds)
    ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  const ex = Array.isArray(runtime.excludedRoomIds)
    ? runtime.excludedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];

  const set = new Set<string>(curAllowed);
  let changed = false;
  for (const rid of roomIds) {
    const id = safeString(rid);
    if (!id) continue;
    if (ex.includes(id)) continue;
    if (set.has(id)) continue;
    set.add(id);
    changed = true;
  }
  if (!changed) return;

  const next = Array.from(set);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 4000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowedRoomIds: next }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logger.warn("[runtime] ensureAllowlistHasRooms failed", { err: String(e) });
  }
}

async function ensureCommandsDefaultOn(
  runtime: RuntimeConfig,
  discoveredIds: string[],
  activeIds: Set<string>,
): Promise<void> {
  // 기본값 ON: 신규 방(=features 엔트리 없음) + 최근 활동 방(active)에는 commands를 기본 ON으로 설정한다.
  // 단, 운영자가 명시적으로 off(commands=false)한 방은 존중한다.
  if (AUTO_FEATURES_DEDUP.isDuplicate("ensureCommandsDefaultOn")) return;

  const baseRuntime = (await fetchRuntimeFromRealtime(3500)) || runtime;
  const curFeatures = baseRuntime.features && typeof baseRuntime.features === "object" ? baseRuntime.features : {};

  let changed = false;
  const nextFeatures: Record<string, any> = { ...(curFeatures as any) };

  for (const rid0 of discoveredIds) {
    const rid = safeString(rid0);
    if (!rid) continue;
    if (!isDigitsOnly(rid)) continue; // smoke-verify 같은 텍스트 roomId 제외

    // 기본값 ON은 "최근 메시지 기록이 있는 방"으로 범위를 제한한다(노이즈/부하 방지).
    if (!activeIds.has(rid)) continue;

    const prev = nextFeatures[rid];
    const prevObj = prev && typeof prev === "object" ? (prev as any) : {};
    const hasCommandsProp = Object.prototype.hasOwnProperty.call(prevObj, "commands");
    if (hasCommandsProp) continue; // true/false 모두 존중(기존 설정 유지)

    nextFeatures[rid] = { ...prevObj, commands: true };
    changed = true;
  }

  if (!changed) return;

  const url = `${safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "")}/runtime`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: nextFeatures }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
  } catch (e) {
    logger.warn("[runtime] ensureCommandsDefaultOn failed", { err: String(e) });
  }
}

const OPS_BATCH_WINDOW_MS = 800;
const OPS_MAX_CHARS = 1600; // 카카오톡 메시지 길이 안전 여유
let opsBuf: string[] = [];
let opsTimer: NodeJS.Timeout | null = null;
let opsLastRuntime: RuntimeConfig | null = null;
let opsFlushInProgress = false;

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
  // ops 로그는 테스트방 고정(allowlist/excluded 설정과 무관)이며, 운영방에는 발신하지 않는다.

  opsLastRuntime = runtime;
  opsBuf.push(text);

  // 너무 많은 메시지가 쌓이면 즉시 flush
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

type MemberLoadMeta = { actorName?: string; actorId?: string; action?: string };

function humanizeMemberLoadReason(reason: string): string {
  const r = String(reason || "").trim();
  const u = r.toUpperCase();
  if (u === "NO_MEMBER_ROW" || u === "NO_ROLE") return "멤버 DB가 아직 로딩되지 않아 관리자/방장 판별이 불가능함";
  if (u.startsWith("ADMIN_REFRESH_")) return "방 정보 갱신 중 멤버 DB가 비어 있음(스크롤 로딩 필요)";
  return r || "알 수 없음";
}

async function triggerMemberLoad(roomId: string, roomName: string, reason: string, meta?: MemberLoadMeta): Promise<void> {
  const runtime = await loadRuntime();
  if (isSafeModeOn(runtime)) return;
  if (!shouldAutoLoadMembersOnMissing(runtime, roomId)) return;
  if (MEMBER_LOAD_DEDUP.isDuplicate(roomId)) return;
  if (MEMBER_LOAD_GLOBAL_DEDUP.isDuplicate("global")) return;
  if (!isRoomAllowed(runtime, roomId)) return;

  const repoRoot = path.resolve(APP_ROOT, "..");
  const scriptPath = path.join(repoRoot, "scripts", "openchat_load_members.ps1");
  const logsDir = path.join(repoRoot, "windows", "logs");
  const ts = new Date().toISOString().replace(/[:.]/g, "").replace("Z", "Z");
  const outLog = path.join(logsDir, `openchat_load_members.${roomId}.${ts}.out.log`);
  const errLog = path.join(logsDir, `openchat_load_members.${roomId}.${ts}.err.log`);

  // NOTE: 기존(Start-Process + -Redirect...)은 실패해도 로그 파일이 안 생기는 케이스가 있어,
  // Node에서 직접 파일을 생성/오픈하고 detached child로 실행한다.

  try {
    await fs.mkdir(logsDir, { recursive: true });
    // Always create log files up-front so that "triggered but no logs" 케이스를 없앤다.
    await fs.writeFile(outLog, `[${new Date().toISOString()}] start openchat_load_members (reason=${reason})\n`, "utf8");
    await fs.writeFile(errLog, `[${new Date().toISOString()}] start openchat_load_members (reason=${reason})\n`, "utf8");

    const outFd = await fs.open(outLog, "a");
    const errFd = await fs.open(errLog, "a");

    const args = [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      scriptPath,
      "-RoomId",
      String(roomId),
      "-Scrolls",
      "120",
    ];

    const p = spawn("powershell", args, {
      detached: true,
      stdio: ["ignore", outFd.fd, errFd.fd],
      windowsHide: true,
      cwd: repoRoot,
    });
    p.unref();
    try {
      await outFd.close();
      await errFd.close();
    } catch {}

    const who = meta?.actorId ? `${safeString(meta?.actorName) || "?"} (${safeString(meta?.actorId)})` : "";
    await sendOpsLog(
      runtime,
      formatOps("멤버 목록 로딩 실행(권한 확인/자동화)", [
        `방: ${roomName} (${roomId})`,
        who ? `요청자: ${who}` : null,
        meta?.action ? `상황: ${safeString(meta.action)}` : null,
        `이유: ${humanizeMemberLoadReason(reason)}`,
        `로그: ${outLog}`,
        `에러로그: ${errLog}`,
        "참고: 멤버 목록 로딩은 roomId 기준 15분 쿨다운이 적용됩니다.",
      ]),
    );
  } catch (e) {
    await sendOpsLog(
      runtime,
      formatOps("멤버 목록 로딩 실행 실패", [
        `방: ${roomName} (${roomId})`,
        `이유: ${humanizeMemberLoadReason(reason)}`,
        `오류: ${String(e)}`,
      ]),
    );
  }
}

async function refreshRoomAdminsForRoom(
  roomId: string,
  roomName: string,
  reason: string,
  opts?: { isActive?: boolean; latestLogMs?: number },
): Promise<void> {
  const rid = safeString(roomId);
  if (!rid) return;

  const runtime = await loadRuntime();
  if (isSafeModeOn(runtime)) return;
  const bypassAllowlist = (String(reason || "").toLowerCase().includes("new_room") || !!opts?.isActive) && isDigitsOnly(rid);
  if (!bypassAllowlist && !isRoomAllowed(runtime, rid)) return;
  const bypassDedup = String(reason || "").toLowerCase().includes("new_room");
  if (!bypassDedup && ROOM_ADMINS_REFRESH_DEDUP.isDuplicate(`room:${rid}`)) return;

  const nowIso = new Date().toISOString();
  const prev = (await getRoomAdminsSnapshotCached()).rooms?.[rid];

  // active members count (from chat_rooms)
  let activeCnt: number | undefined = undefined;
  try {
    const ar = await irisQuery("select active_members_count as cnt from chat_rooms where id=?", [rid], 8000);
    const v = Number(ar.rows?.[0]?.cnt ?? ar.rows?.[0]?.active_members_count);
    if (Number.isFinite(v) && v >= 0) activeCnt = v;
  } catch {
    // ignore
  }

  // loaded members count (from open_chat_member)
  let loadedCnt = 0;
  const cntRes = await irisQuery("select count(distinct user_id) as cnt from db2.open_chat_member where involved_chat_id=?", [rid], 8000);
  if (cntRes.ok) {
    const v = Number(cntRes.rows?.[0]?.cnt);
    if (Number.isFinite(v) && v >= 0) loadedCnt = v;
  }

  // NOTE: 주기 갱신에서 멤버 DB 스크롤 로딩(ADB)을 연쇄 실행하면 운영 알림이 폭주할 수 있으므로,
  // 자동 로딩은 실제 권한 판별이 필요한 시점(관리자 명령 처리)에서만 트리거한다.

  const rolesRes = await irisQuery(
    "select user_id, max(link_member_type) as t from db2.open_chat_member where involved_chat_id=? group by user_id",
    [rid],
    8000,
  );

  const hostUserIds: string[] = [];
  const subHostUserIds: string[] = [];
  const adminUserIds: string[] = [];

  if (rolesRes.ok) {
    for (const row of rolesRes.rows || []) {
      const uid = safeString((row as any)?.user_id);
      const t = Number((row as any)?.t ?? (row as any)?.link_member_type);
      if (!uid || !Number.isFinite(t)) continue;
      if (!ROOM_ADMIN_TYPES.has(t)) continue;
      adminUserIds.push(uid);
      if (t === ROOM_OWNER_TYPE) hostUserIds.push(uid);
      if (ROOM_SUBHOST_TYPES.has(t)) subHostUserIds.push(uid);
    }
  }

  // Fallback: open_link.user_id(방장)로 host/admin 보강
  // - open_chat_member가 비어있거나(대형방/미로딩) role 컬럼이 불안정해도 방장은 항상 판별 가능해야 한다.
  const ownerId = await resolveOpenLinkOwnerUserId(rid);
  if (ownerId) {
    adminUserIds.push(ownerId);
    hostUserIds.push(ownerId);
  }

  const info: RoomAdminInfo = {
    updatedAt: nowIso,
    hostUserIds: Array.from(new Set(hostUserIds)),
    subHostUserIds: Array.from(new Set(subHostUserIds)),
    adminUserIds: Array.from(new Set(adminUserIds)),
    loadedMembersCount: loadedCnt,
    activeMembersCount: activeCnt,
    note:
      loadedCnt <= 0
        ? "open_chat_member empty (member list not loaded yet)"
        : hostUserIds.length === 0 && subHostUserIds.length === 0
          ? "no admin roles found in open_chat_member"
          : null,
  };
  await updateRoomAdmins(rid, info);
  // NOTE: 방별 주기 갱신 로그는 테스트방 알림 스팸이 되기 쉬워 발신하지 않는다.
}

function parseCommand(textRaw: string): ParsedCommand | null {
  const text = String(textRaw || "");
  if (!text.startsWith("!")) return null;
  const lines = text.split(/\r?\n/);
  const firstLine = String(lines[0] || "").trim();
  if (!firstLine.startsWith("!")) return null;
  const rest = firstLine
    .slice(1)
    .trim()
    .replace(/\s+/g, " ");
  if (!rest) return null;

  const lower = rest.toLowerCase();
  if (lower === "명령어") return { kind: "list" };

  const mReg = /^등록(?:\s+(.+))?$/.exec(rest);
  if (mReg) return { kind: "register", key: safeString(mReg[1] || ""), body: lines.slice(1).join("\n") };

  const mUpd = /^수정(?:\s+(.+))?$/.exec(rest);
  if (mUpd) return { kind: "update", key: safeString(mUpd[1] || ""), body: lines.slice(1).join("\n") };

  const mDel = /^삭제(?:\s+(.+))?$/.exec(rest);
  if (mDel) return { kind: "delete", key: safeString(mDel[1] || "") };

  const mG = /^전체등록(?:\s+(.+))?$/.exec(rest);
  if (mG) return { kind: "global_register", key: safeString(mG[1] || ""), body: lines.slice(1).join("\n") };

  return { kind: "trigger", key: rest };
}

async function irisQuery(query: string, bind: unknown[], timeoutMs = 8000): Promise<{ ok: boolean; rows: any[]; httpStatus?: number; err?: string }> {
  const base = String(process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
  const url = `${base}/query`;
  const body = { query, bind: Array.isArray(bind) ? bind : [] };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const j: any = await res.json().catch(() => null);
    const rows = Array.isArray(j?.data) ? j.data : [];
    if (!res.ok) {
      return { ok: false, rows: [], httpStatus: res.status, err: safeString(j?.message || j?.error || j?.detail || "") || `HTTP ${res.status}` };
    }
    return { ok: true, rows, httpStatus: res.status };
  } catch (e) {
    return { ok: false, rows: [], err: String(e) };
  }
}

async function ensureSchema(): Promise<void> {
  const ddl = `
create table if not exists command_triggers (
  scope text not null,
  room_id text not null,
  key_norm text not null,
  key_display text not null,
  body text not null,
  enabled integer not null default 1,
  created_by text not null,
  updated_by text not null,
  created_at text not null,
  updated_at text not null,
  last_used_at text,
  use_count integer not null default 0,
  primary key (scope, room_id, key_norm)
);`.trim();
  const r = await irisQuery(ddl, [], 8000);
  if (!r.ok) {
    logger.warn("[schema] ensureSchema failed", { err: r.err, httpStatus: r.httpStatus });
  }
}

async function resolveOpenLinkIdForRoom(roomId: string): Promise<string | null> {
  const now = Date.now();
  const cached = linkIdByRoom.get(roomId);
  if (cached && now - cached.at < LINK_ID_CACHE_MS) return cached.linkId;

  const r = await irisQuery("select link_id from chat_rooms where id=?", [roomId], 8000);
  if (!r.ok) {
    logger.warn("[reply] resolveOpenLinkIdForRoom failed", { roomId, err: r.err, httpStatus: r.httpStatus });
    return null;
  }
  const linkId = safeString(r.rows?.[0]?.link_id ?? r.rows?.[0]?.linkId ?? "");
  if (!linkId) {
    logger.warn("[reply] resolveOpenLinkIdForRoom empty", { roomId });
    return null;
  }
  linkIdByRoom.set(roomId, { linkId, at: now });
  return linkId;
}

async function resolveOpenLinkOwnerUserId(roomId: string): Promise<string | null> {
  const rid = safeString(roomId);
  if (!rid) return null;
  const now = Date.now();
  const cached = ownerIdByRoom.get(rid);
  if (cached && now - cached.at < LINK_ID_CACHE_MS) return cached.ownerId;

  // Prefer a single join query (less brittle than 2-step "resolve link_id -> open_link").
  // Note: db2.open_link is an attached db in IRIS.
  const r0 = await irisQuery(
    "select ol.user_id as user_id from chat_rooms cr join db2.open_link ol on cr.link_id=ol.id where cr.id=? limit 1",
    [rid],
    8000,
  );
  if (r0.ok) {
    const ownerId0 = safeString(r0.rows?.[0]?.user_id ?? r0.rows?.[0]?.userId ?? "");
    if (ownerId0) {
      ownerIdByRoom.set(rid, { ownerId: ownerId0, at: now });
      return ownerId0;
    }
  }

  // Fallback: old 2-step path (in case join fails due to schema/attach issues).
  const linkId = await resolveOpenLinkIdForRoom(rid);
  if (!linkId) return null;

  const r = await irisQuery("select user_id from db2.open_link where id=? limit 1", [linkId], 8000);
  if (!r.ok) return null;
  const ownerId = safeString(r.rows?.[0]?.user_id ?? r.rows?.[0]?.userId ?? "");
  if (!ownerId) return null;
  ownerIdByRoom.set(rid, { ownerId, at: now });
  return ownerId;
}

async function isRoomAdmin(
  roomId: string,
  senderId: string,
): Promise<{ ok: true; isAdmin: boolean; reason?: "NO_MEMBER_ROW" | "NO_ROLE" } | { ok: false; err: string }> {
  const r = await irisQuery(
    "select link_member_type from db2.open_chat_member where involved_chat_id=? and user_id=? order by rowid desc limit 1",
    [roomId, senderId],
    8000,
  );
  if (!r.ok) return { ok: false, err: r.err || "query_failed" };
  const row = r.rows?.[0];
  if (!row) {
    // Fallback: open_link.user_id(방장) 체크로 방장 권한을 보장한다(멤버 DB 미로딩/드리프트 대비).
    const ownerId = await resolveOpenLinkOwnerUserId(roomId);
    if (ownerId && String(ownerId) === String(senderId)) return { ok: true, isAdmin: true };
    const snap = await getRoomAdminsSnapshotCached();
    const cached = snap.rooms?.[String(roomId)];
    const isCachedAdmin = !!cached && Array.isArray(cached.adminUserIds) && cached.adminUserIds.includes(String(senderId));
    return isCachedAdmin ? { ok: true, isAdmin: true } : { ok: true, isAdmin: false, reason: "NO_MEMBER_ROW" };
  }
  const t = Number((row as any)?.link_member_type);
  if (!Number.isFinite(t)) {
    const ownerId = await resolveOpenLinkOwnerUserId(roomId);
    if (ownerId && String(ownerId) === String(senderId)) return { ok: true, isAdmin: true };
    const snap = await getRoomAdminsSnapshotCached();
    const cached = snap.rooms?.[String(roomId)];
    const isCachedAdmin = !!cached && Array.isArray(cached.adminUserIds) && cached.adminUserIds.includes(String(senderId));
    return isCachedAdmin ? { ok: true, isAdmin: true } : { ok: true, isAdmin: false, reason: "NO_ROLE" };
  }
  const isAdmin = ROOM_ADMIN_TYPES.has(t);
  return { ok: true, isAdmin };
}

async function readTrigger(scope: TriggerScope, roomId: string, keyNorm: string): Promise<TriggerRecord | null> {
  const sid = scope === "global" ? "__global__" : roomId;
  const r = await irisQuery(
    "select scope, room_id, key_norm, key_display, body from command_triggers where scope=? and room_id=? and key_norm=? and enabled=1 limit 1",
    [scope, sid, keyNorm],
    8000,
  );
  if (!r.ok) {
    logger.warn("[db] readTrigger failed", { scope, roomId: sid, keyNorm, err: r.err });
    return null;
  }
  const row = r.rows?.[0];
  if (!row) return null;
  return {
    scope,
    roomId: safeString(row.room_id),
    keyNorm: safeString(row.key_norm),
    keyDisplay: safeString(row.key_display),
    body: String(row.body ?? ""),
  };
}

async function insertTrigger(rec: TriggerRecord, actorId: string): Promise<{ ok: true } | { ok: false; reason: "EXISTS" | "ERROR"; err?: string }> {
  const nowIso = new Date().toISOString();
  const r = await irisQuery(
    "insert into command_triggers (scope, room_id, key_norm, key_display, body, enabled, created_by, updated_by, created_at, updated_at) values (?,?,?,?,?,1,?,?,?,?)",
    [rec.scope, rec.roomId, rec.keyNorm, rec.keyDisplay, rec.body, actorId, actorId, nowIso, nowIso],
    8000,
  );
  if (!r.ok) {
    const msg = String(r.err || "");
    if (msg.toLowerCase().includes("unique") || msg.toLowerCase().includes("constraint")) {
      return { ok: false, reason: "EXISTS" };
    }
    return { ok: false, reason: "ERROR", err: r.err };
  }
  return { ok: true };
}

async function updateTrigger(
  rec: TriggerRecord,
  actorId: string,
): Promise<{ ok: true; updated: boolean } | { ok: false; reason: "NOT_FOUND" | "ERROR"; err?: string }> {
  const sid = rec.scope === "global" ? "__global__" : rec.roomId;
  const existing = await readTrigger(rec.scope, sid, rec.keyNorm);
  if (!existing) return { ok: false, reason: "NOT_FOUND" };

  const nowIso = new Date().toISOString();
  const r = await irisQuery(
    "update command_triggers set key_display=?, body=?, updated_by=?, updated_at=? where scope=? and room_id=? and key_norm=?",
    [rec.keyDisplay, rec.body, actorId, nowIso, rec.scope, sid, rec.keyNorm],
    8000,
  );
  if (!r.ok) return { ok: false, reason: "ERROR", err: r.err };

  // sqlite(/query) rowcount 미반환: 변경 반영 여부는 재조회로 확인한다.
  const check = await readTrigger(rec.scope, sid, rec.keyNorm);
  const updated = !!check && String(check.body) === String(rec.body);
  return { ok: true, updated };
}

async function deleteTrigger(scope: TriggerScope, roomId: string, keyNorm: string): Promise<{ ok: true; deleted: boolean } | { ok: false; err: string }> {
  const sid = scope === "global" ? "__global__" : roomId;
  const r = await irisQuery("delete from command_triggers where scope=? and room_id=? and key_norm=?", [scope, sid, keyNorm], 8000);
  if (!r.ok) return { ok: false, err: r.err || "delete_failed" };
  // sqlite: /query는 변경 rowcount를 반환하지 않으므로, 존재 확인을 추가로 한다.
  const check = await readTrigger(scope, sid, keyNorm);
  return { ok: true, deleted: check == null };
}

async function listTriggers(roomId: string): Promise<{ room: string[]; global: string[] }> {
  const roomRows = await irisQuery(
    "select key_display from command_triggers where scope='room' and room_id=? and enabled=1 order by key_norm asc",
    [roomId],
    8000,
  );
  const globalRows = await irisQuery(
    "select key_display from command_triggers where scope='global' and room_id='__global__' and enabled=1 order by key_norm asc",
    [],
    8000,
  );
  const roomKeys = roomRows.ok && Array.isArray(roomRows.rows) ? roomRows.rows.map((r) => safeString((r as any).key_display)).filter(Boolean) : [];
  const globalKeys = globalRows.ok && Array.isArray(globalRows.rows) ? globalRows.rows.map((r) => safeString((r as any).key_display)).filter(Boolean) : [];
  return { room: roomKeys, global: globalKeys };
}

async function bumpUsage(scope: TriggerScope, roomId: string, keyNorm: string): Promise<void> {
  const sid = scope === "global" ? "__global__" : roomId;
  const nowIso = new Date().toISOString();
  const r = await irisQuery(
    "update command_triggers set use_count=coalesce(use_count,0)+1, last_used_at=?, updated_at=? where scope=? and room_id=? and key_norm=?",
    [nowIso, nowIso, scope, sid, keyNorm],
    8000,
  );
  if (!r.ok) logger.warn("[db] bumpUsage failed", { scope, roomId: sid, keyNorm, err: r.err });
}

async function sendReplyToMessage(opts: {
  runtime: RuntimeConfig;
  roomId: string;
  replyText: string;
  srcLogId: string;
  srcUserId: string;
  srcType: number;
  srcMessage: string;
}): Promise<boolean> {
  const { runtime, roomId, replyText } = opts;
  if (!isRoomAllowed(runtime, roomId)) {
    logger.warn("[send] skip (ROOM_NOT_ALLOWED)", { roomId });
    return false;
  }
  if (isSafeModeOn(runtime)) {
    logger.warn("[send] skip (SAFE_MODE)", { roomId });
    return false;
  }
  if (!isTalkApiEnabled(runtime)) {
    logger.warn("[send] skip (TALKAPI_DISABLED)", { roomId });
    return false;
  }

  const srcLinkId = await resolveOpenLinkIdForRoom(roomId);
  if (!srcLinkId) {
    logger.warn("[send] skip (MISSING_SRC_LINK_ID)", { roomId });
    return false;
  }

  const replyAttachment: Record<string, unknown> = {
    src_logId: safeString(opts.srcLogId),
    src_userId: safeString(opts.srcUserId),
    src_linkId: safeString(srcLinkId),
    src_type: safeString(Math.floor(opts.srcType)),
    src_message: safeString(opts.srcMessage),
  };

  if (!replyAttachment.src_logId || !replyAttachment.src_userId || !replyAttachment.src_type || !replyAttachment.src_message) {
    logger.warn("[send] skip (MISSING_SRC_FIELDS)", { roomId });
    return false;
  }

  const ok = await tryServerTalkApiDispatchRaw(logger, roomId, replyText, 26, replyAttachment, 12000);
  if (ok) return true;

  // Talk-API Reply가 실패하면 운영 연속성을 위해 IRIS /reply_text로 폴백한다(Reply UI 렌더링은 불가).
  // - 운영 방에는 "답장 불가" 같은 기술 문구를 발송하지 않는다.
  // - 대신 테스트방에만 알림을 남겨 운영자가 장애를 인지할 수 있게 한다.
  const alertKey = `talkapi_reply_failed:${roomId}`;
  if (!ALERT_DEDUP.isDuplicate(alertKey)) {
    void sendOpsLog(
      runtime,
      formatOps("답장(Reply) 전송 실패 → 일반 메시지로 대체", [
        `방ID: ${roomId}`,
        `원본 메시지 ID: ${replyAttachment.src_logId}`,
        `발신자 ID: ${replyAttachment.src_userId}`,
        "참고: Talk-API 장애/인증 만료 가능",
      ]),
    );
  }
  const okIris = await tryServerIrisReplyText(logger, roomId, replyText, 12000);
  return okIris;
}

function buildListMessage(roomKeys: string[], globalKeys: string[]): string {
  const out: string[] = [];
  out.push("등록된 명령어 목록");

  const maxItems = 60;
  const maxChars = 1200;

  const addBlock = (title: string, keys: string[]) => {
    out.push("");
    out.push(title);
    if (keys.length === 0) {
      out.push("- (없음)");
      return;
    }
    let n = 0;
    for (const k of keys) {
      n += 1;
      const line = `- !${k}`;
      out.push(line);
      if (n >= maxItems) {
        const remain = keys.length - n;
        if (remain > 0) out.push(`- ... 외 ${remain}개`);
        break;
      }
      if (out.join("\n").length > maxChars) {
        out.push("- ... (목록이 길어 일부만 표시)");
        break;
      }
    }
  };

  addBlock("[방 전용]", roomKeys);
  addBlock("[전체 공통]", globalKeys);
  return out.join("\n").trim();
}

async function processEntry(ent: StreamEntry, lastSeenMsRef: { v: number }): Promise<void> {
  const roomId = safeString(ent.roomId);
  if (!roomId) return;

  const tsMs = tsToMs(ent.ts);
  if (tsMs > 0 && tsMs > lastSeenMsRef.v) lastSeenMsRef.v = tsMs;

  if (safeString(ent.payloadType) !== "message") return;

  const text = String(ent.text || "");
  if (!text.startsWith("!")) return;

  const runtime = await loadRuntime();
  const featureOn = isFeatureEnabled(runtime, roomId, "commands");

  const senderId = safeString(ent.senderId);
  const senderName = safeString(ent.senderName);
  const srcLogId = safeString(ent.mid);
  const srcType = normalizeKakaoMessageType(ent.messageType) ?? 1;
  const srcMessage = text.split(/\r?\n/)[0] || text;

  const cmd = parseCommand(text);
  if (!cmd) return;

  // feature toggle: 트리거는 무시, 관리 커맨드는 안내
  const isMgmt =
    cmd.kind === "register" ||
    cmd.kind === "update" ||
    cmd.kind === "delete" ||
    cmd.kind === "global_register" ||
    cmd.kind === "list";
  if (!featureOn) {
    if (!isMgmt) return;
    const dedupKey = safeString(ent.uid) || `${roomId}:${srcLogId}:${normalizeKey(srcMessage)}`;
    if (EVENT_DEDUP.isDuplicate(dedupKey)) return;
    if (!srcLogId || !senderId) return;
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: "이 방은 `명령어(Commands)` 기능이 꺼져있습니다. settings에서 켜주세요.",
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
    return;
  }

  const dedupKey = safeString(ent.uid) || `${roomId}:${srcLogId}:${normalizeKey(srcMessage)}`;
  if (EVENT_DEDUP.isDuplicate(dedupKey)) return;

  // Reply 기반으로만 응답한다. (fallback 금지)
  if (!srcLogId || !senderId) {
    logger.warn("[cmd] missing src_logId or senderId; skip", { roomId, senderId, srcLogId });
    return;
  }

  if (cmd.kind === "list") {
    const { room, global } = await listTriggers(roomId);
    const msg = buildListMessage(room, global);
    await sendReplyToMessage({ runtime, roomId, replyText: msg, srcLogId, srcUserId: senderId, srcType, srcMessage });
    return;
  }

  if (cmd.kind === "register" || cmd.kind === "update" || cmd.kind === "delete") {
    if (!isCommandAdminOverride(runtime, roomId, senderId, senderName)) {
      const perm = await isRoomAdmin(roomId, senderId);
      if (!perm.ok) {
        await sendReplyToMessage({
          runtime,
          roomId,
          replyText:
            "권한 확인이 어려워 현재 등록/수정/삭제를 처리할 수 없습니다. 잠시 후 다시 시도해주세요.",
          srcLogId,
          srcUserId: senderId,
          srcType,
          srcMessage,
        });
        logger.warn("[perm] room admin check failed", { roomId, senderId, err: perm.err });
        await sendOpsLog(
          runtime,
          formatOps("명령어 등록/수정/삭제 권한 확인 실패", [
            `방: ${safeString(ent.roomName) || roomId} (${roomId})`,
            `요청자: ${resolveSafeSenderDisplayName(senderName, senderId) || "어떤 분"}`,
            `원인: IRIS 조회 실패 (${perm.err})`,
          ]),
        );
        return;
      }
      if (!perm.isAdmin) {
        if (perm.reason === "NO_MEMBER_ROW" || perm.reason === "NO_ROLE") {
          // Edge: 멤버 DB가 비어있어도 open_link(방장) 정보로 즉시 방장 권한을 인정한다.
          // (isRoomAdmin()에서도 처리하지만, IRIS/캐시 문제로 드물게 NO_MEMBER_ROW가 유지되는 케이스를 방지)
          const ownerId = await resolveOpenLinkOwnerUserId(roomId);
          if (ownerId && String(ownerId) === String(senderId)) {
            // allow (fallthrough)
          } else {
          await sendReplyToMessage({
            runtime,
            roomId,
            replyText: "방장/관리자 권한을 확인 중입니다. 1~2분 후 다시 시도해주세요.",
            srcLogId,
            srcUserId: senderId,
            srcType,
            srcMessage,
          });
          void triggerMemberLoad(roomId, safeString(ent.roomName) || roomId, perm.reason, {
            actorName: senderName,
            actorId: senderId,
            action: "명령어 등록/수정/삭제 권한 확인",
          }).catch(() => {});
          return;
          }
        }

        // 진짜 비권한자(방장/관리자 아님)
        await sendReplyToMessage({
          runtime,
          roomId,
          replyText: "방장/관리자만 사용할 수 있는 명령입니다. (`!등록`, `!수정`, `!삭제`)",
          srcLogId,
          srcUserId: senderId,
          srcType,
          srcMessage,
        });
        return;
      }
    }
  }

  if (cmd.kind === "global_register") {
    if (!isIrisAdmin(runtime, senderId, senderName)) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "`!전체등록`은 iris 계정만 사용할 수 있습니다.",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }
  }

  if (cmd.kind === "register" || cmd.kind === "global_register") {
    const key = safeString(cmd.key);
    const keyNorm = normalizeKey(key);
    const body = String(cmd.body || "");
    if (!keyNorm) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "사용법: 첫 줄 `!등록 <키>` + 다음 줄부터 본문(멀티라인)",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }
    if (!body.trim()) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "등록할 본문이 비어 있습니다. (2번째 줄부터 내용을 적어주세요)",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }

    const scope: TriggerScope = cmd.kind === "global_register" ? "global" : "room";
    const sid = scope === "global" ? "__global__" : roomId;

    const exists = await readTrigger(scope, sid, keyNorm);
    if (exists) {
      const hint =
        scope === "room"
          ? `본문 수정은 \`!수정 ${exists.keyDisplay}\`를 사용하세요.`
          : "전체 공통 키는 덮어쓰지 않습니다. (필요 시 운영자에게 문의)";
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: `이미 등록된 키입니다: '${exists.keyDisplay}'. ${hint}`,
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }

    const rec: TriggerRecord = {
      scope,
      roomId: sid,
      keyNorm,
      keyDisplay: key,
      body: body.trimEnd(),
    };
    const ins = await insertTrigger(rec, senderId);
    if (!ins.ok) {
      const msg = ins.reason === "EXISTS" ? "이미 등록된 키입니다. (`!삭제` 후 재등록)" : "등록에 실패했습니다.";
      await sendReplyToMessage({ runtime, roomId, replyText: msg, srcLogId, srcUserId: senderId, srcType, srcMessage });
      return;
    }

    const label = scope === "global" ? "[전체]" : "[방]";
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: `${label} 등록 완료: !${key}`,
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
    return;
  }

  if (cmd.kind === "update") {
    const key = safeString(cmd.key);
    const keyNorm = normalizeKey(key);
    const body = String(cmd.body || "");
    if (!keyNorm) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "사용법: 첫 줄 `!수정 <키>` + 다음 줄부터 본문(멀티라인)",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }
    if (!body.trim()) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "수정할 본문이 비어 있습니다. (2번째 줄부터 내용을 적어주세요)",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }

    const existsRoom = await readTrigger("room", roomId, keyNorm);
    if (!existsRoom) {
      const existsGlobal = await readTrigger("global", "__global__", keyNorm);
      const hint = existsGlobal
        ? `참고: 전체 공통 키로 '${existsGlobal.keyDisplay}'가 있습니다. 방 전용으로 새로 만들려면 \`!등록 ${key}\`를 사용하세요.`
        : "먼저 `!등록`으로 등록해주세요.";
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: `수정할 키가 없습니다: !${key}\n${hint}`,
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }

    const rec: TriggerRecord = {
      scope: "room",
      roomId,
      keyNorm,
      keyDisplay: key,
      body: body.trimEnd(),
    };
    const upd = await updateTrigger(rec, senderId);
    if (!upd.ok) {
      const msg = upd.reason === "NOT_FOUND" ? `수정할 키가 없습니다: !${key}` : "수정에 실패했습니다.";
      await sendReplyToMessage({ runtime, roomId, replyText: msg, srcLogId, srcUserId: senderId, srcType, srcMessage });
      return;
    }

    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: `수정 완료: !${key}`,
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
    return;
  }

  if (cmd.kind === "delete") {
    const key = safeString(cmd.key);
    const keyNorm = normalizeKey(key);
    if (!keyNorm) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "사용법: `!삭제 <키>`",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }
    const exists = await readTrigger("room", roomId, keyNorm);
    if (!exists) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: `삭제할 키가 없습니다: !${key}`,
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }
    const del = await irisQuery("delete from command_triggers where scope='room' and room_id=? and key_norm=?", [roomId, keyNorm], 8000);
    if (!del.ok) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "삭제에 실패했습니다.",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
    }
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: `삭제 완료: !${exists.keyDisplay}`,
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
    return;
  }

  if (cmd.kind === "trigger") {
    const keyNorm = normalizeKey(cmd.key);
    if (!keyNorm) return;

    const local = await readTrigger("room", roomId, keyNorm);
    const found = local || (await readTrigger("global", "__global__", keyNorm));
    if (!found || !found.body) return;

    const ok = await sendReplyToMessage({
      runtime,
      roomId,
      replyText: found.body,
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
    if (ok) {
      await bumpUsage(found.scope, found.scope === "global" ? "__global__" : roomId, keyNorm);
    }
    return;
  }
}

async function connectAndRun(): Promise<void> {
  await ensureSchema();
  const state = await loadState();
  let lastSeenMs = state.lastSeenMs || 0;
  const lastSeenMsRef = { v: lastSeenMs };

  const startedAt = new Date().toISOString();
  await updateStatus({ startedAt, heartbeatTs: startedAt, lastSeenMs: lastSeenMsRef.v });
  const hbTimer = setInterval(() => {
    void updateStatus({ heartbeatTs: new Date().toISOString(), lastSeenMs: lastSeenMsRef.v });
  }, 30_000);
  try {
    const t: any = hbTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  const stateTimer = setInterval(() => {
    const snapshot: WorkerState = { lastSeenMs: lastSeenMsRef.v, updatedAt: new Date().toISOString() };
    void saveState(snapshot).catch((e) => logger.warn("[state] save failed", { err: String(e) }));
  }, 15_000);
  try {
    const t: any = stateTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  while (true) {
    const runtime = await loadRuntime();

    // 신규 방을 수동으로 runtime.allowlist에 추가하지 않아도 되도록, Realtime /rooms 기반으로 자동 발견한다.
    const discovered = await fetchRoomsFromRealtime(4000);
    let discoveredIds = discovered.map((x) => safeString(x.roomId)).filter(Boolean);

    // “최근 메시지 기록이 있는 방” 판정: /logs/bulk(limit=1) 기반
    // - 이 판정은 (1) default-on(feature) 적용 (2) 멤버 DB 자동 로딩 트리거(ADB) 범위 제한에 사용한다.
    let latestByRoom = new Map<string, number>();
    let activeSet = new Set<string>();
    const recentWindowMs = Math.max(1, RECENT_ACTIVITY_HOURS) * 60 * 60 * 1000;
    if (discoveredIds.length > 0) {
      latestByRoom = await fetchLatestLogMsByRoom(discoveredIds, 4500);
      const nowMs = Date.now();
      for (const rid of discoveredIds) {
        const ms = latestByRoom.get(rid) || 0;
        if (ms > 0 && nowMs - ms <= recentWindowMs) activeSet.add(rid);
      }
    }

    // send-gate는 feature 토글/SAFE_MODE로 계속 보호되므로,
    // allowlist는 "리스닝/기초 운영 데이터" 기준으로 자동 병합한다.
    // (excludedRoomIds는 존중)
    if (discoveredIds.length > 0) {
      await ensureAllowlistHasRooms(runtime, discoveredIds);
      await ensureCommandsDefaultOn(runtime, discoveredIds, activeSet);
    }

    // 방장/부방장(운영진) 스냅샷을 주기적으로 갱신한다.
    // - 신규 방 발견 시 최초 1회 reason=new_room로 갱신한다.
    const adminsSnap = await getRoomAdminsSnapshotCached();
    if (discovered.length > 0) {
      for (const it of discovered) {
        const rid = safeString(it.roomId);
        if (!rid) continue;
        const exists = !!adminsSnap.rooms?.[rid];
        void refreshRoomAdminsForRoom(rid, it.roomName, exists ? "periodic" : "new_room", {
          isActive: activeSet.has(rid),
          latestLogMs: latestByRoom.get(rid) || 0,
        }).catch(() => {});
      }
    } else {
      // fallback: 최소한 기존 allowlist 대상은 갱신
      const rooms = Array.isArray(runtime.allowedRoomIds)
        ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
        : [];
      discoveredIds = rooms;
      if (rooms.length > 0) {
        latestByRoom = await fetchLatestLogMsByRoom(rooms, 4500);
        const nowMs = Date.now();
        activeSet = new Set<string>();
        for (const rid of rooms) {
          const ms = latestByRoom.get(rid) || 0;
          if (ms > 0 && nowMs - ms <= recentWindowMs) activeSet.add(rid);
        }
      }
      for (const rid of rooms) {
        const exists = !!adminsSnap.rooms?.[rid];
        void refreshRoomAdminsForRoom(rid, rid, exists ? "periodic" : "new_room", {
          isActive: activeSet.has(String(rid)),
          latestLogMs: latestByRoom.get(String(rid)) || 0,
        }).catch(() => {});
      }
    }

    // command-worker는 명령어(!) 처리 대상 room만 SSE로 구독한다.
    // (전체 방 SSE 구독은 노이즈/부하가 커서 금지)
    const rtForSse = (await fetchRuntimeFromRealtime(2000)) || runtime;
    const rooms = Object.entries(rtForSse.features || {})
      .filter(([, v]) => v && typeof v === "object" && (v as any).commands === true)
      .map(([rid]) => safeString(rid))
      .filter(Boolean);

    if (rooms.length === 0) {
      // commands가 켜진 방이 없더라도, admin snapshot 갱신은 위에서 수행한다.
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
              // /logs/stream은 연결 직후 "snapshot"을 1회 내보낸다.
              // 워커는 snapshot을 처리하면 (특히 TTL reconnect 시) 과거 메시지를 다시 실행하는 문제가 생기므로,
              // "append"(증분)만 처리한다.
              if (payload?.type && String(payload.type) !== "append") continue;
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

    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  await acquireSingletonLock();
  logger.info("command-worker start", {
    pid: process.pid,
    realtime: process.env.REALTIME_API_BASE || "http://127.0.0.1:8650",
    irisQuery: process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050",
  });
  await connectAndRun();
}

if (require.main === module) {
  void main().catch((e) => {
    logger.error("command-worker crashed", { err: String(e) });
    process.exit(1);
  });
}
