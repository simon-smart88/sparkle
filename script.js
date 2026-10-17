(function(){
  const visCanvas = document.getElementById('sparkleCanvas');
  const visCtx = visCanvas.getContext('2d');
  const scope = document.getElementById('scopeCanvas');
  const sctx = scope.getContext('2d');
  const stage = document.querySelector('.stage');
  const frame = document.querySelector('.canvas-frame');

  // --- Fixed backing grid --------------------------------------------------
  // The "true" pixel data lives here, at a size that comfortably covers the
  // whole grid-size wave range (100-2000, mean+amplitude clamped to 2000).
  // It is allocated once and never resized — growing or shrinking the visible
  // grid never touches this buffer's dimensions, only how much of its centre
  // we look at.
  const BACKING_SIZE = 2000;
  const CENTER = BACKING_SIZE / 2;
  const dataCanvas = document.createElement('canvas');
  dataCanvas.width = BACKING_SIZE;
  dataCanvas.height = BACKING_SIZE;
  const dataCtx = dataCanvas.getContext('2d');
  const backingImageData = dataCtx.createImageData(BACKING_SIZE, BACKING_SIZE);
  let filledSize = 0; // how large a centred square has ever been randomized

  function offsetFor(N){ return Math.floor(CENTER - N / 2); }

  let r_range = 128, g_range = 128, b_range = 128;

  const state = {
    r_mean: 128, r_amplitude: 1, r_frequency: 0.1, r_phase: 0, r_shape: 'sine',
    g_mean: 128, g_amplitude: 1, g_frequency: 0.1, g_phase: 0, g_shape: 'sine',
    b_mean: 128, b_amplitude: 1, b_frequency: 0.1, b_phase: 0, b_shape: 'sine',
    pp_mean: 10, pp_amplitude: 0, pp_frequency: 0.1, pp_phase: 0, pp_shape: 'sine',
    ap_mean: 128, ap_amplitude: 0, ap_frequency: 0.1, ap_phase: 0, ap_shape: 'sine',
    cs_mean: 100, cs_amplitude: 0, cs_frequency: 0.1, cs_phase: 0, cs_shape: 'sine',
    pixelUpdatePercent: 10, alpha: 128, speed: 1
  };

  // --- Responsive square canvas frame -------------------------------------
  // Only the *display* resolution changes here, and only on an actual window
  // resize — not on every grid-size wave tick.
  const narrowLayout = window.matchMedia('(max-width: 900px)');
  function sizeFrame(){
    const rect = stage.getBoundingClientRect();
    const pad = 8;
    let available;
    if (narrowLayout.matches && !document.body.classList.contains('is-fullscreen')){
      // Stacked mobile layout: the stage has no fixed height (its height comes
      // from the frame), so size the frame to the full content width instead.
      const cs = getComputedStyle(stage);
      available = rect.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    } else {
      available = Math.min(rect.width, rect.height) - pad * 2;
    }
    available = Math.max(120, available);
    const cssSize = Math.floor(available);
    frame.style.width = cssSize + 'px';
    frame.style.height = cssSize + 'px';

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const intrinsic = Math.max(200, Math.min(1400, Math.round(cssSize * dpr)));
    if (visCanvas.width !== intrinsic){
      visCanvas.width = intrinsic;
      visCanvas.height = intrinsic;
    }
  }
  new ResizeObserver(sizeFrame).observe(stage);

  // --- Grid size slider ranges ----------------------------------------------
  // On the narrow (mobile) layout the grid size sliders cover 30% of the
  // desktop range. Presets always store desktop values and are converted
  // when applied or captured, so they behave the same on every device.
  const GRID_DESKTOP = { min: 100, max: 2000, ampMax: 950, step: 5 };
  const GRID_MOBILE_SCALE = 0.3;
  const GRID_SCALED_IDS = ['cs_mean', 'cs_amplitude'];
  function gridScale(){ return narrowLayout.matches ? GRID_MOBILE_SCALE : 1; }
  function gridStep(){ return narrowLayout.matches ? 1 : GRID_DESKTOP.step; }
  function gridMin(){ return Math.round(GRID_DESKTOP.min * gridScale()); }
  function gridMax(){ return Math.round(GRID_DESKTOP.max * gridScale()); }
  function toSliderGrid(desktopValue){
    const step = gridStep();
    return Math.round(desktopValue * gridScale() / step) * step;
  }
  function toDesktopGrid(sliderValue){
    const step = GRID_DESKTOP.step;
    return Math.round(sliderValue / gridScale() / step) * step;
  }
  let gridSliderScale = 1; // the scale the grid sliders currently use
  function updateGridSliders(){
    const scale = gridScale();
    if (scale === gridSliderScale) return;
    const mean = document.getElementById('cs_mean');
    const amp = document.getElementById('cs_amplitude');
    const desktopMean = parseFloat(mean.value) / gridSliderScale;
    const desktopAmp = parseFloat(amp.value) / gridSliderScale;
    gridSliderScale = scale;
    const step = gridStep();
    mean.min = gridMin(); mean.max = gridMax(); mean.step = step;
    amp.max = Math.round(GRID_DESKTOP.ampMax * scale); amp.step = step;
    mean.value = toSliderGrid(desktopMean);
    amp.value = toSliderGrid(desktopAmp);
    mean.dispatchEvent(new Event('input'));
    amp.dispatchEvent(new Event('input'));
  }
  narrowLayout.addEventListener('change', updateGridSliders);
  window.addEventListener('resize', sizeFrame);
  sizeFrame();

  // --- Full screen mode -----------------------------------------------------
  // Hides the header and side panels so the stage fills the window, and asks
  // the browser for real full screen where supported. Esc or F exits.
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  let idleTimer = null;

  function showControlsBriefly(){
    fullscreenBtn.classList.add('visible');
    document.body.classList.remove('hide-cursor');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      fullscreenBtn.classList.remove('visible');
      document.body.classList.add('hide-cursor');
    }, 2000);
  }

  function setFullscreen(on){
    document.body.classList.toggle('is-fullscreen', on);
    fullscreenBtn.textContent = on ? '✕' : '⛶';
    fullscreenBtn.title = on ? 'Exit full screen (Esc)' : 'Full screen (F)';
    if (on){
      showControlsBriefly();
      if (document.documentElement.requestFullscreen && !document.fullscreenElement){
        document.documentElement.requestFullscreen().catch(() => {});
      }
    } else {
      clearTimeout(idleTimer);
      fullscreenBtn.classList.remove('visible');
      document.body.classList.remove('hide-cursor');
      if (document.fullscreenElement && document.exitFullscreen){
        document.exitFullscreen().catch(() => {});
      }
    }
    sizeFrame();
  }

  const isFullscreen = () => document.body.classList.contains('is-fullscreen');

  fullscreenBtn.addEventListener('click', () => setFullscreen(!isFullscreen()));
  document.addEventListener('fullscreenchange', () => {
    // Browser full screen ended (e.g. via Esc) — leave our mode too.
    if (!document.fullscreenElement && isFullscreen()) setFullscreen(false);
  });
  document.addEventListener('keydown', e => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'f' || e.key === 'F') setFullscreen(!isFullscreen());
    else if (e.key === 'Escape' && isFullscreen()) setFullscreen(false);
  });
  document.addEventListener('mousemove', () => { if (isFullscreen()) showControlsBriefly(); });

  // --- Waveform shapes ------------------------------------------------------
  function shapeValue(shape, x){
    const f = x - Math.floor(x);
    switch (shape){
      case 'triangle':
        return 4 * Math.abs(f - Math.floor(f + 0.5)) - 1;
      case 'square':
        return f < 0.5 ? 1 : -1;
      case 'sawtooth':
        return 2 * f - 1;
      case 'sine':
      default:
        return Math.sin(2 * Math.PI * f);
    }
  }

  function clampRange(v, min, max){ return Math.max(min, Math.min(max, v)); }
  function clamp255(v){ return clampRange(v, 0, 255); }

  function setRandomPixel(x, y){
    const idx = (y * BACKING_SIZE + x) * 4;
    backingImageData.data[idx]     = Math.floor(Math.random() * r_range);
    backingImageData.data[idx + 1] = Math.floor(Math.random() * g_range);
    backingImageData.data[idx + 2] = Math.floor(Math.random() * b_range);
    backingImageData.data[idx + 3] = state.alpha;
  }

  // Randomize only the newly-exposed ring when the visible (centred) grid
  // grows past its previous all-time max. Pixels already generated (even if
  // currently hidden by a later shrink) are left untouched.
  function ensureFilled(N){
    if (N <= filledSize) return;
    const oldSize = filledSize;
    const offNew = offsetFor(N);
    const offOld = offsetFor(oldSize);
    for (let y = offNew; y < offNew + N; y++){
      for (let x = offNew; x < offNew + N; x++){
        if (oldSize > 0 && x >= offOld && x < offOld + oldSize && y >= offOld && y < offOld + oldSize) continue;
        setRandomPixel(x, y);
      }
    }
    filledSize = N;
    dataCtx.putImageData(backingImageData, 0, 0, offNew, offNew, N, N);
  }

  let clockOffset = 0;
  let lastRealTime = Date.now() / 1000;
  function tick(){
    const now = Date.now() / 1000;
    const dt = now - lastRealTime;
    lastRealTime = now;
    clockOffset += dt * state.speed;
    return clockOffset;
  }

  // RGB channel value: 0-255, clamped
  function channelValue(mean, amp, freq, phase, shape, t){
    const wave = shapeValue(shape, t * freq + phase);
    return clamp255(Math.round(mean + amp * wave));
  }

  // Pixel-update-percent value: 0.1-100
  function percentValue(t){
    const wave = shapeValue(state.pp_shape, t * state.pp_frequency + state.pp_phase);
    return clampRange(state.pp_mean + state.pp_amplitude * wave, 0.1, 100);
  }

  // Transparency (alpha) value: 1-256
  function alphaValue(t){
    const wave = shapeValue(state.ap_shape, t * state.ap_frequency + state.ap_phase);
    return clampRange(Math.round(state.ap_mean + state.ap_amplitude * wave), 1, 256);
  }

  // Grid-size (pixels per side) value, clamped to the current slider range
  // and rounded to the slider step
  function sizeValue(t){
    const wave = shapeValue(state.cs_shape, t * state.cs_frequency + state.cs_phase);
    const raw = clampRange(state.cs_mean + state.cs_amplitude * wave, gridMin(), gridMax());
    const step = gridStep();
    return Math.round(raw / step) * step;
  }

  function updateColorRanges(t){
    r_range = channelValue(state.r_mean, state.r_amplitude, state.r_frequency, state.r_phase, state.r_shape, t);
    g_range = channelValue(state.g_mean, state.g_amplitude, state.g_frequency, state.g_phase, state.g_shape, t);
    b_range = channelValue(state.b_mean, state.b_amplitude, state.b_frequency, state.b_phase, state.b_shape, t);
    state.pixelUpdatePercent = percentValue(t);
    state.alpha = alphaValue(t);
  }

  function updateRandomPixels(){
    const t = tick();
    updateColorRanges(t);

    const targetSize = sizeValue(t);
    ensureFilled(targetSize);
    const offset = offsetFor(targetSize);

    const totalPixels = targetSize * targetSize;
    const pixelsToUpdate = Math.round((state.pixelUpdatePercent / 100) * totalPixels);

    for (let n = 0; n < pixelsToUpdate; n++){
      const x = offset + Math.floor(Math.random() * targetSize);
      const y = offset + Math.floor(Math.random() * targetSize);
      setRandomPixel(x, y);
    }
    // Only push the currently-visible centred N x N square to the backing
    // canvas — cost scales with what's on screen, not the 2000x2000 buffer.
    dataCtx.putImageData(backingImageData, 0, 0, offset, offset, targetSize, targetSize);

    // Crop that centred square and scale it up (nearest-neighbour) onto the visible canvas.
    // Clear first: drawing translucent pixels over the previous frame would stack
    // them up, so transparency would act like a slower update rate, not opacity.
    visCtx.imageSmoothingEnabled = false;
    visCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
    visCtx.drawImage(dataCanvas, offset, offset, targetSize, targetSize, 0, 0, visCanvas.width, visCanvas.height);

    drawScope(t);
    requestAnimationFrame(updateRandomPixels);
  }

  // Live oscilloscope-style preview of the RGB waveforms, plus density,
  // transparency and grid size overlaid as extra traces (each normalised
  // to its own range so they stay legible on one chart).
  function drawScope(t0){
    const w = scope.width, h = scope.height;
    sctx.clearRect(0, 0, w, h);

    sctx.strokeStyle = '#1f2023';
    sctx.lineWidth = 1;
    sctx.beginPath();
    sctx.moveTo(0, h / 2);
    sctx.lineTo(w, h / 2);
    sctx.stroke();

    // When a line's settings panel is open, draw that line thicker and fade the rest.
    const openGroup = document.querySelector('.group[open][data-trace]');
    const focused = openGroup ? openGroup.dataset.trace : null;
    function traceStyle(key, baseWidth){
      sctx.lineWidth = focused === key ? 2.2 : baseWidth;
      sctx.globalAlpha = focused && focused !== key ? 0.7 : 1;
    }

    const windowSeconds = 6;
    const channels = [
      { mean: state.r_mean, amp: state.r_amplitude, freq: state.r_frequency, phase: state.r_phase, shape: state.r_shape, color: getCss('--red'), key: 'r' },
      { mean: state.g_mean, amp: state.g_amplitude, freq: state.g_frequency, phase: state.g_phase, shape: state.g_shape, color: getCss('--green'), key: 'g' },
      { mean: state.b_mean, amp: state.b_amplitude, freq: state.b_frequency, phase: state.b_phase, shape: state.b_shape, color: getCss('--blue'), key: 'b' }
    ];

    channels.forEach(c => {
      sctx.beginPath();
      sctx.strokeStyle = c.color;
      traceStyle(c.key, 1.2);
      for (let px = 0; px <= w; px++){
        const t = t0 - windowSeconds + (px / w) * windowSeconds;
        const v = channelValue(c.mean, c.amp, c.freq, c.phase, c.shape, t);
        const y = h - (v / 255) * h;
        if (px === 0) sctx.moveTo(px, y); else sctx.lineTo(px, y);
      }
      sctx.stroke();
    });

    sctx.beginPath();
    sctx.strokeStyle = getCss('--density');
    traceStyle('update', 0.8);
    for (let px = 0; px <= w; px++){
      const t = t0 - windowSeconds + (px / w) * windowSeconds;
      const wave = shapeValue(state.pp_shape, t * state.pp_frequency + state.pp_phase);
      const v = clampRange(state.pp_mean + state.pp_amplitude * wave, 0.1, 100);
      const y = h - (v / 100) * h;
      if (px === 0) sctx.moveTo(px, y); else sctx.lineTo(px, y);
    }
    sctx.stroke();

    sctx.beginPath();
    sctx.strokeStyle = getCss('--alphacol');
    traceStyle('alpha', 0.8);
    for (let px = 0; px <= w; px++){
      const t = t0 - windowSeconds + (px / w) * windowSeconds;
      const wave = shapeValue(state.ap_shape, t * state.ap_frequency + state.ap_phase);
      const v = clampRange(state.ap_mean + state.ap_amplitude * wave, 1, 256);
      const y = h - (v / 256) * h;
      if (px === 0) sctx.moveTo(px, y); else sctx.lineTo(px, y);
    }
    sctx.stroke();

    sctx.beginPath();
    sctx.strokeStyle = getCss('--sizecol');
    traceStyle('size', 0.8);
    for (let px = 0; px <= w; px++){
      const t = t0 - windowSeconds + (px / w) * windowSeconds;
      const wave = shapeValue(state.cs_shape, t * state.cs_frequency + state.cs_phase);
      const v = clampRange(state.cs_mean + state.cs_amplitude * wave, gridMin(), gridMax());
      const y = h - ((v - gridMin()) / (gridMax() - gridMin())) * h;
      if (px === 0) sctx.moveTo(px, y); else sctx.lineTo(px, y);
    }
    sctx.stroke();

    sctx.globalAlpha = 1;
  }

  function getCss(varName){
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  // --- Wire up controls -------------------------------------------------
  const controlIds = [
    'speed',
    'cs_mean', 'cs_amplitude', 'cs_frequency', 'cs_phase', 'cs_shape',
    'r_mean', 'r_amplitude', 'r_frequency', 'r_phase', 'r_shape',
    'g_mean', 'g_amplitude', 'g_frequency', 'g_phase', 'g_shape',
    'b_mean', 'b_amplitude', 'b_frequency', 'b_phase', 'b_shape',
    'pp_mean', 'pp_amplitude', 'pp_frequency', 'pp_phase', 'pp_shape',
    'ap_mean', 'ap_amplitude', 'ap_frequency', 'ap_phase', 'ap_shape'
  ];

  function bindRange(id, onChange, formatter){
    const input = document.getElementById(id);
    const label = document.getElementById('val-' + id);
    input.addEventListener('input', () => {
      const raw = input.value;
      if (label) label.textContent = formatter ? formatter(raw) : raw;
      onChange(raw);
    });
  }
  function bindSelect(id, onChange){
    document.getElementById(id).addEventListener('change', e => onChange(e.target.value));
  }

  bindRange('speed', v => state.speed = parseFloat(v), v => parseFloat(v).toFixed(2) + '×');

  bindRange('cs_mean', v => state.cs_mean = parseInt(v));
  bindRange('cs_amplitude', v => state.cs_amplitude = parseInt(v));
  bindRange('cs_frequency', v => state.cs_frequency = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindRange('cs_phase', v => state.cs_phase = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindSelect('cs_shape', v => state.cs_shape = v);
  updateGridSliders();

  ['r', 'g', 'b'].forEach(ch => {
    bindRange(`${ch}_mean`, v => state[`${ch}_mean`] = parseInt(v));
    bindRange(`${ch}_amplitude`, v => state[`${ch}_amplitude`] = parseInt(v));
    bindRange(`${ch}_frequency`, v => state[`${ch}_frequency`] = parseFloat(v), v => parseFloat(v).toFixed(2));
    bindRange(`${ch}_phase`, v => state[`${ch}_phase`] = parseFloat(v), v => parseFloat(v).toFixed(2));
    bindSelect(`${ch}_shape`, v => state[`${ch}_shape`] = v);
  });

  bindRange('pp_mean', v => state.pp_mean = parseFloat(v));
  bindRange('pp_amplitude', v => state.pp_amplitude = parseFloat(v));
  bindRange('pp_frequency', v => state.pp_frequency = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindRange('pp_phase', v => state.pp_phase = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindSelect('pp_shape', v => state.pp_shape = v);

  bindRange('ap_mean', v => state.ap_mean = parseInt(v));
  bindRange('ap_amplitude', v => state.ap_amplitude = parseInt(v));
  bindRange('ap_frequency', v => state.ap_frequency = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindRange('ap_phase', v => state.ap_phase = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindSelect('ap_shape', v => state.ap_shape = v);

  // --- Randomize -----------------------------------------------------------
  function randomizeElement(el){
    if (el.tagName === 'SELECT'){
      el.selectedIndex = Math.floor(Math.random() * el.options.length);
      el.dispatchEvent(new Event('change'));
    } else if (el.type === 'range'){
      const min = parseFloat(el.min);
      const max = parseFloat(el.max);
      const step = parseFloat(el.step) || 1;
      const steps = Math.round((max - min) / step);
      const value = min + Math.floor(Math.random() * (steps + 1)) * step;
      el.value = Math.round(value * 1000) / 1000;
      el.dispatchEvent(new Event('input'));
    }
  }

  function randomizeIds(ids){
    ids.forEach(id => randomizeElement(document.getElementById(id)));
  }

  document.getElementById('randomizeAllBtn').addEventListener('click', () => {
    randomizeIds(controlIds);
  });

  document.querySelectorAll('[data-randomize-group]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      const group = btn.closest('.group');
      const ids = Array.from(group.querySelectorAll('.group-body input[type="range"], .group-body select'))
        .map(el => el.id);
      randomizeIds(ids);
    });
  });

  // Only one settings panel open at a time (mirrors the old accordion behaviour)
  const groups = document.querySelectorAll('.group');
  groups.forEach(g => {
    g.addEventListener('toggle', () => {
      if (g.open){
        groups.forEach(other => { if (other !== g) other.open = false; });
      }
    });
  });

  // --- Built-in presets (loaded from presets.json) ------------------------
  async function loadBuiltinPresets(){
    try {
      const res = await fetch('presets.json');
      if (!res.ok) throw new Error('presets.json ' + res.status);
      return await res.json();
    } catch (e){
      console.error('Could not load presets.json', e);
      return [];
    }
  }

  function renderBuiltinPresets(presets){
    const container = document.getElementById('builtinPresets');
    presets.forEach(preset => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = preset.name;
      btn.addEventListener('click', () => applySettings(preset.values));
      container.appendChild(btn);
    });
  }
  loadBuiltinPresets().then(renderBuiltinPresets);

  // --- Presets: capture / apply / persist (in localStorage) --------------
  // Presets used to live in a cookie, but the ~4KB cookie limit only fit
  // about three; localStorage gives megabytes. Older cookie presets are
  // migrated across on first load.
  const STORAGE_KEY = 'sparklePresets';
  const LEGACY_COOKIE_NAME = 'sparklePresets';

  function getCookie(name){
    const escaped = name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function deleteCookie(name){
    document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }

  const storageAvailable = (() => {
    try {
      localStorage.setItem('sparkleStorageTest', '1');
      localStorage.removeItem('sparkleStorageTest');
      return true;
    } catch (e){
      return false;
    }
  })();
  let memoryPresets = []; // fallback if localStorage isn't available (e.g. some private modes)

  if (storageAvailable){
    try {
      const legacy = getCookie(LEGACY_COOKIE_NAME);
      if (legacy){
        const legacyList = JSON.parse(legacy);
        const current = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        const ids = new Set(current.map(p => p.id));
        const merged = legacyList.filter(p => !ids.has(p.id)).concat(current);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        deleteCookie(LEGACY_COOKIE_NAME);
      }
    } catch (e){
      console.error('Could not migrate presets cookie', e);
    }
  } else {
    document.getElementById('cookieNote').textContent =
      "Browser storage isn't available here, so saved setups will only last this session.";
  }

  function captureCurrentSettings(){
    const snapshot = {};
    controlIds.forEach(id => { snapshot[id] = document.getElementById(id).value; });
    GRID_SCALED_IDS.forEach(id => { snapshot[id] = String(toDesktopGrid(parseFloat(snapshot[id]))); });
    return snapshot;
  }

  function applySettings(settings){
    controlIds.forEach(id => {
      if (!(id in settings)) return;
      const el = document.getElementById(id);
      el.value = GRID_SCALED_IDS.includes(id) ? toSliderGrid(parseFloat(settings[id])) : settings[id];
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
    });
  }

  async function loadPresets(){
    if (!storageAvailable) return memoryPresets;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e){
      return [];
    }
  }

  // Returns the list actually persisted. If storage is full, the oldest
  // presets are dropped until it fits.
  async function persistPresets(list){
    if (!storageAvailable){
      memoryPresets = list;
      return list;
    }
    const trimmed = list.slice();
    while (true){
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
        return trimmed;
      } catch (e){
        if (!trimmed.length){
          console.error('Could not save presets', e);
          return trimmed;
        }
        trimmed.shift();
      }
    }
  }

  function formatTime(ts){
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' · ' +
      d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  function renderPresets(list){
    const container = document.getElementById('presetList');
    container.innerHTML = '';
    if (!list.length){
      const empty = document.createElement('div');
      empty.className = 'preset-empty';
      empty.textContent = 'No saved setups yet. Adjust the controls, name them, and save.';
      container.appendChild(empty);
      return;
    }
    list.slice().reverse().forEach(preset => {
      const item = document.createElement('div');
      item.className = 'preset-item';

      const meta = document.createElement('div');
      meta.className = 'meta';
      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = preset.name;
      const time = document.createElement('div');
      time.className = 'time';
      time.textContent = formatTime(preset.savedAt);
      meta.appendChild(name);
      meta.appendChild(time);

      const actions = document.createElement('div');
      actions.className = 'actions';
      const restoreBtn = document.createElement('button');
      restoreBtn.className = 'restore';
      restoreBtn.textContent = 'Restore';
      restoreBtn.addEventListener('click', () => applySettings(preset.values));
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', async () => {
        const updated = (await loadPresets()).filter(p => p.id !== preset.id);
        const saved = await persistPresets(updated);
        renderPresets(saved);
      });
      actions.appendChild(restoreBtn);
      actions.appendChild(deleteBtn);

      item.appendChild(meta);
      item.appendChild(actions);
      container.appendChild(item);
    });
  }

  document.getElementById('savePresetBtn').addEventListener('click', async () => {
    const nameInput = document.getElementById('presetName');
    const name = nameInput.value.trim() || `Setup ${new Date().toLocaleTimeString()}`;
    const preset = {
      id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)),
      name,
      savedAt: Date.now(),
      values: captureCurrentSettings()
    };
    const list = await loadPresets();
    list.push(preset);
    const saved = await persistPresets(list);
    renderPresets(saved);
    nameInput.value = '';
  });

  document.getElementById('presetName').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('savePresetBtn').click();
  });

  loadPresets().then(renderPresets);

  updateRandomPixels();
})();
