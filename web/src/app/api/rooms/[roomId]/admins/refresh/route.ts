import { NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";

export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: { roomId: string } }) {
  const roomId = String(ctx?.params?.roomId || "").trim();
  if (!roomId) {
    return NextResponse.json({ ok: false, error: "missing_roomId" }, { status: 400 });
  }

  let body: any = null;
  try {
    body = await request.json().catch(() => null);
  } catch {
    body = null;
  }

  const upstream = `${BASE}/rooms/${encodeURIComponent(roomId)}/admins/refresh`;

  try {
    const r = await fetch(upstream, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
      cache: "no-store",
    });
    const j = await r.json().catch(() => null);
    return NextResponse.json(j, { status: r.status });
  } catch (e: any) {
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

