# 운영 서버(192.168.0.2) 최초 구성. 서버의 관리자 PowerShell에서 한 번만 실행한다.
#
#   git clone http://192.168.0.2:3000/admin/secret_album.git E:\workspace\secret_album
#   powershell -NoProfile -ExecutionPolicy Bypass -File E:\workspace\secret_album\deploy\server_setup.ps1
#
# 하는 일 (각 단계는 이미 되어 있으면 건너뛴다):
#   1. 사전 확인: 관리자 권한, Git, PostgreSQL 18, Python 3.14(없으면 winget 설치), 포트 8090·3051·54328
#   2. Python 가상환경과 패키지
#   3. 전용 PostgreSQL 클러스터·DB (local\album.env 자동 생성) + 내부망 접속 설정
#   4. 개발 PC 데이터 이전: Gitea 비공개 릴리스 'data-migration'의 zip(DB 덤프+원본 사진)을 받아 복원
#      (-Bundle로 zip 경로 지정 가능, -NoData면 새로 시작하고 소유자 계정을 만든다)
#   5. 방화벽(같은 서브넷만), Gitea post-receive 훅(이후 main push마다 자동 배포), 감시 예약 작업
#   6. /ready·화면·보안(로그인 없이 401) 확인
[CmdletBinding()]
param(
    [string]$ServiceUser = "$env:USERDOMAIN\$env:USERNAME",
    [string]$GiteaUrl = 'http://192.168.0.2:3000',
    [string]$Repo = 'admin/secret_album',
    [string]$Bundle,
    [switch]$NoData,
    [string]$GiteaRepoRoot
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $root 'local'
$python = Join-Path $root '.venv\Scripts\python.exe'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$envFile = Join-Path $localRoot 'album.env'

function Step([string]$Text) { Write-Host "`n== $Text" -ForegroundColor Cyan }
function Ok([string]$Text) { Write-Host "   OK  $Text" -ForegroundColor Green }
function Info([string]$Text) { Write-Host "   ..  $Text" }

function Get-GiteaCredential {
    # git clone 때 저장된 자격 증명을 먼저 쓰고, 없으면 묻는다.
    $uri = [Uri]$GiteaUrl
    $query = "protocol=$($uri.Scheme)`nhost=$($uri.Authority)`n`n"
    $filled = $query | git credential fill 2>$null
    $user = ($filled | Where-Object { $_ -like 'username=*' }) -replace '^username=', ''
    $pass = ($filled | Where-Object { $_ -like 'password=*' }) -replace '^password=', ''
    if ($user -and $pass) { return [pscredential]::new($user, (ConvertTo-SecureString $pass -AsPlainText -Force)) }
    return Get-Credential -UserName 'admin' -Message "Gitea($GiteaUrl) 계정"
}

# ---------------------------------------------------------------- 1. 사전 확인
Step '1/6 사전 확인'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '관리자 PowerShell에서 실행해 주세요.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Git이 없습니다.' }
foreach ($tool in 'initdb.exe', 'pg_ctl.exe', 'pg_restore.exe', 'psql.exe') {
    if (-not (Test-Path (Join-Path $pgBin $tool))) { throw "PostgreSQL 18 도구가 없습니다: $pgBin\$tool" }
}
Ok 'Git, PostgreSQL 18'

function Test-Py314 { try { & py -3.14 -c "import sys; sys.exit(0 if sys.version_info[:2] == (3, 14) else 1)" 2>$null; return $LASTEXITCODE -eq 0 } catch { return $false } }
if (-not (Test-Py314)) {
    Info 'Python 3.14가 없어 winget으로 설치합니다.'
    winget install -e --id Python.Python.3.14 --scope machine --accept-package-agreements --accept-source-agreements --silent
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not (Test-Py314)) { throw 'Python 3.14 설치를 확인하지 못했습니다. https://www.python.org 에서 3.14를 설치한 뒤 다시 실행해 주세요.' }
}
Ok 'Python 3.14'

foreach ($port in 8090, 3051, 54328) {
    $owner = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($owner) {
        $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId=$($owner.OwningProcess)").CommandLine
        if ($cmd -notlike "*secret_album*" -and $cmd -notlike "*$root*" -and $cmd -notlike "*postgres*") {
            throw "포트 $port 를 다른 프로그램이 쓰고 있습니다: $cmd"
        }
    }
}
Ok '포트 8090, 3051, 54328'

# ---------------------------------------------------------------- 2. 가상환경
Step '2/6 Python 가상환경'
if (-not (Test-Path $python)) { & py -3.14 -m venv (Join-Path $root '.venv'); if ($LASTEXITCODE -ne 0) { throw 'venv 생성 실패' } }
& $python -m pip install -q --upgrade pip
& $python -m pip install -q -r (Join-Path $root 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install 실패' }
Set-Content -LiteralPath (Join-Path $localRoot '.requirements.sha256') -Value (Get-FileHash (Join-Path $root 'requirements.txt')).Hash -ErrorAction SilentlyContinue
Ok (& $python --version)

# ---------------------------------------------------------------- 3. DB와 내부망 설정
Step '3/6 PostgreSQL과 접속 설정'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\start_local_db.ps1')
if ($LASTEXITCODE -ne 0) { throw 'DB 시작 실패. local\postgres.log를 확인해 주세요.' }
$envText = Get-Content -LiteralPath $envFile -Raw
$lanIps = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' -or $_.IPAddress -like '172.*' } | ForEach-Object IPAddress)
$origins = (@($lanIps | ForEach-Object { "http://${_}:8090" }) + 'http://localhost:8090', 'http://127.0.0.1:8090') -join ','
$add = @()
if ($envText -notmatch '(?m)^ALBUM_API_HOST=') { $add += 'ALBUM_API_HOST=0.0.0.0' }
if ($envText -notmatch '(?m)^ALBUM_WEB_BIND=') { $add += 'ALBUM_WEB_BIND=0.0.0.0' }
if ($envText -notmatch '(?m)^ALBUM_WEB_ORIGINS=') { $add += "ALBUM_WEB_ORIGINS=$origins" }
if ($add) { Add-Content -LiteralPath $envFile -Value $add -Encoding utf8 }
Ok "DB 준비, 접속 허용: $origins"

# ---------------------------------------------------------------- 4. 데이터 이전
Step '4/6 데이터'
& (Join-Path $root 'scripts\load_album_env.ps1') -Path $envFile
$photoCount = [int](& (Join-Path $pgBin 'psql.exe') -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -tAc 'SELECT count(*) FROM photos').Trim()
$userCount = [int](& (Join-Path $pgBin 'psql.exe') -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -tAc 'SELECT count(*) FROM users').Trim()
if ($NoData) {
    if ($userCount -eq 0) { Info '소유자 계정을 만듭니다.'; & $python (Join-Path $root 'scripts\admin_create.py') }
    Ok '새로 시작'
} elseif ($photoCount -gt 0 -or $userCount -gt 0) {
    Ok "이미 데이터가 있어 이전을 건너뜁니다 (사진 $photoCount 장, 계정 $userCount 개)"
} else {
    $transfer = Join-Path $localRoot 'transfer'
    New-Item -ItemType Directory -Force $transfer | Out-Null
    if (-not $Bundle) {
        $cred = Get-GiteaCredential
        $auth = @{ Authorization = 'Basic ' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes("$($cred.UserName):$($cred.GetNetworkCredential().Password)")) }
        $releases = Invoke-RestMethod -Headers $auth -Uri "$GiteaUrl/api/v1/repos/$Repo/releases?draft=true&limit=50"
        $release = $releases | Where-Object { $_.name -eq 'data-migration' } | Select-Object -First 1
        if (-not $release -or -not $release.assets) { throw "Gitea 릴리스 'data-migration'에 이전 파일이 없습니다. -Bundle로 zip을 지정하거나 -NoData로 새로 시작해 주세요." }
        $asset = $release.assets | Sort-Object created_at -Descending | Select-Object -First 1
        $Bundle = Join-Path $transfer $asset.name
        Info "이전 파일 받는 중: $($asset.name) ($([math]::Round($asset.size / 1MB, 1)) MB)"
        Invoke-WebRequest -UseBasicParsing -Headers $auth -Uri $asset.browser_download_url -OutFile $Bundle
    }
    $unpacked = Join-Path $transfer 'unpacked'
    if (Test-Path $unpacked) { Remove-Item -Recurse -Force $unpacked }
    Expand-Archive -LiteralPath $Bundle -DestinationPath $unpacked
    $dump = Get-ChildItem $unpacked -Filter '*.dump' -Recurse | Select-Object -First 1
    if (-not $dump) { throw "zip 안에 DB 덤프(*.dump)가 없습니다: $Bundle" }
    & (Join-Path $root 'scripts\restore_album.ps1') -Dump $dump.FullName -OriginalsFrom (Join-Path $unpacked 'originals') -Apply
    & $python (Join-Path $root 'scripts\rebuild_derived.py') --missing
    if ($LASTEXITCODE -ne 0) { throw '파생 이미지 재생성 작업 등록 실패' }
    Remove-Item -Recurse -Force $unpacked
    $photoCount = [int](& (Join-Path $pgBin 'psql.exe') -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -tAc 'SELECT count(*) FROM photos WHERE deleted_at IS NULL').Trim()
    Ok "데이터 복원 완료: 사진 $photoCount 장 (화면용 이미지는 Worker가 이어서 만든다). 로그인은 개발 PC와 같은 계정·비밀번호"
}
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

# ---------------------------------------------------------------- 5. 방화벽·배포 훅·감시 작업
Step '5/6 방화벽, 자동 배포 훅, 감시 작업'
& (Join-Path $root 'deploy\configure_firewall.ps1')
Ok '방화벽: 같은 서브넷에서만 8090·3051'

if (-not $GiteaRepoRoot) {
    $candidates = @('C:\gitea', 'C:\Gitea', 'C:\ProgramData\gitea', 'C:\Program Files\Gitea', 'D:\gitea', 'E:\gitea', 'C:\tools\gitea', "$env:USERPROFILE\gitea-repositories", 'E:\', 'D:\', 'C:\')
    foreach ($base in $candidates) {
        if (-not (Test-Path $base)) { continue }
        $found = Get-ChildItem -Path $base -Directory -Filter 'secret_album.git' -Recurse -Depth 6 -ErrorAction SilentlyContinue | Where-Object { (Split-Path -Leaf (Split-Path -Parent $_.FullName)) -eq 'admin' } | Select-Object -First 1
        if ($found) { $GiteaRepoRoot = Split-Path -Parent (Split-Path -Parent $found.FullName); break }
    }
}
$bare = if ($GiteaRepoRoot) { Join-Path $GiteaRepoRoot 'admin\secret_album.git' }
if (-not $bare -or -not (Test-Path (Join-Path $bare 'hooks'))) { throw 'Gitea 저장소 폴더(admin\secret_album.git)를 찾지 못했습니다. -GiteaRepoRoot <gitea-repositories 경로>로 다시 실행해 주세요.' }
$hookDir = Join-Path $bare 'hooks\post-receive.d'
New-Item -ItemType Directory -Force $hookDir | Out-Null
$hook = (Get-Content -LiteralPath (Join-Path $root 'deploy\post-receive') -Raw) -replace 'DEPLOY_ROOT="[^"]*"', "DEPLOY_ROOT=`"$($root.Replace('\', '/'))`""
[IO.File]::WriteAllText((Join-Path $hookDir 'secret-album'), ($hook -replace "`r`n", "`n"), [Text.UTF8Encoding]::new($false))
Ok "배포 훅: $hookDir\secret-album"

& (Join-Path $root 'scripts\register_supervisor.ps1') -User $ServiceUser
Ok "감시 예약 작업 (실행 계정 $ServiceUser)"

# ---------------------------------------------------------------- 6. 확인
Step '6/6 확인'
function Get-Status([string]$Url) {
    try { return (Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 $Url).StatusCode }
    catch { if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode } return 0 }
}
$deadline = (Get-Date).AddSeconds(120)
while ((Get-Status 'http://127.0.0.1:3051/ready') -ne 200 -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 3 }
$checks = [ordered]@{
    'API /ready 200'            = (Get-Status 'http://127.0.0.1:3051/ready') -eq 200
    '화면 /login.html 200'      = (Get-Status 'http://127.0.0.1:8090/login.html') -eq 200
    '로그인 없이 /albums 401'   = (Get-Status 'http://127.0.0.1:3051/albums') -eq 401
    '/local/album.env 404'      = (Get-Status 'http://127.0.0.1:8090/local/album.env') -eq 404
}
$failed = $false
foreach ($item in $checks.GetEnumerator()) {
    if ($item.Value) { Ok $item.Key } else { Write-Host "   FAIL $($item.Key)" -ForegroundColor Red; $failed = $true }
}
if ($failed) { throw '확인 실패. local\supervisor.log, local\api.log를 확인해 주세요.' }
$url = if ($lanIps) { "http://$($lanIps[0]):8090" } else { 'http://<서버 IP>:8090' }
Write-Host "`n구성을 마쳤습니다. 접속: $url" -ForegroundColor Green
Write-Host '이후에는 개발 PC에서 git push gitea main 만 하면 자동으로 배포됩니다 (결과: local\deploy.log).'
