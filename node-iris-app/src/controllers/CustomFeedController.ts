import {
  ChatContext,
  FeedController,
  Logger,
  OnInviteUserFeed,
  OnLeaveUserFeed,
} from "@tsuki-chat/node-iris";
import { messageStore } from "../services";

@FeedController
class CustomFeedController {
  private logger: Logger;

  constructor() {
    this.logger = new Logger(CustomFeedController.name);
  }

  @OnInviteUserFeed
  async onInvite(context: ChatContext) {
    try {
      await messageStore.record(context, { type: "join" });
    } catch (error) {
      this.logger.error("Failed to record invite feed", error);
    }
  }

  @OnLeaveUserFeed
  async onLeave(context: ChatContext) {
    try {
      await messageStore.record(context, { type: "leave" });
    } catch (error) {
      this.logger.error("Failed to record leave feed", error);
    }
  }
}

export default CustomFeedController;
