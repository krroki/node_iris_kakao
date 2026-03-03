# KB/RAG 시스템 구현 가이드

> 작성일: 2025-12-02
> 상태: Phase 1-4 완료

---

## 개요

KB(Knowledge Base) 서비스의 RAG 파이프라인 구현 및 개선 가이드.
의사결정 배경은 ADR 문서 참조.

### 관련 ADR
- [ADR-0005](adr/ADR-0005-kb-knowledge-base-system.md) - KB 지식베이스 시스템
- [ADR-0006](adr/ADR-0006-kb-profile-backfill.md) - KB 프로필/백필
- [ADR-0007](adr/ADR-0007-kb-vector-distance-threshold.md) - 벡터 거리 임계값
- [ADR-0008](adr/ADR-0008-kb-menu-ssot.md) - 메뉴 SSOT

---

## 환경변수

| 변수명 | 기본값 | 설명 |
|--------|--------|------|
| `KB_DIST_MAX` | 1.5 | 벡터 거리 임계값 (ADR-0007) |
| `KB_SEARCH_DAYS` | 180 | 게시글 검색 기간(일), 0=무제한 |
| `KB_CAFE_ID` | 30819883 | 검색 대상 카페 ID (dinohighclass) |
| `KB_MENUS` | (SSOT) | 수집 메뉴 ID (미설정 시 SSOT 사용) |
| `OPENAI_API_KEY` | (필수) | OpenAI API 키 (Embedding/LLM). Google Embedding은 선택 |

---

## 자동화 파이프라인

```
┌─────────────────────────────────────────────────────────────┐
│                    KB 자동화 파이프라인                      │
├─────────────────────────────────────────────────────────────┤
│  [collect]  ──30분──▶  새 게시글 수집 → sources_post        │
│      │                                                      │
│      ▼                                                      │
│  [embed]    ──30분──▶  임베딩 누락분 생성 → embeddings       │
│      │                                                      │
│      ▼                                                      │
│  [manual]   ──60분──▶  매뉴얼 문서 업데이트 → manual_doc     │
│      │                                                      │
│      ▼                                                      │
│  [RAG 검색] ◀────────  /ask, /ask_llm 엔드포인트            │
└─────────────────────────────────────────────────────────────┘
```

---

## API 사용법

### /ask - 벡터 검색
```bash
curl -X POST http://127.0.0.1:8610/ask \
  -H "Content-Type: application/json" \
  -d '{"query":"무료 특강", "top_k":5, "profile":"free"}'
```

### /ask_llm - RAG 기반 답변 생성
```bash
curl -X POST http://127.0.0.1:8610/ask_llm \
  -H "Content-Type: application/json" \
  -d '{"query":"최신 강의 소식", "profile":"paid"}'
```

### 프로필 옵션
| Profile | 설명 | 메뉴 ID |
|---------|------|---------|
| main | 전체 수집 대상 | (all collect=true) |
| free | 무료 특강 | 23, 32 |
| paid | 정규 강의 | 42 |
| tips | 꿀팁 모음 | 48, 136, 51 |
| community | 커뮤니티 | 33, 206, 62, 245 |

### 응답 예시
```json
{
  "ok": true,
  "query": "무료 특강",
  "answer": "...",
  "meta": {
    "days_limit": 180,
    "cafe_id": 30819883,
    "profile": "free",
    "menu_ids": [23, 32]
  },
  "took": 15.2
}
```

---

## 구현 완료 체크리스트

### Phase 1 - RAG 파이프라인 정상화
- [x] KB_DIST_MAX 조정 (0.42 → 1.5) - ADR-0007
- [x] 누락 임베딩 보충 (14개)
- [x] 자동화 스케줄 설정 (collect/embed/manual)
- [x] OPENAI_API_KEY 검증 로직

### Phase 2 - 검색 기능 개선
- [x] 검색 기간 확장 (90일 → 180일)
- [x] cafe_id 필터 추가 (dinohighclass 고정)
- [x] 검색 결과에 meta 정보 포함 (dist, created_at)

### Phase 3 - SSOT 연동 및 프로필 검색
- [x] SSOT 메뉴 파일 정비 - ADR-0008
- [x] kb/menu_ssot.py 로더 모듈 생성
- [x] ingest.py SSOT 연동
- [x] vector_search profile/menu_ids 필터
- [x] /ask, /ask_llm API profile 파라미터

---

### Phase 4 - UI SSOT 연동 및 E2E 테스트
- [x] KB 서비스에 `/menus` API 추가 (SSOT 제공)
- [x] Next.js API route 프록시 (`/api/kb/menus`)
- [x] /kb UI에서 SSOT 동적 로드 (MENU_GROUPS, MENU_NAMES)
- [x] E2E 테스트 스크립트 (`scripts/test_kb_e2e.py`)
- [x] 모니터링 스크립트 (`scripts/kb_status.py`)

---

## 남은 작업 (Phase 5)

### nameyee 카페 분리 (ADR-0009)
- **설계 완료**: ADR-0009에 도메인 분리 원칙 문서화
- **구현 보류**: 실제 사용 케이스 확정 시 진행

예정 작업 (구현 시점에):
- [ ] `config/menus_nameyee.json` SSOT 생성
- [ ] `kb_nameyee_post`, `kb_nameyee_manual` 테이블 생성
- [ ] `profiles.yaml`에 `nameyee` 프로필 추가
- [ ] 도메인 라우팅 로직 구현

---

## 주요 파일

| 파일 | 역할 |
|------|------|
| `config/menus_dinohighclass.json` | 메뉴 SSOT |
| `kb/menu_ssot.py` | SSOT 로더 |
| `kb/search.py` | 벡터 검색 |
| `kb/service.py` | API 엔드포인트 (/menus 포함) |
| `kb/ingest.py` | 게시글 수집 |
| `kb/profiles.yaml` | 프로필 설정 |
| `web/src/app/kb/page.tsx` | KB 대시보드 UI |
| `web/src/app/api/kb/menus/route.ts` | SSOT API 프록시 |
| `scripts/test_kb_e2e.py` | E2E 테스트 스크립트 |
| `scripts/kb_status.py` | 상태 모니터링 스크립트 |

---

## 검증 명령어

```bash
# 서비스 상태 확인
curl http://127.0.0.1:8610/health

# 통계 조회
curl http://127.0.0.1:8610/stats

# SSOT 메뉴 조회
curl http://127.0.0.1:8610/menus

# 검색 테스트 (프로필 지정)
curl -X POST http://127.0.0.1:8610/ask \
  -H "Content-Type: application/json" \
  -d '{"query":"무료 특강","profile":"free"}'

# E2E 테스트 실행
python scripts/test_kb_e2e.py --verbose

# 상태 모니터링
python scripts/kb_status.py

# Python 문법 검증
python -m compileall -q kb/
```
