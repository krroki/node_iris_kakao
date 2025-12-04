import type { Logger } from "@tsuki-chat/node-iris";

export async function tryServerTalkApiDispatch(
  logger: Logger,
  roomId: string,
  message: string,
  mentionees: Array<{ name?: string; userId?: string }>,
  timeoutMs = 10000,
): Promise<boolean> {
  try {
    const base = (process.env.REALTIME_API_BASE || 'http://127.0.0.1:8600').replace(/\/$/, '');
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
    if (!res.ok) {
      const txt = await res.text().catch(()=> '');
      logger.warn('[talkapi] dispatch non-OK', { status: res.status, txt: txt?.slice(0,200) });
      return false;
    }
    const data: any = await res.json().catch(()=> ({}));
    logger.info('[talkapi] dispatch ok', { status: data?.status });
    return true;
  } catch (e) {
    logger.warn('[talkapi] dispatch error', { err: String(e) });
    return false;
  }
}

