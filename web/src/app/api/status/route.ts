export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

type StageKey = 'device' | 'bot' | 'logStore' | 'realtime' | 'ui';

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
  latestLogTs?: string | null;
};

const ROOT = path.resolve(process.cwd(), '..');
const BOT_STATUS_FILE = path.join(ROOT, 'node-iris-app', 'data', 'status.json');
const LOGS_DIR = path.join(ROOT, 'node-iris-app', 'data', 'logs');
const REALTIME_BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';
// 디바이스 상태 캐시 파일 (별도 스케줄러나 수동 복구 API에서 갱신)
const DEVICE_HEALTH_CACHE = path.join(ROOT, 'windows', 'device_health_cache.json');
// 캐시 유효 시간 (15분): 불필요한 적색 경보를 줄이기 위해 완화
// NOTE: 캐시는 /api/device/repair 또는 /api/device/health 호출 시 갱신됨.
const DEVICE_CACHE_TTL_MS = 15 * 60 * 1000;

async function readDeviceStatus(): Promise<StageStatus> {
  const stage: StageStatus = {
    key: 'device',
    name: 'Redroid / IRIS 단말',
    ok: false,
    detail: '단말 상태 확인 중...',
  };

  try {
    // 캐시 파일에서 상태 읽기 (PowerShell 직접 실행 제거)
    const raw = await fs.readFile(DEVICE_HEALTH_CACHE, 'utf-8');
    const cache = JSON.parse(raw);
    const updatedAt = cache.updatedAt ? new Date(cache.updatedAt).getTime() : 0;
    const ageMs = Date.now() - updatedAt;

    if (ageMs > DEVICE_CACHE_TTL_MS) {
      // 캐시가 오래됨: ok는 유지하고 경고만 표시 (무의미한 적색 방지)
      stage.ok = cache.ok ?? false;
      stage.detail = `단말 상태 캐시가 ${Math.round(ageMs / 60000)}분 전에 갱신됨 (주의).`;
      stage.timestamp = cache.updatedAt || null;
      stage.extra = { cached: true, stale: true, ageMs };
      return stage;
    }

    // 캐시가 유효함
    stage.ok = cache.ok ?? false;
    stage.detail = cache.detail || (stage.ok ? 'VM/IRIS 단말 정상' : '단말 상태 이상');
    stage.timestamp = cache.updatedAt || null;
    stage.extra = { cached: true, ...cache };
  } catch (error: any) {
    // 캐시 파일이 없거나 읽기 실패
    stage.ok = false;
    stage.detail = '단말 상태 캐시 없음. /api/device/repair로 수동 점검 필요.';
    stage.extra = { cached: false, error: error?.message };
  }

  return stage;
}

function describeAge(msDiff: number | null): string {
  if (msDiff == null) return '시간 정보 없음';
  const sec = Math.max(0, Math.round(msDiff / 1000));
  if (sec < 60) return `${sec}s 전`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m 전`;
  const hr = Math.floor(min / 60);
  return `${hr}h 전`;
}

async function readBotStatus(): Promise<StageStatus> {
  const stage: StageStatus = {
    key: 'bot',
    name: 'Node-IRIS Bot',
    ok: false,
    detail: '상태 파일을 아직 읽지 못했습니다.',
  };

  try {
    const raw = await fs.readFile(BOT_STATUS_FILE, 'utf-8');
    const data = JSON.parse(raw || '{}');
    const lastEventTs = typeof data.lastEventTs === 'string' ? data.lastEventTs : null;
    const heartbeatTs = typeof data.heartbeatTs === 'string' ? data.heartbeatTs : null;
    const startedAt = typeof data.startedAt === 'string' ? data.startedAt : null;

    const effectiveTs = lastEventTs || heartbeatTs;

    if (!effectiveTs) {
      stage.ok = false;
      stage.timestamp = startedAt ?? null;
      stage.detail = startedAt
        ? `최근 이벤트가 없습니다 (시작: ${new Date(startedAt).toISOString()})`
        : '최근 이벤트가 없습니다.';
      stage.extra = {
        pid: data.pid ?? null,
        lastEventText: null,
        heartbeatTs,
      };
      return stage;
    }

    const tsDate = new Date(effectiveTs);
    const ageMs = Date.now() - tsDate.getTime();
    const healthy = ageMs < 15 * 60 * 1000; // 15분 미만이면 정상
    stage.ok = healthy;
    stage.timestamp = tsDate.toISOString();
    stage.detail = healthy
      ? `최근 이벤트 ${describeAge(ageMs)} (${data.lastEventRoomId || 'room n/a'})`
      : '최근 이벤트가 너무 오래되었습니다.';
    stage.extra = {
      pid: data.pid ?? null,
      lastEventText: data.lastEventText ?? null,
      heartbeatTs,
    };
  } catch (error: any) {
    stage.ok = false;
    stage.detail = `status.json을 읽지 못했습니다: ${error?.message || error}`;
  }

  return stage;
}

async function readLogStatus(): Promise<{ stage: StageStatus; latestTs: string | null }> {
  const stage: StageStatus = {
    key: 'logStore',
    name: 'Log Store',
    ok: false,
    detail: '로그 디렉터리를 아직 확인하지 못했습니다.',
  };

  let latestTs: string | null = null;
  let latestMs = 0;

  try {
    // 1) status.json 의 lastEventTs 기준으로 최신 로그 시각 추정
    try {
      const raw = await fs.readFile(BOT_STATUS_FILE, 'utf-8');
      const data = JSON.parse(raw || '{}');
      const last = data.lastEventTs as string | undefined;
      if (typeof last === 'string' && last) {
        const ts = Date.parse(last);
        if (!Number.isNaN(ts)) {
          latestMs = ts;
          latestTs = new Date(ts).toISOString();
        }
      }
    } catch {
      // ignore
    }

    // 2) 로그 디렉터리 파일 mtime 기준 (status.json보다 최신이면 교체)
    try {
      const roomDirs = await fs.readdir(LOGS_DIR, { withFileTypes: true });
      const dirs = roomDirs.filter(d => d.isDirectory());

      const dirStats = await Promise.all(
        dirs.map(async (d) => {
          const dirPath = path.join(LOGS_DIR, d.name);
          const stat = await fs.stat(dirPath).catch(() => null);
          return { name: d.name, mtimeMs: stat?.mtimeMs ?? 0 };
        })
      );
      dirStats.sort((a, b) => b.mtimeMs - a.mtimeMs);
      const recentDirs = dirStats.slice(0, 5);

      for (const { name } of recentDirs) {
        const roomPath = path.join(LOGS_DIR, name);
        const files = await fs.readdir(roomPath).catch(() => []);
        for (const file of files) {
          if (!file.endsWith('.log')) continue;
          const filePath = path.join(roomPath, file);
          const stat = await fs.stat(filePath).catch(() => null);
          if (stat && stat.mtimeMs > latestMs) {
            latestMs = stat.mtimeMs;
            latestTs = new Date(stat.mtimeMs).toISOString();
          }
        }
      }
    } catch {
      // 디렉터리 읽기 실패 무시
    }

    if (latestMs === 0) {
      stage.ok = false;
      stage.detail = '로그 파일이 없거나, 최근 로그가 기록되지 않았습니다.';
    } else {
      const ageMs = Date.now() - latestMs;
      const staleMs = 15 * 60 * 1000; // 15분
      stage.ok = ageMs < staleMs;
      stage.timestamp = latestTs;
      stage.detail = stage.ok
        ? `최근 로그 ${describeAge(ageMs)}`
        : `로그가 ${describeAge(ageMs)} 동안 기록되지 않았습니다.`;
    }
  } catch (error: any) {
    stage.ok = false;
    stage.detail = `로그 상태를 확인하지 못했습니다: ${error?.message || error}`;
  }

  return { stage, latestTs };
}

async function readRealtimeStatus(): Promise<StageStatus> {
  const stage: StageStatus = {
    key: 'realtime',
    name: 'Realtime API (FastAPI)',
    ok: false,
    detail: '상태 확인 중...',
  };

  try {
    const res = await fetch(`${REALTIME_BASE}/health`, { cache: 'no-store' });
    if (!res.ok) {
      stage.detail = `HTTP ${res.status}`;
      return stage;
    }
    const data = await res.json();
    const lastAgeSec = data?.bot?.lastEventAgeSec;
    stage.ok = !!data?.ok;
    stage.detail = stage.ok
      ? `Rooms ${data?.rooms ?? 0} · Bot 이벤트 ${lastAgeSec ?? '?'}s 전`
      : 'FastAPI가 비정상 상태입니다.';
    stage.timestamp = data?.bot?.lastEventTs || null;
    stage.extra = data;
  } catch (error: any) {
    stage.ok = false;
    stage.detail = `연결 오류: ${error?.message || error}`;
  }

  return stage;
}

export async function GET() {
  const stages: StatusResponse['stages'] = {
    device: await readDeviceStatus(),
    bot: await readBotStatus(),
    logStore: { key: 'logStore', name: 'Log Store', ok: false, detail: '' },
    realtime: { key: 'realtime', name: 'Realtime API (FastAPI)', ok: false, detail: '' },
    ui: {
      key: 'ui',
      name: 'Dashboard (Next.js)',
      ok: true,
      detail: '현재 대시보드 UI는 정상적으로 동작 중입니다.',
    },
  };

  const logInfo = await readLogStatus();
  stages.logStore = logInfo.stage;

  stages.realtime = await readRealtimeStatus();

  const payload: StatusResponse = {
    updatedAt: new Date().toISOString(),
    stages,
    latestLogTs: logInfo.latestTs,
  };

  return NextResponse.json(payload, { headers: { 'Cache-Control': 'no-store' } });
}
