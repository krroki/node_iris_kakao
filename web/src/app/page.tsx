"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "./dashboard.css";
import {
  LogEntry,
  SSEPayload,
  PipelineStatus,
  RoomInfo,
  RoomFeatures,
  CourseRosterConfig,
  CourseRosterRoomConfig,
  CourseMembershipAuditConfig,
  OpenchatMembersSheetsConfig,
  OpenchatMembersSheetsRoomConfig,
  BulkLogsResponse,
  RuntimeConfig,
} from "../types";
import PipelineMonitor from "../components/PipelineMonitor";
import RoomCard from "../components/RoomCard";
import LogViewer from "../components/LogViewer";
import BotProcessManager from "../components/BotProcessManager";
import { usePipelineStatus } from "../hooks/usePipelineStatus";
import { useWatchdog } from "../hooks/useWatchdog";

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
    const uid = e.uid ? String(e.uid) : "";
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

function inferCourseRosterSheetName(roomName: string): string {
  const s = String(roomName || "").trim();
  if (/^\\(사담방\\)/.test(s)) return "ROSTER_CHAT";
  if (/^\\(공지방\\)/.test(s)) return "ROSTER_NOTICE";
  if (/^\\(프리미엄방\\)/.test(s)) return "ROSTER_PREMIUM";
  return "ROSTER_RAW";
}

export default function Home() {
  const [status, setStatus] = useState<"connecting" | "sse" | "poll" | "error">("connecting");
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [allLogs, setAllLogs] = useState<LogEntry[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsLoadError, setRoomsLoadError] = useState<string | null>(null);
  const [roomLogs, setRoomLogs] = useState<Record<string, LogEntry[]>>({});
  const [excluded, setExcluded] = useState<string[]>([]);
  const [showExcluded, setShowExcluded] = useState<boolean>(false);
  const [features, setFeatures] = useState<Record<string, RoomFeatures>>({});
  const [savingRooms, setSavingRooms] = useState<Record<string, "idle" | "saving" | "saved" | "error">>({});
  const [avatarVersions, setAvatarVersions] = useState<Record<string, number>>({});
  const [chosen, setChosen] = useState<string | undefined>(undefined);
  const [include, setInclude] = useState<string>("");
  const [exclude, setExclude] = useState<string>("");
  const [limit, setLimit] = useState<number>(80);

  // 기본닉 멘션(닉네임 변경 요청) 전역 설정 (ADR-0041)
  const [nickRemL2Hours, setNickRemL2Hours] = useState<number>(24);
  const [nickRemL3Hours, setNickRemL3Hours] = useState<number>(48);
  const [nickRemSaved, setNickRemSaved] = useState<{ l2: number; l3: number } | null>(null);
  const [nickRemSaving, setNickRemSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [nickRemError, setNickRemError] = useState<string | null>(null);

  // IRIS/Redroid 연결(ADB device 캐시)
  const [irisUrl, setIrisUrl] = useState<string>("http://127.0.0.1:5050");
  const [redroidDevice, setRedroidDevice] = useState<string>("");
  const [redroidDeviceUpdatedAt, setRedroidDeviceUpdatedAt] = useState<string | null>(null);
  const [redroidDeviceCachePath, setRedroidDeviceCachePath] = useState<string | null>(null);
  const [redroidVmIp, setRedroidVmIp] = useState<string | null>(null);
  const [redroidDetectedDevice, setRedroidDetectedDevice] = useState<string | null>(null);
  const [redroidDeviceLoading, setRedroidDeviceLoading] = useState<boolean>(false);
  const [redroidDeviceSaving, setRedroidDeviceSaving] = useState<boolean>(false);
  const [redroidDeviceMsg, setRedroidDeviceMsg] = useState<string | null>(null);

  // 강의 운영(roster-worker) 설정/상태
  const [courseRosterConfig, setCourseRosterConfig] = useState<CourseRosterConfig | null>(null);
  const [courseRosterConfigExists, setCourseRosterConfigExists] = useState<boolean>(false);
  const [courseRosterConfigPath, setCourseRosterConfigPath] = useState<string | null>(null);
  const [courseRosterConfigDirty, setCourseRosterConfigDirty] = useState<boolean>(false);
  const [courseRosterConfigSaving, setCourseRosterConfigSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [courseRosterConfigError, setCourseRosterConfigError] = useState<string | null>(null);
  const [courseRosterServiceAccount, setCourseRosterServiceAccount] = useState<{ exists: boolean; path?: string; clientEmail?: string | null; error?: string | null }>({ exists: false });
  const [rosterWorkerStatus, setRosterWorkerStatus] = useState<any | null>(null);
  const [rosterWorkerStatusError, setRosterWorkerStatusError] = useState<string | null>(null);

  // 강의 운영 v2(등급 기반 참여 점검) 설정/상태
  const [courseMembershipAuditConfig, setCourseMembershipAuditConfig] = useState<CourseMembershipAuditConfig | null>(null);
  const [courseMembershipAuditConfigExists, setCourseMembershipAuditConfigExists] = useState<boolean>(false);
  const [courseMembershipAuditConfigPath, setCourseMembershipAuditConfigPath] = useState<string | null>(null);
  const [courseMembershipAuditConfigDirty, setCourseMembershipAuditConfigDirty] = useState<boolean>(false);
  const [courseMembershipAuditConfigSaving, setCourseMembershipAuditConfigSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [courseMembershipAuditConfigError, setCourseMembershipAuditConfigError] = useState<string | null>(null);
  const [courseMembershipAuditServiceAccount, setCourseMembershipAuditServiceAccount] = useState<{ exists: boolean; path?: string; clientEmail?: string | null; error?: string | null }>({ exists: false });
  const [courseMembershipAuditWorkerStatus, setCourseMembershipAuditWorkerStatus] = useState<any | null>(null);
  const [courseMembershipAuditWorkerStatusError, setCourseMembershipAuditWorkerStatusError] = useState<string | null>(null);
  const [newCourseKey, setNewCourseKey] = useState<string>("");

  // 오픈채팅 멤버(전체) Sheets 자동 동기화 워커 설정/상태
  const [openchatMembersSheetsConfig, setOpenchatMembersSheetsConfig] = useState<OpenchatMembersSheetsConfig | null>(null);
  const [openchatMembersSheetsConfigExists, setOpenchatMembersSheetsConfigExists] = useState<boolean>(false);
  const [openchatMembersSheetsConfigPath, setOpenchatMembersSheetsConfigPath] = useState<string | null>(null);
  const [openchatMembersSheetsConfigDirty, setOpenchatMembersSheetsConfigDirty] = useState<boolean>(false);
  const [openchatMembersSheetsConfigSaving, setOpenchatMembersSheetsConfigSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [openchatMembersSheetsConfigError, setOpenchatMembersSheetsConfigError] = useState<string | null>(null);
  const [openchatMembersSheetsServiceAccount, setOpenchatMembersSheetsServiceAccount] = useState<{ exists: boolean; path?: string; clientEmail?: string | null; error?: string | null }>({ exists: false });
  const [openchatMembersSheetsWorkerStatus, setOpenchatMembersSheetsWorkerStatus] = useState<any | null>(null);
  const [openchatMembersSheetsWorkerStatusError, setOpenchatMembersSheetsWorkerStatusError] = useState<string | null>(null);

  // Debug: React 상태 기준 로그 개수 확인용 (UI에 노출)
  const debugCounts = useMemo(() => {
    const roomKeys = Object.keys(roomLogs || {});
    const roomTotal = roomKeys.reduce((acc, rid) => acc + (roomLogs[rid]?.length || 0), 0);
    return {
      allCount: allLogs.length,
      roomKeys: roomKeys.length,
      roomTotal,
    };
  }, [allLogs, roomLogs]);

  const esRef = useRef<EventSource | null>(null);
  const lastUpdateRef = useRef<number>(0);
  const pollBusyRef = useRef<boolean>(false);

  const {
    status: pipelineStatus,
    error: pipelineError,
    refresh: fetchPipelineStatus,
    botRestarting,
    botRestartMessage,
    deviceRepairing,
    deviceRepairMessage,
    restartBot,
    repairDevice,
  } = usePipelineStatus();

  const watchdog = useWatchdog();

  const diagCommand = `cd C:\\dev\\12.kakao && powershell -ExecutionPolicy Bypass -File .\\scripts\\diagnose_realtime.ps1`;

  // Load Redroid ADB device cache (data/redroid_device.json)
  useEffect(() => {
    let cancelled = false;
    let timer: any = null;
    const load = async () => {
      setRedroidDeviceLoading(true);
      try {
        const r = await fetch(`/api/device/redroid`, { cache: "no-store" });
        const j: any = await r.json().catch(() => null);
        if (!r.ok || !j || j.ok !== true) {
          throw new Error(String(j?.error || `HTTP ${r.status}`));
        }
        if (cancelled) return;
        setIrisUrl(String(j.irisUrl || "http://127.0.0.1:5050"));
        setRedroidDevice(String(j.device || ""));
        setRedroidDeviceUpdatedAt(j.updatedAt ? String(j.updatedAt) : null);
        setRedroidDeviceCachePath(j.cachePath ? String(j.cachePath) : null);
        setRedroidVmIp(j.vmIp ? String(j.vmIp) : null);
        setRedroidDetectedDevice(j.detectedDevice ? String(j.detectedDevice) : null);
      } catch (e: any) {
        if (cancelled) return;
        setRedroidDeviceMsg(`ADB 대상 로드 실패: ${String(e?.message || e)}`);
      } finally {
        if (!cancelled) setRedroidDeviceLoading(false);
      }
    };
    void load();
    timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      try { if (timer) clearInterval(timer); } catch {}
    };
  }, []);

  const saveRedroidDevice = useCallback(async () => {
    const v = String(redroidDevice || "").trim();
    if (!v) {
      setRedroidDeviceMsg("ADB 대상(device)이 비어 있습니다. 예) 172.192.204.123 또는 172.192.204.123:5555");
      return;
    }
    setRedroidDeviceSaving(true);
    setRedroidDeviceMsg(null);
    try {
      const r = await fetch(`/api/device/redroid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device: v }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setIrisUrl(String(j.irisUrl || "http://127.0.0.1:5050"));
      setRedroidDevice(String(j.device || v));
      setRedroidDeviceUpdatedAt(j.updatedAt ? String(j.updatedAt) : null);
      setRedroidDeviceCachePath(j.cachePath ? String(j.cachePath) : null);
      setRedroidDeviceMsg("저장 완료. 필요하면 아래 버튼으로 IRIS 복구를 실행하세요.");
    } catch (e: any) {
      setRedroidDeviceMsg(`저장 실패: ${String(e?.message || e)}`);
    } finally {
      setRedroidDeviceSaving(false);
    }
  }, [redroidDevice]);

  // Load rooms list
  useEffect(() => {
    let cancelled = false;
    let timer: any = null;

    const load = async () => {
      try {
        const r = await fetch(`/api/rooms`, { cache: "no-store" });
        const j: any = await r.json().catch(() => null);
        if (!r.ok) {
          const detail = j && typeof j === "object" ? (j.detail || j.error) : "";
          throw new Error(String(detail || `rooms fetch failed: HTTP ${r.status}`));
        }
        if (!Array.isArray(j)) {
          throw new Error("rooms 응답 형식이 올바르지 않습니다(배열 아님)");
        }
        if (cancelled) return;
        setRooms(j as RoomInfo[]);
        setRoomsLoadError(null);
        if (!chosen && j.length) setChosen(undefined);
      } catch (e: any) {
        if (cancelled) return;
        setRooms([]);
        setRoomsLoadError(String(e?.message || e));
      }
    };

    void load();
    // activeMembersCount는 변동 가능하므로 방 메타를 주기적으로 리프레시한다.
    timer = setInterval(() => { void load(); }, 60_000);
    return () => {
      cancelled = true;
      try { if (timer) clearInterval(timer); } catch {}
    };
  }, []);

  // Load runtime (features/excluded)
  useEffect(() => {
    fetch(`/api/runtime`)
      .then((r) => r.json())
      .then((cfg: RuntimeConfig) => {
        setExcluded((cfg?.excludedRoomIds as string[]) || []);
        setFeatures((cfg?.features as Record<string, RoomFeatures>) || {});

        // nicknameReminder schedule (2차/3차 간격) 로드
        try {
          const nr: any = (cfg as any)?.nicknameReminder;
          const l2sec = Number(nr?.warningSchedule?.level2?.afterLastWarnSec);
          const l3sec = Number(nr?.warningSchedule?.level3?.afterLastWarnSec);
          const l2h = Number.isFinite(l2sec) && l2sec >= 0 ? Math.max(0, Math.round(l2sec / 3600)) : 24;
          const l3h = Number.isFinite(l3sec) && l3sec >= 0 ? Math.max(0, Math.round(l3sec / 3600)) : 48;
          setNickRemL2Hours(l2h || 24);
          setNickRemL3Hours(l3h || 48);
          setNickRemSaved({ l2: l2h || 24, l3: l3h || 48 });
          setNickRemError(null);
        } catch {
          // best-effort: keep defaults
        }
      })
      .catch(() => {});
  }, []);

  const nickRemDirty = useMemo(() => {
    if (!nickRemSaved) return false;
    return nickRemL2Hours !== nickRemSaved.l2 || nickRemL3Hours !== nickRemSaved.l3;
  }, [nickRemSaved, nickRemL2Hours, nickRemL3Hours]);

  const loadCourseRosterConfig = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-roster/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setCourseRosterConfigExists(!!j.exists);
      setCourseRosterConfigPath(j.path ? String(j.path) : null);
      setCourseRosterServiceAccount({
        exists: !!j?.serviceAccount?.exists,
        path: j?.serviceAccount?.path ? String(j.serviceAccount.path) : undefined,
        clientEmail: j?.serviceAccount?.clientEmail ? String(j.serviceAccount.clientEmail) : null,
        error: j?.serviceAccount?.error ? String(j.serviceAccount.error) : null,
      });
      const cfg: CourseRosterConfig = (j.config && typeof j.config === "object")
        ? (j.config as CourseRosterConfig)
        : ({ version: 1, rooms: {} } as CourseRosterConfig);
      setCourseRosterConfig(cfg);
      setCourseRosterConfigError(null);
    } catch (e: any) {
      setCourseRosterConfigError(String(e?.message || e));
      setCourseRosterConfig((prev) => prev || ({ version: 1, rooms: {} } as CourseRosterConfig));
    }
  }, []);

  const loadRosterWorkerStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-roster/status`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setRosterWorkerStatus(j);
      setRosterWorkerStatusError(null);
    } catch (e: any) {
      setRosterWorkerStatus(null);
      setRosterWorkerStatusError(String(e?.message || e));
    }
  }, []);

  const loadCourseMembershipAuditConfig = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-membership-audit/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setCourseMembershipAuditConfigExists(!!j.exists);
      setCourseMembershipAuditConfigPath(j.path ? String(j.path) : null);
      setCourseMembershipAuditServiceAccount({
        exists: !!j?.serviceAccount?.exists,
        path: j?.serviceAccount?.path ? String(j.serviceAccount.path) : undefined,
        clientEmail: j?.serviceAccount?.clientEmail ? String(j.serviceAccount.clientEmail) : null,
        error: j?.serviceAccount?.error ? String(j.serviceAccount.error) : null,
      });
      const cfg: CourseMembershipAuditConfig = (j.config && typeof j.config === "object")
        ? (j.config as CourseMembershipAuditConfig)
        : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800 }, courses: {} } as CourseMembershipAuditConfig);
      setCourseMembershipAuditConfig(cfg);
      setCourseMembershipAuditConfigError(null);
    } catch (e: any) {
      setCourseMembershipAuditConfigError(String(e?.message || e));
      setCourseMembershipAuditConfig((prev) => prev || ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800 }, courses: {} } as CourseMembershipAuditConfig));
    }
  }, []);

  const loadCourseMembershipAuditWorkerStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-membership-audit/status`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setCourseMembershipAuditWorkerStatus(j);
      setCourseMembershipAuditWorkerStatusError(null);
    } catch (e: any) {
      setCourseMembershipAuditWorkerStatus(null);
      setCourseMembershipAuditWorkerStatusError(String(e?.message || e));
    }
  }, []);

  const loadOpenchatMembersSheetsConfig = useCallback(async () => {
    try {
      const r = await fetch(`/api/openchat-members-sheets/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setOpenchatMembersSheetsConfigExists(!!j.exists);
      setOpenchatMembersSheetsConfigPath(j.path ? String(j.path) : null);
      setOpenchatMembersSheetsServiceAccount({
        exists: !!j?.serviceAccount?.exists,
        path: j?.serviceAccount?.path ? String(j.serviceAccount.path) : undefined,
        clientEmail: j?.serviceAccount?.clientEmail ? String(j.serviceAccount.clientEmail) : null,
        error: j?.serviceAccount?.error ? String(j.serviceAccount.error) : null,
      });
      const cfg: OpenchatMembersSheetsConfig = (j.config && typeof j.config === "object")
        ? (j.config as OpenchatMembersSheetsConfig)
        : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
      setOpenchatMembersSheetsConfig(cfg);
      setOpenchatMembersSheetsConfigError(null);
    } catch (e: any) {
      setOpenchatMembersSheetsConfigError(String(e?.message || e));
      setOpenchatMembersSheetsConfig((prev) => prev || ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig));
    }
  }, []);

  const loadOpenchatMembersSheetsWorkerStatus = useCallback(async () => {
    try {
      const r = await fetch(`/api/openchat-members-sheets/status`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setOpenchatMembersSheetsWorkerStatus(j);
      setOpenchatMembersSheetsWorkerStatusError(null);
    } catch (e: any) {
      setOpenchatMembersSheetsWorkerStatus(null);
      setOpenchatMembersSheetsWorkerStatusError(String(e?.message || e));
    }
  }, []);

  useEffect(() => {
    void loadCourseRosterConfig();
    void loadRosterWorkerStatus();
    const t = setInterval(() => { void loadRosterWorkerStatus(); }, 5000);
    return () => clearInterval(t);
  }, [loadCourseRosterConfig, loadRosterWorkerStatus]);

  useEffect(() => {
    void loadCourseMembershipAuditConfig();
    void loadCourseMembershipAuditWorkerStatus();
    const t = setInterval(() => { void loadCourseMembershipAuditWorkerStatus(); }, 5000);
    return () => clearInterval(t);
  }, [loadCourseMembershipAuditConfig, loadCourseMembershipAuditWorkerStatus]);

  useEffect(() => {
    void loadOpenchatMembersSheetsConfig();
    void loadOpenchatMembersSheetsWorkerStatus();
    const t = setInterval(() => { void loadOpenchatMembersSheetsWorkerStatus(); }, 5000);
    return () => clearInterval(t);
  }, [loadOpenchatMembersSheetsConfig, loadOpenchatMembersSheetsWorkerStatus]);

  const onUpdateCourseRosterRoomConfig = useCallback((roomId: string, patch: Partial<CourseRosterRoomConfig>) => {
    const rid = String(roomId || "").trim();
    if (!rid) return;
    setCourseRosterConfig((prev) => {
      const base: CourseRosterConfig = (prev && typeof prev === "object") ? prev : ({ version: 1, rooms: {} } as CourseRosterConfig);
      const nextRooms: Record<string, any> = { ...(base.rooms || {}) };
      const cur = (nextRooms[rid] && typeof nextRooms[rid] === "object") ? nextRooms[rid] : {};
      nextRooms[rid] = { ...cur, ...patch };
      // UX: enabled 기본값
      if (nextRooms[rid].enabled === undefined) nextRooms[rid].enabled = true;
      return { ...base, version: Number(base.version) || 1, rooms: nextRooms };
    });
    setCourseRosterConfigDirty(true);
  }, []);

  const addCourseMembershipAuditCourse = useCallback(() => {
    const ck = String(newCourseKey || "").trim();
    if (!ck) return;
    setCourseMembershipAuditConfig((prev) => {
      const base: CourseMembershipAuditConfig = (prev && typeof prev === "object")
        ? prev
        : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
      const courses: Record<string, any> = { ...(base.courses || {}) };
      if (courses[ck]) return base;
      courses[ck] = {
        enabled: true,
        clubId: "",
        spreadsheetId: "",
        tabs: { cafeRaw: "CAFE_RAW", openchatRaw: "OPENCHAT_RAW", rulesRaw: "RULES_RAW", audit: "AUDIT_VIEW", auditLog: "AUDIT_LOG" },
        gradeRules: { premiumGrades: [], staffGrades: [] },
        rooms: { chat: "", notice: "", premium: "" },
      };
      return { ...base, version: Number(base.version) || 1, courses };
    });
    setNewCourseKey("");
    setCourseMembershipAuditConfigDirty(true);
  }, [newCourseKey]);

  const deleteCourseMembershipAuditCourse = useCallback((courseKey: string) => {
    const ck = String(courseKey || "").trim();
    if (!ck) return;
    setCourseMembershipAuditConfig((prev) => {
      const base: CourseMembershipAuditConfig = (prev && typeof prev === "object")
        ? prev
        : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800 }, courses: {} } as CourseMembershipAuditConfig);
      const courses: Record<string, any> = { ...(base.courses || {}) };
      delete courses[ck];
      return { ...base, version: Number(base.version) || 1, courses };
    });
    setCourseMembershipAuditConfigDirty(true);
  }, []);

  const updateCourseMembershipAuditCourse = useCallback((courseKey: string, patch: any) => {
    const ck = String(courseKey || "").trim();
    if (!ck) return;
    setCourseMembershipAuditConfig((prev) => {
      const base: CourseMembershipAuditConfig = (prev && typeof prev === "object")
        ? prev
        : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800 }, courses: {} } as CourseMembershipAuditConfig);
      const courses: Record<string, any> = { ...(base.courses || {}) };
      const cur = (courses[ck] && typeof courses[ck] === "object") ? courses[ck] : {};
      const next: any = { ...cur, ...patch };
      if (patch && typeof patch === "object") {
        if (patch.tabs && typeof patch.tabs === "object") next.tabs = { ...(cur.tabs || {}), ...(patch.tabs || {}) };
        if (patch.gradeRules && typeof patch.gradeRules === "object") next.gradeRules = { ...(cur.gradeRules || {}), ...(patch.gradeRules || {}) };
        if (patch.rooms && typeof patch.rooms === "object") next.rooms = { ...(cur.rooms || {}), ...(patch.rooms || {}) };
      }
      courses[ck] = next;
      return { ...base, version: Number(base.version) || 1, courses };
    });
    setCourseMembershipAuditConfigDirty(true);
  }, []);

  const parseListLines = useCallback((raw: string): string[] => {
    const parts = String(raw || "").split(/\r?\n|,|;/g).map((s) => s.trim()).filter((s) => !!s);
    return Array.from(new Set(parts));
  }, []);

  const onUpdateOpenchatMembersSheetsRoomConfig = useCallback((roomId: string, patch: Partial<OpenchatMembersSheetsRoomConfig>) => {
    const rid = String(roomId || "").trim();
    if (!rid) return;
    setOpenchatMembersSheetsConfig((prev) => {
      const base: OpenchatMembersSheetsConfig = (prev && typeof prev === "object")
        ? prev
        : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
      const nextRooms: Record<string, any> = { ...(base.rooms || {}) };
      const cur = (nextRooms[rid] && typeof nextRooms[rid] === "object") ? nextRooms[rid] : {};
      nextRooms[rid] = { ...cur, ...patch };
      return { ...base, version: Number(base.version) || 1, rooms: nextRooms };
    });
    setOpenchatMembersSheetsConfigDirty(true);
  }, []);

  const saveCourseRosterConfig = useCallback(async (): Promise<boolean> => {
    try {
      setCourseRosterConfigSaving("saving");
      const cfg = courseRosterConfig && typeof courseRosterConfig === "object"
        ? courseRosterConfig
        : ({ version: 1, rooms: {} } as CourseRosterConfig);

      const inRooms = (cfg.rooms && typeof cfg.rooms === "object") ? cfg.rooms : {};
      const outRooms: Record<string, CourseRosterRoomConfig> = {};
      for (const [rid, v] of Object.entries(inRooms || {})) {
        const cur: any = (v && typeof v === "object") ? v : {};
        const rosterSheetNameRaw = String(cur.rosterSheetName || "").trim();
        const roomName = String(rooms.find((r) => r.roomId === rid)?.roomName || "");
        const rosterSheetName = rosterSheetNameRaw || inferCourseRosterSheetName(roomName);
        outRooms[String(rid)] = { ...cur, rosterSheetName };
      }
      const normalized: CourseRosterConfig = { ...cfg, version: Number(cfg.version) || 1, rooms: outRooms };
      const r = await fetch(`/api/course-roster/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: normalized }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setCourseRosterConfigDirty(false);
      setCourseRosterConfigSaving("saved");
      setTimeout(() => setCourseRosterConfigSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      await loadCourseRosterConfig();
      return true;
    } catch (e: any) {
      setCourseRosterConfigSaving("error");
      setCourseRosterConfigError(String(e?.message || e));
      return false;
    }
  }, [courseRosterConfig, loadCourseRosterConfig, rooms]);

  const saveCourseMembershipAuditConfig = useCallback(async (): Promise<boolean> => {
    try {
      setCourseMembershipAuditConfigSaving("saving");
      const cfg = courseMembershipAuditConfig && typeof courseMembershipAuditConfig === "object"
        ? courseMembershipAuditConfig
        : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800 }, courses: {} } as CourseMembershipAuditConfig);
      const r = await fetch(`/api/course-membership-audit/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setCourseMembershipAuditConfigDirty(false);
      setCourseMembershipAuditConfigSaving("saved");
      setTimeout(() => setCourseMembershipAuditConfigSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      await loadCourseMembershipAuditConfig();
      return true;
    } catch (e: any) {
      setCourseMembershipAuditConfigSaving("error");
      setCourseMembershipAuditConfigError(String(e?.message || e));
      return false;
    }
  }, [courseMembershipAuditConfig, loadCourseMembershipAuditConfig]);

  const saveOpenchatMembersSheetsConfig = useCallback(async (): Promise<boolean> => {
    try {
      setOpenchatMembersSheetsConfigSaving("saving");
      const cfg = openchatMembersSheetsConfig && typeof openchatMembersSheetsConfig === "object"
        ? openchatMembersSheetsConfig
        : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
      const r = await fetch(`/api/openchat-members-sheets/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      setOpenchatMembersSheetsConfigDirty(false);
      setOpenchatMembersSheetsConfigSaving("saved");
      setTimeout(() => setOpenchatMembersSheetsConfigSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      await loadOpenchatMembersSheetsConfig();
      return true;
    } catch (e: any) {
      setOpenchatMembersSheetsConfigSaving("error");
      setOpenchatMembersSheetsConfigError(String(e?.message || e));
      return false;
    }
  }, [openchatMembersSheetsConfig, loadOpenchatMembersSheetsConfig]);

  const uploadServiceAccount = useCallback(async (file: File): Promise<boolean> => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/course-roster/service-account`, { method: "POST", body: fd });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      await loadCourseRosterConfig();
      await loadCourseMembershipAuditConfig();
      await loadOpenchatMembersSheetsConfig();
      return true;
    } catch (e: any) {
      setCourseRosterConfigError(String(e?.message || e));
      setCourseMembershipAuditConfigError(String(e?.message || e));
      setOpenchatMembersSheetsConfigError(String(e?.message || e));
      return false;
    }
  }, [loadCourseRosterConfig, loadCourseMembershipAuditConfig, loadOpenchatMembersSheetsConfig]);

  const restartRosterWorker = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-roster/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      // 상태는 polling으로 갱신됨
    } catch (e: any) {
      setRosterWorkerStatusError(String(e?.message || e));
    }
  }, []);

  const restartOpenchatMembersSheetsWorker = useCallback(async () => {
    try {
      const r = await fetch(`/api/openchat-members-sheets/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      // 상태는 polling으로 갱신됨
    } catch (e: any) {
      setOpenchatMembersSheetsWorkerStatusError(String(e?.message || e));
    }
  }, []);

  const restartCourseMembershipAuditWorker = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-membership-audit/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        throw new Error(String(j?.error || `HTTP ${r.status}`));
      }
      // 상태는 polling으로 갱신됨
    } catch (e: any) {
      setCourseMembershipAuditWorkerStatusError(String(e?.message || e));
    }
  }, []);

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
          const arr: LogEntry[] = data.all;
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
  }, [chosen, include, exclude, limit, connectionVersion]);

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
          const payload: BulkLogsResponse = await r.json();
          const roomsObj: Record<string, LogEntry[]> =
            (payload.rooms as Record<string, LogEntry[]>) || {};
          setRoomLogs((prev) => {
            const next = { ...prev } as Record<string, LogEntry[]>;
            for (const rid of Object.keys(roomsObj)) {
              const arr: LogEntry[] = roomsObj[rid] || [];
              next[rid] = dedupLogs(arr, limit);
            }
            return next;
          });
        }
      } catch { }
    })().catch(() => { });
  }, [rooms, showExcluded, excluded.join(","), limit]);

  // When a room emits logs but is not in /rooms list yet, add it so it appears without reload.
  useEffect(() => {
    const keys = Object.keys(roomLogs || {});
    if (keys.length === 0) return;
    setRooms((prev) => {
      const known = new Set((prev || []).map((r) => r.roomId));
      let changed = false;
      const next = [...(prev || [])];
      for (const rid of keys) {
        if (known.has(rid)) continue;
        const arr = roomLogs[rid] || [];
        if (!arr.length) continue;
        const last = arr[arr.length - 1];
        next.push({ roomId: rid, roomName: last?.roomName || rid });
        known.add(rid);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [roomLogs]);

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
          const data: BulkLogsResponse = await r.json();
          if (data.all) {
            setAllLogs(() => dedupLogs(data.all as LogEntry[], limit));
          }
          if (data.all) {
            const arr: LogEntry[] = data.all;
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
  }, [status, include, exclude, limit]);

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

  const updateRuntime = async (next: {
    features?: Record<string, RoomFeatures>;
    excludedRoomIds?: string[];
  }) => {
    const res = { ok: false };
    try {
      const nextFeatures: Record<string, RoomFeatures> =
        next.features ?? features;
      const nextExcluded = next.excludedRoomIds ?? excluded;
      // allowedRoomIds: 기능이 하나라도 켜진 방 중 제외되지 않은 방
      const allowedRoomIds = Object.keys(nextFeatures || {}).filter(rid => {
        if (nextExcluded.includes(rid)) return false;
        const f = nextFeatures[rid] || {};
        return !!(f.welcome || f.broadcast || f.schedules || f.ai || f.chatSummary || f.commands || f.autoFaq || f.courseRoster || f.nicknameReminder || f.imageGen || f.videoGen);
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
      const cfg: RuntimeConfig = await (await fetch(`/api/runtime`)).json();
      setExcluded((cfg?.excludedRoomIds as string[]) || []);
      setFeatures((cfg?.features as Record<string, RoomFeatures>) || {});
    } catch {
      res.ok = false;
    }
    return res.ok;
  };

  const saveNickRemSchedule = useCallback(async () => {
    const h2 = Math.floor(Number(nickRemL2Hours));
    const h3 = Math.floor(Number(nickRemL3Hours));
    if (!Number.isFinite(h2) || h2 <= 0) {
      setNickRemError("2차 간격은 1시간 이상 숫자로 입력해 주세요.");
      return false;
    }
    if (!Number.isFinite(h3) || h3 <= 0) {
      setNickRemError("3차 간격은 1시간 이상 숫자로 입력해 주세요.");
      return false;
    }

    setNickRemSaving("saving");
    setNickRemError(null);
    try {
      const body = {
        nicknameReminder: {
          warningSchedule: {
            level2: { afterLastWarnSec: h2 * 3600 },
            level3: { afterLastWarnSec: h3 * 3600 },
          },
        },
      };
      const r = await fetch(`/api/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) {
        const detail = j && typeof j === "object" ? (j.detail || j.error) : "";
        throw new Error(String(detail || `HTTP ${r.status}`));
      }
      // refresh runtime snapshot (single source of truth)
      const cfg: RuntimeConfig = await (await fetch(`/api/runtime`, { cache: "no-store" })).json();
      const nr: any = (cfg as any)?.nicknameReminder;
      const l2sec = Number(nr?.warningSchedule?.level2?.afterLastWarnSec);
      const l3sec = Number(nr?.warningSchedule?.level3?.afterLastWarnSec);
      const l2h = Number.isFinite(l2sec) && l2sec > 0 ? Math.max(1, Math.round(l2sec / 3600)) : h2;
      const l3h = Number.isFinite(l3sec) && l3sec > 0 ? Math.max(1, Math.round(l3sec / 3600)) : h3;
      setNickRemSaved({ l2: l2h, l3: l3h });
      setNickRemL2Hours(l2h);
      setNickRemL3Hours(l3h);
      setNickRemSaving("saved");
      setTimeout(() => setNickRemSaving((cur) => (cur === "saved" ? "idle" : cur)), 2000);
      return true;
    } catch (e: any) {
      setNickRemSaving("error");
      setNickRemError(`저장 실패: ${String(e?.message || e)}`);
      return false;
    }
  }, [nickRemL2Hours, nickRemL3Hours]);

  const onSaveRoom = async (rid: string) => {
    setSavingRooms(prev => ({ ...prev, [rid]: "saving" }));
    const next = { ...features };
    next[rid] = next[rid] || {};
    const okRuntime = await updateRuntime({ features: next, excludedRoomIds: excluded });
    const okCourse = courseRosterConfigDirty ? await saveCourseRosterConfig() : true;
    const okCourseAudit = courseMembershipAuditConfigDirty ? await saveCourseMembershipAuditConfig() : true;
    const okMembersSheets = openchatMembersSheetsConfigDirty ? await saveOpenchatMembersSheetsConfig() : true;
    const ok = okRuntime && okCourse && okCourseAudit && okMembersSheets;
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
    try {
      const r = await fetch(`${REALTIME_BASE}/avatar/${rid}`, { method: 'POST', body: fd });
      if (r.ok) {
        setAvatarVersions(prev => ({ ...prev, [rid]: (prev[rid] || 0) + 1 }));
      }
    }
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

  const visibleRooms = useMemo(() => {
    const withLogs = (rooms || []).filter((r) => (roomLogs[r.roomId]?.length || 0) > 0);
    const filtered = withLogs.filter((r) => (showExcluded ? true : !excluded.includes(r.roomId)));
    return filtered;
  }, [rooms, roomLogs, showExcluded, excluded]);

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
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
          <button
            className="btn-outline"
            onClick={async () => {
              if (!confirm('Watchdog를 재시작할까요? (자동 복구 루프 재개)')) return;
              try {
                const r = await fetch('/api/watchdog', { method: 'POST' });
                const j: any = await r.json().catch(() => null);
                if (!r.ok || !j || j.ok !== true) {
                  throw new Error(String(j?.error || `HTTP ${r.status}`));
                }
                alert(`재시작 요청 완료 (pid=${j.pid ?? '?'})`);
              } catch (e: any) {
                alert(`Watchdog 재시작 실패: ${e?.message || e}`);
              }
            }}
            title="windows/ensure_watchdog.ps1 -Restart"
          >
            Watchdog 재시작
          </button>
        </div>
        <pre style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 8, padding: 10, maxHeight: 140, overflow: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {watchdog.lines?.slice(-10).join('\n') || '로그 없음'}
        </pre>
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
          디버그 · allLogs: {debugCounts.allCount}개 / roomLogs: {debugCounts.roomKeys}방, 총 {debugCounts.roomTotal}행
        </div>
      </div>

      {/* IRIS/Redroid 연결(ADB IP) */}
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>IRIS 연결 (Hyper-V IP/ADB)</h3>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8, lineHeight: 1.5 }}>
          - 앱이 IRIS를 확인하는 주소: <code>{irisUrl}</code>
          <br />
          - IRIS 복구 스크립트가 ADB로 붙을 대상(캐시):{" "}
          <code title={redroidDeviceCachePath || ""}>{redroidDevice || "(없음)"}</code>
          {redroidDeviceUpdatedAt ? (
            <>
              {" "}
              <span style={{ color: "var(--text-muted)" }}>
                (갱신: {new Date(redroidDeviceUpdatedAt).toLocaleString()})
              </span>
            </>
          ) : null}
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <input
            className="filter-input"
            style={{ minWidth: 260, maxWidth: 420 }}
            value={redroidDevice}
            disabled={redroidDeviceLoading || redroidDeviceSaving}
            onChange={(e) => setRedroidDevice(e.target.value)}
            placeholder="예) 172.192.204.123 또는 172.192.204.123:5555"
          />
          <button className="btn-save" onClick={() => void saveRedroidDevice()} disabled={redroidDeviceSaving || redroidDeviceLoading}>
            {redroidDeviceSaving ? "저장 중…" : "ADB 대상 저장"}
          </button>
          <button
            className="btn-outline"
            onClick={() => {
              if (redroidDetectedDevice) {
                setRedroidDevice(redroidDetectedDevice);
                setRedroidDeviceMsg(`자동 감지값을 입력했습니다: ${redroidDetectedDevice}`);
              }
            }}
            disabled={!redroidDetectedDevice || redroidDeviceLoading || redroidDeviceSaving}
            title="Hyper-V(MAC→ARP) 기반으로 Windows에서 도달 가능한 IP를 추정합니다."
          >
            자동 감지값 적용
          </button>
          <button
            className="btn-outline"
            onClick={() => {
              const v = String(redroidDevice || "").trim();
              if (v) navigator.clipboard?.writeText?.(v);
              alert("Hyper-V에서 `hostname -I`로 나온 IP 중 ADB용 IP를 넣으세요.\n예) 172.192.204.123 (권장) / 172.17.0.1 (대개 내부 브릿지)\n\n현재 입력값을 복사했습니다.");
            }}
            disabled={!String(redroidDevice || "").trim()}
            title="입력값 복사 + 안내"
          >
            복사/안내
          </button>
          <button
            className="btn-outline"
            onClick={() => void repairDevice(String(redroidDevice || "").trim() || undefined)}
            disabled={deviceRepairing}
            title="windows/repair_redroid_iris.ps1 -Fix (-Device 옵션 포함)"
          >
            {deviceRepairing ? "복구 실행 중…" : "IRIS 복구 실행"}
          </button>
        </div>
        {(redroidDeviceMsg || deviceRepairMessage) && (
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {redroidDeviceMsg && <div>{redroidDeviceMsg}</div>}
            {deviceRepairMessage && <div>{deviceRepairMessage}</div>}
          </div>
        )}
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          - watchdog에서 IRIS /config가 연속 실패하면 <code>repair_redroid_iris.ps1 -Fix</code>가 실행됩니다.
          캐시가 예전 IP(예: <code>172.20.x.x:5555</code>)면 Hyper-V IP 변경 시 복구가 계속 실패할 수 있습니다.
          {redroidVmIp ? (
            <>
              <br />- (참고) Windows에서 감지한 redroid VM IP: <code>{redroidVmIp}</code> (권장 ADB 대상:{" "}
              <code>{redroidDetectedDevice || `${redroidVmIp}:5555`}</code>)
            </>
          ) : null}
        </div>
      </div>

      {/* 기본닉 멘션(닉네임 변경 요청) 전역 설정 */}
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>기본닉 멘션(닉네임 변경 요청) 설정</h3>
        <div style={{ color: 'var(--text-secondary)', fontSize: 13, marginBottom: 8, lineHeight: 1.5 }}>
          - 방 카드에서 <b>기본닉 멘션</b> 토글을 켠 방만 대상입니다.
          <br />
          - 2차/3차는 “이전 안내 발신 이후” 기준입니다. (기본: 2차 24시간, 3차 48시간)
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            2차 간격(시간)
            <input
              type="number"
              min={1}
              max={720}
              value={nickRemL2Hours}
              onChange={(e) => setNickRemL2Hours(parseInt(e.target.value || "24", 10) || 24)}
              className="filter-input"
              style={{ width: 120, height: 34, marginBottom: 0 }}
            />
          </label>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, color: 'var(--text-secondary)' }}>
            3차 간격(시간)
            <input
              type="number"
              min={1}
              max={720}
              value={nickRemL3Hours}
              onChange={(e) => setNickRemL3Hours(parseInt(e.target.value || "48", 10) || 48)}
              className="filter-input"
              style={{ width: 120, height: 34, marginBottom: 0 }}
            />
          </label>
          <button className="btn-save" onClick={() => void saveNickRemSchedule()} disabled={!nickRemDirty || nickRemSaving === "saving"}>
            {nickRemSaving === "saving" ? "저장 중…" : nickRemDirty ? "저장" : "저장됨"}
          </button>
          <span className={`tag ${nickRemSaving === "error" ? "tag-excluded" : nickRemDirty ? "tag-inactive" : "tag-active"}`}>
            {nickRemSaving === "error" ? "오류" : nickRemDirty ? "저장 필요" : "OK"}
          </span>
        </div>
        {(nickRemError) && (
          <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            {nickRemError}
          </div>
        )}
      </div>

      {/* 강의 운영(roster-worker) 상태/설정 */}
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>강의 운영 (카페/닉네임 검증)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span className={`tag ${courseRosterConfigDirty ? 'tag-inactive' : 'tag-active'}`}>
            설정 {courseRosterConfigDirty ? '저장 필요' : 'OK'}
          </span>
          <span className="tag tag-excluded" title={courseRosterConfigPath || ''}>
            설정파일 {courseRosterConfigExists ? 'OK' : '없음'}
          </span>
          <span className="tag tag-excluded" title={courseRosterServiceAccount.path || ''}>
            서비스계정 {courseRosterServiceAccount.exists ? 'OK' : '없음'}
          </span>
          {courseRosterServiceAccount.clientEmail && (
            <span className="tag tag-excluded" title="서비스계정 이메일">
              {courseRosterServiceAccount.clientEmail}
            </span>
          )}
          <span className="tag tag-excluded" title="roster-worker heartbeat/status">
            워커 {rosterWorkerStatus?.status?.pid ? `RUN(pid=${rosterWorkerStatus.status.pid})` : 'N/A'}
          </span>
          <span className="tag tag-excluded" title="pending tracking count">
            pending {typeof rosterWorkerStatus?.status?.pending === 'number' ? rosterWorkerStatus.status.pending : '—'}
          </span>
          <button
            className="btn-outline"
            style={{ padding: '6px 10px', fontSize: 12 }}
            onClick={() => void restartRosterWorker()}
            title="windows/start_roster_worker.ps1 -Restart"
          >
            워커 재시작
          </button>
          <button
            className="btn-save"
            style={{ padding: '6px 10px', fontSize: 12 }}
            disabled={courseRosterConfigSaving === 'saving' || !courseRosterConfigDirty}
            onClick={() => void saveCourseRosterConfig()}
            title="data/course_roster_worker.json 저장"
          >
            {courseRosterConfigSaving === 'saving' ? '저장 중…' : '강의설정 저장'}
          </button>
          <label className="btn-outline" style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer' }} title="data/gcp_service_account.json 업로드">
            서비스계정 업로드
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadServiceAccount(f);
              }}
            />
          </label>
        </div>
        {(courseRosterConfigError || rosterWorkerStatusError || courseRosterServiceAccount.error) && (
          <div style={{ fontSize: 12, color: 'var(--error)', lineHeight: 1.5 }}>
            {courseRosterConfigError && (<div>설정 로드/저장 오류: <code>{courseRosterConfigError}</code></div>)}
            {courseRosterServiceAccount.error && (<div>서비스계정 파싱 오류: <code>{courseRosterServiceAccount.error}</code></div>)}
            {rosterWorkerStatusError && (<div>워커 상태 조회 오류: <code>{rosterWorkerStatusError}</code></div>)}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          - 상단 <b>강의 운영</b> 탭(코스별) 또는 방 카드의 <b>강의 운영</b> 섹션에서 스프레드시트/카페 URL/가입 URL을 설정하고 <b>저장</b>하면, roster-worker가 신규 입장자 기준으로 입장 후 15분/24시간에 최대 2회 안내(Reply/멘션) + Sheets 업서트를 수행합니다. (SAFE_MODE면 발신 스킵, CSV는 레거시 옵션)
        </div>
      </div>

      {/* 강의 운영 v2(등급 기반 참여 점검) 설정/상태 */}
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>강의 운영 v2 (등급 기반 참여 점검)</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span className={`tag ${courseMembershipAuditConfigDirty ? 'tag-inactive' : 'tag-active'}`}>
            설정 {courseMembershipAuditConfigDirty ? '저장 필요' : 'OK'}
          </span>
          <span className="tag tag-excluded" title={courseMembershipAuditConfigPath || ''}>
            설정파일 {courseMembershipAuditConfigExists ? 'OK' : '없음'}
          </span>
          <span className="tag tag-excluded" title={courseMembershipAuditServiceAccount.path || ''}>
            서비스계정 {courseMembershipAuditServiceAccount.exists ? 'OK' : '없음'}
          </span>
          {courseMembershipAuditServiceAccount.clientEmail && (
            <span className="tag tag-excluded" title="서비스계정 이메일">
              {courseMembershipAuditServiceAccount.clientEmail}
            </span>
          )}
          <span className="tag tag-excluded" title="course-membership-audit-worker heartbeat/status">
            워커 {courseMembershipAuditWorkerStatus?.status?.pid ? `RUN(pid=${courseMembershipAuditWorkerStatus.status.pid})` : 'N/A'}
          </span>
          <button
            className="btn-outline"
            style={{ padding: '6px 10px', fontSize: 12 }}
            onClick={() => void restartCourseMembershipAuditWorker()}
            title="windows/start_course_membership_audit_worker.ps1 -Restart"
          >
            워커 재시작
          </button>
          <button
            className="btn-save"
            style={{ padding: '6px 10px', fontSize: 12 }}
            disabled={courseMembershipAuditConfigSaving === 'saving' || !courseMembershipAuditConfigDirty}
            onClick={() => void saveCourseMembershipAuditConfig()}
            title="data/course_membership_audit.json 저장"
          >
            {courseMembershipAuditConfigSaving === 'saving' ? '저장 중…' : 'v2 설정 저장'}
          </button>
          <label className="btn-outline" style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer' }} title="data/gcp_service_account.json 업로드">
            서비스계정 업로드
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadServiceAccount(f);
              }}
            />
          </label>
        </div>

        {(courseMembershipAuditConfigError || courseMembershipAuditWorkerStatusError || courseMembershipAuditServiceAccount.error) && (
          <div style={{ fontSize: 12, color: 'var(--error)', lineHeight: 1.5 }}>
            {courseMembershipAuditConfigError && (<div>설정 로드/저장 오류: <code>{courseMembershipAuditConfigError}</code></div>)}
            {courseMembershipAuditServiceAccount.error && (<div>서비스계정 파싱 오류: <code>{courseMembershipAuditServiceAccount.error}</code></div>)}
            {courseMembershipAuditWorkerStatusError && (<div>워커 상태 조회 오류: <code>{courseMembershipAuditWorkerStatusError}</code></div>)}
          </div>
        )}

        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          - Sheets 업서트는 <b>Chrome 로그인</b>이 아니라 <b>서비스계정 권한</b>이 필요합니다. (시트 문서에 위 이메일을 <b>Editor</b>로 공유)
          <br />
          - 코스별 1개 스프레드시트에 탭을 고정해서 씁니다: <code>CAFE_RAW</code> / <code>OPENCHAT_RAW</code> / <code>RULES_RAW</code> / <code>AUDIT_VIEW</code>
        </div>

        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <label className="tag tag-excluded" style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="enabled=true면 워커가 주기적으로 점검/업서트를 수행합니다.">
            <input
              type="checkbox"
              checked={!!courseMembershipAuditConfig?.worker?.enabled}
              onChange={(e) => {
                setCourseMembershipAuditConfig((prev) => {
                  const base = (prev && typeof prev === "object")
                    ? prev
                    : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                  const w = { ...(base.worker || {}), enabled: e.target.checked };
                  return { ...base, worker: w };
                });
                setCourseMembershipAuditConfigDirty(true);
              }}
            />
            자동 점검 워커
          </label>
          <input
            type="number"
            value={String(courseMembershipAuditConfig?.worker?.hotIntervalSec ?? 600)}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCourseMembershipAuditConfig((prev) => {
                const base = (prev && typeof prev === "object")
                  ? prev
                  : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                const w = { ...(base.worker || {}), hotIntervalSec: Number.isFinite(n) ? n : 600 };
                return { ...base, worker: w };
              });
              setCourseMembershipAuditConfigDirty(true);
            }}
            placeholder="초반 주기(초)"
            className="filter-input"
            style={{ width: 140, height: 34, marginBottom: 0 }}
            title="초기(기본 2주) 주기(초)"
          />
          <input
            type="number"
            value={String(courseMembershipAuditConfig?.worker?.hotDays ?? 14)}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCourseMembershipAuditConfig((prev) => {
                const base = (prev && typeof prev === "object")
                  ? prev
                  : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                const w = { ...(base.worker || {}), hotDays: Number.isFinite(n) ? n : 14 };
                return { ...base, worker: w };
              });
              setCourseMembershipAuditConfigDirty(true);
            }}
            placeholder="초반 일수"
            className="filter-input"
            style={{ width: 120, height: 34, marginBottom: 0 }}
            title="초반 유지 기간(일)"
          />
          <input
            type="number"
            value={String(courseMembershipAuditConfig?.worker?.steadyIntervalSec ?? 10800)}
            onChange={(e) => {
              const n = Number(e.target.value);
              setCourseMembershipAuditConfig((prev) => {
                const base = (prev && typeof prev === "object")
                  ? prev
                  : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                const w = { ...(base.worker || {}), steadyIntervalSec: Number.isFinite(n) ? n : 10800 };
                return { ...base, worker: w };
              });
              setCourseMembershipAuditConfigDirty(true);
            }}
            placeholder="안정기 주기(초)"
            className="filter-input"
            style={{ width: 160, height: 34, marginBottom: 0 }}
            title="안정기 주기(초)"
          />
        </div>

        <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <input
            value={String(courseMembershipAuditConfig?.worker?.crawler?.repoPath || "")}
            onChange={(e) => {
              setCourseMembershipAuditConfig((prev) => {
                const base = (prev && typeof prev === "object")
                  ? prev
                  : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                const crawler = { ...(base.worker?.crawler || {}), repoPath: e.target.value };
                const w = { ...(base.worker || {}), crawler };
                return { ...base, worker: w };
              });
              setCourseMembershipAuditConfigDirty(true);
            }}
            placeholder="crawler repoPath (예: C:\\dev\\naver-cafe-member-crawler)"
            className="filter-input"
            style={{ flex: 1, minWidth: 320, height: 34, marginBottom: 0 }}
          />
          <input
            value={String(courseMembershipAuditConfig?.worker?.crawler?.pythonExe || "")}
            onChange={(e) => {
              setCourseMembershipAuditConfig((prev) => {
                const base = (prev && typeof prev === "object")
                  ? prev
                  : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                const crawler = { ...(base.worker?.crawler || {}), pythonExe: e.target.value };
                const w = { ...(base.worker || {}), crawler };
                return { ...base, worker: w };
              });
              setCourseMembershipAuditConfigDirty(true);
            }}
            placeholder="crawler pythonExe (예: ...\\venv\\Scripts\\python.exe)"
            className="filter-input"
            style={{ flex: 1, minWidth: 320, height: 34, marginBottom: 0 }}
          />
          <input
            value={String(courseMembershipAuditConfig?.worker?.crawler?.settingsPath || "")}
            onChange={(e) => {
              setCourseMembershipAuditConfig((prev) => {
                const base = (prev && typeof prev === "object")
                  ? prev
                  : ({ version: 1, worker: { enabled: false, hotIntervalSec: 600, hotDays: 14, steadyIntervalSec: 10800, crawler: { repoPath: "", pythonExe: "", settingsPath: "" } }, courses: {} } as CourseMembershipAuditConfig);
                const crawler = { ...(base.worker?.crawler || {}), settingsPath: e.target.value };
                const w = { ...(base.worker || {}), crawler };
                return { ...base, worker: w };
              });
              setCourseMembershipAuditConfigDirty(true);
            }}
            placeholder="crawler settingsPath (빈칸이면 자동 탐색)"
            className="filter-input"
            style={{ flex: 1, minWidth: 260, height: 34, marginBottom: 0 }}
          />
        </div>

        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
            <input
              value={newCourseKey}
              onChange={(e) => setNewCourseKey(e.target.value)}
              placeholder="코스키(예: 쇼투벤 3기)"
              className="filter-input"
              style={{ width: 220, height: 34, marginBottom: 0 }}
            />
            <button className="btn-outline" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => addCourseMembershipAuditCourse()}>
              코스 추가
            </button>
            <span className="tag tag-excluded" title="courses 개수">
              {Object.keys(courseMembershipAuditConfig?.courses || {}).length} courses
            </span>
          </div>

          {Object.entries(courseMembershipAuditConfig?.courses || {})
            .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
            .map(([ck, c]) => {
              const cc: any = c as any;
              const premiumTxt = Array.isArray(cc?.gradeRules?.premiumGrades) ? cc.gradeRules.premiumGrades.join("\n") : "";
              const staffTxt = Array.isArray(cc?.gradeRules?.staffGrades) ? cc.gradeRules.staffGrades.join("\n") : "";
              return (
                <div key={ck} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 10 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 8 }}>
                    <span className="tag tag-excluded" title="courseKey">{ck}</span>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                      <input
                        type="checkbox"
                        checked={cc?.enabled !== false}
                        onChange={(e) => updateCourseMembershipAuditCourse(ck, { enabled: e.target.checked })}
                      />
                      enabled
                    </label>
                    <button
                      className="btn-outline"
                      style={{ padding: '6px 10px', fontSize: 12 }}
                      onClick={() => deleteCourseMembershipAuditCourse(ck)}
                      title="courses에서 제거(저장 필요)"
                    >
                      삭제
                    </button>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                    <input
                      value={String(cc?.clubId || "")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { clubId: e.target.value })}
                      placeholder="clubId (네이버 카페)"
                      className="filter-input"
                      style={{ width: 220, height: 34, marginBottom: 0 }}
                    />
                    <input
                      value={String(cc?.spreadsheetId || "")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { spreadsheetId: e.target.value })}
                      placeholder="Spreadsheet ID/URL"
                      className="filter-input"
                      style={{ flex: 1, minWidth: 320, height: 34, marginBottom: 0 }}
                    />
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start', marginTop: 8 }}>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>premiumGrades (1줄=1개)</div>
                      <textarea
                        value={premiumTxt}
                        onChange={(e) => updateCourseMembershipAuditCourse(ck, { gradeRules: { premiumGrades: parseListLines(e.target.value) } })}
                        className="filter-input"
                        style={{ width: '100%', height: 90, resize: 'vertical' }}
                        placeholder="예: 프리미엄반"
                      />
                    </div>
                    <div style={{ flex: 1, minWidth: 260 }}>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>staffGrades (운영진, 1줄=1개)</div>
                      <textarea
                        value={staffTxt}
                        onChange={(e) => updateCourseMembershipAuditCourse(ck, { gradeRules: { staffGrades: parseListLines(e.target.value) } })}
                        className="filter-input"
                        style={{ width: '100%', height: 90, resize: 'vertical' }}
                        placeholder="예: 운영진"
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 8 }}>
                    <input
                      value={String(cc?.tabs?.cafeRaw || "CAFE_RAW")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { tabs: { cafeRaw: e.target.value } })}
                      placeholder="CAFE_RAW"
                      className="filter-input"
                      style={{ width: 160, height: 34, marginBottom: 0 }}
                      title="카페 RAW 탭"
                    />
                    <input
                      value={String(cc?.tabs?.openchatRaw || "OPENCHAT_RAW")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { tabs: { openchatRaw: e.target.value } })}
                      placeholder="OPENCHAT_RAW"
                      className="filter-input"
                      style={{ width: 160, height: 34, marginBottom: 0 }}
                      title="오픈채팅 RAW 탭"
                    />
                    <input
                      value={String(cc?.tabs?.rulesRaw || "RULES_RAW")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { tabs: { rulesRaw: e.target.value } })}
                      placeholder="RULES_RAW"
                      className="filter-input"
                      style={{ width: 160, height: 34, marginBottom: 0 }}
                      title="룰/상태 탭"
                    />
                    <input
                      value={String(cc?.tabs?.audit || "AUDIT_VIEW")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { tabs: { audit: e.target.value } })}
                      placeholder="AUDIT_VIEW"
                      className="filter-input"
                      style={{ width: 160, height: 34, marginBottom: 0 }}
                      title="통합 점검 탭"
                    />
                    <input
                      value={String(cc?.tabs?.auditLog || "AUDIT_LOG")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { tabs: { auditLog: e.target.value } })}
                      placeholder="AUDIT_LOG"
                      className="filter-input"
                      style={{ width: 160, height: 34, marginBottom: 0 }}
                      title="변경 이력 탭(append-only)"
                    />
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 8 }}>
                    <input
                      value={String(cc?.rooms?.chat || "")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { rooms: { chat: e.target.value } })}
                      placeholder="(옵션) 사담방 roomId override"
                      className="filter-input"
                      style={{ width: 240, height: 34, marginBottom: 0 }}
                      title="방 이름 규칙이 깨지면 roomId를 직접 지정"
                    />
                    <input
                      value={String(cc?.rooms?.notice || "")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { rooms: { notice: e.target.value } })}
                      placeholder="(옵션) 공지방 roomId override"
                      className="filter-input"
                      style={{ width: 240, height: 34, marginBottom: 0 }}
                    />
                    <input
                      value={String(cc?.rooms?.premium || "")}
                      onChange={(e) => updateCourseMembershipAuditCourse(ck, { rooms: { premium: e.target.value } })}
                      placeholder="(옵션) 프리미엄방 roomId override"
                      className="filter-input"
                      style={{ width: 240, height: 34, marginBottom: 0 }}
                    />
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* 오픈채팅 멤버(전체) Sheets 동기화 워커 */}
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: 'var(--text-primary)' }}>오픈채팅 멤버(전체) Sheets 동기화</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 10 }}>
          <span className={`tag ${openchatMembersSheetsConfigDirty ? 'tag-inactive' : 'tag-active'}`}>
            설정 {openchatMembersSheetsConfigDirty ? '저장 필요' : 'OK'}
          </span>
          <span className="tag tag-excluded" title={openchatMembersSheetsConfigPath || ''}>
            설정파일 {openchatMembersSheetsConfigExists ? 'OK' : '없음'}
          </span>
          <span className="tag tag-excluded" title={openchatMembersSheetsServiceAccount.path || ''}>
            서비스계정 {openchatMembersSheetsServiceAccount.exists ? 'OK' : '없음'}
          </span>
          {openchatMembersSheetsServiceAccount.clientEmail && (
            <span className="tag tag-excluded" title="서비스계정 이메일">
              {openchatMembersSheetsServiceAccount.clientEmail}
            </span>
          )}
          <span className="tag tag-excluded" title="openchat-members-sheets-worker heartbeat/status">
            워커 {openchatMembersSheetsWorkerStatus?.status?.pid ? `RUN(pid=${openchatMembersSheetsWorkerStatus.status.pid})` : 'N/A'}
          </span>
          <button
            className="btn-outline"
            style={{ padding: '6px 10px', fontSize: 12 }}
            onClick={() => void restartOpenchatMembersSheetsWorker()}
            title="windows/start_openchat_members_sheets_worker.ps1 -Restart"
          >
            워커 재시작
          </button>
          <button
            className="btn-save"
            style={{ padding: '6px 10px', fontSize: 12 }}
            disabled={openchatMembersSheetsConfigSaving === 'saving' || !openchatMembersSheetsConfigDirty}
            onClick={() => void saveOpenchatMembersSheetsConfig()}
            title="data/openchat_members_sheets.json 저장"
          >
            {openchatMembersSheetsConfigSaving === 'saving' ? '저장 중…' : '멤버설정 저장'}
          </button>
          <label className="btn-outline" style={{ padding: '6px 10px', fontSize: 12, cursor: 'pointer' }} title="data/gcp_service_account.json 업로드">
            서비스계정 업로드
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadServiceAccount(f);
              }}
            />
          </label>
        </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <label className="control-label" style={{ display: 'flex', gap: 8, alignItems: 'center' }} title="openchat_members_sheets.json의 worker.enabled">
            <input
              type="checkbox"
              checked={!!openchatMembersSheetsConfig?.worker?.enabled}
              onChange={(e) => {
                setOpenchatMembersSheetsConfig((prev) => {
                  const base = (prev && typeof prev === "object") ? prev : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
                  // 스케줄링 ON 시 고정: 10분
                  const worker = { ...(base.worker || {}), enabled: e.target.checked, intervalSec: 600 };
                  return { ...base, worker };
                });
                setOpenchatMembersSheetsConfigDirty(true);
              }}
            />
            자동 동기화 워커
          </label>
          <span className="tag tag-excluded" title="스케줄링 ON 시 고정: 매 10분 업서트">
            주기 10분(고정)
          </span>
          <input
            value={String(openchatMembersSheetsConfig?.spreadsheetId || "")}
            onChange={(e) => {
              setOpenchatMembersSheetsConfig((prev) => {
                const base = (prev && typeof prev === "object") ? prev : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
                return { ...base, spreadsheetId: e.target.value };
              });
              setOpenchatMembersSheetsConfigDirty(true);
            }}
            placeholder="기본 Spreadsheet ID/URL (빈칸이면 방별 값 필요)"
            className="filter-input"
            style={{ flex: 1, minWidth: 260, height: 34, marginBottom: 0 }}
          />
          <input
            value={String(openchatMembersSheetsConfig?.sheetName || "")}
            onChange={(e) => {
              setOpenchatMembersSheetsConfig((prev) => {
                const base = (prev && typeof prev === "object") ? prev : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
                return { ...base, sheetName: e.target.value };
              });
              setOpenchatMembersSheetsConfigDirty(true);
            }}
            placeholder="기본 시트 탭 이름 (예: members)"
            className="filter-input"
            style={{ width: 220, height: 34, marginBottom: 0 }}
          />
        </div>

        {(openchatMembersSheetsConfigError || openchatMembersSheetsWorkerStatusError || openchatMembersSheetsServiceAccount.error) && (
          <div style={{ fontSize: 12, color: 'var(--error)', lineHeight: 1.5, marginTop: 8 }}>
            {openchatMembersSheetsConfigError && (<div>설정 로드/저장 오류: <code>{openchatMembersSheetsConfigError}</code></div>)}
            {openchatMembersSheetsServiceAccount.error && (<div>서비스계정 파싱 오류: <code>{openchatMembersSheetsServiceAccount.error}</code></div>)}
            {openchatMembersSheetsWorkerStatusError && (<div>워커 상태 조회 오류: <code>{openchatMembersSheetsWorkerStatusError}</code></div>)}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          - 방 카드의 <b>멤버 Sheets 자동</b>에서 roomId별 시트 타겟/옵션을 설정하고 <b>저장</b>하면, 워커가 주기적으로 전체 멤버 목록을 업서트합니다.
          {' '}
          (<code>loadedMembersCount &lt; activeMembersCount</code>면 폴백 없이 스킵/실패 처리)
        </div>
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
            {visibleRooms.map(r => <option key={r.roomId} value={r.roomId}>{r.roomName}</option>)}
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
        onRestartBot={restartBot}
        botRestarting={botRestarting}
        botRestartMessage={botRestartMessage}
        onRepairDevice={repairDevice}
        deviceRepairing={deviceRepairing}
        deviceRepairMessage={deviceRepairMessage}
      />

      <BotProcessManager refreshInterval={5000} />

      <div style={{ marginTop: 32 }}>
        <div className="section-title">
          <span>📱 방 목록</span>
          <span style={{ fontSize: 14, fontWeight: 400, color: 'var(--text-muted)' }}>
            ({visibleRooms.length}개)
          </span>
        </div>
        {roomsLoadError && (
          <div
            style={{
              marginTop: 10,
              marginBottom: 12,
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--border-color)",
              background: "rgba(239,68,68,0.08)",
              color: "var(--error)",
              fontSize: 13,
              lineHeight: 1.5,
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 6 }}>방 목록 로드 실패</div>
            <div style={{ color: "var(--text-secondary)" }}>
              - 에러: <code>{roomsLoadError}</code>
              <br />- Realtime API(:8650)가 내려가 있으면 `/api/rooms`가 503을 반환합니다.
              <br />  - 우선 부분 재기동을 권장합니다: <code>pwsh windows/start_api.ps1 -Port 8650</code>
              <br />  - UI만 문제면: <code>pwsh windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort</code>
              <br />  - 정말 콜드 부팅/전체 복구가 필요할 때만: <code>windows/start_all.cmd</code>
            </div>
          </div>
        )}
        <div className="room-grid">
          {visibleRooms.map(r => (
            <RoomCard
              key={r.roomId}
              room={r}
              logs={roomLogs[r.roomId] || []}
              features={features[r.roomId] || {}}
              openchatMembersSheetsConfig={(openchatMembersSheetsConfig?.rooms as any)?.[r.roomId] || null}
              openchatMembersSheetsConfigExists={openchatMembersSheetsConfigExists}
              openchatMembersSheetsHasServiceAccount={openchatMembersSheetsServiceAccount.exists}
              openchatMembersSheetsConfigDirty={openchatMembersSheetsConfigDirty}
              openchatMembersSheetsWorkerEnabled={!!openchatMembersSheetsConfig?.worker?.enabled}
              openchatMembersSheetsRoomState={(openchatMembersSheetsWorkerStatus?.state as any)?.rooms?.[r.roomId] || null}
              onUpdateOpenchatMembersSheetsConfig={onUpdateOpenchatMembersSheetsRoomConfig}
              excluded={excluded.includes(r.roomId)}
              saving={savingRooms[r.roomId] || "idle"}
              onToggleFeature={onToggleFeature}
              onSave={onSaveRoom}
              onExclude={onExcludeRoom}
              onUploadAvatar={onUploadAvatar}
              realtimeBase={REALTIME_BASE}
              avatarVersion={avatarVersions[r.roomId] || 0}
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
        <b>SAFE_MODE</b>: 기본은 ON(발신 차단)이며, 실제 운영/발신은 `/settings`에서 제어됩니다. (가드레일: allowlist + talkApi.enabled)
      </div>
    </div>
  );
}
