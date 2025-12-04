import type { ChatContext, Logger } from "@tsuki-chat/node-iris";
import { tryServerTalkApiDispatch } from "./talkapi";

function roomIdOf(context: ChatContext): string {
  try {
    // Try several fields to be robust
    // @ts-ignore
    const r: any = context?.room;
    return String(r?.id ?? r?.roomId ?? r?.room_id ?? "");
  } catch {
    return "";
  }
}

export async function safeReply(logger: Logger, context: ChatContext, message: string, timeoutMs = 8000): Promise<void> {
  const start = Date.now();
  const rid = roomIdOf(context);
  logger.info("[send] reply start", { len: message?.length || 0, timeoutMs, roomId: rid });
  const op = context.reply(message);
  try {
    await Promise.race([
      op,
      new Promise((_, rej) => setTimeout(() => rej(new Error('reply_timeout')), timeoutMs)),
    ]);
  logger.info("[send] reply ok", { ms: Date.now() - start, roomId: rid });
  } catch (err) {
    logger.error("[send] reply failed", { ms: Date.now() - start, roomId: rid, err: String(err) });
    throw err;
  }
}

export async function safeReplyImageUrls(logger: Logger, context: ChatContext, urls: string[], timeoutMs = 10000): Promise<void> {
  const u = Array.from(urls || []).filter(Boolean);
  if (u.length === 0) return;
  const start = Date.now();
  logger.info("[send] replyImageUrls start", { count: u.length, timeoutMs });
  const fn: any = (context as any).replyImageUrls;
  if (typeof fn !== 'function') {
    logger.warn("[send] replyImageUrls not supported; fallback to plain URLs");
    await safeReply(logger, context, u.join('\n'), timeoutMs);
    return;
  }
  const op = fn.call(context, u);
  try {
    await Promise.race([
      op,
      new Promise((_, rej) => setTimeout(() => rej(new Error('reply_image_timeout')), timeoutMs)),
    ]);
    logger.info("[send] replyImageUrls ok", { ms: Date.now() - start });
  } catch (err) {
    logger.error("[send] replyImageUrls failed", { ms: Date.now() - start, err: String(err) });
    throw err;
  }
}

export function resolveTemplateImageUrls(relOrList: string | string[]): string[] {
  // 우선순위: TEMPLATE_ASSETS_BASE > REALTIME_API_BASE + '/templates/' > 8650 기본값
  const fromEnv = process.env.TEMPLATE_ASSETS_BASE;
  const fromRealtime = process.env.REALTIME_API_BASE
    ? process.env.REALTIME_API_BASE.replace(/\/+$/, "") + "/templates/"
    : "";
  const baseRoot = (fromEnv && fromEnv.trim()) || fromRealtime || "http://localhost:8650/templates/";
  const base = baseRoot.replace(/\/+$/, "/");
  const rels = Array.isArray(relOrList) ? relOrList : [relOrList];
  return rels
    .filter(Boolean)
    .map((r) => String(r))
    .map((r) => r.replace(/^\/+/, ""))
    .map((r) => base + r);
}

// Experimental: try to send mentions if SDK exposes any suitable API. Falls back to plain text.
function buildMentionEntities(
  text: string,
  mentionees: Array<{ name?: string; userId?: string }>,
): { finalText: string; entities: Array<{ user_id: string; at: number[]; len: number }> } {
  const base = typeof text === 'string' ? text : '';
  let finalText = base;
  const entities: Array<{ user_id: string; at: number[]; len: number }> = [];
  const list = Array.isArray(mentionees) ? mentionees.filter(Boolean) : [];
  for (const m of list) {
    const uid = String((m as any)?.userId || '').trim();
    const name = String((m as any)?.name || '').trim();
    if (!uid) continue;
    const needle = name ? `@${name}` : '';
    let at = -1;
    if (needle && finalText) {
      at = finalText.indexOf(needle);
    }
    if (at < 0) {
      // Append mention text to the end if not present
      const prefix = finalText && !finalText.endsWith(' ') ? ' ' : '';
      if (needle) {
        at = (finalText + prefix).length;
        finalText = (finalText + prefix + needle);
      } else {
        // No name available: still create entity with zero-length anchor at end
        at = finalText.length;
      }
    }
    const len = needle ? [...needle].length : 0; // rough length; UI will highlight by LOCO rules
    entities.push({ user_id: uid, at: [at], len });
  }
  return { finalText, entities };
}

export async function safeReplyWithMentions(
  logger: Logger,
  context: ChatContext,
  message: string,
  mentionees: Array<{ name?: string; userId?: string }> = [],
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  const mlist = Array.isArray(mentionees) ? mentionees.filter(Boolean) : [];
  const hasIds = mlist.some((m) => typeof (m as any)?.userId === "string" && (m as any)?.userId);
  const ctx: any = context as any;
  logger.info("[send] replyWithMentions start", {
    len: message?.length || 0,
    count: mlist.length,
    withIds: hasIds,
    timeoutMs,
    hasReplyRich: typeof ctx?.replyRich === "function",
    hasReplyWithMentions: typeof ctx?.replyWithMentions === "function",
    hasReplyMentions: typeof ctx?.replyMentions === "function",
  });

  // Prefer rich payload with LOCO-style attachment.mentions
  let op: Promise<any> | null = null;
  let finalText = message;
  let entities: Array<{ user_id: string; at: number[]; len: number }> = [];
  try {
    const built = buildMentionEntities(message, mlist);
    finalText = built.finalText;
    entities = built.entities;
    const richPayload = {
      text: finalText,
      attachment: {
        mentions: entities,
        // also provide segments/mentionees for broader client compatibility
        segments: entities.map((e) => ({
          type: "mention",
          at: e.at?.[0] ?? 0,
          len: e.len,
        })),
        mentionees: mlist.map((m, idx) => ({
          name: (m as any)?.name || "",
          userId: (m as any)?.userId || "",
          at: entities[idx]?.at?.[0] ?? 0,
          len: entities[idx]?.len ?? 0,
        })),
      },
    } as any;
    if (entities.length > 0 && typeof ctx.replyRich === "function") {
      op = ctx.replyRich(richPayload);
    } else if (typeof ctx.replyWithMentions === "function") {
      // Fallback to any SDK-provided mention API
      op = ctx.replyWithMentions(message, mlist);
    } else if (typeof ctx.replyMentions === "function") {
      op = ctx.replyMentions(message, mlist);
    }
  } catch (e) {
    logger.warn("[send] mention rich API threw, will fallback", { err: String(e) });
  }

  // Server-side Talk API fallback (FASTAPI) when client SDK lacks mention API
  if (!op && hasIds) {
    try {
      const rid = roomIdOf(context);
      const ok = await tryServerTalkApiDispatch(logger, rid, finalText, mlist, timeoutMs);
      if (ok) {
        logger.info("[send] talkapi dispatch ok", { ms: Date.now() - start, roomId: rid });
        return;
      }
      logger.warn("[send] talkapi dispatch failed, fallback to plain text", { roomId: rid });
    } catch (e) {
      logger.warn("[send] talkapi dispatch error, fallback to plain text", { err: String(e) });
    }
  }

  if (!op) {
    logger.warn("[send] mention API not available; fallback to plain text");
    return safeReply(logger, context, finalText, timeoutMs);
  }
  try {
    await Promise.race([
      op,
      new Promise((_, rej) => setTimeout(() => rej(new Error("reply_mentions_timeout")), timeoutMs)),
    ]);
    logger.info('[send] replyWithMentions ok', { ms: Date.now() - start });
  } catch (err) {
    logger.error('[send] replyWithMentions failed', { ms: Date.now() - start, err: String(err) });
    throw err;
  }
}

// 단순 텍스트 송신 헬퍼 (mentions 없이)
export async function sendLegacy(body: any, text: string) {
  try {
    const ctx: any = body?.context;
    if (ctx && typeof ctx.reply === "function") {
      await ctx.reply(text);
      return;
    }
  } catch {}
  // fallback: no context available
  console.warn("[sendLegacy] no context; cannot send");
}

export async function safeBotReplyWithMentions(
  logger: Logger,
  bot: any,
  channel: string,
  message: string,
  mentionees: Array<{ name?: string; userId?: string }> = [],
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  const mlist = Array.isArray(mentionees) ? mentionees.filter(Boolean) : [];
  logger.info('[send] bot.replyWithMentions start', { channel, len: message?.length || 0, count: mlist.length });
  let op: Promise<any> | null = null;
  try {
    const { finalText, entities } = buildMentionEntities(message, mlist);
    if (entities.length > 0 && typeof bot?.api?.replyRich === 'function') {
      op = bot.api.replyRich(channel, { text: finalText, attachment: { mentions: entities } });
    } else if (typeof bot?.api?.replyWithMentions === 'function') {
      op = bot.api.replyWithMentions(channel, message, mlist);
    } else if (typeof bot?.api?.replyMentions === 'function') {
      op = bot.api.replyMentions(channel, message, mlist);
    }
  } catch (e) {
    logger.warn('[send] bot mention API threw, will fallback', { err: String(e) });
  }
  if (!op) {
    logger.warn('[send] bot mention API not available; fallback to plain text');
    const fallback = bot?.api?.reply?.bind(bot?.api) || bot?.reply?.bind(bot);
    if (typeof fallback === 'function') {
      op = fallback(channel, message);
    } else {
      throw new Error('No reply function available on bot.api');
    }
  }
  try {
    await Promise.race([
      op,
      new Promise((_, rej) => setTimeout(() => rej(new Error('reply_mentions_timeout')), timeoutMs)),
    ]);
    logger.info('[send] bot.replyWithMentions ok', { ms: Date.now() - start });
  } catch (err) {
    logger.error('[send] bot.replyWithMentions failed', { ms: Date.now() - start, err: String(err) });
    throw err;
  }
}
