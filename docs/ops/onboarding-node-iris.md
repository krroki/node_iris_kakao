# Node-Iris 봇 온보딩 가이드 (2025-10-28 기준)

본 문서는 추후 어떤 세션의 AI/엔지니어라도 빠르게 현재 진행 상황을 파악하고 이어갈 수 있도록 작성되었습니다.  
`온보딩 해` 라는 요청이 들어오면 이 문서를 전체 검토한 뒤 안내/작업을 시작하세요.

---

## 1. 프로젝트 개요 & 현재 상태
- 목적: IRIS(루팅된 안드로이드 + Hyper-V VM) 기반 카카오톡 자동화 봇을 **Node.js(TypeScript)** 스택으로 재구현.
- 현재 코드: `node-iris-app/` 디렉터리에 `@tsuki-chat/node-iris` 템플릿을 기반으로 한 봇이 존재.
- 새로 추가한 핵심 기능
  - 메시지 로깅 서비스(`src/services/messageStore.ts`): 이벤트를 JSONL로 저장 + 최근 로그 버퍼 유지.
  - 브로드캐스트 큐(`src/services/broadcastScheduler.ts`): 작업을 파일(JSON)로 대기, `CustomBatchController`가 주기적으로 전송.
  - 브로드캐스트 관리 명령(`broadcast`, `broadcast:list`).
  - Vitest 테스트 2종(`tests/messageStore.test.ts`, `tests/broadcastScheduler.test.ts`) 추가.
  - `.env`를 통한 MOCK/실환경 모드 전환 (`MOCK_IRIS=true`일 때 실연결 건너뜀).
  - 무료 웹 검색 MCP(`fetch_browser`) 설치 완료 → MCP 기반으로 구글 검색/페이지 크롤링 가능(별도 API 키 필요 없음).
- 향후 로드맵(결정됨)
  1. **PNPM 모노레포** 구조로 전환 (`apps/bot`, `apps/dashboard`, `packages/shared`).
  2. **Prisma** 등으로 메시지/브로드캐스트 데이터 영속화를 DB(SQLITE→Postgres로 확장 가능).
  3. **관리용 웹 대시보드(Next.js)** 구현: 로그 뷰, 브로드캐스트 큐 관리, 방/사용자 상태 UI.
  4. REST/SSE API 추가로 봇 ↔ 대시보드 연동.
  5. 운영 자동화(systemd/PM2, CI 파이프라인) 및 문서화 보강.

---

## 2. 운영 환경 요구사항 (IPS + 하드웨어)
### 2.1 루팅 안드로이드 단말
- 카카오톡 설치 및 루팅 필수.
- IRIS 앱 설치 (`iris_control` 스크립트로 deploy).
- ADB 연결 가능해야 함 (`setprop service.adb.tcp.port 5555`, `adb connect <phone_ip>:5555`).
- IRIS 대시보드 접근: `http://<ANDROID_IP>:3000/dashboard`.
- 대시보드 설정
  - Bot Name: 식별용 명칭.
  - Web Server Endpoint: Hyper-V VM (봇이 돌고 있는 Ubuntu)의 엔드포인트. 예) `http://192.168.0.x:5000/db`.
  - DB Polling Rate, Message Send Rate: CPU/배터리와 트레이드오프 고려 (기본값 200ms/100ms).

### 2.2 Windows 10/11 + Hyper-V (리눅스 VM)
- Hyper-V에서 **External vSwitch(브리지)** 설정 → VM이 실제 LAN IP 획득.
- Ubuntu 22.04 LTS 권장. 고정 IP 설정 또는 DHCP 결과 기록.
- 필수 패키지
  ```bash
  sudo apt update && sudo apt install -y build-essential python3 python3-venv python3-pip nodejs npm ufw sqlite3
  sudo ufw allow 3000/tcp   # IRIS 포트
  sudo ufw allow 5000/tcp   # 봇 Webhook/API 용
  ```
- Git/Node/Python 환경을 VM에 설치하여 봇을 실행 & 관리.

### 2.3 네트워크 체크 리스트
- 안드로이드 ↔ VM 간 ping 확인.
- VM에서 `curl http://<ANDROID_IP>:3000/config` 응답 확인.
- IRIS 대시보드에서 지정한 Web Server Endpoint가 VM에서 열려 있는지 확인(테스트용 Express 서버 등으로 사전 검증 가능).

---

## 3. Node-Iris 봇 구조 (현재 `node-iris-app/`)
### 3.1 스크립트
```bash
cd node-iris-app
npm install        # 의존성 설치
npm run dev        # 개발 모드 (MOCK_IRIS=true일 경우 연결 생략)
npm run build      # TypeScript 컴파일
npm run start      # dist/index.js 실행
npm run test       # Vitest 단위 테스트
```

### 3.2 핵심 파일
- `src/app.ts`: Bot 인스턴스 생성 & 컨트롤러 등록. `MOCK_IRIS=true`일 때 실연결 건너뜀.
- `src/controllers/*`: 이벤트/명령어 컨트롤러. 카페 문서의 데코레이터 패턴 그대로.
- `src/services/messageStore.ts`: 이벤트 스냅샷을 파일로 기록 + 버퍼 제공.
- `src/services/broadcastScheduler.ts`: 브로드캐스트 큐 관리. `CustomBatchController.dispatchBroadcasts`에서 처리.
- `src/services/index.ts`: 서비스 singletons export (`messageStore`, `broadcastService`).
- `tests/*.test.ts`: Vitest 테스트 세트.
- `.env`: IRIS URL, LOG 경로, MOCK 모드 등 설정. 기본값은 `MOCK_IRIS=true`, `IRIS_URL=127.0.0.1:3000`.

### 3.3 명령어/기능 요약
- 기본 명령어: `ping`, `echo`, `time`, `room`, `user`, `admin`, `throttle`.
- 브로드캐스트 관리:
  ```
  >>broadcast Hello everyone!                  # 현재 방으로 안내 메시지 대기열 등록
  >>broadcast --rooms=1839,1920 공지 내용…    # 여러 방에 예약
  >>broadcast:list                             # 대기 중인 작업 확인
  ```
- `CustomFeedController`가 입장/퇴장 이벤트를 `messageStore`에 기록.
- `CustomBatchController`는 주기적으로 브로드캐스트 큐를 꺼내 `bot.api.reply()`로 전송.

---

## 4. 향후 구조 개편 (결정사항)
### 4.1 Monorepo 계획
```
pnpm-workspace.yaml
apps/
  bot/         # 현재 node-iris-app 내용 이동
  dashboard/   # Next.js 기반 관리 대시보드
packages/
  shared/      # Prisma schema, 공통 타입/유틸
```
- `pnpm install` 한 번으로 전체 설치.
- `apps/bot`은 REST/SSE API를 제공하여 대시보드/외부 시스템이 데이터 접근 가능.
- `apps/dashboard`는 Next.js + Tailwind (또는 Chakra UI)로 인터랙티브 UI 제공.

### 4.2 데이터 영속화
- 현재 messageStore/broadcastScheduler는 파일 기반 → SQLite or Postgres로 이전.
- Prisma schema 초안:
  ```prisma
  model MessageLog {
    id          String   @id @default(cuid())
    roomId      String
    roomName    String?
    senderId    String?
    senderName  String?
    messageId   String?
    messageText String?
    payload     Json
    createdAt   DateTime @default(now())
  }

  model BroadcastTask {
    id          String   @id @default(cuid())
    channels    Json
    payload     Json
    status      String   // pending/sent/failed
    attempts    Int      @default(0)
    scheduledAt DateTime
    createdAt   DateTime @default(now())
    completedAt DateTime?
    lastError   String?
    metadata    Json?
  }
  ```

### 4.3 관리 대시보드 (Next.js)
추천 기술 스택:
- Next.js(App Router) + TypeScript + Tailwind(또는 Chakra UI) + React Query.
- 페이지 구성:
  1. **Overview**: 연결 상태, 최근 이벤트, 스케줄러 상황.
  2. **Live Logs**: 방/시간별 메시지 스트림 (SSE/WebSocket).
  3. **Broadcasts**: 큐 목록/등록/취소 UI.
  4. **Rooms & Members**: 방 설정, 환영 메시지 템플릿, 권한 설정.
  5. **Settings**: 스케줄 간격, 허용 방 ID, KakaoLink 설정 등 관리.
- Auth: 사내 VPN 또는 간단한 Basic Auth/JWT.
- API 연동: bot 앱에서 제공하는 `/api/*` 라우트를 호출 (REST + SSE).

### 4.4 운영 자동화
- `apps/bot`을 PM2/systemd에 등록, `.env` 관리(AWS SSM, Dotenv Vault 등 고려).
- GitHub Actions 또는 자체 CI로 test/build 파이프라인 구성.
- 로그/메트릭 (Grafana, Loki, Sentry 등) 통합 고려.

---

## 5. 실제 운영 절차 (루팅 단말 + Hyper-V)
아래 순서를 차근차근 따라 하면 됩니다. 각 단계는 **건너뛰지 말고** 완료 후 다음 단계로 이동하세요.

### 5.1 루팅 단말에서 IRIS 실행 준비
1. 루팅된 안드로이드에 IRIS APK 설치.
2. 휴대폰에서 현재 Wi‑Fi의 IP 주소 확인: `설정 → Wi‑Fi → 접속한 네트워크 → IP 주소`.
3. PC에서 ADB 연결:
   ```bash
   adb connect <휴대폰_IP>:5555
   adb devices   # "device" 상태 확인
   ```
4. `iris_control` 스크립트 실행:
   ```bash
   ./iris_control install
   ./iris_control start
   ./iris_control status
   ```
5. 브라우저에서 `http://<휴대폰_IP>:3000/dashboard` 접속 → 대시보드가 열리면 OK.

### 5.2 Hyper-V VM 네트워크/환경 설정
1. Hyper-V 관리자에서 **External vSwitch** 생성 → VM 네트워크 어댑터에 연결.
2. Ubuntu VM 로그인 후 IP 확인:
   ```bash
   ip addr show | grep 'inet '
   ```
   - `inet 192.168.x.y/24` 형태가 VM IP.
3. 방화벽 설정:
   ```bash
   sudo ufw allow 3000/tcp   # IRIS 통신
   sudo ufw allow 5000/tcp   # 봇 HTTP/API (필요 시)
   sudo ufw enable
   ```
4. 필요 패키지 설치: `node -v`, `npm -v`로 버전 확인.

### 5.3 레포 내려받고 의존성 설치
```bash
git clone <repo>
cd <repo>/node-iris-app
npm install
```

### 5.4 .env 값 채우기 (핵심 단계)
1. `.env` 파일을 열기 (예: `nano .env`).
2. 아래 항목을 실제 값으로 채웁니다.
   - `IRIS_URL`: 휴대폰 IP + `:3000` (대시보드 주소). 예) `192.168.0.10:3000`
   - `IRIS_HOST`: 위 주소에서 포트 제거한 값. 예) `192.168.0.10`
   - `MOCK_IRIS=false`: 실연결 시 반드시 `false`.
   - `KAKAOLINK_APP_KEY`, `KAKAOLINK_ORIGIN`: 카카오링크 기능 사용 시 입력 (없으면 비워도 됨).
   - `MESSAGE_LOG_DIR`, `BROADCAST_DB`: 기본값 유지 가능.
3. 저장 후 검증:
   ```bash
   npm run check:env
   ```
   - ❌ 표시가 나오면 해당 항목을 다시 확인합니다.

### 5.5 IRIS 대시보드 설정
1. `http://<휴대폰_IP>:3000/dashboard` 접속.
2. 아래 값을 입력하고 **Save**:
   - **Bot Name**: 자유롭게 설정.
   - **Web Server Endpoint**: `http://<VM_IP>:5000/db` (봇에서 HTTP 모드 사용 시 대비).
   - **DB Polling Rate**, **Message Send Rate**: 기본값(200ms/100ms) → 필요 시 단말 성능에 맞게 조정.
3. `Config` 탭에서 설정이 반영됐는지 확인.
4. VM에서 응답 시험:
   ```bash
   curl http://<휴대폰_IP>:3000/config
   ```
   - JSON이 출력되면 통신 OK.

### 5.6 네트워크 점검
1. VM → 휴대폰 ping:
   ```bash
   ping <휴대폰_IP>
   ```
2. IRIS 대시보드에서 Web Server Endpoint 항목에 에러 표시가 없는지 확인.

### 5.7 봇 빌드 및 실행
```bash
cd node-iris-app
npm run build
npm run start
```
- 로그에 `Connected to Iris` 등이 출력되면 연결 성공.
- 에러가 있다면 메시지를 복사해 분석합니다.

### 5.8 카카오톡에서 동작 테스트
- 봇이 참여한 채팅방에서 `>>ping` 입력 → `Pong!` 응답 확인.
- 브로드캐스트 큐: `>>broadcast 공지 테스트` → 몇 초 뒤 메시지가 도착하는지 확인.
- 로그 파일: `data/logs/<roomId>/<날짜>.log` 생성 여부 확인.

### 5.9 문제 발생 시 체크 포인트
- `npm run start` 로그의 에러 메시지 확인.
- IRIS 대시보드 `logs` 페이지에서 Web Server Endpoint 호출 실패 여부 확인.
- ADB 연결이 끊겼으면 `adb connect`, `./iris_control restart` 다시 실행.
- 방화벽, Hyper-V vSwitch 설정을 재점검.

---

## 6. 다음 액션 아이템 (우선순위)
1. **PNPM 모노레포 전환**: `apps/bot`으로 코드 이동, `pnpm-workspace.yaml` 작성.
2. **Prisma + SQLite 통합**: messageStore/broadcastScheduler를 DB 기반으로 리팩터링.
3. **Express/Fastify API 추가**: `/api/logs`, `/api/broadcasts`, `/api/status` 등 구현.
4. **Next.js 대시보드 초기 화면 구성**: 로그 조회 & 브로드캐스트 관리 기본 UI.
5. **CI 파이프라인**: `npm run test`, `npm run build` 자동화, Vitest + Lint 도입.
6. **운영 문서 추가**: systemd/PM2 스크립트, 복구 절차, 알림 정책 등.
7. **MCP 환경 정리**: `fetch_browser` MCP 활용 가이드 유지(유료 MCP 대체). 추후 다른 무료 MCP 조사 시 문서 갱신.

---

## 7. 참고 문서 링크
- `a3/1028_1/iris.txt`: IRIS 설치/운영 전반에 대한 상세 자료.
- `docs/setup/iris-hyperv.md`: Hyper-V VM 세팅 가이드.
- `docs/ops/iris-usage-manual.md`: IRIS 관련 카페 수집 내용 요약.
- `docs/todo.md`: 전체 TODO/진행상황.
- `docs/analysis/node-iris-migration.md`: Python → Node 전환 시 매핑 및 고려사항.

필요 시 본 온보딩 문서를 갱신하면서, 새로운 결정/이슈/로드맵 변화 사항을 기록하세요.  
항상 `.env`/비밀 정보는 레포에 커밋하지 않도록 주의합니다.
