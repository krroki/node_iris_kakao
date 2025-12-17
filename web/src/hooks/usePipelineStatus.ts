import { useCallback, useEffect, useState } from "react";
import { PipelineStatus } from "../types";

type UsePipelineStatusResult = {
  status: PipelineStatus | null;
  error: string | null;
  refresh: () => Promise<void>;
  botRestarting: boolean;
  botRestartMessage: string | null;
  deviceRepairing: boolean;
  deviceRepairMessage: string | null;
  restartBot: () => Promise<void>;
  repairDevice: (device?: string) => Promise<void>;
};

export function usePipelineStatus(): UsePipelineStatusResult {
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [botRestarting, setBotRestarting] = useState(false);
  const [botRestartMessage, setBotRestartMessage] = useState<string | null>(null);
  const [deviceRepairing, setDeviceRepairing] = useState(false);
  const [deviceRepairMessage, setDeviceRepairMessage] = useState<string | null>(null);

  const fetchPipelineStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/status`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as PipelineStatus;
      setPipelineStatus(data);
      setPipelineError(null);
    } catch (error: any) {
      setPipelineError(error?.message || "상태를 불러올 수 없습니다.");
    }
  }, []);

  // 디바이스 헬스 캐시 자동 갱신 (/api/device/health)
  const refreshDeviceHealth = useCallback(async () => {
    try {
      await fetch(`/api/device/health`, { cache: "no-store" });
    } catch {
      // 실패해도 무시 (status에서 캐시 만료로 표시됨)
    }
  }, []);

  useEffect(() => {
    // 초기 로드 + 주기적 새로고침
    fetchPipelineStatus();
    refreshDeviceHealth();
    const statusId = setInterval(fetchPipelineStatus, 10_000);
    const healthId = setInterval(refreshDeviceHealth, 2 * 60 * 1000);
    return () => {
      clearInterval(statusId);
      clearInterval(healthId);
    };
  }, [fetchPipelineStatus, refreshDeviceHealth]);

  const restartBot = useCallback(async () => {
    const confirmRestart = window.confirm(
      "Node-IRIS 봇을 다시 시작할까요? (메시지 발신은 하지 않습니다)",
    );
    if (!confirmRestart) return;
    setBotRestarting(true);
    setBotRestartMessage(null);
    try {
      const res = await fetch(`/api/bot/restart`, { method: "POST" });
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
  }, [fetchPipelineStatus]);

  const repairDevice = useCallback(async (device?: string) => {
    const deviceHint = device && String(device).trim()
      ? `\n\n(ADB 대상: ${String(device).trim()})`
      : "";
    const confirmRepair = window.confirm(
      "Redroid / IRIS 단말 자동 복구를 시도할까요?\n(Hyper-V VM은 이미 실행 중이라고 가정합니다.)" + deviceHint,
    );
    if (!confirmRepair) return;
    setDeviceRepairing(true);
    setDeviceRepairMessage(null);
    try {
      const res = await fetch(`/api/device/repair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(device ? { device } : {}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setDeviceRepairMessage(
        "단말 복구 스크립트를 실행했습니다.  몇 초 후 상태 패널에서 Redroid / IRIS 단말 상태를 다시 확인해주세요.",
      );
    } catch (error: any) {
      setDeviceRepairMessage(`복구 실패: ${error?.message || error}`);
    } finally {
      setDeviceRepairing(false);
      fetchPipelineStatus();
    }
  }, [fetchPipelineStatus]);

  return {
    status: pipelineStatus,
    error: pipelineError,
    refresh: fetchPipelineStatus,
    botRestarting,
    botRestartMessage,
    deviceRepairing,
    deviceRepairMessage,
    restartBot,
    repairDevice,
  };
}

