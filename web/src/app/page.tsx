"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import './dashboard.css';
import { LogEntry, SSEPayload, PipelineStatus, RoomInfo, RoomFeatures } from "../types";
import PipelineMonitor from "../components/PipelineMonitor";
import RoomCard from "../components/RoomCard";
import LogViewer from "../components/LogViewer";
import BotProcessManager from "../components/BotProcessManager";

const REALTIME_BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";
const SSE_ENABLED = process.env.NEXT_PUBLIC_ENABLE_SSE === "1";

function dedupLogs(list: LogEntry[], max: number): LogEntry[] {
  const sorted = [...list].sort((a, b) => {
    const ta = Date.parse(a.ts || "");
    const tb = Date.parse(b.ts || "");
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return -1;
    if (Number.isNaN(tb)) return 1;
    return ta - tb;
  });

  const out: LogEntry[] = [];
  const seen = new Set<string>();
  for (const e of sorted) {
    const uid = (e as any).uid ? String((e as any).uid) : "";
    const primary = e.mid ? `m:${String(e.mid)}` : uid || null;
    const normText = (e.text || "").replace(/\s+/g, " ").trim();
    const fallback = `t:${e.roomId}|${e.sender}|${normText}`;
    const key = primary || fallback;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  if (out.length > max) {
    return out.slice(-max);
  }
  return out;
}

export default function Home() {
  const [status, setStatus] = useState<"connecting" | "sse" | "poll" | "error">("connecting");
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomLogs, setRoomLogs] = useState<Record<string, LogEntry[]>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState<boolean>(false);
  const [features, setFeatures] = useState<Record<string, RoomFeatures>>({});
  const [savingRooms, setSavingRooms] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [include, setInclude] = useState<string>("");
  const [exclude, setExclude] = useState<string>("");
  const [limit, setLimit] = useState<number>(80);

  const esRef = useRef<EventSource | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const pollBusyRef = useRef<boolean>(false);

  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [botRestarting, setBotRestarting] = useState<boolean>(false);
  const [botRestartMessage, setBotRestartMessage] = useState<string | null>(null);
  const [deviceRepairing, setDeviceRepairing] = useState<boolean>(false);
  const [deviceRepairMessage, setDeviceRepairMessage] = useState<string | null>(null);
  const [watchdog, setWatchdog] = useState<{ ok: boolean; mtime?: string; lines: string[] }>({ ok: false, lines: [] });

  const diagCommand = `cd C:\\dev\\12.kakao && powershell -ExecutionPolicy Bypass -File .\\scripts\\diagnose_realtime.ps1`;

  const handleBotRestart = async () => {
    const confirmRestart = window.confirm("Node-IRIS 봇을 다시 시작할까요? (메시지 발신은 하지 않습니다)");
    if (!confirmRestart) return;
    setBotRestarting(true);
    setBotRestartMessage(null);
    try {
      const res = await fetch(`/api/bot/restart`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setBotRestartMessage("봇 재기동 명령을 보냈습니다. 5~10초 후 상태가 갱신됩니다.");
    } catch (error: any) {
      setBotRestartMessage(`실패: ${error?.message || error}`);
    } finally {
      setBotRestarting(false);
      fetchPipelineStatus();
    }
  };

  const handleDeviceRepair = async () => {
    const confirmRepair = window.confirm("Redroid / IRIS 단말 자동 복구를 시도할까요?\n(Hyper-V VM은 이미 실행 중이라고 가정합니다.)");
    if (!confirmRepair) return;
    setDeviceRepairing(true);
    setDeviceRepairMessage(null);
    try {
      const res = await fetch(`/api/device/repair`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setDeviceRepairMessage("단말 복구 스크립트를 실행했습니다.  몇 초 후 상태 패널에서 Redroid / IRIS 단말 상태를 다시 확인해주세요.");
    } catch (error: any) {
      setDeviceRepairMessage(`복구 실패: ${error?.message || error}`);
    } finally {
      setDeviceRepairing(false);
      fetchPipelineStatus();
    }
  };

  // Load rooms list
  useEffect(() => {
    fetch(`/api/rooms`).then(r => r.json()).then((list) => {
      setRooms(list);
      if (!chosen && list.length) setChosen(undefined);
    }).catch(() => { });
  }, []);

  // Load runtime (features/excluded)
  useEffect(() => {
    fetch(`/api/runtime`).then(r => r.json()).then((cfg) => {
      setExcluded(cfg?.excludedRoomIds || []);
      setFeatures(cfg?.features || {});
    }).catch(() => { });
  }, []);

  const fetchPipelineStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/status`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setPipelineStatus(data);
      setPipelineError(null);
    } catch (error: any) {
      setPipelineError(error?.message || '상태를 불러올 수 없습니다.');
    }
  }, []);

  // 디바이스 헬스 캐시 자동 갱신 (2분 간격)
  // /api/device/health를 호출하여 device_health_cache.json을 최신 상태로 유지
  const refreshDeviceHealth = useCallback(async () => {
    try {
      await fetch(`/api/device/health`, { cache: 'no-store' });
    } catch {
      // 실패해도 무시 (status에서 캐시 만료로 표시됨)
    }
  }, []);

  useEffect(() => {
    fetchPipelineStatus();
    refreshDeviceHealth(); // 최초 로드 시 헬스 체크
    const statusId = setInterval(fetchPipelineStatus, 10_000);
    const healthId = setInterval(refreshDeviceHealth, 2 * 60 * 1000); // 2분 간격
    return () => {
      clearInterval(statusId);
      clearInterval(healthId);
    };
  }, [fetchPipelineStatus, refreshDeviceHealth]);

  const fetchWatchdog = useCallback(async () => {
    try {
      const res = await fetch(`/api/watchdog`, { cache: 'no-store' });
      const data = await res.json();
      setWatchdog({ ok: !!data.ok, mtime: data.mtime, lines: data.lines || [] });
    } catch {
      setWatchdog({ ok: false, lines: [] });
    }
  }, []);

  useEffect(() => {
    fetchWatchdog();
    const id = setInterval(fetchWatchdog, 15000);
    return () => clearInterval(id);
  }, [fetchWatchdog]);

  // Connect SSE
  useEffect(() => {
    if (!SSE_ENABLED) {
      setStatus("poll");
      return;
    }
    if (esRef.current) { try { esRef.current.close(); } catch { } }
    setStatus("connecting");
    const params = new URLSearchParams();
    if (chosen) params.set("rooms", chosen);
    params.set("all", "1");
    params.set("limit", String(limit));
    const inc = include.replace(/,/g, ' ');
    const exc = exclude.replace(/,/g, ' ');
    if (inc) params.set("include", inc);
    if (exc) params.set("exclude", exc);
    params.set("interval", "1000");
    params.set("since", String(Date.now() - 3000));
    const url = `${REALTIME_BASE}/logs/stream?` + params.toString();

    let es: EventSource | null = null;
    try {
      es = new EventSource(url);
    } catch {
      setStatus("error");
      return;
    }
    es.onopen = () => setStatus("sse");
    es.onerror = () => { setStatus("error"); };
    es.onmessage = (ev) => {
      try {
        const data: SSEPayload = JSON.parse(ev.data);
        let list: LogEntry[] = [];
        if (chosen && data.rooms && data.rooms[chosen]) {
          list = data.rooms[chosen];
        } else if (data.all) {
          list = data.all;
        }
        if (list) {
          setAllLogs(prev => {
            const merged = (data.type === 'snapshot') ? list : [...prev, ...list];
            return dedupLogs(merged, limit);
          });
        }
        if (data.all && Array.isArray(data.all)) {
          const arr: LogEntry[] = data.all as any;
          const grouped: Record<string, LogEntry[]> = {};
          for (const e of arr) {
            const rid = e.roomId;
            if (!rid) continue;
            if (!grouped[rid]) grouped[rid] = [];
            grouped[rid].push(e);
          }
          if (Object.keys(grouped).length) {
            setRoomLogs(prev => {
              const next = { ...prev } as Record<string, LogEntry[]>;
              for (const rid of Object.keys(grouped)) {
                const cur = next[rid] || [];
                next[rid] = dedupLogs([...cur, ...grouped[rid]], limit);
              }
              return next;
            });
          }
        }
        if (data.rooms) {
          setRoomLogs(prev => {
            const next = { ...prev };
            for (const rid of Object.keys(data.rooms!)) {
              const cur = prev[rid] || [];
              const merged = (data.type === 'snapshot') ? data.rooms![rid] : [...cur, ...data.rooms![rid]];
              next[rid] = dedupLogs(merged, limit);
            }
            return next;
          });
        }
        lastUpdateRef.current = Date.now();
      } catch { }
    };
    esRef.current = es;
    return () => { try { es?.close(); } catch { } }
  }, [chosen, include, exclude, limit, showExcluded, excluded.join(","), rooms.map(r => r.roomId).join(","), connectionVersion]);

  // Initial bulk fetch
  useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    (async () => {
      try {
        const visible = rooms
          .filter(r => (showExcluded ? true : !excluded.includes(r.roomId)))
          .map(r => r.roomId);
        if (visible.length === 0) return;
        const chunkSize = 40;
        for (let i = 0; i < visible.length; i += chunkSize) {
          const subset = visible.slice(i, i + chunkSize);
          const params = new URLSearchParams();
          params.set("rooms", subset.join(","));
          params.set("limit", String(Math.min(Math.max(10, limit), 120)));
          const r = await fetch(`/api/bulk?` + params.toString(), { cache: "no-store" });
          if (!r.ok) continue;
          const data: any = await r.json();
          if (data?.rooms) {
            setRoomLogs((prev) => {
              const next = { ...prev } as Record<string, LogEntry[]>;
              for (const rid of Object.keys(data.rooms)) {
                const arr: LogEntry[] = data.rooms[rid] || [];
                next[rid] = dedupLogs(arr, limit);
              }
              return next;
            });
          }
        }
      } catch { }
    })().catch(() => { });
  }, [rooms, showExcluded, excluded.join(","), limit]);

  // Fallback polling
  useEffect(() => {
    const timer = setInterval(async () => {
      const now = Date.now();
      const staleMs = now - (lastUpdateRef.current || 0);
      if (status === 'sse' && staleMs < 3500) return;
      if (pollBusyRef.current) return;
      pollBusyRef.current = true;
      try {
        const params = new URLSearchParams();
        params.set('limit', String(limit));
        const inc = include.replace(/,/g, ' ');
        const exc = exclude.replace(/,/g, ' ');
        if (inc) params.set('include', inc);
        if (exc) params.set('exclude', exc);
        params.set('all', '1');
        const url = `/api/bulk?` + params.toString();
        const r = await fetch(url, { cache: 'no-store' });
        if (r.ok) {
          const data: any = await r.json();
          if (data?.all) {
            setAllLogs((prev) => dedupLogs((data.all as LogEntry[]), limit));
          }
          if (data?.all) {
            const arr: LogEntry[] = data.all as any;
            const grouped: Record<string, LogEntry[]> = {};
            for (const e of arr) {
              const rid = e.roomId; if (!rid) continue;
              if (!grouped[rid]) grouped[rid] = [];
              grouped[rid].push(e);
            }
            if (Object.keys(grouped).length) {
              setRoomLogs(prev => {
                const next = { ...prev } as Record<string, LogEntry[]>;
                for (const rid of Object.keys(grouped)) {
                  const merged = dedupLogs([...(next[rid] || []), ...grouped[rid]], limit);
                  next[rid] = merged;
                }
                return next;
              });
            }
          }
          lastUpdateRef.current = Date.now();
          if (status !== 'sse') setStatus('poll');
        }
      } catch { }
      finally { pollBusyRef.current = false; }
    }, 1200);
    return () => clearInterval(timer);
  }, [status, chosen, include, exclude, limit, showExcluded, excluded.join(","), rooms.map(r => r.roomId).join(",")]);

  const handleReconnect = () => {
    try {
      if (esRef.current) {
        esRef.current.close();
        esRef.current = null;
      }
    } catch { }
    setStatus("connecting");
    lastUpdateRef.current = 0;
    setConnectionVersion((v) => v + 1);
  };

  const updateRuntime = async (next: { features?: any, excludedRoomIds?: string[] }) => {
    const res = { ok: false };
    try {
      const nextFeatures = next.features ?? features;
      const nextExcluded = next.excludedRoomIds ?? excluded;
      // allowedRoomIds: 기능이 하나라도 켜진 방 중 제외되지 않은 방
      const allowedRoomIds = Object.keys(nextFeatures || {}).filter(rid => {
        if (nextExcluded.includes(rid)) return false;
        const f = nextFeatures[rid] || {};
        return !!(f.welcome || f.broadcast || f.schedules || f.ai);
      });
      // POST via Next API proxy (avoids CORS/host mismatch)
      const r = await fetch(`/api/runtime`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features: nextFeatures,
          excludedRoomIds: nextExcluded,
          allowedRoomIds,
        })
      });
      res.ok = r.ok;
      const cfg = await (await fetch(`/api/runtime`)).json();
      setExcluded(cfg?.excludedRoomIds || []);
      setFeatures(cfg?.features || {});
    } catch {
      res.ok = false;
    }
    return res.ok;
  };

  const onSaveRoom = async (rid: string) => {
    setSavingRooms(prev => ({ ...prev, [rid]: "saving" }));
    const next = { ...features };
    next[rid] = next[rid] || {};
    const ok = await updateRuntime({ features: next, excludedRoomIds: excluded });
    setSavingRooms(prev => ({ ...prev, [rid]: ok ? "saved" : "error" }));
    if (ok) {
      setTimeout(() => {
        setSavingRooms(prev => {
          const cur = prev[rid];
          if (cur !== "saved") return prev;
          return { ...prev, [rid]: "idle" };
        });
      }, 2000);
    }
  };

  const onExcludeRoom = async (rid: string, value: boolean) => {
    const set = new Set(excluded);
    if (value) set.add(rid); else set.delete(rid);
    await updateRuntime({ features, excludedRoomIds: Array.from(set) });
  };

  const onToggleFeature = (rid: string, feature: keyof RoomFeatures, value: boolean) => {
    setFeatures(prev => ({
      ...prev,
      [rid]: { ...(prev[rid] || {}), [feature]: value }
    }));
  };

  const onUploadAvatar = async (rid: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    try { await fetch(`${REALTIME_BASE}/avatar/${rid}`, { method: 'POST', body: fd }); }
    catch { }
  };

  const statusBadge = useMemo(() => {
    if (status === 'sse') return <span className="tag tag-active">실시간(SSE)</span>;
    if (status === 'poll') return <span className="tag tag-inactive">로컬 폴링</span>;
    if (status === 'error') return <span className="tag tag-excluded" style={{ color: '#fca5a5' }}>연결 오류</span>;
    return <span className="tag tag-excluded">연결 시도 중…</span>;
  }, [status]);

  const watchdogSummary = useMemo(() => {
    const lastLine = watchdog.lines?.slice(-1)[0] || '로그 없음';
    const ts = watchdog.mtime ? new Date(watchdog.mtime).toLocaleString() : 'N/A';
    return { ts, lastLine };
  }, [watchdog]);

  return (
    <div className="dashboard-container">
      <div className="header-section">
        <div style={{ minWidth: 0 }}>
          <div className="status-badge-group">
            {statusBadge}
            <div className="cmd-box">
              {diagCommand}
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText?.(diagCommand);
                alert("PowerShell에서 아래 명령을 붙여 실행하세요:\n" + diagCommand);
              }}
              className="btn-copy"
            >
              복사
            </button>
          </div>
          <h1 className="main-title">IRIS 실시간 로그 대시보드</h1>
          <p className="sub-title">
            {status === 'sse' ? "FastAPI SSE로 실시간 스트림을 수신 중입니다." : "실시간 연결을 준비하거나 폴링 중입니다."}
            {' · '}
            {allLogs.length ? `최근 이벤트: ${new Date(allLogs[allLogs.length - 1].ts).toLocaleTimeString()}` : "최근 이벤트 없음"}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button onClick={handleReconnect} className="btn-outline">
            실시간 다시 연결
          </button>
        </div>
      </div>

      {/* Watchdog 상태 표시 */}
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>Watchdog (windows/watchdog.ps1)</h3>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8 }}>
          최근 업데이트: {watchdogSummary.ts} | 상태: {watchdog.ok ? 'OK' : 'FAIL/미동작'}
        </div>
        <pre style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, maxHeight: 140, overflow: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {watchdog.lines?.slice(-10).join('\n') || '로그 없음'}
        </pre>
      </div>

      <div className="filters-bar">
        <div className="filter-group">
          <label className="filter-label">방 선택</label>
          <select
            value={chosen || ''}
            onChange={e => setChosen(e.target.value || undefined)}
            className="filter-select"
          >
            <option value=''>전체(ALL)</option>
            {rooms.map(r => <option key={r.roomId} value={r.roomId}>{r.roomName}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="filter-label">포함 키워드</label>
          <input
            value={include}
            onChange={e => setInclude(e.target.value)}
            placeholder="검색어 입력"
            className="filter-input"
          />
        </div>
        <div className="filter-group">
          <label className="filter-label">제외 키워드</label>
          <input
            value={exclude}
            onChange={e => setExclude(e.target.value)}
            placeholder="제외할 단어"
            className="filter-input"
          />
        </div>
        <div className="filter-group">
          <label className="filter-label">최대 행</label>
          <input
            type="number"
            min={10} max={200}
            value={limit}
            onChange={e => setLimit(parseInt(e.target.value || '80') || 80)}
            className="filter-input"
            style={{ width: 100 }}
          />
        </div>
        <div className="filter-group" style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
          <input
            id="toggleExcluded"
            type="checkbox"
            checked={showExcluded}
            onChange={e => setShowExcluded(e.target.checked)}
            style={{ width: 16, height: 16, accentColor: 'var(--accent-primary)' }}
          />
          <label htmlFor="toggleExcluded" className="filter-label" style={{ cursor: 'pointer' }}>제외 방 포함</label>
        </div>
      </div>

      <PipelineMonitor
        status={pipelineStatus}
        error={pipelineError}
        onRefresh={fetchPipelineStatus}
        onRestartBot={handleBotRestart}
        botRestarting={botRestarting}
        botRestartMessage={botRestartMessage}
        onRepairDevice={handleDeviceRepair}
        deviceRepairing={deviceRepairing}
        deviceRepairMessage={deviceRepairMessage}
      />

      <BotProcessManager refreshInterval={5000} />

      <div style={{ marginTop: 32 }}>
        <div className="section-title">
          <span>📱 방 목록</span>
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>
            ({rooms.filter(r => showExcluded ? true : !excluded.includes(r.roomId)).length}개)
          </span>
        </div>
        <div className="room-grid">
          {rooms.filter(r => showExcluded ? true : !excluded.includes(r.roomId)).map(r => (
            <RoomCard
              key={r.roomId}
              room={r}
              logs={roomLogs[r.roomId] || []}
              features={features[r.roomId] || {}}
              excluded={excluded.includes(r.roomId)}
              saving={savingRooms[r.roomId] || "idle"}
              onToggleFeature={onToggleFeature}
              onSave={onSaveRoom}
              onExclude={onExcludeRoom}
              onUploadAvatar={onUploadAvatar}
              realtimeBase={REALTIME_BASE}
            />
          ))}
        </div>
      </div>

      <div style={{ marginTop: 32 }}>
        <div className="section-title">
          <span>📜 전체 로그</span>
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>
            ({chosen ? `Room: ${chosen}` : 'ALL'})
          </span>
        </div>
        <LogViewer logs={allLogs} height={400} id="all-feed" showRoomName={true} />
      </div>

      <div style={{ marginTop: 40, color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', paddingBottom: 40 }}>
        <b>SAFE_MODE</b>: 항상 ON (발신 기능 미노출). 이 UI는 수신/모니터링 전용입니다.
      </div>
    </div>
  );
}
