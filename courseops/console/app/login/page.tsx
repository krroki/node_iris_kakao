import LoginForm from "./ui/LoginForm";

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border bg-white shadow-sm">
        <div className="px-6 pt-6 pb-4">
          <div className="text-sm text-slate-500">CourseOps v2</div>
          <h1 className="mt-1 text-xl font-semibold">로그인</h1>
          <p className="mt-2 text-sm text-slate-600">이름과 비밀번호로 접속해요.</p>
        </div>
        <div className="px-6 pb-6">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}

