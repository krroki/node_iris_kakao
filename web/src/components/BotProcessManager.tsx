'use client';

import { useState, useEffect, useCallback } from 'react';

interface BotProcess {
  pid: number;
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

  const killAllExceptNewest = async () => {
    if (processes.length <= 1) return;

    // Sort by startTime descending (newest first)
    const sorted = [...processes].sort((a, b) =>
      new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
    );
    const toKill = sorted.slice(1); // All except the newest

    if (!confirm(`${toKill.length}개의 중복 봇을 종료하시겠습니까? (가장 최신 봇만 유지)`)) return;

    for (const proc of toKill) {
      await fetch(`/api/bot/processes?pid=${proc.pid}`, { method: 'DELETE' });
    }
    await fetchProcesses();
  };

  const statusColor = processes.length === 1
    ? 'bg-green-100 text-green-800 border-green-300'
    : processes.length === 0
    ? 'bg-red-100 text-red-800 border-red-300'
    : 'bg-yellow-100 text-yellow-800 border-yellow-300';

  const statusIcon = processes.length === 1 ? '✓' : processes.length === 0 ? '✗' : '⚠';

  return (
    <div className={`border rounded-lg p-4 ${statusColor}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold flex items-center gap-2">
          <span>{statusIcon}</span>
          <span>봇 프로세스</span>
          <span className="text-sm font-normal">
            ({loading ? '...' : processes.length}개 실행 중)
          </span>
        </h3>
        {processes.length > 1 && (
          <button
            onClick={killAllExceptNewest}
            className="px-3 py-1 text-sm bg-red-500 text-white rounded hover:bg-red-600"
          >
            중복 제거
          </button>
        )}
      </div>

      {error && (
        <div className="text-red-600 text-sm mb-2">Error: {error}</div>
      )}

      {processes.length === 0 && !loading && (
        <div className="text-sm">실행 중인 봇이 없습니다.</div>
      )}

      {processes.length > 0 && (
        <div className="space-y-2">
          {processes.map((proc, idx) => (
            <div
              key={proc.pid}
              className="flex items-center justify-between bg-white/50 rounded px-3 py-2 text-sm"
            >
              <div className="flex-1">
                <span className="font-mono font-bold">PID {proc.pid}</span>
                {idx === 0 && processes.length > 1 && (
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
      )}

      {processes.length > 1 && (
        <div className="mt-2 text-sm text-red-700">
          ⚠ 봇이 {processes.length}개 실행 중입니다. 중복 응답이 발생할 수 있습니다.
        </div>
      )}
    </div>
  );
}
