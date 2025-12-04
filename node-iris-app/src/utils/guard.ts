import type { ChatContext } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

// NOTE: (ADR-0012) "ai" feature 추가 - KB 질의 기능 활성화 플래그
type FeatureName = "welcome" | "broadcast" | "schedules" | "ai";

// Announcement Route 타입 정의
export interface AnnouncementRoute {
  id: string;
  source: string;
  targets: string[];
  enabled: boolean;
  includeImages?: boolean;
  includeSenderName?: boolean;
  delayMs?: number;
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
  const cfgPath = path.join(process.cwd(), "config", "runtime.json");
  try {
    const raw = await fs.readFile(cfgPath, "utf8");
    const parsed = JSON.parse(raw) as RuntimeConfig;
    return parsed;
  } catch {
    return {};
  }
}

export async function isSafeMode(): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  if (typeof cfg.safeMode === "boolean") return cfg.safeMode;
  return (process.env.SAFE_MODE || "").toLowerCase() === "true";
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
 * SAFE_MODE일 때는 allowWhenSafeMode가 true여야 함
 */
export async function isAnnouncementAllowed(): Promise<boolean> {
  const cfg = await loadRuntimeConfig();
  const safeMode = typeof cfg.safeMode === "boolean"
    ? cfg.safeMode
    : (process.env.SAFE_MODE || "").toLowerCase() === "true";

  if (!safeMode) {
    return true; // SAFE_MODE가 아니면 항상 허용
  }

  // SAFE_MODE일 때는 allowWhenSafeMode 체크
  return cfg.announcement?.allowWhenSafeMode === true;
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
