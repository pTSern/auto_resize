@echo off
echo ====================================================
echo Launching Auto-Resize Installer...
echo ====================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/pTSern/auto_resize/master/install.ps1 | iex"
