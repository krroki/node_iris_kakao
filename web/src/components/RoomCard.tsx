import React from 'react';
import { LogEntry, RoomInfo, RoomFeatures } from '../types';
import LogViewer from './LogViewer';

interface RoomCardProps {
    room: RoomInfo;
    logs: LogEntry[];
    features: RoomFeatures;
    excluded: boolean;
    saving: "idle" | "saving" | "saved" | "error";
    onToggleFeature: (roomId: string, feature: keyof RoomFeatures, value: boolean) => void;
    onSave: (roomId: string) => void;
    onExclude: (roomId: string, value: boolean) => void;
    onUploadAvatar: (roomId: string, file: File) => void;
    realtimeBase: string;
}

export default function RoomCard({
    room,
    logs,
    features,
    excluded,
    saving,
    onToggleFeature,
    onSave,
    onExclude,
    onUploadAvatar,
    realtimeBase
}: RoomCardProps) {

    const isActive = !!(features.welcome || features.broadcast || features.schedules || features.ai);

    return (
        <div className="room-card" data-testid={`room-card-${room.roomId}`}>
            <div className="room-header">
                <div style={{ position: 'relative' }}>
                    <img
                        src={`${realtimeBase}/avatar/${room.roomId}?t=${Date.now()}`}
                        onError={(e: any) => { e.currentTarget.style.display = 'none'; }}
                        alt="avatar"
                        className="room-avatar"
                    />
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
                            if (navigator?.clipboard?.writeText) {
                                navigator.clipboard.writeText(room.roomId).catch(() => { });
                            }
                        }}
                    >
                        ID {room.roomId}
                    </div>
                    <div className="room-tags">
                        {isActive ? (
                            <span className="tag tag-active">활성</span>
                        ) : (
                            <span className="tag tag-inactive">비활성</span>
                        )}
                        {excluded && <span className="tag tag-excluded">제외</span>}
                    </div>
                </div>
            </div>

            <LogViewer logs={logs} height={160} id={`room-log-${room.roomId}`} />

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

