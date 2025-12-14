import { NextResponse } from 'next/server';

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const r = await fetch(`${BASE}/runtime`, { cache: 'no-store' });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 502 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const r = await fetch(`${BASE}/runtime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
