"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import '../app/dashboard.css';

async function fetchWithTimeout(url: string, ms: number): Promise<Response> {
  const timeout = new Promise<Response>((resolve) => {
    const id = setTimeout(() => {
      clearTimeout(id);
      resolve(
        new Response(
          JSON.stringify({ ok: false, timeout: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }, ms);
  });

  const req = fetch(url, { cache: "no-store" }).catch((e: any) => {
    return new Response(
      JSON.stringify({ ok: false, error: String(e?.message || e) }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  return Promise.race([req, timeout]);
}

export default function StatusBar() {
  const [ok, setOk] = useState<boolean | null>(null);
  const [degraded, setDegraded] = useState<boolean>(false);
  const [checkedAt, setCheckedAt] = useState<number>(0);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<string>("");
  const [countdown, setCountdown] = useState<number>(0);
  const [lastEventAge, setLastEventAge] = useState<number | null>(null);
  const [bridgeInfo, setBridgeInfo] = useState<{ pid?: number, irisUrl?: string } | null>(null);
  const [talkApi, setTalkApi] = useState<{ enabled: boolean, reachable: boolean, status?: number } | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const probe = async () => {
    try {
      const r = await fetchWithTimeout(`/api/health`, 1500);
      const ok1 = r.ok;
      try { const j = await r.clone().json(); setLastEventAge(typeof j?.bot?.lastEventAgeSec === 'number' ? j.bot.lastEventAgeSec : null); setBridgeInfo({ pid: j?.bot?.pid, irisUrl: j?.bot?.irisUrl }); } catch { }
      let ok2 = false;
      if (ok1) {
        try {
          const rooms = await fetchWithTimeout(`/api/rooms`, 1500);
          if (rooms.ok) {
            // quick bulk snapshot (limit small)
            const bulk = await fetchWithTimeout(`/api/bulk?limit=5&all=1`, 1500);
            ok2 = bulk.ok;
          }
        } catch { ok2 = false; }
      }
      setOk(ok1);
      setDegraded(ok1 && !ok2);
      setCheckedAt(Date.now());
    } catch {
      setOk(false);
      setDegraded(false);
      setCheckedAt(Date.now());
    }
  };

  useEffect(() => {
    probe();
    timerRef.current && clearInterval(timerRef.current);
    timerRef.current = setInterval(probe, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // Talk-API health (10s)
  useEffect(() => {
    let stop = false;
    const fn = async () => {
      try {
        const r = await fetch(`/api/talkapi/health`, { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (!stop) setTalkApi({ enabled: !!data?.enabled, reachable: !!data?.reachable, status: data?.status });
      } catch { }
    };
    fn();
    const t = setInterval(fn, 10000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  const onRestart = async () => {
    setBusy(true); setLog(""); setCountdown(25);
    const t = setInterval(() => setCountdown((c) => (c > 0 ? c - 1 : 0)), 1000);
    try {
      const r = await fetch("/api/restart", { method: 'POST' });
      let data: any = null;
      try { data = await r.json(); } catch { data = null; }
      if (data && typeof data === 'object') {
        setLog(String(data.logs || '').slice(-4000));
        setOk(!!data.ok);
      } else {
        const txt = await r.text();
        setLog(txt.slice(-4000));
      }
    } catch (e: any) {
      setLog(String(e?.message || e || 'restart failed'));
    } finally {
      // re-probe a few times quickly
      for (let i = 0; i < 6; i++) { await new Promise(res => setTimeout(res, 800)); await probe(); if (ok) break; }
      clearInterval(t); setBusy(false); setCountdown(0);
    }
  };

  const sseBadge = useMemo(() => {
    if (ok === true && !degraded) return <span className="tag" style={{ background: "rgba(21,128,61,.25)", color: "#bbf7d0" }}>SSE OK</span>;
    if (ok === true && degraded) return <span className="tag" style={{ background: "rgba(180,83,9,.25)", color: "#fed7aa" }}>SSE DEGRADED</span>;
    if (ok === false) return <span className="tag" style={{ background: "rgba(185,28,28,.25)", color: "#fecaca" }}>SSE DOWN</span>;
    return <span className="tag" style={{ background: "rgba(37,99,235,.15)", color: "#bfdbfe" }}>SSE 체크중…</span>;
  }, [ok, degraded]);

  const bridgeBadge = useMemo(() => {
    if (lastEventAge == null) return null;
    if (lastEventAge <= 10) return <span className="tag" style={{ background: "rgba(21,128,61,.15)", color: "#bbf7d0" }}>BRIDGE OK</span>;
    if (lastEventAge <= 60) return <span className="tag" style={{ background: "rgba(180,83,9,.15)", color: "#fed7aa" }}>BRIDGE IDLE {lastEventAge}s</span>;
    return <span className="tag" style={{ background: "rgba(185,28,28,.15)", color: "#fecaca" }}>BRIDGE DOWN {lastEventAge}s</span>;
  }, [lastEventAge]);

  const talkApiBadge = useMemo(() => {
    const st = talkApi;
    if (!st || !st.enabled) return <span className="tag" style={{ background: "rgba(55,65,81,.25)", color: "#cbd5e1" }}>Talk-API 비활성</span>;
    if (st.reachable) return <span className="tag" style={{ background: "rgba(21,128,61,.25)", color: "#bbf7d0" }}>Talk-API OK</span>;
    return <span className="tag" style={{ background: "rgba(185,28,28,.25)", color: "#fecaca" }}>Talk-API DOWN</span>;
  }, [talkApi]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      {bridgeBadge}
      {sseBadge}
      {talkApiBadge}
      <button onClick={onRestart} disabled={busy} className="btn-outline" style={{ padding: '4px 10px', fontSize: 12 }}>
        {busy ? '재시작 중…' : '재시작'}
      </button>
      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
        {busy && countdown > 0 ? `남은 ${countdown}초` : (checkedAt ? `체크 ${new Date(checkedAt).toLocaleTimeString('ko-KR', { hour12: false })}` : '')}
      </span>
      {log && (
        <details style={{ marginLeft: 6, position: 'relative' }}>
          <summary style={{ cursor: 'pointer', color: 'var(--accent-primary)', fontSize: 13 }}>로그</summary>
          <div style={{
            position: 'absolute', top: '100%', right: 0, width: 500, maxHeight: 300,
            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
            borderRadius: 8, padding: 12, zIndex: 100, boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
            overflow: 'auto'
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
              <button onClick={() => { try { navigator.clipboard.writeText(log); } catch { } }} className="btn-outline" style={{ padding: '2px 8px', fontSize: 11 }}>복사</button>
              <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>최대 4000자 표시</span>
            </div>
            <pre style={{ whiteSpace: 'pre-wrap', color: 'var(--text-primary)', fontSize: 11, margin: 0 }}>{log}</pre>
          </div>
        </details>
      )}
    </div>
  );
}
