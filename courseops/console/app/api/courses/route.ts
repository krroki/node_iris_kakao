import { NextResponse } from "next/server";
import { z } from "zod";

import { requireAdminSession } from "@/lib/admin";
import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const CreateBody = z
  .object({
    courseKey: z.string().trim().min(1, "강의 이름을 입력해 주세요."),
    clubId: z.string().trim().optional().default(""),
    sheetIdOrUrl: z.string().trim().min(1, "스프레드시트 URL 또는 ID를 입력해 주세요."),
    actionsTab: z.string().trim().min(1).default("ACTIONS"),
    cafeUrl: z.string().trim().optional().default(""),
    openchatChatRoomId: z.string().trim().min(1, "사담방 ID를 입력해 주세요."),
    openchatNoticeRoomId: z.string().trim().min(1, "공지방 ID를 입력해 주세요."),
    premiumEnabled: z.boolean().optional().default(true),
    openchatPremiumRoomId: z.string().trim().optional().default(""),
    vipEnabled: z.boolean().optional().default(false),
    openchatVipRoomId: z.string().trim().optional().default(""),
  })
  .superRefine((data, ctx) => {
    if (data.premiumEnabled && !String(data.openchatPremiumRoomId || "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openchatPremiumRoomId"], message: "프리미엄방 ID를 입력해 주세요." });
    }
    if (data.vipEnabled && !String(data.openchatVipRoomId || "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openchatVipRoomId"], message: "VIP방 ID를 입력해 주세요." });
    }
  });

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const store = await coursesStore();
  const courses = await store.listCourses();
  return NextResponse.json({ courses });
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
  try {
    const course = await store.createCourse(parsed.data);
    return NextResponse.json({ course });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || "저장에 실패했어요.") }, { status: 500 });
  }
}
