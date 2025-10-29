# Agents Handbook

## 커뮤니케이션 지침
- 사용자 질의에 대한 응답은 항상 한국어로 작성한다.

## 세션 시작 체크리스트
1. `docs/ssot.md` 최신 내용 확인 (기술 결정, 진행 상황, 미완료 항목).
2. `docs/prd.md`로 제품 목표·범위 재확인.
3. 최신 ADR(`docs/adr/0001-adopt-iris-ldplayer.md`)을 읽어 현재 아키텍처 전제 상기.
4. `git remote -v`로 원격이 정상 등록되어 있는지 확인하고, 없다면 세션 시작 전 설정.

## 폴더 구조 요약
```
/
├─ agents.md
├─ README.md
├─ requirements.txt
├─ config/
│  ├─ env.example
│  └─ README.md
├─ docs/
│  ├─ adr/
│  │  └─ 0001-adopt-iris-ldplayer.md
│  ├─ journal/
│  ├─ setup/
│  │  ├─ ldplayer.md
│  │  └─ requirements.md
│  ├─ prd.md
│  ├─ roadmap.md
│  ├─ ssot.md
│  └─ todo.md
├─ infra/
│  └─ README.md
├─ scripts/
│  ├─ manage_instances.ps1
│  └─ run_iris.sh
├─ src/
│  ├─ bot/
│  │  └─ main.py
│  ├─ bots/
│  └─ services/
└─ tests/
   └─ test_placeholder.py
```

## 세션 시나리오 가이드
1. **버그 핫픽스 요청 수신**  
   - `docs/ssot.md`에서 이슈 배경 확인 → `docs/todo.md`에 해당 항목 존재 여부 체크.  
   - 재현 스크립트는 `scripts/`에 있는지 확인하고, 없다면 작성 계획을 SSOT에 기록.  
   - 수정 후 `tests/`에 검증 코드 추가, 결과를 `docs/journal/`에 남기고 SSOT 히스토리 갱신.
2. **새 명령어 기능 개발**  
   - PRD 범위와 로드맵 우선순위 확인 → 필요한 기술 결정 시 ADR 초안 작성.  
   - `src/bot/`와 `src/services/`에 모듈 배치, 의존성은 `requirements.txt` 갱신.  
   - 기능 완료 시 SSOT에 구현 일자·주요 결정사항 반영, 필요하면 로드맵 진행도 업데이트.
3. **운영 문서 정비 세션**  
   - `docs/journal/`에 세션 시작 로그 생성.  
   - `docs/setup/` 문서를 점검하여 최신 설치 절차와 다르면 수정하고 근거 링크 기재.  
   - 변경사항은 SSOT 업데이트 지침에 따라 즉시 반영하고, 후속 작업은 `docs/todo.md`에 명시.

## 신규 세션 빠른 시작
1. `python -m venv .venv && .venv\Scripts\Activate.ps1` (PowerShell)로 가상환경 구성.
2. `pip install -r requirements.txt` 실행해 패키지 설치.
3. `Copy-Item config/env.example config/local.env` 후 환경 변수 값을 채우고 세션 동안 적용.
4. `docs/setup/ldplayer.md` 절차에 따라 LDPlayer/IRIS 연결 확인 (`adb devices`, `iris admin add` 등).
5. `python src/bot/main.py <IRIS_URL>` 또는 `scripts/run_iris.sh`로 이벤트 수신 여부 확인.
6. 진행한 작업은 `docs/journal/`에 로그를 남기고, 결정 사항은 바로 `docs/ssot.md` 및 ADR에 반영.

## 참고 자료
- ponyobot 블로그: 명령어 봇 설계 및 운영 사례 정리 - https://blog.ponyobot.kr/posts/cmd
- iris_bot GitHub 저장소: IRIS 기반 카카오톡 봇 예제 코드 - https://github.com/dolidolih/iris_bot

## 문서 갱신 규칙
- 주요 작업·의사결정 후 즉시 `docs/ssot.md` 히스토리/결정 표를 업데이트하고 근거 문서를 링크한다.
- PR 작성 또는 세션 종료 전, 변경 이유를 ADR에 반영하거나 신규 ADR을 작성한다.
- PRD 범위/요구 변경 시 `docs/prd.md`와 `docs/roadmap.md`를 함께 수정하고, SSOT `최근 히스토리`에 기록한다.
- 문서 갱신 여부를 체크리스트로 관리하려면 `docs/todo.md`의 “문서화” 섹션을 업데이트한다.

## 개발 기본 원칙
- LDPlayer + IRIS 기반으로 모든 자동화를 구현한다 (PC UIA 접근 금지).
- 각 작업은 모듈화/테스트 가능성/롤백 계획을 확인하며, 필요 테스트는 `tests/`에 추가한다.
- 재현 가능한 스크립트(`scripts/`)와 설정 문서(`docs/setup/`)를 세션마다 검증하고 최신 상태로 유지한다.

