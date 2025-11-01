import type { ChatContext } from "@tsuki-chat/node-iris";
import { promises as fs } from "fs";
import path from "path";

interface RuntimeConfig {
  safeMode?: boolean;
  allowedRoomIds?: string[];
  features?: Record<string, Partial<Record<"welcome" | "broadcast" | "schedules", boolean>>>;
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
  feature: "welcome" | "broadcast" | "schedules",
): Promise<boolean> {
  const roomId = String(context.room.id);
  return isFeatureEnabledForRoomId(roomId, feature);
}

export async function isFeatureEnabledForRoomId(
  roomId: string,
  feature: "welcome" | "broadcast" | "schedules",
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
