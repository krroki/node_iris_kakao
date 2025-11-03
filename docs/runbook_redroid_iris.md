# Redroid + IRIS 재시작 가이드 (Hyper-V)

## 개요

- **목적**: Hyper-V VM + Redroid(루팅 안드로이드) + IRIS 서버를 다시 기동하여 WSL에서 Node-Iris 봇과 UI를 연결하기
- **구성 요약**
  - Hyper-V VM 이름: `redroid`
  - VM IP(기준): `192.168.66.34`
  - VM 계정: `kakao / dhfl.$9909`
  - Redroid 컨테이너 ADB 포트: `localhost:5555`
  - IRIS HTTP 포트(안드로이드 내부): `3000`
  - Windows→WSL 포트 프록시: `5050`
  - WSL 프로젝트 경로: `/home/glemfkcl/dev/12.kakao`

> **주의**: IRIS는 루팅/Redroid 환경에서만 동작합니다. 물리 스마트폰에는 루트 권한과 `su`가 없으면 실행되지 않습니다.

## 1. Hyper-V VM 기동

> 관리자 권한이 필요합니다. Hyper-V 권한이 없으면 해당 계정으로 로그인 후 진행하거나 Hyper-V 관리자에서 직접 시작하세요.

```powershell
# 관리자 PowerShell
Start-VM -Name redroid
```

다른 방법: Hyper-V 관리자 → `redroid` VM → 우클릭 **시작**.

## 2. VM 접속

```bash
ssh kakao@192.168.66.34   # 비밀번호 dhfl.$9909
```

접속 후 홈 디렉터리에 `iris_control` 스크립트가 있습니다.

## 3. Redroid 컨테이너 확인

```bash
sudo docker ps
```

- 정상: `redroid` 컨테이너가 `Up` 상태이며 포트 `0.0.0.0:5555->5555/tcp`, `0.0.0.0:3000->3000/tcp` 가 노출.
- 비정상일 경우:
  ```bash
  sudo docker stop redroid
  sudo docker rm redroid
  sudo docker run -itd --privileged \
    -v ~/data:/data \
    -p 5555:5555 \
    -p 3000:3000 \
    --name redroid redroid/redroid:11.0.0-latest
  ```

## 4. Redroid ADB 및 IRIS 기동 (VM 내부)

```bash
adb connect localhost:5555
./iris_control status       # 동작 여부 확인
./iris_control start        # 미동작 시 기동 (필요하면 ./iris_control install 후 start)
./iris_control status       # PID 표시 확인
curl http://localhost:3000/config   # HTTP 200 응답 확인
```

IRIS가 비정상 종료되면 `./iris_control stop` 후 `start`로 재기동합니다.

## 5. Windows에서 포트 포워딩/프록시 재설정

```powershell
# 관리자 PowerShell
adb disconnect
adb connect 192.168.66.34:5555
C:\Users\Public\forward_iris_port.ps1
C:\Users\Public\setup_iris_port.ps1 -LocalPort 5050
```

- `forward_iris_port.ps1` → VM 내부 3000 포트를 Redroid 3000에 매핑
- `setup_iris_port.ps1` → Windows 5050 ↔ 127.0.0.1:5050 portproxy (WSL 접근용)
- 성공 시 `Probe http://127.0.0.1:5050/config -> HTTP 200` 출력

## 6. WSL에서 봇/대시보드 실행

```bash
cd /home/glemfkcl/dev/12.kakao
IRIS_LOCAL_PORT=5050 ./scripts/start_bot_wsl.sh
./scripts/serve_ui.sh
```

- `.env`가 자동으로 `IRIS_URL=<윈도우 게이트웨이>:5050`으로 갱신됩니다.
- UI: http://localhost:8501 → 상단 카드에 `IRIS Connection: Connected` 확인
- 빠른 시작 스크립트: `C:\Users\\Public\quickstart_wsl_5050.ps1`

## 7. 연결 확인

```bash
# WSL에서
bash scripts/probe_iris.sh 5050

# Windows에서
curl http://127.0.0.1:5050/config
```

둘 모두 HTTP 200을 반환해야 합니다.

## 8. Trubleshooting

| 증상 | 조치 |
|------|------|
| `./iris_control start` 시 `su: not found` | Redroid 컨테이너가 아닌 물리 단말에 연결된 경우 → `adb connect localhost:5555`로 Redroid에 접속, 물리 단말은 사용하지 않음 |
| `Probe http://127.0.0.1:5050/config -> ERR` | 포트프록시 미적용 또는 IRIS 미동작. ① IRIS 상태 재확인 ② `setup_iris_port.ps1 -LocalPort 5050` 재실행 |
| `logs/bot_wsl.log`에 `socket hang up` | 위 포트포워드/IRIS 상태 점검 후 `.env` 갱신(`./scripts/start_bot_wsl.sh`) |
| `adb devices`에 192.168.0.216:5555만 표시 | 물리 단말에 연결된 상태. `adb disconnect` 후 VM(192.168.66.34) 또는 Redroid( localhost:5555 )에 다시 연결 |

도움이 되는 Windows PowerShell 스크립트:

- `C:\Users\Public\check_redroid.ps1` – Redroid/IRIS 상태 점검
- `C:\Users\Public\debug_iris_commands.txt` – 주요 진단 명령 모음
- `C:\Users\Public\check_and_restart_iris.ps1` – IRIS 프로세스 확인 가이드

## 9. 재기동 순서 요약

1. **Hyper-V VM 시작** → `Start-VM -Name redroid`
2. **VM SSH 접속** → `./iris_control start`, `curl http://localhost:3000/config`
3. **Windows 포트 셋업** → `forward_iris_port.ps1`, `setup_iris_port.ps1 -LocalPort 5050`
4. **WSL 봇/대시보드 실행** → `IRIS_LOCAL_PORT=5050 ./scripts/start_bot_wsl.sh`, `./scripts/serve_ui.sh`
5. **연결 확인** → http://localhost:8501 + `bash scripts/probe_iris.sh 5050`

모든 단계 후에도 문제가 지속되면 `/mnt/c/Users/Public/node-iris-setup-progress.md`와 `IRIS_CONNECTION_SOLUTION.txt`의 트러블슈팅 섹션을 참고하세요.
