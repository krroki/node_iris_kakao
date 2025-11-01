import { ChatContext } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

export interface RecordedEventPayload {
  [key: string]: unknown;
  type: string;
}

export interface RecordedEvent {
  timestamp: string;
  snapshot: ChatSnapshot;
  payload: RecordedEventPayload;
}

export interface ChatSnapshot {
  roomId: string;
  roomName?: string;
  senderId?: string;
  senderName?: string;
  messageId?: string;
  messageText?: string;
}

export class MessageStore {
  private readonly baseDir: string;
  private readonly bufferSize: number;
  private readonly buffer = new Map<string, RecordedEvent[]>();
  private readonly lastKey = new Map<string, string>();

  constructor(baseDir?: string, bufferSize = 100) {
    this.baseDir = baseDir ?? process.env.MESSAGE_LOG_DIR ?? "data/logs";
    this.bufferSize = bufferSize;
  }

  async record(context: ChatContext, payload: RecordedEventPayload): Promise<RecordedEvent> {
    const snapshot = await this.toSnapshot(context);
    const record: RecordedEvent = {
      timestamp: new Date().toISOString(),
      snapshot,
      payload,
    };

    await this.persist(snapshot.roomId, record);
    this.pushToBuffer(snapshot.roomId, record);
    return record;
  }

  getRecent(roomId: string): RecordedEvent[] {
    return [...(this.buffer.get(roomId) ?? [])];
  }

  async clear(): Promise<void> {
    this.buffer.clear();
    await fs.rm(this.baseDir, { recursive: true, force: true });
  }

  private async persist(roomId: string, record: RecordedEvent): Promise<void> {
    // Deduplicate immediate duplicates (same ts/sender/message) per room
    const k = JSON.stringify([
      record.timestamp,
      record.snapshot.senderId,
      record.snapshot.messageId,
      record.snapshot.messageText,
    ]);
    const prev = this.lastKey.get(roomId);
    if (prev && prev === k) {
      return; // skip duplicate write
    }
    this.lastKey.set(roomId, k);

    const roomDir = path.join(this.baseDir, roomId);
    await fs.mkdir(roomDir, { recursive: true });
    const filePath = path.join(roomDir, `${record.timestamp.slice(0, 10)}.log`);
    await fs.appendFile(filePath, JSON.stringify(record) + "\n", "utf8");
  }

  private pushToBuffer(roomId: string, record: RecordedEvent): void {
    const list = this.buffer.get(roomId) ?? [];
    list.push(record);
    while (list.length > this.bufferSize) {
      list.shift();
    }
    this.buffer.set(roomId, list);
  }

  private async toSnapshot(context: ChatContext): Promise<ChatSnapshot> {
    const roomId = String(context.room?.id ?? "unknown");
    const room = context.room as any;
    const roomName = await this.resolveMaybeAsync(
      room && typeof room.getName === "function" ? room.getName.bind(room) : undefined,
      typeof room?.name === "string" ? room.name : undefined,
    );
    const sender = context.sender as any;
    const senderId = sender ? String(sender.id ?? "") : undefined;
    const senderName = await this.resolveMaybeAsync(
      sender && typeof sender.getName === "function" ? sender.getName.bind(sender) : undefined,
      sender?.name,
    );
    const messageId =
      context.message && "id" in context.message ? String((context.message as any).id ?? "") : undefined;
    const messageText =
      context.message && "msg" in context.message ? String((context.message as any).msg ?? "") : undefined;

    return {
      roomId,
      roomName,
      senderId,
      senderName,
      messageId,
      messageText,
    };
  }

  private async resolveMaybeAsync<T>(
    maybeFn: (() => Promise<T> | T) | undefined,
    fallback?: T,
  ): Promise<T | undefined> {
    if (typeof maybeFn === "function") {
      try {
        return await maybeFn();
      } catch {
        return fallback;
      }
    }
    return fallback;
  }
}
