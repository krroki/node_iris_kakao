import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

function parseAdmins() {
  const fromEnv = String(process.env.COURSEOPS_ADMIN_NAMES || "")
    .split(/[,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  // 운영 초기 부트스트랩(환경 변수 누락으로 관리자 잠금 방지)
  return fromEnv.length > 0 ? fromEnv : ["glemfkcl"];
}

function parseSyncAllowlist() {
  return String(process.env.COURSEOPS_SYNC_ALLOWLIST || "")
    .split(/[,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function isAdminName(name: string) {
  const admins = parseAdmins();
  if (admins.length === 0) return false;
  return admins.includes(String(name || "").trim());
}

export function canSyncName(name: string) {
  const allow = parseSyncAllowlist();
  if (allow.length === 0) return true;
  return allow.includes(String(name || "").trim());
}

export async function canSyncNameResolved(name: string) {
  const allow = parseSyncAllowlist();
  const n = String(name || "").trim();
  if (!n) return false;

  if (allow.length > 0) return allow.includes(n);
  if (isAdminName(n)) return true;

  const store = await coursesStore();
  const hasUsers = await store.hasAnyUsers();
  if (!hasUsers) return true;

  const u = await store.getUser(n);
  if (!u) return false;
  if (!u.enabled) return false;
  return Boolean(u.canSync);
}

export async function requireAdminSession() {
  const session = await requireSession();
  if (!isAdminName(session.name)) {
    throw new Error("forbidden");
  }
  return session;
}

export async function requireSyncSession() {
  const session = await requireSession();
  const ok = await canSyncNameResolved(session.name);
  if (!ok) {
    throw new Error("forbidden");
  }
  return session;
}
