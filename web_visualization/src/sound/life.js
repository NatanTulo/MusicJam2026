// Tło muzyczne z mieszkańców morza. Każde stworzenie co jakiś czas "odzywa się"
// krótkim zdarzeniem dźwiękowym; zdarzenie przechodzi przez ten sam model wody co ryby
// (opóźnienie, 3 najsilniejsze drogi, echo od terenu, pogłos, odcięcie płytkiej wody).
//
//   meduza   -> pad (harmonia)        morświn -> kliknięcia (rytm)
//   foka     -> zawodzenie (melodia)  babka   -> stuki (perkusja)
//   ławica   -> arpeggio (migotanie)  plankton-> iskierki (faktura)
//
// Wysokość trzyma zasadę całego świata: głębiej = niżej (music.js), w skali z dna pod łódką.
// Momenty odezwania się są wyrównane do siatki ósemek — tło ma puls; to opóźnienie
// w wodzie rozsuwa je potem w czasie (dalsze stworzenia "spóźniają się").
import { fishMidi, midiToHz, quantizeToMode } from './music.js';

const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const LIFE_SOUND = {
  meduza: { every: [8, 15], level: 0.05, near: 8, range: 5000 },
  morswin: { every: [3, 7], level: 0.05, range: 5000 },
  foka: { every: [7, 15], level: 0.08, range: 5500 },
  babka: { every: [3, 7], level: 0.09, near: 10, range: 3500 },
  lawica: { every: [2.5, 5], level: 0.05, range: 5000 },
  plankton: { every: [1.5, 4], level: 0.03, near: 6, range: 900 },
};

// ---------------------------------------------------------------------------
// Synteza zdarzeń (mono Float32Array, szczyt ~1)
// ---------------------------------------------------------------------------
function normalize(d) {
  let m = 0;
  for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] /= m;
  return d;
}

const SYNTH = {
  /** Meduza: miękki pad (podstawa + oktawa + lekkie rozstrojenie), pulsuje jak skurcz dzwonu. */
  meduza(sr, f) {
    const dur = rand(5, 8), n = Math.floor(sr * dur), d = new Float32Array(n);
    const pulse = rand(0.4, 0.7);
    for (let i = 0; i < n; i++) {
      const t = i / sr, x = t / dur;
      const env = Math.sin(Math.PI * Math.min(1, x * 1.25)) ** 2 * (x < 0.8 ? 1 : (1 - x) / 0.2);
      const p = 0.8 + 0.2 * Math.sin(2 * Math.PI * pulse * t);
      d[i] = env * p * (Math.sin(2 * Math.PI * f * t) + 0.5 * Math.sin(2 * Math.PI * f * 1.004 * t) + 0.3 * Math.sin(4 * Math.PI * f * t));
    }
    return normalize(d);
  },
  /** Morświn: seria kliknięć, coraz gęstsza (gdy namierza zdobycz). Prawdziwe mają ~130 kHz;
   *  tu przeniesione do słyszalnego pasma 2–4 kHz. */
  morswin(sr) {
    const clicks = Math.floor(rand(8, 22)), fc = rand(2200, 3800);
    let ici = rand(0.07, 0.11);
    const onsets = [];
    let t = 0.01;
    for (let k = 0; k < clicks; k++) { onsets.push(t); t += ici; ici *= rand(0.86, 0.95); }
    const n = Math.floor(sr * (t + 0.05)), d = new Float32Array(n);
    const len = Math.floor((sr * 5) / fc);
    onsets.forEach((o, k) => {
      const i0 = Math.floor(o * sr), a = 0.6 + 0.4 * Math.sin(k * 0.7);
      for (let j = 0; j < len && i0 + j < n; j++) {
        const w = Math.sin((Math.PI * j) / len) ** 2;
        d[i0 + j] += a * w * Math.sin((2 * Math.PI * fc * j) / sr);
      }
    });
    return normalize(d);
  },
  /** Foka: zawodzenie — harmoniczne z formantem, zjazd wysokości i wibrato. */
  foka(sr, f) {
    const dur = rand(1.4, 2.8), n = Math.floor(sr * dur), d = new Float32Array(n);
    const drop = rand(0.7, 0.85);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, x = t / dur;
      const fi = f * (1 - (1 - drop) * x) * (1 + 0.012 * Math.sin(2 * Math.PI * 5.5 * t));
      ph += (2 * Math.PI * fi) / sr;
      const env = Math.min(1, x * 6) * (1 - x) ** 1.5;
      let s = 0;
      for (let h = 1; h <= 8; h++) {
        const fh = fi * h;
        const formant = Math.exp(-(((fh - 480) / 260) ** 2)) + 0.5 * Math.exp(-(((fh - 1150) / 300) ** 2)) + 0.15;
        s += (formant / h ** 0.6) * Math.sin(h * ph);
      }
      d[i] = env * s;
    }
    return normalize(d);
  },
  /** Babka bycza: krótkie stuki (tłumiony sinus ze spadkiem wysokości) w rytmie szesnastek. */
  babka(sr, f, step) {
    const hits = Math.floor(rand(3, 7));
    const onsets = [];
    let t = 0;
    for (let k = 0; k < hits; k++) { onsets.push(t); t += step * pick([1, 1, 2, 1.5]); }
    const n = Math.floor(sr * (t + 0.15)), d = new Float32Array(n);
    for (const o of onsets) {
      const i0 = Math.floor(o * sr);
      let ph = 0;
      for (let j = 0; j < sr * 0.12 && i0 + j < n; j++) {
        const tt = j / sr;
        ph += (2 * Math.PI * f * (1 + 0.4 * Math.exp(-tt / 0.01))) / sr;
        d[i0 + j] += Math.exp(-tt / 0.035) * Math.sin(ph);
      }
    }
    return normalize(d);
  },
  /** Ławica: szybkie arpeggio dzwoneczków w górę skali + szum ruchu wody. */
  lawica(sr, freqs, step) {
    const n = Math.floor(sr * (step * freqs.length + 0.6)), d = new Float32Array(n);
    freqs.forEach((f, k) => {
      const i0 = Math.floor(k * step * sr);
      for (let j = 0; j < sr * 0.5 && i0 + j < n; j++) {
        const tt = j / sr;
        d[i0 + j] += Math.exp(-tt / 0.12) * (Math.sin(2 * Math.PI * f * tt) + 0.35 * Math.sin(2 * Math.PI * f * 2.76 * tt));
      }
    });
    let lp = 0;
    for (let i = 0; i < n; i++) {
      lp += 0.05 * (Math.random() * 2 - 1 - lp);
      d[i] += 0.6 * lp * Math.sin((Math.PI * i) / n);
    }
    return normalize(d);
  },
  /** Plankton: pojedyncza, bardzo krótka iskierka. */
  plankton(sr, f) {
    const n = Math.floor(sr * 0.12), d = new Float32Array(n);
    for (let i = 0; i < n; i++) { const t = i / sr; d[i] = Math.exp(-t / 0.02) * Math.sin(2 * Math.PI * f * t); }
    return normalize(d);
  },
};

// ---------------------------------------------------------------------------
export class LifeSound {
  constructor(engine) {
    this.engine = engine;
    this.next = new Map();     // id -> czas następnego odezwania się
    this.recent = [];          // [czas, rodzaj] — do UI
    this._cache = new Map();
  }

  /** Jaką wysokość i barwę ma zdarzenie danego stworzenia. */
  _make(c, mode, step) {
    const sr = this.engine.ctx.sampleRate;
    const base = fishMidi(c.depth, mode);          // głębiej = niżej
    const q = (m) => quantizeToMode(m, mode);
    const up = (m) => { let x = m + 1; while (q(x) !== x) x++; return x; };   // następny dźwięk skali
    let data, fRef;
    switch (c.kind) {
      case 'meduza': {
        const m = q(base + 12 + pick([0, 0, 7, 12]));  // plama akordu nad rejestrem głębokości
        const key = `meduza|${m}`;
        data = this._cached(key, () => SYNTH.meduza(sr, midiToHz(m)));
        fRef = midiToHz(m) * 1.5;
        break;
      }
      case 'morswin':
        data = SYNTH.morswin(sr); fRef = 3000; break;
      case 'foka': {
        const f = midiToHz(base + 12);
        data = SYNTH.foka(sr, f); fRef = 480; break;
      }
      case 'babka': {
        const f = midiToHz(base);
        data = SYNTH.babka(sr, f, step / 2); fRef = f * 1.3; break;
      }
      case 'lawica': {
        let m = q(base + 24);
        for (let k = Math.floor(rand(0, 3)); k > 0; k--) m = up(m);
        const notes = [m];
        for (let k = Math.floor(rand(3, 7)); k > 0; k--) notes.push(up(notes[notes.length - 1]));
        const freqs = notes.map(midiToHz);
        data = SYNTH.lawica(sr, freqs, step / 4); fRef = freqs[0] * 1.5; break;
      }
      default: {
        const f = midiToHz(q(base + 48 + pick(mode.steps)));
        data = SYNTH.plankton(sr, Math.min(6000, f)); fRef = Math.min(6000, f);
      }
    }
    const buf = this.engine.ctx.createBuffer(1, data.length, sr);
    buf.copyToChannel(data, 0);
    return { buf, fRef };
  }

  _cached(key, fn) {
    if (!this._cache.has(key)) {
      if (this._cache.size > 48) this._cache.delete(this._cache.keys().next().value);
      this._cache.set(key, fn());
    }
    return this._cache.get(key);
  }

  /**
   * @param creatures [{id, kind, x, y, depth, seabed}] w układzie słuchacza
   */
  update(listener, creatures, env, scan, now, lookahead) {
    const eng = this.engine;
    const step = 60 / eng.params.bpm / 2;
    const level = eng.params.life;
    if (!level) return;
    // tylko najbliższe osobniki gatunków liczniejszych (meduzy, babki, plankton)
    const byKind = {};
    for (const c of creatures) {
      const d = Math.hypot(c.x - listener.x, c.y - listener.y);
      if (d > LIFE_SOUND[c.kind].range) continue;
      (byKind[c.kind] ||= []).push({ c, d });
    }
    const active = [];
    for (const [kind, arr] of Object.entries(byKind)) {
      arr.sort((a, b) => a.d - b.d);
      active.push(...arr.slice(0, LIFE_SOUND[kind].near ?? arr.length).map((x) => x.c));
    }
    for (const c of active) {
      const cfg = LIFE_SOUND[c.kind];
      let t = this.next.get(c.id);
      if (t === undefined || t < now - 1) { t = now + rand(0, cfg.every[1]); this.next.set(c.id, t); }
      if (t > now + lookahead) continue;
      const te = Math.max(now + 0.02, Math.ceil(t / step) * step);   // na siatkę ósemek
      this.next.set(c.id, te + rand(...cfg.every));
      this._emit(c, te, listener, env, scan, cfg.level * level, step);
    }
    this.recent = this.recent.filter(([tt]) => tt > now - 10);
  }

  _emit(c, te, listener, env, scan, level, step) {
    const eng = this.engine;
    const ctx = eng.ctx;
    const { buf, fRef } = this._make(c, eng.mode, step);
    const plan = eng._channelPlan({ x: c.x, y: c.y, z: c.depth }, listener, env, scan, fRef, { taps: 3, echoes: 1, maxOrder: 4 });
    if (plan.landBlocked || plan.loud * level < 3e-5) return;
    this.recent.push([te, c.kind]);

    const nodes = [];
    const keep = (x) => { nodes.push(x); return x; };
    const hp = keep(ctx.createBiquadFilter());
    hp.type = 'highpass';
    hp.frequency.value = Math.min(4000, Math.max(20, plan.cutoffHz));
    const pan = keep(ctx.createStereoPanner());
    pan.pan.value = plan.pan;
    hp.connect(pan).connect(eng.nodes.lifeBus);
    let pending = 0, last = te;
    const play = (at, gain, cutoff, out) => {
      const s = keep(ctx.createBufferSource());
      s.buffer = buf;
      const lp = keep(ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      const g = keep(ctx.createGain());
      g.gain.value = gain;
      s.connect(lp).connect(g).connect(out);
      s.start(at);
      last = Math.max(last, at + buf.duration);
      pending++;
      s.onended = () => { if (--pending === 0) for (const x of nodes) try { x.disconnect(); } catch { /* ok */ } };
    };
    for (const tp of plan.taps) play(te + plan.main + tp.extra, tp.gain * level, tp.cutoff, hp);
    for (const e of plan.echoes) {
      const ep = keep(ctx.createStereoPanner());
      ep.pan.value = e.pan;
      ep.connect(eng.nodes.lifeBus);
      play(te + plan.main + e.extra, e.gain * level, e.cutoff, ep);
    }
    if (plan.tail > 0) play(te + plan.main, plan.tail * level, plan.tailCutoff ?? 16000, eng.nodes.revIn);
  }

  /** Ile zdarzeń każdego rodzaju w ostatnich 10 s (do panelu). */
  stats() {
    const out = {};
    for (const [, k] of this.recent) out[k] = (out[k] || 0) + 1;
    return out;
  }
}
