import type { ChatContext } from "@tsuki-chat/node-iris";
import { Logger } from "@tsuki-chat/node-iris";
import { randomInt } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { isRoomAllowed, isFeatureEnabledForContext } from "../utils/guard";
import { tryServerTalkApiDispatchRaw } from "../utils/talkapi";
import DedupCache from "./dedupCache";

type WelcomeEntrant = { name: string; senderId: string; joinedAt: number };

type RecordFn = (
  context: ChatContext,
  payload: Record<string, unknown> & { type: string },
) => Promise<void>;

type FollowUpConfig = {
  enabled: boolean;
  windowMs: number;
  maxPendingPerRoom: number;
  replies: string[];
};

type PendingEntry = {
  roomId: string;
  userId: string;
  userName: string;
  joinedAt: number;
  welcomeSentAt: number;
  expiresAt: number;
  inflight: boolean;
};

type LinkIdCacheEntry = { linkId: string; at: number };

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function normalizeKakaoMessageType(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  // Kakao message.type는 환경에 따라 16384 플래그가 붙는 케이스가 있어, reply attachment의 src_type은 base type으로 정규화한다.
  // 예: 2(photo) + 16384
  if (n >= 16384) return n - 16384;
  return n;
}

export class WelcomeFollowUpService {
  private readonly logger = new Logger(WelcomeFollowUpService.name);
  private readonly record: RecordFn;
  private readonly pending = new Map<string, PendingEntry>();
  private readonly photoDedup = new DedupCache(10 * 60 * 1000); // 10분 TTL
  private cleanupTimer: NodeJS.Timeout | null = null;

  // runtime.json 로드 캐시 (에러 시 폴백 금지: 캐시 사용하지 않고 skip)
  private runtimeCache: { at: number; data: any } | null = null;
  private runtimeCacheMs = 1500;
  private lastRuntimeErrAt = 0;

  // roomId -> openchat linkId cache (reply attachment requires src_linkId)
  private readonly linkIdByRoom = new Map<string, LinkIdCacheEntry>();
  private readonly linkIdCacheMs = 30 * 60 * 1000; // 30분

  constructor(opts?: { record?: RecordFn }) {
    this.record = opts?.record || (async () => {});
    this.startCleanup();
  }

  async trackAfterWelcomeSent(context: ChatContext, entrants: WelcomeEntrant[]): Promise<void> {
    const roomId = safeString((context as any)?.room?.id ?? "");
    if (!roomId) return;

    // welcome 자체가 enabled인 방에서만 시작한다 (결정 A)
    const welcomeEnabled = await isFeatureEnabledForContext(context, "welcome");
    if (!welcomeEnabled) return;

    const runtime = await this.loadRuntimeConfig();
    if (!runtime) {
      await this.recordSafe(context, {
        type: "welcome_followup_track_skipped",
        reason: "RUNTIME_LOAD_FAILED",
        roomId,
      });
      return;
    }

    const cfgRes = this.parseConfig(runtime);
    if (!cfgRes.ok) {
      await this.recordSafe(context, {
        type: "welcome_followup_track_skipped",
        reason: "CONFIG_INVALID",
        roomId,
        error: cfgRes.error,
      });
      return;
    }
    const cfg = cfgRes.cfg;
    if (!cfg.enabled) return;

    if (!this.isEnabledForRoom(runtime, roomId)) {
      await this.recordSafe(context, {
        type: "welcome_followup_track_skipped",
        reason: "ROOM_DISABLED",
        roomId,
      });
      return;
    }

    const now = Date.now();
    const validEntrants = Array.isArray(entrants) ? entrants.filter(Boolean) : [];
    if (validEntrants.length === 0) return;

    const maxPending = cfg.maxPendingPerRoom;
    const current = this.countPendingByRoom(roomId);

    const added: Array<{ userId: string; userName: string; joinedAt: number; expiresAt: number }> = [];
    const skipped: Array<{ userId: string; userName: string; reason: string }> = [];

    let roomPending = current;
    for (const e of validEntrants) {
      const userId = safeString((e as any)?.senderId);
      const userName = safeString((e as any)?.name) || "Guest";
      const joinedAt = Number((e as any)?.joinedAt || 0);

      if (!userId) {
        skipped.push({ userId: "", userName, reason: "MISSING_USER_ID" });
        continue;
      }

      const expiresAt = joinedAt > 0 ? joinedAt + cfg.windowMs : now + cfg.windowMs;
      if (expiresAt <= now) {
        skipped.push({ userId, userName, reason: "EXPIRED_BEFORE_TRACK" });
        continue;
      }

      if (roomPending >= maxPending) {
        skipped.push({ userId, userName, reason: "ROOM_PENDING_OVERFLOW" });
        continue;
      }

      const key = `${roomId}:${userId}`;
      this.pending.set(key, {
        roomId,
        userId,
        userName,
        joinedAt: joinedAt > 0 ? joinedAt : now,
        welcomeSentAt: now,
        expiresAt,
        inflight: false,
      });
      roomPending += 1;
      added.push({ userId, userName, joinedAt: joinedAt > 0 ? joinedAt : now, expiresAt });
    }

    if (added.length || skipped.length) {
      await this.recordSafe(context, {
        type: "welcome_followup_track_started",
        roomId,
        windowMs: cfg.windowMs,
        maxPendingPerRoom: cfg.maxPendingPerRoom,
        added,
        skipped,
      });
    }
  }

  async handleChatMessage(context: ChatContext): Promise<void> {
    const roomId = safeString((context as any)?.room?.id ?? "");
    if (!roomId) return;

    const msg: any = (context as any)?.message || {};
    const senderId = safeString((context as any)?.sender?.id ?? (context as any)?.sender?.userId ?? "");
    if (!senderId) return;

    const key = `${roomId}:${senderId}`;
    const entry = this.pending.get(key);
    if (!entry) return;

    const now = Date.now();
    if (now >= entry.expiresAt) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_expired",
        roomId,
        userId: senderId,
        userName: entry.userName,
        joinedAt: entry.joinedAt,
        welcomeSentAt: entry.welcomeSentAt,
        expiresAt: entry.expiresAt,
      });
      return;
    }

    if (entry.inflight) {
      return;
    }

    const normalizedType = normalizeKakaoMessageType((msg as any)?.type ?? (context as any)?.message?.type);
    const isImageType = normalizedType === 2 || normalizedType === 27 || normalizedType === 71;
    if (!isImageType) {
      return;
    }

    const runtime = await this.loadRuntimeConfig();
    if (!runtime) {
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "RUNTIME_LOAD_FAILED",
        roomId,
        userId: senderId,
      });
      return;
    }
    const cfgRes = this.parseConfig(runtime);
    if (!cfgRes.ok) {
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "CONFIG_INVALID",
        roomId,
        userId: senderId,
        error: cfgRes.error,
      });
      return;
    }
    const cfg = cfgRes.cfg;
    if (!cfg.enabled) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "DISABLED",
        roomId,
        userId: senderId,
      });
      return;
    }
    if (!this.isEnabledForRoom(runtime, roomId)) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "ROOM_DISABLED",
        roomId,
        userId: senderId,
      });
      return;
    }

    const photoLogId = safeString(msg?.id ?? msg?.messageId ?? "");
    if (!photoLogId) {
      // 재시도 0 정책: 메타가 없으면 여기서 종료(추가 트리거 방지)
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_failed",
        roomId,
        userId: senderId,
        reason: "MISSING_PHOTO_LOG_ID",
      });
      return;
    }

    const dedupKey = `${roomId}:${photoLogId}`;
    if (this.photoDedup.isDuplicate(dedupKey)) {
      return;
    }

    // Guardrails (SAFE_MODE / allowlist)
    const safeModeOn = runtime?.safeMode === true;
    const allowedRoomIds = Array.isArray(runtime?.allowedRoomIds)
      ? runtime.allowedRoomIds.map((x: any) => safeString(x)).filter(Boolean)
      : [];
    const roomAllowed = allowedRoomIds.length > 0 ? allowedRoomIds.includes(roomId) : await isRoomAllowed(context);
    if (safeModeOn || !roomAllowed) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_dry_run",
        reason: safeModeOn ? "SAFE_MODE" : "ROOM_NOT_ALLOWED",
        roomId,
        userId: senderId,
        photoLogId,
      });
      return;
    }

    const replyText = this.pickRandomReply(cfg.replies);
    if (!replyText) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_failed",
        roomId,
        userId: senderId,
        photoLogId,
        reason: "EMPTY_REPLY_POOL",
      });
      return;
    }

    entry.inflight = true;
    this.pending.set(key, entry);

    // NOTE: Kakao "답장"은 message.type=26 + ReplyAttachment(src_linkId/src_logId/src_userId/src_type/...) 형태여야
    // UI에서 답장으로 렌더링된다. (type=1에 src_logId/src_userId만 넣으면 일반 메시지로 전송되는 케이스 확인)
    const srcLinkId = await this.resolveOpenLinkIdForRoom(roomId);
    if (!srcLinkId) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "MISSING_SRC_LINK_ID",
        roomId,
        userId: senderId,
        photoLogId,
      });
      return;
    }

    const srcType = normalizedType;
    if (srcType == null || !Number.isFinite(srcType)) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "MISSING_SRC_TYPE",
        roomId,
        userId: senderId,
        photoLogId,
      });
      return;
    }

    const srcMessage = safeString((msg as any)?.msg ?? (msg as any)?.text ?? (msg as any)?.plainText ?? "");
    if (!srcMessage) {
      this.pending.delete(key);
      await this.recordSafe(context, {
        type: "welcome_followup_trigger_skipped",
        reason: "MISSING_SRC_MESSAGE",
        roomId,
        userId: senderId,
        photoLogId,
      });
      return;
    }

    // NOTE: 실제 "답장" 메시지 attachment는 src_* 값들이 문자열로 들어오는 케이스가 많다.
    // (특히 src_type이 "2" 같은 문자열) → Kakao 렌더링 일치성을 위해 문자열로 정규화한다.
    const replyAttachment: Record<string, unknown> = {
      src_logId: photoLogId,
      src_userId: senderId,
      src_linkId: srcLinkId,
      src_type: safeString(Math.floor(srcType)),
      src_message: srcMessage,
    };

    let ok = false;
    try {
      ok = await tryServerTalkApiDispatchRaw(this.logger, roomId, replyText, 26, replyAttachment, 12000);
    } catch (e) {
      ok = false;
      this.logger.warn("[welcome_followup] dispatch_raw threw", { err: String(e), roomId, userId: senderId });
    } finally {
      // 재시도 0: 시도 후 상태 종료
      this.pending.delete(key);
    }

    if (!ok) {
      await this.recordSafe(context, {
        type: "welcome_followup_failed",
        roomId,
        userId: senderId,
        photoLogId,
        message: replyText,
        send: { type: 26, attachment: replyAttachment },
      });
      return;
    }

    await this.recordSafe(context, {
      type: "welcome_followup_sent",
      roomId,
      userId: senderId,
      photoLogId,
      message: replyText,
      send: { type: 26, attachment: replyAttachment },
    });
  }

  private pickRandomReply(replies: string[]): string {
    const list = Array.isArray(replies) ? replies.map((s) => safeString(s)).filter(Boolean) : [];
    if (list.length === 0) return "";
    if (list.length === 1) return list[0]!;
    const idx = randomInt(0, list.length);
    return list[idx]!;
  }

  private countPendingByRoom(roomId: string): number {
    let n = 0;
    for (const it of this.pending.values()) {
      if (it.roomId === roomId) n += 1;
    }
    return n;
  }

  private isEnabledForRoom(runtime: any, roomId: string): boolean {
    const feats = runtime?.features;
    const flags = feats && typeof feats === "object" ? (feats as any)[roomId] : null;
    if (flags && typeof flags === "object" && (flags as any).welcomeFollowUp === false) {
      return false;
    }
    return true;
  }

  private parseConfig(runtime: any): { ok: true; cfg: FollowUpConfig } | { ok: false; error: string } {
    const w = runtime?.welcome;
    const fu = w && typeof w === "object" ? (w as any).followUp : null;
    if (!fu || typeof fu !== "object") {
      return { ok: false, error: "welcome.followUp missing" };
    }
    const enabled = (fu as any).enabled;
    if (typeof enabled !== "boolean") return { ok: false, error: "welcome.followUp.enabled must be boolean" };

    const windowMsRaw = (fu as any).windowMs;
    const maxRaw = (fu as any).maxPendingPerRoom;
    const repliesRaw = (fu as any).replies;

    const windowMs = Number(windowMsRaw);
    if (!Number.isFinite(windowMs) || windowMs <= 0 || windowMs > 3_600_000) {
      return { ok: false, error: "welcome.followUp.windowMs must be 1..3600000" };
    }

    const maxPendingPerRoom = Number(maxRaw);
    if (!Number.isFinite(maxPendingPerRoom) || maxPendingPerRoom < 1 || maxPendingPerRoom > 50_000) {
      return { ok: false, error: "welcome.followUp.maxPendingPerRoom must be 1..50000" };
    }

    if (!Array.isArray(repliesRaw) || repliesRaw.length === 0) {
      return { ok: false, error: "welcome.followUp.replies must be a non-empty array of strings" };
    }
    const replies = repliesRaw.map((s: any) => safeString(s)).filter(Boolean);
    if (replies.length === 0) {
      return { ok: false, error: "welcome.followUp.replies must contain at least 1 non-empty string" };
    }

    return { ok: true, cfg: { enabled, windowMs: Math.floor(windowMs), maxPendingPerRoom: Math.floor(maxPendingPerRoom), replies } };
  }

  private runtimeConfigPath(): string {
    return path.join(process.cwd(), "config", "runtime.json");
  }

  private async loadRuntimeConfig(): Promise<any | null> {
    const now = Date.now();
    if (this.runtimeCache && now - this.runtimeCache.at < this.runtimeCacheMs) {
      return this.runtimeCache.data;
    }
    const p = this.runtimeConfigPath();
    try {
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") {
        throw new Error("runtime.json is not an object");
      }
      this.runtimeCache = { at: now, data: parsed };
      return parsed;
    } catch (e) {
      this.runtimeCache = null;
      if (!this.lastRuntimeErrAt || now - this.lastRuntimeErrAt > 60_000) {
        this.lastRuntimeErrAt = now;
        this.logger.error("[welcome_followup] runtime.json load/parse failed", { path: p, err: String(e) });
      }
      return null;
    }
  }

  private async resolveOpenLinkIdForRoom(roomId: string): Promise<string | null> {
    const now = Date.now();
    const cached = this.linkIdByRoom.get(roomId);
    if (cached && now - cached.at < this.linkIdCacheMs) {
      return cached.linkId;
    }

    const base = String(process.env.IRIS_QUERY_BASE || "http://127.0.0.1:5050").replace(/\/+$/, "");
    const url = `${base}/query`;
    const body = {
      // Reply attachment의 src_linkId는 chat_rooms.link_id (open_link id) 기준이 안정적이다.
      // open_chat_member는 멤버 목록이 덜 로딩된 방에서 비어 있을 수 있어, chat_rooms를 우선한다.
      query: "select link_id from chat_rooms where id=?",
      bind: [roomId],
    };

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
      clearTimeout(t);

      const j: any = await res.json().catch(() => null);
      const linkId = safeString(j?.data?.[0]?.link_id ?? j?.data?.[0]?.linkId ?? "");
      if (!linkId) {
        this.logger.warn("[welcome_followup] resolveOpenLinkIdForRoom: empty link_id", {
          roomId,
          httpStatus: res?.status,
        });
        return null;
      }

      this.linkIdByRoom.set(roomId, { linkId, at: now });
      return linkId;
    } catch (e) {
      this.logger.warn("[welcome_followup] resolveOpenLinkIdForRoom failed", { roomId, err: String(e) });
      return null;
    }
  }

  private async recordSafe(context: ChatContext, payload: Record<string, unknown> & { type: string }): Promise<void> {
    try {
      await this.record(context, payload);
    } catch (e) {
      this.logger.warn("[welcome_followup] record failed", { err: String(e), type: payload?.type });
    }
  }

  private startCleanup(): void {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => {
      const now = Date.now();
      let removed = 0;
      for (const [k, v] of this.pending.entries()) {
        if (now >= v.expiresAt) {
          this.pending.delete(k);
          removed += 1;
        }
      }
      if (removed > 0) {
        this.logger.info("[welcome_followup] cleanup expired", { removed, pending: this.pending.size });
      }
    }, 30_000);
    try {
      const t: any = this.cleanupTimer as any;
      if (t && typeof t.unref === "function") t.unref();
    } catch {
      // ignore
    }
  }
}
