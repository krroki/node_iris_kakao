import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCourseManagerSession } from "@/lib/admin";
import { coursesStore } from "@/lib/store";

const PatchBody = z
  .object({
    enabled: z.boolean().optional(),
    canSync: z.boolean().optional(),
  })
  .refine((v) => typeof v.enabled === "boolean" || typeof v.canSync === "boolean", {
    message: "변경할 값을 선택해 주세요.",
  });

export async function PATCH(req: Request, { params }: { params: { name: string } }) {
  try {
    await requireCourseManagerSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "입력값이 올바르지 않아요." }, { status: 400 });
  }

  const name = String(params.name || "").trim();
  const store = await coursesStore();
  const existing = await store.getUser(name);
  if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const user = await store.upsertUser({
    name,
    enabled: typeof parsed.data.enabled === "boolean" ? parsed.data.enabled : existing.enabled,
    canSync: typeof parsed.data.canSync === "boolean" ? parsed.data.canSync : existing.canSync,
  });
  return NextResponse.json({ user });
}

export async function DELETE(_req: Request, { params }: { params: { name: string } }) {
  try {
    await requireCourseManagerSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const name = String(params.name || "").trim();
  const store = await coursesStore();
  await store.deleteUser(name);
  return NextResponse.json({ ok: true });
}
