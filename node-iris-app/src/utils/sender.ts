import type { ChatContext, Logger } from "@tsuki-chat/node-iris";
import { downloadUrlAsBase64 } from "./download";
import { tryServerIrisReplyMedia } from "./iris";
import { tryServerTalkApiDispatch } from "./talkapi";
import { isSafeMode } from "./guard";
import { stripAtMentionsForFallback } from "./mentions";

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
  if (await isSafeMode()) {
    logger.warn("[send] skip reply: SAFE_MODE on", { roomId: rid, len: message?.length || 0 });
    return;
  }
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
  const rid = roomIdOf(context);
  if (await isSafeMode()) {
    logger.warn("[send] skip replyImageUrls: SAFE_MODE on", { roomId: rid, count: u.length });
    return;
  }
  const start = Date.now();
  logger.info("[send] replyImageUrls start", { count: u.length, timeoutMs, roomId: rid });
  const ctx: any = context as any;
  const fnUrls: any = ctx.replyImageUrls;
  if (typeof fnUrls === "function") {
    const op = fnUrls.call(context, u);
    try {
      await Promise.race([
        op,
        new Promise((_, rej) => setTimeout(() => rej(new Error("reply_images_timeout")), timeoutMs)),
      ]);
      logger.info("[send] replyImageUrls ok", { ms: Date.now() - start, roomId: rid });
      return;
    } catch (err) {
      logger.error("[send] replyImageUrls failed", { ms: Date.now() - start, roomId: rid, err: String(err) });
      throw err;
    }
  }

  const fnOne: any = ctx.replyImage || ctx.replyImageUrl;
  if (typeof fnOne === "function") {
    logger.warn("[send] replyImageUrls not supported; using per-image send", { roomId: rid, count: u.length });
    for (const url of u) {
      const op = fnOne.call(context, url);
      await Promise.race([
        op,
        new Promise((_, rej) => setTimeout(() => rej(new Error("reply_image_timeout")), timeoutMs)),
      ]);
    }
    logger.info("[send] replyImage(per-image) ok", { ms: Date.now() - start, roomId: rid, count: u.length });
    return;
  }

  // Fallback: download -> base64 -> Realtime API (/send/iris/reply_media) -> IRIS /reply
  // (IRIS는 멘션/Reply 미지원, 이미지는 가능: ADR-0030)
  if (!rid) throw new Error("No image-capable send method available (roomId missing in context)");
  logger.warn("[send] replyImageUrls not supported; falling back to iris.reply_media", { roomId: rid, count: u.length });
  const limited = u.slice(0, 6);
  const imagesBase64: string[] = [];
  for (const url of limited) {
    try {
      imagesBase64.push(await downloadUrlAsBase64(url, Math.max(5000, timeoutMs)));
    } catch (e) {
      logger.warn("[send] image download failed", { roomId: rid, url, err: String(e) });
    }
  }
  if (imagesBase64.length === 0) {
    throw new Error("No image-capable send method available (download failed)");
  }
  const ok = await tryServerIrisReplyMedia(logger as any, rid, imagesBase64, Math.max(15000, timeoutMs));
  if (!ok) {
    throw new Error("iris reply_media failed");
  }
  logger.info("[send] replyImageUrls ok (iris fallback)", { ms: Date.now() - start, roomId: rid, count: imagesBase64.length });
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

type Mentionee = { name?: string; userId?: string };
type MentionStruct = { user_id: string; at: number[]; len: number };

// LOCO-style mention attachment builder (aligned with storycraft/node-kakao MentionStruct):
// - at: 1-based mention order indices (NOT character offsets)
// - len: display name length excluding '@' (UTF-16 code units == JS/Kotlin String.length)
function buildMentionAttachment(text: string, mentionees: Mentionee[]): { finalText: string; mentions: MentionStruct[] } {
  const msg = typeof text === "string" ? text : "";
  const list = Array.isArray(mentionees) ? mentionees.filter(Boolean) : [];
  if (list.length === 0) return { finalText: msg, mentions: [] };
  if (list.length > 15) throw new Error(`too many mentions: ${list.length} (max 15)`);

  const entries = list.map((m, idx) => {
    const userId = String((m as any)?.userId || "").trim();
    const name = String((m as any)?.name || "").trim();
    if (!userId || !name) throw new Error(`mentionees[${idx}] missing name/userId`);
    return { idx, userId, name, token: `@${name}` };
  });

  // Assign each mentionee to a distinct token occurrence, scanning left-to-right.
  const queues = new Map<string, number[]>();
  entries.forEach((e, i) => {
    const q = queues.get(e.token) || [];
    q.push(i);
    queues.set(e.token, q);
  });

  let cursor = 0;
  const orderedIndices: number[] = [];
  let remaining = entries.length;
  while (remaining > 0) {
    let bestPos = -1;
    let bestToken: string | null = null;
    let bestLen = -1;

    for (const [token, q] of queues.entries()) {
      if (q.length === 0) continue;
      const pos = msg.indexOf(token, cursor);
      if (pos < 0) continue;
      const tlen = token.length;
      const better =
        bestToken === null ||
        pos < bestPos ||
        (pos === bestPos && tlen > bestLen); // prefer longer token when same start (prefix overlap)
      if (better) {
        bestPos = pos;
        bestToken = token;
        bestLen = tlen;
      }
    }

    if (bestToken === null) {
      const missing = Array.from(queues.entries()).find(([, q]) => q.length > 0)?.[0];
      throw new Error(`message does not contain required mention token after pos=${cursor}: ${missing || ""}`);
    }

    const idx = queues.get(bestToken)!.shift()!;
    orderedIndices.push(idx);
    cursor = bestPos + bestLen;
    remaining -= 1;
  }

  const mentions: MentionStruct[] = [];
  const idxByUserId = new Map<string, number>();
  for (let i = 0; i < orderedIndices.length; i++) {
    const order = i + 1;
    const e = entries[orderedIndices[i]];
    const mi = idxByUserId.get(e.userId);
    if (mi != null) {
      if (mentions[mi].len !== e.name.length) throw new Error(`same userId mentioned with different name length: ${e.userId}`);
      mentions[mi].at.push(order);
    } else {
      idxByUserId.set(e.userId, mentions.length);
      mentions.push({ user_id: e.userId, at: [order], len: e.name.length });
    }
  }

  return { finalText: msg, mentions };
}

export async function safeReplyWithMentions(
  logger: Logger,
  context: ChatContext,
  message: string,
  mentionees: Array<{ name?: string; userId?: string }> = [],
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  const rid = roomIdOf(context);
  const mlist = Array.isArray(mentionees) ? mentionees.filter(Boolean) : [];
  if (await isSafeMode()) {
    logger.warn("[send] skip replyWithMentions: SAFE_MODE on", {
      roomId: rid,
      len: message?.length || 0,
      count: mlist.length,
    });
    return;
  }
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

  if (mlist.length === 0) {
    await safeReply(logger, context, message, timeoutMs);
    return;
  }

  let finalText = message;
  let mentions: MentionStruct[] = [];
  try {
    const built = buildMentionAttachment(message, mlist as Mentionee[]);
    finalText = built.finalText;
    mentions = built.mentions;
  } catch (e) {
    logger.warn("[send] buildMentionAttachment failed; sending plain text", { roomId: rid, err: String(e), count: mlist.length });
    await safeReply(logger, context, message, timeoutMs);
    return;
  }

  // 1) Prefer server-side Talk-API dispatch when mentionees include userId.
  if (hasIds) {
    if (!rid) {
      logger.warn("[send] roomId missing; skip talkapi dispatch", { count: mlist.length });
    } else {
      const ok = await tryServerTalkApiDispatch(logger, rid, finalText, mlist, timeoutMs);
      if (ok) {
        logger.info("[send] talkapi dispatch ok", { ms: Date.now() - start, roomId: rid });
        return;
      }
    }
  }

  // 2) Try SDK-provided mention APIs (no plain-text fallback).
  let op: Promise<any> | null = null;
  if (mentions.length > 0 && typeof ctx.replyRich === "function") {
    op = ctx.replyRich({ text: finalText, attachment: { mentions } });
  } else if (typeof ctx.replyWithMentions === "function") {
    op = ctx.replyWithMentions(finalText, mlist);
  } else if (typeof ctx.replyMentions === "function") {
    op = ctx.replyMentions(finalText, mlist);
  }

  if (!op) {
    logger.warn("[send] mention send unavailable; falling back to plain text", {
      roomId: rid,
      count: mlist.length,
    });
    const fallbackText = stripAtMentionsForFallback(finalText, mlist);
    await safeReply(logger, context, fallbackText, timeoutMs);
    return;
  }

  try {
    await Promise.race([
      op,
      new Promise((_, rej) => setTimeout(() => rej(new Error("reply_mentions_timeout")), timeoutMs)),
    ]);
    logger.info("[send] replyWithMentions ok", { ms: Date.now() - start });
  } catch (err) {
    logger.error("[send] replyWithMentions failed", { ms: Date.now() - start, err: String(err) });
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
  if (await isSafeMode()) {
    logger.warn("[send] skip bot.replyWithMentions: SAFE_MODE on", {
      channel,
      len: message?.length || 0,
      count: mlist.length,
    });
    return;
  }
  logger.info('[send] bot.replyWithMentions start', { channel, len: message?.length || 0, count: mlist.length });
  let op: Promise<any> | null = null;
  try {
    const { finalText, mentions } = buildMentionAttachment(message, mlist as Mentionee[]);
    if (mentions.length > 0 && typeof bot?.api?.replyRich === 'function') {
      op = bot.api.replyRich(channel, { text: finalText, attachment: { mentions } });
    } else if (typeof bot?.api?.replyWithMentions === 'function') {
      op = bot.api.replyWithMentions(channel, message, mlist);
    } else if (typeof bot?.api?.replyMentions === 'function') {
      op = bot.api.replyMentions(channel, message, mlist);
    }
  } catch (e) {
    logger.warn('[send] bot mention API threw', { err: String(e) });
  }
  if (!op) {
    throw new Error('No mention-capable send method available on bot.api');
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
