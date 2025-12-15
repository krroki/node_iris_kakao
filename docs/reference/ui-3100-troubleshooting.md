# UI(3100) 트러블슈팅: 남색 배경만 보일 때

## 1) 증상

- `http://localhost:3100` 접속 시 **남색 배경만 보이고 UI가 비어 있음**
- 또는 버튼/텍스트가 거의 없고 상단/방 카드가 렌더링되지 않음

> 대부분은 “UI 코드가 고장났다”가 아니라, **브라우저가 Next 정적 자산(JS/CSS)을 못 가져오는 상태**입니다.

---

## 2) 근본 원인(대부분)

Next.js가 HTML은 200으로 내려주지만, HTML이 참조하는 정적 자산이 404가 나면(예: `/_next/static/...`)
브라우저에서 JS/CSS가 로드되지 않아 **결과적으로 빈 화면**처럼 보일 수 있습니다.

주요 트리거:
- 실행 중인 web(Next start/dev)에 대해 `next build`/산출물 삭제가 겹쳐 **`.next`/`.next-prod`가 부분 손상**
- dev/prod 모드 전환/재기동이 꼬여서 **HTML의 buildId와 실제 정적 파일이 불일치**
- 여러 세션이 같은 워킹트리에서 동시에 `web` 빌드/재기동을 수행해 레이스가 발생

---

## 3) 빠른 확인 방법(5초)

### 3.1) 브라우저에서 확인(권장)

1) 개발자도구(F12) → Network 탭
2) `/_next/`로 필터
3) `/_next/static/...` 요청이 404인지 확인

404가 보이면, 거의 확실하게 이 문서의 시나리오입니다.

### 3.2) 터미널에서 확인

```powershell
curl.exe -s http://127.0.0.1:3100/ | Select-Object -First 1
```

HTML 안에 `/_next/static/...css` / `...js`가 보이는데, 그 파일이 404이면 문제입니다.

---

## 4) 복구(권장)

```powershell
pwsh -ExecutionPolicy Bypass -File windows/start_web.ps1 -Mode prod -Port 3100 -ForceKillPort -CleanBuild
```

- `-CleanBuild`는 `.next-prod`를 삭제 후 재빌드하여 “정적 자산 불일치/부분 손상”을 복구합니다.
- 복구 후 브라우저는 `Ctrl+Shift+R`(강력 새로고침) 1회 권장.

---

## 5) 재발 방지(운영 가드레일)

- 운영 중에는 `cd web && npm run build`를 **UI 실행과 동시에** 돌리지 않습니다.
  - 필요하면 `start_web.ps1`로 “정지→빌드→기동” 절차를 사용합니다.
- `windows/start_web.ps1`는 READY 판정에 `/api/ping`뿐 아니라 **`/` + `/_next/static` 자산 1개(200)** 검증을 포함합니다.
  - 실패 시 **CleanBuild로 1회 자가복구**를 시도합니다.
- `windows/watchdog.ps1`는 web 헬스체크를 `/api/ping` 단독에서 **`/` + `/_next/static`**까지 확장해,
  “프로세스는 살아있는데 UI가 빈 화면”인 상태를 자동 감지/복구합니다.

---

## 6) 로그/상태 파일

- 최신 Next 로그 포인터: `windows/logs/web.next.latest.json`
  - 현재 실행 PID와 out/err 로그 파일 경로를 포함합니다.
- Next 로그:
  - `windows/logs/web.next.out.*.log`
  - `windows/logs/web.next.err.*.log`

