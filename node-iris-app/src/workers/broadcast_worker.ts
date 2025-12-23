import crypto from "crypto";
import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { broadcastService } from "../services";
import { downloadUrlAsBase64 } from "../utils/download";
import { tryServerIrisReplyMedia, tryServerIrisReplyText, type IrisReplyVerifyOptions } from "../utils/iris";
import { APP_ROOT } from "../utils/paths";
import { tryServerTalkApiDispatch } from "../utils/talkapi";

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
  imageUrls?: unknown;
};

type AnnouncementRoute = {
  id: string;
  source: string;
  targets: string[];
  enabled: boolean;
  includeImages?: boolean;
  includeSenderName?: boolean;
  delayMs?: number;
  appendTargetIndex?: boolean;
  targetIndexStart?: number;
};

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
  announcement?: {
    routes?: AnnouncementRoute[];
  };
};

type WorkerState = {
  lastSeenMs: number;
  updatedAt: string;
};

type IrisMediaHealthRoom = {
  lastOkAt?: number;
  lastFailAt?: number;
  consecutiveFails?: number;
};

type IrisMediaHealthFile = {
  updatedAt: string;
  rooms: Record<string, IrisMediaHealthRoom>;
};

const logger = new Logger("broadcast-worker");

const STATE_PATH = path.join(APP_ROOT, "data", "broadcast_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "broadcast_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "broadcast_worker.lock");

// Loop/multi-delivery protection
const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분
const ANNOUNCE_DEDUP = new DedupCache(5 * 60 * 1000); // 5분 (source msgId/uid 기준)
const TARGET_DEDUP = new DedupCache(5 * 60 * 1000); // 5분 (source msg -> target 전달)
const SENT_IMAGE_DEDUP = new DedupCache(3 * 60 * 1000); // 3분 (worker가 보낸 이미지 감지용)
const SENT_TEXT_DEDUP = new DedupCache(3 * 60 * 1000); // 3분 (worker가 보낸 텍스트 감지용)

// IRIS/Talk-API senderId (루프/자기 복제 방지)
const IRIS_SENDER_ID = "434886784";

// IRIS /reply_media 는 HTTP 200으로 빠르게 응답해도 실제 UI 전송이 뒤늦게(또는 실패) 처리될 수 있다.
// 공지 미러링(여러 방 연속 발신)에서는 속도가 너무 빠르면 “성공으로 보고되는데 실제 미발신”이 발생할 수 있어,
// 1) 최소 간격을 강제하고 2) MessageStore 로그로 1차 확인(에코) 후 성공으로 판정한다.
const IRIS_MEDIA_MIN_GAP_MS = 200;
const IRIS_MEDIA_CALL_TIMEOUT_MS = 90_000;
function envInt(name: string, fallback: number): number {
  const raw = safeString(process.env[name]);
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.floor(n);
}

const IRIS_MEDIA_ECHO_TIMEOUT_MS = envInt("IRIS_MEDIA_ECHO_TIMEOUT_MS", 18_000);
const IRIS_MEDIA_SENDLOG_TIMEOUT_MS = envInt("IRIS_MEDIA_SENDLOG_TIMEOUT_MS", 25_000);
const IRIS_MEDIA_MAX_RETRIES = envInt("IRIS_MEDIA_MAX_RETRIES", 1);
const IRIS_MEDIA_RETRY_DELAY_MS = envInt("IRIS_MEDIA_RETRY_DELAY_MS", 1200);
const IRIS_MEDIA_VERIFY_BASE: IrisReplyVerifyOptions = {
  echoTimeoutMs: IRIS_MEDIA_ECHO_TIMEOUT_MS,
  sendlogTimeoutMs: IRIS_MEDIA_SENDLOG_TIMEOUT_MS,
  maxRetries: IRIS_MEDIA_MAX_RETRIES,
  retryDelayMs: IRIS_MEDIA_RETRY_DELAY_MS,
};

// 최근에 IRIS 이미지 발송이 실패했던 방은, 같은 공지 내에서 추가 retry를 시도해도 체감 속도만 느려지는 경우가 많다.
// 따라서 "최근 실패(10분)" 방은 첫 시도까지만 하고, 같은 공지 내 retry 대상에서 제외한다.
// Announcement image forwarding can be very slow when we re-upload large images to many rooms.
// Prefer downloading a resized variant from Kakao CDN to reduce upload time per room (IRIS /reply).
const ANNOUNCE_IMAGE_MAX_EDGE = envInt("ANNOUNCE_IMAGE_MAX_EDGE", 1024);
const ANNOUNCE_IMAGE_DOWNLOAD_TIMEOUT_MS = envInt("ANNOUNCE_IMAGE_DOWNLOAD_TIMEOUT_MS", 15_000);

const IRIS_MEDIA_HEALTH_PATH = path.join(APP_ROOT, "data", "iris_media_health.json");
const IRIS_MEDIA_RECENT_FAIL_TTL_MS = 10 * 60 * 1000;

// (Legacy) mirror marker detection
// - 과거에는 루프 방지용으로 텍스트 끝에 숨김 마커를 붙였으나, 일부 환경에서 zero-width가 제거되며
//   마커가 그대로 노출되는 문제가 있어 더 이상 추가하지 않는다.
const MIRROR_MARKER_REGEX = /\u200B?\[MF:[^\]]+\]\u200B?/;

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
const RUNTIME_CACHE_MS = 1500;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function maybeResizeKakaoCdnUrl(rawUrl: string, maxEdge: number): string {
  const u = safeString(rawUrl);
  const edge = Math.floor(Number(maxEdge));
  if (!u) return u;
  if (!Number.isFinite(edge) || edge <= 0) return u;

  try {
    const parsed = new URL(u);
    const host = String(parsed.hostname || "").toLowerCase();
    if (!host.endsWith("kakaocdn.net")) return u;
    parsed.searchParams.set("convert", "resize");
    parsed.searchParams.set("w", String(edge));
    parsed.searchParams.set("h", String(edge));
    return parsed.toString();
  } catch {
    if (!u.startsWith("http://") && !u.startsWith("https://")) return u;
    if (!u.includes("kakaocdn.net")) return u;
    const sep = u.includes("?") ? "&" : "?";
    return `${u}${sep}convert=resize&w=${edge}&h=${edge}`;
  }
}

function sleepMs(ms: number): Promise<void> {
  const t = Math.max(0, Math.floor(ms));
  if (t === 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, t));
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
      logger.warn("[lock] 다른 broadcast-worker가 이미 실행 중이므로 종료합니다.", { pid: oldPid, lockPath: LOCK_PATH });
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
        // eslint-disable-next-line no-console
        console.error("[broadcast-worker] cleanup tmp failed:", e);
      }
    }
  }
}

function numOrZero(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function getIrisMediaRoomHealthSnapshot(health: IrisMediaHealthFile, roomId: string): IrisMediaHealthRoom {
  const rid = safeString(roomId);
  if (!rid) return {};
  const raw = health.rooms[rid];
  if (!raw || typeof raw !== "object") return {};
  return {
    lastOkAt: numOrZero((raw as any).lastOkAt) || undefined,
    lastFailAt: numOrZero((raw as any).lastFailAt) || undefined,
    consecutiveFails: numOrZero((raw as any).consecutiveFails) || undefined,
  };
}

function hasRecentIrisMediaFail(room: IrisMediaHealthRoom, nowMs: number): boolean {
  const lastFailAt = numOrZero(room.lastFailAt);
  if (!lastFailAt) return false;
  return nowMs - lastFailAt < IRIS_MEDIA_RECENT_FAIL_TTL_MS;
}

async function loadIrisMediaHealth(): Promise<IrisMediaHealthFile> {
  const obj = await readJsonSafe(IRIS_MEDIA_HEALTH_PATH);
  const roomsRaw = obj.rooms;
  const rooms = (roomsRaw && typeof roomsRaw === "object") ? (roomsRaw as Record<string, unknown>) : {};

  const outRooms: Record<string, IrisMediaHealthRoom> = {};
  for (const [rid, v] of Object.entries(rooms)) {
    if (!rid || !v || typeof v !== "object") continue;
    const r: any = v;
    const lastOkAt = numOrZero(r.lastOkAt) || undefined;
    const lastFailAt = numOrZero(r.lastFailAt) || undefined;
    const consecutiveFails = numOrZero(r.consecutiveFails) || undefined;
    if (!lastOkAt && !lastFailAt && !consecutiveFails) continue;
    outRooms[rid] = { lastOkAt, lastFailAt, consecutiveFails };
  }

  const updatedAt = typeof obj.updatedAt === "string" && obj.updatedAt ? obj.updatedAt : new Date().toISOString();
  return { updatedAt, rooms: outRooms };
}

async function updateIrisMediaHealthBatch(ok: Set<string>, failed: Set<string>): Promise<void> {
  try {
    const cur = await loadIrisMediaHealth();
    const nowMs = Date.now();

    const rooms: Record<string, IrisMediaHealthRoom> = { ...cur.rooms };

    for (const rid0 of failed) {
      const rid = safeString(rid0);
      if (!rid) continue;
      const prev = rooms[rid] || {};
      const prevConsecutive = numOrZero(prev.consecutiveFails);
      rooms[rid] = {
        ...prev,
        lastFailAt: nowMs,
        consecutiveFails: prevConsecutive + 1,
      };
    }

    for (const rid0 of ok) {
      const rid = safeString(rid0);
      if (!rid) continue;
      const prev = rooms[rid] || {};
      rooms[rid] = {
        ...prev,
        lastOkAt: nowMs,
        consecutiveFails: 0,
      };
    }

    await writeJsonAtomic(IRIS_MEDIA_HEALTH_PATH, { updatedAt: new Date().toISOString(), rooms });
  } catch {
    // keep best-effort only (no fallback)
  }
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
  // SAFE_MODE 기본 true (발신 차단)
  return runtime.safeMode !== false;
}

function isRoomAllowed(runtime: RuntimeConfig, roomId: string): boolean {
  const list = Array.isArray(runtime.allowedRoomIds)
    ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (list.length === 0) return false;
  return list.includes(String(roomId));
}

function isRoomAllowedForAnnouncement(runtime: RuntimeConfig, roomId: string): boolean {
  const rid = String(roomId);
  if (!isRoomAllowed(runtime, rid)) return false;
  const excluded = Array.isArray(runtime.excludedRoomIds)
    ? runtime.excludedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (excluded.includes(rid)) return false;
  return true;
}

function isFeatureEnabled(runtime: RuntimeConfig, roomId: string, feature: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[String(roomId)];
  if (!flags || typeof flags !== "object") return false;
  return (flags as any)[feature] === true;
}

function normalizeText(text: string | undefined): string {
  return String(text || "").trim().normalize("NFC");
}

function normalizeTextForHash(text: string | undefined): string {
  // Kakao가 공백/개행을 일부 정규화할 수 있어, 해시 비교용은 공백을 단일 스페이스로 축약한다.
  return normalizeText(text).replace(/\s+/g, " ");
}

function hasMirrorMarker(text: string): boolean {
  if (!text) return false;
  return MIRROR_MARKER_REGEX.test(text);
}

async function resolveRoomNames(roomIds: string[], timeoutMs = 3000): Promise<Map<string, string>> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const it of roomIds) {
    const rid = safeString(it);
    if (!rid) continue;
    if (seen.has(rid)) continue;
    seen.add(rid);
    ids.push(rid);
    if (ids.length >= 500) break;
  }
  if (ids.length === 0) return new Map();

  const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
  const url = `${base}/rooms/resolve`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomIds: ids }),
      signal: ctrl.signal,
    });
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const detail = typeof data === "object" && data ? JSON.stringify(data).slice(0, 400) : String(data || "");
      throw new Error(`Realtime API /rooms/resolve 실패: HTTP ${res.status} ${detail}`);
    }
    const obj = (data && typeof data === "object") ? (data as Record<string, unknown>) : null;
    const ok = obj ? obj.ok : null;
    const names = obj ? obj.names : null;
    if (ok !== true || !names || typeof names !== "object") {
      throw new Error("Realtime API /rooms/resolve 응답 형식 오류");
    }

    const map = new Map<string, string>();
    for (const [rid, name] of Object.entries(names as Record<string, unknown>)) {
      const rid2 = safeString(rid);
      const name2 = safeString(name);
      if (!rid2 || !name2) continue;
      map.set(rid2, name2);
    }
    return map;
  } finally {
    clearTimeout(t);
  }
}

function normalizeImageUrls(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v.map((x) => safeString(x)).filter(Boolean);
  }
  const s = safeString(v);
  return s ? [s] : [];
}

function hashImageUrls(urls: string[]): string {
  const norm = urls.map((u) => u.trim()).filter(Boolean).sort().join("|");
  return crypto.createHash("sha1").update(norm).digest("hex");
}

function hashTextForDedup(text: string): string {
  const norm = normalizeTextForHash(text);
  return crypto.createHash("sha1").update(norm).digest("hex");
}

function isImageMessageType(msgType: unknown): boolean {
  const rawType = typeof msgType === "number" ? msgType : Number(msgType);
  if (!Number.isFinite(rawType)) return false;
  const baseType = (rawType as number) & ~16384;
  return baseType === 2 || baseType === 27 || baseType === 71;
}

function shouldIgnoreSender(entry: StreamEntry): boolean {
  const sid = safeString(entry.senderId);
  const sn = safeString(entry.senderName || entry.sender).toLowerCase();
  const ignoreIds = [IRIS_SENDER_ID]; // IRIS 계정(senderId) - 루프/자기 복제 방지
  const ignoreNames = ["iris"];
  if (sid && ignoreIds.includes(sid)) return true;
  if (sn && ignoreNames.includes(sn)) return true;
  return false;
}

async function dispatchIrisImagesToTargets(
  targetIdsRaw: string[],
  imagesBase64: string[],
  gapMsList: number[],
): Promise<Set<string>> {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const ridRaw of targetIdsRaw) {
    const rid = safeString(ridRaw);
    if (!rid) continue;
    if (seen.has(rid)) continue;
    seen.add(rid);
    unique.push(rid);
  }
  if (unique.length === 0) return new Set();

  const health = await loadIrisMediaHealth();
  const roomHealthAtStart = new Map<string, IrisMediaHealthRoom>();
  for (const rid of unique) {
    roomHealthAtStart.set(rid, getIrisMediaRoomHealthSnapshot(health, rid));
  }

  const okFinal = new Set<string>();
  const failedFinal = new Set<string>();
  const nowMsAtStart = Date.now();

  const orderedTargets = unique
    .slice()
    .sort((a, b) => {
      const ha = roomHealthAtStart.get(a) || {};
      const hb = roomHealthAtStart.get(b) || {};
      const fa = hasRecentIrisMediaFail(ha, nowMsAtStart) ? 1 : 0;
      const fb = hasRecentIrisMediaFail(hb, nowMsAtStart) ? 1 : 0;
      if (fa !== fb) return fa - fb; // recent-fail last

      const oka = numOrZero(ha.lastOkAt);
      const okb = numOrZero(hb.lastOkAt);
      if (oka !== okb) return okb - oka; // recent-ok first

      const la = numOrZero(ha.lastFailAt);
      const lb = numOrZero(hb.lastFailAt);
      if (la !== lb) return la - lb; // older fail first (more chance to recover)

      return String(a).localeCompare(String(b));
    });

  const gaps = Array.isArray(gapMsList) && gapMsList.length > 0 ? gapMsList : [IRIS_MEDIA_MIN_GAP_MS];
  const gapBetweenRooms = Math.max(0, Math.floor(gaps[0] ?? 0));

  // NOTE:
  // Realtime API(/send/iris/reply_media)는 server에서 "MessageStore 이미지 echo + chat_sending_logs 비움"을 확인한 뒤에만 ok=true를 반환한다.
  // 따라서 worker에서는 "요청 직렬화"만 유지하고, 성공 판정은 응답 ok에 따른다.
  for (let i = 0; i < orderedTargets.length; i += 1) {
    const roomId = orderedTargets[i]!;
    const roomHealth = roomHealthAtStart.get(roomId) || {};
    const verify: IrisReplyVerifyOptions = hasRecentIrisMediaFail(roomHealth, nowMsAtStart)
      ? { ...IRIS_MEDIA_VERIFY_BASE, maxRetries: 0 }
      : IRIS_MEDIA_VERIFY_BASE;
    const okCall = await tryServerIrisReplyMedia(logger, roomId, imagesBase64, IRIS_MEDIA_CALL_TIMEOUT_MS, verify);
    if (okCall) okFinal.add(roomId);
    else failedFinal.add(roomId);
    if (i < orderedTargets.length - 1 && gapBetweenRooms > 0) {
      await sleepMs(gapBetweenRooms);
    }
  }

  await updateIrisMediaHealthBatch(okFinal, failedFinal);
  return okFinal;
}

async function handleAnnouncement(entry: StreamEntry): Promise<void> {
  const dispatcher = String(process.env.ANNOUNCEMENT_DISPATCHER || "worker").trim().toLowerCase();
  if (dispatcher === "bot") return;

  if (safeString(entry.payloadType) !== "message") return;
  if (shouldIgnoreSender(entry)) return;

  const roomId = safeString(entry.roomId);
  if (!roomId) return;

  const runtime = await loadRuntime();
  if (isSafeModeOn(runtime)) return;

  // source allow/exclude
  if (!isRoomAllowedForAnnouncement(runtime, roomId)) return;

  const routes = Array.isArray(runtime.announcement?.routes) ? runtime.announcement?.routes : [];
  const activeRoutes = (routes || []).filter((r) => r && r.enabled === true && String(r.source) === roomId);
  if (activeRoutes.length === 0) return;

  const msgId = safeString(entry.uid) || safeString(entry.mid);
  if (!msgId) return;
  if (ANNOUNCE_DEDUP.isDuplicate(`${roomId}:${msgId}`)) return;

  const images = normalizeImageUrls((entry as any).imageUrls);
  const limitedImages = images.slice(0, 6);
  let imagesBase64Cache: string[] | null = null;
  let imagesBase64Tried = false;

  // 이미지 메시지는 messageText가 "사진"/"photo"로 들어오는 경우가 많다.
  // 공지 미러링에서는 placeholder 텍스트를 그대로 전파하지 않고, 실제 이미지 전송만 수행한다.
  const isImageMsg = isImageMessageType(entry.messageType);

  let text = normalizeText(entry.text);
  if (images.length > 0 && isImageMsg) {
    const t = text.trim();
    if (t === "사진" || t.toLowerCase() === "photo") {
      text = "";
    }
  }
  if (!text && images.length === 0) return;

  // 공지 결과 메시지는 소스방에만 남기고, 타겟으로 재전파되면 안 된다.
  // (senderId 기반 ignore가 누락되는 케이스를 대비해, prefix 기반으로도 차단한다)
  const RESULT_PREFIXES = ["[공지 전파 결과]", "📣 공지 전송 결과"];
  if (text && RESULT_PREFIXES.some((p) => text.startsWith(p))) return;

  // loop prevent (legacy marker)
  if (text && hasMirrorMarker(text)) return;

  const senderName = safeString(entry.senderName || entry.sender);

  logger.info("[announce] triggered", {
    source: roomId,
    routeCount: activeRoutes.length,
    hasText: !!text,
    imageCount: images.length,
    senderName: senderName || undefined,
  });

  let roomNameMap: Map<string, string> | null = null;
  let roomNameErr: string | null = null;
  try {
    const resolveIds = new Set<string>();
    resolveIds.add(roomId);
    for (const route of activeRoutes) {
      const targets = Array.isArray(route.targets) ? route.targets.map((x) => safeString(x)).filter(Boolean) : [];
      for (const t of targets) {
        if (!t) continue;
        resolveIds.add(t);
      }
    }
    roomNameMap = await resolveRoomNames(Array.from(resolveIds), 3000);
  } catch (e) {
    roomNameErr = e instanceof Error ? e.message : String(e);
    logger.warn("[announce] 방 이름 조회 실패(임시 라벨 표시)", { err: roomNameErr });
  }

  const unknownLabels = new Map<string, string>();
  let unknownSeq = 0;
  const roomLabel = (rid: string) => {
    const key = safeString(rid);
    const name = roomNameMap ? safeString(roomNameMap.get(key)) : "";
    if (name && name !== key) return name;
    if (!key) return "알 수 없는 방";
    const prev = unknownLabels.get(key);
    if (prev) return prev;
    unknownSeq += 1;
    const label = `알 수 없는 방 ${unknownSeq}`;
    unknownLabels.set(key, label);
    return label;
  };

  const sourceName = roomLabel(roomId);
  const resultLines: string[] = [];
  resultLines.push("📣 공지 전송 결과");
  if (roomNameErr) {
    resultLines.push("⚠️ 방 이름 조회 실패로 일부 방 이름이 임시 라벨로 표시될 수 있어요");
  }

  const normalizeInfoText = (t: string) => normalizeText(t).replace(/\s+/g, " ").trim();
  const infoText = text ? normalizeInfoText(text) : "";
  const infoTextShort = infoText ? (infoText.length > 220 ? `${infoText.slice(0, 220)}…` : infoText) : "(텍스트 없음)";

  async function ensureImagesBase64(): Promise<string[]> {
    if (imagesBase64Cache) return imagesBase64Cache;
    if (imagesBase64Tried) return [];
    imagesBase64Tried = true;

    const out: string[] = [];
    for (const url of limitedImages) {
      const resizedUrl =
        ANNOUNCE_IMAGE_MAX_EDGE > 0 ? maybeResizeKakaoCdnUrl(url, ANNOUNCE_IMAGE_MAX_EDGE) : safeString(url);
      try {
        out.push(await downloadUrlAsBase64(resizedUrl, ANNOUNCE_IMAGE_DOWNLOAD_TIMEOUT_MS));
        continue;
      } catch (e) {
        if (resizedUrl && resizedUrl !== url) {
          try {
            out.push(await downloadUrlAsBase64(url, ANNOUNCE_IMAGE_DOWNLOAD_TIMEOUT_MS));
            continue;
          } catch (e2) {
            logger.warn("[announce] image download failed", { roomId, url, err: String(e2) });
            continue;
          }
        }
        logger.warn("[announce] image download failed", { roomId, url, err: String(e) });
      }
    }
    imagesBase64Cache = out;
    return out;
  }

  for (const route of activeRoutes) {
    const targetsRaw = Array.isArray(route.targets) ? route.targets.map((x) => safeString(x)).filter(Boolean) : [];
    const targetsUniq = Array.from(new Set(targetsRaw.map((t) => safeString(t)).filter(Boolean).filter((t) => t !== roomId)));

    const excluded = Array.isArray(runtime.excludedRoomIds)
      ? runtime.excludedRoomIds.map((x) => safeString(x)).filter(Boolean)
      : [];
    const notAllowedTargets = targetsUniq.filter((t) => !isRoomAllowed(runtime, t));
    const excludedTargets = targetsUniq.filter((t) => isRoomAllowed(runtime, t) && excluded.includes(t));
    const validTargets = targetsUniq.filter((t) => isRoomAllowedForAnnouncement(runtime, t));
    if (validTargets.length === 0) {
      resultLines.push("");
      resultLines.push(`📌 ${route.id}`);
      resultLines.push(`⚠️ 발송 대상 0개 (설정:${targetsUniq.length}, 스킵:${targetsUniq.length})`);
      if (notAllowedTargets.length > 0) {
        const labels = notAllowedTargets.slice(0, 30).map((rid) => roomLabel(rid));
        resultLines.push(`🚫 allowlist 제외: ${labels.join(", ")}${notAllowedTargets.length > 30 ? ` 외 ${notAllowedTargets.length - 30}개` : ""}`);
      }
      if (excludedTargets.length > 0) {
        const labels = excludedTargets.slice(0, 30).map((rid) => roomLabel(rid));
        resultLines.push(`🚫 excludedRoomIds: ${labels.join(", ")}${excludedTargets.length > 30 ? ` 외 ${excludedTargets.length - 30}개` : ""}`);
      }
      continue;
    }

    const delayMs = typeof route.delayMs === "number" && Number.isFinite(route.delayMs) ? Math.max(0, route.delayMs) : 500;
    const includeSender = route.includeSenderName === true;
    const includeImages = route.includeImages !== false;
    const startIndexRaw = route.targetIndexStart;
    const startIndex = typeof startIndexRaw === "number" && Number.isFinite(startIndexRaw)
      ? Math.max(1, Math.floor(startIndexRaw))
      : 1;

    let finalText = text;
    if (includeSender && finalText && senderName) {
      finalText = `[${senderName}] ${finalText}`;
    }

    const textOkByTarget = new Map<string, boolean>();
    const imageOkByTarget = new Map<string, boolean>();
    const processedTargets: string[] = [];
    const irisImageTargets: string[] = [];
    for (let idx = 0; idx < validTargets.length; idx++) {
      const targetId = validTargets[idx];
      const targetKey = `${roomId}:${msgId}:${targetId}`;
      if (TARGET_DEDUP.isDuplicate(targetKey)) continue;
      processedTargets.push(targetId);


      // 더 이상 숨김 마커를 텍스트 끝에 붙이지 않는다(일부 환경에서 마커가 그대로 노출됨).
      const textToSend = finalText
        ? `${finalText}${route.appendTargetIndex ? ` ${startIndex + idx}` : ""}`
        : "";

      let textOk = true;
      if (textToSend) {
        if (delayMs > 0) {
          await sleepMs(delayMs);
        }
        const h = hashTextForDedup(textToSend);
        SENT_TEXT_DEDUP.mark(`sent_txt:${targetId}:${h}`);
        const okTalk = await tryServerTalkApiDispatch(logger, targetId, textToSend, [], 12000);
        const okIris = okTalk ? false : await tryServerIrisReplyText(logger, targetId, textToSend, 12000);
        textOk = okTalk || okIris;
      }
      textOkByTarget.set(targetId, textOk);

      if (includeImages && images.length > 0) {
        const h = hashImageUrls(images);
        // Record "sent image" so when the mirrored image appears in logs we can ignore it.
        // (No visible marker in the message body)
        SENT_IMAGE_DEDUP.mark(`sent_img:${targetId}:${h}`);
        irisImageTargets.push(targetId);
      }
    }

    if (includeImages && images.length > 0 && irisImageTargets.length > 0) {
      const imagesBase64 = await ensureImagesBase64();
      if (imagesBase64.length === 0) {
        for (const rid of irisImageTargets) imageOkByTarget.set(rid, false);
      } else {
        const gapFast = Math.max(delayMs, IRIS_MEDIA_MIN_GAP_MS);
        const okSet = await dispatchIrisImagesToTargets(irisImageTargets, imagesBase64, [gapFast]);
        for (const rid of irisImageTargets) {
          imageOkByTarget.set(rid, okSet.has(rid));
        }
      }
    }

    let successCount = 0;
    let failCount = 0;
    const okNames: string[] = [];
    const failNames: string[] = [];

    for (const targetId of processedTargets) {
      const okText = textOkByTarget.get(targetId) !== false;
      const okImg = includeImages && images.length > 0 ? imageOkByTarget.get(targetId) === true : true;
      const ok = okText && okImg;
      if (ok) {
        successCount += 1;
        okNames.push(roomLabel(targetId));
      } else {
        failCount += 1;
        failNames.push(roomLabel(targetId));
      }
    }

    logger.info("[announce] completed", {
      source: roomId,
      routeId: route.id,
      targets: validTargets.length,
      success: successCount,
      failed: failCount,
    });
    await updateStatus({
      lastAnnouncementAttemptTs: new Date().toISOString(),
      lastAnnouncementSourceRoomId: roomId,
      lastAnnouncementRouteId: route.id,
      lastAnnouncementTargets: validTargets.length,
      lastAnnouncementSuccess: successCount,
      lastAnnouncementFailed: failCount,
      lastAnnouncementOk: failCount === 0,
    });

    resultLines.push("");

    resultLines.push(`전송 성공 : ${successCount}개`);
    resultLines.push(`전송 실패 : ${failCount}개`);
    resultLines.push("ㅡㅡㅡㅡㅡ");

    resultLines.push("[ 실패한 방]");
    if (failNames.length === 0) {
      resultLines.push("없음");
    } else {
      for (const n of failNames) resultLines.push(n);
    }

    resultLines.push("");
    resultLines.push("[ 성공한 방]");
    if (okNames.length === 0) {
      resultLines.push("없음");
    } else {
      for (const n of okNames) resultLines.push(n);
    }
    resultLines.push("ㅡㅡㅡㅡㅡ");

    resultLines.push("📝 발송 정보");
    resultLines.push(`출처: ${sourceName}`);
    if (images.length > 0) resultLines.push(`첨부: 이미지 ${images.length}장`);
    resultLines.push(`내용: ${infoTextShort}`);
  }

  const msg = resultLines.join("\n");
  const okTalk = await tryServerTalkApiDispatch(logger, roomId, msg, [], 12000);
  if (!okTalk) {
    await tryServerIrisReplyText(logger, roomId, msg, 12000);
  }
}

async function dispatchBroadcastQueueTick(): Promise<void> {
  const dispatcher = String(process.env.BROADCAST_DISPATCHER || "worker").trim().toLowerCase();
  if (dispatcher === "bot") return;

  const runtime = await loadRuntime();
  if (isSafeModeOn(runtime)) return;

  const tasks = await broadcastService.fetchDue(5);
  if (tasks.length === 0) return;

  for (const task of tasks) {
    let delivered = true;
    let retryError: string | null = null;

    for (const channel of task.channels) {
      const roomId = safeString(channel);
      if (!roomId) continue;

      try {
        const message = safeString((task.payload as any)?.message);
        if (!message) {
          throw new Error("Empty broadcast payload");
        }
        if (!isRoomAllowed(runtime, roomId) || !isFeatureEnabled(runtime, roomId, "broadcast")) {
          logger.warn("[broadcast] feature off or room not allowed; skip", { roomId, taskId: task.id });
          continue;
        }

        const okTalk = await tryServerTalkApiDispatch(logger, roomId, message, [], 12000);
        const okIris = okTalk ? false : await tryServerIrisReplyText(logger, roomId, message, 12000);
        const ok = okTalk || okIris;
        if (!ok) {
          throw new Error("talkapi dispatch failed");
        }
        logger.info("[broadcast] sent", { taskId: task.id, roomId });
      } catch (e) {
        delivered = false;
        retryError = e instanceof Error ? e.message : String(e);
        logger.error("[broadcast] send failed", { taskId: task.id, roomId, err: retryError });
        break;
      }
    }

    if (delivered) {
      await broadcastService.markSuccess(task.id);
      continue;
    }

    if (retryError) {
      // Worker는 infra 의존(Talk-API)이 있으므로, 실패 시도 횟수는 넉넉하게 둔다.
      await broadcastService.markRetry(task.id, retryError, 50);
    }
  }
}

function isSentByWorkerImageEcho(entry: StreamEntry): boolean {
  const roomId = safeString(entry.roomId);
  if (!roomId) return false;

  const images = normalizeImageUrls((entry as any).imageUrls);
  if (images.length === 0) return false;

  const h = hashImageUrls(images);
  const key = `sent_img:${roomId}:${h}`;
  return SENT_IMAGE_DEDUP.has(key);
}

function isSentByWorkerTextEcho(entry: StreamEntry): boolean {
  const roomId = safeString(entry.roomId);
  if (!roomId) return false;

  const text = normalizeTextForHash(entry.text);
  if (!text) return false;

  const h = hashTextForDedup(text);
  const key = `sent_txt:${roomId}:${h}`;
  return SENT_TEXT_DEDUP.has(key);
}

async function processEntry(entry: StreamEntry, lastSeenMsRef: { v: number }): Promise<void> {
  const roomId = safeString(entry.roomId);
  if (!roomId) return;

  const tsMs = tsToMs(entry.ts);
  if (tsMs && tsMs > lastSeenMsRef.v) lastSeenMsRef.v = tsMs;

  const payloadType = safeString(entry.payloadType);
  const dedupKey = safeString(entry.uid) || `${roomId}:${payloadType}:${safeString(entry.senderId)}:${safeString(entry.mid)}:${safeString(entry.ts)}`;
  if (EVENT_DEDUP.isDuplicate(dedupKey)) return;

  // mirrored image echo suppression (worker-sent)
  if (payloadType === "message" && isSentByWorkerImageEcho(entry)) {
    return;
  }
  // mirrored text echo suppression (worker-sent)
  if (payloadType === "message" && isSentByWorkerTextEcho(entry)) {
    return;
  }

  await handleAnnouncement(entry);
}

async function connectAndRun(): Promise<void> {
  const state = await loadState();
  let lastSeenMs = state.lastSeenMs || 0;
  const lastSeenMsRef = { v: lastSeenMs };

  const startedAt = new Date().toISOString();
  await updateStatus({ startedAt, heartbeatTs: startedAt, lastSeenMs: lastSeenMsRef.v });

  // status heartbeat
  const hbTimer = setInterval(() => {
    void updateStatus({ heartbeatTs: new Date().toISOString(), lastSeenMs: lastSeenMsRef.v });
  }, 30_000);
  try {
    const t: any = hbTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  // periodic state save
  const stateTimer = setInterval(() => {
    const snapshot: WorkerState = { lastSeenMs: lastSeenMsRef.v, updatedAt: new Date().toISOString() };
    void saveState(snapshot).catch((e) => logger.warn("[state] save failed", { err: String(e) }));
  }, 15_000);
  try {
    const t: any = stateTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  // broadcast queue dispatcher
  const dispatchMs = Math.max(1000, Number(process.env.BROADCAST_DISPATCH_INTERVAL_MS || "5000") || 5000);
  const dispatchTimer = setInterval(() => {
    void dispatchBroadcastQueueTick().catch((e) => logger.warn("[broadcast] tick failed", { err: String(e) }));
  }, dispatchMs);
  try {
    const t: any = dispatchTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  // reconnect loop (announcement sources)
  while (true) {
    const runtime = await loadRuntime();
    const enabledRoutes = Array.isArray(runtime.announcement?.routes) ? runtime.announcement?.routes : [];
    const sourceRooms = Array.from(
      new Set(
        (enabledRoutes || [])
          .filter((r) => r && r.enabled === true)
          .map((r) => safeString(r.source))
          .filter(Boolean),
      ),
    ).filter((rid) => isRoomAllowedForAnnouncement(runtime, rid));

    if (sourceRooms.length === 0) {
      logger.warn("[stream] announcement sources empty; sleeping");
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
    const since = Math.max(0, Math.floor(lastSeenMsRef.v > 0 ? lastSeenMsRef.v - 1000 : 0));
    const url = `${base}/logs/stream?rooms=${encodeURIComponent(sourceRooms.join(","))}&limit=200&since=${since}&interval=1000`;
    logger.info("[stream] connect", { url });

    try {
      const res = await fetch(url, { method: "GET", headers: { Accept: "text/event-stream" } });
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
              // 공지 워커는 snapshot을 처리하면 과거 소스 메시지를 다시 미러링할 수 있으므로,
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
      logger.warn("[stream] connection error", { err: String(e) });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  logger.info("broadcast-worker start", {
    pid: process.pid,
    realtime: process.env.REALTIME_API_BASE || "http://127.0.0.1:8650",
    dispatchIntervalMs: process.env.BROADCAST_DISPATCH_INTERVAL_MS || "5000",
  });
  await acquireSingletonLock();
  await connectAndRun();
}

if (require.main === module) {
  main().catch((e) => {
    // eslint-disable-next-line no-console
    console.error("[broadcast-worker] fatal:", e);
    process.exit(1);
  });
}
