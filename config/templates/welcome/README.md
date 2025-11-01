# 환영 메시지 템플릿

새로운 사용자가 채팅방에 입장했을 때 자동으로 발송되는 환영 메시지 템플릿입니다.

## 템플릿 파일

| 파일 | 설명 | 용도 |
|------|------|------|
| `default.json` | 기본 환영 메시지 | 상세한 안내 포함 |
| `simple.json` | 간단한 환영 메시지 | 짧고 간결한 안내 |

## 템플릿 형식

```json
{
  "version": "1.0",
  "templateName": "템플릿_이름",
  "messages": {
    "text": "환영 메시지 내용",
    "image": "이미지_경로_또는_null"
  },
  "settings": {
    "sendDelay": 1000,
    "sendImage": false,
    "logWelcome": true
  }
}
```

## 사용 가능한 변수

템플릿 메시지에서 다음 변수를 사용할 수 있습니다:

- `{userName}`: 입장한 사용자의 이름
- `{roomName}`: 현재 채팅방 이름
- `{time}`: 현재 시간
- `{date}`: 현재 날짜

### 예제

```json
{
  "text": "{userName}님, {roomName}에 오신 것을 환영합니다!\n입장 시간: {time}"
}
```

## 템플릿 적용 방법

### 1. 전역 설정
`.env` 파일에 기본 템플릿 지정:
```env
WELCOME_TEMPLATE=default
```

### 2. 방별 설정
특정 방에 다른 템플릿 적용 (향후 구현):
```typescript
// 방 설정 DB에서 템플릿 지정
room.settings.welcomeTemplate = "simple"
```

## 이미지 추가

환영 메시지에 이미지를 포함하려면:

1. 이미지 파일을 `config/templates/welcome/images/` 폴더에 저장
2. 템플릿 JSON의 `image` 필드에 파일명 지정:
   ```json
   {
     "messages": {
       "text": "환영합니다!",
       "image": "images/welcome.png"
     },
     "settings": {
       "sendImage": true
     }
   }
   ```

## 커스텀 템플릿 생성

새로운 템플릿을 만들려면:

1. 기존 템플릿(예: `default.json`)을 복사
2. 새 이름으로 저장 (예: `custom.json`)
3. 메시지 내용 수정
4. `.env`에서 새 템플릿 지정

## 테스트

템플릿을 테스트하려면:

```bash
# 로컬 테스트 (Mock 모드)
cd node-iris-app
npm run dev

# 테스트 방에서 새 사용자 초대
# 환영 메시지가 자동으로 발송되는지 확인
```

## 로그

환영 메시지 발송 내역은 다음 위치에 저장됩니다:
- `data/logs/{roomId}/welcome.log`

로그 형식:
```json
{
  "timestamp": "2025-10-30T15:30:00.000Z",
  "roomId": "12345",
  "userId": "67890",
  "userName": "홍길동",
  "template": "default",
  "success": true
}
```
