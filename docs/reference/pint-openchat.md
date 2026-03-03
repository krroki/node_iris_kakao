# 4.pint 오픈채팅 전용 기능 (커맨드 + 자동 브리핑)

> 목적: **4.pint 오픈채팅방**에만 Pint 데이터(홈/핫영상/소재창고/신규발굴)를 요약해 제공한다.  
> 원칙: **다른 방에는 절대 발신하지 않는다.** 운영 알림은 **test open chat**로만 보낸다.

---

## 1) 적용 범위(방)

- 실방(서비스): `18475321871585649`
- 테스트/운영 알림(test open chat): `18475752914588021`

> 오발송 방지 가드가 코드 레벨로 적용되어, 위 2개 방 외에는 브리핑/커맨드 발신이 동작하지 않는다.

---

## 2) 커맨드(실방/테스트방 공통)

- `!도움말` (또는 `!핀트`)  
  - 사용 가능한 명령어 안내
- `!이슈` / `!핫이슈` / `!소재창고`  
  - 기본: 24h 기준(소재창고)  
  - 옵션: `!이슈 1h`
- `!밤새 [쇼츠|롱|전체]`  
  - “밤새 조회수 상승(viewsWindow)” 기준
- `!핫영상 [쇼츠|롱|전체]`  
  - “지금 뜨는 영상(viewsPerHour)” 기준
- `!신규` / `!루키`  
  - 오늘 신규 발굴(오늘 firstSeen 기준)
- `!급상승`  
  - 오늘 급상승 채널(홈 topChannels)

---

## 3) 자동 브리핑(시간 분리)

### 기본 스케줄(Asia/Seoul)

- 오늘의 핫 이슈(소재창고): `09:10`
- 밤새 조회수 상승한 영상: `10:30`
- 신규 발굴(오늘 신규만): `15:30`
  - 오늘 신규가 **0개면 발신 스킵**(도배 방지)
- hot-videos: `12:00`, `16:00`, `20:00` (하루 3회)

### 중복/재발신 방지

- 각 슬롯은 “하루 1회”만 발신한다.
- 상태 파일: `node-iris-app/data/pint_brief_state.json`
- 상태 키는 **roomId를 포함**한다(테스트방에서 발송해도 실방 발송이 막히지 않도록 분리).
- `graceMin`(기본 10분) 내에 워커가 재기동되면, **지각 발신**이 1회 발생할 수 있다.  
  - 10분이 지나면 해당 슬롯은 스킵한다.

---

## 4) 설정(runtime.json)

설정 위치: `node-iris-app/config/runtime.json`

```json
{
  "pintBriefing": {
    "enabled": false,
    "roomId": "18475321871585649",
    "testRoomId": "18475752914588021",
    "allowProdSend": false,
    "timeZone": "Asia/Seoul",
    "graceMin": 10,
    "issues": { "enabled": true, "at": "09:10", "window": "24h" },
    "overnight": { "enabled": true, "at": "10:30", "only": "all" },
    "rookies": { "enabled": true, "at": "15:30" },
    "hotVideos": { "enabled": true, "ats": ["12:00", "16:00", "20:00"], "only": "all" },
    "studioPolling": { "enabled": true, "origin": "https://pint.kr", "pollSec": 10 },
    "debugSaveImages": true
  }
}
```

- `enabled=true`로 켜야 (구)자동 브리핑(텍스트-only)이 시작된다.
- `roomId`는 **실방/테스트방만 허용**한다(오발송 방지).
- `testRoomId`는 테스트/운영 알림 방을 명시한다(기본: test open chat).
- `allowProdSend=false`가 기본이며, `true`일 때만 `target=prod` 묶음 발송이 허용된다.
- `PINT_ORIGIN` 환경 변수로 Pint origin을 바꿀 수 있다(기본 `https://pint.kr`).
- Briefing Studio 대기열 폴링을 쓰려면 `pintBriefing.studioPolling.enabled=true`를 켠다.

---

## 5) 데이터 소스(사용 API)

- `GET https://pint.kr/api/home/data`
- `GET https://pint.kr/api/trend/hunter/v3/topics` (기본: `region=KR`, `window=24h`, `sort=comments`)

> alerts 관련 기능/페이지는 이 오픈채팅 기능에서 언급/사용하지 않는다.

---

## 6) 장애/실패 처리

- 자동 브리핑 실패 시:
  - **실방 발신은 스킵**한다(실방 도배/내부값 노출 방지).
  - 운영 알림은 **test open chat**에만 1회(dedup) 발신한다.

---

## 7) 이미지 + 텍스트 “묶음 발송”(Pint → 12.kakao)

> 목적: Pint(웹)에서 **이미지(최소 3장)** + **텍스트 상세**를 완성한 뒤,
> 12.kakao는 “전송만” 수행해 브리핑 품질/유지보수를 단순화한다.

### API

- `POST http://127.0.0.1:8650/send/pint/briefing_bundle`
  - ✅ **이미지 묶어보내기(앨범)** → ✅ **텍스트 상세** 순서로 전송한다.
  - ✅ 오발송 방지를 위해 **roomId를 직접 받지 않는다.**

### Body

```json
{
  "target": "test",
  "imageUrls": ["https://...signed...", "https://...signed...", "https://...signed..."],
  "text": "브리핑 상세 텍스트",
  "delayMs": 800
}
```

- `target`
  - `test`(기본): test open chat으로만 전송
  - `prod`: 기본 차단(운영 전환 시에만 허용)
    - 허용 조건: `runtime.json.pintBriefing.allowProdSend=true`
- `imageUrls` 또는 `imagesBase64`
  - 둘 중 하나만 전달한다.
  - 최소 3장 / 최대 6장
  - `imageUrls`: 서버가 URL을 내려받아 base64로 변환 후 앨범으로 발송한다.
  - `imagesBase64`: `data:image/png;base64,...` 형태도 허용(내부에서 prefix 제거)
- `text`
  - 텍스트 상세 메시지(튜브렌즈 스타일 + 링크는 footer 분리 권장)

### 한글/이모지 `??` 깨짐 트러블슈팅

- **증상 1) 실제 발신 텍스트가 `??`로 전송됨**
  - 일부 IRIS 빌드에서 `/reply` 호출 시 JSON charset이 누락되면 한글/이모지가 `?`로 대체될 수 있다.
  - SSOT: `server/app.py`의 `_http_post_json`은 `Content-Type: application/json; charset=utf-8`를 강제한다.
- **증상 2) 파일/콘솔에서만 `??`로 깨져 보임(실제 메시지는 정상)**
  - `node-iris-app/data/logs/**.log`는 UTF-8(JSONL)이며, PowerShell 기본 인코딩(ANSI/CP949)로 읽으면 깨질 수 있다.
  - 확인:
    - `Get-Content -Encoding utf8 node-iris-app/data/logs/<roomId>/<YYYY-MM-DD>.log`
    - (옵션) `$OutputEncoding = [System.Text.Encoding]::UTF8; [Console]::OutputEncoding = [System.Text.Encoding]::UTF8`

---

## 8) Briefing Studio 대기열 폴링(권장)

> 목적: Pint(웹)에서 브리핑을 “완성(이미지+텍스트)”해 **대기열에 넣고**, 12.kakao는 “전송만” 수행한다.

- 브라우저(pint.kr)에서 로컬 봇(127.0.0.1)을 직접 호출하지 않는다(https mixed content/CORS 회피).
- 4.pint `/admin/briefing-studio`에서 이미지 업로드 → `POST /api/admin/briefing-studio/jobs`로 대기열에 추가한다.
- 12.kakao `command-worker`가 `GET /api/briefing-studio/bot/next`를 폴링해 job을 가져오고,
  결과를 `POST /api/briefing-studio/bot/ack`로 되돌린다.
- (자동) job에 `imageUrls`가 비어 있고 `draft.pages`가 있으면, `command-worker`가
  `/briefing-studio/bot/render/:jobId`를 렌더링해 스크린샷을 만든 뒤
  `POST /api/briefing-studio/bot/images`로 업로드하여 발신한다.

### 필수 설정

- 4.pint: `PINT_BRIEFING_BOT_TOKEN` 설정
- 12.kakao: `PINT_BRIEFING_BOT_TOKEN` 설정(서버와 동일값)
- 12.kakao: `node-iris-app/config/runtime.json`의 `pintBriefing.studioPolling.enabled=true`

### 오발송 가드

- Briefing Studio는 기본 `target=test`로만 대기열에 넣는다.
- `prod`는 로컬 봇에서 `allowProdSend=true`가 켜져 있어야만 전송된다(기본 차단).

### 운영 알림(노이즈 방지)

- 대기열이 비어 있거나 `next` 조회가 일시 실패하더라도, 실방/테스트방에 “대기열 확인 실패” 알림을 남발하지 않는다(로그만).
- 조치가 필요한 케이스만 운영 알림으로 올린다.
  - 예: 봇 토큰 미설정, 발송 실패(이미지 묶음/텍스트), ack 실패

---

## 9) 실전(서비스방) 전환 체크리스트

- `node-iris-app/config/runtime.json`
  - `pintBriefing.roomId`: 실방(서비스)으로 설정
  - `pintBriefing.allowProdSend=true`로 전환
  - `pintBriefing.studioPolling.enabled=true`, `origin=https://pint.kr`
- 환경 변수(서버/봇 공통)
  - `PINT_BRIEFING_BOT_TOKEN`이 4.pint와 12.kakao에 동일하게 설정돼 있어야 한다.
- Briefing Studio 운영
  - 먼저 `target=test`로 1회 발송해 “이미지 3장 + 텍스트 상세”가 정상인지 확인한다.
  - 이후 `target=prod`로 대기열에 넣어 서비스방 발송을 확인한다.

---

## 10) Briefing Studio 템플릿 운영 스케줄(권장)

> 목표: “하루 1~2개”만 보내면 템플릿이 많아도 다 못 쓰게 된다.  
> 그래서 **고정 슬롯(하루 6회)**만 유지하고, **템플릿을 요일 로테이션**으로 돌린다. (KST)

### 기본 슬롯(매일)

- `09:10` 커뮤니티 소재(아침)
- `12:00` 실시간 급상승 쇼츠(점심)
- `15:30` 신규/루키(오후)
- `16:00` 소규모 채널 고성과 쇼츠(오후)
- `19:30` 급가속 채널(저녁)
- `20:30` hot-videos 변주(역주행/좀비)(밤)

### 요일 로테이션(추천)

- 월 `09:10` `community_weekly_trend` (주간 요약)
- 화 `09:10` `community_hot_topics_morning`
- 수 `09:10` `community_realtime_surge`
- 목 `09:10` `community_views_explosion`
- 금 `09:10` `community_hot_topics_morning`
- 토 `09:10` `community_realtime_surge`
- 일 `09:10` `community_views_explosion`

- `20:30` 슬롯은 아래를 번갈아 사용
  - 월/수/금/일: `hot_videos_revival_surge`
  - 화/목/토: `hot_videos_shorts_steady`

