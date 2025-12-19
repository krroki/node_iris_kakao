import React, { useEffect, useState } from 'react';
import { CourseRosterRoomConfig, LogEntry, OpenchatMembersSheetsRoomConfig, RoomInfo, RoomFeatures, RoomMember, RoomMembersResponse, RoomAdminsResponse } from '../types';
import LogViewer from './LogViewer';

function extractNaverCafeClubId(raw: string): string {
    const s = String(raw || '').trim();
    if (!s) return '';
    const m = s.match(/(?:clubid|clubId|search\\.clubid|search\\.clubId)=(\\d+)/i);
    return m ? String(m[1] || '').trim() : '';
}

function inferCourseRosterSheetName(roomName: string): string {
    const s = String(roomName || '').trim();
    if (/^\\(사담방\\)/.test(s)) return 'ROSTER_CHAT';
    if (/^\\(공지방\\)/.test(s)) return 'ROSTER_NOTICE';
    if (/^\\(프리미엄방\\)/.test(s)) return 'ROSTER_PREMIUM';
    return 'ROSTER_RAW';
}

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
        features.nicknameReminder ||
        features.imageGen ||
        features.chatSummary ||
        features.commands ||
        features.autoFaq ||
        features.courseRoster
    );
    const [avatarError, setAvatarError] = useState(false);

    const rawRoomName = String(room.roomName || "").trim();
    const rosterDefaultSheetName = inferCourseRosterSheetName(rawRoomName);
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

    const [admins, setAdmins] = useState<RoomAdminsResponse | null>(null);
    const [adminsLoading, setAdminsLoading] = useState(false);
    const [adminsError, setAdminsError] = useState<string | null>(null);
    const [adminsRefreshing, setAdminsRefreshing] = useState(false);
    const [adminsRefreshMsg, setAdminsRefreshMsg] = useState<string | null>(null);
    const [adminsRefreshErr, setAdminsRefreshErr] = useState<string | null>(null);

    const rosterCfg: any = (courseRosterConfig && typeof courseRosterConfig === "object") ? courseRosterConfig : {};
    const rosterSpreadsheetId = String(rosterCfg.spreadsheetId || "").trim();
    const rosterSheetName = String(rosterCfg.rosterSheetName || "").trim();
    const rosterCafeSource = String(rosterCfg.cafeSource || "").trim().toLowerCase() === "csv" ? "csv" : "crawler";
    const rosterCafeUrl = String(rosterCfg.cafeUrl || "").trim();
    const rosterCafeClubId = String(rosterCfg.cafeClubId || "").trim();
    const rosterCrawlerRepoPath = String(rosterCfg.crawlerRepoPath || "C:\\dev\\naver-cafe-member-crawler").trim();
    const rosterCrawlerPythonExe = String(rosterCfg.crawlerPythonExe || "").trim()
        || `${rosterCrawlerRepoPath}\\venv\\Scripts\\python.exe`;
    const rosterCrawlerSettingsPath = String(rosterCfg.crawlerSettingsPath || "").trim();
    const rosterCafeCsvPath = String(rosterCfg.cafeCsvPath || "").trim();
    const rosterJoinUrl = String(rosterCfg.joinUrl || "").trim();
    const rosterCsvExists: boolean | undefined = rosterCfg.cafeCsvExists;
    const rosterCrawlerRepoExists: boolean | undefined = rosterCfg.crawlerRepoExists;
    const rosterCrawlerPythonExists: boolean | undefined = rosterCfg.crawlerPythonExists;
    const rosterCrawlerSettingsExists: boolean | undefined = rosterCfg.crawlerSettingsExists;
    const rosterParsedSheetId = String(rosterCfg.parsedSpreadsheetId || "").trim();
    const rosterCafeConfigOk = rosterCafeSource === "csv"
        ? (!!rosterCafeCsvPath && rosterCsvExists !== false)
        : (
            !!rosterCafeClubId
            && rosterCrawlerRepoExists !== false
            && rosterCrawlerPythonExists !== false
            && rosterCrawlerSettingsExists !== false
        );
    const rosterConfigIncomplete = !rosterSpreadsheetId || !rosterCafeConfigOk;
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
        setAdmins(null);
        setAdminsLoading(false);
        setAdminsError(null);
        setAdminsRefreshing(false);
        setAdminsRefreshMsg(null);
        setAdminsRefreshErr(null);
    }, [room.roomId]);

    const avatarUrl = `${realtimeBase}/avatar/${room.roomId}?v=${avatarVersion}&t=${Math.floor(Date.now() / 300000)}`;

    const reloadAdmins = async (): Promise<void> => {
        setAdminsLoading(true);
        setAdminsError(null);
        try {
            const r = await fetch(`/api/rooms/${encodeURIComponent(room.roomId)}/admins`, { cache: 'no-store' });
            const j = await r.json().catch(() => null) as any;
            if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.detail || j?.error || `HTTP ${r.status}`));
            setAdmins(j as RoomAdminsResponse);
        } catch (e: any) {
            setAdmins(null);
            setAdminsError(String(e?.message || e));
        } finally {
            setAdminsLoading(false);
        }
    };

    const triggerAdminsRefresh = async (): Promise<void> => {
        setAdminsRefreshMsg(null);
        setAdminsRefreshErr(null);
        setAdminsError(null);
        setAdminsRefreshing(true);
        try {
            const r = await fetch(`/api/rooms/${encodeURIComponent(room.roomId)}/admins/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}),
                cache: 'no-store',
            });
            const j = await r.json().catch(() => null) as any;
            if (!r.ok || !j || j.ok !== true) throw new Error(String(j?.detail || j?.error || `HTTP ${r.status}`));
            setAdminsRefreshMsg('Redroid에서 멤버 목록 로딩(스크롤) 시작. 1~2분 후 새로고침하세요.');
            // best-effort auto-reload
            setTimeout(() => { void reloadAdmins(); }, 15_000);
        } catch (e: any) {
            setAdminsRefreshErr(String(e?.message || e));
        } finally {
            setAdminsRefreshing(false);
        }
    };

    useEffect(() => {
        // commands(등록/수정/삭제) 권한 판단에 필요하므로, 해당 기능이 켜진 방은 운영진 정보를 자동 로드한다.
        if (!(features.commands || membersOpen)) return;
        if (admins || adminsLoading) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    await reloadAdmins();
                } finally {
                    // cancelled flag is handled by state resets on room change
                    if (cancelled) return;
                }
            })();
        }, 200);
        return () => {
            cancelled = true;
            try { clearTimeout(timer); } catch { }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [room.roomId, features.commands, membersOpen]);

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

    const hostCount = Array.isArray(admins?.host) ? admins!.host!.length : 0;
    const subhostCount = Array.isArray(admins?.subhosts) ? admins!.subhosts!.length : 0;
    const loadedCnt = typeof admins?.loadedMembersCount === 'number' ? admins!.loadedMembersCount! : null;
    const needAdminsRefresh =
        !admins ||
        admins.ok !== true ||
        (typeof loadedCnt === 'number' && loadedCnt <= 0) ||
        (hostCount + subhostCount) <= 0;

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
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.35 }}>
                        <span style={{ color: 'var(--text-muted)' }}>운영진</span>{' '}
                        {adminsLoading ? (
                            <span>조회 중…</span>
                        ) : admins && admins.ok ? (
                            <span>
                                방장 {hostCount}명 / 부방장 {subhostCount}명
                                {Array.isArray(admins.host) && admins.host.length > 0 && (
                                    <span style={{ color: 'var(--text-muted)' }}>
                                        {' '}· 방장 {String(admins.host[0]?.nickname || admins.host[0]?.userId || '').trim()}
                                    </span>
                                )}
                            </span>
                        ) : (
                            <span style={{ color: 'var(--text-muted)' }}>미확인</span>
                        )}
                        <span style={{ marginLeft: 8, display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                                className="btn-outline"
                                style={{ padding: '2px 8px', fontSize: 11 }}
                                disabled={adminsLoading || adminsRefreshing}
                                onClick={() => { void reloadAdmins(); }}
                                title="운영진(방장/부방장) 정보 새로고침"
                            >
                                새로고침
                            </button>
                            {needAdminsRefresh && (
                                <button
                                    className="btn-outline"
                                    style={{ padding: '2px 8px', fontSize: 11 }}
                                    disabled={adminsRefreshing}
                                    onClick={() => { void triggerAdminsRefresh(); }}
                                    title="Redroid(단말)에서 방에 들어가 멤버 목록을 스크롤해 IRIS open_chat_member DB를 채웁니다 (발신 없음)"
                                >
                                    갱신
                                </button>
                            )}
                        </span>
                        {(admins?.hint || adminsError || adminsRefreshMsg || adminsRefreshErr) && (
                            <div style={{ marginTop: 6 }}>
                                {admins?.hint && <div style={{ color: 'var(--text-muted)' }}>{admins.hint}</div>}
                                {adminsError && <div style={{ color: 'var(--error)' }}>운영진 조회 실패: <code>{adminsError}</code></div>}
                                {adminsRefreshMsg && <div style={{ color: 'var(--text-muted)' }}>{adminsRefreshMsg}</div>}
                                {adminsRefreshErr && <div style={{ color: 'var(--error)' }}>갱신 실패: <code>{adminsRefreshErr}</code></div>}
                            </div>
                        )}
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
                        <label className="control-label" title="카카오 기본 닉네임 사용자에게 '닉네임 변경'을 멘션으로 안내합니다. 발동 전 Redroid에서 멤버 목록 스크롤 로딩을 수행합니다.">
                            <input
                                type="checkbox"
                                checked={!!features.nicknameReminder}
                                onChange={e => onToggleFeature(room.roomId, 'nicknameReminder', e.target.checked)}
                            />
                            기본닉 멘션
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
                        <label className="control-label" title="Gemini 웹 기반 이미지 생성/수정 기능을 켭니다. (명령: !사진 / !사진수정)">
                            <input
                                type="checkbox"
                                checked={!!features.imageGen}
                                onChange={e => onToggleFeature(room.roomId, 'imageGen', e.target.checked)}
                            />
                            이미지 생성(!사진 / !사진수정)
                        </label>
                        <label className="control-label" title="Gemini 웹 기반 동영상 생성 기능을 켭니다. (명령: !영상)">
                            <input
                                type="checkbox"
                                checked={!!features.videoGen}
                                onChange={e => onToggleFeature(room.roomId, 'videoGen', e.target.checked)}
                            />
                            영상 생성(!영상)
                        </label>
                        <label className="control-label">
                            <input
                                type="checkbox"
                                checked={!!features.chatSummary}
                                onChange={e => onToggleFeature(room.roomId, 'chatSummary', e.target.checked)}
                            />
                            채팅 요약(!채팅요약 / !요약, 예: !요약 24시간)
                        </label>
                        <label className="control-label" title="방별 FAQ/안내 문구를 !키 형태로 등록/응답합니다. (예: !등록 구글 2차인증)">
                            <input
                                type="checkbox"
                                checked={!!features.commands}
                                onChange={e => onToggleFeature(room.roomId, 'commands', e.target.checked)}
                            />
                            명령어(FAQ)
                        </label>
                        <label className="control-label" title="명령어 없이 질문을 감지해 자동 응답(Reply)합니다. (승인된 트리거만)">
                            <input
                                type="checkbox"
                                checked={!!features.autoFaq}
                                onChange={e => onToggleFeature(room.roomId, 'autoFaq', e.target.checked)}
                            />
                            자동 FAQ(무명령어)
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
                                        onUpdateCourseRosterConfig?.(room.roomId, { enabled: true, rosterSheetName: rosterDefaultSheetName });
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
                                {rosterCafeSource === "csv" ? (
                                    <span className="tag tag-excluded" title="카페 CSV 경로 존재 여부(로컬, 레거시)">
                                        CSV {rosterCafeCsvPath
                                            ? (rosterCsvExists === true ? 'OK' : (rosterCsvExists === false ? '없음' : '확인필요'))
                                            : '미설정'}
                                    </span>
                                ) : (
                                    <>
                                        <span className="tag tag-excluded" title="카페 clubId 설정 여부(크롤러 모드)">
                                            clubId {rosterCafeClubId ? 'OK' : '미설정'}
                                        </span>
                                        <span className="tag tag-excluded" title="naver-cafe-member-crawler 경로(레포/venv/settings)">
                                            크롤러 {(rosterCrawlerRepoExists === true && rosterCrawlerPythonExists === true && rosterCrawlerSettingsExists !== false)
                                                ? 'OK'
                                                : ((rosterCrawlerRepoExists === false || rosterCrawlerPythonExists === false || rosterCrawlerSettingsExists === false) ? '없음' : '확인필요')}
                                        </span>
                                    </>
                                )}
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
                                         placeholder={`시트 탭 이름 (빈칸이면: ${rosterDefaultSheetName})`}
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
                                <select
                                    className="filter-input"
                                    value={rosterCafeSource}
                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { cafeSource: (e.target.value === "csv" ? "csv" : "crawler") })}
                                    title="카페 데이터 소스 선택"
                                >
                                    <option value="crawler">카페 소스: 크롤러(권장, CSV 불필요)</option>
                                    <option value="csv">카페 소스: CSV(레거시)</option>
                                </select>
                                {rosterCafeSource === "crawler" ? (
                                    <>
                                        <input
                                            className="filter-input"
                                            value={rosterCafeUrl}
                                            placeholder="카페 URL (clubId 자동 추출용, 예: https://cafe.naver.com/ManageWholeMember.nhn?clubid=30819883)"
                                            onChange={(e) => {
                                                const cafeUrl = e.target.value;
                                                const extracted = extractNaverCafeClubId(cafeUrl);
                                                const patch: Partial<CourseRosterRoomConfig> = { cafeUrl };
                                                if (extracted && extracted !== rosterCafeClubId) patch.cafeClubId = extracted;
                                                onUpdateCourseRosterConfig?.(room.roomId, patch);
                                            }}
                                        />
                                        <input
                                            className="filter-input"
                                            value={rosterCafeClubId}
                                            placeholder="카페 clubId (예: 30819883)"
                                            onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { cafeClubId: e.target.value })}
                                        />
                                        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>
                                            로그인(ID/PW)은 이 UI에서 입력하지 않습니다.
                                            <br />
                                            <code>naver-cafe-member-crawler</code>의 <code>settings.json</code>(<code>account.naver_id</code>/<code>account.naver_pw</code>)을 사용합니다.
                                            <br />
                                            <code>settingsPath</code>를 비우면 <code>%LOCALAPPDATA%\\NaverCafeMemberCrawler\\config\\settings.json</code> → <code>&lt;crawlerRepoPath&gt;\\config\\settings.json</code> 순서로 자동 탐색합니다.
                                        </div>
                                        <details style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                                            <summary style={{ cursor: 'pointer' }}>크롤러 고급 설정(보통은 비워도 됨)</summary>
                                            <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
                                                <input
                                                    className="filter-input"
                                                    value={rosterCrawlerRepoPath}
                                                    placeholder="크롤러 레포 경로 (기본: C:\\dev\\naver-cafe-member-crawler)"
                                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { crawlerRepoPath: e.target.value })}
                                                />
                                                <input
                                                    className="filter-input"
                                                    value={rosterCrawlerPythonExe}
                                                    placeholder="크롤러 python.exe 경로 (예: ...\\venv\\Scripts\\python.exe)"
                                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { crawlerPythonExe: e.target.value })}
                                                />
                                                <input
                                                    className="filter-input"
                                                    value={rosterCrawlerSettingsPath}
                                                    placeholder="settings.json 경로(선택, 비우면 자동 탐색)"
                                                    onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { crawlerSettingsPath: e.target.value })}
                                                />
                                            </div>
                                        </details>
                                    </>
                                ) : (
                                    <input
                                        className="filter-input"
                                        value={rosterCafeCsvPath}
                                        placeholder="카페 멤버 CSV 경로 (레거시)"
                                        onChange={(e) => onUpdateCourseRosterConfig?.(room.roomId, { cafeCsvPath: e.target.value })}
                                    />
                                )}
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
                        />
                        <input
                            value={openchatSheetsSheetName}
                            onChange={(e) => onUpdateOpenchatMembersSheetsConfig?.(room.roomId, { sheetName: e.target.value })}
                            placeholder="시트 탭(빈칸=기본값, 최종 fallback: members)"
                            className="filter-input"
                            style={{ width: 200, height: 34, marginBottom: 0 }}
                        />
                        <span className="tag tag-excluded" title="스케줄링 ON 시 고정: 매 10분 업서트">
                            주기 10분(고정)
                        </span>
                        <label className="control-label" title="권장하지 않음: loadedMembersCount < activeMembersCount이어도 강제 업서트">
                            <input
                                type="checkbox"
                                checked={openchatSheetsAllowIncomplete}
                                onChange={(e) => onUpdateOpenchatMembersSheetsConfig?.(room.roomId, { allowIncomplete: e.target.checked })}
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
