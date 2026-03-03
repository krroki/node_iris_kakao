import { NextResponse } from "next/server";

const KB_BASE = process.env.NEXT_PUBLIC_KB_URL || "http://127.0.0.1:8610";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function withTimeout(ms: number) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => clearTimeout(t) };
}

// 게시판별 포스트 통계 및 최근 글 목록
export async function GET() {
  const { signal, cancel } = withTimeout(Number(process.env.KB_HTTP_TIMEOUT ?? 10000));
  const rid = Math.random().toString(36).slice(2, 8);
  const t0 = Date.now();
  try {
    const url = `${KB_BASE}/posts/by_menu`;
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
    console.warn(`[kb-proxy:${rid}] GET ${KB_BASE}/posts/by_menu failed: ${msg}`);
    return NextResponse.json({ ok: false, code: "fetch_failed", detail: msg }, { status: 504 });
  } finally {
    cancel();
  }
}
