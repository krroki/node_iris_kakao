import React, { useEffect, useRef } from 'react';
import { LogEntry } from '../types';

interface LogViewerProps {
    logs: LogEntry[];
    height?: number;
    id?: string;
    showRoomName?: boolean;
}

export default function LogViewer({ logs, height = 200, id, showRoomName = false }: LogViewerProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const initScrolled = useRef(false);

    const formatTs = (ts: string) => {
        try {
            const d = new Date(ts);
            if (isNaN(d.getTime())) return ts || "";
            return d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
        } catch {
            return ts || "";
        }
    };

    const stripMentionFromText = (text: string | undefined, mentions?: string[]): string => {
        if (!text) return "";
        let out = text;
        if (Array.isArray(mentions) && mentions.length) {
            for (const m of mentions) {
                const name = String(m || '').trim();
                if (!name) continue;
                const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                out = out.replace(new RegExp(`@${esc}(\\s*)`, 'g'), '$1');
            }
        }
        return out.replace(/\s{2,}/g, ' ').trim();
    };

    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;

        const atBottom = el.scrollHeight - el.clientHeight - el.scrollTop < 50;

        if (!initScrolled.current || atBottom) {
            if (logs.length > 0) {
                el.scrollTop = el.scrollHeight;
                initScrolled.current = true;
            }
        }
    }, [logs]);

    return (
        <div
            id={id}
            ref={scrollRef}
            className="log-box"
            style={{ height }}
        >
            {logs.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '20px' }}>
                    표시할 메시지가 없습니다
                </div>
            ) : (
                logs.map((e, i) => (
                    <div key={(e.mid || '') + i} className="log-entry">
                        <span className="log-ts">[{formatTs(e.ts)}]</span>
                        {showRoomName && <span style={{ color: '#94a3b8', marginRight: 6 }}>({e.roomName})</span>}
                        <span className="log-sender">{e.sender}:</span>
                        {Array.isArray(e.mentions) && e.mentions.length > 0 && (
                            <span>
                                {e.mentions.map((m, idx) => (
                                    <span key={m + idx} className="log-mention">@{m}</span>
                                ))}
                            </span>
                        )}
                        <span>{stripMentionFromText(e.text || '', e.mentions)}</span>
                    </div>
                ))
            )}
        </div>
    );
}
