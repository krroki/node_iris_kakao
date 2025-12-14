"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import '../dashboard.css';

const REALTIME_BASE = process.env.NEXT_PUBLIC_REALTIME_BASE || "http://127.0.0.1:8650";

const cats = [
    { key: "welcome", name: "환영" },
    { key: "broadcast", name: "브로드캐스트" },
    { key: "schedule", name: "스케줄" },
];

interface Template {
    title: string;
    content: string;
    category: string;
    images: string[];
    mentions: string[];
    name?: string;
}

const KakaoPreview = ({ content, images, mentions }: { content: string, images: string[], mentions: string[] }) => {
    const imgs = images || [];
    const ments = (mentions || []).map(s => String(s || '').trim()).filter(Boolean);
    const mentionLine = ments.length ? ments.map(m => `@${m}`).join(', ') : '';
    return (
        <div style={{ background: '#b2c7d9', padding: 16, borderRadius: 12, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif' }}>
            <div style={{ width: '100%', maxWidth: 320, margin: '0 auto', boxSizing: 'border-box' }}>
                <div style={{ textAlign: 'center', color: '#555', fontSize: 12, marginBottom: 10 }}>카카오톡 (미리보기)</div>
                {/* 텍스트 말풍선 (있을 때만) */}
                {(mentionLine || (content || '').trim()) && (
                    <div style={{ width: '100%', maxWidth: 260, background: '#fff', color: '#333', padding: '10px 12px', borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.08)', wordBreak: 'break-word', whiteSpace: 'pre-wrap', marginBottom: 8 }}>
                        {mentionLine && <div style={{ color: '#2563eb', marginBottom: 6, fontWeight: 700 }}>{mentionLine}</div>}
                        <div style={{ fontSize: 14, lineHeight: 1.5 }}>{content}</div>
                    </div>
                )}
                {/* 이미지 말풍선: 이미지마다 별도 버블 */}
                {imgs.map((u, i) => (
                    <div key={i} style={{ width: '100%', maxWidth: 260, background: '#fff', color: '#333', padding: 0, borderRadius: 8, boxShadow: '0 1px 2px rgba(0,0,0,0.08)', overflow: 'hidden', marginBottom: 8 }}>
                                        <img src={u?.startsWith('http') ? u : `/api/templates/${u}`} style={{ display: 'block', maxWidth: '100%' }} alt="preview" />
                    </div>
                ))}
                <div style={{ textAlign: 'right', color: '#555', fontSize: 11, marginTop: 6 }}>오후 5:09</div>
            </div>
        </div>
    );
};

export default function TemplatesPage() {
    const [category, setCategory] = useState('welcome');
    const [list, setList] = useState<any[]>([]);
    const [name, setName] = useState('');
    const [tpl, setTpl] = useState<Template>({ title: '', content: '', category: 'welcome', images: [], mentions: [] });
    const [label, setLabel] = useState('');
    type Preview = { content: string; mentions: string[]; images: string[] };
    const [preview, setPreview] = useState<Preview>({ content: '', mentions: [], images: [] });
    const [query, setQuery] = useState('');
    const [isCompact, setIsCompact] = useState(false);

    const filtered = useMemo(
        () => list.filter(x => x.category === category && (((x.title || '').includes(query)) || x.name.includes(query))),
        [list, category, query]
    );

    const countsByCat = useMemo(() => {
        const m: Record<string, number> = {};
        for (const c of cats) m[c.key] = 0;
        for (const it of list) {
            if (!it?.category) continue;
            if (m[it.category] !== undefined) m[it.category] += 1;
        }
        return m;
    }, [list]);

    const loadList = async () => {
        try {
            const r = await fetch(`/api/templates`);
            setList(await r.json());
        } catch { }
    };
    useEffect(() => { loadList(); }, []);
    useEffect(() => {
        const handler = () => {
            if (typeof window === "undefined") return;
            setIsCompact(window.innerWidth < 1100);
        };
        handler();
        window.addEventListener("resize", handler);
        return () => window.removeEventListener("resize", handler);
    }, []);

    const loadTemplate = async (cat: string, nm: string) => {
        setName(nm);
        try {
            const r = await fetch(`/api/templates/${cat}/${nm}`);
            if (r.ok) {
                const data = await r.json();
                setTpl(data);
                setLabel(data.title || nm);
            } else {
                setLabel(nm);
            }
        } catch { }
    };

    const persistTemplate = async (refreshList = true) => {
        if (!name) return false;
        try {
            const r = await fetch(`/api/templates/${category}/${name}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tpl)
            });
            if (r.ok) {
                if (refreshList) await loadList();
                return true;
            }
        } catch { }
        return false;
    };

    const saveTemplate = async () => {
        await persistTemplate(true);
    };

    const deleteTemplate = async () => {
        if (!name) return;
        if (!confirm('정말 삭제하시겠습니까?')) return;
        await fetch(`/api/templates/${category}/${name}`, { method: 'DELETE' });
        setName(''); setLabel(''); setTpl({ title: '', content: '', category, images: [], mentions: [] });
        await loadList();
    };

    const createNew = () => {
        const nm = `template_${Math.random().toString(16).slice(2, 8)}`;
        setName(nm);
        setLabel(nm);
        setTpl({ title: nm, content: '', category, images: [], mentions: [] });
    };

    const contentRef = useRef<HTMLTextAreaElement>(null);
    const handleTemplateNameChange = (value: string) => {
        setLabel(value);
        setName(value);
        setTpl(prev => ({ ...prev, title: value }));
    };
    const insertVar = (v: string) => {
        const ta = contentRef.current;
        const current = tpl.content || '';
        if (!ta || typeof ta.selectionStart !== 'number') {
            setTpl(prev => ({ ...prev, content: current + v }));
            return;
        }
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const next = current.slice(0, start) + v + current.slice(end);
        setTpl(prev => ({ ...prev, content: next }));
        requestAnimationFrame(() => {
            try { ta.focus(); ta.setSelectionRange(start + v.length, start + v.length); } catch { }
        });
    };

    const onUpload = async (files: FileList | null) => {
        if (!files || !name) return;
        const saved = await persistTemplate(false);
        if (!saved) {
            alert('먼저 템플릿을 저장한 뒤 이미지를 업로드해 주세요.');
            return;
        }
        for (const f of Array.from(files)) {
            const fd = new FormData(); fd.append('file', f);
            try {
                const r = await fetch(`/api/templates/${category}/${name}/image`, { method: 'POST', body: fd });
                if (r.ok) {
                    const data = await r.json();
                    const p = data?.path;
                    if (p) {
                        setTpl(prev => ({ ...prev, images: [...(prev.images || []), p] }));
                    }
                }
            } catch { }
        }
        await loadTemplate(category, name);
    };

    const serverPreview = async () => {
        if (!name) {
            setPreview({ content: tpl.content || '', mentions: (tpl.mentions || []) as string[], images: (tpl.images || []) as string[] });
            return;
        }
        // 서버 렌더에 실패하면 현재 작성 중인 값을 바로 사용
        setPreview({ content: tpl.content || '', mentions: (tpl.mentions || []) as string[], images: (tpl.images || []) as string[] });
    };

    return (
        <div className="dashboard-container">
            <div className="header-section">
                <div>
                    <h1 className="main-title">템플릿 관리</h1>
                    <p className="sub-title">환영·브로드캐스트·스케줄 템플릿을 작성하고 미리보기로 검증하세요.</p>
                </div>
                <button onClick={createNew} className="btn-copy">새 템플릿</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isCompact ? '1fr' : '320px minmax(0,1fr)', gap: 24 }}>
                <aside className="pipeline-card" style={{ padding: 16, height: 'fit-content', marginBottom: 0 }}>
                    <div style={{ marginBottom: 16 }}>
                        <label className="filter-label">카테고리</label>
                        <select
                            value={category}
                            onChange={e => { setCategory(e.target.value); setName(''); setLabel(''); }}
                            className="filter-select"
                            style={{ width: '100%', marginTop: 6 }}
                        >
                            {cats.map(c => (
                                <option key={c.key} value={c.key}>
                                    {c.name} ({countsByCat[c.key] ?? 0}개)
                                </option>
                            ))}
                        </select>
                    </div>
                    <div style={{ marginBottom: 16 }}>
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="템플릿 검색"
                            className="filter-input"
                            style={{ width: '100%' }}
                        />
                    </div>
                    <div style={{ maxHeight: 520, overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 10 }}>
                        {filtered.map(it => {
                            const active = name === it.name && category === it.category;
                            return (
                                <div
                                    key={it.category + it.name}
                                    style={{
                                        padding: '10px 12px',
                                        borderBottom: '1px solid var(--border-color)',
                                        cursor: 'pointer',
                                        background: active ? 'var(--bg-card-hover)' : 'transparent',
                                        transition: 'background 0.2s'
                                    }}
                                    onClick={() => loadTemplate(it.category, it.name)}
                                >
                                    <div style={{ fontWeight: 700, fontSize: 13, color: 'var(--text-primary)' }}>{it.title || it.name}</div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: 12 }}>{it.name}</div>
                                </div>
                            );
                        })}
                        {filtered.length === 0 && <div style={{ padding: 16, color: 'var(--text-muted)', textAlign: 'center' }}>해당 카테고리에 템플릿이 없습니다.</div>}
                    </div>
                </aside>

                <section className="pipeline-card" style={{ marginBottom: 0 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isCompact ? '1fr' : 'minmax(0,1fr) minmax(320px, 380px)', gap: 20 }}>
                        <div>
                            <div style={{ marginBottom: 16 }}>
                                <label className="filter-label">템플릿 이름</label>
                                <input
                                    value={label}
                                    onChange={e => handleTemplateNameChange(e.target.value)}
                                    placeholder="예: 환영 메시지 A안"
                                    className="filter-input"
                                    style={{ width: '100%', marginTop: 6 }}
                                />
                                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>템플릿 이름은 서버 저장 및 대시보드 표시용으로 동일하게 사용됩니다.</div>
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label className="filter-label">내용</label>
                                <textarea
                                    ref={contentRef}
                                    rows={12}
                                    value={tpl.content}
                                    onChange={e => setTpl(prev => ({ ...prev, content: e.target.value }))}
                                    className="filter-input"
                                    style={{ width: '100%', marginTop: 6, fontFamily: 'inherit', lineHeight: 1.5 }}
                                />
                                <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {['@{entrant}', '@{entrance}', '@{entrance1}', '{entrance}', '{{entrance}}', '{entrance1}', '{{entrance1}}', '{entrance2}', '{{entrance2}}', '{{userName}}', '{{roomName}}', '{{time}}', '{{date}}', '{{memberCount}}'].map((v, i) => (
                                        <button
                                            key={i}
                                            onClick={() => insertVar(v)}
                                            className="btn-outline"
                                            style={{ padding: '4px 8px', fontSize: 12 }}
                                        >
                                            {v}
                                        </button>
                                    ))}
                                </div>
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button onClick={serverPreview} disabled={!name && !tpl.content} className="btn-copy">미리보기 업데이트</button>
                                    <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>현재 작성 내용 기준 간단 미리보기</span>
                                </div>
                            </div>
                            <div style={{ marginBottom: 16 }}>
                                <label className="filter-label">이미지 첨부</label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={e => onUpload(e.target.files)}
                                    className="filter-input"
                                    style={{ width: '100%', marginTop: 6 }}
                                />
                                <div style={{ marginTop: 10, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                    {(tpl.images || []).map((rel, idx) => {
                                        let url = rel;
                                        if (rel?.startsWith('assets/')) {
                                            const parts = rel.split('/');
                                            if (parts.length === 4) {
                                                url = `assets/${parts[1]}/${parts[2]}/${parts[3]}`;
                                            }
                                        }
                                        return (<img key={idx} src={`${REALTIME_BASE}/templates/${url}`} style={{ width: 88, height: 88, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-color)' }} alt="attachment" />);
                                    })}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: 10 }}>
                                <button onClick={saveTemplate} className="btn-copy">저장</button>
                                <button
                                    onClick={deleteTemplate}
                                    className="btn-outline"
                                    style={{ color: 'var(--error)', borderColor: 'var(--error)' }}
                                    disabled={!name}
                                >
                                    삭제
                                </button>
                            </div>
                        </div>
                        <div style={{ background: 'var(--bg-main)', border: '1px solid var(--border-color)', borderRadius: 12, padding: 16, minWidth: 0, overflow: 'hidden' }}>
                            <h3 style={{ marginTop: 0, fontSize: 16, color: 'var(--text-primary)', marginBottom: 12 }}>카카오톡 미리보기</h3>
                            <div style={{ display: 'flex', justifyContent: 'center' }}>
                                <div style={{ width: '100%', maxWidth: 360, padding: 8, boxSizing: 'border-box' }}>
                                    <KakaoPreview
                                        content={preview.content || (tpl.content || '')}
                                        images={(preview.images && preview.images.length ? preview.images : (tpl.images || [])).map(rel => rel.startsWith('http') ? rel : `${REALTIME_BASE}/templates/${rel}`)}
                                        mentions={preview.mentions?.length ? preview.mentions : (tpl.mentions || [])}
                                    />
                                </div>
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', marginTop: 12 }}>서버 렌더 결과가 우선 적용되며, 없을 경우 현재 작성 중인 내용을 사용합니다.</div>
                        </div>
                    </div>
                    <div style={{ marginTop: 16, fontSize: 13, color: 'var(--text-muted)' }}><b>SAFE_MODE</b>: 발신 기능은 노출되지 않으며, 템플릿 저장은 서버 파일에 즉시 반영됩니다.</div>
                </section>
            </div>
        </div>
    );
}
