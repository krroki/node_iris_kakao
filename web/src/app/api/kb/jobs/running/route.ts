import { NextResponse } from "next/server";

const KB_BASE = process.env.NEXT_PUBLIC_KB_URL || "http://127.0.0.1:8610";

// 실행 중인 작업 목록 조회
export async function GET() {
  try {
    const r = await fetch(`${KB_BASE}/jobs/running`, { cache: "no-store" });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 504 });
  }
}
