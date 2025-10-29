# 에이전트 작업 지침서

## 네이버 카페 접속 지침

### 로그인 절차

1. **자동 로그인 시도**
   - 환경변수에서 NAVER_ID, NAVER_PW 로드
   - Playwright로 네이버 로그인 페이지 접속
   - 아이디/비밀번호 자동 입력 및 로그인 시도

2. **모바일 인증 대기**
   - 2단계 인증(모바일) 필요시 사용자 수동 처리 대기
   - 로그인 성공 확인 후 다음 단계 진행

3. **카페 글 접속**
   - 로그인 성공 후 목표 카페 글 URL로 이동
   - 글 내용 확인 및 스크린샷 저장

### 사용 방법

```bash
python scripts/naver_cafe_checker.py
```

### 환경변수 설정

```
NAVER_ID=your_naver_id
NAVER_PW=your_naver_password
NAVER_CAFE_URL=https://cafe.naver.com/cafe_name
```

### 주의사항

- 모바일 인증 필요시 수동 처리 필요
- 인증 후 스크립트가 자동으로 진행됨