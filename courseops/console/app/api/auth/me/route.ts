import { NextResponse } from "next/server";

import { canSyncNameResolved, isAdminName, isCourseManagerName } from "@/lib/admin";
import { requireSession } from "@/lib/session";

export async function GET() {
  try {
    const session = await requireSession();
    const canSync = await canSyncNameResolved(session.name);
    return NextResponse.json({
      session,
      isAdmin: isAdminName(session.name),
      isCourseManager: isCourseManagerName(session.name),
      canSync,
    });
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
}
