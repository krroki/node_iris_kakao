import { NextResponse } from "next/server";
import { applyKeywordFilter, tailAll, tailBulk } from "@/lib/logs";

export const dynamic = "force-dynamic";

const REALTIME_BASE =
  process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));

const parseKeywords = (raw: string | null) => {
  if (!raw) return [];
  return raw
    .toLowerCase()
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter(Boolean);
};

const buildPayloadFromLocalLogs = (url: URL) => {
  const limit = clamp(Number(url.searchParams.get("limit") || 80), 1, 500);
  const include = parseKeywords(url.searchParams.get("include"));
  const exclude = parseKeywords(url.searchParams.get("exclude"));
  const roomsParam = url.searchParams.get("rooms") || "";
  const rooms = roomsParam
    ? roomsParam
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
  const sendAll = ["1", "true", "yes", "y"].includes(
    (url.searchParams.get("all") || "").toLowerCase(),
  );

  const payload: Record<string, unknown> = { rooms: {} };

  // 로컬 로그 파일에서 tailAll/tailBulk로 읽어오는 경로 (FastAPI 장애 시 폴백)
  if (rooms.length) {
    const effLimit = limit * 2;
    const bulk = tailBulk(rooms, effLimit);
    const roomData: Record<string, ReturnType<typeof applyKeywordFilter>> =
      {};
    for (const rid of rooms) {
      roomData[rid] = applyKeywordFilter(
        bulk[rid] ?? [],
        include,
        exclude,
        effLimit,
      );
    }
    payload.rooms = roomData;
  }

  if (sendAll) {
    const effLimit = limit * 2;
    payload.all = applyKeywordFilter(
      tailAll(effLimit),
      include,
      exclude,
      effLimit,
    );
  }

  return payload;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const qs = url.search || "";

  // 1순위: FastAPI /logs/bulk를 단일 SSOT로 사용
  try {
    const upstream = await fetch(`${REALTIME_BASE}/logs/bulk${qs}`, {
      cache: "no-store",
    });
    if (upstream.ok) {
      const data = await upstream.json();
      return NextResponse.json(data, { status: upstream.status });
    }
  } catch {
    // ignore and fall through to local fallback
  }

  // 2순위: FastAPI가 죽어 있을 때만 로컬 파일 기반 폴백 (명시적)
  const payload = buildPayloadFromLocalLogs(url);
  return NextResponse.json(payload, { status: 200 });
}

