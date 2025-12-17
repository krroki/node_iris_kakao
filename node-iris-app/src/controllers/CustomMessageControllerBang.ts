import Bot, {
  BotCommand,
  ChatContext,
  MessageController,
  OnMessage,
  Prefix,
} from "@tsuki-chat/node-iris";
import {
  safeReplyWithMentions,
  safeReply,
  resolveTemplateImageUrls,
  safeReplyImageUrls,
} from "../utils/sender";
import { tryServerTalkApiDispatchRaw } from "../utils/talkapi";
import { Logger } from "@tsuki-chat/node-iris";
import { isRoomAllowed, isSafeMode, isFeatureEnabledForContext } from "../utils/guard";
import { APP_ROOT } from "../utils/paths";
import { resolveWelcomeTemplateSelection } from "../utils/welcomeTemplatePolicy";
import path from "path";
import { promises as fs } from "fs";
import { messageStore } from "../services";

// 운영 안전: 테스트 커맨드(!welcome:test / !reply:test)는 테스트 전용 오픈채팅방에서만 수행한다.
const TEST_COMMAND_ROOM_ID = "18462226881291012";

function sanitizeChatAnswer(raw: string): string {
  let s = String(raw || "").replace(/\r\n/g, "\n");
  if (!s.trim()) return "";

  const out: string[] = [];
  for (const ln of s.split("\n")) {
    const line = String(ln || "").trimEnd();
    const t = line.trim();
    if (!t) {
      out.push("");
      continue;
    }

    // 보고서형 헤더 제거
    if (/^\s*(\d+\)\s*)?(답변|근거|증거|Evidence|Next Action|다음\s*액션|다음\s*할\s*일|To\s*do|TODO|참고\s*로그)\s*:?\s*$/i.test(t)) {
      continue;
    }
    let cleaned = line.replace(
      /^\s*(\d+\)\s*)?(답변|근거|증거|Evidence|Next Action|다음\s*액션|다음\s*할\s*일|To\s*do|TODO|참고\s*로그)\s*:\s*/i,
      "",
    );

    // 타임스탬프/로그 인용 라인 제거: "- [ts] sender: text"
    if (/^\s*[-*]\s*\[(20\d{2}[-./]\d{1,2}[-./]\d{1,2}[^\]]*|\d{1,2}:\d{2}(?::\d{2})?)\]\s*[^:]+:\s*.+$/i.test(t)) {
      continue;
    }

    // 캡처/첨부 메타 라인 제거: "[...png 352x476]"
    if (/^\s*\[[^\]]+\.(png|jpg|jpeg|gif|webp)\s+[0-9]{2,4}x[0-9]{2,4}\]\s*$/i.test(t)) {
      continue;
    }

    // 인라인 타임스탬프 제거
    cleaned = cleaned.replace(/\[(20\d{2}[-./]\d{1,2}[-./]\d{1,2}[^\]]*)\]/g, "");
    cleaned = cleaned.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, "");

    // userId(숫자) 노출 방지(제한적으로 치환)
    cleaned = cleaned.replace(/\b\d{6,}\b\s*님\b/g, "어떤 분");
    cleaned = cleaned.replace(/\b\d{6,}\b(?=(이|가|은|는|을|를|에게|한테|에서|도|만|과|와|랑|으로|로|께|부터|까지)\b)/g, "어떤 분");
    cleaned = cleaned.replace(/@\s*\b\d{6,}\b/g, "@어떤 분");

    cleaned = cleaned.replace(/\s{2,}/g, " ").trim();
    out.push(cleaned);
  }

  // 연속 빈 줄 최대 1개
  const compacted: string[] = [];
  let prevBlank = false;
  for (const ln of out) {
    const blank = !String(ln || "").trim();
    if (blank && prevBlank) continue;
    compacted.push(ln);
    prevBlank = blank;
  }
  s = compacted.join("\n").trim();

  // 링크 푸터가 있는데 URL이 없거나 "없음"이면 푸터 제거
  if (/^---\s*$/m.test(s) && /^🔗\s*관련\s*링크\s*$/m.test(s)) {
    const parts = s.split(/^---\s*$/m);
    if (parts.length >= 2) {
      const head = parts[0].trimEnd();
      const tail = parts.slice(1).join("---").trim();
      const hasUrl = /https?:\/\//i.test(tail);
      const hasNone = /(없음|없어요|없습니다)/.test(tail);
      if (!hasUrl || hasNone) {
        s = head.trim();
      }
    }
  }

  // 첫 줄 다음 빈 줄 1개(가독성) 보정
  s = s.replace(/^([^\n]+)\n(💡\s*요약\s*내용|🔗\s*관련\s*링크|---|\d+\.\s+|- )/m, "$1\n\n$2");
  return s.trim();
}

function buildLocalQaFallback(question: string, messages: Array<{ sender?: string; text: string }>): string {
  const q = String(question || "").trim();
  if (!q) return "";

  const wantsLink = /(링크|url|URL|주소)/.test(q);
  const wantsDate = /(언제|일정|날짜|몇\s*일|며칠|나와|나오|출간|업로드|오픈|발표)/.test(q);

  const tokens = (q.match(/[0-9A-Za-z가-힣]{2,}/g) || []).map((t) => t.trim()).filter(Boolean);
  const stop = new Set([
    "링크",
    "주소",
    "알려줘",
    "알려주세요",
    "어떻게",
    "어케",
    "뭐야",
    "무엇",
    "언제",
    "나와",
    "나오",
    "되나",
    "되요",
    "되나요",
    "되면",
    "안되면",
    "안돼",
    "안됨",
    "안돼요",
    "가능",
    "가능해",
    "가능한",
    "확인",
    "할수",
    "할수있",
    "할수있어",
    "질문",
    "요약",
    "채팅요약",
  ]);
  const normalizeToken = (tok: string): string[] => {
    const s = String(tok || "").trim();
    if (!s) return [];
    const out: string[] = [s];
    const suffixes = [
      "님",
      "에서",
      "에게",
      "한테",
      "으로",
      "부터",
      "까지",
      "은",
      "는",
      "이",
      "가",
      "을",
      "를",
      "에",
      "도",
      "만",
      "과",
      "와",
      "랑",
      "로",
      "께",
    ];
    for (const suf of suffixes) {
      if (s.endsWith(suf) && s.length > suf.length + 1) {
        out.push(s.slice(0, -suf.length));
        break;
      }
    }
    return out;
  };

  const keywords = Array.from(
    new Set(tokens.flatMap((t) => normalizeToken(t)).filter((t) => t && !stop.has(t))),
  ).slice(0, 10);
  const hasAnyKeyword = (text: string) => {
    const tl = String(text || "").toLowerCase();
    return keywords.some((kw) => tl.includes(kw.toLowerCase()));
  };

  const extractUrls = (text: string): string[] => {
    const out: string[] = [];
    const re = /https?:\/\/\S+/g;
    for (const m of String(text || "").match(re) || []) {
      out.push(String(m).replace(/[).,]}>\"']+$/g, ""));
    }
    return out;
  };

  // 1) 링크 질문: URL만 모아서 푸터에 넣는다.
  if (wantsLink) {
    const urls: string[] = [];
    for (const m of messages) {
      const t = String(m?.text || "");
      if (!t) continue;
      if (keywords.length > 0 && !hasAnyKeyword(t)) continue;
      urls.push(...extractUrls(t));
    }
    const uniq = Array.from(new Set(urls)).slice(0, 10);
    if (uniq.length === 0) {
      return [
        "아쉽게도 대화에서 관련 링크는 아직 못 찾았어요 😥",
        "",
        "💡 요약 내용",
        "- 공지/고정글에 있을 수도 있으니 한 번만 확인해 주세요.",
        "- 링크가 들어간 메시지가 있었다면, 그 메시지 앞뒤 키워드로 다시 한 번 물어봐도 좋아요.",
      ].join("\n").trim();
    }
    return [
      "찾아봤는데, 대화에서 관련 링크가 있었어요 😊",
      "",
      "💡 요약 내용",
      "- 대화에서 확인된 링크만 모아뒀어요.",
      "",
      "---",
      "🔗 관련 링크",
      ...uniq,
    ].join("\n").trim();
  }

  // 2) 날짜/일정 질문: 날짜 표현만 뽑아서 안내한다.
  if (wantsDate && keywords.length > 0) {
    const dateRe =
      /(?:(20\d{2})[./-]([01]?\d)[./-]([0-3]?\d))|(?:(\d{1,2})\s*월\s*(\d{1,2})\s*일)|(?:(\d{1,2})\s*일)/;
    const dates: string[] = [];
    for (const m of messages) {
      const t = String(m?.text || "");
      if (!t) continue;
      if (!hasAnyKeyword(t)) continue;
      const mm = t.match(dateRe);
      if (!mm) continue;
      dates.push(String(mm[0]).trim());
    }
    const uniq = Array.from(new Set(dates)).slice(0, 5);
    if (uniq.length > 0) {
      return [
        "찾아봤어요! 대화에서 일정/날짜 언급이 이렇게 있었어요 😊",
        "",
        "💡 요약 내용",
        ...uniq.map((d) => `- ${d}`),
        "",
        "📌 표현이 '28일'처럼 월/연도가 빠져 있을 수도 있어서, 딱 떨어지는 날짜로는 못 박기 어렵네요 😥",
      ].join("\n").trim();
    }
  }

  // 3) 일반 질문: 키워드가 걸리는 라인이 있으면 그 존재만 요약한다(원문 인용은 피함).
  const matched = messages.filter((m) => hasAnyKeyword(String(m?.text || "")));
  if (matched.length > 0) {
    const ks = keywords.slice(0, 3).join(", ");
    return [
      "결론부터 말하면, 대화에서 딱 떨어지는 답은 아직 못 찾았어요 😥",
      "",
      "💡 요약 내용",
      `- 대신 **${ks || "질문 관련"}** 얘기는 대화에 언급이 있었어요.`,
      "- 정확한 답이 필요하면 공지/운영진 확인이 제일 빠를 것 같아요.",
    ].join("\n").trim();
  }

  // 4) 아무 것도 못 찾음
  return [
    "아쉽게도 대화에서 질문하신 내용은 아직 못 찾았어요 😥",
    "",
    "💡 요약 내용",
    "- 공지/고정글에 있을 수도 있으니 한 번만 확인해 주세요.",
    "- 키워드를 조금 더 구체적으로 바꿔서 다시 물어봐도 좋아요.",
  ].join("\n").trim();
}

// "!" 접두사 전용(운영 커맨드와 분리)
@Prefix("!")
@MessageController
class CustomMessageControllerBang {
  private bot: Bot;
  private logger: Logger;
  constructor() {
    this.bot = Bot.requireInstance();
    this.logger = new Logger(CustomMessageControllerBang.name);
  }

  // NOTE: IRIS/라이브러리 이벤트가 중복 전달되는 케이스가 있어,
  // 명령 처리 결과(특히 메시지 발신)를 msgId 단위로 1회만 수행한다.
  private static handledCommandIds = new Set<string>();

  private lockOnce(context: ChatContext): boolean {
    const msg: any = (context as any)?.message || {};
    const rid = String((context as any)?.room?.id ?? "");
    const msgId = String(msg?.id || msg?.messageId || "");
    if (!rid || !msgId) return true; // msgId가 없으면 중복 방지를 할 수 없으므로 진행
    const key = `${rid}:${msgId}`;
    if (CustomMessageControllerBang.handledCommandIds.has(key)) return false;
    CustomMessageControllerBang.handledCommandIds.add(key);
    setTimeout(() => CustomMessageControllerBang.handledCommandIds.delete(key), 20000);
    return true;
  }

  private async shouldHandle(context: ChatContext): Promise<boolean> {
    if (await isSafeMode()) {
      this.logger.warn("SAFE_MODE on: ignore command (!)", { roomId: String(context.room.id) });
      return false;
    }
    const allowed = await isRoomAllowed(context);
    if (!allowed) {
      this.logger.warn("Command ignored: room not allowed (!)", { roomId: String(context.room.id) });
      return false;
    }
    return true;
  }

  @OnMessage
  async onWelcomeTestMessage(context: ChatContext) {
    const msg: any = (context as any)?.message;
    const cmd = typeof msg?.command === "string" && msg.command ? String(msg.command).trim() : "";
    const param = typeof msg?.param === "string" && msg.param ? String(msg.param).trim() : "";

    let raw = "";
    if (typeof msg?.msg === "string" && msg.msg) raw = msg.msg;
    else if (typeof msg?.text === "string" && msg.text) raw = msg.text;
    else if (typeof msg?.plainText === "string" && msg.plainText) raw = msg.plainText;
    raw = String(raw || "").trim();

    const isWelcomeTestCmd =
      cmd === "welcome:test" ||
      (cmd === "welcome" && param === "test") ||
      raw === "!welcome:test" ||
      raw.startsWith("!welcome:test ") ||
      raw === "!welcome test" ||
      raw.startsWith("!welcome test ");

    if (!isWelcomeTestCmd) return;
    await this.welcomeTest(context);
  }

  @OnMessage
  async onReplyTestMessage(context: ChatContext) {
    const msg: any = (context as any)?.message;
    const cmd = typeof msg?.command === "string" && msg.command ? String(msg.command).trim() : "";
    const param = typeof msg?.param === "string" && msg.param ? String(msg.param).trim() : "";

    let raw = "";
    if (typeof msg?.msg === "string" && msg.msg) raw = msg.msg;
    else if (typeof msg?.text === "string" && msg.text) raw = msg.text;
    else if (typeof msg?.plainText === "string" && msg.plainText) raw = msg.plainText;
    raw = String(raw || "").trim();

    const isReplyTestCmd =
      cmd === "reply:test" ||
      (cmd === "reply" && param === "test") ||
      raw === "!reply:test" ||
      raw.startsWith("!reply:test ") ||
      raw === "!reply test" ||
      raw.startsWith("!reply test ");

    if (!isReplyTestCmd) return;
    await this.replyTest(context);
  }

  /**
   * !채팅요약 명령 처리
   *
   * - FEATURES[roomId].chatSummary 가 true인 방에서만 동작
   * - 오늘 날짜 기준 최근 로그를 KB /chat/summary API로 보내고, 요약 결과를 그대로 응답한다.
   */
  @OnMessage
  async onChatSummary(context: ChatContext) {
    const msg: any = (context as any)?.message;

    // 원문 텍스트 추출: msg/msg.text/command+param 등 여러 필드를 안전하게 검사
    let raw = "";
    const cmd = typeof msg?.command === "string" && msg.command ? String(msg.command).trim() : "";
    const param = typeof msg?.param === "string" && msg.param ? String(msg.param).trim() : "";
    if (typeof msg?.msg === "string" && msg.msg) {
      raw = msg.msg;
    } else if (typeof msg?.text === "string" && msg.text) {
      raw = msg.text;
    } else if (typeof msg?.plainText === "string" && msg.plainText) {
      raw = msg.plainText;
    }
    raw = String(raw || "").trim();

    // '!채팅요약'/'!요약' 접두 명령만 인식한다.
    // - cmd === '채팅요약' 인 경우는 Prefix('!')에 의해 파싱된 정식 명령
    // - raw.startsWith('!채팅요약') 는 혹시 모를 원문 텍스트 기반 백업 경로
    const isChatSummaryCmd =
      cmd === "채팅요약" ||
      cmd === "요약" ||
      raw.startsWith("!채팅요약") ||
      raw.startsWith("!요약");

    if (!isChatSummaryCmd) {
      return;
    }

    if (!(await this.shouldHandle(context))) return;

    const featureOn = await isFeatureEnabledForContext(context, "chatSummary");
    if (!featureOn) {
      await safeReply(this.logger, context, "이 방에서는 채팅 요약 기능이 비활성화되어 있습니다. 설정에서 chatSummary를 켜 주세요.", 6000);
      return;
    }

    const roomId = String((context as any)?.room?.id ?? "");
    const roomName = (await context.room.name) || "";

    let chatQaQuestion = "";
    try {
      // 기본: "오늘(자정~현재)" 기준. 옵션으로 최근 N시간(롤링) 지원.
      // - 예: !채팅요약 24시간 / !요약 6시간 / !채팅요약 12h
      // - 예: !요약 당근 비즈니스 가입 안되면 어떻게 해?
      // - 예: !요약 24시간 당근 비즈니스 가입 안되면 어떻게 해?
      const rawParam = (() => {
        const p = String(param || "").trim();
        if (p) return p;
        const m = String(raw || "").trim().match(/^!(?:채팅요약|요약)\s+(.+)$/);
        return m && m[1] ? String(m[1]).trim() : "";
      })();

      const parseDurationTokenToHours = (token: string): number | null => {
        const t = String(token || "").trim().replace(/[,\uFF0C]/g, "");
        if (!t) return null;
        const mH = t.match(/^(\d+)(?:시간|h)$/i);
        const mD = t.match(/^(\d+)(?:일|d)$/i);
        if (mH) return Number(mH[1]);
        if (mD) return Number(mD[1]) * 24;
        if (t === "24" || t.toLowerCase() === "24h") return 24;
        if (t === "12" || t.toLowerCase() === "12h") return 12;
        return null;
      };

      const tokens = String(rawParam || "").trim().split(/\s+/).filter(Boolean);
      let hours: number | null = null;
      let question = "";
      if (tokens.length) {
        const h = parseDurationTokenToHours(tokens[0]);
        if (h != null) {
          hours = h;
          question = tokens.slice(1).join(" ").trim();
        } else {
          question = tokens.join(" ").trim();
        }
      }
      chatQaQuestion = question;

      // Q&A 모드(질문이 있을 때)는 기본 범위를 "오늘"이 아니라 "최근 N시간"으로 잡는다.
      // - 사용자가 '바로 위'라고 말하는 정보가 전날/이전 날짜에 있는 케이스가 많다.
      // - 지나치게 넓히면 비용/지연이 증가하므로 기본은 보수적으로 72h(3일)로 둔다.
      const defaultQaHours = 72;
      if (question && hours == null) {
        hours = defaultQaHours;
      }

      // 안전: 1h~168h(7d)만 허용 (대형 방에서 과도한 파일 파싱 방지)
      if (hours != null) {
        if (!Number.isFinite(hours) || hours <= 0) hours = null;
        else hours = Math.min(168, Math.max(1, Math.floor(hours)));
      }

      const limit = question ? 600 : 300;
      const messages = hours == null
        ? await messageStore.loadRecentMessages(roomId, limit)
        : await messageStore.loadMessagesForHours(roomId, hours, limit, 8);
      if (!messages.length) {
        const msgNo = (() => {
          if (question) {
            return hours == null
              ? "오늘 날짜 기준으로 답변할 채팅 로그가 없습니다."
              : `최근 ${hours}시간 기준으로 답변할 채팅 로그가 없습니다.`;
          }
          return hours == null
            ? "오늘 날짜 기준으로 요약할 채팅 로그가 없습니다."
            : `최근 ${hours}시간 기준으로 요약할 채팅 로그가 없습니다.`;
        })();
        await safeReply(this.logger, context, msgNo, 6000);
        return;
      }

      const base = process.env.KB_URL || "http://127.0.0.1:8610";
      const endpoint = question ? "/chat/qa" : "/chat/summary";
      const reqBody: any = {
        room_id: roomId,
        room_name: roomName,
        window_hours: hours,
        message_limit: 300,
        messages: messages.map((m) => ({
          ts: m.ts,
          sender: m.sender,
          text: m.text,
        })),
      };
      if (question) reqBody.question = question;

      const res = await fetch(`${base.replace(/\/+$/, "")}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });

      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok || !body?.ok) {
        this.logger.warn(question ? "[chat-qa] failed" : "[chat-summary] failed", {
          status: res.status,
          body,
        });
        if (question) {
          const fallback = buildLocalQaFallback(question, messages);
          if (fallback) {
            await safeReply(this.logger, context, sanitizeChatAnswer(fallback) || fallback, 15000);
            return;
          }
        }
        await safeReply(this.logger, context, question ? "채팅 질문 답변 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." : "채팅 요약 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 6000);
        return;
      }

      const answer: string = String(body.answer || "").trim();
      if (!answer) {
        await safeReply(this.logger, context, question ? "채팅 질문 답변 결과가 비어 있습니다." : "채팅 요약 결과가 비어 있습니다.", 6000);
        return;
      }

      const sanitized = sanitizeChatAnswer(answer);
      await safeReply(this.logger, context, sanitized || answer, 15000);
    } catch (e) {
      this.logger.error(chatQaQuestion ? "[chat-qa] unexpected error" : "[chat-summary] unexpected error", e as any);
      try {
        await safeReply(
          this.logger,
          context,
          chatQaQuestion ? "채팅 질문 답변 처리 중 예기치 못한 오류가 발생했습니다." : "채팅 요약 처리 중 예기치 못한 오류가 발생했습니다.",
          6000,
        );
      } catch {}
    }
  }

  @BotCommand("ping")
  async ping(context: ChatContext) {
    if (!(await this.shouldHandle(context))) return;
    await context.reply("Pong!");
  }

  @BotCommand("room")
  async room(context: ChatContext) {
    if (!(await this.shouldHandle(context))) return;
    const rid = String((context as any)?.room?.id ?? "");
    await safeReply(this.logger, context, `roomId: ${rid}`, 5000);
  }

  @BotCommand("welcome:test")
  async welcomeTest(context: ChatContext) {
    if (!this.lockOnce(context)) return;

    const rid = String((context as any)?.room?.id ?? "");
    if (rid && rid !== TEST_COMMAND_ROOM_ID) {
      try {
        await messageStore.record(context, {
          type: "welcome_test_dry_run",
          reason: "NOT_TEST_ROOM",
          roomId: rid,
          testRoomId: TEST_COMMAND_ROOM_ID,
        });
      } catch (e) {
        this.logger.warn("[welcome:test] dry-run record failed", { err: String(e) });
      }
      this.logger.warn("[welcome:test] blocked: test room only", { roomId: rid, testRoomId: TEST_COMMAND_ROOM_ID });
      return;
    }

    // SAFE_MODE / allowlist 에서 막히는 경우에도 "드라이런"으로 템플릿 렌더링 결과를 기록해
    // 대시보드/로그에서 원인을 확인할 수 있게 한다. (발신은 하지 않음)
    const safeModeOn = await isSafeMode();
    const roomAllowed = await isRoomAllowed(context);
    const blockedReason = safeModeOn ? "SAFE_MODE" : roomAllowed ? "" : "ROOM_NOT_ALLOWED";

    const userName = (await context.sender.getName()) || "Guest";
    const roomName = (await context.room.name) || "this room";
    const senderId = String((context.sender as any)?.id || (context.sender as any)?.userId || "");

    const loadTemplate = async (name: string): Promise<{ text: string; images: string[] }> => {
      if (!name) throw new Error("welcome template name is not configured");
      const p = path.join(APP_ROOT, "config", "templates", "welcome", `${name}.json`);
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      const text =
        typeof parsed?.messages?.text === "string"
          ? parsed.messages.text
          : typeof parsed?.content === "string"
            ? parsed.content
            : typeof parsed?.text === "string"
              ? parsed.text
              : "";
      if (!text || !String(text).trim()) {
        throw new Error(`welcome template has empty text: ${p}`);
      }
      const images: string[] = [];
      if (typeof parsed?.messages?.image === "string" && parsed.messages.image.trim()) {
        images.push(parsed.messages.image.trim());
      }
      if (Array.isArray(parsed?.images)) {
        for (const img of parsed.images) {
          if (typeof img === "string" && img.trim()) images.push(img.trim());
        }
      }
      return { text: String(text), images: Array.from(new Set(images)) };
    };

    const renderText = (text: string): { text: string; hasMention: boolean } => {
      let hasMention = false;
      const vars: Record<string, string> = {
        userName,
        roomName,
        time: new Date().toLocaleTimeString("ko-KR"),
        date: new Date().toLocaleDateString("ko-KR"),
        entrant: userName,
        entrance: userName,
      };
      let out = String(text || "");
      out = out.replace(/@\{([^}]+)\}/g, (_, k) => {
        const key = String(k || "").trim();
        const aliases = key === "entrant" || key === "entrance" ? [key, "userName"] : [key];
        for (const a of aliases) {
          if (vars[a]) {
            hasMention = true;
            return "@" + vars[a];
          }
        }
        return "@{" + key + "}";
      });
      out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
        const key = String(k || "").trim();
        return vars[key] != null ? String(vars[key]) : "{{" + key + "}}";
      });
      out = out.replace(/\{([^}]+)\}/g, (_, k) => {
        const key = String(k || "").trim();
        return vars[key] != null ? String(vars[key]) : "{" + key + "}";
      });
      return { text: out, hasMention };
    };

    try {
      const selection = await resolveWelcomeTemplateSelection({ userName, senderId });
      const tplName = selection?.templateName || "";
      const tpl = await loadTemplate(tplName);
      const { text, hasMention } = renderText(tpl.text);
      const images = resolveTemplateImageUrls(tpl.images || []);

      if (blockedReason) {
        try {
          await messageStore.record(context, {
            type: "welcome_test_dry_run",
            reason: blockedReason,
            template: tplName,
            text,
            images,
            nicknameClass: selection?.nicknameClass,
            source: selection?.source,
            setKey: selection?.setKey,
            pick: selection?.pick,
          });
        } catch (e) {
          this.logger.warn("[welcome:test] dry-run record failed", { err: String(e) });
        }
        this.logger.warn("[welcome:test] blocked -> dry-run", {
          reason: blockedReason,
          tplName,
          hasMention,
          images: images.length,
          nicknameClass: selection?.nicknameClass,
          source: selection?.source,
          setKey: selection?.setKey,
          pick: selection?.pick,
        });
        return;
      }

      if (hasMention && senderId) {
        await safeReplyWithMentions(this.logger, context, text, [{ name: userName, userId: senderId }], 8000);
      } else {
        await safeReply(this.logger, context, text, 8000);
      }
      if (images && images.length) {
        await safeReplyImageUrls(this.logger, context, images, 10000);
      }
      this.logger.info("[welcome:test] sent (!)", {
        tplName,
        hasMention,
        images: images.length,
        nicknameClass: selection?.nicknameClass,
        source: selection?.source,
        setKey: selection?.setKey,
        pick: selection?.pick,
      });
    } catch (e) {
      if (blockedReason) {
        try {
          await messageStore.record(context, {
            type: "welcome_test_dry_run_failed",
            reason: blockedReason,
            error: String(e),
          });
        } catch (e2) {
          this.logger.warn("[welcome:test] dry-run-failed record failed", { err: String(e2) });
        }
        this.logger.error("[welcome:test] dry-run failed (!)", e as any);
        return;
      }
      this.logger.error("[welcome:test] failed (!)", e as any);
      await safeReply(this.logger, context, "웰컴 템플릿 테스트 중 오류가 발생했습니다.", 5000);
    }
  }

  @BotCommand("reply:test")
  async replyTest(context: ChatContext) {
    if (!this.lockOnce(context)) return;

    const safeModeOn = await isSafeMode();
    const roomAllowed = await isRoomAllowed(context);
    const blockedReason = safeModeOn ? "SAFE_MODE" : roomAllowed ? "" : "ROOM_NOT_ALLOWED";

    const rid = String((context as any)?.room?.id ?? "");
    if (rid && rid !== TEST_COMMAND_ROOM_ID) {
      try {
        await messageStore.record(context, {
          type: "reply_test_dry_run",
          reason: "NOT_TEST_ROOM",
          roomId: rid,
          testRoomId: TEST_COMMAND_ROOM_ID,
        });
      } catch (e) {
        this.logger.warn("[reply:test] dry-run record failed", { err: String(e) });
      }
      this.logger.warn("[reply:test] blocked: test room only", { roomId: rid, testRoomId: TEST_COMMAND_ROOM_ID });
      return;
    }
    const msg: any = (context as any)?.message;
    const param = typeof msg?.param === "string" && msg.param ? String(msg.param).trim() : "";
    const text = param ? `답장 테스트: ${param}` : "답장 테스트: OK";

    const raw: any = (context as any)?.raw || {};
    const attRaw: any = raw?.attachment;
    const attMsg: any = (context as any)?.message?.attachment;
    const normalizeAttachment = (v: any): any => {
      if (!v) return null;
      if (typeof v === "object") return v;
      if (typeof v === "string") {
        const s = v.trim();
        if (!s) return null;
        try {
          const parsed = JSON.parse(s);
          return parsed && typeof parsed === "object" ? parsed : null;
        } catch {
          return null;
        }
      }
      return null;
    };
    const att: any = normalizeAttachment(attRaw) ?? normalizeAttachment(attMsg);
    const reply: any = att && typeof att === "object" ? (att as any)?.reply : null;
    const rawType: any = raw?.type;
    const sendType =
      typeof rawType === "number"
        ? rawType
        : typeof rawType === "bigint"
          ? Number(rawType)
        : typeof rawType === "string" && rawType.trim()
          ? Number.parseInt(rawType.trim(), 10)
          : Number.NaN;

    if (blockedReason) {
      try {
        await messageStore.record(context, {
          type: "reply_test_dry_run",
          reason: blockedReason,
          roomId: rid,
          rawType,
          hasReply: !!reply,
          attachmentKeys: att && typeof att === "object" ? Object.keys(att) : [],
          replyKeys: reply && typeof reply === "object" ? Object.keys(reply) : [],
          src: reply && typeof reply === "object"
            ? {
              src_logId: (reply as any)?.src_logId,
              src_userId: (reply as any)?.src_userId,
              src_type: (reply as any)?.src_type,
            }
            : null,
          message: text,
        });
      } catch (e) {
        this.logger.warn("[reply:test] dry-run record failed", { err: String(e) });
      }
      this.logger.warn("[reply:test] blocked -> dry-run", {
        reason: blockedReason,
        roomId: rid,
        rawType,
        hasReply: !!reply,
      });
      return;
    }

    if (!rid) {
      await safeReply(this.logger, context, "답장 테스트 실패: roomId를 확인할 수 없습니다.", 6000);
      return;
    }
    if (!Number.isFinite(sendType)) {
      await safeReply(this.logger, context, "답장 테스트 실패: raw.type 파싱에 실패했습니다.", 6000);
      return;
    }
    if (!att || typeof att !== "object") {
      await safeReply(
        this.logger,
        context,
        "답장 테스트 실패: attachment가 없습니다. 카카오톡에서 ‘답장’으로 !reply test (또는 !reply:test) 를 보내주세요.",
        8000,
      );
      return;
    }
    const hasTruthyId = (v: any): boolean => {
      if (typeof v === "string") return !!v.trim();
      if (typeof v === "number") return Number.isFinite(v) && v > 0;
      if (typeof v === "bigint") return v > 0n;
      return false;
    };

    // reply 메타는 환경/버전에 따라 attachment.reply(중첩) 또는 attachment(src_logId 등)로 평탄화되어 들어온다.
    const hasReplyMeta =
      (reply && typeof reply === "object") ||
      hasTruthyId((att as any)?.src_logId) ||
      hasTruthyId((att as any)?.srcLogId) ||
      hasTruthyId((reply as any)?.src_logId) ||
      hasTruthyId((reply as any)?.srcLogId);
    if (!hasReplyMeta) {
      await safeReply(
        this.logger,
        context,
        "답장 테스트 실패: reply 데이터가 없습니다. 카카오톡에서 ‘답장’으로 !reply test (또는 !reply:test) 를 보내주세요.",
        8000,
      );
      return;
    }

    let ok = false;
    try {
      // NOTE: attachment에 BigInt가 섞여 있으면 JSON.stringify가 실패한다.
      // Talk-API로 넘길 payload는 BigInt를 문자열로 정규화한 “JSON-safe” 객체로 보낸다.
      const jsonSafeAttachment = JSON.parse(
        JSON.stringify(att, (_k, v) => (typeof v === "bigint" ? v.toString() : v)),
      ) as Record<string, unknown>;

      ok = await tryServerTalkApiDispatchRaw(
        this.logger,
        rid,
        text,
        sendType,
        jsonSafeAttachment,
        12000,
      );
    } catch (e) {
      ok = false;
      this.logger.warn("[reply:test] dispatch_raw threw", { err: String(e) });
    }

    if (!ok) {
      try {
        await messageStore.record(context, {
          type: "reply_test_failed",
          roomId: rid,
          rawType,
          hasReply: true,
          message: text,
        });
      } catch (e) {
        this.logger.warn("[reply:test] failed record failed", { err: String(e) });
      }
      await safeReply(
        this.logger,
        context,
        "답장 테스트 발신 실패: 외부 Talk API 설정(enabled/authHeader) 또는 SAFE_MODE를 확인하세요.",
        9000,
      );
      return;
    }

    try {
      await messageStore.record(context, {
        type: "reply_test_sent",
        roomId: rid,
        rawType,
        message: text,
        src: {
          src_logId: (reply as any)?.src_logId,
          src_userId: (reply as any)?.src_userId,
          src_type: (reply as any)?.src_type,
        },
      });
    } catch (e) {
      this.logger.warn("[reply:test] sent record failed", { err: String(e) });
    }
  }
}

export default CustomMessageControllerBang;
