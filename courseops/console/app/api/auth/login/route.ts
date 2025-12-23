import { NextResponse } from "next/server";
import { z } from "zod";

import { isAdminName } from "@/lib/admin";
import { setSessionCookie } from "@/lib/session";
import { coursesStore } from "@/lib/store";

const Body = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요."),
  password: z.string().min(1, "비밀번호를 입력해 주세요."),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message || "입력값이 올바르지 않아요." }, { status: 400 });
  }

  const name = body.data.name;
  const admin = isAdminName(name);

  const shared = String(process.env.COURSEOPS_SHARED_PASSWORD || "");
  if (!shared) {
    return NextResponse.json({ error: "서버 설정이 필요해요(비밀번호 미설정)." }, { status: 500 });
  }
  if (body.data.password !== shared) {
    return NextResponse.json({ error: "이름 또는 비밀번호가 올바르지 않아요." }, { status: 401 });
  }

  // 계정 테이블(courseops_users)에 1명이라도 등록되어 있으면,
  // 등록된 계정(enabled=true)만 로그인 허용(관리자는 예외).
  if (!admin) {
    const store = await coursesStore();
    const hasUsers = await store.hasAnyUsers();
    if (hasUsers) {
      const u = await store.getUser(name);
      if (!u || !u.enabled) {
        return NextResponse.json({ error: "접속 권한이 없어요. 관리자에게 계정 등록을 요청해 주세요." }, { status: 403 });
      }
    }
  }

  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, { name });
  return res;
}
