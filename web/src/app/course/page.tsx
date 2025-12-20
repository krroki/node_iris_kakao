/* eslint-disable @next/next/no-img-element */
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import "../dashboard.css";
import { CourseMembershipAuditConfig, CourseMembershipAuditCourse, CourseRosterConfig, OpenchatMembersSheetsConfig, OpenchatMembersSheetsRoomConfig, RoomInfo } from "../../types";

type RoomType = "chat" | "notice" | "premium";

function normStr(v: unknown): string {
  return String(v ?? "").trim();
}

function formatIntervalSec(secRaw: unknown): string {
  const sec = Number(secRaw);
  if (!Number.isFinite(sec) || sec <= 0) return "";
  if (sec < 60) return `${Math.round(sec)}초`;
  const min = sec / 60;
  if (min < 60) return `${Math.round(min)}분`;
  const hour = min / 60;
  if (hour < 48) return `${Math.round(hour)}시간`;
  const day = hour / 24;
  return `${Math.round(day)}일`;
}

function formatIsoToHHMMSS(iso: string): string {
  const s = String(iso || "").trim();
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("ko-KR", { hour12: false });
  } catch {
    return "";
  }
}

function formatAgo(iso: string): string {
  const s = String(iso || "").trim();
  if (!s) return "";
  try {
    const d = new Date(s);
    const t = d.getTime();
    if (!Number.isFinite(t)) return "";
    const diffSec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (diffSec < 10) return "방금";
    if (diffSec < 60) return `${diffSec}초 전`;
    const diffMin = Math.round(diffSec / 60);
    if (diffMin < 60) return `${diffMin}분 전`;
    const diffHr = Math.round(diffMin / 60);
    if (diffHr < 48) return `${diffHr}시간 전`;
    const diffDay = Math.round(diffHr / 24);
    return `${diffDay}일 전`;
  } catch {
    return "";
  }
}

function v2StageLabel(stageRaw: unknown): string {
  const s = String(stageRaw || "").trim().toUpperCase();
  if (s === "QUEUED") return "대기";
  if (s === "START") return "시작";
  if (s === "OPENCHAT") return "톡방 데이터";
  if (s === "CAFE") return "카페 데이터";
  if (s === "SHEETS") return "시트 반영";
  if (s === "DONE") return "완료";
  if (s === "ERROR") return "실패";
  return s || "";
}

function v2DefaultPct(stageRaw: unknown): number | null {
  const s = String(stageRaw || "").trim().toUpperCase();
  if (s === "QUEUED") return 5;
  if (s === "START") return 10;
  if (s === "OPENCHAT") return 30;
  if (s === "CAFE") return 60;
  if (s === "SHEETS") return 85;
  if (s === "DONE") return 100;
  if (s === "ERROR") return 100;
  return null;
}

function friendlyV2Error(rawErr: unknown, userErr: unknown): string {
  const user = String(userErr || "").trim();
  if (user) return user;
  const raw = String(rawErr || "").trim();
  if (!raw) return "";

  if (raw.includes("IRIS /query")) return "카카오톡 데이터(멤버 DB) 연결에 실패했어요. IRIS 연결을 확인해주세요.";
  if (raw.includes("Realtime API /rooms")) return "방 목록을 불러오지 못했어요. 서버 상태를 확인해주세요.";
  if (raw.includes("settings.json") && (raw.includes("찾지 못했습니다") || raw.includes("없습니다"))) return "카페 로그인 설정(settings.json)을 찾지 못했어요.";
  if (raw.includes("naver_id/naver_pw")) return "카페 로그인 정보(naver_id/naver_pw)가 비어 있어요.";
  if (raw.includes("카페 크롤링 실패")) return "카페 멤버를 불러오지 못했어요. 로그인/권한을 확인해주세요.";
  if (raw.includes("The caller does not have permission") || raw.includes("insufficientPermissions") || raw.includes("PERMISSION_DENIED")) {
    return "서비스계정이 스프레드시트 편집 권한이 없어요. 시트를 서비스계정 이메일에 Editor로 공유해주세요.";
  }
  if (raw.includes("Requested entity was not found") || raw.includes("notFound")) return "스프레드시트를 찾지 못했어요. URL/ID를 확인해주세요.";

  if (raw.length <= 80) return raw;
  return "업서트에 실패했어요. ‘고급: 오류 상세’에서 원문을 확인할 수 있어요.";
}

function splitList(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of String(raw || "")
    .split(/[,\n/.]/g)
    .map((s) => s.trim())
    .filter(Boolean)) {
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

function extractNaverCafeClubId(raw: string): string {
  const s = String(raw || "").trim();
  if (!s) return "";
  const m = s.match(/(?:clubid|clubId|search\.clubid|search\.clubId)=(\d+)/i);
  if (m && m[1]) return String(m[1]).trim();
  const m2 = s.match(/\/cafes\/(\d+)/i);
  if (m2 && m2[1]) return String(m2[1]).trim();
  return "";
}

function inferRoomTypeAndCourseKey(roomName: string): { roomType: RoomType; courseKey: string } | null {
  const s = String(roomName || "").trim();
  if (!s) return null;
  const m = s.match(/^(?:\d+\.)?\s*(?:\(([^)]+)\)|\[([^\]]+)\])\s*(.+)$/);
  if (!m) return null;
  const prefix = String(m[1] || m[2] || "").trim();
  const base = String(m[3] || "").trim();
  if (!prefix || !base) return null;

  const p = prefix.replace(/\s+/g, "");
  if (p.includes("사담")) return { roomType: "chat", courseKey: base };
  if (p.includes("공지")) return { roomType: "notice", courseKey: base };
  if (p.includes("프리미엄")) return { roomType: "premium", courseKey: base };
  return null;
}

function ensureAuditConfigBase(prev: CourseMembershipAuditConfig | null): CourseMembershipAuditConfig {
  if (prev && typeof prev === "object") return prev;
  return {
    version: 1,
    worker: {
      enabled: false,
      hotIntervalSec: 600,
      hotDays: 14,
      steadyIntervalSec: 10800,
      crawler: {
        repoPath: "C:\\dev\\naver-cafe-member-crawler",
        pythonExe: "C:\\dev\\naver-cafe-member-crawler\\venv\\Scripts\\python.exe",
        settingsPath: "",
      },
    },
    courses: {},
  };
}

function ensureAuditCourseBase(prev: CourseMembershipAuditCourse | null | undefined): CourseMembershipAuditCourse {
  const base: CourseMembershipAuditCourse = {
    enabled: true,
    clubId: "",
    spreadsheetId: "",
    tabs: {
      cafeRaw: "CAFE_RAW",
      openchatRaw: "OPENCHAT_RAW",
      rulesRaw: "RULES_RAW",
      audit: "AUDIT_VIEW",
      auditLog: "AUDIT_LOG",
    },
    gradeRules: {
      premiumGrades: [],
      staffGrades: [],
    },
    rooms: { chat: "", notice: "", premium: "" },
  };
  if (!prev || typeof prev !== "object") return base;
  return {
    ...base,
    ...prev,
    tabs: { ...base.tabs, ...(prev.tabs || {}) },
    gradeRules: { ...base.gradeRules, ...(prev.gradeRules || {}) },
    rooms: { ...base.rooms, ...(prev.rooms || {}) },
  };
}

function ensureOpenchatMembersSheetsConfigBase(prev: OpenchatMembersSheetsConfig | null): OpenchatMembersSheetsConfig {
  if (prev && typeof prev === "object") return prev;
  return { version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} };
}

export default function CourseOpsPage() {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [roomsError, setRoomsError] = useState<string | null>(null);

  const roomById = useMemo(() => {
    const m = new Map<string, RoomInfo>();
    for (const r of rooms || []) {
      const rid = String((r as any)?.roomId || "").trim();
      if (!rid) continue;
      m.set(rid, r);
    }
    return m;
  }, [rooms]);

  const [runtime, setRuntime] = useState<any | null>(null);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [runtimeSaving, setRuntimeSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const [courseRosterConfig, setCourseRosterConfig] = useState<CourseRosterConfig | null>(null);
  const [courseRosterConfigExists, setCourseRosterConfigExists] = useState(false);
  const [courseRosterConfigPath, setCourseRosterConfigPath] = useState<string | null>(null);
  const [courseRosterConfigSaving, setCourseRosterConfigSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [courseRosterConfigError, setCourseRosterConfigError] = useState<string | null>(null);
  const [rosterWorkerStatus, setRosterWorkerStatus] = useState<any | null>(null);
  const [rosterWorkerStatusError, setRosterWorkerStatusError] = useState<string | null>(null);

  const [auditConfig, setAuditConfig] = useState<CourseMembershipAuditConfig | null>(null);
  const [auditExists, setAuditExists] = useState(false);
  const [auditPath, setAuditPath] = useState<string | null>(null);
  const [auditDirty, setAuditDirty] = useState(false);
  const [auditSaving, setAuditSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [auditError, setAuditError] = useState<string | null>(null);
  const [auditLoaded, setAuditLoaded] = useState(false);
  const [auditServiceAccount, setAuditServiceAccount] = useState<{ exists: boolean; path?: string; clientEmail?: string | null; error?: string | null }>({ exists: false });
  const [gradeTextByCourse, setGradeTextByCourse] = useState<Record<string, { premiumText: string; staffText: string }>>({});

  const [auditWorkerStatus, setAuditWorkerStatus] = useState<any | null>(null);
  const [auditWorkerStatusError, setAuditWorkerStatusError] = useState<string | null>(null);

  // 오픈채팅 멤버 Sheets 자동 동기화(선택 기능)
  const [openchatMembersSheetsConfig, setOpenchatMembersSheetsConfig] = useState<OpenchatMembersSheetsConfig | null>(null);
  const [openchatMembersSheetsConfigExists, setOpenchatMembersSheetsConfigExists] = useState(false);
  const [openchatMembersSheetsConfigPath, setOpenchatMembersSheetsConfigPath] = useState<string | null>(null);
  const [openchatMembersSheetsConfigDirty, setOpenchatMembersSheetsConfigDirty] = useState(false);
  const [openchatMembersSheetsConfigSaving, setOpenchatMembersSheetsConfigSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [openchatMembersSheetsConfigError, setOpenchatMembersSheetsConfigError] = useState<string | null>(null);
  const [openchatMembersSheetsWorkerStatus, setOpenchatMembersSheetsWorkerStatus] = useState<any | null>(null);
  const [openchatMembersSheetsWorkerStatusError, setOpenchatMembersSheetsWorkerStatusError] = useState<string | null>(null);
  const [openchatMembersSheetsSyncingRoomId, setOpenchatMembersSheetsSyncingRoomId] = useState<string | null>(null);
  const [openchatMembersSheetsSyncMsgByRoom, setOpenchatMembersSheetsSyncMsgByRoom] = useState<Record<string, string>>({});
  const [openchatMembersSheetsSyncErrByRoom, setOpenchatMembersSheetsSyncErrByRoom] = useState<Record<string, string>>({});

  const [pendingV2OneOff, setPendingV2OneOff] = useState<Record<string, { startedAtMs: number; originalWorkerEnabled: boolean; originalCourseEnabled: boolean }>>({});
  const autoSeededRef = useRef(false);
  const showOpenchatMembersSheetsUi = false;

  const inferredCourses = useMemo(() => {
    const grouped: Record<string, Record<RoomType, RoomInfo[]>> = {};
    for (const r of rooms || []) {
      const inf = inferRoomTypeAndCourseKey(r.roomName);
      if (!inf) continue;
      grouped[inf.courseKey] ||= { chat: [], notice: [], premium: [] };
      grouped[inf.courseKey][inf.roomType].push(r);
    }
    const keys = Object.keys(grouped).sort();
    return keys.map((k) => ({ courseKey: k, rooms: grouped[k] }));
  }, [rooms]);

  const courseKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const c of inferredCourses) keys.add(c.courseKey);
    for (const k of Object.keys(auditConfig?.courses || {})) keys.add(k);
    return Array.from(keys).sort();
  }, [inferredCourses, auditConfig]);

  const v2ScheduleLabel = useMemo(() => {
    const hotSec = Number(auditConfig?.worker?.hotIntervalSec ?? 600);
    const hotDays = Number(auditConfig?.worker?.hotDays ?? 14);
    const steadySec = Number(auditConfig?.worker?.steadyIntervalSec ?? 10800);
    const hot = formatIntervalSec(hotSec) || `${hotSec}s`;
    const steady = formatIntervalSec(steadySec) || `${steadySec}s`;
    const dayStr = Number.isFinite(hotDays) ? `${hotDays}일` : "N일";
    return `초기 ${dayStr}: ${hot}마다 · 이후: ${steady}마다`;
  }, [auditConfig]);

  const courseOpsSendEnabled = useMemo(() => {
    const co = runtime && typeof runtime === "object" ? (runtime as any).courseOps : null;
    return !!(co && typeof co === "object" && (co as any).sendEnabled === true);
  }, [runtime]);

  const loadRooms = useCallback(async () => {
    try {
      setRoomsError(null);
      const r = await fetch(`/api/rooms`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new Error(String(j?.detail || j?.error || `HTTP ${r.status}`));
      if (!Array.isArray(j)) throw new Error("rooms_bad_shape");
      setRooms(j as RoomInfo[]);
    } catch (e: any) {
      setRoomsError(String(e?.message || e));
      setRooms([]);
    }
  }, []);

  const loadRuntime = useCallback(async () => {
    try {
      setRuntimeError(null);
      const r = await fetch(`/api/runtime`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setRuntime(j);
    } catch (e: any) {
      setRuntimeError(String(e?.message || e));
      setRuntime(null);
    }
  }, []);

  const loadCourseRosterConfig = useCallback(async () => {
    try {
      setCourseRosterConfigError(null);
      const r = await fetch(`/api/course-roster/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setCourseRosterConfigExists(!!j.exists);
      setCourseRosterConfigPath(String(j.path || ""));
      setCourseRosterConfig(j?.config || null);
    } catch (e: any) {
      setCourseRosterConfigError(String(e?.message || e));
      setCourseRosterConfig(null);
    }
  }, []);

  const loadRosterWorkerStatus = useCallback(async () => {
    try {
      setRosterWorkerStatusError(null);
      const r = await fetch(`/api/course-roster/status`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setRosterWorkerStatus(j);
    } catch (e: any) {
      setRosterWorkerStatusError(String(e?.message || e));
      setRosterWorkerStatus(null);
    }
  }, []);

  const restartRosterWorker = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-roster/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      await loadRosterWorkerStatus();
    } catch (e: any) {
      setRosterWorkerStatusError(String(e?.message || e));
    }
  }, [loadRosterWorkerStatus]);

  const loadAuditConfig = useCallback(async () => {
    setAuditLoaded(false);
    try {
      setAuditError(null);
      const r = await fetch(`/api/course-membership-audit/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setAuditExists(!!j.exists);
      setAuditPath(String(j.path || ""));
      setAuditServiceAccount({
        exists: !!j?.serviceAccount?.exists,
        path: String(j?.serviceAccount?.path || ""),
        clientEmail: j?.serviceAccount?.clientEmail ?? null,
        error: j?.serviceAccount?.error ?? null,
      });
      const loadedCfg = (j?.config || null) as CourseMembershipAuditConfig | null;
      setAuditConfig(loadedCfg);
      setGradeTextByCourse(() => {
        const next: Record<string, { premiumText: string; staffText: string }> = {};
        for (const [courseKey, courseRaw] of Object.entries((loadedCfg?.courses || {}) as any)) {
          const c: any = courseRaw as any;
          next[String(courseKey)] = {
            premiumText: Array.isArray(c?.gradeRules?.premiumGrades) ? c.gradeRules.premiumGrades.join(", ") : "",
            staffText: Array.isArray(c?.gradeRules?.staffGrades) ? c.gradeRules.staffGrades.join(", ") : "",
          };
        }
        return next;
      });
      setAuditDirty(false);
    } catch (e: any) {
      setAuditError(String(e?.message || e));
      setAuditConfig(null);
      setGradeTextByCourse({});
    } finally {
      setAuditLoaded(true);
    }
  }, []);

  const loadOpenchatMembersSheetsConfig = useCallback(async () => {
    try {
      setOpenchatMembersSheetsConfigError(null);
      const r = await fetch(`/api/openchat-members-sheets/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setOpenchatMembersSheetsConfigExists(!!j.exists);
      setOpenchatMembersSheetsConfigPath(j.path ? String(j.path) : null);
      const cfg: OpenchatMembersSheetsConfig = (j.config && typeof j.config === "object")
        ? (j.config as OpenchatMembersSheetsConfig)
        : ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig);
      setOpenchatMembersSheetsConfig(cfg);
      setOpenchatMembersSheetsConfigDirty(false);
    } catch (e: any) {
      setOpenchatMembersSheetsConfigError(String(e?.message || e));
      setOpenchatMembersSheetsConfig((prev) => prev || ({ version: 1, worker: { enabled: false, intervalSec: 600 }, rooms: {} } as OpenchatMembersSheetsConfig));
      setOpenchatMembersSheetsConfigExists(false);
      setOpenchatMembersSheetsConfigPath(null);
    }
  }, []);

  const loadOpenchatMembersSheetsWorkerStatus = useCallback(async () => {
    try {
      setOpenchatMembersSheetsWorkerStatusError(null);
      const r = await fetch(`/api/openchat-members-sheets/status`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setOpenchatMembersSheetsWorkerStatus(j);
    } catch (e: any) {
      setOpenchatMembersSheetsWorkerStatusError(String(e?.message || e));
      setOpenchatMembersSheetsWorkerStatus(null);
    }
  }, []);

  const loadAuditWorkerStatus = useCallback(async () => {
    try {
      setAuditWorkerStatusError(null);
      const r = await fetch(`/api/course-membership-audit/status`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setAuditWorkerStatus(j);
    } catch (e: any) {
      setAuditWorkerStatusError(String(e?.message || e));
      setAuditWorkerStatus(null);
    }
  }, []);

  const saveAuditConfig = useCallback(async (opts?: { workerEnabled?: boolean; courseEnabled?: Record<string, boolean> }) => {
    try {
      const cfgBase = auditConfig && typeof auditConfig === "object" ? auditConfig : null;
      if (!cfgBase) return false;

      const cfg: CourseMembershipAuditConfig = {
        ...cfgBase,
        worker: { ...(cfgBase.worker || {}) },
        courses: { ...(cfgBase.courses || {}) },
      };

      // 등급 규칙 textarea는 입력 중에 콤마가 사라지지 않도록 원문을 별도로 유지한다.
      // 저장 시점에만 split하여 config에 반영한다.
      for (const [courseKey, text] of Object.entries(gradeTextByCourse || {})) {
        const cur = (cfg.courses || {})[courseKey];
        if (!cur) continue;
        (cfg.courses as any)[courseKey] = {
          ...cur,
          gradeRules: {
            ...(cur.gradeRules || {}),
            premiumGrades: splitList((text as any)?.premiumText),
            staffGrades: splitList((text as any)?.staffText),
          },
        };
      }

      // (옵션) 저장 시점에 worker/course enabled 값을 강제 덮어쓴다.
      if (opts && typeof opts.workerEnabled === "boolean") {
        (cfg.worker as any) = { ...(cfg.worker || {}), enabled: opts.workerEnabled };
      }
      if (opts && opts.courseEnabled && typeof opts.courseEnabled === "object") {
        for (const [courseKey, enabled] of Object.entries(opts.courseEnabled || {})) {
          const cur = (cfg.courses || {})[courseKey];
          if (!cur) continue;
          (cfg.courses as any)[courseKey] = { ...(cur as any), enabled: !!enabled };
        }
      }

      // enabled=true 코스는 필수값이 빠지면 워커가 실패할 수 있으니 UI에서 선제 검증한다.
      const bad: string[] = [];
      for (const [courseKey, courseRaw] of Object.entries(cfg.courses || {})) {
        const c: any = courseRaw as any;
        if (c?.enabled === false) continue;
        const clubId = String(c?.clubId || "").trim();
        const spreadsheetId = String(c?.spreadsheetId || "").trim();
        const rooms = c?.rooms && typeof c.rooms === "object" ? c.rooms : {};
        const ridChat = normStr((rooms as any).chat);
        const ridNotice = normStr((rooms as any).notice);
        const ridPremium = normStr((rooms as any).premium);
        if (!clubId || !/^\d+$/.test(clubId)) bad.push(`${courseKey}: clubId(숫자)`);
        if (!spreadsheetId) bad.push(`${courseKey}: spreadsheetId`);
        if (!ridChat || !ridNotice || !ridPremium) bad.push(`${courseKey}: rooms(사담/공지/프리미엄)`);
        if (ridChat && ridNotice && ridPremium && new Set([ridChat, ridNotice, ridPremium]).size !== 3) bad.push(`${courseKey}: rooms(중복)`);
      }
      if (bad.length) {
        throw new Error(`v2 설정 누락/오류: ${bad.join(", ")}`);
      }

      setAuditSaving("saving");
      setAuditError(null);
      const r = await fetch(`/api/course-membership-audit/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setAuditDirty(false);
      setAuditSaving("saved");
      setTimeout(() => setAuditSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      await loadAuditConfig();
      return true;
    } catch (e: any) {
      setAuditSaving("error");
      setAuditError(String(e?.message || e));
      return false;
    }
  }, [auditConfig, gradeTextByCourse, loadAuditConfig]);

  const saveOpenchatMembersSheetsConfig = useCallback(async (): Promise<boolean> => {
    try {
      setOpenchatMembersSheetsConfigSaving("saving");
      setOpenchatMembersSheetsConfigError(null);
      const cfg = ensureOpenchatMembersSheetsConfigBase(openchatMembersSheetsConfig);
      // 스케줄링 ON 시 고정: 10분
      const worker = { ...(cfg.worker || {}), enabled: !!cfg.worker?.enabled, intervalSec: 600 };
      const out: OpenchatMembersSheetsConfig = { ...cfg, worker };

      const r = await fetch(`/api/openchat-members-sheets/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: out }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
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

  const restartOpenchatMembersSheetsWorker = useCallback(async (): Promise<void> => {
    try {
      const r = await fetch(`/api/openchat-members-sheets/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      await loadOpenchatMembersSheetsWorkerStatus();
    } catch (e: any) {
      setOpenchatMembersSheetsWorkerStatusError(String(e?.message || e));
    }
  }, [loadOpenchatMembersSheetsWorkerStatus]);

  const updateOpenchatMembersSheetsRoom = useCallback((roomId: string, patch: Partial<OpenchatMembersSheetsRoomConfig>) => {
    const rid = String(roomId || "").trim();
    if (!rid) return;
    setOpenchatMembersSheetsConfig((prev) => {
      const base = ensureOpenchatMembersSheetsConfigBase(prev);
      const roomsObj: Record<string, any> =
        (base.rooms && typeof base.rooms === "object" && base.rooms) ? { ...(base.rooms as any) } : {};
      const cur = (roomsObj[rid] && typeof roomsObj[rid] === "object") ? roomsObj[rid] : {};
      roomsObj[rid] = { ...cur, ...patch };
      return { ...base, rooms: roomsObj };
    });
    setOpenchatMembersSheetsConfigDirty(true);
  }, []);

  const syncOpenchatMembersToSheetsOnce = useCallback(async (roomId: string, allowIncomplete: boolean): Promise<void> => {
    const rid = String(roomId || "").trim();
    if (!rid) return;
    if (openchatMembersSheetsSyncingRoomId) return;

    const ok = confirm(`이 방 멤버를 Google Sheets에 업서트할까요?\n\nroomId=${rid}\n\n(※ loadedMembersCount < activeMembersCount이면 기본은 실패합니다)`);
    if (!ok) return;

    setOpenchatMembersSheetsSyncingRoomId(rid);
    setOpenchatMembersSheetsSyncMsgByRoom((prev) => ({ ...prev, [rid]: "" }));
    setOpenchatMembersSheetsSyncErrByRoom((prev) => ({ ...prev, [rid]: "" }));

    try {
      const r = await fetch(`/api/rooms/${encodeURIComponent(rid)}/members/sync-sheets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowIncomplete }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) {
        const msg = String(j?.detail || j?.error || `HTTP ${r.status}`);
        setOpenchatMembersSheetsSyncErrByRoom((prev) => ({ ...prev, [rid]: msg }));
        return;
      }
      const fetched = j?.counts?.fetched;
      const updates = j?.sheets?.updates;
      const appends = j?.sheets?.appends;
      const msg = `Sheets 업서트 완료: updates=${typeof updates === "number" ? updates : "?"}, appends=${typeof appends === "number" ? appends : "?"}, fetched=${typeof fetched === "number" ? fetched : "?"}`;
      setOpenchatMembersSheetsSyncMsgByRoom((prev) => ({ ...prev, [rid]: msg }));
      await loadOpenchatMembersSheetsWorkerStatus();
    } catch (e: any) {
      setOpenchatMembersSheetsSyncErrByRoom((prev) => ({ ...prev, [rid]: String(e?.message || e) }));
    } finally {
      setOpenchatMembersSheetsSyncingRoomId(null);
    }
  }, [openchatMembersSheetsSyncingRoomId, loadOpenchatMembersSheetsWorkerStatus]);

  const syncV1CourseRosterConfigFromV2 = useCallback(async () => {
    try {
      const cfg = auditConfig && typeof auditConfig === "object" ? auditConfig : null;
      if (!cfg) return false;

      const courses = (cfg.courses && typeof cfg.courses === "object") ? cfg.courses : {};
      const curRooms: Record<string, any> = (courseRosterConfig?.rooms && typeof courseRosterConfig.rooms === "object") ? (courseRosterConfig.rooms as any) : {};
      const nextRooms: Record<string, any> = { ...curRooms };

      const bad: string[] = [];
      const workerCrawler: any = (cfg.worker && typeof cfg.worker === "object") ? (cfg.worker as any).crawler : null;
      const crawlerRepoPath = normStr(workerCrawler?.repoPath);
      const crawlerPythonExe = normStr(workerCrawler?.pythonExe);
      const crawlerSettingsPath = normStr(workerCrawler?.settingsPath);

      for (const [courseKey, courseRaw] of Object.entries(courses || {})) {
        const c: any = courseRaw as any;
        if (c?.enabled === false) continue;

        const clubId = String(c?.clubId || "").trim();
        const spreadsheetId = String(c?.spreadsheetId || "").trim();
        const joinUrl = String(c?.joinUrl || "").trim();
        const rooms = c?.rooms && typeof c.rooms === "object" ? c.rooms : {};
        const ridChat = normStr((rooms as any).chat);
        const ridNotice = normStr((rooms as any).notice);
        const ridPremium = normStr((rooms as any).premium);

        if (!clubId || !/^\d+$/.test(clubId)) {
          bad.push(`${courseKey}: clubId`);
          continue;
        }
        if (!spreadsheetId) {
          bad.push(`${courseKey}: spreadsheetId`);
          continue;
        }
        if (!ridChat || !ridNotice || !ridPremium) {
          bad.push(`${courseKey}: rooms(chat/notice/premium)`);
          continue;
        }
        if (new Set([ridChat, ridNotice, ridPremium]).size !== 3) {
          bad.push(`${courseKey}: rooms(duplicate)`);
          continue;
        }

        const apply = (rid: string, rosterSheetName: string) => {
          nextRooms[rid] = {
            ...(nextRooms[rid] || {}),
            enabled: true,
            spreadsheetId,
            rosterSheetName,
            cafeSource: "crawler",
            cafeClubId: clubId,
            cafeUrl: "",
            crawlerRepoPath,
            crawlerPythonExe,
            crawlerSettingsPath,
            cafeCsvPath: "",
            joinUrl,
          };
        };

        apply(ridChat, "ROSTER_CHAT");
        apply(ridNotice, "ROSTER_NOTICE");
        apply(ridPremium, "ROSTER_PREMIUM");
      }

      if (bad.length) {
        throw new Error(`v1 동기화 불가(코스 설정 누락): ${bad.join(", ")}`);
      }

      if (Object.keys(nextRooms).length === 0) {
        throw new Error("v1 동기화 대상(room)이 없습니다. 코스 enabled/방매핑/시트/clubId를 먼저 설정하세요.");
      }

      setCourseRosterConfigSaving("saving");
      setCourseRosterConfigError(null);
      const out: any = {
        version: Number((courseRosterConfig as any)?.version) || 1,
        rooms: nextRooms,
      };
      const r = await fetch(`/api/course-roster/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: out }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      setCourseRosterConfigSaving("saved");
      setTimeout(() => setCourseRosterConfigSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      await loadCourseRosterConfig();
      return true;
    } catch (e: any) {
      setCourseRosterConfigSaving("error");
      setCourseRosterConfigError(String(e?.message || e));
      return false;
    }
  }, [auditConfig, courseRosterConfig, courseRosterConfig?.rooms, loadCourseRosterConfig]);

  const uploadServiceAccount = useCallback(async (file: File): Promise<boolean> => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/course-roster/service-account`, { method: "POST", body: fd });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      await loadAuditConfig();
      await loadOpenchatMembersSheetsConfig();
      return true;
    } catch (e: any) {
      setAuditError(String(e?.message || e));
      return false;
    }
  }, [loadAuditConfig, loadOpenchatMembersSheetsConfig]);

  const restartAuditWorker = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-membership-audit/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
    } catch (e: any) {
      setAuditWorkerStatusError(String(e?.message || e));
    }
  }, []);

  const runV2UpsertOnce = useCallback(async (courseKey: string): Promise<void> => {
    const ck = normStr(courseKey);
    if (!ck) return;

    const cfgBase = auditConfig && typeof auditConfig === "object" ? auditConfig : null;
    if (!cfgBase) {
      alert("v2 설정이 아직 로드되지 않았습니다. 잠시 후 다시 시도해주세요.");
      return;
    }
    const course = ensureAuditCourseBase((cfgBase.courses || {})[ck]);

    const clubId = normStr(course.clubId);
    const spreadsheetId = normStr(course.spreadsheetId);
    const rooms = course.rooms && typeof course.rooms === "object" ? course.rooms : {};
    const ridChat = normStr((rooms as any).chat);
    const ridNotice = normStr((rooms as any).notice);
    const ridPremium = normStr((rooms as any).premium);

    const missing: string[] = [];
    if (!clubId || !/^\d+$/.test(clubId)) missing.push("clubId(숫자)");
    if (!spreadsheetId) missing.push("스프레드시트 URL/ID");
    if (!ridChat || !ridNotice || !ridPremium) missing.push("방 매핑(사담/공지/프리미엄)");
    if (ridChat && ridNotice && ridPremium && new Set([ridChat, ridNotice, ridPremium]).size !== 3) missing.push("방 매핑(중복)");
    if (missing.length) {
      alert(`이 코스에서 1회 업서트를 실행하려면 먼저 아래를 채워주세요:\n- ${missing.join("\n- ")}`);
      return;
    }

    const originalWorkerEnabled = !!cfgBase.worker?.enabled;
    const originalCourseEnabled = course.enabled !== false;

    const ok = confirm(
      `이 코스의 데이터를 Google Sheets에 1회 업서트할까요?\n\n` +
      `- 코스: ${ck}\n` +
      `- 포함: 카페 크롤링 + 3방 멤버 취합 + AUDIT_VIEW/AUDIT_LOG 갱신\n\n` +
      `※ 지금 입력한 설정도 같이 저장됩니다.\n` +
      `※ 실행을 위해 워커를 잠깐 켤 수 있습니다(완료 후 원복).`,
    );
    if (!ok) return;

    // 1회 실행을 위해 v2 worker/course를 일시적으로 ON → 저장
    const saveOk = await saveAuditConfig({ workerEnabled: true, courseEnabled: { [ck]: true } });
    if (!saveOk) return;

    // 워커를 재시작해 즉시 반영(기동/설정 반영)
    await restartAuditWorker();

    // 코스 1회 실행 예약(nextRunMs=now)
    try {
      const r = await fetch(`/api/course-membership-audit/run-once`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseKey: ck }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      if (originalWorkerEnabled === false || originalCourseEnabled === false) {
        setPendingV2OneOff((prev) => ({
          ...prev,
          [ck]: { startedAtMs: Date.now(), originalWorkerEnabled, originalCourseEnabled },
        }));
      }
    } catch (e: any) {
      alert(`1회 실행 예약 실패: ${String(e?.message || e)}`);
    }
  }, [auditConfig, saveAuditConfig, restartAuditWorker]);

  const setV2AutoRunEnabled = useCallback(async (enabled: boolean): Promise<void> => {
    // UI 반응성: 먼저 토글만 반영(저장은 비동기)
    setAuditConfig((prev) => {
      const base = ensureAuditConfigBase(prev);
      return { ...base, worker: { ...(base.worker || {}), enabled } };
    });
    setAuditDirty(true);

    const ok = await saveAuditConfig({ workerEnabled: enabled });
    if (!ok) {
      // 저장 실패 시 원복(서버 기준으로 다시 로드)
      await loadAuditConfig();
      return;
    }
    await restartAuditWorker();
    await loadAuditWorkerStatus();
  }, [saveAuditConfig, loadAuditConfig, restartAuditWorker, loadAuditWorkerStatus]);

  const setCourseOpsSendEnabled = useCallback(async (enabled: boolean) => {
    try {
      setRuntimeSaving("saving");
      setRuntimeError(null);
      const r = await fetch(`/api/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseOps: { sendEnabled: enabled } }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok) throw new Error(String(j?.detail || j?.error || `HTTP ${r.status}`));
      await loadRuntime();
      setRuntimeSaving("saved");
      setTimeout(() => setRuntimeSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      return true;
    } catch (e: any) {
      setRuntimeSaving("error");
      setRuntimeError(String(e?.message || e));
      return false;
    }
  }, [loadRuntime]);

  const updateRuntime = useCallback(async (nextFeatures: Record<string, any>) => {
    if (!runtime) return false;
    try {
      setRuntimeSaving("saving");
      setRuntimeError(null);
      const excludedRoomIds: string[] = Array.isArray(runtime?.excludedRoomIds) ? runtime.excludedRoomIds : [];
      const allowedRoomIds = Object.keys(nextFeatures || {}).filter((rid) => {
        if (excludedRoomIds.includes(rid)) return false;
        const f = nextFeatures[rid] || {};
        return !!(f.welcome || f.broadcast || f.schedules || f.ai || f.chatSummary || f.commands || f.autoFaq || f.courseRoster || f.nicknameReminder || f.imageGen || f.videoGen);
      });

      const r = await fetch(`/api/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          features: nextFeatures,
          excludedRoomIds,
          allowedRoomIds,
        }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await loadRuntime();
      setRuntimeSaving("saved");
      setTimeout(() => setRuntimeSaving((s) => (s === "saved" ? "idle" : s)), 2000);
      return true;
    } catch (e: any) {
      setRuntimeSaving("error");
      setRuntimeError(String(e?.message || e));
      return false;
    }
  }, [runtime, loadRuntime]);

  const setCourseRosterEnabledForCourse = useCallback(async (courseKey: string, enabled: boolean) => {
    const base = runtime && typeof runtime === "object" ? runtime : null;
    if (!base) return;
    const features: Record<string, any> = (base.features && typeof base.features === "object") ? base.features : {};

    const ck = normStr(courseKey);
    if (!ck) return;

    // 1) v2 rooms 매핑이 있으면 그 값을 우선 사용(가장 명시적)
    const v2Rooms: any = (auditConfig?.courses && (auditConfig.courses as any)[ck] && typeof (auditConfig.courses as any)[ck] === "object")
      ? ((auditConfig.courses as any)[ck] as any).rooms
      : null;
    const pickCfg = (rt: RoomType): string | null => {
      const rid = v2Rooms && typeof v2Rooms === "object" ? normStr((v2Rooms as any)[rt]) : "";
      return rid || null;
    };
    let targets = [pickCfg("chat"), pickCfg("notice"), pickCfg("premium")].filter(Boolean) as string[];
    if (targets.length !== 3 || new Set(targets).size !== 3) {
      // 2) fallback: 감지된 코스에서 유일 매칭되는 방을 사용
      const inferred = inferredCourses.find((c) => c.courseKey === ck);
      const pickOne = (rt: RoomType): string | null => {
        const arr = inferred?.rooms?.[rt] || [];
        if (arr.length !== 1) return null;
        return normStr(arr[0]?.roomId) || null;
      };
      targets = [pickOne("chat"), pickOne("notice"), pickOne("premium")].filter(Boolean) as string[];
    }
    if (!targets.length) return;

    const next: Record<string, any> = { ...features };
    for (const rid of targets) {
      next[rid] = { ...(next[rid] || {}), courseRoster: enabled };
    }
    setRuntime((prev: any) => ({ ...(prev || {}), features: next }));
    await updateRuntime(next);
  }, [runtime, auditConfig, inferredCourses, updateRuntime]);

  const addAllDetectedCourses = useCallback(() => {
    setAuditConfig((prev) => {
      const base = ensureAuditConfigBase(prev);
      const nextCourses: Record<string, CourseMembershipAuditCourse> = { ...(base.courses || {}) };
      for (const c of inferredCourses) {
        if (nextCourses[c.courseKey]) continue;
        const cc = ensureAuditCourseBase(null);
        cc.enabled = false;
        const pick = (rt: RoomType): string => {
          const arr = c.rooms[rt] || [];
          if (arr.length !== 1) return "";
          return normStr(arr[0]?.roomId);
        };
        cc.rooms = { chat: pick("chat"), notice: pick("notice"), premium: pick("premium") };
        nextCourses[c.courseKey] = cc;
      }
      return { ...base, courses: nextCourses };
    });
    setAuditDirty(true);
  }, [inferredCourses]);

  const ensureCourseEntry = useCallback((courseKey: string) => {
    setAuditConfig((prev) => {
      const base = ensureAuditConfigBase(prev);
      const cur = (base.courses || {})[courseKey];
      if (cur) return base;

      const inferred = inferredCourses.find((c) => c.courseKey === courseKey);
      const cc = ensureAuditCourseBase(null);
      cc.enabled = false;
      const pick = (rt: RoomType): string => {
        const arr = inferred?.rooms?.[rt] || [];
        if (arr.length !== 1) return "";
        return normStr(arr[0]?.roomId);
      };
      cc.rooms = { chat: pick("chat"), notice: pick("notice"), premium: pick("premium") };
      return { ...base, courses: { ...(base.courses || {}), [courseKey]: cc } };
    });
    setAuditDirty(true);
  }, [inferredCourses]);

  const applyInferredRooms = useCallback((courseKey: string) => {
    const inferred = inferredCourses.find((c) => c.courseKey === courseKey);
    if (!inferred) return;
    setAuditConfig((prev) => {
      const base = ensureAuditConfigBase(prev);
      const existed = !!((base.courses || {})[courseKey]);
      const cur = existed ? ensureAuditCourseBase((base.courses || {})[courseKey]) : { ...ensureAuditCourseBase(null), enabled: false };
      const pick = (rt: RoomType): string => {
        const arr = inferred.rooms[rt] || [];
        if (arr.length !== 1) return (cur.rooms as any)?.[rt] || "";
        return normStr(arr[0]?.roomId);
      };
      const nextCourse: CourseMembershipAuditCourse = { ...cur, rooms: { chat: pick("chat"), notice: pick("notice"), premium: pick("premium") } };
      return { ...base, courses: { ...(base.courses || {}), [courseKey]: nextCourse } };
    });
    setAuditDirty(true);
  }, [inferredCourses]);

  const updateCourseField = useCallback((courseKey: string, patch: Partial<CourseMembershipAuditCourse>) => {
    setAuditConfig((prev) => {
      const base = ensureAuditConfigBase(prev);
      const existed = !!((base.courses || {})[courseKey]);
      const cur = existed ? ensureAuditCourseBase((base.courses || {})[courseKey]) : { ...ensureAuditCourseBase(null), enabled: false };
      const nextCourse: CourseMembershipAuditCourse = {
        ...cur,
        ...patch,
        tabs: { ...(cur.tabs || {}), ...(patch.tabs || {}) },
        gradeRules: { ...(cur.gradeRules || {}), ...(patch.gradeRules || {}) },
        rooms: { ...(cur.rooms || {}), ...(patch.rooms || {}) },
      };
      return { ...base, courses: { ...(base.courses || {}), [courseKey]: nextCourse } };
    });
    setAuditDirty(true);
  }, []);

  useEffect(() => {
    void loadRooms();
    void loadRuntime();
    void loadAuditConfig();
    void loadAuditWorkerStatus();
    void loadOpenchatMembersSheetsConfig();
    void loadOpenchatMembersSheetsWorkerStatus();
    const t = setInterval(() => {
      void loadAuditWorkerStatus();
      void loadOpenchatMembersSheetsWorkerStatus();
    }, 5000);
    return () => clearInterval(t);
  }, [loadRooms, loadRuntime, loadAuditConfig, loadAuditWorkerStatus, loadOpenchatMembersSheetsConfig, loadOpenchatMembersSheetsWorkerStatus]);

  // /course 첫 진입 UX: 설정이 비어 있으면(또는 설정파일이 없으면) 감지된 코스를 UI 상태에 미리 채운다. (저장은 사용자가 명시적으로 수행)
  useEffect(() => {
    if (!auditLoaded) return;
    if (autoSeededRef.current) return;
    if (!inferredCourses.length) return;

    const curKeys = Object.keys((auditConfig && typeof auditConfig === "object" ? auditConfig.courses : null) || {});
    if (curKeys.length) {
      autoSeededRef.current = true;
      return;
    }

    setAuditConfig((prev) => {
      const base = ensureAuditConfigBase(prev);
      const nextCourses: Record<string, CourseMembershipAuditCourse> = { ...(base.courses || {}) };
      for (const c of inferredCourses) {
        const cc = ensureAuditCourseBase(null);
        cc.enabled = false;
        const pick = (rt: RoomType): string => {
          const arr = c.rooms[rt] || [];
          if (arr.length !== 1) return "";
          return normStr(arr[0]?.roomId);
        };
        cc.rooms = { chat: pick("chat"), notice: pick("notice"), premium: pick("premium") };
        nextCourses[c.courseKey] = cc;
      }
      return { ...base, courses: nextCourses };
    });
    setAuditDirty(true);
    autoSeededRef.current = true;
  }, [auditLoaded, auditConfig, inferredCourses]);

  // 1회 실행(임시 ON) 완료 후 원래 상태로 복구
  useEffect(() => {
    const entries = Object.entries(pendingV2OneOff || {});
    if (!entries.length) return;

    const st = auditWorkerStatus && typeof auditWorkerStatus === "object" ? (auditWorkerStatus as any).state : null;
    const courses = st && typeof st === "object" ? (st as any).courses : null;
    if (!courses || typeof courses !== "object") return;

    for (const [courseKey, p] of entries) {
      const cs = (courses as any)[courseKey];
      if (!cs || typeof cs !== "object") continue;
      const lastRunMs = Number((cs as any).lastRunMs || 0);
      if (!lastRunMs || lastRunMs < Number(p.startedAtMs || 0)) continue;

      // 완료로 판단 → pending 제거 후 복구 시도
      setPendingV2OneOff((prev) => {
        const next = { ...(prev || {}) };
        delete (next as any)[courseKey];
        return next;
      });

      const needRestore = p.originalWorkerEnabled === false || p.originalCourseEnabled === false;
      if (!needRestore) continue;

      void (async () => {
        await saveAuditConfig({
          workerEnabled: p.originalWorkerEnabled,
          courseEnabled: { [courseKey]: p.originalCourseEnabled },
        });
        // worker.enabled=false로 복귀하는 경우, 재시작으로 프로세스가 빨리 종료되도록 유도
        if (p.originalWorkerEnabled === false) {
          await restartAuditWorker();
        }
      })();
    }
  }, [pendingV2OneOff, auditWorkerStatus, saveAuditConfig, restartAuditWorker]);

  return (
    <div className="dashboard-container">
      <div className="header-section">
        <div style={{ minWidth: 0 }}>
          <h1 className="main-title">강의 운영</h1>
          <p className="sub-title" style={{ marginBottom: 0 }}>
            코스(강의) 단위로 카페 + 오픈채팅 3방 데이터를 취합해서 Google Sheets에 upsert 합니다.
          </p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn-outline" onClick={() => { void loadRooms(); void loadRuntime(); void loadAuditConfig(); void loadAuditWorkerStatus(); }}>
            새로고침
          </button>
          <button
            className="btn-save"
            disabled={!auditDirty || auditSaving === "saving"}
            onClick={() => void saveAuditConfig()}
            title={auditPath ? `${auditPath} 저장` : "v2 설정 저장"}
          >
            {auditSaving === "saving" ? "저장 중…" : "변경사항 저장"}
          </button>
        </div>
      </div>

      {(roomsError || runtimeError || auditError || courseRosterConfigError || rosterWorkerStatusError || auditWorkerStatusError || auditServiceAccount.error) && (
        <div
          className="pipeline-card"
          style={{
            marginTop: 12,
            background: "rgba(239,68,68,0.08)",
            border: "1px solid var(--border-color)",
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6, color: "var(--error)" }}>로드/상태 오류</div>
          {roomsError && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- rooms: <code>{roomsError}</code></div>)}
          {runtimeError && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- runtime: <code>{runtimeError}</code></div>)}
          {auditError && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- v2 config: <code>{auditError}</code></div>)}
          {courseRosterConfigError && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- v1 config: <code>{courseRosterConfigError}</code></div>)}
          {auditServiceAccount.error && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- service account: <code>{String(auditServiceAccount.error)}</code></div>)}
          {rosterWorkerStatusError && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- v1 worker status: <code>{rosterWorkerStatusError}</code></div>)}
          {auditWorkerStatusError && (<div style={{ fontSize: 13, color: "var(--text-secondary)" }}>- v2 worker status: <code>{auditWorkerStatusError}</code></div>)}
        </div>
      )}

      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>빠른 사용법</h3>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.75 }}>
          <div>1) 방 이름이 <code>(사담방)</code> / <code>(공지방)</code> / <code>(프리미엄방)</code> 접두어 규칙을 따르는지 확인합니다.</div>
          <div>2) 아래 코스 카드에서 <b>스프레드시트 URL/ID</b> + <b>카페 URL/clubId</b> + <b>프리미엄/운영진 등급</b>을 입력하고 <b>변경사항 저장</b>을 눌러 저장합니다.</div>
          <div>3) 코스 카드의 <b>지금 1회 업서트</b>로 RAW/VIEW/LOG를 한 번 갱신합니다. (v2는 clear 없이 upsert)</div>
          <div>4) 초반에 자주 확인이 필요하면 <b>v2 자동 갱신</b>을 켜고, 코스 카드의 <b>자동 갱신 포함</b>도 ON으로 둡니다.</div>
          <div>5) 카카오 안내(레거시)는 <b>강의 메시지 발송</b>이 ON일 때만 나가며, OFF면 절대 발송되지 않습니다.</div>
        </div>
      </div>

      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>v2 자동 갱신</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label className="control-label" style={{ display: "flex", gap: 8, alignItems: "center" }} title="ON이면 enabled 코스만 주기적으로 Sheets를 갱신합니다.">
            <input
              type="checkbox"
              checked={!!auditConfig?.worker?.enabled}
              onChange={(e) => void setV2AutoRunEnabled(e.target.checked)}
              disabled={auditSaving === "saving"}
            />
            자동 갱신
          </label>
          <span className="tag tag-excluded" title="초반/안정기 주기">
            {v2ScheduleLabel}
          </span>
          <span className={`tag ${auditConfig?.worker?.enabled ? "tag-active" : "tag-inactive"}`}>
            {auditConfig?.worker?.enabled ? "ON" : "OFF"}
          </span>
          <span className={`tag ${auditDirty ? "tag-inactive" : "tag-active"}`}>설정 {auditDirty ? "저장 필요" : "OK"}</span>
          <span className="tag tag-excluded" title={auditPath || ""}>설정파일 {auditExists ? "OK" : "없음"}</span>
          <span className="tag tag-excluded" title={auditServiceAccount.path || ""}>서비스계정 {auditServiceAccount.exists ? "OK" : "없음"}</span>
          {auditServiceAccount.clientEmail && (
            <span className="tag tag-excluded" title="서비스계정 이메일">{auditServiceAccount.clientEmail}</span>
          )}
          <span className="tag tag-excluded" title="course-membership-audit-worker status">
            워커 {auditWorkerStatus?.status?.pid ? `RUN(pid=${auditWorkerStatus.status.pid})` : "N/A"}
          </span>
          <button
            className="btn-outline"
            style={{ padding: "6px 10px", fontSize: 12 }}
            onClick={() => void restartAuditWorker()}
            title="windows/start_course_membership_audit_worker.ps1 -Restart"
          >
            워커 재시작
          </button>
          <label className="btn-outline" style={{ padding: "6px 10px", fontSize: 12, cursor: "pointer" }} title="data/gcp_service_account.json 업로드">
            서비스계정 업로드
            <input
              type="file"
              accept="application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void uploadServiceAccount(f);
              }}
            />
          </label>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          - Sheets upsert 권한은 <b>Chrome 로그인</b>이 아니라 <b>서비스계정(Editor 공유)</b> 기준입니다.
          <br />
          - 자동 갱신은 <b>코스별 enabled</b>가 ON인 코스만 실행합니다.
        </div>
      </div>

      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>강의톡방 자동 감지</h3>
        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          - 방 이름 접두어 규칙: <code>(사담방)</code> / <code>(공지방)</code> / <code>(프리미엄방)</code>
          <br />
          - 접두어 뒤 나머지 이름이 같으면 같은 코스로 묶습니다.
        </div>
        <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="tag tag-excluded">감지 코스 {inferredCourses.length}개</span>
          <span className="tag tag-excluded">코스 카드 {courseKeys.length}개</span>
          <button
            className="btn-outline"
            style={{ padding: "6px 10px", fontSize: 12 }}
            onClick={addAllDetectedCourses}
            disabled={!inferredCourses.length}
            title="감지된 코스를 v2 설정에 추가합니다(기본: enabled=OFF)."
          >
            감지 코스 채우기(기본 OFF)
          </button>
          {!inferredCourses.length && (
            <span className="tag tag-inactive" title="방 이름 접두어 규칙을 확인하세요">
              감지 없음
            </span>
          )}
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          - 감지된 코스/방 매핑은 아래 코스 카드에 자동 반영됩니다.
          <br />
          - 감지가 안 되면 <b>방 이름 접두어</b>가 정확한지 먼저 확인해주세요.
        </div>
      </div>

      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>카카오 안내(레거시)</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
            강의 메시지 발송
            <input
              type="checkbox"
              checked={courseOpsSendEnabled}
              onChange={(e) => {
                const next = e.target.checked;
                if (next) {
                  const ok = confirm(
                    "강의 메시지 발송을 켤까요?\n\n" +
                    "- SAFE_MODE가 OFF이고\n" +
                    "- Talk-API가 ON이며\n" +
                    "- 코스별 '입장자 안내'가 ON인 방이 있으면\n" +
                    "안내 메시지가 자동 발송될 수 있습니다.\n\n" +
                    "※ 마음의 준비가 됐을 때만 켜주세요.",
                  );
                  if (!ok) return;
                }
                void setCourseOpsSendEnabled(next);
              }}
              disabled={runtimeSaving === "saving"}
            />
          </label>
          <span className={`tag ${courseOpsSendEnabled ? "tag-active" : "tag-inactive"}`} title="OFF면 어떤 코스/방 설정이 켜져 있어도 발송되지 않습니다.">
            발송 {courseOpsSendEnabled ? "ON" : "OFF"}
          </span>
          <span className={`tag ${(runtime && (runtime as any).safeMode === true) ? "tag-inactive" : "tag-active"}`} title="SAFE_MODE=true면 모든 발신이 차단됩니다.">
            SAFE_MODE {(runtime && (runtime as any).safeMode === true) ? "ON" : "OFF"}
          </span>
          <span className={`tag ${(runtime && (runtime as any).talkApi?.enabled === true) ? "tag-active" : "tag-inactive"}`} title="Talk-API가 꺼져 있으면 멘션/Reply 발송이 불가합니다.">
            Talk-API {(runtime && (runtime as any).talkApi?.enabled === true) ? "ON" : "OFF"}
          </span>
          <span className={`tag ${runtimeSaving === "error" ? "tag-excluded" : runtimeSaving === "saving" ? "tag-inactive" : "tag-active"}`}>
            런타임 {runtimeSaving === "saving" ? "저장 중" : runtimeSaving === "error" ? "오류" : "OK"}
          </span>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          - 이 토글이 <b>OFF</b>이면 <b>절대 발송되지 않습니다.</b>
          <br />
          - 발송은 코스 카드의 <b>입장자 안내(레거시)</b>가 ON인 방에서만 동작합니다.
          <br />
          - (v1 동작) 신규 입장자 기준으로 <b>입장 후 15분</b>, <b>24시간</b>에 최대 2회 안내(멘션/Reply)를 보냅니다.
          <br />
          - v2 Sheets 업서트는 메시지 발송과 무관합니다.
        </div>
      </div>

      {showOpenchatMembersSheetsUi && (
      <div className="pipeline-card" style={{ marginTop: 12 }}>
        <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>톡방 멤버 Sheets(선택)</h3>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 10 }}>
          <span className={`tag ${openchatMembersSheetsConfigDirty ? "tag-inactive" : "tag-active"}`}>
            설정 {openchatMembersSheetsConfigDirty ? "저장 필요" : "OK"}
          </span>
          <span className="tag tag-excluded" title={openchatMembersSheetsConfigPath || ""}>
            설정파일 {openchatMembersSheetsConfigExists ? "OK" : "없음"}
          </span>
          <span className="tag tag-excluded" title="openchat-members-sheets-worker status">
            워커 {openchatMembersSheetsWorkerStatus?.status?.pid ? `RUN(pid=${openchatMembersSheetsWorkerStatus.status.pid})` : "N/A"}
          </span>
          <button
            className="btn-outline"
            style={{ padding: "6px 10px", fontSize: 12 }}
            onClick={() => void restartOpenchatMembersSheetsWorker()}
            title="windows/start_openchat_members_sheets_worker.ps1 -Restart"
          >
            워커 재시작
          </button>
          <button
            className="btn-save"
            style={{ padding: "6px 10px", fontSize: 12 }}
            disabled={openchatMembersSheetsConfigSaving === "saving" || !openchatMembersSheetsConfigDirty}
            onClick={() => void saveOpenchatMembersSheetsConfig()}
            title="data/openchat_members_sheets.json 저장"
          >
            {openchatMembersSheetsConfigSaving === "saving" ? "저장 중…" : "멤버설정 저장"}
          </button>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label className="control-label" style={{ display: "flex", gap: 8, alignItems: "center" }} title="openchat_members_sheets.json의 worker.enabled">
            <input
              type="checkbox"
              checked={!!openchatMembersSheetsConfig?.worker?.enabled}
              onChange={(e) => {
                setOpenchatMembersSheetsConfig((prev) => {
                  const base = ensureOpenchatMembersSheetsConfigBase(prev);
                  // 스케줄링 ON 시 고정: 10분
                  const worker = { ...(base.worker || {}), enabled: e.target.checked, intervalSec: 600 };
                  return { ...base, worker };
                });
                setOpenchatMembersSheetsConfigDirty(true);
              }}
            />
            자동 동기화 워커
          </label>
          <span className="tag tag-excluded" title="스케줄링 ON 시 고정: 매 10분 업서트">주기 10분(고정)</span>
          <input
            value={String(openchatMembersSheetsConfig?.spreadsheetId || "")}
            onChange={(e) => {
              setOpenchatMembersSheetsConfig((prev) => {
                const base = ensureOpenchatMembersSheetsConfigBase(prev);
                return { ...base, spreadsheetId: e.target.value };
              });
              setOpenchatMembersSheetsConfigDirty(true);
            }}
            placeholder="기본 Spreadsheet ID/URL (빈칸이면 방별 값 필요)"
            className="filter-input"
            style={{ flex: 1, minWidth: 280, height: 34, marginBottom: 0 }}
          />
          <input
            value={String(openchatMembersSheetsConfig?.sheetName || "")}
            onChange={(e) => {
              setOpenchatMembersSheetsConfig((prev) => {
                const base = ensureOpenchatMembersSheetsConfigBase(prev);
                return { ...base, sheetName: e.target.value };
              });
              setOpenchatMembersSheetsConfigDirty(true);
            }}
            placeholder="기본 시트 탭(빈칸이면 방 이름 기반 자동 추론, 최종 fallback: members)"
            className="filter-input"
            style={{ width: 360, height: 34, marginBottom: 0 }}
          />
        </div>

        {(openchatMembersSheetsConfigError || openchatMembersSheetsWorkerStatusError) && (
          <div style={{ fontSize: 12, color: "var(--error)", lineHeight: 1.5, marginTop: 8 }}>
            {openchatMembersSheetsConfigError && (<div>설정 로드/저장 오류: <code>{openchatMembersSheetsConfigError}</code></div>)}
            {openchatMembersSheetsWorkerStatusError && (<div>워커 상태 조회 오류: <code>{openchatMembersSheetsWorkerStatusError}</code></div>)}
          </div>
        )}
        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
          - 코스(강의) 단위 관리는 아래 <b>코스 카드</b>에서 roomId별 옵션을 설정하세요.
          <br />
          - 시트 탭 기본값(자동 추론): <code>(사담방)=MEMBERS_CHAT</code>, <code>(공지방)=MEMBERS_NOTICE</code>, <code>(프리미엄방)=MEMBERS_PREMIUM</code>
        </div>
      </div>
      )}

      <div style={{ marginTop: 16 }}>
        <div className="section-title">
          <span>코스 목록</span>
          <span style={{ fontSize: 14, fontWeight: 400, color: "var(--text-muted)" }}>({courseKeys.length}개)</span>
        </div>

        {courseKeys.length === 0 && (
          <div className="pipeline-card" style={{ marginTop: 12 }}>
            <div style={{ color: "var(--text-secondary)" }}>
              감지된 코스가 없습니다. 방 이름 접두어가 <code>(사담방)</code>/<code>(공지방)</code>/<code>(프리미엄방)</code> 형식인지 확인해주세요.
            </div>
          </div>
        )}

        {courseKeys.map((courseKey) => {
          const inferred = inferredCourses.find((c) => c.courseKey === courseKey);
          const hasConfig = !!(auditConfig?.courses && (auditConfig.courses as any)[courseKey]);
          const curBase = ensureAuditCourseBase(hasConfig ? (auditConfig?.courses || {})[courseKey] : null);
          const cur: CourseMembershipAuditCourse = hasConfig ? curBase : { ...curBase, enabled: false };

          const resolveOne = (rt: RoomType): RoomInfo | null => {
            const arr = inferred?.rooms?.[rt] || [];
            return arr.length === 1 ? arr[0] : null;
          };

          const inferredChat = resolveOne("chat");
          const inferredNotice = resolveOne("notice");
          const inferredPremium = resolveOne("premium");
          const inferredOk = !!(inferredChat && inferredNotice && inferredPremium);

          const ridChat = normStr((cur.rooms as any)?.chat);
          const ridNotice = normStr((cur.rooms as any)?.notice);
          const ridPremium = normStr((cur.rooms as any)?.premium);
          const mappingOk = !!(ridChat && ridNotice && ridPremium && new Set([ridChat, ridNotice, ridPremium]).size === 3);

          const rChat = (ridChat ? (roomById.get(ridChat) || null) : null) || inferredChat;
          const rNotice = (ridNotice ? (roomById.get(ridNotice) || null) : null) || inferredNotice;
          const rPremium = (ridPremium ? (roomById.get(ridPremium) || null) : null) || inferredPremium;

          const clubIdInput = String(cur.clubId || "").trim();
          const spreadsheetInput = String(cur.spreadsheetId || "").trim();
          const joinUrlInput = String((cur as any).joinUrl || "").trim();
          const premiumGradeText = gradeTextByCourse[courseKey]?.premiumText ?? (cur.gradeRules?.premiumGrades || []).join(", ");
          const staffGradeText = gradeTextByCourse[courseKey]?.staffText ?? (cur.gradeRules?.staffGrades || []).join(", ");
          const pendingOneOff = !!(pendingV2OneOff && (pendingV2OneOff as any)[courseKey]);
          const v2CoursesState = (auditWorkerStatus && typeof auditWorkerStatus === "object") ? (auditWorkerStatus as any).state?.courses : null;
          const v2CourseState = (v2CoursesState && typeof v2CoursesState === "object") ? (v2CoursesState as any)[courseKey] : null;
          const v2LastResult = normStr(v2CourseState?.lastResult || "");
          const v2LastResultLabel =
            v2LastResult === "OK" ? "완료" :
            v2LastResult === "ERROR" ? "실패" :
            v2LastResult === "RUNNING" ? "진행 중" :
            v2LastResult;
          const v2LastResultTagClass =
            v2LastResult === "OK" ? "tag-active" :
            v2LastResult === "RUNNING" ? "tag-inactive" :
            v2LastResult === "ERROR" ? "tag-excluded" :
            "tag-excluded";
          const v2LastRunTs = normStr(v2CourseState?.lastRunTs || "");
          const v2NextRunTs = normStr(v2CourseState?.nextRunTs || "");
          const v2Progress = (v2CourseState && typeof v2CourseState === "object") ? (v2CourseState as any).progress : null;
          const v2ProgressStage = normStr(v2Progress?.stage || "");
          const v2ProgressMsg = normStr(v2Progress?.message || "");
          const v2ProgressTs = normStr(v2Progress?.ts || "");
          const v2ProgressPctRaw = v2Progress?.pct;
          const v2ProgressPct = Number.isFinite(Number(v2ProgressPctRaw)) ? Math.max(0, Math.min(100, Number(v2ProgressPctRaw))) : null;
          const v2Events = Array.isArray((v2CourseState as any)?.events) ? ((v2CourseState as any).events as any[]) : [];
          const v2LastErrorRaw = normStr(v2CourseState?.lastError || "");
          const v2LastErrorUser = normStr((v2CourseState as any)?.lastErrorUser || "");
          const v2ErrorFriendly = friendlyV2Error(v2LastErrorRaw, v2LastErrorUser);
          const v2HasProgressUi = !!(pendingOneOff || v2ProgressStage || v2ProgressMsg || v2Events.length || v2LastResult === "ERROR" || v2LastResult === "RUNNING");
          const courseKeySlug = String(courseKey || "").replace(/[^a-zA-Z0-9_-]/g, "_");

          const missingForRunOnce: string[] = [];
          if (!auditServiceAccount.exists) missingForRunOnce.push("서비스계정");
          if (!/^\d+$/.test(clubIdInput)) missingForRunOnce.push("clubId(숫자)");
          if (!spreadsheetInput) missingForRunOnce.push("스프레드시트");
          if (!mappingOk) missingForRunOnce.push("방 매핑");
          const canRunOnce = missingForRunOnce.length === 0;
          const runtimeFeatures = (runtime && typeof runtime === "object") ? (runtime as any).features : null;
          const courseRosterEnabled = !!(
            ridChat && runtimeFeatures && typeof runtimeFeatures === "object" && (runtimeFeatures as any)[ridChat]?.courseRoster === true &&
            ridNotice && runtimeFeatures && typeof runtimeFeatures === "object" && (runtimeFeatures as any)[ridNotice]?.courseRoster === true &&
            ridPremium && runtimeFeatures && typeof runtimeFeatures === "object" && (runtimeFeatures as any)[ridPremium]?.courseRoster === true
          );

          const openchatCfgRooms: Record<string, any> =
            (openchatMembersSheetsConfig && typeof openchatMembersSheetsConfig === "object" && typeof (openchatMembersSheetsConfig as any).rooms === "object" && (openchatMembersSheetsConfig as any).rooms)
              ? ((openchatMembersSheetsConfig as any).rooms as any)
              : {};

          const getOpenchatRoomCfg = (rid: string): OpenchatMembersSheetsRoomConfig => {
            const roomId = String(rid || "").trim();
            if (!roomId) return {};
            const v = openchatCfgRooms[roomId];
            return (v && typeof v === "object") ? (v as any) : {};
          };

          const getOpenchatRoomState = (rid: string): any | null => {
            const roomId = String(rid || "").trim();
            if (!roomId) return null;
            const st = openchatMembersSheetsWorkerStatus?.state;
            const roomsObj = st && typeof st === "object" ? (st as any).rooms : null;
            if (!roomsObj || typeof roomsObj !== "object") return null;
            const v = (roomsObj as any)[roomId];
            return (v && typeof v === "object") ? v : null;
          };

          const fillCourseOpenchatMembersSheetsDefaults = (): void => {
            const spreadsheetId = String(cur.spreadsheetId || "").trim();
            const applyOne = (rt: RoomType, room: RoomInfo | null) => {
              const rid = String(room?.roomId || "").trim();
              if (!rid) return;
              const base = getOpenchatRoomCfg(rid);
              const sheetNameDefault = rt === "chat" ? "MEMBERS_CHAT" : rt === "notice" ? "MEMBERS_NOTICE" : "MEMBERS_PREMIUM";
              const patch: Partial<OpenchatMembersSheetsRoomConfig> = {};
              if (!String(base.spreadsheetId || "").trim() && spreadsheetId) patch.spreadsheetId = spreadsheetId;
              if (!String(base.sheetName || "").trim()) patch.sheetName = sheetNameDefault;
              if (Object.keys(patch).length) updateOpenchatMembersSheetsRoom(rid, patch);
            };
            applyOne("chat", rChat);
            applyOne("notice", rNotice);
            applyOne("premium", rPremium);
          };

          return (
            <div key={courseKey} className="pipeline-card" style={{ marginTop: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 800, color: "var(--text-primary)", fontSize: 16, wordBreak: "break-word" }}>
                    {courseKey}
                  </div>
                  <div style={{ marginTop: 6, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <span className={`tag ${mappingOk ? "tag-active" : "tag-inactive"}`}>방 매핑 {mappingOk ? "OK" : "필요"}</span>
                    <span className={`tag ${inferredOk ? "tag-active" : "tag-inactive"}`}>자동 감지 {inferredOk ? "OK" : "미완성"}</span>
                    <span className={`tag ${hasConfig ? "tag-active" : "tag-excluded"}`}>설정 {hasConfig ? "OK" : "없음"}</span>
                    <span className={`tag ${auditDirty ? "tag-inactive" : "tag-active"}`}>저장 {auditDirty ? "필요" : "OK"}</span>
                    {v2LastResult && (
                      <span className={`tag ${v2LastResultTagClass}`}>
                        {v2LastResult === "RUNNING" ? v2LastResultLabel : `최근 ${v2LastResultLabel}`}
                      </span>
                    )}
                    {pendingOneOff && (
                      <span className="tag tag-inactive" title="1회 업서트 실행을 위해 잠시 워커를 켠 상태일 수 있습니다.">
                        1회 실행 대기
                      </span>
                    )}
                    {v2LastRunTs && (
                      <span className="tag tag-excluded" title="최근 실행">
                        최근 {v2LastRunTs}
                      </span>
                    )}
                    {v2NextRunTs && auditConfig?.worker?.enabled && cur.enabled !== false && (
                      <span className="tag tag-excluded" title="다음 자동 실행 예정">
                        다음 {v2NextRunTs}
                      </span>
                    )}
                    <button
                      className="btn-save"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      disabled={!auditDirty || auditSaving === "saving"}
                      onClick={() => void saveAuditConfig()}
                      title={auditDirty ? "변경사항을 저장합니다" : "저장할 변경사항이 없습니다"}
                    >
                      {auditSaving === "saving" ? "저장 중…" : auditDirty ? "설정 저장" : "저장됨"}
                    </button>
                    <button
                      className="btn-save"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      disabled={!canRunOnce || auditSaving === "saving"}
                      onClick={() => void runV2UpsertOnce(courseKey)}
                      title={canRunOnce ? "카페 + 3방 취합 → Sheets(AUDIT_VIEW/AUDIT_LOG) 1회 업서트" : `필수값 누락: ${missingForRunOnce.join(", ")}`}
                    >
                      {pendingOneOff ? "업서트 대기…" : "지금 1회 업서트"}
                    </button>
                    <button
                      className="btn-outline"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => applyInferredRooms(courseKey)}
                      disabled={!inferred || auditSaving === "saving"}
                      title="감지된 방 매핑(사담/공지/프리미엄)을 rooms에 반영합니다."
                    >
                      방 매핑 자동
                    </button>
                    {!hasConfig && (
                      <button className="btn-outline" style={{ padding: "6px 10px", fontSize: 12 }} onClick={() => ensureCourseEntry(courseKey)}>
                        설정 추가
                      </button>
                    )}
                  </div>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                  자동 갱신 포함
                  <input
                    type="checkbox"
                    checked={cur.enabled !== false}
                    onChange={(e) => updateCourseField(courseKey, { enabled: e.target.checked })}
                    style={{ width: 18, height: 18, accentColor: "var(--accent-primary)" }}
                  />
                </label>
              </div>

              {v2HasProgressUi && (
                <div
                  style={{
                    marginTop: 12,
                    padding: 12,
                    border: "1px solid var(--border-color)",
                    borderRadius: 10,
                    background: "rgba(255,255,255,0.02)",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, color: "var(--text-primary)" }}>진행 상태</div>
                    {(v2ProgressStage || v2LastResult) && (
                      <span className={`tag ${v2LastResult === "ERROR" ? "tag-excluded" : v2ProgressStage ? "tag-inactive" : "tag-excluded"}`}>
                        {v2ProgressStage ? v2StageLabel(v2ProgressStage) : v2LastResultLabel}
                      </span>
                    )}
                  </div>

                  <div style={{ marginTop: 8, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {v2ProgressMsg || (pendingOneOff ? "실행 요청됨 · 완료되면 자동으로 원복됩니다." : "")}
                  </div>

                  {(v2ProgressPct !== null || v2ProgressStage) && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ height: 8, borderRadius: 999, background: "rgba(148,163,184,0.18)", overflow: "hidden" }}>
                        <div
                          style={{
                            height: 8,
                            width: `${v2ProgressPct !== null ? v2ProgressPct : (v2DefaultPct(v2ProgressStage) ?? 0)}%`,
                            background: v2LastResult === "ERROR" ? "rgba(239,68,68,0.7)" : "rgba(59,130,246,0.7)",
                            transition: "width 0.35s ease",
                          }}
                        />
                      </div>
                      <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                        {v2ProgressTs ? `${formatAgo(v2ProgressTs)} · ${formatIsoToHHMMSS(v2ProgressTs)}` : ""}
                      </div>
                    </div>
                  )}

                  {v2LastResult === "ERROR" && v2ErrorFriendly && (
                    <div style={{ marginTop: 10, fontSize: 13, color: "var(--error)", lineHeight: 1.6 }}>
                      실패: {v2ErrorFriendly}
                    </div>
                  )}

                  {v2Events.length > 0 && (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--text-primary)" }}>
                        진행 로그
                      </summary>
                      <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
                        {v2Events.slice(-12).map((ev: any, idx: number) => {
                          const ts = normStr(ev?.ts || "");
                          const msg = normStr(ev?.message || "");
                          const level = normStr(ev?.level || "");
                          const stg = normStr(ev?.stage || "");
                          if (!msg) return null;
                          return (
                            <div
                              key={`${courseKeySlug}-ev-${idx}`}
                              style={{
                                fontSize: 12,
                                color: level.toUpperCase() === "ERROR" ? "var(--error)" : "var(--text-secondary)",
                                display: "flex",
                                gap: 8,
                                alignItems: "baseline",
                                flexWrap: "wrap",
                              }}
                            >
                              <span style={{ color: "var(--text-muted)" }}>{ts ? formatIsoToHHMMSS(ts) : ""}</span>
                              {stg && (
                                <span className="tag tag-excluded" style={{ padding: "2px 8px", fontSize: 11 }}>
                                  {v2StageLabel(stg)}
                                </span>
                              )}
                              <span>{msg}</span>
                            </div>
                          );
                        })}
                      </div>
                    </details>
                  )}

                  {v2LastResult === "ERROR" && v2LastErrorRaw && (
                    <details style={{ marginTop: 10 }}>
                      <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--text-primary)" }}>
                        고급: 오류 상세
                      </summary>
                      <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, wordBreak: "break-word" }}>
                        <code>{v2LastErrorRaw}</code>
                      </div>
                    </details>
                  )}
                </div>
              )}

              <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, alignItems: "start" }}>
                <div>
                  <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>기본 설정</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      스프레드시트 URL 또는 ID
                      <input
                        className="filter-input"
                        style={{ width: "100%", height: 38, marginTop: 6 }}
                        value={spreadsheetInput}
                        onChange={(e) => updateCourseField(courseKey, { spreadsheetId: e.target.value })}
                        placeholder="https://docs.google.com/spreadsheets/d/... 또는 시트 ID"
                      />
                    </label>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      카페 URL 또는 clubId
                      <input
                        className="filter-input"
                        style={{ width: "100%", height: 38, marginTop: 6 }}
                        value={clubIdInput}
                        onChange={(e) => {
                          const v = e.target.value;
                          const extracted = extractNaverCafeClubId(v);
                          updateCourseField(courseKey, { clubId: extracted || v });
                        }}
                        placeholder="...clubid=123 또는 /cafes/123 또는 123"
                      />
                      {extractNaverCafeClubId(clubIdInput) && (
                        <div style={{ marginTop: 6, fontSize: 12, color: "var(--text-muted)" }}>
                          clubId 추출: <code>{extractNaverCafeClubId(clubIdInput)}</code>
                        </div>
                      )}
                    </label>
                  </div>

                  <label style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 10 }}>
                    카페 가입신청/가입요청 URL (선택)
                    <input
                      className="filter-input"
                      style={{ width: "100%", height: 38, marginTop: 6 }}
                      value={joinUrlInput}
                      onChange={(e) => updateCourseField(courseKey, { joinUrl: e.target.value })}
                      placeholder="https://cafe.naver.com/... (선택)"
                    />
                  </label>

                  <div style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>등급 규칙</div>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      프리미엄 등급(구분자: 줄바꿈 / . / /)
                      <textarea
                        className="filter-input"
                        style={{ width: "100%", height: 76, marginTop: 6, paddingTop: 8 }}
                        value={premiumGradeText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGradeTextByCourse((prev) => ({ ...(prev || {}), [courseKey]: { premiumText: v, staffText: staffGradeText } }));
                          setAuditDirty(true);
                        }}
                        placeholder={"예: 프리미엄반\n2단계"}
                      />
                    </label>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 10 }}>
                      운영진 등급(구분자: 줄바꿈 / . / /)
                      <textarea
                        className="filter-input"
                        style={{ width: "100%", height: 66, marginTop: 6, paddingTop: 8 }}
                        value={staffGradeText}
                        onChange={(e) => {
                          const v = e.target.value;
                          setGradeTextByCourse((prev) => ({ ...(prev || {}), [courseKey]: { premiumText: premiumGradeText, staffText: v } }));
                          setAuditDirty(true);
                        }}
                        placeholder={"예: 운영진\n스태프"}
                      />
                    </label>
                    <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                      - 등급명은 <b>정확히 일치</b>로만 판별합니다. (포함/정규식 X)
                      <br />
                      - 위 목록에 없는 등급은 자동으로 일반(새싹 포함) 취급합니다.
                    </div>
                  </div>
                </div>

                <div>
                  <div style={{ fontWeight: 800, color: "var(--text-primary)", marginBottom: 8 }}>방 매핑</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, color: "var(--text-secondary)" }}>
                    <div>
                      - 사담방:{" "}
                      {rChat ? (
                        <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{rChat.roomName}</span>
                      ) : (
                        <span style={{ color: "var(--error)" }}>미감지/중복</span>
                      )}
                    </div>
                    <div>
                      - 공지방:{" "}
                      {rNotice ? (
                        <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{rNotice.roomName}</span>
                      ) : (
                        <span style={{ color: "var(--error)" }}>미감지/중복</span>
                      )}
                    </div>
                    <div>
                      - 프리미엄방:{" "}
                      {rPremium ? (
                        <span style={{ color: "var(--text-primary)", fontWeight: 700 }}>{rPremium.roomName}</span>
                      ) : (
                        <span style={{ color: "var(--error)" }}>미감지/중복</span>
                      )}
                    </div>
                  </div>

                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      사담방 roomId
                      <input
                        className="filter-input"
                        style={{ width: "100%", height: 36, marginTop: 6 }}
                        value={ridChat}
                        onChange={(e) => updateCourseField(courseKey, { rooms: { ...(cur.rooms || {}), chat: e.target.value } })}
                        list={`rooms-${courseKeySlug}-chat`}
                        placeholder="roomId (자동 감지가 안 되면 여기서 선택/입력)"
                      />
                      <datalist id={`rooms-${courseKeySlug}-chat`}>
                        {(inferred?.rooms?.chat || []).map((r) => (
                          <option key={r.roomId} value={String(r.roomId)}>{r.roomName}</option>
                        ))}
                      </datalist>
                    </label>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      공지방 roomId
                      <input
                        className="filter-input"
                        style={{ width: "100%", height: 36, marginTop: 6 }}
                        value={ridNotice}
                        onChange={(e) => updateCourseField(courseKey, { rooms: { ...(cur.rooms || {}), notice: e.target.value } })}
                        list={`rooms-${courseKeySlug}-notice`}
                        placeholder="roomId (자동 감지가 안 되면 여기서 선택/입력)"
                      />
                      <datalist id={`rooms-${courseKeySlug}-notice`}>
                        {(inferred?.rooms?.notice || []).map((r) => (
                          <option key={r.roomId} value={String(r.roomId)}>{r.roomName}</option>
                        ))}
                      </datalist>
                    </label>
                    <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                      프리미엄방 roomId
                      <input
                        className="filter-input"
                        style={{ width: "100%", height: 36, marginTop: 6 }}
                        value={ridPremium}
                        onChange={(e) => updateCourseField(courseKey, { rooms: { ...(cur.rooms || {}), premium: e.target.value } })}
                        list={`rooms-${courseKeySlug}-premium`}
                        placeholder="roomId (자동 감지가 안 되면 여기서 선택/입력)"
                      />
                      <datalist id={`rooms-${courseKeySlug}-premium`}>
                        {(inferred?.rooms?.premium || []).map((r) => (
                          <option key={r.roomId} value={String(r.roomId)}>{r.roomName}</option>
                        ))}
                      </datalist>
                    </label>
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    - roomId는 방 카드에서 ID를 클릭해 복사할 수 있습니다.
                  </div>

                  <details style={{ marginTop: 14 }}>
                    <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--text-primary)" }}>고급: 탭 이름(기본값)</summary>
                    <div style={{ marginTop: 10 }}>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                        <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                          CAFE_RAW
                          <input
                            className="filter-input"
                            style={{ width: "100%", height: 36, marginTop: 6 }}
                            value={normStr(cur.tabs?.cafeRaw || "CAFE_RAW")}
                            onChange={(e) => updateCourseField(courseKey, { tabs: { ...(cur.tabs || {}), cafeRaw: e.target.value } })}
                          />
                        </label>
                        <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                          OPENCHAT_RAW
                          <input
                            className="filter-input"
                            style={{ width: "100%", height: 36, marginTop: 6 }}
                            value={normStr(cur.tabs?.openchatRaw || "OPENCHAT_RAW")}
                            onChange={(e) => updateCourseField(courseKey, { tabs: { ...(cur.tabs || {}), openchatRaw: e.target.value } })}
                          />
                        </label>
                        <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                          RULES_RAW
                          <input
                            className="filter-input"
                            style={{ width: "100%", height: 36, marginTop: 6 }}
                            value={normStr(cur.tabs?.rulesRaw || "RULES_RAW")}
                            onChange={(e) => updateCourseField(courseKey, { tabs: { ...(cur.tabs || {}), rulesRaw: e.target.value } })}
                          />
                        </label>
                        <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                          AUDIT_VIEW
                          <input
                            className="filter-input"
                            style={{ width: "100%", height: 36, marginTop: 6 }}
                            value={normStr(cur.tabs?.audit || "AUDIT_VIEW")}
                            onChange={(e) => updateCourseField(courseKey, { tabs: { ...(cur.tabs || {}), audit: e.target.value } })}
                          />
                        </label>
                        <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                          AUDIT_LOG
                          <input
                            className="filter-input"
                            style={{ width: "100%", height: 36, marginTop: 6 }}
                            value={normStr(cur.tabs?.auditLog || "AUDIT_LOG")}
                            onChange={(e) => updateCourseField(courseKey, { tabs: { ...(cur.tabs || {}), auditLog: e.target.value } })}
                          />
                        </label>
                      </div>

                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                        <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                          - 입력을 바꾸면 상단/우측 하단 <b>변경사항 저장</b>을 눌러야 적용됩니다.
                          <br />
                          - 코스당 스프레드시트는 1개를 권장합니다. (3방 + 카페 RAW + AUDIT_VIEW + AUDIT_LOG)
                        </div>
                      </div>
                    </div>
                  </details>
                </div>
              </div>

              {showOpenchatMembersSheetsUi && (
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, color: "var(--text-primary)" }}>톡방 멤버 Sheets</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    {openchatMembersSheetsConfigDirty && (
                      <span className="tag tag-inactive" title="openchat_members_sheets.json 저장 필요">저장 필요</span>
                    )}
                    <button className="btn-outline" style={{ padding: "6px 10px", fontSize: 12 }} onClick={fillCourseOpenchatMembersSheetsDefaults}>
                      코스값 채우기
                    </button>
                  </div>
                </div>

                {!openchatMembersSheetsConfigExists && (
                  <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
                    - openchat_members_sheets.json이 없습니다. 상단 카드에서 <b>멤버설정 저장</b>을 한 번 눌러 생성하세요.
                  </div>
                )}

                <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 10 }}>
                  {([
                    { rt: "chat" as const, label: "사담방", room: rChat },
                    { rt: "notice" as const, label: "공지방", room: rNotice },
                    { rt: "premium" as const, label: "프리미엄방", room: rPremium },
                  ] as const).map(({ rt, label, room }) => {
                    const rid = String(room?.roomId || "").trim();
                    const cfg = rid ? getOpenchatRoomCfg(rid) : {};
                    const st = rid ? getOpenchatRoomState(rid) : null;
                    const enabled = cfg.enabled === true;
                    const spreadsheetId = String(cfg.spreadsheetId || "").trim();
                    const sheetName = String(cfg.sheetName || "").trim();
                    const allowIncomplete = cfg.allowIncomplete === true;
                    const lastResult = st ? String(st.lastResult || "").trim() : "";
                    const nextRunTs = st ? String(st.nextRunTs || "").trim() : "";
                    const lastOkTs = st ? String(st.lastOkTs || "").trim() : "";
                    const lastAttemptTs = st ? String(st.lastAttemptTs || "").trim() : "";
                    const lastError = st ? String(st.lastError || "").trim() : "";
                    const syncing = !!openchatMembersSheetsSyncingRoomId && openchatMembersSheetsSyncingRoomId === rid;
                    const syncMsg = rid ? String(openchatMembersSheetsSyncMsgByRoom[rid] || "") : "";
                    const syncErr = rid ? String(openchatMembersSheetsSyncErrByRoom[rid] || "") : "";

                    return (
                      <div key={rt} style={{ padding: 10, border: "1px solid var(--border-color)", borderRadius: 12, background: "var(--bg-main)" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                          <span className="tag tag-excluded">{label}</span>
                          <span className={`tag ${room ? "tag-active" : "tag-inactive"}`} title={rid || ""}>
                            {room ? (room.roomName || rid || "OK") : "미감지/중복"}
                          </span>
                          <label className="control-label" title="해당 방 전체 멤버 목록을 주기적으로 Google Sheets에 업서트">
                            <input
                              type="checkbox"
                              checked={enabled}
                              onChange={(e) => rid && updateOpenchatMembersSheetsRoom(rid, { enabled: e.target.checked })}
                              disabled={!rid}
                            />
                            자동 동기화
                          </label>
                          <span className="tag tag-excluded" title="스케줄링 ON 시 고정: 매 10분 업서트">10분</span>
                          <label className="control-label" title="권장하지 않음: loadedMembersCount < activeMembersCount이어도 강제 업서트">
                            <input
                              type="checkbox"
                              checked={allowIncomplete}
                              onChange={(e) => rid && updateOpenchatMembersSheetsRoom(rid, { allowIncomplete: e.target.checked })}
                              disabled={!rid}
                            />
                            불완전 허용(권장x)
                          </label>
                          <button
                            className="btn-outline"
                            style={{ padding: "6px 10px", fontSize: 12 }}
                            disabled={!rid || !!openchatMembersSheetsSyncingRoomId}
                            onClick={() => rid && void syncOpenchatMembersToSheetsOnce(rid, allowIncomplete)}
                            title="즉시 1회 업서트(수동). 자동 동기화는 다음 주기부터 실행됩니다."
                          >
                            {syncing ? "업서트…" : "지금 업서트"}
                          </button>
                          {lastResult && (
                            <span className={`tag ${lastResult === "OK" ? "tag-active" : lastResult === "INCOMPLETE_MEMBER_DB" ? "tag-inactive" : "tag-excluded"}`}>
                              {lastResult}
                            </span>
                          )}
                          {nextRunTs && (
                            <span className="tag tag-excluded" title="다음 실행 예정">다음 {nextRunTs}</span>
                          )}
                          {lastOkTs && (
                            <span className="tag tag-excluded" title="최근 OK">OK {lastOkTs}</span>
                          )}
                          {!lastOkTs && lastAttemptTs && (
                            <span className="tag tag-excluded" title="최근 시도">시도 {lastAttemptTs}</span>
                          )}
                        </div>

                        <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                          <input
                            value={spreadsheetId}
                            onChange={(e) => rid && updateOpenchatMembersSheetsRoom(rid, { spreadsheetId: e.target.value })}
                            placeholder="Spreadsheet ID/URL (빈칸=기본값 사용)"
                            className="filter-input"
                            style={{ flex: 1, minWidth: 260, height: 34, marginBottom: 0 }}
                            disabled={!rid}
                          />
                          <input
                            value={sheetName}
                            onChange={(e) => rid && updateOpenchatMembersSheetsRoom(rid, { sheetName: e.target.value })}
                            placeholder="시트 탭(빈칸=자동 추론, 최종 fallback: members)"
                            className="filter-input"
                            style={{ width: 320, height: 34, marginBottom: 0 }}
                            disabled={!rid}
                          />
                        </div>

                        {syncMsg && (
                          <div style={{ marginTop: 8, fontSize: 12, color: "var(--success)", lineHeight: 1.4 }}>
                            {syncMsg}
                          </div>
                        )}
                        {syncErr && (
                          <div style={{ marginTop: 8, fontSize: 12, color: "var(--error)", lineHeight: 1.4 }}>
                            Sheets 업서트 실패: <code>{syncErr}</code>
                          </div>
                        )}
                        {!syncErr && lastError && lastResult && lastResult !== "OK" && (
                          <div style={{ marginTop: 8, fontSize: 12, color: "var(--error)", lineHeight: 1.4 }}>
                            최근 오류: <code>{lastError.slice(0, 180)}</code>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  - 코스별 스프레드시트(권장)를 쓸 경우, 위 <b>코스값 채우기</b>로 `spreadsheetId`/`sheetName`을 빠르게 채울 수 있습니다.
                  <br />
                  - 빈칸 sheetName은 방 이름 기반으로 자동 추론합니다. (<code>MEMBERS_CHAT/NOTICE/PREMIUM</code>)
                </div>
              </div>
              )}

              <details style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-color)" }}>
                <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--text-primary)" }}>
                  카카오 안내(레거시)
                </summary>
                <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
                  <label className="control-label" style={{ display: "flex", gap: 8, alignItems: "center" }} title="v1 roster-worker: 입장자 안내/닉네임 검증 (15분/24시간 최대 2회)">
                    <input
                      type="checkbox"
                      checked={courseRosterEnabled}
                      onChange={(e) => {
                        const next = e.target.checked;
                        const safeModeOn = !!(runtime && (runtime as any).safeMode === true);
                        const talkApiOn = !!(runtime && (runtime as any).talkApi?.enabled === true);
                        if (next && courseOpsSendEnabled && !safeModeOn && talkApiOn) {
                          const ok = confirm(
                            "입장자 안내(레거시)를 켤까요?\n\n" +
                            "현재 상태에서 강의 메시지 발송이 ON이면,\n" +
                            "신규 입장자에게 안내 메시지가 자동 발송될 수 있습니다.",
                          );
                          if (!ok) return;
                        }
                        void setCourseRosterEnabledForCourse(courseKey, next);
                      }}
                      disabled={!mappingOk || runtimeSaving === "saving"}
                    />
                    입장자 안내
                  </label>
                  <span className={`tag ${courseRosterEnabled ? "tag-active" : "tag-inactive"}`}>
                    {courseRosterEnabled ? "ON" : "OFF"}
                  </span>
                  {!mappingOk && (
                    <span className="tag tag-inactive" title="방 매핑(roomId)이 필요합니다.">
                      방 매핑 필요
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 8, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
                  - 실제 발송은 위 <b>강의 메시지 발송</b>이 ON이고 <b>SAFE_MODE=OFF</b>일 때만 동작합니다.
                  <br />
                  - 이 설정은 v2 Sheets 업서트와 별개입니다.
                </div>
              </details>
            </div>
          );
        })}
      </div>

      <details className="pipeline-card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 800, color: "var(--text-primary)" }}>
          고급: v2 워커 상세 설정
        </summary>
        <div style={{ marginTop: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          <label className="tag tag-excluded" style={{ display: "flex", alignItems: "center", gap: 6 }} title="enabled=true면 워커가 주기적으로 실행됩니다.">
            <input
              type="checkbox"
              checked={!!auditConfig?.worker?.enabled}
              onChange={(e) => {
                setAuditConfig((prev) => {
                  const base = ensureAuditConfigBase(prev);
                  return { ...base, worker: { ...(base.worker || {}), enabled: e.target.checked } };
                });
                setAuditDirty(true);
              }}
            />
            자동 실행
          </label>
          <span className="tag tag-excluded">hotIntervalSec</span>
          <input
            type="number"
            min={30}
            className="filter-input"
            style={{ width: 140, height: 34, marginBottom: 0 }}
            value={String(auditConfig?.worker?.hotIntervalSec ?? 600)}
            onChange={(e) => {
              const v = Math.max(30, parseInt(e.target.value || "600", 10) || 600);
              setAuditConfig((prev) => {
                const base = ensureAuditConfigBase(prev);
                return { ...base, worker: { ...(base.worker || {}), hotIntervalSec: v } };
              });
              setAuditDirty(true);
            }}
          />
          <span className="tag tag-excluded">hotDays</span>
          <input
            type="number"
            min={0}
            className="filter-input"
            style={{ width: 120, height: 34, marginBottom: 0 }}
            value={String(auditConfig?.worker?.hotDays ?? 14)}
            onChange={(e) => {
              const v = Math.max(0, parseInt(e.target.value || "14", 10) || 14);
              setAuditConfig((prev) => {
                const base = ensureAuditConfigBase(prev);
                return { ...base, worker: { ...(base.worker || {}), hotDays: v } };
              });
              setAuditDirty(true);
            }}
          />
          <span className="tag tag-excluded">steadyIntervalSec</span>
          <input
            type="number"
            min={60}
            className="filter-input"
            style={{ width: 160, height: 34, marginBottom: 0 }}
            value={String(auditConfig?.worker?.steadyIntervalSec ?? 10800)}
            onChange={(e) => {
              const v = Math.max(60, parseInt(e.target.value || "10800", 10) || 10800);
              setAuditConfig((prev) => {
                const base = ensureAuditConfigBase(prev);
                return { ...base, worker: { ...(base.worker || {}), steadyIntervalSec: v } };
              });
              setAuditDirty(true);
            }}
          />
        </div>

        <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            crawler.repoPath
            <input
              className="filter-input"
              style={{ width: "100%", height: 36, marginTop: 6 }}
              value={normStr(auditConfig?.worker?.crawler?.repoPath || "")}
              onChange={(e) => {
                const v = e.target.value;
                setAuditConfig((prev) => {
                  const base = ensureAuditConfigBase(prev);
                  const w = base.worker || ({} as any);
                  const c = { ...(w.crawler || {}), repoPath: v };
                  return { ...base, worker: { ...w, crawler: c } };
                });
                setAuditDirty(true);
              }}
            />
          </label>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            crawler.pythonExe
            <input
              className="filter-input"
              style={{ width: "100%", height: 36, marginTop: 6 }}
              value={normStr(auditConfig?.worker?.crawler?.pythonExe || "")}
              onChange={(e) => {
                const v = e.target.value;
                setAuditConfig((prev) => {
                  const base = ensureAuditConfigBase(prev);
                  const w = base.worker || ({} as any);
                  const c = { ...(w.crawler || {}), pythonExe: v };
                  return { ...base, worker: { ...w, crawler: c } };
                });
                setAuditDirty(true);
              }}
            />
          </label>
          <label style={{ fontSize: 13, color: "var(--text-secondary)" }}>
            crawler.settingsPath (선택)
            <input
              className="filter-input"
              style={{ width: "100%", height: 36, marginTop: 6 }}
              value={normStr(auditConfig?.worker?.crawler?.settingsPath || "")}
              onChange={(e) => {
                const v = e.target.value;
                setAuditConfig((prev) => {
                  const base = ensureAuditConfigBase(prev);
                  const w = base.worker || ({} as any);
                  const c = { ...(w.crawler || {}), settingsPath: v };
                  return { ...base, worker: { ...w, crawler: c } };
                });
                setAuditDirty(true);
              }}
              placeholder="비공개 카페 로그인 정보는 settings.json에 저장"
            />
          </label>
        </div>

        <div style={{ marginTop: 10, fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>
          - 비공개 카페 접근은 <code>naver-cafe-member-crawler</code>의 <code>settings.json</code>(naver_id/naver_pw)로 로그인합니다.
          <br />
          - 초반(hot)에는 짧은 주기(예: 10분), 안정화 이후(steady)에는 긴 주기(예: 3시간)로 운영합니다.
        </div>
        </div>
      </details>

      {auditDirty && (
        <div
          style={{
            position: "fixed",
            right: 16,
            bottom: 16,
            zIndex: 1000,
            maxWidth: "calc(100vw - 32px)",
          }}
        >
          <div
            className="pipeline-card"
            style={{
              marginTop: 0,
              padding: 12,
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "space-between",
              boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>설정 저장이 필요합니다</div>
            <button
              className="btn-save"
              style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
              disabled={auditSaving === "saving"}
              onClick={() => void saveAuditConfig()}
              title={auditPath ? `${auditPath} 저장` : "v2 설정 저장"}
            >
              {auditSaving === "saving" ? "저장 중…" : "변경사항 저장"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
