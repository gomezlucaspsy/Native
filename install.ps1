#Requires -Version 5.1
<#
    Native Share - one-command installer.

    Builds the web app deps, the host agent, and the desktop launcher,
    then creates Desktop + Start Menu shortcuts pointing at the built exe -
    so shortcuts exist right away, with the correct icon, without needing
    to run the app first.

    Usage:
        powershell -ExecutionPolicy Bypass -File install.ps1
#>

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "    $msg" -ForegroundColor DarkGray }
function Fail($msg)       { Write-Host "`nERROR: $msg" -ForegroundColor Red; exit 1 }

# -- 1. Prerequisites ------------------------------------------------------
Write-Step "Checking prerequisites"

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail "Node.js is not installed or not on PATH. Install it from https://nodejs.org and re-run." }
Write-Info "node: $(node --version)"

$dotnetCmd = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnetCmd) { Fail ".NET SDK is not installed or not on PATH. Install .NET 8 SDK and re-run." }
Write-Info "dotnet: $(dotnet --version)"

# -- 2. Web app dependencies ------------------------------------------------
Write-Step "Installing web app dependencies (npm install)"
Push-Location $root
try {
    npm install
    if ($LASTEXITCODE -ne 0) { Fail "npm install failed." }
} finally { Pop-Location }

if (-not (Test-Path (Join-Path $root ".env.local"))) {
    Write-Info "No .env.local found - copying .env.example (fill in ANTHROPIC_API_KEY etc. before using the Claude tab)"
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env.local") -ErrorAction SilentlyContinue
}

# -- 3. Host agent (Release build, used by the launcher) -------------------
Write-Step "Building host agent"
Push-Location (Join-Path $root "host-agent")
try {
    dotnet publish -c Release
    if ($LASTEXITCODE -ne 0) { Fail "host-agent build failed." }
} finally { Pop-Location }

# -- 4. Desktop launcher (single self-contained exe -> dist/) --------------
Write-Step "Building desktop launcher"
Push-Location (Join-Path $root "launcher")
try {
    dotnet publish -c Release -r win-x64 --self-contained true `
        -p:PublishSingleFile=true -o (Join-Path $root "dist")
    if ($LASTEXITCODE -ne 0) { Fail "launcher build failed." }
} finally { Pop-Location }

$exe = Join-Path $root "dist\NativeShare.exe"
if (-not (Test-Path $exe)) { Fail "Build succeeded but $exe was not found." }

# -- 5. Shortcuts: Desktop + Start Menu -------------------------------------
Write-Step "Creating shortcuts"

function New-AppShortcut($lnkPath) {
    New-Item -ItemType Directory -Force -Path (Split-Path $lnkPath) | Out-Null
    $shell = New-Object -ComObject WScript.Shell
    $sc = $shell.CreateShortcut($lnkPath)
    $sc.TargetPath       = $exe
    $sc.WorkingDirectory = $root
    $sc.IconLocation     = "$exe,0"
    $sc.Description      = "Native Share - QuickShare and Claude AI"
    $sc.Save()
    Write-Info $lnkPath
}

$desktopLnk   = Join-Path ([Environment]::GetFolderPath("Desktop")) "Native Share.lnk"
$startMenuLnk = Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Native Share.lnk"

New-AppShortcut $desktopLnk
New-AppShortcut $startMenuLnk

# -- Done --------------------------------------------------------------
Write-Host "`nInstall complete." -ForegroundColor Green
Write-Host "Launch Native Share from the Desktop shortcut, the Start Menu, or:" -ForegroundColor White
Write-Host "  $exe" -ForegroundColor White
Write-Host ""
