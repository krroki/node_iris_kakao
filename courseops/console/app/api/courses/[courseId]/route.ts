import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCourseManagerSession } from "@/lib/admin";
import { coursesStore } from "@/lib/store";

const PatchBody = z
  .object({
    courseKey: z.string().trim().min(1).optional(),
    clubId: z.string().trim().optional(),
    cafeUrl: z.string().trim().optional(),
    openchatChatRoomId: z.string().trim().optional(),
    openchatNoticeRoomId: z.string().trim().optional(),
    premiumEnabled: z.boolean().optional(),
    openchatPremiumRoomId: z.string().trim().optional(),
    vipEnabled: z.boolean().optional(),
    openchatVipRoomId: z.string().trim().optional(),
    paymentSheetId: z.string().trim().optional(),
    paymentSheetName: z.string().trim().optional(),
    paymentHeaderRow: z.coerce.number().int().min(1).optional(),
    paymentGradeCol: z.string().trim().optional(),
    paymentNicknameCol: z.string().trim().optional(),
    paymentNameCol: z.string().trim().optional(),
    paymentIdCol: z.string().trim().optional(),
    paymentKindCol: z.string().trim().optional(),
    paymentExcludeKinds: z.string().trim().optional(),
    archived: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.premiumEnabled === true && !String(data.openchatPremiumRoomId || "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openchatPremiumRoomId"], message: "프리미엄방 ID를 입력해 주세요." });
    }
    if (data.vipEnabled === true && !String(data.openchatVipRoomId || "").trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["openchatVipRoomId"], message: "VIP방 ID를 입력해 주세요." });
    }
  });

export async function PATCH(req: Request, { params }: { params: { courseId: string } }) {
  let session;
  try {
    session = await requireCourseManagerSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const parsed = PatchBody.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message || "입력값이 올바르지 않아요." }, { status: 400 });
  }

  const store = await coursesStore();
  try {
    let course = await store.getCourse(params.courseId, { includeArchived: true });
    if (!course) return NextResponse.json({ error: "강의를 찾지 못했어요." }, { status: 404 });

    const { archived, ...patch } = parsed.data;
    const hasPatch = Object.keys(patch).some((k) => (patch as any)[k] !== undefined);
    if (hasPatch) {
      course = await store.updateCourse(course.id, patch as any);
    }
    if (typeof archived === "boolean") {
      course = await store.setCourseArchived({ courseId: course.id, archived, by: session.name });
    }
    return NextResponse.json({ course });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || "저장에 실패했어요.") }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { courseId: string } }) {
  let session;
  try {
    session = await requireCourseManagerSession();
  } catch {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const store = await coursesStore();
  try {
    const course = await store.getCourse(params.courseId, { includeArchived: true });
    if (!course) return NextResponse.json({ error: "강의를 찾지 못했어요." }, { status: 404 });
    const updated = await store.setCourseArchived({ courseId: course.id, archived: true, by: session.name });
    return NextResponse.json({ course: updated });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || "삭제에 실패했어요.") }, { status: 500 });
  }
}
