import { Bot, Logger, type LogLevel } from "@tsuki-chat/node-iris";
import "dotenv/config";

// Import controller classes
import CustomBatchController from "./controllers/CustomBatchController";
import CustomBootstrapController from "./controllers/CustomBootstrapController";
import CustomChatController from "./controllers/CustomChatController";
import CustomDeleteMemberController from "./controllers/CustomDeleteMemberController";
import CustomErrorController from "./controllers/CustomErrorController";
import CustomFeedController from "./controllers/CustomFeedController";
import CustomMessageController from "./controllers/CustomMessageController";
import CustomNewMemberController from "./controllers/CustomNewMemberController";
import CustomUnknownController from "./controllers/CustomUnknownController";

const appName = "Create-Node-Iris-App";

// Controller configuration (등록은 런타임에서 SAFE_MODE에 따라 조정)
const controllers = [
  CustomChatController,
  CustomNewMemberController,
  CustomDeleteMemberController,
  CustomMessageController,
  CustomFeedController,
  CustomUnknownController,
  CustomErrorController,
  CustomBatchController,
  CustomBootstrapController,
];

class App {
  private bot: Bot;
  private logger: Logger;

  constructor() {
    const isMock = process.env.MOCK_IRIS === "true";
    const irisUrl =
      process.env.IRIS_URL || (isMock ? "127.0.0.1:3000" : undefined);
    if (!irisUrl) {
      throw new Error("Need IRIS_URL environment variable");
    }
    this.logger = new Logger("Bootstrap");
    this.bot = new Bot(appName, irisUrl, {
      saveChatLogs: process.env.SAVE_CHAT_LOGS === "true",
      autoRegisterControllers: false, // Disable auto-registration
      logLevel: (process.env.LOG_LEVEL as LogLevel) || "debug",
      // httpMode: true, //If you want to use webhook mode, uncomment these lines
      // webhookPort: 3000,
      // webhookPath: "/webhook/message",
    });

    // Register controllers manually (SAFE_MODE일 때 명령어 컨트롤러 비등록)
    const safeMode = (process.env.SAFE_MODE || "").toLowerCase() === "true";
    const toRegister = safeMode
      ? controllers.filter(
          (c) =>
            c !== (CustomMessageController as any) &&
            c !== (CustomNewMemberController as any) &&
            c !== (CustomBatchController as any) &&
            c !== (CustomBootstrapController as any)
        )
      : controllers;
    this.bot.registerControllers(toRegister);
  }

  public async start(): Promise<void> {
    try {
      if (process.env.MOCK_IRIS === "true") {
        this.logger.warn(
          `${this.bot.name} running in MOCK_IRIS mode. Skipping real connection.`
        );
        return;
      }
      if (!process.env.IRIS_URL) {
        throw new Error("Need IRIS_URL environment variable");
      }
      this.logger.info(`${this.bot.name} is starting...`);
      await this.bot.run();
    } catch (error) {
      this.logger.error(`${this.bot.name} failed to start:`, error);
      // Keep process alive and retry periodically instead of exiting
      const delay = Number(process.env.RESTART_DELAY_MS || 5000);
      this.logger.warn(`Retrying start in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
      return this.start();
    }
  }

  public async stop() {
    try {
      this.bot.stop();
    } catch (error) {
      this.logger.error(`${this.bot.name} failed to stop:`, error);
    }
  }
}

export default App;
