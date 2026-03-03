import { NextResponse } from 'next/server';

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const r = await fetch(`${BASE}/talkapi/health`, { cache: 'no-store' });
    const j = await r.json().catch(()=>({ ok:false }));
    return NextResponse.json(j, { status: r.status });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 200 });
  }
}
