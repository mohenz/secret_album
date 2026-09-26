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

$webBind = if ($env:ALBUM_WEB_BIND) { $env:ALBUM_WEB_BIND } else { '127.0.0.1' }
$webPort = if ($env:ALBUM_WEB_PORT) { $env:ALBUM_WEB_PORT } else { '8090' }
$apiPort = if ($env:ALBUM_API_PORT) { $env:ALBUM_API_PORT } else { '3051' }

function Test-Listening([int]$Port) {
    [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Test-WorkerRunning {
    [bool](Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*local_worker.py*' -and $_.CommandLine -like "*$projectRoot*" })
}

# 출력은 각 프로세스가 local/*.log에 직접 남긴다. 시작 직후의 오류만 cmd 리다이렉트로 *.error.log에 받는다.
# Start-Process에 -Redirect* 옵션을 쓰면 자식이 호출 측 핸들을 물려받아, 호출한 쪽이 끝나지 않는 문제가 생긴다.
function Start-AlbumProcess([string]$Name, [string]$Arguments, [string]$ErrorLog) {
    $command = "`"$python`" $Arguments 2>> `"$(Join-Path $projectRoot $ErrorLog)`""
    Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', "`"$command`"") -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
    Write-Output "$Name 시작"
}

if (-not (Test-Listening $apiPort)) { Start-AlbumProcess 'API' 'scripts\local_api.py' 'local\api.error.log' }
if (-not (Test-WorkerRunning)) { Start-AlbumProcess 'Worker' 'scripts\local_worker.py' 'local\worker.error.log' }
if (-not (Test-Listening $webPort)) { Start-AlbumProcess 'Web' "scripts\web_server.py --port $webPort --bind $webBind --api-port $apiPort" 'local\web.error.log' }

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 "http://127.0.0.1:$apiPort/ready"
        if ($response.StatusCode -eq 200) { $ready = $true; break }
    } catch { Start-Sleep -Milliseconds 500 }
}
if (-not $ready) { throw "API가 준비되지 않았습니다. local\api.log와 local\api.error.log를 확인해 주세요." }

Write-Output "비밀앨범: http://127.0.0.1:$webPort"
Write-Output "API 상태: http://127.0.0.1:$apiPort/health"
if ($webBind -ne '127.0.0.1') { Write-Output "내부망 접속: http://<이 PC의 IP>:$webPort (방화벽에서 $webPort, $apiPort 허용 필요)" }
if (-not $NoBrowser) { Start-Process "http://127.0.0.1:$webPort" }
