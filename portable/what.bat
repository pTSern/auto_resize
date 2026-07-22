@echo off
set /p targetPath="Nhap duong dan file hoac thu muc: "
if exist "%~dp0rs.bat" (
    call "%~dp0rs.bat" "%targetPath%"
) else (
    call rs "%targetPath%"
)
pause
