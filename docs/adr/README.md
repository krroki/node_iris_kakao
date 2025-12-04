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
