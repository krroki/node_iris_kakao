# Reboot→VM→IRIS→ADB→서버/웹앱 Quickstart

본 문서는 재부팅 직후 기준으로, Hyper‑V Linux VM + Redroid(안드로이드 컨테이너) + IRIS + Windows(봇/서버/웹)까지 한 번에 올리는 최소 경로를 정리한다. 개념 정리는 agents.md를 따르며, 실무에서는 아래 순서를 그대로 복붙한다.

## 용어 정리(역할)
- VM: Hyper‑V의 Linux 가상머신. 이 안에서 docker로 Redroid(안드로이드)가 돈다.
- Redroid: 안드로이드 컨테이너. IRIS 앱이 여기서 실행된다(HTTP 3000, ADB 5555).
- IRIS: 카카오톡 데이터 수집/제어 앱. `iris_control`로 설치/시작/상태 확인.
- ADB: 호스트↔안드로이드 연결. IRIS를 원격 설치/시작하려면 5555(TCP) 열려 있어야 함.
- Windows: Node‑IRIS 봇, FastAPI(SSE), Next.js 대시보드를 띄우는 호스트.

## 순서 한 장 요약(TL;DR)
1) Windows(관리자 PS): `Start-VM redroid`
2) Linux VM: Redroid 컨테이너 기동 + ADB(5555) 오픈
3) Linux VM: `./iris_control install && ./iris_control start && ./iris_control status`
4) Windows: `windows/start_all.cmd -IrisUrl "http://<VM_IP>:3000"`
5) 확인: API 200(`/health`), 대시보드(3000), IRIS 200(`/config`)

## 단계별 상세

### 1) Windows – VM 부팅 및 VM IP 확보
관리자 PowerShell:
```
Start-VM redroid
$IP = (Get-VMNetworkAdapter -VMName redroid).IPAddresses | ? { $_ -notmatch ':' } | Select-Object -First 1
if (-not $IP) {
  $m=((Get-VMNetworkAdapter -VMName redroid).MacAddress -replace '(.{2})','$1-').TrimEnd('-').ToUpper()
  $IP=(Get-NetNeighbor -AddressFamily IPv4 | ? { $_.LinkLayerAddress -eq $m } | Select -Expand IPAddress -First 1)
}
Write-Host "VM_IP=$IP"
```

### 2) Linux VM – Redroid 컨테이너 기동 + ADB 5555 오픈
SSH 혹은 콘솔 접속(예: `ssh kakao@<VM_IP>`):
```
sudo docker rm -f redroid 2>/dev/null || true
sudo docker run -itd --privileged --name redroid \
  -v ~/data:/data -p 5555:5555 -p 3000:3000 redroid/redroid:11.0.0-latest

# adbd(5555) 열기
sudo docker exec -it redroid sh -c 'setprop service.adb.tcp.port 5555; stop adbd; start adbd'
adb kill-server; adb start-server
adb connect 127.0.0.1:5555
adb devices   # state= device 여야 정상
```

### 3) Linux VM – IRIS 설치/기동/검증
```
./iris_control install     # 최초 1회만
./iris_control start
./iris_control status      # PID 확인
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/config   # 200
```

### 4) Windows – 서버/봇/웹앱 동시 기동
관리자 PowerShell:
```
windows/start_all.cmd -IrisUrl "http://$IP:3000"
```

## 재시작(무엇을 재시작해야 하나?)
> 기본 원칙: **부분 재기동 우선**. “항상 start_all”은 코어/워커 분리(ADR-0027) 취지에 반합니다.  
> 단, PC 재부팅 직후/포트 꼬임/산출물 파손/원인 미상 대규모 장애처럼 “어느 프로세스가 문제인지”를 분리하기 어려우면 `start_all.cmd`로 전체 복구하는 편이 빠를 수 있습니다. (`start_all.cmd`는 내부적으로 `start_all.ps1`를 호출)

- 전체(서버+KB+봇+웹) 재시작: `windows/start_all.cmd -IrisUrl "http://$IP:3000"`
- welcome-worker만 재시작(웰컴/후속 Reply만 이상): `powershell -ExecutionPolicy Bypass -File windows/start_welcome_worker.ps1 -Restart`
- 봇만 재시작(채팅 반응/명령만 이상): `powershell -ExecutionPolicy Bypass -File windows/start_bot.ps1 -Restart -IrisUrl "http://$IP:3000"`
- KB만 재시작(RAG/수집/임베딩만 이상): `powershell -ExecutionPolicy Bypass -File windows/kb_service.ps1 -Port 8610`
- API만 재시작(대시보드 SSE/로그만 이상): `powershell -ExecutionPolicy Bypass -File windows/start_api.ps1 -Port 8650`
- 웹만 재시작(Next.js 화면만 이상): `powershell -ExecutionPolicy Bypass -File windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort`
  - Redroid/VM/다른 기기에서 Web UI에 접속해야 하면: `-Hostname 0.0.0.0`로 바인딩을 열고, `localhost` 대신 **Windows 호스트 IP**로 접속한다.

로그 위치:
- `windows/logs/` (web/api/bot/kb stdout/stderr)
- `logs/` (KB task runner 로그 및 lock)

### 5) 웰컴 템플릿/테스트(`!welcome:test`)
- 전제: 봇이 `READY` 상태여야 한다. (안 되면 `windows/start_bot.ps1 -Restart ...`)
- 전제: 테스트하려는 방이 allowlist에 포함되어야 한다. (`node-iris-app/config/runtime.json.allowedRoomIds`)
  - 방이 allowlist가 아니면 **명령/웰컴이 조용히 무시**될 수 있다.
- 전제: `safeMode=true`면 모든 발신이 차단된다. (`node-iris-app/config/runtime.json.safeMode`)
- 템플릿 선택 우선순위:
  1) (신규) 템플릿 세트: `node-iris-app/config/runtime.json.welcome.templateSets`
     - `kakaoDefaultNickname`: “카카오 기본닉(예: 인사하는 프로도, 하품하는 제이지)” 사용자용 세트
     - `customNickname`: 기본닉이 아닌 사용자용 세트
     - 기본닉 판별: `runtime.json.welcome.kakaoDefaultNicknameRegexes` 정규식 매칭
     - 선택 방식: `runtime.json.welcome.templateSetPick` (권장: `random`, 세트 내에서 1개 무작위 선택)
  2) (레거시) 단일 템플릿: `runtime.json.templateByFeature.welcome` → `runtime.json.welcomeTemplateName`
  3) (옵션) env: `ALLOW_ENV_WELCOME_TEMPLATE=true`일 때만 `WELCOME_TEMPLATE`
  - 실제 파일: `node-iris-app/config/templates/welcome/<name>.json`
  - 세트/정규식/선택 방식/템플릿이 불완전하면 **폴백 없이 스킵**하며, 원인은 로그로 남는다(ADR-0022).
- 로그 확인:
  - `windows/logs/bot.out.log`에서 `welcome:test`, `skip welcome`, `No welcome template configured` 검색
  - 웹 UI(`/settings`)의 “Welcome 세트 경고” 박스에서 세트 누락/템플릿 누락을 확인

### 6) 헬스체크(Windows)
```
Invoke-WebRequest http://127.0.0.1:8600/health      # 200
Start-Process "http://127.0.0.1:3000"               # 대시보드
```

## 선택(로컬 127.0.0.1:5050 프록시)
ADB 없이도 Windows→VM 매핑을 고정하고 싶을 때:
```
netsh interface portproxy delete v4tov4 listenport=5050 listenaddress=127.0.0.1
netsh interface portproxy add v4tov4 listenport=5050 listenaddress=127.0.0.1 connectport=3000 connectaddress=$IP protocol=tcp
windows/start_all.cmd -IrisUrl "http://127.0.0.1:5050"
```

## 트러블슈팅 단축표
| 증상 | 원인 | 조치 |
|------|------|------|
| `adb connect ...:5555` 거부 | adbd 미기동 | 컨테이너 내 `setprop ...; stop adbd; start adbd` 후 재시도 |
| `iris_control start`에서 No devices | ADB 연결 안 됨 | `adb devices`로 확인→`adb connect 127.0.0.1:5555` |
| `curl /config` 비정상 | IRIS 미기동 | `./iris_control start && status` 재확인 |
| Windows에서 /config 실패 | VM IP 오기 | `hostname -I`로 IP 재확인 후 `-IrisUrl` 갱신 |

## 참조
- agents.md(핸드북) – 개념/역할/가드레일
- docs/runbook_redroid_iris.md – 배경/세부 가이드(확장)
