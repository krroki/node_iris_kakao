## 멘션 토큰 캡처 실패 기록 (2025-11-24)

- 현상: talk-api `dispatch`가 401(Unauthorized)로 거부되어 멘션이 텍스트로만 전송됨.
- 환경: IRIS/봇/포트프록시 정상(5050/8510), SAFE_MODE=false, ALLOWED_ROOM_IDS=18462226881291012. talk-api base=https://talk-api.naijun.dev.
- 시도 내역:
  - frida-server(root, x86_64) 실행 후 KakaoTalk 프로세스에 여러 훅 적용(`hook_capture_auth_*`, wide/okhttp3 finder 등) → Authorization 로그 미발생.
  - tcpdump 443 포트 캡처(`talkapi.pcap`) → Authorization 헤더 0건.
  - okhttp3 클래스 메서드 덤프 시도 → 스크립트 로드시 프로세스 종료/timeout.
- 추정 원인: 최신 KakaoTalk이 커스텀/난독화된 HTTP 스택을 사용하거나 Authorization을 네이티브 계층에서 세팅, 표준 okhttp/URLConnection 계층에서 헤더가 노출되지 않음. 또한 talk-api 토큰 자체가 만료 상태.
- 결론: 단기적으로 멘션 포기(text-only fallback). 추후 재시도 시 옵션
  1) KakaoTalk 구버전(APKMirror 등) 설치 후 표준 okhttp 훅으로 토큰 캡처.
  2) talk-api 토큰을 별도 경로로 확보해 runtime에 주입.
  3) 네이티브 계층/커스텀 클라이언트에 대한 심층 후킹(충돌/시간 부담 큼).
- 참고 파일(커밋 대상): `scripts/hook_capture_auth_wide.js`, `hook_capture_auth_okhttp3_finder.js`, `hook_capture_auth_builder.js`, `hook_capture_auth_simple.js`
- 커밋 제외: `talkapi.pcap`(민감/분석용)
