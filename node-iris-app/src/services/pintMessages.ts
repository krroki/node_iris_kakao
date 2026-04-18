import type { PintHomeHotVideo, PintHomeRookieChannel, PintTrendHunterTopic, PintTrendingTopic } from "./pintClient";

type PintTopChannelRow = {
  id?: unknown;
  youtube_channel_id?: unknown;
  title?: unknown;
  subscriber_count?: unknown;
  daily_views?: unknown;
  content_format?: unknown;
  primary_category_id?: unknown;
};

type NormalizedTopChannel = {
  id: string;
  youtubeChannelId: string;
  title: string;
  subscriberCount: number | null;
  dailyViews: number | null;
  contentFormat: string | null;
  primaryCategoryId: number | null;
};

type IssueMetrics = {
  label: string;
  views: number | null;
  comments: number | null;
};

const WHALE_SUBSCRIBER_THRESHOLD = 1_000_000;
const TOP_CHANNEL_DISCOVERY_MAX_SUBSCRIBERS = 300_000;
const SUSPICIOUS_DAILY_VIEWS_MIN = 20_000_000;
const SUSPICIOUS_VIEW_SUBSCRIBER_RATIO = 300;
const ISSUE_MINIMUMS = {
  "24h": {
    minViewsOnly: 3_000,
    minCommentsOnly: 10,
    minViewsWithComments: 1_500,
    minCommentsWithViews: 5,
  },
  "1h": {
    minViewsOnly: 300,
    minCommentsOnly: 5,
    minViewsWithComments: 150,
    minCommentsWithViews: 3,
  },
} as const;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function fmtInt(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : null;
  if (v == null) return "-";
  try {
    return new Intl.NumberFormat("ko-KR").format(Math.round(v));
  } catch {
    return String(Math.round(v));
  }
}

function fmtCompact(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : null;
  if (v == null) return "-";
  try {
    return new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(v);
  } catch {
    return fmtInt(v);
  }
}

function fmtRatio(n: number | null | undefined): string {
  const v = typeof n === "number" && Number.isFinite(n) ? n : null;
  if (v == null || v <= 0) return "-";
  const rounded = v >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${fmtInt(rounded)}배`;
}

function withFooterLinks(body: string, links: string[]): string {
  const cleaned = links.map((u) => safeString(u)).filter(Boolean);
  if (cleaned.length === 0) return body.trim();
  return `${body.trim()}\n\n---\n🔗 관련 링크\n${cleaned.join("\n")}`.trim();
}

function pickTop<T>(items: T[], limit: number): T[] {
  if (!Array.isArray(items)) return [];
  if (!(limit > 0)) return [];
  return items.slice(0, limit);
}

function flagShorts(isShorts: boolean | null): string {
  if (isShorts === true) return "[쇼츠] ";
  if (isShorts === false) return "[롱폼] ";
  return "";
}

function normalizeTopChannels(topChannels: unknown[]): NormalizedTopChannel[] {
  return (Array.isArray(topChannels) ? topChannels : [])
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const typedRow = row as PintTopChannelRow;
      const id = safeString(typedRow.id);
      const youtubeChannelId = safeString(typedRow.youtube_channel_id);
      const title = safeString(typedRow.title);
      if (!id || !youtubeChannelId || !title) return null;

      const subscriberCount = Number(typedRow.subscriber_count);
      const dailyViews = Number(typedRow.daily_views);
      const primaryCategoryId = Number(typedRow.primary_category_id);
      return {
        id,
        youtubeChannelId,
        title,
        subscriberCount: Number.isFinite(subscriberCount) ? subscriberCount : null,
        dailyViews: Number.isFinite(dailyViews) ? dailyViews : null,
        contentFormat: safeString(typedRow.content_format) || null,
        primaryCategoryId: Number.isFinite(primaryCategoryId) ? primaryCategoryId : null,
      } satisfies NormalizedTopChannel;
    })
    .filter((value): value is NormalizedTopChannel => value !== null);
}

function isWhaleChannel(channel: Pick<NormalizedTopChannel, "subscriberCount">): boolean {
  return typeof channel.subscriberCount === "number" && Number.isFinite(channel.subscriberCount) && channel.subscriberCount > WHALE_SUBSCRIBER_THRESHOLD;
}

function isSuspiciousChannel(channel: Pick<NormalizedTopChannel, "subscriberCount" | "dailyViews">): boolean {
  if (typeof channel.subscriberCount !== "number" || !Number.isFinite(channel.subscriberCount) || channel.subscriberCount <= 0) return false;
  if (typeof channel.dailyViews !== "number" || !Number.isFinite(channel.dailyViews)) return false;
  if (channel.dailyViews < SUSPICIOUS_DAILY_VIEWS_MIN) return false;
  return channel.dailyViews / channel.subscriberCount >= SUSPICIOUS_VIEW_SUBSCRIBER_RATIO;
}

function shouldExcludeChannel(channel: Pick<NormalizedTopChannel, "subscriberCount" | "dailyViews">): boolean {
  return isWhaleChannel(channel) || isSuspiciousChannel(channel);
}

function isDiscoverySizedChannel(channel: Pick<NormalizedTopChannel, "subscriberCount">): boolean {
  return (
    typeof channel.subscriberCount === "number" &&
    Number.isFinite(channel.subscriberCount) &&
    channel.subscriberCount > 0 &&
    channel.subscriberCount <= TOP_CHANNEL_DISCOVERY_MAX_SUBSCRIBERS
  );
}

function isOfficialOrCorporateChannel(channel: Pick<NormalizedTopChannel, "title">): boolean {
  const title = safeString(channel.title).toLowerCase();
  if (!title) return false;
  return /\b(official|records|entertainment|studios?|pictures|media|news|vevo|label)\b/.test(title) || /(공식|오피셜|레코즈|엔터테인먼트|스튜디오|미디어|뉴스)/.test(title);
}

function growthRatio(channel: Pick<NormalizedTopChannel, "subscriberCount" | "dailyViews">): number | null {
  if (typeof channel.subscriberCount !== "number" || !Number.isFinite(channel.subscriberCount) || channel.subscriberCount <= 0) return null;
  if (typeof channel.dailyViews !== "number" || !Number.isFinite(channel.dailyViews) || channel.dailyViews < 0) return null;
  return channel.dailyViews / channel.subscriberCount;
}

function buildChannelLookups(topChannels: unknown[]): {
  byInternalId: Map<string, NormalizedTopChannel>;
  byTitle: Map<string, NormalizedTopChannel>;
} {
  const byInternalId = new Map<string, NormalizedTopChannel>();
  const byTitle = new Map<string, NormalizedTopChannel>();
  for (const channel of normalizeTopChannels(topChannels)) {
    byInternalId.set(channel.id, channel);
    byTitle.set(channel.title.toLowerCase(), channel);
  }
  return { byInternalId, byTitle };
}

function excludeUnreliableVideos(videos: PintHomeHotVideo[], topChannels: unknown[] | undefined): PintHomeHotVideo[] {
  if (!Array.isArray(topChannels) || topChannels.length === 0) return videos;
  const { byInternalId, byTitle } = buildChannelLookups(topChannels);
  return videos.filter((video) => {
    const internalId = safeString((video as any).channelId);
    const channel = (internalId ? byInternalId.get(internalId) : undefined) ?? byTitle.get(safeString(video.channelTitle).toLowerCase());
    if (!channel) return true;
    return !shouldExcludeChannel(channel);
  });
}

function resolveIssueMetrics(topic: PintTrendHunterTopic, window: "1h" | "24h"): IssueMetrics {
  const deltas = topic.deltas || null;
  const totals = topic.totals || null;

  if (window === "1h" && (deltas?.views1h != null || deltas?.comments1h != null)) {
    return {
      label: "1h",
      views: deltas?.views1h ?? null,
      comments: deltas?.comments1h ?? null,
    };
  }

  if (window === "24h" && (deltas?.views24h != null || deltas?.comments24h != null)) {
    return {
      label: "24h",
      views: deltas?.views24h ?? null,
      comments: deltas?.comments24h ?? null,
    };
  }

  return {
    label: "누적",
    views: totals?.views ?? null,
    comments: totals?.comments ?? null,
  };
}

function isStrongEnoughIssue(topic: PintTrendHunterTopic, window: "1h" | "24h"): boolean {
  const metrics = resolveIssueMetrics(topic, window);
  const threshold = ISSUE_MINIMUMS[window];
  const views = metrics.views ?? 0;
  const comments = metrics.comments ?? 0;
  return (
    views >= threshold.minViewsOnly ||
    comments >= threshold.minCommentsOnly ||
    (views >= threshold.minViewsWithComments && comments >= threshold.minCommentsWithViews)
  );
}

function compareIssueStrength(a: PintTrendHunterTopic, b: PintTrendHunterTopic, window: "1h" | "24h"): number {
  const am = resolveIssueMetrics(a, window);
  const bm = resolveIssueMetrics(b, window);
  const commentDelta = (bm.comments ?? -1) - (am.comments ?? -1);
  if (commentDelta !== 0) return commentDelta;
  const viewDelta = (bm.views ?? -1) - (am.views ?? -1);
  if (viewDelta !== 0) return viewDelta;
  return safeString(a.title).localeCompare(safeString(b.title), "ko");
}

function buildIssueMetricLine(topic: PintTrendHunterTopic, window: "1h" | "24h"): string {
  const metrics = resolveIssueMetrics(topic, window);
  return `- ${metrics.label} 조회 ${fmtInt(metrics.views)}, 댓글 ${fmtInt(metrics.comments)}`;
}

export function buildPintHelpMessage(origin: string): string {
  const lines: string[] = [];
  lines.push("바로 써볼 수 있게 정리해드릴게요 😊");
  lines.push("");
  lines.push("1. !이슈");
  lines.push("- 지금 커뮤니티에서 실제 반응이 붙는 주제를 보여줘요.");
  lines.push("2. !밤새 [쇼츠|롱폼|전체]");
  lines.push("- 밤사이 조회가 많이 오른 영상을 보여줘요. 고래/이상치 채널은 제외해요.");
  lines.push("3. !핫영상 [쇼츠|롱폼|전체]");
  lines.push("- 지금 시간당 조회가 빠르게 붙는 영상을 보여줘요. 고래/이상치 채널은 제외해요.");
  lines.push("4. !신규");
  lines.push("- 오늘 새로 포착된 루키 채널을 보여줘요.");
  lines.push("5. !급상승");
  lines.push("- 구독 30만 이하 채널 중에서 구독 대비 성장률이 큰 채널을 보여줘요. 기업/공식, 고래/이상치 채널은 제외해요.");
  lines.push("");
  lines.push("- 자연어도 돼요");
  lines.push('- "요즘 뭐 떠?"');
  lines.push('- "밤새 뭐 올랐어?"');
  lines.push('- "신규 뭐 있어?"');
  lines.push('- "급상승 뭐 있어?"');
  return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/home`]);
}

export function buildPintIssuesMessage(opts: { origin: string; topics: PintTrendHunterTopic[]; window: "1h" | "24h" }): string {
  const { origin, topics, window } = opts;
  const filtered = (Array.isArray(topics) ? topics : [])
    .filter((topic) => isStrongEnoughIssue(topic, window))
    .sort((a, b) => compareIssueStrength(a, b, window));
  const top = pickTop(filtered, 7);
  const lines: string[] = [];
  lines.push(window === "24h" ? "오늘 댓글 반응이 많이 붙은 이슈만 바로 볼게요 😊" : "지금 댓글 반응이 빠르게 붙는 이슈만 바로 볼게요 😊");
  lines.push("");

  if (top.length === 0) {
    lines.push("1. 아직 기준을 넘긴 이슈는 없어요.");
    lines.push("- 대신 !핫영상으로 지금 뜨는 영상을 먼저 볼 수 있어요.");
    return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/trend/hunter`]);
  }

  let idx = 0;
  for (const topic of top) {
    idx += 1;
    lines.push(`${idx}. ${safeString(topic.title)}`);
    lines.push(buildIssueMetricLine(topic, window));
  }

  return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/trend/hunter`]);
}

export function buildPintTrendingTopicsMessage(opts: { origin: string; topics: PintTrendingTopic[] }): string {
  const { origin, topics } = opts;
  const top = pickTop(topics, 5);
  const lines: string[] = [];
  lines.push("오늘 주목할 토픽만 빠르게 볼게요 😊");
  lines.push("");

  if (top.length === 0) {
    lines.push("1. 아직 대표 토픽은 비어 있어요.");
    return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/home`]);
  }

  let idx = 0;
  for (const topic of top) {
    idx += 1;
    lines.push(`${idx}. ${safeString(topic.title)}`);
    lines.push(`- ${safeString(topic.reason)}`);
  }

  return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/home`]);
}

export function buildPintHotVideosMessage(opts: {
  origin: string;
  videos: PintHomeHotVideo[];
  mode: "now" | "overnight";
  limit?: number;
  only?: "shorts" | "long" | "all";
  topChannels?: unknown[];
  excludeWhales?: boolean;
}): string {
  const { origin, videos, mode } = opts;
  const limit = typeof opts.limit === "number" ? Math.max(3, Math.min(10, opts.limit)) : 6;
  const only = opts.only ?? "all";
  const excludeWhales = opts.excludeWhales !== false;

  const filteredByFormat = videos.filter((video) => {
    if (only === "shorts") return video.isShorts === true;
    if (only === "long") return video.isShorts === false;
    return true;
  });

  const filtered = excludeWhales ? excludeUnreliableVideos(filteredByFormat, opts.topChannels) : filteredByFormat;
  const sorted = filtered.slice().sort((a, b) => {
    const av = mode === "overnight" ? a.viewsWindow : a.viewsPerHour;
    const bv = mode === "overnight" ? b.viewsWindow : b.viewsPerHour;
    const an = typeof av === "number" && Number.isFinite(av) ? av : -1;
    const bn = typeof bv === "number" && Number.isFinite(bv) ? bv : -1;
    return bn - an;
  });

  const top = pickTop(sorted, limit);
  const lines: string[] = [];
  lines.push(mode === "overnight" ? "밤사이 많이 오른 영상만 추려봤어요 😊" : "지금 뜨는 영상만 추려봤어요 😊");
  lines.push("");

  if (top.length === 0) {
    lines.push("1. 지금 보여드릴 영상이 아직 없어요.");
    lines.push("- 대신 !급상승으로 치고 올라오는 채널을 볼 수 있어요.");
    return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/hot-videos`]);
  }

  let idx = 0;
  for (const video of top) {
    idx += 1;
    const channelTitle = safeString(video.channelTitle) || "채널명 미확인";
    const metric = mode === "overnight" ? video.viewsWindow : video.viewsPerHour;
    const metricLabel = mode === "overnight" ? "24h 조회" : "시간당 조회";
    lines.push(`${idx}. ${flagShorts(video.isShorts)}${channelTitle}`);
    lines.push(`- ${safeString(video.title)}`);
    lines.push(`- ${metricLabel} ${fmtCompact(metric)}`);
  }

  return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/hot-videos`]);
}

export function buildPintTopChannelsMessage(opts: {
  origin: string;
  topChannels: unknown[];
  limit?: number;
  excludeWhales?: boolean;
}): string {
  const { origin, topChannels } = opts;
  const limit = typeof opts.limit === "number" ? Math.max(3, Math.min(10, opts.limit)) : 6;
  const excludeWhales = opts.excludeWhales !== false;

  const mapped = normalizeTopChannels(topChannels);
  const filtered = mapped
    .filter((channel) => isDiscoverySizedChannel(channel))
    .filter((channel) => !isOfficialOrCorporateChannel(channel))
    .filter((channel) => (excludeWhales ? !shouldExcludeChannel(channel) : true))
    .sort((a, b) => {
      const ratioDelta = (growthRatio(b) ?? -1) - (growthRatio(a) ?? -1);
      if (ratioDelta !== 0) return ratioDelta;
      const viewDelta = (b.dailyViews ?? -1) - (a.dailyViews ?? -1);
      if (viewDelta !== 0) return viewDelta;
      const subDelta = (a.subscriberCount ?? Number.MAX_SAFE_INTEGER) - (b.subscriberCount ?? Number.MAX_SAFE_INTEGER);
      if (subDelta !== 0) return subDelta;
      return a.title.localeCompare(b.title, "ko");
    });
  const top = filtered.slice(0, limit);

  const lines: string[] = [];
  lines.push(`오늘 발굴할 급상승 채널 ${top.length}개를 추려봤어요 😊`);
  lines.push("");

  if (top.length === 0) {
    lines.push("1. 지금 기준에 맞는 발굴 채널이 없어요.");
    lines.push("- 대신 !핫영상으로 지금 뜨는 영상을 먼저 볼 수 있어요.");
    return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/home`]);
  }

  let idx = 0;
  for (const channel of top) {
    idx += 1;
    lines.push(`${idx}. ${channel.title}`);
    lines.push(`- 구독 ${fmtCompact(channel.subscriberCount)}, 24h 조회 ${fmtCompact(channel.dailyViews)}`);
    lines.push(`- 구독 대비 24h 조회 ${fmtRatio(growthRatio(channel))}`);
  }

  return withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/home`]);
}

function toKstDateOnly(iso: string): string | null {
  const raw = safeString(iso);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  const dt = new Date(ms);
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(dt);
    const y = parts.find((p) => p.type === "year")?.value;
    const m = parts.find((p) => p.type === "month")?.value;
    const d = parts.find((p) => p.type === "day")?.value;
    if (!y || !m || !d) return null;
    return `${y}-${m}-${d}`;
  } catch {
    return raw.slice(0, 10);
  }
}

export function buildPintRookiesMessage(opts: {
  origin: string;
  rookies: PintHomeRookieChannel[];
  todayKst: string;
  limit?: number;
}): { text: string; hasNew: boolean } {
  const { origin, rookies, todayKst } = opts;
  const limit = typeof opts.limit === "number" ? Math.max(3, Math.min(10, opts.limit)) : 6;

  const newOnes = rookies.filter((channel) => {
    const firstSeen = toKstDateOnly(channel.firstSeenDate || "");
    if (!firstSeen) return false;
    return firstSeen === todayKst;
  });

  const top = pickTop(newOnes, limit);
  const lines: string[] = [];
  if (top.length === 0) {
    lines.push("오늘 새로 포착된 루키 채널은 아직 없어요 😊");
    lines.push("");
    lines.push("1. 대신 !급상승으로 오늘 치고 올라오는 채널을 볼 수 있어요.");
    const text = withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/rookies`]);
    return { text, hasNew: false };
  }

  lines.push("오늘 새로 포착된 루키 채널만 추려봤어요 😊");
  lines.push("");
  let idx = 0;
  for (const channel of top) {
    idx += 1;
    const title = safeString(channel.title) || "채널명 미확인";
    lines.push(`${idx}. ${title}`);
    lines.push(`- 구독 ${fmtCompact(channel.subscriberCount)}, 24h 조회 ${fmtCompact(channel.dailyViews)}`);
  }

  const text = withFooterLinks(lines.join("\n"), [`${origin.replace(/\/+$/, "")}/rookies`]);
  return { text, hasNew: true };
}
