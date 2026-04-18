export type WelcomeRecoveryEntrant = {
  senderId?: string;
  joinedAt?: number;
};

export function buildRecentWelcomeSendKey(roomId: string, userId: string, joinedAt: number): string {
  const rid = String(roomId || "").trim();
  const uid = String(userId || "").trim();
  const at = Number.isFinite(Number(joinedAt)) ? Math.max(0, Math.floor(Number(joinedAt))) : 0;
  return `welcome:${rid}:${uid}:${at}`;
}

export function pruneRecentWelcomeSends(
  recent: Record<string, number> | undefined,
  nowMs: number,
  ttlMs: number,
  maxEntries = 2000,
): Record<string, number> {
  const src = recent && typeof recent === "object" ? recent : {};
  const out: Array<[string, number]> = [];
  for (const [key, rawTs] of Object.entries(src)) {
    const ts = Number(rawTs);
    if (!Number.isFinite(ts) || ts <= 0) continue;
    if (nowMs - ts >= ttlMs) continue;
    out.push([key, Math.floor(ts)]);
  }
  out.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(out.slice(0, Math.max(100, Math.floor(maxEntries))));
}

export function filterRecentlyWelcomedEntrants<T extends WelcomeRecoveryEntrant>(
  roomId: string,
  entrants: T[],
  recent: Record<string, number> | undefined,
  nowMs: number,
  ttlMs: number,
): T[] {
  const src = recent && typeof recent === "object" ? recent : {};
  return (Array.isArray(entrants) ? entrants : []).filter((entrant) => {
    const userId = String(entrant?.senderId || "").trim();
    const joinedAt = Number(entrant?.joinedAt || 0);
    if (!userId || !Number.isFinite(joinedAt) || joinedAt <= 0) return true;
    const key = buildRecentWelcomeSendKey(roomId, userId, joinedAt);
    const sentAt = Number(src[key] || 0);
    if (!Number.isFinite(sentAt) || sentAt <= 0) return true;
    return nowMs - sentAt >= ttlMs;
  });
}

export function resolveStartupBackfillSince(
  lastSeenMs: number,
  updatedAt: string | undefined,
  nowMs: number,
  maxAgeMs: number,
): number | null {
  const seen = Number(lastSeenMs);
  if (!Number.isFinite(seen) || seen <= 0) return null;
  const updatedMs = Date.parse(String(updatedAt || ""));
  if (!Number.isFinite(updatedMs) || updatedMs <= 0) return null;
  const ageMs = Math.max(0, nowMs - updatedMs);
  if (ageMs > maxAgeMs) return null;
  return Math.max(0, Math.min(seen, nowMs) - 1500, nowMs - maxAgeMs);
}
