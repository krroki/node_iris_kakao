# Web 포트 3100 충돌 처리 런북

> 목적: `http://localhost:3100` 에서 대시보드가 떠야 하는데,  
> 404 또는 접속 실패가 발생할 때 **포트 3100 선점 문제를 진단하고 복구하는 절차**를 정리한다.

---

## 1. 증상

- 브라우저에서 `http://localhost:3100` 접속 시:
  - 404 Not Found 또는
  - ERR_CONNECTION_REFUSED / 연결 안 됨
- `windows/start_all.ps1` 실행 로그에는 `[all] starting web` 이 찍히지만,
  - `windows/logs/web.err.log` 에는 `EADDRINUSE: address already in use 127.0.0.1:3100` 등이 남아 있다.

---

## 2. 원인 개요

- Next.js dev 서버가 사용하는 **포트 3100**을 다른 `node.exe` 프로세스가 이미 점유하고 있어서,
  - `windows/start_web.ps1` 가 Next 서버를 띄우지 못하고 TIMEOUT 발생.
- 이 때 API(`http://localhost:8650/health`)나 KB(`http://localhost:8610/health`)는 정상일 수 있지만,
  - 웹 UI만 404/접속 실패 상태가 된다.

---

## 3. 진단 절차 (Windows PowerShell)

관리자/일반 PS 상관없이, 먼저 누가 3100을 점유 중인지 확인한다.

```powershell
netstat -ano | Select-String ":3100"
```

예시 출력:

```text
TCP    127.0.0.1:3100         0.0.0.0:0      LISTENING       123724
```

- 마지막 숫자(`123724`)가 **포트를 점유 중인 PID**다.

자세한 정보:

```powershell
Get-Process -Id 123724 | Format-List Id,ProcessName,Path,StartTime
```

---

## 4. 해결 절차

### 4.1 3100을 잡고 있는 node 프로세스 종료 시도

1) **해당 PID 강제 종료 시도**

```powershell
Stop-Process -Id 123724 -Force
```

- 정상: 프로세스 종료, 이후 `netstat` 에서 3100 항목이 사라진다.
- 실패: `Access is denied` 발생 → 다른 계정/권한으로 떠 있는 프로세스일 가능성이 크다.

2) 다시 확인

```powershell
netstat -ano | Select-String ":3100"
```

- 아무 출력이 없으면 포트가 비워진 상태.
- 여전히 LISTENING 이 남아 있으면, **현재 세션 권한으로는 종료 불가** 상태다.
  - 이 경우에는 **해당 프로세스를 직접(작업 관리자/관리자 PS) 종료**해야 한다.

### 4.2 웹만 다시 올리기 (포트 확보된 경우)

포트 3100을 비운 뒤, 웹만 다시 올린다.

```powershell
cd C:\dev\12.kakao
powershell -NoProfile -ExecutionPolicy Bypass -File windows\start_web.ps1 -Port 3100 -ForceKillPort
```

- 정상 시:
  - 콘솔: `[web] READY on :3100`
  - `http://localhost:3100` 접속 시 대시보드가 뜬다.

### 4.3 포트 3100을 당장 비울 수 없을 때 (임시 우회)

권한 문제로 3100 PID를 종료할 수 없는 경우, **임시로 다른 포트(예: 3101)로 웹을 띄운다.**

```powershell
cd C:\dev\12.kakao
powershell -NoProfile -ExecutionPolicy Bypass -File windows\start_web.ps1 -Port 3101 -ForceKillPort
```

- 정상 시:
  - 콘솔: `[web] READY on :3101`
  - 브라우저에서 `http://localhost:3101` 로 접속하면 대시보드 사용 가능.
- 이 우회는 **임시용**이며, 가능할 때 3100 점유 프로세스를 종료한 뒤 4.2 절차로 다시 3100으로 복귀하는 것을 권장한다.

---

## 5. 운영 권장사항

1. **불필요한 Next dev 서버 중복 실행 금지**
   - VSCode/터미널에서 `npm run dev` 를 수동으로 여러 번 실행하지 않는다.
   - 항상 `windows/start_all.ps1` 또는 `windows/start_web.ps1` 를 통해 웹을 기동한다.

2. **포트 충돌 발생 시 표준 절차**
   - 1차: `netstat` + `Stop-Process` 로 포트 3100 점유 프로세스 종료 시도.
   - 2차: 종료 권한이 없으면, 운영자 계정(관리자 권한)에서 직접 종료.
   - 3차(임시): 3101 등 다른 포트로 웹 띄우기 → 문제 해결 후 3100으로 복귀.

3. **문제 재발 시 기록**
   - 동일 PID/프로세스가 반복해서 3100을 점유한다면,
     - 어떤 툴/IDE가 해당 Node 프로세스를 띄우는지 확인하고
     - `docs/CHANGELOG.md` 및 세션 로그에 원인/조치 내용을 남긴다.

---

## 6. 요약

- 404/접속 실패 + `EADDRINUSE 127.0.0.1:3100` → **포트 3100이 다른 Node가 잡고 있음**.
- 표준 패턴:
  1. `netstat` 로 PID 확인
  2. `Stop-Process -Id <PID> -Force` 시도
  3. 성공 시 `start_web.ps1 -Port 3100 -ForceKillPort` 로 웹 복구
  4. 실패 시 임시로 3101 등으로 우회, 이후 운영자 계정에서 3100 프로세스 정리 후 복귀

