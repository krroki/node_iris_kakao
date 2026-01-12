# CourseOps v2 오픈채팅 현황: 활동 TOP/급증/말많은 사람 랭킹 (구현 계획서)

## 배경
- 현재 `/openchat` 페이지는 “방별”로 인원/운영진/오늘 대화수/스파크라인을 보여준다.
- 운영 입장에서는 **지금 가장 활발한 방**, **평소 대비 급증한 방(이상징후/이벤트)**, **오늘 말이 많은 멤버**를 “한 번에” 보고 싶다.
- 목표는 비개발자도 즉시 이해 가능한 **TOP 랭킹 섹션**을 추가하는 것이다.

## 범위 (이번 계획서에 포함)
- 오늘 대화 TOP: 오늘(자정~현재) 메시지 수가 가장 많은 방을 순위로 보여준다.
- 최근 1시간 대화 TOP: 지금 가장 뜨거운 방을 바로 찾는다.
- 7일 평균 대비 급증 TOP: 평소 대비 오늘 대화가 크게 늘어난 방을 보여준다(이상징후/이벤트 감지).
- 말많은 사람 TOP(전 방 통합): `랭킹 | 방이름 | 닉네임 | 오늘 대화수` 형태의 리스트를 제공한다.

## 비범위 (이번에는 구현하지 않음)
- 입장/퇴장/순증/이탈률 등 “멤버 이벤트” 기반 지표
- “들어온 인원보다 나간 인원이 더 많은 방”, “오늘 입장이 가장 많은 방” 등
- 채팅 로그 내용/검색, 워커 상태/기능 세부, 운영 플로우 화면 확장

## 용어/정의 (SSOT)

### 시간대
- 기준 시간대: KST(+09:00)
- “오늘”: KST 00:00:00 ~ 스냅샷 생성 시각

### 대화수 정의
- MessageStore 로그에서 `payload.type == "message"` 이벤트 건수
- 텍스트/이미지/기타 분류는 기존 로직(`classifyMessage`)을 그대로 사용한다.
- 시스템 이벤트(입장/퇴장/공지 등)는 대화수에서 제외한다.

### 최근 1시간 정의(SSOT)
- v2(슬라이딩): **최근 60분(슬라이딩 윈도우)** 메시지 수 (이번 구현 선택)
  - 예: 현재 12:16이면 11:16~12:16 집계
  - 장점: “지금 핫한 방” 체감에 더 정확
  - 단점: 분 단위 집계(링버퍼/윈도우)가 필요해 구현/운영 난이도가 올라간다
- (대안) v1(시간 단위): **직전 완료된 1시간 구간**(정각~정각)의 메시지 수
  - 예: 현재 12:16이면 11:00~11:59 집계
  - 장점: 구현/설명이 단순하고 순위가 덜 흔들린다
  - 단점: “지금(최근 60분)”과 최대 59분 차이가 날 수 있다

### 7일 평균 대비 급증 정의(SSOT)
- 비교 기간: 오늘을 제외한 직전 7일(D-1…D-7)
- 비교 단위: **최근 60분(슬라이딩 윈도우)** 메시지 수
  - todayLast1h: 최근 60분 메시지 수(= Hot Live와 동일 정의)
  - avg7dLast1h: 과거 7일의 “동시간대 최근 60분” 평균
    - v1(권장): 분 단위 링버퍼로 정확 집계(가능하면)
    - v1-대안: 시간 단위(hourly)로 근사(분 단위 데이터가 없을 때)
  - surgePct: `(todayLast1h - avg7dLast1h) / max(avg7dLast1h, 1) * 100`
  - surgeDelta: `todayLast1h - avg7dLast1h`

## 데이터 소스/파이프라인(현행)
- 원천 로그: `data/logs/<room>/<YYYY-MM-DD>.log` (jsonl)
- 집계 주체: `courseops/agent` 의 Openchat overview sync(현행)
- 상태 파일(중간): `node-iris-app/data/courseops_openchat_overview_state.json`
- 업로드 스냅샷: console global snapshot key `openchat_overview`
- UI: `courseops/console` 의 `/openchat`

## 데이터 스키마 확장안(제안)

### 1) per-room 필드 확장 (`openchat_overview.rooms[*]`)
랭킹 계산을 위한 최소 필드를 per-room에 싣고, UI/정렬은 console에서 처리한다.

- `last1h`: `{ total: number }`
  - v2(슬라이딩) 기준이면 “최근 60분 윈도우 합”을 저장한다
- `avg7dLast1h`: `{ total: number }` (선택)
  - “급증” 계산을 위한 과거 7일의 동시간대 최근 60분 평균
- `topTalkersToday`: `{ nickname: string; total: number }[]` (선택)
  - room 내 TOP N(예: 20)만 싣고, 전 방 통합 TOP은 이 리스트를 평탄화해서 계산

### 2) global rankings 필드 추가(대안) (`openchat_overview.rankings`)
console에서 계산 부담을 줄이고 싶다면 스냅샷에 “미리 계산된 TOP”을 포함한다.

- `todayTopRooms`: `{ roomId: string; total: number }[]`
- `last1hTopRooms`: `{ roomId: string; total: number }[]`
- `surgeTopRooms`: `{ roomId: string; todayLast1h: number; avg7dLast1h: number; surgePct: number; surgeDelta: number }[]`
- `todayTopTalkers`: `{ roomId: string; nickname: string; total: number }[]`

> 내부적으로 roomId/userId를 쓰더라도, **UI/응답에는 숫자 식별자를 절대 노출하지 않는다.**

## 집계/정렬 로직(권장)

### 1) 오늘 대화 TOP
- 대상 값: `room.today.total` (자정~현재)
- 정렬: `total desc`
- 기본 노출: TOP 10 (UI에서 “더보기”로 확장 가능)

### 2) 최근 1시간 대화 TOP
- v2(슬라이딩 60분) 구현(권장):
  - `now` 기준 `now-60분 ~ now` 구간의 메시지 수를 집계한다.
  - 구현 방식은 아래 중 하나를 선택한다.
    - (권장) 분 단위 링버퍼(60 버킷): `minuteEpoch -> count` 로 보관하고 윈도우 합을 계산
    - (대안) 최근 N개 timestamp 큐: 메시지가 매우 많은 방에서 메모리 상한 관리가 필요
- 정렬: `last1h.total desc`

### 3) 7일 평균 대비 급증 TOP (슬라이딩 60분 v2)
- 계산:
  - `todayLast1h = last1h.total`
  - `avg7dLast1h = round(mean(pastLast1h))` for d in (D-1…D-7)
  - `surgePct = (todayLast1h - avg7dLast1h) / max(avg7dLast1h, 1) * 100`
  - `surgeDelta = todayLast1h - avg7dLast1h`
- 정렬: `surgePct desc`, 동률이면 `surgeDelta desc`
- 데이터 부족 처리:
  - past 데이터가 충분하지 않으면(예: 유효 pastLast1h < 3) 랭킹에서 제외하거나 “데이터 부족”으로 표시한다.

### 4) 말많은 사람 TOP(전 방 통합)
- 단위: `(room, member)` 페어(= 같은 닉네임이어도 방이 다르면 별개 row)
- 집계:
  - 오늘 메시지에서 `senderId`별 카운트
  - 표시 닉네임은 오늘 로그에서 관측된 `senderName`의 최신값(또는 가장 최근 timestamp) 사용
- 정렬: `오늘 대화수 desc`, 동률이면 `최근 발화 시각 desc`
- 필터/주의:
  - “의심 닉네임(해시/암호문/장문 숫자 등)”은 제외하거나 “미확인” 처리(정책 확정 필요)
  - “봇 계정 제외”는 **정확한 allowlist/식별**로만 수행한다(예: 단순히 `ai` 포함 같은 규칙 금지)
- 결과 노출 컬럼(요구사항):
  - `랭킹 | 방이름 | 닉네임 | 오늘 대화수`

## UI 노출안(데모 이미지 반영 예정)
- `/openchat` 상단에 “활동 TOP” 섹션을 추가한다.
  - 오늘 TOP / 최근 1시간 TOP / 급증 TOP 을 각각 카드/테이블로 배치
  - 각 row는 “순위, 방 이름, 수치” 중심으로 단순화(비개발자 가독성 우선)
  - 급증은 `+%`(ratio)와 `+Δ`(delta)를 함께 표시하는 것을 권장
- “말많은 사람 TOP” 섹션을 별도 테이블로 제공한다.
  - `랭킹 | 방이름 | 닉네임 | 오늘 대화수`
  - (선택) TOP N 선택, 검색/필터, “방 상세로 이동” 액션
- 공통: “마지막 갱신” + “지금 갱신” UX는 유지한다.

## 데모 UI 반영 메모(2026-01-12)
아래 항목은 전달받은 데모 UI(영상/이미지)를 기준으로, 계획서의 “최종 화면 형태”를 구체화하기 위한 메모다.

### 화면 구성(권장)
- 상단 헤더
  - 우측 요약 칩(예): `총 관리 방`, `총 인원`, `오늘 총 대화`
  - `LAST SYNC`(마지막 갱신) 표기 + `지금 갱신` 버튼 유지
- 상단 3열 랭킹 카드
  - `오늘 대화 TOP 5`(왕관 아이콘)
  - `최근 1시간(Hot Live)`(불 아이콘)
  - `급상승(Surge) 감지`(번개 아이콘)
  - 급상승 row 오른쪽에 `+%`를 크게, `증가량 +Δ건`을 작은 보조 텍스트로 표기
- 검색/정렬 바
  - “방 이름으로 검색” 입력
  - 정렬 토글(예): `대화량순` / `급상승순` / `인원순`
- 메인 그리드(방 카드)
  - 카드 헤더: 썸네일(있으면 이미지, 없으면 이니셜/컬러) + 방 이름 + 인원수 pill
  - 핵심 수치: `오늘 N건` + 보조로 `(어제: M건)` 또는 `(7일 평균: A건)` 중 하나
  - `1시간내: H건` 표기(최근 1시간 랭킹과 동일 정의로 맞춤)
  - 운영진: `방장`, `부방장` (닉네임만, 의심값은 “미확인” 처리)
  - 하단: `WEEKLY ACTIVITY TREND`(7일 스파크라인)
  - 카드 강조: 급상승 TOP에 포함되면 카드에 “급상승” 뱃지/테두리 강조
- 우측 사이드(말많은 사람 TOP)
  - 제목(예): `오늘의 헤비 유저`
  - 리스트 row: `RANK` + `USER(닉네임)` + `MSGS(오늘 대화수)`
  - 닉네임 아래 보조텍스트로 “방 이름”을 노출(요구 컬럼 충족을 위해)

### 상세 패널(방 클릭 시, 우측 Drawer/Modal)
- `오늘 시간대별 활동(Hourly)` 막대차트(hover tooltip 포함)
- `운영진 상세 정보`: 방장/부방장 목록을 chip 형태로 노출
- `최근 7일 상세 분석`: 날짜별 대화량 테이블
  - (참고) 데모에는 `유입 인구(입/퇴/순)` 같은 컬럼이 보이는데, 이는 “비범위”로 유지하고 추후 합의 후 추가한다.

## 관련 문서/코드 위치(빠른 탐색)
- Agent(집계/업로드): `courseops/agent/src/index.js`
  - Openchat 스냅샷 생성: `syncOpenchatOverviewOnce`
  - 로그 반영: `applyMessageToRoomState`, `updateRoomUtcFileFromLog`
- Console API: `courseops/console/app/api/global/openchat/route.ts`
- UI: `courseops/console/app/(app)/openchat/ui/OpenchatView.tsx`
- 운영 UI 가이드/메뉴 설명: `docs/reference/course-ops-v2-web-console.md`
- UI/UX 준수 규칙: `docs/agents.md`

## 구현 단계(체크리스트)

### 1) Agent(집계/스냅샷) 작업
- [x] `last1h` 계산 로직 추가(슬라이딩 60분 v2, 분 단위 링버퍼)
- [x] `avg7dLast1h` 계산 로직 추가(급상승은 슬라이딩 60분 SSOT)
- [x] `topTalkersToday` 집계용 sender 카운터 추가(메모리 상한/프루닝 포함)
- [x] openchat_overview payload에 per-room 필드 또는 global rankings 필드 포함

### 2) Console API 작업
- [x] `/api/global/openchat` 응답에 TOP 섹션용 데이터 포함
- [x] 사용자 노출 필터(숫자 식별자/의심 닉네임) 방어 로직을 한 곳에 모은다

### 3) UI 작업
- [x] `OpenchatView`에 “활동 TOP”/“말많은 사람 TOP” 섹션 추가
- [x] `docs/agents.md`의 “UI/UX·디자인 구현 가이드(4.pint 준용)” 규칙을 적용한다

### 4) 테스트/검증
- [ ] Vitest: 정렬/타이브레이크/데이터 부족/의심 닉네임 필터 케이스
- [ ] 스모크: 랭킹 섹션이 비어있지 않은지, 의심 닉네임이 과도하게 남지 않는지(카운트 기반)

## 결정이 필요한 항목(UI 데모 후 확정)
- [x] 급증 정렬 우선순위: ratio(pct) 우선, 동률이면 delta 우선
- [x] 노출 개수: TOP 5(방), TOP 25(말많은 사람)
- [x] 말많은 사람: `(room, member)` 기준 유지(요구 컬럼 충족 우선)
