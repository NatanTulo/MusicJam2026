// Silnik dźwięku morza (WebAudio). Słuchaczem jest hydrofon opuszczony z łódki.
//
//   ryby ──(nuty)──> propagacja: 3 drogi × opóźnienie × tłumienie(f) ──┐
//   tło morza: fale+falowanie, pęcherzyki, szum głębin, dno, silnik ───┼─> kompresor -> wyjście
//   echosonda łódki: ping + echo od dna po 2D/c ───────────────────────┘
//
// Ten sam silnik gra w grze (Batymetry Boat) i w laboratorium (sound-lab.html).
// Można mu podać OfflineAudioContext — wtedy renderuje do bufora (testy, eksport).
import {
  propagate, coherentLevelDb, seaStateInfo, orbitalDecay, soundSpeedAt,
  bottomReflection, BALTIC_SUMMER,
} from './acoustics.js';
import { modeForSeabed, pitchFor, midiToHz, noteName, euclidHit } from './music.js';
import { SPECIES_BY_ID } from '../fish/species.js';

export const DEFAULT_PARAMS = {
  volume: 0.8,
  seaState: 2,
  // Mapa ma kilka km, a pochłanianie przy częstotliwościach słyszalnych robi różnicę
  // dopiero na dziesiątkach km. Mnożnik pozwala usłyszeć ten efekt na małej mapie.
  absorptionGain: 20,
  bpm: 84,
  layers: { fish: true, surface: true, bubbles: true, deep: true, bottom: true, engine: true, ping: true },
  paths: { direct: true, surface: true, bottom: true },
};

const LOOKAHEAD = 0.3;      // [s] ile do przodu planujemy nuty
const MAX_VOICES = 110;     // limit równoczesnych dróg (oscylatorów)

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}

export class SeaSoundEngine {
  constructor({ context = null } = {}) {
    this.ctx = context;
    this.params = clone(DEFAULT_PARAMS);
    this.nodes = null;
    this.running = false;
    this.lookahead = LOOKAHEAD;
    this.mode = null;
    this.info = { fish: [], listener: null, mode: null, voices: 0 };
    this._voices = [];      // {start, end} zaplanowanych dróg — limit równoczesności
    this._step = 0;
    this._nextStepTime = null;
    this._bubbleClock = null;
    this._lastInfo = -Infinity;
    this._lastBottomWobble = -Infinity;
    this._lastUpdate = null;
  }

  async start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback' });
    }
    const offline = typeof this.ctx.startRendering === 'function';
    if (!offline && this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.nodes) this._build();
    this.running = true;
  }

  async stop() {
    this.running = false;
    if (this.ctx?.suspend && this.ctx.state === 'running') await this.ctx.suspend();
  }

  setParams(p = {}) {
    const { layers, paths, ...rest } = p;
    Object.assign(this.params, rest);
    if (layers) Object.assign(this.params.layers, layers);
    if (paths) Object.assign(this.params.paths, paths);
    if (this.nodes && 'volume' in rest) this.nodes.master.gain.setTargetAtTime(rest.volume, this.ctx.currentTime, 0.05);
  }

  get analyser() {
    return this.nodes?.analyser ?? null;
  }

  // -------------------------------------------------------------------------
  // Graf audio
  // -------------------------------------------------------------------------
  _noiseBuffer(kind, seconds = 7) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {   // kanały niezależne = szeroka, przestrzenna scena
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'pink') {   // filtr Paula Kelleta: ~ -3 dB/oktawę
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759;
          b2 = 0.969 * b2 + w * 0.153852; b3 = 0.8665 * b3 + w * 0.3104856;
          b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        } else {                 // brązowy: ~ -6 dB/oktawę, dudnienie
          last = (last + 0.02 * w) / 1.02;
          d[i] = last * 3.5;
        }
      }
    }
    return buf;
  }

  _build() {
    const ctx = this.ctx;
    const n = {};
    const t = ctx.currentTime;
    const gain = (v = 0) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const loop = (buf, offset = 0) => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(t, offset); return s; };

    n.master = gain(this.params.volume);
    n.comp = ctx.createDynamicsCompressor();
    n.comp.threshold.value = -16; n.comp.knee.value = 12; n.comp.ratio.value = 4;
    n.comp.attack.value = 0.008; n.comp.release.value = 0.25;
    n.analyser = ctx.createAnalyser();
    n.analyser.fftSize = 4096;
    n.analyser.smoothingTimeConstant = 0.82;
    n.master.connect(n.comp).connect(n.analyser).connect(ctx.destination);
    n.fishBus = gain(1); n.fishBus.connect(n.master);
    n.ambBus = gain(1); n.ambBus.connect(n.master);

    const pink = this._noiseBuffer('pink');
    const brown = this._noiseBuffer('brown');

    // Fale przy powierzchni: szum różowy, filtr coraz ciemniejszy z głębokością,
    // głośność "oddycha" w rytmie falowania (LFO), które też zanika z głębokością.
    n.surfLp = filt('lowpass', 4000, 0.5);
    n.surfGain = gain(0);
    loop(pink).connect(n.surfLp).connect(n.surfGain).connect(n.ambBus);
    n.swell = ctx.createOscillator(); n.swell.frequency.value = 0.2; n.swell.start(t);
    n.swellDepth = gain(0);
    n.swell.connect(n.swellDepth).connect(n.surfGain.gain);

    // Odległy szum głębin (żegluga, sejsmika): stały, więc w głębi zaczyna dominować.
    n.deepLp = filt('lowpass', 95, 0.7);
    n.deepGain = gain(0);
    loop(brown).connect(n.deepLp).connect(n.deepGain).connect(n.ambBus);

    // Przy dnie: syk osadu i przydennego prądu.
    n.botBp = filt('bandpass', 520, 0.9);
    n.botGain = gain(0);
    loop(pink, 2.3).connect(n.botBp).connect(n.botGain).connect(n.ambBus);

    // Silnik łódki: wał + częstotliwość łopat śruby (4×), słychać go głównie pod kadłubem.
    n.engA = ctx.createOscillator(); n.engA.type = 'sawtooth'; n.engA.frequency.value = 22;
    n.engB = ctx.createOscillator(); n.engB.type = 'triangle'; n.engB.frequency.value = 88;
    const engBGain = gain(0.45);
    n.engLp = filt('lowpass', 320, 1.1);
    n.engGain = gain(0);
    n.engA.connect(n.engLp); n.engB.connect(engBGain).connect(n.engLp);
    n.engLp.connect(n.engGain).connect(n.ambBus);
    n.engA.start(t); n.engB.start(t);

    this.nodes = n;
  }

  // -------------------------------------------------------------------------
  // Pętla: wołana co klatkę z gry/laboratorium
  // -------------------------------------------------------------------------
  /**
   * @param listener {x,y, depth (hydrofon), seabed (dno pod łódką), heading (rad), speed, throttle}
   * @param fish     [{id, x, y, depth, seabed, species, excitement, alpha}] — ten sam układ co listener
   * @param env      {depthAt(x,y), profile?}
   * @param now      czas audio (domyślnie ctx.currentTime; offline — podawany ręcznie)
   */
  update({ listener, fish, env, now = null }) {
    if (!this.nodes || !this.running) return;
    now = now ?? this.ctx.currentTime;
    // Planujemy do przodu co najmniej do następnej klatki: przy 5 fps odstęp to 0,2 s,
    // a stały horyzont 0,3 s gubiłby nuty na wolnym sprzęcie.
    const gap = this._lastUpdate === null ? 0 : now - this._lastUpdate;
    this._lastUpdate = now;
    this.lookahead = Math.min(1.2, Math.max(LOOKAHEAD, gap * 1.6));
    this.mode = modeForSeabed(listener.seabed, this.mode);
    this._updateAmbient(listener, now);
    this._scheduleBubbles(listener, now);
    this._scheduleGrid(listener, fish, env, now);
    if (now - this._lastInfo > 0.25) {
      this._lastInfo = now;
      this._computeInfo(listener, fish, env, now);
    }
  }

  /** Poziomy tła z głębokości hydrofonu (h), dna (D) i stanu morza. Opis: docs/dzwiek.md */
  ambientLevels(listener) {
    const { layers } = this.params;
    const ss = this.params.seaState;
    const h = Math.max(0, listener.depth);
    const D = Math.max(h, listener.seabed);
    const sea = seaStateInfo(ss);
    const db = (x) => 10 ** (x / 20);
    const thr = Math.min(1, Math.abs(listener.throttle ?? 0));
    const spd = Math.min(16, Math.abs(listener.speed ?? 0));
    return {
      // hałas fal: +~3 dB na stopień stanu morza (Knudsen), cichnie z głębokością
      surface: layers.surface ? db(-31 + 3.2 * ss - 10 * Math.log10(1 + h / 6)) : 0,
      // pluski i pęcherzyki przy powierzchni są jasne; głębiej zostaje dół pasma
      surfaceCutoff: 220 + 6500 * Math.exp(-h / 10) * (0.55 + 0.1 * ss),
      // falowanie czuć tylko płytko: ruch orbitalny zanika jak e^(-2πh/λ)
      swellDepth: orbitalDecay(h, ss) * 0.85 * Math.min(1, 0.2 + ss / 2),
      swellRate: 1 / sea.period,
      bubbles: layers.bubbles ? 0.13 * Math.exp(-h / 2.2) : 0,
      bubbleRate: 0.3 + 0.35 * ss * ss,
      deep: layers.deep ? db(-37 + 6 * Math.min(1, h / 60)) : 0,
      // ostatnie ~5 m nad dnem
      bottom: layers.bottom ? 0.09 * Math.exp(-(D - h) / 5) : 0,
      engine: layers.engine ? (0.16 / (1 + h / 2.5)) * (0.35 + 0.65 * thr) : 0,
      engineHz: 14 + 20 * thr + 0.8 * spd,
    };
  }

  _updateAmbient(listener, now) {
    const n = this.nodes;
    const a = this.ambientLevels(listener);
    const tc = 0.2;
    n.surfGain.gain.setTargetAtTime(a.surface, now, tc);
    n.surfLp.frequency.setTargetAtTime(a.surfaceCutoff, now, tc);
    n.swellDepth.gain.setTargetAtTime(a.surface * a.swellDepth, now, tc);
    n.swell.frequency.setTargetAtTime(a.swellRate, now, 1);
    n.deepGain.gain.setTargetAtTime(a.deep, now, tc);
    if (now - this._lastBottomWobble > 0.7) {   // przydenny prąd nie jest równy
      this._lastBottomWobble = now;
      n.botGain.gain.setTargetAtTime(a.bottom * (0.55 + 0.45 * Math.random()), now, 0.4);
    }
    n.engGain.gain.setTargetAtTime(a.engine, now, tc);
    n.engA.frequency.setTargetAtTime(a.engineHz, now, 0.3);
    n.engB.frequency.setTargetAtTime(a.engineHz * 4, now, 0.3);
    this._ambient = a;
  }

  /** Pęcherzyki z załamanych fal: rezonans Minnaerta f ≈ 3,26 m·Hz / promień. */
  _scheduleBubbles(listener, now) {
    const a = this._ambient;
    if (this._bubbleClock === null || this._bubbleClock < now) this._bubbleClock = now;
    while (this._bubbleClock < now + this.lookahead) {
      this._bubbleClock += -Math.log(1 - Math.random()) / a.bubbleRate;   // proces Poissona
      if (a.bubbles < 2e-3) continue;
      const t0 = this._bubbleClock;
      const radiusMm = 0.6 + Math.random() * 3;
      const f = 3260 / radiusMm;
      const dur = 0.025 + Math.random() * 0.05;
      const ctx = this.ctx;
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(f, t0);
      osc.frequency.exponentialRampToValueAtTime(f * 1.25, t0 + dur);   // pęcherzyk kurczy się przy powierzchni
      const g = ctx.createGain();
      const amp = a.bubbles * (0.3 + 0.7 * Math.random());
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + 0.002);
      g.gain.setTargetAtTime(0, t0 + 0.002, dur / 3);
      const p = ctx.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      osc.connect(g).connect(p).connect(this.nodes.ambBus);
      osc.start(t0); osc.stop(t0 + dur * 2);
      osc.onended = () => p.disconnect();
    }
  }

  /** Siatka rytmiczna (ósemki): nuty ryb + echosonda na każdą "raz" taktu. */
  _scheduleGrid(listener, fish, env, now) {
    const stepDur = 60 / this.params.bpm / 2;
    if (this._nextStepTime === null || this._nextStepTime < now - 0.2) this._nextStepTime = now + 0.05;
    while (this._nextStepTime < now + this.lookahead) {
      const te = this._nextStepTime;
      const step = this._step++;
      if (step % 8 === 0 && this.params.layers.ping) this._ping(listener, te);
      if (this.params.layers.fish) for (const f of fish) this._maybeNote(f, te, step, listener, env, now);
      this._nextStepTime += stepDur;
    }
  }

  /** Echosonda łódki: ping pod kadłubem, echo od dna wraca po 2D/c.
   *  Prawdziwe echosondy pracują na 50–200 kHz; tu ping jest słyszalny (D6).
   *  Płytko nad piaskiem echo jest głośne i szybkie, nad głębią mułu — ciche i późne. */
  _ping(listener, te) {
    const D = Math.max(1, listener.seabed);
    const c = soundSpeedAt(D / 2);
    const echoDelay = (2 * D) / c;
    const echo = Math.min(0.8, Math.max(0.05, (bottomReflection(Math.PI / 2, D) * 40) / (2 * D)));
    const f = midiToHz(86);
    this._blip(f, te, 0.035, 0.018, 0);
    this._blip(f, te + echoDelay, 0.035 * echo, 0.03, 0);
  }

  _blip(f, t0, amp, dur, pan) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.002);
    g.gain.setTargetAtTime(0, t0 + 0.002, dur / 2);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(this.nodes.ambBus);
    osc.start(t0); osc.stop(t0 + dur * 4);
    osc.onended = () => p.disconnect();
  }

  _noteFor(f) {
    const sp = SPECIES_BY_ID[f.species];
    if (!sp) return null;
    const midi = pitchFor(f, sp, this.mode);
    const f0 = midiToHz(midi);
    const freqs = sp.voice.partials.map((_, i) => f0 * (i + 1));
    return { sp, midi, freqs };
  }

  _maybeNote(f, te, step, listener, env, now) {
    // ryba, której człowiek wyszedł, odpływa w ciszy
    if (f.alpha < 0.05 || f.state === 'leaving') return;
    const note = this._noteFor(f);
    if (!note) return;
    const k = Math.max(1, Math.min(6, note.sp.voice.pulses + Math.round((f.excitement ?? 0) * 2)));
    if (!euclidHit(k, 8, (step + f.id) % 8)) return;
    if (Math.random() > 0.85) return;   // oddech — nie każde uderzenie wzoru
    const res = propagate(
      { x: f.x, y: f.y, z: f.depth },
      { x: listener.x, y: listener.y, z: listener.depth },
      env, note.freqs,
      { seaState: this.params.seaState, absorptionGain: this.params.absorptionGain, paths: this.params.paths },
    );
    // stereo: kierunek do ryby względem dziobu łódki (prawa burta = prawy kanał)
    const pan = Math.sin(res.bearing - (listener.heading ?? 0)) * 0.85;
    this._playNote(note.sp.voice, note.freqs, res, te, pan, Math.min(1, f.alpha), now);
  }

  /** Jedna nuta = jedna kopia na każdą drogę dźwięku, każda z własnym
   *  opóźnieniem, znakiem (faza) i widmem (harmoniczne tłumione osobno). */
  /** Ile głosów brzmi jednocześnie w oknie [t0, t1]. Nuty z dalekich ryb są planowane
   *  sekundy naprzód (opóźnienie propagacji), więc liczymy nakładanie się w czasie,
   *  a nie "wszystko, co jeszcze nie wybrzmiało". */
  _overlapping(t0, t1) {
    let n = 0;
    for (const v of this._voices) if (v.start < t1 && v.end > t0) n++;
    return n;
  }

  _playNote(voice, freqs, res, te, pan, alpha, now) {
    const ctx = this.ctx;
    this._voices = this._voices.filter((v) => v.end > now);
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    panner.connect(this.nodes.fishBus);
    let pending = 0;
    for (const path of res.paths) {
      const amps = voice.partials.map((a, i) => a * Math.abs(path.gains[i]));
      const peak = Math.max(...amps);
      if (peak * voice.level * alpha < 3e-4) continue;   // < -70 dB: i tak ginie w szumie morza — nie twórz węzłów
      const real = new Float32Array(amps.length + 1);
      const imag = new Float32Array(amps.length + 1);
      amps.forEach((a, i) => { imag[i + 1] = a; });
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
      osc.frequency.value = freqs[0];
      const t0 = te + path.delay;
      const tEnd = t0 + voice.attack + voice.decay * 2.2;
      if (this._overlapping(t0, tEnd) >= MAX_VOICES) continue;
      const g = ctx.createGain();
      const amp = (Math.sign(path.gains[0]) || 1) * voice.level * alpha;   // ujemny = odwrócona faza
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(amp, t0 + voice.attack);
      g.gain.setTargetAtTime(0, t0 + voice.attack, voice.decay / 3);
      osc.connect(g).connect(panner);
      osc.start(t0);
      osc.stop(tEnd);
      this._voices.push({ start: t0, end: tEnd });
      pending++;
      osc.onended = () => { g.disconnect(); if (--pending === 0) panner.disconnect(); };
    }
    if (pending === 0) panner.disconnect();
  }

  // -------------------------------------------------------------------------
  // Informacje do UI (co ~0,25 s): kto gra, jak daleko, jak głośno, jaka nuta
  // -------------------------------------------------------------------------
  _computeInfo(listener, fish, env, now) {
    const rows = [];
    for (const f of fish) {
      const note = this._noteFor(f);
      if (!note) continue;
      const freqs = [note.freqs[0]];
      const res = propagate(
        { x: f.x, y: f.y, z: f.depth }, { x: listener.x, y: listener.y, z: listener.depth },
        env, freqs,
        { seaState: this.params.seaState, absorptionGain: this.params.absorptionGain, paths: this.params.paths },
      );
      const direct = res.paths.find((p) => p.kind === 'direct');
      rows.push({
        id: f.id, species: note.sp.name, depth: f.depth,
        note: noteName(note.midi), hz: freqs[0],
        range: res.rh, dist: res.r,
        delay: direct ? direct.delay : res.paths[0]?.delay ?? 0,
        tlDb: direct ? direct.tlDb : NaN,
        shadowDb: direct ? direct.shadowDb : 0,
        blocked: res.blocked,
        levelDb: res.paths.length ? coherentLevelDb(res, freqs) + 20 * Math.log10(note.sp.voice.level) : -120,
        paths: res.paths.map((p) => ({ kind: p.kind, delay: p.delay, gainDb: 20 * Math.log10(Math.abs(p.gains[0]) + 1e-12) })),
      });
    }
    rows.sort((a, b) => b.levelDb - a.levelDb);
    const h = listener.depth, D = listener.seabed;
    const profile = env.profile || BALTIC_SUMMER;
    this.info = {
      fish: rows,
      mode: this.mode,
      voices: this._voices.filter((v) => v.start <= now && v.end > now).length,
      listener: {
        depth: h, seabed: D,
        c: soundSpeedAt(h, profile),
        temperature: profile.temperature(h),
        salinity: profile.salinity(h),
        pingEchoMs: ((2 * D) / soundSpeedAt(D / 2, profile)) * 1000,
      },
      ambient: this._ambient,
      sea: seaStateInfo(this.params.seaState),
    };
  }
}
