export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

const ROOT = path.resolve(process.cwd(), '..');
const DEVICE_HEALTH_CACHE = path.join(ROOT, 'windows', 'device_health_cache.json');

async function updateDeviceCache(ok: boolean, detail: string, extra?: Record<string, unknown>) {
  const cache = {
    ok,
    detail,
    updatedAt: new Date().toISOString(),
    ...extra,
  };
  await fs.writeFile(DEVICE_HEALTH_CACHE, JSON.stringify(cache, null, 2), 'utf-8');
  return cache;
}

/**
 * GET /api/device/health
 * 경량 디바이스 헬스 체크 (캐시 갱신용)
 *
 * IRIS /health 엔드포인트만 호출하여 빠르게 상태 확인.
 * 전체 repair 없이 캐시를 갱신할 수 있음.
 */
export async function GET() {
  try {
    // IRIS URL 확인 (portproxy 경유 127.0.0.1:5050)
    const irisUrl = process.env.IRIS_URL || 'http://127.0.0.1:5050';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${irisUrl}/health`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);

      if (res.ok) {
        const cache = await updateDeviceCache(true, 'IRIS 단말 정상 (health check OK)');
        return NextResponse.json(cache);
      } else {
        const cache = await updateDeviceCache(false, `IRIS 응답 오류: HTTP ${res.status}`);
        return NextResponse.json(cache, { status: 503 });
      }
    } catch (fetchError: any) {
      clearTimeout(timeout);
      const detail = fetchError?.name === 'AbortError'
        ? 'IRIS 연결 타임아웃 (5초)'
        : `IRIS 연결 실패: ${fetchError?.message || fetchError}`;
      const cache = await updateDeviceCache(false, detail);
      return NextResponse.json(cache, { status: 503 });
    }
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || String(error) },
      { status: 500 },
    );
  }
}

/**
 * POST /api/device/health
 * 캐시 강제 갱신 (repair 없이)
 */
export async function POST() {
  return GET();
}
