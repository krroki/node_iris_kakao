import { NextResponse } from "next/server";

import { isAdminName } from "@/lib/admin";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await requireSession();
    return NextResponse.json({ session, isAdmin: isAdminName(session.name) });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}

