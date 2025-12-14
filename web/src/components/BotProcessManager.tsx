'use client';

import { useState, useEffect, useCallback } from 'react';

interface BotProcess {
  pid: number;
  kind?: string;
  cmd: string;
  startTime: string;
}

interface Props {
  refreshInterval?: number;
}

export default function BotProcessManager({ refreshInterval = 5000 }: Props) {
  const [processes, setProcesses] = useState<BotProcess[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [killing, setKilling] = useState<number | null>(null);

  const fetchProcesses = useCallback(async () => {
    try {
      const res = await fetch('/api/bot/processes');
      const data = await res.json();
      if (data.ok) {
        setProcesses(data.processes || []);
        setError(null);
      } else {
        setError(data.error);
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

  const byKind = processes.reduce<Record<string, BotProcess[]>>((acc, p) => {
    const kind = (p.kind || 'bot').trim() || 'bot';
    if (!acc[kind]) acc[kind] = [];
    acc[kind].push({ ...p, kind });
    return acc;
  }, {});

  const kindKeys = Object.keys(byKind).sort();
  const hasDuplicate = kindKeys.some((k) => (byKind[k]?.length || 0) > 1);
  const totalCount = processes.length;

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

  const statusColor = (totalCount > 0 && !hasDuplicate)
    ? 'bg-green-100 text-green-800 border-green-300'
    : totalCount === 0
    ? 'bg-red-100 text-red-800 border-red-300'
    : 'bg-yellow-100 text-yellow-800 border-yellow-300';

  const statusIcon = (totalCount > 0 && !hasDuplicate) ? '✓' : totalCount === 0 ? '✗' : '⚠';

  return (
    <div className={`border rounded-lg p-4 ${statusColor}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span>{statusIcon}</span>
          <span>프로세스(봇/워커)</span>
          <span className="text-sm font-normal">
            ({loading ? '...' : totalCount}개 실행 중)
          </span>
        </h3>
      </div>

      {error && (
        <div className="text-red-600 text-sm mb-2">Error: {error}</div>
      )}

      {totalCount === 0 && !loading && (
        <div className="text-sm">실행 중인 봇이 없습니다.</div>
      )}

      {totalCount > 0 && (
        <div className="space-y-4">
          {kindKeys.map((kind) => {
            const list = byKind[kind] || [];
            const sorted = [...list].sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime());
            const newestPid = sorted[0]?.pid;
            const dup = list.length > 1;
            return (
              <div key={kind} className="bg-white/40 rounded p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-sm">
                    {kind} ({list.length}개)
                    {dup && <span className="ml-2 text-xs bg-red-500 text-white px-1 rounded">중복</span>}
                  </div>
                  {dup && (
                    <button
                      onClick={() => killAllExceptNewest(kind)}
                      className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
                    >
                      중복 제거(최신 유지)
                    </button>
                  )}
                </div>
                <div className="space-y-2">
                  {sorted.map((proc) => (
                    <div
                      key={proc.pid}
                      className="flex items-center justify-between bg-white/50 rounded px-3 py-2 text-sm"
                    >
                      <div className="flex-1">
                        <span className="font-mono font-bold">PID {proc.pid}</span>
                        {proc.pid === newestPid && dup && (
                          <span className="ml-2 text-xs bg-blue-500 text-white px-1 rounded">최신</span>
                        )}
                        <div className="text-xs opacity-70 truncate max-w-md">
                          {proc.startTime} | {proc.cmd}
                        </div>
                      </div>
                      <button
                        onClick={() => killProcess(proc.pid)}
                        disabled={killing === proc.pid}
                        className="ml-2 px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
                      >
                        {killing === proc.pid ? '...' : '종료'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {hasDuplicate && (
        <div className="mt-2 text-sm text-red-700">
          ⚠ 중복 실행이 감지되었습니다. 공지/AI/환영 메시지가 여러 번 발신될 수 있습니다.
        </div>
      )}

      <div className="mt-3 text-xs opacity-60 border-t pt-2">
        ℹ️ node-iris-app 프로세스만 종료됩니다. 다른 Node 앱(Codex, Claude Code 등)은 보호됩니다.
      </div>
    </div>
  );
}
