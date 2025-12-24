"use client";

import { useEffect, useState } from "react";

type UserRow = {
  name: string;
  enabled: boolean;
  canSync: boolean;
  createdAt: string;
  updatedAt: string | null;
};

function formatTs(ts: string | null) {
  if (!ts) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString("ko-KR");
}

export default function AccountsView() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [canSync, setCanSync] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "불러오지 못했어요."));
      const list: UserRow[] = Array.isArray(j?.users) ? j.users : [];
      setUsers(list);
    } catch (e: any) {
      setError(String(e?.message || "불러오지 못했어요."));
      setUsers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const addUser = async () => {
    const n = name.trim();
    if (!n) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: n, enabled, canSync }),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "추가에 실패했어요."));
      setName("");
      setEnabled(true);
      setCanSync(true);
      await load();
    } catch (e: any) {
      setError(String(e?.message || "추가에 실패했어요."));
    } finally {
      setSaving(false);
    }
  };

  const patchUser = async (userName: string, patch: { enabled?: boolean; canSync?: boolean }) => {
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userName)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "변경에 실패했어요."));
      await load();
    } catch (e: any) {
      setError(String(e?.message || "변경에 실패했어요."));
    }
  };

  const deleteUser = async (userName: string) => {
    if (!confirm(`'${userName}' 계정을 삭제할까요?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(userName)}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as any;
      if (!res.ok) throw new Error(String(j?.error || "삭제에 실패했어요."));
      await load();
    } catch (e: any) {
      setError(String(e?.message || "삭제에 실패했어요."));
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">접속 방법</div>
        <div className="mt-2 text-sm text-slate-600">
          1) `go.yoorang.kr` 접속
          <br />
          2) 이름 + 공용 비밀번호로 로그인
          <br />
          3) 계정을 등록하기 시작하면, 등록된 사람만 로그인할 수 있어요. (관리자는 항상 가능)
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="text-sm font-semibold">계정 추가</div>
        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div className="md:col-span-2">
            <div className="text-xs font-medium text-slate-500">이름</div>
            <input
              className="mt-1 w-full rounded-lg border px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예) 홍길동"
            />
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <label className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-700">접속 허용</div>
              <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            </label>
            <div className="mt-1 text-xs text-slate-500">OFF면 로그인 차단</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-3">
            <label className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-700">동기화 허용</div>
              <input type="checkbox" checked={canSync} onChange={(e) => setCanSync(e.target.checked)} />
            </label>
            <div className="mt-1 text-xs text-slate-500">OFF면 조회만 가능</div>
          </div>
        </div>

        {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={addUser}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
          >
            {saving ? "추가 중..." : "추가"}
          </button>
          <button
            onClick={load}
            disabled={loading}
            className="rounded-lg border bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 disabled:opacity-60"
          >
            {loading ? "불러오는 중..." : "새로고침"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold">등록된 계정</div>
          <div className="text-xs text-slate-500">총 {users.length}명</div>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-[760px] w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>
                <th className="px-4 py-3">이름</th>
                <th className="px-4 py-3">접속</th>
                <th className="px-4 py-3">동기화</th>
                <th className="px-4 py-3">수정</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.name} className="border-t">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{u.name}</div>
                    <div className="mt-0.5 text-xs text-slate-500">생성: {formatTs(u.createdAt)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={u.enabled}
                        onChange={(e) => patchUser(u.name, { enabled: e.target.checked })}
                      />
                      <span className="text-sm">{u.enabled ? "허용" : "차단"}</span>
                    </label>
                  </td>
                  <td className="px-4 py-3">
                    <label className="inline-flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={u.canSync}
                        onChange={(e) => patchUser(u.name, { canSync: e.target.checked })}
                        disabled={!u.enabled}
                      />
                      <span className="text-sm">{u.canSync ? "허용" : "조회만"}</span>
                    </label>
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-600">{formatTs(u.updatedAt)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => deleteUser(u.name)}
                      className="rounded-lg border bg-white px-3 py-2 text-sm font-medium hover:bg-slate-50"
                    >
                      삭제
                    </button>
                  </td>
                </tr>
              ))}
              {!loading && users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-600">
                    아직 등록된 계정이 없어요.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
