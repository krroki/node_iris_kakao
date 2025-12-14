import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs/promises';

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';
const ROOT = path.resolve(process.cwd(), '..');
const STATUS_JSON = path.join(ROOT, 'node-iris-app', 'data', 'status.json');

export const dynamic = 'force-dynamic';

export async function GET() {
  // 1) 정상 경로: FastAPI /health 를 그대로 proxy
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    let r: Response;
    try {
      r = await fetch(`${BASE}/health`, { cache: 'no-store', signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e: any) {
    // 2) Windows 환경에서 로컬 HTTP 타임아웃/연결 실패 시: status.json 기반 fallback
    try {
      const raw = await fs.readFile(STATUS_JSON, 'utf-8');
      const s = JSON.parse(raw) || {};
      const startedAt = s.startedAt as string | undefined;
      let ageSec: number | null = null;
      if (startedAt) {
        const ts = Date.parse(startedAt);
        if (!Number.isNaN(ts)) {
          ageSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
        }
      }
      const payload = {
        ok: true,
        rooms: -1,
        bot: {
          pid: s.pid,
          lastEventTs: startedAt,
          lastEventAgeSec: ageSec,
        },
        fallback: true,
        error: String(e?.message || e),
      };
      return NextResponse.json(payload, { status: 200 });
    } catch (e2: any) {
      return NextResponse.json(
        {
          ok: false,
          error: `fetch failed and no fallback status.json: ${String(e2?.message || e2)}`,
        },
        { status: 200 },
      );
    }
  }
}
