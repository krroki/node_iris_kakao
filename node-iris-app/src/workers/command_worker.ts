import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { APP_ROOT } from "../utils/paths";
import { tryServerIrisReplyText } from "../utils/iris";
import { tryServerTalkApiDispatchRaw } from "../utils/talkapi";

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
};

type WorkerState = {
  lastSeenMs: number;
  updatedAt: string;
};

type ParsedCommand =
  | { kind: "register"; key: string; body: string }
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

const STATE_PATH = path.join(APP_ROOT, "data", "command_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "command_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "command_worker.lock");

const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분

const LINK_ID_CACHE_MS = 30 * 60 * 1000; // 30분
const linkIdByRoom = new Map<string, { linkId: string; at: number }>();

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
const RUNTIME_CACHE_MS = 1500;
const STREAM_TTL_MS = Number.parseInt(String(process.env.COMMAND_WORKER_STREAM_TTL_MS || "").trim(), 10) || 60_000;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
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

async function isRoomAdmin(roomId: string, senderId: string): Promise<{ ok: true; isAdmin: boolean } | { ok: false; err: string }> {
  const r = await irisQuery(
    "select link_member_type from open_chat_member where involved_chat_id=? and user_id=? order by rowid desc limit 1",
    [roomId, senderId],
    8000,
  );
  if (!r.ok) return { ok: false, err: r.err || "query_failed" };
  const t = Number(r.rows?.[0]?.link_member_type);
  const isAdmin = Number.isFinite(t) && (t === 1 || t === 4);
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

  // Talk-API Reply가 실패하면 운영 연속성을 위해 IRIS /reply_text로 "명시적 폴백"한다.
  // - 카카오톡 UI에서 답장으로 렌더링되지는 않으므로 혼란 방지를 위해 prefix를 붙인다.
  const fallbackText = `[답장 불가: Talk-API] ${replyText}`;
  const okIris = await tryServerIrisReplyText(logger, roomId, fallbackText, 12000);
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
    cmd.kind === "register" || cmd.kind === "delete" || cmd.kind === "global_register" || cmd.kind === "list";
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

  if (cmd.kind === "register" || cmd.kind === "delete") {
    const perm = await isRoomAdmin(roomId, senderId);
    if (!perm.ok) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "권한 확인에 실패했습니다. 잠시 후 다시 시도해주세요.",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      logger.warn("[perm] room admin check failed", { roomId, senderId, err: perm.err });
      return;
    }
    if (!perm.isAdmin) {
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: "방장/관리자만 사용할 수 있는 명령입니다. (`!등록`, `!삭제`)",
        srcLogId,
        srcUserId: senderId,
        srcType,
        srcMessage,
      });
      return;
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
      await sendReplyToMessage({
        runtime,
        roomId,
        replyText: `이미 등록된 키입니다: '${exists.keyDisplay}'. 수정하려면 \`!삭제 ${exists.keyDisplay}\` 후 다시 등록해주세요.`,
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
