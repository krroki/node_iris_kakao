import { describe, expect, it } from "vitest";

import {
  buildRecentWelcomeSendKey,
  filterRecentlyWelcomedEntrants,
  pruneRecentWelcomeSends,
  resolveStartupBackfillSince,
} from "../src/utils/welcomeRecovery";

describe("welcome recovery", () => {
  it("filters duplicate entrants within the recent welcome TTL", () => {
    const now = 1_710_000_000_000;
    const recent = {
      [buildRecentWelcomeSendKey("room-1", "user-1", 1_000)]: now - 10_000,
    };
    const entrants = [
      { senderId: "user-1", joinedAt: 1_000 },
      { senderId: "user-1", joinedAt: 2_000 },
      { senderId: "user-2", joinedAt: 1_000 },
    ];

    expect(filterRecentlyWelcomedEntrants("room-1", entrants, recent, now, 30 * 60 * 1000)).toEqual([
      { senderId: "user-1", joinedAt: 2_000 },
      { senderId: "user-2", joinedAt: 1_000 },
    ]);
  });

  it("prunes expired and invalid recent welcome entries", () => {
    const now = 1_710_000_000_000;
    const pruned = pruneRecentWelcomeSends(
      {
        alive: now - 1_000,
        expired: now - 31 * 60 * 1000,
        bad: Number.NaN,
      },
      now,
      30 * 60 * 1000,
      100,
    );

    expect(pruned).toEqual({ alive: now - 1_000 });
  });

  it("returns a recent startup backfill cursor only for fresh state", () => {
    const now = 200_000;

    expect(resolveStartupBackfillSince(195_000, new Date(now - 5_000).toISOString(), now, 120_000)).toBe(193_500);
    expect(resolveStartupBackfillSince(195_000, new Date(now - 121_000).toISOString(), now, 120_000)).toBeNull();
    expect(resolveStartupBackfillSince(0, new Date(now - 5_000).toISOString(), now, 120_000)).toBeNull();
  });
});
