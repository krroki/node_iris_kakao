import Bot, {
  BotCommand,
  ChatContext,
  MessageController,
  Prefix,
} from "@tsuki-chat/node-iris";
import { safeReplyWithMentions, safeReply, resolveTemplateImageUrls, safeReplyImageUrls } from "../utils/sender";
import { Logger } from "@tsuki-chat/node-iris";
import { isRoomAllowed, isSafeMode } from "../utils/guard";
import path from "path";
import { promises as fs } from "fs";

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
    if (!(await this.shouldHandle(context))) return;
    const userName = (await context.sender.getName()) || "Guest";
    const roomName = (await context.room.name) || "this room";
    const senderId = String((context.sender as any)?.id || (context.sender as any)?.userId || "");

    const getTemplateName = async (): Promise<string> => {
      try {
        const p = path.join(__dirname, "..", "..", "config", "runtime.json");
        const raw = await fs.readFile(p, "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.templateByFeature?.welcome && typeof parsed.templateByFeature.welcome === "string" && parsed.templateByFeature.welcome.trim()) {
          return parsed.templateByFeature.welcome.trim();
        }
        if (parsed && typeof parsed.welcomeTemplateName === "string" && parsed.welcomeTemplateName.trim()) {
          return parsed.welcomeTemplateName.trim();
        }
      } catch {}
      return process.env.WELCOME_TEMPLATE || "default";
    };

    const loadTemplate = async (name: string): Promise<{ text: string; image: string | null }> => {
      const p = path.join(__dirname, "..", "..", "config", "templates", "welcome", `${name}.json`);
      try {
        const raw = await fs.readFile(p, "utf8");
        const parsed = JSON.parse(raw);
        const text =
          typeof parsed?.messages?.text === "string"
            ? parsed.messages.text
            : typeof parsed?.content === "string"
              ? parsed.content
              : "{userName}님 환영합니다!";
        const image =
          typeof parsed?.messages?.image === "string"
            ? parsed.messages.image
            : Array.isArray(parsed?.images) && parsed.images.length
              ? String(parsed.images[0])
              : null;
        return { text, image };
      } catch {
        return { text: "{userName}님 환영합니다!", image: null };
      }
    };

    const renderText = (text: string): { text: string; hasMention: boolean } => {
      let hasMention = false;
      const vars: Record<string, string> = {
        userName,
        roomName,
        time: new Date().toLocaleTimeString("ko-KR"),
        date: new Date().toLocaleDateString("ko-KR"),
        entrant: "디하클",
        entrance: "디하클",
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
      const tplName = await getTemplateName();
      const tpl = await loadTemplate(tplName);
      const { text, hasMention } = renderText(tpl.text);
      const images = tpl.image ? resolveTemplateImageUrls(tpl.image) : [];

      if (hasMention && senderId) {
        try {
          await safeReplyWithMentions(this.logger, context, text, [{ name: userName, userId: senderId }], 8000);
        } catch {
          await safeReply(this.logger, context, text, 8000);
        }
      } else {
        await safeReply(this.logger, context, text, 8000);
      }
      if (images && images.length) {
        try {
          await safeReplyImageUrls(this.logger, context, images, 10000);
        } catch (e) {
          this.logger.warn("[welcome:test] replyImageUrls failed; will send URLs as text", { err: String(e) });
          try { await safeReply(this.logger, context, images.join('\n'), 8000); } catch {}
        }
      }
      this.logger.info("[welcome:test] sent (!)", { tplName, hasMention, images: images.length });
    } catch (e) {
      this.logger.error("[welcome:test] failed (!)", e as any);
      await safeReply(this.logger, context, "웰컴 템플릿 테스트 중 오류가 발생했습니다.", 5000);
    }
  }
}

export default CustomMessageControllerBang;
