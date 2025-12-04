export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd(), '..');

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

    const processes = JSON.parse(stdout.trim() || '[]');
    return NextResponse.json({
      ok: true,
      processes,
      count: Array.isArray(processes) ? processes.length : 0
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
      '-Pid',
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
