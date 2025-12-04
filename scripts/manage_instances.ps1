<#
LDPlayer 인스턴스 제어 스크립트 (초안)
TODO:
- 인스턴스 목록(config/instances.yaml) 읽기
- ADB 연결/재시작
- IRIS 봇 상태 점검 및 재기동
#>

param(
    [ValidateSet('start','stop','status','restart')]
    [string]$Action = 'status'
)

Write-Host "[TODO] manage_instances.ps1 - Action: $Action" -ForegroundColor Cyan
