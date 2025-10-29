import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { mkdtemp, rm } from "fs/promises";
import { BroadcastSchedulerService } from "../src/services/broadcastScheduler";

describe("BroadcastSchedulerService", () => {
  let tempDir: string;
  let scheduler: BroadcastSchedulerService;
  let queuePath: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "broadcast-queue-"));
    queuePath = path.join(tempDir, "queue.json");
    scheduler = new BroadcastSchedulerService(queuePath);
  });

  afterEach(async () => {
    await scheduler.clear();
    await rm(tempDir, { recursive: true, force: true });
  });

  it("enqueues and fetches due tasks", async () => {
    await scheduler.enqueue(["1001"], { message: "hello" }, { scheduledAt: Date.now() - 1000 });
    const due = await scheduler.fetchDue();
    expect(due).toHaveLength(1);
    expect(due[0].payload.message).toBe("hello");
  });

  it("marks success and removes tasks from pending list", async () => {
    const task = await scheduler.enqueue(["1001"], { message: "hello" }, { scheduledAt: Date.now() - 1000 });
    await scheduler.markSuccess(task.id);
    const active = await scheduler.listActive();
    expect(active).toHaveLength(0);
  });

  it("retries with backoff and fails after max attempts", async () => {
    const task = await scheduler.enqueue(["1001"], { message: "hello" }, { scheduledAt: Date.now() - 1000 });
    await scheduler.markRetry(task.id, "temporary-error", 2);
    let active = await scheduler.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].attempts).toBe(1);
    expect(active[0].status).toBe("pending");

    await scheduler.markRetry(task.id, "temporary-error", 2);
    active = await scheduler.listActive();
    expect(active).toHaveLength(0);
    const due = await scheduler.fetchDue();
    expect(due).toHaveLength(0);
  });
});
