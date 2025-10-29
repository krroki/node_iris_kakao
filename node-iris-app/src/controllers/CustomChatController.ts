import {
  ChatController,
  ChatContext,
  Logger,
  OnMessage,
} from "@tsuki-chat/node-iris";
import { messageStore } from "../services";

@ChatController
class CustomChatController {
  private logger: Logger;

  constructor() {
    this.logger = new Logger(CustomChatController.name);
  }

  @OnMessage
  async onChat(context: ChatContext) {
    try {
      await messageStore.record(context, {
        type: "message",
        attachment: (context.message as any)?.attachment ?? null,
      });
    } catch (error) {
      this.logger.error("Failed to record chat message", error);
    }
  }
}

export default CustomChatController;
