import { NextResponse } from "next/server";

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const r = await fetch(`${BASE}/rooms`, { cache: "no-store" });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
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
