# FSV Studio

AI video generation desktop app built with Electron + LTX-2.

## Project Structure

```
fsv-studio/
├── package.json
├── config/
│   ├── config.json          # pythonPath, outputsDir, ffmpegPath, theme
│   └── presets.json         # style preset definitions
├── frontend/
│   ├── main.js              # Electron main process
│   ├── preload.js           # contextBridge IPC bridge
│   ├── index.html           # App UI
│   ├── app.js               # Renderer logic
│   └── styles/
│       └── app.css          # All styles
├── backend/
│   └── src/
│       ├── hardware.js      # GPU detection + hardware profiles
│       ├── jobManager.js    # Job orchestration, multi-clip, resume
│       ├── queue.js         # Batch queue runner
│       ├── pythonBridge.js  # Spawns generate.py, parses PROGRESS:
│       └── diagnostics.js   # System health checks
├── engine/                  # Python environment (created by install.ps1)
│   ├── .venv/
│   └── generate.py          # NOT included — created by installer
├── models/                  # LTX-2 model weights (downloaded by installer)
│   └── ltx-2/
├── bin/                     # Optional local ffmpeg.exe
└── jobs/                    # Generated output files (created at runtime)
```

## Setup

```
npm install
npm start          # production
npm run dev        # with DevTools
```

Python, PyTorch, and models must be installed separately via `installer/install.ps1`.

---

## Bugs Fixed (v1.0.0 → patched)

| # | File | Bug | Fix |
|---|------|-----|-----|
| 1 | `preload.js` / `main.js` | `cancelGenerate` had no IPC handler — clicking Cancel threw an uncaught error | Added `generate:cancel` handler wired to `jobManager.cancel()` |
| 2 | `main.js` | `gpu:info` sent before renderer loaded — race condition left `S.gpuProfile` always null | Moved send to `did-finish-load` event |
| 3 | `pythonBridge.js` | `seed`, `cfg`, `fps`, `negPrompt` collected in UI but never passed as CLI args to `generate.py` | Added `--seed`, `--cfg_scale`, `--fps`, `--negative_prompt` args |
| 4 | `pythonBridge.js` / `jobManager.js` | Image-to-video mode set `mode:'image'` but no image path was ever extracted or passed to Python | `buildParams()` now reads `file.path` from the file input; passed as `--image_path` |
| 5 | `queue.js` / `main.js` | Delay slider and auto-shutdown toggle were purely cosmetic — values never reached `Queue` instance | Added `queue:settings` IPC handler; UI calls `fsv.setQueueSettings()` on change |
| 6 | `app.js` | `addToLibrary` called `buildParams()` at completion — if user edited form during generation, wrong metadata was saved | Params captured at job start and threaded through to `finishGenerate` |
| 7 | `queue.js` | `shutdown /s` used unconditionally — would fail or error on macOS/Linux | Guarded with `process.platform` check |
| 8 | `app.js` | `S.library` grew unbounded in localStorage — would eventually hit 5 MB limit | Capped at 500 entries |
