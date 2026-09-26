# 비밀앨범 프로세스 감시. "SecretAlbum-Supervisor" 예약 작업이 실행한다 (register_supervisor.ps1).
#
# 왜 예약 작업인가: 배포 훅·에이전트 셸에서 Start-Process로 띄운 프로세스는 호출자의 작업 개체에 묶여
# 호출자가 끝나면 함께 종료될 수 있다(cinetube에서 실제 발생). 예약 작업은 그런 묶임 밖에서 실행되므로,
# 배포는 프로세스를 끝내기만 하고 다시 띄우는 일은 이 감시 루프가 맡는다.
#
# PostgreSQL · API · Worker · 정적 웹을 모두 확인한다 (cinetube는 API만 감시했다).
[CmdletBinding()]
param(
    [int]$IntervalSeconds = 15,
    [switch]$Once
)
$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot 'local'
$logFile = Join-Path $localRoot 'supervisor.log'
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'
New-Item -ItemType Directory -Force $localRoot | Out-Null

function Write-Log([string]$Text) {
    Add-Content -LiteralPath $logFile -Value "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Text" -Encoding utf8 -ErrorAction SilentlyContinue
}

# 예약 작업은 1분마다 다시 실행되어 스스로 복구한다. 이미 감시 중이면 바로 끝낸다.
$mutex = New-Object System.Threading.Mutex($false, 'Global\SecretAlbumSupervisor')
if (-not $mutex.WaitOne(0)) { exit 0 }

& (Join-Path $PSScriptRoot 'load_album_env.ps1') -Path (Join-Path $localRoot 'album.env')
$webBind = if ($env:ALBUM_WEB_BIND) { $env:ALBUM_WEB_BIND } else { '127.0.0.1' }
$webPort = if ($env:ALBUM_WEB_PORT) { [int]$env:ALBUM_WEB_PORT } else { 8090 }
$apiPort = if ($env:ALBUM_API_PORT) { [int]$env:ALBUM_API_PORT } else { 3051 }
$dbPort = if ($env:PGPORT) { [int]$env:PGPORT } else { 54328 }

function Test-Listening([int]$Port) { [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) }
function Test-WorkerRunning {
    [bool](Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*local_worker.py*' -and $_.CommandLine -like "*$projectRoot*" })
}
function Start-AlbumProcess([string]$Name, [string]$Arguments, [string]$ErrorLog) {
    $command = "`"$python`" $Arguments 2>> `"$(Join-Path $projectRoot $ErrorLog)`""
    Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', "`"$command`"") -WorkingDirectory $projectRoot -WindowStyle Hidden | Out-Null
    Write-Log "$Name started"
}

Write-Log "supervisor started (pid $PID)"
try {
    while ($true) {
        try {
            if (-not (Test-Listening $dbPort)) {
                Write-Log 'PostgreSQL not listening, starting'
                & (Join-Path $PSScriptRoot 'start_local_db.ps1') | Out-Null
            }
            if (-not (Test-Listening $apiPort)) { Start-AlbumProcess 'API' 'scripts\local_api.py' 'local\api.error.log' }
            if (-not (Test-WorkerRunning)) { Start-AlbumProcess 'Worker' 'scripts\local_worker.py' 'local\worker.error.log' }
            if (-not (Test-Listening $webPort)) { Start-AlbumProcess 'Web' "scripts\web_server.py --port $webPort --bind $webBind --api-port $apiPort" 'local\web.error.log' }
        } catch {
            Write-Log "check failed: $($_.Exception.Message)"
        }
        if ($Once) { break }
        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    $mutex.ReleaseMutex()
    Write-Log 'supervisor stopped'
}
