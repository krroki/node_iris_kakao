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
    if (typeof msg?.msg === "string" && msg.msg) {
      raw = msg.msg;
    } else if (typeof msg?.text === "string" && msg.text) {
      raw = msg.text;
    } else if (typeof msg?.plainText === "string" && msg.plainText) {
      raw = msg.plainText;
    }
    raw = String(raw || "").trim();

    // '!채팅요약' 접두 명령만 인식한다.
    // - cmd === '채팅요약' 인 경우는 Prefix('!')에 의해 파싱된 정식 명령
    // - raw.startsWith('!채팅요약') 는 혹시 모를 원문 텍스트 기반 백업 경로
    const isChatSummaryCmd =
      cmd === "채팅요약" ||
      raw.startsWith("!채팅요약");

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

    try {
      const messages = await messageStore.loadRecentMessages(roomId, 300);
      if (!messages.length) {
        await safeReply(this.logger, context, "오늘 날짜 기준으로 요약할 채팅 로그가 없습니다.", 6000);
        return;
      }

      const base = process.env.KB_URL || "http://127.0.0.1:8610";
      const res = await fetch(`${base.replace(/\/+$/, "")}/chat/summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          room_id: roomId,
          room_name: roomName,
          messages: messages.map((m) => ({
            ts: m.ts,
            sender: m.sender,
            text: m.text,
          })),
        }),
      });

      let body: any = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }

      if (!res.ok || !body?.ok) {
        this.logger.warn("[chat-summary] failed", {
          status: res.status,
          body,
        });
        await safeReply(this.logger, context, "채팅 요약 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.", 6000);
        return;
      }

      const answer: string = String(body.answer || "").trim();
      if (!answer) {
        await safeReply(this.logger, context, "채팅 요약 결과가 비어 있습니다.", 6000);
        return;
      }

      await safeReply(this.logger, context, answer, 15000);
    } catch (e) {
      this.logger.error("[chat-summary] unexpected error", e as any);
      try {
        await safeReply(this.logger, context, "채팅 요약 처리 중 예기치 못한 오류가 발생했습니다.", 6000);
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
