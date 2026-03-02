'use strict';
const EventEmitter = require('events');
const { exec }     = require('child_process');

class Queue extends EventEmitter {
  constructor(jobManager) {
    super();
    this.jobManager   = jobManager;
    this.jobs         = [];
    this.running      = false;
    this.autoShutdown = false;
    this.clipDelay    = 30; // seconds — now writable from main.js via queue:settings IPC
  }

  add(params) {
    const job = {
      id:       `q_${Date.now()}`,
      params,
      status:   'waiting',
      prompt:   params.prompt,
      width:    params.width,
      height:   params.height,
      duration: params.duration,
      fps:      params.fps,
      cfg:      params.cfg,
    };
    this.jobs.push(job);
    this._emit();
    return job;
  }

  clear() {
    if (!this.running) {
      this.jobs = [];
      this._emit();
    }
  }

  async start() {
    if (this.running) return;
    this.running = true;

    for (const job of this.jobs) {
      if (job.status === 'done') continue;
      job.status = 'running';
      this._emit();

      try {
        await this.jobManager.generate(job.params);
        job.status = 'done';
      } catch (err) {
        job.status = 'error';
        job.error  = err.message;
      }

      this._emit();

      // Cool-down delay between jobs
      if (this.clipDelay > 0 && this.jobs.indexOf(job) < this.jobs.length - 1) {
        await this._sleep(this.clipDelay * 1000);
      }
    }

    this.running = false;

    if (this.autoShutdown) {
      // FIX: guard against running shutdown command on non-Windows platforms.
      // The original used a Windows-only command unconditionally.
      if (process.platform === 'win32') {
        exec('shutdown /s /t 60 /c "FSV Studio queue complete. Shutting down in 60 seconds."');
      } else if (process.platform === 'linux') {
        exec('shutdown -h +1 "FSV Studio queue complete. Shutting down in 60 seconds."');
      } else if (process.platform === 'darwin') {
        exec('sudo shutdown -h +1');
      }
    }
  }

  _emit() {
    this.emit('update', this.jobs.map(j => ({
      id:       j.id,
      prompt:   j.prompt,
      width:    j.width,
      height:   j.height,
      duration: j.duration,
      fps:      j.fps,
      cfg:      j.cfg,
      status:   j.status,
      error:    j.error,
    })));
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
}

module.exports = Queue;
