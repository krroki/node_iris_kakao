import { NextRequest, NextResponse } from 'next/server';

const BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || 'http://127.0.0.1:8650';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function buildUrl(path: string) {
  const trimmed = path.replace(/^\/+/, '');
  return `${BASE}/templates/${trimmed}`;
}

function forwardHeaders(req: NextRequest) {
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => {
    if (['host', 'content-length'].includes(k.toLowerCase())) return;
    headers[k] = v;
  });
  return headers;
}

async function forward(req: NextRequest, path: string) {
  const url = buildUrl(path);
  const headers = forwardHeaders(req);
  let body: BodyInit | undefined = undefined;
  if (!(req.method === 'GET' || req.method === 'HEAD')) {
    const buffer = await req.arrayBuffer();
    body = buffer.byteLength > 0 ? buffer : undefined;
  }
  const res = await fetch(url, {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
  });
  const respBody = res.body ? res.body : res.statusText;
  const respHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => {
    respHeaders[k] = v;
  });
  return new NextResponse(respBody as any, {
    status: res.status,
    headers: respHeaders,
  });
}

export async function GET(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return forward(req, (params.path || []).join('/'));
}

export async function POST(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return forward(req, (params.path || []).join('/'));
}

export async function DELETE(req: NextRequest, { params }: { params: { path?: string[] } }) {
  return forward(req, (params.path || []).join('/'));
}
