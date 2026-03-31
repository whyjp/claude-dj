@echo off
REM Stop any running claude-dj bridge server
REM Usage: scripts\stop-bridge.bat

if "%CLAUDE_DJ_PORT%"=="" set CLAUDE_DJ_PORT=39200

REM Check if bridge is running
curl -s "http://localhost:%CLAUDE_DJ_PORT%/api/health" | findstr /C:"\"status\":\"ok\"" >nul 2>&1
if errorlevel 1 (
    echo [claude-dj] No bridge running on port %CLAUDE_DJ_PORT%
    exit /b 0
)

echo [claude-dj] Bridge found on port %CLAUDE_DJ_PORT%

REM Find and kill the process on the port
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":%CLAUDE_DJ_PORT% " ^| findstr "LISTENING"') do (
    echo [claude-dj] Killing bridge (PID %%a)
    taskkill /PID %%a /F >nul 2>&1
)

echo [claude-dj] Bridge stopped
