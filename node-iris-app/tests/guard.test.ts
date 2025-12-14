import { afterEach, describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import { mkdtemp, mkdir, rm, writeFile } from "fs/promises";

import {
  isFeatureEnabledForRoomId,
  isRoomIdAllowed,
  isAnnouncementAllowed,
  isRoomIdAllowedForAnnouncement,
} from "../src/utils/guard";

const createRuntime = async (cfg: any): Promise<string> => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "runtime-guard-"));
  const configDir = path.join(tempDir, "config");
  await mkdir(configDir, { recursive: true });
  await writeFile(path.join(configDir, "runtime.json"), JSON.stringify(cfg, null, 2), "utf8");
  return tempDir;
};

const originalCwd = process.cwd();
let currentTempDir: string | null = null;

afterEach(async () => {
  // cwd를 원래대로 돌려놓고, 임시 디렉터리 정리
  process.chdir(originalCwd);
  if (currentTempDir) {
    await rm(currentTempDir, { recursive: true, force: true });
    currentTempDir = null;
  }
});

describe("SAFE_MODE / allowedRoomIds / feature 플래그 조합", () => {
  it("ai 기능은 allowedRoomIds에 포함되고 feature.ai=true인 방에서만 활성화된다", async () => {
    currentTempDir = await createRuntime({
      safeMode: false,
      allowedRoomIds: ["ROOM_AI_ON", "ROOM_AI_OFF"],
      features: {
        ROOM_AI_ON: { ai: true },
        ROOM_AI_OFF: { ai: false },
      },
    });
    process.chdir(currentTempDir);

    const aiOn = await isFeatureEnabledForRoomId("ROOM_AI_ON", "ai");
    const aiOff = await isFeatureEnabledForRoomId("ROOM_AI_OFF", "ai");
    const aiUnknown = await isFeatureEnabledForRoomId("ROOM_UNKNOWN", "ai");

    expect(aiOn).toBe(true);
    expect(aiOff).toBe(false);
    expect(aiUnknown).toBe(false);
  });

  it("allowedRoomIds에 없으면 feature가 true여도 비활성화된다", async () => {
    currentTempDir = await createRuntime({
      safeMode: false,
      allowedRoomIds: ["ROOM_ALLOWED"],
      features: {
        ROOM_ALLOWED: { ai: true },
        ROOM_NOT_ALLOWED: { ai: true },
      },
    });
    process.chdir(currentTempDir);

    const allowed = await isFeatureEnabledForRoomId("ROOM_ALLOWED", "ai");
    const notAllowed = await isFeatureEnabledForRoomId("ROOM_NOT_ALLOWED", "ai");

    expect(allowed).toBe(true);
    expect(notAllowed).toBe(false);
  });

  it("isRoomIdAllowed는 allowedRoomIds에 포함 여부만 본다", async () => {
    currentTempDir = await createRuntime({
      safeMode: false,
      allowedRoomIds: ["ROOM1"],
    });
    process.chdir(currentTempDir);

    expect(await isRoomIdAllowed("ROOM1")).toBe(true);
    expect(await isRoomIdAllowed("ROOM2")).toBe(false);
  });

  it("Announcement는 SAFE_MODE=true일 때는 항상 차단된다", async () => {
    currentTempDir = await createRuntime({
      safeMode: true,
      allowedRoomIds: ["ROOM_SRC"],
      announcement: {
        allowWhenSafeMode: true,
        routes: [{ id: "r1", source: "ROOM_SRC", targets: ["ROOM_TGT"], enabled: true }],
      },
    });
    process.chdir(currentTempDir);

    expect(await isAnnouncementAllowed()).toBe(false);
  });

  it("Announcement 대상 방은 allowedRoomIds에 포함되고 excludedRoomIds에 없어야 한다", async () => {
    currentTempDir = await createRuntime({
      safeMode: false,
      allowedRoomIds: ["ROOM_OK", "ROOM_EXCLUDED"],
      excludedRoomIds: ["ROOM_EXCLUDED"],
    });
    process.chdir(currentTempDir);

    expect(await isRoomIdAllowedForAnnouncement("ROOM_OK")).toBe(true);
    expect(await isRoomIdAllowedForAnnouncement("ROOM_EXCLUDED")).toBe(false);
  });
});
