/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import "../dashboard.css";

import type { CourseRosterConfig, CourseRosterRoomConfig } from "../../types";

type RoomType = "chat" | "notice" | "premium";

type RoomInfo = {
  roomId: string;
  roomName: string;
  activeMembersCount?: number | null;
};

type CourseGroup = {
  courseKey: string;
  rooms: Partial<Record<RoomType, RoomInfo>>;
};

function normStr(v: any): string {
  return String(v || "").trim();
}

function extractNaverCafeClubId(raw: string): string {
  const s = normStr(raw);
  if (!s) return "";
  const m = s.match(/[?&]clubid=(\d{3,})/i);
  return m ? String(m[1]) : "";
}

function inferRoomTypeAndCourseKey(roomNameRaw: string): { roomType: RoomType; courseKey: string } | null {
  const s = normStr(roomNameRaw);
  if (!s) return null;
  const m = s.match(/^\((사담방|공지방|프리미엄방)\)\s*(.+)$/);
  if (!m) return null;
  const prefix = String(m[1]);
  const courseKey = normStr(m[2]);
  const roomType: RoomType =
    prefix === "사담방" ? "chat" :
      (prefix === "공지방" ? "notice" : "premium");
  if (!courseKey) return null;
  return { roomType, courseKey };
}

function inferRosterSheetName(roomType: RoomType): string {
  if (roomType === "chat") return "ROSTER_CHAT";
  if (roomType === "notice") return "ROSTER_NOTICE";
  return "ROSTER_PREMIUM";
}

function pickUniformValue(values: string[]): { value: string; mixed: boolean } {
  const uniq = Array.from(new Set(values.map((v) => normStr(v)).filter((v) => v.length > 0)));
  if (uniq.length === 1) return { value: uniq[0], mixed: false };
  if (uniq.length === 0) return { value: "", mixed: false };
  return { value: "", mixed: true };
}

export default function CourseOpsPage() {
  const [rooms, setRooms] = useState<RoomInfo[]>([]);

  const [courseRosterConfig, setCourseRosterConfig] = useState<CourseRosterConfig | null>(null);
  const [courseRosterConfigExists, setCourseRosterConfigExists] = useState<boolean>(false);
  const [courseRosterConfigPath, setCourseRosterConfigPath] = useState<string | null>(null);
  const [courseRosterConfigDirty, setCourseRosterConfigDirty] = useState<boolean>(false);
  const [courseRosterConfigSaving, setCourseRosterConfigSaving] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [courseRosterConfigError, setCourseRosterConfigError] = useState<string | null>(null);
  const [courseRosterServiceAccount, setCourseRosterServiceAccount] = useState<{ exists: boolean; path?: string; clientEmail?: string | null; error?: string | null }>({ exists: false });

  const [filter, setFilter] = useState<string>("");

  const roomsById = useMemo(() => {
    const m = new Map<string, RoomInfo>();
    for (const r of rooms) m.set(String(r.roomId), r);
    return m;
  }, [rooms]);

  const courses = useMemo(() => {
    const grouped = new Map<string, Partial<Record<RoomType, RoomInfo>>>();
    for (const r of rooms) {
      const inf = inferRoomTypeAndCourseKey(r.roomName);
      if (!inf) continue;
      const cur = grouped.get(inf.courseKey) || {};
      cur[inf.roomType] = r;
      grouped.set(inf.courseKey, cur);
    }
    const list: CourseGroup[] = [];
    for (const [courseKey, roomsMap] of grouped.entries()) {
      list.push({ courseKey, rooms: roomsMap });
    }
    list.sort((a, b) => a.courseKey.localeCompare(b.courseKey));

    const f = normStr(filter).toLowerCase();
    if (!f) return list;
    return list.filter((c) => c.courseKey.toLowerCase().includes(f));
  }, [rooms, filter]);

  const loadRooms = useCallback(async () => {
    const r = await fetch(`/api/rooms`, { cache: "no-store" });
    const j: any = await r.json().catch(() => null);
    const list: any[] = Array.isArray(j?.rooms)
      ? j.rooms
      : Array.isArray(j?.data?.rooms)
        ? j.data.rooms
        : Array.isArray(j?.data)
          ? j.data
          : [];
    const out: RoomInfo[] = [];
    for (const it of list) {
      if (!it || typeof it !== "object") continue;
      const roomId = normStr((it as any).roomId);
      const roomName = normStr((it as any).roomName);
      if (!roomId || !roomName) continue;
      out.push({
        roomId,
        roomName,
        activeMembersCount: (it as any).activeMembersCount ?? null,
      });
    }
    out.sort((a, b) => a.roomName.localeCompare(b.roomName));
    setRooms(out);
  }, []);

  const loadCourseRosterConfig = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-roster/config`, { cache: "no-store" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));

      setCourseRosterConfigExists(!!j.exists);
      setCourseRosterConfigPath(j.path ? String(j.path) : null);
      setCourseRosterServiceAccount(j.serviceAccount && typeof j.serviceAccount === "object" ? j.serviceAccount : { exists: false });

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

  useEffect(() => {
    void loadRooms();
    void loadCourseRosterConfig();
  }, [loadRooms, loadCourseRosterConfig]);

  const updateRoomCfg = useCallback((roomId: string, patch: Partial<CourseRosterRoomConfig>) => {
    const rid = normStr(roomId);
    if (!rid) return;
    setCourseRosterConfig((prev) => {
      const base: CourseRosterConfig = (prev && typeof prev === "object") ? prev : ({ version: 1, rooms: {} } as CourseRosterConfig);
      const nextRooms: Record<string, any> = { ...(base.rooms || {}) };
      const cur = (nextRooms[rid] && typeof nextRooms[rid] === "object") ? nextRooms[rid] : {};
      const next: any = { ...cur, ...patch };
      if (next.enabled === undefined) next.enabled = true;
      nextRooms[rid] = next;
      return { ...base, version: Number(base.version) || 1, rooms: nextRooms };
    });
    setCourseRosterConfigDirty(true);
  }, []);

  const updateCourseCfg = useCallback((course: CourseGroup, patch: Partial<CourseRosterRoomConfig>) => {
    const roomIds: string[] = [];
    for (const rt of ["chat", "notice", "premium"] as RoomType[]) {
      const r = course.rooms[rt];
      if (r?.roomId) roomIds.push(r.roomId);
    }
    for (const rid of roomIds) updateRoomCfg(rid, patch);
  }, [updateRoomCfg]);

  const saveCourseRosterConfig = useCallback(async (): Promise<boolean> => {
    try {
      setCourseRosterConfigSaving("saving");
      const cfg = courseRosterConfig && typeof courseRosterConfig === "object"
        ? courseRosterConfig
        : ({ version: 1, rooms: {} } as CourseRosterConfig);

      // normalize rosterSheetName: 빈칸이면 roomType별 기본값 적용
      const inRooms = (cfg.rooms && typeof cfg.rooms === "object") ? cfg.rooms : {};
      const outRooms: Record<string, any> = {};
      for (const [rid, v] of Object.entries(inRooms || {})) {
        const cur: any = (v && typeof v === "object") ? v : {};
        const roomName = roomsById.get(String(rid))?.roomName || "";
        const inf = inferRoomTypeAndCourseKey(roomName);
        const defaultTab = inf ? inferRosterSheetName(inf.roomType) : "ROSTER_RAW";
        const rosterSheetName = normStr(cur.rosterSheetName) || defaultTab;
        outRooms[String(rid)] = { ...cur, rosterSheetName };
      }

      const normalized: CourseRosterConfig = { ...cfg, version: Number(cfg.version) || 1, rooms: outRooms };
      const r = await fetch(`/api/course-roster/config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: normalized }),
      });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));

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
  }, [courseRosterConfig, loadCourseRosterConfig, roomsById]);

  const restartRosterWorker = useCallback(async () => {
    try {
      const r = await fetch(`/api/course-roster/restart`, { method: "POST" });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
    } catch (e: any) {
      setCourseRosterConfigError(String(e?.message || e));
    }
  }, []);

  const uploadServiceAccount = useCallback(async (file: File): Promise<boolean> => {
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/course-roster/service-account`, { method: "POST", body: fd });
      const j: any = await r.json().catch(() => null);
      if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.error || `HTTP ${r.status}`));
      await loadCourseRosterConfig();
      return true;
    } catch (e: any) {
      setCourseRosterConfigError(String(e?.message || e));
      return false;
    }
  }, [loadCourseRosterConfig]);

  return (
    <main className="dashboard-main">
      <div className="dashboard-container">
        <div className="pipeline-card" style={{ marginTop: 12 }}>
          <div className="pipeline-header" style={{ marginBottom: 10 }}>
            <div className="pipeline-title">강의 운영</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span className="tag tag-excluded" title={courseRosterConfigPath || ""}>
                설정파일 {courseRosterConfigExists ? "OK" : "없음"}
              </span>
              <span className={`tag ${courseRosterServiceAccount.exists ? "tag-active" : "tag-excluded"}`} title={courseRosterServiceAccount.path || ""}>
                서비스계정 {courseRosterServiceAccount.exists ? "OK" : "없음"}
              </span>
              {courseRosterServiceAccount.clientEmail && (
                <span className="tag tag-excluded" title="서비스계정 이메일">{courseRosterServiceAccount.clientEmail}</span>
              )}
            </div>
          </div>

          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>
            - roster-worker의 “15분/24시간 안내”는 신규 입장자 기준으로, 입장 후 약 15분/24시간 시점에 최대 2회 안내(Reply/멘션)를 보내는 정책이다.
            (SAFE_MODE=true면 발신은 스킵된다)
          </div>
        </div>

        <div className="pipeline-card" style={{ marginTop: 12 }}>
          <div className="pipeline-header" style={{ marginBottom: 10 }}>
            <div className="pipeline-title">강의톡방 v1 (roster-worker) 설정</div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              <span className={`tag ${courseRosterConfigDirty ? "tag-inactive" : "tag-active"}`}>
                저장 {courseRosterConfigDirty ? "미완료" : "OK"}
              </span>
              <input
                className="filter-input"
                style={{ width: 220, height: 34, marginBottom: 0 }}
                placeholder="강의명 필터(코스키)"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <button
                className="btn-outline"
                style={{ padding: "6px 10px", fontSize: 12 }}
                disabled={courseRosterConfigSaving === "saving" || !courseRosterConfigDirty}
                onClick={() => void saveCourseRosterConfig()}
                title="data/course_roster_worker.json 저장"
              >
                {courseRosterConfigSaving === "saving" ? "저장중" : "설정 저장"}
              </button>
              <button
                className="btn-outline"
                style={{ padding: "6px 10px", fontSize: 12 }}
                onClick={() => void restartRosterWorker()}
                title="roster-worker 재기동"
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
          </div>

          {(courseRosterConfigError || courseRosterServiceAccount.error) && (
            <div style={{ fontSize: 12, color: "var(--error)", lineHeight: 1.5, marginBottom: 10 }}>
              {courseRosterConfigError && (<div>설정 로드/저장 오류: <code>{courseRosterConfigError}</code></div>)}
              {courseRosterServiceAccount.error && (<div>서비스계정 읽기 오류: <code>{courseRosterServiceAccount.error}</code></div>)}
            </div>
          )}

          <div style={{ display: "grid", gap: 12 }}>
            {courses.map((course) => {
              const roomIds: string[] = [];
              for (const rt of ["chat", "notice", "premium"] as RoomType[]) {
                const r = course.rooms[rt];
                if (r?.roomId) roomIds.push(r.roomId);
              }

              const roomCfg = (courseRosterConfig?.rooms && typeof courseRosterConfig.rooms === "object")
                ? (courseRosterConfig.rooms as any)
                : {};

              const spreadsheetAgg = pickUniformValue(roomIds.map((rid) => normStr(roomCfg?.[rid]?.spreadsheetId)));
              const cafeUrlAgg = pickUniformValue(roomIds.map((rid) => normStr(roomCfg?.[rid]?.cafeUrl)));
              const joinUrlAgg = pickUniformValue(roomIds.map((rid) => normStr(roomCfg?.[rid]?.joinUrl)));

              const spreadsheetId = spreadsheetAgg.value;
              const cafeUrl = cafeUrlAgg.value;
              const joinUrl = joinUrlAgg.value;

              return (
                <div key={course.courseKey} style={{ border: "1px solid var(--border-color)", borderRadius: 12, padding: 14 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="tag tag-course" title="courseKey">{course.courseKey}</span>
                      {spreadsheetAgg.mixed && <span className="tag tag-inactive" title="방별 SpreadsheetId 값이 다름">시트 혼합</span>}
                      {cafeUrlAgg.mixed && <span className="tag tag-inactive" title="방별 카페 URL 값이 다름">카페URL 혼합</span>}
                      {joinUrlAgg.mixed && <span className="tag tag-inactive" title="방별 가입 URL 값이 다름">가입URL 혼합</span>}
                    </div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <span className="tag tag-excluded" title="방 3종 자동 추론 기준">(사담방)/(공지방)/(프리미엄방) 접두어</span>
                    </div>
                  </div>

                  <div style={{ marginTop: 10, display: "grid", gap: 8 }}>
                    <input
                      className="filter-input"
                      value={spreadsheetId}
                      placeholder="스프레드시트 URL 또는 ID (코스 공통)"
                      onChange={(e) => updateCourseCfg(course, { spreadsheetId: e.target.value })}
                    />
                    <input
                      className="filter-input"
                      value={cafeUrl}
                      placeholder="카페 멤버 URL (코스 공통, clubid 포함)"
                      onChange={(e) => {
                        const url = e.target.value;
                        const clubId = extractNaverCafeClubId(url);
                        const patch: Partial<CourseRosterRoomConfig> = { cafeSource: "crawler", cafeUrl: url };
                        if (clubId) patch.cafeClubId = clubId;
                        updateCourseCfg(course, patch);
                      }}
                    />
                    <input
                      className="filter-input"
                      value={joinUrl}
                      placeholder="카페 가입 URL (코스 공통, 선택)"
                      onChange={(e) => updateCourseCfg(course, { joinUrl: e.target.value })}
                    />
                  </div>

                  <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 10 }}>
                    {(["chat", "notice", "premium"] as RoomType[]).map((rt) => {
                      const r = course.rooms[rt];
                      const roomId = r?.roomId || "";
                      const roomName = r?.roomName || "";
                      const cfg: any = roomId ? (roomCfg?.[roomId] || {}) : {};
                      const enabled = roomId ? (cfg.enabled !== false) : false;
                      const rosterSheetName = normStr(cfg.rosterSheetName) || inferRosterSheetName(rt);

                      return (
                        <div key={rt} style={{ border: "1px solid var(--border-color)", borderRadius: 10, padding: 10, opacity: roomId ? 1 : 0.6 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <span className="tag tag-excluded" title={roomId || ""}>
                                {rt === "chat" ? "사담방" : (rt === "notice" ? "공지방" : "프리미엄방")}
                              </span>
                              <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{roomName || "방 없음"}</span>
                            </div>
                            {roomId && (
                              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-muted)" }}>
                                <input
                                  type="checkbox"
                                  checked={enabled}
                                  onChange={(e) => updateRoomCfg(roomId, { enabled: e.target.checked })}
                                />
                                사용
                              </label>
                            )}
                          </div>

                          {roomId && (
                            <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                              <input
                                className="filter-input"
                                value={rosterSheetName}
                                placeholder={`시트 탭 이름 (기본: ${inferRosterSheetName(rt)})`}
                                onChange={(e) => updateRoomCfg(roomId, { rosterSheetName: e.target.value })}
                              />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </main>
  );
}
