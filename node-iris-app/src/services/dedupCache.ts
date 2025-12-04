/**
 * TTL 기반 중복 방지 캐시
 * - 메시지 ID + 소스 방 조합으로 중복 발송 방지
 * - 기본 TTL: 5분 (300,000ms)
 */

interface CacheEntry {
  timestamp: number;
}

class DedupCache {
  private cache: Map<string, CacheEntry> = new Map();
  private ttlMs: number;
  private cleanupIntervalMs: number;
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(ttlMs = 5 * 60 * 1000, cleanupIntervalMs = 60 * 1000) {
    this.ttlMs = ttlMs;
    this.cleanupIntervalMs = cleanupIntervalMs;
    this.startCleanup();
  }

  /**
   * 키가 이미 존재하는지 확인하고, 없으면 추가
   * @returns true if duplicate (already seen), false if new
   */
  isDuplicate(key: string): boolean {
    const now = Date.now();
    const entry = this.cache.get(key);

    if (entry && now - entry.timestamp < this.ttlMs) {
      return true; // 중복
    }

    // 새 항목 추가
    this.cache.set(key, { timestamp: now });
    return false;
  }

  /**
   * 메시지 ID + 소스 방 조합으로 중복 체크
   */
  isMessageDuplicate(msgId: string, sourceRoom: string): boolean {
    const key = `${msgId}:${sourceRoom}`;
    return this.isDuplicate(key);
  }

  /**
   * 만료된 항목 정리
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp >= this.ttlMs) {
        this.cache.delete(key);
      }
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupIntervalMs);
    // 프로세스 종료 시 타이머 정리
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /**
   * 캐시 크기 반환
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 캐시 초기화
   */
  clear(): void {
    this.cache.clear();
  }
}

// 싱글톤 인스턴스 (TTL 5분)
export const announcementDedup = new DedupCache(5 * 60 * 1000);

export default DedupCache;
