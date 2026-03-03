"use client";
/**
 * KB 통합 대시보드 (ADR-0006)
 *
 * 게시판별로 수집된 글 목록을 박스로 표시
 * - 무료강의 게시판 그룹
 * - 유료강의 게시판 그룹
 * - 기타 게시판
 */

import { useCallback, useEffect, useState } from "react";
import '../dashboard.css';

const API = {
  stats: "/api/kb/stats",
  run: "/api/kb/run",
  run_cookie: "/api/kb/run_cookie",
  login: "/api/kb/login",
  creds: "/api/kb/creds",
  schedule: "/api/kb/schedule",
  postsByMenu: "/api/kb/posts/by_menu",
  manuals: "/api/kb/manuals",
  menus: "/api/kb/menus",  // SSOT 메뉴 정보 (ADR-0008)
  servicesHealth: "/api/services/health",
  servicesStart: "/api/services/start",
  jobsRunning: "/api/kb/jobs/running",
};

type RunningJob = {
  job_id: number;
  job_type: string;
  status: string;
  started_at: string;
  elapsed_seconds: number;
  payload: any;
};

type RecentJob = {
  job_id: number;
  job_type: string;
  status: string;
  finished_at: string;
  result: any;
};

// SSOT 메뉴 정보 타입 (ADR-0008)
type MenuGroup = {
  label: string;
  menuIds: number[];
};

type MenuGroups = Record<string, MenuGroup>;
type MenuNames = Record<number, string>;

// Fallback: SSOT 로드 실패 시 사용 (config/menus_dinohighclass.json 기준)
const DEFAULT_MENU_GROUPS: MenuGroups = {
  free: { label: "무료 특강", menuIds: [23, 32] },
  paid: { label: "정규 강의", menuIds: [42] },
  tips: { label: "꿀팁 게시판", menuIds: [48, 136, 51] },
  community: { label: "커뮤니티", menuIds: [33, 206, 62, 245] },
};

const DEFAULT_MENU_NAMES: MenuNames = {
  23: "📖 무료 특강 신청",
  32: "무료 특강 후기",
  42: "정규 강의 신청",
  48: "💡 주차별 하이라이트",
  136: "디하클 회원의 꿀팁!",
  51: "카페 운영자의 꿀팁!",
  33: "자유 게시판",
  206: "개인 수익 인증 게시판",
  62: "디하클 성장 일기",
  245: "수강생 인터뷰",
  165: "질문 게시판",
  1: "📡 회원 대상 전체 공지",
  11: "✅ 출석 체크하기",
};

type MenuData = {
  count: number;
  oldest_at: string | null;
  newest_at: string | null;
  posts: Array<{
    post_id: number;
    menu_id: number;
    title: string;
    url: string;
    created_at: string | null;
  }>;
};

type MenusData = Record<string, MenuData>;

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

export default function KBPage() {
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const [schedule, setScheduleState] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");
  const [nid, setNid] = useState("");
  const [npw, setNpw] = useState("");
  const [save, setSave] = useState(true);
  const [hasSaved, setHasSaved] = useState<any>(null);
  const [menusData, setMenusData] = useState<MenusData>({});
  const [manuals, setManuals] = useState<any[]>([]);
  const [servicesHealth, setServicesHealth] = useState<ServicesHealth | null>(null);
  const [startingService, setStartingService] = useState<string | null>(null);
  const [expandedMenus, setExpandedMenus] = useState<Set<string>>(new Set());
  const [runningJobs, setRunningJobs] = useState<RunningJob[]>([]);
  const [recentJobs, setRecentJobs] = useState<RecentJob[]>([]);
  const [jobPolling, setJobPolling] = useState(false);

  // SSOT 메뉴 정보 (ADR-0008)
  const [menuGroups, setMenuGroups] = useState<MenuGroups>(DEFAULT_MENU_GROUPS);
  const [menuNames, setMenuNames] = useState<MenuNames>(DEFAULT_MENU_NAMES);
  const [ssotLoaded, setSsotLoaded] = useState(false);

  const fetchx = useFetchx();

  const refresh = useCallback(async () => {
    const [rs, sch, pm, ms] = await Promise.all([
      fetchx(API.stats, { timeoutMs: 8000 }),
      fetchx(API.schedule, { timeoutMs: 8000 }),
      fetchx(API.postsByMenu, { timeoutMs: 10000 }),
      fetchx(API.manuals, { timeoutMs: 8000 }),
    ]);
    if (rs.ok) setStats(rs.body); else setMsg(`stats failed: ${JSON.stringify(rs.body)}`);
    if (sch.ok) setScheduleState(sch.body);
    if (pm.ok) setMenusData(pm.body?.menus || {});
    if (ms.ok) setManuals(ms.body?.manuals || []);
  }, [fetchx]);

  const checkServicesHealth = useCallback(async () => {
    try {
      const r = await fetch(API.servicesHealth, { cache: "no-store" });
      const j = await r.json();
      setServicesHealth(j);
    } catch {
      setServicesHealth(null);
    }
  }, []);

  // 실행 중인 작업 폴링
  const pollRunningJobs = useCallback(async () => {
    try {
      const r = await fetch(API.jobsRunning, { cache: "no-store" });
      const j = await r.json();
      if (j.ok) {
        setRunningJobs(j.running || []);
        setRecentJobs(j.recent_done || []);
        return (j.running?.length || 0) > 0;
      }
    } catch {
      // ignore
    }
    return false;
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

  // SSOT 메뉴 정보 로드 (ADR-0008)
  const loadMenus = useCallback(async () => {
    try {
      const r = await fetch(API.menus, { cache: "no-store" });
      const j = await r.json();
      if (j.ok && j.groups && j.names) {
        // groups를 MenuGroups 형태로 변환
        const groups: MenuGroups = {};
        for (const [key, val] of Object.entries(j.groups)) {
          const g = val as { label: string; menuIds: number[] };
          groups[key] = { label: g.label, menuIds: g.menuIds };
        }
        setMenuGroups(groups);

        // names를 MenuNames 형태로 변환 (string key -> number key)
        const names: MenuNames = {};
        for (const [key, val] of Object.entries(j.names)) {
          names[Number(key)] = val as string;
        }
        setMenuNames(names);
        setSsotLoaded(true);
        console.log("[SSOT] 메뉴 정보 로드 완료", { groups: Object.keys(groups).length, names: Object.keys(names).length });
      }
    } catch (e) {
      console.warn("[SSOT] 메뉴 정보 로드 실패, fallback 사용", e);
    }
  }, []);

  useEffect(() => {
    checkServicesHealth();
    refresh();
    loadMenus();  // SSOT 메뉴 로드
    (async () => {
      // 초기 로드 시에도 실행 중인 잡이 있으면 폴링을 켠다.
      try {
        const hasRunning = await pollRunningJobs();
        if (hasRunning) {
          setJobPolling(true);
        }
      } catch {
        // ignore
      }
      try {
        const r = await fetch(API.creds, { cache: "no-store" });
        const j = await r.json();
        setHasSaved(j);
      } catch {
        // ignore
      }
    })();
  }, [refresh, checkServicesHealth, pollRunningJobs, loadMenus]);

  // 작업 실행 중일 때 2초마다 폴링
  useEffect(() => {
    if (!jobPolling) return;
    const interval = setInterval(async () => {
      const hasRunning = await pollRunningJobs();
      if (!hasRunning) {
        setJobPolling(false);
        refresh(); // 작업 완료 시 데이터 새로고침
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [jobPolling, pollRunningJobs, refresh]);

  const run = async (task: "collect" | "embed" | "manual" | "backfill", extra: any = {}) => {
    setLoading(true); setMsg("");
    try {
      const r = await fetchx(API.run, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ task, ...extra }), timeoutMs: 8000 });
      setMsg(`${task} 작업 시작됨`);
      // 폴링 시작
      setJobPolling(true);
      await pollRunningJobs();
    } finally { setLoading(false); }
  };

  const doLogin = async () => {
    setLoading(true); setMsg("");
    try {
      // 새 자격증명 입력했으면 저장
      if (save && nid && npw) {
        const s = await fetchx(API.creds, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: nid, pw: npw }) });
        if (!s.ok) { setMsg(`save creds failed: ${JSON.stringify(s.body)}`); return; }
      }
      // 로그인 시도: 입력값 있으면 사용, 없으면 서버 저장값 사용
      const useInputCreds = nid && npw;
      const canLogin = useInputCreds || hasSaved?.saved;

      if (canLogin) {
        const loginBody = useInputCreds
          ? { id: nid, pw: npw, headless: false }
          : { headless: false };  // 서버 저장 자격증명 사용
        const r = await fetchx(API.login, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(loginBody), timeoutMs: 180000 });
        // 성공: HTTP 200 + body.ok === true
        if (r.ok && (r.body as any)?.ok === true) {
          setMsg(`✅ 로그인 성공! 쿠키가 갱신되었습니다.`);
          alert('✅ 로그인 성공! 쿠키가 갱신되었습니다.');
        } else {
          const detail = (r.body as any)?.detail || (r.body as any)?.code || r.status;
          const rc = await fetchx(API.run_cookie, { method: "POST", timeoutMs: 8000 });
          setMsg(`login failed (${detail}), fallback cookie: ${JSON.stringify(rc.body)}`);
          alert(`⚠️ 로그인 실패 (${detail}) - 쿠키 캡처로 대체 시도함`);
        }
      } else {
        const rc = await fetchx(API.run_cookie, { method: "POST", timeoutMs: 8000 });
        setMsg(`cookie: ${JSON.stringify(rc.body)}`);
      }
      setTimeout(refresh, 1200);
    } finally { setLoading(false); }
  };

  const toggleMenu = (menuId: string) => {
    setExpandedMenus(prev => {
      const next = new Set(prev);
      if (next.has(menuId)) next.delete(menuId);
      else next.add(menuId);
      return next;
    });
  };

  const counts = stats?.counts || {};

  // 쿠키 만료 경고 (7일 기준)
  const cookieUpdatedAt = stats?.cookies?.updated_at;
  const cookieAgeDays = cookieUpdatedAt
    ? Math.floor((Date.now() - new Date(cookieUpdatedAt).getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const cookieExpired = cookieAgeDays !== null && cookieAgeDays >= 7;
  const cookieBadge = stats?.cookies?.present
    ? cookieExpired
      ? `⚠️ 쿠키 만료됨 (${cookieAgeDays}일 전) - 재로그인 필요!`
      : `쿠키 등록됨 · ${cookieUpdatedAt?.replace('T', ' ').slice(0, 19)} (${cookieAgeDays}일 전)`
    : '쿠키 없음';

  // 게시판 그룹 분류 (SSOT 기반, ADR-0008)
  const freeMenuIds = menuGroups.free?.menuIds || [];
  const paidMenuIds = menuGroups.paid?.menuIds || [];
  const tipsMenuIds = menuGroups.tips?.menuIds || [];
  const communityMenuIds = menuGroups.community?.menuIds || [];
  const knownMenuIds = [...freeMenuIds, ...paidMenuIds, ...tipsMenuIds, ...communityMenuIds];
  const allMenuIds = Object.keys(menusData).map(Number);
  const otherMenuIds = allMenuIds.filter(id => !knownMenuIds.includes(id));

  async function setSchedule(task: 'collect' | 'embed' | 'manual' | 'backfill', minutes: number) {
    setLoading(true); setMsg("");
    try {
      const r = await fetch(API.schedule, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task, interval_minutes: minutes }) });
      const j = await r.json().catch(() => ({}));
      setMsg(`${task} 스케줄 ${minutes === 0 ? '중지' : `${minutes}분`} -> ${JSON.stringify(j)}`);
    } catch (e: any) {
      setMsg(`스케줄 설정 실패: ${e?.message || e}`);
    } finally { setLoading(false); refresh(); }
  }

  // 공백 일수 계산 (newest_at 기준)
  const calcGapDays = (newestAt: string | null): number => {
    if (!newestAt) return -1;
    try {
      const newest = new Date(newestAt);
      const now = new Date();
      const diffMs = now.getTime() - newest.getTime();
      return Math.floor(diffMs / (1000 * 60 * 60 * 24));
    } catch {
      return -1;
    }
  };

  const renderMenuBox = (menuId: number) => {
    const data = menusData[String(menuId)];
    const menuName = menuNames[menuId] || `게시판 #${menuId}`;
    const isExpanded = expandedMenus.has(String(menuId));

    if (!data) {
      return (
        <div key={menuId} className="pipeline-card" style={{ marginBottom: 12, opacity: 0.5 }}>
          <div className="pipeline-header">
            <div className="pipeline-title" style={{ fontSize: 14 }}>{menuName}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>수집된 글 없음</span>
              <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                백필 필요
              </span>
            </div>
          </div>
        </div>
      );
    }

    const gapDays = calcGapDays(data.newest_at);
    const needsBackfill = gapDays >= 1;

    return (
      <div key={menuId} className="pipeline-card" style={{ marginBottom: 12, borderLeft: needsBackfill ? '3px solid #f59e0b' : undefined }}>
        <div
          className="pipeline-header"
          style={{ cursor: 'pointer' }}
          onClick={() => toggleMenu(String(menuId))}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{isExpanded ? '▼' : '▶'}</span>
            <div className="pipeline-title" style={{ fontSize: 14 }}>{menuName}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{data.count}개</span>
            {data.newest_at && (
              <span style={{ color: 'var(--text-muted)' }}>
                최근: {fmt(data.newest_at)}
              </span>
            )}
            {gapDays >= 0 && (
              <span style={{
                padding: '2px 6px',
                borderRadius: 4,
                fontSize: 11,
                background: gapDays === 0 ? 'rgba(34,197,94,0.2)' : gapDays <= 2 ? 'rgba(251,191,36,0.2)' : 'rgba(239,68,68,0.2)',
                color: gapDays === 0 ? '#22c55e' : gapDays <= 2 ? '#f59e0b' : '#ef4444'
              }}>
                {gapDays === 0 ? '오늘' : `${gapDays}일 전`}
              </span>
            )}
            {needsBackfill && (
              <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 4, background: 'rgba(239,68,68,0.2)', color: '#ef4444' }}>
                백필 필요
              </span>
            )}
          </div>
        </div>

        {isExpanded && data.posts.length > 0 && (
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border-color)', paddingTop: 12 }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500 }}>ID</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500 }}>제목</th>
                  <th style={{ textAlign: 'left', padding: '8px 12px', color: 'var(--text-muted)', fontWeight: 500 }}>작성일</th>
                </tr>
              </thead>
              <tbody>
                {data.posts.map(p => (
                  <tr key={p.post_id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '8px 12px', color: 'var(--text-secondary)' }}>{p.post_id}</td>
                    <td style={{ padding: '8px 12px' }}>
                      {p.url ? (
                        <a href={p.url} target="_blank" rel="noreferrer" className="nav-link" style={{ color: 'var(--accent-primary)' }}>
                          {p.title || '(제목없음)'}
                        </a>
                      ) : (p.title || '(제목없음)')}
                    </td>
                    <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{p.created_at ? fmt(p.created_at) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
              최근 5개만 표시 (전체 {data.count}개)
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderMenuGroup = (label: string, menuIds: number[], bgColor: string) => {
    const totalCount = menuIds.reduce((sum, id) => sum + (menusData[String(id)]?.count || 0), 0);
    const menusWithData = menuIds.filter(id => menusData[String(id)]);

    // 그룹 내 백필 필요한 게시판 수
    const menusNeedingBackfill = menuIds.filter(id => {
      const data = menusData[String(id)];
      if (!data) return true; // 데이터 없으면 백필 필요
      const gapDays = calcGapDays(data.newest_at);
      return gapDays >= 1;
    });

    return (
      <div style={{ marginBottom: 24 }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          marginBottom: 12,
          padding: '12px 16px',
          background: bgColor,
          borderRadius: 8,
        }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{label}</h2>
          <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            {menusWithData.length}/{menuIds.length} 게시판 · 총 {totalCount}개 글
          </span>
          {menusNeedingBackfill.length > 0 && (
            <span style={{
              fontSize: 11,
              padding: '3px 8px',
              borderRadius: 4,
              background: 'rgba(239,68,68,0.2)',
              color: '#ef4444',
              fontWeight: 600
            }}>
              {menusNeedingBackfill.length}개 백필 필요
            </span>
          )}
        </div>
        {menuIds.map(renderMenuBox)}
      </div>
    );
  };

  return (
    <div className="dashboard-container">
      <div className="header-section">
        <div>
          <h1 className="main-title">카페 지식베이스</h1>
          <p className="sub-title">게시판별 수집 현황을 한눈에 확인하세요</p>
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

      {msg && (
        <div style={{ marginBottom: 24, padding: 12, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: 8, color: '#93c5fd', whiteSpace: 'pre-wrap', fontSize: 13 }}>
          {msg}
        </div>
      )}

      {/* 전체 통계 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 16, marginBottom: 24 }}>
        <Metric label="전체 포스트" value={counts.posts || 0} />
        <Metric label="전체 매뉴얼" value={counts.manuals || 0} />
        <Metric label="임베드(포스트)" value={counts.emb_posts || 0} />
        <Metric label="임베드(매뉴얼)" value={counts.emb_manuals || 0} />
      </div>

      {/* 작업 실행 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">작업 실행</div>
          <div style={{ fontSize: 12, color: cookieExpired ? '#f59e0b' : stats?.cookies?.present ? 'var(--success)' : 'var(--error)', fontWeight: cookieExpired ? 'bold' : 'normal' }}>{cookieBadge}</div>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <button disabled={loading} onClick={() => run('collect')} className="btn-copy">수집 실행</button>
          <button disabled={loading} onClick={() => run('collect', { pages: 1 })} className="btn-outline">빠른 수집(1p)</button>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>|</span>
          <button
            disabled={loading}
            onClick={() => run('backfill', { pages: 3 })}
            className="btn-outline"
            style={{ borderColor: '#f59e0b', color: '#f59e0b' }}
          >
            백필 실행(최근 페이지만)
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>|</span>
          <button disabled={loading} onClick={() => run('embed')} className="btn-outline">임베드</button>
          <button disabled={loading} onClick={() => run('manual')} className="btn-outline">매뉴얼화</button>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
          수집: 최신 글 가져오기 · 백필: 공백 기간 글 채우기 (최대 30일)
        </div>
      </div>

      {/* 실행 중인 작업 */}
      {(runningJobs.length > 0 || recentJobs.length > 0) && (
        <div className="pipeline-card" style={{
          marginBottom: 24,
          border: runningJobs.length > 0 ? '2px solid #3b82f6' : '1px solid var(--border-color)',
          background: runningJobs.length > 0 ? 'rgba(59,130,246,0.05)' : undefined,
        }}>
          <div className="pipeline-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {runningJobs.length > 0 && (
                <span className="spinner" style={{ width: 16, height: 16, border: '2px solid #3b82f6', borderTop: '2px solid transparent', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
              )}
              <div className="pipeline-title">
                {runningJobs.length > 0 ? '작업 진행 중' : '최근 완료된 작업'}
              </div>
            </div>
            {jobPolling && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>2초마다 갱신</span>
            )}
          </div>

          {/* 실행 중인 작업 목록 (최근 3개만 표시) */}
          {runningJobs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              {runningJobs.slice(0, 3).map(job => (
                <div key={job.job_id} style={{
                  padding: 16,
                  borderRadius: 8,
                  background: 'rgba(59,130,246,0.1)',
                  marginBottom: 8,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: '#3b82f6',
                        color: 'white',
                        fontSize: 12,
                        fontWeight: 600,
                      }}>
                        {job.job_type === 'backfill' ? '백필' : job.job_type === 'collect' ? '수집' : job.job_type}
                      </span>
                      <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 }}>
                        #{job.job_id}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        fontSize: 14,
                        fontWeight: 700,
                        color: '#3b82f6',
                        fontFamily: 'monospace',
                      }}>
                        {Math.floor(job.elapsed_seconds / 60)}:{String(Math.floor(job.elapsed_seconds % 60)).padStart(2, '0')}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>경과</span>
                    </div>
                  </div>
                  {job.payload && Object.keys(job.payload).length > 0 && (
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>
                      {job.payload.profile && <span>프로필: {job.payload.profile}</span>}
                      {job.payload.menu_ids && <span> · 게시판: {job.payload.menu_ids.length}개</span>}
                    </div>
                  )}
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                    시작: {fmt(job.started_at)}
                  </div>
                </div>
              ))}
              {runningJobs.length > 3 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  +{runningJobs.length - 3}개 작업 더 실행 중...
                </div>
              )}
            </div>
          )}

          {/* 최근 완료된 작업 목록 */}
          {recentJobs.length > 0 && (
            <div style={{ marginTop: runningJobs.length > 0 ? 16 : 0 }}>
              {runningJobs.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>최근 완료</div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {recentJobs.slice(0, 3).map(job => (
                  <div key={job.job_id} style={{
                    padding: 12,
                    borderRadius: 8,
                    background: job.status === 'done' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{
                        width: 8, height: 8, borderRadius: '50%',
                        background: job.status === 'done' ? '#22c55e' : '#ef4444',
                      }} />
                      <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                        {job.job_type === 'backfill' ? '백필' : job.job_type === 'collect' ? '수집' : job.job_type}
                        {' '}#{job.job_id}
                      </span>
                      {job.result && (
                        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {job.result.new_count !== undefined && `+${job.result.new_count}개`}
                          {job.result.error && `오류: ${job.result.error}`}
                        </span>
                      )}
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(job.finished_at)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <style jsx>{`
        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
      `}</style>

      {/* 게시판별 수집 현황 (디하클 카페) */}
      <div className="section-title" style={{ marginBottom: 16 }}>
        게시판별 수집 현황
        {ssotLoaded && <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>(SSOT)</span>}
      </div>

      {/* 무료 특강 */}
      {freeMenuIds.length > 0 && renderMenuGroup(menuGroups.free?.label || "무료 특강", freeMenuIds, 'rgba(34, 197, 94, 0.1)')}

      {/* 정규 강의 */}
      {paidMenuIds.length > 0 && renderMenuGroup(menuGroups.paid?.label || "정규 강의", paidMenuIds, 'rgba(59, 130, 246, 0.1)')}

      {/* 꿀팁 게시판 */}
      {tipsMenuIds.length > 0 && renderMenuGroup(menuGroups.tips?.label || "꿀팁 게시판", tipsMenuIds, 'rgba(251, 191, 36, 0.1)')}

      {/* 커뮤니티 */}
      {communityMenuIds.length > 0 && renderMenuGroup(menuGroups.community?.label || "커뮤니티", communityMenuIds, 'rgba(168, 85, 247, 0.1)')}

      {/* 기타 게시판 */}
      {otherMenuIds.length > 0 && renderMenuGroup("기타 게시판", otherMenuIds, 'rgba(156, 163, 175, 0.1)')}

      {/* 스케줄 설정 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <div className="pipeline-header">
          <div className="pipeline-title">스케줄 설정</div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 12, alignItems: 'center' }}>
          {(['collect', 'embed', 'manual', 'backfill'] as const).map(t => (
            <div key={t} style={{ display: 'contents' }}>
              <div style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{t}</div>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                interval: {schedule?.schedule?.[t]?.interval_minutes ?? 0}m, next: {schedule?.schedule?.[t]?.next ? fmt(schedule?.schedule?.[t]?.next) : '-'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={loading} onClick={() => setSchedule(t, 0)} className="btn-outline" style={{ color: 'var(--error)', borderColor: 'var(--error)' }}>중지</button>
                <button disabled={loading} onClick={() => setSchedule(t, 5)} className="btn-outline">5분</button>
                <button disabled={loading} onClick={() => setSchedule(t, 30)} className="btn-outline">30분</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 자동 로그인 / 쿠키 캡처 */}
      <div className="pipeline-card">
        <div className="pipeline-header">
          <div className="pipeline-title">자동 로그인 / 쿠키 캡처</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            <input value={nid} onChange={e => setNid(e.target.value)} placeholder="아이디" className="filter-input" style={{ width: 200 }} />
            <input value={npw} onChange={e => setNpw(e.target.value)} placeholder="비밀번호" type="password" className="filter-input" style={{ width: 200 }} />
            <button disabled={loading || (!hasSaved?.saved && (!nid || !npw))} onClick={doLogin} className="btn-copy">로그인/쿠키 캡처</button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <label style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
              <input type='checkbox' checked={save} onChange={e => setSave(e.target.checked)} style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }} />
              서버에 자격 저장
            </label>
            {hasSaved?.saved && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>저장됨: {hasSaved.id_masked}</span>}
          </div>
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

function fmt(s: string) {
  try {
    const d = new Date(s);
    return d.toLocaleString('ko-KR', { hour12: false });
  } catch {
    return s;
  }
}
