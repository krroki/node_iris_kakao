# 시스템 요구사항 및 의존성

## 하드웨어
- CPU: 쿼드코어 이상 (Hyper-V VM과 호스트 동시 구동을 고려해 8코어 권장)
- RAM: 최소 16GB (VM + Windows 동시 운영 시 32GB 권장)
- 디스크: SSD, 여유 공간 50GB 이상
- GPU: 하드웨어 가속을 위한 최신 드라이버

## 소프트웨어
- 운영체제: Windows 11 Pro 64bit (Hyper-V 사용 가능 에디션)
- Python: 3.11.x (가상환경 권장)
- Git, PowerShell 7.x

## Python 패키지
`requirements.txt` 참고:
```
irispy-client
gemini_webapi
google-genai
pytz
```
추가로 pytest, black 등 개발 도구는 향후 `requirements-dev.txt`에 분리 예정.

## 외부 서비스 키
- Google Gemini (텍스트, 이미지 생성)
- Naver 검색 API (선택)
- 기타 명령어별 API 키는 `config/env.example` 주석 참조.

## 네트워크
- Hyper-V External vSwitch로 리눅스 VM에 LAN IP 부여.
- 루팅 단말과 VM이 동일 네트워크(또는 VPN)에서 통신 가능해야 하며, 필요 시 WireGuard 등 터널 구성.

## 점검 목록
- [ ] Python 가상환경 생성 및 활성화
- [ ] 패키지 설치 완료 확인
- [ ] 루팅 단말 `adb devices` 인식 확인
- [ ] IRIS admin 등록
- [ ] `.env` 설정 후 봇 실행 테스트
