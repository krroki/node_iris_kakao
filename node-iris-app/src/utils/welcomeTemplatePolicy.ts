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

// IRIS 기본 제공(또는 레거시) 템플릿 이름 차단 정책
// - 숫자만으로 된 이름(예: "1", "2")은 과거 기본 템플릿에서 자주 사용되어
//   운영자가 의도하지 않은 welcome 멘트가 나가는 원인이 된다.
// - welcome_default_* 역시 "기본 문구"로 오인/혼동을 유발할 수 있어 기본 차단한다.
const DISALLOWED_WELCOME_TEMPLATE_NAME_RE = /^(\d+|welcome_default_.*)$/;

const DEFAULT_KAKAO_FRIENDS_NAMES_KO = [
  "라이언",
  "어피치",
  "무지",
  "콘",
  "튜브",
  "프로도",
  "네오",
  "제이지",
  "춘식이",
  "프렌즈",
  "니니즈",
  "죠르디",
  "앙몬드",
  "스카피",
  "팬더주니어",
  "팬더 주니어",
  "팬다",
  "케로",
  "베로니",
  "케로&베로니",
  "케로 & 베로니",
  "콥",
  "빠냐",
  "콥&빠냐",
  "콥 & 빠냐",
] as const;

const DEFAULT_KAKAO_DEFAULT_NICKNAME_REGEXES: RegExp[] = [
  new RegExp(
    `^[가-힣0-9]{1,12}하는\\s+(?:${DEFAULT_KAKAO_FRIENDS_NAMES_KO.join("|")})$`,
    "u",
  ),
  new RegExp(
    `^[가-힣0-9]{1,12}\\s+(?:${DEFAULT_KAKAO_FRIENDS_NAMES_KO.join("|")})$`,
    "u",
  ),
  new RegExp(
    `^[가-힣0-9]{1,12}(?:\\s+[가-힣0-9]{1,12}){1,3}\\s+(?:${DEFAULT_KAKAO_FRIENDS_NAMES_KO.join("|")})$`,
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
    throw new Error("welcome.kakaoDefaultNicknameRegexes is required when welcome.templateSets is enabled");
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

function isKakaoDefaultNickname(userNameRaw: string, regexes: RegExp[]): boolean {
  const userName = String(userNameRaw || "").trim();
  if (!userName) return true; // 이름이 비어 있으면 "기본닉/미설정"으로 취급해 닉네임 변경 안내 세트를 적용
  return regexes.some((re) => re.test(userName));
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
      const hashKey =
        pick === "hash_sender_id"
          ? (senderId || userName)
          : userName;
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
