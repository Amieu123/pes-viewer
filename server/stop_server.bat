@echo off
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":5000.*LISTENING"') do taskkill /F /PID %%a >nul 2>&1
powershell -command "[System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms') | Out-Null; [System.Windows.Forms.MessageBox]::Show('PES Server stopped!', 'OK', 'OK', 'Information')" >nul
