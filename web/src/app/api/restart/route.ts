import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);
const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';
export const dynamic = 'force-dynamic';

function resolveIrisUrl(repoRoot: string): string {
  let url =
    process.env.IRIS_BRIDGE_URL ||
    process.env.IRIS_URL ||
    '';
  if (!url) {
    try {
      const statusPath = path.join(repoRoot, 'node-iris-app', 'data', 'status.json');
      const raw = fs.readFileSync(statusPath, 'utf8');
      const data = JSON.parse(raw || '{}');
      if (typeof data.irisUrl === 'string' && data.irisUrl) {
        url = data.irisUrl;
      }
    } catch {}
  }
  if (!url) {
    // 마지막 수단: 기존 포트프록시(5050)를 기본값으로 사용
    url = 'http://127.0.0.1:5050';
  }
  return url;
}

export async function POST() {
  try {
    const repoRoot = path.resolve(process.cwd(), '..');
    const ps = 'powershell.exe';
    const recover = path.join(repoRoot, 'windows', 'recover_realtime.ps1');
    const startAll = path.join(repoRoot, 'windows', 'start_all.ps1');
    const logs: string[] = [];

    // Start API+Bot with recovery script, fallback to start_all
    const run = async (file: string, args: string[], label: string) => {
      try {
        const { stdout, stderr } = await execFileAsync(
          ps,
          ['-NoProfile','-ExecutionPolicy','Bypass','-File', file, ...args],
          { cwd: repoRoot, timeout: 60000 },
        );
        if (stdout) logs.push(`[${label}] ${stdout}`);
        if (stderr) logs.push(`[${label}-err] ${stderr}`);
      } catch (e: any) {
        logs.push(`[${label}-err] ${String(e?.message || e)}`);
      }
    };

    const IRIS_BRIDGE = resolveIrisUrl(repoRoot);
    await run(recover, ['-BotIrisUrl', IRIS_BRIDGE, '-ApiPort','8650','-HealthTimeoutSec','6'], 'recover');
    if (!logs.join('\n').toLowerCase().includes('ready') && fs.existsSync(startAll)) {
      await run(startAll, ['-IrisUrl', IRIS_BRIDGE, '-ApiPort','8650','-WebPort','3100'], 'start_all');
    }

    // Probe health with timeout
    let ok = false;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      try {
        const r = await fetch(`${BASE}/health`, { cache: 'no-store' });
        if (r.ok) { ok = true; break; }
      } catch {}
      await new Promise(r => setTimeout(r, 1000));
    }
    return NextResponse.json({ ok, logs: logs.join('\n') }, { status: 200 });
  } catch (e:any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e || 'restart failed') }, { status: 500 });
  }
}
