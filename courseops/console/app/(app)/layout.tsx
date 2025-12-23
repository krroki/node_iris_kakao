import { redirect } from "next/navigation";

import AppShell from "./ui/AppShell";
import { canSyncNameResolved, isAdminName } from "@/lib/admin";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const canSync = await canSyncNameResolved(session.name);
  const isAdmin = isAdminName(session.name);
  return (
    <AppShell userName={session.name} canSync={canSync} isAdmin={isAdmin}>
      {children}
    </AppShell>
  );
}
