@echo off
echo ====================================================
echo Building Standalone Portable Package for Windows
echo ====================================================

rem Ensure we are in the script's directory
cd /d "%~dp0"

rem 1. Compile TypeScript source code
echo [1/5] Compiling TypeScript source files...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [ERROR] TypeScript compilation failed!
    pause
    exit /b 1
)

rem 2. Create portable folder structure
echo [2/5] Creating portable/ directory...
if not exist "portable" mkdir "portable"

rem 3. Download standalone Node.js executable if it does not exist yet
if not exist "portable\node.exe" (
    echo [3/5] Downloading standalone Node.js executable v20...
    powershell -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.11.0/win-x64/node.exe' -OutFile 'portable\node.exe'"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to download standalone node.exe!
        pause
        exit /b 1
    )
) else (
    echo [3/5] Standalone Node.js binary already exists in portable/, skipping download.
)

rem 4. Copy required files and dependencies
echo [4/5] Copying build files and dependencies...
if exist "portable\dist" rd /s /q "portable\dist"
xcopy "dist" "portable\dist" /E /I /Y >nul

copy "package.json" "portable\" >nul
copy "all.bat" "portable\" >nul
copy "what.bat" "portable\" >nul

rem Copy node_modules using robocopy for fast, clean file operations on Windows
echo Copying node_modules dependencies including FFmpeg and FFprobe binaries...
if exist "portable\node_modules" rd /s /q "portable\node_modules"
robocopy "node_modules" "portable\node_modules" /E /XD .bin /NFL /NDL /NJH /NJS /nc /ns /np >nul

rem 5. Create launcher batch file
echo [5/5] Creating auto_resize.bat and rs.bat launchers...
(
echo @echo off
echo "%%~dp0node.exe" "%%~dp0dist/cli.js" %%*
) > "portable\auto_resize.bat"

(
echo @echo off
echo "%%~dp0node.exe" "%%~dp0dist/cli.js" %%*
) > "portable\rs.bat"

echo ====================================================
echo SUCCESS: Portable package created in "portable/" folder!
echo.
echo Zip the "portable" folder and share it with your users.
echo.
echo To run it, they just execute:
echo   auto_resize.bat ^<video_path^>
echo ====================================================
pause
