import { NextResponse } from "next/server";
import { z } from "zod";

import { isCourseManagerName, requireCourseManagerSession } from "@/lib/admin";
import { requireSession } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const CreateBody = z
  .object({
    courseKey: z.string().trim().min(1, "강의 이름을 입력해 주세요."),
    clubId: z.string().trim().optional().default(""),
    cafeUrl: z.string().trim().optional().default(""),
    openchatChatRoomId: z.string().trim().min(1, "사담방 ID를 입력해 주세요."),
    openchatNoticeRoomId: z.string().trim().min(1, "공지방 ID를 입력해 주세요."),
    premiumEnabled: z.boolean().optional().default(true),
    openchatPremiumRoomId: z.string().trim().optional().default(""),
    vipEnabled: z.boolean().optional().default(false),
    openchatVipRoomId: z.string().trim().optional().default(""),
    paymentSheetId: z.string().trim().optional().default(""),
    paymentSheetName: z.string().trim().optional().default(""),
    paymentHeaderRow: z.coerce.number().int().min(1).optional().default(19),
    paymentGradeCol: z.string().trim().optional().default("카페 등급"),
    paymentNicknameCol: z.string().trim().optional().default("닉네임"),
    paymentNameCol: z.string().trim().optional().default("성함"),
    paymentIdCol: z.string().trim().optional().default("아이디"),
    paymentKindCol: z.string().trim().optional().default("구분"),
    paymentExcludeKinds: z.string().trim().optional().default("환불"),
  })
  .superRefine((data, ctx) => {
    if (data.premiumEnabled && !String(data.openchatPremiumRoomId || "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openchatPremiumRoomId"], message: "프리미엄방 ID를 입력해 주세요." });
    }
    if (data.vipEnabled && !String(data.openchatVipRoomId || "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openchatVipRoomId"], message: "VIP방 ID를 입력해 주세요." });
    }
  });

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const includeArchived = url.searchParams.get("includeArchived") === "1";      
  const canSeeArchived = includeArchived && isCourseManagerName(session.name);
  const store = await coursesStore();
  const courses = await store.listCourses({ includeArchived: canSeeArchived }); 
  return NextResponse.json({ courses });
}

export async function POST(req: Request) {
  try {
    await requireCourseManagerSession();
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
