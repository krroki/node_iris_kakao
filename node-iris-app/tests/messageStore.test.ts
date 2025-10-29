import { afterEach, beforeEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { mkdtemp, readFile, rm } from "fs/promises";
import { MessageStore } from "../src/services/messageStore";

const createContext = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    room: { id: "123", name: "test-room" },
    sender: {
      id: "456",
      name: "tester",
      getName: async () => "tester",
    },
    message: {
      id: 789,
      msg: "hello world",
      attachment: { type: "text" },
    },
    ...overrides,
  } as any);

describe("MessageStore", () => {
  let tempDir: string;
  let store: MessageStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "message-store-"));
    store = new MessageStore(tempDir, 2);
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("records events to disk and buffer", async () => {
    const context = createContext();
    const record = await store.record(context, {
      type: "message",
      extra: "value",
    });

    const buffer = store.getRecent("123");
    expect(buffer).toHaveLength(1);
    expect(buffer[0].payload.type).toBe("message");

    const logPath = path.join(
      tempDir,
      "123",
      `${record.timestamp.slice(0, 10)}.log`,
    );
    const logContent = await readFile(logPath, "utf8");
    const parsed = JSON.parse(logContent.trim());
    expect(parsed.snapshot.roomId).toBe("123");
    expect(parsed.payload.extra).toBe("value");
  });

  it("maintains a bounded in-memory buffer", async () => {
    await store.record(createContext({ message: { id: 1, msg: "first" } }), {
      type: "message",
    });
    await store.record(createContext({ message: { id: 2, msg: "second" } }), {
      type: "message",
    });
    await store.record(createContext({ message: { id: 3, msg: "third" } }), {
      type: "message",
    });

    const buffer = store.getRecent("123");
    expect(buffer).toHaveLength(2);
    expect(buffer[0].snapshot.messageText).toBe("second");
    expect(buffer[1].snapshot.messageText).toBe("third");
  });

  it("clears persisted files", async () => {
    await store.record(createContext(), { type: "message" });
    await store.clear();
    const buffer = store.getRecent("123");
    expect(buffer).toHaveLength(0);
  });
});
