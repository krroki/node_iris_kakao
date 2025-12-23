import { NextResponse } from "next/server";
import { z } from "zod";

import { setSessionCookie } from "@/lib/session";

const Body = z.object({
  name: z.string().trim().min(1, "이름을 입력해 주세요."),
  password: z.string().min(1, "비밀번호를 입력해 주세요."),
});

export async function POST(req: Request) {
  const body = Body.safeParse(await req.json().catch(() => ({})));
  if (!body.success) {
    return NextResponse.json({ error: body.error.issues[0]?.message || "입력값이 올바르지 않아요." }, { status: 400 });
  }

  const shared = String(process.env.COURSEOPS_SHARED_PASSWORD || "");
  if (!shared) {
    return NextResponse.json({ error: "서버 설정이 필요해요(비밀번호 미설정)." }, { status: 500 });
  }
  if (body.data.password !== shared) {
    return NextResponse.json({ error: "이름 또는 비밀번호가 올바르지 않아요." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, { name: body.data.name });
  return res;
}

