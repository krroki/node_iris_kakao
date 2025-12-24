import { redirect } from "next/navigation";
import { requireCourseManagerSession } from "@/lib/admin";
import CourseAdminView from "./ui/CourseAdminView";

export default async function CoursesPage() {
  try {
    await requireCourseManagerSession();
  } catch {
    redirect("/queue");
  }
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">강의 관리</h1>
        <p className="mt-1 text-sm text-slate-600">강의 등록/수정 및 결제 SSOT 연동 설정을 관리합니다.</p>
      </div>
      <CourseAdminView />
    </div>
  );
}
