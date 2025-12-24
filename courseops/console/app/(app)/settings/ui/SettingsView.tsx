"use client";

import { useEffect, useState } from "react";

type Course = {
  id: string;
  courseKey: string;
  clubId: string | null;
  archived?: boolean;
  archivedAt?: string | null;
  archivedBy?: string | null;
  cafeUrl: string | null;
  openchatChatRoomId: string | null;
  openchatNoticeRoomId: string | null;
  premiumEnabled: boolean;
  openchatPremiumRoomId: string | null;
  vipEnabled: boolean;
  openchatVipRoomId: string | null;
  paymentSheetId?: string | null;
  paymentSheetName?: string | null;
  paymentHeaderRow?: number | null;
  paymentGradeCol?: string | null;
  paymentNicknameCol?: string | null;
  paymentNameCol?: string | null;
  paymentIdCol?: string | null;
  paymentKindCol?: string | null;
  paymentExcludeKinds?: string | null;
};

export default function SettingsView() {
  const [isAdmin, setIsAdmin] = useState(false);
  const [courses, setCourses] = useState<Course[]>([]);
  const [showArchived, setShowArchived] = useState(false);
  const [courseKey, setCourseKey] = useState("");
  const [cafeUrl, setCafeUrl] = useState("");
  const [clubId, setClubId] = useState("");
  const [openchatChatRoomId, setOpenchatChatRoomId] = useState("");
  const [openchatNoticeRoomId, setOpenchatNoticeRoomId] = useState("");      
  const [premiumEnabled, setPremiumEnabled] = useState(true);
  const [openchatPremiumRoomId, setOpenchatPremiumRoomId] = useState("");    
  const [vipEnabled, setVipEnabled] = useState(false);
  const [openchatVipRoomId, setOpenchatVipRoomId] = useState("");
  const [paymentSheetId, setPaymentSheetId] = useState("");
  const [paymentSheetName, setPaymentSheetName] = useState("종합");
  const [paymentHeaderRow, setPaymentHeaderRow] = useState("19");
  const [paymentGradeCol, setPaymentGradeCol] = useState("카페 등급");
  const [paymentNicknameCol, setPaymentNicknameCol] = useState("닉네임");
  const [paymentNameCol, setPaymentNameCol] = useState("성함");
  const [paymentIdCol, setPaymentIdCol] = useState("아이디");
  const [paymentKindCol, setPaymentKindCol] = useState("구분");
  const [paymentExcludeKinds, setPaymentExcludeKinds] = useState("환불");

  const [editing, setEditing] = useState<Course | null>(null);
  const [editingSaving, setEditingSaving] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    const meRes = await fetch("/api/auth/me", { cache: "no-store" });
    let admin = false;
    if (meRes.ok) {
      const j = (await meRes.json().catch(() => ({}))) as any;
      admin = Boolean(j?.isAdmin);
    }
    setIsAdmin(admin);

    const coursesUrl = showArchived && admin ? "/api/courses?includeArchived=1" : "/api/courses";
    const coursesRes = await fetch(coursesUrl, { cache: "no-store" });
    if (coursesRes.ok) {
      const j = (await coursesRes.json().catch(() => ({}))) as any;
      setCourses(Array.isArray(j?.courses) ? (j.courses as Course[]) : []);
    } else {
      setCourses([]);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

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
          openchatChatRoomId,
          openchatNoticeRoomId,
          premiumEnabled,
          openchatPremiumRoomId,
          vipEnabled,
          openchatVipRoomId,
          paymentSheetId,
          paymentSheetName,
          paymentHeaderRow,
          paymentGradeCol,
          paymentNicknameCol,
          paymentNameCol,
          paymentIdCol,
          paymentKindCol,
          paymentExcludeKinds,
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
      setOpenchatChatRoomId("");
      setOpenchatNoticeRoomId("");
      setPremiumEnabled(true);
      setOpenchatPremiumRoomId("");
      setVipEnabled(false);
      setOpenchatVipRoomId("");
      setPaymentSheetId("");
      setPaymentSheetName("종합");
      setPaymentHeaderRow("19");
      setPaymentGradeCol("카페 등급");
      setPaymentNicknameCol("닉네임");
      setPaymentNameCol("성함");
      setPaymentIdCol("아이디");
      setPaymentKindCol("구분");
      setPaymentExcludeKinds("환불");
      await load();
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (c: Course) => {
    setError("");
    setEditing({
      ...c,
      paymentSheetName: (c.paymentSheetName || "").trim() || "종합",
      paymentHeaderRow: typeof c.paymentHeaderRow === "number" && c.paymentHeaderRow > 0 ? c.paymentHeaderRow : 19,
      paymentGradeCol: (c.paymentGradeCol || "").trim() || "카페 등급",
      paymentNicknameCol: (c.paymentNicknameCol || "").trim() || "닉네임",
      paymentNameCol: (c.paymentNameCol || "").trim() || "성함",
      paymentIdCol: (c.paymentIdCol || "").trim() || "아이디",
      paymentKindCol: (c.paymentKindCol || "").trim() || "구분",
      paymentExcludeKinds: (c.paymentExcludeKinds || "").trim() || "환불",
    });
  };

  const cancelEdit = () => setEditing(null);

  const saveEdit = async () => {
    if (!editing) return;
    setEditingSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/courses/${encodeURIComponent(editing.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courseKey: editing.courseKey,
          clubId: editing.clubId || "",
          cafeUrl: editing.cafeUrl || "",
          openchatChatRoomId: editing.openchatChatRoomId || "",
          openchatNoticeRoomId: editing.openchatNoticeRoomId || "",
          premiumEnabled: Boolean(editing.premiumEnabled),
          openchatPremiumRoomId: editing.openchatPremiumRoomId || "",
          vipEnabled: Boolean(editing.vipEnabled),
          openchatVipRoomId: editing.openchatVipRoomId || "",
          paymentSheetId: String(editing.paymentSheetId || ""),
          paymentSheetName: String(editing.paymentSheetName || ""),
          paymentHeaderRow: editing.paymentHeaderRow ?? 19,
          paymentGradeCol: String(editing.paymentGradeCol || ""),
          paymentNicknameCol: String(editing.paymentNicknameCol || ""),
          paymentNameCol: String(editing.paymentNameCol || ""),
          paymentIdCol: String(editing.paymentIdCol || ""),
          paymentKindCol: String(editing.paymentKindCol || ""),
          paymentExcludeKinds: String(editing.paymentExcludeKinds || ""),
        }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) {
        if (res.status === 403) setError("관리자만 수정할 수 있어요.");
        else setError(String(j?.error || "저장에 실패했어요."));
        return;
      }
      setEditing(null);
      await load();
    } finally {
      setEditingSaving(false);
    }
  };

  const archiveCourse = async (courseId: string) => {
    if (!window.confirm("이 강의를 목록에서 숨길까요? (필요하면 복구할 수 있어요)")) return;
    setError("");
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, { method: "DELETE" });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      if (res.status === 403) setError("관리자만 삭제할 수 있어요.");
      else setError(String(j?.error || "삭제에 실패했어요."));
      return;
    }
    if (editing?.id === courseId) setEditing(null);
    await load();
  };

  const restoreCourse = async (courseId: string) => {
    setError("");
    const res = await fetch(`/api/courses/${encodeURIComponent(courseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
    const j = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      if (res.status === 403) setError("관리자만 복구할 수 있어요.");
      else setError(String(j?.error || "복구에 실패했어요."));
      return;
    }
    await load();
  };

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">새 강의 등록</div>
        <div className="mt-1 text-sm text-slate-600">
          강의별로 카페/톡방을 묶어서 관리해요. (새 강의 등록은 관리자만 가능)
        </div>

        {!isAdmin ? (
          <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">
            관리자만 강의 등록/수정/삭제가 가능해요.
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-3">
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
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
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

        <div className="mt-4 rounded-2xl border bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-800">결제 SSOT 시트(읽기)</div>
          <div className="mt-1 text-sm text-slate-600">결제 확인용 구글 시트를 강의별로 연결해요. (쓰기 없이 읽기만 사용)</div>

          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <div className="md:col-span-2">
              <div className="text-xs font-medium text-slate-500">결제 시트 URL 또는 ID</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentSheetId}
                onChange={(e) => setPaymentSheetId(e.target.value)}
                placeholder="https://docs.google.com/spreadsheets/d/..."
              />
              <div className="mt-1 text-xs text-slate-500">비공개 시트라면 서비스 계정 이메일에 뷰어 권한 공유가 필요해요.</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">시트 탭 이름</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentSheetName}
                onChange={(e) => setPaymentSheetName(e.target.value)}
                placeholder="예: 종합"
                disabled={!paymentSheetId.trim()}
              />
              <div className="mt-1 text-xs text-slate-500">기본값: 종합</div>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-medium text-slate-500">헤더 행</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentHeaderRow}
                onChange={(e) => setPaymentHeaderRow(e.target.value)}
                placeholder="예: 19"
                disabled={!paymentSheetId.trim()}
              />
              <div className="mt-1 text-xs text-slate-500">기본값: 19</div>
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">등급 컬럼명</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentGradeCol}
                onChange={(e) => setPaymentGradeCol(e.target.value)}
                disabled={!paymentSheetId.trim()}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">닉네임 컬럼명</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentNicknameCol}
                onChange={(e) => setPaymentNicknameCol(e.target.value)}
                disabled={!paymentSheetId.trim()}
              />
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-medium text-slate-500">아이디 컬럼명</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentIdCol}
                onChange={(e) => setPaymentIdCol(e.target.value)}
                disabled={!paymentSheetId.trim()}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">성함 컬럼명</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentNameCol}
                onChange={(e) => setPaymentNameCol(e.target.value)}
                disabled={!paymentSheetId.trim()}
              />
            </div>
            <div>
              <div className="text-xs font-medium text-slate-500">구분 컬럼명</div>
              <input
                className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                value={paymentKindCol}
                onChange={(e) => setPaymentKindCol(e.target.value)}
                disabled={!paymentSheetId.trim()}
              />
            </div>
          </div>

          <div className="mt-3">
            <div className="text-xs font-medium text-slate-500">제외 구분(쉼표로 여러 개)</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={paymentExcludeKinds}
              onChange={(e) => setPaymentExcludeKinds(e.target.value)}
              placeholder="예: 환불, 취소"
              disabled={!paymentSheetId.trim()}
            />
            <div className="mt-1 text-xs text-slate-500">기본값: 환불</div>
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
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm font-semibold">등록된 강의</div>
          {isAdmin ? (
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
              삭제된 강의도 보기
            </label>
          ) : null}
        </div>

        <div className="mt-3 space-y-2">
          {courses.map((c) => {
            const isEditing = Boolean(editing && editing.id === c.id);
            const archived = Boolean(c.archived);
            return (
              <div key={c.id} className="rounded-xl border bg-slate-50 p-3 text-sm">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="truncate font-semibold">{c.courseKey}</div>
                      {archived ? <span className="rounded-full bg-slate-200 px-2 py-0.5 text-xs font-medium text-slate-700">삭제됨</span> : null}
                    </div>
                    <div className="mt-1 text-slate-600">
                      카페: {c.cafeUrl || "-"} · clubId: {c.clubId || "-"}
                    </div>
                  </div>

                  {isAdmin ? (
                    <div className="flex shrink-0 items-center gap-2">
                      {archived ? (
                        <button
                          onClick={() => restoreCourse(c.id)}
                          className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                        >
                          복구
                        </button>
                      ) : isEditing ? (
                        <>
                          <button
                            onClick={saveEdit}
                            disabled={editingSaving}
                            className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                          >
                            {editingSaving ? "저장 중..." : "저장"}
                          </button>
                          <button
                            onClick={cancelEdit}
                            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                          >
                            취소
                          </button>
                          <button
                            onClick={() => archiveCourse(c.id)}
                            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            onClick={() => beginEdit(c)}
                            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                          >
                            수정
                          </button>
                          <button
                            onClick={() => archiveCourse(c.id)}
                            className="rounded-lg border bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
                          >
                            삭제
                          </button>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>

                {isEditing && editing ? (
                  <div className="mt-4 space-y-3">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div>
                        <div className="text-xs font-medium text-slate-500">강의 이름</div>
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={editing.courseKey}
                          onChange={(e) => setEditing((p) => (p ? { ...p, courseKey: e.target.value } : p))}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500">카페 주소</div>
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={editing.cafeUrl || ""}
                          onChange={(e) => setEditing((p) => (p ? { ...p, cafeUrl: e.target.value } : p))}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500">카페 clubId</div>
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={editing.clubId || ""}
                          onChange={(e) => setEditing((p) => (p ? { ...p, clubId: e.target.value } : p))}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div>
                        <div className="text-xs font-medium text-slate-500">사담방 ID</div>
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={editing.openchatChatRoomId || ""}
                          onChange={(e) => setEditing((p) => (p ? { ...p, openchatChatRoomId: e.target.value } : p))}
                        />
                      </div>
                      <div>
                        <div className="text-xs font-medium text-slate-500">공지방 ID</div>
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={editing.openchatNoticeRoomId || ""}
                          onChange={(e) => setEditing((p) => (p ? { ...p, openchatNoticeRoomId: e.target.value } : p))}
                        />
                      </div>
                    </div>

                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="rounded-xl bg-white p-3">
                        <label className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-700">프리미엄 방 사용</div>
                          <input
                            type="checkbox"
                            checked={Boolean(editing.premiumEnabled)}
                            onChange={(e) => setEditing((p) => (p ? { ...p, premiumEnabled: e.target.checked } : p))}
                          />
                        </label>
                        <div className="mt-2">
                          <div className="text-xs font-medium text-slate-500">프리미엄방 ID</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={editing.openchatPremiumRoomId || ""}
                            onChange={(e) => setEditing((p) => (p ? { ...p, openchatPremiumRoomId: e.target.value } : p))}
                            disabled={!editing.premiumEnabled}
                          />
                        </div>
                      </div>

                      <div className="rounded-xl bg-white p-3">
                        <label className="flex items-center justify-between gap-3">
                          <div className="text-sm font-medium text-slate-700">VIP 방 사용</div>
                          <input
                            type="checkbox"
                            checked={Boolean(editing.vipEnabled)}
                            onChange={(e) => setEditing((p) => (p ? { ...p, vipEnabled: e.target.checked } : p))}
                          />
                        </label>
                        <div className="mt-2">
                          <div className="text-xs font-medium text-slate-500">VIP방 ID</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={editing.openchatVipRoomId || ""}
                            onChange={(e) => setEditing((p) => (p ? { ...p, openchatVipRoomId: e.target.value } : p))}
                            disabled={!editing.vipEnabled}
                          />
                        </div>
                      </div>

                      <div className="rounded-xl bg-white p-3 text-sm text-slate-600">
                        <div className="font-medium text-slate-700">결제 시트</div>
                        <div className="mt-1">{String(editing.paymentSheetId || "").trim() ? "설정됨" : "미설정"}</div>
                      </div>
                    </div>

                    <div className="rounded-2xl border bg-white p-4">
                      <div className="text-sm font-semibold text-slate-800">결제 SSOT 시트(읽기)</div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div className="md:col-span-2">
                          <div className="text-xs font-medium text-slate-500">결제 시트 URL 또는 ID</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentSheetId || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentSheetId: e.target.value } : p))}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500">시트 탭 이름</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentSheetName || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentSheetName: e.target.value } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div>
                          <div className="text-xs font-medium text-slate-500">헤더 행</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentHeaderRow ?? 19)}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentHeaderRow: Number(e.target.value || "19") } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500">등급 컬럼명</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentGradeCol || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentGradeCol: e.target.value } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500">닉네임 컬럼명</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentNicknameCol || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentNicknameCol: e.target.value } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 md:grid-cols-3">
                        <div>
                          <div className="text-xs font-medium text-slate-500">아이디 컬럼명</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentIdCol || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentIdCol: e.target.value } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500">성함 컬럼명</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentNameCol || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentNameCol: e.target.value } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                        <div>
                          <div className="text-xs font-medium text-slate-500">구분 컬럼명</div>
                          <input
                            className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                            value={String(editing.paymentKindCol || "")}
                            onChange={(e) => setEditing((p) => (p ? { ...p, paymentKindCol: e.target.value } : p))}
                            disabled={!String(editing.paymentSheetId || "").trim()}
                          />
                        </div>
                      </div>
                      <div className="mt-3">
                        <div className="text-xs font-medium text-slate-500">제외 구분(쉼표로 여러 개)</div>
                        <input
                          className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
                          value={String(editing.paymentExcludeKinds || "")}
                          onChange={(e) => setEditing((p) => (p ? { ...p, paymentExcludeKinds: e.target.value } : p))}
                          disabled={!String(editing.paymentSheetId || "").trim()}
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">사담방: {c.openchatChatRoomId || "-"}</div>
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">공지방: {c.openchatNoticeRoomId || "-"}</div>
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">
                      프리미엄: {c.premiumEnabled ? c.openchatPremiumRoomId || "-" : "사용 안 함"}
                    </div>
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700">VIP: {c.vipEnabled ? c.openchatVipRoomId || "-" : "사용 안 함"}</div>
                    <div className="rounded-lg bg-white px-3 py-2 text-xs text-slate-700 md:col-span-2">
                      결제 시트: {String(c.paymentSheetId || "").trim() ? `설정됨 (탭: ${c.paymentSheetName || "종합"}, 헤더: ${c.paymentHeaderRow || 19})` : "미설정"}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {courses.length === 0 ? <div className="text-sm text-slate-600">아직 등록된 강의가 없어요.</div> : null}
        </div>
      </div>
    </div>
  );
}
