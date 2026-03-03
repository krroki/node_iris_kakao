"use client";
import React, { useEffect, useMemo, useState } from "react";
import "../dashboard.css";

const cats = [
  { key: "welcome", name: "Welcome (입장/초대)" },
  { key: "broadcast", name: "Broadcast" },
  { key: "schedule", name: "Schedule" },
] as const;

type CatKey = (typeof cats)[number]["key"];
type WelcomeTemplatePick = "random" | "hash_sender_id" | "hash_user_name";

function normalizeLines(raw: string): string[] {
  const lines = String(raw || "")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of lines) {
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function joinLines(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((x) => String(x ?? "")).join("\n");
}

function normalizeStringArray(value: unknown): string[] {
  const arr = Array.isArray(value) ? value : [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function pushUnique(list: string[], value: string): string[] {
  const v = String(value || "").trim();
  if (!v) return list;
  if (list.includes(v)) return list;
  return [...list, v];
}

const KakaoPreview = ({ content, images, mentions }: { content: string; images: string[]; mentions: string[] }) => {
  const imgs = images || [];
  const ments = (mentions || []).map((s) => String(s || "").trim()).filter(Boolean);
  const mentionLine = ments.length ? ments.map((m) => `@${m}`).join(", ") : "";
  return (
    <div
      style={{
        background: "#b2c7d9",
        padding: 16,
        borderRadius: 12,
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
      }}
    >
      <div style={{ width: "100%", maxWidth: 320, margin: "0 auto", boxSizing: "border-box" }}>
        <div style={{ textAlign: "center", color: "#555", fontSize: 12, marginBottom: 10 }}>카카오톡 (미리보기)</div>
        {(mentionLine || (content || "").trim()) && (
          <div
            style={{
              width: "100%",
              maxWidth: 260,
              background: "#fff",
              color: "#333",
              padding: "10px 12px",
              borderRadius: 8,
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              wordBreak: "break-word",
              whiteSpace: "pre-wrap",
              marginBottom: 8,
            }}
          >
            {mentionLine && <div style={{ color: "#2563eb", marginBottom: 6, fontWeight: 700 }}>{mentionLine}</div>}
            <div style={{ fontSize: 14, lineHeight: 1.5 }}>{content}</div>
          </div>
        )}
        {imgs.map((u, i) => (
          <div
            key={i}
            style={{
              width: "100%",
              maxWidth: 260,
              background: "#fff",
              color: "#333",
              padding: 0,
              borderRadius: 8,
              boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
              overflow: "hidden",
              marginBottom: 8,
            }}
          >
            <img src={u?.startsWith("http") ? u : `/api/templates/${u}`} style={{ display: "block", maxWidth: "100%" }} alt="preview" />
          </div>
        ))}
        <div style={{ textAlign: "right", color: "#555", fontSize: 11, marginTop: 6 }}>오후 5:09</div>
      </div>
    </div>
  );
};

export default function FeatureSettingsPage() {
  const [list, setList] = useState<any[]>([]);
  const [runtime, setRuntime] = useState<any>({
    safeMode: true,
    features: {},
    excludedRoomIds: [],
    templateByFeature: {},
  });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [talkEnabled, setTalkEnabled] = useState(false);
  const [talkBase, setTalkBase] = useState("https://talk-api.naijun.dev");
  const [talkAuth, setTalkAuth] = useState("");
  const [talkApplying, setTalkApplying] = useState(false);

  const [welcomeSetEnabled, setWelcomeSetEnabled] = useState(false);
  const [welcomeSetPick, setWelcomeSetPick] = useState<WelcomeTemplatePick>("random");
  const [welcomeDelayMinSec, setWelcomeDelayMinSec] = useState("3");
  const [welcomeDelayMaxSec, setWelcomeDelayMaxSec] = useState("5");
  const [welcomeRegexText, setWelcomeRegexText] = useState("");
  const [welcomeSetKakao, setWelcomeSetKakao] = useState<string[]>([]);
  const [welcomeSetCustom, setWelcomeSetCustom] = useState<string[]>([]);
  const [welcomeAddKakao, setWelcomeAddKakao] = useState("");
  const [welcomeAddCustom, setWelcomeAddCustom] = useState("");
  const [welcomeRegexOpen, setWelcomeRegexOpen] = useState(false);
  const [welcomeNickTest, setWelcomeNickTest] = useState("");
  const [welcomePreview, setWelcomePreview] = useState<{
    open: boolean;
    name: string;
    title: string;
    content: string;
    images: string[];
    mentions: string[];
  }>({
    open: false,
    name: "",
    title: "",
    content: "",
    images: [],
    mentions: [],
  });

  const optionsByCat = useMemo(() => {
    const map: Record<CatKey, any[]> = { welcome: [], broadcast: [], schedule: [] };
    for (const it of list) {
      if (!it?.category) continue;
      if (map[it.category as CatKey]) map[it.category as CatKey].push(it);
    }
    for (const k of Object.keys(map) as CatKey[]) {
      map[k].sort((a, b) => (a.title || a.name).localeCompare(b.title || b.name));
    }
    return map;
  }, [list]);

  const welcomeTplByName = useMemo(() => {
    const m = new Map<string, any>();
    for (const it of optionsByCat.welcome || []) {
      if (!it?.name) continue;
      m.set(String(it.name), it);
    }
    return m;
  }, [optionsByCat]);

  const welcomeDelayEdit = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const minSec = Number(welcomeDelayMinSec);
    const maxSec = Number(welcomeDelayMaxSec);

    if (!Number.isFinite(minSec) || minSec < 0) {
      errors.push("Welcome 딜레이(최소)는 0 이상의 숫자(초)여야 합니다.");
    }
    if (!Number.isFinite(maxSec) || maxSec < 0) {
      errors.push("Welcome 딜레이(최대)는 0 이상의 숫자(초)여야 합니다.");
    }

    const minMs = Number.isFinite(minSec) ? Math.floor(minSec * 1000) : 0;
    const maxMs = Number.isFinite(maxSec) ? Math.floor(maxSec * 1000) : 0;
    if (Number.isFinite(minSec) && Number.isFinite(maxSec) && maxMs < minMs) {
      errors.push("Welcome 딜레이(최대)는 딜레이(최소)보다 크거나 같아야 합니다.");
    }
    if (Number.isFinite(minSec) && Number.isFinite(maxSec) && maxMs < 2500) {
      warnings.push("Welcome 딜레이가 너무 짧으면 봇 티가 납니다. (권장: 3~5초)");
    }
    if (Number.isFinite(minSec) && Number.isFinite(maxSec) && maxMs > 30_000) {
      warnings.push("Welcome 딜레이가 너무 길면 운영이 불편할 수 있습니다. (권장: 3~5초)");
    }

    return { errors, warnings, minMs, maxMs };
  }, [welcomeDelayMinSec, welcomeDelayMaxSec]);

  const welcomeEdit = useMemo(() => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const welcomeOpts = optionsByCat.welcome || [];
    const exists = (name: string) => welcomeOpts.some((it: any) => it?.name === name);

    const regexes = normalizeLines(welcomeRegexText);
    const kakaoSet = normalizeStringArray(welcomeSetKakao);
    const customSet = normalizeStringArray(welcomeSetCustom);

    if (welcomeSetEnabled) {
      if (!welcomeSetPick || !["random", "hash_sender_id", "hash_user_name"].includes(welcomeSetPick)) {
        errors.push(`welcome.templateSetPick 값이 올바르지 않습니다. (허용: random | hash_sender_id | hash_user_name)`);
      }

      if (regexes.length === 0) {
        errors.push(`welcome.kakaoDefaultNicknameRegexes 는 1개 이상 필요합니다.`);
      } else {
        for (let i = 0; i < regexes.length; i += 1) {
          const rx = regexes[i]!;
          try {
            // eslint-disable-next-line no-new
            new RegExp(rx, "u");
          } catch (e: any) {
            errors.push(`정규식 컴파일 실패 (라인 ${i + 1}): ${rx} (${String(e?.message || e)})`);
          }
        }
      }

      if (kakaoSet.length === 0) errors.push(`templateSets.kakaoDefaultNickname 은 1개 이상 필요합니다.`);
      if (customSet.length === 0) errors.push(`templateSets.customNickname 은 1개 이상 필요합니다.`);

      for (const nm of kakaoSet) {
        if (!exists(nm)) errors.push(`CASE1(기본닉) 템플릿 '${nm}' 이(가) welcome 템플릿 목록에 없습니다.`);
      }
      for (const nm of customSet) {
        if (!exists(nm)) errors.push(`CASE2(커스텀닉) 템플릿 '${nm}' 이(가) welcome 템플릿 목록에 없습니다.`);
      }

      if (kakaoSet.length > 0 && kakaoSet.length < 5) warnings.push(`CASE1(기본닉) 템플릿이 ${kakaoSet.length}개입니다. (권장: 5개 이상)`);
      if (customSet.length > 0 && customSet.length < 5) warnings.push(`CASE2(커스텀닉) 템플릿이 ${customSet.length}개입니다. (권장: 5개 이상)`);
    }

    return { errors, warnings, regexes, kakaoSet, customSet };
  }, [optionsByCat, welcomeRegexText, welcomeSetKakao, welcomeSetCustom, welcomeSetEnabled, welcomeSetPick]);

  const missingTemplateWarnings = useMemo(() => {
    const warnings: string[] = [];
    const tbf = (runtime && runtime.templateByFeature) || {};
    for (const c of cats) {
      if (c.key === "welcome" && welcomeSetEnabled) continue;
      const selected = (tbf as any)[c.key];
      if (!selected) continue;
      const opts = optionsByCat[c.key] || [];
      const exists = opts.some((it: any) => it.name === selected);
      if (!exists) {
        warnings.push(`${c.name}: runtime.json에는 '${selected}'가 설정되어 있으나 템플릿 목록에는 없습니다.`);
      }
    }
    return warnings;
  }, [runtime, optionsByCat, welcomeSetEnabled]);

  const welcomeSetWarnings = useMemo(() => {
    const warnings: string[] = [];
    const w = (runtime && (runtime as any).welcome) || {};
    const sets = w && w.templateSets;
    if (!sets) return warnings;

    const welcomeOpts = optionsByCat.welcome || [];
    const exists = (name: string) => welcomeOpts.some((it: any) => it?.name === name);

    const pick = w.templateSetPick;
    if (!pick || (pick !== "random" && pick !== "hash_sender_id" && pick !== "hash_user_name")) {
      warnings.push(`Welcome 세트: runtime.json.welcome.templateSetPick이 비었거나 잘못되었습니다. (허용: random | hash_sender_id | hash_user_name)`);
    }

    const regexes = w.kakaoDefaultNicknameRegexes;
    if (!Array.isArray(regexes) || regexes.length === 0) {
      warnings.push(`Welcome 세트: runtime.json.welcome.kakaoDefaultNicknameRegexes가 비어 있습니다.`);
    }

    const checkList = (key: string) => {
      const arr = sets[key];
      if (!Array.isArray(arr) || arr.length === 0) {
        warnings.push(`Welcome 세트: runtime.json.welcome.templateSets.${key}가 비어 있습니다.`);
        return;
      }
      for (const v of arr) {
        const nm = String(v || "").trim();
        if (!nm) {
          warnings.push(`Welcome 세트: runtime.json.welcome.templateSets.${key}에 빈 항목이 있습니다.`);
          continue;
        }
        if (!exists(nm)) {
          warnings.push(`Welcome 세트: '${nm}' 템플릿이 welcome 목록에 없습니다. (templateSets.${key})`);
        }
      }
    };

    checkList("kakaoDefaultNickname");
    checkList("customNickname");
    return warnings;
  }, [runtime, optionsByCat]);

  const welcomeNickTestResult = useMemo(() => {
    if (!welcomeSetEnabled) return null;
    const name = String(welcomeNickTest || "").trim();
    if (!name) return null;
    const regexes = normalizeLines(welcomeRegexText);
    if (!regexes.length) return { ok: false, kind: "unknown", matched: "" };

    for (const rx of regexes) {
      try {
        const re = new RegExp(rx, "u");
        if (re.test(name)) return { ok: true, kind: "기본닉", matched: rx };
      } catch {
        // invalid regex는 welcomeEdit에서 차단됨
      }
    }
    return { ok: true, kind: "커스텀닉", matched: "" };
  }, [welcomeSetEnabled, welcomeNickTest, welcomeRegexText]);

  const welcomeSetSummary = useMemo(() => {
    const w = (runtime && (runtime as any).welcome) || {};
    const sets = w && w.templateSets;
    if (!sets) return null;

    const normalize = (arr: any): string[] => (Array.isArray(arr) ? arr.map((x: any) => String(x || "").trim()).filter(Boolean) : []);

    const pick = typeof w.templateSetPick === "string" ? w.templateSetPick : "";
    const regexes = Array.isArray(w.kakaoDefaultNicknameRegexes) ? w.kakaoDefaultNicknameRegexes.map((x: any) => String(x || "")) : [];

    const kakao = normalize(sets.kakaoDefaultNickname);
    const custom = normalize(sets.customNickname);

    const welcomeOpts = optionsByCat.welcome || [];
    const exists = (name: string) => welcomeOpts.some((it: any) => it?.name === name);

    return {
      pick,
      regexes,
      kakao: kakao.map((n) => ({ name: n, ok: exists(n) })),
      custom: custom.map((n) => ({ name: n, ok: exists(n) })),
    };
  }, [runtime, optionsByCat]);

  const load = async () => {
    setMsg("");
    try {
      const [tplsRes, rtRes] = await Promise.all([fetch(`/api/templates`), fetch(`/api/runtime`)]);
      const [tpls, rt] = await Promise.all([tplsRes.json(), rtRes.json()]);
      if (!tplsRes.ok) {
        throw new Error(`templates fetch failed: ${tplsRes.status}`);
      }
      if (!rtRes.ok || (rt && (rt as any).ok === false)) {
        const err = (rt && ((rt as any).detail || (rt as any).error)) || `runtime fetch failed: ${rtRes.status}`;
        throw new Error(String(err));
      }

      setList(Array.isArray(tpls) ? tpls : []);
      setRuntime(rt || {});
      setLoadError(null);

      const t = (rt && rt.talkApi) || {};
      setTalkEnabled(!!t.enabled);
      setTalkBase(t.baseUrl || "https://talk-api.naijun.dev");
      setTalkAuth(t.authHeader || "");

      const w = (rt && (rt as any).welcome) || {};
      const sets = w && w.templateSets;
      setWelcomeSetEnabled(Boolean(sets));

      const pick = typeof w.templateSetPick === "string" ? w.templateSetPick.trim() : "";
      if (pick === "random" || pick === "hash_sender_id" || pick === "hash_user_name") setWelcomeSetPick(pick);
      else setWelcomeSetPick("random");

      const toSec = (ms: number) => String((ms / 1000).toFixed(1)).replace(/\.0$/, "");
      const dmin = typeof w.sendDelayMinMs === "number" && Number.isFinite(w.sendDelayMinMs) ? Math.max(0, Math.floor(w.sendDelayMinMs)) : 3000;
      const dmax = typeof w.sendDelayMaxMs === "number" && Number.isFinite(w.sendDelayMaxMs) ? Math.max(0, Math.floor(w.sendDelayMaxMs)) : 5000;
      setWelcomeDelayMinSec(toSec(dmin));
      setWelcomeDelayMaxSec(toSec(dmax));

      setWelcomeRegexText(joinLines(w.kakaoDefaultNicknameRegexes));
      if (sets && typeof sets === "object") {
        setWelcomeSetKakao(normalizeStringArray((sets as any).kakaoDefaultNickname));
        setWelcomeSetCustom(normalizeStringArray((sets as any).customNickname));
      } else {
        setWelcomeSetKakao([]);
        setWelcomeSetCustom([]);
      }
      setWelcomeAddKakao("");
      setWelcomeAddCustom("");
      setWelcomeRegexOpen(false);
      setWelcomeNickTest("");
    } catch (e: any) {
      setLoadError(String(e?.message || e));
      setMsg("설정 로드 실패: " + String(e?.message || e));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const setFeatureTemplate = (feature: string, name: string) => {
    setRuntime((prev: any) => ({ ...prev, templateByFeature: { ...(prev.templateByFeature || {}), [feature]: name || "" } }));
  };

  const save = async () => {
    setSaving(true);
    setMsg("");
    try {
      const body: any = { templateByFeature: runtime.templateByFeature || {}, safeMode: !!runtime.safeMode };

      const runtimeTalkAuth = String((runtime && (runtime as any).talkApi && (runtime as any).talkApi.authHeader) || "").trim();
      const inputTalkAuth = String(talkAuth || "").trim();
      if (talkEnabled && !inputTalkAuth && !runtimeTalkAuth) {
        setMsg("저장 불가: 외부 Talk API 사용 시 Auth Header가 필요합니다. (scripts/capture_talkapi_auth_frida.py로 캡처 후 적용하거나, 아래 ‘파일에서 자동 적용’ 버튼을 사용하세요.)");
        return;
      }

      if (welcomeDelayEdit.errors.length) {
        setMsg(`저장 불가: Welcome 딜레이 설정 오류 ${welcomeDelayEdit.errors.length}개`);
        return;
      }

      body.talkApi = {
        enabled: !!talkEnabled,
        baseUrl: talkBase || "https://talk-api.naijun.dev",
      };
      // Auth Header는 민감 정보이므로, 입력값이 비어 있으면 “기존 값을 유지”하기 위해 아예 전송하지 않는다.
      // (빈 문자열을 보내면 서버의 authHeader가 지워져서 Talk API 송신이 즉시 실패한다.)
      if (inputTalkAuth) {
        body.talkApi.authHeader = inputTalkAuth;
      }

      if (welcomeSetEnabled) {
        if (welcomeEdit.errors.length) {
          setMsg(`저장 불가: Welcome 설정 오류 ${welcomeEdit.errors.length}개`);
          return;
        }
        body.welcome = {
          sendDelayMinMs: welcomeDelayEdit.minMs,
          sendDelayMaxMs: welcomeDelayEdit.maxMs,
          templateSets: {
            kakaoDefaultNickname: welcomeEdit.kakaoSet,
            customNickname: welcomeEdit.customSet,
          },
          templateSetPick: welcomeSetPick,
          kakaoDefaultNicknameRegexes: welcomeEdit.regexes,
        };
      } else {
        body.welcome = { templateSets: null, sendDelayMinMs: welcomeDelayEdit.minMs, sendDelayMaxMs: welcomeDelayEdit.maxMs };
      }

      const r = await fetch(`/api/runtime`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      let detail = "";
      try {
        const j = await r.json();
        detail = String(j?.detail || j?.error || "");
      } catch {
        // ignore
      }

      if (r.ok) {
        setMsg("저장되었습니다.");
        await load();
      } else {
        setMsg(`저장에 실패했습니다.${detail ? `: ${detail}` : ""}`);
      }
    } catch (e: any) {
      setMsg("저장에 실패했습니다: " + String(e?.message || e));
    } finally {
      setSaving(false);
    }
  };

  const openWelcomePreview = async (name: string) => {
    const nm = String(name || "").trim();
    if (!nm) return;
    try {
      const r = await fetch(`/api/templates/welcome/${encodeURIComponent(nm)}`);
      if (!r.ok) throw new Error(`template fetch failed: ${r.status}`);
      const data = await r.json();
      setWelcomePreview({
        open: true,
        name: nm,
        title: String(data?.title || nm),
        content: String(data?.content || ""),
        images: Array.isArray(data?.images) ? data.images.map((x: any) => String(x || "")).filter(Boolean) : [],
        mentions: Array.isArray(data?.mentions) ? data.mentions.map((x: any) => String(x || "")).filter(Boolean) : [],
      });
    } catch (e: any) {
      setMsg(`템플릿 미리보기 로드 실패: ${nm} (${String(e?.message || e)})`);
    }
  };

  return (
    <div className="dashboard-container">
      <div className="header-section">
        <div>
          <h1 className="main-title">기능별 관리</h1>
          <p className="sub-title">각 기능(환영, 브로드캐스트 등)에 사용할 템플릿을 연결하고 전역 설정을 관리합니다.</p>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          <a href="/kb" className="btn-outline">
            카페 지식베이스(KB) 바로가기
          </a>
        </div>
      </div>

      {loadError ? (
        <div
          style={{
            marginTop: 12,
            marginBottom: 24,
            padding: 12,
            borderRadius: 10,
            border: "1px solid var(--border-color)",
            background: "rgba(239,68,68,0.08)",
            color: "var(--error)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ fontWeight: 800, marginBottom: 6 }}>연결 실패: 실시간 서버(/runtime)를 불러오지 못했습니다.</div>
          <div style={{ color: "var(--text-secondary)" }}>
            - 에러: <code>{loadError}</code>
            <br />- `windows/start_all.ps1` 또는 `windows/start_api.cmd` / `windows/start_web.cmd` 실행 후 다시 시도하세요.
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 12, color: "var(--text-muted)", fontSize: 14, marginBottom: 24 }}>
          SAFE_MODE: {runtime.safeMode ? "ON (모든 발신 차단: 수신/로그 전용)" : "OFF (발신 허용 모드)"} — 값은{" "}
          <code>runtime.json.safeMode</code>에 기록되며, 설정 변경은 즉시 반영됩니다.
        </div>
      )}

      <div className="pipeline-card" style={{ maxWidth: 900 }}>
        <h3 style={{ marginTop: 0, color: "var(--text-primary)" }}>기본/연동</h3>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 24 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={!!runtime.safeMode}
              onChange={(e) => setRuntime((prev: any) => ({ ...prev, safeMode: e.target.checked }))}
              disabled={!!loadError}
              style={{ width: 16, height: 16, accentColor: "var(--accent-primary)" }}
            />
            <span style={{ fontWeight: 700, color: "var(--text-primary)" }}>SAFE MODE (발신 차단)</span>
          </label>
          {!runtime.safeMode && (
            <span
              style={{
                color: "#fecaca",
                background: "rgba(185,28,28,.25)",
                padding: "4px 8px",
                borderRadius: 8,
                fontWeight: 700,
                fontSize: 12,
              }}
            >
              주의: SAFE MODE 해제 시 실제 방으로 발신될 수 있습니다.
            </span>
          )}
        </div>

        <div style={{ marginTop: 6, padding: 16, border: "1px solid var(--border-color)", borderRadius: 12, background: "var(--bg-main)" }}>
          <div style={{ fontWeight: 700, marginBottom: 12, color: "var(--text-primary)" }}>Talk API 설정 (옵션)</div>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>사용 여부</div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={talkEnabled}
                onChange={(e) => setTalkEnabled(e.target.checked)}
                disabled={!!loadError}
                style={{ width: 16, height: 16, accentColor: "var(--accent-primary)" }}
              />
              <span style={{ color: "var(--text-primary)", fontSize: 13 }}>외부 Talk API 사용</span>
            </label>
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>Base URL</div>
            <input
              value={talkBase}
              onChange={(e) => setTalkBase(e.target.value)}
              disabled={!!loadError}
              placeholder="https://talk-api.naijun.dev"
              className="filter-input"
              style={{ width: "100%" }}
            />
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>Auth Header</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                value={talkAuth}
                onChange={(e) => setTalkAuth(e.target.value)}
                disabled={!!loadError}
                placeholder="(자동 캡처/적용 가능)"
                className="filter-input"
                style={{ width: "100%" }}
              />
              <button
                type="button"
                className="btn-outline"
                disabled={!!loadError || talkApplying}
                style={{ padding: "6px 10px", fontSize: 12, whiteSpace: "nowrap" }}
                onClick={async () => {
                  setTalkApplying(true);
                  setMsg("");
                  try {
                    const r = await fetch("/api/talkapi/auth-from-file", { method: "POST" });
                    const j: any = await r.json().catch(() => ({}));
                    if (!r.ok || !j?.ok) {
                      throw new Error(String(j?.error || `apply failed: status=${r.status}`));
                    }
                    // 서버 쪽 runtime.json에 저장만 하고, 값은 레드랙트로만 안내한다.
                    setRuntime((prev: any) => ({
                      ...(prev || {}),
                      talkApi: { ...((prev || {}).talkApi || {}), enabled: true, authHeader: "__SET__" },
                    }));
                    setTalkEnabled(true);
                    setMsg(`Talk API authHeader 적용 완료 (Authorization=${j?.auth?.authorization || "***"}, Duuid=${j?.auth?.duuid || "***"})`);
                  } catch (e: any) {
                    setMsg("Talk API authHeader 자동 적용 실패: " + String(e?.message || e));
                  } finally {
                    setTalkApplying(false);
                  }
                }}
              >
                파일에서 자동 적용
              </button>
            </div>
          </div>
          <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
            외부 Talk API는 “멘션 발송(attachment.mentions)” 같은 경로에 사용됩니다. Auth Header는 민감 정보이며 카카오톡 로그인/토큰 갱신에 따라 바뀔 수 있습니다.
          </div>
        </div>

        <div style={{ marginTop: 16, padding: 16, border: "1px solid var(--border-color)", borderRadius: 12, background: "var(--bg-main)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
            <div style={{ fontWeight: 700, color: "var(--text-primary)" }}>Welcome 템플릿 세트</div>
            <a href="/templates?category=welcome" className="btn-outline" style={{ padding: "6px 10px", fontSize: 12 }}>
              템플릿 편집/미리보기
            </a>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 12 }}>
            <input
              type="checkbox"
              checked={welcomeSetEnabled}
              onChange={(e) => setWelcomeSetEnabled(e.target.checked)}
              disabled={!!loadError}
              style={{ width: 16, height: 16, accentColor: "var(--accent-primary)" }}
            />
            <div style={{ color: "var(--text-primary)", fontSize: 13 }}>
              세트 모드 사용 (기본닉/커스텀닉 분기 + <code>templateSets.*</code>에서 1개 선택)
            </div>
          </label>

          <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>Delay (초)</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <input
                value={welcomeDelayMinSec}
                onChange={(e) => setWelcomeDelayMinSec(e.target.value)}
                disabled={!!loadError}
                className="filter-input"
                style={{ width: 90 }}
                placeholder="3"
              />
              <span style={{ color: "var(--text-muted)" }}>~</span>
              <input
                value={welcomeDelayMaxSec}
                onChange={(e) => setWelcomeDelayMaxSec(e.target.value)}
                disabled={!!loadError}
                className="filter-input"
                style={{ width: 90 }}
                placeholder="5"
              />
              <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                입장 후 <b>{welcomeDelayMinSec || "?"}초</b> 동안 합류한 인원은 묶어서 처리하고, 최종 발송은 <b>{welcomeDelayMinSec || "?"}~{welcomeDelayMaxSec || "?"}초</b> 사이로 랜덤 지연됩니다.
              </div>
            </div>
          </div>

          {welcomeDelayEdit.errors.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: "rgba(239,68,68,0.08)",
                fontSize: 12,
                color: "var(--error)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Welcome 딜레이 설정 오류 (저장 불가)</div>
              {welcomeDelayEdit.errors.map((e, idx) => (
                <div key={idx} style={{ marginBottom: 2 }}>
                  - {e}
                </div>
              ))}
            </div>
          )}

          {welcomeDelayEdit.warnings.length > 0 && (
            <div
              style={{
                marginBottom: 12,
                padding: 12,
                borderRadius: 8,
                border: "1px solid var(--border-color)",
                background: "rgba(250,204,21,0.06)",
                fontSize: 12,
                color: "var(--text-secondary)",
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Welcome 딜레이 경고</div>
              {welcomeDelayEdit.warnings.map((w, idx) => (
                <div key={idx} style={{ marginBottom: 2 }}>
                  - {w}
                </div>
              ))}
            </div>
          )}

          {welcomeSetEnabled ? (
            <>
              {welcomeEdit.errors.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border-color)",
                    background: "rgba(239,68,68,0.08)",
                    fontSize: 12,
                    color: "var(--error)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Welcome 설정 오류 (저장 불가)</div>
                  {welcomeEdit.errors.map((e, idx) => (
                    <div key={idx} style={{ marginBottom: 2 }}>
                      - {e}
                    </div>
                  ))}
                </div>
              )}

              {welcomeEdit.warnings.length > 0 && (
                <div
                  style={{
                    marginBottom: 12,
                    padding: 12,
                    borderRadius: 8,
                    border: "1px solid var(--border-color)",
                    background: "rgba(250,204,21,0.06)",
                    fontSize: 12,
                    color: "var(--text-secondary)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>Welcome 설정 경고</div>
                  {welcomeEdit.warnings.map((w, idx) => (
                    <div key={idx} style={{ marginBottom: 2 }}>
                      - {w}
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "160px 1fr", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>선택 규칙</div>
                <select value={welcomeSetPick} onChange={(e) => setWelcomeSetPick(e.target.value as WelcomeTemplatePick)} className="filter-select">
                  <option value="random">random (입장 이벤트마다 1개 랜덤)</option>
                  <option value="hash_sender_id">hash_sender_id (senderId 기반 고정)</option>
                  <option value="hash_user_name">hash_user_name (userName 기반 고정)</option>
                </select>

                <div style={{ color: "var(--text-secondary)", fontSize: 13 }}>기본닉 판별</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                  <input
                    value={welcomeNickTest}
                    onChange={(e) => setWelcomeNickTest(e.target.value)}
                    disabled={!!loadError}
                    className="filter-input"
                    placeholder="닉네임을 입력하면 기본닉/커스텀닉 판별 결과가 표시됩니다"
                    style={{ minWidth: 260, flex: "1 1 260px" }}
                  />
                  {welcomeNickTestResult && (
                    <span
                      style={{
                        padding: "6px 10px",
                        borderRadius: 10,
                        border: "1px solid var(--border-color)",
                        background: welcomeNickTestResult.kind === "기본닉" ? "rgba(250,204,21,0.08)" : "rgba(34,197,94,0.08)",
                        color: "var(--text-secondary)",
                        fontSize: 12,
                        whiteSpace: "nowrap",
                      }}
                    >
                      판별: <b>{welcomeNickTestResult.kind}</b>
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn-outline"
                    style={{ padding: "6px 10px", fontSize: 12 }}
                    onClick={() => setWelcomeRegexOpen((v) => !v)}
                  >
                    {welcomeRegexOpen ? "정규식 숨기기" : "정규식(고급) 편집"}
                  </button>
                </div>

                <div />
                {welcomeRegexOpen ? (
                  <div>
                    <textarea
                      value={welcomeRegexText}
                      onChange={(e) => setWelcomeRegexText(e.target.value)}
                      disabled={!!loadError}
                      className="filter-input"
                      rows={4}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                      }}
                      placeholder={"예) ^[가-힣0-9]{1,12}\\s+(프렌즈|니니즈|춘식이)$"}
                    />
                    {welcomeNickTestResult?.matched && (
                      <div style={{ marginTop: 6, color: "var(--text-muted)", fontSize: 12 }}>
                        매칭된 정규식: <code>{welcomeNickTestResult.matched}</code>
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ color: "var(--text-muted)", fontSize: 12 }}>
                    정규식 {normalizeLines(welcomeRegexText).length}개 (필요 시 “정규식(고급) 편집”에서 수정)
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr" }}>
                <div style={{ border: "1px solid var(--border-color)", borderRadius: 10, padding: 12, background: "rgba(15,23,42,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13 }}>CASE1(기본닉) 템플릿 세트</div>
                    <select
                      value={welcomeAddKakao}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWelcomeAddKakao(v);
                        if (!v) return;
                        setWelcomeSetKakao((prev) => pushUnique(prev, v));
                        setWelcomeAddKakao("");
                      }}
                      className="filter-select"
                      disabled={!!loadError}
                      style={{ width: 220 }}
                    >
                      <option value="">+ 템플릿 추가</option>
                      {(optionsByCat.welcome || []).map((it: any) => (
                        <option key={"kakao_add_" + it.name} value={it.name}>
                          {it.title || it.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 34 }}>
                    {welcomeEdit.kakaoSet.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>선택된 템플릿이 없습니다.</div>
                    ) : (
                      welcomeEdit.kakaoSet.map((nm) => {
                        const info = welcomeTplByName.get(nm);
                        const label = String(info?.title || nm);
                        return (
                          <span
                            key={nm}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 8px",
                              borderRadius: 999,
                              border: "1px solid var(--border-color)",
                              background: "rgba(59,130,246,0.04)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <button type="button" className="btn-outline" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => openWelcomePreview(nm)}>
                              미리보기
                            </button>
                            <span style={{ fontSize: 12 }}>
                              {label} <span style={{ color: "var(--text-muted)" }}>(<code>{nm}</code>)</span>
                            </span>
                            <button type="button" className="btn-outline" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setWelcomeSetKakao((prev) => prev.filter((x) => x !== nm))}>
                              제거
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>현재 {welcomeEdit.kakaoSet.length}개 (권장: 5개 이상)</div>
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => setWelcomeSetKakao(["1", "2", "welcome_default_3", "welcome_default_4", "welcome_default_5"])}
                    >
                      샘플 5개로 채우기
                    </button>
                  </div>
                </div>

                <div style={{ border: "1px solid var(--border-color)", borderRadius: 10, padding: 12, background: "rgba(15,23,42,0.02)" }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                    <div style={{ fontWeight: 700, color: "var(--text-primary)", fontSize: 13 }}>CASE2(커스텀닉) 템플릿 세트</div>
                    <select
                      value={welcomeAddCustom}
                      onChange={(e) => {
                        const v = e.target.value;
                        setWelcomeAddCustom(v);
                        if (!v) return;
                        setWelcomeSetCustom((prev) => pushUnique(prev, v));
                        setWelcomeAddCustom("");
                      }}
                      className="filter-select"
                      disabled={!!loadError}
                      style={{ width: 220 }}
                    >
                      <option value="">+ 템플릿 추가</option>
                      {(optionsByCat.welcome || []).map((it: any) => (
                        <option key={"custom_add_" + it.name} value={it.name}>
                          {it.title || it.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, minHeight: 34 }}>
                    {welcomeEdit.customSet.length === 0 ? (
                      <div style={{ color: "var(--text-muted)", fontSize: 12 }}>선택된 템플릿이 없습니다.</div>
                    ) : (
                      welcomeEdit.customSet.map((nm) => {
                        const info = welcomeTplByName.get(nm);
                        const label = String(info?.title || nm);
                        return (
                          <span
                            key={nm}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              padding: "4px 8px",
                              borderRadius: 999,
                              border: "1px solid var(--border-color)",
                              background: "rgba(34,197,94,0.04)",
                              color: "var(--text-secondary)",
                            }}
                          >
                            <button type="button" className="btn-outline" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => openWelcomePreview(nm)}>
                              미리보기
                            </button>
                            <span style={{ fontSize: 12 }}>
                              {label} <span style={{ color: "var(--text-muted)" }}>(<code>{nm}</code>)</span>
                            </span>
                            <button type="button" className="btn-outline" style={{ padding: "2px 8px", fontSize: 12 }} onClick={() => setWelcomeSetCustom((prev) => prev.filter((x) => x !== nm))}>
                              제거
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>

                  <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                    <div style={{ color: "var(--text-muted)", fontSize: 12 }}>현재 {welcomeEdit.customSet.length}개 (권장: 5개 이상)</div>
                    <button
                      type="button"
                      className="btn-outline"
                      style={{ padding: "6px 10px", fontSize: 12 }}
                      onClick={() => setWelcomeSetCustom(["welcome_custom_1", "welcome_custom_2", "welcome_custom_3", "welcome_custom_4", "welcome_custom_5"])}
                    >
                      샘플 5개로 채우기
                    </button>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10, color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
                - <code>random</code>은 <b>입장 이벤트마다</b> 세트 중 1개만 발송합니다. (5개 이상 넣으면 문구가 자연스럽게 분산됩니다.)
                <br />- 변수는 <code>{"{{entrance}}"}</code> / <code>{"{entrance}"}</code> / <code>{"@{entrance}"}</code> 모두 지원합니다.
              </div>
            </>
          ) : (
            <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.5 }}>
              세트 모드 OFF: welcome은 아래 <code>templateByFeature.welcome</code> 선택값으로 동작합니다.
            </div>
          )}
        </div>

        {missingTemplateWarnings.length > 0 && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "rgba(250,204,21,0.05)",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>템플릿 누락 경고</div>
            {missingTemplateWarnings.map((w, idx) => (
              <div key={idx} style={{ marginBottom: 2 }}>
                - {w}
              </div>
            ))}
            <div style={{ marginTop: 4 }}>
              SSOT 폴더(<code>node-iris-app/config/templates/&lt;category&gt;</code>)에서 템플릿 JSON이 실제로 존재하는지 확인하세요.
            </div>
          </div>
        )}

        {welcomeSetWarnings.length > 0 && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "rgba(250,204,21,0.05)",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 4 }}>Welcome 세트 경고 (runtime 기준)</div>
            {welcomeSetWarnings.map((w, idx) => (
              <div key={idx} style={{ marginBottom: 2 }}>
                - {w}
              </div>
            ))}
            <div style={{ marginTop: 4 }}>
              참고: Welcome 세트 모드가 켜져 있으면 <code>templateByFeature.welcome</code> 선택은 무시됩니다.
            </div>
          </div>
        )}

        {welcomeSetSummary && (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "rgba(59,130,246,0.04)",
              fontSize: 12,
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Welcome 세트 요약(runtime)</div>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
              <div>
                templateSetPick: <code>{welcomeSetSummary.pick || "(none)"}</code>
              </div>
              <div>
                regexes: <code>{welcomeSetSummary.regexes.length}</code>
              </div>
              <div>
                CASE1(기본닉): <code>{welcomeSetSummary.kakao.length}</code>
              </div>
              <div>
                CASE2(커스텀닉): <code>{welcomeSetSummary.custom.length}</code>
              </div>
            </div>
            {welcomeSetSummary.regexes.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>kakaoDefaultNicknameRegexes</div>
                {welcomeSetSummary.regexes.map((r: string, idx: number) => (
                  <div key={idx} style={{ marginBottom: 2 }}>
                    <code>{r}</code>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr" }}>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>templateSets.kakaoDefaultNickname</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {welcomeSetSummary.kakao.map((it: any, idx: number) => (
                    <span
                      key={idx}
                      style={{
                        padding: "2px 6px",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                        background: it.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                        color: it.ok ? "var(--text-secondary)" : "var(--error)",
                      }}
                    >
                      <code>{it.name}</code>
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>templateSets.customNickname</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {welcomeSetSummary.custom.map((it: any, idx: number) => (
                    <span
                      key={idx}
                      style={{
                        padding: "2px 6px",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                        background: it.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
                        color: it.ok ? "var(--text-secondary)" : "var(--error)",
                      }}
                    >
                      <code>{it.name}</code>
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 10, color: "var(--text-muted)" }}>템플릿 내용/이미지는 <code>/templates</code>에서 확인할 수 있습니다.</div>
          </div>
        )}

        {welcomePreview.open && (
          <div
            role="dialog"
            aria-modal="true"
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.5)",
              zIndex: 50,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 20,
            }}
            onClick={() => setWelcomePreview((p) => ({ ...p, open: false }))}
          >
            <div
              style={{
                width: "min(980px, 100%)",
                maxHeight: "90vh",
                overflow: "auto",
                background: "var(--bg-main)",
                border: "1px solid var(--border-color)",
                borderRadius: 12,
                padding: 16,
                boxShadow: "0 10px 30px rgba(0,0,0,0.25)",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
                <div style={{ fontWeight: 800, color: "var(--text-primary)" }}>
                  {welcomePreview.title}{" "}
                  <span style={{ color: "var(--text-muted)", fontWeight: 600 }}>
                    (<code>{welcomePreview.name}</code>)
                  </span>
                </div>
                <button
                  type="button"
                  className="btn-outline"
                  style={{ padding: "6px 10px", fontSize: 12 }}
                  onClick={() => setWelcomePreview((p) => ({ ...p, open: false }))}
                >
                  닫기
                </button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", gap: 14, alignItems: "start" }}>
                <div style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{welcomePreview.content}</div>
                <KakaoPreview content={welcomePreview.content} images={welcomePreview.images} mentions={welcomePreview.mentions} />
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: 24 }}>
          {cats.map((c) => (
            <div key={c.key} style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div style={{ width: 220, color: "var(--text-secondary)", fontWeight: 600, fontSize: 14 }}>
                {c.name}{" "}
                <span style={{ fontWeight: 400, fontSize: 12, color: "var(--text-muted)" }}>({(optionsByCat[c.key] || []).length}개)</span>
              </div>
              <select
                value={(runtime.templateByFeature || {})[c.key] || ""}
                onChange={(e) => setFeatureTemplate(c.key, e.target.value)}
                className="filter-select"
                style={{ flex: 1, opacity: c.key === "welcome" && welcomeSetEnabled ? 0.55 : 1 }}
                disabled={!!loadError || (c.key === "welcome" && welcomeSetEnabled)}
              >
                <option value="">{c.key === "welcome" && welcomeSetEnabled ? "세트 모드 사용중" : "사용 안 함"}</option>
                {(optionsByCat[c.key] || []).map((it) => (
                  <option key={it.category + it.name} value={it.name}>
                    {it.title || it.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 24, alignItems: "center" }}>
          <button
            onClick={save}
            disabled={!!loadError || saving || (welcomeSetEnabled && welcomeEdit.errors.length > 0)}
            className="btn-copy"
          >
            {saving ? "저장 중..." : "Save"}
          </button>
          {msg && <div style={{ color: "var(--accent-primary)", fontSize: 14 }}>{msg}</div>}
        </div>
      </div>

      <div style={{ marginTop: 20, color: "var(--text-muted)", fontSize: 12 }}>
        참고: 템플릿/정규식은 운영 중에도 변경 가능하지만, 폴백 없이 검증 실패 시 저장이 차단됩니다.
      </div>
    </div>
  );
}
