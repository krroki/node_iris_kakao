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
      // LLM 답변에 URL이 이미 포함되어 있으면 link_hint 추가 안함
      const hasUrl = /참고\s*:|링크\s*:|https?:\/\//.test(final);
      // 정보 부재 응답이면 link_hint를 붙이지 않는다. (공백 제거 후 매칭)
      const noInfoPatterns =
        /(정보없음|정보\s*없음|찾지못했|못\s*찾았|찾을\s*수\s*없|관련\s*없|자료\s*부족|없습니다|없어요|다시\s*시도|못찾음)/;
      const finalNoSpace = final.replace(/\s+/g, "");
      const isNoInfo = noInfoPatterns.test(finalNoSpace);
      const linkHint = typeof data?.link_hint === "string" ? data.link_hint : "";
      if (linkHint && !hasUrl && !isNoInfo) {
        final = `${final}\n\n${linkHint}`;
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
