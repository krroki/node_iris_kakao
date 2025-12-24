import { redirect } from "next/navigation";

import { requireCourseManagerSession } from "@/lib/admin";
import AccountsView from "./ui/AccountsView";

export default async function AccountsPage() {
  try {
    await requireCourseManagerSession();
  } catch {
    redirect("/queue");
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">계정 관리</h1>
        <p className="mt-1 text-sm text-slate-600">
          운영진 계정을 등록/차단하고, 동기화 권한을 조절할 수 있어요.
        </p>
      </div>
      <AccountsView />
    </div>
  );
}
