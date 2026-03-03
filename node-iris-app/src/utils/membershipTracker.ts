const EXPIRE_MS = 5 * 60 * 1000; // 5 minutes

type RoomId = string;
type UserId = string;

const recentLeaves = new Map<RoomId, Map<UserId, number>>();

function normalizeId(id?: string | number | bigint | null): string | null {
  if (id === undefined || id === null) return null;
  try {
    return String(id);
  } catch {
    return null;
  }
}

function cleanup(roomId: RoomId) {
  const bucket = recentLeaves.get(roomId);
  if (!bucket) return;
  const now = Date.now();
  for (const [uid, ts] of bucket.entries()) {
    if (now - ts > EXPIRE_MS) {
      bucket.delete(uid);
    }
  }
  if (bucket.size === 0) {
    recentLeaves.delete(roomId);
  }
}

export function markLeave(roomId: string | number | bigint, userId?: string | number | bigint | null) {
  const rid = normalizeId(roomId);
  const uid = normalizeId(userId);
  if (!rid || !uid) return;
  let bucket = recentLeaves.get(rid);
  if (!bucket) {
    bucket = new Map<UserId, number>();
    recentLeaves.set(rid, bucket);
  }
  bucket.set(uid, Date.now());
  cleanup(rid);
}

export function hasLeftSince(roomId: string | number | bigint, userId?: string | number | bigint | null, since?: number) {
  const rid = normalizeId(roomId);
  const uid = normalizeId(userId);
  if (!rid || !uid) return false;
  cleanup(rid);
  const bucket = recentLeaves.get(rid);
  if (!bucket) return false;
  const ts = bucket.get(uid);
  if (ts == null) return false;
  if (typeof since === "number" && ts < since) return false;
  return true;
}
