/**
 * FSV Studio — Electron Main Process
 */
'use strict';

const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const fs   = require('fs');

// ── Backend modules ────────────────────────────────────────────────────────
const Hardware     = require('../backend/src/hardware');
const JobManager   = require('../backend/src/jobManager');
const Queue        = require('../backend/src/queue');
const PythonBridge = require('../backend/src/pythonBridge');
const Diagnostics  = require('../backend/src/diagnostics');

let win;
let hardware, jobManager, queue, pythonBridge, diagnostics;
let gpuInfoCache = null; // FIX: cache so we can send after page load

// ── Window ─────────────────────────────────────────────────────────────────
function createWindow() {
  win = new BrowserWindow({
    width:  1280,
    height: 820,
    minWidth:  1000,
    minHeight: 680,
    frame: false,
    backgroundColor: '#F7F6F2',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
  });

  win.loadFile(path.join(__dirname, 'index.html'));

  // FIX: Send gpu:info only after the renderer has finished loading and
  // registered its IPC listeners. Previously this was sent immediately after
  // createWindow(), which is a race condition — the renderer wasn't ready yet.
  win.webContents.on('did-finish-load', () => {
    if (gpuInfoCache) {
      win.webContents.send('gpu:info', gpuInfoCache);
    }
  });

  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools();
  }
}

// ── Bootstrap ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createWindow();

  try {
    pythonBridge = new PythonBridge();
    hardware     = new Hardware();
    jobManager   = new JobManager(pythonBridge);
    queue        = new Queue(jobManager);
    diagnostics  = new Diagnostics(pythonBridge);

    // Forward progress events to renderer
    jobManager.on('progress', (data) => {
      win?.webContents.send('job:progress', data);
    });

    jobManager.on('complete', (data) => {
      win?.webContents.send('job:complete', data);
    });

    jobManager.on('error', (data) => {
      win?.webContents.send('job:complete', { success: false, ...data });
    });

    queue.on('update', (jobs) => {
      win?.webContents.send('queue:update', jobs);
    });

    diagnostics.on('result', (results) => {
      win?.webContents.send('diag:result', results);
    });

    diagnostics.on('log', (msg) => {
      win?.webContents.send('diag:log', msg);
    });

    // FIX: Detect GPU and cache the result. It will be sent to the renderer
    // in the did-finish-load handler above, avoiding the race condition where
    // the event fired before the renderer registered its listener.
    gpuInfoCache = await hardware.detect();

    // Run diagnostics silently on startup
    diagnostics.runAll();

  } catch (err) {
    console.error('Bootstrap error:', err);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ── IPC Handlers ───────────────────────────────────────────────────────────
ipcMain.handle('generate', async (_, params) => {
  return jobManager.generate(params);
});

// FIX: cancelGenerate was called in the UI (doCancelGenerate) but had no
// corresponding handler in main.js or preload.js — clicking Cancel threw an error.
ipcMain.handle('generate:cancel', async () => {
  return jobManager.cancel();
});

ipcMain.handle('queue:add', async (_, params) => {
  return queue.add(params);
});

ipcMain.handle('queue:start', async () => {
  return queue.start();
});

ipcMain.handle('queue:clear', async () => {
  return queue.clear();
});

// FIX: The UI has a delay slider and auto-shutdown toggle in the Queue panel
// but their values were never sent to the Queue instance. Now the UI calls
// setQueueSettings whenever these controls change.
ipcMain.handle('queue:settings', async (_, settings) => {
  if (settings.clipDelay    != null) queue.clipDelay    = settings.clipDelay;
  if (settings.autoShutdown != null) queue.autoShutdown = settings.autoShutdown;
});

ipcMain.handle('diag:run', async () => {
  return diagnostics.runAll();
});

ipcMain.handle('diag:fix', async (_, key) => {
  return diagnostics.fix(key);
});

ipcMain.handle('output:open', async (_, filePath) => {
  shell.showItemInFolder(filePath);
});

// FIX #9: serve presets.json to the renderer so PRESETS are user-editable
// without touching source code. Falls back gracefully if file is missing.
ipcMain.handle('config:presets', async () => {
  const presetsPath = path.join(__dirname, '../config/presets.json');
  try {
    const raw = fs.readFileSync(presetsPath, 'utf8');
    return JSON.parse(raw).presets || [];
  } catch {
    return [];
  }
});

ipcMain.on('window:minimize', () => win?.minimize());
ipcMain.on('window:maximize', () => win?.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on('window:close',    () => win?.close());
