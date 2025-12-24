import SettingsView from "./ui/SettingsView";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">설정</h1>
        <p className="mt-1 text-sm text-slate-600">내 화면 설정을 관리합니다.</p>
      </div>
      <SettingsView />
    </div>
  );
}

