import React, { useEffect, useState } from 'react';
import { CourseRosterRoomConfig, LogEntry, OpenchatMembersSheetsRoomConfig, RoomInfo, RoomFeatures, RoomMember, RoomMembersResponse } from '../types';
import LogViewer from './LogViewer';

interface RoomCardProps {
    room: RoomInfo;
    logs: LogEntry[];
    features: RoomFeatures;
    courseRosterConfig?: CourseRosterRoomConfig | null;
    courseRosterConfigExists?: boolean;
    courseRosterHasServiceAccount?: boolean;
    courseRosterConfigDirty?: boolean;
    onUpdateCourseRosterConfig?: (roomId: string, patch: Partial<CourseRosterRoomConfig>) => void;
    openchatMembersSheetsConfig?: OpenchatMembersSheetsRoomConfig | null;
    openchatMembersSheetsConfigExists?: boolean;
    openchatMembersSheetsHasServiceAccount?: boolean;
    openchatMembersSheetsConfigDirty?: boolean;
    openchatMembersSheetsWorkerEnabled?: boolean;
    openchatMembersSheetsRoomState?: any | null;
    onUpdateOpenchatMembersSheetsConfig?: (roomId: string, patch: Partial<OpenchatMembersSheetsRoomConfig>) => void;
    excluded: boolean;
    saving: "idle" | "saving" | "saved" | "error";
    onToggleFeature: (roomId: string, feature: keyof RoomFeatures, value: boolean) => void;
    onSave: (roomId: string) => void;
    onExclude: (roomId: string, value: boolean) => void;
    onUploadAvatar: (roomId: string, file: File) => void;
    realtimeBase: string;
    avatarVersion: number;
}

export default function RoomCard({
    room,
    logs,
    features,
    courseRosterConfig,
    courseRosterConfigExists,
    courseRosterHasServiceAccount,
    courseRosterConfigDirty,
    onUpdateCourseRosterConfig,
    openchatMembersSheetsConfig,
    openchatMembersSheetsConfigExists,
    openchatMembersSheetsHasServiceAccount,
    openchatMembersSheetsConfigDirty,
    openchatMembersSheetsWorkerEnabled,
    openchatMembersSheetsRoomState,
    onUpdateOpenchatMembersSheetsConfig,
    excluded,
    saving,
    onToggleFeature,
    onSave,
    onExclude,
    onUploadAvatar,
    realtimeBase,
    avatarVersion,
}: RoomCardProps) {
    const MEMBERS_LIMIT = 200;

    const isActive = !!(
        features.welcome ||
        features.broadcast ||
        features.schedules ||
        features.ai ||
        features.chatSummary ||
        features.courseRoster
    );
    const [avatarError, setAvatarError] = useState(false);

    const rawRoomName = String(room.roomName || "").trim();
    const inferredCourseRoom = /^\((사담방|공지방|프리미엄방)\)/.test(rawRoomName);
    const isCourseRoom =
        features.courseRoom === true ||
        features.courseRoster === true ||
        (features.courseRoom !== false && inferredCourseRoom);

    const [membersOpen, setMembersOpen] = useState(false);
    const [membersQuery, setMembersQuery] = useState("");
    const [membersOffset, setMembersOffset] = useState(0);
    const [membersLoading, setMembersLoading] = useState(false);
    const [membersError, setMembersError] = useState<string | null>(null);
    const [membersHint, setMembersHint] = useState<string | null>(null);
    const [membersLoadedCount, setMembersLoadedCount] = useState<number | null>(null);
    const [membersActiveCount, setMembersActiveCount] = useState<number | null>(null);
    const [members, setMembers] = useState<RoomMember[]>([]);
    const [membersSheetsSyncing, setMembersSheetsSyncing] = useState(false);
    const [membersSheetsSyncMsg, setMembersSheetsSyncMsg] = useState<string | null>(null);
    const [membersSheetsSyncErr, setMembersSheetsSyncErr] = useState<string | null>(null);
    const [membersSheetsHintCmd, setMembersSheetsHintCmd] = useState<string | null>(null);

    const rosterCfg: any = (courseRosterConfig && typeof courseRosterConfig === "object") ? courseRosterConfig : {};
    const rosterSpreadsheetId = String(rosterCfg.spreadsheetId || "").trim();
    const rosterSheetName = String(rosterCfg.rosterSheetName || "").trim();
    const rosterCafeCsvPath = String(rosterCfg.cafeCsvPath || "").trim();
    const rosterJoinUrl = String(rosterCfg.joinUrl || "").trim();
    const rosterCsvExists = rosterCfg.cafeCsvExists === true;
    const rosterParsedSheetId = String(rosterCfg.parsedSpreadsheetId || "").trim();
    const rosterConfigIncomplete = !rosterSpreadsheetId || !rosterCafeCsvPath;
    const rosterCanOperate = !!features.courseRoster && !rosterConfigIncomplete && !!courseRosterHasServiceAccount;

    const openchatSheetsCfg: any = (openchatMembersSheetsConfig && typeof openchatMembersSheetsConfig === "object") ? openchatMembersSheetsConfig : {};
    const openchatSheetsEnabled = openchatSheetsCfg.enabled === true;
    const openchatSheetsSpreadsheetId = String(openchatSheetsCfg.spreadsheetId || "").trim();
    const openchatSheetsSheetName = String(openchatSheetsCfg.sheetName || "").trim();
    const openchatSheetsAllowIncomplete = openchatSheetsCfg.allowIncomplete === true;

    const openchatSheetsState: any = (openchatMembersSheetsRoomState && typeof openchatMembersSheetsRoomState === "object")
        ? openchatMembersSheetsRoomState
        : {};
    const openchatSheetsLastResult = String(openchatSheetsState.lastResult || "").trim();
    const openchatSheetsLastOkTs = String(openchatSheetsState.lastOkTs || "").trim();
    const openchatSheetsLastAttemptTs = String(openchatSheetsState.lastAttemptTs || "").trim();
    const openchatSheetsNextRunTs = String(openchatSheetsState.nextRunTs || "").trim();
    const openchatSheetsLastError = String(openchatSheetsState.lastError || "").trim();

    const fmtTs = (ts: string): string => {
        const s = String(ts || "").trim();
        if (!s) return "";
        try {
            const d = new Date(s);
            if (Number.isNaN(d.getTime())) return s;
            return d.toLocaleString();
        } catch {
            return s;
        }
    };

    const copyToClipboard = async (text: string): Promise<void> => {
        const v = String(text || "");
        if (!v) return;
        try {
            if (navigator?.clipboard?.writeText) {
                await navigator.clipboard.writeText(v);
                return;
            }
        } catch { }
        try {
            const ta = document.createElement("textarea");
            ta.value = v;
            ta.setAttribute("readonly", "true");
            ta.style.position = "fixed";
            ta.style.top = "0";
            ta.style.left = "0";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            document.execCommand("copy");
            document.body.removeChild(ta);
        } catch { }
    };

    useEffect(() => {
        setAvatarError(false);
    }, [room.roomId, avatarVersion]);

    useEffect(() => {
        // 방이 바뀌면 멤버 UI 상태를 초기화한다.
        setMembersOpen(false);
        setMembersQuery("");
        setMembersOffset(0);
        setMembersLoading(false);
        setMembersError(null);
        setMembersHint(null);
        setMembersLoadedCount(null);
        setMembersActiveCount(null);
        setMembers([]);
        setMembersSheetsSyncing(false);
        setMembersSheetsSyncMsg(null);
        setMembersSheetsSyncErr(null);
        setMembersSheetsHintCmd(null);
    }, [room.roomId]);

    const avatarUrl = `${realtimeBase}/avatar/${room.roomId}?v=${avatarVersion}&t=${Math.floor(Date.now() / 300000)}`;

    useEffect(() => {
        if (!membersOpen) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                setMembersLoading(true);
                setMembersError(null);
                try {
                    const params = new URLSearchParams();
                    params.set("limit", String(MEMBERS_LIMIT));
                    params.set("offset", String(Math.max(0, membersOffset)));
                    const q = membersQuery.trim();
                    if (q) params.set("q", q);
                    const r = await fetch(`/api/rooms/${room.roomId}/members?` + params.toString(), { cache: "no-store" });
                    const j: RoomMembersResponse = await r.json().catch(() => ({ ok: false } as any));
                    if (!r.ok || !j || j.ok !== true) {
                        const msg = (j as any)?.detail || (j as any)?.error || `HTTP ${r.status}`;
                        throw new Error(String(msg));
                    }
                    if (cancelled) return;
                    setMembers((Array.isArray(j.members) ? j.members : []) as RoomMember[]);
                    setMembersLoadedCount(typeof j.loadedMembersCount === "number" ? j.loadedMembersCount : null);
                    setMembersActiveCount(typeof j.activeMembersCount === "number" ? j.activeMembersCount : null);
                    setMembersHint(j.hint ? String(j.hint) : null);
                } catch (e: any) {
                    if (cancelled) return;
                    setMembers([]);
                    setMembersError(String(e?.message || e));
                    setMembersHint(null);
                    setMembersLoadedCount(null);
                    setMembersActiveCount(null);
                } finally {
                    if (!cancelled) setMembersLoading(false);
                }
            })();
        }, 250);
        return () => {
            cancelled = true;
            try { clearTimeout(timer); } catch { }
        };
    }, [membersOpen, room.roomId, membersQuery, membersOffset]);

    const syncMembersToSheets = async (): Promise<void> => {
        const rid = String(room.roomId || "").trim();
        if (!rid) return;
        const ok = confirm(`이 방 멤버를 Google Sheets에 업서트할까요?\n\nroomId=${rid}\n\n(※ loadedMembersCount < activeMembersCount이면 실패합니다)`);
        if (!ok) return;

        setMembersSheetsSyncing(true);
        setMembersSheetsSyncMsg(null);
        setMembersSheetsSyncErr(null);
        setMembersSheetsHintCmd(null);

        try {
            const r = await fetch(`/api/rooms/${encodeURIComponent(rid)}/members/sync-sheets`, { method: "POST" });
            const j: any = await r.json().catch(() => null);
            if (!r.ok || !j || j.ok !== true) {
                setMembersSheetsSyncErr(String(j?.detail || j?.error || `HTTP ${r.status}`));
                const hint = String(j?.hintCommand || "").trim();
                if (hint) setMembersSheetsHintCmd(hint);
                return;
            }
            const fetched = j?.counts?.fetched;
            const updates = j?.sheets?.updates;
            const appends = j?.sheets?.appends;
            const msg = `Sheets 업서트 완료: updates=${typeof updates === "number" ? updates : "?"}, appends=${typeof appends === "number" ? appends : "?"}, fetched=${typeof fetched === "number" ? fetched : "?"}`;
            setMembersSheetsSyncMsg(msg);
        } catch (e: any) {
            setMembersSheetsSyncErr(String(e?.message || e));
        } finally {
            setMembersSheetsSyncing(false);
        }
    };

    return (
        <div className="room-card" data-testid={`room-card-${room.roomId}`}>
            <div className="room-header">
                <div style={{ position: 'relative' }}>
                    {!avatarError ? (
                        <img
                            src={avatarUrl}
                            onError={() => setAvatarError(true)}
                            alt="avatar"
                            className="room-avatar"
                        />
                    ) : (
                        <div className="room-avatar room-avatar-fallback">
                            {(room.roomName || "").trim().charAt(0) || "?"}
                        </div>
                    )}
                    <label
                        style={{
                            position: 'absolute', bottom: -4, right: -4,
                            background: 'var(--bg-card)', border: '1px solid var(--border-color)',
                            borderRadius: '50%', width: 20, height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: 'pointer', fontSize: 10
                        }}
                        title="아바타 교체"
                    >
                        ?
                        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0]; if (f) onUploadAvatar(room.roomId, f); }} />
                    </label>
                </div>

                <div className="room-info">
                    <div className="room-name" title={room.roomName}>{room.roomName}</div>
                    <div
                        className="room-id"
                        title="Room ID (클릭하면 복사)"
                        onClick={() => {
                            void copyToClipboard(room.roomId);
                        }}
                    >
                        ID {room.roomId}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)' }} title="IRIS chat_rooms.active_members_count (실시간에 가까운 값)">
                        인원 {typeof room.activeMembersCount === 'number' ? room.activeMembersCount.toLocaleString() : '—'}
                    </div>
                    <div className="room-tags">
                        {isActive ? (
                            <span className="tag tag-active">활성</span>
                        ) : (
                            <span className="tag tag-inactive">비활성</span>
                        )}
                        {isCourseRoom && <span className="tag tag-course">강의톡방</span>}
                        {excluded && <span className="tag tag-excluded">제외</span>}
                    </div>
                </div>
            </div>

            <LogViewer logs={logs} height={160} id={`room-log-${room.roomId}`} />

            <div className="room-controls-block">
                <div className="room-controls-section">
                    <div className="room-controls-title">기본 기능</div>
                    <div className="room-controls">
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.welcome}
                                onChange={e => onToggleFeature(room.roomId, 'welcome', e.target.checked)}
                            />
                            환영
                        </label>
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.welcome && features.welcomeFollowUp !== false}
                                onChange={e => onToggleFeature(room.roomId, 'welcomeFollowUp', e.target.checked)}
                                disabled={!features.welcome}
                            />
                            웰컴 답장(첫 이미지)
                        </label>
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.broadcast}
                                onChange={e => onToggleFeature(room.roomId, 'broadcast', e.target.checked)}
                            />
                            브로드캐스트
                        </label>
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.schedules}
                                onChange={e => onToggleFeature(room.roomId, 'schedules', e.target.checked)}
                            />
                            스케줄
                        </label>
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.ai}
                                onChange={e => onToggleFeature(room.roomId, 'ai', e.target.checked)}
                            />
                            AI 응답(?디하클)
                        </label>
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.chatSummary}
                                onChange={e => onToggleFeature(room.roomId, 'chatSummary', e.target.checked)}
                            />
                            채팅 요약(!채팅요약)
                        </label>
                    </div>
                </div>

                <div className="room-controls-section">
                    <div className="room-controls-title">강의 운영</div>
                    <div className="room-controls">
                        <label className="control-label" title="강의 운영 톡방으로 표시(배지)합니다. (기본: 방 이름 접두어로 자동 추론)">
                            <input
                                type="checkbox"
                                checked={isCourseRoom}
                                onChange={e => {
                                    const v = e.target.checked;
                                    onToggleFeature(room.roomId, 'courseRoom', v);
                                    if (!v && !!features.courseRoster) {
                                        onToggleFeature(room.roomId, 'courseRoster', false);
                                    }
                                }}
                            />
                            강의톡방
                        </label>
                        <label
                            className="control-label"
                            title="카페 가입/닉네임 확인 안내(멘션) + 시트 upsert 워커를 활성화합니다."
                        >
                            <input
                                type="checkbox"
                                checked={!!features.courseRoster}
                                onChange={e => {
                                    const v = e.target.checked;
                                    if (v && !isCourseRoom) {
                                        onToggleFeature(room.roomId, 'courseRoom', true);
                                    }
                                    onToggleFeature(room.roomId, 'courseRoster', v);
                                    // UX: courseRoster를 켜면 설정 엔트리를 자동 생성해 "설정 필요" 상태를 명확히 만든다.
                                    if (v && (!courseRosterConfig || typeof courseRosterConfig !== "object")) {
                                        onUpdateCourseRosterConfig?.(room.roomId, { enabled: true, rosterSheetName: "ROSTER_RAW" });
                                    }
                                }}
                                disabled={!isCourseRoom && !features.courseRoster}
                            />
                            카페/닉네임 검증
                        </label>
                    </div>
                    <div className="room-controls-note">
                        강의톡방 자동 추론: <code>(사담방)</code>, <code>(공지방)</code>, <code>(프리미엄방)</code> 접두어가 있으면 강의톡방으로 표시됩니다.
                    </div>

                    {isCourseRoom && (
                        <div style={{ marginTop: 10 }}>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
                                <span className="tag tag-excluded" title="로스터 설정 파일 존재 여부">
                                    설정파일 {courseRosterConfigExists ? 'OK' : '없음'}
                                </span>
                                <span className="tag tag-excluded" title="Google Sheets 서비스 계정 키">
                                    서비스계정 {courseRosterHasServiceAccount ? 'OK' : '없음'}
                                </span>
                                <span className="tag tag-excluded" title="카페 CSV 경로 존재 여부(로컬)">
                                    CSV {rosterCafeCsvPath ? (rosterCsvExists ? 'OK' : '없음') : '미설정'}
                                </span>
                                <span className="tag tag-excluded" title="스프레드시트 ID(파싱 결과)">
                                    시트 {rosterSpreadsheetId ? (rosterParsedSheetId ? 'OK' : '확인필요') : '미설정'}
                                </span>
                                {features.courseRoster && (
                                    <span className={rosterCanOperate ? "tag tag-active" : "tag tag-excluded"}>
                                        {rosterCanOperate ? "운영 가능" : "설정 필요"}
                                    </span>
                                )}
                                {courseRosterConfigDirty && <span className="tag tag-inactive">강의설정 저장 필요</span>}
                            </div>

                            <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
                                <input
                                    className="filter-input"
                                    value={rosterSpreadsheetId}
                                    placeholder="스프레드시트 URL 또는 ID (예: https://docs.google.com/spreadsheets/d/.../edit)"
                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { spreadsheetId: e.target.value })}
                                />
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <input
                                        className="filter-input"
                                        style={{ flex: 1 }}
                                        value={rosterSheetName}
                                        placeholder="시트 탭 이름 (기본: ROSTER_RAW)"
                                        onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { rosterSheetName: e.target.value })}
                                    />
                                    <label className="control-label" title="roomId 매핑을 roster-worker에서 사용할지 여부(기본 ON)">
                                        <input
                                            type="checkbox"
                                            checked={rosterCfg.enabled !== false}
                                            onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { enabled: e.target.checked })}
                                        />
                                        사용
                                    </label>
                                </div>
                                <input
                                    className="filter-input"
                                    value={rosterCafeCsvPath}
                                    placeholder="카페 멤버 CSV 경로 (예: C:\\dev\\naver-cafe-member-crawler\\data\\...csv)"
                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { cafeCsvPath: e.target.value })}
                                />
                                <input
                                    className="filter-input"
                                    value={rosterJoinUrl}
                                    placeholder="카페 가입 URL (선택)"
                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { joinUrl: e.target.value })}
                                />
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                    강의 운영 설정을 변경했다면, 아래 <b>저장</b>을 눌러 반영하세요. (런타임 + 강의 운영 설정을 함께 저장)
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ marginTop: 10, borderTop: '1px solid var(--border-color)', paddingTop: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button
                            onClick={() => setMembersOpen(v => !v)}
                            className="btn-outline"
                            style={{ padding: '6px 10px', fontSize: 12 }}
                            title="IRIS db2.open_chat_member 기반 멤버 목록(대형 방은 단말 스크롤로 DB 로딩이 필요할 수 있음)"
                        >
                            멤버 {membersOpen ? '닫기' : '보기'}
                        </button>
                        <button
                            onClick={() => { void syncMembersToSheets(); }}
                            className="btn-outline"
                            style={{ padding: '6px 10px', fontSize: 12 }}
                            disabled={membersSheetsSyncing}
                            title="IRIS db2.open_chat_member → Google Sheets upsert (서비스 계정 OAuth 필요)"
                        >
                            {membersSheetsSyncing ? '업서트…' : 'Sheets 업서트'}
                        </button>
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                        {membersLoading ? '로딩…' : (
                            <>
                                DB {typeof membersLoadedCount === 'number' ? membersLoadedCount.toLocaleString() : '—'}명
                                {' · '}
                                실시간 {typeof (room.activeMembersCount ?? membersActiveCount) === 'number'
                                    ? (room.activeMembersCount ?? membersActiveCount)!.toLocaleString()
                                    : '—'}명
                            </>
                        )}
                    </div>
                </div>

                {membersSheetsSyncMsg && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--success)', lineHeight: 1.4 }}>
                        {membersSheetsSyncMsg}
                    </div>
                )}
                {membersSheetsSyncErr && (
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--error)', lineHeight: 1.4 }}>
                        Sheets 업서트 실패: <code>{membersSheetsSyncErr}</code>
                    </div>
                )}
                {membersSheetsHintCmd && (
                    <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <code style={{ fontSize: 11, color: 'var(--text-secondary)' }}>{membersSheetsHintCmd}</code>
                        <button
                            className="btn-copy"
                            style={{ padding: '2px 8px', fontSize: 11 }}
                            onClick={() => { void copyToClipboard(membersSheetsHintCmd); }}
                        >
                            복사
                        </button>
                    </div>
                )}

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>멤버 Sheets 자동</div>
                        {openchatMembersSheetsConfigDirty && <span className="tag tag-inactive" title="openchat_members_sheets.json 저장 필요">저장 필요</span>}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 8 }}>
                        <label className="control-label" title="해당 방 전체 멤버 목록을 주기적으로 Google Sheets에 업서트">
                            <input
                                type="checkbox"
                                checked={openchatSheetsEnabled}
                                onChange={e => onUpdateOpenchatMembersSheetsConfig?.(room.roomId, { enabled: e.target.checked })}
                            />
                            자동 동기화
                        </label>
                        <input
                            value={openchatSheetsSpreadsheetId}
                            onChange={(e) => onUpdateOpenchatMembersSheetsConfig?.(room.roomId, { spreadsheetId: e.target.value })}
                            placeholder="Spreadsheet ID/URL (빈칸=기본값 사용)"
                            className="filter-input"
                            style={{ flex: 1, minWidth: 220, height: 34, marginBottom: 0 }}
                            disabled={!openchatSheetsEnabled}
                        />
                        <input
                            value={openchatSheetsSheetName}
                            onChange={(e) => onUpdateOpenchatMembersSheetsConfig?.(room.roomId, { sheetName: e.target.value })}
                            placeholder="시트 탭(빈칸=기본값)"
                            className="filter-input"
                            style={{ width: 200, height: 34, marginBottom: 0 }}
                            disabled={!openchatSheetsEnabled}
                        />
                        <span className="tag tag-excluded" title="스케줄링 ON 시 고정: 매 10분 업서트">
                            주기 10분(고정)
                        </span>
                        <label className="control-label" title="권장하지 않음: loadedMembersCount < activeMembersCount이어도 강제 업서트">
                            <input
                                type="checkbox"
                                checked={openchatSheetsAllowIncomplete}
                                onChange={(e) => onUpdateOpenchatMembersSheetsConfig?.(room.roomId, { allowIncomplete: e.target.checked })}
                                disabled={!openchatSheetsEnabled}
                            />
                            불완전 허용(권장x)
                        </label>
                        <button
                            onClick={() => { void syncMembersToSheets(); }}
                            className="btn-outline"
                            style={{ padding: '6px 10px', fontSize: 12 }}
                            disabled={membersSheetsSyncing}
                            title="즉시 1회 업서트(수동). 자동 동기화는 다음 주기부터 실행됩니다."
                        >
                            {membersSheetsSyncing ? '업서트…' : '지금 업서트'}
                        </button>
                    </div>

                    <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        워커: {openchatMembersSheetsWorkerEnabled ? 'ON' : 'OFF'}{' · '}
                        서비스계정: {openchatMembersSheetsHasServiceAccount ? 'OK' : '없음'}{' · '}
                        설정파일: {openchatMembersSheetsConfigExists ? 'OK' : '없음'}
                        {openchatSheetsNextRunTs && (
                            <>
                                {' · '}다음: {fmtTs(openchatSheetsNextRunTs)}
                            </>
                        )}
                        {openchatSheetsLastResult && (
                            <>
                                {' · '}최근 결과: <b>{openchatSheetsLastResult}</b>
                            </>
                        )}
                        {openchatSheetsLastOkTs && (
                            <>
                                {' · '}OK: {fmtTs(openchatSheetsLastOkTs)}
                            </>
                        )}
                        {!openchatSheetsLastOkTs && openchatSheetsLastAttemptTs && (
                            <>
                                {' · '}시도: {fmtTs(openchatSheetsLastAttemptTs)}
                            </>
                        )}
                    </div>

                    {openchatSheetsLastResult === "INCOMPLETE_MEMBER_DB" && (
                        <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 11, color: 'var(--error)' }}>멤버 DB 불완전 → 스크롤 로딩 후 재시도</span>
                            <code style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
                                {`pwsh scripts/openchat_load_members.ps1 -RoomId ${room.roomId} -Scrolls 600`}
                            </code>
                            <button
                                className="btn-copy"
                                style={{ padding: '2px 8px', fontSize: 11 }}
                                onClick={() => { void copyToClipboard(`pwsh scripts/openchat_load_members.ps1 -RoomId ${room.roomId} -Scrolls 600`); }}
                            >
                                복사
                            </button>
                        </div>
                    )}
                    {openchatSheetsLastError && openchatSheetsLastResult && openchatSheetsLastResult !== "OK" && (
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--error)', whiteSpace: 'pre-wrap' }}>
                            {openchatSheetsLastError.slice(0, 600)}
                        </div>
                    )}
                </div>

                {membersOpen && (
                    <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                                value={membersQuery}
                                onChange={e => { setMembersQuery(e.target.value); setMembersOffset(0); }}
                                placeholder="닉네임 검색 (부분일치)"
                                className="filter-input"
                                style={{ flex: 1, height: 34, marginBottom: 0 }}
                            />
                            <button
                                className="btn-outline"
                                style={{ padding: '6px 10px', fontSize: 12 }}
                                disabled={membersOffset <= 0 || membersLoading}
                                onClick={() => setMembersOffset(o => Math.max(0, o - MEMBERS_LIMIT))}
                                title="이전 페이지"
                            >
                                이전
                            </button>
                            <button
                                className="btn-outline"
                                style={{ padding: '6px 10px', fontSize: 12 }}
                                disabled={
                                    membersLoading ||
                                    (typeof membersLoadedCount === 'number' && membersOffset + MEMBERS_LIMIT >= membersLoadedCount) ||
                                    (members.length > 0 && members.length < MEMBERS_LIMIT)
                                }
                                onClick={() => setMembersOffset(o => o + MEMBERS_LIMIT)}
                                title="다음 페이지"
                            >
                                다음
                            </button>
                        </div>

                        {membersHint && (
                            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                {membersHint}
                            </div>
                        )}
                        {membersError && (
                            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--error)' }}>
                                멤버 조회 실패: <code>{membersError}</code>
                            </div>
                        )}

                        <div style={{ marginTop: 8, maxHeight: 180, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 10, background: 'var(--bg-main)', padding: 10 }}>
                            {membersLoading ? (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>로딩…</div>
                            ) : members.length ? (
                                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--text-secondary)' }}>
                                    {members.map((m) => (
                                        <li
                                            key={m.userId}
                                            style={{ cursor: 'pointer', userSelect: 'text' }}
                                            title="클릭하면 userId 복사"
                                            onClick={() => {
                                                void copyToClipboard(String(m.userId));
                                            }}
                                        >
                                            {m.nickname || '—'}{' '}
                                            <span style={{ color: 'var(--text-muted)' }}>
                                                ({String(m.userId)})
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            ) : (
                                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>멤버 없음</div>
                            )}
                        </div>
                        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                            페이지: {Math.floor(membersOffset / MEMBERS_LIMIT) + 1}
                            {typeof membersLoadedCount === 'number'
                                ? ` / ${Math.max(1, Math.ceil(membersLoadedCount / MEMBERS_LIMIT))}`
                                : ''}
                        </div>
                    </div>
                )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button
                        onClick={() => onSave(room.roomId)}
                        disabled={saving === "saving"}
                        className="btn-save"
                        style={{ minWidth: 60 }}
                    >
                        {saving === "saving" ? "..." : "저장"}
                    </button>
                    {saving === "saved" && <span style={{ fontSize: 11, color: 'var(--success)', alignSelf: 'center' }}>저장됨</span>}
                    {saving === "error" && <span style={{ fontSize: 11, color: 'var(--error)', alignSelf: 'center' }}>에러</span>}
                </div>

                {!excluded ? (
                    <button onClick={() => onExclude(room.roomId, true)} className="btn-exclude">
                        제외
                    </button>
                ) : (
                    <button onClick={() => onExclude(room.roomId, false)} className="btn-restore">
                        복원
                    </button>
                )}
            </div>
        </div>
    );
}
