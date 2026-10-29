'use strict';
// =====================================================================
//  EXPERIENCIA: recibe el tacto del teléfono (MQTT) y lo conecta a audio e imagen.
//  1. ENTRADAS  : canales que llegan por Tacto (tacto.get('touch.x'), 'ang.b', 'mic.level', …)
//  2. CONEXIONES: el panel de la derecha: cada fila lleva una entrada a una variable (rango, curva, suavizado)
//  3. SALIDAS   : variables de audio (Web Audio) y de imagen (filtros CSS) — tabla T más abajo
//  Para añadir una variable nueva, agrega una línea con tgt(...) y aparece sola en el panel.
// =====================================================================
const $ = s => document.querySelector(s);
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const fmt = v => (v == null ? '–' : Math.abs(v) >= 100 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));
const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

// ============================ SALIDAS ================================
const T = {}, LAST = {}, P = {}; // T: variables · LAST: último valor aplicado · P: parámetros de imagen
const tgt = (id, g, label, min, max, def, o = {}) => { T[id] = { id, g, label, min, max, def, ...o }; };
const setT = (id, v) => { LAST[id] = v; T[id].apply(v); };

// --- audio: oscilador o archivo → envolvente → filtro → (seco | delay | reverb) → paneo → volumen → compresor ---
const A = { ctx: null, mode: 'osc', wave: 'sawtooth', freq: 110, tono: 0, buf: null, src: null };
const aset = (p, v, tc = 0.03) => { if (A.ctx && p) p.setTargetAtTime(v, A.ctx.currentTime, tc); };
tgt('audio.volumen', 'Audio', 'volumen', 0, 1, 0.6, { apply: v => aset(A.vol && A.vol.gain, v) });
tgt('audio.frecuencia', 'Audio', 'frecuencia (oscilador, Hz)', 60, 2000, 110, { log: true, apply: v => { A.freq = v; if (A.mode === 'osc' && A.src) aset(A.src.frequency, v); } });
tgt('audio.tono', 'Audio', 'tono (semitonos)', -24, 24, 0, { apply: v => { A.tono = v; if (A.src && A.src.detune) aset(A.src.detune, v * 100); } });
tgt('audio.filtro', 'Audio', 'filtro: frecuencia de corte (Hz)', 80, 12000, 12000, { log: true, apply: v => aset(A.filt && A.filt.frequency, v) });
tgt('audio.resonancia', 'Audio', 'filtro: resonancia', 0.1, 20, 0.7, { apply: v => aset(A.filt && A.filt.Q, v) });
tgt('audio.delay.mezcla', 'Audio', 'delay: mezcla', 0, 1, 0, { apply: v => aset(A.dwet && A.dwet.gain, v) });
tgt('audio.delay.tiempo', 'Audio', 'delay: tiempo (s)', 0.02, 1, 0.3, { apply: v => aset(A.dly && A.dly.delayTime, v, 0.08) });
tgt('audio.delay.feedback', 'Audio', 'delay: repeticiones', 0, 0.9, 0.35, { apply: v => aset(A.fb && A.fb.gain, v) });
tgt('audio.reverb.mezcla', 'Audio', 'reverb: mezcla', 0, 1, 0.2, { apply: v => aset(A.rwet && A.rwet.gain, v) });
tgt('audio.pan', 'Audio', 'paneo (izq–der)', -1, 1, 0, { apply: v => aset(A.pan && A.pan.pan, v) });
tgt('audio.gate', 'Audio', 'disparador (suena / calla)', 0, 1, 1, { gate: true, apply: v => aset(A.env && A.env.gain, v >= 0.5 ? 1 : 0, v >= 0.5 ? 0.02 : 0.15) });

function impulse(c) { const len = c.sampleRate * 2.4, b = c.createBuffer(2, len, c.sampleRate); for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } return b; }
function initAudio() {
  if (A.ctx) return; const c = (A.ctx = new (window.AudioContext || window.webkitAudioContext)());
  A.env = c.createGain(); A.filt = c.createBiquadFilter(); A.filt.type = 'lowpass'; A.mix = c.createGain();
  A.dly = c.createDelay(1.5); A.fb = c.createGain(); A.dwet = c.createGain(); A.conv = c.createConvolver(); A.conv.buffer = impulse(c); A.rwet = c.createGain();
  A.pan = c.createStereoPanner(); A.vol = c.createGain(); A.comp = c.createDynamicsCompressor(); A.an = c.createAnalyser(); A.an.fftSize = 1024;
  A.env.connect(A.filt); A.filt.connect(A.mix);
  A.filt.connect(A.dly); A.dly.connect(A.dwet); A.dwet.connect(A.mix); A.dly.connect(A.fb); A.fb.connect(A.dly);
  A.filt.connect(A.conv); A.conv.connect(A.rwet); A.rwet.connect(A.mix);
  A.mix.connect(A.pan); A.pan.connect(A.vol); A.vol.connect(A.comp); A.comp.connect(A.an); A.comp.connect(c.destination);
  for (const id in T) if (T[id].g === 'Audio') setT(id, LAST[id] ?? T[id].def);
  startSource();
}
function startSource() {
  if (!A.ctx) return;
  if (A.src) { try { A.src.stop(); } catch {} A.src.disconnect(); }
  let s;
  if (A.mode === 'file' && A.buf) { s = A.ctx.createBufferSource(); s.buffer = A.buf; s.loop = true; }
  else { s = A.ctx.createOscillator(); s.type = A.wave; s.frequency.value = A.freq; }
  if (s.detune) s.detune.value = A.tono * 100;
  s.connect(A.env); s.start(); A.src = s;
}

// --- imagen: animación generada o video, con filtros y transformaciones CSS ---
const vt = (id, label, min, max, def, o = {}) => { P[id] = def; tgt('video.' + id, 'Imagen', label, min, max, def, { ...o, apply: v => { P[id] = v; } }); };
vt('brillo', 'brillo', 0.2, 3, 1); vt('contraste', 'contraste', 0.2, 3, 1); vt('saturacion', 'saturación', 0, 4, 1);
vt('tono', 'tono de color (°)', 0, 360, 0); vt('desenfoque', 'desenfoque (px)', 0, 20, 0); vt('invertir', 'invertir colores', 0, 1, 0);
vt('zoom', 'zoom', 0.5, 4, 1); vt('rotacion', 'rotación (°)', -180, 180, 0); vt('posx', 'posición X (%)', -50, 50, 0); vt('posy', 'posición Y (%)', -50, 50, 0);
vt('opacidad', 'opacidad', 0, 1, 1); vt('velocidad', 'velocidad de reproducción', 0.1, 4, 1); vt('posicion', 'posición en el video (0–1)', 0, 1, null);

// --- física del material: parámetros que se pueden conectar a un sensor ---
tgt('fisica.intensidad', 'Física', 'intensidad de la deformación', 0, 3, 1, { apply: v => FX.set({ intensidad: v }) });
tgt('fisica.recuperacion', 'Física', 'recuperación (s hasta volver a la normalidad)', 0.5, 5, 2.5, { apply: v => FX.set({ recuperacion: v }) });
tgt('fisica.tamano', 'Física', 'tamaño del toque', 0.5, 2.5, 1, { apply: v => FX.set({ tamano: v }) });
tgt('fisica.relieve', 'Física', 'relieve (luz y sombra)', 0, 2, 1, { apply: v => FX.set({ relieve: v }) });

const vwrap = $('#vwrap'), gen = $('#gen'), gx = gen.getContext('2d'), vid = $('#vid');
let videoMode = false, lastF = '', gt = 0, lastT = performance.now();
function applyVideo() {
  const f = `brightness(${P.brillo}) contrast(${P.contraste}) saturate(${P.saturacion}) hue-rotate(${P.tono}deg) blur(${P.desenfoque}px) invert(${P.invertir})`;
  if (f !== lastF) { vwrap.style.filter = f; lastF = f; }
  vwrap.style.transform = `translate(${P.posx}%, ${P.posy}%) rotate(${P.rotacion}deg) scale(${P.zoom})`;
  vwrap.style.opacity = P.opacidad;
  if (videoMode) {
    if (!vid.srcObject) vid.playbackRate = clamp(P.velocidad, 0.0625, 16);
    if (P.posicion != null && isFinite(vid.duration) && vid.duration) { const t = P.posicion * vid.duration; if (Math.abs(vid.currentTime - t) > 0.04) vid.currentTime = t; }
  }
}
function drawGen(now) {
  gt += ((now - lastT) / 1000) * (P.velocidad || 1); lastT = now;
  if (videoMode) return;
  const W = gen.width, H = gen.height;
  gx.fillStyle = '#10081c'; gx.fillRect(0, 0, W, H);
  for (let i = 0; i < 7; i++) {
    const a = gt * (0.3 + i * 0.11) + i * 1.7, x = W / 2 + Math.cos(a * 1.3 + i) * W * 0.34, y = H / 2 + Math.sin(a + i * 2) * H * 0.32, r = 130 + 60 * Math.sin(gt + i);
    const gr = gx.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `hsla(${(i * 50 + gt * 20) % 360},90%,60%,.95)`); gr.addColorStop(1, 'hsla(0,0%,0%,0)');
    gx.fillStyle = gr; gx.beginPath(); gx.arc(x, y, r, 0, 7); gx.fill();
  }
  gx.strokeStyle = 'rgba(255,255,255,.22)'; gx.lineWidth = 2; gx.beginPath();
  for (let x = -80; x < W + 80; x += 80) { const o = (gt * 40) % 80; gx.moveTo(x + o, 0); gx.lineTo(x + o, H); }
  gx.stroke();
}

// ============================ FÍSICA DEL MATERIAL ====================
// La imagen (animación, video o cámara) se dibuja en WebGL sobre una grilla que los dedos deforman (ver fisica.js).
const FX = Fisica.create($('#fx'));
let curMat = 'ninguno', fxTime = performance.now(); const fst = {};
function readFingers(dt) { // dedos del teléfono: posición, desplazamiento en este cuadro, velocidad, presión y tamaño
  const out = [], n = tacto.get('touch.n') || 0;
  const add = (id, x, y, f, d) => {
    let s = fst[id]; const nuevo = !s; if (!s) s = fst[id] = { x, y, vx: 0, vy: 0 };
    const dx = nuevo ? 0 : x - s.x, dy = nuevo ? 0 : y - s.y;
    s.vx = s.vx * 0.6 + (dx / Math.max(dt, 1 / 120)) * 0.4; s.vy = s.vy * 0.6 + (dy / Math.max(dt, 1 / 120)) * 0.4; s.x = x; s.y = y;
    out.push({ id, x, y, dx, dy, vx: s.vx, vy: s.vy, f: f > 0 ? f : 0.5, r: clamp(0.05 + (d || 40) / 900, 0.04, 0.3), nuevo }); // sin dato de presión: 0,5
  };
  if (n > 0) {
    for (let i = 1; i <= 5; i++) {
      const f = tacto.get(`t${i}.f`) || 0, d = tacto.get(`t${i}.d`) || 0, x = tacto.get(`t${i}.x`), y = tacto.get(`t${i}.y`);
      if ((f > 0 || d > 0) && x != null && y != null) add(i, x, y, f, d);
    }
    if (!out.length) { const x = tacto.get('touch.x'), y = tacto.get('touch.y'); if (x != null && y != null) add(0, x, y, 0, 0); }
  }
  const vivos = new Set(out.map(o => o.id)); for (const k in fst) if (!vivos.has(+k)) delete fst[k];
  return out;
}
function fxFrame(now) {
  const dt = clamp((now - fxTime) / 1000, 0.001, 0.05); fxTime = now;
  const on = FX.ok && curMat !== 'ninguno';
  if (vwrap.classList.contains('fx') !== on) { vwrap.classList.toggle('fx', on); $('#fx').hidden = !on; }
  if (!on) return;
  const w = stage.clientWidth, h = stage.clientHeight; if (!w || !h) return;
  FX.step(dt, readFingers(dt), w / h, now / 1000);
  const src = videoMode ? vid : gen, sw = videoMode ? vid.videoWidth : gen.width, sh = videoMode ? vid.videoHeight : gen.height;
  if (videoMode && vid.readyState < 2) return;
  FX.render(src, sw, sh, videoMode && !!vid.srcObject && $('#mirror').checked, w, h);
}

// ============================ ENTRADAS ===============================
const tacto = new Tacto();
const CHN = Object.fromEntries(Tacto.CHANNELS.map(c => [c.name, c]));
tacto.on('estado', s => { const e = $('#estado'); e.className = 'dot ' + (s === 'conectado' ? 'on' : 'warn'); e.textContent = '● ' + s; });
tacto.on('error', e => { $('#estado').className = 'dot warn'; $('#estado').textContent = '● ' + (e.message || 'error de conexión'); });
tacto.on('dispositivo', () => {
  const sel = $('#devSel'), cur = sel.value;
  sel.innerHTML = '<option value="auto">automático</option>' + Object.values(tacto.devices).map(d => `<option value="${d.id}">${d.name}${d.online ? '' : ' (sin conexión)'}</option>`).join('');
  sel.value = [...sel.options].some(o => o.value === cur) ? cur : 'auto'; tacto.sel = sel.value;
});
$('#devSel').onchange = e => { tacto.sel = e.target.value; };
setInterval(() => { // latencia de ida y vuelta hasta el teléfono (a través del broker)
  const d = tacto.pick(); if (!d || !d.rtt.length) { $('#rtt').textContent = ''; return; }
  const s = [...d.rtt].sort((a, b) => a - b); $('#rtt').textContent = `latencia ${Math.round(s[s.length >> 1])} ms`;
}, 1000);

// monitor de entradas
const groups = {};
for (const c of Tacto.CHANNELS) (groups[c.group] ||= []).push(c);
for (const [gname, list] of Object.entries(groups)) {
  const d = document.createElement('details'); d.className = 'grp'; d.open = !(gname.startsWith('Dedo ') || gname === 'Aceleración' || gname === 'Cámara' || gname === 'Micrófono');
  d.innerHTML = `<summary>${gname}</summary>`;
  for (const c of list) { const r = document.createElement('div'); r.className = 'ch off'; r.title = c.name; r.innerHTML = `<span class="n">${c.label}</span><span class="v">–</span><div class="bar"><i></i></div>`; d.appendChild(r); c.el = r; }
  $('#chList').appendChild(d);
}
function updateMonitor() {
  for (const c of Tacto.CHANNELS) {
    const v = tacto.get(c.name); c.el.classList.toggle('off', v == null);
    c.el.querySelector('.v').textContent = fmt(v); c.el.querySelector('i').style.width = v == null ? '0' : clamp((v - c.min) / (c.max - c.min)) * 100 + '%';
  }
}

// ratón como teléfono: permite probar el sistema sin teléfono
const stage = $('#stageWrap'); let mdown = false;
function mouseSend(n, e) {
  if (!$('#mouseDev').checked) return;
  const r = stage.getBoundingClientRect(), pre = `tacto/${tacto.sala}/raton/`;
  if (!tacto.devices.raton || !tacto.devices.raton.online) tacto._msg(pre + 'status', JSON.stringify({ online: true, name: 'ratón', caps: {} }));
  tacto._msg(pre + 'touch', JSON.stringify({ t: Date.now(), n, ar: r.width / r.height, p: n ? [{ i: 1, x: clamp((e.clientX - r.left) / r.width), y: clamp((e.clientY - r.top) / r.height), f: 0.5, d: 40 }] : [] }));
}
stage.addEventListener('pointerdown', e => { mdown = true; stage.setPointerCapture(e.pointerId); mouseSend(1, e); });
stage.addEventListener('pointermove', e => mdown && mouseSend(1, e));
stage.addEventListener('pointerup', e => { if (mdown) { mdown = false; mouseSend(0, e); } });

// ============================ CONEXIONES =============================
const CURVES = { lineal: n => n, suave: n => n * n * (3 - 2 * n), acelerada: n => n * n, rapida: n => Math.sqrt(n) };
const CURVE_LABEL = { lineal: 'lineal', suave: 'suave (S)', acelerada: 'acelerada', rapida: 'rápida' };
let maps = [], nextId = 1, driven = {}, learning = null;
const opt = (v, t) => `<option value="${v}">${t}</option>`;
const OPT_IN = (() => { let h = '', g = ''; for (const c of Tacto.CHANNELS) { if (c.group !== g) { if (g) h += '</optgroup>'; g = c.group; h += `<optgroup label="${g}">`; } h += opt(c.name, `${c.name} · ${c.label}`); } return h + '</optgroup>'; })();
const OPT_OUT = (() => { let h = '', g = ''; for (const t of Object.values(T)) { if (t.g !== g) { if (g) h += '</optgroup>'; g = t.g; h += `<optgroup label="${g}">`; } h += opt(t.id, `${t.id.split('.').slice(1).join('.')} · ${t.label}`); } return h + '</optgroup>'; })();

function newMap(inn = 'touch.x', out = 'audio.filtro', o = {}) {
  const c = CHN[inn], t = T[out];
  return { id: nextId++, on: true, in: inn, inMin: c.min, inMax: c.max, out, outMin: t.min, outMax: t.max, curve: 'lineal', invert: false, smooth: 0.3, ...o };
}
const save = () => ls('tacto.exp.maps', JSON.stringify(maps.map(({ id, on, in: i, inMin, inMax, out, outMin, outMax, curve, invert, smooth }) => ({ id, on, in: i, inMin, inMax, out, outMin, outMax, curve, invert, smooth }))));
function starter() {
  nextId = 1;
  maps = [
    newMap('touch.down', 'audio.gate', { smooth: 0 }),
    newMap('touch.x', 'audio.tono', { outMin: -12, outMax: 24, smooth: 0.5 }),
    newMap('touch.y', 'audio.filtro', { outMin: 200, outMax: 9000, invert: true }),
    newMap('touch.n', 'audio.delay.mezcla', { inMax: 3, outMax: 0.6 }),
    newMap('touch.d', 'video.zoom', { inMin: 10, inMax: 90, outMin: 1, outMax: 2.2 }),
    newMap('ang.g', 'video.tono', { inMin: -45, inMax: 45, outMin: 0, outMax: 360 }),
    newMap('touch.f', 'video.brillo', { outMin: 1, outMax: 2 }),
  ];
}
try { maps = JSON.parse(ls('tacto.exp.maps') || 'null') || []; maps = maps.filter(m => CHN[m.in] && T[m.out]); nextId = Math.max(0, ...maps.map(m => m.id)) + 1; } catch { maps = []; }
if (!maps.length) starter();

function rowEl(m) {
  const d = document.createElement('div'); d.className = 'row' + (learning && learning.m === m ? ' learning' : '');
  d.innerHTML = `
    <div class="r1"><input type="checkbox" class="on" title="activar"><select class="in"></select><span>→</span><select class="out"></select>
      <button class="learn" title="Mueve el teléfono y elijo la entrada que cambie">${learning && learning.m === m ? 'mueve…' : 'Aprender'}</button><button class="del" title="Quitar"><svg class="ic" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
    <div class="r2"><span>entrada</span><input type="number" class="inMin" step="any"><span>a</span><input type="number" class="inMax" step="any">
      <span>salida</span><input type="number" class="outMin" step="any"><span>a</span><input type="number" class="outMax" step="any"></div>
    <div class="r3"><select class="curve"></select><label><input type="checkbox" class="inv"> invertir</label><span>suavizado</span><input type="range" class="smooth" min="0" max="0.95" step="0.05"></div>
    <div class="meter"><i class="mi"></i><i class="o mo"></i><span class="val">–</span></div>`;
  const q = s => d.querySelector(s);
  for (const [k, t] of [['on','Activar conexión'],['in','Entrada'],['out','Variable de salida'],['learn','Aprender entrada'],['del','Quitar conexión'],['inMin','Entrada mínima'],['inMax','Entrada máxima'],['outMin','Salida mínima'],['outMax','Salida máxima'],['curve','Curva'],['inv','Invertir'],['smooth','Suavizado']]) q('.' + k).setAttribute('aria-label', t);
  q('.meter').setAttribute('role', 'img'); q('.meter').setAttribute('aria-label', 'Entrada y salida actuales');
  q('.in').innerHTML = OPT_IN; q('.out').innerHTML = OPT_OUT; q('.curve').innerHTML = Object.keys(CURVES).map(k => opt(k, CURVE_LABEL[k])).join('');
  q('.on').checked = m.on; q('.in').value = m.in; q('.out').value = m.out; q('.curve').value = m.curve; q('.inv').checked = m.invert; q('.smooth').value = m.smooth;
  for (const k of ['inMin', 'inMax', 'outMin', 'outMax']) q('.' + k).value = m[k];
  q('.on').onchange = e => { m.on = e.target.checked; save(); };
  q('.in').onchange = e => { m.in = e.target.value; m.inMin = CHN[m.in].min; m.inMax = CHN[m.in].max; save(); renderRows(); };
  q('.out').onchange = e => { m.out = e.target.value; m.outMin = T[m.out].min; m.outMax = T[m.out].max; m.s = null; save(); renderRows(); };
  q('.curve').onchange = e => { m.curve = e.target.value; save(); };
  q('.inv').onchange = e => { m.invert = e.target.checked; save(); };
  q('.smooth').oninput = e => { m.smooth = +e.target.value; save(); };
  for (const k of ['inMin', 'inMax', 'outMin', 'outMax']) q('.' + k).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) { m[k] = v; save(); } };
  q('.del').onclick = () => { maps = maps.filter(x => x !== m); save(); renderRows(); };
  q('.learn').onclick = () => { learning = learning && learning.m === m ? null : { m, base: snapshot(), t0: performance.now() }; renderRows(); };
  m._el = d; return d;
}
function renderRows() {
  const box = $('#rows'); box.innerHTML = '';
  if (!maps.length) box.innerHTML = '<div class="empty">Sin conexiones. Pulsa “＋ Nueva conexión” o “Ejemplo”.</div>';
  for (const m of maps) box.appendChild(rowEl(m));
}
const snapshot = () => Object.fromEntries(Tacto.CHANNELS.map(c => [c.name, tacto.get(c.name)]));
function checkLearn() { // "aprender": gana la entrada que más cambia desde que se pulsó el botón
  if (!learning) return;
  if (performance.now() - learning.t0 > 8000) { learning = null; renderRows(); return; }
  let best = null, bestD = 0.2;
  for (const c of Tacto.CHANNELS) { const v = tacto.get(c.name), b = learning.base[c.name]; if (v == null || b == null) continue; const dd = Math.abs(v - b) / (c.max - c.min); if (dd > bestD) { bestD = dd; best = c; } }
  if (best) { const m = learning.m; m.in = best.name; m.inMin = best.min; m.inMax = best.max; learning = null; save(); renderRows(); }
}
function evalMaps() {
  checkLearn();
  const now = {};
  for (const m of maps) {
    if (!m.on) continue;
    const t = T[m.out], v = tacto.get(m.in);
    if (v == null) { m.inV = null; if (t.gate && !(m.out in now)) now[m.out] = 0; continue; } // sin teléfono, el disparador se cierra
    const span = m.inMax - m.inMin || 1;
    m.inN = clamp((v - m.inMin) / span);
    let n = m.invert ? 1 - m.inN : m.inN; n = CURVES[m.curve](n);
    m.s = m.s == null ? n : m.s + (n - m.s) * (1 - m.smooth);
    let o;
    if (t.gate) o = m.s >= 0.5 ? 1 : 0;
    else if (t.log && m.outMin > 0 && m.outMax > 0) o = m.outMin * Math.pow(m.outMax / m.outMin, m.s);
    else o = m.outMin + m.s * (m.outMax - m.outMin);
    m.inV = v; m.outV = o; now[m.out] = o; // si dos conexiones van a la misma variable, gana la última de la lista
  }
  for (const id in now) setT(id, now[id]);
  for (const id in driven) if (!(id in now)) setT(id, T[id].def); // al soltar el control, la variable vuelve a su valor base
  driven = now;
}
function updateMeters() {
  for (const m of maps) {
    if (!m._el) continue;
    m._el.querySelector('.mi').style.width = (m.inV == null ? 0 : m.inN) * 100 + '%';
    m._el.querySelector('.mo').style.width = (m.s == null || m.inV == null ? 0 : m.s) * 100 + '%';
    m._el.querySelector('.val').textContent = m.inV == null ? 'sin datos' : `${fmt(m.inV)} → ${fmt(m.outV)}`;
  }
}
$('#addRow').onclick = () => { maps.push(newMap()); save(); renderRows(); };
$('#starter').onclick = () => { if (!maps.length || confirm('Esto reemplaza tus conexiones por el ejemplo. ¿Continuar?')) { starter(); save(); renderRows(); } };
$('#expBtn').onclick = () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify({ v: 1, maps }, null, 2)], { type: 'application/json' })); a.download = 'tacto-conexiones.json'; a.click(); };
$('#impBtn').onclick = () => $('#impFile').click();
$('#impFile').onchange = async e => {
  try { const j = JSON.parse(await e.target.files[0].text()); maps = (j.maps || []).filter(m => CHN[m.in] && T[m.out]); nextId = Math.max(0, ...maps.map(m => m.id)) + 1; save(); renderRows(); } catch { alert('No pude leer ese archivo.'); }
  e.target.value = '';
};

// ============================ FUENTES Y ESCENARIO ====================
$('#audioBtn').onclick = () => { initAudio(); A.ctx.resume(); $('#audioBtn').textContent = 'Audio activo'; $('#audioBtn').classList.remove('primary'); };
$('#aSrc').onchange = e => { A.mode = e.target.value; startSource(); };
$('#aWave').onchange = e => { A.wave = e.target.value; if (A.mode === 'osc') startSource(); };
$('#aFile').onchange = async e => {
  const f = e.target.files[0]; if (!f) return; initAudio();
  try { A.buf = await A.ctx.decodeAudioData(await f.arrayBuffer()); A.mode = 'file'; $('#aSrc').value = 'file'; startSource(); $('#audioBtn').textContent = 'Audio activo'; } catch { alert('No pude leer ese audio.'); }
};
const showVideo = (on, src = 'file') => { videoMode = on; vid.hidden = !on; gen.hidden = on; $('#vSrc').value = on ? src : 'gen'; if (on) vid.play().catch(() => {}); };
let fileUrl = '', camStream = null;
const stopWebcam = () => { if (camStream) camStream.getTracks().forEach(t => t.stop()); camStream = null; vid.srcObject = null; };
async function startWebcam() { // la cámara web del computador como fuente de imagen (no sale de este navegador)
  stopWebcam();
  camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  vid.srcObject = camStream; showVideo(true, 'cam');
}
const syncMirror = () => vid.classList.toggle('mirror', $('#mirror').checked && !!vid.srcObject);
$('#mirror').onchange = syncMirror;
$('#vSrc').onchange = async e => {
  const v = e.target.value;
  if (v === 'cam') {
    try { await startWebcam(); } catch (err) { stopWebcam(); showVideo(false); alert('No pude abrir la cámara web: ' + (err.message || err) + '\nRevisa el permiso del navegador y que ninguna otra aplicación la esté usando.'); }
  } else { stopWebcam(); if (v === 'file' && fileUrl) vid.src = fileUrl; showVideo(v === 'file' && !!fileUrl); }
  syncMirror();
};
$('#vFile').onchange = e => { const f = e.target.files[0]; if (!f) return; stopWebcam(); if (fileUrl) URL.revokeObjectURL(fileUrl); fileUrl = URL.createObjectURL(f); vid.src = fileUrl; showVideo(true); syncMirror(); };

// pantalla completa del escenario (tecla F o botón); los controles se esconden si no mueves el mouse
const fsBtn = $('#fsBtn'), fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFs() {
  const p = fsEl() ? (document.exitFullscreen || document.webkitExitFullscreen).call(document) : (stage.requestFullscreen || stage.webkitRequestFullscreen).call(stage);
  if (p && p.catch) p.catch(() => {}); // algunos navegadores incrustados bloquean la pantalla completa
}
fsBtn.onclick = toggleFs; fsBtn.addEventListener('pointerdown', e => e.stopPropagation());
addEventListener('keydown', e => { const mk = ['ninguno', 'tela', 'agua', 'squishy', 'remolino'][+e.key - 1]; if (mk && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) setMat(mk, true); });
addEventListener('keydown', e => { if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) toggleFs(); });
let idleT;
const wake = () => { stage.classList.remove('idle'); clearTimeout(idleT); if (fsEl()) idleT = setTimeout(() => stage.classList.add('idle'), 2500); };
stage.addEventListener('pointermove', wake);
['fullscreenchange', 'webkitfullscreenchange'].forEach(n => document.addEventListener(n, () => { const on = !!fsEl(); fsBtn.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa'); fsBtn.title = on ? 'Salir (Esc o F)' : 'Pantalla completa (F)'; wake(); }));

// selector de material y deslizadores de física
const FXP = { intensidad: 1, recuperacion: 2.5, tamano: 1, relieve: 1 };
try { Object.assign(FXP, JSON.parse(ls('tacto.exp.fxp') || '{}')); } catch {}
const fxToast = $('#fxToast'); let fxToastT;
function setMat(m, aviso) {
  if (!Fisica.MATERIALES[m]) m = 'tela';
  curMat = m; FX.setMaterial(m); ls('tacto.exp.fx', m);
  for (const b of document.querySelectorAll('#fxMat button')) b.setAttribute('aria-pressed', b.dataset.m === m);
  $('#fxDesc').textContent = FX.ok ? Fisica.MATERIALES[m].desc : 'Este navegador no permite WebGL: la imagen se muestra sin deformar.';
  if (aviso && FX.ok) { fxToast.textContent = Fisica.MATERIALES[m].nombre; fxToast.classList.add('on'); clearTimeout(fxToastT); fxToastT = setTimeout(() => fxToast.classList.remove('on'), 1400); }
}
for (const b of document.querySelectorAll('#fxMat button')) { b.onclick = () => setMat(b.dataset.m, true); b.disabled = !FX.ok; }
for (const k in FXP) {
  const id = 'fisica.' + k, el = $('#fx-' + k), out = $('#o-' + k); T[id].def = FXP[k]; FX.set({ [k]: FXP[k] }); el.value = FXP[k]; out.textContent = fmt(FXP[k]);
  el.oninput = () => { const v = +el.value; FXP[k] = v; T[id].def = v; out.textContent = fmt(v); if (!(id in driven)) setT(id, v); ls('tacto.exp.fxp', JSON.stringify(FXP)); }; // si un sensor lo controla, este valor es el de reposo
}
setMat(ls('tacto.exp.fx') || 'tela', false);

const ov = $('#overlay'), og = ov.getContext('2d'), sc = $('#scope'), sg = sc.getContext('2d'), wave = new Uint8Array(1024);
function drawOverlay() {
  const r = stage.getBoundingClientRect(); if (ov.width !== Math.round(r.width)) { ov.width = Math.round(r.width); ov.height = Math.round(r.height); }
  og.clearRect(0, 0, ov.width, ov.height);
  if (!$('#showTouch').checked) return;
  const n = tacto.get('touch.n') || 0;
  for (let i = 1; i <= Math.min(5, n); i++) {
    const x = tacto.get(`t${i}.x`) * ov.width, y = tacto.get(`t${i}.y`) * ov.height, d = tacto.get(`t${i}.d`) || 40, f = tacto.get(`t${i}.f`) || 0;
    og.strokeStyle = '#e6ff3d'; og.fillStyle = `hsla(${270 + f * 80},85%,62%,.3)`; og.lineWidth = 2;
    og.beginPath(); og.arc(x, y, Math.max(14, d / 2), 0, 7); og.fill(); og.stroke();
  }
}
function drawScope() {
  sg.clearRect(0, 0, sc.width, sc.height); if (!A.an) return;
  A.an.getByteTimeDomainData(wave); sg.strokeStyle = '#e6ff3d'; sg.lineWidth = 1.5; sg.beginPath();
  for (let i = 0; i < sc.width; i++) { const y = sc.height / 2 + ((wave[(i * 2) % 1024] - 128) / 128) * (sc.height / 2 - 4); i ? sg.lineTo(i, y) : sg.moveTo(i, y); }
  sg.stroke();
}

// ============================ SALA, QR y arranque ====================
const qrLib = () => window.qrcode ? Promise.resolve() : new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; s.onload = ok; s.onerror = no; document.head.appendChild(s); });
async function updateJoin() {
  const CFG = window.TACTO_CONFIG || {}, Q = new URLSearchParams(location.search); let base = CFG.phoneUrl || null, local = false;
  try { const i = await (await fetch('info', { cache: 'no-store' })).json(); if (i.baseUrl) { base = CFG.phoneUrl || i.baseUrl + '/'; local = true; } } catch {}
  if (!base) base = new URL('./', location.href).href; // publicado (GitHub Pages): la página del teléfono es index.html, junto a esta
  let u = base + (base.includes('?') ? '&' : '?') + 'sala=' + tacto.sala;
  if (!local || Q.get('broker')) u += '&broker=' + encodeURIComponent(tacto.broker || Tacto.PUBLIC_BROKER); // el teléfono debe usar el mismo broker
  $('#phoneUrl').textContent = u;
  if (local) { $('#qr').src = 'qr.svg?u=' + encodeURIComponent(u); $('#qr').hidden = false; return; }
  try { await qrLib(); const q = window.qrcode(0, 'M'); q.addData(u); q.make(); $('#qr').src = q.createDataURL(4, 4); $('#qr').hidden = false; } catch { $('#qr').hidden = true; } // sin internet no hay QR: queda la dirección escrita
}
$('#salaIn').value = tacto.sala;
$('#salaIn').onchange = e => { $('#salaIn').value = tacto.cambiarSala(e.target.value); updateJoin(); };
$('#salaNueva').onclick = () => { $('#salaIn').value = tacto.cambiarSala(Tacto.nuevaSala()); updateJoin(); };

renderRows(); updateJoin();
tacto.connect().then(() => { $('#brokerInfo').textContent = tacto.broker.replace(/^wss?:\/\//, ''); updateJoin(); }).catch(e => { $('#estado').textContent = '● ' + (e.message || 'sin conexión'); });
for (const id in T) if (T[id].g === 'Imagen') LAST[id] = T[id].def;

let frame = 0;
(function loop(now) {
  evalMaps(); applyVideo(); drawGen(now); fxFrame(now); drawOverlay(); drawScope();
  if (++frame % 4 === 0) { updateMonitor(); updateMeters(); const d = tacto.pick(); $('#waiting').hidden = !!(d && d.online); }
  requestAnimationFrame(loop);
})(performance.now());

window.__tacto = { tacto, A, P, T, FX, get maps() { return maps; } }; // para depurar desde la consola
