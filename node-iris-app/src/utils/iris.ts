import type { Logger } from "@tsuki-chat/node-iris";

export type IrisReplyVerifyOptions = {
  echoTimeoutMs?: number;
  sendlogTimeoutMs?: number;
  maxRetries?: number;
  retryDelayMs?: number;
};

export async function tryServerIrisReplyText(
  logger: Logger,
  roomId: string,
  text: string,
  timeoutMs = 15000,
  verify?: IrisReplyVerifyOptions,
): Promise<boolean> {
  try {
    const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
    const url = `${base}/send/iris/reply_text`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const body: any = { roomId, text };
    if (verify && typeof verify === "object") {
      if (Number.isFinite(Number(verify.sendlogTimeoutMs))) body.sendlogTimeoutMs = Number(verify.sendlogTimeoutMs);
      if (Number.isFinite(Number(verify.maxRetries))) body.maxRetries = Number(verify.maxRetries);
      if (Number.isFinite(Number(verify.retryDelayMs))) body.retryDelayMs = Number(verify.retryDelayMs);
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (!res) return false;
    const data: any = await res.json().catch(() => ({}));
    const len = typeof text === "string" ? text.length : 0;
    const attempt = data?.attempt;
    const irisHttp = data?.iris?.httpStatus ?? res.status;
    const sendlogOk = data?.sendlog?.ok;
    const sendlogWaitMs = data?.sendlog?.waitMs;
    const sendlogErr = data?.sendlog?.error ?? data?.sendlog?.err ?? data?.detail;

    if (!res.ok || !data?.ok) {
      logger.warn("[iris] reply_text failed", {
        roomId,
        httpStatus: res.status,
        irisHttpStatus: irisHttp,
        ok: data?.ok,
        attempt,
        sendlogOk,
        sendlogWaitMs,
        sendlogErr,
        len,
      });
      return false;
    }
    logger.info("[iris] reply_text ok", { roomId, len, attempt, sendlogWaitMs });
    return true;
  } catch (e) {
    logger.warn("[iris] reply_text error", { roomId, err: String(e) });
    return false;
  }
}

export async function tryServerIrisReplyMedia(
  logger: Logger,
  roomId: string,
  imagesBase64: string[],
  timeoutMs = 90_000,
  verify?: IrisReplyVerifyOptions,
): Promise<boolean> {
  try {
    const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
    const url = `${base}/send/iris/reply_media`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const body: any = { roomId, imagesBase64 };
    if (verify && typeof verify === "object") {
      if (Number.isFinite(Number(verify.echoTimeoutMs))) body.echoTimeoutMs = Number(verify.echoTimeoutMs);
      if (Number.isFinite(Number(verify.sendlogTimeoutMs))) body.sendlogTimeoutMs = Number(verify.sendlogTimeoutMs);
      if (Number.isFinite(Number(verify.maxRetries))) body.maxRetries = Number(verify.maxRetries);
      if (Number.isFinite(Number(verify.retryDelayMs))) body.retryDelayMs = Number(verify.retryDelayMs);
    }
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (!res) return false;
    const data: any = await res.json().catch(() => ({}));
    const count = Array.isArray(imagesBase64) ? imagesBase64.length : 0;
    const attempt = data?.attempt;
    const irisHttp = data?.iris?.httpStatus ?? res.status;
    const echoOk = data?.echo?.ok;
    const echoWaitMs = data?.echo?.waitMs;
    const sendlogOk = data?.sendlog?.ok;
    const sendlogWaitMs = data?.sendlog?.waitMs;
    const sendlogErr = data?.sendlog?.error ?? data?.sendlog?.err ?? data?.detail;

    if (!res.ok || !data?.ok) {
      logger.warn("[iris] reply_media failed", {
        roomId,
        httpStatus: res.status,
        irisHttpStatus: irisHttp,
        ok: data?.ok,
        attempt,
        echoOk,
        echoWaitMs,
        sendlogOk,
        sendlogWaitMs,
        sendlogErr,
        count,
      });
      return false;
    }
    logger.info("[iris] reply_media ok", { roomId, count: data?.sent?.count ?? count, attempt, echoWaitMs, sendlogWaitMs });
    return true;
  } catch (e) {
    logger.warn("[iris] reply_media error", { roomId, err: String(e) });
    return false;
  }
}

