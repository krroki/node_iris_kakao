import { requireSession } from "@/lib/session";

function parseAdmins() {
  return String(process.env.COURSEOPS_ADMIN_NAMES || "")
    .split(/[,\n\r]+/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function isAdminName(name: string) {
  const admins = parseAdmins();
  if (admins.length === 0) return false;
  return admins.includes(String(name || "").trim());
}

export async function requireAdminSession() {
  const session = await requireSession();
  if (!isAdminName(session.name)) {
    throw new Error("forbidden");
  }
  return session;
}

