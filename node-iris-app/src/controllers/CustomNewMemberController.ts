import {
  ChatContext,
  Command,
  Logger,
  NewMemberController,
} from "@tsuki-chat/node-iris";
import { promises as fs, readFileSync } from "fs";
import path from "path";
import { randomInt } from "crypto";
import { isSafeMode, isRoomAllowed, isFeatureEnabledForContext } from "../utils/guard";
import { APP_ROOT } from "../utils/paths";
import {
  resolveTemplateImageUrls,
  safeReply,
  safeReplyImageUrls,
  safeReplyWithMentions,
} from "../utils/sender";
import { resolveWelcomeTemplateSelection } from "../utils/welcomeTemplatePolicy";
import { messageStore, welcomeFollowUp } from "../services";
import DedupCache from "../services/dedupCache";
import { updateStatus } from "../utils/status";

interface WelcomeTemplate {
  text: string;
  images: string[];
  sendDelayMs: number;
  logWelcome: boolean;
}

type OpenProfileCloseGuideMatch = "profileLinkIdNonZero" | "profileLinkIdZero";
type OpenProfileCloseGuideConfig = {
  enabled: boolean;
  match: OpenProfileCloseGuideMatch;
  text: string;
  images: string[];
};

type WelcomeEntrant = { name: string; senderId: string; joinedAt: number };
type WelcomeBatch = {
  roomId: string;
  roomName: string;
  context: ChatContext;
  entrants: WelcomeEntrant[];
  createdAt: number;
  delayMinMs: number;
  delayMaxMs: number;
  extraDelayMs: number;
  timer: NodeJS.Timeout;
};

const OPEN_PROFILE_GUIDE_DEDUP = new DedupCache(24 * 60 * 60 * 1000); // 24시간

@NewMemberController
class CustomNewMemberController {
  private logger: Logger;
  private templateCache: Map<string, WelcomeTemplate> = new Map();
  private static pendingByRoom: Map<string, WelcomeBatch> = new Map();

  constructor() {
    this.logger = new Logger(CustomNewMemberController.name);
  }

  @Command
  async onNewMember(context: ChatContext) {
    try {
      // NOTE: join 이벤트 직후에는 open_chat_member DB 동기화가 늦어 sender.getName()이 비어 있을 수 있다.
      // 이 경우 feed payload(JSON)에서 nickName/userId를 우선 복구한다.
      const rawJoin = (context.message as any)?.msg;
      let userName = String((await context.sender.getName()) || "").trim();
      const roomName = String((await context.room.name) || "").trim();
      let senderId = String((context.sender as any)?.id || (context.sender as any)?.userId || "").trim();

      // feed payload를 최대한 복원해 "입장 이벤트" 로그를 더 정확히 남긴다.
      const entrants: WelcomeEntrant[] = [];
      if (typeof rawJoin === "string" && rawJoin.trim().startsWith("{")) {
        try {
          const parsed: any = JSON.parse(rawJoin);
          const feedType = Number(parsed?.feedType);
          const members = Array.isArray(parsed?.members)
            ? parsed.members
            : parsed?.member && typeof parsed.member === "object"
              ? [parsed.member]
              : [];
          if (feedType === 4 && members.length > 0) {
            const m0: any = members[0];
            const id2 = String(m0?.userId || "").trim();
            const nm2 = String(m0?.nickName || "").trim();
            if (!senderId && id2) senderId = id2;
            if (!userName && nm2) userName = nm2;

            for (const m of members) {
              const uid = String((m as any)?.userId || "").trim();
              const nm = String((m as any)?.nickName || "").trim();
              if (uid || nm) {
                entrants.push({
                  name: nm || "Guest",
                  senderId: uid,
                  joinedAt: Date.now(),
                });
              }
            }
          }
        } catch {
          // ignore
        }
      }

      if (entrants.length === 0) {
        entrants.push({
          name: userName || "Guest",
          senderId,
          joinedAt: Date.now(),
        });
      }

      // 코어 불변식(ADR-0027):
      // - 신규 입장 이벤트는 항상 로그로 남긴다(분석/워커 처리용).
      // - welcome 발신은 기본적으로 welcome-worker가 담당한다.
      try {
        await messageStore.record(context, {
          type: "member_joined",
          entrants,
        });
      } catch (e) {
        this.logger.warn("[welcome] failed to record member_joined", { err: String(e) });
      }

      // 코어 상태 파일(status.json) 갱신: join 이벤트도 "최근 이벤트 수신"으로 취급한다.
      void updateStatus({
        lastEventTs: new Date().toISOString(),
        lastEventRoomId: String(context.room.id),
        lastEventText: `[member_joined] entrants=${entrants.length}`,
      }).catch(() => {});

      const dispatcher = String(process.env.WELCOME_DISPATCHER || "worker").toLowerCase().trim();
      if (dispatcher !== "bot") {
        this.logger.info("[welcome] dispatcher=worker: skip sending in bot process", {
          roomId: String(context.room.id),
          roomName: roomName || String(context.room.id),
          entrants: entrants.length,
        });
        return;
      }

      // Legacy mode: welcome 발신을 bot 프로세스에서 수행(긴급 롤백/운영용)
      if (await isSafeMode()) {
        this.logger.warn("SAFE_MODE on: skip welcome message");
        return;
      }

      const allowed = await isRoomAllowed(context);
      const welcomeEnabled = await isFeatureEnabledForContext(context, "welcome");
      if (!allowed || !welcomeEnabled) {
        this.logger.warn("Room not allowed: skip welcome", {
          roomId: String(context.room.id),
        });
        return;
      }

      this.logger.info("New member joined (queued)", {
        roomId: String(context.room.id),
        roomName: roomName || String(context.room.id),
        userName: userName || "(empty)",
      });

      this.enqueueWelcome(context, {
        name: userName || "Guest",
        senderId,
        joinedAt: Date.now(),
      }, roomName || String(context.room.id));
    } catch (error) {
      this.logger.error("Failed to send welcome message:", error);
    }
  }

  private readRuntimeConfigStrict(): any {
    const cfgPath = path.join(APP_ROOT, "config", "runtime.json");
    const raw = readFileSync(cfgPath, "utf8");
    return JSON.parse(raw);
  }

  private readWelcomeDelayRangeMs(): { minMs: number; maxMs: number } {
    const cfg = this.readRuntimeConfigStrict();
    const w = (cfg && (cfg as any).welcome) || {};

    const rawMin = (w as any).sendDelayMinMs;
    const rawMax = (w as any).sendDelayMaxMs;

    const hasMin = typeof rawMin === "number" && Number.isFinite(rawMin);
    const hasMax = typeof rawMax === "number" && Number.isFinite(rawMax);

    const minMs = hasMin ? Math.max(0, Math.floor(rawMin)) : 3000;
    const maxMs = hasMax ? Math.max(0, Math.floor(rawMax)) : 5000;

    if (maxMs < minMs) {
      throw new Error(`welcome.sendDelayMaxMs must be >= welcome.sendDelayMinMs (min=${minMs}, max=${maxMs})`);
    }
    return { minMs, maxMs };
  }

  private enqueueWelcome(context: ChatContext, entrant: WelcomeEntrant, roomName: string): void {
    const roomId = String(context.room.id);
    const existing = CustomNewMemberController.pendingByRoom.get(roomId);
    if (existing) {
      existing.entrants.push(entrant);
      this.logger.info("[welcome] batch add", { roomId, count: existing.entrants.length });
      return;
    }

    let delayMinMs = 3000;
    let delayMaxMs = 5000;
    try {
      const d = this.readWelcomeDelayRangeMs();
      delayMinMs = d.minMs;
      delayMaxMs = d.maxMs;
    } catch (e) {
      this.logger.error("[welcome] delay config read failed; use default 3~5s", { err: String(e) });
    }

    const jitter = Math.max(0, delayMaxMs - delayMinMs);
    const extraDelayMs = jitter > 0 ? randomInt(0, jitter + 1) : 0;

    const delayMs = delayMinMs + extraDelayMs;
    const timer = setTimeout(() => {
      void this.flushWelcomeBatch(roomId);
    }, delayMs);
    // optional: don't keep process alive for just the timer
    try {
      const t: any = timer as any;
      if (t && typeof t.unref === "function") t.unref();
    } catch {
      // ignore
    }

    const batch: WelcomeBatch = {
      roomId,
      roomName,
      context,
      entrants: [entrant],
      createdAt: Date.now(),
      delayMinMs,
      delayMaxMs,
      extraDelayMs,
      timer,
    };
    CustomNewMemberController.pendingByRoom.set(roomId, batch);
    this.logger.info("[welcome] batch start", { roomId, delayMinMs, delayMaxMs, delayMs, count: 1 });
  }

  private async flushWelcomeBatch(roomId: string): Promise<void> {
    const batch = CustomNewMemberController.pendingByRoom.get(roomId);
    if (!batch) return;
    CustomNewMemberController.pendingByRoom.delete(roomId);

    const delayMs = batch.delayMinMs + batch.extraDelayMs;
    this.logger.info("[welcome] batch flush", { roomId, count: batch.entrants.length, delayMs });
    void this.sendWelcomeBatch(batch);
  }

  private compileRegexes(regexes: unknown): RegExp[] {
    if (!Array.isArray(regexes) || regexes.length === 0) {
      throw new Error("welcome.kakaoDefaultNicknameRegexes must be a non-empty array of regex strings");
    }
    const list: string[] = regexes.map((x) => String(x || "").trim()).filter(Boolean);
    if (list.length === 0) throw new Error("welcome.kakaoDefaultNicknameRegexes must have at least 1 regex string");
    return list.map((s) => new RegExp(s, "u"));
  }

  private isKakaoDefaultNickname(userNameRaw: string, regexes: RegExp[]): boolean {
    const userName = String(userNameRaw || "").trim();
    if (!userName) return true;
    return regexes.some((re) => re.test(userName));
  }

  private async sendWelcomeBatch(batch: WelcomeBatch): Promise<void> {
    const roomId = batch.roomId;
    const context = batch.context;

    try {
      // Gate again at send time (settings may have changed)
      if (await isSafeMode()) {
        this.logger.warn("[welcome] skip batch send: SAFE_MODE on", { roomId, count: batch.entrants.length });
        return;
      }
      const allowed = await isRoomAllowed(context);
      const welcomeEnabled = await isFeatureEnabledForContext(context, "welcome");
      if (!allowed || !welcomeEnabled) {
        this.logger.warn("[welcome] skip batch send: room not allowed or feature off", { roomId, count: batch.entrants.length });
        return;
      }

      // Decide set-mode + regexes for grouping
      let cfg: any;
      try {
        cfg = this.readRuntimeConfigStrict();
      } catch (e) {
        this.logger.error("[welcome] runtime.json read/parse failed; skip welcome", { roomId, err: String(e) });
        return;
      }
      const w = (cfg && (cfg as any).welcome) || {};
      const sets = w && (w as any).templateSets;

      // Set-mode: split by nickname class and send max 2 messages (CASE1/CASE2)
      if (sets && typeof sets === "object") {
        let compiled: RegExp[] = [];
        try {
          compiled = this.compileRegexes((w as any).kakaoDefaultNicknameRegexes);
        } catch (e) {
          this.logger.error("[welcome] regex compile failed; skip welcome", { roomId, err: String(e) });
          return;
        }

        const kakaoDefaults: WelcomeEntrant[] = [];
        const customs: WelcomeEntrant[] = [];
        for (const e of batch.entrants) {
          const nm = String(e?.name || "").trim();
          const isDefault = this.isKakaoDefaultNickname(nm, compiled);
          (isDefault ? kakaoDefaults : customs).push({
            name: nm || "Guest",
            senderId: String(e?.senderId || "").trim(),
            joinedAt: Number(e?.joinedAt || 0) || Date.now(),
          });
        }

        // 요구: 딜레이 윈도우 내 다중 입장자는 "한 번에" 환영한다.
        // 기본닉/커스텀닉이 섞여도 1개의 welcome 메시지로 통합 발신한다.
        // 템플릿 선택은 (가능하면) 커스텀닉 대표로 수행해 "기본닉 변경 유도" 텍스트가
        // 커스텀닉 사용자에게 섞이지 않도록 한다.
        const merged = [...batch.entrants]
          .map((e) => ({
            name: String(e?.name || "").trim() || "Guest",
            senderId: String(e?.senderId || "").trim(),
            joinedAt: Number(e?.joinedAt || 0) || Date.now(),
          }))
          .filter((e) => e.senderId);
        // joinedAt 순으로 본문 노출 순서를 안정화
        merged.sort((a, b) => a.joinedAt - b.joinedAt);

        const selectionHint = customs.length > 0
          ? customs[0]!
          : kakaoDefaults.length > 0
            ? kakaoDefaults[0]!
            : merged[0];
        if (merged.length) {
          await this.sendWelcomeForEntrants(context, batch.roomName, merged, selectionHint || undefined, w);
        }
        return;
      }

      // Legacy mode: single message, but still support multiple entrants within window
      await this.sendWelcomeForEntrants(context, batch.roomName, batch.entrants, undefined, w);
    } catch (e) {
      this.logger.error("[welcome] unexpected error while sending batch", { roomId, err: String(e) });
    }
  }

  private buildVars(entrants: WelcomeEntrant[], roomName: string): Record<string, string> {
    const now = new Date();
    const names = entrants.map((e) => String(e?.name || "").trim() || "Guest");

    const vars: Record<string, string> = {
      userName: names[0] || "Guest",
      roomName: roomName || "this room",
      time: now.toLocaleTimeString("ko-KR"),
      date: now.toLocaleDateString("ko-KR"),
      entrant: names[0] || "Guest",
      entrance: names[0] || "Guest",
      entranceCount: String(names.length),
      entranceList: names.join(", "),
      entrantList: names.join(", "),
    };

    for (let i = 0; i < names.length; i += 1) {
      const idx = i + 1;
      vars[`entrance${idx}`] = names[i]!;
      vars[`entrant${idx}`] = names[i]!;
    }

    return vars;
  }

  private renderWelcomeText(templateText: string, entrants: WelcomeEntrant[], roomName: string): { text: string; hasMention: boolean } {
    const vars = this.buildVars(entrants, roomName);

    let out = String(templateText || "");

    // Multi-entrant: replace @-placeholders for entrance/entrant/userName to mention all entrants.
    if (entrants.length > 1) {
      const names = entrants.map((e) => String(e?.name || "").trim() || "Guest");
      const mentionPlain = names.map((n) => `@${n}`).join(", ");
      const mentionWithNim = `${mentionPlain} 님`;
      out = out.replace(/@\{(?:entrant|entrance|userName)\}님/g, mentionWithNim);
      out = out.replace(/@\{(?:entrant|entrance|userName)\}/g, mentionPlain);
    }

    let hasMention = false;

    const isOptionalIndexed = (key: string) => /^(entrance|entrant)\d+$/.test(key);

    out = out.replace(/@\{([^}]+)\}/g, (_, k) => {
      const key = String(k || "").trim();
      const aliases = key === "entrant" || key === "entrance" ? [key, "userName"] : [key];
      for (const a of aliases) {
        if (vars[a]) {
          hasMention = true;
          return "@" + vars[a];
        }
      }
      if (isOptionalIndexed(key)) return "";
      return "@{" + key + "}";
    });

    out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
      const key = String(k || "").trim();
      if (vars[key] != null) return String(vars[key]);
      if (isOptionalIndexed(key)) return "";
      return "{{" + key + "}}";
    });
    out = out.replace(/\{([^}]+)\}/g, (_, k) => {
      const key = String(k || "").trim();
      if (vars[key] != null) return String(vars[key]);
      if (isOptionalIndexed(key)) return "";
      return "{" + key + "}";
    });

    // Mention list inserted as plain @name tokens should still be treated as "hasMention"
    if (!hasMention && entrants.some((e) => out.includes("@" + String(e?.name || "").trim()))) {
      hasMention = true;
    }

    return { text: out, hasMention };
  }

  private async sendWelcomeForEntrants(
    context: ChatContext,
    roomName: string,
    entrants: WelcomeEntrant[],
    selectionHint?: WelcomeEntrant,
    welcomeConfig?: any,
  ): Promise<void> {
    const roomId = String(context.room.id);

    // Select template based on the first entrant (set-mode inside resolveWelcomeTemplateSelection handles default/custom)
    let selection: Awaited<ReturnType<typeof resolveWelcomeTemplateSelection>> = null;
    try {
      const first = selectionHint || entrants[0] || { name: "Guest", senderId: "" };
      selection = await resolveWelcomeTemplateSelection({ userName: first.name || "", senderId: first.senderId });
    } catch (e) {
      this.logger.error("[welcome] template selection failed; skip welcome", { roomId, err: String(e) });
      return;
    }
    if (!selection?.templateName) {
      this.logger.warn("[welcome] no template configured; skip welcome", { roomId });
      return;
    }

    const templateName = selection.templateName;
    const template = await this.loadTemplate(templateName);
    if (!template) {
      this.logger.warn("[welcome] template missing/invalid; skip welcome", { roomId, templateName });
      return;
    }

    const { text: message, hasMention } = this.renderWelcomeText(template.text, entrants, roomName);
    const imageUrls = resolveTemplateImageUrls(template.images || []);

    // Only include mentionees that actually appear in message, and cap to 15 (Kakao limit).
    const mentionees = entrants
      .map((e) => ({ name: String(e?.name || "").trim() || "Guest", userId: String(e?.senderId || "").trim() }))
      .filter((m) => m.userId && m.name && message.includes("@" + m.name));

    const mentioneesCapped = mentionees.length > 15 ? mentionees.slice(0, 15) : mentionees;
    if (mentionees.length > 15) {
      this.logger.warn("[welcome] mentionees capped to 15", { roomId, count: mentionees.length });
    }

    try {
      if (hasMention && mentioneesCapped.length) {
        await safeReplyWithMentions(this.logger, context, message, mentioneesCapped, 8000);
      } else {
        await safeReply(this.logger, context, message, 8000);
      }

      // Decision(A): welcome 메시지 발신 성공 후에만 follow-up 트래킹을 시작한다.
      try {
        await welcomeFollowUp.trackAfterWelcomeSent(
          context,
          entrants.map((e) => ({ name: e.name, senderId: e.senderId, joinedAt: e.joinedAt })),
        );
      } catch (e) {
        this.logger.warn("[welcome_followup] trackAfterWelcomeSent failed", { roomId, err: String(e) });
      }

      // 이미지 발송 실패가 follow-up 트래킹을 막지 않도록 분리한다.
      if (imageUrls.length) {
        try {
          await safeReplyImageUrls(this.logger, context, imageUrls, 10000);
        } catch (e) {
          this.logger.error("[welcome] image send failed", { roomId, err: String(e) });
        }
      }

      try {
        await this.maybeSendOpenProfileCloseGuide(context, roomName, entrants, welcomeConfig);
      } catch (e) {
        this.logger.warn("[welcome-open-profile] unexpected error; skip", { roomId, err: String(e) });
      }

      this.logWelcome(context, entrants.map((e) => e.name).filter(Boolean).join(", "), {
        templateName,
        nicknameClass: selection.nicknameClass,
        source: selection.source,
        pick: selection.pick,
        setKey: selection.setKey,
      });

      try {
        await messageStore.record(context, {
          type: "welcome_sent",
          template: templateName,
          nicknameClass: selection.nicknameClass,
          source: selection.source,
          pick: selection.pick,
          setKey: selection.setKey,
          entrances: entrants.map((e) => ({ name: e.name, senderId: e.senderId, joinedAt: e.joinedAt })),
          hasMention,
          images: imageUrls,
        });
      } catch (e) {
        this.logger.warn("[welcome] record failed", { err: String(e) });
      }
    } catch (e) {
      this.logger.error("[welcome] send failed", { roomId, err: String(e) });
    }
  }

  private parseOpenProfileCloseGuideConfig(welcomeConfig: any): OpenProfileCloseGuideConfig | null {
    if (!welcomeConfig || typeof welcomeConfig !== "object") return null;
    const raw = (welcomeConfig as any).openProfileCloseGuide;
    if (!raw || typeof raw !== "object") return null;

    const enabled = (raw as any).enabled;
    if (typeof enabled !== "boolean") return null;

    const matchRaw = String((raw as any).match ?? (raw as any).mode ?? "").trim();
    let match: OpenProfileCloseGuideMatch | "" = "";
    if (matchRaw === "profileLinkIdNonZero" || matchRaw === "profile_link_id_nonzero" || matchRaw === "nonzero" || matchRaw === "nonZero") {
      match = "profileLinkIdNonZero";
    } else if (matchRaw === "profileLinkIdZero" || matchRaw === "profile_link_id_zero" || matchRaw === "zero") {
      match = "profileLinkIdZero";
    }

    const text = String((raw as any).text ?? (raw as any).message ?? "").trim();
    const images = Array.isArray((raw as any).images)
      ? (raw as any).images.map((x: any) => String(x ?? "").trim()).filter(Boolean)
      : [];

    if (enabled && !match) {
      this.logger.warn("[welcome-open-profile] invalid config: match", { match: matchRaw || null });
      return null;
    }
    if (enabled && !text) {
      this.logger.warn("[welcome-open-profile] invalid config: empty text");
      return null;
    }
    if (enabled && images.length === 0) {
      this.logger.warn("[welcome-open-profile] invalid config: empty images");
      return null;
    }

    return { enabled, match: match as OpenProfileCloseGuideMatch, text, images };
  }

  private async queryOpenChatMemberProfile(
    roomIdRaw: string,
    userIdRaw: string,
    timeoutMs: number,
  ): Promise<{ profileLinkId: string; profileType: string } | null> {
    const roomId = String(roomIdRaw || "").trim();
    const userId = String(userIdRaw || "").trim();
    if (!roomId || !userId) return null;

    const base = String(process.env.IRIS_QUERY_BASE || process.env.IRIS_URL || "http://127.0.0.1:5050").replace(/\/+$/, "");
    const url = `${base}/query`;
    const body = {
      query:
        "select profile_type, profile_link_id from db2.open_chat_member where involved_chat_id=? and user_id=? order by _id desc limit 1",
      bind: [roomId, userId],
    };

    for (let attempt = 1; attempt <= 2; attempt++) {
      const tms = Math.min(25_000, Math.max(5000, Math.floor(timeoutMs) + (attempt - 1) * 3000));
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), tms);
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        clearTimeout(t);

        const j: any = await res.json().catch(() => null);
        if (!res.ok) {
          this.logger.warn("[welcome-open-profile] query non-OK", { roomId, httpStatus: res.status, attempt });
          continue;
        }

        const row: any = j?.data?.[0] || null;
        if (!row || typeof row !== "object") return null;

        const profileLinkId = String(row?.profile_link_id ?? row?.profileLinkId ?? "").trim();
        const profileType = String(row?.profile_type ?? row?.profileType ?? "").trim();
        return { profileLinkId, profileType };
      } catch (e) {
        this.logger.warn("[welcome-open-profile] query failed", { roomId, err: String(e), attempt, timeoutMs: tms });
      }

      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return null;
  }

  private async maybeSendOpenProfileCloseGuide(
    context: ChatContext,
    roomName: string,
    entrants: WelcomeEntrant[],
    welcomeConfig?: any,
  ): Promise<void> {
    const cfg = this.parseOpenProfileCloseGuideConfig(welcomeConfig);
    if (!cfg || !cfg.enabled) return;

    const roomId = String((context.room as any)?.id ?? (context.room as any)?.roomId ?? "").trim();
    if (!roomId) return;

    const targets: WelcomeEntrant[] = [];
    for (const e of entrants) {
      const uid = String(e?.senderId || "").trim();
      if (!uid) continue;
      const dedupKey = `${roomId}:${uid}`;
      if (OPEN_PROFILE_GUIDE_DEDUP.has(dedupKey)) continue;

      const prof = await this.queryOpenChatMemberProfile(roomId, uid, 8000);
      if (!prof) continue;

      const profileLinkId = String(prof.profileLinkId || "").trim();
      if (!profileLinkId) continue; // unknown

      const nonZero = profileLinkId !== "0";
      const match = cfg.match === "profileLinkIdNonZero" ? nonZero : !nonZero;
      if (match) targets.push(e);
    }

    if (!targets.length) return;

    const { text: message, hasMention } = this.renderWelcomeText(cfg.text, targets, roomName);
    const mentionees = targets
      .map((e) => ({ name: String(e?.name || "").trim() || "Guest", userId: String(e?.senderId || "").trim() }))
      .filter((m) => m.userId && m.name && message.includes("@" + m.name));
    const mentioneesCapped = mentionees.length > 15 ? mentionees.slice(0, 15) : mentionees;

    try {
      if (hasMention && mentioneesCapped.length) {
        await safeReplyWithMentions(this.logger, context, message, mentioneesCapped, 8000);
      } else {
        await safeReply(this.logger, context, message, 8000);
      }
    } catch (e) {
      this.logger.warn("[welcome-open-profile] text send failed", { roomId, err: String(e) });
    }

    const imageUrls = resolveTemplateImageUrls(cfg.images || []);
    if (imageUrls.length) {
      try {
        await safeReplyImageUrls(this.logger, context, imageUrls, 10000);
      } catch (e) {
        this.logger.warn("[welcome-open-profile] image send failed", { roomId, err: String(e), count: imageUrls.length });
      }
    }

    for (const e of targets) {
      const uid = String(e?.senderId || "").trim();
      if (!uid) continue;
      OPEN_PROFILE_GUIDE_DEDUP.mark(`${roomId}:${uid}`);
    }
  }

  private async loadTemplate(name: string): Promise<WelcomeTemplate | null> {
    // Check cache first
    if (this.templateCache.has(name)) {
      return this.templateCache.get(name)!;
    }

    // Load from file
    const templatePath = path.join(APP_ROOT, "config", "templates", "welcome", `${name}.json`);

    try {
      const content = await fs.readFile(templatePath, "utf8");
      const parsed: any = JSON.parse(content);

      const text =
        typeof parsed?.messages?.text === "string"
          ? parsed.messages.text
          : typeof parsed?.content === "string"
            ? parsed.content
            : typeof parsed?.text === "string"
              ? parsed.text
              : "";
      if (!text || !String(text).trim()) {
        throw new Error("welcome template has empty text");
      }

      const images: string[] = [];
      if (typeof parsed?.messages?.image === "string" && parsed.messages.image.trim()) {
        images.push(parsed.messages.image.trim());
      }
      if (Array.isArray(parsed?.images)) {
        for (const img of parsed.images) {
          if (typeof img === "string" && img.trim()) images.push(img.trim());
        }
      }

      const sendDelayMs =
        typeof parsed?.settings?.sendDelay === "number" && Number.isFinite(parsed.settings.sendDelay)
          ? Math.max(0, Math.floor(parsed.settings.sendDelay))
          : typeof parsed?.settings?.sendDelayMs === "number" && Number.isFinite(parsed.settings.sendDelayMs)
            ? Math.max(0, Math.floor(parsed.settings.sendDelayMs))
            : 0;

      const logWelcome = Boolean(parsed?.settings?.logWelcome);

      const template: WelcomeTemplate = {
        text: String(text),
        images: Array.from(new Set(images)),
        sendDelayMs,
        logWelcome,
      };
      this.templateCache.set(name, template);
      return template;
    } catch (error) {
      this.logger.warn(`Failed to load template "${name}"`, error);
      return null;
    }
  }

  private logWelcome(
    context: ChatContext,
    userName: string | null,
    meta: {
      templateName: string;
      nicknameClass?: string;
      source?: string;
      pick?: string;
      setKey?: string;
    }
  ): void {
    this.logger.info(`Welcome message sent`, {
      roomId: String(context.room.id),
      userName: userName || "Unknown",
      template: meta.templateName,
      nicknameClass: meta.nicknameClass,
      source: meta.source,
      pick: meta.pick,
      setKey: meta.setKey,
      timestamp: new Date().toISOString(),
    });
  }
}

export default CustomNewMemberController;
