# 에이전트 작업 지침서

---

## 🚨 제1원칙: FALLBACK 절대 금지 (최우선 준수)

### 불변식
**어줍잖은 fallback은 시스템을 망가뜨린다. 절대 사용 금지.**

### 원칙
1. **모든 코딩은 목적과 결과가 분명해야 한다**
   - 입력 → 처리 → 출력의 모든 경로가 명확해야 함
   - "혹시 모르니까" 식의 fallback 금지

2. **fallback이 필요해 보이는 상황 = 엣지케이스 분석 부족**
   - fallback을 넣고 싶다면, 그 상황이 왜 발생하는지 근본 원인을 먼저 파악
   - 모든 엣지케이스를 열거하고 각각에 대한 명시적 처리 로직 작성

3. **"일단 fallback으로 처리" 금지**
   - ❌ `catch (e) { return defaultValue }` - 에러 원인 은폐
   - ❌ `value ?? fallbackValue` - 왜 null인지 모르는 상태로 진행
   - ❌ `try { ... } catch { /* 무시 */ }` - 문제 숨기기

### 올바른 접근
```typescript
// ❌ 금지: 어줍잖은 fallback
const result = riskyOperation() ?? "default";

// ✅ 권장: 명시적 에러 처리
const result = riskyOperation();
if (result === null) {
  throw new Error("riskyOperation returned null: [구체적 원인 분석]");
}
```

### 예외 (명시적 승인 필요)
- 사용자가 "이 경우는 fallback 써도 된다"고 명시적으로 지시한 경우에만 허용
- 그 경우에도 로그에 fallback 발동 사실을 남겨야 함

---

## 운영 장애: EMFILE(too many open files)

### 핵심
`EMFILE`은 “잠깐 오류”가 아니라 **로그/상태 기록이 멈추며 welcome/worker 트리거까지 끊길 수 있는 운영 장애**다.

### 원인 분류(자주 재발하는 2가지)
1. **MessageStore append burst**(ADR-0031)
   - 증상: `/status extra.emfile=true` 또는 `node-iris-app/data/bot_health.json` 존재
2. **node-iris Logger 파일 핸들 누수**(ADR-0042)
   - 증상: `Get-Process -Id <PID> | Select HandleCount`가 수천 단위로 증가
   - 핸들이 `node-iris-app/logs/app.log`, `node-iris-app/logs/error*.log`에 과다하게 잡힘

### 복구(운영 원칙: 부분 재기동 우선)
1. Bot 재기동: `windows/start_bot.ps1 -Restart` (빠른 재기동은 `-SkipBuild`)
2. 재발 시(핫픽스/패치 확인):
   - `node-iris-app/package.json`에서 `@tsuki-chat/node-iris=1.6.41` 고정 여부 확인
   - `cd node-iris-app && npx patch-package --error-on-fail`
   - 참고(SSOT): `docs/adr/ADR-0042-node-iris-logger-handle-leak-emfile-hotfix.md`

---

## 네이버 카페 접속 지침

### 로그인 절차

1. **자동 로그인 시도**
   - 환경변수에서 NAVER_ID, NAVER_PW 로드
   - Playwright로 네이버 로그인 페이지 접속
   - 아이디/비밀번호 자동 입력 및 로그인 시도

2. **모바일 인증 대기**
   - 2단계 인증(모바일) 필요시 사용자 수동 처리 대기
   - 로그인 성공 확인 후 다음 단계 진행

3. **카페 글 접속**
   - 로그인 성공 후 목표 카페 글 URL로 이동
   - 글 내용 확인 및 스크린샷 저장

### 사용 방법

```bash
python scripts/naver_cafe_checker.py
```

### 환경변수 설정

```
NAVER_ID=your_naver_id
NAVER_PW=your_naver_password
NAVER_CAFE_URL=https://cafe.naver.com/cafe_name
```

### 주의사항

- 모바일 인증 필요시 수동 처리 필요
- 인증 후 스크립트가 자동으로 진행됨
