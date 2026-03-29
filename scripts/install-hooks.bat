@echo off
REM Install claude-dj hooks into Claude Code global settings
REM Usage: scripts\install-hooks.bat [--project]
REM   Default: global (%%USERPROFILE%%\.claude\settings.json)
REM   --project: project-local (.claude\settings.json)

setlocal

set "PROJECT_DIR=%~dp0.."
pushd "%PROJECT_DIR%"

if not exist node_modules (
    echo [claude-dj] Installing dependencies...
    call npm install
)

if "%~1"=="--project" (
    echo [claude-dj] Installing hooks (project-local^)...
    node -e "import('./tools/setup.js').then(m => m.run({ global: false }))"
) else (
    echo [claude-dj] Installing hooks (global^)...
    node -e "import('./tools/setup.js').then(m => m.run({ global: true }))"
)

echo.
echo [claude-dj] Done! Start a new Claude Code session to activate hooks.
echo [claude-dj] Make sure the bridge is running: scripts\start-bridge.bat

popd
endlocal
