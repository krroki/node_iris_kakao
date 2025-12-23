"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import TopBar from "./TopBar";

function NavItem({ href, label }: { href: string; label: string }) {
  const pathname = usePathname();
  const active = pathname === href;
  return (
    <Link
      href={href}
      className={[
        "flex items-center gap-2 rounded-lg px-3 py-2 text-sm",
        active ? "bg-brand-50 text-brand-700" : "text-slate-600 hover:bg-slate-100",
      ].join(" ")}
    >
      <span className={["h-2 w-2 rounded-full", active ? "bg-brand-600" : "bg-slate-300"].join(" ")} />
      {label}
    </Link>
  );
}

export default function AppShell({
  children,
  userName,
  canSync,
  isAdmin,
}: {
  children: React.ReactNode;
  userName: string;
  canSync: boolean;
  isAdmin: boolean;
}) {
  return (
    <div className="min-h-screen">
      <div className="flex">
        <aside className="hidden w-64 shrink-0 border-r bg-white p-4 md:block">
          <div className="flex items-center gap-2 px-2 py-2">
            <div className="h-8 w-8 rounded-lg bg-brand-600" />
            <div className="font-semibold">CourseOps v2</div>
          </div>
          <div className="mt-4 space-y-1">
            <NavItem href="/queue" label="작업 대기열" />
            <NavItem href="/dashboard" label="대시보드" />
            <NavItem href="/roster" label="전체 명단" />
            <NavItem href="/settings" label="설정" />
            {isAdmin ? <NavItem href="/accounts" label="계정 관리" /> : null}
          </div>
          <div className="mt-6 rounded-xl bg-slate-50 p-3 text-sm">
            <div className="text-slate-500">로그인</div>
            <div className="mt-1 font-medium">{userName}</div>
          </div>
        </aside>
        <main className="min-w-0 flex-1">
          <TopBar userName={userName} canSync={canSync} />
          <div className="p-4 md:p-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
