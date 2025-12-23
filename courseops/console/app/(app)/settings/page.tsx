import SettingsView from "./ui/SettingsView";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">설정</h1>
        <p className="mt-1 text-sm text-slate-600">데이터 소스와 권한을 설정해요.</p>
      </div>
      <SettingsView />
    </div>
  );
}

