"use client";

import React from "react";
import "../dashboard.css";

type AutoFaqConfig = import("../../types").AutoFaqConfig;
type AutoFaqTrigger = import("../../types").AutoFaqTrigger;
type RoomInfo = import("../../types").RoomInfo;

function safeString(v: unknown): string {
  if (typeof v === "bigint") return v.toString();
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return String(v ?? "").trim();
}

function newId(): string {
  // browser crypto first, fallback
  try {
    // @ts-ignore
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") return globalThis.crypto.randomUUID();
  } catch {}
  return `t_${Date.now()}_${Math.floor(Math.random() * 1e9)}`;
}

function linesToArray(s: string): string[] {
  return String(s || "")
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function arrayToLines(a: string[] | undefined): string {
  return Array.isArray(a) ? a.join("\n") : "";
}

export default function AutoFaqPage() {
  const [tab, setTab] = React.useState<"설정" | "진단">("설정");
  const [rooms, setRooms] = React.useState<RoomInfo[]>([]);
  const [config, setConfig] = React.useState<AutoFaqConfig | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveOk, setSaveOk] = React.useState<string | null>(null);

  const [workerStatus, setWorkerStatus] = React.useState<any | null>(null);
  const [workerStatusExists, setWorkerStatusExists] = React.useState<boolean>(false);
  const [statusError, setStatusError] = React.useState<string | null>(null);

  const [selectedLectureId, setSelectedLectureId] = React.useState<string>("");
  const [selectedRoomId, setSelectedRoomId] = React.useState<string>("");

  const [simScope, setSimScope] = React.useState<"room" | "lecture" | "global">("room");
  const [simLectureId, setSimLectureId] = React.useState<string>("");
  const [simRoomId, setSimRoomId] = React.useState<string>("");
  const [simText, setSimText] = React.useState<string>("");
  const [simRunning, setSimRunning] = React.useState<boolean>(false);
  const [simError, setSimError] = React.useState<string | null>(null);
  const [simResult, setSimResult] = React.useState<any | null>(null);

  const [eventsHideNoMatch, setEventsHideNoMatch] = React.useState<boolean>(true);
  const [eventsQuery, setEventsQuery] = React.useState<string>("");

  const loadStatus = React.useCallback(async () => {
    setStatusError(null);
    try {
      const res = await fetch("/api/auto-faq/status");
      const j = await res.json().catch(() => ({}));
      if (!j?.ok) throw new Error(j?.error || "status fetch failed");
      setWorkerStatusExists(Boolean(j?.exists));
      setWorkerStatus(j?.status && typeof j.status === "object" ? j.status : null);
    } catch (e: any) {
      setStatusError(String(e?.message || e));
    }
  }, []);

  const loadAll = React.useCallback(async () => {
    setLoadError(null);
    try {
      const [roomsRes, cfgRes] = await Promise.all([fetch("/api/rooms"), fetch("/api/auto-faq/config")]);
      const roomsJson = await roomsRes.json().catch(() => ({}));
      const cfgJson = await cfgRes.json().catch(() => ({}));
      const roomsList: RoomInfo[] = Array.isArray(roomsJson)
        ? (roomsJson as RoomInfo[])
        : Array.isArray((roomsJson as any)?.rooms)
          ? ((roomsJson as any).rooms as RoomInfo[])
          : Array.isArray((roomsJson as any)?.value)
            ? ((roomsJson as any).value as RoomInfo[])
            : [];
      setRooms(roomsList);
      setConfig(cfgJson?.config && typeof cfgJson.config === "object" ? (cfgJson.config as AutoFaqConfig) : null);
    } catch (e: any) {
      setLoadError(String(e?.message || e));
    }
  }, []);

  React.useEffect(() => {
    void loadAll();
    void loadStatus();
  }, [loadAll, loadStatus]);

  React.useEffect(() => {
    const t = setInterval(() => void loadStatus(), 10_000);
    return () => clearInterval(t);
  }, [loadStatus]);

  const ensureConfig = (cfg: AutoFaqConfig | null): AutoFaqConfig => {
    const c: AutoFaqConfig = cfg && typeof cfg === "object" ? cfg : {};
    if (!c.global) c.global = { enabled: true, triggers: [] };
    if (!c.global.triggers) c.global.triggers = [];
    if (!c.lectures) c.lectures = {};
    if (!c.rooms) c.rooms = {};
    return c;
  };

  const updateConfig = (fn: (c: AutoFaqConfig) => AutoFaqConfig) => {
    setConfig((prev) => fn(ensureConfig(prev)));
  };

  const save = async () => {
    setSaving(true);
    setSaveError(null);
    setSaveOk(null);
    try {
      const res = await fetch("/api/auto-faq/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) {
        const detail = j?.details ? JSON.stringify(j.details, null, 2) : "";
        throw new Error((j?.error || `save failed (${res.status})`) + (detail ? `\n${detail}` : ""));
      }
      setSaveOk("저장 완료");
    } catch (e: any) {
      setSaveError(String(e?.message || e));
    } finally {
      setSaving(false);
      setTimeout(() => setSaveOk(null), 1500);
    }
  };

  const restartWorker = async () => {
    try {
      await fetch("/api/auto-faq/restart", { method: "POST" });
    } catch {}
  };

  const simulate = async () => {
    setSimRunning(true);
    setSimError(null);
    setSimResult(null);
    try {
      const payload: any = { scope: simScope, text: simText };
      if (simScope === "room") payload.roomId = simRoomId;
      if (simScope === "lecture") payload.lectureId = simLectureId;
      const res = await fetch("/api/auto-faq/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok) throw new Error(j?.error || `simulate failed (${res.status})`);
      setSimResult(j);
    } catch (e: any) {
      setSimError(String(e?.message || e));
    } finally {
      setSimRunning(false);
    }
  };

  const lectures = Object.keys((config?.lectures || {}) as any);
  const roomsSorted = React.useMemo(
    () => [...rooms].sort((a, b) => safeString(a.roomName).localeCompare(safeString(b.roomName))),
    [rooms],
  );
  const lecturesSorted = React.useMemo(() => [...lectures].sort(), [lectures]);

  // simulator defaults: prefer test room if present
  React.useEffect(() => {
    if (!rooms || rooms.length === 0) return;
    if (!simRoomId) {
      const testId = "18462226881291012";
      const found = rooms.find((r) => String(r.roomId) === testId);
      setSimRoomId(found ? testId : String(rooms[0].roomId));
    }
    if (!simLectureId && lecturesSorted.length > 0) {
      setSimLectureId(String(lecturesSorted[0] || ""));
    }
  }, [rooms, lecturesSorted, simRoomId, simLectureId]);
  const lectureRooms = (lectureId: string) => {
    const roomsMap = (config?.rooms || {}) as any;
    const out: string[] = [];
    for (const [rid, v] of Object.entries(roomsMap)) {
      if (safeString((v as any)?.lectureId) === lectureId) out.push(String(rid));
    }
    out.sort();
    return out;
  };

  const renderTriggerEditor = (scope: "global" | "lecture" | "room", scopeId: string, triggers: AutoFaqTrigger[]) => {
    const setTriggers = (next: AutoFaqTrigger[]) => {
      updateConfig((c) => {
        if (scope === "global") {
          (c.global as any).triggers = next;
          return { ...c };
        }
        if (scope === "lecture") {
          const lec = ((c.lectures as any)[scopeId] || {}) as any;
          (c.lectures as any)[scopeId] = { ...lec, triggers: next };
          return { ...c };
        }
        const room = ((c.rooms as any)[scopeId] || {}) as any;
        (c.rooms as any)[scopeId] = { ...room, triggers: next };
        return { ...c };
      });
    };

    const addTrigger = () => {
      const id = newId();
      const next: AutoFaqTrigger = {
        id,
        enabled: true,
        label: "",
        priority: 100,
        match: { type: "exact_norm", patterns: [], negativePatterns: [], requireQuestionSignal: true },
        action: { type: "static_text", responseText: "" },
        replyTemplate: { titleLine: "", bodyLines: [], footerLinksMode: "none" },
        images: [],
      };
      setTriggers([next, ...(triggers || [])]);
    };

    const updateTrigger = (id: string, partial: Partial<AutoFaqTrigger>) => {
      const next = (triggers || []).map((t) => (t.id === id ? ({ ...t, ...partial } as AutoFaqTrigger) : t));
      setTriggers(next);
    };

    const removeTrigger = (id: string) => {
      setTriggers((triggers || []).filter((t) => t.id !== id));
    };

    const copyTrigger = (id: string) => {
      const src = (triggers || []).find((t) => t.id === id);
      if (!src) return;
      const nid = newId();
      const cloned: AutoFaqTrigger = {
        ...(src as any),
        id: nid,
        label: safeString(src.label) ? `${safeString(src.label)} (복사)` : "",
        // images는 경로에 triggerId가 포함되므로 자동 복사하면 깨질 수 있어 비운다.
        images: [],
      };
      setTriggers([cloned, ...(triggers || [])]);
    };

    const uploadImage = async (triggerId: string, file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/templates/auto_faq/${encodeURIComponent(triggerId)}/image`, { method: "POST", body: fd });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j?.ok || !j?.path) throw new Error(j?.detail || j?.error || "upload failed");
      updateTrigger(triggerId, { images: [...(triggers.find((t) => t.id === triggerId)?.images || []), String(j.path)] });
    };

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-outline" onClick={addTrigger}>
            + 트리거 추가
          </button>
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
            총 {Array.isArray(triggers) ? triggers.length : 0}개
          </span>
        </div>

        {(triggers || []).map((t) => {
          const m = t.match || {};
          const a = t.action || {};
          const tpl = t.replyTemplate || {};
          const images = Array.isArray(t.images) ? t.images : [];
          const titleLine = safeString(tpl.titleLine);
          const bodyLines = Array.isArray(tpl.bodyLines) ? tpl.bodyLines : [];
          const actionType = safeString(a.type || "static_text");
          const kbMenuIds = safeString((a as any).menuIds);
          const kbLimit = Number((a as any).limit || 3) || 3;
          const kbKeywords = Array.isArray((a as any).keywords) ? (a as any).keywords : [];

          return (
            <div key={t.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="control-label">
                  <input
                    type="checkbox"
                    checked={t.enabled !== false}
                    onChange={(e) => updateTrigger(t.id, { enabled: e.target.checked })}
                  />{" "}
                  활성
                </label>
                <input
                  className="filter-input"
                  style={{ minWidth: 240, height: 34, marginBottom: 0 }}
                  value={safeString(t.label)}
                  onChange={(e) => updateTrigger(t.id, { label: e.target.value })}
                  placeholder="라벨(운영용)"
                />
                <input
                  className="filter-input"
                  style={{ width: 120, height: 34, marginBottom: 0 }}
                  value={String(t.priority ?? 100)}
                  onChange={(e) => updateTrigger(t.id, { priority: Number(e.target.value) || 100 })}
                  placeholder="우선순위"
                />
                <input
                  className="filter-input"
                  style={{ width: 120, height: 34, marginBottom: 0 }}
                  value={t.cooldownSec ? String(Math.floor(Number(t.cooldownSec) / 60) || "") : ""}
                  onChange={(e) => {
                    const raw = String(e.target.value || "").trim();
                    if (!raw) {
                      updateTrigger(t.id, { cooldownSec: undefined });
                      return;
                    }
                    const mins = Number(raw);
                    if (!Number.isFinite(mins) || mins <= 0) {
                      updateTrigger(t.id, { cooldownSec: undefined });
                      return;
                    }
                    const sec = Math.max(30, Math.min(24 * 60 * 60, Math.floor(mins * 60)));
                    updateTrigger(t.id, { cooldownSec: sec });
                  }}
                  placeholder="쿨다운(분)"
                  title="동일 사용자+동일 트리거 재응답 최소 간격(분). 비우면 기본값(10분)."
                />
                <button className="btn-outline" onClick={() => copyTrigger(t.id)} title="트리거 복사(이미지는 복사되지 않음)">
                  복사
                </button>
                <button className="btn-danger" onClick={() => removeTrigger(t.id)}>
                  삭제
                </button>
              </div>

              <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 12, marginBottom: 6, color: "var(--text-muted)" }}>매칭</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <select
                      className="filter-input"
                      style={{ width: 160, height: 34, marginBottom: 0 }}
                      value={safeString(m.type || "exact_norm")}
                      onChange={(e) => updateTrigger(t.id, { match: { ...(m as any), type: e.target.value as any } })}
                    >
                      <option value="exact_norm">정확(정규화)</option>
                      <option value="regex">정규식</option>
                    </select>
                    <label className="control-label" title="질문형(?, 어디/언제 등) 신호가 있어야만 발동">
                      <input
                        type="checkbox"
                        checked={m.requireQuestionSignal !== false}
                        onChange={(e) => updateTrigger(t.id, { match: { ...(m as any), requireQuestionSignal: e.target.checked } })}
                      />{" "}
                      질문 신호 필수
                    </label>
                  </div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>
                    - 정확(정규화)는 문장 완전 일치만 반응합니다(부분일치는 정규식 사용).
                    <br />- 정확(정규화)는 문장 끝의 <code>?</code>/<code>!</code>/<code>.</code> 같은 구두점을 무시합니다.
                    <br />- 여러 트리거가 동시에 맞으면 우선순위(priority, 작을수록 우선)로 1개만 선택됩니다.
                  </div>
                  <textarea
                    className="filter-input"
                    style={{ width: "100%", minHeight: 80 }}
                    value={arrayToLines(m.patterns as any)}
                    onChange={(e) => updateTrigger(t.id, { match: { ...(m as any), patterns: linesToArray(e.target.value) } })}
                    placeholder="패턴(한 줄 1개)"
                  />
                  <textarea
                    className="filter-input"
                    style={{ width: "100%", minHeight: 60 }}
                    value={arrayToLines(m.negativePatterns as any)}
                    onChange={(e) =>
                      updateTrigger(t.id, { match: { ...(m as any), negativePatterns: linesToArray(e.target.value) } })
                    }
                    placeholder="부정 패턴(있으면 제외, 한 줄 1개)"
                  />
                </div>

                <div style={{ flex: 1, minWidth: 260 }}>
                  <div style={{ fontSize: 12, marginBottom: 6, color: "var(--text-muted)" }}>응답</div>
                  <select
                    className="filter-input"
                    style={{ width: 220, height: 34, marginBottom: 8 }}
                    value={actionType}
                    onChange={(e) => updateTrigger(t.id, { action: { ...(a as any), type: e.target.value as any } })}
                  >
                    <option value="static_text">고정 텍스트</option>
                    <option value="kb_recent_posts">KB 최근 글</option>
                    <option value="kb_recent_posts_filtered">KB 최근 글(키워드 필터)</option>
                  </select>

                  {actionType === "static_text" ? (
                    <textarea
                      className="filter-input"
                      style={{ width: "100%", minHeight: 120 }}
                      value={safeString((a as any).responseText)}
                      onChange={(e) => updateTrigger(t.id, { action: { ...(a as any), responseText: e.target.value } })}
                      placeholder="발신 텍스트(튜브렌즈 스타일 권장)"
                    />
                  ) : (
                    <>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <input
                          className="filter-input"
                          style={{ flex: 1, minWidth: 220, height: 34, marginBottom: 0 }}
                          value={kbMenuIds}
                          onChange={(e) => updateTrigger(t.id, { action: { ...(a as any), menuIds: e.target.value } })}
                          placeholder="menuIds 예: 23"
                        />
                        <input
                          className="filter-input"
                          style={{ width: 120, height: 34, marginBottom: 0 }}
                          value={String(kbLimit)}
                          onChange={(e) => updateTrigger(t.id, { action: { ...(a as any), limit: Number(e.target.value) || 3 } })}
                          placeholder="개수"
                        />
                      </div>
                      {actionType === "kb_recent_posts_filtered" && (
                        <textarea
                          className="filter-input"
                          style={{ width: "100%", minHeight: 70 }}
                          value={arrayToLines(kbKeywords)}
                          onChange={(e) => updateTrigger(t.id, { action: { ...(a as any), keywords: linesToArray(e.target.value) } })}
                          placeholder="키워드(한 줄 1개, title/norm_text에 포함된 글만)"
                        />
                      )}
                      <input
                        className="filter-input"
                        style={{ width: "100%", height: 34, marginBottom: 8 }}
                        value={titleLine}
                        onChange={(e) => updateTrigger(t.id, { replyTemplate: { ...(tpl as any), titleLine: e.target.value } })}
                        placeholder="첫 줄(결론/공감) 예: 😊 최근 다시보기 글 3개 링크예요."
                      />
                      <textarea
                        className="filter-input"
                        style={{ width: "100%", minHeight: 70 }}
                        value={arrayToLines(bodyLines)}
                        onChange={(e) => updateTrigger(t.id, { replyTemplate: { ...(tpl as any), bodyLines: linesToArray(e.target.value) } })}
                        placeholder="본문 라인(한 줄 1개) 예: 1) {t1}"
                      />
                    </>
                  )}

                  <div style={{ fontSize: 12, margin: "8px 0 6px", color: "var(--text-muted)" }}>이미지(외부 URL 금지)</div>
                  <input
                    type="file"
                    accept="image/*"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      void uploadImage(t.id, f).catch(() => {});
                      e.currentTarget.value = "";
                    }}
                  />
                  {images.length > 0 && (
                    <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                      {images.slice(0, 12).map((rel) => (
                        <img
                          key={rel}
                          src={`/api/templates/${rel.replace(/^\/+/, "")}`}
                          alt="auto-faq-asset"
                          style={{ width: 64, height: 64, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  const cfg = ensureConfig(config);
  const globalTriggers = (cfg.global?.triggers || []) as AutoFaqTrigger[];
  const lectureObj = (cfg.lectures || {}) as any;
  const roomObj = (cfg.rooms || {}) as any;
  const workerEvents: any[] = Array.isArray(workerStatus?.events) ? (workerStatus.events as any[]) : [];
  const filteredWorkerEvents = React.useMemo(() => {
    const q = safeString(eventsQuery).toLowerCase();
    const src = Array.isArray(workerEvents) ? workerEvents : [];
    return src.filter((ev) => {
      const decision = safeString(ev?.decision);
      if (eventsHideNoMatch && decision.startsWith("NO_MATCH")) return false;
      if (!q) return true;
      const blob = [
        safeString(ev?.decision),
        safeString(ev?.roomId),
        safeString(ev?.triggerLabel),
        safeString(ev?.triggerId),
        safeString(ev?.text),
        safeString(ev?.errMsg),
      ]
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [workerEvents, eventsHideNoMatch, eventsQuery]);

  const selectedLecture = selectedLectureId ? lectureObj[selectedLectureId] : null;
  const selectedRoom = selectedRoomId ? roomObj[selectedRoomId] : null;

  return (
    <main className="container">
      <div className="header">
        <div>
          <h1>자동 FAQ(무명령어)</h1>
          <div className="subtitle">전역 / 강의ID / 방별 트리거 + 이미지(업로드) 설정</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="btn-outline" onClick={() => void loadAll()}>
            새로고침
          </button>
          <button className="btn-outline" onClick={() => void loadStatus()} title="auto-faq-worker 상태 갱신">
            상태
          </button>
          <button className="btn-outline" onClick={() => void restartWorker()} title="auto-faq-worker 재시작">
            워커 재시작
          </button>
          <button className="btn-primary" onClick={() => void save()} disabled={saving}>
            {saving ? "저장 중…" : "저장"}
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <button
          className="btn-outline"
          style={tab === "설정" ? { background: "rgba(37,99,235,.15)", borderColor: "rgba(37,99,235,.35)" } : {}}
          onClick={() => setTab("설정")}
        >
          설정
        </button>
        <button
          className="btn-outline"
          style={tab === "진단" ? { background: "rgba(37,99,235,.15)", borderColor: "rgba(37,99,235,.35)" } : {}}
          onClick={() => setTab("진단")}
        >
          진단(왜 안 되지?)
        </button>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {tab === "진단" ? "발신 없이 매칭/게이트/실패 원인을 확인하세요." : "트리거/응답/이미지를 설정하세요."}
        </span>
      </div>

      {(loadError || saveError || statusError) && (
        <div className="card" style={{ padding: 12, borderColor: "var(--error)" }}>
          {loadError && (
            <div>
              로드 오류: <code>{loadError}</code>
            </div>
          )}
          {saveError && (
            <div>
              저장 오류:
              <pre style={{ margin: "6px 0 0", whiteSpace: "pre-wrap" }}>{saveError}</pre>
            </div>
          )}
          {statusError && (
            <div>
              워커 상태 오류: <code>{statusError}</code>
            </div>
          )}
        </div>
      )}
      {saveOk && (
        <div className="card" style={{ padding: 12, borderColor: "var(--success)" }}>
          {saveOk}
        </div>
      )}

      {tab === "진단" && (
        <>
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>워커 상태</h2>
        {!workerStatusExists && (
          <div style={{ color: "var(--text-muted)" }}>상태 파일이 없습니다. 워커가 아직 기동되지 않았을 수 있어요.</div>
        )}
        {workerStatus && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 8, fontSize: 13 }}>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
              <div>
                PID: <code>{safeString(workerStatus.pid)}</code>
              </div>
              <div>
                Started: <code>{safeString(workerStatus.startedAt)}</code>
              </div>
              <div>
                Heartbeat: <code>{safeString(workerStatus.heartbeatTs)}</code>
              </div>
            </div>
            {workerStatus.lastMatchDecision && (
              <div>
                마지막 매치: <code>{safeString(workerStatus.lastMatchDecision)}</code>{" "}
                {safeString(workerStatus.lastMatchTriggerLabel) ? `(${safeString(workerStatus.lastMatchTriggerLabel)})` : ""}
                {safeString(workerStatus.lastMatchRoomId) ? (
                  <>
                    {" "}
                    in <code>{safeString(workerStatus.lastMatchRoomId)}</code>
                  </>
                ) : null}
              </div>
            )}
            {workerStatus.lastMatchText && (
              <div style={{ color: "var(--text-muted)" }}>
                입력: <code>{safeString(workerStatus.lastMatchText)}</code>
              </div>
            )}
            {workerStatus.lastFireTs && (
              <div>
                마지막 발신:{" "}
                <code>{safeString(workerStatus.lastFireOk) === "true" || workerStatus.lastFireOk === true ? "OK" : "FAIL"}</code>{" "}
                at <code>{safeString(workerStatus.lastFireTs)}</code>{" "}
                {safeString(workerStatus.lastFireTriggerLabel) ? `(${safeString(workerStatus.lastFireTriggerLabel)})` : ""}
              </div>
            )}
            {safeString(workerStatus.lastFireErrMsg) && (
              <div style={{ color: "var(--text-muted)" }}>
                에러: <code>{safeString(workerStatus.lastFireErrMsg)}</code>{" "}
                {workerStatus.lastFireTalkStatus !== undefined && workerStatus.lastFireTalkStatus !== null ? (
                  <span>
                    (talkStatus: <code>{safeString(workerStatus.lastFireTalkStatus)}</code>)
                  </span>
                ) : null}
              </div>
            )}
            {(workerStatus.lastFireImagesCount || workerStatus.lastFireImagesOk !== undefined) && (
              <div style={{ color: "var(--text-muted)" }}>
                이미지: {Number(workerStatus.lastFireImagesCount || 0) || 0}장 / 결과{" "}
                <code>
                  {workerStatus.lastFireImagesOk === null || workerStatus.lastFireImagesOk === undefined
                    ? "-"
                    : String(workerStatus.lastFireImagesOk)}
                </code>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>최근 이벤트</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
          <label className="control-label" style={{ marginBottom: 0 }}>
            <input type="checkbox" checked={eventsHideNoMatch} onChange={(e) => setEventsHideNoMatch(e.target.checked)} /> NO_MATCH 숨김
          </label>
          <input
            className="filter-input"
            style={{ minWidth: 260, height: 34, marginBottom: 0 }}
            value={eventsQuery}
            onChange={(e) => setEventsQuery(e.target.value)}
            placeholder="검색(결정/방ID/트리거/입력/에러)…"
          />
          <span style={{ color: "var(--text-muted)", fontSize: 12 }}>
            표시 {filteredWorkerEvents.length}건 / 최대 80건(워커 ring-buffer)
          </span>
        </div>
        {filteredWorkerEvents.length === 0 ? (
          <div style={{ color: "var(--text-muted)" }}>
            {workerEvents.length === 0 ? "아직 기록된 이벤트가 없습니다." : "필터 조건으로 표시할 이벤트가 없습니다."}
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: 160 }}>시간</th>
                  <th style={{ width: 160 }}>결정</th>
                  <th style={{ width: 160 }}>방ID</th>
                  <th style={{ width: 220 }}>트리거</th>
                  <th>입력</th>
                </tr>
              </thead>
              <tbody>
                {[...filteredWorkerEvents]
                  .reverse()
                  .map((ev, idx) => (
                    <tr key={idx}>
                      <td>
                        <code>{safeString(ev.ts)}</code>
                      </td>
                      <td>
                        <code>{safeString(ev.decision)}</code>
                        {ev.ok !== undefined && ev.ok !== null ? (
                          <span style={{ marginLeft: 6, color: "var(--text-muted)" }}>(ok:{String(Boolean(ev.ok))})</span>
                        ) : null}
                        {safeString(ev.errMsg) ? (
                          <div style={{ color: "var(--text-muted)" }}>
                            err: <code>{safeString(ev.errMsg)}</code>
                          </div>
                        ) : null}
                      </td>
                      <td>
                        <code>{safeString(ev.roomId)}</code>
                      </td>
                      <td>
                        {safeString(ev.triggerLabel) ? (
                          <>
                            {safeString(ev.triggerLabel)}{" "}
                            <span style={{ color: "var(--text-muted)" }}>
                              ({safeString(ev.scope) || "-"} / {safeString(ev.triggerId) || "-"})
                            </span>
                          </>
                        ) : (
                          <span style={{ color: "var(--text-muted)" }}>-</span>
                        )}
                      </td>
                      <td>
                        <code>{safeString(ev.text)}</code>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <h2 style={{ marginTop: 0 }}>매칭 시뮬레이터(발신 없음)</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
          <select
            className="filter-input"
            style={{ width: 140, height: 34, marginBottom: 0 }}
            value={simScope}
            onChange={(e) => setSimScope(e.target.value as any)}
          >
            <option value="room">방 기준</option>
            <option value="lecture">강의ID 기준</option>
            <option value="global">전역만</option>
          </select>

          {simScope === "room" && (
            <input
              className="filter-input"
              style={{ minWidth: 420, height: 34, marginBottom: 0 }}
              list="auto-faq-sim-room-list"
              value={simRoomId}
              onChange={(e) => setSimRoomId(e.target.value)}
              placeholder="방 선택/검색(roomId 또는 방 이름)…"
            />
          )}
          {simScope === "room" && (
            <datalist id="auto-faq-sim-room-list">
              {roomsSorted.map((r) => (
                <option key={String(r.roomId)} value={String(r.roomId)}>
                  {safeString(r.roomName)} ({String(r.roomId)})
                </option>
              ))}
            </datalist>
          )}
          {simScope === "room" && simRoomId && (
            <button
              className="btn-outline"
              onClick={() => {
                try {
                  void navigator.clipboard.writeText(String(simRoomId));
                } catch {}
              }}
              title="roomId 복사"
            >
              roomId 복사
            </button>
          )}

          {simScope === "lecture" && (
            <input
              className="filter-input"
              style={{ minWidth: 320, height: 34, marginBottom: 0 }}
              list="auto-faq-sim-lecture-list"
              value={simLectureId}
              onChange={(e) => setSimLectureId(e.target.value)}
              placeholder="강의ID 선택/검색…"
            />
          )}
          {simScope === "lecture" && (
            <datalist id="auto-faq-sim-lecture-list">
              {lecturesSorted.map((lid) => (
                <option key={lid} value={lid}>
                  {lid} {safeString(lectureObj[lid]?.title) ? `(${safeString(lectureObj[lid]?.title)})` : ""}
                </option>
              ))}
            </datalist>
          )}

          <button className="btn-primary" onClick={() => void simulate()} disabled={simRunning || !simText.trim()}>
            {simRunning ? "시뮬레이션 중…" : "시뮬레이션"}
          </button>
        </div>

        <textarea
          className="filter-input"
          style={{ width: "100%", minHeight: 80 }}
          value={simText}
          onChange={(e) => setSimText(e.target.value)}
          placeholder="예: 다시보기 링크 어디 / 무료강의 언제? / 보너스 프로그램 뭐에요"
        />

        {simError && (
          <div className="card" style={{ padding: 10, borderColor: "var(--error)", marginTop: 10 }}>
            시뮬레이터 오류: <code>{simError}</code>
          </div>
        )}

        {simResult && (
          <div style={{ marginTop: 10, display: "grid", gridTemplateColumns: "1fr", gap: 10 }}>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                결정: <code>{safeString(simResult.decision)}</code>
              </div>
              <div>
                질문신호: <code>{String(Boolean(simResult.questionSignal))}</code>
              </div>
              <div>
                발신가능(게이트 포함): <code>{String(Boolean(simResult.wouldSend))}</code>
              </div>
              <div style={{ color: "var(--text-muted)" }}>
                safeMode={String(Boolean(simResult.gates?.safeMode))}, talkApi={String(Boolean(simResult.gates?.talkApiEnabled))}
              </div>
            </div>

            {simResult.selected && (
              <div>
                선택된 트리거: <code>{safeString(simResult.selected.label) || safeString(simResult.selected.id)}</code>{" "}
                <span style={{ color: "var(--text-muted)" }}>
                  ({safeString(simResult.selected.scope)} / priority {safeString(simResult.selected.priority)} / {safeString(simResult.selected.matchType)})
                </span>
              </div>
            )}

            {safeString(simResult.replyText) && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>발신 텍스트(미리보기)</div>
                <pre style={{ whiteSpace: "pre-wrap", margin: 0, padding: 10, background: "var(--panel)", borderRadius: 8 }}>
                  {safeString(simResult.replyText)}
                </pre>
              </div>
            )}

            {Array.isArray(simResult.images) && simResult.images.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>이미지(묶음 1회 발신)</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  {simResult.images.slice(0, 12).map((rel: string) => (
                    <img
                      key={rel}
                      src={`/api/templates/${String(rel || "").replace(/^\/+/, "")}`}
                      alt="auto-faq-sim-image"
                      style={{ width: 72, height: 72, objectFit: "cover", borderRadius: 6, border: "1px solid var(--border)" }}
                    />
                  ))}
                </div>
              </div>
            )}

            {Array.isArray(simResult.matched) && simResult.matched.length > 1 && (
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                매칭 후보(상위):{" "}
                {simResult.matched.slice(0, 6).map((m: any) => `${safeString(m.scope)}:${safeString(m.label) || safeString(m.id)}`).join(" / ")}
              </div>
            )}
          </div>
        )}
      </div>
        </>
      )}

      {tab === "설정" && (
      <div className="grid" style={{ gridTemplateColumns: "1fr", gap: 16 }}>
        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>전역(Global)</h2>
          <label className="control-label" style={{ marginBottom: 10 }}>
            <input
              type="checkbox"
              checked={cfg.global?.enabled !== false}
              onChange={(e) => updateConfig((c) => ({ ...c, global: { ...(c.global as any), enabled: e.target.checked } }))}
            />{" "}
            전역 트리거 사용
          </label>
          {renderTriggerEditor("global", "__global__", globalTriggers)}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>강의ID(Lecture)</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input
              className="filter-input"
              style={{ minWidth: 320, height: 34, marginBottom: 0 }}
              list="auto-faq-lecture-list"
              value={selectedLectureId}
              onChange={(e) => setSelectedLectureId(e.target.value)}
              placeholder="강의ID 선택/검색…"
            />
            <datalist id="auto-faq-lecture-list">
              {lecturesSorted.map((lid) => (
                <option key={lid} value={lid}>
                  {lid} {safeString(lectureObj[lid]?.title) ? `(${safeString(lectureObj[lid]?.title)})` : ""}
                </option>
              ))}
            </datalist>
            <button
              className="btn-outline"
              onClick={() => {
                const id = prompt("새 강의ID를 입력하세요 (예: shorts_to_benz_3)") || "";
                const lectureId = id.trim();
                if (!lectureId) return;
                updateConfig((c) => {
                  const cur = (c.lectures as any) || {};
                  if (cur[lectureId]) return c;
                  return { ...c, lectures: { ...cur, [lectureId]: { enabled: true, title: "", triggers: [] } } };
                });
                setSelectedLectureId(lectureId);
              }}
            >
              + 강의ID 추가
            </button>
            {selectedLectureId && (
              <button
                className="btn-danger"
                onClick={() => {
                  if (!confirm(`강의ID '${selectedLectureId}'를 삭제할까요? (트리거만 삭제, 방 매핑은 남을 수 있음)`)) return;
                  updateConfig((c) => {
                    const cur = { ...(c.lectures as any) };
                    delete cur[selectedLectureId];
                    return { ...c, lectures: cur };
                  });
                  setSelectedLectureId("");
                }}
              >
                강의 삭제
              </button>
            )}
          </div>

          {selectedLectureId && selectedLecture && (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <label className="control-label">
                  <input
                    type="checkbox"
                    checked={selectedLecture?.enabled !== false}
                    onChange={(e) =>
                      updateConfig((c) => ({
                        ...c,
                        lectures: { ...(c.lectures as any), [selectedLectureId]: { ...(selectedLecture as any), enabled: e.target.checked } },
                      }))
                    }
                  />{" "}
                  활성
                </label>
                <input
                  className="filter-input"
                  style={{ minWidth: 260, height: 34, marginBottom: 0 }}
                  value={safeString(selectedLecture?.title)}
                  onChange={(e) =>
                    updateConfig((c) => ({
                      ...c,
                      lectures: { ...(c.lectures as any), [selectedLectureId]: { ...(selectedLecture as any), title: e.target.value } },
                    }))
                  }
                  placeholder="강의 제목(표시용)"
                />
                <span className="tag tag-excluded">방 {lectureRooms(selectedLectureId).length}개</span>
              </div>

              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 8 }}>
                이 강의ID에 묶인 방: {lectureRooms(selectedLectureId).join(", ") || "(없음)"}{" "}
              </div>

              {renderTriggerEditor("lecture", selectedLectureId, (selectedLecture?.triggers || []) as any)}
            </>
          )}
        </div>

        <div className="card" style={{ padding: 14 }}>
          <h2 style={{ marginTop: 0 }}>방별(Room)</h2>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <input
              className="filter-input"
              style={{ minWidth: 420, height: 34, marginBottom: 0 }}
              list="auto-faq-room-list"
              value={selectedRoomId}
              onChange={(e) => setSelectedRoomId(e.target.value)}
              placeholder="방 선택/검색(roomId 또는 방 이름)…"
            />
            <datalist id="auto-faq-room-list">
              {roomsSorted.map((r) => (
                <option key={r.roomId} value={r.roomId}>
                  {safeString(r.roomName)} ({safeString(r.roomId)})
                </option>
              ))}
            </datalist>
            {selectedRoomId && (
              <button
                className="btn-outline"
                onClick={() => {
                  try {
                    void navigator.clipboard.writeText(String(selectedRoomId));
                  } catch {}
                }}
                title="roomId 복사"
              >
                roomId 복사
              </button>
            )}
          </div>

          {selectedRoomId && (
            <>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                <label className="control-label">
                  <input
                    type="checkbox"
                    checked={(selectedRoom?.enabled ?? true) !== false}
                    onChange={(e) =>
                      updateConfig((c) => ({
                        ...c,
                        rooms: { ...(c.rooms as any), [selectedRoomId]: { ...(selectedRoom as any), enabled: e.target.checked } },
                      }))
                    }
                  />{" "}
                  방별 트리거 사용
                </label>
                <input
                  className="filter-input"
                  style={{ minWidth: 240, height: 34, marginBottom: 0 }}
                  value={safeString(selectedRoom?.lectureId)}
                  onChange={(e) =>
                    updateConfig((c) => ({
                      ...c,
                      rooms: { ...(c.rooms as any), [selectedRoomId]: { ...(selectedRoom as any), lectureId: e.target.value } },
                    }))
                  }
                  placeholder="강의ID(선택)"
                />
                <span className="tag tag-excluded">
                  lecture={safeString(selectedRoom?.lectureId) || "-"}
                </span>
              </div>
              {renderTriggerEditor("room", selectedRoomId, ((selectedRoom as any)?.triggers || []) as any)}
            </>
          )}
        </div>
      </div>
      )}
    </main>
  );
}
