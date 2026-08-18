@echo off
setlocal
set "ROOT=%~dp0"
set "VSDEV=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"
if exist "%VSDEV%" goto vsdev_found
echo Visual Studio Build Tools bulunamadi.
exit /b 1
:vsdev_found
call "%VSDEV%" -arch=x64 >nul
if not errorlevel 1 goto vsdev_ready
echo VS gelistirme ortami yuklenemedi.
exit /b 1
:vsdev_ready
set "PATH=C:\Program Files\nodejs;%USERPROFILE%\.cargo\bin;%PATH%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%ROOT%release-windows-native.ps1" -Finalize -RunDefenderScan
exit /b %errorlevel%
