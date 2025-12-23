import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin";
import { coursesStore } from "@/lib/store";

const CreateBody = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요."),
  enabled: z.boolean().optional().default(true),
  canSync: z.boolean().optional().default(true),
});

export async function GET() {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = await coursesStore();
  const users = await store.listUsers();
  return NextResponse.json({ users });
}

export async function POST(req: Request) {
  try {
    await requireAdminSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = CreateBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "입력값이 올바르지 않아요." }, { status: 400 });
  }

  const store = await coursesStore();
  const user = await store.upsertUser({
    name: parsed.data.name,
    enabled: parsed.data.enabled,
    canSync: parsed.data.canSync,
  });
  return NextResponse.json({ user });
}

