import Bot, {
  BotCommand,
  ChatContext,
  MessageController,
  Prefix,
  OnMessage,
  HasParam,
} from "@tsuki-chat/node-iris";
import { Logger } from "@tsuki-chat/node-iris";
import { safeReply, safeReplyWithMentions, safeReplyImageUrls, resolveTemplateImageUrls } from "../utils/sender";
import { isRoomAllowed, isSafeMode, isFeatureEnabledForRoomId } from "../utils/guard";
import { askKb } from "../utils/askKb";
import { updateStatus } from "../utils/status";
import { APP_ROOT, REPO_ROOT } from "../utils/paths";
import { resolveWelcomeTemplateSelection } from "../utils/welcomeTemplatePolicy";
import path from "path";
import { promises as fs } from "fs";
import { createHash } from "crypto";

// NOTE: Controller 인스턴스는 이벤트마다 새로 생성될 수 있으므로,
// 메시지 중복 방지는 모듈 레벨 Set으로 관리한다.
const recentMsgIds = new Set<string>();
// 방별로 현재 처리 중인 AI 응답 여부 (중복 동시 처리 방지)
const inflightByRoom = new Map<string, ReturnType<typeof setTimeout>>();
// 원본 payload hash 기반 중복 방지 (msgId가 다르게 들어오는 경우)
const recentRawKeys = new Set<string>();
// 질의 문자열 단위 전역 락 (방+질문 기준 1회만 응답)
const queryLocks = new Set<string>();

// NOTE: (문제 1 해결) AnnouncementController의 mirrorFrom 마커 제거용 정규식
// 루프 방지 마커 [MF:roomId]가 query에 포함되면 검색 품질이 저하됨
const MIRROR_MARKER_REGEX = /\u200B\[MF:[^\]]+\]\u200B/g;
// 접두어 미일치(rawDump) 디버그 파일 경로
const PREFIX_SKIP_LOG = path.join(REPO_ROOT, "windows", "logs", "prefix_skip.raw.txt");

// 운영 안전: ">>" 디버그 커맨드는 테스트 전용 오픈채팅방에서만 수행한다.
const TEST_COMMAND_ROOM_ID = "18462226881291012";

function decodeRawDump(rawDump: string): { decoded: string; msg?: string } {
  try {
    const decoded = Buffer.from(rawDump, "base64").toString("utf-8");
    const m = decoded.match(/msg: '([^']*)'/);
    return { decoded, msg: m?.[1] };
  } catch (e) {
    return { decoded: "", msg: undefined };
  }
}

@Prefix(">>")
@MessageController
class CustomMessageController {
  private bot: Bot;
  private logger: Logger;
  private lastRawByRoom: Record<string, string> = {};
  private lastHandledText: Record<string, { text: string; ts: number }> = {};
  private realtimeBase: string;

  constructor() {
    this.bot = Bot.requireInstance();
    this.logger = new Logger(CustomMessageController.name);
    this.realtimeBase = process.env.REALTIME_API_BASE || "http://127.0.0.1:8650";
  }

  private extractText(msg: any): { text: string; debug: string[]; rawDump: string } {
    // lazy-load iconv-lite to avoid hard dependency during tests if not installed
    let iconv: any = null;
    try { iconv = require("iconv-lite"); } catch {}

    const fields = [
      msg?.msg, // node-iris Message.msg (정상 한글 포함)
      msg?.text,
      msg?.msgContent,
      msg?.body,
      msg?.message,
      msg?.content,
    ];
    const candidates: Array<{ src: string; val: string }> = [];
    fields.forEach((v, i) => {
      if (typeof v !== "string" || !v) return;
      const raw = String(v);
      const hasNullBytes = raw.includes("\u0000");
      const tries = [
        raw,
        (() => { try { return Buffer.from(raw, "binary").toString("utf8"); } catch { return raw; } })(),
        (() => { try { return Buffer.from(raw, "latin1").toString("utf8"); } catch { return raw; } })(),
        (() => {
          if (!iconv) return raw;
          try {
            const buf = Buffer.from(raw, "binary");
            const decoded = iconv.decode(buf, "euc-kr");
            return decoded || raw;
          } catch { return raw; }
        })(),
        (() => {
          if (!iconv || !hasNullBytes) return raw;
          try {
            const buf = Buffer.from(raw, "binary");
            const decoded = iconv.decode(buf, "utf16-le");
            return decoded || raw;
          } catch { return raw; }
        })(),
      ];
      tries.forEach((t) => {
        if (t && t.trim()) candidates.push({ src: `field${i}`, val: t });
      });
    });
    // gen_ai style plain text
    if (msg?.plainText && typeof msg.plainText === "string") {
      candidates.push({ src: "plainText", val: msg.plainText });
    }
    if (msg?.convertedText && typeof msg.convertedText === "string") {
      candidates.push({ src: "convertedText", val: msg.convertedText });
    }
    // command + param 조합을 그대로 붙여본다.
    if (msg?.command) {
      const combo = `${String(msg.command)} ${msg?.param ? String(msg.param) : ""}`.trim();
      if (combo) candidates.push({ src: "command+param", val: combo });
    }
    let chosen = "";
    // 우선 ?디하클 포함
    const hit = candidates.find((c) => c.val.includes("?디하클"));
    if (hit) chosen = hit.val;
    // 그 다음 ?로 시작
    if (!chosen) {
      const hit2 = candidates.find((c) => c.val.trim().startsWith("?"));
      if (hit2) chosen = hit2.val;
    }
    // 마지막: 가장 긴 값
    if (!chosen && candidates.length) {
      chosen = candidates.sort((a, b) => b.val.length - a.val.length)[0].val;
    }
    // raw dump (base64) for debugging, truncated to 4KB (safe stringify)
    const safeDump = (obj: any): string => {
      try {
        const json = JSON.stringify(obj, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
        return Buffer.from(json, "utf8").toString("base64").slice(0, 4096);
      } catch {
        try {
          const util = require("util");
          const txt = util.inspect(obj, { depth: 2, maxArrayLength: 20, maxStringLength: 200 });
          return Buffer.from(txt, "utf8").toString("base64").slice(0, 4096);
        } catch {
          return "";
        }
      }
    };
    const rawDump = safeDump(msg);
    return { text: chosen || "", debug: candidates.map((c) => c.val.slice(0, 120)), rawDump };
  }

  private decodeMaybeUtf8(text: string): string {
    let iconv: any = null;
    try { iconv = require("iconv-lite"); } catch {}
    try {
      if (!text) return text;
      // If the string already has Korean characters, keep it.
      if (/[가-힣]/.test(text)) return text;
      // Attempt to reinterpret as latin1 -> utf8 (common mojibake case)
      const recoded = Buffer.from(text, "binary").toString("utf8");
      // If recoded contains Korean, prefer it
      if (/[가-힣]/.test(recoded)) return recoded;
      // Try EUC-KR/CP949 fallback when available
      if (iconv) {
        const buf = Buffer.from(text, "binary");
        const kr = iconv.decode(buf, "euc-kr");
        if (/[가-힣]/.test(kr)) return kr;
        // UTF-16LE heuristic: contains many NULL bytes or even-length buffer
        if (buf.length >= 4 && (text.includes("\u0000") || buf.length % 2 === 0)) {
          const utf16 = iconv.decode(buf, "utf16-le");
          if (/[가-힣]/.test(utf16)) return utf16;
        }
      }
      return text;
    } catch {
      return text;
    }
  }

  private async shouldHandle(context: ChatContext): Promise<boolean> {
    if (await isSafeMode()) {
      this.logger.warn("SAFE_MODE on: ignore command", { roomId: String(context.room.id) });
      return false;
    }
    const rid = String(context.room.id);
    if (rid && rid !== TEST_COMMAND_ROOM_ID) {
      this.logger.warn("Command ignored: test room only (>>)", { roomId: rid });
      return false;
    }
    const allowed = await isRoomAllowed(context);
    if (!allowed) {
      this.logger.warn("Command ignored: room not allowed", { roomId: String(context.room.id) });
      return false;
    }
    return true;
  }

  // Record is handled globally; keep no-op to attach decorators
  @OnMessage
  async onAny(_context: ChatContext): Promise<void> {
    return;
  }

  @BotCommand("ping", "핑/응답 테스트")
  async pingCommand(context: ChatContext): Promise<void> {
    if (!(await this.shouldHandle(context))) return;
    await context.reply("Pong!");
  }

  @BotCommand("echo", "메시지 에코 <텍스트>")
  @HasParam
  async echoCommand(context: ChatContext): Promise<void> {
    if (!(await this.shouldHandle(context))) return;
    const text = (context as any)?.message?.param ?? "";
    await context.reply(`Echo: ${text}`);
  }

  @BotCommand("room")
  async roomCommand(context: ChatContext): Promise<void> {
    if (!(await this.shouldHandle(context))) return;
    await context.reply(`roomId: ${context.room.id}`);
  }

  // KB 질의 (?디하클 ...) : 허용방 + ai 토글 켜진 경우에만 동작
  @OnMessage
  async aiQuery(context: ChatContext): Promise<void> {
    // ADR-0028: 기본은 ai-worker가 처리한다. (레거시 롤백: AI_DISPATCHER=bot)
    const dispatcher = String(process.env.AI_DISPATCHER || "worker").toLowerCase().trim();
    if (dispatcher !== "bot") return;

    const msg: any = (context as any)?.message || {};
    const rid = String(context.room.id);
    const msgId = msg?.id || msg?.messageId || "";

    // SAFE_MODE 전역 차단: 설정이 켜져 있으면 AI 응답 자체를 수행하지 않는다.
    if (await isSafeMode()) {
      this.logger.warn("[ai] skip: SAFE_MODE on", { roomId: rid, msgId });
      return;
    }

    // ★★★ CRITICAL: 가장 먼저 동기적으로 락 체크 (race condition 방지) ★★★
    // 모든 await나 비동기 연산 전에 락을 획득해야 함
    if (msgId) {
      const key = `${rid}:${msgId}`;
      if (recentMsgIds.has(key)) {
        // 이미 처리 중이거나 처리됨 - 즉시 종료
        return;
      }
      // 즉시 락 획득 (다른 이벤트 핸들러가 끼어들기 전에)
      recentMsgIds.add(key);
      setTimeout(() => recentMsgIds.delete(key), 15000);
    }

    // 방 단위 동시 처리 차단: 기존 처리 중이면 스킵 (LLM 1회만 응답)
    if (inflightByRoom.has(rid)) {
      this.logger.warn("[ai] skip: room already processing", { roomId: rid, msgId });
      return;
    }

    const { text, debug, rawDump } = this.extractText(msg);
    if (rawDump) this.lastRawByRoom[rid] = rawDump;
    const decoded = this.decodeMaybeUtf8(text);
    this.logger.info("[ai] received", { roomId: rid, text: decoded, raw: debug, msgId });

    // 상태 파일에 이벤트 기록 (하트비트 외 실제 이벤트 시각)
    updateStatus({
      lastEventTs: new Date().toISOString(),
      lastEventRoomId: rid,
      lastEventText: decoded || "",
    }).catch(() => {});

    // 원본 payload hash 기반 중복 방지 (msgId가 다르거나 없는 경우 대비)
    const rawFields = [msg?.msgContent, msg?.msg, msg?.text, msg?.body, msg?.message, msg?.content].filter(
      (v) => typeof v === "string" && v
    );
    if (rawFields.length) {
      const rawKey = `${rid}:${createHash("sha1").update(String(rawFields[0]), "binary").digest("hex")}`;
      if (recentRawKeys.has(rawKey)) {
        this.logger.warn("[ai] skip duplicate raw payload", { roomId: rid, rawKey, msgId });
        return;
      }
      recentRawKeys.add(rawKey);
      setTimeout(() => recentRawKeys.delete(rawKey), 15000);
    }

    let parsed = decoded;
    // If parsed is empty, try fallback from last raw dump
    if (!parsed && this.lastRawByRoom[rid]) {
      try {
        const buf = Buffer.from(this.lastRawByRoom[rid], "base64").toString("utf8");
        const maybe = buf.match(/\?\s*디하클[^\n"]{0,200}/);
        if (maybe) parsed = maybe[0];
      } catch {}
    }

    // Fallback: pull latest log from realtime API (/logs/bulk)
    if (!parsed) {
      try {
        const resp = await fetch(`${this.realtimeBase}/logs/bulk?rooms=${encodeURIComponent(rid)}&limit=1&all=0`);
        const j: any = await resp.json();
        const arr = j?.rooms?.[rid] || [];
        const t = Array.isArray(arr) && arr[0]?.text ? String(arr[0].text) : "";
        if (t) {
          parsed = t;
          this.logger.info("[ai] fallback realtime text", { roomId: rid, text: parsed });
        }
      } catch (e) {
        this.logger.warn("[ai] fallback fetch failed", { roomId: rid, err: String(e) });
      }
    }

    // --- 명령 인식 및 접두 강제 ---
    parsed = (parsed || "").trim();
    const normalized = parsed.normalize("NFC");

    // 접두어는 반드시 문자열 맨 앞에서 "? + (공백) + 디하클" 형태만 허용한다.
    // - "?디하클", "? 디하클" 등 공백 변형은 허용
    // - 그 외 fallback/추측은 금지
    const prefixMatch = normalized.match(/^\?\s*디하클\s*(.*)$/);
    if (!prefixMatch) {
      // rawDump는 base64로 전체 메시지 오브젝트가 들어 있음 (인코딩 문제 분석용)
      const { msg: decodedMsg } = decodeRawDump(rawDump);
      this.logger.warn("[ai] skip: prefix not matched (require '?디하클')", {
        roomId: rid,
        text: normalized,
        rawDump,
        msgDecoded: decodedMsg,
      });
      void this.appendPrefixSkipDump(rawDump, { roomId: rid, msgId: msg.msgId, text: normalized });
      return;
    }

    // NOTE: (문제 1 해결) AnnouncementController의 mirrorFrom 마커 제거
    // 공지 복제 시 붙는 [MF:roomId] 마커가 query에 포함되면 검색 결과가 왜곡됨
    let query = (prefixMatch[1] || "").replace(/\s+/g, " ").trim();
    query = query.replace(MIRROR_MARKER_REGEX, "").trim();

    if (!query) {
      this.logger.warn("[ai] skip: empty query after prefix", { roomId: rid, text: normalized });
      return;
    }

    const queryNorm = query.toLowerCase();
    this.logger.info("[ai] query parsed", { roomId: rid, query, msgId });
    if (!query) return;

    // 질의 전역 락: 같은 방+질문 15초 내 중복 차단
    const qLock = `${rid}:${queryNorm}`;
    if (queryLocks.has(qLock)) {
      this.logger.warn("[ai] skip duplicate query lock", { roomId: rid, query, msgId });
      return;
    }
    queryLocks.add(qLock);
    setTimeout(() => queryLocks.delete(qLock), 15000);

    // Dedup by text within short window (handles IRIS double-delivery without msgId)
    const now = Date.now();
    const last = this.lastHandledText[rid];
    if (last && last.text === queryNorm && now - last.ts < 12000) {
      this.logger.warn("[ai] skip duplicate text window", { roomId: rid, query, msgId });
      return;
    }
    this.lastHandledText[rid] = { text: queryNorm, ts: now };

    const aiEnabled = await isFeatureEnabledForRoomId(rid, "ai");
    if (!aiEnabled) {
      this.logger.warn("AI disabled for room", { roomId: rid });
      return;
    }

    // 방별 처리 플래그 세팅 (LLM 응답 완료/실패 시 해제)
    const clearInflight = () => {
      const timer = inflightByRoom.get(rid);
      if (timer) clearTimeout(timer);
      inflightByRoom.delete(rid);
    };
    // 안전망: 20초 후 자동 해제 (LLM 응답 지연/에러 대비)
    const timeout = setTimeout(() => inflightByRoom.delete(rid), 20000);
    inflightByRoom.set(rid, timeout);

    try {
      await askKb(this.logger, context, query);
      this.logger.info("[ai] answered", { roomId: rid });
    } catch (e) {
      this.logger.error("AI query failed", e as any);
      try {
        await context.reply("죄송합니다. KB 응답 중 오류가 발생했습니다.");
      } catch {}
    } finally {
      clearInflight();
    }
  }

  @BotCommand("user")
  async userCommand(context: ChatContext): Promise<void> {
    if (!(await this.shouldHandle(context))) return;
    const nameRaw = await context.sender.getName();
    const name = nameRaw ? String(nameRaw) : "User";
    // userId(숫자) 노출 금지: 닉네임만 보여준다.
    await context.reply(`user: ${name}`);
  }

  @BotCommand("welcome:test", "멘션 송신 경로 점검")
  async welcomeTest(context: ChatContext): Promise<void> {
    if (!(await this.shouldHandle(context))) return;
    const userName = (await context.sender.getName()) || "Guest";
    const roomName = context.room.name || "this room";
    const senderId = String((context.sender as any)?.id || (context.sender as any)?.userId || "");

    const loadTemplate = async (name: string): Promise<{ text: string; images: string[] }> => {
      if (!name) throw new Error("welcome template name is not configured");
      const p = path.join(APP_ROOT, "config", "templates", "welcome", `${name}.json`);
      const raw = await fs.readFile(p, "utf8");
      const parsed = JSON.parse(raw);
      const text =
        typeof parsed?.messages?.text === "string"
          ? parsed.messages.text
          : typeof parsed?.content === "string"
            ? parsed.content
            : typeof parsed?.text === "string"
              ? parsed.text
              : "";
      if (!text || !String(text).trim()) {
        throw new Error(`welcome template has empty text: ${p}`);
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
      return { text: String(text), images: Array.from(new Set(images)) };
    };

    const renderText = (text: string): { text: string; hasMention: boolean } => {
      let hasMention = false;
      const vars: Record<string, string> = {
        userName,
        roomName,
        time: new Date().toLocaleTimeString("ko-KR"),
        date: new Date().toLocaleDateString("ko-KR"),
        entrant: userName,
        entrance: userName,
      };
      let out = String(text || "");
      out = out.replace(/@\{([^}]+)\}/g, (_, k) => {
        const key = String(k || "").trim();
        const aliases = key === "entrant" || key === "entrance" ? [key, "userName"] : [key];
        for (const a of aliases) {
          if (vars[a]) {
            hasMention = true;
            return "@" + vars[a];
          }
        }
        return "@{" + key + "}";
      });
      out = out.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, k) => {
        const key = String(k || "").trim();
        return vars[key] != null ? String(vars[key]) : "{{" + key + "}}";
      });
      out = out.replace(/\{([^}]+)\}/g, (_, k) => {
        const key = String(k || "").trim();
        return vars[key] != null ? String(vars[key]) : "{" + key + "}";
      });
      return { text: out, hasMention };
    };

    let sentText = false;
    let tplName = "";
    let hasMention = false;
    let images: string[] = [];
    let meta: any = {};
    try {
      const selection = await resolveWelcomeTemplateSelection({ userName, senderId });
      tplName = selection?.templateName || "";
      const tpl = await loadTemplate(tplName);
      const rendered = renderText(tpl.text);
      hasMention = rendered.hasMention;
      const resolvedImages = resolveTemplateImageUrls(tpl.images || []);
      images = Array.isArray(resolvedImages) ? resolvedImages : [];
      meta = {
        tplName,
        nicknameClass: selection?.nicknameClass,
        source: selection?.source,
        setKey: selection?.setKey,
        pick: selection?.pick,
      };

      if (hasMention && senderId) {
        await safeReplyWithMentions(this.logger, context, rendered.text, [{ name: userName, userId: senderId }], 8000);
      } else {
        await safeReply(this.logger, context, rendered.text, 8000);
      }
      sentText = true;
      this.logger.info("[welcome:test] sent(text)", { ...meta, hasMention });
    } catch (e) {
      this.logger.error("[welcome:test] failed(text)", { err: String(e), tplName, sentText });
      if (!sentText) {
        await safeReply(this.logger, context, "웰컴 템플릿 테스트 중 오류가 발생했습니다.", 5000);
      }
      return;
    }

    if (images.length) {
      try {
        await safeReplyImageUrls(this.logger, context, images, 10000);
        this.logger.info("[welcome:test] sent(images)", { ...meta, images: images.length });
      } catch (e) {
        this.logger.warn("[welcome:test] image send failed", { err: String(e), ...meta, images: images.length });
      }
    }
  }

  // prefix 미일치 rawDump를 별도 파일로 남겨 운영자가 UTF-8로 바로 확인할 수 있게 한다.
  private async appendPrefixSkipDump(rawDump: string, meta: { roomId: string; msgId?: string; text: string }) {
    if (!rawDump) return;
    try {
      const decoded = Buffer.from(rawDump, "base64").toString("utf-8");
      const entry = [
        `time=${new Date().toISOString()}`,
        `roomId=${meta.roomId}`,
        meta.msgId ? `msgId=${meta.msgId}` : undefined,
        `textField=${meta.text}`,
        "rawDecoded:",
        decoded,
        "",
      ]
        .filter(Boolean)
        .join("\n");

      await fs.appendFile(PREFIX_SKIP_LOG, `${entry}\n`, { encoding: "utf-8" });
    } catch (err) {
      this.logger.debug("[ai] prefix skip dump write failed", { err: String(err) });
    }
  }
}

export default CustomMessageController;
