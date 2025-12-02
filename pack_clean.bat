@echo off
cd /d "%~dp0"

REM Create clean export folder
set EXPORT=..\Feline_Extention_Portable
if exist "%EXPORT%" rmdir /s /q "%EXPORT%"
mkdir "%EXPORT%"

echo Copying files...

REM Copy essential folders
xcopy /E /I /Q "extension" "%EXPORT%\extension"
xcopy /E /I /Q "server" "%EXPORT%\server"
xcopy /E /I /Q "python" "%EXPORT%\python"

echo.
echo ============================================
echo Exported to: Feline_Extention_Portable
echo ============================================
echo.
echo Folder contains:
echo   - extension/  (Chrome extension)
echo   - server/     (Python server)
echo   - python/     (Portable Python + libraries)
echo.
echo To use on new machine:
echo   1. Copy folder to new machine
echo   2. Run server\start_server.bat
echo   3. Load extension in Chrome
echo.
explorer "%EXPORT%"
pause
