# ADR-0011: Bot Singleton Mechanism

| 항목 | 내용 |
|------|------|
| **상태** | Accepted |
| **날짜** | 2025-12-03 |
| **결정자** | Claude Code + 운영자 |

## Context

봇이 중복 응답하는 문제가 발생했다. 원인 분석 결과:

1. **IRIS WebSocket 특성**: IRIS는 연결된 모든 클라이언트에게 동일한 메시지를 브로드캐스트
2. **다중 프로세스 실행**: 여러 봇 프로세스가 동시에 실행되어 각각 IRIS에 연결
3. **각 프로세스가 독립 응답**: 같은 메시지를 받은 N개의 프로세스가 각각 응답 → N번 중복 응답

실제 사례: 10개의 봇 프로세스가 동시 실행되어 질문당 3~5회 중복 응답 발생

## Options Considered

### Option 1: 메시지 레벨 중복 방지 (기존)
- `msgId` 기반 Set으로 중복 체크
- **한계**: 프로세스 간 상태 공유 불가, 각 프로세스가 독립적으로 응답

### Option 2: PID 락 파일 + 프로세스 강제 종료 (채택)
- 시작 시 락 파일 확인 → 기존 프로세스 종료 → 새 PID 기록
- **장점**: 단일 프로세스 보장
- **단점**: Windows에서 `process.kill()` 제한적 동작

### Option 3: 시작 스크립트에서 기존 프로세스 정리 (채택)
- PowerShell 스크립트가 시작 전 모든 봇 프로세스 종료
- **장점**: Windows 네이티브 명령으로 확실한 종료

## Decision

**Option 2 + Option 3 조합** 채택:

1. **`index.ts` PID 락**: 방어적 중복 방지 (1차)
2. **`smart_restart_bot.ps1` 필터 개선**: 확실한 프로세스 정리 (2차)

### 불변식 (Invariants)
- **봇 프로세스는 항상 1개만 실행되어야 한다**
- 봇 재시작 시 기존 프로세스를 먼저 종료해야 한다

## Implementation

### 1. `node-iris-app/src/index.ts` 수정
```typescript
const LOCK_FILE = path.join(__dirname, "../data/bot.lock");

function acquireLock(): boolean {
  // 기존 프로세스 확인 및 종료 시도
  // 현재 PID 기록
}
```

### 2. `windows/smart_restart_bot.ps1` 필터 개선
```powershell
# 기존: node-iris-app, iris*bot 만 매칭
# 개선: dist\index, dist/index 패턴 추가
if ($cmd -like "*node-iris-app*" -or $cmd -like "*iris*bot*" -or
    $cmd -like "*dist\index*" -or $cmd -like "*dist/index*") {
    Stop-Process -Id $_.ProcessId -Force
}
```

## Consequences

### 긍정적
- 중복 응답 문제 근본적 해결
- 운영 안정성 향상
- 수동 개입 없이 자동 정리

### 부정적
- Windows에서 Node.js `process.kill()` 제한으로 완전한 자동화 어려움
- PowerShell 스크립트 의존성

## Links
- 관련 코드: `node-iris-app/src/index.ts`, `windows/smart_restart_bot.ps1`
- 락 파일: `node-iris-app/data/bot.lock`
