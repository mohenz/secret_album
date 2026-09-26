# 운영 서버 배포. Gitea post-receive 훅(deploy/post-receive)이 main push마다 실행한다.
#
#   deploy.ps1 -GitDir <Gitea 저장소 경로>     작업 트리를 main으로 갱신한 뒤 배포
#   deploy.ps1 -SkipCheckout                  현재 작업 트리 그대로 재배포 (수동)
#
# 순서: 작업 트리 갱신 → 패키지 변경 시 설치 → 새 마이그레이션이 있으면 안전 백업 후 적용
#       → API·Worker·웹 종료 → 감시 예약 작업(없으면 launch_album.ps1)이 새 코드로 기동
#       → /health·/ready 확인 → 로그인 없이 사진·API가 401인지 확인 (배포 불변 조건)
[CmdletBinding()]
param(
    [string]$GitDir,
    [string]$Branch = 'main',
    [switch]$SkipCheckout
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $root 'local'
$logFile = Join-Path $localRoot 'deploy.log'
$python = Join-Path $root '.venv\Scripts\python.exe'
New-Item -ItemType Directory -Force $localRoot | Out-Null

function Write-Log([string]$Text) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] [SecretAlbum Deploy] $Text"
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
    Write-Output $line
}

function Get-Status([string]$Url) {
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $Url).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return 0 }
}

try {
    Write-Log "start (branch $Branch)"
    if (-not $SkipCheckout) {
        if (-not $GitDir) { throw '-GitDir 또는 -SkipCheckout을 지정해 주세요.' }
        git --git-dir="$GitDir" --work-tree="$root" checkout -f $Branch
        if ($LASTEXITCODE -ne 0) { throw 'git checkout 실패' }
        $commit = (git --git-dir="$GitDir" rev-parse --short $Branch).Trim()
        Write-Log "working tree updated to $commit (local/ is untracked and preserved)"
    }

    # 패키지 목록이 바뀌었을 때만 설치한다.
    $reqHash = (Get-FileHash (Join-Path $root 'requirements.txt')).Hash
    $reqMarker = Join-Path $localRoot '.requirements.sha256'
    if (-not (Test-Path $reqMarker) -or (Get-Content $reqMarker) -ne $reqHash) {
        & $python -m pip install -q -r (Join-Path $root 'requirements.txt')
        if ($LASTEXITCODE -ne 0) { throw 'pip install 실패' }
        Set-Content -LiteralPath $reqMarker -Value $reqHash
        Write-Log 'python packages installed'
    }

    # 새 마이그레이션이 있으면 먼저 DB를 백업한다.
    & (Join-Path $root 'scripts\load_album_env.ps1') -Path (Join-Path $localRoot 'album.env')
    $applied = @(& 'C:\Program Files\PostgreSQL\18\bin\psql.exe' -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -tAc 'SELECT name FROM schema_migrations' 2>$null)
    $pending = @(Get-ChildItem (Join-Path $localRoot 'migrations') -Filter '*.sql' | Where-Object { $applied -notcontains $_.Name })
    if ($pending.Count -gt 0) {
        Write-Log "pending migrations: $($pending.Name -join ', ') — backing up first"
        & (Join-Path $root 'scripts\backup_album.ps1') | Out-Null
        if ($LASTEXITCODE -ne 0) { throw '마이그레이션 전 백업 실패. 배포를 중단합니다.' }
    }
    & (Join-Path $root 'scripts\start_local_db.ps1') | Out-Null
    Write-Log 'database ready, migrations applied'

    # 프로세스를 끝내기만 한다. 다시 띄우는 일은 감시 예약 작업이 맡는다 (supervisor.ps1 참고).
    $apiPort = if ($env:ALBUM_API_PORT) { [int]$env:ALBUM_API_PORT } else { 3051 }
    $webPort = if ($env:ALBUM_WEB_PORT) { [int]$env:ALBUM_WEB_PORT } else { 8090 }
    foreach ($port in $apiPort, $webPort) {
        Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }
    }
    Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*local_worker.py*' -and $_.CommandLine -like "*$root*" } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Write-Log 'API, Worker, and web stopped'
    Start-Sleep -Seconds 2
    if (Get-ScheduledTask -TaskName 'SecretAlbum-Supervisor' -ErrorAction SilentlyContinue) {
        Write-Log 'waiting for SecretAlbum-Supervisor to restart services'
    } else {
        Write-Log 'supervisor task not registered; starting services directly'
        $launcher = Start-Process powershell.exe -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $root 'scripts\launch_album.ps1'), '-NoBrowser' -WindowStyle Hidden -PassThru
        $launcher.WaitForExit()
    }

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        if ((Get-Status "http://127.0.0.1:$apiPort/ready") -eq 200 -and (Get-Status "http://127.0.0.1:$webPort/login.html") -eq 200) { $ready = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $ready) { throw '60초 안에 서비스가 준비되지 않았습니다. local\api.log, worker.log, supervisor.log를 확인해 주세요.' }

    # 배포 불변 조건: 로그인 없이 사진과 API에 접근할 수 없다.
    $albums = Get-Status "http://127.0.0.1:$apiPort/albums"
    $media = Get-Status "http://127.0.0.1:$apiPort/media/00000000-0000-0000-0000-000000000000/thumb"
    $localDir = Get-Status "http://127.0.0.1:$webPort/local/album.env"
    if ($albums -ne 401 -or $media -ne 401 -or $localDir -ne 404) {
        throw "보안 확인 실패: /albums=$albums /media=$media /local/album.env=$localDir (기대값 401, 401, 404)"
    }
    Write-Log 'deploy succeeded (ready 200, unauthenticated 401, local/ not served)'
    exit 0
} catch {
    Write-Log "deploy FAILED: $($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
