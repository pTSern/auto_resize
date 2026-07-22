# install.ps1 - Automated Installer for auto_resize CLI tool
$ErrorActionPreference = "Stop"

# 1. Self-Elevate to Administrator if not already running as Admin
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "This installation requires Administrator rights to install Node.js and register global CLI commands." -ForegroundColor Yellow
    Write-Host "Requesting elevation..." -ForegroundColor Yellow
    
    # Resolve script path. If run via iex, we download the script to a temp file first.
    $scriptPath = $PSCommandPath
    if (-not $scriptPath) {
        $scriptPath = Join-Path $env:TEMP "install_auto_resize.ps1"
        Write-Host "Downloading installer to temporary file: $scriptPath" -ForegroundColor Gray
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/pTSern/auto_resize/master/install.ps1" -OutFile $scriptPath
    }
    
    # Pass arguments as a structured array to robustly handle spaces in paths (e.g. "Wild Boar PC")
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $scriptPath -Verb RunAs
    Exit
}

# Wrap the installation process in a try/catch to display errors and keep the window open if something fails
try {
    Write-Host "====================================================" -ForegroundColor Cyan
    Write-Host " Starting Auto-Resize CLI Installation" -ForegroundColor Cyan
    Write-Host "====================================================" -ForegroundColor Cyan

    # 2. Check Node.js and install if missing
    $nodeInstalled = $false
    try {
        $nodeVersion = node -v 2>$null
        if ($nodeVersion) {
            Write-Host "Found Node.js installed ($nodeVersion)" -ForegroundColor Green
            $nodeInstalled = $true
        }
    } catch {}

    if (-not $nodeInstalled) {
        Write-Host "Node.js was not found. Downloading and installing Node.js v20 silently..." -ForegroundColor Yellow
        $msiPath = Join-Path $env:TEMP "node-v20-x64.msi"
        
        # Download official Node.js installer
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi" -OutFile $msiPath
        
        # Run MSI silently with structured arguments to handle spaces in Temp path
        Write-Host "Installing Node.js... Please wait..." -ForegroundColor Yellow
        $process = Start-Process msiexec.exe -ArgumentList "/i", $msiPath, "/qn", "/norestart" -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw New-Object System.Exception("Node.js installation failed with exit code $($process.ExitCode)")
        }
        Write-Host "Node.js installed successfully!" -ForegroundColor Green
        
        # Clean up MSI
        if (Test-Path $msiPath) {
            Remove-Item $msiPath -Force
        }
        
        # Refresh Path environment variable in this process
        Write-Host "Refreshing Environment Paths..." -ForegroundColor Gray
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
    }

    # 3. Create the global configuration file with 1:1, 9:16, 16:9 defaults
    $configPath = Join-Path $env:USERPROFILE ".auto_resize_config.json"
    $configJson = @"
{
  "dimensions": [
    { "w": 1, "h": 1 },
    { "w": 16, "h": 9 }
  ]
}
"@

    Write-Host "Generating global configuration at $configPath..." -ForegroundColor Cyan
    [System.IO.File]::WriteAllText($configPath, $configJson)
    Write-Host "Global configuration created!" -ForegroundColor Green

    # 4. Clone or Download Repository from GitHub
    $tempDir = Join-Path $env:TEMP "auto_resize_source"
    if (Test-Path $tempDir) {
        Remove-Item $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
    New-Item -ItemType Directory -Path $tempDir | Out-Null

    $gitAvailable = $false
    try {
        $gitVersion = git --version 2>$null
        if ($gitVersion) {
            $gitAvailable = $true
        }
    } catch {}

    if ($gitAvailable) {
        Write-Host "Git detected. Cloning repository..." -ForegroundColor Cyan
        git clone https://github.com/pTSern/auto_resize.git "$tempDir"
    } else {
        Write-Host "Git not found. Downloading ZIP archive from GitHub..." -ForegroundColor Cyan
        $zipPath = Join-Path $env:TEMP "auto_resize.zip"
        
        # Download the master branch archive. If it fails, try main branch.
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "https://github.com/pTSern/auto_resize/archive/refs/heads/master.zip" -OutFile $zipPath
        } catch {
            Write-Host "Master branch not found, trying main branch ZIP..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri "https://github.com/pTSern/auto_resize/archive/refs/heads/main.zip" -OutFile $zipPath
        }
        
        Write-Host "Extracting ZIP package..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
        Remove-Item $zipPath -Force
        
        # ZIP extraction creates a subfolder (e.g., auto_resize-master). Find it.
        $extractedFolder = Get-ChildItem -Path $tempDir -Directory | Select-Object -First 1
        if ($extractedFolder) {
            $tempDir = $extractedFolder.FullName
        }
    }

    # 5. Build and Install globally
    Write-Host "Installing dependencies and building the project..." -ForegroundColor Cyan
    cd "$tempDir"

    # Ensure npm command is resolved in the refreshed path
    $npmCmd = "npm"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        # If path hasn't refreshed in memory properly, look in typical installation path
        $npmPath = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
        if (Test-Path $npmPath) {
            $npmCmd = $npmPath
        }
    }

    Write-Host "Running npm install..." -ForegroundColor Gray
    & $npmCmd install
    Write-Host "Running npm build..." -ForegroundColor Gray
    & $npmCmd run build
    Write-Host "Installing command globally..." -ForegroundColor Gray
    & $npmCmd install -g .

    Write-Host "====================================================" -ForegroundColor Green
    Write-Host " SUCCESS: Installation complete!" -ForegroundColor Green
    Write-Host " Use it anywhere in your terminal:" -ForegroundColor Green
    Write-Host "   auto_resize <video_path> (Or 'rs')" -ForegroundColor Yellow
    Write-Host "   srs (To open the File browser popup dialog)" -ForegroundColor Yellow
    Write-Host "   rss (To manage custom target dimensions)" -ForegroundColor Yellow
    Write-Host "====================================================" -ForegroundColor Green

} catch {
    Write-Host "`n[FATAL ERROR] Installation failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Host "`nPress any key to close..." -ForegroundColor Gray
[void]$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
