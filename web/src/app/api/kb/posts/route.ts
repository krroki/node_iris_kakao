import { NextResponse } from "next/server";

const KB_BASE = process.env.NEXT_PUBLIC_KB_URL || "http://127.0.0.1:8610";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

export async function GET(req: Request) {
  const { signal, cancel } = withTimeout(Number(process.env.KB_HTTP_TIMEOUT ?? 6000));
  const rid = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  try {
    // ADR-0006: profile 파라미터 전달
    const { searchParams } = new URL(req.url);
    const profile = searchParams.get("profile");
    const url = profile ? `${KB_BASE}/posts?limit=50&profile=${profile}` : `${KB_BASE}/posts?limit=50`;
    const r = await fetch(url, { cache: "no-store", signal });
    const ct = r.headers.get("content-type") || "";
    const dur = Date.now() - t0;
    console.log(`[kb-proxy:${rid}] GET ${url} -> ${r.status} ${dur}ms ct=${ct}`);
    if (!ct.includes("application/json")) {
      const text = await r.text().catch(() => "<no body>");
      return NextResponse.json({ ok: false, code: "bad_content_type", status: r.status, body: text }, { status: 502 });
    }
    const j = await r.json();
    return NextResponse.json(j, { status: r.status });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "timeout" : (e?.message || String(e));
    console.warn(`[kb-proxy:${rid}] GET ${KB_BASE}/posts failed: ${msg}`);
    return NextResponse.json({ ok: false, code: "fetch_failed", detail: msg }, { status: 504 });
  } finally {
    cancel();
  }
}
