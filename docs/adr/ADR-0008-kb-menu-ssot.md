# ADR-0008: KB 메뉴 SSOT (Single Source of Truth) 도입

## Meta

- **Date**: 2025-12-02
- **Status**: Accepted
- **Authors**: 운영자, Claude
- **Related Session**: Phase 3 KB/RAG 개선 작업

## Context (배경)

- 디하클 카페 메뉴 정보가 여러 곳에 분산되어 있음:
  - `kb/ingest.py`: `KB_MENUS` 환경변수에서 메뉴 ID 파싱
  - `kb/profiles.yaml`: profile별 menu_ids 관리
  - `/kb` UI (TypeScript): `MENU_GROUPS`, `MENU_NAMES` 하드코딩
- 메뉴 추가/변경 시 3곳을 동기화해야 하며, 불일치 시 버그 발생
- 프로필 기반 검색 기능 추가에 따라 메뉴-프로필 매핑이 필요

### 제약 조건
- 기존 `profiles.yaml` 구조 유지 (ADR-0006 호환)
- 점진적 마이그레이션 (기존 코드 즉시 변경 부담 최소화)

## Options Considered (고려한 대안)

### Option A: profiles.yaml을 SSOT로 확장
- 설명: profiles.yaml에 메뉴 이름, collect 여부 등 추가
- 장점: 단일 파일 관리
- 단점: YAML 구조 복잡화, profile과 메뉴 정의가 혼재

### Option B: DB 테이블로 메뉴 관리
- 설명: PostgreSQL에 `kb_menus` 테이블 생성
- 장점: 동적 수정 가능, UI 연동 용이
- 단점: DB 의존성 증가, 초기 설정 복잡

### Option C: JSON SSOT 파일 + 로더 모듈 (선택됨)
- 설명: `config/menus_dinohighclass.json`을 SSOT로 지정, `kb/menu_ssot.py` 모듈로 로드
- 장점:
  - 단순한 JSON 구조로 가독성 좋음
  - Git 추적 가능 (변경 이력 관리)
  - profiles.yaml과 교차 검증 로직 구현 가능
  - ingest, search, UI 모두에서 참조 가능
- 단점: 런타임 수정 불가 (재배포 필요)

## Decision (결정)

**우리는 Option C (JSON SSOT + 로더 모듈)를 선택했다.**

그 이유는:
1. 메뉴 정보가 자주 변경되지 않음 (카페 구조가 안정적)
2. Git 버전 관리로 변경 이력 추적 가능
3. profiles.yaml 검증 로직으로 불일치 사전 감지
4. 점진적 마이그레이션: UI는 추후 SSOT 연동, 현재는 하드코딩 유지

### Invariants (불변식)
- `config/menus_dinohighclass.json`이 메뉴 정의의 유일한 소스
- `collect=true`인 메뉴만 ingest 대상
- 하나의 메뉴는 하나의 profile에만 속함 (중복 배정 금지)
- `KB_MENUS` 환경변수 설정 시 SSOT보다 우선 (오버라이드)

## Consequences (결과)

### 긍정적 효과
- 메뉴 정보 단일화로 동기화 오류 방지
- profile 기반 검색 기능 구현 가능
- ingest 시 `KB_MENUS` 미설정 시 자동으로 collect=true 메뉴 사용

### 부정적 효과 / 리스크
- 메뉴 변경 시 JSON 수정 + 재배포 필요
- UI 하드코딩은 별도 마이그레이션 필요 (Phase 4)

### 후속 작업
- [x] SSOT 파일 정비: `config/menus_dinohighclass.json` profile 필드 추가
- [x] 로더 모듈 생성: `kb/menu_ssot.py`
- [x] ingest.py 연동: SSOT에서 collect 메뉴 자동 로드
- [x] search.py 연동: profile → menu_ids 조회
- [ ] UI 마이그레이션: MENU_GROUPS/MENU_NAMES를 SSOT에서 파생 (Phase 4)

## Implementation Details (구현 상세)

### SSOT 파일 구조
```json
{
  "cafe_id": 30819883,
  "menus": [
    {
      "menu_id": 23,
      "name": "📖 무료 특강 신청",
      "collect": true,
      "profile": "free"
    },
    {
      "menu_id": 42,
      "name": "정규 강의 신청",
      "collect": true,
      "profile": "paid"
    }
  ]
}
```

### 프로필-메뉴 매핑
| Profile | Menu IDs | 설명 |
|---------|----------|------|
| free | 23, 32 | 무료 특강 |
| paid | 42 | 정규 강의 |
| tips | 48, 136, 51 | 꿀팁 모음 |
| community | 33, 206, 62, 245 | 커뮤니티 |
| main | (all collect=true) | 전체 수집 대상 |

### 주요 함수
- `get_collect_menu_ids()`: collect=true 메뉴 목록
- `get_menu_ids_by_profile(profile)`: 프로필별 메뉴 ID
- `validate_against_profiles_yaml()`: profiles.yaml 교차 검증

### (참고) 템플릿 SSOT와의 관계

- 공지/환영/브로드캐스트/스케줄 등에서 사용하는 **메시지 템플릿**은 메뉴 SSOT와 별도의 SSOT로 관리한다.
  - 경로: `node-iris-app/config/templates/<category>/*.json`
  - 로더/관리 코드: `server/log_utils.list_templates`, FastAPI `/templates*` 계열, Next `/templates`, `/settings` UI
- 메뉴 SSOT와 템플릿 SSOT의 공통 원칙:
  - Git에서 버전 관리되는 JSON 파일이 단일 소스이며, 다른 경로/형식의 템플릿/메뉴 정의는 점진적으로 제거/마이그레이션한다.
  - 런타임 설정(`runtime.json.templateByFeature`)에는 템플릿 **파일명(name)**만 저장하고, 실제 내용은 항상 SSOT 경로에서 로드한다.
- UI/문서:
  - `docs/ARCHITECTURE.md`에 템플릿 SSOT 경로와 사용 계층(노드 봇, FastAPI, Next UI)을 명시해 두고,
  - 템플릿 관련 변경 시 이 ADR(0008)과 ARCHITECTURE 문서를 함께 갱신한다.

## AI Context (AI 협업 메모)

- Phase 3 SSOT 연동 작업에서 기존 `config/menus_dinohighclass.json` 활용
- profiles.yaml의 menu_ids와 SSOT의 profile 필드 교차 검증 로직 추가
- `lru_cache`로 SSOT 로드 캐싱하여 반복 호출 최적화

## Links

- Related ADR: ADR-0006 (KB Profile/Backfill)
- Code:
  - `config/menus_dinohighclass.json` (SSOT)
  - `kb/menu_ssot.py` (로더 모듈)
  - `kb/search.py` (profile 기반 검색)
  - `kb/ingest.py` (SSOT 연동)
