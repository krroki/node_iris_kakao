# IRIS 루팅 안드로이드 + Hyper-V 설치 가이드

> **상태:** 2025-10-28 업데이트. YouTube `H43VTOsKDXY` 흐름(개요 → Hyper-V → Iris 설치 → `irispy-client`)을 기준으로 재정리했습니다.

## 1. 아키텍처 개요
- **루팅 안드로이드 + Iris 앱**: 카카오톡 DB 변화를 감지하고 HTTP/WebSocket API(`/reply`, `/query`, `/decrypt`, `/config`, `/dashboard`)로 이벤트를 전달합니다.
- **봇 서버 (Hyper-V 리눅스 VM)**: `irispy-client`로 Iris에 연결해 메시지/입장 이벤트를 처리하고 자동 응답 로직을 실행합니다.
- **네트워크 구성**: Hyper-V External vSwitch를 사용해 리눅스 VM이 LAN IP를 받아, 루팅 단말에서 `http://<VM_IP>:<PORT>`로 직접 접근합니다.

## 2. 준비물 / 전제조건
1. 루팅된 안드로이드 스마트폰(카카오톡 설치 완료)
2. Windows 10/11 Pro 이상, Hyper-V 활성화
3. 동일 네트워크(또는 VPN)에서 안드로이드 ↔ 리눅스 VM 통신 가능
4. Windows ADB 도구 설치 (Android Platform Tools)
5. 보안/약관 준수: 루팅·비공식 자동화는 계정 제재 및 보안 리스크가 있으므로 운영 정책을 사전 합의합니다.

## 3. Hyper-V 리눅스 VM 설치
1. Hyper-V 관리자에서 **External vSwitch(브리지)** 생성 → VM이 실제 LAN IP를 받도록 설정합니다.
2. Ubuntu 22.04 LTS 기준 VM 생성 후 고정 IP 또는 DHCP로 LAN IP 확보.
3. 초기 패키지 및 방화벽 설정:
   ```bash
   sudo apt update && sudo apt upgrade -y
   sudo apt install -y python3 python3-venv python3-pip ufw
   sudo ufw allow 5000/tcp    # 봇 서버 포트 예시
   sudo ufw enable
   ```
4. 필요 시 `/etc/netplan/`을 편집해 고정 IP를 지정하고 재부팅합니다.

## 4. 안드로이드에 Iris 설치 및 실행
### 4.1 바이너리 다운로드
- `Iris.apk`와 `iris_control`(`iris_control.ps1`)을 GitHub Releases에서 내려받습니다.

### 4.2 ADB로 설치/실행
```bash
adb push Iris.apk /data/local/tmp
```

- **Windows PowerShell**
  ```powershell
  ./iris_control.ps1 install
  ./iris_control.ps1 start
  ```
- **macOS/Linux**
  ```bash
  chmod +x iris_control
  ./iris_control install
  ./iris_control start
  ```
- `iris_control`은 `status`, `stop`, `install_redroid` 등 서브커맨드를 제공합니다.

### 4.3 대시보드 초기 설정
1. 브라우저에서 `http://<ANDROID_IP>:3000/dashboard` 접속.
2. 필수 입력
   - **Bot Name**: 식별용 이름
   - **Web Server Endpoint**: 리눅스 VM 엔드포인트 (예: `http://<VM_IP>:5000/db`)
   - **DB Polling Rate**: 기본 200ms (낮을수록 리소스↑, 지연↓)
   - **Message Send Rate**: 기본 100ms
   - **Bot Port**: 기본 3000
3. 저장 후 `/config`, `/status` 등을 호출해 기초 동작을 확인합니다.

## 5. 리눅스 VM에 `irispy-client` 봇 배포
### 5.1 가상환경 준비
```bash
python3 -m venv ~/iris-bot-venv
source ~/iris-bot-venv/bin/activate
pip install -U pip
```

### 5.2 라이브러리 설치
```bash
pip install irispy-client
```

### 5.3 최소 샘플 `app.py`
```python
from iris.bot import Bot
from iris.bot.models import ChatContext

IRIS_URL = "http://<ANDROID_IP>:3000"

bot = Bot(IRIS_URL)

@bot.on_event("message")
def on_message(ctx: ChatContext):
    text = (ctx.message.msg or "").strip()

    if text.startswith("/핑"):
        ctx.reply("pong")
        return

    if text.startswith("/이미지"):
        ctx.reply_media("https://picsum.photos/512")
        return

    if "안녕" in text:
        ctx.reply(f"{ctx.sender.name}님, 안녕하세요!")

bot.run()
```

> 추가 제어가 필요하면 `@is_admin`, `@has_param`, `@is_reply`, `@is_not_banned` 데코레이터를 적용하고, `iris.kakaolink.IrisLink`로 카카오링크를 전송할 수 있습니다.

### 5.4 서비스화
- 샘플 저장소 사용:
  ```bash
  git clone https://github.com/dolidolih/iris_bot
  cd iris_bot
  python -m venv venv && source venv/bin/activate
  pip install -U pip && pip install -r requirements.txt
  iris init
  iris admin add <YOUR_USER_ID>
  iris service create
  iris service start
  ```
- systemd 서비스 또는 `pm2`, `supervisor` 등으로 장기 실행을 구성합니다.

## 6. 네트워킹 및 점검 체크리스트
- [ ] `http://<ANDROID_IP>:3000/dashboard` 접속 및 설정 저장 확인
- [ ] 대시보드 **Web Server Endpoint**에서 리눅스 VM 엔드포인트 호출 성공
- [ ] `adb devices`에서 안드로이드 기기가 `device` 상태로 노출
- [ ] 리눅스 VM에서 `curl http://<ANDROID_IP>:3000/config` 확인
- [ ] 카카오톡 채팅방에서 `/핑` 입력 → `pong` 응답 확인

## 7. 운영/보안 베스트 프랙티스
- 내부망 또는 VPN으로만 대시보드/HTTP 포트를 노출하고, 필요 시 WireGuard 등 터널링을 사용합니다.
- Iris의 Polling/Send Rate는 기기 성능과 배터리를 고려해 보수적으로 설정합니다.
- `@bot.on_event("error")`로 예외를 수집하고, 재시도/백오프 전략을 정의합니다.
- 루팅 단말 분실·탈취에 대비해 지문/암호, 원격 초기화 등 보안 대책을 마련합니다.

## 8. 트러블슈팅
- **루팅/권한 문제**: 루트 권한이 불완전하면 `/query` 복호화 실패 또는 이벤트 미수신이 발생합니다.
- **엔드포인트 미수신**: 대시보드 Web Server Endpoint가 Hyper-V VM의 실제 IP/포트인지 확인하고, NAT 환경이면 External vSwitch로 전환합니다.
- **연결 실패**: `IRIS_URL` 오타, 방화벽, 포트 충돌을 점검합니다.
- **Iris 프로세스 미동작**: `iris_control (status|stop|start)`로 상태를 확인하고 필요 시 재시작합니다.

## 9. 후속 TODO
- Hyper-V VM 백업/스냅샷 전략 문서화
- 루팅 단말 교체 절차 및 드라이버 재설치 가이드 정리
- `iris_bot` 기반 systemd 서비스 템플릿 작성
- API 토큰/환경 변수 암호화 저장 방식 확정 (`config/` 구조 개편)
