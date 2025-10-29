# {{PROJECT_NAME}}

{{PROJECT_DESCRIPTION}}

이 프로젝트는 [@tsuki-chat/node-iris](https://www.npmjs.com/package/@tsuki-chat/node-iris)를 기반으로 생성된 카카오톡 봇입니다.

## 개발 환경 설정

### 1. 의존성 설치

```bash
pnpm install
```

### 2. 환경 변수 설정

`.env` 파일을 수정하여 봇 설정을 완료하세요:

```env
# Iris URL (IP:PORT 형식)
IRIS_URL=127.0.0.1:3000

# 최대 워커 스레드 수 (선택사항)
MAX_WORKERS=4

# 차단된 사용자 ID 목록 (쉼표로 구분, 선택사항)
BANNED_USERS=123456789,987654321

# KakaoLink 설정 (카카오링크 기능 사용시 필요)
KAKAOLINK_APP_KEY=your_kakao_app_key_here
KAKAOLINK_ORIGIN=your_origin_here

# 로그 레벨 설정 (error, warn, info, debug)
LOG_LEVEL=debug

# HTTP 웹훅 모드 설정 (선택사항)
HTTP_MODE=false
HTTP_PORT=3001
WEBHOOK_PATH=/webhook/message

# 채팅 로그 저장 여부
SAVE_CHAT_LOGS=false
```

### 3. 개발 서버 실행

```bash
pnpm run dev
```

### 4. 프로덕션 빌드

```bash
pnpm run build
pnpm start
```

## 프로젝트 구조

```
src/
├── controllers/          # 컨트롤러 클래스들
│   ├── CustomBootstrapController.ts    # 부트스트랩 컨트롤러
│   ├── CustomBatchController.ts        # 배치 컨트롤러
│   ├── CustomChatController.ts         # 모든 채팅 이벤트 핸들러
│   ├── CustomMessageController.ts      # 메시지 핸들러
│   ├── CustomNewMemberController.ts    # 새 멤버 입장 핸들러
│   ├── CustomDeleteMemberController.ts # 멤버 퇴장 핸들러
│   ├── CustomFeedController.ts         # 피드 핸들러
│   ├── CustomUnknownController.ts      # Unknown 명령어 핸들러
│   └── CustomErrorController.ts        # 에러 핸들러
├── app.ts               # 봇 인스턴스 설정
└── index.ts             # 애플리케이션 진입점
```

## 컨트롤러 가이드

### 부트스트랩 컨트롤러 (CustomBootstrapController)

봇 시작 시 초기화 작업을 수행하는 컨트롤러입니다 (숫자가 낮을수록 먼저 실행):

- `@Bootstrap(1)`: 데이터베이스 초기화 (최우선 실행)
- `@Bootstrap(10)`: 봇 설정 로드 (두 번째 실행)
- `@Bootstrap(50)`: 주기적 작업 설정 (세 번째 실행)
- `@Bootstrap(100)`: 정리 및 최적화 작업 (마지막 실행)

### 배치 컨트롤러 (CustomBatchController)

배치 처리 기능을 담당하는 컨트롤러입니다:

- `@Schedule(5000)`: 5초마다 수집된 메시지들을 배치로 처리
- `@Schedule(30000, 'daily-summary')`: 30초마다 일일 요약 생성
- `@ScheduleMessage('reminder')`: 리마인더 메시지 처리
- `@ScheduleMessage('notification')`: 알림 메시지 처리

#### 스케줄 메시지 작동 방식

스케줄 메시지는 `metadata.key` 값에 따라 해당하는 `@ScheduleMessage` 데코레이터가 적용된 메서드에서 처리됩니다:

```typescript
// 1. 메시지 스케줄링
scheduler.scheduleMessage(
  'reminder-id',
  'room-id',
  '알림 메시지입니다!',
  Date.now() + 60000, // 1분 후
  { key: 'reminder', type: 'meeting' } // 이 key로 처리할 메서드 결정
);

// 2. 처리 메서드 (CustomBatchController에서)
@ScheduleMessage('reminder') // key가 'reminder'인 메시지 처리
async handleReminderMessages(scheduledMessage: ScheduledMessage) {
  // 메시지가 자동으로 전송된 후 이 메서드가 호출됨
  console.log('리마인더 처리:', scheduledMessage.message);
}
```

#### 사용 예제

```typescript
import { BatchScheduler } from "@tsuki-chat/node-iris";

// 프로그래매틱하게 메시지 스케줄링
const scheduler = BatchScheduler.getInstance();

// 리마인더 메시지 (CustomBatchController의 handleReminderMessages에서 처리)
scheduler.scheduleMessage(
  "meeting-reminder",
  "room-id",
  "회의가 10분 후에 시작됩니다!",
  Date.now() + 10 * 60 * 1000, // 10분 후
  {
    key: "reminder", // 이 키로 처리할 메서드 결정
    type: "meeting",
    recurring: false,
  }
);

// 시스템 알림 (CustomBatchController의 handleNotificationMessages에서 처리)
scheduler.scheduleMessage(
  "system-alert",
  "room-id",
  "서버 점검이 예정되어 있습니다.",
  Date.now() + 60000, // 1분 후
  {
    key: "notification", // 다른 키로 다른 메서드에서 처리
    type: "system",
    priority: "important",
  }
);
```

### 채팅 컨트롤러 (CustomChatController)

모든 채팅 이벤트를 포괄적으로 처리하는 컨트롤러입니다.

```typescript
@ChatController
export default class CustomChatController {
  @Command
  async onChatEvent(context: ChatContext) {
    // 모든 채팅 이벤트에 대한 공통 처리
    this.logger.debug("Chat event received");
  }
}
```

### 메시지 컨트롤러 (CustomMessageController)

일반 메시지를 처리하는 컨트롤러입니다.

```typescript
@MessageController
@Prefix("!")
export default class CustomMessageController {
  @BotCommand("안녕", "인사 명령어")
  async hello(context: ChatContext) {
    await context.reply("안녕하세요!");
  }
}
```

### 새 멤버 컨트롤러 (CustomNewMemberController)

새로운 멤버가 채팅방에 입장했을 때의 이벤트를 처리하는 컨트롤러입니다.

```typescript
@NewMemberController
export default class CustomNewMemberController {
  @Command
  async onNewMember(context: ChatContext) {
    await context.reply("새로운 멤버를 환영합니다! 🎉");
  }
}
```

### 멤버 퇴장 컨트롤러 (CustomDeleteMemberController)

멤버가 채팅방에서 퇴장했을 때의 이벤트를 처리하는 컨트롤러입니다.

```typescript
@DeleteMemberController
export default class CustomDeleteMemberController {
  @Command
  async onDeleteMember(context: ChatContext) {
    this.logger.info("Member left the chat");
    // 퇴장 멤버 처리 로직
  }
}
```

### 피드 컨트롤러 (CustomFeedController)

채팅방 이벤트(입장, 퇴장 등)를 처리하는 컨트롤러입니다.

```typescript
@FeedController
export default class CustomFeedController {
  @OnInviteUserFeed
  async onUserJoin(context: ChatContext) {
    await context.reply("새로운 멤버가 들어왔습니다!");
  }
}
```

### 에러 컨트롤러 (CustomErrorController)

봇에서 발생하는 에러를 처리하는 컨트롤러입니다.

```typescript
@ErrorController
export default class CustomErrorController {
  @Command
  async onError(context: ChatContext) {
    this.logger.error("Error occurred:", context);
    // 에러 처리 로직
  }
}
```

### Unknown 컨트롤러 (CustomUnknownController)

등록되지 않은 명령어나 알 수 없는 요청을 처리하는 컨트롤러입니다.

```typescript
@UnknownController
export default class CustomUnknownController {
  @Command
  async onUnknown(context: ChatContext) {
    await context.reply("알 수 없는 명령어입니다.");
  }
}
```

## 사용 가능한 데코레이터

### 클래스 데코레이터

- `@BootstrapController`: 봇 앱 시작시 우선적으로 실행
- `@BatchController`: 스케줄, 배치 처리
- `@ChatController` / `@Controller`: 모든 채팅 이벤트 처리
- `@MessageController`: 메시지 이벤트 처리
- `@NewMemberController`: 새 멤버 입장 이벤트 처리
- `@DeleteMemberController`: 멤버 퇴장 이벤트 처리
- `@FeedController`: 피드 이벤트 처리
- `@UnknownController`: 알 수 없는 명령어 처리
- `@ErrorController`: 에러 이벤트 처리

### 메소드 데코레이터

#### 기본 명령어 데코레이터

- `@BotCommand('명령어', '설명')`: 봇 명령어 등록
- `@Command`: 컨트롤러에 이벤트가 수신된 경우 자동으로 실행되는 명령어로 등록
- `@HelpCommand('도움말')`: 도움말 명령어 등록

#### Prefix 및 스케줄링 데코레이터

- `@Prefix('!')`: 컨트롤러의 기본 prefix 설정
- `@MethodPrefix('특정메소드!')`: 특정 메소드에만 prefix 설정
- `@Schedule(5000)`: 주기적 스케줄 실행 (밀리초)
- `@ScheduleMessage('key')`: 스케줄된 메시지 처리
- `@Bootstrap(1)`: 봇 시작시 부트스트랩 실행 (낮은 숫자 우선)

#### 메시지 타입별 데코레이터

- `@OnMessage`: 모든 메시지에 반응
- `@OnNormalMessage`: 일반 텍스트 메시지에만 반응
- `@OnPhotoMessage`: 사진 메시지에만 반응
- `@OnImageMessage`: 이미지 메시지에만 반응
- `@OnVideoMessage`: 비디오 메시지에만 반응
- `@OnAudioMessage`: 오디오 메시지에만 반응
- `@OnFileMessage`: 파일 메시지에만 반응
- `@OnMapMessage`: 지도 메시지에만 반응
- `@OnEmoticonMessage`: 이모티콘 메시지에만 반응
- `@OnProfileMessage`: 프로필 메시지에만 반응
- `@OnMultiPhotoMessage`: 다중 사진 메시지에만 반응
- `@OnNewMultiPhotoMessage`: 새로운 다중 사진 메시지에만 반응
- `@OnReplyMessage`: 답장 메시지에만 반응

#### 피드 타입별 데코레이터

- `@OnFeedMessage`: 피드 메시지에만 반응
- `@OnInviteUserFeed`: 사용자 초대 피드에 반응
- `@OnLeaveUserFeed`: 사용자 퇴장 피드에 반응
- `@OnDeleteMessageFeed`: 메시지 삭제 피드에 반응
- `@OnHideMessageFeed`: 메시지 숨김 피드에 반응
- `@OnPromoteManagerFeed`: 관리자 승급 피드에 반응
- `@OnDemoteManagerFeed`: 관리자 강등 피드에 반응
- `@OnHandOverHostFeed`: 방장 위임 피드에 반응
- `@OnOpenChatJoinUserFeed`: 오픈채팅 사용자 입장 피드에 반응
- `@OnOpenChatKickedUserFeed`: 오픈채팅 사용자 추방 피드에 반응

#### 제한 및 조건부 데코레이터

- `@Throttle(횟수, 시간)`: 명령어 사용 빈도 제한
- `@HasParam`: 파라미터가 있는 메시지만 처리
- `@IsReply`: 답장 메시지만 처리
- `@IsAdmin`: 관리자만 사용 가능
- `@IsNotBanned`: 차단되지 않은 사용자만 사용 가능
- `@HasRole(['HOST', 'MANAGER'])`: 특정 역할만 사용 가능
- `@AllowedRoom(['room1', 'room2'])`: 특정 방에서만 사용 가능

### 유틸리티 함수

#### 스케줄링 관련

- `addContextToSchedule(context, delay, key)`: 컨텍스트를 스케줄에 추가
- `scheduleMessage(id, roomId, message, time, metadata)`: 메시지 스케줄링

#### 스로틀링 관리

- `clearUserThrottle(userId, commandName)`: 특정 사용자의 스로틀 해제
- `clearAllThrottle(commandName)`: 모든 사용자의 스로틀 해제

#### 디버깅 및 메타데이터

- `debugDecoratorMetadata()`: 데코레이터 메타데이터 디버깅
- `debugRoomRestrictions()`: 방 제한 설정 디버깅

#### 정보 조회

- `getRegisteredCommands()`: 등록된 명령어 목록 조회
- `getRegisteredControllers()`: 등록된 컨트롤러 목록 조회
- `getBatchControllers()`: 배치 컨트롤러 목록 조회
- `getBootstrapControllers()`: 부트스트랩 컨트롤러 목록 조회
- `getBootstrapMethods()`: 부트스트랩 메소드 목록 조회
- `getScheduleMethods()`: 스케줄 메소드 목록 조회
- `getScheduleMessageMethods()`: 스케줄 메시지 메소드 목록 조회

### 하위 호환성 함수

- `hasParam()`: @HasParam 데코레이터의 함수형 버전
- `isAdmin()`: @IsAdmin 데코레이터의 함수형 버전
- `isNotBanned()`: @IsNotBanned 데코레이터의 함수형 버전
- `isReply()`: @IsReply 데코레이터의 함수형 버전

## 사용 가능한 타입과 클래스

### 메인 클래스

- `Bot`: 봇 인스턴스 클래스
- `BatchScheduler`: 배치 스케줄러
- `IrisAPI`: Iris API 클라이언트
- `KakaoLink` / `IrisLink`: 카카오링크 서비스
- `Logger`: 로거 클래스

### 모델 타입

- `ChatContext`: 채팅 컨텍스트
- `ErrorContext`: 에러 컨텍스트
- `Message`: 메시지 모델
- `Room`: 채팅방 모델
- `User`: 사용자 모델
- `Avatar`: 아바타 모델
- `ChatImage`: 채팅 이미지 모델
- `IrisRawData`: Iris 원시 데이터
- `IrisRequest`: Iris 요청 데이터

### 컨트롤러 기본 클래스

- `BaseController`: 모든 컨트롤러의 기본 클래스

### 유틸리티 클래스

- `Config`: 설정 관리 클래스
- `EventEmitter`: 이벤트 에미터
- `LogLevel`: 로그 레벨 열거형
- `defaultLogger`: 기본 로거 인스턴스

### 예외 클래스

- `KakaoLinkException` / `IrisLinkException`: 카카오링크 일반 예외
- `KakaoLink2FAException` / `IrisLink2FAException`: 2FA 관련 예외
- `KakaoLinkLoginException` / `IrisLinkLoginException`: 로그인 예외
- `KakaoLinkReceiverNotFoundException` / `IrisLinkReceiverNotFoundException`: 수신자를 찾을 수 없음
- `KakaoLinkSendException` / `IrisLinkSendException`: 전송 예외

### 타입 정의

- `BotOptions`: 봇 옵션 타입
- `ErrorHandler`: 에러 핸들러 함수 타입
- `EventHandler`: 이벤트 핸들러 함수 타입

## 예제

### 기본 명령어

```typescript
@BotCommand('안녕', '인사 명령어')
async hello(context: ChatContext) {
  await context.reply('안녕하세요!');
}
```

### 파라미터가 있는 명령어

```typescript
@BotCommand('반복', '메시지 반복')
@HasParam
async echo(context: ChatContext) {
  const message = context.message.param;
  await context.reply(`반복: ${message}`);
}
```

### 관리자 전용 명령어

```typescript
@BotCommand('공지', '공지사항 전송')
@IsAdmin // 또는 @HasRole(['HOST', 'MANAGER'])
@HasParam
async announce(context: ChatContext) {
  const announcement = context.message.param;
  await context.reply(`📢 공지: ${announcement}`);
}
```

### 사용 빈도 제한

```typescript
@BotCommand('날씨', '날씨 정보 조회')
@Throttle(3, 60000) // 1분에 3번만 허용
async weather(context: ChatContext) {
  await context.reply('오늘 날씨는 맑습니다!');
}
```

### 특정 메시지 타입 처리

```typescript
// 사진 메시지만 처리
@OnPhotoMessage
async onPhoto(context: ChatContext) {
  await context.reply('사진을 받았습니다! 📸');
}

// 비디오 메시지만 처리
@OnVideoMessage
async onVideo(context: ChatContext) {
  await context.reply('비디오를 받았습니다! 🎥');
}

// 답장 메시지만 처리
@OnReplyMessage
async onReply(context: ChatContext) {
  await context.reply('답장 메시지를 받았습니다!');
}
```

### 피드 이벤트 처리

```typescript
// 사용자 초대 이벤트
@OnInviteUserFeed
async onUserInvite(context: ChatContext) {
  await context.reply('새로운 멤버가 초대되었습니다! 👋');
}

// 사용자 퇴장 이벤트
@OnLeaveUserFeed
async onUserLeave(context: ChatContext) {
  console.log('사용자가 퇴장했습니다.');
}

// 관리자 승급 이벤트
@OnPromoteManagerFeed
async onManagerPromote(context: ChatContext) {
  await context.reply('새로운 관리자가 임명되었습니다! 👑');
}
```

### 방 제한 및 조건부 실행

```typescript
@BotCommand('특별명령', '특정 방에서만 사용 가능한 명령어')
@AllowedRoom(['특별한방', '관리자방'])
async specialCommand(context: ChatContext) {
  await context.reply('이 명령어는 특별한 방에서만 실행됩니다!');
}

@BotCommand('차단확인', '차단되지 않은 사용자만 사용 가능')
@IsNotBanned
async notBannedOnly(context: ChatContext) {
  await context.reply('차단되지 않은 사용자입니다!');
}
```

### 스케줄링과 배치 처리

```typescript
// 주기적 실행 (5초마다)
@Schedule(5000)
async periodicTask() {
  console.log('주기적 작업 실행 중...');
}

// 스케줄된 메시지 처리
@ScheduleMessage('reminder')
async handleReminder(scheduledMessage: ScheduledMessage) {
  console.log('리마인더 처리:', scheduledMessage.message);
}

// 부트스트랩 (봇 시작시 실행)
@Bootstrap(1)
async initializeDatabase() {
  console.log('데이터베이스 초기화 중...');
}
```

### 메소드별 다른 Prefix 설정

```typescript
@MessageController
@Prefix("!")
export default class CustomMessageController {
  // 기본 prefix (!) 사용
  @BotCommand("기본명령", "기본 prefix 명령어")
  async defaultCommand(context: ChatContext) {
    await context.reply("기본 명령어입니다!");
  }

  // 특정 메소드에만 다른 prefix 적용
  @BotCommand("특별명령", "특별한 prefix 명령어")
  @MethodPrefix("?")
  async specialPrefixCommand(context: ChatContext) {
    await context.reply("?특별명령 으로 호출됩니다!");
  }
}
```

## 고급 기능

### 1. HTTP 웹훅 모드

기본 WebSocket 연결 대신 HTTP 웹훅을 사용할 수 있습니다:

```typescript
// app.ts
import { Bot } from "@tsuki-chat/node-iris";

const bot = new Bot(process.env.IRIS_URL!, {
  httpMode: true,
  port: 3001,
  webhookPath: "/webhook/message",
  logLevel: "debug",
});
```

### 2. 카카오링크 기능

카카오링크를 사용하여 템플릿 메시지를 전송할 수 있습니다:

```typescript
import { KakaoLink } from "@tsuki-chat/node-iris";

const kakaoLink = new KakaoLink(
  process.env.IRIS_URL!,
  process.env.KAKAOLINK_APP_KEY,
  process.env.KAKAOLINK_ORIGIN
);

// 템플릿 메시지 전송
await kakaoLink.send(
  "받는사람",
  12345, // 템플릿 ID
  { message: "안녕하세요!" } // 템플릿 변수
);
```

### 3. 배치 스케줄러

주기적 작업이나 지연된 메시지 전송을 위한 스케줄러:

```typescript
import { BatchScheduler } from "@tsuki-chat/node-iris";

const scheduler = BatchScheduler.getInstance();

// 지연 메시지 스케줄링
scheduler.scheduleMessage(
  "reminder-1",
  context.room.id,
  "10분 후 알림입니다!",
  Date.now() + 10 * 60 * 1000,
  { key: "reminder" }
);
```

### 4. 로깅 시스템

다양한 로그 레벨을 지원하는 통합 로깅:

```typescript
import { Logger, LogLevel } from "@tsuki-chat/node-iris";

// 커스텀 로거 생성
const logger = new Logger(LogLevel.DEBUG);

logger.info("정보 메시지");
logger.warn("경고 메시지");
logger.error("에러 메시지");
logger.debug("디버그 메시지");
```

### 5. 이벤트 에미터

커스텀 이벤트 시스템:

```typescript
import { EventEmitter } from "@tsuki-chat/node-iris";

const eventEmitter = new EventEmitter();

eventEmitter.on("custom-event", (data) => {
  console.log("커스텀 이벤트 수신:", data);
});

eventEmitter.emit("custom-event", { message: "Hello!" });
```

### 6. API 타입 정보

주요 타입들과 인터페이스:

```typescript
// 봇 옵션
interface BotOptions {
  maxWorkers?: number;
  httpMode?: boolean;
  port?: number;
  webhookPath?: string;
  logLevel?: "error" | "warn" | "info" | "debug";
  errorHandler?: ErrorHandler;
  eventHandler?: EventHandler;
}

// 채팅 컨텍스트 주요 속성
interface ChatContext {
  room: Room; // 채팅방 정보
  sender: User; // 발신자 정보
  message: Message; // 메시지 정보
  raw: IrisRawData; // 원시 데이터
  api: IrisAPI; // API 인스턴스

  // 주요 메서드
  reply(message: string, roomId?: string): Promise<any>;
  replyMedia(files: Buffer[], roomId?: string): Promise<any>;
  getSource(): Promise<ChatContext | null>;
  getNextChat(n?: number): Promise<ChatContext | null>;
  getPreviousChat(n?: number): Promise<ChatContext | null>;
}
```

### 7. 오류 처리

적절한 오류 처리 방법:

```typescript
@ErrorController
export default class CustomErrorController extends BaseController {
  @Command
  async onError(context: ErrorContext) {
    this.logger.error("봇 오류 발생:", context.error);

    // 특정 오류 타입에 대한 처리
    if (context.error.message.includes("네트워크")) {
      await context.reply(
        "네트워크 오류가 발생했습니다. 잠시 후 다시 시도해주세요."
      );
    } else {
      await context.reply("알 수 없는 오류가 발생했습니다.");
    }
  }
}

// 카카오링크 오류 처리
try {
  await kakaoLink.send("받는사람", 12345, {});
} catch (error) {
  if (error instanceof KakaoLinkReceiverNotFoundException) {
    console.error("받는 사람을 찾을 수 없습니다.");
  } else if (error instanceof KakaoLinkSendException) {
    console.error("메시지 전송에 실패했습니다.");
  }
}
```

## 참조

- [node-iris](https://github.com/Tsuki-Chat/node-iris)

## 문제 해결

### 봇이 연결되지 않는 경우

1. `.env` 파일의 설정값들이 올바른지 확인
2. 카카오 계정의 2단계 인증 설정 확인
3. API 키가 유효한지 확인

### 명령어가 작동하지 않는 경우

1. 컨트롤러가 올바르게 등록되었는지 확인
2. prefix 설정이 올바른지 확인
3. 데코레이터가 올바르게 적용되었는지 확인

## 라이선스

MIT

## 면책 조항

이 프로젝트는 오직 교육 및 연구 목적으로 제공됩니다. 개발자들은 이 소프트웨어의 오용이나 이로 인한 손상에 대해 책임지지 않습니다. 본인의 책임 하에 사용하시고, 관련 법률 및 서비스 약관을 준수하시기 바랍니다.

This project is provided for educational and research purposes only. The developers are not responsible for any misuse or damage caused by this software. Use it at your own risk and ensure you comply with all applicable laws and terms of service.
