@echo off
cd /d "%~dp0"
cd ..

REM Delete old zip
if exist "Feline_Extention.zip" del "Feline_Extention.zip"

REM Create zip excluding problematic files
powershell -Command "$source = 'Feline Extention'; $files = Get-ChildItem $source -Recurse | Where-Object { $_.Name -ne 'nul' -and $_.FullName -notmatch '__pycache__' }; Compress-Archive -Path $files.FullName -DestinationPath 'Feline_Extention.zip' -Force"

if exist "Feline_Extention.zip" (
    echo.
    echo Created: Feline_Extention.zip
    explorer /select,"Feline_Extention.zip"
) else (
    echo Failed to create zip
)
pause
