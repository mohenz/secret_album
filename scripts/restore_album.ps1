# 백업 복원.
#
# 복원 연습 (운영 DB는 건드리지 않음): 덤프를 임시 DB에 복원하고 행 수를 확인한 뒤 지운다.
#   .\scripts\restore_album.ps1 -Dump local\backups\secret_album_20260926_030000.dump -Verify
#
# 실제 복원 (API·Worker를 먼저 멈춘다): 운영 DB 내용을 덤프로 바꾸고, 원본 사진을 되돌린다.
#   .\scripts\restore_album.ps1 -Dump <덤프> -OriginalsFrom F:\album-backup\originals -Apply
#   복원 뒤 파생 이미지: .\.venv\Scripts\python.exe scripts\rebuild_derived.py --missing
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Dump,
    [string]$OriginalsFrom,
    [switch]$Verify,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
if ($Verify -eq $Apply) { throw '-Verify(복원 연습) 또는 -Apply(실제 복원) 중 하나를 지정해 주세요.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot 'local'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$psql = Join-Path $pgBin 'psql.exe'
if (-not (Test-Path -LiteralPath $Dump)) { throw "덤프 파일이 없습니다: $Dump" }
& (Join-Path $PSScriptRoot 'load_album_env.ps1') -Path (Join-Path $localRoot 'album.env')
$conn = @('-h', $env:PGHOST, '-p', $env:PGPORT, '-U', $env:PGUSER)

try {
    if ($Verify) {
        $scratch = 'secret_album_restore_check'
        & $psql @conn -d postgres -q -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" | Out-Null
        & (Join-Path $pgBin 'createdb.exe') @conn $scratch
        & (Join-Path $pgBin 'pg_restore.exe') @conn -d $scratch --no-owner --exit-on-error $Dump
        if ($LASTEXITCODE -ne 0) { throw '복원 연습 실패: pg_restore 오류' }
        $counts = & $psql @conn -d $scratch -tAc "SELECT 'users=' || (SELECT count(*) FROM users) || ' models=' || (SELECT count(*) FROM models) || ' albums=' || (SELECT count(*) FROM albums) || ' photos=' || (SELECT count(*) FROM photos)"
        $live = & $psql @conn -d $env:PGDATABASE -tAc "SELECT 'users=' || (SELECT count(*) FROM users) || ' models=' || (SELECT count(*) FROM models) || ' albums=' || (SELECT count(*) FROM albums) || ' photos=' || (SELECT count(*) FROM photos)"
        & $psql @conn -d postgres -q -c "DROP DATABASE IF EXISTS $scratch WITH (FORCE)" | Out-Null
        Write-Output "복원 연습 성공. 덤프: $($counts.Trim()) / 현재 DB: $($live.Trim())"
        return
    }

    $apiUp = Get-NetTCPConnection -LocalPort $env:ALBUM_API_PORT -State Listen -ErrorAction SilentlyContinue
    if ($apiUp) { throw 'API가 실행 중입니다. stop-album.cmd(운영 서버는 예약 작업 중지 후)로 멈춘 뒤 다시 실행해 주세요.' }
    $safety = Join-Path $localRoot "backups\before_restore_$(Get-Date -Format 'yyyyMMdd_HHmmss').dump"
    & (Join-Path $pgBin 'pg_dump.exe') @conn -d $env:PGDATABASE -Fc -f $safety
    if ($LASTEXITCODE -ne 0) { throw '복원 전 안전 덤프 실패' }
    Write-Output "복원 전 현재 DB를 저장했습니다: $safety"
    & (Join-Path $pgBin 'pg_restore.exe') @conn -d $env:PGDATABASE --clean --if-exists --no-owner --exit-on-error $Dump
    if ($LASTEXITCODE -ne 0) { throw 'DB 복원 실패. 안전 덤프로 되돌릴 수 있습니다.' }
    if ($OriginalsFrom) {
        $mediaRoot = if ($env:ALBUM_MEDIA_ROOT) { $env:ALBUM_MEDIA_ROOT } else { Join-Path $localRoot 'media' }
        robocopy $OriginalsFrom (Join-Path $mediaRoot 'originals') /E /R:2 /W:5 /NFL /NDL /NP /NJH | Out-Null
        if ($LASTEXITCODE -ge 8) { throw "원본 사진 복사 실패(robocopy 종료 코드 $LASTEXITCODE)" }
    }
    Write-Output '복원을 마쳤습니다. 파생 이미지 재생성: .\.venv\Scripts\python.exe scripts\rebuild_derived.py --missing'
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
