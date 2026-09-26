[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw 'Python 3.14 가상환경이 없습니다. README.md의 환경 구성 절차를 먼저 실행하세요.'
}
$version = & $python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"
if ($version -ne '3.14') { throw "Python 3.14가 필요합니다. 현재 가상환경: $version" }
& (Join-Path $PSScriptRoot 'start_local_db.ps1')
& (Join-Path $PSScriptRoot 'load_album_env.ps1') -Path (Join-Path $projectRoot 'local\album.env')

$processes = @(
    @{ Name='API'; Args=@('scripts\local_api.py'); Out='local\api.log'; Err='local\api.error.log' },
    @{ Name='Worker'; Args=@('scripts\local_worker.py'); Out='local\worker.log'; Err='local\worker.error.log' },
    @{ Name='Web'; Args=@('-m','http.server','8090','--bind','127.0.0.1','--directory','web'); Out='local\web.log'; Err='local\web.error.log' }
)
foreach ($item in $processes) {
    Start-Process -FilePath $python -ArgumentList $item.Args -WorkingDirectory $projectRoot -RedirectStandardOutput (Join-Path $projectRoot $item.Out) -RedirectStandardError (Join-Path $projectRoot $item.Err) -WindowStyle Hidden | Out-Null
}
Start-Sleep -Seconds 1
Write-Output '비밀앨범: http://127.0.0.1:8090'
Write-Output 'API 상태: http://127.0.0.1:3051/health'
if (-not $NoBrowser) { Start-Process 'http://127.0.0.1:8090' }

