import type { Logger } from "@tsuki-chat/node-iris";
import fs from "fs";
import path from "path";
import { APP_ROOT } from "./paths";

type TalkApiStatusFile = {
  updatedAt?: string;
  ok?: boolean;
  kind?: "dispatch" | "dispatch_raw";
  roomId?: string;
  realtimeHttpStatus?: number | null;
  talkHttpStatus?: number | null;
  talkStatus?: number | null;
  errMsg?: string | null;
  lastSuccessAt?: string | null;
  lastFailureAt?: string | null;
  consecutiveFailures?: number;
};

const TALKAPI_STATUS_PATH = path.join(APP_ROOT, "data", "talkapi_status.json");
const TALKAPI_STATUS_BAK_PATH = path.join(APP_ROOT, "data", "talkapi_status.json.bak");

// Talk-API가 장애 상태일 때(예: status=-500 지속), 모든 워커가 매번 원격 호출→타임아웃을
// 반복하면 체감 지연이 커진다. 따라서 실패 후 짧은 쿨다운 동안은 Talk-API 호출을 스킵하고
// 즉시 IRIS 폴백으로 넘어가도록 한다.
const TALKAPI_FAILURE_COOLDOWN_MS = Math.max(0, Number(process.env.TALKAPI_FAILURE_COOLDOWN_MS || 30_000));
let talkApiCooldownUntil = 0;
let lastCooldownLogAt = 0;

function shouldSkipTalkApiDueToCooldown(logger: Logger): boolean {
  if (!TALKAPI_FAILURE_COOLDOWN_MS) return false;
  const now = Date.now();
  if (talkApiCooldownUntil <= now) return false;
  if (!lastCooldownLogAt || now - lastCooldownLogAt > 60_000) {
    lastCooldownLogAt = now;
    logger.info("[talkapi] skip due to failure cooldown", { msLeft: talkApiCooldownUntil - now });
  }
  return true;
}

function updateTalkApiCooldown(ok: boolean): void {
  if (!TALKAPI_FAILURE_COOLDOWN_MS) return;
  const now = Date.now();
  if (ok) {
    talkApiCooldownUntil = 0;
    return;
  }
  talkApiCooldownUntil = Math.max(talkApiCooldownUntil, now + TALKAPI_FAILURE_COOLDOWN_MS);
}

let writeChain: Promise<void> = Promise.resolve();
let lastWriteErrorAt = 0;

function logWriteErrorThrottled(err: unknown) {
  const now = Date.now();
  if (lastWriteErrorAt && now - lastWriteErrorAt < 60_000) return;
  lastWriteErrorAt = now;
  console.error("[talkapi-status] update failed:", err);
}

async function readJsonSafe(p: string): Promise<TalkApiStatusFile> {
  try {
    const raw = await fs.promises.readFile(p, "utf8");
    const obj = JSON.parse(raw || "{}");
    return obj && typeof obj === "object" ? (obj as TalkApiStatusFile) : {};
  } catch {
    return {};
  }
}

async function writeJsonAtomic(dst: string, data: unknown): Promise<void> {
  const dir = path.dirname(dst);
  await fs.promises.mkdir(dir, { recursive: true });

  const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(data, null, 2);
  await fs.promises.writeFile(tmp, payload, "utf8");

  try {
    try {
      await fs.promises.unlink(TALKAPI_STATUS_BAK_PATH);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") throw e;
    }
    try {
      await fs.promises.rename(dst, TALKAPI_STATUS_BAK_PATH);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") throw e;
    }
    await fs.promises.rename(tmp, dst);
  } finally {
    try {
      await fs.promises.unlink(tmp);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") {
        console.error("[talkapi-status] cleanup tmp failed:", e);
      }
    }
  }
}

function numOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

async function updateTalkApiStatus(partial: Required<Pick<TalkApiStatusFile, "ok" | "kind">> & Partial<TalkApiStatusFile>) {
  writeChain = writeChain
    .then(async () => {
      const now = new Date().toISOString();

      let cur = await readJsonSafe(TALKAPI_STATUS_PATH);
      if (!cur || Object.keys(cur).length === 0) {
        const bak = await readJsonSafe(TALKAPI_STATUS_BAK_PATH);
        if (bak && Object.keys(bak).length > 0) cur = bak;
      }

      const prevConsecutive = typeof cur.consecutiveFailures === "number" ? cur.consecutiveFailures : 0;
      const nextConsecutive = partial.ok ? 0 : prevConsecutive + 1;

      const next: TalkApiStatusFile = {
        ...cur,
        ...partial,
        updatedAt: now,
        realtimeHttpStatus:
          "realtimeHttpStatus" in partial ? numOrNull(partial.realtimeHttpStatus) : (cur.realtimeHttpStatus ?? null),
        talkHttpStatus: "talkHttpStatus" in partial ? numOrNull(partial.talkHttpStatus) : (cur.talkHttpStatus ?? null),
        talkStatus: "talkStatus" in partial ? numOrNull(partial.talkStatus) : (cur.talkStatus ?? null),
        errMsg: "errMsg" in partial ? (partial.errMsg ?? null) : (cur.errMsg ?? null),
        lastSuccessAt: partial.ok ? now : (cur.lastSuccessAt ?? null),
        lastFailureAt: partial.ok ? (cur.lastFailureAt ?? null) : now,
        consecutiveFailures: nextConsecutive,
      };

      await writeJsonAtomic(TALKAPI_STATUS_PATH, next);
    })
    .catch((e) => {
      logWriteErrorThrottled(e);
    });

  await writeChain;
}

function recordStatusFireAndForget(p: Parameters<typeof updateTalkApiStatus>[0]) {
  void updateTalkApiStatus(p).catch(() => {});
}

export async function tryServerTalkApiDispatch(
  logger: Logger,
  roomId: string,
  message: string,
  mentionees: Array<{ name?: string; userId?: string }>,
  timeoutMs = 10000,
): Promise<boolean> {
  try {
    if (shouldSkipTalkApiDueToCooldown(logger)) return false;
    const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
    const url = `${base}/send/talkapi/dispatch`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, message, mentionees }),
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (!res) return false;
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn("[talkapi] dispatch non-OK", {
        roomId,
        httpStatus: res.status,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg: data?.talkApi?.errMsg,
      });
      updateTalkApiCooldown(false);
      recordStatusFireAndForget({
        ok: false,
        kind: "dispatch",
        roomId,
        realtimeHttpStatus: res.status,
        talkHttpStatus: data?.talkApi?.httpStatus ?? null,
        talkStatus: data?.talkApi?.status ?? null,
        errMsg: data?.talkApi?.errMsg ?? null,
      });
      return false;
    }
    if (!data?.ok) {
      logger.warn("[talkapi] dispatch failed", {
        roomId,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg: data?.talkApi?.errMsg,
      });
      updateTalkApiCooldown(false);
      recordStatusFireAndForget({
        ok: false,
        kind: "dispatch",
        roomId,
        realtimeHttpStatus: res.status,
        talkHttpStatus: data?.talkApi?.httpStatus ?? null,
        talkStatus: data?.talkApi?.status ?? null,
        errMsg: data?.talkApi?.errMsg ?? null,
      });
      return false;
    }
    logger.info("[talkapi] dispatch ok", { roomId, talkStatus: data?.talkApi?.status });
    updateTalkApiCooldown(true);
    recordStatusFireAndForget({
      ok: true,
      kind: "dispatch",
      roomId,
      realtimeHttpStatus: res.status,
      talkHttpStatus: data?.talkApi?.httpStatus ?? null,
      talkStatus: data?.talkApi?.status ?? null,
      errMsg: data?.talkApi?.errMsg ?? null,
    });
    return true;
  } catch (e) {
    logger.warn("[talkapi] dispatch error", { roomId, err: String(e) });
    updateTalkApiCooldown(false);
    recordStatusFireAndForget({ ok: false, kind: "dispatch", roomId, errMsg: String(e) });
    return false;
  }
}

export async function tryServerTalkApiDispatchRaw(
  logger: Logger,
  roomId: string,
  message: string,
  type: number,
  attachment: Record<string, unknown>,
  timeoutMs = 10000,
  mentionees: Array<{ name?: string; userId?: string }> = [],
): Promise<boolean> {
  const r = await tryServerTalkApiDispatchRawResult(logger, roomId, message, type, attachment, timeoutMs, mentionees);
  return r.ok;
}

export type TalkApiDispatchRawResult = {
  ok: boolean;
  realtimeHttpStatus?: number | null;
  talkHttpStatus?: number | null;
  talkStatus?: number | null;
  errMsg?: string | null;
};

export async function tryServerTalkApiDispatchRawResult(
  logger: Logger,
  roomId: string,
  message: string,
  type: number,
  attachment: Record<string, unknown>,
  timeoutMs = 10000,
  mentionees: Array<{ name?: string; userId?: string }> = [],
): Promise<TalkApiDispatchRawResult> {
  try {
    if (shouldSkipTalkApiDueToCooldown(logger)) return { ok: false, errMsg: "cooldown" };
    const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
    const url = `${base}/send/talkapi/dispatch_raw`;
    const payload: Record<string, unknown> = { roomId, message, type, attachment };
    if (Array.isArray(mentionees) && mentionees.length > 0) {
      payload.mentionees = mentionees;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (!res) return { ok: false, errMsg: "no response" };
    const data: any = await res.json().catch(() => ({}));
    const errMsg = data?.talkApi?.errMsg || data?.detail || data?.error || null;
    if (!res.ok) {
      logger.warn("[talkapi] dispatch_raw non-OK", {
        roomId,
        httpStatus: res.status,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg,
      });
      updateTalkApiCooldown(false);
      recordStatusFireAndForget({
        ok: false,
        kind: "dispatch_raw",
        roomId,
        realtimeHttpStatus: res.status,
        talkHttpStatus: data?.talkApi?.httpStatus ?? null,
        talkStatus: data?.talkApi?.status ?? null,
        errMsg,
      });
      return {
        ok: false,
        realtimeHttpStatus: res.status,
        talkHttpStatus: data?.talkApi?.httpStatus ?? null,
        talkStatus: data?.talkApi?.status ?? null,
        errMsg,
      };
    }
    if (!data?.ok) {
      logger.warn("[talkapi] dispatch_raw failed", {
        roomId,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg,
      });
      updateTalkApiCooldown(false);
      recordStatusFireAndForget({
        ok: false,
        kind: "dispatch_raw",
        roomId,
        realtimeHttpStatus: res.status,
        talkHttpStatus: data?.talkApi?.httpStatus ?? null,
        talkStatus: data?.talkApi?.status ?? null,
        errMsg,
      });
      return {
        ok: false,
        realtimeHttpStatus: res.status,
        talkHttpStatus: data?.talkApi?.httpStatus ?? null,
        talkStatus: data?.talkApi?.status ?? null,
        errMsg,
      };
    }
    logger.info("[talkapi] dispatch_raw ok", { roomId, talkStatus: data?.talkApi?.status });
    updateTalkApiCooldown(true);
    recordStatusFireAndForget({
      ok: true,
      kind: "dispatch_raw",
      roomId,
      realtimeHttpStatus: res.status,
      talkHttpStatus: data?.talkApi?.httpStatus ?? null,
      talkStatus: data?.talkApi?.status ?? null,
      errMsg,
    });
    return {
      ok: true,
      realtimeHttpStatus: res.status,
      talkHttpStatus: data?.talkApi?.httpStatus ?? null,
      talkStatus: data?.talkApi?.status ?? null,
      errMsg,
    };
  } catch (e) {
    logger.warn("[talkapi] dispatch_raw error", { roomId, err: String(e) });
    updateTalkApiCooldown(false);
    recordStatusFireAndForget({ ok: false, kind: "dispatch_raw", roomId, errMsg: String(e) });
    return { ok: false, errMsg: String(e) };
  }
}
