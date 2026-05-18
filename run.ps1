# Clario / Symptom Diary - one-command launcher (Windows)
#
#   Right-click -> "Run with PowerShell"   (or double-click start-windows.bat)
#   or from a terminal:   .\run.ps1   [-Rebuild]
#
# First run: creates the Python venv, installs the backend, builds the
# frontend. Later runs skip straight to launching. Everything is local;
# nothing leaves your machine. -Rebuild forces a fresh deps install + UI build.

[CmdletBinding()]
param([switch]$Rebuild)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$Port = if ($env:DIARY_PORT) { $env:DIARY_PORT } else { "8765" }
$Url = "http://127.0.0.1:$Port/"

function Info($m)  { Write-Host "  $m" -ForegroundColor Cyan }
function Ok($m)    { Write-Host "  $m" -ForegroundColor Green }
function Warn($m)  { Write-Host "  $m" -ForegroundColor Yellow }
function Die($m)   { Write-Host ""; Write-Host "  $m" -ForegroundColor Red; Write-Host ""; exit 1 }

Write-Host ""
Write-Host "  Clario - local encrypted symptom diary" -ForegroundColor White
Write-Host "  ---------------------------------------" -ForegroundColor DarkGray

# --- locate a suitable Python (3.12+) ------------------------------------
$Py = $null
foreach ($cand in @("py -3.12", "py -3", "python", "python3")) {
  $exe, $arg = $cand.Split(" ", 2)
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    try {
      $v = & $exe $arg -c "import sys;print('%d.%d'%sys.version_info[:2])" 2>$null
      if ($v -and [version]$v -ge [version]"3.12") { $Py = $cand; break }
    } catch {}
  }
}
if (-not $Py) {
  Die "Python 3.12+ is required. Install it from https://www.python.org/downloads/ and re-run."
}
$PyExe, $PyArg = $Py.Split(" ", 2)
Ok "Python found ($Py)"

# --- backend venv + deps -------------------------------------------------
$Venv = Join-Path $Backend ".venv"
$VenvPy = Join-Path $Venv "Scripts\python.exe"
$Marker = Join-Path $Venv ".deps-installed"

if (-not (Test-Path $VenvPy)) {
  Info "Creating Python environment (first run, ~1 min)..."
  & $PyExe $PyArg -m venv $Venv
  if ($LASTEXITCODE -ne 0) { Die "Failed to create the virtual environment." }
}

if ($Rebuild -or -not (Test-Path $Marker)) {
  Info "Installing backend dependencies..."
  & $VenvPy -m pip install --quiet --upgrade pip
  Push-Location $Backend
  try {
    & $VenvPy -m pip install --quiet -e .
    if ($LASTEXITCODE -ne 0) { Die "Backend install failed. See the output above." }
  } finally { Pop-Location }
  New-Item -ItemType File -Path $Marker -Force | Out-Null
  Ok "Backend ready"
} else {
  Ok "Backend ready (cached)"
}

# --- frontend build (single-process serving) -----------------------------
$Dist = Join-Path $Frontend "dist\index.html"
if ($Rebuild -or -not (Test-Path $Dist)) {
  if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Die "Node.js 20+ is required to build the interface (first run only). Install from https://nodejs.org/ and re-run."
  }
  Push-Location $Frontend
  try {
    if ($Rebuild -or -not (Test-Path (Join-Path $Frontend "node_modules"))) {
      Info "Installing interface dependencies (first run, ~1 min)..."
      & npm install --no-audit --no-fund --loglevel=error
      if ($LASTEXITCODE -ne 0) { Die "npm install failed. See the output above." }
    }
    Info "Building the interface..."
    & npm run build
    if ($LASTEXITCODE -ne 0) { Die "Frontend build failed. See the output above." }
  } finally { Pop-Location }
  Ok "Interface built"
} else {
  Ok "Interface built (cached)"
}

# --- open the browser once the server answers ----------------------------
$opener = Start-Job -ArgumentList $Url -ScriptBlock {
  param($u)
  for ($i = 0; $i -lt 90; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ($u + "api/health") | Out-Null
      Start-Process $u
      return
    } catch { Start-Sleep -Milliseconds 700 }
  }
}

# --- run ------------------------------------------------------------------
Write-Host ""
Ok "Starting Clario at $Url"
Info "Keep this window open. Press Ctrl+C to stop."
Write-Host ""

$env:DIARY_HOST = "127.0.0.1"
$env:DIARY_PORT = $Port
Push-Location $Backend
try {
  & $VenvPy -m diary
} finally {
  Pop-Location
  Stop-Job $opener -ErrorAction SilentlyContinue | Out-Null
  Remove-Job $opener -ErrorAction SilentlyContinue | Out-Null
}
