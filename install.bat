@echo off
setlocal
echo ====================================================
echo Launching Auto-Resize Installer...
echo ====================================================
if exist "%~dp0install.ps1" (
    powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
) else (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; irm https://raw.githubusercontent.com/pTSern/auto_resize/master/install.ps1 | iex"
)
if errorlevel 1 (
    echo.
    echo Installer exited with error code %errorlevel%.
    pause
)
endlocal
