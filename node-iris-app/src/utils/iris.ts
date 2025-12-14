import type { Logger } from "@tsuki-chat/node-iris";

export async function tryServerIrisReplyMedia(
  logger: Logger,
  roomId: string,
  imagesBase64: string[],
  timeoutMs = 30000,
): Promise<boolean> {
  try {
    const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
    const url = `${base}/send/iris/reply_media`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, imagesBase64 }),
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (!res) return false;
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn("[iris] reply_media non-OK", {
        httpStatus: res.status,
        detail: data?.detail,
        count: Array.isArray(imagesBase64) ? imagesBase64.length : 0,
      });
      return false;
    }
    if (!data?.ok) {
      logger.warn("[iris] reply_media failed", {
        ok: data?.ok,
        httpStatus: data?.iris?.httpStatus,
        count: data?.sent?.count,
      });
      return false;
    }
    logger.info("[iris] reply_media ok", { count: data?.sent?.count });
    return true;
  } catch (e) {
    logger.warn("[iris] reply_media error", { err: String(e) });
    return false;
  }
}

