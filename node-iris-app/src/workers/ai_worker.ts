import { Logger } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

import DedupCache from "../services/dedupCache";
import { tryServerIrisReplyText } from "../utils/iris";
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
};

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
};

type WorkerState = {
  lastSeenMs: number;
  updatedAt: string;
};

const logger = new Logger("ai-worker");

const STATE_PATH = path.join(APP_ROOT, "data", "ai_worker_state.json");
const STATUS_PATH = path.join(APP_ROOT, "data", "ai_worker_status.json");
const RUNTIME_PATH = path.join(APP_ROOT, "config", "runtime.json");
const LOCK_PATH = path.join(APP_ROOT, "data", "locks", "ai_worker.lock");

const EVENT_DEDUP = new DedupCache(10 * 60 * 1000); // 10분
const QUERY_DEDUP = new DedupCache(15 * 1000, 15 * 1000); // 15초
const inflightByRoom = new Map<string, NodeJS.Timeout>();

let runtimeCache: { at: number; data: RuntimeConfig } | null = null;
const RUNTIME_CACHE_MS = 1500;

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
      logger.warn("[lock] 다른 ai-worker가 이미 실행 중이므로 종료합니다.", { pid: oldPid, lockPath: LOCK_PATH });
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
        console.error("[ai-worker] cleanup tmp failed:", e);
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

function isRoomAllowed(runtime: RuntimeConfig, roomId: string): boolean {
  const list = Array.isArray(runtime.allowedRoomIds)
    ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
    : [];
  if (list.length === 0) return false;
  return list.includes(String(roomId));
}

function isFeatureEnabled(runtime: RuntimeConfig, roomId: string, feature: string): boolean {
  const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
  const flags = feats[String(roomId)];
  if (!flags || typeof flags !== "object") return false;
  return (flags as any)[feature] === true;
}

function parseIgnoreList(raw: string | undefined): string[] {
  const s = String(raw || "").trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => String(x).trim())
    .filter(Boolean);
}

function isIgnoredSender(entry: StreamEntry): boolean {
  const defaultIgnoreIds = ["434886784"]; // IRIS(봇) 계정으로 관측되는 senderId (루프 방지용)
  const ignoreIds = parseIgnoreList(process.env.AI_IGNORE_SENDER_IDS).concat(defaultIgnoreIds);

  const defaultIgnoreNames = ["Iris"];
  const ignoreNames = parseIgnoreList(process.env.AI_IGNORE_SENDER_NAMES).concat(defaultIgnoreNames).map((x) => x.toLowerCase());

  const sid = safeString(entry.senderId);
  const sn = safeString(entry.senderName || entry.sender).toLowerCase();

  if (sid && ignoreIds.includes(sid)) return true;
  if (sn && ignoreNames.includes(sn)) return true;
  return false;
}

function normalizeQueryText(text: string): { ok: true; query: string } | { ok: false; reason: string } {
  const normalized = String(text || "").trim().normalize("NFC");
  const m = normalized.match(/^\?\s*디하클\s*(.*)$/);
  if (!m) return { ok: false, reason: "prefix_not_matched" };

  // 공지 mirror 마커([MF:roomId])가 포함되면 검색 품질이 저하되므로 제거한다.
  const MIRROR_MARKER_REGEX = /\u200B\[MF:[^\]]+\]\u200B/g;
  let q = (m[1] || "").replace(/\s+/g, " ").trim();
  q = q.replace(MIRROR_MARKER_REGEX, "").trim();
  if (!q) return { ok: false, reason: "empty_query" };
  return { ok: true, query: q };
}

const KB_BASE = (process.env.KB_BASE || "http://127.0.0.1:8610").replace(/\/+$/, "");

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildKbBody(query: string, roomName: string): Record<string, unknown> {
  const body: any = { query, top_k: 6 };

  const tags: string[] = [];
  tags.push("dinohighclass", "디하클", "디지털 하이클래스 카페");

  // Sajulab 수강생용 사용법 질문 감지
  const qLower = query.toLowerCase();
  const usageKeywords = [
    "사이트",
    "로그인",
    "로그아웃",
    "로그인 방법",
    "포인트",
    "포인트 확인",
    "포인트 조회",
    "분석",
    "분석 시작",
    "결과",
    "결과 pdf",
    "pdf",
    "수강생",
    "sajulab",
    "사주랩",
  ];
  const isUsageQuery = usageKeywords.some((kw) => qLower.includes(kw));
  if (roomName && roomName.includes("사알못") && isUsageQuery) {
    tags.push("sajulab", "sajulab.kr", "사알못 강의 수강생", "Sajulab 수강생용 사용법");
  }

  if (tags.length) body.context_tags = tags;
  return body;
}

function formatKbAnswer(answer: string, linkHint: string): string {
  let final = String(answer || "").trim();
  if (!final) return "";

  const hasUrl = /참고\s*:|링크\s*:|https?:\/\//.test(final);
  const finalNoSpace = final.replace(/\s+/g, "").toLowerCase();
  const noInfoPatterns =
    /(정보없음|찾지못|확인불가|자료기준|자료부족|관련정보없|kb응답중오류|응답중오류|잠시후다시|오류가발생)/i;
  const isNoInfo = noInfoPatterns.test(finalNoSpace);

  if (linkHint && !hasUrl && !isNoInfo) {
    final = `${final}\n\n${linkHint}`;
  }
  return final.trim();
}

async function callKb(query: string, roomName: string): Promise<{ ok: true; text: string; model?: string } | { ok: false; err: string }> {
  const body = buildKbBody(query, roomName);

  const maxAttempts = Math.max(1, Math.min(4, parseInt(process.env.KB_MAX_ATTEMPTS || "2", 10) || 2));
  let lastStatus: number | null = null;
  let lastBody = "";
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(`${KB_BASE}/ask_llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      lastStatus = res.status;

      if (!res.ok) {
        try {
          lastBody = String(await res.text()).slice(0, 800);
        } catch {
          lastBody = "";
        }
        const bodyHint = lastBody ? ` ${lastBody}` : "";
        throw new Error(`kb ask_llm failed ${res.status}${bodyHint}`);
      }

      const data: any = await res.json();
      const answer = String(data?.answer || "");
      const linkHint = typeof data?.link_hint === "string" ? data.link_hint : "";
      const final = formatKbAnswer(answer, linkHint);
      if (!final) throw new Error("empty answer");

      return { ok: true, text: final, model: data?.model ? String(data.model) : undefined };
    } catch (e) {
      lastErr = e;
      const msg = String(e || "");
      const permanent =
        /missing_openai_api_key|openai not installed|google-genai not installed/i.test(msg) ||
        (typeof lastStatus === "number" && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 429);
      const retryable =
        !permanent &&
        (/ECONNREFUSED|fetch failed|Failed to fetch|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(msg) ||
          (typeof lastStatus === "number" && lastStatus >= 500) ||
          lastStatus === 429);

      logger.warn("[kb] attempt failed", {
        attempt,
        maxAttempts,
        status: lastStatus ?? undefined,
        err: msg,
        body: lastBody ? lastBody.slice(0, 200) : undefined,
      });

      if (attempt < maxAttempts && retryable) {
        await sleep(250 * attempt);
        continue;
      }
      break;
    }
  }

  const errMsg = String(lastErr || "kb ask_llm failed");
  return { ok: false, err: errMsg };
}

function clearInflight(roomId: string) {
  const t = inflightByRoom.get(roomId);
  if (t) clearTimeout(t);
  inflightByRoom.delete(roomId);
}

async function handleAiQuery(entry: StreamEntry, lastSeenMsRef: { v: number }): Promise<void> {
  const rid = safeString(entry.roomId);
  const roomName = safeString(entry.roomName) || rid;
  const text = safeString(entry.text);

  if (!rid || !text) return;
  if (isIgnoredSender(entry)) return;

  const parsed = normalizeQueryText(text);
  if (!parsed.ok) return;

  const query = parsed.query;
  const queryNorm = query.toLowerCase();

  // per-room inflight
  if (inflightByRoom.has(rid)) {
    logger.warn("[ai] skip: room already processing", { roomId: rid });
    return;
  }

  const qKey = `${rid}:${queryNorm}`;
  if (QUERY_DEDUP.isDuplicate(qKey)) {
    logger.warn("[ai] skip duplicate query window", { roomId: rid, query });
    return;
  }

  const runtime = await loadRuntime();
  if (isSafeModeOn(runtime)) {
    logger.warn("[ai] skip: SAFE_MODE on", { roomId: rid });
    return;
  }
  if (!isRoomAllowed(runtime, rid)) {
    logger.warn("[ai] skip: room not allowed", { roomId: rid });
    return;
  }
  if (!isFeatureEnabled(runtime, rid, "ai")) {
    logger.warn("[ai] skip: ai disabled for room", { roomId: rid });
    return;
  }

  const timeout = setTimeout(() => inflightByRoom.delete(rid), 25_000);
  inflightByRoom.set(rid, timeout);

  try {
    logger.info("[ai] query", { roomId: rid, query });
    const kb = await callKb(query, roomName);
    if (!kb.ok) {
      const msg = kb.err || "";
      let userHint = "죄송합니다. KB 응답 중 오류가 발생했습니다.";
      if (/ECONNREFUSED|fetch failed|Failed to fetch|socket hang up|ECONNRESET/i.test(msg)) {
        userHint =
          "KB 서버에 연결할 수 없습니다. (KB 서비스 8610)\n" +
          "PC에서 `windows\\\\start_all.cmd` 또는 `windows\\\\kb_service.ps1` 실행 후 다시 시도해 주세요.";
      } else if (/missing_openai_api_key|openai.*not installed/i.test(msg)) {
        userHint =
          "KB 서버 설정(OPENAI_API_KEY)이 누락되어 응답을 생성할 수 없습니다.\n" +
          "`.env.kb`의 OPENAI_API_KEY 설정을 확인한 뒤 KB 서비스를 재시작해 주세요.";
      }
      const okTalk = await tryServerTalkApiDispatch(logger as any, rid, userHint, [], 12000);
      if (!okTalk) {
        await tryServerIrisReplyText(logger as any, rid, userHint, 12000);
      }
      return;
    }

    const okTalk = await tryServerTalkApiDispatch(logger as any, rid, kb.text, [], 12000);
    const okIris = okTalk ? false : await tryServerIrisReplyText(logger as any, rid, kb.text, 12000);
    const ok = okTalk || okIris;
    const via = okTalk ? "talkapi" : okIris ? "iris" : "failed";
    logger.info("[ai] answered", { roomId: rid, ok, via, model: kb.model });
  } finally {
    clearInflight(rid);
    // status: 마지막 처리 시각/상태 반영 (best-effort)
    void updateStatus({ lastEventTs: new Date().toISOString(), lastSeenMs: lastSeenMsRef.v, inflight: inflightByRoom.size }).catch(() => {});
  }
}

async function processEntry(entry: StreamEntry, lastSeenMsRef: { v: number }): Promise<void> {
  const rid = safeString(entry.roomId);
  if (!rid) return;

  // lastSeen 갱신 (SSE since)
  const tms = tsToMs(entry.ts);
  if (tms > lastSeenMsRef.v) lastSeenMsRef.v = tms;

  // dedup by uid
  const uid = safeString(entry.uid || entry.mid || "");
  const key = uid ? `evt:${rid}:${uid}` : `evt:${rid}:${safeString(entry.ts)}:${safeString(entry.senderId)}:${safeString(entry.text)}`.slice(0, 400);
  if (EVENT_DEDUP.isDuplicate(key)) return;

  if (safeString(entry.payloadType) !== "message") return;
  await handleAiQuery(entry, lastSeenMsRef);
}

async function connectAndRun(): Promise<void> {
  const state = await loadState();
  const lastSeenMsRef = { v: state.lastSeenMs || 0 };

  // status heartbeat
  const startedAt = new Date().toISOString();
  await updateStatus({ startedAt, heartbeatTs: startedAt, lastSeenMs: lastSeenMsRef.v, inflight: 0 });
  const hbTimer = setInterval(() => {
    void updateStatus({ heartbeatTs: new Date().toISOString(), lastSeenMs: lastSeenMsRef.v, inflight: inflightByRoom.size });
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

  // reconnect loop
  while (true) {
    const runtime = await loadRuntime();
    const allowedRooms = Array.isArray(runtime.allowedRoomIds)
      ? runtime.allowedRoomIds.map((x) => safeString(x)).filter(Boolean)
      : [];
    const rooms = allowedRooms.filter((rid) => isFeatureEnabled(runtime, rid, "ai"));

    if (rooms.length === 0) {
      logger.warn("[stream] ai-enabled rooms empty; sleeping");
      await new Promise((r) => setTimeout(r, 5000));
      continue;
    }

    const base = safeString(process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/+$/, "");
    const since = Math.max(0, Math.floor(lastSeenMsRef.v > 0 ? lastSeenMsRef.v - 1000 : 0));
    const url = `${base}/logs/stream?rooms=${encodeURIComponent(rooms.join(","))}&limit=200&since=${since}&interval=1000`;
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
              // AI 워커는 snapshot을 처리하면 과거 질문을 다시 답변하는 문제가 생길 수 있으므로,
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
  await acquireSingletonLock();
  logger.info("ai-worker start", {
    pid: process.pid,
    realtime: process.env.REALTIME_API_BASE || "http://127.0.0.1:8650",
    kb: KB_BASE,
  });
  await connectAndRun();
}

if (require.main === module) {
  main().catch((e) => {
    console.error("[ai-worker] fatal:", e);
    process.exit(1);
  });
}
