[CmdletBinding()]
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $python)) {
    throw "가상환경이 없습니다. 'py -3.14 -m venv .venv' 후 '.\.venv\Scripts\python.exe -m pip install -r requirements.txt'를 실행해 주세요."
}
# Windows PowerShell 5.1은 네이티브 인자 안의 큰따옴표를 지우므로 따옴표 없는 식을 쓴다.
$pythonVersion = (& $python -c 'import sys; print(*sys.version_info[:2], sep=chr(46))' | Out-String).Trim()
if ($pythonVersion -ne '3.14') {
    throw "가상환경 Python이 $pythonVersion 입니다. .venv를 삭제하고 Python 3.14로 다시 만들어 주세요."
}
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

