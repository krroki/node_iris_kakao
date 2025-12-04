import type { ChatContext, Logger } from "@tsuki-chat/node-iris";
import { safeReply } from "./sender";

const KB_BASE = process.env.KB_BASE || "http://127.0.0.1:8610";

export async function askKb(logger: Logger, context: ChatContext, query: string) {
  const body = { query, top_k: 6 };
  let answer = "";
  try {
    const res = await fetch(`${KB_BASE}/ask_llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      const data: any = await res.json();
      answer = (data?.answer as string) || "";
      if (!answer) throw new Error("empty answer");
      let final = answer.trim();
      const linkHint = typeof data?.link_hint === "string" ? data.link_hint : "";
      // LLM 답변에 URL이 이미 포함되어 있으면 link_hint 추가 안함
      // "참고:", "링크:", 또는 http URL이 있으면 skip
      const hasUrl = /참고\s*:|링크\s*:|https?:\/\//.test(final);
      if (linkHint && !hasUrl) {
        final = `${final}

${linkHint}`;
      }
      logger.info("[kb] reply(llm)", { roomId: String(context.room.id), model: data?.model, len: final.length });
      await safeReply(logger as any, context, final, 12000);
      return;
    }
    throw new Error(`kb ask_llm failed ${res.status}`);
  } catch (e) {
    logger.error("[kb] llm failed", { err: String(e) });
    throw e;
  }
}
