# 운영 서버에서 관리자 PowerShell로 한 번 실행한다.
# 부팅 시 + 1분마다 supervisor.ps1을 실행하는 "SecretAlbum-Supervisor" 예약 작업을 만든다.
#
#   .\scripts\register_supervisor.ps1 -User "SERVER\albumsvc"   (서비스 전용 계정 권장, 암호를 묻는다)
#   .\scripts\register_supervisor.ps1 -Remove
[CmdletBinding()]
param(
    [string]$User = "$env:USERDOMAIN\$env:USERNAME",
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$taskName = 'SecretAlbum-Supervisor'
if ($Remove) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output "예약 작업을 지웠습니다: $taskName"
    return
}
$script = Join-Path $PSScriptRoot 'supervisor.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`"" -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$startup = New-ScheduledTaskTrigger -AtStartup
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
$credential = Get-Credential -UserName $User -Message '예약 작업을 실행할 계정의 암호를 입력해 주세요.'
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($startup, $repeat) -Settings $settings `
    -User $credential.UserName -Password $credential.GetNetworkCredential().Password -RunLevel Limited -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output "예약 작업을 등록하고 시작했습니다: $taskName (로그: local\supervisor.log)"
