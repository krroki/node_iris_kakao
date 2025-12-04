export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

const ROOT = path.resolve(process.cwd(), '..');
const DEVICE_HEALTH_CACHE = path.join(ROOT, 'windows', 'device_health_cache.json');
// IRIS는 /health가 없으므로 200을 주는 /config를 헬스 체크로 사용한다.
const IRIS_HEALTH_PATH = '/config';

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
 * IRIS HTTP 응답을 확인한다. 2xx만 성공으로 간주하고, 나머지는 실패로 기록한다.
 */
export async function GET() {
  try {
    const irisUrl = process.env.IRIS_URL || 'http://127.0.0.1:5050';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(`${irisUrl}${IRIS_HEALTH_PATH}`, {
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeout);

      if (res.ok) {
        const cache = await updateDeviceCache(true, 'IRIS /config 200 OK');
        return NextResponse.json(cache);
      }

      const cache = await updateDeviceCache(false, `IRIS 응답 오류: HTTP ${res.status}`);
      return NextResponse.json(cache, { status: 503 });
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

