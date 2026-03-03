import { NextResponse } from "next/server";

const KB_BASE = process.env.NEXT_PUBLIC_KB_URL || "http://127.0.0.1:8610";

function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

export async function POST() {
  const { signal, cancel } = withTimeout(Number(process.env.KB_HTTP_TIMEOUT ?? 6000));
  const rid = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  try {
    const url = `${KB_BASE}/run_cookie`;
    const r = await fetch(url, { method: 'POST', signal });
    const dur = Date.now() - t0;
    console.log(`[kb-proxy:${rid}] POST ${url} -> ${r.status} ${dur}ms`);
    const j = await r.json().catch(()=>({ ok:false, code:"bad_json" }));
    return NextResponse.json(j, { status: r.status });
  } catch (e:any) {
    const msg = e?.name === 'AbortError' ? 'timeout' : (e?.message || String(e));
    console.warn(`[kb-proxy:${rid}] POST ${KB_BASE}/run_cookie failed: ${msg}`);
    return NextResponse.json({ ok:false, code:"fetch_failed", detail: msg }, { status: 504 });
  } finally { cancel(); }
}
