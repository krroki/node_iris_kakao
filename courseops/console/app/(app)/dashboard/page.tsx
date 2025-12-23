export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">대시보드</h1>
        <p className="mt-1 text-sm text-slate-600">요약 지표는 다음 단계에서 연결해요.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-4">
        {[
          { title: "대기 작업", value: "-" },
          { title: "확인 대기", value: "-" },
          { title: "프리미엄 트랙", value: "-" },
          { title: "운영 준수율", value: "-" },
        ].map((c) => (
          <div key={c.title} className="rounded-2xl border bg-white p-4 shadow-sm">
            <div className="text-sm text-slate-500">{c.title}</div>
            <div className="mt-2 text-2xl font-semibold">{c.value}</div>
          </div>
        ))}
      </div>
      <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">
        차트/분포/준수율 계산은 “데이터(카페/톡방/결제SSOT) → 통합 레코드 → 규칙 판정” 연결이 필요해요.
      </div>
    </div>
  );
}

