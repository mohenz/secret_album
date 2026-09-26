[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$dataRoot = Join-Path $projectRoot 'local\postgres-data'
$pgCtl = 'C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe'
if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) { Write-Output 'PostgreSQL 데이터 디렉터리가 없습니다.'; exit 0 }
& $pgCtl -D $dataRoot status *> $null
if ($LASTEXITCODE -eq 3) { Write-Output 'PostgreSQL이 실행 중이 아닙니다.'; exit 0 }
& $pgCtl -D $dataRoot stop -m fast
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 종료 실패' }

