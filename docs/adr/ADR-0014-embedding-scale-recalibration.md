# ADR-0014: KB 임베딩 스케일 재조정 및 검색 임계치 재설정

## 상태
Accepted (2025-12-05)

## 배경 / 컨텍스트
- 질의 예시: “12월 3일 강의 있나”에 대해 과거에는 게시글 141215(사알못사주자동화 특강)로 응답했으나, 현재는 관련 없는 최신 글만 노출되고 “정보 없음”+엉뚱 링크가 붙는 문제가 발생.
- DB 확인: `sources_post`에 post_id=141215 존재(status=clean), `embeddings`에도 obj_id=141215, model=text-embedding-004, updated_at 2025-12-02.
- `/ask` 실제 결과: manuals dist 0.92~0.98, posts dist 0.76~0.84로 모두 임계치(0.42) 밖에 위치.
- embeddings 모델 분포: text-embedding-004 915개, text-embedding-3-large 8개(잔존). 혼선은 적지만 **벡터 스케일이 1.x 수준**으로 형성되어 기존 임계치가 지나치게 낮음.
- 코사인 거리 자체를 SQL로 조회하면 141215 vs 상위 hit 간 cos_dist ≈ 1.64~1.74 → 임계치 불일치가 근본 원인.

## 결정
- 검색 임계치 재설정: `KB_DIST_MAX`, `KB_LINK_HINT_DIST_MAX`를 환경 변수로 상향 조정하여 현재 스케일에 맞게 튜닝한다(최종 값은 재임베딩 후 분포를 본 뒤 확정).
- 전면 재임베딩: 단일 모델(text-embedding-004)로 모든 post/manual 벡터를 다시 생성해 스케일 일관성을 확보한다.
- 검색 보강: 벡터 hit가 없을 때 동일 DB에서 제목/본문 키워드 부분일치 검색을 추가(비벡터 deterministic 검색, fallback 아님).
- 링크 안전장치: LLM 응답이 “정보 없음/못 찾음” 패턴이면 `link_hint`를 붙이지 않고, 링크 줄은 근거 문서 URL이 있을 때만 출력한다.

## 근거 데이터
- `SELECT model, COUNT(*), MIN(updated_at), MAX(updated_at) FROM embeddings GROUP BY model;`
  - text-embedding-004: 915개 (2025-11-25 ~ 2025-12-03)
  - text-embedding-3-large: 8개 (2025-11-25)
- `/ask` “12월 3일 강의 있나” 결과: posts dist 0.76~0.84, 141215 미포함.
- SQL 코사인 거리: 141215 vs top hits ≈ 1.64~1.74.

## 결과 / 영향
- 임계치 재설정 전까지는 검색 품질 저하 지속. 재임베딩 + 임계치 상향 후 정상화 예상.
- 링크 오남용은 no-info 차단과 link_hint dist 조건으로 방어.
- dist 스케일 변화 시마다 임계치 재튜닝 필요 → 모니터링 항목 추가.

## 후속 작업
1) `kb_task_runner.ps1 -Task embed` 실행으로 전면 재임베딩(단일 모델 004) 수행.
2) 재임베딩 후 `/ask` 다수 쿼리 dist 분포 수집 → `KB_DIST_MAX`, `KB_LINK_HINT_DIST_MAX` 최종 확정.
3) 벡터/키워드 동시 검색 로그에 상위 hit dist를 기록해 스케일 변동을 조기 감지.

## 관련 변경
- `kb/service.py`: 키워드 보강 검색 추가, link_hint dist 조건 보수적 설정, 링크/CTA 출력 지침 강화.
- `node-iris-app/src/utils/askKb.ts`: “정보 없음” 패턴 시 link_hint 미첨부.
- `windows/smart_restart_bot.ps1`: VM IP를 직접 지정할 수 있도록 -VmIp 옵션 추가(운영 재시작 안정화).

