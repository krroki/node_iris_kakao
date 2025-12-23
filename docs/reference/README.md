# Reference 문서 인덱스

12.kakao 저장소에서 구조/명령어와 같이 반복적으로 조회되는 정보를 모으는 공간입니다.

| 문서 | 내용 |
|------|------|
| `project-structure.md` | 저장소 전역 구조, 핵심 디렉터리 책임, 업데이트 체크리스트 |
| `verification-commands.md` | 테스트·스모크·운영 스크립트 명령어 요약 |
| `kakao-mentions-and-reply.md` | 오픈채팅 “실제 멘션(@)” / “답장(Reply)” payload·경로·가드레일 레퍼런스 |
| `kakao-room-command-triggers.md` | 방별 명령어(FAQ) `!등록/!삭제/!명령어/!키` 기능/권한/Reply payload 레퍼런스 |
| `auto-faq-worker.md` | 무명령어 자동 FAQ(질문 트리거) – 후보 추출→승인→자동응답, 강의ID/글로벌 스코프, 링크/일정 가드레일 |
| `outbound-message-style.md` | 발신 메시지 템플릿 지침(튜브렌즈 스타일): 두괄식/구조화/모바일 줄바꿈/푸터 링크 |
| `chat-summary.md` | 채팅 요약(chatSummary) 사용법/범위(오늘 vs 최근 N시간) |
| `openchat-members-google-sheets.md` | 오픈채팅 멤버(닉네임/userId) Google Sheets 업서트(서비스 계정 OAuth) |
| `course-roster-worker.md` | 강의 운영: 오픈채팅 입장자 카페 가입/닉네임 검증 워커(15분/24시간 안내, Sheets 업서트) |
| `course-roster-v2-membership-audit.md` | 강의 운영 v2: 카페 등급(grade) 기반 톡방 참여 점검 + 통합 스프레드시트(RAW→VIEW) |
| `course-ops-v2-web-console.md` | 강의 운영 v2: 외부 동시접속 CourseOps 웹 콘솔(go.yoorang.kr) – 작업 대기열/재검증/담당자·메모 |
| `payment-ssot-google-sheets.md` | 결제 SSOT Google Sheets 연동(권한/검증/활용 기능) |
| `image-worker.md` | Gemini 웹 기반 이미지 생성/수정 워커(`!사진 / !사진수정`) 운영/환경변수/세션 준비 |
| `ui-3100-troubleshooting.md` | UI(3100) “남색 배경만/빈 화면” 문제(Next `/_next/static` 404) 원인·복구·재발 방지 |
| `bridge-status.md` | StatusBar의 BRIDGE/LOG 판정 기준(`heartbeatAgeSec`/`lastEventAgeSec`/`logAgeSec`, LOG LAG) |

> 신규 레퍼런스 문서를 추가할 때는 위 표에 링크를 추가하고, `agents.md`/`claude.md` 온보딩 절차에서 참고하도록 연결하세요.
