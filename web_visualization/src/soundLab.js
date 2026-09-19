// Laboratorium dźwięku: przekrój morza (odległość × głębokość) z łódką po lewej.
// Ten sam SeaSoundEngine co w grze — co się tu ustawi i usłyszy, tak zagra na mapie.
import { SeaSoundEngine, DEFAULT_PARAMS } from './sound/engine.js';
import { propagate, coherentLevelDb, soundSpeedAt, BALTIC_SUMMER } from './sound/acoustics.js';
import { modeForSeabed, pitchFor, midiToHz, noteName } from './sound/music.js';
import { analyze } from './sound/analysis.js';
import { SPECIES, SPECIES_BY_ID, hsvToRgb } from './fish/species.js';

const $ = (id) => document.getElementById(id);
const RANGE_M = 7000;   // szerokość przekroju [m]

// --- profile dna: głębokość [m] w funkcji odległości od łódki [m] ----------
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PROFILES = {
  slope: { name: 'Stok Zatoki Gdańskiej (25 → 75 m)', depth: (x) => 25 + 50 * smooth(800, 5500, x) },
  ridge: { name: 'Grzbiet w połowie drogi (70 m, grzbiet 16 m)', depth: (x) => 70 - 54 * Math.exp(-(((x - 2600) / 320) ** 2)) },
  flat: { name: 'Płasko 45 m', depth: () => 45 },
  shallow: { name: 'Płycizna 14 m', depth: () => 14 },
  deep: { name: 'Głębia Gdańska 105 m', depth: () => 105 },
};
let profile = PROFILES.slope;
const depthAt = (x) => profile.depth(Math.max(0, x));
const env = { depthAt: (x) => depthAt(x), profile: BALTIC_SUMMER };

// --- ryby: po jednej z każdego gatunku, w swoich warstwach -----------------
const fish = [
  { id: 3, species: 'szprot', x: 700, frac: 0.15 },
  { id: 5, species: 'sledz', x: 1900, frac: 0.45 },
  { id: 8, species: 'dorsz', x: 3600, frac: 0.74 },
  { id: 13, species: 'fladra', x: 5300, frac: 0.93 },
].map((f) => ({ ...f, y: 0, depth: f.frac * depthAt(f.x), seabed: depthAt(f.x), excitement: 0.25, alpha: 1, on: true, hue: (f.id * 0.381966) % 1 }));

const engine = new SeaSoundEngine();
const params = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
params.layers.engine = false;   // łódka stoi — silnik tylko by zagłuszał
engine.setParams(params);

let hydDepth = 10;
let mode = null;

// --- UI --------------------------------------------------------------------
for (const [id, p] of Object.entries(PROFILES)) {
  const o = document.createElement('option');
  o.value = id; o.textContent = p.name;
  $('profile').appendChild(o);
}
$('profile').addEventListener('change', () => {
  profile = PROFILES[$('profile').value];
  for (const f of fish) { f.seabed = depthAt(f.x); f.depth = Math.min(f.depth, f.seabed - 0.5); }
  clampHyd();
});
$('depth').addEventListener('input', () => { hydDepth = parseFloat($('depth').value); clampHyd(); });
$('sea').addEventListener('input', () => { $('sea-val').textContent = $('sea').value; engine.setParams({ seaState: +$('sea').value }); });
$('abs').addEventListener('input', () => { $('abs-val').textContent = $('abs').value; engine.setParams({ absorptionGain: +$('abs').value }); });
$('vol').addEventListener('input', () => engine.setParams({ volume: +$('vol').value }));
document.querySelectorAll('[data-layer]').forEach((el) => {
  el.checked = params.layers[el.dataset.layer];
  el.addEventListener('change', () => engine.setParams({ layers: { [el.dataset.layer]: el.checked } }));
});
document.querySelectorAll('[data-path]').forEach((el) => {
  el.addEventListener('change', () => engine.setParams({ paths: { [el.dataset.path]: el.checked } }));
});
$('play').addEventListener('click', async () => {
  if (engine.running) await engine.stop(); else await engine.start();
  $('play').textContent = engine.running ? '⏸ Wycisz' : '▶ Włącz dźwięk';
  $('play').classList.toggle('on', engine.running);
});

function clampHyd() {
  const max = depthAt(0) - 0.5;
  hydDepth = Math.max(0.5, Math.min(hydDepth, max));
  $('depth').max = String(Math.floor(max * 2) / 2);
  $('depth').value = String(hydDepth);
  $('depth-val').textContent = hydDepth.toFixed(1);
}
clampHyd();

// --- przekrój: rysowanie + przeciąganie -------------------------------------
const cv = $('section');
const view = { W: 0, H: 0, maxD: 110, padL: 46, padT: 26, padB: 22 };
const sx = (x) => view.padL + (x / RANGE_M) * (view.W - view.padL - 10);
const sy = (z) => view.padT + (z / view.maxD) * (view.H - view.padT - view.padB);
const wx = (px) => ((px - view.padL) / (view.W - view.padL - 10)) * RANGE_M;
const wz = (py) => ((py - view.padT) / (view.H - view.padT - view.padB)) * view.maxD;

let drag = null;
cv.addEventListener('pointerdown', (e) => {
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * devicePixelRatio, py = (e.clientY - r.top) * devicePixelRatio;
  let best = null, bestD = 30 * devicePixelRatio;
  for (const f of fish) {
    const d = Math.hypot(sx(f.x) - px, sy(f.depth) - py);
    if (d < bestD) { best = f; bestD = d; }
  }
  if (Math.hypot(sx(0) - px, sy(hydDepth) - py) < bestD) best = 'hyd';
  if (best) { drag = best; cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * devicePixelRatio, py = (e.clientY - r.top) * devicePixelRatio;
  if (drag === 'hyd') { hydDepth = wz(py); clampHyd(); return; }
  drag.x = Math.max(50, Math.min(RANGE_M - 50, wx(px)));
  drag.seabed = depthAt(drag.x);
  drag.depth = Math.max(0.5, Math.min(drag.seabed - 0.5, wz(py)));
});
cv.addEventListener('pointerup', () => { drag = null; });

function rgb(h, a = 1) {
  const [r, g, b] = hsvToRgb(h, 0.8, 1);
  return `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${a})`;
}

function listener() {
  return { x: 0, y: 0, depth: hydDepth, seabed: depthAt(0), heading: Math.PI / 2, speed: 0, throttle: 0 };
}

/** Propagacja do rysowania i tabeli (liczona zawsze, także bez dźwięku). */
function analyzeFish() {
  mode = modeForSeabed(depthAt(0), mode);
  const L = listener();
  return fish.map((f) => {
    const sp = SPECIES_BY_ID[f.species];
    const midi = pitchFor(f, sp, mode);
    const freqs = [midiToHz(midi)];
    const res = propagate({ x: f.x, y: 0, z: f.depth }, { x: 0, y: 0, z: L.depth }, env, freqs,
      { seaState: engine.params.seaState, absorptionGain: engine.params.absorptionGain, paths: engine.params.paths });
    const level = res.paths.length ? coherentLevelDb(res, freqs) : -120;
    return { f, sp, midi, freqs, res, level };
  });
}

function drawSection(rows) {
  const W = (cv.width = cv.clientWidth * devicePixelRatio);
  const H = (cv.height = cv.clientHeight * devicePixelRatio);
  Object.assign(view, { W, H, maxD: Math.max(30, ...Array.from({ length: 50 }, (_, i) => depthAt((i / 49) * RANGE_M))) * 1.08 });
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;

  // woda: gradient jak przy świetle z góry
  const g = ctx.createLinearGradient(0, sy(0), 0, sy(view.maxD));
  g.addColorStop(0, '#1b6f93'); g.addColorStop(0.35, '#0d3f5f'); g.addColorStop(1, '#051a2b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#9dc6dd'; ctx.fillRect(0, 0, W, sy(0));

  // termoklina i haloklina (tam zmienia się prędkość dźwięku)
  ctx.font = `${11 * dpr}px system-ui`;
  for (const [z, label] of [[22, 'termoklina ~22 m'], [70, 'haloklina ~70 m']]) {
    if (z > view.maxD) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.moveTo(view.padL, sy(z)); ctx.lineTo(W, sy(z)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(label, W - 120 * dpr, sy(z) - 4 * dpr);
  }

  // dno
  ctx.beginPath(); ctx.moveTo(sx(0), H);
  for (let i = 0; i <= 140; i++) { const x = (i / 140) * RANGE_M; ctx.lineTo(sx(x), sy(depthAt(x))); }
  ctx.lineTo(sx(RANGE_M), H); ctx.closePath();
  ctx.fillStyle = '#6b5a3e'; ctx.fill();
  ctx.strokeStyle = '#b89a66'; ctx.lineWidth = 2 * dpr; ctx.stroke();

  // skale
  ctx.fillStyle = 'rgba(230,241,248,0.75)';
  for (let z = 0; z <= view.maxD; z += view.maxD > 60 ? 20 : 10) ctx.fillText(`${z} m`, 4 * dpr, sy(z) + 4 * dpr);
  for (let x = 0; x <= RANGE_M; x += 1000) ctx.fillText(`${x / 1000} km`, sx(x) - 10 * dpr, H - 5 * dpr);

  // promienie
  const L = listener();
  const hx = sx(0), hy = sy(L.depth);
  for (const { f, res } of rows) {
    if (!f.on) continue;
    const fx = sx(f.x), fy = sy(f.depth);
    for (const p of res.paths) {
      const gDb = 20 * Math.log10(Math.abs(p.gains[0]) + 1e-12);
      const w = Math.max(0.4, Math.min(5, (gDb + 55) / 11)) * dpr;
      const a = Math.max(0.12, Math.min(0.95, (gDb + 60) / 60));
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(fx, fy);
      if (p.kind === 'direct') {
        const blocked = res.blocked;
        ctx.strokeStyle = blocked ? `rgba(255,107,94,${a})` : `rgba(127,216,255,${a})`;
        ctx.setLineDash(blocked ? [8 * dpr, 5 * dpr] : []);
        ctx.lineTo(hx, hy);
      } else if (p.kind === 'surface') {
        const t = f.depth / (f.depth + L.depth);
        ctx.strokeStyle = `rgba(255,207,95,${a})`; ctx.setLineDash([7 * dpr, 5 * dpr]);
        ctx.lineTo(sx(f.x * (1 - t)), sy(0)); ctx.lineTo(hx, hy);
      } else {
        const Db = res.bottomDepth;
        const t = (Db - f.depth) / (2 * Db - f.depth - L.depth);
        ctx.strokeStyle = `rgba(196,155,255,${a})`; ctx.setLineDash([2 * dpr, 4 * dpr]);
        ctx.lineTo(sx(f.x * (1 - t)), sy(Db)); ctx.lineTo(hx, hy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
  }

  // łódka + lina hydrofonu
  ctx.fillStyle = '#8a2f23';
  ctx.beginPath(); ctx.moveTo(hx - 18 * dpr, sy(0) - 8 * dpr); ctx.lineTo(hx + 22 * dpr, sy(0) - 8 * dpr);
  ctx.lineTo(hx + 14 * dpr, sy(0) + 2 * dpr); ctx.lineTo(hx - 14 * dpr, sy(0) + 2 * dpr); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#ffe08a'; ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.moveTo(hx, sy(0)); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.fillStyle = '#ffd34d';
  ctx.beginPath(); ctx.arc(hx, hy, 7 * dpr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(`hydrofon ${L.depth.toFixed(1)} m`, hx + 12 * dpr, hy + 4 * dpr);

  // ryby
  for (const { f, sp, midi } of rows) {
    const fx = sx(f.x), fy = sy(f.depth);
    ctx.globalAlpha = f.on ? 1 : 0.35;
    ctx.fillStyle = rgb(f.hue);
    ctx.beginPath(); ctx.ellipse(fx, fy, 13 * dpr, 6 * dpr, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(fx + 11 * dpr, fy); ctx.lineTo(fx + 20 * dpr, fy - 7 * dpr); ctx.lineTo(fx + 20 * dpr, fy + 7 * dpr); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.fillText(`${sp.name} ${noteName(midi)}`, fx - 20 * dpr, fy - 11 * dpr);
    ctx.globalAlpha = 1;
  }
}

function drawSpectrum() {
  const sc = $('spectrum');
  const W = (sc.width = sc.clientWidth * devicePixelRatio);
  const H = (sc.height = sc.clientHeight * devicePixelRatio);
  const ctx = sc.getContext('2d');
  ctx.fillStyle = '#06121b'; ctx.fillRect(0, 0, W, H);
  const dpr = devicePixelRatio;
  ctx.font = `${10 * dpr}px system-ui`;
  const fx = (f) => (Math.log10(f / 20) / Math.log10(16000 / 20)) * W;
  ctx.fillStyle = 'rgba(143,169,187,0.8)';
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    ctx.fillRect(fx(f), 0, 1, H);
    ctx.fillText(f >= 1000 ? `${f / 1000}k` : String(f), fx(f) + 3, H - 4);
  }
  const an = engine.analyser;
  if (!an || !engine.running) {
    ctx.fillStyle = 'rgba(230,241,248,0.6)';
    ctx.fillText('widmo pojawi się po włączeniu dźwięku', 10 * dpr, 18 * dpr);
    return;
  }
  const data = new Float32Array(an.frequencyBinCount);
  an.getFloatFrequencyData(data);
  const binHz = engine.ctx.sampleRate / an.fftSize;
  ctx.beginPath();
  for (let i = 1; i < data.length; i++) {
    const f = i * binHz;
    if (f < 20 || f > 16000) continue;
    const y = H - ((data[i] + 110) / 90) * H;
    i === 1 ? ctx.moveTo(fx(f), y) : ctx.lineTo(fx(f), y);
  }
  ctx.strokeStyle = '#5fd68a'; ctx.lineWidth = 1.5 * dpr; ctx.stroke();
}

function drawTable(rows) {
  const tb = document.querySelector('#fish-table tbody');
  if (tb.children.length !== rows.length) {
    tb.innerHTML = '';
    rows.forEach(({ f }) => {
      const tr = document.createElement('tr');
      tr.innerHTML = '<td><input type="checkbox" checked></td>' + '<td></td>'.repeat(8);
      tr.querySelector('input').addEventListener('change', (e) => { f.on = e.target.checked; });
      tb.appendChild(tr);
    });
  }
  rows.forEach(({ f, sp, midi, freqs, res, level }, i) => {
    const cells = tb.children[i].children;
    const direct = res.paths.find((p) => p.kind === 'direct');
    const txt = [
      `<span style="color:${rgb(f.hue)}">■</span> ${sp.name} · ${f.depth.toFixed(0)} m`,
      `${noteName(midi)} (${freqs[0].toFixed(0)} Hz)`,
      `${(res.r / 1000).toFixed(2)} km`,
      direct ? `${(direct.delay * 1000).toFixed(0)} ms` : '—',
      direct ? `${direct.tlDb.toFixed(1)} dB` : '—',
      direct && direct.shadowDb > 0.5 ? `${direct.shadowDb.toFixed(1)} dB` : '—',
      `${(level + 20 * Math.log10(sp.voice.level)).toFixed(1)} dB`,
      res.paths.map((p) => `${p.kind[0]}:${(20 * Math.log10(Math.abs(p.gains[0]) + 1e-12)).toFixed(0)}`).join(' '),
    ];
    txt.forEach((t, k) => { if (cells[k + 1].innerHTML !== t) cells[k + 1].innerHTML = t; });
  });
}

function drawWater() {
  const L = listener();
  const a = engine.ambientLevels(L);
  const T = BALTIC_SUMMER.temperature(L.depth), S = BALTIC_SUMMER.salinity(L.depth);
  const db = (x) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(0)} dB` : 'wył.');
  $('water').innerHTML = [
    `<b>Przy hydrofonie</b>: ${T.toFixed(1)}°C, ${S.toFixed(1)} PSU`,
    `prędkość dźwięku: ${soundSpeedAt(L.depth).toFixed(0)} m/s`,
    `<b>Skala</b>: ${mode?.name} — ${mode?.mood}`,
    `fale: ${db(a.surface)}, filtr ${a.surfaceCutoff.toFixed(0)} Hz, falowanie ${(a.swellDepth * 100).toFixed(0)}%`,
    `pęcherzyki: ${db(a.bubbles)} · głębiny: ${db(a.deep)} · dno: ${db(a.bottom)}`,
    `echo echosondy: ${(((2 * depthAt(0)) / soundSpeedAt(depthAt(0) / 2)) * 1000).toFixed(0)} ms`,
    engine.running ? `głosów: ${engine.info?.voices ?? 0}` : '',
  ].join('<br>');
}

function frame() {
  requestAnimationFrame(frame);
  const rows = analyzeFish();
  drawSection(rows);
  drawTable(rows);
  drawSpectrum();
  drawWater();
  if (engine.running) {
    engine.update({ listener: listener(), fish: fish.map((f) => ({ ...f, alpha: f.on ? 1 : 0 })), env });
  }
}
frame();

// --- API do testów i eksperymentów w konsoli --------------------------------
/** Renderuje N sekund offline (bez głośników) i zwraca pomiary: poziom, widmo, "oddychanie". */
async function renderOffline({ depth = hydDepth, seconds = 6, seaState = engine.params.seaState, layers = {}, paths = {}, profileId = null } = {}) {
  const prevProfile = profile;
  if (profileId) profile = PROFILES[profileId];
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const eng = new SeaSoundEngine({ context: ctx });
  eng.setParams({ ...JSON.parse(JSON.stringify(engine.params)), seaState, layers, paths });
  await eng.start();
  const L = { ...listener(), depth: Math.min(depth, depthAt(0) - 0.5) };
  const fl = fish.map((f) => ({ ...f, seabed: depthAt(f.x), alpha: f.on ? 1 : 0 }));
  for (let t = 0; t < seconds; t += 0.05) eng.update({ listener: L, fish: fl, env, now: t });
  const buf = await ctx.startRendering();
  profile = prevProfile;
  return { depth: L.depth, ...analyze(buf) };
}

window.soundLab = { renderOffline, fish, PROFILES, engine, setHydrophone: (d) => { hydDepth = d; clampHyd(); } };
