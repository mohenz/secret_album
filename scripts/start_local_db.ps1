[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot 'local'
$dataRoot = Join-Path $localRoot 'postgres-data'
$envFile = Join-Path $localRoot 'album.env'
$schemaFile = Join-Path $localRoot 'schema.sql'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$pgPort = 54328
$dbName = 'secret_album'
$dbUser = 'album_app'

foreach ($tool in 'initdb.exe','pg_ctl.exe','createdb.exe','psql.exe') {
    if (-not (Test-Path -LiteralPath (Join-Path $pgBin $tool))) { throw "PostgreSQL 도구를 찾을 수 없습니다: $tool" }
}
New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $envFile)) {
    $bytes = New-Object byte[] 32
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    $password = [Convert]::ToBase64String($bytes).Replace('+','A').Replace('/','B').TrimEnd('=')
    @('PGHOST=127.0.0.1',"PGPORT=$pgPort","PGUSER=$dbUser","PGPASSWORD=$password","PGDATABASE=$dbName",'ALBUM_API_HOST=127.0.0.1','ALBUM_API_PORT=3051','ALBUM_WEB_ORIGINS=http://localhost:8090,http://127.0.0.1:8090') | Set-Content -LiteralPath $envFile -Encoding utf8
}
$settings = @{}
Get-Content -LiteralPath $envFile | ForEach-Object { if ($_ -match '^([^#=]+)=(.*)$') { $settings[$matches[1]]=$matches[2] } }
$env:PGPASSWORD = $settings.PGPASSWORD

if (-not (Test-Path -LiteralPath (Join-Path $dataRoot 'PG_VERSION'))) {
    $pwFile = Join-Path $localRoot 'postgres-password.tmp'
    try {
        Set-Content -LiteralPath $pwFile -Value $env:PGPASSWORD -NoNewline -Encoding ascii
        & (Join-Path $pgBin 'initdb.exe') -D $dataRoot -U $dbUser -A scram-sha-256 --pwfile=$pwFile --encoding=UTF8 --locale=C
        if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 클러스터 초기화 실패' }
    } finally { Remove-Item -LiteralPath $pwFile -Force -ErrorAction SilentlyContinue }
}
$listener = Get-NetTCPConnection -LocalAddress 127.0.0.1 -LocalPort $pgPort -State Listen -ErrorAction SilentlyContinue
if (-not $listener) {
    # pg_ctl을 숨겨진 새 콘솔에서 실행한다. 호출한 터미널의 콘솔을 물려받으면 그 창을 닫은 뒤
    # 새 연결 프로세스가 0xC0000142(DLL 초기화 실패)로 죽는다.
    # 출력은 리다이렉트하지 않는다. postgres가 리다이렉트 스트림을 물려받으면 호출 측이 끝나지 않는다.
    # 서버 로그는 -l 옵션으로 파일에 남는다.
    $logFile = Join-Path $localRoot 'postgres.log'
    $process = Start-Process (Join-Path $pgBin 'pg_ctl.exe') -WindowStyle Hidden -PassThru `
        -ArgumentList @('start', '-D', "`"$dataRoot`"", '-l', "`"$logFile`"", '-o', "`"-p $pgPort -h 127.0.0.1`"", '-w', '-t', '30')
    $process.WaitForExit()
    if ($process.ExitCode -ne 0) { throw "PostgreSQL 시작 실패(종료 코드 $($process.ExitCode)). $logFile 을 확인하세요." }
}
$exists = & (Join-Path $pgBin 'psql.exe') -h 127.0.0.1 -p $pgPort -U $dbUser -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$dbName'"
if (($exists | Out-String).Trim() -ne '1') {
    & (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p $pgPort -U $dbUser $dbName
    if ($LASTEXITCODE -ne 0) { throw '데이터베이스 생성 실패' }
}
& (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -h 127.0.0.1 -p $pgPort -U $dbUser -d $dbName -f $schemaFile
if ($LASTEXITCODE -ne 0) { throw '스키마 적용 실패' }
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
Write-Output "DATABASE_READY host=127.0.0.1 port=$pgPort database=$dbName user=$dbUser"
