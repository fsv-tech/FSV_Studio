# ============================================================
# FSV Studio - Full Automatic Installer (Stable Build)
# ============================================================

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

$ModelRepo = "Lightricks/LTX-2"

function Write-Step($msg) { Write-Host ""; Write-Host "  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK   $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ============================================"
Write-Host "    FSV Studio - Full Automatic Setup"
Write-Host "  ============================================"
Write-Host ""
Read-Host "  Press Enter to start"

# ============================================================
# STEP 1 — PYTHON CHECK
# ============================================================

Write-Step "Checking Python"

try {
    $ver = & python --version 2>&1
    if ($LASTEXITCODE -ne 0) { throw }
    Write-OK "Using $ver"
}
catch {
    Write-Fail "Python not found in PATH"
    exit 1
}

# ============================================================
# STEP 2 — CREATE VENV
# ============================================================

Write-Step "Creating virtual environment"

if (-not (Test-Path $VenvDir)) {
    & python -m venv $VenvDir
    Write-OK "Virtual environment created"
}
else {
    Write-OK "Virtual environment already exists"
}

& $VenvPython -m pip install --upgrade pip

# ============================================================
# STEP 3 — INSTALL DEPENDENCIES
# ============================================================

Write-Step "Installing PyTorch (CPU build)"

& $VenvPip install torch torchvision torchaudio

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

Write-OK "Dependencies installed"

# ============================================================
# STEP 4 — DOWNLOAD LTX-2 MODEL
# ============================================================

Write-Step "Checking LTX-2 model"

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
$existing = Get-ChildItem $ModelsDir -Filter "*.safetensors" -ErrorAction SilentlyContinue

if ($existing -and $existing.Count -gt 0) {
    Write-OK "Model already exists"
}
else {
    Write-Host "  Downloading model (this may take 10–30 minutes)..."

    $tempPy = Join-Path $EngineDir "download_model.py"

@"
from huggingface_hub import snapshot_download

snapshot_download(
    repo_id="$ModelRepo",
    local_dir=r"$ModelsDir",
    local_dir_use_symlinks=False
)

print("MODEL DOWNLOAD COMPLETE")
"@ | Set-Content $tempPy -Encoding UTF8

    & $VenvPython $tempPy

    Remove-Item $tempPy -Force

    Write-OK "Model downloaded"
}

# ============================================================
# STEP 5 — INSTALL FFMPEG
# ============================================================

Write-Step "Checking FFmpeg"

$ffmpegLocal = Join-Path $BinDir "ffmpeg.exe"

if (Test-Path $ffmpegLocal) {
    Write-OK "FFmpeg already installed"
}
else {
    try {
        New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
        $zipPath = Join-Path $BinDir "ffmpeg.zip"

        Write-Host "  Downloading FFmpeg..."
        Invoke-WebRequest `
            -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" `
            -OutFile $zipPath

        Expand-Archive -Path $zipPath -DestinationPath $BinDir -Force

        $folder = Get-ChildItem $BinDir | Where-Object {
            $_.PSIsContainer -and $_.Name -like "ffmpeg-*"
        } | Select-Object -First 1

        Move-Item "$($folder.FullName)\bin\ffmpeg.exe" $ffmpegLocal -Force

        Remove-Item $zipPath -Force
        Remove-Item $folder.FullName -Recurse -Force

        Write-OK "FFmpeg installed"
    }
    catch {
        Write-Warn "FFmpeg auto-install failed. Install manually from https://ffmpeg.org"
    }
}

# ============================================================
# STEP 6 — WRITE CONFIG
# ============================================================

Write-Step "Writing configuration"

New-Item -ItemType Directory -Force -Path (Split-Path $ConfigFile) | Out-Null

$config = @{
    version    = "1.0.0"
    pythonPath = $VenvPython
    modelsDir  = $ModelsDir
    outputsDir = (Join-Path $ProjectDir "jobs")
    ffmpegPath = if (Test-Path $ffmpegLocal) { $ffmpegLocal } else { "ffmpeg" }
    theme      = "light"
}

$config | ConvertTo-Json -Depth 3 | Set-Content $ConfigFile -Encoding UTF8

Write-OK "Config written"

Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "    INSTALL COMPLETE"
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Read-Host "Press Enter to close"