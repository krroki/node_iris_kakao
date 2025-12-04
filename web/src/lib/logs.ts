import fs from "fs";
import path from "path";

export interface ParsedLogEntry {
  ts: string;
  roomId: string;
  roomName?: string;
  sender?: string;
  text?: string;
  mid?: string;
}

const repoRoot = path.resolve(process.cwd(), "..");
const logsDir = path.join(repoRoot, "node-iris-app", "data", "logs");
const DAY_MS = 24 * 60 * 60 * 1000;

const toMs = (ts: string | undefined): number => {
  if (!ts) return 0;
  const v = Date.parse(ts);
  return Number.isNaN(v) ? 0 : v;
};

const isRecentEnough = (ts: string | undefined, nowMs: number): boolean => {
  const t = toMs(ts);
  if (!t) return false;
  return nowMs - t <= DAY_MS;
};

const safeReaddir = (dir: string): string[] => {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
};

const parseLine = (line: string): ParsedLogEntry | null => {
  try {
    const obj = JSON.parse(line);
    const snapshot = obj?.snapshot ?? {};
    const payload = obj?.payload ?? {};
    const roomIdRaw = snapshot?.roomId;
    const ts = typeof obj?.timestamp === "string" ? obj.timestamp : "";
    if (!roomIdRaw || !ts) return null;
    let text = typeof snapshot?.messageText === "string" ? snapshot.messageText : "";
    if (!text || text === "[object Object]") {
      if (typeof payload?.text === "string" && payload.text.trim()) {
        text = payload.text.trim();
      } else if (typeof payload?.raw === "string" && payload.raw.trim()) {
        text = payload.raw.trim();
      }
    }
    return {
      ts,
      roomId: String(roomIdRaw),
      roomName: snapshot?.roomName ?? String(roomIdRaw),
      sender: snapshot?.senderName ?? snapshot?.senderId ?? undefined,
      text,
      mid: snapshot?.messageId ? String(snapshot.messageId) : undefined,
    };
  } catch {
    return null;
  }
};

const readRoomFiles = (roomId: string): string[] => {
  const roomDir = path.join(logsDir, roomId);
  const files = safeReaddir(roomDir).filter((file) => file.endsWith(".log")).sort();
  return files.slice(-2).map((file) => path.join(roomDir, file));
};

export const tailRoom = (roomId: string, limit = 80): ParsedLogEntry[] => {
  const files = readRoomFiles(roomId);
  if (!files.length) return [];
  const nowMs = Date.now();
  const seen = new Set<string>();
  const entries: ParsedLogEntry[] = [];
  for (const file of files) {
    let data: string;
    try {
      data = fs.readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const lines = data.split(/\r?\n/).filter(Boolean);
    for (const line of lines.slice(-limit * 3)) {
      const parsed = parseLine(line);
      if (!parsed) continue;
      if (!isRecentEnough(parsed.ts, nowMs)) continue;
      if (parsed.mid) {
        if (seen.has(parsed.mid)) continue;
        seen.add(parsed.mid);
      }
      entries.push(parsed);
    }
  }
  return entries.slice(-limit);
};

export const tailBulk = (roomIds: string[], limit = 80): Record<string, ParsedLogEntry[]> => {
  const result: Record<string, ParsedLogEntry[]> = {};
  for (const rid of roomIds) {
    const key = String(rid);
    if (!key) continue;
    result[key] = tailRoom(key, limit);
  }
  return result;
};

export const tailAll = (limit = 80): ParsedLogEntry[] => {
  const dirs = safeReaddir(logsDir).filter((dir) => dir && !dir.startsWith("."));
  const combined: ParsedLogEntry[] = [];
  for (const dir of dirs) {
    combined.push(...tailRoom(dir, limit));
  }
  combined.sort((a, b) => toMs(a.ts) - toMs(b.ts));
  return combined.slice(-limit);
};

export const applyKeywordFilter = (
  entries: ParsedLogEntry[],
  include: string[],
  exclude: string[],
  limit: number,
): ParsedLogEntry[] => {
  const out: ParsedLogEntry[] = [];
  for (const entry of entries) {
    const blob = `${entry.roomName ?? ""} ${entry.sender ?? ""} ${entry.text ?? ""}`.toLowerCase();
    if (include.length && !include.some((kw) => blob.includes(kw))) {
      continue;
    }
    if (exclude.length && exclude.some((kw) => blob.includes(kw))) {
      continue;
    }
    out.push(entry);
    if (out.length >= limit) break;
  }
  return out;
};

export const listRoomsSummary = (): { roomId: string; roomName: string }[] => {
  const dirs = safeReaddir(logsDir).filter((dir) => dir && !dir.startsWith("."));
  const summary: { roomId: string; roomName: string }[] = [];
  for (const dir of dirs) {
    const last = tailRoom(dir, 1)[0];
    summary.push({
      roomId: String(dir),
      roomName: last?.roomName || String(dir),
    });
  }
  return summary;
};

export const getLogsDir = () => logsDir;
