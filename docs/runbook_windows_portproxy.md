Windows에서 ADB 포워드 + PortProxy 표준 절차 (WSL에서도 접근 가능)

1) 관리자 PowerShell에서 ADB 포워드 재설정 (예: 로컬 3000 → 단말 3000)

```
Set-ExecutionPolicy Bypass -Scope Process -Force
cd C:\dev\12.kakao\windows
./fix_adb_forward.ps1 -Device 192.168.66.34:5555 -LocalPort 3000 -RemotePort 3000 -AdbPath "$env:USERPROFILE\scrcpy\scrcpy-win64-v3.1\adb.exe"
```

2) PortProxy + 방화벽 열기 (WSL → Windows → ADB 순서)

```
cd C:\dev\12.kakao\windows
./setup_portproxy_firewall.ps1 -HostIP 0.0.0.0 -Port 3000 -RemotePort 3000
```

3) 검증

- Windows: `Invoke-WebRequest http://127.0.0.1:3000/config` → HTTP 200 이어야 함
- WSL: `curl -m 2 http://<wsl-host-ip>:3000/config` → HTTP 200 (wsl-host-ip는 `ip route | grep default` 의 gateway)

4) 봇/대시보드 실행

- WSL 봇: `./scripts/start_bot_wsl.sh`
- UI: `./scripts/serve_ui.sh` 후 브라우저에서 `http://localhost:8501`

문제 해결

- `adb cannot bind 127.0.0.1:3000 (10013)`: 이미 다른 프로세스가 3000 사용 중. 해당 포트를 점유한 앱을 종료하거나 `fix_adb_forward.ps1 -LocalPort 5005`처럼 다른 포트를 사용하고, `setup_portproxy_firewall.ps1 -Port 5005 -RemotePort 5005`로 맞춰 주세요(단, 단말의 Iris는 여전히 3000에서 서비스하므로 ADB는 `LocalPort 5005 -> RemotePort 3000` 으로 매핑해야 합니다).

