export type RoomAdminSnapshotLike = {
  updatedAt?: string;
  hostUserIds?: string[];
  subHostUserIds?: string[];
  adminUserIds?: string[];
};

export type MergeRoomAdminListsInput = {
  previous?: RoomAdminSnapshotLike | null;
  hostUserIds: string[];
  subHostUserIds: string[];
  adminUserIds: string[];
  loadedMembersCount?: number;
  activeMembersCount?: number;
  nowMs?: number;
  previousMaxAgeMs?: number;
};

export type MergeRoomAdminListsResult = {
  hostUserIds: string[];
  subHostUserIds: string[];
  adminUserIds: string[];
  preservedPrevious: boolean;
};

const DEFAULT_PREVIOUS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function uniqUserIds(values: string[] | undefined): string[] {
  const out = new Set<string>();
  for (const raw of values || []) {
    const value = String(raw || "").trim();
    if (!value) continue;
    out.add(value);
  }
  return Array.from(out);
}

function isMetadataIncomplete(loadedMembersCount: number | undefined, activeMembersCount: number | undefined): boolean {
  const loaded = Number(loadedMembersCount);
  const active = Number(activeMembersCount);
  if (!Number.isFinite(loaded) || loaded <= 0) return true;
  if (Number.isFinite(active) && active > 0 && loaded < active) return true;
  return false;
}

function hasFreshPreviousAdmins(
  previous: RoomAdminSnapshotLike | null | undefined,
  nowMs: number,
  previousMaxAgeMs: number,
): boolean {
  const prevAdmins = uniqUserIds(previous?.adminUserIds);
  if (!prevAdmins.length) return false;

  const updatedMs = Date.parse(String(previous?.updatedAt || ""));
  if (!Number.isFinite(updatedMs) || updatedMs <= 0) return false;
  return nowMs - updatedMs <= previousMaxAgeMs;
}

export function mergeRoomAdminLists(input: MergeRoomAdminListsInput): MergeRoomAdminListsResult {
  const nowMs = Number.isFinite(Number(input.nowMs)) ? Math.floor(Number(input.nowMs)) : Date.now();
  const previousMaxAgeMs = Math.max(
    60_000,
    Number.isFinite(Number(input.previousMaxAgeMs))
      ? Math.floor(Number(input.previousMaxAgeMs))
      : DEFAULT_PREVIOUS_MAX_AGE_MS,
  );

  const currentHostUserIds = uniqUserIds(input.hostUserIds);
  const currentSubHostUserIds = uniqUserIds(input.subHostUserIds);
  const currentAdminUserIds = uniqUserIds(input.adminUserIds);

  const preservePrevious =
    isMetadataIncomplete(input.loadedMembersCount, input.activeMembersCount) &&
    hasFreshPreviousAdmins(input.previous, nowMs, previousMaxAgeMs);

  if (!preservePrevious) {
    return {
      hostUserIds: currentHostUserIds,
      subHostUserIds: currentSubHostUserIds,
      adminUserIds: currentAdminUserIds,
      preservedPrevious: false,
    };
  }

  return {
    hostUserIds: uniqUserIds([...(input.previous?.hostUserIds || []), ...currentHostUserIds]),
    subHostUserIds: uniqUserIds([...(input.previous?.subHostUserIds || []), ...currentSubHostUserIds]),
    adminUserIds: uniqUserIds([...(input.previous?.adminUserIds || []), ...currentAdminUserIds]),
    preservedPrevious: true,
  };
}
