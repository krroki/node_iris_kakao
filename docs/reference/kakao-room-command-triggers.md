# 오픈채팅 방별 명령어(FAQ) 트리거 – `command-worker`

## 목표

- 운영자가 자주 쓰는 안내/FAQ 답변을 **방 단위로 등록**해두고,
  누구나 `!키워드` 형태로 호출하면 **답장(Reply)** 으로 자동 응답하도록 한다.

## 켜는 방법(UI)

- UI(3100)에서 해당 방 카드 → **`명령어(FAQ)` 토글 ON** → 저장
  - 내부적으로 `runtime.features[roomId].commands=true`가 저장된다.

## 채팅 명령어 사용법

> 기본 응답은 **카카오톡 “답장(Reply)”** 형태(`type=26 + attachment.src_*`)로 발신된다.  
> 단, Talk-API가 502/-500 등으로 실패하면(ADR-0034) IRIS `/reply_text`로 **일반 텍스트**를 발신하며,
> 이 경우 카카오톡 UI에서 “답장”으로 렌더링되지 않는다.
> - 운영 방에는 “답장 불가” 같은 **기술 문구/로그를 발신하지 않는다.**
>   대신 **테스트용 오픈채팅방(`18462226881291012`)에만** `[ALERT][command-worker] ...` 형태의 알림을 남긴다(운영자 알림).

### 1) 등록(방장/관리자만)

- 형식:
  - 1줄: `!등록 <키>`
  - 2줄~: 응답 본문(멀티라인)
- 예시:
  - `!등록 구글 2차인증`
  - `구글 2차인증은 아래 링크 참고해주세요.`
  - `https://sample.com`
  - `궁금한 점 있으면 편하게 질문주세요!`

정책:
- **덮어쓰기(수정) 금지**: 이미 존재하면 거부한다.
  - 수정은 `!삭제 <키>` 후 다시 `!등록`한다.

### 2) 삭제(방장/관리자만)

- `!삭제 <키>`

### 3) 목록(누구나)

- `!명령어`
  - `[방 전용]`, `[전체 공통]` 두 섹션으로 출력한다.
  - 너무 길면 일부만 표시하고 “외 N개”로 줄인다(명시적 제한).

### 4) 전체 등록(iris 계정만)

- `!전체등록 <키>` + 다음 줄부터 본문
  - 모든 방에서 `!<키>`로 호출 가능(방 전용 키가 있으면 방 전용이 우선).

iris 계정 판정(우선순위):
1) `runtime.json.irisAdminSenderIds`에 senderId가 포함되면 허용
2) `runtime.json.irisAdminSenderNames`에 senderName(소문자)가 포함되면 허용
3) 둘 다 없으면 `senderName == "iris"`(대소문자 무시)일 때만 허용

> 운영에서는 **senderId 기반(1번)** 을 권장한다(닉네임 위장 방지).

### 5) 호출(누구나)

- `!<키>` 를 입력하면 등록된 본문을 그대로 답장으로 발신한다.
- 키 매칭은 공백을 정규화한다.
  - 예: `구글   2차인증` ↔ `구글 2차인증`은 동일 키로 취급

## 권한/역할 판별(방장/관리자)

- IRIS DB(`open_chat_member`)에서 `link_member_type`으로 판별한다.
  - 관측된 역할 값(보수적):
    - `8` → 방장(호스트)
    - `4` → 부방장/운영진
    - `1` → 일부 방에서 운영진/특수 role로 관측(보수적으로 admin 취급)
- 멤버 DB가 아직 로딩되지 않은 방(특히 대형방)은 권한 확인이 실패할 수 있다.
  - 이 경우 등록/삭제는 거부되며, 안내 메시지가 답장으로 발신된다.
  - 운영자가 수동으로 등록/삭제 권한을 부여하려면(멤버 DB가 비어있거나 role 확인이 불안정할 때):
   - (방 단위 권장) `runtime.features[roomId].commandAdminSenderIds`에 senderId를 추가한다.
   - 또는 (글로벌) `runtime.json.commandAdminSenderIds`에 senderId를 추가한다.
   - senderName 기반(`commandAdminSenderNames`)도 가능하지만, 닉네임 위장 가능성 때문에 비권장이다.
  - 또한 `command-worker`가 멤버 DB 미로딩을 감지하면 `scripts/openchat_load_members.ps1`를 자동 트리거(송신 없이 화면 탭/스크롤)하여 DB를 채운다.
    - 진단/상태 로그는 테스트용 오픈채팅방으로만 발신한다(운영방 오염 방지).

## 구현/운영 포인트

- 워커:
  - 코드: `node-iris-app/src/workers/command_worker.ts`
  - 빌드 산출물: `node-iris-app/dist/workers/command_worker.js`
  - 상태 파일: `node-iris-app/data/command_worker_status.json`
  - 락 파일: `node-iris-app/data/locks/command_worker.lock`
- 기동:
  - 단독 재기동: `windows/start_command_worker.ps1 -Restart`
  - 전체 기동: `windows/start_all.cmd` (콜드 부팅/전체 복구용)
  - watchdog가 heartbeat stale(5분)/프로세스 종료를 감지하면 자동 재기동한다.
- 저장소(영속):
  - IRIS(DB) 테이블: `command_triggers` (room/global + key_norm)

## 트러블슈팅 체크리스트

1) **워커 실행 여부**
   - UI(3100) 상단 “프로세스” 카드에서 `command-worker`가 1개인지 확인
   - 또는 `windows/logs/command_worker.out.log` 확인
2) **방 토글**
   - 해당 방 카드에서 `명령어(FAQ)`가 ON인지 확인
3) **발신 전제조건**
   - `safeMode=false`
   - `talkApi.enabled=true` + `authHeader` 유효
4) **Reply payload 필수값**
   - `messageId(src_logId)`/`senderId(src_userId)`/`chat_rooms.link_id(src_linkId)`/`messageType(src_type)`가 누락되면 Reply 발신을 스킵한다(명시적 스킵/로그 기록).
   - Talk-API 자체 전송이 실패하면 IRIS `/reply_text`로 “일반 메시지 폴백”이 발생할 수 있다(Reply 아님).
     - 이 때 운영 방에는 기술 문구를 붙이지 않으며, 실패 알림은 테스트방(`18462226881291012`)에만 남긴다.
