# 카카오톡 멘션 및 오픈채팅 멤버 연동 조사 보고서

> 작성일: 2025-11-26
> 목적: 실제 @ 멘션 기능 구현 및 오픈채팅방 참여인원 실시간 연동 가능성 조사

---

## 1. 멘션(Mention) 기능 조사 결과

### 1.1 현재 상태 요약

| 항목 | 상태 | 비고 |
|------|------|------|
| IRIS `/reply` API 멘션 지원 | ❌ 미지원 | text, image만 지원 |
| node-iris SDK 멘션 API | ❌ 없음 | `replyRich()`, `replyWithMentions()` 존재하지 않음 |
| 기존 구현 코드 | ❌ 동작 불가 | 존재하지 않는 API 호출 시도 |

### 1.2 카카오톡 멘션 프로토콜 구조 (LOCO)

카카오톡 내부적으로 멘션은 `attachment.mentions` 배열로 처리됩니다:

```javascript
{
  type: 1,  // TEXT 메시지
  message: "@홍길동 안녕하세요!",
  attachment: {
    mentions: [{
      at: [1],              // 멘션 순번(1-based). 오프셋이 아님.
      len: 3,               // 멘션 텍스트 길이('@' 제외, UTF-16 code unit 기준)
      user_id: 1234567890   // 대상 사용자 ID(int64/Long)
    }]
  }
}
```

**중요 제약사항:**
- `at`는 위치가 아니라 “멘션 순번”이다. 같은 사용자를 여러 번 멘션하면 `at: [1,3]` 처럼 배열이 늘어난다.
- `len`은 `@` 제외, UTF-16 code unit 기준(JS/Kotlin `String.length`와 동일). 닉네임에 이모지가 있으면 Python `len()`과 값이 달라질 수 있다.
- 한 메시지당 **최대 15회**까지만 멘션 가능 (카카오 서버 측 제한)

### 1.3 멘션 구현 가능한 방법들

#### 방법 A: IRIS 앱 수정 (권장)

IRIS 안드로이드 앱의 `/reply` API를 수정하여 `attachment` 파라미터 추가:

```kotlin
// ReplyService.kt 수정 필요
data class ReplyRequest(
    val type: String,      // "text", "image"
    val room: String,      // 채팅방 ID
    val data: String,      // 메시지 내용
    val attachment: String? // JSON: {"mentions": [...]}  <-- 추가
)
```

**장점:** 가장 안정적, 기존 인프라 활용
**단점:** IRIS 소스 수정 및 APK 재빌드 필요

#### 방법 B: node-kakao 라이브러리 사용

[storycraft/node-kakao](https://github.com/storycraft/node-kakao) - LOCO 프로토콜 직접 구현

```typescript
import { ChatBuilder, MentionContent, KnownChatType } from 'node-kakao';

// 멘션 메시지 전송
const builder = new ChatBuilder();
for (const user of channel.getAllUserInfo()) {
    builder.append(new MentionContent(user)).text(' ');
}
channel.sendChat(builder.build(KnownChatType.TEXT));
```

**장점:** 멘션 포함 완전한 기능
**단점:**
- 별도 로그인 세션 필요 (계정 밴 위험)
- 카카오 약관 위반 가능성
- PC카톡 위장 클라이언트로 감지 시 영구정지

#### 방법 C: shareKakao 모듈 참고

[LiF-Lee/shareKakao](https://github.com/LiF-Lee/shareKakao) 구조 참고:

```javascript
const shareKakao = require("share.js");
const Kakao = new shareKakao();

Kakao.share("chat_id", {
    type: 1,
    message: "@Example 안녕!",
    attachment: {
        mentions: [{
            at: [1],
            len: 7,
            user_id: 123456789  // int64/Long
        }]
    }
});
```

### 1.4 결론 및 권장사항

| 방법 | 난이도 | 안정성 | 권장도 |
|------|--------|--------|--------|
| IRIS 앱 수정 | 중 | 높음 | ⭐⭐⭐ |
| node-kakao | 상 | 낮음 | ⭐ |
| 텍스트 @이름 유지 | 하 | 높음 | ⭐⭐ |

**권장:**
1. 단기: 현재 텍스트 `@이름` 방식 유지
2. 중기: IRIS 앱 포크하여 멘션 attachment 지원 추가

---

## 2. 오픈채팅방 참여인원 실시간 연동

### 2.1 공식 API 지원 여부

카카오 공식 답변 (devtalk.kakao.com):
> "아쉽지만, 오픈채팅 관련 API는 제공하지 않습니다."

**결론:** 공식 REST API로는 오픈채팅방 멤버 목록 조회 **불가**

### 2.2 비공식 방법들

#### 방법 A: IRIS /query API + 카카오톡 로컬 DB

카카오톡 안드로이드 앱의 SQLite 데이터베이스를 직접 쿼리:

```sql
-- 오픈채팅방 멤버 테이블 (추정)
SELECT * FROM open_link_member WHERE link_id = ?;
SELECT * FROM open_members WHERE chat_id = ?;
```

**IRIS /query 엔드포인트:**
```bash
POST /query
{
  "query": "SELECT * FROM open_link_member WHERE link_id = ?",
  "bind": ["123456789"]
}
```

**제약사항:**
- 테이블 스키마가 카카오톡 버전마다 다를 수 있음
- 루팅된 기기 또는 Redroid 필요
- 실시간 동기화는 DB 폴링으로 구현해야 함

#### 방법 B: node-kakao getAllUserInfo()

```typescript
// 채널의 모든 사용자 정보 조회
const users = channel.getAllUserInfo();
for (const user of users) {
    console.log(user.userId, user.nickname);
}
```

#### 방법 C: 입퇴장 이벤트 기반 추적

IRIS의 `new_member`, `del_member` 이벤트를 활용하여 자체 멤버 목록 관리:

```typescript
// node-iris-app 현재 구현
bot.on('new_member', async (context) => {
    // 입장 시 멤버 추가
    memberStore.add(context.room.id, context.sender);
});

bot.on('del_member', async (context) => {
    // 퇴장 시 멤버 제거
    memberStore.remove(context.room.id, context.sender);
});
```

**장점:** 별도 API 없이 이벤트 기반 추적
**단점:** 봇 시작 전 기존 멤버 목록은 별도 초기화 필요

### 2.3 실시간 연동 구현 계획

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  카카오톡 DB    │────▶│    IRIS      │────▶│  node-iris  │
│  (Redroid/폰)   │     │  /query API  │     │  memberStore│
└─────────────────┘     └──────────────┘     └─────────────┘
        │                                           │
        │  입퇴장 이벤트                            ▼
        └─────────────────────────────────▶  실시간 UI 반영
                                            (SSE/WebSocket)
```

### 2.4 권장 구현 방식

1. **초기 로딩:** IRIS `/query`로 `open_link_member` 테이블 조회
2. **실시간 업데이트:** `new_member`/`del_member` 이벤트 구독
3. **UI 반영:** FastAPI SSE 또는 WebSocket으로 프론트엔드 푸시

---

## 3. 참고 자료

### 3.1 GitHub 프로젝트

| 프로젝트 | 설명 | URL |
|----------|------|-----|
| dolidolih/Iris | IRIS 안드로이드 봇 | https://github.com/dolidolih/Iris |
| storycraft/node-kakao | LOCO 프로토콜 라이브러리 | https://github.com/storycraft/node-kakao |
| LiF-Lee/shareKakao | 카카오톡 공유 모듈 | https://github.com/LiF-Lee/shareKakao |
| NyangBotLab/DBManager | DB 기반 봇 모듈 | https://github.com/NyangBotLab/DBManager_deploy |
| jhleekr/kakao.py | Python LOCO 래퍼 | https://github.com/jhleekr/kakao.py |

### 3.2 카카오 공식 문서

- [카카오 멘션 기능 안내](https://cs.kakao.com/helps_html/1073207821)
- [카카오 데브톡 - 오픈채팅 API 문의](https://devtalk.kakao.com/t/topic/127683)

### 3.3 커뮤니티

- 카카오톡 봇 커뮤니티 카페: https://cafe.naver.com/nameyee
- KBotDocs 문서: https://kbotdocs.github.io/kbotdocs/

---

## 4. 다음 단계 (Action Items)

### 4.1 멘션 기능
- [ ] IRIS 소스코드 포크 및 `/reply` API 수정 검토
- [ ] attachment.mentions 파라미터 추가 PR 작성
- [ ] 테스트용 APK 빌드 및 Redroid 배포

### 4.2 멤버 목록 연동
- [ ] IRIS `/query`로 `open_link_member` 테이블 스키마 확인
- [ ] memberStore 서비스에 초기 로딩 로직 추가
- [ ] SSE 엔드포인트에 멤버 변경 이벤트 추가

### 4.3 주의사항
- 카카오톡 약관 위반 시 계정 영구정지 가능
- LOCO 프로토콜 직접 사용은 권장하지 않음
- DB 직접 접근은 루팅/Redroid 환경에서만 가능
