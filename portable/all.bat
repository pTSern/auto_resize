@echo off
if exist "%~dp0rs.bat" (
    call "%~dp0rs.bat"
) else (
    call rs
)
pause
