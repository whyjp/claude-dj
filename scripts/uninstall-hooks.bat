@echo off
REM Remove claude-dj hooks from Claude Code settings
REM Usage: scripts\uninstall-hooks.bat [--project]
REM   Default: global (%%USERPROFILE%%\.claude\settings.json)
REM   --project: project-local (.claude\settings.json)

setlocal

set "PROJECT_DIR=%~dp0.."
pushd "%PROJECT_DIR%"

if "%~1"=="--project" (
    echo [claude-dj] Removing hooks (project-local^)...
    node -e "import('./tools/setup.js').then(m => m.uninstall({ global: false }))"
) else (
    echo [claude-dj] Removing hooks (global^)...
    node -e "import('./tools/setup.js').then(m => m.uninstall({ global: true }))"
)

echo.
echo [claude-dj] Restart Claude Code sessions to apply changes.

popd
endlocal
