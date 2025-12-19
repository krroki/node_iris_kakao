export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd(), '..');

type BotProcess = {
  pid: number;
  kind?: string;
  cmd: string;
  startTime: string;
};

type StatusFileResult = {
  exists: boolean;
  path: string;
  data?: any;
  error?: string;
};

const EXPECTED_KINDS = ['bot', 'welcome-worker', 'ai-worker', 'broadcast-worker', 'command-worker', 'nickname-reminder-worker', 'image-worker', 'video-worker', 'auto-faq-worker'] as const;
type ExpectedKind = (typeof EXPECTED_KINDS)[number];

const STATUS_PATH_BY_KIND: Record<ExpectedKind, string> = {
  bot: path.join(ROOT, 'node-iris-app', 'data', 'status.json'),
  'welcome-worker': path.join(ROOT, 'node-iris-app', 'data', 'welcome_worker_status.json'),
  'ai-worker': path.join(ROOT, 'node-iris-app', 'data', 'ai_worker_status.json'),
  'broadcast-worker': path.join(ROOT, 'node-iris-app', 'data', 'broadcast_worker_status.json'),
  'command-worker': path.join(ROOT, 'node-iris-app', 'data', 'command_worker_status.json'),
  'nickname-reminder-worker': path.join(ROOT, 'node-iris-app', 'data', 'nickname_reminder_worker_status.json'),
  'image-worker': path.join(ROOT, 'node-iris-app', 'data', 'image_worker_status.json'),
  'video-worker': path.join(ROOT, 'node-iris-app', 'data', 'video_worker_status.json'),
  'auto-faq-worker': path.join(ROOT, 'node-iris-app', 'data', 'auto_faq_worker_status.json'),
};

const TALKAPI_STATUS_PATH = path.join(ROOT, 'node-iris-app', 'data', 'talkapi_status.json');
const TALKAPI_AUTH_APPLY_STATUS_PATH = path.join(ROOT, 'node-iris-app', 'data', 'talkapi_auth_apply_status.json');

const toRepoRelativePath = (p: string) => {
  try {
    return path.relative(ROOT, p).split(path.sep).join('/');
  } catch {
    return p;
  }
};

async function readJsonFile(p: string): Promise<StatusFileResult> {
  const rel = toRepoRelativePath(p);
  try {
    const raw = await fs.promises.readFile(p, 'utf8');
    const obj = JSON.parse(raw || '{}');
    return { exists: true, path: rel, data: obj };
  } catch (e: any) {
    if (e && String(e.code || '') === 'ENOENT') return { exists: false, path: rel };
    return { exists: false, path: rel, error: String(e?.message || e) };
  }
}

function parseTsMs(ts: unknown): number | null {
  if (!ts || typeof ts !== 'string') return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function computeAgeSec(ts: unknown, nowMs: number): number | null {
  const ms = parseTsMs(ts);
  if (ms === null) return null;
  const diff = Math.max(0, nowMs - ms);
  return Math.floor(diff / 1000);
}

// GET: List all running bot processes
export async function GET() {
  const script = path.join(ROOT, 'windows', 'list_bots.ps1');
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
    ], { timeout: 10000 });

    const processes = JSON.parse(stdout.trim() || '[]') as BotProcess[];
    const nowMs = Date.now();

    const byKind = (Array.isArray(processes) ? processes : []).reduce<Record<string, BotProcess[]>>((acc, p) => {
      const kind = String((p as any)?.kind || 'bot').trim() || 'bot';
      if (!acc[kind]) acc[kind] = [];
      acc[kind].push(p);
      return acc;
    }, {});

    const statusFilesEntries = await Promise.all(
      EXPECTED_KINDS.map(async (kind) => [kind, await readJsonFile(STATUS_PATH_BY_KIND[kind])] as const)
    );
    const statusFiles = Object.fromEntries(statusFilesEntries) as Record<ExpectedKind, StatusFileResult>;
    const talkApiStatusFile = await readJsonFile(TALKAPI_STATUS_PATH);
    const talkApiAuthApplyStatusFile = await readJsonFile(TALKAPI_AUTH_APPLY_STATUS_PATH);

    const kinds = EXPECTED_KINDS.map((kind) => {
      const running = [...(byKind[kind] || [])].sort((a, b) => {
        return Date.parse(b.startTime || '') - Date.parse(a.startTime || '');
      });

      const newest = running[0] || null;
      const dupPids = running.slice(1).map((p) => p.pid);

      const status = statusFiles[kind];
      const heartbeatAgeSec = computeAgeSec(status?.data?.heartbeatTs, nowMs);
      const staleHeartbeat = typeof heartbeatAgeSec === 'number' ? heartbeatAgeSec >= 180 : null;

      const statusPid = typeof status?.data?.pid === 'number' ? status.data.pid : null;
      const statusPidRunning = statusPid ? running.some((p) => p.pid === statusPid) : null;

      return {
        kind,
        expected: true,
        runningCount: running.length,
        newestPid: newest?.pid ?? null,
        newestStartTime: newest?.startTime ?? null,
        duplicatePids: dupPids,
        statusFile: status,
        heartbeatAgeSec,
        staleHeartbeat,
        statusPid,
        statusPidRunning,
      };
    });

    const summary = {
      expectedKinds: EXPECTED_KINDS.length,
      totalRunning: Array.isArray(processes) ? processes.length : 0,
      missingKinds: kinds.filter((k) => k.runningCount === 0).map((k) => k.kind),
      duplicateKinds: kinds.filter((k) => k.runningCount > 1).map((k) => k.kind),
      staleHeartbeatKinds: kinds.filter((k) => k.staleHeartbeat === true).map((k) => k.kind),
      generatedAt: new Date(nowMs).toISOString(),
    };

    return NextResponse.json({
      ok: true,
      processes,
      count: Array.isArray(processes) ? processes.length : 0,
      expectedKinds: EXPECTED_KINDS,
      kinds,
      summary,
      talkApiStatusFile,
      talkApiAuthApplyStatusFile,
    });
  } catch (error: any) {
    return NextResponse.json({
      ok: false,
      error: error?.message || String(error),
      processes: [],
      count: 0
    }, { status: 500 });
  }
}

// DELETE: Kill a specific bot process by PID
// NOTE: (ADR-0011) node-iris-app 외 프로세스는 종료되지 않음 (안전장치)
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const pid = url.searchParams.get('pid');

  if (!pid || !/^\d+$/.test(pid)) {
    return NextResponse.json({ ok: false, error: 'Invalid PID' }, { status: 400 });
  }

  // 직접 Stop-Process 호출 금지! stop_bot.ps1 스크립트 경유
  // 스크립트가 node-iris-app 패턴인지 검증 후에만 종료함
  const script = path.join(ROOT, 'windows', 'stop_bot.ps1');

  try {
    const { stdout, stderr } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-TargetPid',  // NOTE: $Pid는 PowerShell 내장 변수와 충돌하므로 $TargetPid 사용
      pid,
    ], { timeout: 10000 });

    return NextResponse.json({
      ok: true,
      killed: parseInt(pid),
      stdout: stdout.trim(),
    });
  } catch (error: any) {
    const stderr = error?.stderr?.toString() || '';
    // exit code 2 = not a node-iris-app process
    const isNotBotProcess = stderr.includes('not a node-iris-app process');

    return NextResponse.json({
      ok: false,
      error: isNotBotProcess
        ? `PID ${pid}는 node-iris-app 프로세스가 아닙니다. 안전을 위해 종료하지 않습니다.`
        : (error?.message || String(error)),
      code: isNotBotProcess ? 'not_bot_process' : 'kill_failed',
    }, { status: isNotBotProcess ? 400 : 500 });
  }
}
