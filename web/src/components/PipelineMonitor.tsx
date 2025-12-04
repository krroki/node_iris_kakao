import React, { useMemo } from 'react';
import { PipelineStatus, StageKey } from '../types';

interface PipelineMonitorProps {
  status: PipelineStatus | null;
  error: string | null;
  onRefresh: () => void;
  onRestartBot: () => void;
  botRestarting: boolean;
  botRestartMessage: string | null;
  onRepairDevice: () => void;
  deviceRepairing: boolean;
  deviceRepairMessage: string | null;
}

const stageOrder: StageKey[] = ['device', 'bot', 'logStore', 'realtime', 'ui'];

const stageGuides: Record<StageKey, string[]> = {
  device: [
    'Hyper-V 관리자: Start-VM -Name redroid (VM 실행 확인)',
    'PowerShell: windows/setup_iris_port.ps1 -LocalPort 5050',
    '필요 시: windows/repair_redroid_iris.ps1 -Fix (단말/IRIS 복구)',
  ],
  bot: [
    '대시보드 상단의 "봇 재시작" 버튼으로 재기동',
    '또는 PowerShell: windows/smart_restart_bot.ps1',
  ],
  logStore: [
    'node-iris-app/data/logs/<room>/*.log 파일이 최근에 갱신되는지 확인',
    '필요 시 windows/start_all.ps1 로 전체 스택 재기동',
  ],
  realtime: [
    'windows/start_all.ps1 실행 후 FastAPI(8650) /health 확인',
    'logs/realtime_api.log tail -f 로 에러 확인',
  ],
  ui: [
    '윈도우 PowerShell: windows/start_web.ps1 또는 start_all.ps1',
    '브라우저에서 http://localhost:3100 접속',
  ],
};

export default function PipelineMonitor({
  status,
  error,
  onRefresh,
  onRestartBot,
  botRestarting,
  botRestartMessage,
  onRepairDevice,
  deviceRepairing,
  deviceRepairMessage,
}: PipelineMonitorProps) {
  const pipelineAllOk = useMemo(() => {
    if (!status) return false;
    return stageOrder.every((key) => status.stages?.[key]?.ok);
  }, [status]);

  const formatTs = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
    } catch {
      return ts;
    }
  };

  return (
    <div className="pipeline-card">
      <div className="pipeline-header">
        <div className="pipeline-title">
          <span>전체 파이프라인 상태</span>
          {status ? (
            pipelineAllOk ? (
              <span className="tag tag-active">모든 단계 정상</span>
            ) : (
              <span
                className="tag tag-inactive"
                style={{ color: '#fca5a5', background: 'rgba(239,68,68,0.1)' }}
              >
                주의 필요
              </span>
            )
          ) : (
            <span className="tag tag-excluded">상태 로딩 중...</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            업데이트: {status?.updatedAt ? formatTs(status.updatedAt) : '-'}
          </span>
          <button onClick={onRefresh} className="btn-outline">
            새로고침
          </button>
          <button
            onClick={onRepairDevice}
            disabled={deviceRepairing}
            className="btn-outline"
            style={{ opacity: deviceRepairing ? 0.7 : 1 }}
          >
            {deviceRepairing ? '단말 복구 중...' : '단말 복구'}
          </button>
          <button
            onClick={onRestartBot}
            disabled={botRestarting}
            className="btn-copy"
            style={{ opacity: botRestarting ? 0.7 : 1 }}
          >
            {botRestarting ? '재시작 중...' : '봇 재시작'}
          </button>
        </div>
      </div>

      {deviceRepairMessage && (
        <div
          style={{
            marginBottom: 8,
            padding: 10,
            borderRadius: 8,
            background: 'rgba(59,130,246,0.08)',
            color: '#93c5fd',
            fontSize: 13,
          }}
        >
          {deviceRepairMessage}
        </div>
      )}

      {botRestartMessage && (
        <div
          style={{
            marginBottom: 16,
            padding: 12,
            borderRadius: 8,
            background: 'rgba(245, 158, 11, 0.1)',
            color: '#fbbf24',
            fontSize: 13,
          }}
        >
          {botRestartMessage}
        </div>
      )}

      {error ? (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.1)',
            color: '#fca5a5',
          }}
        >
          상태 정보를 불러오지 못했습니다: {error}
        </div>
      ) : (
        <>
          <div className="pipeline-nodes">
            {stageOrder.map((key, idx) => {
              const stage = status?.stages?.[key];
              const waiting = !status;
              const ok = stage?.ok ?? false;

              const borderColor = waiting
                ? 'var(--border-color)'
                : ok
                  ? 'var(--success)'
                  : 'var(--error)';
              const bgColor = waiting
                ? 'rgba(15,23,42,0.5)'
                : ok
                  ? 'rgba(16, 185, 129, 0.05)'
                  : 'rgba(239, 68, 68, 0.05)';

              return (
                <React.Fragment key={key}>
                  <div
                    className="stage-node"
                    style={{ border: `1px solid ${borderColor}`, background: bgColor }}
                  >
                    <div className="stage-name">{stage?.name || key}</div>
                    <div className="stage-detail">
                      {stage?.detail || (waiting ? '상태 확인 중..' : '상세 정보 없음')}
                    </div>
                    {stage?.timestamp && (
                      <div className="stage-time">최근: {formatTs(stage.timestamp)}</div>
                    )}
                  </div>
                  {idx < stageOrder.length - 1 && <div className="arrow-separator">➜</div>}
                </React.Fragment>
              );
            })}
          </div>

          <div className="pipeline-details-grid">
            {stageOrder.map((key) => {
              const stage = status?.stages?.[key];
              const ok = stage?.ok ?? false;
              if (ok) return null; // 실패한 단계만 가이드를 보여줌

              return (
                <div key={`detail-${key}`} className="detail-box">
                  <div
                    style={{
                      fontWeight: 600,
                      marginBottom: 4,
                      color: ok ? 'var(--success)' : 'var(--error)',
                    }}
                  >
                    {stage?.name || key} 복구 가이드
                  </div>
                  {stageGuides[key] && (
                    <ul
                      style={{
                        margin: 0,
                        paddingLeft: 16,
                        color: 'var(--text-secondary)',
                        fontSize: 12,
                      }}
                    >
                      {stageGuides[key].map((g, i) => (
                        <li key={i}>{g}</li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

