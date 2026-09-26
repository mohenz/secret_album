# DB 덤프 + 원본 사진 백업. 운영 서버에서는 예약 작업으로 매일 실행한다.
#
#   .\scripts\backup_album.ps1                               DB 덤프만 local\backups에
#   .\scripts\backup_album.ps1 -BackupRoot F:\album-backup   DB 덤프 + 원본 사진을 백업 디스크로
#
# 파생 이미지(derived)는 원본에서 다시 만들 수 있어 백업하지 않는다 (scripts\rebuild_derived.py).
[CmdletBinding()]
param(
    [string]$BackupRoot,
    [int]$KeepDays = 30
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$localRoot = Join-Path $projectRoot 'local'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$logFile = Join-Path $localRoot 'backup.log'

function Write-Log([string]$Text) {
    $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Text"
    Add-Content -LiteralPath $logFile -Value $line -Encoding utf8
    Write-Output $line
}

& (Join-Path $PSScriptRoot 'load_album_env.ps1') -Path (Join-Path $localRoot 'album.env')
$dumpDir = Join-Path $localRoot 'backups'
New-Item -ItemType Directory -Force $dumpDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd_HHmmss'
$dump = Join-Path $dumpDir "secret_album_$stamp.dump"

try {
    & (Join-Path $pgBin 'pg_dump.exe') -h $env:PGHOST -p $env:PGPORT -U $env:PGUSER -d $env:PGDATABASE -Fc -f $dump
    if ($LASTEXITCODE -ne 0) { throw "pg_dump 실패(종료 코드 $LASTEXITCODE)" }
    & (Join-Path $pgBin 'pg_restore.exe') --list $dump | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '덤프 파일 검증 실패' }
    Write-Log "DB 덤프 완료: $dump ($([math]::Round((Get-Item $dump).Length / 1MB, 1))MB)"

    if ($BackupRoot) {
        $dbTarget = Join-Path $BackupRoot 'db'
        $mediaTarget = Join-Path $BackupRoot 'originals'
        New-Item -ItemType Directory -Force $dbTarget, $mediaTarget | Out-Null
        Copy-Item -LiteralPath $dump -Destination $dbTarget
        $mediaRoot = if ($env:ALBUM_MEDIA_ROOT) { $env:ALBUM_MEDIA_ROOT } else { Join-Path $localRoot 'media' }
        $originals = Join-Path $mediaRoot 'originals'
        if (Test-Path -LiteralPath $originals) {
            # /MIR: 영구 삭제된 사진은 백업에서도 지운다. /R:2 /W:5 재시도, 목록 출력 생략.
            robocopy $originals $mediaTarget /MIR /R:2 /W:5 /NFL /NDL /NP /NJH | Out-Null
            if ($LASTEXITCODE -ge 8) { throw "원본 사진 복사 실패(robocopy 종료 코드 $LASTEXITCODE)" }
        }
        Get-ChildItem -LiteralPath $dbTarget -Filter 'secret_album_*.dump' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) | Remove-Item -Force
        Write-Log "백업 디스크 복사 완료: $BackupRoot"
    }
    Get-ChildItem -LiteralPath $dumpDir -Filter 'secret_album_*.dump' | Where-Object LastWriteTime -lt (Get-Date).AddDays(-$KeepDays) | Remove-Item -Force
} catch {
    Write-Log "백업 실패: $($_.Exception.Message)"
    exit 1
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
