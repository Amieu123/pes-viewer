@echo off
cd /d "%~dp0"

echo ========================================
echo   PES Viewer - Auto Update from Git
echo ========================================
echo.

REM Check if git is installed
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed!
    echo Please install Git from: https://git-scm.com/
    pause
    exit /b 1
)

REM Check if this is a git repo
if not exist ".git" (
    echo [INFO] Initializing git repository...
    git init
    git remote add origin https://github.com/Amieu123/pes-viewer.git
    echo.
    git pull origin main
    echo.
    echo [OK] Repository initialized!
    pause
    exit /b 0
)

echo [INFO] Fetching updates...
git fetch origin

REM Check if there are updates
for /f %%i in ('git rev-parse HEAD') do set LOCAL=%%i
for /f %%i in ('git rev-parse origin/main 2^>nul') do set REMOTE=%%i

if "%LOCAL%"=="%REMOTE%" (
    echo.
    echo [OK] Already up to date!
) else (
    echo.
    echo [INFO] New updates found! Updating...

    REM Stash local changes
    git stash

    REM Pull latest
    git pull origin main

    echo.
    echo [OK] Update completed!
    echo Please reload the extension in Chrome.
)

echo.
pause
