export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(process.cwd(), '..');

export async function POST(req: Request) {
  const ps = 'powershell.exe';
  // Use smart_restart_bot.ps1 which auto-detects VM IP and updates portproxy
  const script = path.join(ROOT, 'windows', 'smart_restart_bot.ps1');

  // Parse optional query params
  const url = new URL(req.url);
  const force = url.searchParams.get('force') === 'true';

  try {
    const args = [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
    ];
    if (force) {
      args.push('-Force');
    }

    const { stdout, stderr } = await execFileAsync(ps, args, {
      cwd: ROOT,
      timeout: 120000, // 2 min for subnet scan
    });
    return NextResponse.json({ ok: true, stdout, stderr });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || String(error),
        stdout: error?.stdout,
        stderr: error?.stderr,
      },
      { status: 500 },
    );
  }
}

