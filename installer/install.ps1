# FSV Studio - Windows Installer
# Uses system-installed Python (whatever "python" resolves to)

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
function Write-OK($msg)   { Write-Host "  OK   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ============================================"
Write-Host "    FSV Studio - First-Time Setup"
Write-Host "  ============================================"
Write-Host ""
Read-Host "  Press Enter to start"

# ============================================================
# Step 1 - Check Python
# ============================================================

Write-Step "Checking Python installation"

try {
    $ver = & python --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
    Write-OK "Using $ver"
}
catch {
    Write-Fail "Python not found in PATH."
    Write-Host "Install Python and ensure 'Add Python to PATH' is enabled."
    exit 1
}

# ============================================================
# Step 2 - Create Virtual Environment
# ============================================================

Write-Step "Creating virtual environment"

if (-not (Test-Path $VenvDir)) {
    & python -m venv $VenvDir
    Write-OK "Virtual environment created"
} else {
    Write-OK "Virtual environment already exists"
}

& $VenvPython -m pip install --upgrade pip

# ============================================================
# Step 3 - Install PyTorch (CPU version for max compatibility)
# ============================================================

Write-Step "Installing PyTorch (CPU build)"

try {
    & $VenvPip install torch torchvision torchaudio
    Write-OK "PyTorch installed"
}
catch {
    Write-Fail "PyTorch install failed."
    exit 1
}

# ============================================================
# Step 4 - Install AI Dependencies
# ============================================================

Write-Step "Installing AI dependencies"

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

Write-OK "All dependencies installed"

# ============================================================
# Step 5 - Prepare Model Directory
# ============================================================

Write-Step "Preparing model directory"

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

$existingFiles = Get-ChildItem $ModelsDir -Filter "*.safetensors" -ErrorAction SilentlyContinue

if ($existingFiles -and $existingFiles.Count -gt 0) {
    Write-OK ("Model already present ({0} files found)" -f $existingFiles.Count)
}
else {
    Write-Warn "No model files found."
    Write-Host "Download LTX-2 manually from HuggingFace and place files in:"
    Write-Host "  $ModelsDir"
}

# ============================================================
# Step 6 - Install FFmpeg (optional check)
# ============================================================

Write-Step "Checking FFmpeg"

$ffmpegLocal = Join-Path $BinDir "ffmpeg.exe"

if (Test-Path $ffmpegLocal) {
    Write-OK "FFmpeg found locally"
}
else {
    try {
        & ffmpeg -version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "FFmpeg available on PATH"
        }
    }
    catch {
        Write-Warn "FFmpeg not found."
        Write-Host "Install from https://ffmpeg.org/download.html and add to PATH."
    }
}

# ============================================================
# Write config.json safely
# ============================================================

Write-Step "Writing configuration file"

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

Write-OK "Config saved to config\config.json"

# ============================================================
# Done
# ============================================================

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "    Setup complete!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"