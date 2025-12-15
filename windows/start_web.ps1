param(
  [int]$Port = 3100,
  [int]$TimeoutSec = 45,
  [string]$LogDir = '',
  [switch]$ForceKillPort,
  [ValidateSet('prod','dev')]
  [string]$Mode = 'prod',
  # 기본은 IPv6 dual-stack(::) 바인딩으로 `localhost`(::1) / `127.0.0.1` 모두에서 접근 가능하게 한다.
  # VM/다른 기기에서 접근이 필요하면 0.0.0.0(IPv4) 또는 ::(IPv6)로 지정.
  [string]$Hostname = '::',
  # node_modules가 이미 있으면(운영) 설치를 생략하는 것을 기본으로 한다.
  [switch]$Install,
  # prod 모드에서 .next-prod 빌드를 생략(이미 빌드가 보장된 경우에만)
  [switch]$SkipBuild,
  # prod 모드에서 빌드 캐시/산출물을 강제로 재생성
  [switch]$CleanBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$web = Join-Path $root 'web'
Set-Location $web

# Expose KB service URL to Next dev (used by /kb page proxy)
if (-not $env:NEXT_PUBLIC_KB_URL -or [string]::IsNullOrWhiteSpace($env:NEXT_PUBLIC_KB_URL)) {
  $env:NEXT_PUBLIC_KB_URL = 'http://127.0.0.1:8610'
}

if (-not $LogDir) { $LogDir = Join-Path $root 'windows\logs' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
# NOTE: start_web.cmd may already redirect this script's stdout/stderr to web.out.log/web.err.log.
# Use distinct files for npm/next child processes to avoid file-handle conflicts.
$runId = (Get-Date -Format 'yyyyMMdd_HHmmss')
$outLog = Join-Path $LogDir ("web.next.out.{0}.log" -f $runId)
$errLog = Join-Path $LogDir ("web.next.err.{0}.log" -f $runId)
$latestPath = Join-Path $LogDir 'web.next.latest.json'

function Rotate-LogIfExists {
  param([string]$Path, [string]$Suffix)
  if (-not (Test-Path $Path)) { return }
  $dst = $Path -replace '\.log$', (".{0}.{1}.log" -f $Suffix, $runId)
  for ($i = 0; $i -lt 5; $i++) {
    try {
      $item = Get-Item -LiteralPath $Path -ErrorAction Stop
      if ($item.Length -le 0) { return }
      Move-Item -LiteralPath $Path -Destination $dst -Force
      return
    } catch {
      if ($i -lt 4) { Start-Sleep -Milliseconds 200; continue }
      throw "로그 로테이션 실패: $Path ($($_.Exception.Message))"
    }
  }
}

function Start-LoggedProcess {
  param([string]$Exe,[string[]]$ArgList,[string]$Out,[string]$Err)
  $argLine = $ArgList -join ' '
  return (Start-Process -FilePath $Exe -ArgumentList $argLine -WorkingDirectory $web `
    -RedirectStandardOutput $Out -RedirectStandardError $Err -WindowStyle Hidden -PassThru)
}

function Get-ListeningPids {
  param([int]$Port)
  $conns = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
  if (-not $conns) { return @() }
  $pids = @()
  foreach ($c in $conns) {
    if ($c.OwningProcess -and $c.OwningProcess -gt 0) { $pids += [int]$c.OwningProcess }
  }
  return @($pids | Sort-Object -Unique)
}

function Test-WebStaticOk {
  param(
    [int]$Port,
    [int]$TimeoutSec = 2
  )
  $base = "http://127.0.0.1:$Port"
  $out = @{ ok = $false; detail = "" }
  $html = ""

  try {
    $params = @{
      Uri         = ("{0}/" -f $base)
      TimeoutSec  = $TimeoutSec
      Method      = 'GET'
      ErrorAction = 'Stop'
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) { $params['UseBasicParsing'] = $true }
    $resp = Invoke-WebRequest @params
    if ($resp.StatusCode -ne 200) {
      $out.detail = "/ not 200 (HTTP $($resp.StatusCode))"
      return $out
    }
    $html = [string]$resp.Content
  } catch {
    $out.detail = "/ fetch error: $($_.Exception.Message)"
    return $out
  }

  if (-not $html -or $html.Length -lt 2000) {
    $out.detail = "/ html too small"
    return $out
  }

  $assetPath = $null
  try {
    # href="/_next/static/css/<hash>.css" or src="/_next/static/chunks/<hash>.js"
    $m = [regex]::Match($html, '/_next/static/[^\s"<>]+\.(?:css|js)')
    if ($m.Success) { $assetPath = [string]$m.Value }
  } catch { $assetPath = $null }

  if (-not $assetPath) {
    $out.detail = "no /_next/static asset in HTML"
    return $out
  }

  try {
    $params2 = @{
      Uri         = ("{0}{1}" -f $base, $assetPath)
      TimeoutSec  = $TimeoutSec
      Method      = 'GET'
      ErrorAction = 'Stop'
    }
    if ($PSVersionTable.PSVersion.Major -lt 6) { $params2['UseBasicParsing'] = $true }
    $resp2 = Invoke-WebRequest @params2
    if ($resp2.StatusCode -ne 200) {
      $out.detail = "static asset not 200: $assetPath (HTTP $($resp2.StatusCode))"
      return $out
    }
  } catch {
    $out.detail = "static asset fetch error: $assetPath ($($_.Exception.Message))"
    return $out
  }

  $out.ok = $true
  $out.detail = "ok"
  return $out
}

Write-Host ("[web] mode={0} starting on :{1} (timeout {2}s)" -f $Mode, $Port, $TimeoutSec) -ForegroundColor Green

$npmExe = 'npm.cmd'
if (-not (Get-Command $npmExe -ErrorAction SilentlyContinue)) {
  throw "npm을 찾을 수 없습니다: $npmExe (Node.js 설치/Path를 확인하세요)"
}

# Kill any previous Next processes for this port (dev/start) to release log handles
try {
  $portArg = "(?:-p\\s+{0}\\b|--port\\s+{0}\\b)" -f $Port
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object {
      $_.CommandLine -match 'node_modules[/\\\\]next' -and
      $_.CommandLine -match '\b(dev|start)\b' -and
      $_.CommandLine -match $portArg
    } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
} catch {}

# Optionally free the port if another process is listening (EADDRINUSE guard)
if ($ForceKillPort) {
  $pids = @(Get-ListeningPids -Port $Port)
  foreach ($listenPid in $pids) {
    try {
      $p = Get-Process -Id $listenPid -ErrorAction SilentlyContinue
      if ($p) {
        Write-Host ("[web] killing PID {0} listening on :{1} ({2})" -f $listenPid, $Port, ($p.Path)) -ForegroundColor Yellow
        Stop-Process -Id $listenPid -Force -ErrorAction SilentlyContinue
      }
    } catch {}
  }
  $deadlineKill = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadlineKill) {
    Start-Sleep -Milliseconds 250
    $still = @(Get-ListeningPids -Port $Port)
    if ($still.Count -eq 0) { break }
  }
  $still2 = @(Get-ListeningPids -Port $Port)
  if ($still2.Count -gt 0) {
    throw "[web] 포트 해제 실패(:$Port). PID: $($still2 -join ', ')"
  }
} else {
  $pids = @(Get-ListeningPids -Port $Port)
  if ($pids.Count -gt 0) {
    throw "[web] 포트가 이미 사용 중입니다(:$Port). -ForceKillPort로 재시도하세요. PID: $($pids -join ', ')"
  }
}

# deps: 운영(prod) 기본은 재설치하지 않는다. node_modules가 없거나 -Install 지정 시에만 설치한다.
if (-not (Test-Path 'node_modules')) {
  Write-Host '[web] node_modules 없음 → npm ci 실행' -ForegroundColor Cyan
  & $npmExe ci *>> $outLog 2>> $errLog
  if ($LASTEXITCODE -ne 0) { throw "npm ci 실패 (exit=$LASTEXITCODE). 로그: $outLog / $errLog" }
} elseif ($Install) {
  Write-Host '[web] -Install 지정됨 → npm install 실행' -ForegroundColor Cyan
  & $npmExe install *>> $outLog 2>> $errLog
  if ($LASTEXITCODE -ne 0) { throw "npm install 실패 (exit=$LASTEXITCODE). 로그: $outLog / $errLog" }
}

# Build/Cache policy
$maxAttempts = 1
if ($Mode -eq 'prod' -and -not $SkipBuild -and -not $CleanBuild) {
  # 1차 기동 후 "/ + /_next/static" 체크가 실패하면, 동일 실행 내에서 CleanBuild로 1회 자가복구한다.
  $maxAttempts = 2
}

for ($attempt = 1; $attempt -le $maxAttempts; $attempt++) {
  $attemptClean = ($attempt -ge 2) -or $CleanBuild
  $suffix = if ($attempt -ge 2) { ".retry$attempt" } else { "" }
  $outLog2 = $outLog -replace '\.log$', ("{0}.log" -f $suffix)
  $errLog2 = $errLog -replace '\.log$', ("{0}.log" -f $suffix)

  if ($Mode -eq 'dev') {
    # dev cache는 깨진 상태로 시작하면 overlay/번들 오류가 누적되므로, 삭제 실패 시 즉시 중단한다.
    $devDir = Join-Path $web '.next'
    if (Test-Path $devDir) {
      Write-Host '[web] dev cache(.next) 정리' -ForegroundColor Cyan
      try { Remove-Item -Recurse -Force $devDir } catch { throw ".next 삭제 실패(잠금/권한): $($_.Exception.Message)" }
    }
    $proc = Start-LoggedProcess node @('node_modules/next/dist/bin/next','dev','-p',"$Port",'--hostname',"$Hostname") $outLog2 $errLog2
  } else {
    # prod: .next-prod를 사용한다(next.config.mjs distDir)
    $env:NODE_ENV = 'production'
    $prodDir = Join-Path $web '.next-prod'
    $buildId = Join-Path $prodDir 'BUILD_ID'

    # 소스 변경 감지(운영 편의):
    # - `npm run build`를 사용자가 "언제 해야 하는지" 판단하기 어렵기 때문에,
    #   빌드 산출물(BUILD_ID)보다 최신인 소스/설정 파일이 있으면 자동으로 재빌드한다.
    # - `-SkipBuild`는 "이미 빌드가 확실"한 경우에만 사용(기본은 자동 감지).
    if (-not $attemptClean -and -not $SkipBuild -and (Test-Path $buildId)) {
      try {
        $buildTimeUtc = (Get-Item -LiteralPath $buildId -ErrorAction Stop).LastWriteTimeUtc
        $newerPath = $null
        $watchFiles = @(
          (Join-Path $web 'next.config.mjs'),
          (Join-Path $web 'package.json'),
          (Join-Path $web 'package-lock.json'),
          (Join-Path $web 'tsconfig.json')
        )
        foreach ($wf in $watchFiles) {
          if (-not (Test-Path $wf)) { continue }
          $t = (Get-Item -LiteralPath $wf -ErrorAction SilentlyContinue).LastWriteTimeUtc
          if ($t -and $t -gt $buildTimeUtc) { $newerPath = $wf; break }
        }

        if (-not $newerPath) {
          $srcDir = Join-Path $web 'src'
          if (Test-Path $srcDir) {
            $newer = Get-ChildItem -LiteralPath $srcDir -Recurse -File -ErrorAction SilentlyContinue |
              Where-Object {
                $_.LastWriteTimeUtc -gt $buildTimeUtc -and $_.Extension -in @('.ts','.tsx','.js','.jsx','.css','.mjs')
              } |
              Select-Object -First 1
            if ($newer -and $newer.FullName) { $newerPath = $newer.FullName }
          }
        }

        if ($newerPath) {
          Write-Host ("[web] 소스 변경 감지 → .next-prod 삭제 후 재빌드 ({0})" -f $newerPath) -ForegroundColor Yellow
          if (Test-Path $prodDir) {
            try { Remove-Item -Recurse -Force $prodDir } catch { throw ".next-prod 삭제 실패(잠금/권한): $($_.Exception.Message)" }
          }
        }
      } catch {
        Write-Host ("[web] 소스 변경 감지 스킵(오류): {0}" -f $_.Exception.Message) -ForegroundColor Yellow
      }
    }

    # `.next-prod` 산출물이 부분 삭제/불일치 상태면(next chunk require 실패 등)
    # BUILD_ID가 있어도 실행 중에 MODULE_NOT_FOUND가 반복될 수 있으므로, 필수 디렉터리 누락을 감지해 강제 재빌드한다.
    if (-not $attemptClean -and -not $SkipBuild -and (Test-Path $buildId)) {
      $required = @(
        (Join-Path $prodDir 'server\app'),
        (Join-Path $prodDir 'server\chunks'),
        (Join-Path $prodDir 'server\pages'),
        (Join-Path $prodDir 'static')
      )
      $missing = @($required | Where-Object { -not (Test-Path $_) })
      if ($missing.Count -gt 0) {
        $missText = ($missing -join ', ')
        Write-Host ("[web] .next-prod 산출물 손상 감지(누락: {0}) → .next-prod 삭제 후 재빌드" -f $missText) -ForegroundColor Yellow
        try { Remove-Item -Recurse -Force $prodDir } catch { throw ".next-prod 삭제 실패(잠금/권한): $($_.Exception.Message)" }
      }
    }

    if ($attemptClean -and (Test-Path $prodDir)) {
      Write-Host '[web] CleanBuild → .next-prod 삭제' -ForegroundColor Yellow
      try { Remove-Item -Recurse -Force $prodDir } catch { throw ".next-prod 삭제 실패(잠금/권한): $($_.Exception.Message)" }
    }

    if (-not $SkipBuild) {
      if (-not (Test-Path $buildId)) {
        Write-Host '[web] .next-prod 빌드 없음 → npm run build 실행' -ForegroundColor Cyan
        & $npmExe run build *>> $outLog2 2>> $errLog2
        if ($LASTEXITCODE -ne 0) { throw "npm run build 실패 (exit=$LASTEXITCODE). 로그: $outLog2 / $errLog2" }
      }
    } else {
      if (-not (Test-Path $buildId)) {
        throw "SkipBuild 지정됨 but BUILD_ID가 없습니다: $buildId"
      }
    }

    $proc = Start-LoggedProcess node @('node_modules/next/dist/bin/next','start','-p',"$Port",'--hostname',"$Hostname") $outLog2 $errLog2
  }

  # 최신 로그 파일 경로를 별도 포인터로 남긴다(rotate/rename 잠금(WinError 32)으로 기동이 실패하지 않게 하기 위함).
  try {
    $latest = @{
      startedAt = (Get-Date).ToString('o')
      runId     = $runId
      mode      = $Mode
      port      = $Port
      hostname  = $Hostname
      pid       = $proc.Id
      outLog    = $outLog2
      errLog    = $errLog2
    }
    $latest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $latestPath -Encoding UTF8
  } catch {}

  $deadline = (Get-Date).AddSeconds([math]::Max(5,$TimeoutSec))
  $ready = $false
  do {
    Start-Sleep -Seconds 1
    try {
      if ($proc -and $proc.HasExited) {
        Write-Host "[web] FAILED: next process exited early (pid=$($proc.Id)). See logs: $outLog2 / $errLog2" -ForegroundColor Yellow
        break
      }
    } catch { }
    try {
      $params = @{
        Uri         = "http://127.0.0.1:$Port/api/ping"
        TimeoutSec  = 2
        Method      = 'GET'
        ErrorAction = 'Stop'
      }
      if ($PSVersionTable.PSVersion.Major -lt 6) { $params['UseBasicParsing'] = $true }
      $resp = Invoke-WebRequest @params
      if ($resp.StatusCode -eq 200) {
        $ready = $true
        break
      }
    } catch { }
  } while ((Get-Date) -lt $deadline)

  if (-not $ready) {
    if ((Get-Date) -ge $deadline) {
      Write-Host "[web] TIMEOUT waiting for :$Port. See logs at $outLog2 / $errLog2" -ForegroundColor Yellow
    }
    if ($proc) { try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {} }
    throw "[web] 기동 실패: /api/ping 타임아웃/실패"
  }

  # "/ + /_next/static"까지 확인해서, 남색 배경만 뜨는(정적 자산 404) 상태를 READY로 간주하지 않는다.
  $static = Test-WebStaticOk -Port $Port -TimeoutSec 2
  if ($static.ok -eq $true) {
    Write-Host "[web] READY on :$Port" -ForegroundColor Green
    break
  }

  Write-Host ("[web] WARN: 정적 자산 체크 실패 → UI가 빈 화면일 수 있음. detail={0}" -f $static.detail) -ForegroundColor Yellow
  if ($proc) {
    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch {}
  }

  if ($attempt -lt $maxAttempts) {
    Write-Host "[web] 재시도: CleanBuild로 재빌드 후 재기동" -ForegroundColor Yellow
    continue
  }

  throw "[web] 기동 실패: 정적 자산 체크 실패. detail=$($static.detail)"
}
