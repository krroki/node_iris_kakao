"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import "../dashboard.css";

interface AnnouncementRoute {
  id: string;
  source: string;
  targets: string[];
  enabled: boolean;
  includeImages?: boolean;
  includeSenderName?: boolean;
  delayMs?: number;
  appendTargetIndex?: boolean;
  targetIndexStart?: number;
}

interface AnnouncementConfig {
  allowWhenSafeMode: boolean;
  routes: AnnouncementRoute[];
}

interface RoomInfo {
  roomId: string;
  roomName: string;
}

export default function AnnouncementPage() {
  const [config, setConfig] = useState<AnnouncementConfig>({
    allowWhenSafeMode: false,
    routes: [],
  });
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [safeModeOn, setSafeModeOn] = useState<boolean>(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // 편집 중인 route
  const [editingRoute, setEditingRoute] = useState<AnnouncementRoute | null>(null);
  const [isNewRoute, setIsNewRoute] = useState(false);
  const [targetsText, setTargetsText] = useState<string>("");
  const [sourceQuery, setSourceQuery] = useState<string>("");
  const [targetQuery, setTargetQuery] = useState<string>("");

  const normalizeTargets = (list: string[], source?: string) => {
    const src = String(source || "").trim();
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of list) {
      const t = String(raw || "").trim();
      if (!t) continue;
      if (src && t === src) continue;
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
    }
    return out;
  };

  const parseTargetsText = (text: string) => {
    const tokens = String(text || "")
      .split(/[\s,]+/g)
      .map((t) => t.trim())
      .filter(Boolean);
    return tokens;
  };

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [runtimeRes, roomsRes] = await Promise.all([
        fetch("/api/runtime"),
        fetch("/api/rooms"),
      ]);
      const runtime = await runtimeRes.json();
      const roomsList = await roomsRes.json();

      setConfig(runtime.announcement || { allowWhenSafeMode: false, routes: [] });
      setSafeModeOn(runtime?.safeMode !== false);
      setRooms(Array.isArray(roomsList) ? roomsList : []);
    } catch (e) {
      setMessage({ type: "error", text: "데이터 로드 실패" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // 저장
  const saveConfig = async (newConfig: AnnouncementConfig) => {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/runtime", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ announcement: newConfig }),
      });
      if (!res.ok) throw new Error("저장 실패");
      setConfig(newConfig);
      setMessage({ type: "success", text: "저장되었습니다" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e: any) {
      setMessage({ type: "error", text: e?.message || "저장 실패" });
    } finally {
      setSaving(false);
    }
  };

  // Route 토글
  const toggleRoute = (routeId: string) => {
    const newRoutes = config.routes.map((r) =>
      r.id === routeId ? { ...r, enabled: !r.enabled } : r
    );
    saveConfig({ ...config, routes: newRoutes });
  };

  // Route 삭제
  const deleteRoute = (routeId: string) => {
    if (!confirm("이 공지 설정을 삭제할까요?")) return;
    const newRoutes = config.routes.filter((r) => r.id !== routeId);
    saveConfig({ ...config, routes: newRoutes });
  };

  // 편집 시작
  const startEdit = (route: AnnouncementRoute) => {
    const next = { ...route };
    setEditingRoute(next);
    setTargetsText((next.targets || []).join("\n"));
    setIsNewRoute(false);
  };

  // 새 Route 생성
  const startNewRoute = () => {
    const next: AnnouncementRoute = {
      id: `route-${Date.now()}`,
      source: "",
      targets: [],
      enabled: true,
      includeImages: true,
      includeSenderName: false,
      delayMs: 500,
      appendTargetIndex: false,
      targetIndexStart: 1,
    };
    setEditingRoute(next);
    setTargetsText("");
    setIsNewRoute(true);
  };

  // 편집 저장
  const saveEdit = () => {
    if (!editingRoute) return;
    if (!editingRoute.source) {
      setMessage({ type: "error", text: "소스 방을 선택해주세요" });
      return;
    }
    if (editingRoute.targets.length === 0) {
      setMessage({ type: "error", text: "타겟 방을 최소 1개 선택해주세요" });
      return;
    }

    // normalize targets (dedup + strip + exclude source)
    const normalizedTargets = normalizeTargets(editingRoute.targets || [], editingRoute.source);
    const normalizedRoute: AnnouncementRoute = {
      ...editingRoute,
      targets: normalizedTargets,
      targetIndexStart: Math.max(1, Math.floor(Number(editingRoute.targetIndexStart || 1) || 1)),
    };

    let newRoutes: AnnouncementRoute[];
    if (isNewRoute) {
      newRoutes = [...config.routes, normalizedRoute];
    } else {
      newRoutes = config.routes.map((r) =>
        r.id === editingRoute.id ? normalizedRoute : r
      );
    }
    saveConfig({ ...config, routes: newRoutes });
    setEditingRoute(null);
  };

  // 방 이름 찾기
  const roomMap = useMemo(() => {
    const m = new Map<string, RoomInfo>();
    for (const r of rooms) {
      if (r?.roomId) m.set(r.roomId, r);
    }
    return m;
  }, [rooms]);

  const getRoomLabel = (roomId: string) => {
    const rid = String(roomId || "").trim();
    if (!rid) return "";
    const room = roomMap.get(rid);
    if (!room) return rid;
    const name = String(room.roomName || "").trim();
    if (!name || name === rid) return rid;
    return `${name} (${rid})`;
  };

  const filterRooms = (query: string, excludeRoomId?: string) => {
    const q = String(query || "").trim().toLowerCase();
    const ex = String(excludeRoomId || "").trim();
    return rooms.filter((r) => {
      if (!r?.roomId) return false;
      if (ex && r.roomId === ex) return false;
      if (!q) return true;
      const id = r.roomId.toLowerCase();
      const name = String(r.roomName || "").toLowerCase();
      return id.includes(q) || name.includes(q);
    });
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div style={{ textAlign: "center", padding: 40, color: "var(--text-muted)" }}>
          로딩 중...
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-container">
      <div className="header-section">
        <div>
          <h1 className="main-title">공지 관리</h1>
          <p className="sub-title">
            소스 방에 메시지를 보내면 타겟 방들에 자동으로 복제됩니다
          </p>
        </div>
        <button onClick={startNewRoute} className="btn-primary">
          + 새 공지 설정
        </button>
      </div>

      {message && (
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            marginBottom: 16,
            background: message.type === "success" ? "#22c55e20" : "#ef444420",
            color: message.type === "success" ? "#22c55e" : "#ef4444",
            border: `1px solid ${message.type === "success" ? "#22c55e" : "#ef4444"}`,
          }}
        >
          {message.text}
        </div>
      )}

      {/* 전역 설정 */}
      <div className="pipeline-card" style={{ marginBottom: 24 }}>
        <h3 style={{ margin: "0 0 12px", color: "var(--text-primary)" }}>전역 설정</h3>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span
            className={`tag ${safeModeOn ? "tag-inactive" : "tag-active"}`}
            title="SAFE_MODE는 runtime.json.safeMode 단일 소스입니다"
          >
            SAFE_MODE {safeModeOn ? "ON(발신 차단)" : "OFF(발신 가능)"}
          </span>
          <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
            SAFE_MODE=ON이면 공지/브로드캐스트 포함 **모든 발신이 차단**됩니다.
          </span>
        </div>
        <p style={{ margin: "10px 0 0", fontSize: 13, color: "var(--text-muted)" }}>
          팁: 같은 멘트를 여러 방에 뿌릴 때는 “타겟별 번호 붙이기” 옵션을 켜면 됩니다. (예: <code>공지 1</code>, <code>공지 2</code> …)
        </p>
      </div>

      {/* Route 목록 */}
      <div className="section-title" style={{ marginBottom: 16 }}>
        <span>공지 설정 ({config.routes.length}개)</span>
      </div>

      {config.routes.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: 40,
            color: "var(--text-muted)",
            background: "var(--bg-card)",
            borderRadius: 12,
            border: "1px solid var(--border-color)",
          }}
        >
          설정된 공지가 없습니다. "새 공지 설정" 버튼을 눌러 추가하세요.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {config.routes.map((route) => (
            <div
              key={route.id}
              className="pipeline-card"
              style={{
                opacity: route.enabled ? 1 : 0.6,
                borderLeft: `4px solid ${route.enabled ? "#22c55e" : "#6b7280"}`,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <span
                      className={`tag ${route.enabled ? "tag-active" : "tag-inactive"}`}
                    >
                      {route.enabled ? "활성" : "비활성"}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      {route.id}
                    </span>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <strong style={{ color: "var(--text-primary)" }}>소스:</strong>{" "}
                    <span style={{ color: "var(--accent-primary)" }}>
                      {getRoomLabel(route.source)}
                    </span>
                  </div>

                  <div style={{ marginBottom: 8 }}>
                    <strong style={{ color: "var(--text-primary)" }}>타겟:</strong>{" "}
                    <span style={{ color: "var(--text-secondary)" }}>
                      {route.targets.map((t) => getRoomLabel(t)).join(", ")}
                    </span>
                  </div>

                  <div style={{ display: "flex", gap: 16, fontSize: 13, color: "var(--text-muted)" }}>
                    <span>이미지: {route.includeImages !== false ? "O" : "X"}</span>
                    <span>발신자명: {route.includeSenderName ? "O" : "X"}</span>
                    <span>딜레이: {route.delayMs || 500}ms</span>
                    <span>번호: {route.appendTargetIndex ? `O(${route.targetIndexStart || 1}~)` : "X"}</span>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    onClick={() => toggleRoute(route.id)}
                    className="btn-outline"
                    style={{ padding: "6px 12px", fontSize: 13 }}
                  >
                    {route.enabled ? "비활성화" : "활성화"}
                  </button>
                  <button
                    onClick={() => startEdit(route)}
                    className="btn-outline"
                    style={{ padding: "6px 12px", fontSize: 13 }}
                  >
                    편집
                  </button>
                  <button
                    onClick={() => deleteRoute(route.id)}
                    className="btn-outline"
                    style={{ padding: "6px 12px", fontSize: 13, color: "#ef4444", borderColor: "#ef4444" }}
                  >
                    삭제
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 편집 모달 */}
      {editingRoute && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.7)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setEditingRoute(null)}
        >
          <div
            style={{
              background: "var(--bg-card)",
              borderRadius: 16,
              padding: 24,
              width: "90%",
              maxWidth: 600,
              maxHeight: "80vh",
              overflow: "auto",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ margin: "0 0 20px", color: "var(--text-primary)" }}>
              {isNewRoute ? "새 공지 설정" : "공지 설정 편집"}
            </h2>

            {/* 소스 방 선택 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 8, color: "var(--text-primary)", fontWeight: 500 }}>
                소스 방 (메시지를 보낼 방)
              </label>
              <input
                value={sourceQuery}
                onChange={(e) => setSourceQuery(e.target.value)}
                className="filter-input"
                style={{ width: "100%", marginBottom: 8 }}
                placeholder="검색 (방 이름/roomId)"
              />
              <select
                value={editingRoute.source}
                onChange={(e) => setEditingRoute({ ...editingRoute, source: e.target.value })}
                className="filter-select"
                style={{ width: "100%" }}
              >
                <option value="">-- 선택 --</option>
                {filterRooms(sourceQuery).map((r) => (
                  <option key={r.roomId} value={r.roomId}>
                    {getRoomLabel(r.roomId)}
                  </option>
                ))}
              </select>
            </div>

            {/* 타겟 방 선택 (다중) */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 8, color: "var(--text-primary)", fontWeight: 500 }}>
                타겟 방 (복제할 방들)
              </label>
              <input
                value={targetQuery}
                onChange={(e) => setTargetQuery(e.target.value)}
                className="filter-input"
                style={{ width: "100%", marginBottom: 8 }}
                placeholder="검색 (방 이름/roomId)"
              />
              <div
                style={{
                  border: "1px solid var(--border-color)",
                  borderRadius: 8,
                  maxHeight: 200,
                  overflow: "auto",
                  background: "var(--bg-main)",
                }}
              >
                {filterRooms(targetQuery, editingRoute.source).map((r) => (
                    <label
                      key={r.roomId}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: "8px 12px",
                        cursor: "pointer",
                        borderBottom: "1px solid var(--border-color)",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={editingRoute.targets.includes(r.roomId)}
                          onChange={(e) => {
                            const newTargetsRaw = e.target.checked
                              ? [...editingRoute.targets, r.roomId]
                              : editingRoute.targets.filter((t) => t !== r.roomId);
                            const newTargets = normalizeTargets(newTargetsRaw, editingRoute.source);
                            setEditingRoute({ ...editingRoute, targets: newTargets });
                            setTargetsText(newTargets.join("\n"));
                          }}
                          style={{ width: 16, height: 16 }}
                        />
                      <span style={{ color: "var(--text-secondary)" }}>{getRoomLabel(r.roomId)}</span>
                    </label>
                ))}
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                선택됨: {editingRoute.targets.length}개
              </p>
              <div style={{ marginTop: 10 }}>
                <label style={{ display: "block", marginBottom: 6, color: "var(--text-primary)", fontWeight: 500 }}>
                  타겟 roomId 직접 입력(붙여넣기)
                </label>
                <textarea
                  value={targetsText}
                  onChange={(e) => setTargetsText(e.target.value)}
                  className="filter-input"
                  style={{ width: "100%", height: 90, resize: "vertical", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace" }}
                  placeholder={"예) 18426993080683374\\n18468711351022101\\n... (공백/쉼표/줄바꿈 구분)"}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  <button
                    className="btn-outline"
                    onClick={() => {
                      const parsed = parseTargetsText(targetsText);
                      const normalized = normalizeTargets(parsed, editingRoute.source);
                      setEditingRoute({ ...editingRoute, targets: normalized });
                      setTargetsText(normalized.join("\n"));
                    }}
                    style={{ padding: "6px 10px", fontSize: 13 }}
                    type="button"
                  >
                    적용
                  </button>
                  <button
                    className="btn-outline"
                    onClick={() => {
                      setTargetsText((editingRoute.targets || []).join("\n"));
                    }}
                    style={{ padding: "6px 10px", fontSize: 13 }}
                    type="button"
                  >
                    되돌리기
                  </button>
                </div>
                <p style={{ margin: "6px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                  방 목록에 없는 ID도 입력할 수 있습니다. (단, 실제 발신은 allowlist/권한/토크 API 상태에 따라 실패할 수 있습니다)
                </p>
              </div>
            </div>

            {/* 옵션 */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", marginBottom: 8, color: "var(--text-primary)", fontWeight: 500 }}>
                옵션
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editingRoute.includeImages !== false}
                    onChange={(e) =>
                      setEditingRoute({ ...editingRoute, includeImages: e.target.checked })
                    }
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ color: "var(--text-secondary)" }}>이미지 포함</span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editingRoute.includeSenderName === true}
                    onChange={(e) =>
                      setEditingRoute({ ...editingRoute, includeSenderName: e.target.checked })
                    }
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ color: "var(--text-secondary)" }}>
                    발신자 이름 포함 ([닉네임] 메시지)
                  </span>
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={editingRoute.appendTargetIndex === true}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setEditingRoute({
                        ...editingRoute,
                        appendTargetIndex: on,
                        targetIndexStart: Math.max(1, Math.floor(Number(editingRoute.targetIndexStart || 1) || 1)),
                      });
                    }}
                    style={{ width: 16, height: 16 }}
                  />
                  <span style={{ color: "var(--text-secondary)" }}>
                    타겟별 번호 붙이기 (예: "공지 1", "공지 2")
                  </span>
                </label>
                {editingRoute.appendTargetIndex === true && (
                  <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 24 }}>
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>시작 번호</span>
                    <input
                      type="number"
                      value={editingRoute.targetIndexStart || 1}
                      onChange={(e) => {
                        const n = Math.max(1, Math.floor(parseInt(e.target.value || "1") || 1));
                        setEditingRoute({ ...editingRoute, targetIndexStart: n });
                      }}
                      className="filter-input"
                      style={{ width: 120 }}
                      min={1}
                      max={9999}
                    />
                    <span style={{ color: "var(--text-muted)", fontSize: 13 }}>
                      (타겟 순서대로 1씩 증가)
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* 딜레이 */}
            <div style={{ marginBottom: 24 }}>
              <label style={{ display: "block", marginBottom: 8, color: "var(--text-primary)", fontWeight: 500 }}>
                타겟 간 딜레이 (ms)
              </label>
              <input
                type="number"
                value={editingRoute.delayMs || 500}
                onChange={(e) =>
                  setEditingRoute({ ...editingRoute, delayMs: parseInt(e.target.value) || 500 })
                }
                className="filter-input"
                style={{ width: 120 }}
                min={0}
                max={5000}
              />
              <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--text-muted)" }}>
                스팸 방지를 위해 500ms 이상 권장
              </p>
            </div>

            {/* 버튼 */}
            <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
              <button
                onClick={() => setEditingRoute(null)}
                className="btn-outline"
                style={{ padding: "10px 20px" }}
              >
                취소
              </button>
              <button
                onClick={saveEdit}
                className="btn-primary"
                style={{ padding: "10px 20px" }}
                disabled={saving}
              >
                {saving ? "저장 중..." : "저장"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginTop: 40, color: "var(--text-muted)", fontSize: 13, textAlign: "center", paddingBottom: 40 }}>
        공지는 소스 방에 메시지가 올라오면 타겟 방들에 자동으로 복제됩니다.
        <br />
        루프 방지를 위해 복제된 메시지에는 숨김 마커가 포함됩니다.
      </div>
    </div>
  );
}
