export default function RosterPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold">전체 명단</h1>
        <p className="mt-1 text-sm text-slate-600">통합 명단 뷰는 다음 단계에서 연결해요.</p>
      </div>
      <div className="rounded-2xl border bg-white p-6 text-sm text-slate-600">
        목표: “멤버별 방 참여 현황 / 닉네임 규칙 위반 / 권한 꼬임 / 운영진 예외”를 한눈에 보이도록 표로 제공.
      </div>
    </div>
  );
}

