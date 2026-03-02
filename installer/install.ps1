# ============================================
# FSV Studio - First-Time Setup
# ============================================

$ErrorActionPreference = "Stop"

# --------------------------------------------
# FIX BROKEN SSL ENV VARIABLES (PostgreSQL bug)
# --------------------------------------------

Remove-Item Env:SSL_CERT_FILE -ErrorAction SilentlyContinue
Remove-Item Env:REQUESTS_CA_BUNDLE -ErrorAction SilentlyContinue
Remove-Item Env:CURL_CA_BUNDLE -ErrorAction SilentlyContinue

# --------------------------------------------
# Paths
# --------------------------------------------

$RootDir    = Split-Path -Parent $PSScriptRoot
$EngineDir  = Join-Path $RootDir "engine"
$ModelsDir  = Join-Path $RootDir "models\ltx-2"
$VenvDir    = Join-Path $EngineDir ".venv"
$VenvPython = Join-Path $VenvDir "Scripts\python.exe"

function Write-Step($msg) {
    Write-Host ""
    Write-Host "  >> $msg"
}

function Write-OK($msg) {
    Write-Host "  OK   $msg"
}

function Write-Warn($msg) {
    Write-Host "  WARN  $msg"
}

# ============================================
# STEP 1 — CHECK PYTHON
# ============================================

Write-Step "Checking Python"

try {
    $pyVersion = python --version
    Write-OK "Using $pyVersion"
}
catch {
    Write-Host "  FAIL  Python not found in PATH."
    pause
    exit
}

# ============================================
# STEP 2 — CREATE VENV
# ============================================

Write-Step "Creating virtual environment"

if (!(Test-Path $VenvPython)) {
    python -m venv $VenvDir
    Write-OK "Virtual environment created"
}
else {
    Write-OK "Virtual environment already exists"
}

# ============================================
# STEP 3 — INSTALL DEPENDENCIES
# ============================================

Write-Step "Installing dependencies"

& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121
& $VenvPython -m pip install diffusers transformers accelerate huggingface_hub safetensors opencv-python imageio ffmpeg-python

Write-OK "Dependencies installed"

# ============================================
# STEP 4 — DOWNLOAD REQUIRED MODEL ONLY
# ============================================

Write-Step "Checking LTX-2 distilled FP8 model"

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null
$MainModel = Join-Path $ModelsDir "ltx-2-19b-distilled-fp8.safetensors"

if (Test-Path $MainModel) {
    Write-OK "Model already exists"
}
else {
    Write-Host "  Downloading model (this may take time)..."

    & $VenvPython -c "
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='Lightricks/LTX-2',
    allow_patterns=[
        'ltx-2-19b-distilled-fp8.safetensors',
        '*.json',
        'tokenizer*'
    ],
    local_dir=r'$ModelsDir'
)
print('MODEL DOWNLOAD COMPLETE')
"

    Write-OK "Model downloaded"
}

# ============================================
# STEP 5 — INSTALL FFMPEG (LOCAL, NO ADMIN)
# ============================================

Write-Step "Checking FFmpeg"

$LocalFFmpegDir = Join-Path $RootDir "ffmpeg"
$LocalFFmpegBin = Join-Path $LocalFFmpegDir "bin\ffmpeg.exe"

if (Test-Path $LocalFFmpegBin) {
    $env:Path = "$LocalFFmpegDir\bin;$env:Path"
    Write-OK "FFmpeg already installed (local)"
}
else {
    Write-Host "  Installing FFmpeg locally..."

    $ffmpegZip = "$env:TEMP\ffmpeg.zip"

    Invoke-WebRequest -Uri "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip" -OutFile $ffmpegZip

    Expand-Archive $ffmpegZip -DestinationPath $env:TEMP -Force

    $extracted = Get-ChildItem "$env:TEMP" | Where-Object { $_.Name -like "ffmpeg-*essentials*" }

    Move-Item "$($extracted.FullName)" $LocalFFmpegDir -Force

    $env:Path = "$LocalFFmpegDir\bin;$env:Path"

    Write-OK "FFmpeg installed locally"
}

# ============================================
# STEP 6 — WRITE CONFIG
# ============================================

Write-Step "Writing configuration file"

$ConfigDir = Join-Path $RootDir "config"
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

$ConfigFile = Join-Path $ConfigDir "config.json"

@"
{
    "model_path": "$ModelsDir\ltx-2-19b-distilled-fp8.safetensors",
    "device": "cuda",
    "precision": "fp16",
    "cpu_offload": true
}
"@ | Out-File -Encoding UTF8 $ConfigFile

Write-OK "Config saved"

# ============================================
# DONE
# ============================================

Write-Host ""
Write-Host "============================================"
Write-Host "  Setup complete!"
Write-Host "============================================"
Write-Host ""
pause