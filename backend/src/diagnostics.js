'use strict';
const EventEmitter = require('events');
const { exec, spawn } = require('child_process');
const path         = require('path');
const fs           = require('fs');

class Diagnostics extends EventEmitter {
  constructor(pythonBridge) {
    super();
    this.bridge   = pythonBridge;
    this.rootDir  = path.join(__dirname, '../..');
  }

  async runAll() {
    const checks = [
      this._checkGpu(),
      this._checkCuda(),
      this._checkPython(),
      this._checkModels(),
      this._checkFfmpeg(),
      this._checkDisk(),
      this._checkRam(),
    ];

    const results = [];
    for (const check of checks) {
      try {
        const r = await check;
        results.push(r);
        this.emit('result', [...results]);
      } catch (err) {
        results.push({ name: 'Unknown check', status: 'fail', detail: err.message });
        this.emit('result', [...results]);
      }
    }

    return results;
  }

  async fix(key) {
    this.emit('log', `Running fix: ${key}`);
    switch (key) {
      case 'cuda':
        this.emit('log', 'Run installer/install.ps1 to reinstall PyTorch with CUDA support.');
        break;
      case 'models':
        this.emit('log', 'Run installer/install.ps1 to download models.');
        break;
      case 'ffmpeg':
        this.emit('log', 'Run installer/install.ps1 to install FFmpeg.');
        break;
      case 'disk':
        this.emit('log', 'Free up disk space — at least 20 GB recommended.');
        break;
      default:
        this.emit('log', `No automatic fix available for: ${key}`);
    }
  }

  _checkGpu() {
    return new Promise(res => {
      exec('nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits', (err, stdout) => {
        if (err) return res({ name: 'GPU', status: 'fail', detail: 'No NVIDIA GPU detected or drivers not installed', fixKey: null });
        const parts = stdout.trim().split(',');
        const name  = parts[0]?.trim();
        const vram  = Math.round(parseInt(parts[1]?.trim()) / 1024);
        res({ name: 'GPU', status: 'pass', detail: `${name} — ${vram} GB VRAM` });
      });
    });
  }

  // FIX #3: Use spawn() with an args array instead of building a shell command
  // string with exec(). The previous approach broke when pythonPath contained
  // spaces (e.g. "C:\Program Files\...") because the path was joined into a
  // single string and passed to a shell without quoting.
  _checkCuda() {
    return new Promise(res => {
      const pythonPath = this.bridge.pythonPath;

      // Resolve the executable and any leading flags (e.g. "py -3.11" → ['py', '-3.11'])
      const parts = pythonPath.includes(' ') ? pythonPath.split(' ') : [pythonPath];
      const exe   = parts[0];
      const flags = parts.slice(1);

      const script = [
        'import torch',
        'available = torch.cuda.is_available()',
        'print("True" if available else "False")',
        'print(torch.version.cuda or "unknown")',
      ].join(';');

      const proc = spawn(exe, [...flags, '-c', script]);

      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          return res({ name: 'PyTorch + CUDA', status: 'fail', detail: 'PyTorch not installed', fixKey: 'cuda' });
        }
        const lines   = stdout.trim().split('\n');
        const avail   = lines[0]?.trim() === 'True';
        const version = lines[1]?.trim() || 'unknown';
        if (avail) {
          res({ name: 'PyTorch + CUDA', status: 'pass', detail: `CUDA ${version} available` });
        } else {
          res({ name: 'PyTorch + CUDA', status: 'fail', detail: 'PyTorch installed but CUDA not available', fixKey: 'cuda' });
        }
      });

      proc.on('error', () => {
        res({ name: 'PyTorch + CUDA', status: 'fail', detail: 'Could not run Python to check CUDA', fixKey: 'cuda' });
      });
    });
  }

  _checkPython() {
    return new Promise(res => {
      const venvPy = path.join(this.rootDir, 'engine/.venv/Scripts/python.exe');
      if (fs.existsSync(venvPy)) {
        exec(`"${venvPy}" --version`, (err, stdout) => {
          if (err) return res({ name: 'Python', status: 'warn', detail: 'venv Python not responding' });
          res({ name: 'Python', status: 'pass', detail: stdout.trim() + ' (venv)' });
        });
      } else {
        exec('py -3.11 --version', (err, stdout) => {
          if (err) return res({ name: 'Python', status: 'warn', detail: 'Python 3.11 not found. Run install.ps1' });
          res({ name: 'Python', status: 'pass', detail: stdout.trim() });
        });
      }
    });
  }

  _checkModels() {
    const modelsDir = path.join(this.rootDir, 'models/ltx-2');
    if (!fs.existsSync(modelsDir)) {
      return Promise.resolve({ name: 'LTX-2 Model', status: 'fail', detail: 'Model not downloaded. Run install.ps1', fixKey: 'models' });
    }
    const files = fs.readdirSync(modelsDir).filter(f => f.endsWith('.safetensors') || f.endsWith('.bin'));
    if (files.length === 0) {
      return Promise.resolve({ name: 'LTX-2 Model', status: 'fail', detail: 'Model files missing. Run install.ps1', fixKey: 'models' });
    }
    return Promise.resolve({ name: 'LTX-2 Model', status: 'pass', detail: `${files.length} model files found` });
  }

  _checkFfmpeg() {
    return new Promise(res => {
      const local = path.join(this.rootDir, 'bin/ffmpeg.exe');
      if (fs.existsSync(local)) return res({ name: 'FFmpeg', status: 'pass', detail: 'FFmpeg installed (local)' });

      exec('ffmpeg -version', (err, stdout) => {
        if (err) return res({ name: 'FFmpeg', status: 'fail', detail: 'FFmpeg not found. Run install.ps1', fixKey: 'ffmpeg' });
        const ver = stdout.split('\n')[0]?.replace('ffmpeg version ', '').split(' ')[0];
        res({ name: 'FFmpeg', status: 'pass', detail: `FFmpeg ${ver}` });
      });
    });
  }

  // FIX #11: Check the disk that actually contains modelsDir/outputsDir rather
  // than always checking drives[0] (C:). Users who store models on a secondary
  // drive (common for large model workflows) would see misleading results.
  _checkDisk() {
    return new Promise(res => {
      const si = require('systeminformation');
      si.fsSize().then(drives => {
        // Find the drive whose mount point is the longest prefix of rootDir.
        // This gives us the most specific match (e.g. D:\ over C:\).
        const rootNorm = this.rootDir.replace(/\\/g, '/').toLowerCase();
        let best = drives[0];
        for (const d of drives) {
          const mount = (d.mount || '').replace(/\\/g, '/').toLowerCase();
          if (rootNorm.startsWith(mount) && mount.length > ((best?.mount || '').length)) {
            best = d;
          }
        }
        const drive = best || drives[0];
        const gb    = Math.round((drive?.available || 0) / 1024 ** 3);
        if (gb < 5)  return res({ name: 'Disk space', status: 'fail', detail: `Only ${gb} GB free — need at least 5 GB`, fixKey: 'disk' });
        if (gb < 20) return res({ name: 'Disk space', status: 'warn', detail: `${gb} GB free — 20+ GB recommended` });
        res({ name: 'Disk space', status: 'pass', detail: `${gb} GB free` });
      }).catch(() => res({ name: 'Disk space', status: 'warn', detail: 'Could not check disk space' }));
    });
  }

  _checkRam() {
    return new Promise(res => {
      const si = require('systeminformation');
      si.mem().then(mem => {
        const gb = Math.round(mem.total / 1024 ** 3);
        if (gb < 8)  return res({ name: 'System RAM', status: 'fail',  detail: `${gb} GB — 16 GB recommended` });
        if (gb < 16) return res({ name: 'System RAM', status: 'warn',  detail: `${gb} GB — 16+ GB recommended for large models` });
        res({ name: 'System RAM', status: 'pass', detail: `${gb} GB` });
      }).catch(() => res({ name: 'System RAM', status: 'warn', detail: 'Could not check RAM' }));
    });
  }
}

module.exports = Diagnostics;
