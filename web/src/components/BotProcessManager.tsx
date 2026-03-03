'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

interface BotProcess {
  pid: number;
  kind?: string;
  cmd: string;
  startTime: string;
}

type StatusFileResult = {
  exists: boolean;
  path: string;
  data?: any;
  error?: string;
};

type KindOverview = {
  kind: string;
  expected: boolean;
  runningCount: number;
  newestPid: number | null;
  newestStartTime: string | null;
  duplicatePids: number[];
  statusFile?: StatusFileResult;
  heartbeatAgeSec: number | null;
  staleHeartbeat: boolean | null;
  statusPid: number | null;
  statusPidRunning: boolean | null;
};

type ApiResponse = {
  ok: boolean;
  processes?: BotProcess[];
  count?: number;
  expectedKinds?: string[];
  kinds?: KindOverview[];
  summary?: any;
  talkApiStatusFile?: StatusFileResult;
  talkApiAuthApplyStatusFile?: StatusFileResult;
  error?: string;
};

interface Props {
  refreshInterval?: number;
}

const KIND_LABEL: Record<string, string> = {
  bot: '봇',
  'welcome-worker': '환영 워커',
  'ai-worker': 'AI 워커',
  'broadcast-worker': '공지 워커',
  'command-worker': '명령어 워커',
  'nickname-reminder-worker': '기본닉 멘션 워커',
  'image-worker': '이미지 워커',
  'auto-faq-worker': '자동 FAQ 워커',
};

const formatAge = (ageSec: number | null) => {
  if (typeof ageSec !== 'number') return '-';
  if (ageSec < 60) return `${ageSec}초 전`;
  const m = Math.floor(ageSec / 60);
  const s = ageSec % 60;
  if (m < 60) return `${m}분 ${s}초 전`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}시간 ${mm}분 전`;
};

const safeText = (v: unknown, maxLen = 140) => {
  if (v === null || v === undefined) return '-';
  const s = String(v).replace(/\s+/g, ' ').trim();
  if (!s) return '-';
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + '…';
};

export default function BotProcessManager({ refreshInterval = 5000 }: Props) {
  const [processes, setProcesses] = useState<BotProcess[]>([]);
  const [kinds, setKinds] = useState<KindOverview[]>([]);
  const [expectedKinds, setExpectedKinds] = useState<string[]>([]);
  const [summary, setSummary] = useState<any | null>(null);
  const [talkApiStatusFile, setTalkApiStatusFile] = useState<StatusFileResult | null>(null);
  const [talkApiAuthApplyStatusFile, setTalkApiAuthApplyStatusFile] = useState<StatusFileResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<number | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/processes');
      const data = (await res.json()) as ApiResponse;
      if (data && data.ok) {
        setProcesses(Array.isArray(data.processes) ? data.processes : []);
        setKinds(Array.isArray(data.kinds) ? data.kinds : []);
        setExpectedKinds(Array.isArray(data.expectedKinds) ? data.expectedKinds : []);
        setSummary(data.summary || null);
        setTalkApiStatusFile(data.talkApiStatusFile || null);
        setTalkApiAuthApplyStatusFile(data.talkApiAuthApplyStatusFile || null);
        setError(null);
      } else {
        setError(String((data as any)?.error || 'unknown error'));
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProcesses();
    const interval = setInterval(fetchProcesses, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchProcesses, refreshInterval]);

  const byKind = useMemo(() => {
    return processes.reduce<Record<string, BotProcess[]>>((acc, p) => {
      const kind = String(p.kind || 'bot').trim() || 'bot';
      if (!acc[kind]) acc[kind] = [];
      acc[kind].push({ ...p, kind });
      return acc;
    }, {});
  }, [processes]);

  const kindKeys = useMemo(() => Object.keys(byKind).sort(), [byKind]);
  const totalCount = processes.length;

  const killProcess = async (pid: number) => {
    if (!confirm(`PID ${pid} 프로세스를 종료하시겠습니까?`)) return;

    setKilling(pid);
    try {
      const res = await fetch(`/api/bot/processes?pid=${pid}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        await fetchProcesses();
      } else {
        alert(`종료 실패: ${data.error}`);
      }
    } catch (e: any) {
      alert(`종료 실패: ${e.message}`);
    } finally {
      setKilling(null);
    }
  };

  const killAllExceptNewest = async (kind: string) => {
    const list = byKind[kind] || [];
    if (list.length <= 1) return;

    const sorted = [...list].sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    const newest = sorted[0];
    const toKill = sorted.slice(1);

    if (!confirm(`[${kind}] 중복 ${toKill.length}개를 종료할까요? (최신 PID ${newest.pid} 유지)`)) return;

    for (const proc of toKill) {
      await fetch(`/api/bot/processes?pid=${proc.pid}`, { method: 'DELETE' });
    }
    await fetchProcesses();
  };

  const restartWorkerKinds = async (kindsToRestart: string[]) => {
    const list = Array.from(
      new Set((kindsToRestart || []).map((k) => String(k || '').trim()).filter(Boolean)),
    ).filter((k) => k !== 'bot');

    if (list.length === 0) return;
    if (!confirm(`아래 워커를 재시작할까요?\n- ${list.join(', ')}`)) return;

    setRestarting('bulk');
    try {
      const res = await fetch('/api/bot/workers/restart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kinds: list }),
      });
      const data: any = await res.json().catch(() => null);
      if (!res.ok || !data || data.ok !== true) {
        throw new Error(String(data?.error || `HTTP ${res.status}`));
      }
      alert(`재시작 요청 완료: ${list.join(', ')}`);
    } catch (e: any) {
      alert(`재시작 실패: ${e?.message || e}`);
    } finally {
      setRestarting(null);
    }
  };

  const restartKind = async (kind: string) => {
    const k = String(kind || '').trim();
    if (!k) return;
    if (!confirm(`[${k}] 재시작할까요?`)) return;

    setRestarting(k);
    try {
      if (k === 'bot') {
        const res = await fetch('/api/bot/restart', { method: 'POST' });
        const data: any = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) {
          throw new Error(String(data?.error || `HTTP ${res.status}`));
        }
      } else {
        const res = await fetch('/api/bot/workers/restart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind: k }),
        });
        const data: any = await res.json().catch(() => null);
        if (!res.ok || !data || data.ok !== true) {
          throw new Error(String(data?.error || `HTTP ${res.status}`));
        }
      }
    } catch (e: any) {
      alert(`재시작 실패: ${e?.message || e}`);
    } finally {
      setRestarting(null);
    }
  };

  const hasDuplicate = useMemo(() => {
    if (kinds.some((k) => k.runningCount > 1)) return true;
    return kindKeys.some((k) => (byKind[k]?.length || 0) > 1);
  }, [byKind, kindKeys, kinds]);

  const missingKinds = useMemo(() => {
    if (Array.isArray(summary?.missingKinds)) return summary.missingKinds as string[];
    return kinds.filter((k) => k.runningCount === 0).map((k) => k.kind);
  }, [kinds, summary]);

  const staleKinds = useMemo(() => {
    if (Array.isArray(summary?.staleHeartbeatKinds)) return summary.staleHeartbeatKinds as string[];
    return kinds.filter((k) => k.staleHeartbeat === true).map((k) => k.kind);
  }, [kinds, summary]);

  const expectedTotal = useMemo(() => {
    if (Array.isArray(expectedKinds) && expectedKinds.length > 0) return expectedKinds.length;
    if (typeof summary?.expectedKinds === 'number') return Number(summary.expectedKinds) || 4;
    return kinds.length || 4;
  }, [expectedKinds, kinds, summary]);

  const overallTag = useMemo(() => {
    if (!loading && totalCount === 0) return { cls: 'tag-error', text: '미실행' };
    if (missingKinds.length > 0) return { cls: 'tag-error', text: '미실행' };
    if (hasDuplicate || staleKinds.length > 0) return { cls: 'tag-inactive', text: '주의' };
    return { cls: 'tag-active', text: '정상' };
  }, [hasDuplicate, loading, missingKinds.length, staleKinds.length, totalCount]);

  const talkApiTag = useMemo(() => {
    const sf = talkApiStatusFile;
    const data = sf?.data || null;
    const ok = data?.ok === true;
    const updatedAt = typeof data?.updatedAt === 'string' ? data.updatedAt : null;
    const ageSec = updatedAt ? Math.floor(Math.max(0, Date.now() - new Date(updatedAt).getTime()) / 1000) : null;
    const status = typeof data?.talkStatus === 'number' ? data.talkStatus : null;
    if (!sf) return { cls: 'tag-excluded', text: 'Talk-API: 미확인', ageSec: null as number | null, status: null as number | null, updatedAt: null as string | null };
    if (!sf.exists) return { cls: 'tag-excluded', text: 'Talk-API: 상태파일 없음', ageSec, status, updatedAt };
    if (sf.error) return { cls: 'tag-inactive', text: 'Talk-API: 상태파일 오류', ageSec, status, updatedAt };
    if (ok) return { cls: 'tag-active', text: `Talk-API: 정상${status != null ? `(${status})` : ''}`, ageSec, status, updatedAt };
    return { cls: 'tag-error', text: `Talk-API: 실패${status != null ? `(${status})` : ''}`, ageSec, status, updatedAt };
  }, [talkApiStatusFile]);

  const talkApiAuthTag = useMemo(() => {
    const sf = talkApiAuthApplyStatusFile;
    const data = sf?.data || null;
    const ok = data?.ok === true;
    const appliedAt = typeof data?.appliedAt === 'string' ? data.appliedAt : null;
    const ageSec = appliedAt ? Math.floor(Math.max(0, Date.now() - new Date(appliedAt).getTime()) / 1000) : null;
    if (!sf) return { cls: 'tag-excluded', text: 'auth: 미확인', ageSec: null as number | null, appliedAt: null as string | null, ok: null as boolean | null };
    if (!sf.exists) return { cls: 'tag-excluded', text: 'auth: 상태파일 없음', ageSec, appliedAt, ok: null as boolean | null };
    if (sf.error) return { cls: 'tag-inactive', text: 'auth: 상태파일 오류', ageSec, appliedAt, ok: null as boolean | null };
    if (ok) return { cls: 'tag-active', text: 'auth: 적용됨', ageSec, appliedAt, ok: true as const };
    return { cls: 'tag-error', text: 'auth: 적용 실패', ageSec, appliedAt, ok: false as const };
  }, [talkApiAuthApplyStatusFile]);

  const talkApiHint = useMemo(() => {
    const status = talkApiStatusFile?.data || null;
    const apply = talkApiAuthApplyStatusFile?.data || null;

    const statusUpdatedAt = typeof status?.updatedAt === 'string' ? status.updatedAt : null;
    const appliedAt = typeof apply?.appliedAt === 'string' ? apply.appliedAt : null;
    const statusMs = statusUpdatedAt ? Date.parse(statusUpdatedAt) : NaN;
    const appliedMs = appliedAt ? Date.parse(appliedAt) : NaN;
    const appliedAfterStatus = Number.isFinite(statusMs) && Number.isFinite(appliedMs) ? appliedMs > statusMs : null;

    const ok = status?.ok === true;
    const talkStatus = typeof status?.talkStatus === 'number' ? status.talkStatus : null;
    if (ok) return { kind: 'ok' as const, text: null as string | null, appliedAfterStatus };

    // 최근 실패 기록이 있어도 auth 재적용이 더 최신이면 “재검증 필요”로 표시(실패로 단정하지 않음).
    if (status?.ok === false && appliedAfterStatus === true) {
      return {
        kind: 'needs_verify' as const,
        appliedAfterStatus,
        text:
          `최근 실패 기록(${talkStatus ?? '?'})이 있지만 authHeader가 더 최근에 적용되었습니다. ` +
          `테스트 방에서 1회 검증을 권장합니다.`,
      };
    }

    if (status?.ok === false) {
      return {
        kind: 'fail' as const,
        appliedAfterStatus,
        text:
          `전송이 실패하면 멘션/답장(Reply)은 “진짜 멘션”으로 렌더링되지 못하고 ` +
          `텍스트(@닉네임)로만 보일 수 있습니다. (상태: ${talkStatus ?? '?'})`,
      };
    }

    return { kind: 'unknown' as const, text: null as string | null, appliedAfterStatus };
  }, [talkApiAuthApplyStatusFile?.data, talkApiStatusFile?.data]);

  const cleanupAllDuplicates = async () => {
    const duplicateKinds = kindKeys.filter((k) => (byKind[k]?.length || 0) > 1);
    if (duplicateKinds.length === 0) return;

    if (!confirm(`중복 프로세스를 모두 정리할까요?\n- 대상: ${duplicateKinds.join(', ')}\n- 동작: kind별 최신 1개만 유지`)) return;

    for (const kind of duplicateKinds) {
      const list = byKind[kind] || [];
      const sorted = [...list].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
      const toKill = sorted.slice(1);
      for (const proc of toKill) {
        await fetch(`/api/bot/processes?pid=${proc.pid}`, { method: 'DELETE' });
      }
    }
    await fetchProcesses();
  };

  const viewKinds: KindOverview[] = useMemo(() => {
    if (kinds.length) return kinds;
    return kindKeys.map((kind) => ({
      kind,
      expected: false,
      runningCount: (byKind[kind] || []).length,
      newestPid: null,
      newestStartTime: null,
      duplicatePids: [],
      statusFile: undefined,
      heartbeatAgeSec: null,
      staleHeartbeat: null,
      statusPid: null,
      statusPidRunning: null,
    }));
  }, [byKind, kindKeys, kinds]);

  return (
    <div className="pipeline-card">
      <div className="pipeline-header">
        <div className="pipeline-title">
          <span>봇/워커 프로세스</span>
          <span className={`tag ${overallTag.cls}`}>{loading ? '로딩…' : overallTag.text}</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>
            (실행 {loading ? '…' : totalCount}/{expectedTotal})
          </span>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {(missingKinds.length > 0 || staleKinds.length > 0) && (
            <button
              onClick={() => restartWorkerKinds([...missingKinds, ...staleKinds])}
              className="btn-outline"
              disabled={loading || restarting !== null}
              title="미실행/하트비트 경고 kind를 -Restart로 재기동 요청합니다."
            >
              {restarting ? '재시작 요청 중…' : '미실행/하트비트 재시작'}
            </button>
          )}
          {hasDuplicate && (
            <button onClick={cleanupAllDuplicates} className="btn-outline" disabled={loading}>
              중복 일괄 정리(최신 유지)
            </button>
          )}
          <button onClick={fetchProcesses} className="btn-outline" disabled={loading}>
            새로고침
          </button>
        </div>
      </div>

      <div className="process-note">
        정상 기준: <span className="process-mono">bot + welcome-worker + ai-worker + broadcast-worker + command-worker + nickname-reminder-worker + image-worker + auto-faq-worker</span>가 각각 1개씩(총 8개)
        떠 있는 것이 정상입니다. 이 카드의 종료 버튼은 <span className="process-mono">node-iris-app</span>만 안전 종료합니다(전체 <span className="process-mono">node.exe</span> 종료 금지).
      </div>

      {error && (
        <div className="process-error">
          프로세스 목록을 불러오지 못했습니다: <span className="process-mono">{error}</span>
        </div>
      )}

      {!loading && (
        <div className="process-summary">
          {missingKinds.length > 0 && (
            <span className="tag tag-error">미실행: {missingKinds.join(', ')}</span>
          )}
          {hasDuplicate && (
            <span className="tag tag-inactive">
              중복: {kinds.filter((k) => k.runningCount > 1).map((k) => k.kind).join(', ') || '감지됨'}
            </span>
          )}
          {staleKinds.length > 0 && (
            <span className="tag tag-inactive">하트비트 경고(3분+): {staleKinds.join(', ')}</span>
          )}
          <span className={`tag ${talkApiTag.cls}`} title={talkApiTag.updatedAt ? `updatedAt=${talkApiTag.updatedAt}` : undefined}>
            {talkApiTag.text}{talkApiTag.ageSec != null ? ` · ${formatAge(talkApiTag.ageSec)}` : ''}
          </span>
          <span className={`tag ${talkApiAuthTag.cls}`} title={talkApiAuthTag.appliedAt ? `appliedAt=${talkApiAuthTag.appliedAt}` : undefined}>
            {talkApiAuthTag.text}{talkApiAuthTag.ageSec != null ? ` · ${formatAge(talkApiAuthTag.ageSec)}` : ''}
          </span>
          {missingKinds.length === 0 && !hasDuplicate && staleKinds.length === 0 && (
            <span className="tag tag-active">모든 워커 정상 실행 중</span>
          )}
          {summary?.generatedAt && (
            <span className="tag tag-excluded">생성: {String(summary.generatedAt)}</span>
          )}
        </div>
      )}

      {!loading && (missingKinds.length > 0 || staleKinds.length > 0 || hasDuplicate || !!talkApiHint.text) && (
        <div className="process-hints">
          {missingKinds.includes('bot') && (
            <div className="process-hint">
              - <span className="process-mono">bot</span>이 꺼져 있으면 로그 수집/명령 처리 전반이 멈춥니다. 우선 <span className="process-mono">windows/start_bot.cmd</span> 또는 <span className="process-mono">windows/start_all.cmd</span>로 기동하세요.
            </div>
          )}
          {missingKinds.includes('welcome-worker') && (
            <div className="process-hint">
              - 환영 기능이 안 돌 때는 <span className="process-mono">welcome-worker</span> 실행 여부를 먼저 확인하세요. (<span className="process-mono">windows/start_welcome_worker.ps1</span> / <span className="process-mono">windows/start_all.cmd</span>)
            </div>
          )}
          {missingKinds.includes('ai-worker') && (
            <div className="process-hint">
              - AI 응답이 안 나오면 <span className="process-mono">ai-worker</span> 미실행일 수 있습니다. (<span className="process-mono">windows/start_ai_worker.ps1</span> / <span className="process-mono">windows/start_all.cmd</span>)
            </div>
          )}
          {missingKinds.includes('broadcast-worker') && (
            <div className="process-hint">
              - 공지 전파가 안 되면 <span className="process-mono">broadcast-worker</span> 미실행일 수 있습니다. (<span className="process-mono">windows/start_broadcast_worker.ps1</span> / <span className="process-mono">windows/start_all.cmd</span>)
            </div>
          )}
          {missingKinds.includes('command-worker') && (
            <div className="process-hint">
              - 방별 명령어(FAQ)가 안 되면 <span className="process-mono">command-worker</span> 미실행일 수 있습니다. (<span className="process-mono">windows/start_command_worker.ps1</span> / <span className="process-mono">windows/start_all.cmd</span>)
            </div>
          )}
          {missingKinds.includes('image-worker') && (
            <div className="process-hint">
              - 이미지 생성/수정이 안 되면 <span className="process-mono">image-worker</span> 미실행일 수 있습니다. (<span className="process-mono">windows/start_image_worker.ps1</span> / <span className="process-mono">windows/start_all.cmd</span>)
            </div>
          )}
          {staleKinds.length > 0 && (
            <div className="process-hint">
              - 하트비트가 3분 이상 멈추면 “프로세스는 떠 있는데 워커가 멈춘” 상태일 수 있습니다. 우선 해당 kind의 <span className="process-mono">최신 PID 종료</span> 후 재기동을 권장합니다.
            </div>
          )}
          {hasDuplicate && (
            <div className="process-hint">
              - 중복 실행은 동일 메시지 다중 발송의 대표 원인입니다. 가능하면 <span className="process-mono">중복 일괄 정리(최신 유지)</span>로 정리하세요.
            </div>
          )}
          {talkApiHint.text && (
            <div className="process-hint">
              - <span className="process-mono">Talk-API</span>: {talkApiHint.text}
            </div>
          )}
        </div>
      )}

      <div className="process-grid">
        {viewKinds.map((k) => {
          const list = [...(byKind[k.kind] || [])].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
          const newestPid = list[0]?.pid ?? null;
          const dup = list.length > 1;
          const missing = list.length === 0;
          const stale = k.staleHeartbeat === true;
          const hbAgeLabel = formatAge(k.heartbeatAgeSec);

          const kindLabel = KIND_LABEL[k.kind] || k.kind;

          const tag = missing
            ? { cls: 'tag-error', text: '미실행' }
            : dup || stale
              ? { cls: 'tag-inactive', text: dup ? `중복 ${list.length}개` : '하트비트 경고' }
              : { cls: 'tag-active', text: '정상' };

          const statusData = k.statusFile?.data || null;
          const statusPid = typeof k.statusPid === 'number' ? k.statusPid : null;
          const statusPidMismatch = statusPid && newestPid && statusPid !== newestPid;

          const preview = (() => {
            if (!statusData) return '-';
            if (k.kind === 'bot') {
              const roomId = statusData.lastEventRoomId ? String(statusData.lastEventRoomId) : '-';
              const text = safeText(statusData.lastEventText, 90);
              return `${roomId} | ${text}`;
            }
            if (k.kind === 'welcome-worker') {
              const ok = statusData.lastWelcomeOk;
              const tpl = statusData.lastWelcomeTemplate ? String(statusData.lastWelcomeTemplate) : '-';
              const rid = statusData.lastWelcomeRoomId ? String(statusData.lastWelcomeRoomId) : '-';
              return `welcome(${ok ? 'OK' : 'FAIL'}) tpl=${tpl} room=${rid}`;
            }
            if (k.kind === 'ai-worker') {
              const inflight = typeof statusData.inflight === 'number' ? statusData.inflight : '-';
              const last = statusData.lastEventTs ? String(statusData.lastEventTs) : '-';
              return `inflight=${inflight} last=${last}`;
            }
            if (k.kind === 'broadcast-worker') {
              const ok = statusData.lastAnnouncementOk;
              const succ = typeof statusData.lastAnnouncementSuccess === 'number' ? statusData.lastAnnouncementSuccess : '-';
              const fail = typeof statusData.lastAnnouncementFailed === 'number' ? statusData.lastAnnouncementFailed : '-';
              const targets = typeof statusData.lastAnnouncementTargets === 'number' ? statusData.lastAnnouncementTargets : '-';
              return `announce(${ok ? 'OK' : 'FAIL'}) ${succ}/${targets} fail=${fail}`;
            }
            return safeText(JSON.stringify(statusData), 120);
          })();

          return (
            <div key={k.kind} className="process-kind-card">
              <div className="process-kind-head">
                <div style={{ minWidth: 0 }}>
                  <div className="process-kind-title">{kindLabel}</div>
                  <div className="process-kind-sub">{k.kind}</div>
                </div>
                <div className="process-kind-tags">
                  <span className={`tag ${tag.cls}`}>{tag.text}</span>
                  <span className="tag tag-excluded">하트비트: {hbAgeLabel}</span>
                </div>
              </div>

              <div className="process-kv">
                <div className="process-k">최신 PID</div>
                <div className="process-v process-mono">{newestPid ?? '-'}</div>

                <div className="process-k">시작</div>
                <div className="process-v process-mono">{list[0]?.startTime ?? '-'}</div>

                <div className="process-k">status PID</div>
                <div className="process-v process-mono">
                  {statusPid ?? '-'}
                  {statusPidMismatch && <span className="process-warn"> (불일치)</span>}
                  {k.statusPidRunning === false && <span className="process-warn"> (미실행)</span>}
                </div>

                <div className="process-k">최근 상태</div>
                <div className="process-v">{preview}</div>
              </div>

              <div className="process-actions">
                <button
                  className="btn-outline"
                  onClick={() => restartKind(k.kind)}
                  disabled={loading || restarting !== null}
                  title="해당 kind의 start_* 스크립트(-Restart)로 재기동합니다."
                >
                  {restarting === k.kind ? '재시작 중…' : '재시작'}
                </button>
                {dup && (
                  <button className="btn-outline" onClick={() => killAllExceptNewest(k.kind)} disabled={loading}>
                    중복 정리(최신 유지)
                  </button>
                )}
                {newestPid && (
                  <button
                    className="btn-outline process-btn-danger"
                    onClick={() => killProcess(newestPid)}
                    disabled={killing === newestPid}
                    title="최신 PID 종료(긴급)"
                  >
                    {killing === newestPid ? '종료 중…' : '최신 PID 종료'}
                  </button>
                )}
              </div>

              <details className="process-details">
                <summary>PID 목록/명령행 보기</summary>
                {list.length === 0 ? (
                  <div className="process-detail-empty">실행 중인 프로세스가 없습니다.</div>
                ) : (
                  <div className="process-pid-list">
                    {list.map((p) => (
                      <div key={p.pid} className="process-pid-row">
                        <div style={{ minWidth: 0 }}>
                          <div className="process-mono">PID {p.pid}{p.pid === newestPid ? ' (최신)' : ''}</div>
                          <div className="process-pid-cmd">{p.startTime} | {p.cmd}</div>
                        </div>
                        <button
                          className="btn-outline process-btn-danger"
                          onClick={() => killProcess(p.pid)}
                          disabled={killing === p.pid}
                        >
                          {killing === p.pid ? '…' : '종료'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </details>

              <details className="process-details">
                <summary>status 파일 보기</summary>
                {!k.statusFile ? (
                  <div className="process-detail-empty">status 정보가 없습니다.</div>
                ) : k.statusFile.error ? (
                  <div className="process-detail-empty">
                    읽기 실패: <span className="process-mono">{k.statusFile.error}</span>
                  </div>
                ) : !k.statusFile.exists ? (
                  <div className="process-detail-empty">
                    없음: <span className="process-mono">{k.statusFile.path}</span>
                  </div>
                ) : (
                  <pre className="process-json">
                    {JSON.stringify(k.statusFile.data || {}, null, 2)}
                  </pre>
                )}
              </details>
            </div>
          );
        })}
      </div>
    </div>
  );
}
