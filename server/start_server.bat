@echo off
cd /d "%~dp0"

REM Detect portable Python
if exist "..\python\pythonw.exe" (
    set PYTHON=%~dp0..\python\pythonw.exe
) else (
    REM Full path to system python
    set PYTHON="C:\Program Files\Python39\pythonw.exe"
)

REM Test python silently
"%PYTHON%" -c "import flask, pyembroidery, PIL" >nul 2>&1
if errorlevel 1 (
    echo [%date% %time%] Python or dependencies not found! >> start_log.txt
    exit /b 1
)

start "" "%PYTHON%" "%~dp0pes_server.py"

REM Delay for startup
ping -n 3 127.0.0.1 >nul

echo [%date% %time%] PES Server started successfully. >> start_log.txt
exit /b 0
