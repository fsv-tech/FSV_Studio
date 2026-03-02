'use strict';
const { exec } = require('child_process');

/**
 * Detects GPU, maps to hardware profile, returns profile object.
 * Profile controls: safeClipLength, resolution, dtype, cpuOffload, vaeTiling
 */
class Hardware {
  async detect() {
    try {
      const gpu = await this._nvidiaSmi();
      return this._buildProfile(gpu);
    } catch {
      return this._buildProfile({ name: 'Unknown', vram: 0 });
    }
  }

  _nvidiaSmi() {
    return new Promise((res, rej) => {
      exec(
        'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader,nounits',
        (err, stdout) => {
          if (err) return rej(err);
          const parts = stdout.trim().split(',');
          const name  = parts[0]?.trim() || 'Unknown GPU';
          const vram  = parseInt(parts[1]?.trim()) || 0; // MiB
          res({ name, vram: Math.round(vram / 1024) }); // convert to GB
        }
      );
    });
  }

  _buildProfile(gpu) {
    const vram = gpu.vram || 0;
    let profile;

    if (vram >= 24) {
      profile = {
        tier:           'high',
        safeClipLength: 16,
        defaultRes:     '1280x720',
        dtype:          'fp16',
        cpuOffload:     false,
        vaeTiling:      false,
        steps:          25,
      };
    } else if (vram >= 16) {
      profile = {
        tier:           'mid-high',
        safeClipLength: 12,
        defaultRes:     '768x768',
        dtype:          'fp16',
        cpuOffload:     false,
        vaeTiling:      true,
        steps:          20,
      };
    } else if (vram >= 10) {
      profile = {
        tier:           'mid',
        safeClipLength: 10,
        defaultRes:     '768x512',
        dtype:          'fp16',
        cpuOffload:     false,
        vaeTiling:      true,
        steps:          20,
      };
    } else if (vram >= 8) {
      profile = {
        tier:           'entry',
        safeClipLength: 8,
        defaultRes:     '512x512',
        dtype:          'fp8',
        cpuOffload:     true,
        vaeTiling:      true,
        steps:          20,
      };
    } else {
      profile = {
        tier:           'low',
        safeClipLength: 5,
        defaultRes:     '512x512',
        dtype:          'fp8',
        cpuOffload:     true,
        vaeTiling:      true,
        steps:          15,
      };
    }

    return { ...profile, name: gpu.name, vram };
  }

  // NOTE (#12): getSystemInfo() is defined but not currently called anywhere.
  // Wired up here for future use by the diagnostics or settings panels.
  async getSystemInfo() {
    const si = require('systeminformation');
    const [cpu, mem, disk] = await Promise.all([
      si.cpu(),
      si.mem(),
      si.fsSize(),
    ]);
    return {
      cpu:      `${cpu.manufacturer} ${cpu.brand}`,
      ram:      Math.round(mem.total / 1024 ** 3),
      diskFree: Math.round(disk[0]?.available / 1024 ** 3 || 0),
    };
  }
}

module.exports = Hardware;
