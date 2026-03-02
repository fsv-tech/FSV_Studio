'use strict';
const EventEmitter = require('events');
const path         = require('path');
const fs           = require('fs');

class JobManager extends EventEmitter {
  constructor(pythonBridge) {
    super();
    this.bridge      = pythonBridge;
    this.activeJob   = null;
    this.outputsDir  = path.join(__dirname, '../../jobs');
    this._cancelled  = false;
    fs.mkdirSync(this.outputsDir, { recursive: true });
  }

  async generate(params) {
    const jobId    = `job_${Date.now()}`;
    const jobDir   = path.join(this.outputsDir, jobId);
    fs.mkdirSync(jobDir, { recursive: true });

    const stateFile  = path.join(jobDir, 'state.json');
    const safeLen    = params.gpuProfile?.safeClipLength || 8;
    const duration   = params.duration || 8;
    const totalClips = Math.ceil(duration / safeLen);

    const state = {
      jobId,
      params,
      totalClips,
      completedClips: 0,
      clips: [],
      status: 'running',
      startedAt: new Date().toISOString(),
    };

    this._saveState(stateFile, state);
    this.activeJob  = { jobId, state, stateFile, jobDir };
    this._cancelled = false;

    try {
      for (let i = 0; i < totalClips; i++) {
        // FIX #2: Remove redundant flag check here. Cancellation is fully
        // handled by bridge.cancel() sending SIGTERM to the active process,
        // which causes bridge.generate() / extractFrame() to reject with an
        // error. That rejection propagates here and is caught below.
        // Keeping a separate flag check is misleading because it only fires
        // between clips (not mid-clip), giving a false sense of responsiveness.

        const clipPath     = path.join(jobDir, `clip_${String(i).padStart(3, '0')}.mp4`);
        const initFrame    = i > 0 ? path.join(jobDir, `frame_${String(i-1).padStart(3, '0')}.png`) : null;
        const clipDuration = (i === totalClips - 1)
          ? duration - (safeLen * i)
          : safeLen;

        this.emit('progress', {
          jobId, step: i * 10, total: totalClips * 10,
          label: `Generating clip ${i + 1} of ${totalClips}...`,
        });

        await this.bridge.generate({
          ...params,
          jobId,
          clipIndex:  i,
          duration:   Math.max(2, clipDuration),
          outputPath: clipPath,
          initFrame,
          onProgress: (step, total, label) => {
            this.emit('progress', {
              jobId,
              step:  i * 10 + Math.round((step / total) * 10),
              total: totalClips * 10,
              label: label || `Clip ${i + 1}/${totalClips} — step ${step}/${total}`,
            });
          },
          onSeed: (seed) => {
            this.emit('progress', { jobId, seed });
          },
        });

        state.clips.push(clipPath);
        state.completedClips = i + 1;
        this._saveState(stateFile, state);

        // Extract last frame for continuity (also cancellable via bridge)
        if (i < totalClips - 1) {
          const framePath = path.join(jobDir, `frame_${String(i).padStart(3, '0')}.png`);
          await this.bridge.extractFrame(clipPath, framePath);
        }
      }

      // Stitch if multiple clips (also cancellable via bridge)
      let finalPath;
      if (totalClips > 1) {
        finalPath = path.join(jobDir, 'output.mp4');
        await this.bridge.stitchClips(state.clips, finalPath);
      } else {
        finalPath = state.clips[0];
      }

      state.status     = 'done';
      state.outputPath = finalPath;
      this._saveState(stateFile, state);

      this.emit('complete', { jobId, success: true, outputPath: finalPath });
      return { jobId, outputPath: finalPath };

    } catch (err) {
      // bridge.cancel() causes rejections with 'cancelled' message or null exit code
      const wasCancelled = this._cancelled ||
        err.message === 'cancelled' ||
        err.message === 'Python process was cancelled';

      state.status = wasCancelled ? 'cancelled' : 'error';
      state.error  = err.message;
      this._saveState(stateFile, state);

      if (wasCancelled) {
        this.emit('complete', { jobId, success: false, cancelled: true });
      } else {
        this.emit('error', { jobId, error: err.message });
      }
      throw err;
    }
  }

  cancel() {
    this._cancelled = true;
    this.bridge.cancel();
  }

  _saveState(file, state) {
    try { fs.writeFileSync(file, JSON.stringify(state, null, 2)); } catch {}
  }

  /** Resume an interrupted job from its state file */
  async resume(stateFile) {
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (state.status === 'done') return state.outputPath;
    state.params.resumeFromClip = state.completedClips;
    return this.generate(state.params);
  }
}

module.exports = JobManager;
