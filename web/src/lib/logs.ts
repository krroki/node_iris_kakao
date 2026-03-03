import fs from "fs";
import path from "path";

export interface ParsedLogEntry {
  ts: string;
  roomId: string;
  roomName?: string;
  sender?: string;
  text?: string;
  mid?: string;
  uid?: string;
}

const repoRoot = path.resolve(process.cwd(), "..");
const logsDir = path.join(repoRoot, "node-iris-app", "data", "logs");
const DAY_MS = 24 * 60 * 60 * 1000;
// 서버 log_utils.py와 동일: sender+text 기반 중복 제거 윈도우
const DEDUP_WINDOW_MS = 2000;

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

    // Skip message_debug records (서버 log_utils.py와 동일)
    const ptype = String(payload?.type ?? "");
    if (ptype === "message_debug") return null;

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

    const roomId = String(roomIdRaw);
    const mid = snapshot?.messageId ? String(snapshot.messageId) : undefined;
    const senderId = snapshot?.senderId ? String(snapshot.senderId) : undefined;
    const senderName = snapshot?.senderName ?? senderId ?? undefined;
    const normText = (text || "").replace(/\s+/g, " ").trim();

    // uid 생성 (서버 log_utils.py와 동일)
    let uid: string | undefined;
    const rawJsonId = payload?.rawJson?.id;
    if (rawJsonId != null) {
      uid = `m:${rawJsonId}`;
    } else if (mid) {
      uid = `m:${mid}`;
    } else {
      // Fallback: text-based fingerprint (room+sender+text)
      uid = `t:${roomId}|${senderId || senderName || ""}|${normText}`;
    }

    return {
      ts,
      roomId,
      roomName: snapshot?.roomName ?? roomId,
      sender: senderName,
      text,
      mid,
      uid,
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
  const seenMid = new Set<string>();
  // 서버 log_utils.py와 동일: sender+text 기반 중복 제거
  const lastTimeKey = new Map<string, number>();
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

      // mid 기반 dedup
      if (parsed.mid) {
        if (seenMid.has(parsed.mid)) continue;
        seenMid.add(parsed.mid);
        entries.push(parsed);
        continue;
      }

      // sender+text 기반 dedup (서버 log_utils.py와 동일)
      const sender = parsed.sender || "";
      const text = parsed.text || "";
      const key = `${sender}|${text}`;
      const tms = toMs(parsed.ts);
      const lt = lastTimeKey.get(key);
      if (lt !== undefined && Math.abs(tms - lt) <= DEDUP_WINDOW_MS) {
        continue;
      }
      lastTimeKey.set(key, tms);
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
  // 시간순 정렬 (최신이 마지막)
  combined.sort((a, b) => toMs(a.ts) - toMs(b.ts));

  // 서버 log_utils.py와 동일: 전역 dedup 적용
  const seenMid = new Set<string>();
  const lastTimeKey = new Map<string, number>();
  const out: ParsedLogEntry[] = [];
  for (const r of combined) {
    if (r.mid) {
      if (seenMid.has(r.mid)) continue;
      seenMid.add(r.mid);
      out.push(r);
      continue;
    }
    const sender = r.sender || "";
    const text = r.text || "";
    const key = `${sender}|${text}`;
    const tms = toMs(r.ts);
    const lt = lastTimeKey.get(key);
    if (lt !== undefined && Math.abs(tms - lt) <= DEDUP_WINDOW_MS) {
      continue;
    }
    lastTimeKey.set(key, tms);
    out.push(r);
  }
  return out.slice(-limit);
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
