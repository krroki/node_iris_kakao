import { NextResponse } from "next/server";

import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";
import { parseActionsFromValues } from "@/lib/actions";
import { getSnapshotTables } from "@/lib/snapshot";

export async function GET(_req: Request, { params }: { params: { courseId: string } }) {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await coursesStore();
  const course = await store.getCourse(params.courseId);
  if (!course) return NextResponse.json({ error: "강의를 찾지 못했어요." }, { status: 404 });

  const snap = await store.getCourseSnapshot(course.id);
  const tables = getSnapshotTables(snap?.payload);
  const raw = parseActionsFromValues({ courseId: course.id, values: tables.actions });
  const state = await store.getActionStates(course.id, raw.items.map((it) => it.key));

  const byKey = new Map(state.map((s) => [s.actionKey, s]));
  const items = raw.items.map((it) => {
    const st = byKey.get(it.key);
    return {
      ...it,
      state: st
        ? {
            status: st.status,
            handledBy: st.handledBy,
            handledAt: st.handledAt,
            memo: st.memo,
          }
        : undefined,
    };
  });

  return NextResponse.json({ course, lastUpdatedAt: snap?.fetchedAt || raw.lastUpdatedAt, items });
}
