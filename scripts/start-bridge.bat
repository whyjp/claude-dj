@echo off
REM Start the claude-dj bridge server
REM Usage: scripts\start-bridge.bat [--debug] [port]
REM   --debug  enables file logging to logs\bridge.log
REM   port     defaults to 39200

setlocal

set "PROJECT_DIR=%~dp0.."
pushd "%PROJECT_DIR%"

REM Parse args
:parse_args
if "%~1"=="--debug" (
    set "CLAUDE_DJ_DEBUG=1"
    shift
    goto :parse_args
)
if not "%~1"=="" set "CLAUDE_DJ_PORT=%~1"
if not defined CLAUDE_DJ_PORT set "CLAUDE_DJ_PORT=39200"

if not exist node_modules (
    echo [claude-dj] Installing dependencies...
    call npm install
)

echo [claude-dj] Starting bridge server on http://localhost:%CLAUDE_DJ_PORT%
echo [claude-dj] Virtual DJ UI: http://localhost:%CLAUDE_DJ_PORT%
if defined CLAUDE_DJ_DEBUG (
    echo [claude-dj] Debug mode: logging to logs\bridge.log
)
echo [claude-dj] Press Ctrl+C to stop
echo.

node bridge\server.js

popd
endlocal
