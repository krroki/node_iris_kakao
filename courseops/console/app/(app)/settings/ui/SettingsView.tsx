"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Me = { session?: { name?: string } | null; canSync?: boolean; isCourseManager?: boolean };

const LS_HIDE_HIDDEN = "courseops_pref_hide_hidden_actions";
const LS_HIDE_INCOMPLETE = "courseops_pref_hide_incomplete_actions";

function readBool(key: string, fallback: boolean) {
  try {
    const v = window.localStorage.getItem(key);
    if (v === null) return fallback;
    return v === "1" || v === "true";
  } catch {
    return fallback;
  }
}

function writeBool(key: string, v: boolean) {
  try {
    window.localStorage.setItem(key, v ? "1" : "0");
  } catch {}
}

export default function SettingsView() {
  const [me, setMe] = useState<Me | null>(null);
  const [hideHidden, setHideHidden] = useState(true);
  const [hideIncomplete, setHideIncomplete] = useState(true);

  useEffect(() => {
    setHideHidden(readBool(LS_HIDE_HIDDEN, true));
    setHideIncomplete(readBool(LS_HIDE_INCOMPLETE, true));
    (async () => {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (res.ok) setMe(j as Me);
      else setMe(null);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">내 정보</div>
        <div className="mt-2 text-sm text-slate-700">
          이름: <span className="font-medium">{String(me?.session?.name || "-")}</span>
        </div>
        <div className="mt-1 text-xs text-slate-500">{me?.canSync ? "동기화 가능" : "조회만 가능"}</div>
      </div>

      {me?.isCourseManager ? (
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold">강의 설정</div>
          <div className="mt-1 text-sm text-slate-600">결제 SSOT 시트/톡방 ID 등 강의 설정은 “강의 관리”에서 입력해요.</div>
          <div className="mt-3">
            <Link
              href="/courses"
              className="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
            >
              강의 관리로 이동
            </Link>
          </div>
        </div>
      ) : null}

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">대기열 표시</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <div>
              <div className="text-sm font-medium text-slate-700">숨김 항목 숨기기</div>
              <div className="mt-1 text-xs text-slate-500">대기열에서 “숨김” 처리된 항목을 기본으로 감춥니다.</div>
            </div>
            <input
              type="checkbox"
              checked={hideHidden}
              onChange={(e) => {
                const v = e.target.checked;
                setHideHidden(v);
                writeBool(LS_HIDE_HIDDEN, v);
              }}
            />
          </label>

          <label className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
            <div>
              <div className="text-sm font-medium text-slate-700">데이터 부족 숨기기</div>
              <div className="mt-1 text-xs text-slate-500">데이터가 부족해 확정 판단이 어려운 항목을 기본으로 감춥니다.</div>
            </div>
            <input
              type="checkbox"
              checked={hideIncomplete}
              onChange={(e) => {
                const v = e.target.checked;
                setHideIncomplete(v);
                writeBool(LS_HIDE_INCOMPLETE, v);
              }}
            />
          </label>
        </div>
        <div className="mt-3 text-xs text-slate-500">이 설정은 현재 브라우저에 저장됩니다.</div>
      </div>
    </div>
  );
}
