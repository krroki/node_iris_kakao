"use client";
/**
 * KB 프로필별 대시보드 컴포넌트 (ADR-0006)
 *
 * props.profile: 'main' | 'free' | 'paid'
 * - main: 통합 KB (기존 /kb)
 * - free: 무료강의 KB (/kb/free)
 * - paid: 유료강의 KB (/kb/paid)
 */

import { useCallback, useEffect, useState } from "react";
import '../app/dashboard.css';

type ProfileName = 'main' | 'free' | 'paid';

interface KbDashboardProps {
  profile: ProfileName;
}

const PROFILE_LABELS: Record<ProfileName, string> = {
  main: '통합 KB',
  free: '무료강의 KB',
  paid: '유료강의 KB',
};

const API = {
  stats: "/api/kb/stats",
  run: "/api/kb/run",
  posts: "/api/kb/posts",
  manuals: "/api/kb/manuals",
  backfillStatus: "/api/kb/backfill/status",
  servicesHealth: "/api/services/health",
  servicesStart: "/api/services/start",
};

type BackfillStatus = {
  needs_backfill: boolean;
  gap_days: number | null;
  oldest_cursor_at: string | null;  // 가장 오래된 cursor 시점
  newest_cursor_at: string | null;  // 가장 최근 cursor 시점
  menus_without_cursor: number[];
};

type ServiceStatus = {
  name: string;
  ok: boolean;
  detail?: string;
  latency?: number;
};

type ServicesHealth = {
  ok: boolean;
  services: {
    kb: ServiceStatus;
    postgres: ServiceStatus;
    fastapi: ServiceStatus;
  };
};

function useFetchx() {
  return useCallback(async (url: string, init?: RequestInit & { timeoutMs?: number }) => {
    const c = new AbortController();
    const { timeoutMs = 6000, ...rest } = init || {};
    const t = setTimeout(() => c.abort(), timeoutMs);
    try {
      const r = await fetch(url, { cache: "no-store", ...rest, signal: c.signal });
      const ct = r.headers.get("content-type") || "";
      const body = ct.includes("application/json") ? await r.json() : await r.text();
      return { ok: r.ok, status: r.status, body } as const;
    } catch (e: any) {
      const msg = e?.name === "AbortError" ? "timeout" : (e?.message || String(e));
      return { ok: false, status: 0, body: { ok: false, code: "fetch_failed", detail: msg } } as const;
    } finally { clearTimeout(t); }
  }, []);
}

export default function KbDashboard({ profile }: KbDashboardProps) {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [posts, setPosts] = useState<any[]>([]);
  const [manuals, setManuals] = useState<any[]>([]);
  const [backfillStatus, setBackfillStatus] = useState<BackfillStatus | null>(null);
  const [servicesHealth, setServicesHealth] = useState<ServicesHealth | null>(null);
  const [startingService, setStartingService] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  const fetchx = useFetchx();

  const refresh = useCallback(async () => {
    const profileParam = `?profile=${profile}`;
    const [rs, ps, ms, bf] = await Promise.all([
      fetchx(`${API.stats}${profileParam}`, { timeoutMs: 8000 }),
      fetchx(`${API.posts}${profileParam}`, { timeoutMs: 8000 }),
      fetchx(`${API.manuals}${profileParam}`, { timeoutMs: 8000 }),
      fetchx(`${API.backfillStatus}${profileParam}`, { timeoutMs: 8000 }),
    ]);
    if (rs.ok) setStats(rs.body);
    if (ps.ok) setPosts(ps.body?.posts || []);
    if (ms.ok) setManuals(ms.body?.manuals || []);
    if (bf.ok) setBackfillStatus(bf.body);
  }, [fetchx, profile]);

  const checkServicesHealth = useCallback(async () => {
    try {
      const r = await fetch(API.servicesHealth, { cache: "no-store" });
      const j = await r.json();
      setServicesHealth(j);
    } catch {
      setServicesHealth(null);
    }
  }, []);

  const startService = async (service: string) => {
    setStartingService(service);
    setMsg("");
    try {
      const r = await fetch(API.servicesStart, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ service }),
      });
      const j = await r.json();
      if (j.ok) {
        setMsg(`${service} 시작 요청됨. 잠시 후 새로고침...`);
        setTimeout(async () => {
          await checkServicesHealth();
          await refresh();
          setStartingService(null);
        }, 3000);
      } else {
        setMsg(`${service} 시작 실패: ${j.error}`);
        setStartingService(null);
      }
    } catch (e: any) {
      setMsg(`${service} 시작 오류: ${e?.message || e}`);
      setStartingService(null);
    }
  };

  useEffect(() => {
    checkServicesHealth();
    refresh();
  }, [refresh, checkServicesHealth]);

  const runBackfill = async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetchx(API.run, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "backfill", profile }),
        timeoutMs: 60000,
      });
      setMsg(`backfill -> ${typeof r.body === 'string' ? r.body : JSON.stringify(r.body)}`);
      setTimeout(refresh, 2000);
    } finally {
      setLoading(false);
    }
  };

  const runCollect = async () => {
    setLoading(true);
    setMsg("");
    try {
      const r = await fetchx(API.run, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "collect", profile }),
        timeoutMs: 30000,
      });
      setMsg(`collect -> ${typeof r.body === 'string' ? r.body : JSON.stringify(r.body)}`);
      setTimeout(refresh, 2000);
    } finally {
      setLoading(false);
    }
  };

  const counts = stats?.profile_counts || stats?.counts || {};

  return (
    <div className="dashboard-container">
      <div className="header-section">
        <div>
          <h1 className="main-title">{PROFILE_LABELS[profile]}</h1>
          <p className="sub-title">
            {profile === 'main' && '통합 지식베이스'}
            {profile === 'free' && '무료강의 게시판 전용 지식베이스'}
            {profile === 'paid' && '유료강의 게시판 전용 지식베이스'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button disabled={loading} onClick={() => { checkServicesHealth(); refresh(); }} className="btn-outline">새로고침</button>
        </div>
      </div>

      {/* 서비스 상태 패널 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">서비스 상태</div>
          <button onClick={checkServicesHealth} className="btn-outline" style={{ padding: '4px 12px', fontSize: 12 }}>체크</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          {(['postgres', 'kb', 'fastapi'] as const).map(svc => {
            const s = servicesHealth?.services?.[svc];
            const isOk = s?.ok ?? false;
            const isStarting = startingService === svc;
            return (
              <div key={svc} style={{
                padding: 16,
                borderRadius: 12,
                background: isOk ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                border: `1px solid ${isOk ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{
                    width: 10, height: 10, borderRadius: '50%',
                    background: isOk ? '#22c55e' : '#ef4444',
                    boxShadow: isOk ? '0 0 8px #22c55e' : '0 0 8px #ef4444',
                  }} />
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)', textTransform: 'uppercase' }}>
                    {svc === 'postgres' ? 'PostgreSQL' : svc === 'kb' ? 'KB API' : 'FastAPI'}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {s ? (isOk ? `${s.latency}ms` : (s.detail || 'offline')) : '확인 중...'}
                </div>
                {!isOk && (
                  <button
                    disabled={isStarting || loading}
                    onClick={() => startService(svc)}
                    className="btn-copy"
                    style={{ padding: '6px 12px', fontSize: 12, width: '100%' }}
                  >
                    {isStarting ? '시작 중...' : '시작'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* 백필 상태 (ADR-0006) */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">백필 상태</div>
        </div>
        {backfillStatus ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 14 }}>
              <span style={{ color: 'var(--text-secondary)' }}>최근 수집: </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {backfillStatus.newest_cursor_at ? fmt(backfillStatus.newest_cursor_at) : '없음'}
              </span>
            </div>
            <div style={{ fontSize: 14 }}>
              <span style={{ color: 'var(--text-secondary)' }}>최악 갭: </span>
              <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                {backfillStatus.oldest_cursor_at ? fmt(backfillStatus.oldest_cursor_at) : '없음'}
              </span>
            </div>
            {backfillStatus.gap_days !== null && (
              <div style={{ fontSize: 14 }}>
                <span style={{ color: 'var(--text-secondary)' }}>공백: </span>
                <span style={{
                  color: backfillStatus.gap_days >= 1 ? 'var(--error)' : 'var(--success)',
                  fontWeight: 600
                }}>
                  {backfillStatus.gap_days}일
                </span>
              </div>
            )}
            {backfillStatus.needs_backfill && (
              <span style={{
                padding: '4px 12px',
                background: 'rgba(239,68,68,0.2)',
                border: '1px solid rgba(239,68,68,0.4)',
                borderRadius: 20,
                fontSize: 12,
                color: '#fca5a5',
              }}>
                백필 필요
              </span>
            )}
            <button
              disabled={loading}
              onClick={runBackfill}
              className="btn-copy"
              style={{ marginLeft: 'auto' }}
            >
              {loading ? '실행 중...' : '백필 실행'}
            </button>
          </div>
        ) : (
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            백필 상태 로딩 중...
          </div>
        )}
      </div>

      {msg && (
        <div style={{ marginBottom: 24, padding: 12, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, color: '#93c5fd', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {msg}
        </div>
      )}

      {/* 작업 실행 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">작업 실행</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button disabled={loading} onClick={runCollect} className="btn-copy">
            수집 실행
          </button>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>(전체 KB 기준)</span>
          <button disabled={loading} onClick={runBackfill} className="btn-outline">백필 실행</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          * 수집은 현재 전체 KB 기준으로 동작합니다. 프로필별 수집은 추후 지원 예정.
        </div>
      </div>

      {/* 통계 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
        <Metric label="포스트" value={counts.posts || 0} />
        <Metric label="매뉴얼" value={counts.manuals || 0} />
      </div>

      {/* 최근 포스트 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">최근 포스트</div>
        </div>
        <div style={{ maxHeight: 300, overflow: 'auto', fontSize: 13 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card-hover)' }}>
                <Th>ID</Th><Th>메뉴</Th><Th>제목</Th><Th>작성일</Th>
              </tr>
            </thead>
            <tbody>
              {posts.map(p => (
                <tr key={p.post_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <Td>{p.post_id}</Td>
                  <Td>{p.menu_id}</Td>
                  <Td>
                    {p.url ? <a href={p.url} target="_blank" rel="noreferrer" className="nav-link">{p.title || '(제목없음)'}</a> : (p.title || '(제목없음)')}
                  </Td>
                  <Td>{p.created_at ? fmt(p.created_at) : '-'}</Td>
                </tr>
              ))}
              {!posts.length && <tr><Td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12 }}>
                {stats?.warning === 'table_not_exists' ? '테이블이 없습니다. 마이그레이션을 실행하세요.' : '표시할 포스트 없음'}
              </Td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 최근 매뉴얼 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">최근 매뉴얼</div>
        </div>
        <div style={{ maxHeight: 220, overflow: 'auto', fontSize: 13 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-card-hover)' }}>
                <Th>ID</Th><Th>제목</Th><Th>상태</Th><Th>업데이트</Th>
              </tr>
            </thead>
            <tbody>
              {manuals.map(m => (
                <tr key={m.doc_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <Td>{m.doc_id}</Td>
                  <Td>{m.title || '(제목없음)'}</Td>
                  <Td>{m.status}</Td>
                  <Td>{m.updated_at ? fmt(m.updated_at) : '-'}</Td>
                </tr>
              ))}
              {!manuals.length && <tr><Td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 12 }}>표시할 매뉴얼 없음</Td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* 네비게이션 */}
      <div className="pipeline-card">
        <div className="pipeline-header">
          <div className="pipeline-title">다른 프로필</div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {profile !== 'main' && <a href="/kb" className="btn-outline">통합 KB</a>}
          {profile !== 'free' && <a href="/kb/free" className="btn-outline">무료강의 KB</a>}
          {profile !== 'paid' && <a href="/kb/paid" className="btn-outline">유료강의 KB</a>}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string, value: any }) {
  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: 16, padding: 20 }}>
      <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th style={{ textAlign: 'left', padding: '12px 16px', color: 'var(--text-secondary)', fontSize: 13, fontWeight: 600 }}>{children}</th>;
}

function Td({ children, colSpan, style }: { children: React.ReactNode; colSpan?: number; style?: React.CSSProperties }) {
  return <td colSpan={colSpan} style={{ padding: '12px 16px', fontSize: 13, color: 'var(--text-primary)', ...(style || {}) }}>{children}</td>;
}

function fmt(s: string) {
  try {
    const d = new Date(s);
    return d.toLocaleString('ko-KR', { hour12: false });
  } catch {
    return s;
  }
}
