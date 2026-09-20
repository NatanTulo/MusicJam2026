// Laboratorium dźwięku: przekrój morza (odległość × głębokość) z łódką po lewej.
// Ten sam SeaSoundEngine i ten sam model kanału co w grze.
import { SeaSoundEngine, DEFAULT_PARAMS } from './sound/engine.js';
import {
  channel, terrainEchoes, scanReflectors, waterColumnReverb, gainAt, coherentLevelDb,
  soundSpeedAt, BALTIC_SUMMER,
} from './sound/acoustics.js';
import { modeForSeabed, fishMidi, midiToHz, noteName } from './sound/music.js';
import { analyze } from './sound/analysis.js';
import { SPECIES_BY_ID, hsvToRgb } from './fish/species.js';

const $ = (id) => document.getElementById(id);
const RANGE_M = 7000;   // szerokość przekroju [m]

// --- profile dna: głębokość [m] w funkcji odległości od łódki [m] ----------
// (przekrój jest 2D: dno nie zależy od y, więc "brzeg" to prosta linia brzegowa)
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PROFILES = {
  slope: { name: 'Stok Zatoki Gdańskiej (25 → 75 m)', depth: (x) => 25 + 50 * smooth(800, 5500, x) },
  coast: { name: 'Brzeg 3 km od łódki (echo!)', depth: (x) => (x < 2400 ? 40 : x < 3000 ? (40 * (3000 - x)) / 600 : 0) },
  ridge: { name: 'Grzbiet w połowie drogi (70 m, grzbiet 16 m)', depth: (x) => 70 - 54 * Math.exp(-(((x - 2600) / 320) ** 2)) },
  flat: { name: 'Płasko 45 m', depth: () => 45 },
  shallow: { name: 'Płycizna piaszczysta 14 m', depth: () => 14 },
  deep: { name: 'Głębia Gdańska 105 m (muł)', depth: () => 105 },
};
let profile = PROFILES.slope;
const depthAt = (x) => profile.depth(Math.max(0, x));
const env = { depthAt: (x) => depthAt(x), profile: BALTIC_SUMMER };

// --- ryby: po jednej z każdego gatunku, w swoich warstwach -----------------
const fish = [
  { id: 3, species: 'szprot', x: 700, frac: 0.15 },
  { id: 5, species: 'sledz', x: 1900, frac: 0.45 },
  { id: 8, species: 'dorsz', x: 3600, frac: 0.74 },
  { id: 13, species: 'fladra', x: 4100, frac: 0.93 },
].map((f) => ({ ...f, y: 0, depth: f.frac * depthAt(f.x), seabed: depthAt(f.x), excitement: 0.25, alpha: 1, on: true, hue: (f.id * 0.381966) % 1 }));
let selected = fish[2];

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
/** Ryba nie może stać na lądzie ani w płyciźnie: jeśli nowe dno ją "wyrzuciło",
 *  rozstawiamy ją w żeglownej części przekroju (woda >= 10 m), każdą gdzie indziej. */
function keepInWater(f, i) {
  if (depthAt(f.x) < 10) {
    let maxX = RANGE_M;
    while (maxX > 200 && depthAt(maxX) < 10) maxX -= 50;
    f.x = maxX * (0.45 + 0.13 * i);
  }
  f.seabed = depthAt(f.x);
  f.depth = Math.max(0.5, Math.min(f.frac * f.seabed, f.seabed - 0.5));
}
$('profile').addEventListener('change', () => {
  profile = PROFILES[$('profile').value];
  fish.forEach((f, i) => keepInWater(f, i));
  clampHyd();
});
$('depth').addEventListener('input', () => { hydDepth = parseFloat($('depth').value); clampHyd(); });
const bindRange = (id, fmt, fn) => $(id).addEventListener('input', () => { const v = +$(id).value; $(`${id}-val`).textContent = fmt(v); fn(v); });
bindRange('sea', (v) => v, (v) => engine.setParams({ seaState: v }));
bindRange('abs', (v) => v, (v) => engine.setParams({ absorptionGain: v }));
bindRange('rev', (v) => v.toFixed(1), (v) => engine.setParams({ reverb: v }));
bindRange('echo', (v) => v.toFixed(1), (v) => engine.setParams({ echoes: v }));
bindRange('dop', (v) => `${(v * 100).toFixed(1)} %`, (v) => engine.setParams({ doppler: v }));
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
  if (best) { drag = best; if (best !== 'hyd') selected = best; cv.setPointerCapture(e.pointerId); }
});
cv.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const r = cv.getBoundingClientRect();
  const px = (e.clientX - r.left) * devicePixelRatio, py = (e.clientY - r.top) * devicePixelRatio;
  if (drag === 'hyd') { hydDepth = wz(py); clampHyd(); return; }
  const prevX = drag.x;
  drag.x = Math.max(50, Math.min(RANGE_M - 50, wx(px)));
  if (depthAt(drag.x) < 3) drag.x = prevX;   // na ląd nie wolno
  drag.seabed = depthAt(drag.x);
  drag.depth = Math.max(0.5, Math.min(drag.seabed - 0.5, wz(py)));
  drag.frac = drag.depth / drag.seabed;
});
cv.addEventListener('pointerup', () => { drag = null; });

function rgb(h, a = 1) {
  const [r, g, b] = hsvToRgb(h, 0.8, 1);
  return `rgba(${r * 255 | 0},${g * 255 | 0},${b * 255 | 0},${a})`;
}

function listener() {
  return { x: 0, y: 0, depth: hydDepth, seabed: depthAt(0), heading: Math.PI / 2, speed: 0, throttle: 0 };
}

let scan = null, scanKey = '';
/** Model kanału dla każdej ryby (liczony zawsze, także bez dźwięku). */
function analyzeFish() {
  mode = modeForSeabed(depthAt(0), mode);
  const L = listener();
  const rcv = { x: 0, y: 0, z: L.depth };
  const key = `${$('profile').value}|${L.depth.toFixed(1)}`;
  if (key !== scanKey) { scanKey = key; scan = scanReflectors(rcv, env); }
  const p = engine.params;
  return fish.map((f) => {
    const sp = SPECIES_BY_ID[f.species];
    const midi = fishMidi(f.depth, mode);
    const f0 = midiToHz(midi);
    const src = { x: f.x, y: 0, z: f.depth };
    const ch = channel(src, rcv, env, { seaState: p.seaState, absorptionGain: p.absorptionGain, maxOrder: p.maxOrder, paths: p.paths });
    const echoes = p.echoes > 0 ? terrainEchoes(src, rcv, scan, env, { count: 2, absorptionGain: p.absorptionGain }) : [];
    const fRef = Math.max(f0 * 1.5, 90);
    const level = ch.arrivals.length ? coherentLevelDb(ch.arrivals, ch.freqs, fRef) + 20 * Math.log10(sp.voice.level) : -120;
    return { f, sp, midi, f0, fRef, ch, echoes, level };
  });
}

function drawSection(rows) {
  const W = (cv.width = cv.clientWidth * devicePixelRatio);
  const H = (cv.height = cv.clientHeight * devicePixelRatio);
  Object.assign(view, { W, H, maxD: Math.max(30, ...Array.from({ length: 50 }, (_, i) => depthAt((i / 49) * RANGE_M))) * 1.08 });
  const ctx = cv.getContext('2d');
  const dpr = devicePixelRatio;

  const g = ctx.createLinearGradient(0, sy(0), 0, sy(view.maxD));
  g.addColorStop(0, '#1b6f93'); g.addColorStop(0.35, '#0d3f5f'); g.addColorStop(1, '#051a2b');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#9dc6dd'; ctx.fillRect(0, 0, W, sy(0));

  ctx.font = `${11 * dpr}px system-ui`;
  for (const [z, label] of [[22, 'termoklina ~22 m'], [70, 'haloklina ~70 m']]) {
    if (z > view.maxD) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.setLineDash([6 * dpr, 6 * dpr]);
    ctx.beginPath(); ctx.moveTo(view.padL, sy(z)); ctx.lineTo(W, sy(z)); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(label, W - 120 * dpr, sy(z) - 4 * dpr);
  }

  ctx.beginPath(); ctx.moveTo(sx(0), H);
  for (let i = 0; i <= 200; i++) { const x = (i / 200) * RANGE_M; ctx.lineTo(sx(x), sy(depthAt(x))); }
  ctx.lineTo(sx(RANGE_M), H); ctx.closePath();
  ctx.fillStyle = '#6b5a3e'; ctx.fill();
  ctx.strokeStyle = '#b89a66'; ctx.lineWidth = 2 * dpr; ctx.stroke();

  ctx.fillStyle = 'rgba(230,241,248,0.75)';
  for (let z = 0; z <= view.maxD; z += view.maxD > 60 ? 20 : 10) ctx.fillText(`${z} m`, 4 * dpr, sy(z) + 4 * dpr);
  for (let x = 0; x <= RANGE_M; x += 1000) ctx.fillText(`${x / 1000} km`, sx(x) - 10 * dpr, H - 5 * dpr);

  // ściany znalezione przez skan (kierunek na wschód = w prawo na przekroju)
  const L = listener();
  const hx = sx(0), hy = sy(L.depth);
  const wall = scan?.reflectors.find((r) => Math.abs(r.azimuth - Math.PI / 2) < 0.01);
  if (wall) {
    ctx.strokeStyle = 'rgba(255,157,77,0.8)'; ctx.lineWidth = 3 * dpr;
    ctx.beginPath(); ctx.moveTo(sx(wall.x), sy(scan.wallDepth)); ctx.lineTo(sx(wall.x), sy(0)); ctx.stroke();
    ctx.fillStyle = '#ff9d4d'; ctx.fillText(`ściana (odbija ${Math.round(wall.strength * 100)}%)`, sx(wall.x) - 60 * dpr, sy(0) + 14 * dpr);
  }

  // drogi dźwięku: rzędu 0–1 + echa od terenu
  for (const { f, ch, echoes, fRef } of rows) {
    if (!f.on) continue;
    const fx = sx(f.x), fy = sy(f.depth);
    for (const a of ch.arrivals.filter((x) => x.order <= 1)) {
      const gDb = 20 * Math.log10(Math.abs(gainAt(ch.freqs, a.gains, fRef)) + 1e-12);
      const w = Math.max(0.4, Math.min(5, (gDb + 55) / 11)) * dpr;
      const al = Math.max(0.12, Math.min(0.95, (gDb + 60) / 60));
      ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(fx, fy);
      if (a.kind === 'direct') {
        ctx.strokeStyle = a.blocked ? `rgba(255,107,94,${Math.max(al, 0.5)})` : `rgba(127,216,255,${al})`;
        ctx.setLineDash(a.blocked ? [8 * dpr, 5 * dpr] : []);
        ctx.lineTo(hx, hy);
      } else if (a.kind === 'surface') {
        const t = f.depth / (f.depth + L.depth);
        ctx.strokeStyle = `rgba(255,207,95,${al})`; ctx.setLineDash([7 * dpr, 5 * dpr]);
        ctx.lineTo(sx(f.x * (1 - t)), sy(0)); ctx.lineTo(hx, hy);
      } else {
        const Db = ch.D;
        const t = (Db - f.depth) / (2 * Db - f.depth - L.depth);
        ctx.strokeStyle = `rgba(196,155,255,${al})`; ctx.setLineDash([2 * dpr, 4 * dpr]);
        ctx.lineTo(sx(f.x * (1 - t)), sy(Db)); ctx.lineTo(hx, hy);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }
    for (const e of echoes) {
      if (Math.abs(e.point.y) > 1) continue;   // w przekroju rysujemy tylko echo leżące w płaszczyźnie rysunku
      const gDb = 20 * Math.log10(Math.abs(gainAt(ch.freqs, e.gains, fRef)) + 1e-12);
      ctx.lineWidth = Math.max(0.6, Math.min(5, (gDb + 55) / 11)) * dpr;
      ctx.strokeStyle = `rgba(255,157,77,${Math.max(0.25, Math.min(0.95, (gDb + 60) / 60))})`;
      ctx.setLineDash([10 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(sx(e.point.x), sy(e.point.z)); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.setLineDash([]);
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

  for (const { f, sp, midi, f0 } of rows) {
    const fx = sx(f.x), fy = sy(f.depth);
    ctx.globalAlpha = f.on ? 1 : 0.35;
    ctx.fillStyle = rgb(f.hue);
    ctx.beginPath(); ctx.ellipse(fx, fy, 13 * dpr, 6 * dpr, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(fx + 11 * dpr, fy); ctx.lineTo(fx + 20 * dpr, fy - 7 * dpr); ctx.lineTo(fx + 20 * dpr, fy + 7 * dpr); ctx.closePath(); ctx.fill();
    if (f === selected) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.ellipse(fx, fy, 17 * dpr, 10 * dpr, 0, 0, Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = '#fff';
    ctx.fillText(`${sp.name} ${noteName(midi)} ${f0.toFixed(0)} Hz`, fx - 24 * dpr, fy - 12 * dpr);
    ctx.globalAlpha = 1;
  }
}

/** Echogram = odpowiedź impulsowa kanału wybranej ryby: każda droga to słupek
 *  (kiedy przychodzi, jak głośno), plus zanik pogłosu słupa wody. */
function drawEchogram(rows) {
  const c = $('echogram');
  const W = (c.width = c.clientWidth * devicePixelRatio);
  const H = (c.height = c.clientHeight * devicePixelRatio);
  const ctx = c.getContext('2d');
  const dpr = devicePixelRatio;
  ctx.fillStyle = '#06121b'; ctx.fillRect(0, 0, W, H);
  const row = rows.find((r) => r.f === selected);
  if (!row) return;
  const { ch, echoes, fRef, sp } = row;
  const rv = waterColumnReverb(depthAt(0), engine.params.seaState);
  const all = [...ch.arrivals.map((a) => ({ ...a, g: gainAt(ch.freqs, a.gains, fRef) })),
    ...echoes.map((e) => ({ ...e, g: gainAt(ch.freqs, e.gains, fRef) }))];
  const t0 = all.length ? Math.min(...all.map((a) => a.delay)) : 0;
  const tEnd = Math.max(t0 + 0.4, ...all.map((a) => a.delay)) + Math.min(3, rv.t60 * 0.6);
  const padL = 40 * dpr, padB = 18 * dpr;
  const tx = (t) => padL + ((t - t0 + 0.05) / (tEnd - t0 + 0.05)) * (W - padL - 10 * dpr);
  const ly = (db) => 8 * dpr + ((10 - db) / 80) * (H - padB - 8 * dpr);
  ctx.font = `${10 * dpr}px system-ui`;
  ctx.fillStyle = 'rgba(143,169,187,0.8)';
  for (const d of [0, -20, -40, -60]) { ctx.fillRect(padL, ly(d), W - padL, 1); ctx.fillText(`${d} dB`, 4 * dpr, ly(d) + 3 * dpr); }
  const stepT = tEnd - t0 > 3 ? 1 : tEnd - t0 > 1 ? 0.25 : 0.1;
  for (let t = Math.ceil(t0 / stepT) * stepT; t <= tEnd; t += stepT) {
    ctx.fillRect(tx(t), H - padB, 1, 5 * dpr);
    ctx.fillText(`${t.toFixed(stepT < 1 ? 2 : 0)} s`, tx(t) - 10 * dpr, H - 4 * dpr);
  }
  const colors = { direct: '#7fd8ff', surface: '#ffcf5f', bottom: '#c49bff', multi: '#7f9bb3', teren: '#ff9d4d' };
  let blocked = 0;
  for (const a of all) {
    const db = 20 * Math.log10(Math.abs(a.g) + 1e-12);
    const x = tx(a.delay);
    if (a.blocked || db < -75) {
      blocked++;
      ctx.strokeStyle = '#ff6b5e'; ctx.lineWidth = 1.5 * dpr;
      const y = H - padB - 6 * dpr;
      ctx.beginPath(); ctx.moveTo(x - 4 * dpr, y - 4 * dpr); ctx.lineTo(x + 4 * dpr, y + 4 * dpr);
      ctx.moveTo(x + 4 * dpr, y - 4 * dpr); ctx.lineTo(x - 4 * dpr, y + 4 * dpr); ctx.stroke();
      continue;
    }
    ctx.strokeStyle = colors[a.kind] || '#fff'; ctx.lineWidth = 2.5 * dpr;
    ctx.beginPath(); ctx.moveTo(x, H - padB); ctx.lineTo(x, ly(db)); ctx.stroke();
    ctx.fillStyle = colors[a.kind];
    ctx.beginPath(); ctx.arc(x, ly(db), 3 * dpr, 0, Math.PI * 2); ctx.fill();
    if (a.kind === 'teren' || a.order <= 1) ctx.fillText(a.kind === 'teren' ? `echo: ${a.label}` : a.label, x + 4 * dpr, ly(db) - 4 * dpr);
  }
  // ogon pogłosu: zaczyna się od najsilniejszej drogi i spada 60 dB w czasie T60
  const strongest = all.filter((a) => !a.blocked).sort((a, b) => Math.abs(b.g) - Math.abs(a.g))[0];
  if (strongest) {
    const tailDb = 20 * Math.log10(Math.abs(strongest.g) + 1e-12) - 12;
    ctx.strokeStyle = 'rgba(230,241,248,0.55)'; ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.moveTo(tx(strongest.delay), ly(tailDb));
    ctx.lineTo(tx(Math.min(tEnd, strongest.delay + rv.t60)), ly(tailDb - 60 * Math.min(1, (tEnd - strongest.delay) / rv.t60)));
    ctx.stroke(); ctx.setLineDash([]);
  }
  const reach = all.length - blocked;
  $('echo-title').textContent = `#${selected.id} ${sp.name}: ${reach} dróg dociera, ${blocked} nie dociera · `
    + `rozmycie ${((Math.max(...ch.arrivals.map((a) => a.delay)) - t0) * 1000).toFixed(0)} ms · pogłos T60 ${rv.t60.toFixed(1)} s`;
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
      const cb = tr.querySelector('input');
      cb.addEventListener('change', (e) => { f.on = e.target.checked; });
      cb.addEventListener('click', (e) => e.stopPropagation());
      tr.addEventListener('click', () => { selected = f; });
      tb.appendChild(tr);
    });
  }
  rows.forEach(({ f, sp, midi, f0, ch, echoes, level }, i) => {
    const tr = tb.children[i];
    tr.classList.toggle('sel', f === selected);
    const cells = tr.children;
    const dir = ch.arrivals.find((a) => a.kind === 'direct');
    const live = ch.arrivals.filter((a) => !a.blocked);
    const spread = live.length ? (Math.max(...live.map((a) => a.delay)) - Math.min(...live.map((a) => a.delay))) * 1000 : 0;
    const e = echoes[0];
    const txt = [
      `<span style="color:${rgb(f.hue)}">■</span> ${sp.name} · ${f.depth.toFixed(0)} m`,
      `${noteName(midi)} (${f0.toFixed(0)} Hz)`,
      `${(ch.r / 1000).toFixed(2)} km`,
      dir ? `${(dir.delay * 1000).toFixed(0)} ms` : '—',
      ch.landBlocked ? 'ląd — nic' : `${live.length} dróg, ${spread.toFixed(0)} ms${dir?.blocked ? ', <em>bezp. w cieniu</em>' : ''}`,
      e ? `+${(e.delay - (dir?.delay ?? 0)).toFixed(2)} s, ${(20 * Math.log10(e.strength + 1e-12)).toFixed(0)} dB` : '—',
      Number.isFinite(ch.cutoffHz) ? `${ch.cutoffHz.toFixed(0)} Hz${f0 < ch.cutoffHz ? ' ⚠' : ''}` : '∞',
      `${level.toFixed(1)} dB`,
    ];
    txt.forEach((t, k) => { if (cells[k + 1].innerHTML !== t) cells[k + 1].innerHTML = t; });
  });
}

function drawWater() {
  const L = listener();
  const a = engine.ambientLevels(L);
  const T = BALTIC_SUMMER.temperature(L.depth), S = BALTIC_SUMMER.salinity(L.depth);
  const rv = waterColumnReverb(depthAt(0), engine.params.seaState);
  const db = (x) => (x > 0 ? `${(20 * Math.log10(x)).toFixed(0)} dB` : 'wył.');
  $('water').innerHTML = [
    `<b>Przy hydrofonie</b>: ${T.toFixed(1)}°C, ${S.toFixed(1)} PSU`,
    `prędkość dźwięku: ${soundSpeedAt(L.depth).toFixed(0)} m/s`,
    `<b>Skala</b>: ${mode?.name} — ${mode?.mood}`,
    `<b>Pogłos</b>: T60 ${rv.t60.toFixed(1)} s (wysokie ${rv.t60High.toFixed(1)} s), trzepotanie co ${(rv.flutterPeriod * 1000).toFixed(0)} ms`,
    `ściany w zasięgu: ${scan?.reflectors.length ?? 0}`,
    `fale: ${db(a.surface)}, filtr ${a.surfaceCutoff.toFixed(0)} Hz, falowanie ${(a.swellDepth * 100).toFixed(0)}%`,
    `pęcherzyki: ${db(a.bubbles)} · głębiny: ${db(a.deep)} · dno: ${db(a.bottom)}`,
    `echo echosondy: ${(((2 * depthAt(0)) / soundSpeedAt(depthAt(0) / 2)) * 1000).toFixed(0)} ms`,
    engine.running ? `brzmiących ryb: ${engine.info?.voices ?? 0}` : '',
  ].join('<br>');
}

function frame() {
  requestAnimationFrame(frame);
  const rows = analyzeFish();
  drawSection(rows);
  drawEchogram(rows);
  drawTable(rows);
  drawSpectrum();
  drawWater();
  if (engine.running) {
    engine.update({ listener: listener(), fish: fish.map((f) => ({ ...f, alpha: f.on ? 1 : 0 })), env });
  }
}
frame();

// --- API do testów i eksperymentów w konsoli --------------------------------
/** Renderuje N sekund offline (bez głośników) i zwraca pomiary.
 *  fishUntil: od tej chwili ryby "odpływają" — po niej widać, jak dźwięk wybrzmiewa. */
async function renderOffline({ depth = hydDepth, seconds = 6, seaState = engine.params.seaState, layers = {}, paths = {},
  profileId = null, fishUntil = Infinity, params: extra = {}, raw = false } = {}) {
  const prevProfile = profile;
  if (profileId) profile = PROFILES[profileId];
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, sr * seconds, sr);
  const eng = new SeaSoundEngine({ context: ctx });
  eng.setParams({ ...JSON.parse(JSON.stringify(engine.params)), seaState, layers, paths, ...extra });
  await eng.start();
  const L = { ...listener(), depth: Math.min(depth, depthAt(0) - 0.5) };
  const fl = fish.map((f) => ({ ...f, seabed: depthAt(f.x), alpha: f.on ? 1 : 0 }));
  for (let t = 0; t < seconds; t += 0.05) {
    const gone = t >= fishUntil;
    eng.update({ listener: L, fish: fl.map((f) => (gone ? { ...f, state: 'leaving', alpha: 0 } : f)), env, now: t });
  }
  const buf = await ctx.startRendering();
  profile = prevProfile;
  const out = { depth: L.depth, ...analyze(buf) };
  if (raw) out.channel0 = Array.from(buf.getChannelData(0));
  return out;
}

window.soundLab = {
  renderOffline, fish, PROFILES, engine,
  setHydrophone: (d) => { hydDepth = d; clampHyd(); },
  setProfile: (id) => { $('profile').value = id; $('profile').dispatchEvent(new Event('change')); },
};
