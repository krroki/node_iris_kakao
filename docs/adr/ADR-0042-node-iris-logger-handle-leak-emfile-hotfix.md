## Meta

- **Date**: 2025-12-19
- **Status**: Accepted
- **Authors**: 운영, Codex CLI
- **Related**: ADR-0031(MessageStore EMFILE 완화), ADR-0019(SAVE_CHAT_LOGS 기본값), docs/reference/verification-commands.md

## Context (배경)

운영 중 Node 봇이 “죽은 것처럼 보임(로그/상태 업데이트 정지)” 증상이 재발했다.

관측된 핵심 증상은 다음과 같다.

- Node 프로세스에서 `EMFILE: too many open files`가 발생하며,
  - MessageStore 로그 append(`data/logs/<room>/<date>.log`)가 실패하고
  - `data/status.json` / `data/bot_health.json` 갱신도 실패하여
  - UI(`/status`)에서 `logStore`/`bot` 상태가 비정상처럼 보일 수 있다.
- 프로세스 핸들 덤프를 확인해보면 동일 파일에 대한 File handle이 수천 개로 누적되어 있었다.
  - `node-iris-app/logs/app.log`
  - `node-iris-app/logs/error*.log` (로테이션된 파일)

ADR-0031은 MessageStore의 “로그 파일 append burst”로 인한 EMFILE을 완화했지만,
이번 케이스는 MessageStore가 아니라 **로거(File transport) 핸들 누수**가 원인이었다.

## Options Considered (고려한 대안)

### Option A: watchdog/재기동으로만 대응
- 설명: EMFILE 발생 시 재기동으로 즉시 복구하고, 원인은 추후 분석한다.
- 장점: 가장 빠른 복구.
- 단점: 원인 미해결로 재발한다(운영 불안정).

### Option B: Logger 생성 지점을 모두 찾아 singleton으로 변경
- 설명: node-iris 내부의 핫패스에서 `new Logger(...)`를 반복 생성하는 부분을 전부 수정한다.
- 장점: 원인에 직접 접근.
- 단점: 수정 범위가 넓고, 누락 시 재발한다. 라이브러리 내부 변경이라 유지보수가 어렵다.

### Option C: Logger 구현을 “공유 transport” 방식으로 변경 (선택됨)
- 설명: `Logger` 래퍼가 매번 `winston.createLogger()`로 File transport를 새로 만들지 않도록,
  **공유 winstonLogger(transport 단일)**를 사용하도록 변경한다.
- 장점:
  - Logger 인스턴스가 많이 만들어져도 파일 핸들이 누수되지 않는다.
  - 변경 범위가 작고(로거 모듈 단일 파일) 즉시 효과를 얻는다.
- 단점:
  - `node_modules` 내 코드 핫픽스는 재설치(`npm ci`) 시 덮어써질 수 있다(후속 조치 필요).

## Decision (결정)

**우리는 Option C(공유 transport 방식)를 선택했다.**

적용은 다음과 같다.

1. `node-iris-app/node_modules/@tsuki-chat/node-iris/dist/utils/logger.js`에서
   Logger 인스턴스별 `winston.createLogger + File transport` 생성을 제거한다.
2. 파일 로깅은 모듈 단일 `winstonLogger`(transport 단일)로만 수행한다.
3. 인스턴스별 `logLevel`은 래퍼에서 필터링해 기존 의미를 최대한 유지한다.
4. `saveChatLogs`(chat.log)는 공유 `chatLogger`(단일 File transport)로 통합한다.

### Invariants (불변식)

- 동일 파일(`logs/app.log`, `logs/error*.log`)에 대한 File handle은 프로세스 당 **소수(1~몇 개)**로 유지되어야 한다.
- Logger 생성이 핫패스에서 반복되어도 파일 핸들이 선형으로 증가하면 안 된다.
- EMFILE을 “조용히 무시”하지 않는다.
  - 발생 시 status/health로 가시화하고 watchdog/운영 조치로 복구되게 둔다(ADR-0031 유지).

## Consequences (결과)

### 긍정적 효과

- `logs/app.log` / `logs/error*.log` 핸들 누수가 제거되어 EMFILE 재발 확률이 크게 낮아진다.
- MessageStore/Status 파일 갱신이 정상화되어 “봇이 죽은 것처럼 보이는” 증상이 감소한다.

### 부정적 효과 / 리스크

- `node_modules` 핫픽스이므로 원칙적으로는 `npm ci` 등 재설치 시 덮어써질 수 있다.
  - 재발 방지를 위해 `node-iris-app`에 `patch-package`를 도입해 `postinstall`에서 자동 재적용되도록 했다.
    - `postinstall`은 `patch-package --error-on-fail`로 설정해, 패치 미적용 상태로 “조용히” 넘어가지 않도록 한다.
  - 패치 파일: `node-iris-app/patches/@tsuki-chat+node-iris+1.6.41.patch`
  - 버전 드리프트를 막기 위해 `node-iris-app/package.json`의 `@tsuki-chat/node-iris`는 `1.6.41`로 고정한다.
    - 버전을 올리면 patch 파일 버전도 맞춰 재생성해야 한다: `cd node-iris-app && npx patch-package @tsuki-chat/node-iris`
  - 주의: `npm ci --omit=dev` 같은 방식으로 devDependencies 설치를 생략하면 `patch-package`가 설치되지 않아 패치가 자동 적용되지 않는다.

### 후속 작업

- [ ] (권장) `@tsuki-chat/node-iris` upstream에 동일 수정 반영(PR/릴리즈) 또는 내부 패치 배포 방식을 확정한다.
- [ ] 운영 런북에 “EMFILE 발생 시 로거 핸들 누수 점검” 절차를 추가한다.

## Links

- Code: `node-iris-app/node_modules/@tsuki-chat/node-iris/dist/utils/logger.js`
- Related ADR: `docs/adr/ADR-0031-messagestore-emfile-mitigation.md`
