@echo off
cd /d "%~dp0"
where bun >nul 2>&1
if errorlevel 1 (
  echo Install Bun 1.3 or newer from https://bun.sh first.
  pause
  exit /b 1
)
call bun install --frozen-lockfile
if errorlevel 1 goto failed
call bun run live:start
if errorlevel 1 goto failed
exit /b 0
:failed
echo Startup failed. See the error above.
pause
exit /b 1
