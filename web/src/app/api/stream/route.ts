import { NextResponse } from "next/server";
import { applyKeywordFilter, tailAll, tailBulk } from "@/lib/logs";

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";

export const dynamic = "force-dynamic";

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const parseKeywords = (raw: string | null) => {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean);
};

// NOTE: (AGENTS 지침) fallback 시 명시적 경고 필요
// FastAPI SSE 프록시 실패 시 로컬 파일 모드로 전환하되, 경고 이벤트를 전송
const tryProxy = async (req: Request): Promise<{ response: Response | null; error: string | null }> => {
  try {
    const url = new URL(req.url);
    const qs = url.search || "";
    const upstream = await fetch(`${BASE}/logs/stream${qs}`, {
      headers: { accept: "text/event-stream" },
      cache: "no-store",
    });
    if (!upstream.body) throw new Error("empty upstream body");
    return {
      response: new Response(upstream.body, {
        status: upstream.status,
        headers: { "Content-Type": "text/event-stream" },
      }),
      error: null,
    };
  } catch (e: any) {
    return { response: null, error: e?.message || String(e) };
  }
};

export async function GET(req: Request) {
  const { response: proxied, error: proxyError } = await tryProxy(req);
  if (proxied) return proxied;

  const url = new URL(req.url);
  const limit = clamp(Number(url.searchParams.get("limit") || 80), 1, 500);
  const include = parseKeywords(url.searchParams.get("include"));
  const exclude = parseKeywords(url.searchParams.get("exclude"));
  const roomsParam = url.searchParams.get("rooms") || "";
  const rooms = roomsParam ? roomsParam.split(",").map((s) => s.trim()).filter(Boolean) : [];
  const sendAll = ["1", "true", "yes", "y"].includes((url.searchParams.get("all") || "").toLowerCase());
  const intervalMs = clamp(Number(url.searchParams.get("interval") || 1000), 300, 10_000);
  const sinceMs = Number(url.searchParams.get("since") || 0);

  const encoder = new TextEncoder();
  let interval: NodeJS.Timeout | undefined;
  const lastRoomTs = Object.fromEntries(rooms.map((rid) => [rid, sinceMs])) as Record<string, number>;
  let lastAllTs = sinceMs;
  const heartbeatEvery = Math.max(1, Math.round(15000 / intervalMs));
  let idleTicks = 0;

  const stream = new ReadableStream({
    start(controller) {
      const push = (payload: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
      };

      // FastAPI 프록시 실패 시 경고 이벤트 전송 (AGENTS fallback 금지 지침 준수)
      if (proxyError) {
        push({
          type: "warning",
          code: "proxy_failed",
          message: `FastAPI SSE 연결 실패 (${proxyError}). 로컬 파일 모드로 동작 중입니다.`,
          localMode: true,
        });
      }

      const snapshotPayload = () => {
        const payload: Record<string, unknown> = { type: "snapshot" };
        if (rooms.length) {
          const bulk = tailBulk(rooms, limit * 2);
          const roomData: Record<string, ReturnType<typeof applyKeywordFilter>> = {};
          for (const rid of rooms) {
            const filtered = applyKeywordFilter(bulk[rid] ?? [], include, exclude, limit);
            if (filtered.length) {
              roomData[rid] = filtered;
              lastRoomTs[rid] = Math.max(lastRoomTs[rid] || 0, ...filtered.map((entry) => Date.parse(entry.ts) || 0));
            }
          }
          payload.rooms = roomData;
        }
        if (sendAll) {
          const allEntries = applyKeywordFilter(tailAll(limit * 2), include, exclude, limit);
          if (allEntries.length) {
            payload.all = allEntries;
            lastAllTs = Math.max(lastAllTs, ...allEntries.map((entry) => Date.parse(entry.ts) || 0));
          }
        }
        return payload;
      };

      const appendPayload = () => {
        const payload: Record<string, unknown> = { type: "append" };
        let hasData = false;
        if (rooms.length) {
          const roomUpdates: Record<string, ReturnType<typeof applyKeywordFilter>> = {};
          const bulk = tailBulk(rooms, limit * 2);
          for (const rid of rooms) {
            const entries = (bulk[rid] ?? []).filter((entry) => Date.parse(entry.ts) > (lastRoomTs[rid] || 0));
            if (!entries.length) continue;
            const filtered = applyKeywordFilter(entries, include, exclude, limit);
            if (!filtered.length) continue;
            roomUpdates[rid] = filtered;
            const latest = filtered[filtered.length - 1];
            if (latest) {
              lastRoomTs[rid] = Math.max(lastRoomTs[rid], Date.parse(latest.ts) || 0);
            }
          }
          if (Object.keys(roomUpdates).length) {
            payload.rooms = roomUpdates;
            hasData = true;
          }
        }
        if (sendAll) {
          const nextEntries = tailAll(limit * 2).filter((entry) => Date.parse(entry.ts) > lastAllTs);
          if (nextEntries.length) {
            const filtered = applyKeywordFilter(nextEntries, include, exclude, limit);
            if (filtered.length) {
              payload.all = filtered;
              const latest = filtered[filtered.length - 1];
              if (latest) lastAllTs = Math.max(lastAllTs, Date.parse(latest.ts) || 0);
              hasData = true;
            }
          }
        }
        return hasData ? payload : null;
      };

      push(snapshotPayload());
      interval = setInterval(() => {
        const payload = appendPayload();
        if (payload) {
          idleTicks = 0;
          push(payload);
        } else {
          idleTicks += 1;
          if (idleTicks % heartbeatEvery === 0) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
        }
      }, intervalMs);
    },
    cancel() {
      if (interval) clearInterval(interval);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
