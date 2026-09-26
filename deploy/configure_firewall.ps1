# 운영 서버에서 관리자 PowerShell로 한 번 실행한다.
# 화면(8090)과 API(3051)를 내부망에서만 받는다. DB(54328)는 127.0.0.1에만 열려 있어 규칙이 필요 없다.
#
#   .\deploy\configure_firewall.ps1                         같은 서브넷(LocalSubnet)만 허용
#   .\deploy\configure_firewall.ps1 -RemoteAddress 192.168.0.0/24
#   .\deploy\configure_firewall.ps1 -Remove
[CmdletBinding()]
param(
    [string]$RemoteAddress = 'LocalSubnet',
    [int]$WebPort = 8090,
    [int]$ApiPort = 3051,
    [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw '관리자 PowerShell에서 실행해 주세요.' }
$rules = @(
    @{ Name = 'SecretAlbum-Web'; Port = $WebPort },
    @{ Name = 'SecretAlbum-API'; Port = $ApiPort }
)
foreach ($rule in $rules) {
    Remove-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    if (-not $Remove) {
        New-NetFirewallRule -DisplayName $rule.Name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $rule.Port `
            -RemoteAddress $RemoteAddress -Profile Private, Domain | Out-Null
        Write-Output "허용: TCP $($rule.Port) ← $RemoteAddress ($($rule.Name))"
    }
}
if ($Remove) { Write-Output '비밀앨범 방화벽 규칙을 지웠습니다.' }
