import { ChatContext } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

// BigInt를 문자열로 변환하는 JSON replacer
function bigIntReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

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

export interface ChatSummaryMessage {
  ts: string;
  sender?: string;
  text: string;
}

export class MessageStore {
  private readonly baseDir: string;
  private readonly bufferSize: number;
  private readonly buffer = new Map<string, RecordedEvent[]>();
  private readonly lastKey = new Map<string, string>();
  // Persist 동시성 제한 (burst 상황에서 appendFile 동시 오픈이 과도해 EMFILE로 이어지는 것을 방지)
  private readonly persistConcurrency: number;
  private persistActive = 0;
  private readonly persistWaiters: Array<() => void> = [];
  private readonly ensuredRoomDirs = new Set<string>();

  // EMFILE(too many open files) 발생 추적 (UI/상태에서 가시화)
  private emfileActive = false;
  private emfileLastLoggedAt = 0;

  constructor(baseDir?: string, bufferSize = 100) {
    this.baseDir = baseDir ?? process.env.MESSAGE_LOG_DIR ?? "data/logs";
    this.bufferSize = bufferSize;
    const raw = String(process.env.MESSAGE_STORE_PERSIST_CONCURRENCY || "").trim();
    const n = raw ? Number(raw) : Number.NaN;
    // Windows 환경에서 burst 상황에 EMFILE(too many open files) 발생이 관측되므로 기본값을 보수적으로 둔다.
    // 필요 시 운영 스크립트에서 MESSAGE_STORE_PERSIST_CONCURRENCY로 상향 가능.
    this.persistConcurrency = Number.isFinite(n) && n > 0 ? Math.min(64, Math.max(1, Math.floor(n))) : 2;
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

  /**
   * ChatContext가 없는 워커/백그라운드 프로세스에서 이벤트를 기록하기 위한 API.
   *
   * 주의:
   * - 동일 roomId/date 로그 파일에 여러 프로세스가 동시에 append 하면 OS/FS에 따라 라인 interleave가 발생할 수 있다.
   * - 따라서 운영에서는 가급적 "코어(bot)"만 MessageStore 로그를 쓰고,
   *   워커는 별도 로그 파일을 사용하거나(권장) 서버를 통해 기록하는 경로를 추가한 뒤 사용한다.
   */
  async recordSynthetic(snapshot: ChatSnapshot, payload: RecordedEventPayload): Promise<RecordedEvent> {
    const roomId = String(snapshot?.roomId || "").trim();
    if (!roomId) {
      throw new Error("recordSynthetic: snapshot.roomId is required");
    }

    const record: RecordedEvent = {
      timestamp: new Date().toISOString(),
      snapshot: {
        roomId,
        roomName: snapshot.roomName,
        senderId: snapshot.senderId,
        senderName: snapshot.senderName,
        messageId: snapshot.messageId,
        messageText: snapshot.messageText,
      },
      payload,
    };

    await this.persist(roomId, record);
    this.pushToBuffer(roomId, record);
    return record;
  }

  getRecent(roomId: string): RecordedEvent[] {
    return [...(this.buffer.get(roomId) ?? [])];
  }

  async clear(): Promise<void> {
    this.buffer.clear();
    this.lastKey.clear();
    this.ensuredRoomDirs.clear();
    this.emfileActive = false;
    await fs.rm(this.baseDir, { recursive: true, force: true });
  }

  private async acquirePersistSlot(): Promise<void> {
    if (this.persistActive < this.persistConcurrency) {
      this.persistActive += 1;
      return;
    }
    await new Promise<void>((resolve) => this.persistWaiters.push(resolve));
    this.persistActive += 1;
  }

  private releasePersistSlot(): void {
    this.persistActive = Math.max(0, this.persistActive - 1);
    const next = this.persistWaiters.shift();
    if (next) next();
  }

  private async withPersistSlot<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquirePersistSlot();
    try {
      return await fn();
    } finally {
      this.releasePersistSlot();
    }
  }

  private healthPath(): string {
    return path.join(this.baseDir, "..", "bot_health.json");
  }

  private async writeTextAtomic(dst: string, text: string): Promise<void> {
    const dir = path.dirname(dst);
    await fs.mkdir(dir, { recursive: true });
    const tmp = `${dst}.tmp-${process.pid}-${Date.now()}`;
    await fs.writeFile(tmp, text, "utf8");
    const bak = `${dst}.bak`;
    try {
      await fs.unlink(bak);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") throw e;
    }
    try {
      await fs.rename(dst, bak);
    } catch (e: any) {
      if (e && String(e.code || "") !== "ENOENT") throw e;
    }
    try {
      await fs.rename(tmp, dst);
    } finally {
      try {
        await fs.unlink(tmp);
      } catch (e: any) {
        if (e && String(e.code || "") !== "ENOENT") {
          console.error("[MessageStore] cleanup tmp failed:", e);
        }
      }
    }
  }

  private async setEmfileHealth(active: boolean, since?: string): Promise<void> {
    const hp = this.healthPath();
    if (!active) {
      // 과거 EMFILE 플래그가 남아 있으면 제거/해제한다.
      try {
        await fs.unlink(hp);
      } catch (e: any) {
        if (e && String(e.code || "") !== "ENOENT") throw e;
      }
      return;
    }
    const payload = JSON.stringify({ emfile: true, since: since || new Date().toISOString() }, bigIntReplacer);
    await this.writeTextAtomic(hp, payload);
  }

  private async handleEmfile(err: unknown): Promise<void> {
    const now = Date.now();
    if (!this.emfileLastLoggedAt || now - this.emfileLastLoggedAt > 60_000) {
      this.emfileLastLoggedAt = now;
      console.error(
        "[MessageStore] EMFILE: too many open files. " +
        "로그 기록을 위해 디스크 I/O를 직렬화하지만, 현재 프로세스의 파일 핸들 한도를 초과했습니다. " +
        "지속되면 봇 재시작 및 MESSAGE_STORE_PERSIST_CONCURRENCY 조정을 권장합니다.",
      );
      console.error("[MessageStore] EMFILE detail:", err);
    }
    this.emfileActive = true;
    try {
      await this.setEmfileHealth(true);
    } catch (e) {
      // health 파일 기록 실패는 추가 장애 확산을 막기 위해 여기서만 로그로 남긴다.
      console.error("[MessageStore] failed to write bot_health.json for EMFILE:", e);
    }
  }

  /**
   * 오늘 날짜 기준으로 특정 방의 최근 채팅 메시지를 로드한다.
   *
   * - 디스크 로그(JSONL)를 읽어서 timestamp / senderName / messageText만 추려낸다.
   * - summary 용이므로 type === "message" 이고 text가 있는 레코드만 사용한다.
   */
  async loadRecentMessages(roomId: string, limit = 300): Promise<ChatSummaryMessage[]> {
    const day = new Date().toISOString().slice(0, 10);
    const roomDir = path.join(this.baseDir, roomId);
    const filePath = path.join(roomDir, `${day}.log`);
    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf8");
    } catch (err: any) {
      if (err && (err as any).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    const lines = raw.split(/\r?\n/).filter(Boolean);
    const parsed: ChatSummaryMessage[] = [];
    for (const line of lines) {
      try {
        const obj = JSON.parse(line) as RecordedEvent;
        const snap = obj?.snapshot || {};
        const payload = obj?.payload || {};
        const t = (obj as any).timestamp || "";
        const sender = (snap as any).senderName || (snap as any).senderId || "";
        const text = (snap as any).messageText || "";
        if ((payload as any).type !== "message") continue;
        if (!text) continue;
        parsed.push({
          ts: String(t || ""),
          sender: sender ? String(sender) : undefined,
          text: String(text),
        });
      } catch {
        // 파싱 실패한 라인은 무시 (요약 기능이 로그 전체를 망가뜨리지 않도록 방어)
        continue;
      }
    }
    if (parsed.length <= limit) {
      return parsed;
    }
    return parsed.slice(parsed.length - limit);
  }

  private async persist(roomId: string, record: RecordedEvent): Promise<void> {
    // Deduplicate immediate duplicates (same ts/sender/message) per room
    // NOTE: BigInt 필드가 있을 수 있으므로 bigIntReplacer 사용
    const k = JSON.stringify([
      record.timestamp,
      record.snapshot.senderId,
      record.snapshot.messageId,
      record.snapshot.messageText,
    ], bigIntReplacer);
    const prev = this.lastKey.get(roomId);
    if (prev && prev === k) {
      return; // skip duplicate write
    }
    this.lastKey.set(roomId, k);

    const roomDir = path.join(this.baseDir, roomId);
    await this.withPersistSlot(async () => {
      try {
        if (!this.ensuredRoomDirs.has(roomDir)) {
          await fs.mkdir(roomDir, { recursive: true });
          this.ensuredRoomDirs.add(roomDir);
        }
        const filePath = path.join(roomDir, `${record.timestamp.slice(0, 10)}.log`);
        const payload = JSON.stringify(record, bigIntReplacer) + "\n";
        let lastErr: any = null;
        for (let attempt = 0; attempt < 6; attempt += 1) {
          try {
            await fs.appendFile(filePath, payload, "utf8");
            lastErr = null;
            break;
          } catch (err: any) {
            lastErr = err;
            if (err && (err as any).code === "EMFILE") {
              await this.handleEmfile(err);
              // 짧은 백오프 후 재시도(파일 핸들 정리 대기). 최대 1.6s.
              const backoffMs = Math.min(1600, 50 * (2 ** attempt));
              await new Promise((r) => setTimeout(r, backoffMs));
              continue;
            }
            throw err;
          }
        }
        if (lastErr) {
          throw lastErr;
        }

        // EMFILE 상태가 해제되면 health 플래그도 정리한다.
        if (this.emfileActive) {
          this.emfileActive = false;
          try {
            await this.setEmfileHealth(false);
          } catch (e) {
            console.error("[MessageStore] failed to clear bot_health.json:", e);
          }
        }
      } catch (err: any) {
        if (err && (err as any).code === "EMFILE") {
          await this.handleEmfile(err);
        }
        throw err;
      }
    });
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
    // msg가 객체인 경우 JSON.stringify로 변환, 문자열이면 그대로 사용
    const rawMsg = context.message && "msg" in context.message ? (context.message as any).msg : undefined;
    const messageText = typeof rawMsg === "string"
      ? rawMsg
      : rawMsg != null
        ? JSON.stringify(rawMsg, bigIntReplacer)
        : undefined;

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
