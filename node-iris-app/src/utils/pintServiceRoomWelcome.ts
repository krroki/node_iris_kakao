type RuntimeConfig = {
  features?: Record<string, Record<string, unknown> | undefined>;
};

export const PINT_SERVICE_ROOM_ID = "18475321871585649";
export const PINT_SERVICE_ROOM_WELCOME_FEATURE = "pintServiceWelcomeOnly";
export const PINT_SERVICE_ROOM_WELCOME_TEMPLATE = "welcome_pint_service_room";
export const PINT_SERVICE_ROOM_ORIGIN = "https://pint.kr";

export type PintWelcomeMetrics = {
  hotVideoCount: number | null;
  rookieCount: number | null;
  issueCount: number | null;
};

type PintWelcomeTimeSlot = "morning" | "day" | "evening" | "night";

const BASE_WELCOMES = [
  "{entrance}님 어서오세요! 🍺",
  "{entrance}님 반가워요! 🍺",
  "{entrance}님 환영해요! 🍺",
  "{entrance}님 왔다! 반가워요 🍺",
  "{entrance}님 합류! 환영해요 🍺",
  "어서오세요 {entrance}님! 🍺",
  "{entrance}님 들어오셨네! 반가워요 🍺",
  "{entrance}님 안녕하세요! 🍺",
  "반갑습니다 {entrance}님! 🍺",
  "{entrance}님 어서와요! 🍺",
] as const;

const SLOT_WELCOMES: Record<PintWelcomeTimeSlot, readonly string[]> = {
  morning: [
    "{entrance}님 좋은 아침이에요! 🍺",
    "{entrance}님 굿모닝! 🍺",
    "{entrance}님 아침부터 부지런하시네요! 🍺",
    "{entrance}님 좋은 아침! 반가워요 🍺",
    "{entrance}님 안녕하세요! 오늘도 좋은 하루 되세요 🍺",
  ],
  day: [
    "{entrance}님 안녕하세요! 점심은 드셨어요? 🍺",
    "{entrance}님 반가워요! 오늘 하루 어떠세요? 🍺",
    "{entrance}님 어서오세요! 좋은 오후예요 🍺",
    "{entrance}님 환영해요! 오후도 힘내요 🍺",
    "{entrance}님 왔다! 좋은 하루 보내고 계시죠? 🍺",
  ],
  evening: [
    "{entrance}님 수고하셨어요! 🍺",
    "{entrance}님 반가워요! 퇴근하셨어요? 🍺",
    "{entrance}님 어서오세요! 좋은 저녁이에요 🍺",
    "{entrance}님 환영해요! 오늘 하루도 수고 많으셨어요 🍺",
    "{entrance}님 왔다! 편한 저녁 보내세요 🍺",
  ],
  night: [
    "{entrance}님 아직 안 주무시네요! 🍺",
    "{entrance}님 반가워요! 늦은 시간에 어서오세요 🍺",
    "{entrance}님 환영해요! 야행성이시군요 🍺",
    "{entrance}님 어서오세요! 좋은 밤이에요 🍺",
    "{entrance}님 왔다! 늦었는데 푹 쉬어요 🍺",
  ],
};

function safeString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return value.toString();
  return "";
}

export function isPintServiceRoomWelcomeOnlyEnabled(runtime: RuntimeConfig, roomId: string): boolean {
  const rid = safeString(roomId);
  if (rid !== PINT_SERVICE_ROOM_ID) return false;

  const features = runtime?.features;
  if (!features || typeof features !== "object") return false;

  const roomFeatures = features[rid];
  if (!roomFeatures || typeof roomFeatures !== "object") return false;

  return (roomFeatures as Record<string, unknown>)[PINT_SERVICE_ROOM_WELCOME_FEATURE] === true;
}

function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function pickStable<T>(items: readonly T[], seed: string): T {
  return items[hashString(seed) % items.length]!;
}

function getKstParts(now: Date): { ymd: string; hour: number } {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const y = parts.find((p) => p.type === "year")?.value || "0000";
    const m = parts.find((p) => p.type === "month")?.value || "01";
    const d = parts.find((p) => p.type === "day")?.value || "01";
    const h = Number(parts.find((p) => p.type === "hour")?.value || "0");
    return { ymd: `${y}-${m}-${d}`, hour: Number.isFinite(h) ? h : 0 };
  } catch {
    return { ymd: now.toISOString().slice(0, 10), hour: now.getHours() };
  }
}

function resolveTimeSlot(now: Date): PintWelcomeTimeSlot {
  const { hour } = getKstParts(now);
  if (hour >= 6 && hour < 11) return "morning";
  if (hour >= 11 && hour < 17) return "day";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

function normalizeMetric(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

export function extractPintWelcomeMetrics(
  data: {
    hotVideos?: unknown[];
    rookies?: Array<{ firstSeenDate?: string | null }>;
    trendingTopics?: unknown[];
  },
  now: Date = new Date(),
): PintWelcomeMetrics {
  const todayKst = getKstParts(now).ymd;
  const hotVideoCount = Array.isArray(data.hotVideos) ? data.hotVideos.length : 0;
  const rookieCount = Array.isArray(data.rookies)
    ? data.rookies.filter((item) => safeString(item?.firstSeenDate) === todayKst).length
    : 0;
  const issueCount = Array.isArray(data.trendingTopics) ? data.trendingTopics.length : 0;

  return {
    hotVideoCount: normalizeMetric(hotVideoCount),
    rookieCount: normalizeMetric(rookieCount),
    issueCount: normalizeMetric(issueCount),
  };
}

export function buildPintServiceRoomWelcomeMessage(opts?: {
  entrancePlaceholder?: string;
  metrics?: Partial<PintWelcomeMetrics> | null;
  seedKey?: string | null;
  now?: Date;
}): string {
  const now = opts?.now instanceof Date ? opts.now : new Date();
  const entrance = safeString(opts?.entrancePlaceholder) || "{entrance}";
  const slot = resolveTimeSlot(now);
  const seedKey = safeString(opts?.seedKey) || entrance;
  const seed = `${slot}|${seedKey}|${getKstParts(now).ymd}`;
  const pool = [...BASE_WELCOMES, ...SLOT_WELCOMES[slot]];
  return pickStable(pool, seed).replace(/\{entrance\}/g, entrance);
}

export function resolvePintNaturalLanguageCommand(textRaw: string): string | null {
  const raw = safeString(textRaw);
  if (!raw || raw.startsWith("!")) return null;

  const compact = raw
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[?!.,~`'"]/g, "");
  if (!compact || compact.length > 24) return null;

  const rules: Array<{ re: RegExp; command: string }> = [
    { re: /^(요즘뭐떠|지금뭐떠|뭐떠|요즘뭐뜸|지금뭐뜸|뭐뜸|핫한거뭐야|지금뜨는거뭐야)$/, command: "핫영상" },
    { re: /^(밤새뭐올랐어|밤새뭐떠|밤새뭐뜸|밤새뭐핫해|오버나이트뭐야)$/, command: "밤새" },
    { re: /^(오늘이슈뭐야|요즘무슨이슈야|이슈뭐야|무슨이슈야)$/, command: "이슈" },
    { re: /^(신규뭐있어|루키뭐있어|오늘신규뭐있어|신규뭐야|새로운채널뭐있어)$/, command: "신규" },
    { re: /^(급상승뭐있어|오늘급상승뭐야|급상승채널뭐있어|채널뭐떠|채널뭐뜸)$/, command: "급상승" },
    { re: /^(핀트뭐할수있어|뭐할수있어|뭐돼|도움말|핀트도움말)$/, command: "도움말" },
  ];

  for (const rule of rules) {
    if (rule.re.test(compact)) return rule.command;
  }
  return null;
}
