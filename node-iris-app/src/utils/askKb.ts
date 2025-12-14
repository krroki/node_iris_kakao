import type { ChatContext, Logger } from "@tsuki-chat/node-iris";
import { safeReply } from "./sender";

const KB_BASE = process.env.KB_BASE || "http://127.0.0.1:8610";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * KB RAG 서비스에 질의를 보내고, 답변을 현재 방에 전송한다.
 *
 * - CustomMessageController.aiQuery 쪽에서 이미 `?디하클 ...` 접두어를 파싱해
 *   여기에는 질문 본문만 query로 넘어온다.
 * - 방 이름 및 질문 내용을 기반으로 context_tags를 구성해서
 *   kb/service.py 의 /ask_llm 에 도메인 힌트를 전달한다.
 */
export async function askKb(logger: Logger, context: ChatContext, query: string) {
  const body: any = { query, top_k: 6 };

  try {
    const roomNameRaw = (context.room && (context.room as any).name) || "";
    const roomName = typeof roomNameRaw === "string" ? roomNameRaw : String(roomNameRaw ?? "");
    const tags: string[] = [];

    // 1) 기본 도메인 태그: 디하클 카페 관련 KB 질의라는 신호
    //    (?디하클 접두어는 node-iris 쪽에서 이미 필터링됨)
    tags.push("dinohighclass", "디하클", "디지털 하이클래스 카페");

    // 2) Sajulab 수강생용 사용법 질문 감지
    //    - 사알못 전용 방 이름 + 로그인/포인트/PDF 등 키워드 조합
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

    if (tags.length) {
      body.context_tags = tags;
    }
  } catch (e) {
    logger.warn("[kb] failed to derive context_tags from room", { err: String(e) });
  }

  let answer = "";
  try {
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
        answer = (data?.answer as string) || "";
        if (!answer) throw new Error("empty answer");

        let final = answer.trim();

        // LLM 출력에 이미 URL/링크 안내가 포함돼 있으면 link_hint는 붙이지 않는다.
        const hasUrl = /참고\s*:|링크\s*:|https?:\/\//.test(final);

        // "정보 없음/확인 불가/오류" 계열 답변에는 억지로 링크를 붙이지 않는다.
        const finalNoSpace = final.replace(/\s+/g, "").toLowerCase();
        const noInfoPatterns =
          /(정보없음|찾지못|확인불가|자료기준|자료부족|관련정보없|kb응답중오류|응답중오류|잠시후다시|오류가발생)/i;
        const isNoInfo = noInfoPatterns.test(finalNoSpace);

        const linkHint = typeof data?.link_hint === "string" ? data.link_hint : "";
        if (linkHint && !hasUrl && !isNoInfo) {
          final = `${final}\n\n${linkHint}`;
        }

        logger.info("[kb] reply(llm)", {
          roomId: String(context.room.id),
          model: (data && data.model) || undefined,
          len: final.length,
        });
        await safeReply(logger as any, context, final, 12000);
        return;
      } catch (e) {
        lastErr = e;
        const msg = String(e || "");
        const permanent =
          /missing_openai_api_key|openai not installed|openai not installed|google-genai not installed/i.test(msg) ||
          (typeof lastStatus === "number" && lastStatus >= 400 && lastStatus < 500 && lastStatus !== 429);
        const retryable =
          !permanent &&
          (/ECONNREFUSED|fetch failed|Failed to fetch|socket hang up|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(msg) ||
            (typeof lastStatus === "number" && lastStatus >= 500) ||
            lastStatus === 429);

        logger.warn("[kb] attempt failed", {
          attempt,
          maxAttempts,
          roomId: String(context.room.id),
          status: lastStatus ?? undefined,
          err: msg,
          body: lastBody ? lastBody.slice(0, 200) : undefined,
        });

        if (attempt < maxAttempts && retryable) {
          await sleep(250 * attempt);
          continue;
        }
        throw lastErr;
      }
    }

    throw lastErr || new Error("kb ask_llm failed");
  } catch (e) {
    logger.error("[kb] llm failed", { err: String(e) });
    const msg = String(e || "");
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
    try {
      await safeReply(logger as any, context, userHint, 12000);
    } catch {}
    return;
  }
}
