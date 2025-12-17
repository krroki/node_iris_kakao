export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);
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
}

export async function POST(request: Request) {
  const ps = 'powershell.exe';
  const script = path.join(ROOT, 'windows', 'repair_redroid_iris.ps1');
  const body = await request.json().catch(() => ({} as any));
  const deviceRaw = typeof (body as any)?.device === 'string' ? String((body as any).device).trim() : '';

  try {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Fix',
    ] as string[];
    if (deviceRaw) {
      args.push('-Device', deviceRaw);
    }

    const { stdout, stderr } = await execFileAsync(ps, args, {
      cwd: ROOT,
      timeout: 120000,
    });

    // 캐시 갱신 (성공)
    await updateDeviceCache(true, 'VM/IRIS 단말 정상 (repair script OK)', { stdout, stderr });

    return NextResponse.json(
      {
        ok: true,
        stdout,
        stderr,
      },
      { status: 200 },
    );
  } catch (error: any) {
    const stdout = error?.stdout || '';
    const stderr = error?.stderr || '';
    const detail = `복구 실패: ${error?.message || String(error)}`;

    // 캐시 갱신 (실패)
    await updateDeviceCache(false, detail, { stdout, stderr }).catch(() => {});

    return NextResponse.json(
      {
        ok: false,
        error: error?.message || String(error),
        stdout,
        stderr,
      },
      { status: 500 },
    );
  }
}
