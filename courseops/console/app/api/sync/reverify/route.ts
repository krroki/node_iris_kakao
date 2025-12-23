import { NextResponse } from "next/server";
import { z } from "zod";

import { requireSyncSession } from "@/lib/admin";
import { coursesStore } from "@/lib/store";
import { fetchActionsFromSheet } from "@/lib/sheets";

const Body = z.object({ courseId: z.string().min(1) });

export async function POST(req: Request) {
  let session;
  try {
    session = await requireSyncSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "입력값이 올바르지 않아요." }, { status: 400 });

  const store = await coursesStore();
  const course = await store.getCourse(parsed.data.courseId);
  if (!course) return NextResponse.json({ error: "강의를 찾지 못했어요." }, { status: 404 });

  const raw = await fetchActionsFromSheet({ sheetId: course.sheetId, actionsTab: course.actionsTab });
  const states = await store.getActionStates(course.id, raw.items.map((it) => it.key));
  const waitingKeys = new Set(states.filter((s) => s.status === "확인 대기").map((s) => s.actionKey));

  const pending = raw.items
    .filter((it) => waitingKeys.has(it.key))
    .map((it) => ({ actionKey: it.key, action: it.action, target: it.target, rooms: it.rooms }));

  const job = await store.enqueueJob({
    courseId: course.id,
    kind: "REVERIFY_PENDING",
    requestedBy: session.name,
    payload: { items: pending },
  });

  return NextResponse.json({ job, count: pending.length });
}
