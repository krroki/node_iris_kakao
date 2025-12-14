import type { Logger } from "@tsuki-chat/node-iris";

export async function tryServerTalkApiDispatch(
  logger: Logger,
  roomId: string,
  message: string,
  mentionees: Array<{ name?: string; userId?: string }>,
  timeoutMs = 10000,
): Promise<boolean> {
  try {
    const base = (process.env.REALTIME_API_BASE || 'http://127.0.0.1:8650').replace(/\/$/, '');
    const url = `${base}/send/talkapi/dispatch`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, message, mentionees }),
      signal: ctrl.signal,
    }).catch((e) => { throw e; });
    clearTimeout(t);
    if (!res) return false;
    const data: any = await res.json().catch(()=> ({}));
    if (!res.ok) {
      logger.warn('[talkapi] dispatch non-OK', {
        roomId,
        httpStatus: res.status,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg: data?.talkApi?.errMsg,
      });
      return false;
    }
    if (!data?.ok) {
      logger.warn('[talkapi] dispatch failed', {
        roomId,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg: data?.talkApi?.errMsg,
      });
      return false;
    }
    logger.info('[talkapi] dispatch ok', { roomId, talkStatus: data?.talkApi?.status });
    return true;
  } catch (e) {
    logger.warn('[talkapi] dispatch error', { roomId, err: String(e) });
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
): Promise<boolean> {
  try {
    const base = (process.env.REALTIME_API_BASE || "http://127.0.0.1:8650").replace(/\/$/, "");
    const url = `${base}/send/talkapi/dispatch_raw`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId, message, type, attachment }),
      signal: ctrl.signal,
    }).catch((e) => {
      throw e;
    });
    clearTimeout(t);
    if (!res) return false;
    const data: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      logger.warn("[talkapi] dispatch_raw non-OK", {
        roomId,
        httpStatus: res.status,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg: data?.talkApi?.errMsg || data?.detail || data?.error,
      });
      return false;
    }
    if (!data?.ok) {
      logger.warn("[talkapi] dispatch_raw failed", {
        roomId,
        ok: data?.ok,
        talkStatus: data?.talkApi?.status,
        errMsg: data?.talkApi?.errMsg || data?.detail || data?.error,
      });
      return false;
    }
    logger.info("[talkapi] dispatch_raw ok", { roomId, talkStatus: data?.talkApi?.status });
    return true;
  } catch (e) {
    logger.warn("[talkapi] dispatch_raw error", { roomId, err: String(e) });
    return false;
  }
}
