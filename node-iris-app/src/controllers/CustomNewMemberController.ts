import {
  ChatContext,
  Command,
  Logger,
  NewMemberController,
} from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";
import { isSafeMode, isRoomAllowed, isFeatureEnabledForContext } from "../utils/guard";

interface WelcomeTemplate {
  version: string;
  templateName: string;
  messages: {
    text: string;
    image: string | null;
  };
  settings: {
    sendDelay: number;
    sendImage: boolean;
    logWelcome: boolean;
  };
}

@NewMemberController
class CustomNewMemberController {
  private logger: Logger;
  private templateCache: Map<string, WelcomeTemplate> = new Map();

  constructor() {
    this.logger = new Logger(CustomNewMemberController.name);
  }

  @Command
  async onNewMember(context: ChatContext) {
    try {
      if (await isSafeMode()) {
        this.logger.warn("SAFE_MODE on: skip welcome message");
        return;
      }

      const allowed = await isRoomAllowed(context);
      const welcomeEnabled = await isFeatureEnabledForContext(context, "welcome");
      if (!allowed || !welcomeEnabled) {
        this.logger.warn("Room not allowed: skip welcome", {
          roomId: String(context.room.id),
        });
        return;
      }
      const userName = await context.sender.getName();
      const roomName = await context.room.name;

      this.logger.info(
        `New member joined: ${userName} in room ${roomName || context.room.id}`
      );

      // Load welcome template
      const templateName = process.env.WELCOME_TEMPLATE || "default";
      const template = await this.loadTemplate(templateName);

      // Replace variables in message
      const message = this.replaceVariables(template.messages.text, {
        userName: userName || "Guest",
        roomName: roomName || "this room",
        time: new Date().toLocaleTimeString("ko-KR"),
        date: new Date().toLocaleDateString("ko-KR"),
      });

      // Send welcome message with delay
      setTimeout(async () => {
        if (await isSafeMode()) return;
        await context.reply(message);

        if (template.settings.logWelcome) {
          this.logWelcome(context, userName, templateName);
        }
      }, template.settings.sendDelay);
    } catch (error) {
      this.logger.error("Failed to send welcome message:", error);
    }
  }

  private async loadTemplate(name: string): Promise<WelcomeTemplate> {
    // Check cache first
    if (this.templateCache.has(name)) {
      return this.templateCache.get(name)!;
    }

    // Load from file
    const templatePath = path.join(
      process.cwd(),
      "..",
      "config",
      "templates",
      "welcome",
      `${name}.json`
    );

    try {
      const content = await fs.readFile(templatePath, "utf8");
      const template: WelcomeTemplate = JSON.parse(content);
      this.templateCache.set(name, template);
      return template;
    } catch (error) {
      this.logger.warn(
        `Failed to load template "${name}", using fallback:`,
        error
      );
      return this.getFallbackTemplate();
    }
  }

  private replaceVariables(
    text: string,
    variables: Record<string, string>
  ): string {
    let result = text;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
    }
    return result;
  }

  private getFallbackTemplate(): WelcomeTemplate {
    return {
      version: "1.0",
      templateName: "fallback",
      messages: {
        text: "{userName}님, 환영합니다! >>help 명령어로 사용법을 확인하세요.",
        image: null,
      },
      settings: {
        sendDelay: 1000,
        sendImage: false,
        logWelcome: true,
      },
    };
  }

  private logWelcome(
    context: ChatContext,
    userName: string | null,
    template: string
  ): void {
    this.logger.info(`Welcome message sent`, {
      roomId: String(context.room.id),
      userName: userName || "Unknown",
      template,
      timestamp: new Date().toISOString(),
    });
  }
}

export default CustomNewMemberController;
