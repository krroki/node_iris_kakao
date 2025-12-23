import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { generateGeminiWebImage, initGeminiWebSessionInteractive } from "../services/geminiWebImage";
import { tryServerIrisReplyMedia, tryServerIrisReplyText } from "../utils/iris";
import { APP_ROOT } from "../utils/paths";
import { tryServerTalkApiDispatchRaw } from "../utils/talkapi";

type StreamEntry = {
  ts?: string;
  roomId?: string;
  roomName?: string;
  senderId?: string;
  senderName?: string;
  sender?: string;
  text?: string;
  mid?: string;
  uid?: string | null;
  payloadType?: string;
  messageType?: unknown;
  imageUrls?: string[] | undefined;
};

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
  talkApi?: { enabled?: boolean } | undefined;
};

type WorkerState = {
  lastSeenMs: number;
  updatedAt: string;
};

type ImageCommand =
  | { kind: "generate"; prompt: string }
  | { kind: "edit"; prompt: string };

type RawLogRecord = {
  timestamp?: string;
  snapshot?: {
    roomId?: string;
    roomName?: string;
    senderId?: string;
    senderName?: string;
    messageId?: string;
    messageText?: string;
  };
  payload?: { type?: string; messageType?: unknown; attachment?: unknown };
};

const logger = new Logger("image-worker");

const STATE_PATH = path.join(APP_ROOT, "data", "image_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "image_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "image_worker.lock");
const LOGS_DIR = (() => {
  const override = String(process.env.IRIS_LOGS_DIR || "").trim();
  return override ? path.resolve(override) : path.join(APP_ROOT, "data", "logs");
})();

// 운영 진단/알림 로그는 항상 "테스트용 오픈채팅방"으로만 발신한다(운영방 오염 방지).
const OPS_LOG_ROOM_ID = "18462226881291012";

const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분

type QueuedJob = {
  enqueuedAt: number;
  roomId: string;
  senderId: string;
  senderName: string;
  cmd: ImageCommand;
  srcLogId: string;
  srcType: number;
  srcMessage: string;
};

const JOB_QUEUE: QueuedJob[] = [];
let queueRunning = false;
type ActiveJob = { roomId: string; kind: ImageCommand["kind"]; startedAt: number; slotId: string };
const activeJobs: ActiveJob[] = [];

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
const RUNTIME_CACHE_MS = 1500;
const STREAM_TTL_MS = Number.parseInt(String(process.env.IMAGE_WORKER_STREAM_TTL_MS || "").trim(), 10) || 60_000;
const MAX_CONCURRENCY = (() => {
  const raw = String(process.env.IMAGE_WORKER_MAX_CONCURRENCY || "").trim();
  const n = Number.parseInt(raw, 10);
  const v = Number.isFinite(n) && n > 0 ? n : 1;
  return Math.max(1, Math.min(3, v));
})();
const SLOT_IDS: string[] = Array.from({ length: MAX_CONCURRENCY }, (_, i) => String(i + 1));
const AVAILABLE_SLOT_IDS: string[] = [...SLOT_IDS];
const QUEUE_MAX = (() => {
  const raw = String(process.env.IMAGE_WORKER_QUEUE_MAX || "").trim();
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 30;
})();
const LOG_SEARCH_MAX_BYTES = (() => {
  const raw = String(process.env.IMAGE_WORKER_LOG_SEARCH_MAX_BYTES || "").trim();
  const n = Number.parseInt(raw, 10);
  // 기본값은 "희소 케이스(오래된 메시지 수정)"를 커버할 만큼만 넉넉히 둔다.
  return Number.isFinite(n) && n > 0 ? n : 8 * 1024 * 1024;
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
  // 숫자만으로 이뤄진 값은 userId일 가능성이 높으므로 노출 금지(닉네임 숫자-only도 보수적으로 가린다)
  if (/^\d{5,}$/.test(v)) return true;
  return false;
}

function resolveDisplayName(entry: StreamEntry): string {
  const sid = safeString(entry.senderId);
  const primary = safeString(entry.senderName);
  if (primary && !looksLikeUserId(primary, sid)) return primary;

  const fallback = safeString(entry.sender);
  if (fallback && !looksLikeUserId(fallback, sid)) return fallback;
  return "";
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

function normalizeKakaoMessageType(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 16384) return n - 16384;
  return n;
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
      logger.warn("[lock] 다른 image-worker가 이미 실행 중이므로 종료합니다.", { pid: oldPid, lockPath: LOCK_PATH });
      process.exit(0);
    }

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
        console.error("[image-worker] cleanup tmp failed:", e);
      }
    }
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

async function loadRuntime(force = false): Promise<RuntimeConfig> {
  const now = Date.now();
  if (!force && runtimeCache && now - runtimeCache.at < RUNTIME_CACHE_MS) return runtimeCache.data;
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

function computeImageRooms(runtime: RuntimeConfig): string[] {
  const allowedRooms = Array.isArray(runtime.allowedRoomIds)
    ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  return allowedRooms.filter((rid) => isRoomAllowed(runtime, rid) && isFeatureEnabled(runtime, rid, "imageGen"));
}

function parseImageCommand(text: string): ImageCommand | null {
  const normalized = String(text || "").trim().normalize("NFC");
  if (!normalized.startsWith("!")) return null;

  // Accept single-line or multi-line prompts (everything after command keyword)
  const lines = normalized.split(/\r?\n/);
  const first = (lines[0] || "").trim();
  const rest = [first, ...lines.slice(1)].join("\n");

  const variants: Array<{ re: RegExp; kind: ImageCommand["kind"] }> = [
    { re: /^!사진(?:\s+|$)([\s\S]*)$/u, kind: "generate" },
    { re: /^!그림(?:\s+|$)([\s\S]*)$/u, kind: "generate" },
    { re: /^!이미지(?:\s+|$)([\s\S]*)$/u, kind: "generate" },
    { re: /^!사진수정(?:\s+|$)([\s\S]*)$/u, kind: "edit" },
    { re: /^!그림수정(?:\s+|$)([\s\S]*)$/u, kind: "edit" },
    { re: /^!이미지수정(?:\s+|$)([\s\S]*)$/u, kind: "edit" },
  ];

  for (const v of variants) {
    const m = rest.match(v.re);
    if (!m) continue;
    const prompt = String(m[1] || "").trim();
    return { kind: v.kind, prompt };
  }
  return null;
}

function formatTubeLens(firstLine: string, bullets: string[]): string {
  const out: string[] = [];
  out.push(firstLine.trim());
  for (const b of bullets) {
    const s = String(b || "").trim();
    if (!s) continue;
    out.push(`- ${s}`);
  }
  return out.join("\n").trim();
}

function isIgnoredSender(entry: StreamEntry): boolean {
  const sid = safeString(entry.senderId);
  const sn = safeString(entry.senderName || entry.sender).toLowerCase();
  if (sid === "434886784") return true; // IRIS(봇) 계정(루프 방지)
  if (sn === "iris") return true;
  return false;
}

async function sendOpsLog(runtime: RuntimeConfig, text: string): Promise<void> {
  if (!text.trim()) return;
  const rt = await loadRuntime(true);
  if (!isRoomAllowed(rt, OPS_LOG_ROOM_ID)) return;
  if (isSafeModeOn(rt)) return;
  // 운영 알림은 Reply가 꼭 필요 없으므로 IRIS로만 보낸다(멘션/Reply 불필요).
  await tryServerIrisReplyText(logger, OPS_LOG_ROOM_ID, text, 12000);
}

async function resolveOpenLinkIdForRoom(roomId: string, timeoutMs = 7000): Promise<string | null> {
  const rid = String(roomId || "").trim();
  if (!rid) return null;
  const url = (process.env.IRIS_URL || process.env.IRIS_BRIDGE_URL || "http://127.0.0.1:5050").replace(/\/+$/, "") + "/query";
  const payload = { query: "select link_id from chat_rooms where id=?", params: [rid] };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data: any = await res.json().catch(() => null);
    const row0 = Array.isArray(data?.rows) ? (data.rows as any[])[0] : null;
    const v = safeString(row0?.link_id ?? row0?.linkId ?? row0?.LINK_ID);
    return v ? v : null;
  } catch {
    return null;
  }
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
  const runtime = await loadRuntime(true);
  const roomId = opts.roomId;
  const replyText = opts.replyText;
  if (!isRoomAllowed(runtime, roomId)) return false;
  if (isSafeModeOn(runtime)) return false;

  // Prefer Reply via Talk-API when enabled
  if (isTalkApiEnabled(runtime)) {
    const srcLinkId = await resolveOpenLinkIdForRoom(roomId);
    if (srcLinkId) {
      const attachment: Record<string, unknown> = {
        src_logId: safeString(opts.srcLogId),
        src_userId: safeString(opts.srcUserId),
        src_linkId: safeString(srcLinkId),
        src_type: safeString(Math.floor(opts.srcType)),
        src_message: safeString(opts.srcMessage),
      };
      if (attachment.src_logId && attachment.src_userId && attachment.src_linkId && attachment.src_type && attachment.src_message) {
        const ok = await tryServerTalkApiDispatchRaw(logger, roomId, replyText, 26, attachment, 12000);
        if (ok) return true;
      }
    }
  }

  // Fallback: IRIS text (Reply UI 불가)
  return await tryServerIrisReplyText(logger, roomId, replyText, 12000);
}

function computeQueuePositions(roomId: string): { globalPos: number; roomPos: number } {
  const rid = String(roomId);
  const activeGlobal = activeJobs.length;
  const activeRoom = activeJobs.reduce((acc, j) => (String(j.roomId) === rid ? acc + 1 : acc), 0);

  const queuedForRoom = JOB_QUEUE.reduce((acc, j) => (String(j.roomId) === rid ? acc + 1 : acc), 0);
  return {
    globalPos: activeGlobal + JOB_QUEUE.length + 1,
    roomPos: activeRoom + queuedForRoom + 1,
  };
}

function takeSlotId(): string | null {
  const id = AVAILABLE_SLOT_IDS.shift();
  return id ? String(id) : null;
}

function releaseSlotId(slotId: string): void {
  const sid = String(slotId);
  if (!sid) return;
  if (AVAILABLE_SLOT_IDS.includes(sid)) return;
  AVAILABLE_SLOT_IDS.push(sid);
}

async function runQueueLoop(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    const running = new Set<Promise<void>>();

    const launchJob = (job: QueuedJob): boolean => {
      const slotId = takeSlotId();
      if (!slotId) return false;

      const startedAt = Date.now();
      const aj: ActiveJob = { roomId: job.roomId, kind: job.cmd.kind, startedAt, slotId };
      activeJobs.push(aj);

      const p = (async () => {
        const runtime = await loadRuntime();
        if (!isRoomAllowed(runtime, job.roomId) || isSafeModeOn(runtime)) {
          // 안전/운영 가드에 걸리면 조용히 스킵 (운영방 오염 금지)
          return;
        }
        if (!isFeatureEnabled(runtime, job.roomId, "imageGen")) {
          await sendReplyToMessage({
            runtime,
            roomId: job.roomId,
            replyText: formatTubeLens("지금은 이미지 기능이 꺼져 있어요 😥", [
              "운영자가 이 방의 이미지 기능을 켜면 다시 사용할 수 있어요.",
            ]),
            srcLogId: job.srcLogId,
            srcUserId: job.senderId,
            srcType: job.srcType,
            srcMessage: job.srcMessage,
          });
          return;
        }

        try {
          if (job.cmd.kind === "generate") {
            await handleGenerate(runtime, job.roomId, job.senderName, job.cmd, {
              logId: job.srcLogId,
              userId: job.senderId,
              type: job.srcType,
              message: job.srcMessage,
            }, slotId);
          } else if (job.cmd.kind === "edit") {
            await handleEdit(runtime, job.roomId, job.senderName, job.cmd, {
              logId: job.srcLogId,
              userId: job.senderId,
              type: job.srcType,
              message: job.srcMessage,
            }, slotId);
          }
        } catch (e) {
          logger.warn("[image] job failed", { roomId: job.roomId, kind: job.cmd.kind, slotId, err: String(e) });
          const rt = await loadRuntime();
          await sendOpsLog(rt, `[ops] image-worker 실패 (${job.cmd.kind}) [slot ${slotId}]: ${String(e)}`);
          await sendReplyToMessage({
            runtime: rt,
            roomId: job.roomId,
            replyText: formatTubeLens("이미지 처리에 실패했어요 😥", [
              "잠시 후 다시 시도해 주세요.",
              "문제가 계속되면 운영자에게 알려주세요.",
            ]),
            srcLogId: job.srcLogId,
            srcUserId: job.senderId,
            srcType: job.srcType,
            srcMessage: job.srcMessage,
          });
        }
      })()
        .finally(() => {
          running.delete(p);
          const idx = activeJobs.indexOf(aj);
          if (idx >= 0) activeJobs.splice(idx, 1);
          releaseSlotId(slotId);
        });

      running.add(p);
      return true;
    };

    while (JOB_QUEUE.length > 0 || running.size > 0) {
      while (JOB_QUEUE.length > 0 && running.size < MAX_CONCURRENCY) {
        const job = JOB_QUEUE.shift();
        if (!job) break;
        const launched = launchJob(job);
        if (!launched) {
          JOB_QUEUE.unshift(job);
          break;
        }
      }
      if (running.size === 0) break;
      await Promise.race(Array.from(running));
    }
  } finally {
    queueRunning = false;
    activeJobs.splice(0, activeJobs.length);
    AVAILABLE_SLOT_IDS.splice(0, AVAILABLE_SLOT_IDS.length, ...SLOT_IDS);
  }
}

async function readTailLines(filePath: string, maxBytes = 512 * 1024): Promise<string[]> {
  const fh = await fs.open(filePath, "r");
  try {
    const st = await fh.stat();
    const size = Number(st.size || 0);
    if (!Number.isFinite(size) || size <= 0) return [];
    const start = Math.max(0, size - maxBytes);
    const len = size - start;
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    const text = buf.toString("utf8");
    // Ensure we start from a line boundary (avoid partial JSON)
    const idx = text.indexOf("\n");
    const sliced = start === 0 ? text : (idx >= 0 ? text.slice(idx + 1) : "");
    return sliced.split(/\r?\n/).filter((x) => x.trim().length > 0);
  } finally {
    await fh.close();
  }
}

async function findRawLogRecordByMessageId(roomId: string, messageId: string): Promise<RawLogRecord | null> {
  const rid = safeString(roomId);
  const mid = safeString(messageId);
  if (!rid || !mid) return null;
  const dir = path.join(LOGS_DIR, rid);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = entries
      .filter((e) => e.isFile() && e.name.endsWith(".log"))
      .map((e) => e.name)
      .sort()
      .reverse()
      .slice(0, 6); // 최근 6일만 탐색(운영 안전/성능)

    const keyNeedle = `"messageId"`;
    const hasDigitsOnly = /^\d+$/.test(mid);
    const idNeedle = hasDigitsOnly ? mid : `"${mid}"`;
    const tailSizes = (() => {
      const base = 1024 * 1024;
      const max = Math.max(base, Math.min(LOG_SEARCH_MAX_BYTES, 64 * 1024 * 1024));
      if (max <= base) return [base];
      return [base, max];
    })();
    for (const fn of files) {
      const fp = path.join(dir, fn);
      for (const maxBytes of tailSizes) {
        const lines = await readTailLines(fp, maxBytes);
        // reverse scan (latest first)
        for (let i = lines.length - 1; i >= 0; i -= 1) {
          const ln = lines[i];
          if (!ln.includes(keyNeedle)) continue;
          if (!ln.includes(idNeedle)) continue;
          try {
            const obj = JSON.parse(ln) as RawLogRecord;
            const got = safeString(obj?.snapshot?.messageId);
            if (got === mid) return obj;
          } catch {}
        }
      }
    }
  } catch {}
  return null;
}

function extractReplySrcLogIdFromAttachment(attRaw: unknown): string | null {
  if (!attRaw) return null;

  // Some logs store the reply attachment as a JSON string (to avoid 64-bit precision issues).
  if (typeof attRaw === "string") {
    const s = attRaw.trim();
    if (!s) return null;
    const patterns = [
      /"src_logId"\s*:\s*"(\d+)"/,
      /"src_logId"\s*:\s*(\d+)/,
      /"srcLogId"\s*:\s*"(\d+)"/,
      /"srcLogId"\s*:\s*(\d+)/,
      /"src_log_id"\s*:\s*"(\d+)"/,
      /"src_log_id"\s*:\s*(\d+)/,
    ];
    for (const re of patterns) {
      const m = s.match(re);
      const v = safeString(m?.[1] || "");
      if (v) return v;
    }
    return null;
  }

  if (typeof attRaw !== "object") return null;
  const att: any = attRaw as any;
  const v = safeString(att.src_logId ?? att.srcLogId ?? att.src_log_id);
  return v ? v : null;
}

function extractImageUrlsFromAttachment(attRaw: unknown): string[] {
  if (!attRaw) return [];

  // Some payloads store attachment as a JSON string; best-effort extract URLs from it.
  if (typeof attRaw === "string") {
    const s = attRaw.trim();
    if (!s) return [];
    const cand: string[] = [];
    const add = (v: unknown) => {
      const u = safeString(v);
      if (u) cand.push(u);
    };

    // Prefer well-known keys first.
    const keyRe = /"(url|originalUrl|original_url|thumbnailUrl|thumbnail_url)"\s*:\s*"([^"]+)"/g;
    for (const m of s.matchAll(keyRe) as any) {
      add(m?.[2]);
    }

    // Fallback: any http(s) URL inside the attachment string (arrays, nested structures).
    if (cand.length === 0) {
      const anyUrlRe = /https?:\/\/[^\s"\\<>]+/g;
      const ms = s.match(anyUrlRe) || [];
      for (const u of ms) add(u);
    }

    const seen = new Set<string>();
    const out: string[] = [];
    for (const u of cand) {
      if (seen.has(u)) continue;
      seen.add(u);
      out.push(u);
      if (out.length >= 6) break;
    }
    if (out.length > 1) {
      const nonThumb = out.filter((u) => !u.includes("convert=resize"));
      if (nonThumb.length > 0) return nonThumb;
    }
    return out;
  }

  if (typeof attRaw !== "object") return [];
  const att: any = attRaw as any;
  const cand: string[] = [];

  const add = (v: unknown) => {
    const s = safeString(v);
    if (s) cand.push(s);
  };

  add(att.url);
  add(att.originalUrl);
  add(att.original_url);
  add(att.thumbnailUrl);
  add(att.thumbnail_url);

  const lists: unknown[] = [att.urls, att.urlList, att.imageUrlList, att.imageURLs];
  for (const l of lists) {
    if (!Array.isArray(l)) continue;
    for (const x of l) add(x);
  }

  // Keep order + dedupe + cap
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of cand) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
    if (out.length >= 6) break;
  }
  // Prefer non-thumbnail if possible
  if (out.length > 1) {
    const nonThumb = out.filter((u) => !u.includes("convert=resize"));
    if (nonThumb.length > 0) return nonThumb;
  }
  return out;
}

function extractUrlsFromText(text: string): string[] {
  const s = safeString(text);
  if (!s) return [];
  const matches = s.match(/https?:\/\/\S+/g) || [];
  const cleaned = matches.map((u) => u.replace(/[)\]}>.,!?'"“”‘’]+$/g, ""));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of cleaned) {
    const v = safeString(u);
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 6) break;
  }
  return out;
}

function stripFirstUrlFromPrompt(prompt: string, url: string): string {
  const p = String(prompt || "");
  const u = String(url || "");
  if (!u) return p.trim();
  return p.replace(u, " ").replace(/\s+/g, " ").trim();
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((x) => Number.parseInt(x, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const v = ip.toLowerCase();
  if (v === "::1") return true;
  // Unique local: fc00::/7, Link-local: fe80::/10
  if (v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("fe8") || v.startsWith("fe9") || v.startsWith("fea") || v.startsWith("feb")) return true;
  // IPv4-mapped loopback
  if (v.startsWith("::ffff:127.")) return true;
  return false;
}

async function downloadUrlAsBase64(url: string, timeoutMs = 20000): Promise<string> {
  const u = safeString(url);
  if (!u) throw new Error("empty_url");
  if (!/^https?:\/\//i.test(u)) throw new Error("url_scheme_not_allowed");

  // SSRF guard: block localhost/private IPs (best-effort).
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const net = require("net") as typeof import("net");
    const host = new URL(u).hostname;
    const ipType = net.isIP(host);
    if (ipType === 4 && isPrivateIpv4(host)) throw new Error("url_private_ip_blocked");
    if (ipType === 6 && isPrivateIpv6(host)) throw new Error("url_private_ip_blocked");
    if (host === "localhost") throw new Error("url_private_ip_blocked");
  } catch {
    // ignore URL parse errors here; fetch will fail
  }

  const maxBytes = 12 * 1024 * 1024; // 12MB
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(u, { method: "GET", signal: ctrl.signal, redirect: "follow" as any });
    if (!res.ok) throw new Error(`http_${res.status}`);

    const ct = safeString(res.headers.get("content-type") || "");
    const looksImage = ct.toLowerCase().includes("image/") || /\.(png|jpg|jpeg|webp|gif)(\?|#|$)/i.test(u);
    if (!looksImage) throw new Error("not_an_image_url");

    const reader = (res.body as any)?.getReader?.();
    if (!reader) {
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > maxBytes) throw new Error("image_too_large");
      return buf.toString("base64");
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const r = await reader.read();
      if (!r || r.done) break;
      const chunk: Uint8Array = r.value;
      if (!chunk) continue;
      total += chunk.length;
      if (total > maxBytes) throw new Error("image_too_large");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("base64");
  } finally {
    clearTimeout(t);
  }
}

function isRetryableGeminiError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || "");
  const needles = [
    "gemini_web_eval_timeout",
    "gemini_web_overall_timeout",
    "gemini_web_image_download_failed",
    "gemini_web_no_image_found",
    "gemini_web_lock_busy",
  ];
  if (needles.some((n) => msg.includes(n))) return true;
  if (msg.includes("file_input_not_found") || msg.includes("prompt_input_not_found")) return true;
  if (msg.includes("Target closed") || msg.includes("Navigation failed") || msg.includes("has been closed")) return true;
  if (msg.includes("browserContext.newPage") || msg.includes("Browser closed")) return true;
  return false;
}

async function generateGeminiWebImageWithRetry(opts: {
  prompt: string;
  inputImageBase64?: string | null;
  sessionId: string;
}): Promise<string[]> {
  try {
    return await generateGeminiWebImage(opts);
  } catch (e) {
    if (!isRetryableGeminiError(e)) throw e;
    logger.warn("[image] gemini retry", { sessionId: opts.sessionId, err: String(e) });
    await new Promise((r) => setTimeout(r, 800));
    return await generateGeminiWebImage(opts);
  }
}

async function handleGenerate(
  runtime: RuntimeConfig,
  roomId: string,
  senderName: string,
  cmd: ImageCommand,
  src: { logId: string; userId: string; type: number; message: string },
  slotId: string,
) {
  if (!cmd.prompt) {
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: formatTubeLens("프롬프트가 비어 있어요 😥", [
        "사용법: `!사진 <원하는 이미지 설명>`",
        "예시: `!사진 껌이 화내는 이미지 만들어줘`",
      ]),
      srcLogId: src.logId,
      srcUserId: src.userId,
      srcType: src.type,
      srcMessage: src.message,
    });
    return;
  }

  await sendReplyToMessage({
    runtime,
    roomId,
    replyText: formatTubeLens("이미지 만들고 있어요 😊", [
      `요청자: ${senderName || "어떤 분"}`,
      "완료되면 바로 올려드릴게요.",
    ]),
    srcLogId: src.logId,
    srcUserId: src.userId,
    srcType: src.type,
    srcMessage: src.message,
  });

  const imagesBase64 = await generateGeminiWebImageWithRetry({ prompt: cmd.prompt, sessionId: slotId });

  const ok = await tryServerIrisReplyMedia(logger, roomId, imagesBase64, 90_000);
  if (!ok) throw new Error("iris_reply_media_failed");

  await sendReplyToMessage({
    runtime,
    roomId,
    replyText: formatTubeLens("이미지 완성했어요 😊", [
      "아래 이미지로 확인해 주세요.",
      "수정이 필요하면 이미지에 답장으로 `!사진수정 <수정 내용>`을 보내주세요.",
    ]),
    srcLogId: src.logId,
    srcUserId: src.userId,
    srcType: src.type,
    srcMessage: src.message,
  });
}

async function handleEdit(
  runtime: RuntimeConfig,
  roomId: string,
  senderName: string,
  cmd: ImageCommand,
  src: { logId: string; userId: string; type: number; message: string },
  slotId: string,
) {
  const inlineUrls = extractUrlsFromText(cmd.prompt);
  const inlineUrl = inlineUrls.length > 0 ? inlineUrls[0] : null;
  const promptClean = inlineUrl ? stripFirstUrlFromPrompt(cmd.prompt, inlineUrl) : cmd.prompt;

  if (!promptClean) {
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: formatTubeLens("수정 프롬프트가 비어 있어요 😥", [
        "사용법: (이미지에 답장으로) `!사진수정 <수정 내용>`",
        "예시: `!사진수정 화가 식은 껌`",
      ]),
      srcLogId: src.logId,
      srcUserId: src.userId,
      srcType: src.type,
      srcMessage: src.message,
    });
    return;
  }

  let imageUrls: string[] = [];
  if (inlineUrl) {
    imageUrls = [inlineUrl];
  } else {
    // Reply 형태(원본 메시지 참조)
    const rec = await findRawLogRecordByMessageId(roomId, src.logId);
    const att = rec?.payload?.attachment;
    const repliedLogId = extractReplySrcLogIdFromAttachment(att);
    if (!repliedLogId) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: formatTubeLens("수정할 이미지를 찾지 못했어요 😥", [
          "수정하려는 이미지(또는 이미지 URL)에 ‘답장’으로 명령을 보내주세요.",
          "예시: (이미지에 답장) `!사진수정 화가 식은 껌`",
          "예시: (URL 포함) `!사진수정 https://... 화가 식은 껌`",
        ]),
        srcLogId: src.logId,
        srcUserId: src.userId,
        srcType: src.type,
        srcMessage: src.message,
      });
      return;
    }

    const orig = await findRawLogRecordByMessageId(roomId, repliedLogId);
    imageUrls = extractImageUrlsFromAttachment(orig?.payload?.attachment);

    // External image support: if there is no attachment URL, try to parse URLs from the replied message text.
    if (imageUrls.length === 0) {
      const textUrls = extractUrlsFromText(safeString(orig?.snapshot?.messageText));
      imageUrls = textUrls;
    }

    if (imageUrls.length === 0) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: formatTubeLens("원본 이미지를 찾지 못했어요 😥", [
          "채팅에 업로드된 이미지 또는 ‘이미지 URL’에 답장으로 시도해 주세요.",
          "예시: (URL에 답장) `!사진수정 화가 식은 껌`",
        ]),
        srcLogId: src.logId,
        srcUserId: src.userId,
        srcType: src.type,
        srcMessage: src.message,
      });
      return;
    }
  }

  await sendReplyToMessage({
    runtime,
    roomId,
    replyText: formatTubeLens("이미지 수정 중이에요 😊", [
      `요청자: ${senderName || "어떤 분"}`,
      "완료되면 바로 올려드릴게요.",
    ]),
    srcLogId: src.logId,
    srcUserId: src.userId,
    srcType: src.type,
    srcMessage: src.message,
  });

  const inputImageBase64 = await downloadUrlAsBase64(imageUrls[0], 30_000);
  const imagesBase64 = await generateGeminiWebImageWithRetry({ prompt: promptClean, inputImageBase64, sessionId: slotId });

  const ok = await tryServerIrisReplyMedia(logger, roomId, imagesBase64, 90_000);
  if (!ok) throw new Error("iris_reply_media_failed");

  await sendReplyToMessage({
    runtime,
    roomId,
    replyText: formatTubeLens("수정 이미지 완성했어요 😊", [
      "아래 이미지로 확인해 주세요.",
      "추가 수정도 같은 방식으로 `!사진수정`을 보내주시면 돼요.",
    ]),
    srcLogId: src.logId,
    srcUserId: src.userId,
    srcType: src.type,
    srcMessage: src.message,
  });
}

async function processEntry(ent: StreamEntry, lastSeenMsRef: { v: number }): Promise<void> {
  const roomId = safeString(ent.roomId);
  if (!roomId) return;

  const tsMs = tsToMs(ent.ts);
  if (tsMs > 0 && tsMs > lastSeenMsRef.v) lastSeenMsRef.v = tsMs;

  if (safeString(ent.payloadType) !== "message") return;
  if (isIgnoredSender(ent)) return;

  const text = safeString(ent.text);
  if (!text.startsWith("!")) return;

  const runtime = await loadRuntime();
  if (!isFeatureEnabled(runtime, roomId, "imageGen")) return;

  const cmd = parseImageCommand(text);
  if (!cmd) return;

  const srcLogId = safeString(ent.mid);
  const senderId = safeString(ent.senderId);
  const senderName = resolveDisplayName(ent);
  const srcType = normalizeKakaoMessageType(ent.messageType) ?? 1;
  const srcMessage = text.split(/\r?\n/)[0] || text;

  const dedupKey = safeString(ent.uid) || `${roomId}:${srcLogId}:${cmd.kind}:${safeString(cmd.prompt).slice(0, 80)}`;
  if (EVENT_DEDUP.isDuplicate(dedupKey)) return;

  if (!srcLogId || !senderId) return;

  if (!isRoomAllowed(runtime, roomId) || isSafeModeOn(runtime)) {
    // 운영방에 기술 문구 발신 금지 → 조용히 스킵하고 테스트방으로만 알림
    await sendOpsLog(runtime, `[ops] image-worker skip: room not allowed or SAFE_MODE (roomId masked)`);
    return;
  }

  const activeGlobal = activeJobs.length;
  if (activeGlobal + JOB_QUEUE.length >= QUEUE_MAX) {
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: formatTubeLens("지금은 대기열이 너무 길어요 😥", [
        "잠시 후 다시 시도해 주세요.",
        "대기열이 줄어들면 자동으로 처리돼요.",
      ]),
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
    return;
  }

  const willStartImmediately = activeJobs.length < MAX_CONCURRENCY && JOB_QUEUE.length === 0;
  const pos = computeQueuePositions(roomId);
  JOB_QUEUE.push({
    enqueuedAt: Date.now(),
    roomId,
    senderId,
    senderName,
    cmd,
    srcLogId,
    srcType,
    srcMessage,
  });

  // 즉시 실행되는 작업은 handle*에서 "이미지 만들고 있어요"가 곧바로 나가므로,
  // 대기열 안내는 "대기"가 확실한 경우에만 보내 스팸을 줄인다.
  if (!willStartImmediately) {
    await sendReplyToMessage({
      runtime,
      roomId,
      replyText: formatTubeLens("요청 접수했어요 😊", [
        `대기열: 이 방 ${pos.roomPos}번째 (전체 ${pos.globalPos}번째)`,
        "순서가 되면 자동으로 처리할게요.",
      ]),
      srcLogId,
      srcUserId: senderId,
      srcType,
      srcMessage,
    });
  }

  void runQueueLoop();
}

async function connectAndRun(): Promise<void> {
  const state = await loadState();
  const lastSeenMsRef = { v: state.lastSeenMs || 0 };

  const startedAt = new Date().toISOString();
  await updateStatus({
    ok: true,
    startedAt,
    heartbeatTs: startedAt,
    lastSeenMs: lastSeenMsRef.v,
    inflightRooms: 0,
    queueLength: JOB_QUEUE.length,
    activeRoomId: null,
    activeKind: null,
    activeCount: 0,
    concurrency: MAX_CONCURRENCY,
  });

  // periodic state save
  const stateTimer = setInterval(() => {
    const snapshot: WorkerState = { lastSeenMs: lastSeenMsRef.v, updatedAt: new Date().toISOString() };
    void saveState(snapshot).catch((e) => logger.warn("[state] save failed", { err: String(e) }));
    void updateStatus({
      ok: true,
      lastSeenMs: lastSeenMsRef.v,
      heartbeatTs: new Date().toISOString(),
      inflightRooms: activeJobs.length,
      queueLength: JOB_QUEUE.length,
      activeRoomId: activeJobs.length === 1 ? safeString(activeJobs[0].roomId) : null,
      activeKind: activeJobs.length === 1 ? safeString(activeJobs[0].kind) : null,
      activeCount: activeJobs.length,
      concurrency: MAX_CONCURRENCY,
    }).catch(() => {});
  }, 15_000);
  try {
    const t: any = stateTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  // reconnect loop
  while (true) {
    const runtime = await loadRuntime();
    const rooms = computeImageRooms(runtime);
    if (rooms.length === 0) {
      logger.warn("[stream] imageGen-enabled rooms empty; sleeping");
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
    const since = Math.max(0, Math.floor(lastSeenMsRef.v > 0 ? lastSeenMsRef.v - 1000 : 0));
    const roomsKey = rooms.join(",");
    const url = `${base}/logs/stream?rooms=${encodeURIComponent(roomsKey)}&limit=200&since=${since}&interval=1000`;
    logger.info("[stream] connect", { url, ttlMs: STREAM_TTL_MS });

    try {
      const controller = new AbortController();
      const ttl = setTimeout(() => controller.abort(), STREAM_TTL_MS);
      try {
        const res = await fetch(url, { method: "GET", headers: { Accept: "text/event-stream" }, signal: controller.signal });
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
                if (payload?.type && String(payload.type) !== "append") continue; // snapshot 무시
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
      } finally {
        try { clearTimeout(ttl); } catch {}
      }
    } catch (e) {
      logger.warn("[stream] connection error", { err: String(e) });
    }

    await new Promise((r) => setTimeout(r, 1500));
  }
}

async function main() {
  await acquireSingletonLock();
  logger.info("image-worker start", {
    pid: process.pid,
    concurrency: MAX_CONCURRENCY,
    realtime: process.env.REALTIME_API_BASE || "http://127.0.0.1:8650",
    logsDir: LOGS_DIR,
  });

  // Optional: interactive session init for local manual runs
  if (process.argv.includes("--init-gemini-session")) {
    const getArgValue = (names: string[]): string | null => {
      for (let i = 0; i < process.argv.length; i += 1) {
        const a = String(process.argv[i] || "");
        for (const name of names) {
          if (!name) continue;
          if (a === name) {
            const next = process.argv[i + 1];
            const v = safeString(next);
            if (v) return v;
          }
          const prefix = `${name}=`;
          if (a.startsWith(prefix)) {
            const v = safeString(a.slice(prefix.length));
            if (v) return v;
          }
        }
      }
      return null;
    };
    const sid = getArgValue(["--gemini-session-id", "--gemini-session", "--session-id", "--session", "--slot"]);
    await initGeminiWebSessionInteractive(sid);
    return;
  }

  await connectAndRun();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[image-worker] fatal:", e);
    process.exit(1);
  });
}
