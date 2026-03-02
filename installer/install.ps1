# FSV Studio - Windows Installer
# Run via RUN_INSTALLER.bat (double-click it)

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

function Write-Step($msg) { Write-Host "" ; Write-Host "  >> $msg" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  WARN  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  FAIL  $msg" -ForegroundColor Red }

Clear-Host
Write-Host ""
Write-Host "  ============================================"
Write-Host "    FSV Studio - First-Time Setup"
Write-Host "  ============================================"
Write-Host ""
Write-Host "  This will install:"
Write-Host "    - Python 3.11"
Write-Host "    - PyTorch with GPU/CUDA support"
Write-Host "    - LTX-2 AI model (~14 GB)"
Write-Host "    - FFmpeg"
Write-Host ""
Write-Host "  Total download: ~17 GB. Leave this running." -ForegroundColor Yellow
Write-Host ""
Read-Host "  Press Enter to start"

# ============================================================
# Step 1 - Check / Install Python 3.11
# ============================================================
Write-Step "Step 1 / 6 - Checking Python 3.11"

$py311Found = $false
try {
    $ver = & py -3.11 --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Python 3.11 found: $ver"
        $py311Found = $true
    }
} catch { $py311Found = $false }

if (-not $py311Found) {
    Write-Host "  Python 3.11 not found. Downloading..." -ForegroundColor Yellow
    $pyInstaller = Join-Path $env:TEMP "python-3.11.9-amd64.exe"
    $pyUrl = "https://www.python.org/ftp/python/3.11.9/python-3.11.9-amd64.exe"
    try {
        Invoke-WebRequest -Uri $pyUrl -OutFile $pyInstaller -UseBasicParsing
        Write-Host "  Installing Python 3.11..."
        Start-Process -FilePath $pyInstaller -ArgumentList "/quiet InstallAllUsers=0 PrependPath=1 Include_test=0" -Wait
        Write-OK "Python 3.11 installed"
    } catch {
        Write-Fail "Could not download Python 3.11 automatically."
        Write-Host "  Please install from: https://www.python.org/downloads/release/python-3119/"
        Write-Host "  Tick 'Add Python to PATH' then re-run this installer."
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ============================================================
# Step 2 - Create virtual environment
# ============================================================
Write-Step "Step 2 / 6 - Creating Python virtual environment"

if (-not (Test-Path $VenvDir)) {
    & py -3.11 -m venv $VenvDir
    Write-OK "venv created at $VenvDir"
} else {
    Write-OK "venv already exists"
}

# Upgrade pip silently
& $VenvPython -m pip install --upgrade pip -q

# ============================================================
# Step 3 - Install PyTorch (auto-select CUDA version)
# ============================================================
# FIX #5: Detect NVIDIA driver version and choose the correct PyTorch CUDA
# wheel. RTX 40xx / 50xx series cards require CUDA 12.x — installing the
# cu118 wheel on those GPUs causes "CUDA not available" even with valid drivers.
#
# Driver version mapping (minimum driver for each CUDA toolkit):
#   CUDA 11.8 → driver >= 452.39   (supported by GTX 10xx through RTX 30xx)
#   CUDA 12.1 → driver >= 527.41   (required by RTX 40xx and newer)

$cudaWheelUrl = "https://download.pytorch.org/whl/cu118"
$cudaLabel    = "CUDA 11.8"

try {
    $driverLine = & nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>&1
    if ($LASTEXITCODE -eq 0 -and $driverLine) {
        $driverMajor = [int]($driverLine.Trim().Split('.')[0])
        if ($driverMajor -ge 527) {
            $cudaWheelUrl = "https://download.pytorch.org/whl/cu121"
            $cudaLabel    = "CUDA 12.1"
            Write-Host "  Detected driver $($driverLine.Trim()) → selecting PyTorch with $cudaLabel" -ForegroundColor Cyan
        } else {
            Write-Host "  Detected driver $($driverLine.Trim()) → selecting PyTorch with $cudaLabel" -ForegroundColor Cyan
        }
    }
} catch {
    Write-Warn "Could not detect driver version — defaulting to $cudaLabel"
}

Write-Step "Step 3 / 6 - Installing PyTorch with $cudaLabel"
Write-Host "  Downloading ~2.8 GB - this takes several minutes..." -ForegroundColor Yellow

try {
    & $VenvPip install torch torchvision torchaudio --index-url $cudaWheelUrl -q
    Write-OK "PyTorch installed ($cudaLabel)"
} catch {
    Write-Fail "PyTorch install failed: $_"
    Read-Host "Press Enter to exit"
    exit 1
}

# Verify CUDA - write a temp script to avoid PowerShell string parsing issues
$cudaScript = Join-Path $env:TEMP "fsv_check_cuda.py"
Set-Content -Path $cudaScript -Encoding UTF8 -Value @'
import torch
available = torch.cuda.is_available()
print("CUDA_OK" if available else "CUDA_FAIL")
if available:
    print(torch.cuda.get_device_name(0))
'@

$cudaResult = & $VenvPython $cudaScript 2>&1
if ($cudaResult -match "CUDA_OK") {
    Write-OK "CUDA is available - GPU acceleration confirmed"
    $gpuName = ($cudaResult | Where-Object { $_ -notmatch "CUDA_" }) -join ""
    if ($gpuName) { Write-OK "GPU: $gpuName" }
} else {
    Write-Warn "CUDA not available. Make sure NVIDIA drivers are up to date."
    Write-Host "  Download drivers: https://www.nvidia.com/drivers" -ForegroundColor Yellow
}

# ============================================================
# Step 4 - Install AI dependencies
# ============================================================
Write-Step "Step 4 / 6 - Installing AI dependencies"

$deps = @(
    "diffusers>=0.27.0",
    "transformers>=4.38.0",
    "accelerate>=0.27.0",
    "sentencepiece",
    "protobuf",
    "imageio",
    "imageio-ffmpeg",
    "numpy",
    "Pillow",
    "huggingface_hub"
)

try {
    foreach ($dep in $deps) {
        Write-Host "  Installing $dep..." -NoNewline
        & $VenvPip install $dep -q
        Write-Host " done" -ForegroundColor Green
    }
    Write-OK "All dependencies installed"
} catch {
    Write-Fail "Dependency install failed: $_"
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host "  Installing xformers (optional, may take a moment)..."
try {
    & $VenvPip install xformers --index-url $cudaWheelUrl -q
    Write-OK "xformers installed"
} catch {
    Write-Warn "xformers unavailable on this system - generation will still work"
}

# ============================================================
# Step 5 - Download LTX-2 model
# ============================================================
Write-Step "Step 5 / 6 - Downloading LTX-2 model (~14 GB)"
Write-Host "  Leave this window open - this is the longest step." -ForegroundColor Yellow

New-Item -ItemType Directory -Force -Path $ModelsDir | Out-Null

$existingFiles = Get-ChildItem $ModelsDir -Filter "*.safetensors" -ErrorAction SilentlyContinue
if ($existingFiles.Count -gt 0) {
    Write-OK "LTX-2 model already downloaded ($($existingFiles.Count) files found)"
} else {
    $downloadScript = Join-Path $env:TEMP "fsv_download.py"
    Set-Content -Path $downloadScript -Encoding UTF8 -Value @'
import sys
import os

models_dir = sys.argv[1]
print("Downloading LTX-2 from Hugging Face...")
print("This takes 10-30 minutes depending on your connection.")
print("")

try:
    from huggingface_hub import snapshot_download
    snapshot_download(
        repo_id="Lightricks/LTX-Video",
        local_dir=models_dir,
        ignore_patterns=["*.msgpack", "*.h5", "flax_model*", "tf_model*", "rust_model*"],
    )
    print("Download complete.")
except Exception as e:
    print("Download failed: " + str(e))
    sys.exit(1)
'@

    try {
        & $VenvPython $downloadScript $ModelsDir
        Write-OK "LTX-2 model downloaded"
    } catch {
        Write-Fail "Model download failed: $_"
        Write-Host "  Re-run this installer to retry the download." -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
}

# ============================================================
# Step 6 - Install FFmpeg
# ============================================================
Write-Step "Step 6 / 6 - Installing FFmpeg"

$ffmpegLocal = Join-Path $BinDir "ffmpeg.exe"
$ffmpegFound = $false

if (Test-Path $ffmpegLocal) {
    Write-OK "FFmpeg already installed (local)"
    $ffmpegFound = $true
}

if (-not $ffmpegFound) {
    try {
        & ffmpeg -version 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "FFmpeg found on system PATH"
            $ffmpegFound = $true
        }
    } catch {}
}

if (-not $ffmpegFound) {
    Write-Host "  Downloading FFmpeg..."
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
    $ffmpegZip = Join-Path $env:TEMP "ffmpeg.zip"
    $ffmpegUrl = "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip"
    try {
        Invoke-WebRequest -Uri $ffmpegUrl -OutFile $ffmpegZip -UseBasicParsing
        Expand-Archive -Path $ffmpegZip -DestinationPath $env:TEMP -Force
        $ffmpegExe = Get-ChildItem "$env:TEMP\ffmpeg*" -Filter "ffmpeg.exe" -Recurse | Select-Object -First 1
        Copy-Item $ffmpegExe.FullName -Destination $ffmpegLocal
        Write-OK "FFmpeg installed"
    } catch {
        Write-Warn "Could not install FFmpeg automatically."
        Write-Host "  Install from https://ffmpeg.org/download.html and add to PATH." -ForegroundColor Yellow
    }
}

# ============================================================
# Write config.json
# ============================================================
$ffmpegPath = if (Test-Path $ffmpegLocal) { $ffmpegLocal } else { "ffmpeg" }

$configContent = @"
{
  "version":    "1.0.0",
  "pythonPath": "$($VenvPython -replace '\\', '\\\\')",
  "modelsDir":  "$($ModelsDir -replace '\\', '\\\\')",
  "outputsDir": "$((Join-Path $ProjectDir 'jobs') -replace '\\', '\\\\')",
  "ffmpegPath": "$($ffmpegPath -replace '\\', '\\\\')",
  "theme":      "light"
}
"@

Set-Content -Path $ConfigFile -Encoding UTF8 -Value $configContent
Write-OK "Config saved to config\config.json"

# ============================================================
# Done
# ============================================================
Write-Host ""
Write-Host "  ============================================" -ForegroundColor Green
Write-Host "    Setup complete!" -ForegroundColor Green
Write-Host "  ============================================" -ForegroundColor Green
Write-Host ""
Write-Host "  To launch FSV Studio:"
Write-Host ""
Write-Host "    1. Open a terminal in the FSV-Studio folder"
Write-Host "    2. Run: npm install"
Write-Host "    3. Run: npm start"
Write-Host ""
Write-Host "  To test generation works:"
Write-Host "    $VenvPython engine\generate.py --job_id test --prompt `"a dog on a beach`" --width 512 --height 512 --clip_length 3 --output test.mp4"
Write-Host ""
Read-Host "  Press Enter to close"
