import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type BroadcastStatus = "pending" | "sent" | "failed";

export interface BroadcastTask {
  id: string;
  channels: string[];
  payload: Record<string, unknown>;
  status: BroadcastStatus;
  attempts: number;
  createdAt: number;
  scheduledAt: number;
  lastError?: string;
  completedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface EnqueueOptions {
  scheduledAt?: number;
  metadata?: Record<string, unknown>;
}

export class BroadcastSchedulerService {
  private readonly filePath: string;
  private queue: BroadcastTask[] = [];
  private loaded = false;

  constructor(filePath?: string) {
    this.filePath = filePath ?? process.env.BROADCAST_DB ?? "data/broadcast-queue.json";
  }

  async enqueue(channels: string[], payload: Record<string, unknown>, options: EnqueueOptions = {}): Promise<BroadcastTask> {
    await this.ensureLoaded();
    const now = Date.now();
    const task: BroadcastTask = {
      id: crypto.randomUUID(),
      channels: channels.map((channel) => String(channel)),
      payload,
      status: "pending",
      attempts: 0,
      createdAt: now,
      scheduledAt: options.scheduledAt ?? now,
      metadata: options.metadata,
    };
    this.queue.push(task);
    await this.persist();
    return task;
  }

  async fetchDue(limit = 5): Promise<BroadcastTask[]> {
    await this.ensureLoaded();
    const now = Date.now();
    return this.queue
      .filter((task) => task.status === "pending" && task.scheduledAt <= now)
      .slice(0, limit)
      .map((task) => ({ ...task, channels: [...task.channels], payload: { ...task.payload } }));
  }

  async markSuccess(taskId: string): Promise<void> {
    await this.ensureLoaded();
    const task = this.queue.find((item) => item.id === taskId);
    if (!task) return;
    task.status = "sent";
    task.completedAt = Date.now();
    await this.persist();
  }

  async markRetry(taskId: string, error: string, maxAttempts = 3): Promise<void> {
    await this.ensureLoaded();
    const task = this.queue.find((item) => item.id === taskId);
    if (!task) return;
    task.attempts += 1;
    task.lastError = error;
    if (task.attempts >= maxAttempts) {
      task.status = "failed";
      task.completedAt = Date.now();
    } else {
      const backoff = Math.min(60_000, 2_000 * task.attempts ** 2);
      task.scheduledAt = Date.now() + backoff;
    }
    await this.persist();
  }

  async listActive(): Promise<BroadcastTask[]> {
    await this.ensureLoaded();
    return this.queue.filter((task) => task.status === "pending").map((task) => ({ ...task }));
  }

  async clear(): Promise<void> {
    this.queue = [];
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      this.queue = JSON.parse(raw);
    } catch (error: unknown) {
      if (this.isNotFoundError(error)) {
        this.queue = [];
        await this.persist();
      } else {
        throw error;
      }
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(this.queue, null, 2), "utf8");
  }

  private isNotFoundError(error: unknown): error is NodeJS.ErrnoException {
    return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT");
  }
}
