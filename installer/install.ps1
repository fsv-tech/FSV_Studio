# FSV Studio - Windows Installer

$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "FSV Studio Installer"

$ScriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $ScriptDir
$EngineDir  = Join-Path $ProjectDir "engine"
$ModelsDir  = Join-Path $ProjectDir "models\ltx-2"
$BinDir     = Join-Path $ProjectDir "bin"
$ConfigFile = Join-Path $ProjectDir "config\config.json"
$VenvDir    = Join-Path $EngineDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"
$VenvPip    = Join-Path $VenvDir "Scripts\pip.exe"

function Write-Step($msg) { Write-Host ""; Write-Host "  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  FSV Studio - First-Time Setup"
Write-Host ""
Read-Host "  Press Enter to start"

# ============================================================
# Python Check
# ============================================================

Write-Step "Checking Python 3.11"

$py311Found = $false
try {
    $ver = & py -3.11 --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Python 3.11 found: $ver"
        $py311Found = $true
    }
} catch {}

if (-not $py311Found) {
    Write-Fail "Python 3.11 not found. Please install it manually."
    exit 1
}

# ============================================================
# Create venv
# ============================================================

Write-Step "Creating virtual environment"

if (-not (Test-Path $VenvDir)) {
    & py -3.11 -m venv $VenvDir
    Write-OK "venv created"
} else {
    Write-OK "venv already exists"
}

& $VenvPython -m pip install --upgrade pip

# ============================================================
# Install PyTorch
# ============================================================

Write-Step "Installing PyTorch"
& $VenvPip install torch torchvision torchaudio
Write-OK "PyTorch installed"

# ============================================================
# Install dependencies
# ============================================================

Write-Step "Installing dependencies"

$deps = @(
    "diffusers",
    "transformers",
    "accelerate",
    "sentencepiece",
    "protobuf",
    "imageio",
    "imageio-ffmpeg",
    "numpy",
    "Pillow",
    "huggingface_hub"
)

foreach ($dep in $deps) {
    Write-Host "  Installing $dep..."
    & $VenvPip install $dep
}

Write-OK "Dependencies installed"

# ============================================================
# Download Model
# ============================================================

Write-Step "Checking model folder"

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

$existingFiles = Get-ChildItem $ModelsDir -Filter "*.safetensors" -ErrorAction SilentlyContinue

if ($existingFiles -and $existingFiles.Count -gt 0) {
    Write-OK ("Model already downloaded ({0} files found)" -f $existingFiles.Count)
} else {
    Write-Warn "Model not found. Download manually from HuggingFace."
}

# ============================================================
# Write config.json SAFELY
# ============================================================

Write-Step "Writing config"

New-Item -ItemType Directory -Force -Path (Split-Path $ConfigFile) | Out-Null

$configObject = @{
    version    = "1.0.0"
    pythonPath = $VenvPython
    modelsDir  = $ModelsDir
    outputsDir = (Join-Path $ProjectDir "jobs")
    ffmpegPath = "ffmpeg"
    theme      = "light"
}

$configObject | ConvertTo-Json -Depth 3 | Set-Content $ConfigFile -Encoding UTF8

Write-OK "Config saved"

# ============================================================
# Done
# ============================================================

Write-Host ""
Write-Host "Setup complete!"
Read-Host "Press Enter to close"