// 🎹 Podgląd muzyczny: piano-roll tego, co jest grane.
// Oś X = czas, oś Y = wysokość (MIDI). Ryby płyną smugami (brzmią ciągle),
// tło morza stuka kropkami w pasie perkusji na dole.
//
// Źródła danych (ten sam format snapshotu):
//  * LIVE — BroadcastChannel 'musicjam-roll' z gry (src/sound/controller.js),
//    4 snapshoty/s, gdy w grze włączony jest dźwięk;
//  * DEMO — lokalna symulacja (te same funkcje music.js), gdy gra nie gra.
import { MODES, MODES as _MODES, fishMidi, noteName, modeForSeabed } from './sound/music.js';

void _MODES;

const $ = (id) => document.getElementById(id);
const roll = $('roll');
const ctx = roll.getContext('2d');

// --- instrumenty: kolory i role (tło jak legenda w index.html) ---------------
const FISH_STYLE = {
  szprot: { color: '#ffd34d', role: 'jasny, migoczący · góra wody' },
  sledz: { color: '#7fd4ff', role: 'miękki, fletowy · środek' },
  dorsz: { color: '#ff8a5b', role: 'chrząkanie, puls · dół' },
  fladra: { color: '#b78aff', role: 'cichy dron · przy dnie' },
};
const LIFE_STYLE = {
  meduza: { color: '#cdb8ff', role: 'harmonia · długi pad' },
  morswin: { color: '#b3c2cf', role: 'rytm · serie kliknięć' },
  foka: { color: '#e8a07a', role: 'melodia · zawołanie' },
  babka: { color: '#e6c46e', role: 'perkusja · stuki' },
  lawica: { color: '#d6ecff', role: 'migotanie · arpeggio' },
  plankton: { color: '#7fffd4', role: 'faktura · iskierki' },
};
const LIFE_ROWS = Object.keys(LIFE_STYLE);
// Gra wysyłała kiedyś school-name z ogonkami (śledź/flądra) zamiast id — normalizuj.
const SPECIES_ALIAS = { 'śledź': 'sledz', 'flądra': 'fladra' };
const speciesKey = (s) => SPECIES_ALIAS[s] ?? s;

// --- zakres wysokości: D2 (38, dno głębi) … C6 (84, plankton w górze) ---------
const LO = 36, HI = 84;

// --- stan --------------------------------------------------------------------
let windowSec = 30;
let follow = true;
let frozenEnd = 0;
const trails = new Map();   // fishId -> { species, pts: [{t, midi, levelDb, voiced}], lastNote }
const lifeDots = [];        // [{t, kind}]
let mode = MODES[1];
let lastLiveAt = 0;         // Date.now() ostatniego snapshotu LIVE (słyszalnego)
let liveHeard = false;      // czy kiedykolwiek przyszedł live (do podpowiedzi)
let audibleNow = false;
const mutedSpecies = new Set();
const mutedLife = new Set();
const mutedFishIds = new Set();
const meters = { fish: new Map(), life: new Map() };  // do paska ścieżek

// --- wspólny ingest (live i demo mają ten sam kształt) ------------------------
function pushSnapshot(snap, isLive) {
  const t = Date.now();
  if (isLive) {
    if (!snap.audible) return;   // gra wyciszona — nie zamrażamy podglądu, gra demo
    lastLiveAt = t;
    liveHeard = true;
    audibleNow = true;
  }
  if (snap.mode) mode = snap.mode;
  for (const f of snap.fish ?? []) {
    let tr = trails.get(f.id);
    if (!tr) {
      tr = { species: speciesKey(f.species), pts: [] };
      trails.set(f.id, tr);
    }
    tr.species = speciesKey(f.species);
    tr.pts.push({ t, midi: f.midi, levelDb: f.levelDb, voiced: f.voiced });
    tr.lastNote = f.note ?? noteName(f.midi);
    // przytnij do 2× okna (mniej pamięci, a i tak rysujemy tylko okno)
    const cut = t - windowSec * 2000;
    while (tr.pts.length > 2 && tr.pts[0].t < cut) tr.pts.shift();
    meters.fish.set(f.id, { levelDb: f.levelDb, note: tr.lastNote, species: f.species });
  }
  for (const e of snap.lifeEvents ?? []) {
    lifeDots.push({ t: e.wall, kind: e.kind });
    meters.life.set(e.kind, (meters.life.get(e.kind) ?? 0) + 1);
  }
  const cutL = t - windowSec * 1000 - 5000;
  while (lifeDots.length && lifeDots[0].t < cutL) lifeDots.shift();
}

// --- LIVE --------------------------------------------------------------------
try {
  const bc = new BroadcastChannel('musicjam-roll');
  bc.onmessage = (ev) => {
    if (ev.data?.type === 'sound-snapshot') pushSnapshot(ev.data, true);
  };
} catch { /* brak BroadcastChannel — samo demo */ }

// --- DEMO (gdy gra nie gra): te same funkcje co silnik ------------------------
const demoFish = [
  { id: 1, species: 'szprot', base: 9, amp: 6, period: 26000, phase: 0.0 },
  { id: 2, species: 'sledz', base: 22, amp: 9, period: 34000, phase: 1.4 },
  { id: 3, species: 'szprot', base: 14, amp: 5, period: 21000, phase: 2.6 },
  { id: 4, species: 'dorsz', base: 48, amp: 12, period: 45000, phase: 0.7 },
  { id: 5, species: 'sledz', base: 30, amp: 10, period: 30000, phase: 3.8 },
  { id: 6, species: 'fladra', base: 62, amp: 5, period: 52000, phase: 2.0 },
];
let demoLifeNext = {};
function demoTick() {
  if (Date.now() - lastLiveAt < 2500 && audibleNow) return;  // gra na żywo — demo cicho
  const t = Date.now();
  const cycle = Math.floor(t / 40000) % MODES.length;
  const m = MODES[cycle];
  const fish = demoFish.map((f) => {
    const depth = Math.max(1, f.base + f.amp * Math.sin((2 * Math.PI * t) / (f.period * 1000) + f.phase));
    const midi = Math.round(fishMidi(depth, m));
    return {
      id: f.id, species: f.species, midi, note: noteName(midi),
      hz: 440 * 2 ** ((midi - 69) / 12), depth,
      levelDb: -14 - depth * 0.12 + Math.random() * 3, voiced: true,
    };
  });
  const lifeEvents = [];
  const means = { meduza: 11, morswin: 5, foka: 11, babka: 5, lawica: 3.5, plankton: 2.5 };
  for (const k of LIFE_ROWS) {
    if (demoLifeNext[k] === undefined) demoLifeNext[k] = t + Math.random() * 3000;
    if (t >= demoLifeNext[k]) {
      lifeEvents.push({ wall: t, kind: k });
      demoLifeNext[k] = t + means[k] * 1000 * (0.5 + Math.random());
    }
  }
  void modeForSeabed;
  pushSnapshot({ mode: m, fish, lifeEvents }, false);
}
setInterval(demoTick, 250);

// --- pasek ścieżek ------------------------------------------------------------
const fishTracksEl = $('fish-tracks');
const lifeTracksEl = $('life-tracks');
const fishRowEls = new Map();   // id -> {row, meter, note}
const lifeRowEls = new Map();

function makeRow(parent, key, color, name, sub, onToggle) {
  const row = document.createElement('div');
  row.className = 'trk';
  row.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="meter"><i></i></span><span class="note"></span>`;
  row.querySelector('.dot').style.background = color;
  row.querySelector('.nm').innerHTML = `${name}<small>${sub}</small>`;
  row.addEventListener('click', () => {
    onToggle(key);
    row.classList.toggle('off');
  });
  parent.appendChild(row);
  return { row, meter: row.querySelector('.meter i'), note: row.querySelector('.note') };
}
for (const [kind, st] of Object.entries(LIFE_STYLE)) {
  lifeRowEls.set(kind, makeRow(lifeTracksEl, kind, st.color, kind, st.role,
    (k) => { mutedLife.has(k) ? mutedLife.delete(k) : mutedLife.add(k); }));
}
function syncFishRows() {
  // usuń ryby niewidziane od 2 okien
  const t = Date.now();
  for (const [id, tr] of trails) {
    const last = tr.pts.length ? tr.pts[tr.pts.length - 1].t : 0;
    if (t - last > windowSec * 2000 && !fishRowEls.has(id)) trails.delete(id);
    if (t - last > windowSec * 2000 && fishRowEls.has(id)) {
      fishRowEls.get(id).row.remove();
      fishRowEls.delete(id);
      meters.fish.delete(id);
    }
  }
  for (const [id, tr] of trails) {
    if (!fishRowEls.has(id)) {
      const st = FISH_STYLE[tr.species] ?? { color: '#fff', role: '' };
      const el = makeRow(fishTracksEl, id, st.color, `#${id} ${tr.species}`, st.role,
        (k) => { mutedFishIds.has(k) ? mutedFishIds.delete(k) : mutedFishIds.add(k); });
      fishRowEls.set(id, el);
    }
  }
}

// --- rysowanie ----------------------------------------------------------------
const PIANO_W = 76, TIME_H = 24, DRUM_H = LIFE_ROWS.length * 20 + 8;
const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];

function scaleSet(m) {
  const s = new Set();
  for (let midi = LO; midi <= HI; midi++) {
    if (m.steps.includes((((midi - 2) % 12) + 12) % 12)) s.add(midi);
  }
  return s;
}

function fitCanvas() {
  const r = roll.parentElement.getBoundingClientRect();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  roll.width = Math.max(1, Math.round(r.width * dpr));
  roll.height = Math.max(1, Math.round(r.height * dpr));
}

new ResizeObserver(fitCanvas).observe(roll.parentElement);
fitCanvas();

function draw() {
  requestAnimationFrame(draw);
  const W = roll.width, H = roll.height;
  if (W < 10 || H < 10) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const tEnd = follow ? Date.now() : (frozenEnd || Date.now());
  const tStart = tEnd - windowSec * 1000;

  const rollX = PIANO_W * dpr, rollW = W - PIANO_W * dpr;
  const gridH = H - TIME_H * dpr - DRUM_H * dpr;
  const nRows = HI - LO + 1;
  const rowH = gridH / nRows;
  const x = (t) => rollX + ((t - tStart) / (windowSec * 1000)) * rollW;
  const y = (midi) => gridH - (midi - LO + 0.5) * rowH;

  // tło
  ctx.fillStyle = '#0a0f16';
  ctx.fillRect(0, 0, W, H);
  const inScale = scaleSet(mode);

  // rzędy: skala jasna, reszta ciemna
  for (let m = LO; m <= HI; m++) {
    ctx.fillStyle = inScale.has(m) ? '#111c2c' : '#0b111b';
    ctx.fillRect(rollX, gridH - (m - LO + 1) * rowH, rollW, rowH);
  }
  // linie co oktawę C
  ctx.strokeStyle = 'rgba(140,180,220,0.10)';
  ctx.lineWidth = 1;
  for (let m = LO; m <= HI; m++) {
    if (m % 12 === 0) {
      ctx.beginPath();
      ctx.moveTo(rollX, gridH - (m - LO) * rowH);
      ctx.lineTo(W, gridH - (m - LO) * rowH);
      ctx.stroke();
    }
  }
  // siatka czasu co 5 s
  ctx.fillStyle = '#8ba0b8';
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.textAlign = 'left';
  const step = windowSec <= 15 ? 2 : windowSec <= 30 ? 5 : windowSec <= 60 ? 10 : 30;
  const first = Math.ceil(tStart / (step * 1000)) * step * 1000;
  ctx.strokeStyle = 'rgba(140,180,220,0.14)';
  for (let tt = first; tt <= tEnd; tt += step * 1000) {
    const xx = x(tt);
    ctx.beginPath(); ctx.moveTo(xx, 0); ctx.lineTo(xx, gridH); ctx.stroke();
    const ago = Math.round((tEnd - tt) / 1000);
    ctx.fillText(ago === 0 ? 'teraz' : `-${ago}s`, xx + 4 * dpr, 14 * dpr);
  }

  // klawiatura z lewej
  for (let m = HI; m >= LO; m--) {
    const y0 = gridH - (m - LO + 1) * rowH;
    const pc = ((m % 12) + 12) % 12;
    const isBlack = BLACK.has(pc);
    ctx.fillStyle = isBlack ? '#1a2434' : '#dbe6f2';
    ctx.fillRect(0, y0 + 0.5, PIANO_W * dpr - 6 * dpr, rowH - 1);
    if (inScale.has(m)) {
      ctx.fillStyle = 'rgba(255,211,77,0.9)';
      ctx.fillRect(PIANO_W * dpr - 6 * dpr, y0 + 0.5, 3 * dpr, rowH - 1);
    }
    if (rowH > 9 * dpr && !isBlack) {
      ctx.fillStyle = '#33404f';
      ctx.font = `${9 * dpr}px system-ui`;
      ctx.fillText(`${NAMES[pc]}${Math.floor(m / 12) - 1}`, 4 * dpr, y0 + rowH - 3 * dpr);
    }
  }

  // smugi ryb
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const labelYs = [];   // anti-kolizja podpisów na prawej krawędzi
  for (const [id, tr] of trails) {
    if (mutedFishIds.has(id) || mutedSpecies.has(tr.species)) continue;
    const st = FISH_STYLE[tr.species] ?? { color: '#fff' };
    const pts = tr.pts.filter((p) => p.t >= tStart - 2000 && p.t <= tEnd + 500);
    if (pts.length === 0) continue;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k];
      if (b.t - a.t > 2000) continue;   // przerwa — nie łącz
      const w = Math.max(1.5 * dpr, Math.min(9 * dpr, (a.levelDb + 70) * 0.14 * dpr));
      ctx.strokeStyle = st.color;
      ctx.globalAlpha = a.voiced ? 0.28 + 0.72 * Math.min(1, (a.levelDb + 60) / 45) : 0.18;
      ctx.lineWidth = w;
      ctx.setLineDash(a.voiced ? [] : [5 * dpr, 4 * dpr]);
      ctx.beginPath();
      ctx.moveTo(x(a.t), y(a.midi));
      ctx.lineTo(x(b.t), y(b.midi));
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // głowica: kropka + podpis na prawej krawędzi
    const last = pts[pts.length - 1];
    ctx.fillStyle = st.color;
    ctx.beginPath();
    ctx.arc(Math.min(x(last.t), rollX + rollW - 4 * dpr), y(last.midi), 4 * dpr, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `bold ${11 * dpr}px system-ui`;
    const ly = y(last.midi) - 6 * dpr;
    if (!labelYs.some((v) => Math.abs(v - ly) < 13 * dpr)) {
      labelYs.push(ly);
      ctx.fillText(`#${id} ${last.voiced ? noteName(last.midi) : '×'}`, rollX + rollW - 52 * dpr, ly);
    }
  }

  // pas perkusji: jeden rząd na rodzaj
  const drumTop = gridH;
  ctx.fillStyle = '#0d1420';
  ctx.fillRect(0, drumTop, W, DRUM_H * dpr);
  LIFE_ROWS.forEach((kind, ri) => {
    const cy = drumTop + 8 * dpr + ri * 20 * dpr + 6 * dpr;
    const st = LIFE_STYLE[kind];
    if (mutedLife.has(kind)) ctx.globalAlpha = 0.25;
    ctx.fillStyle = '#8ba0b8';
    ctx.font = `${10 * dpr}px system-ui`;
    ctx.fillText(kind, 4 * dpr, cy + 3 * dpr);
    ctx.strokeStyle = 'rgba(140,180,220,0.12)';
    ctx.beginPath(); ctx.moveTo(rollX, cy + 8 * dpr); ctx.lineTo(W, cy + 8 * dpr); ctx.stroke();
    for (const d of lifeDots) {
      if (d.kind !== kind || d.t < tStart || d.t > tEnd) continue;
      const age = (tEnd - d.t) / 1000;
      const r = Math.max(2 * dpr, 5 * dpr - age * 0.4 * dpr);
      ctx.globalAlpha = mutedLife.has(kind) ? 0.15 : Math.max(0.25, 1 - age / windowSec);
      ctx.fillStyle = st.color;
      ctx.beginPath();
      ctx.arc(x(d.t), cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  });

  // playhead
  ctx.strokeStyle = 'rgba(255,211,77,0.85)';
  ctx.lineWidth = 2 * dpr;
  ctx.beginPath();
  ctx.moveTo(x(tEnd), 0);
  ctx.lineTo(x(tEnd), H);
  ctx.stroke();

  // pasek statusu
  const fresh = Date.now() - lastLiveAt < 2500;
  audibleNow = fresh;
  const badge = $('src-badge');
  if (fresh) {
    badge.textContent = 'LIVE · gra';
    badge.className = 'badge live';
    $('src-hint').textContent = 'Połączono z grą — to jest to, co naprawdę gra hydrofon.';
  } else if (liveHeard) {
    badge.textContent = 'GRA WYCISZONA · demo';
    badge.className = 'badge muted-live';
    $('src-hint').textContent = 'Gra otwarta, ale dźwięk wyłączony — pokazuję demo. Włącz dźwięk w grze.';
  } else {
    badge.textContent = 'DEMO';
    badge.className = 'badge demo';
  }
  $('mode-name').textContent = mode.name ?? '—';
  $('mode-mood').textContent = mode.mood ? `(${mode.mood})` : '';
  const nowAud = [...trails.values()].flatMap((tr) => tr.pts.slice(-1)).filter((p) => tEnd - p.t < 1500 && p.voiced).length;
  $('now-playing').textContent = `słychać głosów: ${nowAud} · zdarzeń tła: ${lifeDots.filter((d) => tEnd - d.t < 10000).length}/10s`;
  $('empty-hint').hidden = trails.size > 0;

  // mierniki i lista ścieżek na timerze (nie w rAF — karta w tle nie rysuje,
  // ale dane demo/live spływają dalej i ścieżki mają być aktualne)
  setInterval(() => {
    syncFishRows();
    for (const [id, el] of fishRowEls) {
      const m = meters.fish.get(id);
      if (!m) continue;
      el.meter.style.width = `${Math.max(0, Math.min(100, (m.levelDb + 80) * 1.4))}%`;
      el.note.textContent = m.note ?? '';
    }
    for (const [kind, el] of lifeRowEls) {
      const n = meters.life.get(kind) ?? 0;
      el.meter.style.width = `${Math.min(100, n * 12)}%`;
      el.note.textContent = n ? `${n}` : '';
    }
    meters.life.clear();
  }, 500);
}

// --- kontrolki ---------------------------------------------------------------
$('window').addEventListener('change', (e) => { windowSec = +e.target.value; });
$('follow').addEventListener('change', (e) => {
  follow = e.target.checked;
  if (!follow) frozenEnd = Date.now();
});
$('clear').addEventListener('click', () => {
  trails.clear();
  lifeDots.length = 0;
  for (const [, el] of fishRowEls) el.row.remove();
  fishRowEls.clear();
  meters.fish.clear();
});

draw();
