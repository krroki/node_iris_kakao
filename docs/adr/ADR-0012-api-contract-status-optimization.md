# ADR-0012: API 계약 정합성 및 상태 체크 경량화

**Status**: Accepted
**Date**: 2025-12-04
**Deciders**: Claude Code, 운영자

## Context

### 문제 1: API 응답 형식 불일치
KB Service와 대시보드 간 API 계약이 명시되지 않아 다음 문제 발생:
- 프론트엔드에서 404 에러 (`/backfill/status`, `/jobs/running` 미존재)
- `ok` 필드 누락으로 성공/실패 판단 불가
- `/menus` 응답에 `groups`, `names` 필드 누락

### 문제 2: 대시보드 상태 체크 과부하
`/api/status` 호출 시마다 PowerShell 스크립트 실행:
```typescript
// 기존 방식 (매 요청마다 ~3초 소요)
await execFileAsync('powershell.exe', ['-File', 'check_redroid_iris.ps1']);
```
- 10초 간격 폴링 × PowerShell 오버헤드 = CPU/메모리 낭비
- 스크립트 실패 시 전체 상태 조회 실패

### 문제 3: 봇 종료 API 안전성 부재
`Stop-Process -Name node` 사용 시 다른 Node 앱(Codex, Claude Code 등)도 종료되는 치명적 문제.

### 문제 4: SSE 프록시 실패 시 무음 fallback
FastAPI SSE 연결 실패 시 조용히 로컬 파일 모드로 전환:
- 사용자가 장애를 인지하지 못함
- AGENTS 지침의 "fallback 금지" 원칙 위반

## Options Considered

### 상태 체크 방식
1. **매 요청 PowerShell 실행** (기존) - 느리고 비효율
2. **캐시 파일 + 주기적 갱신** (선택) - 빠르고 효율적
3. **백그라운드 워커** - 복잡도 증가

### 봇 종료 방식
1. **Stop-Process -Name node** (기존) - 위험
2. **PID 지정 + 패턴 검증 스크립트** (선택) - 안전

## Decision

### 1. API 계약 표준화
모든 KB Service 엔드포인트에 `ok: boolean` 필드 추가:
```python
# kb/service.py
@app.post("/ask")
def ask(req: AskRequest):
    return {"ok": True, "query": req.query, **res}
```

신규 엔드포인트 추가:
- `GET /backfill/status` - 백필 진행 상태
- `GET /jobs/running` - 실행 중인 작업 목록

문서화:
- `docs/api-contract.md` - API 스키마 SSOT
- `web/src/types/api.ts` - TypeScript 타입 정의

### 2. 상태 체크 캐시화
```
┌─────────────────────────────────────────────────┐
│  GET /api/status                                 │
│  └─> device_health_cache.json 읽기 (즉시)        │
└─────────────────────────────────────────────────┘
                    ▲
                    │ 갱신
┌─────────────────────────────────────────────────┐
│  POST /api/device/repair                         │
│  └─> repair_redroid_iris.ps1 실행               │
│  └─> 캐시 갱신                                   │
└─────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────┐
│  GET /api/device/health (신규)                   │
│  └─> IRIS /health 호출 (5초 타임아웃)            │
│  └─> 캐시 갱신                                   │
└─────────────────────────────────────────────────┘
```

대시보드 UI 진입 시 자동 헬스 체크 (2분 간격):
```typescript
// web/src/app/page.tsx
useEffect(() => {
  refreshDeviceHealth(); // 최초 로드
  const healthId = setInterval(refreshDeviceHealth, 2 * 60 * 1000);
  return () => clearInterval(healthId);
}, []);
```

### 3. 봇 종료 안전장치
```powershell
# windows/stop_bot.ps1
$cmd = $proc.CommandLine
if (-not ($cmd -like '*node-iris-app*' -or $cmd -like '*dist\index.js*')) {
    Write-Error "PID $Pid is not a node-iris-app process"
    exit 2
}
```

API에서 스크립트 경유:
```typescript
// web/src/app/api/bot/processes/route.ts
// NOTE: (ADR-0012) 직접 Stop-Process 금지, 스크립트 경유
const script = path.join(ROOT, 'windows', 'stop_bot.ps1');
await execFileAsync('powershell.exe', ['-File', script, '-Pid', pid]);
```

### 4. SSE fallback 경고
```typescript
// web/src/app/api/stream/route.ts
if (proxyError) {
  push({
    type: "warning",
    code: "proxy_failed",
    message: `FastAPI SSE 연결 실패 (${proxyError}). 로컬 파일 모드로 동작 중입니다.`,
    localMode: true,
  });
}
```

### 5. 로그 파서 일관성
서버(`log_utils.py`)와 클라이언트(`logs.ts`) 동일 규칙:
- `message_debug` 레코드 스킵
- `uid` 필드 생성 (rawJson.id → messageId → text fingerprint)
- 2초 윈도우 sender+text 중복 제거

## Consequences

### 긍정적
- `/api/status` 응답 시간: ~3초 → ~50ms
- API 계약 명시로 프론트/백엔드 불일치 방지
- 봇 종료 시 다른 Node 앱 보호
- SSE 장애 시 사용자에게 명시적 경고
- 회귀 테스트로 계약 위반 조기 감지

### 부정적/주의사항
- 캐시 TTL(5분) 내 실제 장애 감지 지연 가능
  - 완화: UI 진입 시 즉시 헬스 체크 + 2분 간격 갱신
- `stop_bot.ps1` 패턴 변경 시 스크립트 업데이트 필요

## Links

- PR: (이 ADR과 함께 커밋)
- 관련 파일:
  - `kb/service.py` - API 엔드포인트
  - `web/src/app/api/status/route.ts` - 캐시 기반 상태
  - `web/src/app/api/device/health/route.ts` - 경량 헬스체크
  - `windows/stop_bot.ps1` - 안전한 봇 종료
  - `web/src/app/api/stream/route.ts` - SSE 경고 이벤트
  - `docs/api-contract.md` - API 계약 문서
  - `tests/test_kb_contract.py` - 회귀 테스트
