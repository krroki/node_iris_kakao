export const runtime = "nodejs";

import { NextResponse } from "next/server";
import path from "path";
import { repoRoot, readJsonIfExists } from "../_util";

export const dynamic = "force-dynamic";

type AutoFaqTrigger = import("../../../../types").AutoFaqTrigger;
type AutoFaqConfig = import("../../../../types").AutoFaqConfig;

type RuntimeConfig = {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, Record<string, unknown> | undefined>;
  talkApi?: { enabled?: boolean } | undefined;
};

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function safeSlice(v: unknown, maxLen = 260): string {
  const s = safeString(v);
  if (!s) return "";
  if (s.length <= maxLen) return s;
  return s.slice(0, Math.max(0, maxLen - 1)) + "…";
}

function normalizeKey(raw: string, mode: "regex" | "exact" = "regex"): string {
  const s0 = safeString(raw);
  if (!s0) return "";
  let s = s0.replace(/\s+/g, " ").trim().toLowerCase();
  if (!s) return "";
  if (mode === "exact") {
    s = s.replace(/^[?!.？！。．…]+/g, "");
    s = s.replace(/[?!.？！。．…]+$/g, "");
    s = s.replace(/^["'“”‘’]+/g, "");
    s = s.replace(/["'“”‘’]+$/g, "");
    s = s.trim();
  }
  return s;
}

function isQuestionSignal(text: string): boolean {
  const t = safeString(text);
  if (!t) return false;
  if (t.includes("?")) return true;
  const cues = [
    "어디",
    "언제",
    "어떻게",
    "방법",
    "되나",
    "되나요",
    "있나요",
    "없나요",
    "맞나요",
    "인가요",
    "문의",
    "알려",
    "링크",
    "결제",
    "가격",
    "얼마",
    "신청",
    "다시보기",
    "보너스",
    "혹시",
  ];
  return cues.some((c) => t.includes(c));
}

function matchTrigger(text: string, trig: AutoFaqTrigger): boolean {
  if (trig.enabled === false) return false;
  const m = trig.match || {};
  const patterns = Array.isArray(m.patterns) ? m.patterns.map(safeString).filter(Boolean) : [];
  if (patterns.length === 0) return false;

  const base0 = m.type === "regex" ? normalizeKey(text, "regex") : normalizeKey(text, "exact");
  const base = m.type === "regex" ? base0.slice(0, 240) : base0;

  const neg = Array.isArray(m.negativePatterns) ? m.negativePatterns.map(safeString).filter(Boolean) : [];
  for (const p of neg) {
    try {
      if (m.type === "regex") {
        if (new RegExp(p, "i").test(base)) return false;
      } else {
        const pn = normalizeKey(p, "exact");
        if (pn && base.includes(pn)) return false;
      }
    } catch {
      // invalid regex should be blocked at save time; ignore here
    }
  }

  if (m.requireQuestionSignal !== false && !isQuestionSignal(text)) return false;

  for (const p of patterns) {
    if (m.type === "regex") {
      try {
        if (new RegExp(p, "i").test(base)) return true;
      } catch {
        continue;
      }
    } else {
      const pn = normalizeKey(p, "exact");
      if (!pn) continue;
      if (base === pn) return true;
    }
  }
  return false;
}

type KbRecentPost = {
  title?: string;
  url?: string;
  norm_text?: string | null;
};

async function fetchKbRecentPosts(action: any): Promise<{ posts: KbRecentPost[]; ok: boolean }> {
  const base = safeString(process.env.KB_BASE || "http://127.0.0.1:8610").replace(/\/+$/, "");
  const url = `${base}/posts/recent`;
  const menuIds = safeString(action?.menuIds || "").replace(/\s+/g, "");
  const limit = Math.max(1, Math.min(10, Number(action?.limit || 3) || 3));
  const keywords = Array.isArray(action?.keywords) ? action.keywords.map(safeString).filter(Boolean) : [];
  const includeNormText = Boolean(action?.includeNormText);

  const params = new URLSearchParams();
  if (menuIds) params.set("menu_ids", menuIds);
  params.set("limit", String(limit));
  if (keywords.length > 0) params.set("keywords", keywords.join(","));
  if (includeNormText) params.set("include_norm_text", "1");

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6500);
    const res = await fetch(`${url}?${params.toString()}`, { method: "GET", signal: ctrl.signal }).catch(() => null);
    clearTimeout(t);
    if (!res || !res.ok) return { posts: [], ok: false };
    const j: any = await res.json().catch(() => null);
    if (!j?.ok || !Array.isArray(j?.posts)) return { posts: [], ok: false };
    return { posts: j.posts as KbRecentPost[], ok: true };
  } catch {
    return { posts: [], ok: false };
  }
}

function extractBonusSnippets(normText: string): string[] {
  const t = safeString(normText);
  if (!t) return [];
  const needles = ["보너스", "폼", "naver.me", "네이버", "마감", "까지", "전달", "채널톡", "캡쳐", "캡처", "스크린샷", "스샷", "기간 제한", "수령"];
  const rawLines = t.split(/\r?\n/);
  const out: string[] = [];
  for (const ln of rawLines) {
    const s = String(ln || "").trim();
    if (!s) continue;
    if (!needles.some((k) => s.includes(k))) continue;
    if (s.length > 220) out.push(s.slice(0, 220) + "…");
    else out.push(s);
    if (out.length >= 2) break;
  }
  return out;
}

function buildReplyTextFromTemplate(trig: AutoFaqTrigger, posts: Array<{ title: string; url: string }>, snippetLines: string[]): string {
  const tpl = trig.replyTemplate || {};
  const titleLine = safeString(tpl.titleLine);
  const bodyLines = Array.isArray(tpl.bodyLines) ? tpl.bodyLines.map(safeString).filter(Boolean) : [];

  const out: string[] = [];
  if (titleLine) out.push(titleLine);

  const actionType = safeString(trig.action?.type || "static_text");
  const responseText = safeString(trig.action?.responseText);

  if (actionType === "static_text") {
    const body = responseText.trim();
    if (body) {
      if (out.length) out.push("");
      out.push(body);
    }
  } else {
    const renderedBody: string[] = [];
    if (bodyLines.length > 0) {
      for (const line of bodyLines) {
        let s = line;
        for (let i = 0; i < Math.min(10, posts.length); i++) {
          s = s.replace(new RegExp(`\\{t${i + 1}\\}`, "g"), posts[i].title);
          s = s.replace(new RegExp(`\\{url${i + 1}\\}`, "g"), posts[i].url);
        }
        for (let i = 0; i < Math.min(10, snippetLines.length); i++) {
          s = s.replace(new RegExp(`\\{s${i + 1}\\}`, "g"), snippetLines[i]);
        }
        s = s.replace(/\{t\d+\}/g, "").replace(/\{url\d+\}/g, "").replace(/\{s\d+\}/g, "").trim();
        if (s) renderedBody.push(s);
      }
    } else if (posts.length > 0) {
      renderedBody.push(...posts.map((p, idx) => `${idx + 1}) ${p.title}`));
    }
    if (renderedBody.length) {
      if (out.length) out.push("");
      out.push(...renderedBody);
    }
  }

  const footerMode = safeString((trig.replyTemplate as any)?.footerLinksMode || "kb_posts");
  if (footerMode !== "none" && posts.length > 0) {
    out.push("");
    out.push("---");
    out.push("🔗 관련 링크");
    for (const p of posts) out.push(p.url);
  }

  const cleaned = out
    .join("\n")
    .split(/\r?\n/)
    .filter((ln) => !/^\s*\[?\d{4}-\d{2}-\d{2}T/.test(ln))
    .filter((ln) => !/^\s*\[\d{4}-\d{2}-\d{2}/.test(ln))
    .filter((ln) => !/^\s*evidence\b/i.test(ln))
    .filter((ln) => !/^\s*next action\b/i.test(ln))
    .filter((ln) => !/^\s*참고\s*로그/i.test(ln))
    .join("\n")
    .trim();

  return cleaned;
}

function normalizePriority(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 100;
  return Math.max(-10000, Math.min(10000, Math.floor(n)));
}

function isSafeAutoFaqImageRelPath(rel: string): boolean {
  const s = safeString(rel);
  if (!s) return false;
  if (/^[a-zA-Z]:[\\/]/.test(s)) return false;
  if (s.startsWith("\\\\") || s.startsWith("//")) return false;
  if (/^[a-zA-Z]+:\/\//.test(s)) return false;
  if (s.includes("..")) return false;
  return s.startsWith("assets/auto_faq/");
}

export async function POST(req: Request) {
  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const scope = safeString(body?.scope || "room");
  const roomId = safeString(body?.roomId);
  const lectureIdInput = safeString(body?.lectureId);
  const text = safeString(body?.text);
  if (!text) return NextResponse.json({ ok: false, error: "text is required" }, { status: 400 });

  const root = repoRoot();
  const cfgPath = path.join(root, "node-iris-app", "data", "auto_faq_config.json");
  const runtimePath = path.join(root, "node-iris-app", "config", "runtime.json");

  const cfgRes = await readJsonIfExists(cfgPath);
  const cfg = (cfgRes.json && typeof cfgRes.json === "object" ? (cfgRes.json as AutoFaqConfig) : {}) as AutoFaqConfig;

  const rtRes = await readJsonIfExists(runtimePath);
  const runtime = (rtRes.json && typeof rtRes.json === "object" ? (rtRes.json as RuntimeConfig) : {}) as RuntimeConfig;

  const questionSignal = isQuestionSignal(text.trim());

  const roomsCfg = cfg.rooms && typeof cfg.rooms === "object" ? cfg.rooms : {};
  const roomCfg = roomId && roomsCfg[roomId] && typeof roomsCfg[roomId] === "object" ? (roomsCfg[roomId] as any) : null;
  const lectureId = scope === "lecture" ? lectureIdInput : roomCfg ? safeString(roomCfg.lectureId) : lectureIdInput;
  const lecturesCfg = cfg.lectures && typeof cfg.lectures === "object" ? cfg.lectures : {};
  const lecCfg = lectureId && lecturesCfg[lectureId] && typeof lecturesCfg[lectureId] === "object" ? (lecturesCfg[lectureId] as any) : null;

  const globalEnabled = cfg.global?.enabled !== false;
  const globalTriggers = globalEnabled && Array.isArray(cfg.global?.triggers) ? (cfg.global?.triggers as AutoFaqTrigger[]) : [];

  const roomEnabled = roomCfg ? roomCfg.enabled !== false : true;
  const roomTriggers = roomEnabled && roomCfg && Array.isArray(roomCfg.triggers) ? (roomCfg.triggers as AutoFaqTrigger[]) : [];

  const lectureEnabled = lecCfg ? lecCfg.enabled !== false : true;
  const lectureTriggers = lectureEnabled && lecCfg && Array.isArray(lecCfg.triggers) ? (lecCfg.triggers as AutoFaqTrigger[]) : [];

  const scopeRank = (s: string): number => (s === "room" ? 0 : s === "lecture" ? 1 : 2);

  const candidates: Array<{ scope: string; trig: AutoFaqTrigger }> = [];
  if (scope === "global") {
    for (const t of globalTriggers) candidates.push({ scope: "global", trig: t });
  } else if (scope === "lecture") {
    for (const t of lectureTriggers) candidates.push({ scope: "lecture", trig: t });
    for (const t of globalTriggers) candidates.push({ scope: "global", trig: t });
  } else {
    // room(default): room > lecture > global
    for (const t of roomTriggers) candidates.push({ scope: "room", trig: t });
    for (const t of lectureTriggers) candidates.push({ scope: "lecture", trig: t });
    for (const t of globalTriggers) candidates.push({ scope: "global", trig: t });
  }

  const matched = candidates.filter((c) => matchTrigger(text, c.trig));
  const sorted = [...matched].sort((a, b) => {
    const sa = scopeRank(a.scope);
    const sb = scopeRank(b.scope);
    if (sa !== sb) return sa - sb;
    const pa = normalizePriority(a.trig.priority);
    const pb = normalizePriority(b.trig.priority);
    if (pa !== pb) return pa - pb;
    return safeString(a.trig.id).localeCompare(safeString(b.trig.id));
  });

  let decision: string = "NO_MATCH";
  let selected: { scope: string; trig: AutoFaqTrigger } | null = null;

  if (sorted.length === 0) {
    decision = questionSignal ? "NO_MATCH" : "NO_MATCH_NO_QUESTION_SIGNAL";
  } else if (sorted.length === 1) {
    decision = "MATCH";
    selected = sorted[0];
  } else {
    const top = sorted[0];
    const second = sorted[1];
    const clearWinner =
      scopeRank(top.scope) < scopeRank(second.scope) ||
      (scopeRank(top.scope) === scopeRank(second.scope) && normalizePriority(top.trig.priority) < normalizePriority(second.trig.priority));
    if (clearWinner) {
      decision = "MATCH";
      selected = top;
    } else {
      decision = "AMBIGUOUS";
    }
  }

  // gating (room scope only meaningful)
  const gates: any = {
    safeMode: Boolean(runtime.safeMode),
    talkApiEnabled: Boolean(runtime.talkApi?.enabled),
    allowedRoom: true,
    excludedRoom: false,
    featureAutoFaq: true,
  };
  if (scope !== "global" && scope !== "lecture") {
    if (Array.isArray(runtime.excludedRoomIds) && runtime.excludedRoomIds.includes(roomId)) {
      gates.excludedRoom = true;
    }
    if (Array.isArray(runtime.allowedRoomIds) && runtime.allowedRoomIds.length > 0 && !runtime.allowedRoomIds.includes(roomId)) {
      gates.allowedRoom = false;
    }
    const feats = runtime.features && typeof runtime.features === "object" ? runtime.features : {};
    const rf = feats[roomId] && typeof feats[roomId] === "object" ? (feats as any)[roomId] : {};
    gates.featureAutoFaq = (rf as any)?.autoFaq === true;
  }
  const wouldSend =
    decision === "MATCH" &&
    selected != null &&
    !gates.safeMode &&
    gates.talkApiEnabled &&
    gates.allowedRoom &&
    !gates.excludedRoom &&
    gates.featureAutoFaq;

  // render
  let replyText = "";
  let images: string[] = [];
  let posts: Array<{ title: string; url: string }> = [];
  let snippetLines: string[] = [];
  let actionOk: boolean | null = null;

  if (selected) {
    const trig = selected.trig;
    const actionType = safeString(trig.action?.type || "static_text");
    if (actionType === "static_text") {
      actionOk = true;
    } else {
      const res = await fetchKbRecentPosts(trig.action);
      actionOk = res.ok;
      const rows = (res.posts || []).map((p) => ({
        title: safeString(p.title),
        url: safeString(p.url),
        norm_text: safeString(p.norm_text),
      }));
      posts = rows
        .filter((p) => p.title && p.url)
        .slice(0, Math.max(1, Math.min(10, Number(trig.action?.limit || 3) || 3)))
        .map((p) => ({ title: p.title, url: p.url }));
      if (actionType === "kb_recent_posts_filtered" && Boolean(trig.action?.includeNormText)) {
        const first = rows.find((x) => x.norm_text) || null;
        if (first && first.norm_text) snippetLines = extractBonusSnippets(first.norm_text);
      }
    }
    replyText = buildReplyTextFromTemplate(trig, posts, snippetLines);
    images = (Array.isArray(trig.images) ? trig.images : []).map(safeString).filter(Boolean).filter(isSafeAutoFaqImageRelPath);
  }

  return NextResponse.json(
    {
      ok: true,
      scope,
      roomId: roomId || null,
      lectureId: lectureId || null,
      questionSignal,
      decision,
      wouldSend,
      gates,
      selected: selected
        ? {
            scope: selected.scope,
            id: safeString(selected.trig.id),
            label: safeString(selected.trig.label),
            priority: normalizePriority(selected.trig.priority),
            matchType: safeString(selected.trig.match?.type || "exact_norm"),
            actionType: safeString(selected.trig.action?.type || "static_text"),
          }
        : null,
      matched: sorted.slice(0, 20).map((m) => ({
        scope: m.scope,
        id: safeString(m.trig.id),
        label: safeString(m.trig.label),
        priority: normalizePriority(m.trig.priority),
        matchType: safeString(m.trig.match?.type || "exact_norm"),
      })),
      replyText: safeSlice(replyText, 1200),
      images,
      actionOk,
      posts: posts.slice(0, 10),
    },
    { status: 200 },
  );
}
