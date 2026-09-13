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
    pixelUpdatePercent: 10, alpha: 128, speed: 1, quantize: 0
  };

  // --- Responsive square canvas frame -------------------------------------
  // Only the *display* resolution changes here, and only on an actual window
  // resize — not on every grid-size wave tick.
  function sizeFrame(){
    const rect = stage.getBoundingClientRect();
    const pad = 8;
    const available = Math.max(120, Math.min(rect.width, rect.height) - pad * 2);
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
  window.addEventListener('resize', sizeFrame);
  sizeFrame();

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

  function quantizeValue(v){
    const steps = state.quantize;
    if (!steps) return v;
    const levelSize = 255 / steps;
    return Math.round(v / levelSize) * levelSize;
  }

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

  // RGB channel value: 0-255, clamped and (optionally) quantized
  function channelValue(mean, amp, freq, phase, shape, t){
    const wave = shapeValue(shape, t * freq + phase);
    return quantizeValue(clamp255(Math.round(mean + amp * wave)));
  }

  // Pixel-update-percent value: 0.1-100, no quantize
  function percentValue(t){
    const wave = shapeValue(state.pp_shape, t * state.pp_frequency + state.pp_phase);
    return clampRange(state.pp_mean + state.pp_amplitude * wave, 0.1, 100);
  }

  // Transparency (alpha) value: 1-256, no quantize
  function alphaValue(t){
    const wave = shapeValue(state.ap_shape, t * state.ap_frequency + state.ap_phase);
    return clampRange(Math.round(state.ap_mean + state.ap_amplitude * wave), 1, 256);
  }

  // Grid-size (pixels per side) value: 100-2000, rounded to the nearest 5
  function sizeValue(t){
    const wave = shapeValue(state.cs_shape, t * state.cs_frequency + state.cs_phase);
    const raw = clampRange(state.cs_mean + state.cs_amplitude * wave, 100, 2000);
    return Math.round(raw / 5) * 5;
  }

  function updateColorRanges(t){
    r_range = channelValue(state.r_mean, state.r_amplitude, state.r_frequency, state.r_phase, state.r_shape, t);
    g_range = channelValue(state.g_mean, state.g_amplitude, state.g_frequency, state.g_phase, state.g_shape, t);
    b_range = channelValue(state.b_mean, state.b_amplitude, state.b_frequency, state.b_phase, state.b_shape, t);
    state.pixelUpdatePercent = percentValue(t);
    state.alpha = alphaValue(t);
  }

  const ppLive = document.getElementById('pp-live');
  const apLive = document.getElementById('ap-live');
  const csLive = document.getElementById('cs-live');

  function updateRandomPixels(){
    const t = tick();
    updateColorRanges(t);

    const targetSize = sizeValue(t);
    ensureFilled(targetSize);
    const offset = offsetFor(targetSize);
    csLive.textContent = targetSize + 'px';
    ppLive.textContent = state.pixelUpdatePercent.toFixed(1) + '%';
    apLive.textContent = Math.round(state.alpha);

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
    visCtx.imageSmoothingEnabled = false;
    visCtx.drawImage(dataCanvas, offset, offset, targetSize, targetSize, 0, 0, visCanvas.width, visCanvas.height);

    drawScope(t);
    requestAnimationFrame(updateRandomPixels);
  }

  // Live oscilloscope-style preview of the RGB waveforms, plus density,
  // transparency and grid size overlaid as dashed traces (each normalised
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

    const windowSeconds = 6;
    const channels = [
      { mean: state.r_mean, amp: state.r_amplitude, freq: state.r_frequency, phase: state.r_phase, shape: state.r_shape, color: getCss('--red') },
      { mean: state.g_mean, amp: state.g_amplitude, freq: state.g_frequency, phase: state.g_phase, shape: state.g_shape, color: getCss('--green') },
      { mean: state.b_mean, amp: state.b_amplitude, freq: state.b_frequency, phase: state.b_phase, shape: state.b_shape, color: getCss('--blue') }
    ];

    channels.forEach(c => {
      sctx.beginPath();
      sctx.strokeStyle = c.color;
      sctx.lineWidth = 1.5;
      for (let px = 0; px <= w; px++){
        const t = t0 - windowSeconds + (px / w) * windowSeconds;
        const v = channelValue(c.mean, c.amp, c.freq, c.phase, c.shape, t);
        const y = h - (v / 255) * h;
        if (px === 0) sctx.moveTo(px, y); else sctx.lineTo(px, y);
      }
      sctx.stroke();
    });

    sctx.setLineDash([3, 3]);

    sctx.beginPath();
    sctx.strokeStyle = getCss('--density');
    sctx.lineWidth = 1;
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
    sctx.lineWidth = 1;
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
    sctx.lineWidth = 1;
    for (let px = 0; px <= w; px++){
      const t = t0 - windowSeconds + (px / w) * windowSeconds;
      const wave = shapeValue(state.cs_shape, t * state.cs_frequency + state.cs_phase);
      const v = clampRange(state.cs_mean + state.cs_amplitude * wave, 100, 2000);
      const y = h - ((v - 100) / 1900) * h;
      if (px === 0) sctx.moveTo(px, y); else sctx.lineTo(px, y);
    }
    sctx.stroke();

    sctx.setLineDash([]);
  }

  function getCss(varName){
    return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
  }

  // --- Wire up controls -------------------------------------------------
  const controlIds = [
    'speed', 'quantize',
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
  bindRange('quantize', v => state.quantize = parseInt(v), v => v === '0' ? 'off' : v);

  bindRange('cs_mean', v => state.cs_mean = parseInt(v));
  bindRange('cs_amplitude', v => state.cs_amplitude = parseInt(v));
  bindRange('cs_frequency', v => state.cs_frequency = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindRange('cs_phase', v => state.cs_phase = parseFloat(v), v => parseFloat(v).toFixed(2));
  bindSelect('cs_shape', v => state.cs_shape = v);

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

  // --- Presets: capture / apply / persist (as a cookie) ------------------
  const COOKIE_NAME = 'sparklePresets';
  const COOKIE_MAX_BYTES = 3800; // stay comfortably under the ~4KB per-cookie limit

  function getCookie(name){
    const escaped = name.replace(/([.$?*|{}()\[\]\\/+^])/g, '\\$1');
    const match = document.cookie.match(new RegExp('(?:^|; )' + escaped + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }
  function setCookie(name, value, days){
    const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`;
  }

  const cookiesAvailable = (() => {
    try {
      document.cookie = 'sparkleCookieTest=1; path=/; SameSite=Lax';
      const ok = document.cookie.indexOf('sparkleCookieTest=') !== -1;
      document.cookie = 'sparkleCookieTest=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      return ok;
    } catch (e){
      return false;
    }
  })();
  let memoryPresets = []; // fallback if cookies aren't available (e.g. some local file:// views)

  if (!cookiesAvailable){
    document.getElementById('cookieNote').textContent =
      "Cookies aren't available here, so saved setups will only last this session.";
  }

  function captureCurrentSettings(){
    const snapshot = {};
    controlIds.forEach(id => { snapshot[id] = document.getElementById(id).value; });
    return snapshot;
  }

  function applySettings(settings){
    controlIds.forEach(id => {
      if (!(id in settings)) return;
      const el = document.getElementById(id);
      el.value = settings[id];
      el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
    });
  }

  async function loadPresets(){
    if (!cookiesAvailable) return memoryPresets;
    try {
      const raw = getCookie(COOKIE_NAME);
      return raw ? JSON.parse(raw) : [];
    } catch (e){
      return [];
    }
  }

  // Returns the (possibly trimmed) list actually persisted, since cookies
  // have a hard ~4KB size limit — oldest presets are dropped first if needed.
  async function persistPresets(list){
    if (!cookiesAvailable){
      memoryPresets = list;
      return list;
    }
    const trimmed = list.slice();
    let serialized = JSON.stringify(trimmed);
    while (serialized.length > COOKIE_MAX_BYTES && trimmed.length > 0){
      trimmed.shift();
      serialized = JSON.stringify(trimmed);
    }
    try {
      setCookie(COOKIE_NAME, serialized, 365 * 5);
    } catch (e){
      console.error('Could not save presets cookie', e);
    }
    return trimmed;
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
