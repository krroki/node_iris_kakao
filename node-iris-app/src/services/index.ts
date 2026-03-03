import { BroadcastSchedulerService } from "./broadcastScheduler";
import { MessageStore } from "./messageStore";
import { WelcomeFollowUpService } from "./welcomeFollowUp";

export const messageStore = new MessageStore();
export const broadcastService = new BroadcastSchedulerService();
export const welcomeFollowUp = new WelcomeFollowUpService({
  record: async (context, payload) => {
    await messageStore.record(context as any, payload as any);
  },
});

// Announcement 중복 방지 캐시 (TTL 5분)
export { announcementDedup } from "./dedupCache";

export type { BroadcastTask } from "./broadcastScheduler";
export type {
  RecordedEvent,
  RecordedEventPayload,
  ChatSummaryMessage,
} from "./messageStore";
