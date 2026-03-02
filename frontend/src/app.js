'use strict';

/* ── IPC shim ── */
const fsv = window.fsv || {
  generate:          async (p) => { console.log('generate', p); return {} },
  cancelGenerate:    async ()  => {},
  addToQueue:        async (p) => {},
  startQueue:        async ()  => {},
  clearQueue:        async ()  => {},
  setQueueSettings:  async (s) => {},
  runDiagnostics:    async ()  => {},
  fixIssue:          async (k) => {},
  openOutput:        async (p) => {},
  minimizeWindow:    ()  => {},
  maximizeWindow:    ()  => {},
  closeWindow:       ()  => {},
  onProgress:        (cb) => {},
  onJobComplete:     (cb) => {},
  onQueueUpdate:     (cb) => {},
  onDiagResult:      (cb) => {},
  onLog:             (cb) => {},
  onGpuInfo:         (cb) => {},
};

/* ── State ── */
const S = {
  theme:        localStorage.getItem('fsv-theme') || 'nebula',
  mode:         'text',
  preset:       null,
  duration:     8,
  generating:   false,
  seedLocked:   false,
  currentSeed:  null,
  queue:        [],
  recent:       JSON.parse(localStorage.getItem('fsv-recent') || '[]'),
  // FIX #6: trim on load so a pre-cap library from an older version doesn't
  // bloat memory. The write-side cap (500 entries) alone isn't enough.
  library:      (() => { const l = JSON.parse(localStorage.getItem('fsv-library') || '[]'); return l.length > 500 ? l.slice(0, 500) : l; })(),
  characters:   JSON.parse(localStorage.getItem('fsv-chars')    || '[]'),
  projects:     JSON.parse(localStorage.getItem('fsv-projects') || '[]'),
  gpuProfile:   null,
  editCharId:   null,
  currentVideo: null,  // { path, name, duration }
  loopEnabled:  true,
  settings:     JSON.parse(localStorage.getItem('fsv-settings') || '{}'),
};

// FIX #9: PRESETS are loaded from config/presets.json at boot (via fsv.loadPresets)
// so they can be edited without touching source code. The hardcoded array
// below is the fallback used in the browser shim / dev mode only.
const PRESETS_FALLBACK = [
  { id:'none',        label:'None',        mod:'' },
  { id:'cinematic',   label:'Cinematic',   mod:'35mm film, dramatic lighting, anamorphic lens, cinematic color grade' },
  { id:'anime',       label:'Anime',       mod:'cel shaded, vibrant colors, Japanese animation style, clean lines' },
  { id:'documentary', label:'Documentary', mod:'natural lighting, handheld realism, muted tones, observational' },
  { id:'cyberpunk',   label:'Cyberpunk',   mod:'neon lights, rain-soaked streets, high contrast, dystopian atmosphere' },
  { id:'nature',      label:'Nature',      mod:'macro photography, golden hour, nature documentary, BBC Earth style' },
  { id:'scifi',       label:'Sci-Fi',      mod:'futuristic, clean design, space, epic scale, high tech' },
  { id:'horror',      label:'Horror',      mod:'dark atmosphere, unsettling, low key lighting, building tension' },
  { id:'vhs',         label:'VHS',         mod:'VHS tape, film grain, scan lines, 80s aesthetic, retro' },
  { id:'3d',          label:'3D Render',   mod:'photorealistic 3D render, subsurface scattering, ray tracing, Octane' },
];
let PRESETS = PRESETS_FALLBACK;

const RANDOMS = [
  'A lone astronaut walking across a rust-red Martian desert, dust swirling, golden hour light',
  'Bioluminescent jellyfish drifting through a midnight ocean, slow motion, 8K',
  'Cherry blossoms falling in slow motion over a Kyoto temple at sunrise',
  'A wolf running through a snowy pine forest at golden hour, low angle shot',
  'Storm clouds gathering over the Grand Canyon at dusk, timelapse',
  'A hummingbird hovering at a tropical flower, extreme close-up, shallow depth of field',
  'City lights reflecting on rain-soaked streets at night, bokeh, cinematic',
  'Northern lights dancing over an icy tundra landscape, vivid and hypnotic',
  'Close-up of sand dunes shifting in the desert wind, warm afternoon light',
  'A lone sailboat crossing calm open ocean at sunrise, aerial view',
  'Slow zoom into a massive waterfall in a misty rainforest, drone shot',
  'Timelapse of a seed sprouting and growing into a flower over 10 seconds',
];

/* ── DOM shortcuts ── */
const $  = id  => document.getElementById(id);
const $$ = sel => [...document.querySelectorAll(sel)];
const html = document.documentElement;

/* ══════════════════════════════════════════
   BOOT
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  // FIX #9: load presets from config/presets.json so they're user-editable
  if (typeof fsv.loadPresets === 'function') {
    try {
      const loaded = await fsv.loadPresets();
      if (Array.isArray(loaded) && loaded.length) {
        // Ensure 'None' is always first
        const hasNone = loaded.some(p => p.id === 'none');
        PRESETS = hasNone ? loaded : [{ id:'none', label:'None', mod:'' }, ...loaded];
      }
    } catch (e) {
      console.warn('Could not load presets.json, using defaults', e);
    }
  }
  applyTheme(S.theme);
  applySettings();
  buildPresets();
  renderCharacters();
  renderProjects();
  updateProjectSelect();
  updateClipNotice();
  renderLibrary();
  renderRecent();
  bindAll();
  bindIPC();
});

/* ══════════════════════════════════════════
   THEME
══════════════════════════════════════════ */
function applyTheme(t) {
  S.theme = t;
  html.setAttribute('data-theme', t);
  localStorage.setItem('fsv-theme', t);
  $$('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.dot === t));
}

/* ══════════════════════════════════════════
   SETTINGS
══════════════════════════════════════════ */
function applySettings() {
  const def = {
    outputDir: '',
    defaultRes: '1280x720',
    defaultFps: '24',
    vram: '8',
    attn: 'sdpa',
    cpuOffload: false,
    fp8: false,
    showSteps: true,
    autoplay: true,
  };
  S.settings = { ...def, ...S.settings };

  $('setting-output-dir').value   = S.settings.outputDir;
  $('setting-default-res').value  = S.settings.defaultRes;
  $('setting-default-fps').value  = S.settings.defaultFps;
  $('setting-vram').value         = S.settings.vram;
  $('vram-val').textContent       = S.settings.vram + ' GB';
  $('setting-attn').value         = S.settings.attn;
  $('setting-cpu-offload').checked= S.settings.cpuOffload;
  $('setting-fp8').checked        = S.settings.fp8;
  $('setting-show-steps').checked = S.settings.showSteps;
  $('setting-autoplay').checked   = S.settings.autoplay;

  // apply defaults to generate panel
  $('resolution').value = S.settings.defaultRes;
  $('fps').value        = S.settings.defaultFps;
}

function saveSettings() {
  S.settings = {
    outputDir:  $('setting-output-dir').value,
    defaultRes: $('setting-default-res').value,
    defaultFps: $('setting-default-fps').value,
    vram:       $('setting-vram').value,
    attn:       $('setting-attn').value,
    cpuOffload: $('setting-cpu-offload').checked,
    fp8:        $('setting-fp8').checked,
    showSteps:  $('setting-show-steps').checked,
    autoplay:   $('setting-autoplay').checked,
  };
  localStorage.setItem('fsv-settings', JSON.stringify(S.settings));
  showToast('Settings saved');
}

/* ══════════════════════════════════════════
   BINDINGS
══════════════════════════════════════════ */
function bindAll() {
  // Titlebar
  $$('.theme-dot').forEach(d => d.onclick = () => applyTheme(d.dataset.dot));
  $('btn-min').onclick   = () => fsv.minimizeWindow();
  $('btn-max').onclick   = () => fsv.maximizeWindow();
  $('btn-close').onclick = () => fsv.closeWindow();

  // Nav
  $$('.nav-btn').forEach(b => b.onclick = () => switchPanel(b.dataset.panel));

  // Mode tabs
  $$('.mode-tab').forEach(t => t.onclick = () => switchMode(t.dataset.mode));

  // Prompt
  $('prompt-input').oninput = updateCharCount;
  $('btn-random').onclick   = randomPrompt;
  $('btn-inject-char').onclick = toggleCharPicker;
  document.addEventListener('click', e => {
    if (!e.target.closest('#char-picker') && !e.target.closest('#btn-inject-char')) {
      $('char-picker').classList.add('hidden');
    }
  });

  // Duration
  $('duration').oninput = onDurationChange;

  // CFG
  $('cfg-scale').oninput = () => {
    $('cfg-val').textContent = parseFloat($('cfg-scale').value).toFixed(1);
  };

  // Seed
  $('btn-rand-seed').onclick  = randomSeed;
  $('btn-lock-seed').onclick  = toggleSeedLock;

  // Collapsible sections
  $$('.sidebar-collapse-btn').forEach(h => h.onclick = () => toggleSection(h.dataset.target));

  // Generate + cancel
  $('btn-generate').onclick = doGenerate;
  $('btn-queue').onclick    = doAddQueue;
  $('btn-cancel').onclick   = doCancelGenerate;

  // Video controls
  bindVideoControls();

  // Image drop
  bindDrop();

  // Queue
  $('btn-start-queue').onclick = () => fsv.startQueue();
  $('btn-clear-queue').onclick = () => { fsv.clearQueue(); S.queue = []; renderQueue(); };

  // FIX: delay slider and auto-shutdown toggle were purely cosmetic — their
  // values were never sent to the backend Queue instance. Now we call
  // setQueueSettings whenever either control changes.
  function syncQueueSettings() {
    fsv.setQueueSettings({
      clipDelay:    parseInt($('delay').value),
      autoShutdown: $('auto-shutdown').checked,
    });
  }
  $('delay').oninput = () => {
    $('delay-val').textContent = $('delay').value + ' s';
    syncQueueSettings();
  };
  $('auto-shutdown').onchange = syncQueueSettings;

  // Library
  $('library-search').oninput = renderLibrary;
  $('library-sort').onchange  = renderLibrary;

  // Projects
  $('btn-new-project').onclick = newProject;

  // Characters
  $('btn-new-char').onclick = () => openCharModal();
  $('modal-close').onclick  = closeCharModal;
  $('modal-cancel').onclick = closeCharModal;
  $('modal-save').onclick   = saveChar;
  $('char-modal').onclick   = e => { if (e.target === $('char-modal')) closeCharModal(); };

  // Diagnostics
  $('btn-run-diag').onclick = () => fsv.runDiagnostics();

  // Settings
  $('btn-save-settings').onclick = saveSettings;
  $('setting-vram').oninput = () => { $('vram-val').textContent = $('setting-vram').value + ' GB'; };
}

/* ── Panel switch ── */
function switchPanel(panel) {
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.panel === panel));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${panel}`));
  if (panel === 'library') renderLibrary();
}

/* ── Mode switch ── */
function switchMode(mode) {
  S.mode = mode;
  $$('.mode-tab').forEach(t => t.classList.toggle('active', t.dataset.mode === mode));
  $$('.mode-pane').forEach(p => p.classList.toggle('active', p.id === `mode-${mode}`));
}

/* ── Collapsible sections ── */
function toggleSection(id) {
  document.getElementById(id)?.classList.toggle('open');
}

/* ══════════════════════════════════════════
   PROMPT
══════════════════════════════════════════ */
function updateCharCount() {
  const n  = $('prompt-input').value.length;
  const el = $('char-count');
  el.textContent = `${n} / 500`;
  el.style.color = n > 450 ? 'var(--amber)' : '';
}

function randomPrompt() {
  $('prompt-input').value = RANDOMS[Math.floor(Math.random() * RANDOMS.length)];
  updateCharCount();
}

/* ── Character picker popover ── */
function toggleCharPicker() {
  const picker = $('char-picker');
  const btn    = $('btn-inject-char');
  const rect   = btn.getBoundingClientRect();

  if (!picker.classList.contains('hidden')) {
    picker.classList.add('hidden');
    return;
  }

  // Position below button
  picker.style.top  = (rect.bottom + 8) + 'px';
  picker.style.left = rect.left + 'px';

  const list = $('char-picker-list');
  if (!S.characters.length) {
    list.innerHTML = '<div class="popover-empty">No characters saved yet</div>';
  } else {
    list.innerHTML = S.characters.map(c => `
      <button class="popover-item" data-id="${c.id}">
        <span class="popover-item-name">${esc(c.name)}</span>
        <span class="popover-item-desc">${esc(c.description.substring(0, 60))}${c.description.length > 60 ? '…' : ''}</span>
      </button>`).join('');
    $$('.popover-item').forEach(b => b.onclick = () => {
      const c = S.characters.find(x => x.id === b.dataset.id);
      if (!c) return;
      const cur = $('prompt-input').value.trim();
      $('prompt-input').value = cur ? `${cur}, ${c.description}` : c.description;
      updateCharCount();
      picker.classList.add('hidden');
    });
  }
  picker.classList.remove('hidden');
}

/* ══════════════════════════════════════════
   DURATION / CLIP NOTICE
══════════════════════════════════════════ */
function onDurationChange() {
  S.duration = parseInt($('duration').value);
  $('duration-val').textContent = fmtDuration(S.duration);
  updateClipNotice();
}

function fmtDuration(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function updateClipNotice() {
  const safe  = S.gpuProfile?.safeClipLength || 8;
  const el    = $('clip-notice');
  if (S.duration <= safe) { el.classList.add('hidden'); return; }
  const clips = Math.ceil(S.duration / safe);
  el.textContent = `Will be split into ${clips} clips of ~${safe}s each, then stitched. Overnight mode recommended.`;
  el.classList.remove('hidden');
}

/* ══════════════════════════════════════════
   PRESETS
══════════════════════════════════════════ */
function buildPresets() {
  $('preset-chips').innerHTML = '';
  PRESETS.forEach(p => {
    const c = document.createElement('button');
    c.className = 'chip' + (S.preset === p.id ? ' on' : '');
    c.textContent = p.label;
    c.onclick = () => { S.preset = S.preset === p.id ? null : p.id; buildPresets(); };
    $('preset-chips').appendChild(c);
  });
}

/* ══════════════════════════════════════════
   SEED
══════════════════════════════════════════ */
function randomSeed() {
  if (S.seedLocked) return;
  const s = Math.floor(Math.random() * 2147483647);
  $('seed-input').value = s;
  S.currentSeed = s;
  updateSeedDisplay();
}

function toggleSeedLock() {
  S.seedLocked = !S.seedLocked;
  $('btn-lock-seed').classList.toggle('active', S.seedLocked);
  $('seed-input').disabled = S.seedLocked;
}

function updateSeedDisplay() {
  const el = $('seed-display');
  if (S.currentSeed != null) {
    el.textContent = `Last seed: ${S.currentSeed}`;
    el.style.display = 'block';
  }
}

/* ══════════════════════════════════════════
   IMAGE DROP
══════════════════════════════════════════ */
function bindDrop() {
  const zone = $('image-drop');
  const inp  = $('image-file');
  $('btn-browse').onclick = e => { e.stopPropagation(); inp.click(); };
  inp.onchange = () => inp.files[0] && showThumb(inp.files[0]);
  zone.ondragover  = e => { e.preventDefault(); zone.classList.add('over'); };
  zone.ondragleave = () => zone.classList.remove('over');
  zone.ondrop = e => {
    e.preventDefault(); zone.classList.remove('over');
    const f = e.dataTransfer.files[0];
    if (f?.type.startsWith('image/')) showThumb(f);
  };
}

function showThumb(file) {
  const img = $('image-thumb');
  img.src = URL.createObjectURL(file);
  img.classList.remove('hidden');
  $('image-drop-body').style.opacity = '0';
}

/* ══════════════════════════════════════════
   GENERATE
══════════════════════════════════════════ */
function buildParams() {
  const prompt  = $('prompt-input').value.trim();
  const negProm = $('neg-prompt').value.trim();
  const preset  = PRESETS.find(p => p.id === S.preset);

  // FIX: image mode has its own prompt field; combine with preset modifier
  const basePrompt = S.mode === 'image'
    ? ($('image-prompt').value.trim() || prompt)
    : prompt;
  const full = preset?.mod ? `${basePrompt}, ${preset.mod}` : basePrompt;

  const [w, h]  = ($('resolution').value || '1280x720').split('x').map(Number);
  const q       = $('quality').value;
  const seed    = S.seedLocked ? S.currentSeed
                : ($('seed-input').value ? parseInt($('seed-input').value) : null);
  const name    = $('output-name').value.trim() || null;
  const project = $('save-to-project').value || null;

  // FIX: extract the actual image file path for image-to-video mode.
  // Previously S.mode was passed but no image data was ever included,
  // so image mode silently behaved identically to text mode.
  let imagePath = null;
  if (S.mode === 'image') {
    const fileInput = $('image-file');
    if (fileInput.files[0]) {
      imagePath = fileInput.files[0].path; // Electron exposes .path on File objects
    }
  }

  return {
    prompt:    full,
    negPrompt: negProm,
    width:     w, height: h,
    fps:       parseInt($('fps').value),
    duration:  S.duration,
    steps:     q === 'draft' ? 10 : q === 'quality' ? 30 : q === 'ultra' ? 50 : 20,
    cfg:       parseFloat($('cfg-scale').value),
    seed:      seed,
    mode:      S.mode,
    imagePath: imagePath,
    overnight: $('overnight').checked,
    outputName: name,
    project:   project,
  };
}

async function doGenerate() {
  if (S.generating) return;
  const prompt = $('prompt-input').value.trim();
  if (!prompt && S.mode === 'text') { $('prompt-input').focus(); return; }

  S.generating = true;
  $('btn-generate').disabled    = true;
  $('btn-generate').textContent = 'Generating…';
  setProgress(true);

  // FIX: capture params at job start and stash on S so the onJobComplete
  // handler can pass them to finishGenerate/addToLibrary
  const params = buildParams();
  S._activeParams = params;

  try {
    await fsv.generate(params);
  } catch (err) {
    console.error(err);
    finishGenerate(false, null, false, params);
  }
}

async function doAddQueue() {
  const prompt = $('prompt-input').value.trim();
  if (!prompt) { $('prompt-input').focus(); return; }
  await fsv.addToQueue(buildParams());
  switchPanel('queue');
  showToast('Added to queue');
}

async function doCancelGenerate() {
  await fsv.cancelGenerate();
  finishGenerate(false, null, true);
}

function setProgress(show) {
  $('preview-empty').style.display = show ? 'none' : '';
  $('preview-video').classList.add('hidden');
  $('preview-overlay').classList.toggle('hidden', !show);
  $('video-controls').classList.add('hidden');
  if (show) {
    $('progress-bar').style.width  = '0%';
    $('progress-sub').textContent  = 'Initialising…';
    $('progress-pct').textContent  = '0%';
    $('progress-steps').textContent = '';
    $('progress-phase').textContent = 'Generating';
  }
}

// FIX: accept params argument so addToLibrary always uses the params that were
// active when generation started, not whatever is in the form fields at completion.
function finishGenerate(ok, outputPath, cancelled = false, params = null) {
  S.generating = false;
  // FIX #10: always clear _activeParams here regardless of how finishGenerate
  // was called (direct cancel path or via onJobComplete). Without this, a
  // cancel followed immediately by a new job would use stale params in
  // onJobComplete until the new job's params arrive.
  S._activeParams = null;
  $('btn-generate').disabled    = false;
  $('btn-generate').textContent = 'Generate';

  if (ok && outputPath) {
    $('preview-overlay').classList.add('hidden');
    // Use captured params for the name; fall back to filename
    const displayName = (params?.outputName) || outputPath.split(/[\\/]/).pop();
    loadVideoIntoPreview(outputPath, displayName);
    // FIX: use captured params, not a fresh buildParams() call
    if (params) addToLibrary(outputPath, params);
    if (!S.seedLocked && S.currentSeed != null) updateSeedDisplay();
    if (S.settings.autoplay) $('preview-video').play();
  } else {
    setProgress(false);
    $('preview-empty').style.display = '';
    if (cancelled) showToast('Generation cancelled');
  }
}

/* ══════════════════════════════════════════
   VIDEO PLAYER
══════════════════════════════════════════ */
function loadVideoIntoPreview(path, name) {
  const vid = $('preview-video');
  vid.src   = path;
  vid.loop  = S.loopEnabled;
  vid.classList.remove('hidden');
  $('preview-empty').style.display = 'none';
  $('video-controls').classList.remove('hidden');
  $('vc-name').textContent = name || '';

  S.currentVideo = { path, name };

  vid.onloadedmetadata = () => {
    const dur = vid.duration;
    $('vc-dur').textContent = fmtTime(dur);
    $('timeline-scrubber').max = dur;
    buildWaveform(dur);
  };

  vid.ontimeupdate = () => {
    const t = vid.currentTime;
    $('vc-time').textContent = fmtTime(t);
    if (!vid.duration) return;
    $('timeline-scrubber').value = t;
  };

  const playIcon  = document.querySelector('.play-icon');
  const pauseIcon = document.querySelector('.pause-icon');
  vid.onplay  = () => { playIcon?.classList.add('hidden'); pauseIcon?.classList.remove('hidden'); };
  vid.onpause = () => { playIcon?.classList.remove('hidden'); pauseIcon?.classList.add('hidden'); };
  vid.onended = () => {
    if (!S.loopEnabled) { playIcon?.classList.remove('hidden'); pauseIcon?.classList.add('hidden'); }
  };

  addRecent(path, name);
}

function buildWaveform(dur) {
  // decorative waveform bars proportional to duration
  const el = $('timeline-waveform');
  const bars = Math.min(Math.floor(dur * 8), 200);
  el.innerHTML = '';
  for (let i = 0; i < bars; i++) {
    const b = document.createElement('span');
    b.className = 'wf-bar';
    const h = 20 + Math.random() * 80;
    b.style.height = h + '%';
    el.appendChild(b);
  }
}

function bindVideoControls() {
  $('btn-play').onclick = () => {
    const v = $('preview-video');
    v.paused ? v.play() : v.pause();
  };

  $('btn-skip-back').onclick = () => {
    const v = $('preview-video');
    v.currentTime = Math.max(0, v.currentTime - 5);
  };

  $('btn-skip-fwd').onclick = () => {
    const v = $('preview-video');
    v.currentTime = Math.min(v.duration || 0, v.currentTime + 5);
  };

  $('btn-loop').onclick = () => {
    S.loopEnabled = !S.loopEnabled;
    $('preview-video').loop = S.loopEnabled;
    $('btn-loop').classList.toggle('active', S.loopEnabled);
  };
  // default loop on
  $('btn-loop').classList.add('active');

  $('timeline-scrubber').oninput = () => {
    $('preview-video').currentTime = parseFloat($('timeline-scrubber').value);
  };

  $('btn-open-output').onclick = () => {
    if (S.currentVideo?.path) fsv.openOutput(S.currentVideo.path);
  };

  $('btn-fullscreen').onclick = () => {
    const v = $('preview-video');
    if (v.requestFullscreen) v.requestFullscreen();
  };
}

/* ══════════════════════════════════════════
   RECENT STRIP
══════════════════════════════════════════ */
function addRecent(path, name) {
  S.recent = S.recent.filter(r => r.path !== path);
  S.recent.unshift({ path, name: name || path.split('/').pop() });
  S.recent = S.recent.slice(0, 20);
  localStorage.setItem('fsv-recent', JSON.stringify(S.recent));
  renderRecent();
}

function renderRecent() {
  const row = $('recent-row');
  if (!S.recent.length) {
    row.innerHTML = '<span class="recent-none">No outputs yet</span>';
    return;
  }
  row.innerHTML = '';
  S.recent.slice(0, 12).forEach(r => {
    const item = document.createElement('div');
    item.className = 'recent-item';
    item.title = r.name;
    const vid = document.createElement('video');
    vid.src = r.path; vid.muted = true; vid.loop = true;
    item.appendChild(vid);
    item.onmouseenter = () => vid.play();
    item.onmouseleave = () => vid.pause();
    item.onclick = () => loadVideoIntoPreview(r.path, r.name);
    row.appendChild(item);
  });
}

/* ══════════════════════════════════════════
   LIBRARY
══════════════════════════════════════════ */
function addToLibrary(path, params) {
  const entry = {
    id:       Date.now() + '',
    path,
    name:     params.outputName || path.split(/[\\/]/).pop(),
    prompt:   params.prompt,
    width:    params.width,
    height:   params.height,
    fps:      params.fps,
    duration: params.duration,
    seed:     params.seed,
    cfg:      params.cfg,
    project:  params.project,
    created:  new Date().toISOString(),
  };
  S.library.unshift(entry);
  // FIX: cap library at 500 entries to prevent localStorage 5MB limit being hit
  if (S.library.length > 500) S.library = S.library.slice(0, 500);
  localStorage.setItem('fsv-library', JSON.stringify(S.library));
}

function renderLibrary() {
  const el    = $('library-grid');
  const query = ($('library-search')?.value || '').toLowerCase();
  const sort  = $('library-sort')?.value || 'newest';

  let items = S.library.filter(i =>
    !query || i.name.toLowerCase().includes(query) || i.prompt?.toLowerCase().includes(query)
  );

  if (sort === 'oldest')   items = [...items].reverse();
  if (sort === 'duration') items = [...items].sort((a, b) => b.duration - a.duration);

  if (!items.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-title">${query ? 'No results' : 'No outputs yet'}</div>
      <div class="empty-hint">${query ? 'Try a different search' : 'Generated videos will appear here'}</div>
    </div>`;
    return;
  }

  el.innerHTML = items.map(v => `
    <div class="lib-card" data-id="${v.id}" data-path="${esc(v.path)}">
      <div class="lib-thumb">
        <video src="${esc(v.path)}" muted loop preload="metadata"></video>
        <div class="lib-play-icon">▶</div>
      </div>
      <div class="lib-info">
        <div class="lib-name">${esc(v.name)}</div>
        <div class="lib-meta">${v.width}×${v.height} · ${fmtDuration(v.duration)} · ${v.fps}fps</div>
        ${v.seed != null ? `<div class="lib-seed">seed ${v.seed}</div>` : ''}
        <div class="lib-prompt">${esc((v.prompt || '').substring(0, 80))}${v.prompt?.length > 80 ? '…' : ''}</div>
      </div>
      <div class="lib-actions">
        <button class="ghost-btn lib-load" data-id="${v.id}">Load</button>
        <button class="ghost-btn lib-open" data-id="${v.id}">Show in folder</button>
        <button class="ghost-btn lib-del" data-id="${v.id}" style="color:var(--red)">Delete</button>
      </div>
    </div>`).join('');

  $$('.lib-card').forEach(card => {
    const vid = card.querySelector('video');
    card.onmouseenter = () => vid?.play();
    card.onmouseleave = () => vid?.pause();
  });

  $$('.lib-load').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const v = S.library.find(x => x.id === b.dataset.id);
    if (v) { loadVideoIntoPreview(v.path, v.name); switchPanel('generate'); }
  });

  $$('.lib-open').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const v = S.library.find(x => x.id === b.dataset.id);
    if (v) fsv.openOutput(v.path);
  });

  $$('.lib-del').forEach(b => b.onclick = e => {
    e.stopPropagation();
    if (!confirm('Remove from library?')) return;
    S.library = S.library.filter(x => x.id !== b.dataset.id);
    localStorage.setItem('fsv-library', JSON.stringify(S.library));
    renderLibrary();
  });
}

/* ══════════════════════════════════════════
   QUEUE
══════════════════════════════════════════ */
function renderQueue() {
  const el = $('queue-list');
  if (!S.queue.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-title">Queue is empty</div>
      <div class="empty-hint">Add jobs from the Generate panel to run overnight</div>
    </div>`;
    return;
  }
  el.innerHTML = S.queue.map((j, i) => `
    <div class="q-item">
      <span class="q-num">${i + 1}</span>
      <div class="q-info">
        <div class="q-prompt">${esc(j.prompt || 'Untitled')}</div>
        <div class="q-meta">${j.width}×${j.height} · ${fmtDuration(j.duration)} · ${j.fps}fps · cfg ${j.cfg ?? '7.5'}</div>
      </div>
      <span class="q-status q-${j.status || 'waiting'}">${j.status || 'waiting'}</span>
      <button class="q-remove" data-id="${j.id}">&#215;</button>
    </div>`).join('');

  $$('.q-remove').forEach(b => b.onclick = e => {
    e.stopPropagation();
    S.queue = S.queue.filter(j => j.id !== b.dataset.id);
    renderQueue();
  });
}

/* ══════════════════════════════════════════
   PROJECTS
══════════════════════════════════════════ */
function newProject() {
  const name = prompt('Project name:');
  if (!name?.trim()) return;
  S.projects.push({ id: Date.now() + '', name: name.trim(), created: new Date().toISOString() });
  localStorage.setItem('fsv-projects', JSON.stringify(S.projects));
  renderProjects();
  updateProjectSelect();
}

function renderProjects() {
  const el = $('projects-grid');
  if (!S.projects.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-title">No projects yet</div>
      <div class="empty-hint">Projects organise your generations into folders</div>
    </div>`; return;
  }
  el.innerHTML = S.projects.map(p => {
    const count = S.library.filter(v => v.project === p.id).length;
    return `<div class="p-card">
      <div class="p-name">${esc(p.name)}</div>
      <div class="p-meta">${count} output${count !== 1 ? 's' : ''} · ${new Date(p.created).toLocaleDateString()}</div>
    </div>`;
  }).join('');
}

function updateProjectSelect() {
  const sel = $('save-to-project');
  const cur = sel.value;
  sel.innerHTML = '<option value="">No project</option>' +
    S.projects.map(p => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>${esc(p.name)}</option>`).join('');
}

/* ══════════════════════════════════════════
   CHARACTERS
══════════════════════════════════════════ */
function openCharModal(char = null) {
  S.editCharId = char?.id || null;
  $('modal-title').textContent = char ? 'Edit Character' : 'New Character';
  $('char-name').value         = char?.name || '';
  $('char-desc').value         = char?.description || '';
  $('char-modal').classList.remove('hidden');
  $('char-name').focus();
}

function closeCharModal() { $('char-modal').classList.add('hidden'); }

function saveChar() {
  const name = $('char-name').value.trim();
  const desc = $('char-desc').value.trim();
  if (!name) { $('char-name').focus(); return; }

  if (S.editCharId) {
    const c = S.characters.find(c => c.id === S.editCharId);
    if (c) { c.name = name; c.description = desc; }
  } else {
    S.characters.push({ id: Date.now() + '', name, description: desc });
  }

  localStorage.setItem('fsv-chars', JSON.stringify(S.characters));
  renderCharacters();
  closeCharModal();
}

function renderCharacters() {
  const el = $('chars-grid');
  if (!S.characters.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-title">No characters saved</div>
      <div class="empty-hint">Save reusable character descriptions to inject into any prompt</div>
    </div>`; return;
  }
  el.innerHTML = S.characters.map(c => `
    <div class="c-card">
      <div class="c-name">${esc(c.name)}</div>
      <div class="c-desc">${esc(c.description)}</div>
      <div class="c-actions">
        <button class="c-use" data-id="${c.id}">Use in prompt</button>
        <button class="c-edit" data-id="${c.id}">Edit</button>
        <button class="c-del" data-id="${c.id}">Delete</button>
      </div>
    </div>`).join('');

  $$('.c-use').forEach(b => b.onclick = () => {
    const c = S.characters.find(x => x.id === b.dataset.id);
    if (!c) return;
    const cur = $('prompt-input').value.trim();
    $('prompt-input').value = cur ? `${cur}, ${c.description}` : c.description;
    updateCharCount();
    switchPanel('generate');
  });

  $$('.c-edit').forEach(b => b.onclick = () => {
    const c = S.characters.find(x => x.id === b.dataset.id);
    if (c) openCharModal(c);
  });

  $$('.c-del').forEach(b => b.onclick = () => {
    if (!confirm('Delete this character?')) return;
    S.characters = S.characters.filter(x => x.id !== b.dataset.id);
    localStorage.setItem('fsv-chars', JSON.stringify(S.characters));
    renderCharacters();
  });
}

/* ══════════════════════════════════════════
   DIAGNOSTICS
══════════════════════════════════════════ */
function renderDiag(results) {
  if (!results?.length) return;
  $('diag-grid').innerHTML = results.map(r => `
    <div class="diag-card diag-${r.status}">
      <div class="diag-dot"></div>
      <div class="diag-body">
        <div class="diag-name">${esc(r.name)}</div>
        <div class="diag-detail">${esc(r.detail || '')}</div>
        ${r.fixKey ? `<button class="diag-fix-btn" data-fix="${r.fixKey}">Fix automatically</button>` : ''}
      </div>
    </div>`).join('');
  $$('.diag-fix-btn').forEach(b => b.onclick = () => fsv.fixIssue(b.dataset.fix));
}

function diagLog(msg) {
  const el = $('diag-log');
  el.textContent += msg + '\n';
  el.scrollTop = el.scrollHeight;
}

/* ══════════════════════════════════════════
   IPC LISTENERS
══════════════════════════════════════════ */
function bindIPC() {
  fsv.onGpuInfo(info => {
    S.gpuProfile = info;
    $('gpu-label').textContent = info.name || 'GPU ready';
    $('gpu-badge').classList.add('ok');
    updateClipNotice();
  });

  fsv.onProgress(d => {
    const pct = Math.round((d.step / d.total) * 100);
    $('progress-bar').style.width   = `${pct}%`;
    $('progress-pct').textContent   = `${pct}%`;
    $('progress-sub').textContent   = d.label || `Step ${d.step} of ${d.total}`;
    if (d.phase) $('progress-phase').textContent = d.phase;
    if (S.settings.showSteps && d.step != null) {
      $('progress-steps').textContent = `${d.step} / ${d.total} steps`;
    }
    // capture seed from backend if provided
    if (d.seed != null) {
      S.currentSeed = d.seed;
      if (!S.seedLocked) $('seed-input').value = d.seed;
    }
  });

  fsv.onJobComplete(d => {
    // FIX: pass the params that were captured at job start so finishGenerate
    // has them available for addToLibrary, regardless of current form state
    finishGenerate(d.success, d.outputPath, d.cancelled, S._activeParams);
    S._activeParams = null;
  });

  fsv.onQueueUpdate(jobs => {
    S.queue = jobs;
    renderQueue();
  });

  fsv.onDiagResult(renderDiag);
  fsv.onLog(diagLog);
}

/* ══════════════════════════════════════════
   TOAST
══════════════════════════════════════════ */
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ══════════════════════════════════════════
   UTILS
══════════════════════════════════════════ */
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}
