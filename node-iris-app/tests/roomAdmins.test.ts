import { describe, expect, it } from "vitest";

import { mergeRoomAdminLists } from "../src/utils/roomAdmins";

describe("room admin cache merge", () => {
  it("preserves recent previous admins when member metadata is incomplete", () => {
    const now = Date.UTC(2026, 2, 8, 12, 0, 0);
    const result = mergeRoomAdminLists({
      previous: {
        updatedAt: new Date(now - 60_000).toISOString(),
        hostUserIds: ["owner-1"],
        subHostUserIds: ["sub-1"],
        adminUserIds: ["owner-1", "sub-1"],
      },
      hostUserIds: ["owner-1"],
      subHostUserIds: [],
      adminUserIds: ["owner-1"],
      loadedMembersCount: 1,
      activeMembersCount: 3,
      nowMs: now,
    });

    expect(result.preservedPrevious).toBe(true);
    expect(result.hostUserIds).toEqual(["owner-1"]);
    expect(result.subHostUserIds).toEqual(["sub-1"]);
    expect(result.adminUserIds).toEqual(["owner-1", "sub-1"]);
  });

  it("does not preserve previous admins when current metadata is complete", () => {
    const now = Date.UTC(2026, 2, 8, 12, 0, 0);
    const result = mergeRoomAdminLists({
      previous: {
        updatedAt: new Date(now - 60_000).toISOString(),
        hostUserIds: ["owner-1"],
        subHostUserIds: ["sub-1"],
        adminUserIds: ["owner-1", "sub-1"],
      },
      hostUserIds: ["owner-2"],
      subHostUserIds: [],
      adminUserIds: ["owner-2"],
      loadedMembersCount: 3,
      activeMembersCount: 3,
      nowMs: now,
    });

    expect(result.preservedPrevious).toBe(false);
    expect(result.hostUserIds).toEqual(["owner-2"]);
    expect(result.subHostUserIds).toEqual([]);
    expect(result.adminUserIds).toEqual(["owner-2"]);
  });

  it("ignores stale previous admins even when metadata is incomplete", () => {
    const now = Date.UTC(2026, 2, 8, 12, 0, 0);
    const result = mergeRoomAdminLists({
      previous: {
        updatedAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
        hostUserIds: ["owner-1"],
        subHostUserIds: ["sub-1"],
        adminUserIds: ["owner-1", "sub-1"],
      },
      hostUserIds: ["owner-2"],
      subHostUserIds: [],
      adminUserIds: ["owner-2"],
      loadedMembersCount: 0,
      activeMembersCount: 3,
      nowMs: now,
    });

    expect(result.preservedPrevious).toBe(false);
    expect(result.hostUserIds).toEqual(["owner-2"]);
    expect(result.subHostUserIds).toEqual([]);
    expect(result.adminUserIds).toEqual(["owner-2"]);
  });
});
