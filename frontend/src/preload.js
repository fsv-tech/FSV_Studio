'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fsv', {
  // Generation
  generate:        (params) => ipcRenderer.invoke('generate', params),
  cancelGenerate:  ()       => ipcRenderer.invoke('generate:cancel'),
  // Config
  loadPresets:     ()       => ipcRenderer.invoke('config:presets'), // FIX #9: expose presets.json to renderer
  // Queue
  addToQueue:      (params) => ipcRenderer.invoke('queue:add', params),
  startQueue:      ()       => ipcRenderer.invoke('queue:start'),
  clearQueue:      ()       => ipcRenderer.invoke('queue:clear'),
  setQueueSettings:(s)      => ipcRenderer.invoke('queue:settings', s), // FIX: was missing - delay/autoShutdown never reached Queue
  // Diagnostics
  runDiagnostics:  ()       => ipcRenderer.invoke('diag:run'),
  fixIssue:        (key)    => ipcRenderer.invoke('diag:fix', key),
  // File
  openOutput:      (p)      => ipcRenderer.invoke('output:open', p),
  // Window
  minimizeWindow:  ()       => ipcRenderer.send('window:minimize'),
  maximizeWindow:  ()       => ipcRenderer.send('window:maximize'),
  closeWindow:     ()       => ipcRenderer.send('window:close'),
  // Events → renderer
  onProgress:      (cb) => ipcRenderer.on('job:progress',  (_, d) => cb(d)),
  onJobComplete:   (cb) => ipcRenderer.on('job:complete',  (_, d) => cb(d)),
  onQueueUpdate:   (cb) => ipcRenderer.on('queue:update',  (_, d) => cb(d)),
  onDiagResult:    (cb) => ipcRenderer.on('diag:result',   (_, d) => cb(d)),
  onLog:           (cb) => ipcRenderer.on('diag:log',      (_, d) => cb(d)),
  onGpuInfo:       (cb) => ipcRenderer.on('gpu:info',      (_, d) => cb(d)),
});
