export const runtime = 'nodejs';

import { NextResponse } from 'next/server';
import path from 'path';
import { promises as fs } from 'fs';

const ROOT = path.resolve(process.cwd(), '..');
const AUTH_FILE = path.join(ROOT, 'data', 'talkapi_auth.txt');
const REALTIME_BASE = (process.env.NEXT_PUBLIC_REALTIME_BASE || process.env.REALTIME_API_BASE || 'http://127.0.0.1:8650').replace(/\/+$/, '');

function redact(s: string): string {
  const v = String(s || '').trim();
  if (!v) return '';
  if (v.length <= 8) return '***';
  return `${v.slice(0, 4)}…${v.slice(-4)}`;
}

function redactAuthHeader(authHeader: string): { authorization: string; duuid: string } {
  const raw = String(authHeader || '').trim();
  const parts = raw.split('-', 2);
  const authorization = parts[0] || '';
  const duuid = parts.length > 1 ? parts[1] : '';
  return { authorization: redact(authorization), duuid: redact(duuid) };
}

export async function POST() {
  try {
    const raw = await fs.readFile(AUTH_FILE, 'utf8');
    const line = raw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find((s) => !!s) || '';

    if (!line) {
      return NextResponse.json(
        { ok: false, error: `authHeader 파일이 비어 있습니다: ${AUTH_FILE}` },
        { status: 400 },
      );
    }

    const r = await fetch(`${REALTIME_BASE}/runtime`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ talkApi: { enabled: true, authHeader: line } }),
      cache: 'no-store',
    });

    let detail: any = null;
    try {
      detail = await r.json();
    } catch {}

    if (!r.ok) {
      return NextResponse.json(
        { ok: false, error: `Realtime /runtime 반영 실패 (status=${r.status})`, detail },
        { status: r.status },
      );
    }

    return NextResponse.json({
      ok: true,
      applied: true,
      auth: redactAuthHeader(line),
      note: 'data/talkapi_auth.txt에서 읽어 Realtime runtime.talkApi.authHeader에 반영했습니다. (값은 레드랙트)',
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}

