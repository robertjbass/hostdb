<#
.SYNOPSIS
    Build ClickHouse for Windows - handles MSYS2 installation automatically.

.DESCRIPTION
    This script:
    1. Checks if MSYS2 is installed, installs it if not
    2. Installs required CLANG64 packages
    3. Runs the build inside MSYS2 CLANG64 environment

    The script automatically detects and reuses existing source code.
    Use -Clean to force a fresh clone.

.PARAMETER Version
    ClickHouse version to build (e.g., 25.12.3.21)

.PARAMETER Clean
    Remove existing source and start fresh

.PARAMETER ConfigureOnly
    Only run cmake configure, don't build

.EXAMPLE
    .\build-windows.ps1 -Version 25.12.3.21

.EXAMPLE
    .\build-windows.ps1 -Version 25.12.3.21 -Clean

.EXAMPLE
    .\build-windows.ps1 -Version 25.12.3.21 -ConfigureOnly
#>

param(
    [Parameter(Mandatory=$true)]
    [string]$Version,

    [switch]$Clean,
    [switch]$ConfigureOnly
)

$ErrorActionPreference = "Stop"

# MSYS2 installation paths (check common locations)
$MSYS2Paths = @(
    "C:\msys64",
    "C:\msys2",
    "$env:USERPROFILE\msys64",
    "$env:LOCALAPPDATA\msys64"
)

$MSYS2Root = $null
$MSYS2InstallerUrl = "https://github.com/msys2/msys2-installer/releases/download/2024-01-13/msys2-x86_64-20240113.exe"
$MSYS2InstallerPath = "$env:TEMP\msys2-installer.exe"

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> " -ForegroundColor Cyan -NoNewline
    Write-Host $Message -ForegroundColor White
}

function Write-Success {
    param([string]$Message)
    Write-Host "[OK] " -ForegroundColor Green -NoNewline
    Write-Host $Message
}

function Write-Warning {
    param([string]$Message)
    Write-Host "[WARN] " -ForegroundColor Yellow -NoNewline
    Write-Host $Message
}

function Write-Error {
    param([string]$Message)
    Write-Host "[ERROR] " -ForegroundColor Red -NoNewline
    Write-Host $Message
}

function Find-MSYS2 {
    foreach ($path in $MSYS2Paths) {
        if (Test-Path "$path\msys2_shell.cmd") {
            return $path
        }
    }
    return $null
}

function Install-MSYS2 {
    Write-Step "MSYS2 not found. Installing..."

    # Download installer
    Write-Host "Downloading MSYS2 installer..."
    try {
        Invoke-WebRequest -Uri $MSYS2InstallerUrl -OutFile $MSYS2InstallerPath -UseBasicParsing
    } catch {
        Write-Error "Failed to download MSYS2 installer: $_"
        Write-Host "`nPlease install MSYS2 manually from https://www.msys2.org/"
        exit 1
    }

    # Run installer silently
    Write-Host "Running MSYS2 installer (this may take a few minutes)..."
    $installPath = "C:\msys64"

    # Run installer with silent options
    $installerArgs = @(
        "install",
        "--root", $installPath,
        "--confirm-command"
    )

    try {
        # The MSYS2 installer supports command-line installation
        Start-Process -FilePath $MSYS2InstallerPath -ArgumentList $installerArgs -Wait -NoNewWindow
    } catch {
        # Fallback: run interactive installer
        Write-Warning "Silent install failed, launching interactive installer..."
        Write-Host "Please complete the installation with default settings."
        Start-Process -FilePath $MSYS2InstallerPath -Wait
    }

    # Clean up installer
    Remove-Item -Path $MSYS2InstallerPath -Force -ErrorAction SilentlyContinue

    # Verify installation
    if (Test-Path "$installPath\msys2_shell.cmd") {
        Write-Success "MSYS2 installed to $installPath"
        return $installPath
    } else {
        Write-Error "MSYS2 installation failed or was cancelled"
        exit 1
    }
}

function Initialize-MSYS2 {
    param([string]$Root)

    Write-Step "Initializing MSYS2 (first-time setup)..."

    # Run initial setup to update package database
    $bash = "$Root\usr\bin\bash.exe"

    # First run to initialize
    & $bash -lc "exit 0" 2>$null

    Write-Success "MSYS2 initialized"
}

function Install-Packages {
    param([string]$Root)

    Write-Step "Installing required packages..."

    $bash = "$Root\usr\bin\bash.exe"
    $env:MSYSTEM = "CLANG64"
    $env:CHERE_INVOKING = "1"

    # Package list
    $packages = @(
        "mingw-w64-clang-x86_64-clang",
        "mingw-w64-clang-x86_64-lld",
        "mingw-w64-clang-x86_64-cmake",
        "mingw-w64-clang-x86_64-ninja",
        "mingw-w64-clang-x86_64-openssl",
        "mingw-w64-clang-x86_64-zlib",
        "mingw-w64-clang-x86_64-zstd",
        "mingw-w64-clang-x86_64-lz4",
        "mingw-w64-clang-x86_64-xz",
        "mingw-w64-clang-x86_64-libxml2",
        "mingw-w64-clang-x86_64-python",
        "mingw-w64-clang-x86_64-nasm",
        "git",
        "zip"
    )

    $packageList = $packages -join " "

    # Fresh MSYS2 installs need TWO rounds of pacman -Syu
    # First round updates core packages and may require shell restart
    # We handle this by running it twice with proper flags

    Write-Host "Updating package database (pass 1 - core system)..."
    Write-Host "(This may take a few minutes, please wait...)"

    # First update - use --noconfirm and ignore errors (core update may "fail" asking for restart)
    $env:MSYS = "winsymlinks:nativestrict"
    $result = & $bash -lc "pacman -Syuu --noconfirm 2>&1; exit 0"
    Write-Host $result

    Write-Host ""
    Write-Host "Updating package database (pass 2 - remaining packages)..."
    $result = & $bash -lc "pacman -Syu --noconfirm 2>&1"
    Write-Host $result

    Write-Host ""
    Write-Host "Installing packages (this may take a few minutes)..."
    $result = & $bash -lc "pacman -S --noconfirm --needed $packageList 2>&1"
    Write-Host $result

    Write-Success "Packages installed"
}

function Test-PackagesInstalled {
    param([string]$Root)

    $bash = "$Root\usr\bin\bash.exe"
    $env:MSYSTEM = "CLANG64"
    $env:CHERE_INVOKING = "1"

    # Quick check if clang is available in CLANG64
    $result = & $bash -lc "which clang 2>/dev/null" 2>&1
    return ($LASTEXITCODE -eq 0)
}

function Invoke-Build {
    param(
        [string]$Root,
        [string]$Version,
        [bool]$Clean,
        [bool]$ConfigureOnly
    )

    Write-Step "Starting ClickHouse build..."

    $bash = "$Root\usr\bin\bash.exe"
    $env:MSYSTEM = "CLANG64"
    $env:CHERE_INVOKING = "1"

    # Get the script directory in Unix format
    $scriptDir = $PSScriptRoot -replace '\\', '/' -replace '^([A-Za-z]):', '/$1'
    $scriptDir = $scriptDir.ToLower() -replace '^/([a-z])', '/$1'

    # Build command arguments
    $buildArgs = "--version $Version"
    if ($Clean) { $buildArgs += " --clean" }
    if ($ConfigureOnly) { $buildArgs += " --configure-only" }

    Write-Host "Running: build-windows.sh $buildArgs"
    Write-Host ""

    # Run the build script
    & $bash -lc "cd '$scriptDir' && ./build-windows.sh $buildArgs"

    return $LASTEXITCODE
}

# =============================================================================
# Main
# =============================================================================

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  ClickHouse Windows Build Launcher" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Version:        $Version"
Write-Host "Clean:          $Clean"
Write-Host "Configure Only: $ConfigureOnly"
Write-Host ""

# Step 1: Find or install MSYS2
Write-Step "Checking for MSYS2 installation..."
$MSYS2Root = Find-MSYS2

if (-not $MSYS2Root) {
    $MSYS2Root = Install-MSYS2
    Initialize-MSYS2 -Root $MSYS2Root
    Install-Packages -Root $MSYS2Root
} else {
    Write-Success "Found MSYS2 at $MSYS2Root"

    # Check if packages are installed
    if (-not (Test-PackagesInstalled -Root $MSYS2Root)) {
        Write-Warning "Required packages not found"
        Install-Packages -Root $MSYS2Root
    } else {
        Write-Success "Required packages already installed"
    }
}

# Step 2: Run the build
$exitCode = Invoke-Build -Root $MSYS2Root -Version $Version -Clean $Clean -ConfigureOnly $ConfigureOnly

if ($exitCode -eq 0) {
    Write-Host ""
    Write-Success "Build completed successfully!"
} else {
    Write-Host ""
    Write-Error "Build failed with exit code $exitCode"
}

exit $exitCode
