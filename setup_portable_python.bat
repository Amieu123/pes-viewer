@echo off
echo ============================================
echo Setup Portable Python for PES Viewer
echo ============================================
echo.

cd /d "%~dp0"

REM Download Python embeddable
echo Downloading Python 3.11 embeddable...
curl -L -o python.zip "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"

echo Extracting...
powershell -command "Expand-Archive -Force python.zip python"
del python.zip

REM Enable pip by editing python311._pth
echo Enabling pip...
echo python311.zip>> python\python311._pth
echo .>> python\python311._pth
echo import site>> python\python311._pth

REM Download get-pip.py
echo Downloading pip...
curl -L -o python\get-pip.py "https://bootstrap.pypa.io/get-pip.py"

REM Install pip
echo Installing pip...
python\python.exe python\get-pip.py --no-warn-script-location
del python\get-pip.py

REM Install dependencies
echo Installing dependencies...
python\python.exe -m pip install flask flask-cors pyembroidery --no-warn-script-location

echo.
echo ============================================
echo Setup complete!
echo ============================================
pause
