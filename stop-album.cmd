@echo off
for %%P in (3051 8090) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P .*LISTENING"') do taskkill /PID %%A /F >nul 2>nul
)
rem Worker는 포트가 없고 숨김 창으로 실행되므로, 이 프로젝트의 local_worker.py 명령줄로 찾아 종료한다.
PowerShell.exe -NoProfile -Command "$root = '%~dp0'.TrimEnd('\'); Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'python*' -and $_.CommandLine -like '*local_worker.py*' -and $_.CommandLine -like ('*' + $root + '*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_local_db.ps1"
echo 비밀앨범 프로세스를 종료했습니다.
schtasks /Query /TN "SecretAlbum-Supervisor" >nul 2>nul && echo 주의: 감시 예약 작업이 1분 안에 다시 시작합니다. 유지보수 중에는 schtasks /Change /TN "SecretAlbum-Supervisor" /DISABLE 로 먼저 끄세요.
