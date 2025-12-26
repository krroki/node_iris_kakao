import { NextResponse } from "next/server";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

function parseYmdDate(raw: string): Date | null {
  const s = String(raw || "").trim();
  if (!s) return null;
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!y || !mo || !d) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return dt;
}

function pickMainCafeClubId(payload: any): string {
  const fromPayload = String(payload?.clubId || payload?.club_id || "").trim();
  const fromEnv = String(process.env.COURSEOPS_MAIN_CAFE_CLUB_ID || process.env.COURSEOPS_MAIN_CAFE_URL || "").trim();
  const s = fromPayload || fromEnv || "30819883";
  const m = s.match(/(\d{5,})/);
  return m ? String(m[1]) : "";
}

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const store = await coursesStore();
  const snap = await store.getGlobalSnapshot("main_cafe");
  if (!snap) {
    return NextResponse.json({
      ok: true,
      snapshot: null,
      metrics: null,
    });
  }

  const payload = snap.payload ?? {};
  const clubId = pickMainCafeClubId(payload);
  const cafeUrl = clubId ? `https://cafe.naver.com/ManageWholeMember.nhn?clubid=${clubId}` : "";

  const fetchedAt = String(payload?.fetchedAt || snap.fetchedAt || snap.updatedAt || "").trim() || null;
  const ok = Boolean(payload?.ok);
  const error = String(payload?.error || "").trim() || null;
  const cafeName = String(payload?.cafeName || payload?.cafe_name || "메인 카페").trim() || "메인 카페";

  const members = Array.isArray(payload?.members) ? payload.members : [];
  const summary = payload?.summary && typeof payload.summary === "object" ? payload.summary : null;
  const totalCount = Math.max(
    0,
    Number(payload?.totalCount || payload?.total_count || summary?.total || summary?.totalCount || members.length || 0) || 0,
  );

  const ref = fetchedAt ? new Date(fetchedAt) : new Date();
  const refMs = Number.isNaN(ref.getTime()) ? Date.now() : ref.getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const withinDays = (dt: Date | null, days: number) => (dt ? refMs - dt.getTime() <= days * dayMs : false);

  let gradesTop: Array<{ grade: string; count: number }> = [];
  let joined7d = Math.max(0, Number(summary?.joined7d || 0) || 0);
  let visited7d = Math.max(0, Number(summary?.visited7d || 0) || 0);
  let visited30d = Math.max(0, Number(summary?.visited30d || 0) || 0);
  let activeRate7d = Math.max(0, Number(summary?.activeRate7d || 0) || 0);

  if (Array.isArray(summary?.gradesTop) && summary.gradesTop.length > 0) {
    gradesTop = summary.gradesTop
      .map((x: any) => ({
        grade: String(x?.grade || "").trim() || "기타",
        count: Math.max(0, Number(x?.count || 0) || 0),
      }))
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count)
      .slice(0, 8);
  } else {
    const gradeCounts: Record<string, number> = {};
    joined7d = 0;
    visited7d = 0;
    visited30d = 0;

    for (const m of members) {
      const grade = String(m?.grade || "").trim() || "기타";
      gradeCounts[grade] = (gradeCounts[grade] || 0) + 1;

      const joinDate = parseYmdDate(String(m?.joinDate || m?.join_date || ""));
      const lastVisit = parseYmdDate(String(m?.lastVisit || m?.last_visit || ""));
      if (withinDays(joinDate, 7)) joined7d += 1;
      if (withinDays(lastVisit, 7)) visited7d += 1;
      if (withinDays(lastVisit, 30)) visited30d += 1;
    }

    gradesTop = Object.entries(gradeCounts)
      .map(([grade, count]) => ({ grade, count }))
      .sort((a: { count: number }, b: { count: number }) => b.count - a.count)
      .slice(0, 8);

    activeRate7d = totalCount > 0 ? Math.round((visited7d / totalCount) * 100) : 0;
  }

  return NextResponse.json({
    ok: true,
    snapshot: {
      ok,
      fetchedAt,
      clubId: clubId || null,
      cafeName,
      cafeUrl: cafeUrl || null,
      error: ok ? null : error,
    },
    metrics: {
      total: totalCount,
      gradesTop,
      joined7d,
      visited7d,
      visited30d,
      activeRate7d,
    },
  });
}
