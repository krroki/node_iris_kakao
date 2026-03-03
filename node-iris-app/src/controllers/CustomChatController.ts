import {
  ChatController,
  ChatContext,
  Logger,
  OnMessage,
} from "@tsuki-chat/node-iris";
import { messageStore, welcomeFollowUp } from "../services";
import { updateStatus } from "../utils/status";

@ChatController
class CustomChatController {
  private logger: Logger;

  constructor() {
    this.logger = new Logger(CustomChatController.name);
  }

  @OnMessage
  async onChat(context: ChatContext) {
    const rid = String(context.room.id);
    try {
      const rec = await messageStore.record(context, {
        type: "message",
        // welcome-worker(ADR-0027)에서 이미지/Reply 트리거 판단을 위해 messageType을 함께 기록한다.
        messageType: (context.message as any)?.type ?? null,
        attachment: (context.message as any)?.attachment ?? null,
      });

      // 코어 상태 파일(status.json) 갱신: AI/Welcome 워커 분리 후에도 "최근 이벤트 수신" 모니터링이 유지되어야 한다.
      void updateStatus({
        lastEventTs: new Date().toISOString(),
        lastEventRoomId: rid,
        lastEventText: rec?.snapshot?.messageText ? String(rec.snapshot.messageText).slice(0, 300) : "",
      }).catch(() => {});
    } catch (error) {
      this.logger.error("Failed to record chat message", error);
    }

    // Welcome follow-up (첫 이미지 1회 답장) 트리거 처리
    try {
      const dispatcher = String(process.env.WELCOME_DISPATCHER || "worker").toLowerCase().trim();
      if (dispatcher === "bot") {
        await welcomeFollowUp.handleChatMessage(context);
      }
    } catch (error) {
      this.logger.error("[welcome_followup] handleChatMessage failed", error);
    }
  }
}

export default CustomChatController;
