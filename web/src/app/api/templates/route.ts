import { NextResponse } from 'next/server';

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const res = await fetch(`${BASE}/templates`, { cache: 'no-store' });
  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const data = await res.json().catch(() => null);
    return NextResponse.json(data, { status: res.status });
  }

  const body = await res.text().catch(() => '');
  return new NextResponse(body, {
    status: res.status,
    headers: {
      'content-type': contentType || 'text/plain; charset=utf-8',
    },
  });
}
