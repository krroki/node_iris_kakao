import { BroadcastSchedulerService } from "./broadcastScheduler";
import { MessageStore } from "./messageStore";

export const messageStore = new MessageStore();
export const broadcastService = new BroadcastSchedulerService();

// Announcement 중복 방지 캐시 (TTL 5분)
export { announcementDedup } from "./dedupCache";

export type { BroadcastTask } from "./broadcastScheduler";
export type { RecordedEvent, RecordedEventPayload } from "./messageStore";
