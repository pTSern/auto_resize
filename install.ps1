# install.ps1 - Automated Installer for auto_resize CLI tool
$ErrorActionPreference = "Stop"

function Refresh-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $parts = @($machinePath, $userPath) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    $env:Path = ($parts -join ";")
}

function Ensure-DirectoryInPath {
    param(
        [Parameter(Mandatory = $true)][string]$Directory,
        [ValidateSet("Machine", "User")][string]$Scope = "User"
    )
    if (-not (Test-Path $Directory)) { return }

    $normalizedTarget = $Directory.TrimEnd('\')

    # Ensure present in current session PATH
    $sessionEntries = @($env:Path -split ';' | Where-Object { $_ } | ForEach-Object { $_.Trim().TrimEnd('\') })
    if ($sessionEntries -notcontains $normalizedTarget) {
        $env:Path = "$env:Path;$Directory"
    }

    # Ensure present in persistent PATH
    try {
        $existing = [System.Environment]::GetEnvironmentVariable("Path", $Scope)
        $entries = @($existing -split ';' | Where-Object { $_ } | ForEach-Object { $_.Trim().TrimEnd('\') })
        if ($entries -notcontains $normalizedTarget) {
            $newPath = if ([string]::IsNullOrWhiteSpace($existing)) { $Directory } else { "$($existing.TrimEnd(';'));$Directory" }
            [System.Environment]::SetEnvironmentVariable("Path", $newPath, $Scope)
        }
    } catch {
        Write-Host "Warning: Could not persist '$Directory' to $Scope PATH: $($_.Exception.Message)" -ForegroundColor Yellow
    }
}

function Test-GitAvailable {
    param([bool]$IsAdmin = $false)

    $gitCmd = Get-Command git -ErrorAction SilentlyContinue
    if (-not $gitCmd) {
        $candidateDirs = @()
        if ($env:ProgramFiles) { $candidateDirs += (Join-Path $env:ProgramFiles "Git\cmd") }
        if (${env:ProgramFiles(x86)}) { $candidateDirs += (Join-Path ${env:ProgramFiles(x86)} "Git\cmd") }
        if ($env:LOCALAPPDATA) { $candidateDirs += (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd") }
        foreach ($dir in $candidateDirs) {
            if ($dir -and (Test-Path (Join-Path $dir "git.exe"))) {
                $inProgramFiles = ($env:ProgramFiles -and $dir -like "$env:ProgramFiles*") -or (${env:ProgramFiles(x86)} -and $dir -like "${env:ProgramFiles(x86)}*")
                $scope = if ($IsAdmin -and $inProgramFiles) { "Machine" } else { "User" }
                Ensure-DirectoryInPath -Directory $dir -Scope $scope
                $gitCmd = Get-Command git -ErrorAction SilentlyContinue
                if ($gitCmd) { break }
            }
        }
    }

    if (-not $gitCmd) { return $false }

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $gitOutput = @(& git --version 2>$null)
        $gitExit = $LASTEXITCODE
        $gitVersion = $gitOutput | Where-Object { -not [string]::IsNullOrWhiteSpace("$_") } | Select-Object -First 1
        return ($gitExit -eq 0 -and -not [string]::IsNullOrWhiteSpace("$gitVersion"))
    } catch {
        return $false
    } finally {
        $ErrorActionPreference = $prevEap
    }
}

function Get-GlobalNpmPrefix {
    param([string]$NpmCommand = "npm")

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        $prefixOut = @(& $NpmCommand prefix -g 2>$null)
        $prefixExit = $LASTEXITCODE
        $rawPrefix = $prefixOut | Where-Object { -not [string]::IsNullOrWhiteSpace("$_") } | Select-Object -First 1
        if ($prefixExit -eq 0 -and -not [string]::IsNullOrWhiteSpace("$rawPrefix")) {
            return "$rawPrefix".Trim()
        }

        $configOut = @(& $NpmCommand config get prefix 2>$null)
        $configExit = $LASTEXITCODE
        $rawPrefix = $configOut | Where-Object { -not [string]::IsNullOrWhiteSpace("$_") } | Select-Object -First 1
        if ($configExit -eq 0 -and -not [string]::IsNullOrWhiteSpace("$rawPrefix")) {
            return "$rawPrefix".Trim()
        }
    } catch {} finally {
        $ErrorActionPreference = $prevEap
    }
    return $null
}

function Remove-DirectoryForce {
    param([Parameter(Mandatory = $true)][string]$Path)
    if (-not (Test-Path $Path)) { return }
    try {
        Get-ChildItem -Path $Path -Recurse -Force -ErrorAction SilentlyContinue | ForEach-Object {
            try { $_.Attributes = 'Normal' } catch {}
        }
        Remove-Item -Path $Path -Recurse -Force -ErrorAction SilentlyContinue
    } catch {}
    if (Test-Path $Path) {
        cmd /c "rmdir /s /q `"$Path`"" 2>$null
    }
}

function Install-GitGlobally {
    param([bool]$IsAdmin = $false)

    Write-Host "Git was not found. Attempting to install Git as a global command..." -ForegroundColor Yellow

    # Method 1: Install via winget if available
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        try {
            Write-Host "Installing Git via winget..." -ForegroundColor Yellow
            $wingetScope = if ($IsAdmin) { "machine" } else { "user" }
            $wingetArgs = @(
                "install", "--id", "Git.Git", "-e", "--source", "winget",
                "--scope", $wingetScope, "--silent",
                "--accept-package-agreements", "--accept-source-agreements"
            )
            $wingetProc = Start-Process winget -ArgumentList $wingetArgs -Wait -PassThru -NoNewWindow
            if ($wingetProc.ExitCode -eq 0) {
                Refresh-SessionPath
                if (Test-GitAvailable -IsAdmin $IsAdmin) {
                    return $true
                }
            } else {
                Write-Host "winget Git install exited with code $($wingetProc.ExitCode). Trying direct official installer..." -ForegroundColor Yellow
            }
        } catch {
            Write-Host "winget Git install failed: $($_.Exception.Message). Trying direct official installer..." -ForegroundColor Yellow
        }
    }

    # Method 2: Download and silently install official Git for Windows (64-bit)
    $gitInstallerPath = Join-Path $env:TEMP "Git-64-bit-installer.exe"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $gitDownloadUrl = "https://github.com/git-for-windows/git/releases/download/v2.56.1.windows.1/Git-2.56.1-64-bit.exe"
        try {
            $release = Invoke-RestMethod -Uri "https://api.github.com/repos/git-for-windows/git/releases/latest" -Headers @{ "User-Agent" = "auto-resize-installer" } -TimeoutSec 15
            $asset = $release.assets | Where-Object { $_.name -match '^Git-.*-64-bit\.exe$' } | Select-Object -First 1
            if ($asset -and $asset.browser_download_url) {
                $gitDownloadUrl = $asset.browser_download_url
            }
        } catch {
            Write-Host "Could not query latest Git release API; using pinned official Git installer..." -ForegroundColor Gray
        }

        Write-Host "Downloading official Git for Windows installer..." -ForegroundColor Yellow
        Invoke-WebRequest -Uri $gitDownloadUrl -OutFile $gitInstallerPath -UseBasicParsing

        Write-Host "Installing Git silently... Please wait..." -ForegroundColor Yellow
        $gitArgs = @(
            "/VERYSILENT", "/NORESTART", "/NOCANCEL", "/SP-",
            "/CLOSEAPPLICATIONS", "/RESTARTAPPLICATIONS", "/o:PathOption=Cmd"
        )
        $gitProc = Start-Process -FilePath $gitInstallerPath -ArgumentList $gitArgs -Wait -PassThru
        if ($gitProc.ExitCode -eq 0) {
            Refresh-SessionPath
            if (Test-GitAvailable -IsAdmin $IsAdmin) {
                return $true
            }
        } else {
            Write-Host "Official Git installer exited with code $($gitProc.ExitCode)." -ForegroundColor Yellow
        }
    } catch {
        Write-Host "Direct Git installation failed: $($_.Exception.Message)" -ForegroundColor Yellow
    } finally {
        if (Test-Path $gitInstallerPath) {
            Remove-Item $gitInstallerPath -Force -ErrorAction SilentlyContinue
        }
    }

    return $false
}

# 1. Elevate to Administrator only when the work actually needs it:
#    installing Node.js, installing Git globally, or writing into a global npm prefix the user cannot write to.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$nodeInstalled = [bool](Get-Command node -ErrorAction SilentlyContinue)
$gitInstalled = Test-GitAvailable -IsAdmin $isAdmin

$npmPrefix = if ($nodeInstalled) { Get-GlobalNpmPrefix -NpmCommand "npm" } else { $null }
$prefixWritable = $false
if ($npmPrefix -and (Test-Path $npmPrefix)) {
    $probePath = Join-Path $npmPrefix ".auto_resize_write_test"
    try {
        [System.IO.File]::WriteAllText($probePath, "")
        Remove-Item $probePath -Force
        $prefixWritable = $true
    } catch {}
}

$needsElevation = (-not $isAdmin) -and ((-not $nodeInstalled) -or (-not $gitInstalled) -or (-not $prefixWritable))
if ($needsElevation) {
    Write-Host "This installation needs Administrator rights (Node.js/Git install or protected npm prefix)." -ForegroundColor Yellow
    Write-Host "Requesting elevation..." -ForegroundColor Yellow
    
    # Resolve script path. If run via iex, we download the script to a temp file first.
    $scriptPath = $PSCommandPath
    if (-not $scriptPath) {
        $scriptPath = Join-Path $env:TEMP "install_auto_resize.ps1"
        Write-Host "Downloading installer to temporary file: $scriptPath" -ForegroundColor Gray
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://raw.githubusercontent.com/pTSern/auto_resize/master/install.ps1" -OutFile $scriptPath -UseBasicParsing
    }
    
    # Quote $scriptPath explicitly so spaces in paths (e.g. "Wild Boar PC") are preserved in Windows PowerShell 5.1
    Start-Process powershell -ArgumentList "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"" -Verb RunAs
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
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        $nodeVersion = node -v 2>$null
        $nodeExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap
        if ($nodeExit -eq 0 -and $nodeVersion) {
            Write-Host "Found Node.js installed ($nodeVersion)" -ForegroundColor Green
            $nodeInstalled = $true
        }
    } catch {
        $ErrorActionPreference = "Stop"
    }

    if (-not $nodeInstalled) {
        Write-Host "Node.js was not found. Downloading and installing Node.js v20 silently..." -ForegroundColor Yellow
        $msiPath = Join-Path $env:TEMP "node-v20-x64.msi"
        
        # Download official Node.js installer
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://nodejs.org/dist/v20.11.0/node-v20.11.0-x64.msi" -OutFile $msiPath -UseBasicParsing
        
        # Run MSI silently with quoted path to handle spaces in Temp path
        Write-Host "Installing Node.js... Please wait..." -ForegroundColor Yellow
        $process = Start-Process msiexec.exe -ArgumentList "/i", "`"$msiPath`"", "/qn", "/norestart" -Wait -PassThru
        if ($process.ExitCode -ne 0) {
            throw New-Object System.Exception("Node.js installation failed with exit code $($process.ExitCode)")
        }
        Write-Host "Node.js installed successfully!" -ForegroundColor Green
        
        # Clean up MSI
        if (Test-Path $msiPath) {
            Remove-Item $msiPath -Force -ErrorAction SilentlyContinue
        }
        
        # Refresh Path environment variable in this process
        Write-Host "Refreshing Environment Paths..." -ForegroundColor Gray
        Refresh-SessionPath
        $defaultNodeDir = Join-Path $env:ProgramFiles "nodejs"
        if (Test-Path $defaultNodeDir) {
            $nodePathScope = if ($isAdmin) { "Machine" } else { "User" }
            Ensure-DirectoryInPath -Directory $defaultNodeDir -Scope $nodePathScope
        }
    }

    # 3. Create the global configuration file with defaults on first install only.
    #    An update MUST keep the user's dimensions, replacer, blur and exposure settings.
    $configPath = Join-Path $env:USERPROFILE ".auto_resize_config.json"
    if (Test-Path $configPath) {
        Write-Host "Keeping existing configuration at $configPath" -ForegroundColor Gray
    } else {
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
    }

    # 4. Check Git (install globally if missing) and fetch repository from GitHub (ZIP fallback if Git fails)
    $tempDir = Join-Path $env:TEMP "auto_resize_source"
    Remove-DirectoryForce -Path $tempDir
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

    $gitAvailable = Test-GitAvailable -IsAdmin $isAdmin
    if ($gitAvailable) {
        $gitVer = (@(& git --version 2>$null) | Select-Object -First 1)
        Write-Host "Found Git installed ($gitVer)" -ForegroundColor Green
    } else {
        $gitAvailable = Install-GitGlobally -IsAdmin $isAdmin
        if ($gitAvailable) {
            $gitVer = (@(& git --version 2>$null) | Select-Object -First 1)
            Write-Host "Git installed globally! ($gitVer)" -ForegroundColor Green
        } else {
            Write-Host "Warning: Global Git installation failed. Falling back to GitHub ZIP download..." -ForegroundColor Yellow
        }
    }

    $sourceReady = $false
    if ($gitAvailable) {
        Write-Host "Cloning repository via Git..." -ForegroundColor Cyan
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        & git clone https://github.com/pTSern/auto_resize.git "$tempDir"
        $cloneExit = $LASTEXITCODE
        $ErrorActionPreference = $prevEap

        if ($cloneExit -eq 0 -and (Test-Path (Join-Path $tempDir "package.json"))) {
            $sourceReady = $true
        } else {
            Write-Host "Warning: git clone failed (exit code $cloneExit). Falling back to ZIP download..." -ForegroundColor Yellow
            Remove-DirectoryForce -Path $tempDir
            New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
        }
    }

    if (-not $sourceReady) {
        Write-Host "Downloading ZIP archive from GitHub..." -ForegroundColor Cyan
        $zipPath = Join-Path $env:TEMP "auto_resize.zip"
        if (Test-Path $zipPath) {
            Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        }
        
        # Download the master branch archive. If it fails, try main branch.
        try {
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            Invoke-WebRequest -Uri "https://github.com/pTSern/auto_resize/archive/refs/heads/master.zip" -OutFile $zipPath -UseBasicParsing
        } catch {
            Write-Host "Master branch not found, trying main branch ZIP..." -ForegroundColor Yellow
            Invoke-WebRequest -Uri "https://github.com/pTSern/auto_resize/archive/refs/heads/main.zip" -OutFile $zipPath -UseBasicParsing
        }
        
        Write-Host "Extracting ZIP package..." -ForegroundColor Cyan
        Expand-Archive -Path $zipPath -DestinationPath $tempDir -Force
        Remove-Item $zipPath -Force -ErrorAction SilentlyContinue
        
        # ZIP extraction creates a subfolder (e.g., auto_resize-master). Find it.
        $extractedFolder = Get-ChildItem -Path $tempDir -Directory | Select-Object -First 1
        if ($extractedFolder) {
            $tempDir = $extractedFolder.FullName
        }

        if (-not (Test-Path (Join-Path $tempDir "package.json"))) {
            throw New-Object System.Exception("Downloaded ZIP archive did not contain package.json in $tempDir")
        }
    }

    # 5. Build and Install globally
    Write-Host "Installing dependencies and building the project..." -ForegroundColor Cyan
    Set-Location "$tempDir"

    # Ensure npm command is resolved in the refreshed path
    $npmCmd = "npm"
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        # If path hasn't refreshed in memory properly, look in typical installation path
        $npmPath = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
        if (Test-Path $npmPath) {
            $npmCmd = $npmPath
        }
    }

    $isUpdate = [bool](Get-Command srs -ErrorAction SilentlyContinue)
    if ($isUpdate) {
        Write-Host "Existing installation found. Updating commands (rs, srs, rss, rsh, rsi)..." -ForegroundColor Cyan
    } else {
        Write-Host "No previous installation found. Installing commands (rs, srs, rss, rsh, rsi)..." -ForegroundColor Cyan
    }

    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Write-Host "Running npm install..." -ForegroundColor Gray
        & $npmCmd install
        if ($LASTEXITCODE -ne 0) {
            throw New-Object System.Exception("npm install failed with exit code $LASTEXITCODE")
        }

        Write-Host "Running npm build..." -ForegroundColor Gray
        & $npmCmd run build
        if ($LASTEXITCODE -ne 0) {
            throw New-Object System.Exception("npm run build failed with exit code $LASTEXITCODE")
        }

        Write-Host "Installing command globally..." -ForegroundColor Gray
        & $npmCmd install -g .
        if ($LASTEXITCODE -ne 0) {
            throw New-Object System.Exception("npm install -g . failed with exit code $LASTEXITCODE")
        }
    } finally {
        $ErrorActionPreference = $prevEap
    }

    # Verify every advertised command shim was (re)written in the GLOBAL npm prefix
    $shimDir = Get-GlobalNpmPrefix -NpmCommand $npmCmd
    if (-not $shimDir -or -not (Test-Path $shimDir)) {
        throw New-Object System.Exception("Could not resolve global npm prefix directory (got: '$shimDir')")
    }

    $expectedShims = @("auto-resize", "auto_resize", "rs", "srs", "rss", "rsh", "rsi")
    $missingShims = @($expectedShims | Where-Object { -not (Test-Path (Join-Path $shimDir "$($_).cmd")) })
    if ($missingShims.Count -gt 0) {
        throw New-Object System.Exception("Command shims were not installed: $($missingShims -join ', ') in $shimDir")
    }
    Write-Host "Command shims updated in $shimDir" -ForegroundColor Green

    # Ensure the global npm shim directory is on PATH so commands work in every terminal
    $pathScope = if ($isAdmin -and ($shimDir -like "$env:ProgramFiles*")) { "Machine" } else { "User" }
    Ensure-DirectoryInPath -Directory $shimDir -Scope $pathScope

    Write-Host "Creating Start Menu shortcuts for Windows Search..." -ForegroundColor Gray
    try {
        $programsPath = [System.IO.Path]::Combine($env:APPDATA, "Microsoft\Windows\Start Menu\Programs")
        if (Test-Path $programsPath) {
            $wsh = New-Object -ComObject WScript.Shell
            
            # 1. Shortcut for srs (Select Resize)
            $srsShortcut = $wsh.CreateShortcut([System.IO.Path]::Combine($programsPath, "Select Resize (srs).lnk"))
            $srsShortcut.TargetPath = "powershell.exe"
            $srsShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command srs"
            $srsShortcut.Description = "Open Select Resize Dialog Picker"
            $srsShortcut.WorkingDirectory = $env:USERPROFILE
            $srsShortcut.Save()
            
            # 2. Shortcut for rss (Resize Settings)
            $rssShortcut = $wsh.CreateShortcut([System.IO.Path]::Combine($programsPath, "Resize Settings (rss).lnk"))
            $rssShortcut.TargetPath = "powershell.exe"
            $rssShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command rss"
            $rssShortcut.Description = "Manage Auto-Resize Target Resolutions"
            $rssShortcut.WorkingDirectory = $env:USERPROFILE
            $rssShortcut.Save()

            # 3. Shortcut for rsh (Resize Help)
            $rshShortcut = $wsh.CreateShortcut([System.IO.Path]::Combine($programsPath, "Resize Help (rsh).lnk"))
            $rshShortcut.TargetPath = "powershell.exe"
            $rshShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -Command rsh"
            $rshShortcut.Description = "Show Auto-Resize User Guide"
            $rshShortcut.WorkingDirectory = $env:USERPROFILE
            $rshShortcut.Save()

            # 4. Shortcut for rsi (Resize Install)
            $rsiShortcut = $wsh.CreateShortcut([System.IO.Path]::Combine($programsPath, "Resize Install (rsi).lnk"))
            $rsiShortcut.TargetPath = "powershell.exe"
            $rsiShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -Command rsi"
            $rsiShortcut.Description = "Run Auto-Resize Installer / Updater"
            $rsiShortcut.WorkingDirectory = $env:USERPROFILE
            $rsiShortcut.Save()

            # 5. Shortcut for rs (Auto Resize)
            $rsShortcut = $wsh.CreateShortcut([System.IO.Path]::Combine($programsPath, "Auto Resize (rs).lnk"))
            $rsShortcut.TargetPath = "powershell.exe"
            $rsShortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -NoExit -Command rs"
            $rsShortcut.Description = "Run Auto-Resize Processing Engine"
            $rsShortcut.WorkingDirectory = $env:USERPROFILE
            $rsShortcut.Save()
        }
    } catch {
        Write-Host "Warning: Could not create Start Menu shortcuts: $_" -ForegroundColor Yellow
    }

    $installedVersion = (Get-Content (Join-Path $tempDir "package.json") -Raw | ConvertFrom-Json).version
    Write-Host "====================================================" -ForegroundColor Green
    Write-Host " SUCCESS: Installation complete! (v$installedVersion)" -ForegroundColor Green
    Write-Host " Use it anywhere in your terminal:" -ForegroundColor Green
    Write-Host "   auto_resize <video_path> (Or 'rs')" -ForegroundColor Yellow
    Write-Host "   srs (To open the File browser popup dialog)" -ForegroundColor Yellow
    Write-Host "   rss (To manage custom target dimensions)" -ForegroundColor Yellow
    Write-Host "   rsh (To view the Vietnamese user guide)" -ForegroundColor Yellow
    Write-Host "====================================================" -ForegroundColor Green

} catch {
    Write-Host "`n[FATAL ERROR] Installation failed!" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
}

Write-Host "`nPress any key to close..." -ForegroundColor Gray
[void]$Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
