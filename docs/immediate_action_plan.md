# 즉시 실행 계획 (Immediate Action Plan)
## 다음 단계를 위한 구체적인 실행 가이드

---

## 🎯 현재 상태 요약

### ✅ 완료된 작업
1. **프로젝트 기반 구축**
   - 프로젝트 구조 설계 완료
   - 기본 Python 환경 설정
   - IRIS 연결 테스트 성공
   - 환경변수 관리 시스템 구축

2. **카페 정보 수집**
   - 네이버 카페 자동 접속 시스템
   - IRIS 설치 정보 확인
   - 기술 자료 및 스크린샷 수집
   - 노루팅 관련 정보 조사

3. **문서화**
   - 상세 PRD 작성 완료
   - 단계별 Task 목록 생성
   - 기술 구조 설계 완료

### 🔄 진행 가능한 작업
현재 바로 시작할 수 있는 작업들은 다음과 같습니다.

---

## 🚀 오늘 바로 시작할 수 있는 작업

### Task 1: IRIS 연결 모듈 강화

**📁 파일**: `src/bot/main.py` 개선

```python
# 현재 상태: 기본 연결 테스트 완료
# 필요한 개선:
# 1. 안정적인 WebSocket 연결 관리
# 2. 자동 재연결 로직
# 3. 연결 상태 모니터링

# 실행할 코드:
class IRISConnection:
    def __init__(self):
        self.ws = None
        self.connected = False
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 5

    async def connect(self):
        # 연결 로직 구현
        pass

    async def reconnect(self):
        # 재연결 로직 구현
        pass
```

**🎯 예상 완료 시간**: 2-3시간

### Task 2: 메시지 저장 기능 확장

**📁 파일**: `src/services/message_store.py`

```python
# 현재 상태: 기본 스켈레톤 존재
# 필요한 개선:
# 1. SQLite 데이터베이스 연동
# 2. 메시지 저장 및 조회 기능
# 3. 로그 파일 관리

# 실행할 코드:
import sqlite3
import json
from datetime import datetime

class MessageStore:
    def __init__(self, db_path="data/messages.db"):
        self.db_path = db_path
        self.init_database()

    def init_database(self):
        # 데이터베이스 테이블 생성
        pass

    def store_message(self, message_data):
        # 메시지 저장 로직
        pass
```

**🎯 예상 완료 시간**: 3-4시간

### Task 3: 로깅 시스템 구축

**📁 파일**: `src/utils/logger.py` (신규 생성)

```python
# 필요한 기능:
# 1. 구조화된 로그 포맷
# 2. 로그 레벨 관리
# 3. 파일 자동 회전

import logging
import json
from datetime import datetime

class StructuredLogger:
    def __init__(self, name):
        self.logger = logging.getLogger(name)

    def info(self, message, **kwargs):
        # 구조화된 로그 생성
        pass
```

**🎯 예상 완료 시간**: 2시간

---

## 📋 이번 주까지 완료 목표 (Week 1)

### 목표: 기반 인프라 완성

**Day 1-2 (10/27-10/28)**
- [ ] IRIS 연결 모듈 안정화
- [ ] 기본 로깅 시스템 구축
- [ ] 메시지 저장 기능 구현

**Day 3-4 (10/29-10/30)**
- [ ] 이벤트 핸들러 기본 구조
- [ ] 간단한 명령어 처리기 (`!help`, `!status`)
- [ ] 기본 테스트 코드 작성

**Day 5-7 (10/31-11/02)**
- [ ] 통합 테스트 및 디버깅
- [ ] 성능 기본 측정
- [ ] 문서 업데이트

---

## 🛠️ 기술적 구현 세부사항

### 1. IRIS 연결 강화 방법

**네이버 카페에서 얻은 정보 적용:**
- IRIS 설치는 2025년 7월 기준 최신 버전 사용
- WebSocket 연결 시 안정적인 핸드셰이크 필요
- 연결 끊김 시 지수 백오프 재시도 전략

**구현 단계:**
```bash
# 1. 현재 연결 테스트 코드 확인
python -m src.bot.main --dry-run

# 2. 연결 상태 모니터링 추가
# 3. 재연결 로직 구현
# 4. 연결 풀 관리 (향후 확장)
```

### 2. 데이터베이스 설계

**SQLite 스키마:**
```sql
-- 방 정보 테이블
CREATE TABLE rooms (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    settings JSON
);

-- 메시지 테이블
CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    room_id TEXT,
    user_id TEXT,
    content TEXT,
    message_type TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (room_id) REFERENCES rooms (id)
);

-- 사용자 테이블
CREATE TABLE users (
    id TEXT PRIMARY KEY,
    name TEXT,
    profile_image TEXT,
    first_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### 3. 환경 설정 추가

**`config/local.env`에 추가:**
```
# 데이터베이스 설정
DATABASE_PATH=data/messages.db
LOG_LEVEL=INFO
LOG_PATH=logs/

# IRIS 연결 설정
IRIS_RECONNECT_DELAY=5
IRIS_MAX_RECONNECT_ATTEMPTS=5
IRIS_HEARTBEAT_INTERVAL=30
```

---

## 📊 진행 상황 추적 방법

### 1. 일일 체크리스트

**매일 확인할 항목:**
- [ ] IRIS 연결 상태 정상
- [ ] 메시지 저장 기능 동작
- [ ] 로그 정상 기록
- [ ] 에러 없는 실행

### 2. 주간 목표 검증

**이번 주 목표 달성 여부:**
- IRIS 연결 안정성 99% 이상
- 메시지 처리 속도 평균 2초 이내
- 기본 명령어 정상 동작
- 테스트 케이스 80% 이상 통과

### 3. 위험 모니터링

**주요 위험 요인:**
- IRIS 연결 불안정성 → 모니터링 강화
- 데이터베이스 성능 → 쿼리 최적화
- 메모리 누수 → 프로파일링 도구 사용

---

## 🎯 다음 단계 (Week 2 예고)

### Week 2: 다중 방 관리 시스템
- 방 등록/관리 기능
- 방별 메시지 처리
- 입장/퇴장 이벤트 핸들러
- 기본적인 환영 메시지 기능

### 준비 사항
- LDPlayer 멀티 인스턴스 설정
- 다중 IRIS 연동 테스트
- 방 관리 UI/CLI 개발

---

## 📞 지원이 필요한 경우

### 기술적 문제
1. **IRIS 연결**: 카페 커뮤니티에 문의 또는 IRIS 공식 문서 참조
2. **데이터베이스**: SQLite 공식 문서 및 Stack Overflow
3. **Python**: Python 공식 문서 및 커뮤니티

### 커뮤니티 자원
- **네이버 카페**: https://cafe.naver.com/f-e/cafes/29537083
- **IRIS 관련**: 카페에서 "25년 7월 기준 Iris 설치 방법" 글 참조
- **기술 Q&A**: 카페 검색 기능 활용

---

## ✅ 성공 기준

### 이번 주 성공 기준
1. **IRIS 안정 연결**: 24시간 연속 운영 테스트 통과
2. **메시지 처리**: 100개 메시지 무처리 없이 저장
3. **기본 명령어**: `!help`, `!status` 정상 동작
4. **코드 품질**: 기본 테스트 케이스 통과

### 달성 시 다음 단계
- 다중 방 관리 기능 구현 시작
- 환영 메시지 시스템 개발
- 성능 최적화 및 모니터링 강화

---

*즉시 실행 계획 버전: v1.0*
*작성일: 2025-10-27*
*적용 기간: 2025-10-27 ~ 2025-11-03*