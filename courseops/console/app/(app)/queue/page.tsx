import QueueView from "./ui/QueueView";

export default function QueuePage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">작업 대기열</h1>
        <p className="mt-1 text-sm text-slate-600">조치가 필요한 항목을 그대로 처리해요.</p>
      </div>
      <QueueView />
    </div>
  );
}

