# ADR (Architecture Decision Records)

프로젝트의 주요 아키텍처/기술 결정을 기록하고 추적하는 폴더입니다.

## 파일명 규칙

```
ADR-<4자리 번호>-<주제-kebab>.md
```

예: `ADR-0001-adopt-iris-ldplayer.md`, `ADR-0003-fastapi-sse-migration.md`

## 상태 전환

| 상태 | 설명 |
|------|------|
| Draft | AI/사용자와 논의 중 (작성 초안) |
| Proposed | 작성 완료, 리뷰 대기 |
| Accepted | 합의되어 적용됨 |
| Deprecated | 더 이상 유효하지 않음 |
| Superseded | 다른 ADR로 대체됨 (예: `Superseded by ADR-0002`) |

## 템플릿

새 ADR 작성 시 `ADR-0000-template.md`를 복사하여 사용합니다.

## 작성 트리거

다음 상황에서 ADR을 작성합니다:

1. **주요 아키텍처 변경** – 데이터 흐름, 폴더 구조, 핵심 라이브러리 교체
2. **기술적 이견 조율** – AI 제안 vs 사용자 선호 간 결정
3. **비기능적 요구사항** – 성능, 보안, 비용 관련 결정
4. **Workaround 적용** – 버그나 제약사항의 비표준 해결

## 빠른 체크리스트

ADR 작성 시 다음을 확인하세요:

- [ ] Context(배경): Why/문제 정의가 명확한가?
- [ ] Options: 고려한 대안들과 Trade-offs가 있는가?
- [ ] Decision: 최종 결정과 그 이유가 명시되어 있는가?
- [ ] Consequences: 장점, 단점, 후속 작업이 나열되어 있는가?
- [ ] Links: 관련 PR, 문서, 코드 경로가 연결되어 있는가?

## 현재 ADR 목록

| 번호 | 제목 | 상태 | 날짜 |
|------|------|------|------|
| 0001 | LDPlayer + IRIS 채택 | Deprecated (→0002) | 2025-10-28 |
| 0002 | 루팅 안드로이드 + Hyper-V + IRIS 구조 | Accepted | 2025-10-28 |

## Epic Draft PR 연동

브랜치 작업 시 관련 ADR이 있다면 PR 본문에 링크를 추가합니다:

```markdown
## Related ADR
- [ADR-0002: 루팅 안드로이드 + Hyper-V](docs/adr/ADR-0002-adopt-rooted-android-hyperv.md)
```

코드 핵심 지점에는 ADR 참조 주석을 남깁니다:

```typescript
// NOTE: (ADR-0002) Hyper-V VM 내부 Docker에서 IRIS 실행
const IRIS_HOST = process.env.VM_IP || '172.19.x.x';
```
## ADR 목록 (정제 요약)

> 아래 표가 현재 기준으로 유효한 ADR 요약이다.  
> 위쪽에 남아 있는 깨진 한글/구 ADR 내용보다 이 표와 개별 `ADR-000*.md` 파일을 신뢰한다.

| 번호 | 제목                                              | 상태               | 비고                         |
|------|---------------------------------------------------|--------------------|------------------------------|
| 0001 | LDPlayer + IRIS 채택                              | Deprecated (→0002) | 역사 기록용                  |
| 0002 | 루팅 안드로이드(Redroid) + Hyper-V + IRIS 구조   | Accepted           | IRIS/Redroid/Hyper‑V 토폴로지 |
| 0003 | FastAPI + SSE + Next.js 대시보드 전환            | Accepted           | 기본 웹 대시보드/실시간 스택  |
| 0004 | KB 서비스 아키텍처                               | Accepted           | PostgreSQL(Docker) + KB API 인프라 |
| 0005 | 네이버 카페 지식베이스(KB) 시스템                | Accepted           | 수집→임베딩→RAG 파이프라인   |
| 0006 | KB 프로필 분리 + 백필 전략                       | Accepted           | free/paid 분리, 자동 백필    |
| 0007 | KB 벡터 거리 임계값                              | Accepted           | 임베딩 유사도 판정 기준       |
| 0008 | KB 메뉴 SSOT                                     | Accepted           | 게시판 구조 단일 출처         |
| 0009 | nameyee 카페 분리                                | Accepted           | 디하클/nameyee 용도 구분      |
| 0010 | Windows 전용 스택 + IRIS_URL SSOT               | Accepted           | WSL 제거, 5050 포트 표준화    |
| 0011 | 봇 싱글톤 메커니즘                               | Accepted           | PID 락 + 프로세스 필터로 중복 응답 방지 |
| 0012 | API 계약 정합성 및 상태 체크 경량화             | Accepted           | ok 필드 표준화, 캐시 기반 상태, 안전한 봇 종료 |
| 0013 | 빌드 파이프라인 강화 및 명령 파서 정책         | Accepted           | 빌드 강제/검증, ?디하클 필수, UTF-8 로깅 |
| 0014 | KB 임베딩 스케일 재조정 및 검색 임계치 재설정    | Accepted           | dist 스케일 대응, 키워드 보강 검색 |
| 0015 | 임베딩 프로바이더 하드페일 및 OpenAI 전환        | Accepted           | 0벡터 폴백 금지, OpenAI 임베딩 |
| 0016 | SAFE_MODE 동작 및 웹 UI 정렬                     | Accepted           | 발신 완전 차단 SSOT 정리 |
| 0017 | 상태/룸 정보 FS 결합 해소 및 API 단일화          | Accepted           | /status,/rooms 단일 소스 |
| 0018 | RAG 범위 밖 질의에 대한 일반 상식 경로           | Accepted           | out-of-domain 라우팅, 고정 프리픽스 |
| 0019 | 로그 파이프라인 안정성 강화                      | Accepted           | SAVE_CHAT_LOGS 기본 true, logStore 판정 |
| 0020 | 이미지 기반 규칙의 텍스트 매뉴얼화 및 RAG 연동    | Draft              | 이미지→텍스트 매뉴얼 생성 규칙 |
| 0021 | RAG 질의 라우팅 / 컨텍스트 태그 정렬             | Accepted           | context_tags 기반 routing |
| 0022 | Welcome 템플릿 세트 + 카카오 기본 닉네임 분기    | Accepted           | CASE1/CASE2 세트, 기본닉 정규식 |
| 0023 | `/status` 기반 Watchdog 자동 재시작              | Accepted           | 봇/파이프라인 자동 복구 + ensure_watchdog(Task Scheduler 1분/ONLOGON) |
| 0024 | Talk-API authHeader 캡처(Frida)                  | Accepted           | Authorization/Duuid 캡처, data 저장/반영 |
| 0025 | Next.js Web 운영(prod) 고정 + web 헬스체크 재시작  | Accepted           | .next/.next-prod 분리 + `/api/ping`/`/`/`/_next/static` 헬스 + prebuild_guard |
| 0026 | Welcome 후속(첫 이미지) 자동 답장(Reply)          | Accepted           | type=26 Reply + src_* 타입(coerce)로 -203 방지 |
| 0027 | 코어(LogStore) 상시 가동 + 기능 워커 분리(Welcome) | Accepted           | welcome/후속답장을 워커로 분리해 코어 다운타임 최소화 |
| 0028 | AI 응답을 ai-worker로 분리 (LogStore 구독 기반)   | Accepted           | `?디하클` 질의 처리를 bot에서 분리, KB 호출/발신은 워커가 담당 |
| 0029 | 공지/브로드캐스트 발신을 broadcast-worker로 분리 (LogStore 구독 기반) | Accepted | bot 내부 공지/브로드캐스트 발신을 worker로 분리, watchdog 단독 복구 |
| 0030 | Welcome-worker 템플릿 이미지 발신을 IRIS /reply로 복구 (Realtime API 브리지) | Accepted | 템플릿 이미지 발신 복구, SAFE_MODE 최종 차단 유지 |
| 0031 | MessageStore EMFILE(too many open files) 완화 및 자동복구 정렬 | Accepted | 동시성 제한 + EMFILE 백오프 재시도 + 상태 가시화(`/status`) |
| 0032 | 강의 운영(카페/닉네임 검증) 워커 + 15분/24시간 안내 정책 | Accepted | 오픈채팅 입장자 검증/안내 + Sheets 업서트 |
| 0033 | 오픈채팅 멤버(전체) Sheets 자동 동기화 워커 | Accepted | 오픈채팅 멤버 userId/닉네임 upsert + 10분 주기 스케줄 |
| 0034 | Talk-API 실패 시 IRIS `/reply` 기반 텍스트 폴백 | Accepted | `/send/iris/reply_text` + worker/command explicit fallback |
| 0035 | 오픈채팅 방별 명령어(FAQ) 트리거 워커(command-worker) | Accepted | `!등록/!삭제/!명령어/!키` + Reply(type=26) 기반 응답 |
| 0036 | 발신 메시지 템플릿(튜브렌즈 스타일) 표준화 | Accepted | userId/타임스탬프/보고서형 섹션 금지 + 푸터 링크 |
| 0037 | 무명령어 자동 FAQ(auto-faq-worker) – Reply + 이미지(업로드) | Accepted | 전역/강의ID/방별 트리거 승인 기반 자동응답 |
| 0038 | 채팅 요약(chatSummary) 해결책/결론 중심(Q&A) 요약 | Accepted | 메타 설명 금지 + 문제→해결 구조(상위 3~5개) |
| 0039 | 강의 운영 v2 — 카페 멤버 자동 갱신 + 등급 기반 톡방 참여 점검 + 통합 스프레드시트 | Accepted | 코스 단위 RAW→VIEW 점검 시트 |
| 0041 | 카카오 기본 닉네임 변경 요청(멘션) 워커 | Accepted | 멤버 완전성(스크롤 로딩) 확인 후 멘션 발신 |
| 0040 | roster-worker 카페 데이터 소스 — CSV(레거시) → 크롤러(JSON 스냅샷) 기본값 | Accepted | 강의 운영(v1) 설정 UX 단순화, 수동 CSV 의존 제거 |
| 0042 | node-iris Logger 파일 핸들 누수(EMFILE) 핫픽스 | Accepted | 공유 winstonLogger(transport 단일)로 핸들 누수 차단 |
| 0043 | Welcome 오픈프로필 닫기 안내 + 5분 기본닉 리마인더 | Superseded (→0045) | 기록용(운영 정책 변경으로 대체) |
| 0044 | 강의 운영 UI를 `/course` 탭으로 통합 | Accepted | RoomCard 강의 운영 입력 제거 + 코스 단위 관리 |
| 0045 | Welcome 오픈프로필 닫기 안내(첫 이미지 트리거) + 리마인더 제거 | Accepted | 오픈프로필 안내를 첫 이미지 업로드에서만 트리거 + 리마인더 전부 제거 |
| 0046 | 강의 운영 v2 — 외부 동시접속 CourseOps 웹 콘솔(go.yoorang.kr) | Accepted | ACTIONS 중심 운영 UI |
| 0054 | Pint Briefing Studio 실전 발신(묶음) 가드 및 운영 경로 | Accepted | 4.pint SSOT + 12.kakao 전송 파이프라인 + UTF-8 invariant |
| 0055 | Pint Briefing Studio 봇 토큰 동기화(개행/CRLF 혼입 방지) | Accepted | 403(권한 없음) 재발 방지 운영 규칙 |
| 0047 | CourseOps 메인 카페 홈 지표(글로벌 스냅샷) | Accepted | 메인 카페 요약 지표 업로드/조회 |
| 0048 | Watchdog Talk-API(talkapi-loco) ensure + heartbeat | Deprecated (→0050) | 실발송 기반 상태 갱신(금지) |
| 0049 | Talk-API 전송을 Frida/LOCO 기반 로컬로 대체 | Deprecated (→0050) | 계정 리스크로 금지 |
| 0050 | talkapi-loco(LOCO) 금지 + HTTP TalkApi로 복귀 | Accepted | 계정 영구정지 리스크 대응 |
| 0051 | CourseOps 오픈채팅 현황 SSOT 정렬(방장/닉네임/썸네일) | Accepted | 운영진/대화 흐름 모니터링 안정화 |
