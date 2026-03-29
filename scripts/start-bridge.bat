@echo off
REM Start the claude-dj bridge server
REM Usage: scripts\start-bridge.bat [port]
REM   port defaults to 39200

setlocal

set "PROJECT_DIR=%~dp0.."
pushd "%PROJECT_DIR%"

if not "%~1"=="" set "CLAUDE_DJ_PORT=%~1"
if not defined CLAUDE_DJ_PORT set "CLAUDE_DJ_PORT=39200"

if not exist node_modules (
    echo [claude-dj] Installing dependencies...
    call npm install
)

echo [claude-dj] Starting bridge server on http://localhost:%CLAUDE_DJ_PORT%
echo [claude-dj] Virtual DJ UI: http://localhost:%CLAUDE_DJ_PORT%
echo [claude-dj] Press Ctrl+C to stop
echo.

node bridge\server.js

popd
endlocal
