import { promises as fs } from "fs";
import path from "path";
import { randomInt } from "crypto";
import { APP_ROOT } from "./paths";

export type WelcomeNicknameClass = "kakao_default_nickname" | "custom_nickname";
export type WelcomeTemplatePick = "random" | "hash_sender_id" | "hash_user_name";

export interface WelcomeTemplateSelection {
  templateName: string;
  nicknameClass: WelcomeNicknameClass;
  source: "template_set" | "single_template" | "env";
  pick?: WelcomeTemplatePick;
  setKey?: "kakaoDefaultNickname" | "customNickname";
}

interface RuntimeWelcomeConfig {
  welcome?: {
    templateSets?: {
      kakaoDefaultNickname?: unknown;
      customNickname?: unknown;
    };
    templateSetPick?: unknown;
    kakaoDefaultNicknameRegexes?: unknown;
  };
  templateByFeature?: {
    welcome?: unknown;
  };
  welcomeTemplateName?: unknown;
}

const DISALLOWED_WELCOME_TEMPLATE_NAME_RE = /^(\d+|welcome_default_.*)$/;

// NOTE: Use \u escapes to stay ASCII-safe in encoding-mixed environments.
const DEFAULT_KAKAO_FRIENDS_NAMES_KO = [
  "\uB77C\uC774\uC5B8", // 라이언
  "\uC5B4\uD53C\uCE58", // 어피치
  "\uBB34\uC9C0", // 무지
  "\uCF58", // 콘
  "\uD2DC\uBE0C", // 튜브
  "\uD504\uB85C\uB3C4", // 프로도
  "\uB124\uC624", // 네오
  "\uC81C\uC774\uC9C0", // 제이지
  "\uCD98\uC2DD\uC774", // 춘식이
  "\uC559\uBAAC\uB4DC", // 앙몬드
  "\uC8E0\uB974\uB514", // 죠르디
  "\uC2A4\uCE74\uD53C", // 스카피
  "\uCF00\uB85C", // 케로
  "\uBCA0\uB85C", // 베로
  "\uCF00\uB85C\uBCA0\uB85C", // 케로베로
  "\uCF00\uB85C&\uBCA0\uB85C", // 케로&베로
  "\uCF00\uB85C & \uBCA0\uB85C", // 케로 & 베로
  "\uBE54\uBC24", // 빔밤
  "\uCF58\uBE54\uBC24", // 콘빔밤
  "\uCF58&\uBE54\uBC24", // 콘&빔밤
  "\uCF58 & \uBE54\uBC24", // 콘 & 빔밤
  "\uD504\uB80C\uC988", // 프렌즈
] as const;

export const DEFAULT_KAKAO_DEFAULT_NICKNAME_REGEXES: RegExp[] = [
  // 1) "<word>하는 <name>"
  new RegExp(
    `^[\\p{Script=Hangul}0-9]{1,12}하는\\s+(?:${DEFAULT_KAKAO_FRIENDS_NAMES_KO.join("|")})$`,
    "u",
  ),
  // 2) "<word> <name>" (e.g. "우는 춘식이")
  new RegExp(
    `^[\\p{Script=Hangul}0-9]{1,12}\\s+(?:${DEFAULT_KAKAO_FRIENDS_NAMES_KO.join("|")})$`,
    "u",
  ),
  // 3) "<word> <word> ... <name>" (2~4 words)
  new RegExp(
    `^[\\p{Script=Hangul}0-9]{1,12}(?:\\s+[\\p{Script=Hangul}0-9]{1,12}){1,3}\\s+(?:${DEFAULT_KAKAO_FRIENDS_NAMES_KO.join("|")})$`,
    "u",
  ),
];

function normalizeStringArray(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array`);
  }
  if (value.length === 0) {
    throw new Error(`${fieldName} must have at least 1 non-empty string`);
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const v = value[i];
    if (typeof v !== "string") {
      throw new Error(`${fieldName}[${i}] must be a string`);
    }
    const s = v.trim();
    if (!s) {
      throw new Error(`${fieldName}[${i}] must be a non-empty string`);
    }
    out.push(s);
  }
  return out;
}

function filterAllowedTemplateNames(candidates: string[], fieldName: string): string[] {
  const filtered = candidates.filter((name) => !DISALLOWED_WELCOME_TEMPLATE_NAME_RE.test(String(name || "").trim()));
  if (filtered.length === 0) {
    throw new Error(`${fieldName} has no allowed template names (blocked: numeric / welcome_default_*)`);
  }
  return filtered;
}

function assertAllowedTemplateName(nameRaw: string, fieldName: string): string {
  const name = String(nameRaw || "").trim();
  if (!name) {
    throw new Error(`${fieldName} is empty`);
  }
  if (DISALLOWED_WELCOME_TEMPLATE_NAME_RE.test(name)) {
    throw new Error(`${fieldName} template '${name}' is blocked (numeric / welcome_default_*)`);
  }
  return name;
}

function normalizeTemplatePick(value: unknown): WelcomeTemplatePick {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("welcome.templateSetPick is required (recommend: 'random')");
  }
  const v = value.trim();
  if (v === "random" || v === "hash_sender_id" || v === "hash_user_name") return v;
  throw new Error("welcome.templateSetPick must be one of: random | hash_sender_id | hash_user_name");
}

function compileRegexes(value: unknown): RegExp[] {
  if (value === undefined || value === null) {
    throw new Error("welcome.kakaoDefaultNicknameRegexes is required (when welcome.templateSets is set)");
  }
  if (!Array.isArray(value)) {
    throw new Error("welcome.kakaoDefaultNicknameRegexes must be an array of regex strings");
  }
  if (value.length === 0) {
    throw new Error("welcome.kakaoDefaultNicknameRegexes must have at least 1 regex string");
  }
  const raw: string[] = [];
  for (let i = 0; i < value.length; i += 1) {
    const v = value[i];
    if (typeof v !== "string") {
      throw new Error(`welcome.kakaoDefaultNicknameRegexes[${i}] must be a string`);
    }
    const s = v.trim();
    if (!s) {
      throw new Error(`welcome.kakaoDefaultNicknameRegexes[${i}] must be a non-empty string`);
    }
    raw.push(s);
  }
  try {
    return raw.map((s) => new RegExp(s, "u"));
  } catch (e) {
    throw new Error(`invalid regex in welcome.kakaoDefaultNicknameRegexes: ${String(e)}`);
  }
}

export function isKakaoDefaultNickname(userNameRaw: string, regexes: RegExp[]): boolean {
  const userName = String(userNameRaw || "").trim();
  if (!userName) return true;
  return regexes.some((re) => re.test(userName));
}

let warnedInvalidRuntimeRegexes = false;

export function resolveKakaoDefaultNicknameRegexesFromRuntime(runtime: unknown): RegExp[] {
  // Prefer runtime.json.welcome.kakaoDefaultNicknameRegexes when it looks sane; otherwise use defaults.
  try {
    if (runtime && typeof runtime === "object") {
      const w = (runtime as any).welcome;
      const raw = w && typeof w === "object" ? (w as any).kakaoDefaultNicknameRegexes : undefined;
      if (Array.isArray(raw)) {
        const joined = raw.map((v: any) => String(v ?? "")).join("\n");
        const looksOk =
          joined.includes("\\p{Script=Hangul}") ||
          joined.includes("\\uAC00-\\uD7A3") ||
          joined.includes("가-힣");
        if (!looksOk && !warnedInvalidRuntimeRegexes) {
          warnedInvalidRuntimeRegexes = true;
          // eslint-disable-next-line no-console
          console.warn(
            "[welcome] runtime.welcome.kakaoDefaultNicknameRegexes looks invalid (encoding/mojibake?). Using defaults.",
          );
        }
        if (looksOk) {
          const compiled = compileRegexes(raw);
          if (compiled && compiled.length > 0) return compiled;
        }
      }
    }
  } catch {
    // ignore; fall back to defaults
  }
  return DEFAULT_KAKAO_DEFAULT_NICKNAME_REGEXES;
}

function fnv1a32(input: string): number {
  const buf = Buffer.from(String(input || ""), "utf8");
  let hash = 0x811c9dc5;
  for (const b of buf) {
    hash ^= b;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function pickByHash(candidates: string[], key: string): string {
  if (candidates.length === 0) {
    throw new Error("template set candidates is empty");
  }
  const idx = fnv1a32(key) % candidates.length;
  return candidates[idx]!;
}

function pickRandom(candidates: string[]): string {
  if (candidates.length === 0) {
    throw new Error("template set candidates is empty");
  }
  const idx = randomInt(0, candidates.length);
  return candidates[idx]!;
}

async function loadRuntimeConfig(): Promise<RuntimeWelcomeConfig> {
  const cfgPath = path.join(APP_ROOT, "config", "runtime.json");
  let raw: string;
  try {
    raw = await fs.readFile(cfgPath, "utf8");
  } catch (e) {
    throw new Error(`runtime.json read failed: ${cfgPath}: ${String(e)}`);
  }
  try {
    return JSON.parse(raw) as RuntimeWelcomeConfig;
  } catch (e) {
    throw new Error(`runtime.json JSON parse failed: ${cfgPath}: ${String(e)}`);
  }
}

export async function resolveWelcomeTemplateSelection(params: {
  userName: string;
  senderId?: string | null;
}): Promise<WelcomeTemplateSelection | null> {
  const cfg = await loadRuntimeConfig();

  const userName = String(params.userName || "").trim();
  const senderId = String(params.senderId || "").trim();

  const welcomeCfg = cfg.welcome;
  const sets = welcomeCfg?.templateSets;
  if (sets) {
    // In template-set mode, never "guess" defaults:
    // kakaoDefaultNicknameRegexes must be explicitly provided and valid.
    const regexes = compileRegexes(welcomeCfg?.kakaoDefaultNicknameRegexes);
    const nicknameClass: WelcomeNicknameClass = isKakaoDefaultNickname(userName, regexes)
      ? "kakao_default_nickname"
      : "custom_nickname";

    const pick = normalizeTemplatePick(welcomeCfg?.templateSetPick);

    const kakaoDefaultSet = filterAllowedTemplateNames(
      normalizeStringArray(sets.kakaoDefaultNickname, "welcome.templateSets.kakaoDefaultNickname"),
      "welcome.templateSets.kakaoDefaultNickname",
    );
    const customSet = filterAllowedTemplateNames(
      normalizeStringArray(sets.customNickname, "welcome.templateSets.customNickname"),
      "welcome.templateSets.customNickname",
    );

    const candidates = nicknameClass === "kakao_default_nickname" ? kakaoDefaultSet : customSet;
    const setKey = nicknameClass === "kakao_default_nickname" ? "kakaoDefaultNickname" : "customNickname";

    let templateName = "";
    if (pick === "random") {
      templateName = pickRandom(candidates);
    } else {
      const hashKey = pick === "hash_sender_id" ? (senderId || userName) : userName;
      if (!hashKey) {
        throw new Error("cannot pick welcome template: both senderId and userName are empty");
      }
      templateName = pickByHash(candidates, hashKey);
    }
    templateName = assertAllowedTemplateName(templateName, "welcome.templateSets pick result");
    return { templateName, nicknameClass, source: "template_set", pick, setKey };
  }

  // ---- Legacy: single welcome template selection ----
  const tbf = cfg.templateByFeature;
  if (tbf?.welcome && typeof tbf.welcome === "string" && tbf.welcome.trim()) {
    return {
      templateName: assertAllowedTemplateName(tbf.welcome.trim(), "templateByFeature.welcome"),
      nicknameClass: isKakaoDefaultNickname(userName, DEFAULT_KAKAO_DEFAULT_NICKNAME_REGEXES)
        ? "kakao_default_nickname"
        : "custom_nickname",
      source: "single_template",
    };
  }

  if (cfg.welcomeTemplateName && typeof cfg.welcomeTemplateName === "string" && cfg.welcomeTemplateName.trim()) {
    return {
      templateName: assertAllowedTemplateName(cfg.welcomeTemplateName.trim(), "welcomeTemplateName"),
      nicknameClass: isKakaoDefaultNickname(userName, DEFAULT_KAKAO_DEFAULT_NICKNAME_REGEXES)
        ? "kakao_default_nickname"
        : "custom_nickname",
      source: "single_template",
    };
  }

  if ((process.env.ALLOW_ENV_WELCOME_TEMPLATE || "").toLowerCase() === "true") {
    const envName = (process.env.WELCOME_TEMPLATE || "").trim();
    if (envName) {
      return {
        templateName: assertAllowedTemplateName(envName, "WELCOME_TEMPLATE"),
        nicknameClass: isKakaoDefaultNickname(userName, DEFAULT_KAKAO_DEFAULT_NICKNAME_REGEXES)
          ? "kakao_default_nickname"
          : "custom_nickname",
        source: "env",
      };
    }
  }

  return null;
}
