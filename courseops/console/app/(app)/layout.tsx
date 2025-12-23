import { redirect } from "next/navigation";

import AppShell from "./ui/AppShell";
import { getSession } from "@/lib/session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login");
  return <AppShell userName={session.name}>{children}</AppShell>;
}

