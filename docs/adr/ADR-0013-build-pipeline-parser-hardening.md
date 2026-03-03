# ADR-0013: 빌드 파이프라인 강화 및 명령 파서 정책 확립

## Meta

- **Date**: 2025-12-05
- **Status**: Accepted
- **Authors**: 운영자, Claude (Opus 4.5)
- **Related ADR**: ADR-0011 (봇 싱글톤), ADR-0012 (API 계약)

## Context (배경)

### 문제 1: 소스-빌드 불일치 위험
- `node-iris-app/dist/`가 `.gitignore`에 추가되어 git에서 제외됨
- `start_bot.ps1`이 빌드 실패해도 구버전 `dist`로 실행될 수 있음
- 코드 변경 후 빌드 없이 기동 시 이전 버전 동작

### 문제 2: 명령 파서 정책 불명확
- `?` 단독으로도 명령 발동 가능했음
- 요구사항: `?디하클` 접두어일 때만 LLM 실행
- 모지바이크(깨진 텍스트)로 인한 오동작 우려

### 문제 3: 로그 가독성
- PowerShell 콘솔이 CP949 인코딩 사용
- UTF-8 텍스트가 `???`로 깨져 보임
- 운영자 디버깅 불편

## Options Considered (고려한 대안)

### 빌드 파이프라인

**Option A**: dist를 git에 포함
- 장점: clone 직후 실행 가능
- 단점: 빌드 산출물이 git 이력에 포함, 충돌 가능성

**Option B**: start 스크립트에서 빌드 강제 (선택됨)
- 장점: 항상 최신 소스로 빌드, dist git 제외 유지
- 단점: 기동 시간 증가 (빌드 포함)

### 명령 파서

**Option A**: `?`로 시작하면 모두 처리 (기존)
- 장점: 유연함
- 단점: 의도치 않은 발동, 보안 우려

**Option B**: `?디하클` 맨 앞 필수 (선택됨)
- 장점: 명확한 트리거, 오발동 방지
- 단점: 사용자가 정확히 입력해야 함

**Option C**: fallback으로 접두어 추정
- 장점: 깨진 텍스트도 처리 가능
- 단점: CLAUDE.md "fallback 금지" 원칙 위반, 오검출 위험

## Decision (결정)

### 1. 빌드 파이프라인 강화

`windows/start_bot.ps1` 수정:

```powershell
# 빌드 강제 실행
npm run build

# 빌드 실패 시 즉시 종료
if ($rc -ne 0) {
    Write-Error "[bot] build failed (exit $rc) - see $buildLog"
    return $false
}

# dist/index.js 존재 확인
if (-not (Test-Path $distIndex)) {
    Write-Error "[bot] build completed but dist/index.js missing"
    return $false
}
```

### 2. 명령 파서 정책

`CustomMessageController.ts` 수정:

```typescript
// NFC 정규화
const normalized = parsed.normalize("NFC");

// 접두어는 반드시 문자열 맨 앞의 "?디하클"만 허용
const prefixMatch = normalized.match(/^\?디하클\s*(.*)$/);
if (!prefixMatch) {
    this.logger.warn("[ai] skip: prefix not matched (require '?디하클')");
    return;
}
```

### 3. 로그 가독성 개선

- `start_bot.ps1`에 UTF-8 강제 설정 추가
- 접두 불일치 시 `msgDecoded` 필드 추가
- `windows/logs/prefix_skip.raw.txt`에 원문 UTF-8 저장

```powershell
# start_bot.ps1 상단
chcp 65001 | Out-Null
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
```

### Invariants (불변식)

1. **빌드 없이 봇 기동 금지**: `dist/index.js` 없으면 기동 실패
2. **`?디하클` 맨 앞 필수**: 다른 접두어나 `?` 단독은 발동 안 함
3. **fallback/추측 금지**: 접두어 불일치 시 명시적 스킵 + 로그
4. **UTF-8 로깅**: 운영 로그는 UTF-8로 저장/표시

## Consequences (결과)

### 긍정적 효과
- 소스-빌드 불일치로 인한 버그 방지
- 명령 오발동 완전 차단
- 운영자 디버깅 편의성 향상
- CLAUDE.md 원칙(fallback 금지) 준수

### 부정적 효과 / 리스크
- 봇 기동 시간 증가 (빌드 포함, 약 10-20초)
- `-SkipBuild` 옵션 있으나 dist 없으면 강제 빌드

### 후속 작업
- [x] start_bot.ps1 빌드 강제/검증 추가
- [x] CustomMessageController 파서 정리
- [x] UTF-8 로깅 설정
- [x] prefix_skip.raw.txt 자동 저장
- [ ] CI/테스트 자동화 (후속 과제)
- [ ] 알림 훅 추가 (후속 과제)

## AI Context (AI 협업 메모)

- PM AI 역할로 코드 리뷰 및 검토 수행
- 계획 외 변경(iconv-lite, UTF-16LE 시도)에 대한 프로세스 피드백 제공
- rawDump 분석으로 "인코딩 문제"가 실제로는 "콘솔 표시 문제"임을 확인
- 실제 데이터는 정상 UTF-8, LLM 경로 정상 동작 확인

## Links

- Related ADR: ADR-0011 (봇 싱글톤), ADR-0012 (API 계약)
- Code:
  - `windows/start_bot.ps1` - 빌드 파이프라인
  - `node-iris-app/src/controllers/CustomMessageController.ts` - 명령 파서
  - `windows/logs/prefix_skip.raw.txt` - 스킵 로그
