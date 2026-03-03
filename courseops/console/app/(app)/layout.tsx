import { redirect } from "next/navigation";

import AppShell from "./ui/AppShell";
import { canSyncNameResolved, isCourseManagerName } from "@/lib/admin";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canSync = await canSyncNameResolved(session.name);
  const isCourseManager = isCourseManagerName(session.name);
  return (
    <AppShell userName={session.name} canSync={canSync} isCourseManager={isCourseManager}>
      {children}
    </AppShell>
  );
}
