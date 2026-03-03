import { NextResponse } from "next/server";

interface ServiceHealth {
  name: string;
  url: string;
  ok: boolean;
  status?: number;
  detail?: string;
  latency?: number;
}

async function checkService(name: string, url: string, timeoutMs = 3000): Promise<ServiceHealth> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeoutMs);
    const r = await fetch(url, { cache: "no-store", signal: controller.signal });
    clearTimeout(t);
    return {
      name,
      url,
      ok: r.ok,
      status: r.status,
      latency: Date.now() - start,
    };
  } catch (e: any) {
    return {
      name,
      url,
      ok: false,
      detail: e?.name === "AbortError" ? "timeout" : (e?.message || String(e)),
      latency: Date.now() - start,
    };
  }
}

export async function GET() {
  const [kb, postgres, fastapi] = await Promise.all([
    checkService("kb", "http://127.0.0.1:8610/health"),
    checkService("postgres", "http://127.0.0.1:8610/stats", 5000), // stats는 DB 연결 필요
    checkService("fastapi", "http://127.0.0.1:8650/health"),
  ]);

  // postgres는 stats 응답으로 DB 연결 여부 판단
  const postgresOk = postgres.ok && postgres.status === 200;

  return NextResponse.json({
    ok: kb.ok && postgresOk && fastapi.ok,
    services: {
      kb: kb,
      postgres: { ...postgres, ok: postgresOk, name: "postgres" },
      fastapi: fastapi,
    },
    ts: new Date().toISOString(),
  });
}
