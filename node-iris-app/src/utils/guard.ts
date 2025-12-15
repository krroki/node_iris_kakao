import type { ChatContext } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";
import { APP_ROOT } from "./paths";

// NOTE: (ADR-0012) "ai" feature 추가 - KB 질의 기능 활성화 플래그
// chatSummary: 채팅 요약(!채팅요약) 기능 토글
type FeatureName = "welcome" | "broadcast" | "schedules" | "ai" | "chatSummary";

// Announcement Route 타입 정의
export interface AnnouncementRoute {
  id: string;
  source: string;
  targets: string[];
  enabled: boolean;
  includeImages?: boolean;
  includeSenderName?: boolean;
  delayMs?: number;
  // 동일 문구를 다수 방에 발송할 때, 끝에 타겟별 번호를 붙여(예: "공지 1", "공지 2") 스팸/중복 판정 리스크를 낮춘다.
  appendTargetIndex?: boolean;
  // appendTargetIndex=true일 때 시작 번호(기본 1)
  targetIndexStart?: number;
}

interface AnnouncementConfig {
  allowWhenSafeMode?: boolean;
  routes?: AnnouncementRoute[];
}

interface RuntimeConfig {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  excludedRoomIds?: string[];
  features?: Record<string, Partial<Record<FeatureName, boolean>>>;
  announcement?: AnnouncementConfig;
}

async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const cfgPath = path.join(APP_ROOT, "config", "runtime.json");
  try {
    const raw = await fs.readFile(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as RuntimeConfig;
    return parsed;
  } catch {
    return {};
  }
}

function resolveSafeMode(cfg: RuntimeConfig): boolean {
  // SAFE_MODE 기본값은 true(발신 차단)이며, 명시적으로 false일 때만 발신을 허용한다.
  if (cfg.safeMode === true) return true;
  if (cfg.safeMode === false) return false;
  const env = String(process.env.SAFE_MODE || "").trim().toLowerCase();
  if (env === "false") return false;
  if (env === "true") return true;
  return true;
}

export async function isSafeMode(): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  return resolveSafeMode(cfg);
}

export async function isRoomAllowed(context: ChatContext): Promise<boolean> {
  const roomId = String(context.room.id);
  const cfg = await loadRuntimeConfig();
  const list = Array.isArray(cfg.allowedRoomIds) ? cfg.allowedRoomIds : null;
  const raw = process.env.ALLOWED_ROOM_IDS || "";
  const allow = (list ?? raw.split(",").map((s) => s.trim())).filter(Boolean);
  if (allow.length === 0) return false;
  return allow.includes(roomId);
}

export async function isRoomIdAllowed(roomId: string): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  const list = Array.isArray(cfg.allowedRoomIds) ? cfg.allowedRoomIds : [];
  return list.includes(String(roomId));
}

export async function isFeatureEnabledForContext(
  context: ChatContext,
  feature: FeatureName,
): Promise<boolean> {
  const roomId = String(context.room.id);
  return isFeatureEnabledForRoomId(roomId, feature);
}

export async function isFeatureEnabledForRoomId(
  roomId: string,
  feature: FeatureName,
): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  const features = cfg.features || {};
  const flags = features[String(roomId)] || {};
  const flag = flags[feature];
  // 기본값: false (명시적으로 켠 방만 허용)
  const enabled = flag === true;
  // 추가 안전장치: 허용 방 목록에도 포함되어야 함
  const allowed = Array.isArray(cfg.allowedRoomIds)
    ? cfg.allowedRoomIds.includes(String(roomId))
    : false;
  return enabled && allowed;
}

// ===== Announcement 관련 함수들 =====

/**
 * Announcement 기능이 허용되는지 확인
 * SAFE_MODE=true이면 어떤 경우에도 false(발신 차단)
 */
export async function isAnnouncementAllowed(): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  const safeMode = resolveSafeMode(cfg);

  // SAFE_MODE에서는 어떤 경우에도 발신하지 않는다(운영 가드레일).
  return safeMode === false;
}

/**
 * 특정 방이 announcement에 참여 가능한지 확인
 * (allowedRoomIds에 포함 && excludedRoomIds에 미포함)
 */
export async function isRoomIdAllowedForAnnouncement(roomId: string): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  const rid = String(roomId);

  // allowedRoomIds에 포함되어야 함
  const allowedList = Array.isArray(cfg.allowedRoomIds) ? cfg.allowedRoomIds : [];
  if (!allowedList.includes(rid)) {
    return false;
  }

  // excludedRoomIds에 포함되면 제외
  const excludedList = Array.isArray(cfg.excludedRoomIds) ? cfg.excludedRoomIds : [];
  if (excludedList.includes(rid)) {
    return false;
  }

  return true;
}

/**
 * 특정 소스 방에 해당하는 활성화된 announcement route들 찾기
 */
export async function findAnnouncementRoutesBySource(sourceRoomId: string): Promise<AnnouncementRoute[]> {
  const cfg = await loadRuntimeConfig();
  const routes = cfg.announcement?.routes || [];
  const sid = String(sourceRoomId);

  return routes.filter((r) => r.enabled && r.source === sid);
}
