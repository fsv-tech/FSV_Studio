'use strict';
const { spawn } = require('child_process');
const path      = require('path');
const fs        = require('fs');

class PythonBridge {
  constructor() {
    this.pythonPath  = this._findPython();
    this.engineDir   = path.join(__dirname, '../../engine');
    this._activeProc = null; // tracks Python generation process
    this._activeFFmpeg = null; // FIX #1: track ffmpeg procs so cancel() kills them too
  }

  _findPython() {
    // Try reading saved path from installer config
    const cfgPath = path.join(__dirname, '../../config/config.json');
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        // FIX #8: pythonPath in shipped config is null, not "". Guard both.
        if (cfg.pythonPath && fs.existsSync(cfg.pythonPath)) return cfg.pythonPath;
      } catch {}
    }

    // Try local venv
    const venvPy = path.join(__dirname, '../../engine/.venv/Scripts/python.exe');
    if (fs.existsSync(venvPy)) return venvPy;

    // Fall back to system py -3.11
    return 'py -3.11';
  }

  generate(params) {
    return new Promise((resolve, reject) => {
      const args = [
        path.join(this.engineDir, 'generate.py'),
        '--job_id',      params.jobId,
        '--prompt',      params.prompt,
        '--width',       String(params.width   || 512),
        '--height',      String(params.height  || 512),
        '--clip_length', String(params.duration || 8),
        '--steps',       String(params.steps    || 20),
        '--fps',         String(params.fps      || 24),
        '--output',      params.outputPath,
      ];

      if (params.cfg      != null) args.push('--cfg_scale',       String(params.cfg));
      if (params.seed     != null) args.push('--seed',            String(params.seed));
      if (params.negPrompt)        args.push('--negative_prompt', params.negPrompt);
      if (params.imagePath)        args.push('--image_path',      params.imagePath);
      if (params.initFrame)        args.push('--init_frame',      params.initFrame);
      if (params.dtype)            args.push('--dtype',           params.dtype);
      if (params.cpuOffload)       args.push('--cpu_offload');
      if (params.vaeTiling)        args.push('--vae_tiling');
      if (params.attn)             args.push('--attn',            params.attn);

      const pythonCmd = this.pythonPath.includes(' ')
        ? this.pythonPath.split(' ')
        : [this.pythonPath];

      const proc = spawn(pythonCmd[0], [...pythonCmd.slice(1), ...args], {
        cwd: this.engineDir,
        env: { ...process.env },
      });

      this._activeProc = proc;

      proc.stdout.on('data', (data) => {
        const text = data.toString();
        text.split('\n').forEach(line => {
          if (line.startsWith('PROGRESS:')) {
            const parts = line.slice(9).split(':');
            const step  = parseInt(parts[0]);
            const total = parseInt(parts[1]);
            const label = parts[2] || '';
            params.onProgress?.(step, total, label);
          }
          if (line.startsWith('SEED:')) {
            const seed = parseInt(line.slice(5).trim());
            if (!isNaN(seed)) params.onSeed?.(seed);
          }
        });
      });

      proc.stderr.on('data', (d) => console.error('[Python]', d.toString()));

      proc.on('close', (code) => {
        this._activeProc = null;
        if (code === 0) resolve();
        else if (code === null) reject(new Error('Python process was cancelled'));
        else reject(new Error(`Python exited with code ${code}`));
      });

      proc.on('error', (err) => {
        this._activeProc = null;
        reject(err);
      });
    });
  }

  // FIX #1: cancel() now kills both active Python and active FFmpeg processes.
  // Previously only _activeProc (Python) was tracked; cancelling during frame
  // extraction or stitching silently did nothing.
  cancel() {
    if (this._activeProc) {
      this._activeProc.kill('SIGTERM');
      this._activeProc = null;
    }
    if (this._activeFFmpeg) {
      this._activeFFmpeg.kill('SIGTERM');
      this._activeFFmpeg = null;
    }
  }

  extractFrame(videoPath, outputPath) {
    return new Promise((resolve, reject) => {
      const ffmpeg = this._findFfmpeg();
      const proc   = spawn(ffmpeg, [
        '-sseof', '-0.1',
        '-i', videoPath,
        '-vframes', '1',
        '-y', outputPath,
      ]);
      // FIX #1: track so cancel() can kill this too
      this._activeFFmpeg = proc;
      proc.on('close', (c) => {
        this._activeFFmpeg = null;
        c === 0 ? resolve() : reject(new Error('ffmpeg frame extract failed'));
      });
      proc.on('error', (err) => {
        this._activeFFmpeg = null;
        reject(err);
      });
    });
  }

  stitchClips(clipPaths, outputPath) {
    return new Promise((resolve, reject) => {
      const listFile = outputPath + '.txt';

      // FIX #7: use forward slashes and double-quote entries so this works on
      // Windows. The previous bash-style '\'' escape is a no-op on Windows FFmpeg.
      const content = clipPaths
        .map(p => `file '${p.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`)
        .join('\n');
      fs.writeFileSync(listFile, content);

      const ffmpeg = this._findFfmpeg();
      const proc   = spawn(ffmpeg, [
        '-f', 'concat', '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-y', outputPath,
      ]);

      // FIX #1: track so cancel() can kill this too
      this._activeFFmpeg = proc;

      proc.on('close', (c) => {
        this._activeFFmpeg = null;
        try { fs.unlinkSync(listFile); } catch {}
        if (c === 0) resolve();
        else reject(new Error('ffmpeg stitch failed'));
      });

      proc.on('error', (err) => {
        this._activeFFmpeg = null;
        reject(err);
      });
    });
  }

  _findFfmpeg() {
    const local = path.join(__dirname, '../../bin/ffmpeg.exe');
    return fs.existsSync(local) ? local : 'ffmpeg';
  }
}

module.exports = PythonBridge;
