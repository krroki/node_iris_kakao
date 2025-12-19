import { NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";

export const dynamic = "force-dynamic";

type RoomInfo = import("../../../types").RoomInfo;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function numOrUndef(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizeRoomEntry(v: any): RoomInfo | null {
  if (!v || typeof v !== "object") return null;
  const roomId = safeString(v.roomId ?? v.id ?? v.chat_id ?? v.chatId ?? "");
  if (!roomId) return null;
  const roomName = safeString(v.roomName ?? v.name ?? v.title ?? roomId);
  const activeMembersCount = numOrUndef(v.activeMembersCount ?? v.active_members_count ?? v.memberCount ?? v.count);
  const out: RoomInfo = { roomId, roomName };
  if (activeMembersCount !== undefined) out.activeMembersCount = activeMembersCount;
  return out;
}

function normalizeRoomsResponse(j: any): RoomInfo[] | null {
  // preferred: array
  if (Array.isArray(j)) return j.map(normalizeRoomEntry).filter(Boolean) as RoomInfo[];
  // legacy/proxy formats
  const candidates = Array.isArray(j?.rooms) ? j.rooms : Array.isArray(j?.value) ? j.value : null;
  if (!candidates) return null;
  return candidates.map(normalizeRoomEntry).filter(Boolean) as RoomInfo[];
}

export async function GET() {
  try {
    const r = await fetch(`${BASE}/rooms`, { cache: "no-store" });
    const j = await r.json();
    // pass-through errors (caller checks r.ok)
    if (!r.ok) return NextResponse.json(j, { status: r.status });

    const rooms = normalizeRoomsResponse(j);
    if (!rooms) {
      return NextResponse.json(
        { ok: false, error: "rooms_bad_shape", detail: "rooms 응답 형식이 올바르지 않습니다(배열 또는 value/rooms가 아님)" },
        { status: 502 },
      );
    }

    return NextResponse.json(rooms, { status: 200 });
  } catch (e: any) {
    // FastAPI Realtime API가 내려가 있으면, 오래된 파일 기반 데이터 대신
    // 명시적인 에러 상태를 반환한다.
    return NextResponse.json(
      {
        ok: false,
        error: "realtime_unavailable",
        detail: String(e?.message || e),
      },
      { status: 503 },
    );
  }
}
