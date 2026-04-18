type Json = Record<string, unknown>;

export type PintHomeHotVideo = {
  youtubeVideoId: string;
  channelTitle: string | null;
  title: string;
  viewsWindow: number | null;
  viewsPerHour: number | null;
  isShorts: boolean | null;
  contentFormat: string | null;
  publishedAt: string;
  snapshotHour: string;
};

export type PintHomeRookieChannel = {
  youtubeChannelId: string;
  title: string | null;
  subscriberCount: number | null;
  dailyViews: number | null;
  createdDate: string | null;
  lastUploadAt: string | null;
  contentFormat: string | null;
  emergingType: string | null;
  snapshotDate: string;
  firstSeenDate: string | null;
  daysSeen: number | null;
  countryCode: string | null;
};

export type PintTrendingTopic = { title: string; reason: string };

export type PintHomeData = {
  fetchedAt: string;
  topChannels: unknown[];
  trendingTopics: PintTrendingTopic[];
  hotVideos: PintHomeHotVideo[];
  rookies: PintHomeRookieChannel[];
};

export type PintTrendHunterTopic = {
  id: string;
  title: string;
  mentionCount: number;
  uniqueSources: number;
  sourceCounts: Record<string, number> | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  deltas: {
    views1h: number | null;
    comments1h: number | null;
    recommends1h: number | null;
    views24h: number | null;
    comments24h: number | null;
    recommends24h: number | null;
  } | null;
  totals: { views: number | null; comments: number | null; recommends: number | null } | null;
};

export type PintTrendHunterTopicsResponse = {
  ok: boolean;
  fetchedAt: string;
  window: "1h" | "24h";
  sort: string;
  lookbackHours: number;
  topics: PintTrendHunterTopic[];
};

type CacheEntry<T> = { expiresAt: number; value: T };
const memCache = new Map<string, CacheEntry<unknown>>();

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function safeNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function getCached<T>(key: string): T | null {
  const cur = memCache.get(key);
  if (!cur) return null;
  if (Date.now() >= cur.expiresAt) {
    memCache.delete(key);
    return null;
  }
  return cur.value as T;
}

function setCached<T>(key: string, value: T, ttlMs: number) {
  if (!(ttlMs > 0)) return;
  memCache.set(key, { value, expiresAt: Date.now() + ttlMs });
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number): Promise<{ ok: boolean; json?: Json; err?: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, {
      method: "GET",
      signal: ctrl.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "12.kakao/command-worker (pint briefing)",
      },
    });
    clearTimeout(t);

    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { ok: false, err: `invalid_json` };
    if (!res.ok) return { ok: false, json: data as Json, err: `http_${res.status}` };
    return { ok: true, json: data as Json };
  } catch (e) {
    return { ok: false, err: safeString(e) || "fetch_failed" };
  }
}

async function fetchJsonWithTimeoutAdvanced(opts: {
  url: string;
  method: "GET" | "POST";
  timeoutMs: number;
  headers?: Record<string, string>;
  body?: unknown;
}): Promise<{ ok: boolean; json?: Json; err?: string; status?: number }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs);

    const headers: Record<string, string> = {
      Accept: "application/json",
      "User-Agent": "12.kakao/command-worker (pint client)",
      ...opts.headers,
    };

    const res = await fetch(opts.url, {
      method: opts.method,
      signal: ctrl.signal,
      headers,
      body: opts.body == null ? undefined : JSON.stringify(opts.body),
    });
    clearTimeout(t);

    const data: unknown = await res.json().catch(() => null);
    if (!data || typeof data !== "object") return { ok: false, err: `invalid_json`, status: res.status };
    if (!res.ok) return { ok: false, json: data as Json, err: `http_${res.status}`, status: res.status };
    return { ok: true, json: data as Json, status: res.status };
  } catch (e) {
    return { ok: false, err: safeString(e) || "fetch_failed" };
  }
}

export async function fetchPintHomeData(options?: {
  origin?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
}): Promise<{ ok: boolean; data?: PintHomeData; err?: string }> {
  const origin = safeString(options?.origin) || "https://pint.kr";
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 4500;
  const cacheTtlMs = typeof options?.cacheTtlMs === "number" ? options.cacheTtlMs : 30_000;
  const cacheKey = `pint:home:data:v1:${origin}`;

  const cached = getCached<PintHomeData>(cacheKey);
  if (cached) return { ok: true, data: cached };

  const url = `${origin.replace(/\/+$/, "")}/api/home/data`;
  const res = await fetchJsonWithTimeout(url, timeoutMs);
  if (!res.ok) return { ok: false, err: res.err || "home_data_failed" };

  const root = res.json || {};
  const success = (root as any).success === true;
  const payload = success ? (root as any).data : null;
  if (!payload || typeof payload !== "object") return { ok: false, err: "home_data_empty" };

  const topChannels = Array.isArray((payload as any).topChannels) ? ((payload as any).topChannels as unknown[]) : [];

  const trendingTopicsRaw = (payload as any).trending?.topics;
  const trendingTopics: PintTrendingTopic[] = Array.isArray(trendingTopicsRaw)
    ? (trendingTopicsRaw as any[])
        .map((t) => {
          if (!t || typeof t !== "object") return null;
          const title = safeString((t as any).title);
          const reason = safeString((t as any).reason);
          if (!title || !reason) return null;
          return { title, reason };
        })
        .filter((x): x is PintTrendingTopic => x !== null)
    : [];

  const hotVideosRaw = Array.isArray((payload as any).hotVideos) ? ((payload as any).hotVideos as any[]) : [];
  const hotVideos: PintHomeHotVideo[] = hotVideosRaw
    .map((v) => {
      if (!v || typeof v !== "object") return null;
      const youtubeVideoId = safeString((v as any).youtubeVideoId);
      const title = safeString((v as any).title);
      if (!youtubeVideoId || !title) return null;
      return {
        youtubeVideoId,
        channelTitle: safeString((v as any).channelTitle) || null,
        title,
        viewsWindow: safeNumber((v as any).viewsWindow),
        viewsPerHour: safeNumber((v as any).viewsPerHour),
        isShorts: typeof (v as any).isShorts === "boolean" ? ((v as any).isShorts as boolean) : null,
        contentFormat: safeString((v as any).contentFormat) || null,
        publishedAt: safeString((v as any).publishedAt) || "",
        snapshotHour: safeString((v as any).snapshotHour) || "",
      };
    })
    .filter((x): x is PintHomeHotVideo => x !== null);

  const rookiesRaw = Array.isArray((payload as any).rookies) ? ((payload as any).rookies as any[]) : [];
  const rookies: PintHomeRookieChannel[] = rookiesRaw
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const youtubeChannelId = safeString((c as any).youtubeChannelId);
      if (!youtubeChannelId) return null;
      return {
        youtubeChannelId,
        title: safeString((c as any).title) || null,
        subscriberCount: safeNumber((c as any).subscriberCount),
        dailyViews: safeNumber((c as any).dailyViews),
        createdDate: safeString((c as any).createdDate) || null,
        lastUploadAt: safeString((c as any).lastUploadAt) || null,
        contentFormat: safeString((c as any).contentFormat) || null,
        emergingType: safeString((c as any).emergingType) || null,
        snapshotDate: safeString((c as any).snapshotDate) || "",
        firstSeenDate: safeString((c as any).firstSeenDate) || null,
        daysSeen: safeNumber((c as any).daysSeen),
        countryCode: safeString((c as any).countryCode) || null,
      };
    })
    .filter((x): x is PintHomeRookieChannel => x !== null);

  const data: PintHomeData = {
    fetchedAt: new Date().toISOString(),
    topChannels,
    trendingTopics,
    hotVideos,
    rookies,
  };
  setCached(cacheKey, data, cacheTtlMs);
  return { ok: true, data };
}

export type PintBriefingStudioJob = {
  id: string;
  target: "test" | "prod";
  templateId: string;
  templateLabel: string;
  text: string;
  imageUrls: string[];
  draftPageCount?: number;
};

export async function fetchPintBriefingStudioNextJob(options: {
  token: string;
  origin?: string;
  timeoutMs?: number;
  workerId?: string;
}): Promise<{ ok: boolean; job?: PintBriefingStudioJob | null; err?: string }> {
  const origin = safeString(options?.origin) || "https://pint.kr";
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 6500;
  const token = safeString(options?.token);
  if (!token) return { ok: false, err: "missing_token" };

  const url = `${origin.replace(/\/+$/, "")}/api/briefing-studio/bot/next`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "User-Agent": "12.kakao/command-worker (briefing-studio)",
  };
  const workerId = safeString(options?.workerId);
  if (workerId) headers["x-briefing-worker-id"] = workerId.slice(0, 80);

  const res = await fetchJsonWithTimeoutAdvanced({ url, method: "GET", timeoutMs, headers });
  if (!res.ok) return { ok: false, err: res.err || "briefing_studio_next_failed" };

  const root = res.json || {};
  if ((root as any).ok !== true) return { ok: false, err: "briefing_studio_next_not_ok" };

  const jobRaw = (root as any).job;
  if (!jobRaw) return { ok: true, job: null };
  if (typeof jobRaw !== "object") return { ok: false, err: "briefing_studio_job_invalid" };

  const id = safeString((jobRaw as any).id);
  const text = safeString((jobRaw as any).text);
  const templateId = safeString((jobRaw as any).templateId);
  const templateLabel = safeString((jobRaw as any).templateLabel) || "브리핑";
  const targetRaw = safeString((jobRaw as any).target).toLowerCase();
  const target: "test" | "prod" = targetRaw === "prod" ? "prod" : "test";
  const imageUrlsRaw = Array.isArray((jobRaw as any).imageUrls) ? ((jobRaw as any).imageUrls as any[]) : [];
  const imageUrls = imageUrlsRaw.map((u) => safeString(u)).filter(Boolean).slice(0, 6);

  const draftRaw = (jobRaw as any).draft;
  const draftPagesRaw = draftRaw && typeof draftRaw === "object" ? (draftRaw as any).pages : null;
  const draftPageCount = Array.isArray(draftPagesRaw) ? draftPagesRaw.length : 0;
  const hasDraft = draftPageCount > 0;

  // Some templates may legitimately enqueue with fewer than 3 images (e.g. insufficient data).
  // 또한, 일부 job은 imageUrls 없이 draft만 포함될 수 있으며(봇이 렌더+업로드 수행), 그 경우도 허용한다.
  if (!id || !text || (imageUrls.length < 1 && !hasDraft)) return { ok: false, err: "briefing_studio_job_incomplete" };

  return {
    ok: true,
    job: {
      id,
      target,
      templateId,
      templateLabel,
      text,
      imageUrls,
      ...(hasDraft ? { draftPageCount } : {}),
    },
  };
}

export async function ackPintBriefingStudioJob(options: {
  token: string;
  origin?: string;
  timeoutMs?: number;
  jobId: string;
  ok: boolean;
  detail?: string;
  workerId?: string;
  imageUrls?: string[];
}): Promise<{ ok: boolean; err?: string }> {
  const origin = safeString(options?.origin) || "https://pint.kr";
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 6500;
  const token = safeString(options?.token);
  if (!token) return { ok: false, err: "missing_token" };

  const url = `${origin.replace(/\/+$/, "")}/api/briefing-studio/bot/ack`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    "User-Agent": "12.kakao/command-worker (briefing-studio)",
  };

  const workerId = safeString(options?.workerId);
  const body = {
    jobId: safeString(options?.jobId),
    ok: options.ok === true,
    detail: safeString(options?.detail) || undefined,
    workerId: workerId ? workerId.slice(0, 80) : undefined,
    imageUrls:
      Array.isArray(options?.imageUrls) && options.imageUrls.length > 0
        ? options.imageUrls.map((u) => safeString(u)).filter(Boolean).slice(0, 6)
        : undefined,
  };

  const res = await fetchJsonWithTimeoutAdvanced({ url, method: "POST", timeoutMs, headers, body });
  if (!res.ok) return { ok: false, err: res.err || "briefing_studio_ack_failed" };

  const root = res.json || {};
  if ((root as any).ok !== true) return { ok: false, err: "briefing_studio_ack_not_ok" };
  return { ok: true };
}

export async function fetchPintTrendHunterTopics(options?: {
  origin?: string;
  timeoutMs?: number;
  cacheTtlMs?: number;
  window?: "1h" | "24h";
  sort?: "comments" | "mentions" | "views" | "recommends";
  limit?: number;
  lookbackHours?: number;
}): Promise<{ ok: boolean; data?: PintTrendHunterTopicsResponse; err?: string }> {
  const origin = safeString(options?.origin) || "https://pint.kr";
  const timeoutMs = typeof options?.timeoutMs === "number" ? options.timeoutMs : 6500;
  const cacheTtlMs = typeof options?.cacheTtlMs === "number" ? options.cacheTtlMs : 5 * 60_000;
  const windowKey = options?.window === "24h" ? "24h" : "1h";
  const sortKey =
    options?.sort === "mentions" || options?.sort === "views" || options?.sort === "recommends" || options?.sort === "comments"
      ? options.sort
      : "comments";
  const limit = typeof options?.limit === "number" ? Math.max(5, Math.min(30, options.limit)) : 8;
  const lookbackHours = typeof options?.lookbackHours === "number" ? Math.max(1, Math.min(24 * 30, options.lookbackHours)) : 24;

  const cacheKey = `pint:trend-hunter:v3:topics:v1:${origin}:${windowKey}:${sortKey}:${limit}:${lookbackHours}`;
  const cached = getCached<PintTrendHunterTopicsResponse>(cacheKey);
  if (cached) return { ok: true, data: cached };

  const base = `${origin.replace(/\/+$/, "")}/api/trend/hunter/v3/topics`;
  const url = `${base}?region=KR&window=${encodeURIComponent(windowKey)}&sort=${encodeURIComponent(sortKey)}&limit=${encodeURIComponent(
    String(limit),
  )}&lookback_hours=${encodeURIComponent(String(lookbackHours))}`;

  const res = await fetchJsonWithTimeout(url, timeoutMs);
  if (!res.ok) return { ok: false, err: res.err || "trend_hunter_failed" };

  const root = res.json || {};
  const ok = (root as any).ok === true;
  const topicsRaw = Array.isArray((root as any).topics) ? ((root as any).topics as any[]) : [];
  const topics: PintTrendHunterTopic[] = topicsRaw
    .map((t) => {
      if (!t || typeof t !== "object") return null;
      const id = safeString((t as any).id);
      const title = safeString((t as any).title);
      if (!id || !title) return null;
      return {
        id,
        title,
        mentionCount: safeNumber((t as any).mentionCount) ?? 0,
        uniqueSources: safeNumber((t as any).uniqueSources) ?? 0,
        sourceCounts: (t as any).sourceCounts && typeof (t as any).sourceCounts === "object" ? ((t as any).sourceCounts as any) : null,
        firstSeenAt: safeString((t as any).firstSeenAt) || null,
        lastSeenAt: safeString((t as any).lastSeenAt) || null,
        deltas: (t as any).deltas && typeof (t as any).deltas === "object" ? ((t as any).deltas as any) : null,
        totals: (t as any).totals && typeof (t as any).totals === "object" ? ((t as any).totals as any) : null,
      };
    })
    .filter((x): x is PintTrendHunterTopic => x !== null);

  const data: PintTrendHunterTopicsResponse = {
    ok,
    fetchedAt: safeString((root as any).fetchedAt) || new Date().toISOString(),
    window: windowKey,
    sort: safeString((root as any).sort) || sortKey,
    lookbackHours: safeNumber((root as any).lookbackHours) ?? lookbackHours,
    topics,
  };
  setCached(cacheKey, data, cacheTtlMs);
  return { ok: true, data };
}
