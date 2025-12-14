export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';

type StageKey = 'device' | 'bot' | 'logStore' | 'realtime' | 'kb' | 'ui';

type StageStatus = {
  key: StageKey;
  name: string;
  ok: boolean;
  detail: string;
  timestamp?: string | null;
  extra?: Record<string, unknown>;
};

type StatusResponse = {
  updatedAt: string;
  stages: Record<StageKey, StageStatus>;
};

const REALTIME_BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';

export async function GET() {
  try {
    const r = await fetch(`${REALTIME_BASE}/status`, { cache: 'no-store' });
    const data = (await r.json()) as StatusResponse;
    return NextResponse.json(data, { status: r.status });
  } catch (e: any) {
    const err = String(e?.message || e);
    const now = new Date().toISOString();
    const fallback: StatusResponse = {
      updatedAt: now,
      stages: {
        device: { key: 'device', name: 'Redroid / IRIS 단말', ok: false, detail: 'status API 연결 실패', extra: { error: err } },
        bot: { key: 'bot', name: 'Node-IRIS Bot', ok: false, detail: 'status API 연결 실패', extra: { error: err } },
        logStore: { key: 'logStore', name: 'Log Store', ok: false, detail: 'status API 연결 실패', extra: { error: err } },
        realtime: { key: 'realtime', name: 'Realtime API (FastAPI)', ok: false, detail: 'status API 연결 실패', extra: { error: err } },
        kb: { key: 'kb', name: 'KB API (FastAPI)', ok: false, detail: 'status API 연결 실패', extra: { error: err } },
        ui: { key: 'ui', name: 'Dashboard (Next.js)', ok: true, detail: 'UI는 동작 중이나 상태 API 호출에 실패했습니다.' },
      },
    };
    return NextResponse.json(fallback, { status: 503 });
  }
}
