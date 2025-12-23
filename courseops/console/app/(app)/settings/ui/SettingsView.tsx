"use client";

import { useEffect, useState } from "react";

type Course = {
  id: string;
  courseKey: string;
  clubId: string | null;
  sheetId: string;
  actionsTab: string;
  cafeUrl: string | null;
  openchatChatRoomId: string | null;
  openchatNoticeRoomId: string | null;
  premiumEnabled: boolean;
  openchatPremiumRoomId: string | null;
  vipEnabled: boolean;
  openchatVipRoomId: string | null;
};

export default function SettingsView() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseKey, setCourseKey] = useState("");
  const [cafeUrl, setCafeUrl] = useState("");
  const [clubId, setClubId] = useState("");
  const [sheetIdOrUrl, setSheetIdOrUrl] = useState("");
  const [actionsTab, setActionsTab] = useState("ACTIONS");
  const [openchatChatRoomId, setOpenchatChatRoomId] = useState("");
  const [openchatNoticeRoomId, setOpenchatNoticeRoomId] = useState("");
  const [premiumEnabled, setPremiumEnabled] = useState(true);
  const [openchatPremiumRoomId, setOpenchatPremiumRoomId] = useState("");
  const [vipEnabled, setVipEnabled] = useState(false);
  const [openchatVipRoomId, setOpenchatVipRoomId] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const [meRes, coursesRes] = await Promise.all([
      fetch("/api/auth/me", { cache: "no-store" }),
      fetch("/api/courses", { cache: "no-store" }),
    ]);
    if (meRes.ok) {
      const j = (await meRes.json().catch(() => ({}))) as any;
      setIsAdmin(Boolean(j?.isAdmin));
    } else {
      setIsAdmin(false);
    }
    if (coursesRes.ok) {
      const j = (await coursesRes.json().catch(() => ({}))) as any;
      setCourses(Array.isArray(j?.courses) ? (j.courses as Course[]) : []);
    } else {
      setCourses([]);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addCourse = async () => {
    setError("");
    setSaving(true);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseKey,
          clubId,
          cafeUrl,
          sheetIdOrUrl,
          actionsTab,
          openchatChatRoomId,
          openchatNoticeRoomId,
          premiumEnabled,
          openchatPremiumRoomId,
          vipEnabled,
          openchatVipRoomId,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        if (res.status === 403) setError("새 강의 등록은 관리자만 가능해요.");
        else setError(String(j?.error || "저장에 실패했어요."));
        return;
      }
      setCourseKey("");
      setCafeUrl("");
      setClubId("");
      setSheetIdOrUrl("");
      setActionsTab("ACTIONS");
      setOpenchatChatRoomId("");
      setOpenchatNoticeRoomId("");
      setPremiumEnabled(true);
      setOpenchatPremiumRoomId("");
      setVipEnabled(false);
      setOpenchatVipRoomId("");
      await load();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">새 강의 등록</div>
        <div className="mt-1 text-sm text-slate-600">
          강의별로 카페/톡방/시트를 묶어서 관리해요. (새 강의 등록은 관리자만 가능)
        </div>

        {!isAdmin ? (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            관리자 설정이 필요해요. Vercel 환경 변수 `COURSEOPS_ADMIN_NAMES`에 본인 이름을
            추가해 주세요.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-4">
          <div>
            <div className="text-xs font-medium text-slate-500">강의 이름</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={courseKey}
              onChange={(e) => setCourseKey(e.target.value)}
              placeholder="예: 사알못사주자동화 [카라반]"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">카페 주소</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={cafeUrl}
              onChange={(e) => setCafeUrl(e.target.value)}
              placeholder="https://cafe.naver.com/..."
            />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">카페 clubId</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={clubId}
              onChange={(e) => setClubId(e.target.value)}
              placeholder="숫자 (예: 123456)"
            />
            <div className="mt-1 text-xs text-slate-500">카페 URL에 clubid=가 포함되어 있으면 clubId는 비워도 돼요.</div>
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">스프레드시트 URL 또는 ID</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={sheetIdOrUrl}
              onChange={(e) => setSheetIdOrUrl(e.target.value)}
              placeholder="https://docs.google.com/spreadsheets/d/..."
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div>
            <div className="text-xs font-medium text-slate-500">ACTIONS 탭 이름</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={actionsTab}
              onChange={(e) => setActionsTab(e.target.value)}
              placeholder="ACTIONS"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">사담방 ID</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={openchatChatRoomId}
              onChange={(e) => setOpenchatChatRoomId(e.target.value)}
              placeholder="오픈채팅 roomId"
            />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500">공지방 ID</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={openchatNoticeRoomId}
              onChange={(e) => setOpenchatNoticeRoomId(e.target.value)}
              placeholder="오픈채팅 roomId"
            />
          </div>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-3">
          <div className="rounded-xl bg-slate-50 p-3">
            <label className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-700">프리미엄 방 사용</div>
              <input
                type="checkbox"
                checked={premiumEnabled}
                onChange={(e) => setPremiumEnabled(e.target.checked)}
              />
            </label>
            <div className="mt-2">
              <div className="text-xs font-medium text-slate-500">프리미엄방 ID</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={openchatPremiumRoomId}
                onChange={(e) => setOpenchatPremiumRoomId(e.target.value)}
                placeholder="오픈채팅 roomId"
                disabled={!premiumEnabled}
              />
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <label className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-700">VIP 방 사용</div>
              <input type="checkbox" checked={vipEnabled} onChange={(e) => setVipEnabled(e.target.checked)} />
            </label>
            <div className="mt-2">
              <div className="text-xs font-medium text-slate-500">VIP방 ID</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={openchatVipRoomId}
                onChange={(e) => setOpenchatVipRoomId(e.target.value)}
                placeholder="오픈채팅 roomId"
                disabled={!vipEnabled}
              />
            </div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">
            <div className="font-medium text-slate-700">팁</div>
            <div className="mt-1">프리미엄이 없으면 “프리미엄 방 사용”을 꺼두면 돼요.</div>
            <div className="mt-1">VIP가 있으면 VIP를 켜고 roomId를 입력해요.</div>
          </div>
        </div>
        {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        <div className="mt-3">
          <button
            onClick={addCourse}
            disabled={saving || !isAdmin}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">등록된 강의</div>
        <div className="mt-3 space-y-2">
          {courses.map((c) => (
            <div key={c.id} className="rounded-xl border bg-slate-50 p-3 text-sm">
              <div className="font-semibold">{c.courseKey}</div>
              <div className="mt-1 text-slate-600">카페: {c.cafeUrl || "-"}</div>
              <div className="text-slate-600">clubId: {c.clubId || "-"}</div>
              <div className="text-slate-600">시트: {c.sheetId}</div>
              <div className="text-slate-600">탭: {c.actionsTab}</div>
              <div className="mt-2 grid gap-2 md:grid-cols-2">
                <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                  사담방: {c.openchatChatRoomId || "-"}
                </div>
                <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                  공지방: {c.openchatNoticeRoomId || "-"}
                </div>
                <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                  프리미엄: {c.premiumEnabled ? c.openchatPremiumRoomId || "-" : "사용 안 함"}
                </div>
                <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                  VIP: {c.vipEnabled ? c.openchatVipRoomId || "-" : "사용 안 함"}
                </div>
              </div>
            </div>
          ))}
          {courses.length === 0 ? <div className="text-sm text-slate-600">아직 등록된 강의가 없어요.</div> : null}
        </div>
      </div>
    </div>
  );
}
