import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { APP_ROOT } from "../utils/paths";
import { tryServerIrisReplyMedia } from "../utils/iris";
import { downloadUrlAsBase64 } from "../utils/download";
import { resolveTemplateImageUrls } from "../utils/sender";
import { tryServerTalkApiDispatchRawResult } from "../utils/talkapi";

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
  irisAdminSenderIds?: string[] | undefined;
  irisAdminSenderNames?: string[] | undefined;
};

type AutoFaqTrigger = {
  id: string;
  enabled?: boolean;
  label?: string;
  priority?: number;
  cooldownSec?: number;
  match?: {
    type?: "exact_norm" | "regex";
    patterns?: string[];
    negativePatterns?: string[];
    requireQuestionSignal?: boolean;
  };
  action?: {
    type?: "static_text" | "kb_recent_posts" | "kb_recent_posts_filtered";
    menuIds?: string;
    limit?: number;
    keywords?: string[];
    includeNormText?: boolean;
    responseText?: string;
  };
  replyTemplate?: {
    titleLine?: string;
    bodyLines?: string[];
    footerLinksMode?: "none" | "kb_posts" | "explicit";
  };
  images?: string[];
};

type AutoFaqConfig = {
  version?: number;
  updatedAt?: string;
  global?: { enabled?: boolean; triggers?: AutoFaqTrigger[] };
  lectures?: Record<string, { enabled?: boolean; title?: string; triggers?: AutoFaqTrigger[] }>;
  rooms?: Record<string, { enabled?: boolean; lectureId?: string; triggers?: AutoFaqTrigger[] }>;
};

type WorkerState = {
  lastSeenMs: number;
  updatedAt: string;
};

type KbRecentPost = {
  post_id?: number;
  menu_id?: number;
  title?: string;
  url?: string;
  created_at?: string | null;
  norm_text?: string | null;
};

const logger = new Logger("auto-faq-worker");

const STATE_PATH = path.join(APP_ROOT, "data", "auto_faq_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "auto_faq_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "auto_faq_worker.lock");
const CONFIG_PATH = path.join(APP_ROOT, "data", "auto_faq_config.json");
const ROOM_ADMINS_PATH = path.join(APP_ROOT, "data", "room_admins.json");

const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분
const STATUS_MAX_EVENTS = 80;
const LINK_ID_CACHE_MS = 30 * 60 * 1000;
const linkIdByRoom = new Map<string, { linkId: string; at: number }>();

// 동일 사용자 + 동일 트리거 쿨다운(트리거별 커스텀 지원)
const FIRE_DEFAULT_MS = 10 * 60 * 1000;
const FIRE_MAX_MS = 24 * 60 * 60 * 1000;
const fireAtByKey = new Map<string, number>();
const fireCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [k, ts] of fireAtByKey.entries()) {
    if (now - ts > FIRE_MAX_MS) fireAtByKey.delete(k);
  }
  // 과도하게 커지면(비정상) 강제 축소
  if (fireAtByKey.size > 200_000) {
    let n = 0;
    for (const k of fireAtByKey.keys()) {
      fireAtByKey.delete(k);
      n += 1;
      if (n > 50_000) break;
    }
  }
}, 5 * 60 * 1000);
try {
  const t: any = fireCleanupTimer as any;
  if (t && typeof t.unref === "function") t.unref();
} catch {}

function resolveCooldownMs(trig: AutoFaqTrigger): number {
  const sec = Number((trig as any)?.cooldownSec);
  if (!Number.isFinite(sec) || sec <= 0) return FIRE_DEFAULT_MS;
  const ms = Math.floor(sec * 1000);
  return Math.max(30_000, Math.min(FIRE_MAX_MS, ms));
}

function isInCooldown(fireKey: string, cooldownMs: number): boolean {
  const now = Date.now();
  const last = fireAtByKey.get(fireKey);
  if (last && now - last < cooldownMs) return true;
  fireAtByKey.set(fireKey, now);
  return false;
}

const STREAM_TTL_MS = Number.parseInt(String(process.env.AUTO_FAQ_WORKER_STREAM_TTL_MS || "").trim(), 10) || 60_000;
const CONFIG_CACHE_MS = 1200;
const RUNTIME_CACHE_MS = 1500;
const ROOM_ADMINS_CACHE_MS = 2000;

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
let configCache: { at: number; data: AutoFaqConfig } | null = null;
let roomAdminsCache: { at: number; data: any } | null = null;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function normalizeKey(raw: string, mode: "regex" | "exact" = "regex"): string {
  const s0 = safeString(raw);
  if (!s0) return "";
  let s = s0.replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return "";
  if (mode === "exact") {
    // exact_norm의 "정확 일치"는 사용자가 ?/!/마침표를 붙여도 같은 문장으로 취급하도록
    // 앞/뒤의 흔한 구두점은 제거한다(중간 구두점은 유지).
    s = s.replace(/^[?!.？！。．…]+/g, "");
    s = s.replace(/[?!.？！。．…]+$/g, "");
    s = s.replace(/^["'“”‘’]+/g, "");
    s = s.replace(/["'“”‘’]+$/g, "");
    s = s.trim();
  }
  return s;
}

function normalizeKakaoMessageType(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  if (n >= 16384) return n - 16384;
  return n;
}

function tsToMs(ts: unknown): number {
  const t = safeString(ts);
  if (!t) return 0;
  try {
    const ms = new Date(t).getTime();
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

function isSafeAssetRelPath(rel: string): boolean {
  const s = safeString(rel);
  if (!s) return false;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return false;
  if (s.startsWith("\\\\") || s.startsWith("//")) return false;
  if (/^[a-zA-Z]+:\/\//.test(s)) return false;
  if (s.includes("..")) return false;
  // auto-faq 이미지 소스는 UI 업로드(templates assets)만 허용
  if (!s.startsWith("assets/auto_faq/")) return false;
  return true;
}

function normalizePriority(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.max(-10000, Math.min(10000, Math.floor(n)));
}

async function readJsonSafe(filePath: string): Promise<any | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const obj = JSON.parse(raw || "{}");
    return obj && typeof obj === "object" ? obj : null;
  } catch {
    return null;
  }
}

async function loadRuntime(): Promise<RuntimeConfig> {
  const now = Date.now();
  if (runtimeCache && now - runtimeCache.at < RUNTIME_CACHE_MS) return runtimeCache.data;
  const j = (await readJsonSafe(RUNTIME_PATH)) as RuntimeConfig | null;
  const data = j && typeof j === "object" ? j : {};
  runtimeCache = { at: now, data };
  return data;
}

async function fetchRuntimeFromRealtime(timeoutMs = 3500): Promise<RuntimeConfig | null> {
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

async function loadConfig(): Promise<AutoFaqConfig> {
  const now = Date.now();
  if (configCache && now - configCache.at < CONFIG_CACHE_MS) return configCache.data;
  const j = (await readJsonSafe(CONFIG_PATH)) as AutoFaqConfig | null;
  const data = j && typeof j === "object" ? j : {};
  configCache = { at: now, data };
  return data;
}

async function loadRoomAdminsSnapshotCached(): Promise<any> {
  const now = Date.now();
  if (roomAdminsCache && now - roomAdminsCache.at < ROOM_ADMINS_CACHE_MS) return roomAdminsCache.data;
  const j = await readJsonSafe(ROOM_ADMINS_PATH);
  if (j && typeof j === "object") {
    roomAdminsCache = { at: now, data: j };
    return j;
  }
  const bak = await readJsonSafe(`${ROOM_ADMINS_PATH}.bak`);
  roomAdminsCache = { at: now, data: bak && typeof bak === "object" ? bak : {} };
  return roomAdminsCache.data;
}

async function writeJsonAtomic(dst: string, data: unknown): Promise<void> {
  const dir = path.dirname(dst);
  await fs.mkdir(dir, { recursive: true });
  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await fs.rename(tmp, dst);
}

async function loadState(): Promise<WorkerState> {
  const j = (await readJsonSafe(STATE_PATH)) as WorkerState | null;
  if (!j || typeof j !== "object") return { lastSeenMs: 0, updatedAt: new Date().toISOString() };
  return {
    lastSeenMs: Number(j.lastSeenMs) || 0,
    updatedAt: safeString(j.updatedAt) || new Date().toISOString(),
  };
}

async function saveState(s: WorkerState): Promise<void> {
  await writeJsonAtomic(STATE_PATH, s);
}

async function updateStatus(partial: any): Promise<void> {
  const cur = (await readJsonSafe(STATUS_PATH)) || {};
  const next = { ...cur, ...partial, pid: process.pid };
  await writeJsonAtomic(STATUS_PATH, next);
}

function safeSlice(v: unknown, maxLen = 220): string {
  const s = safeString(v);
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + "…";
}

async function appendStatusEvent(event: any): Promise<void> {
  try {
    const cur = (await readJsonSafe(STATUS_PATH)) || {};
    const events = Array.isArray(cur?.events) ? cur.events : [];
    const ev = event && typeof event === "object" ? event : { value: safeString(event) };
    events.push(ev);
    const nextEvents = events.slice(-STATUS_MAX_EVENTS);
    const next = { ...cur, pid: process.pid, events: nextEvents };
    await writeJsonAtomic(STATUS_PATH, next);
  } catch {
    // ignore
  }
}

async function acquireSingletonLock(): Promise<void> {
  try {
    await fs.mkdir(path.dirname(LOCK_PATH), { recursive: true });
    await fs.writeFile(LOCK_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
    return;
  } catch (e: any) {
    if (String(e?.code || "") !== "EEXIST") {
      logger.warn("[lock] lock 파일 생성 실패 (중복 실행 방지 비활성화)", { lockPath: LOCK_PATH, err: String(e) });
      return;
    }
    let oldPid: number | null = null;
    try {
      const raw = await fs.readFile(LOCK_PATH, "utf8");
      const n = Number(String(raw || "").trim());
      if (Number.isFinite(n) && n > 0) oldPid = n;
    } catch {}
    if (oldPid) {
      try {
        process.kill(oldPid, 0);
        throw new Error(`auto-faq-worker already running (pid=${oldPid})`);
      } catch {
        // stale lock
        try {
          await fs.unlink(LOCK_PATH);
        } catch {}
        await fs.writeFile(LOCK_PATH, String(process.pid), { encoding: "utf8", flag: "wx" });
        return;
      }
    }
    throw new Error("auto-faq-worker already running (lock exists)");
  }
}

function isQuestionSignal(text: string): boolean {
  const t = safeString(text);
  if (!t) return false;
  if (t.includes("?")) return true;
  // '?'가 없어도 자주 쓰는 질문 신호
  const cues = [
    "어디",
    "언제",
    "어떻게",
    "방법",
    "되나",
    "되나요",
    "있나요",
    "없나요",
    "맞나요",
    "인가요",
    "문의",
    "알려",
    "링크",
    "결제",
    "가격",
    "얼마",
    "신청",
    "다시보기",
    "보너스",
    "혹시",
  ];
  return cues.some((c) => t.includes(c));
}

function matchTrigger(text: string, trig: AutoFaqTrigger): boolean {
  if (trig.enabled === false) return false;
  const m = trig.match || {};
  const patterns = Array.isArray(m.patterns) ? m.patterns.map(safeString).filter(Boolean) : [];
  if (patterns.length === 0) return false;

  const base0 = m.type === "regex" ? normalizeKey(text, "regex") : normalizeKey(text, "exact");
  // regex는 최악 케이스(백트래킹) 방지를 위해 입력 길이를 제한한다.
  const base = m.type === "regex" ? base0.slice(0, 240) : base0;

  const neg = Array.isArray(m.negativePatterns) ? m.negativePatterns.map(safeString).filter(Boolean) : [];
  for (const p of neg) {
    try {
      if (m.type === "regex") {
        if (new RegExp(p, "i").test(base)) return false;
      } else {
        const pn = normalizeKey(p, "exact");
        if (pn && base.includes(pn)) return false;
      }
    } catch {
      // invalid regex -> ignore this negative pattern (but do not match based on it)
    }
  }

  if (m.requireQuestionSignal !== false && !isQuestionSignal(text)) return false;

  for (const p of patterns) {
    if (m.type === "regex") {
      try {
        if (new RegExp(p, "i").test(base)) return true;
      } catch {
        continue;
      }
    } else {
      const pn = normalizeKey(p, "exact");
      if (!pn) continue;
      // exact_norm: "정확 일치"만 허용한다(부분일치는 regex로 명시)
      if (base === pn) return true;
    }
  }
  return false;
}

async function resolveOpenLinkIdForRoom(roomId: string): Promise<string | null> {
  const now = Date.now();
  const cached = linkIdByRoom.get(roomId);
  if (cached && now - cached.at < LINK_ID_CACHE_MS) return cached.linkId;

  const base = safeString(process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
  const url = `${base}/query`;
  const body = { query: "select link_id from chat_rooms where id=?", bind: [roomId] };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    if (!res || !res.ok) return null;
    const j: any = await res.json().catch(() => null);
    const linkId = safeString(j?.data?.[0]?.link_id ?? j?.data?.[0]?.linkId ?? "");
    if (!linkId) return null;
    linkIdByRoom.set(roomId, { linkId, at: now });
    return linkId;
  } catch {
    return null;
  }
}

function buildReplyTextFromTemplate(
  trig: AutoFaqTrigger,
  posts: Array<{ title: string; url: string }>,
  snippetLines: string[],
): string {
  const tpl = trig.replyTemplate || {};
  const titleLine = safeString(tpl.titleLine);
  const bodyLines = Array.isArray(tpl.bodyLines) ? tpl.bodyLines.map(safeString).filter(Boolean) : [];

  const out: string[] = [];
  if (titleLine) out.push(titleLine);

  const actionType = safeString(trig.action?.type || "static_text");
  const responseText = safeString(trig.action?.responseText);

  if (actionType === "static_text") {
    const body = responseText.trim();
    if (body) {
      if (out.length) out.push("");
      out.push(body);
    }
  } else {
    const renderedBody: string[] = [];
    if (bodyLines.length > 0) {
      for (const line of bodyLines) {
        let s = line;
        for (let i = 0; i < Math.min(10, posts.length); i++) {
          s = s.replace(new RegExp(`\\{t${i + 1}\\}`, "g"), posts[i].title);
          s = s.replace(new RegExp(`\\{url${i + 1}\\}`, "g"), posts[i].url);
        }
        for (let i = 0; i < Math.min(10, snippetLines.length); i++) {
          s = s.replace(new RegExp(`\\{s${i + 1}\\}`, "g"), snippetLines[i]);
        }
        // 남아 있는 placeholder는 제거(예: {s1}이 채워지지 않은 경우)
        s = s.replace(/\{t\d+\}/g, "").replace(/\{url\d+\}/g, "").replace(/\{s\d+\}/g, "").trim();
        if (s) renderedBody.push(s);
      }
    } else if (posts.length > 0) {
      // 기본 body
      renderedBody.push(...posts.map((p, idx) => `${idx + 1}) ${p.title}`));
    }
    if (renderedBody.length) {
      if (out.length) out.push("");
      out.push(...renderedBody);
    }
  }

  const footerMode = safeString(tpl.footerLinksMode || "kb_posts");
  if (footerMode !== "none" && posts.length > 0) {
    out.push("");
    out.push("---");
    out.push("🔗 관련 링크");
    for (const p of posts) out.push(p.url);
  }

  // outbound-message-style 방어(메타 라인/로그/타임스탬프 등)
  const cleaned = out
    .join("\n")
    .split(/\r?\n/)
    .filter((ln) => !/^\s*\[?\d{4}-\d{2}-\d{2}T/.test(ln)) // ISO ts
    .filter((ln) => !/^\s*\[\d{4}-\d{2}-\d{2}/.test(ln)) // [2025-..]
    .filter((ln) => !/^\s*evidence\b/i.test(ln))
    .filter((ln) => !/^\s*next action\b/i.test(ln))
    .filter((ln) => !/^\s*참고\s*로그/i.test(ln))
    .join("\n")
    .trim();

  return cleaned;
}

async function fetchKbRecentPosts(action: AutoFaqTrigger["action"]): Promise<{ posts: KbRecentPost[]; ok: boolean }> {
  const base = safeString(process.env.KB_BASE || "http://127.0.0.1:8610").replace(/\/+$/, "");
  const url = `${base}/posts/recent`;
  const menuIds = safeString(action?.menuIds || "").replace(/\s+/g, "");
  const limit = Math.max(1, Math.min(10, Number(action?.limit || 3) || 3));
  const keywords = Array.isArray(action?.keywords) ? action?.keywords.map(safeString).filter(Boolean) : [];
  const includeNormText = Boolean(action?.includeNormText);

  const params = new URLSearchParams();
  if (menuIds) params.set("menu_ids", menuIds);
  params.set("limit", String(limit));
  if (keywords.length > 0) params.set("keywords", keywords.join(","));
  if (includeNormText) params.set("include_norm_text", "1");

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6500);
    const res = await fetch(`${url}?${params.toString()}`, { method: "GET", signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    if (!res || !res.ok) return { posts: [], ok: false };
    const j: any = await res.json().catch(() => null);
    if (!j?.ok || !Array.isArray(j?.posts)) return { posts: [], ok: false };
    return { posts: j.posts as KbRecentPost[], ok: true };
  } catch {
    return { posts: [], ok: false };
  }
}

function extractBonusSnippets(normText: string): string[] {
  const t = safeString(normText);
  if (!t) return [];
  const needles = ["보너스", "폼", "naver.me", "네이버", "마감", "까지", "전달", "채널톡", "캡쳐", "캡처", "스크린샷", "스샷", "기간 제한", "수령"];
  const rawLines = t.split(/\r?\n/);
  const out: string[] = [];
  for (const ln of rawLines) {
    const s = String(ln || "").trim();
    if (!s) continue;
    if (!needles.some((k) => s.includes(k))) continue;
    if (s.length > 220) out.push(s.slice(0, 220) + "…");
    else out.push(s);
    if (out.length >= 2) break;
  }
  return out;
}

async function sendImages(roomId: string, imagesRel: string[], timeoutMs = 20000): Promise<boolean> {
  const rels = Array.isArray(imagesRel) ? imagesRel.map(safeString).filter(Boolean).filter(isSafeAssetRelPath) : [];
  if (rels.length === 0) return true;
  const urls = resolveTemplateImageUrls(rels).slice(0, 8);
  const imagesBase64: string[] = [];
  for (const url of urls) {
    try {
      imagesBase64.push(await downloadUrlAsBase64(url, Math.max(6000, timeoutMs)));
    } catch (e) {
      logger.warn("[auto-faq] image download failed", { roomId, url, err: String(e) });
    }
  }
  if (imagesBase64.length === 0) return false;
  return await tryServerIrisReplyMedia(logger as any, roomId, imagesBase64, Math.max(90_000, timeoutMs));
}

async function isIrisOrStaff(runtime: RuntimeConfig, roomId: string, senderId: string, senderName: string): Promise<boolean> {
  const sid = safeString(senderId);
  const sn = safeString(senderName).toLowerCase();

  const ids = Array.isArray(runtime.irisAdminSenderIds) ? runtime.irisAdminSenderIds.map(safeString).filter(Boolean) : [];
  if (sid && ids.includes(sid)) return true;
  const names = Array.isArray(runtime.irisAdminSenderNames) ? runtime.irisAdminSenderNames.map(safeString).filter(Boolean) : [];
  if (sn && names.map((x) => x.toLowerCase()).includes(sn)) return true;
  if (sn === "iris") return true;

  // room_admins.json(있으면) 기반으로 운영진/관리자 메시지는 무시(루프/오인식 방지)
  try {
    const snap = await loadRoomAdminsSnapshotCached();
    const roomsObj = snap?.rooms && typeof snap.rooms === "object" ? snap.rooms : {};
    const row = roomsObj[String(roomId)] && typeof roomsObj[String(roomId)] === "object" ? roomsObj[String(roomId)] : null;
    const adminUserIds = Array.isArray((row as any)?.adminUserIds)
      ? (row as any).adminUserIds.map(safeString).filter(Boolean)
      : [];
    if (sid && adminUserIds.includes(sid)) return true;
  } catch {}
  return false;
}

async function processEntry(ent: StreamEntry, lastSeenMsRef: { v: number }) {
  const roomId = safeString(ent.roomId);
  if (!roomId) return;
  const payloadType = safeString(ent.payloadType);
  if (payloadType && payloadType !== "message") return;

  const mid = safeString(ent.mid);
  const senderId = safeString(ent.senderId);
  if (!mid || !senderId) return;
  const tsMs = tsToMs(ent.ts);
  if (tsMs > 0) lastSeenMsRef.v = Math.max(lastSeenMsRef.v, tsMs);

  const msgType = normalizeKakaoMessageType(ent.messageType);
  if (msgType !== 1) return; // 텍스트만(무명령어 FAQ)

  const text = safeString(ent.text);
  if (!text) return;
  const textTrim = text.trim();
  const questionSignal = isQuestionSignal(textTrim);
  // 무명령어 FAQ: 명령어/다른 워커 트리거와 충돌 방지
  if (textTrim.startsWith("!")) return;
  // AI/KB 라우팅 접두어는 여기서 처리하지 않는다.
  if (textTrim.startsWith("?디하클") || textTrim.startsWith("?사주랩") || textTrim.startsWith("?sajulab")) return;

  // dedupe (uid > mid)
  const dedupKey = safeString(ent.uid) || `${roomId}:${mid}`;
  if (EVENT_DEDUP.isDuplicate(dedupKey)) return;

  const runtime = (await fetchRuntimeFromRealtime(1800)) || (await loadRuntime());
  if (runtime.safeMode) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "GATE_SAFE_MODE",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }
  if (Array.isArray(runtime.excludedRoomIds) && runtime.excludedRoomIds.includes(roomId)) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "GATE_EXCLUDED_ROOM",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }
  if (Array.isArray(runtime.allowedRoomIds) && runtime.allowedRoomIds.length > 0 && !runtime.allowedRoomIds.includes(roomId)) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "GATE_NOT_ALLOWED_ROOM",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }
  if (!runtime.talkApi?.enabled) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "GATE_TALKAPI_OFF",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }

  // feature gate
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const rf = feats[roomId] && typeof feats[roomId] === "object" ? (feats[roomId] as any) : {};
  if (rf.autoFaq !== true) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "GATE_FEATURE_OFF",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }

  // ignore staff/admin/bot (iris 포함)
  if (await isIrisOrStaff(runtime, roomId, senderId, safeString(ent.senderName))) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "SKIP_STAFF_OR_IRIS",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }

  // load triggers
  const cfg = await loadConfig();
  const roomsCfg = cfg.rooms && typeof cfg.rooms === "object" ? cfg.rooms : {};
  const roomCfg = roomsCfg[roomId] && typeof roomsCfg[roomId] === "object" ? (roomsCfg[roomId] as any) : null;
  const lectureId = roomCfg ? safeString(roomCfg.lectureId) : "";

  const globalEnabled = cfg.global?.enabled !== false;
  const globalTriggers = globalEnabled && Array.isArray(cfg.global?.triggers) ? (cfg.global?.triggers as AutoFaqTrigger[]) : [];
  const roomEnabled = roomCfg ? roomCfg.enabled !== false : true;
  const roomTriggers = roomEnabled && roomCfg && Array.isArray(roomCfg.triggers) ? (roomCfg.triggers as AutoFaqTrigger[]) : [];
  const lecturesCfg = cfg.lectures && typeof cfg.lectures === "object" ? cfg.lectures : {};
  const lecCfg = lectureId && lecturesCfg[lectureId] && typeof lecturesCfg[lectureId] === "object" ? (lecturesCfg[lectureId] as any) : null;
  const lectureEnabled = lecCfg ? lecCfg.enabled !== false : true;
  const lectureTriggers = lectureEnabled && lecCfg && Array.isArray(lecCfg.triggers) ? (lecCfg.triggers as AutoFaqTrigger[]) : [];

  // scope priority: room > lecture > global, then trigger priority(low)
  const candidates: Array<{ scope: string; trig: AutoFaqTrigger }> = [];
  for (const t of roomTriggers) candidates.push({ scope: "room", trig: t });
  for (const t of lectureTriggers) candidates.push({ scope: "lecture", trig: t });
  for (const t of globalTriggers) candidates.push({ scope: "global", trig: t });

  const matched = candidates.filter((c) => matchTrigger(text, c.trig));
  if (matched.length === 0) {
    if (questionSignal) {
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "NO_MATCH",
        roomId,
        senderId,
        text: safeSlice(textTrim),
      });
    }
    return;
  }

  const scopeRank = (s: string): number => (s === "room" ? 0 : s === "lecture" ? 1 : 2);
  const sorted = [...matched].sort((a, b) => {
    const sa = scopeRank(a.scope);
    const sb = scopeRank(b.scope);
    if (sa !== sb) return sa - sb;
    const pa = normalizePriority(a.trig.priority);
    const pb = normalizePriority(b.trig.priority);
    if (pa !== pb) return pa - pb;
    return safeString(a.trig.id).localeCompare(safeString(b.trig.id));
  });

  // 기본 정책: ambiguous면 무응답. 다만 우선순위/스코프가 "명확히" 이기면 1개로 결정한다.
  const top = sorted[0] || null;
  const second = sorted[1] || null;
  if (!top) return;
  if (second) {
    const topScope = scopeRank(top.scope);
    const secondScope = scopeRank(second.scope);
    const topPri = normalizePriority(top.trig.priority);
    const secondPri = normalizePriority(second.trig.priority);
    const clearWinner = topScope < secondScope || (topScope === secondScope && topPri < secondPri);
    if (!clearWinner) {
      await updateStatus({
        lastMatchTs: new Date().toISOString(),
        lastMatchRoomId: roomId,
        lastMatchDecision: "SKIP_AMBIGUOUS",
        lastMatchText: textTrim.slice(0, 200),
        lastMatchMatchedCount: matched.length,
        lastMatchTop: {
          scope: top.scope,
          triggerId: safeString(top.trig.id),
          triggerLabel: safeString(top.trig.label),
          priority: normalizePriority(top.trig.priority),
        },
        lastMatchSecond: {
          scope: second.scope,
          triggerId: safeString(second.trig.id),
          triggerLabel: safeString(second.trig.label),
          priority: normalizePriority(second.trig.priority),
        },
      });
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "SKIP_AMBIGUOUS",
        roomId,
        senderId,
        text: safeSlice(textTrim),
        matchedCount: matched.length,
        top: { scope: top.scope, id: safeString(top.trig.id), label: safeString(top.trig.label), priority: normalizePriority(top.trig.priority) },
        second: {
          scope: second.scope,
          id: safeString(second.trig.id),
          label: safeString(second.trig.label),
          priority: normalizePriority(second.trig.priority),
        },
      });
      return;
    }
  }

  const trig = top.trig;
  const trigId = safeString(trig.id);
  if (!trigId) return;

  const fireKey = `${roomId}:${senderId}:${trigId}`;
  const cooldownMs = resolveCooldownMs(trig);
  if (isInCooldown(fireKey, cooldownMs)) {
    await updateStatus({
      lastMatchTs: new Date().toISOString(),
      lastMatchRoomId: roomId,
      lastMatchTriggerId: trigId,
      lastMatchTriggerLabel: safeString(trig.label),
      lastMatchDecision: "SKIP_DEDUP",
      lastMatchText: textTrim.slice(0, 200),
      lastMatchMatchedCount: matched.length,
      lastMatchScope: top.scope,
      lastMatchCooldownSec: Math.floor(cooldownMs / 1000),
    });
    await appendStatusEvent({
      ts: new Date().toISOString(),
      decision: "SKIP_DEDUP",
      roomId,
      senderId,
      triggerId: trigId,
      triggerLabel: safeString(trig.label),
      scope: top.scope,
      cooldownSec: Math.floor(cooldownMs / 1000),
      text: safeSlice(textTrim),
    });
    return;
  }

  // action
  const actionType = safeString(trig.action?.type || "static_text");
  let posts: Array<{ title: string; url: string }> = [];
  let snippetLines: string[] = [];
  if (actionType !== "static_text") {
    const res = await fetchKbRecentPosts(trig.action);
    if (!res.ok) {
      await updateStatus({
        lastMatchTs: new Date().toISOString(),
        lastMatchRoomId: roomId,
        lastMatchTriggerId: trigId,
        lastMatchTriggerLabel: safeString(trig.label),
        lastMatchDecision: "SKIP_KB_FETCH_FAILED",
        lastMatchText: textTrim.slice(0, 200),
        lastMatchMatchedCount: matched.length,
        lastMatchScope: top.scope,
      });
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "SKIP_KB_FETCH_FAILED",
        roomId,
        senderId,
        triggerId: trigId,
        triggerLabel: safeString(trig.label),
        scope: top.scope,
        text: safeSlice(textTrim),
      });
      return;
    }
    const rows = (res.posts || []).map((p) => ({
      title: safeString(p.title),
      url: safeString(p.url),
      norm_text: safeString(p.norm_text),
    }));
    posts = rows
      .filter((p) => p.title && p.url)
      .slice(0, Math.max(1, Math.min(10, Number(trig.action?.limit || 3) || 3)))
      .map((p) => ({ title: p.title, url: p.url }));

    if (posts.length === 0) {
      await updateStatus({
        lastMatchTs: new Date().toISOString(),
        lastMatchRoomId: roomId,
        lastMatchTriggerId: trigId,
        lastMatchTriggerLabel: safeString(trig.label),
        lastMatchDecision: "SKIP_KB_EMPTY",
        lastMatchText: textTrim.slice(0, 200),
        lastMatchMatchedCount: matched.length,
        lastMatchScope: top.scope,
      });
      await appendStatusEvent({
        ts: new Date().toISOString(),
        decision: "SKIP_KB_EMPTY",
        roomId,
        senderId,
        triggerId: trigId,
        triggerLabel: safeString(trig.label),
        scope: top.scope,
        text: safeSlice(textTrim),
      });
      return;
    }

    if (actionType === "kb_recent_posts_filtered" && Boolean(trig.action?.includeNormText)) {
      const first = rows.find((x) => x.norm_text) || null;
      if (first && first.norm_text) {
        snippetLines = extractBonusSnippets(first.norm_text);
      }
    }
  }

  const replyText = buildReplyTextFromTemplate(trig, posts, snippetLines);
  if (!replyText) {
    await updateStatus({
      lastMatchTs: new Date().toISOString(),
      lastMatchRoomId: roomId,
      lastMatchTriggerId: trigId,
      lastMatchTriggerLabel: safeString(trig.label),
      lastMatchDecision: "SKIP_EMPTY_REPLY_TEXT",
      lastMatchText: textTrim.slice(0, 200),
      lastMatchMatchedCount: matched.length,
      lastMatchScope: top.scope,
    });
    await appendStatusEvent({
      ts: new Date().toISOString(),
      decision: "SKIP_EMPTY_REPLY_TEXT",
      roomId,
      senderId,
      triggerId: trigId,
      triggerLabel: safeString(trig.label),
      scope: top.scope,
      text: safeSlice(textTrim),
    });
    return;
  }

  // Reply attachment requires src_* and open link id
  const srcLinkId = await resolveOpenLinkIdForRoom(roomId);
  if (!srcLinkId) {
    await updateStatus({
      lastMatchTs: new Date().toISOString(),
      lastMatchRoomId: roomId,
      lastMatchTriggerId: trigId,
      lastMatchTriggerLabel: safeString(trig.label),
      lastMatchDecision: "SKIP_MISSING_SRC_LINK_ID",
      lastMatchText: textTrim.slice(0, 200),
      lastMatchMatchedCount: matched.length,
      lastMatchScope: top.scope,
    });
    await appendStatusEvent({
      ts: new Date().toISOString(),
      decision: "SKIP_MISSING_SRC_LINK_ID",
      roomId,
      senderId,
      triggerId: trigId,
      triggerLabel: safeString(trig.label),
      scope: top.scope,
      text: safeSlice(textTrim),
    });
    return;
  }

  const srcType = normalizeKakaoMessageType(ent.messageType);
  if (srcType == null) {
    await updateStatus({
      lastMatchTs: new Date().toISOString(),
      lastMatchRoomId: roomId,
      lastMatchTriggerId: trigId,
      lastMatchTriggerLabel: safeString(trig.label),
      lastMatchDecision: "SKIP_MISSING_SRC_TYPE",
      lastMatchText: textTrim.slice(0, 200),
      lastMatchMatchedCount: matched.length,
      lastMatchScope: top.scope,
    });
    await appendStatusEvent({
      ts: new Date().toISOString(),
      decision: "SKIP_MISSING_SRC_TYPE",
      roomId,
      senderId,
      triggerId: trigId,
      triggerLabel: safeString(trig.label),
      scope: top.scope,
      text: safeSlice(textTrim),
    });
    return;
  }

  const srcMessage = safeString(text) || "메시지";
  const replyAttachment: Record<string, unknown> = {
    src_logId: mid,
    src_userId: senderId,
    src_linkId: srcLinkId,
    src_type: safeString(srcType),
    src_message: srcMessage,
  };

  const dispatch = await tryServerTalkApiDispatchRawResult(logger as any, roomId, replyText, 26, replyAttachment, 12000);
  const ok = Boolean(dispatch?.ok);
  let imagesOk: boolean | null = null;
  let imagesCount = 0;

  await updateStatus({
    lastFireTs: new Date().toISOString(),
    lastFireRoomId: roomId,
    lastFireTriggerId: trigId,
    lastFireTriggerLabel: safeString(trig.label),
    lastFireActionType: actionType,
    lastFireOk: ok,
    lastFireRealtimeHttpStatus: (dispatch as any)?.realtimeHttpStatus ?? null,
    lastFireTalkHttpStatus: (dispatch as any)?.talkHttpStatus ?? null,
    lastFireTalkStatus: (dispatch as any)?.talkStatus ?? null,
    lastFireErrMsg: safeString((dispatch as any)?.errMsg) || null,
  });
  await appendStatusEvent({
    ts: new Date().toISOString(),
    decision: ok ? "FIRED" : "SEND_FAIL",
    roomId,
    senderId,
    triggerId: trigId,
    triggerLabel: safeString(trig.label),
    scope: top.scope,
    actionType,
    ok,
    realtimeHttpStatus: (dispatch as any)?.realtimeHttpStatus ?? null,
    talkHttpStatus: (dispatch as any)?.talkHttpStatus ?? null,
    talkStatus: (dispatch as any)?.talkStatus ?? null,
    errMsg: safeSlice((dispatch as any)?.errMsg, 240),
    text: safeSlice(textTrim),
    replyPreview: safeSlice(replyText, 260),
  });
  if (!ok) return;

  // images (separate message)
  const imagesRel = Array.isArray(trig.images) ? trig.images : [];
  if (imagesRel.length > 0) {
    imagesCount = imagesRel.length;
    imagesOk = await sendImages(roomId, imagesRel, 25000);
    await updateStatus({
      lastFireImagesCount: imagesCount,
      lastFireImagesOk: imagesOk,
    });
    await appendStatusEvent({
      ts: new Date().toISOString(),
      decision: imagesOk ? "IMAGES_OK" : "IMAGES_FAIL",
      roomId,
      senderId,
      triggerId: trigId,
      triggerLabel: safeString(trig.label),
      imagesCount,
      imagesOk,
    });
  }
}

async function connectAndRun(): Promise<void> {
  const state = await loadState();
  const lastSeenMsRef = { v: state.lastSeenMs || 0 };

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
    void saveState({ lastSeenMs: lastSeenMsRef.v, updatedAt: new Date().toISOString() }).catch(() => {});
  }, 15_000);
  try {
    const t: any = stateTimer as any;
    if (t && typeof t.unref === "function") t.unref();
  } catch {}

  while (true) {
    const runtime = (await fetchRuntimeFromRealtime(2000)) || (await loadRuntime());
    const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
    const rooms = Object.entries(feats)
      .filter(([, v]) => v && typeof v === "object" && (v as any).autoFaq === true)
      .map(([rid]) => safeString(rid))
      .filter(Boolean);

    if (rooms.length === 0) {
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
    const since = Math.max(0, Math.floor(lastSeenMsRef.v > 0 ? lastSeenMsRef.v - 1000 : 0));
    const url = `${base}/logs/stream?rooms=${encodeURIComponent(rooms.join(","))}&limit=200&since=${since}&interval=1000`;
    logger.info("[stream] connect", { rooms: rooms.length });

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
  logger.info("auto-faq-worker start", {
    pid: process.pid,
    realtime: process.env.REALTIME_API_BASE || "http://127.0.0.1:8650",
    kb: process.env.KB_BASE || "http://127.0.0.1:8610",
    irisQuery: process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050",
  });
  await connectAndRun();
}

if (require.main === module) {
  void main().catch((e) => {
    logger.error("auto-faq-worker crashed", { err: String(e) });
    process.exit(1);
  });
}
