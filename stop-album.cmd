@echo off
for %%P in (3051 8090) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr ":%%P .*LISTENING"') do taskkill /PID %%A /F >nul 2>nul
)
for /f "tokens=2" %%A in ('tasklist /FI "WINDOWTITLE eq SecretAlbum Worker" /FO LIST ^| findstr "PID:"') do taskkill /PID %%A /F >nul 2>nul
PowerShell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop_local_db.ps1"
echo 비밀앨범 프로세스를 종료했습니다.
