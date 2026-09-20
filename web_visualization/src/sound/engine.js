// Silnik dźwięku morza (WebAudio). Słuchaczem jest hydrofon opuszczony z łódki.
//
// Każda ryba brzmi CIĄGLE (wszystkie naraz). Jej dźwięk przechodzi przez model kanału
// (acoustics.js), a graf audio odwzorowuje go wprost:
//
//   głos ryby ─> [opóźnienie drogi bezpośredniej: r/c, zmiana = Doppler] ─> górnoprzepust (odcięcie płytkiej wody)
//      ├─> 4 najsilniejsze drogi (bezp., od powierzchni, od dna, wielokrotne): +Δτ, filtr, poziom ze znakiem ─┐
//      ├─> 2 echa od terenu (stok/brzeg): +Δτ (nawet sekundy), filtr, poziom, własny kierunek ────────────────┼─> wyjście
//      └─> reszta dróg (ogon wielokrotnych odbić) ─> wspólny pogłos słupa wody (T60 z dna i osadu) ─────────┘
//   tło morza: fale+falowanie, pęcherzyki, głębiny, dno, silnik; echosonda łódki
//
// Parametry kanału liczone ~8×/s, w audio przejścia są płynne. Można podać
// OfflineAudioContext — wtedy renderuje do bufora (testy, pomiary).
import {
  channel, terrainEchoes, scanReflectors, waterColumnReverb, fitTap, gainAt, FREQ_GRID, waveguideCutoffHz,
  seaStateInfo, orbitalDecay, soundSpeedAt, bottomReflection, BALTIC_SUMMER,
  stereoCues, planeWaveITD, sedimentSand, sedimentName,
} from './acoustics.js';
import { modeForSeabed, fishMidi, midiToHz, noteName } from './music.js';
import { SPECIES_BY_ID } from '../fish/species.js';
import { LifeSound } from './life.js';

export const DEFAULT_PARAMS = {
  volume: 0.8,
  seaState: 2,
  // Mapa ma kilka km, a pochłanianie przy częstotliwościach słyszalnych robi różnicę
  // dopiero na dziesiątkach km. Mnożnik pozwala usłyszeć ten efekt na małej mapie.
  absorptionGain: 20,
  // Doppler: największa dopuszczalna zmiana wysokości od ruchu (0.02 = 2 % ≈ 1/3 półtonu).
  // Ryby pływają realistycznie (~1-2 m/s), więc prawdziwy Doppler jest znikomy;
  // limit jest siatką bezpieczeństwa na duże skoki (np. teleport za łódką).
  doppler: 0.02,
  // Ryby pływają po mapie setki m/s, żeby nadążyć za człowiekiem w kadrze.
  // Przy takim tempie opóźnienie do hydrofonu zmienia się szybciej, niż pozwala
  // limit Dopplera — każdy głos jest wtedy stale przestrojony o ~2 % w losową
  // stronę i z kilkunastu robi się mętny gul. Dlatego OPÓŹNIENIE (czyli Doppler)
  // liczymy z wolniejszej, "dźwiękowej" pozycji, a głośność, kierunek i barwę
  // z prawdziwej — dźwięk nadal reaguje na ruch człowieka natychmiast.
  acousticSpeed: 8,       // [m/s] jak szybko dźwiękowa pozycja goni wizualną (Doppler ≤ 0,55 %)
  acousticDepthRate: 2.5, // [m/s] to samo w pionie
  motion: 0.45,           // ile z pobudzenia człowieka słychać (głośność, jasność, puls)
  maxVoices: 14,          // ile ryb brzmi naraz (najgłośniejsze); reszta i tak ginie w szumie
  maxOrder: 6,            // najwyższy rząd odbić w modelu kanału
  baseline: 3,            // [m] rozstaw uszu hydrofonu stereo (0 = mono, wtedy wraca panorama)
  reverb: 1,              // poziom pogłosu słupa wody
  echoes: 1,              // poziom ech od terenu
  life: 1,                // poziom tła z mieszkańców morza
  bpm: 104,               // puls tła (stworzenia odzywają się na ósemkach), echosonda co takt
  pingPeriod: 60 / 104 * 4,
  layers: { fish: true, life: true, surface: true, bubbles: true, deep: true, bottom: true, engine: true, ping: true },
  paths: { direct: true, surface: true, bottom: true, multi: true },
};

const LOOKAHEAD = 0.3;
const CHANNEL_DT = 0.12;    // [s] co ile przeliczać kanały
const MAX_MAIN_DELAY = 6;   // [s] ~8,5 km — dalej ryby są niesłyszalne
const MAX_TAP_DELAY = 1;    // [s] rozrzut dróg wielokrotnych względem najszybszej
const MAX_ECHO_DELAY = 4.6; // [s] echo od ściany względem drogi bezpośredniej
const TAPS = 4, ECHOES = 2;

function clone(o) {
  return JSON.parse(JSON.stringify(o));
}
const dB = (x) => 20 * Math.log10(Math.abs(x) + 1e-12);

// ---------------------------------------------------------------------------
// Wyjście stereo z prawdziwym ITD/ILD: wejście -> [dL/dR, gL/gR] -> merger(2).
// itd [s]: + = prawy później (źródło z lewej); ildDb [dB]: lewy minus prawy.
// pan: zapasowa panorama (equal-power, jak stary StereoPanner) na wypadek
// mono (baseline 0) albo planów bez wskazówek. Używają ChannelChain i life.js.
// ---------------------------------------------------------------------------
export function createStereoOut(ctx, dest, keep = (x) => x) {
  const input = keep(ctx.createGain());
  const dL = keep(ctx.createDelay(0.05)), dR = keep(ctx.createDelay(0.05));
  const gL = keep(ctx.createGain()), gR = keep(ctx.createGain());
  const merger = keep(ctx.createChannelMerger(2));
  input.connect(dL).connect(gL).connect(merger, 0, 0);
  input.connect(dR).connect(gR).connect(merger, 0, 1);
  merger.connect(dest);
  const set = (now, { itd = 0, ildDb = 0, pan = 0 } = {}, tc = 0.2) => {
    const half = Math.max(-0.02, Math.min(0.02, itd)) / 2;   // max ±20 ms — uszy są blisko siebie
    dL.delayTime.setTargetAtTime(Math.max(0, -half), now, tc);
    dR.delayTime.setTargetAtTime(Math.max(0, half), now, tc);
    const ild = ildDb / 2;
    const pl = Math.cos(((pan + 1) * Math.PI) / 4), pr = Math.sin(((pan + 1) * Math.PI) / 4);
    gL.gain.setTargetAtTime(10 ** (ild / 20) * pl, now, tc);
    gR.gain.setTargetAtTime(10 ** (-ild / 20) * pr, now, tc);
  };
  set(ctx.currentTime, {});
  return { input, set };
}

// ---------------------------------------------------------------------------
// Kanał akustyczny w węzłach WebAudio: wejście -> opóźnienie -> drogi/echa/pogłos
// Ten sam tor obsługuje rybę i podwodny głośnik DJ.
// ---------------------------------------------------------------------------
class ChannelChain {
  constructor(engine, { maxMain = MAX_MAIN_DELAY } = {}) {
    const ctx = engine.ctx;
    const n = engine.nodes;
    this.ctx = ctx;
    this.nodes = [];
    const keep = (x) => { this.nodes.push(x); return x; };
    const gain = (v = 0) => { const g = keep(ctx.createGain()); g.gain.value = v; return g; };
    const filt = (type, f, q = 0.707) => { const b = keep(ctx.createBiquadFilter()); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    const delay = (max) => keep(ctx.createDelay(max));
    this.keep = keep;

    this.input = gain(1);
    this.main = delay(maxMain);
    this.maxMain = maxMain;
    this.hp = filt('highpass', 20, 0.9);         // odcięcie płytkiej wody
    this.input.connect(this.main).connect(this.hp);
    this.stereo = createStereoOut(ctx, n.fishBus, keep);
    this.taps = [];
    for (let i = 0; i < TAPS; i++) {
      const d = i === 0 ? null : delay(MAX_TAP_DELAY);
      const f = filt('lowpass', 16000);
      const g = gain(0);
      (d ? this.hp.connect(d).connect(f) : this.hp.connect(f));
      f.connect(g).connect(this.stereo.input);
      this.taps.push({ d, f, g, cur: null });
    }
    this.echoes = [];
    for (let i = 0; i < ECHOES; i++) {
      const d = delay(MAX_ECHO_DELAY);
      const f = filt('lowpass', 16000);
      const g = gain(0);
      const st = createStereoOut(ctx, n.fishBus, keep);   // echo ma własny kierunek
      this.hp.connect(d).connect(f).connect(g).connect(st.input);
      this.echoes.push({ d, f, g, st, cur: null });
    }
    this.tailLp = filt('lowpass', 16000);        // ogon też traci górę po drodze
    this.tail = gain(0);
    this.hp.connect(this.tailLp).connect(this.tail).connect(n.revIn);
    this.mainCur = null;
    this.doppler = 0;
    this.jumps = 0;        // ile razy trzeba było przeskoczyć opóźnienie (= ile "dziur" w dźwięku)
  }

  /** Płynna zmiana opóźnienia z ograniczeniem szybkości (= ograniczony Doppler).
   *  Duży skok (nowa droga, zmiana ściany) robimy przez ściszenie, żeby nie było "wycia". */
  _slide(param, cur, target, now, dt, rate, gainParam, gainTarget) {
    if (cur === null) {
      param.setValueAtTime(target, now);
      return target;
    }
    if (Math.abs(target - cur) > 0.35 && gainParam) {
      gainParam.cancelScheduledValues(now);
      gainParam.setTargetAtTime(0, now, 0.03);
      param.setValueAtTime(target, now + 0.12);
      gainParam.setTargetAtTime(gainTarget, now + 0.14, 0.08);
      return target;
    }
    const step = Math.max(-rate * dt, Math.min(rate * dt, target - cur));
    const next = cur + step;
    if (param.cancelAndHoldAtTime) param.cancelAndHoldAtTime(now);
    else { param.cancelScheduledValues(now); param.setValueAtTime(cur, now); }
    param.linearRampToValueAtTime(next, now + dt);
    return next;
  }

  /** plan: {main, taps[], echoes[], tail, itd, ildDb, pan, cutoffHz} z SeaSoundEngine._channelPlan */
  apply(plan, now, dt, rate, level = 1) {
    const tc = 0.1;
    this.hp.frequency.setTargetAtTime(Math.min(4000, Math.max(20, plan.cutoffHz)), now, 0.3);
    this.stereo.set(now, plan);
    const prev = this.mainCur;
    const target = Math.min(plan.main, this.maxMain * 0.99);
    // duży skok (przestawiony głośnik, ryba "dogoniona" po długim ruchu): krótkie wyciszenie
    // i przeskok zamiast minut "zjeżdżania" z ograniczonym Dopplerem
    const jump = prev !== null && Math.abs(target - prev) > 0.5;
    if (jump) this.jumps++;
    this.mainCur = this._slide(this.main.delayTime, this.mainCur, target, now, dt, rate, jump ? this.input.gain : null, 1);
    this.doppler = prev === null || jump ? 0 : -((this.mainCur - prev) / dt);
    this.taps.forEach((t, i) => {
      const tp = plan.taps[i];
      const g = tp ? tp.gain * level : 0;
      if (t.d && tp) t.cur = this._slide(t.d.delayTime, t.cur, tp.extra, now, dt, rate * 2, t.g.gain, g);
      t.g.gain.setTargetAtTime(g, now, tc);
      if (tp) t.f.frequency.setTargetAtTime(tp.cutoff, now, tc);
    });
    this.echoes.forEach((e, i) => {
      const ep = plan.echoes[i];
      const g = ep ? ep.gain * level : 0;
      if (ep) {
        e.cur = this._slide(e.d.delayTime, e.cur, ep.extra, now, dt, rate * 2, e.g.gain, g);
        e.f.frequency.setTargetAtTime(ep.cutoff, now, tc);
        e.st.set(now, ep, 0.2);
      }
      e.g.gain.setTargetAtTime(g, now, 0.15);
    });
    this.tail.gain.setTargetAtTime(plan.tail * level, now, 0.2);
    this.tailLp.frequency.setTargetAtTime(plan.tailCutoff ?? 16000, now, 0.2);
  }

  /** Źródło przestawione ręcznie (np. głośnik DJ): krótkie wyciszenie i nowe opóźnienia
   *  od razu, bez "dojeżdżania" z ograniczonym Dopplerem. */
  reset(now) {
    const g = this.input.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0, now, 0.03);
    g.setTargetAtTime(1, now + 0.15, 0.08);
    this.mainCur = null;
    for (const t of [...this.taps, ...this.echoes]) t.cur = null;
  }

  dispose() {
    for (const x of this.nodes) try { x.disconnect(); } catch { /* już odłączony */ }
  }
}

/** Głos ryby: fala z harmonicznych gatunku, puls, oddech -> ChannelChain. */
class FishVoice {
  constructor(engine, fish, now) {
    const ctx = engine.ctx;
    const sp = SPECIES_BY_ID[fish.species];
    this.id = fish.id;
    this.sp = sp;
    this.chain = new ChannelChain(engine);
    const keep = this.chain.keep;
    const gain = (v = 0) => { const g = keep(ctx.createGain()); g.gain.value = v; return g; };

    const amps = sp.voice.partials;
    const real = new Float32Array(amps.length + 1), imag = new Float32Array(amps.length + 1);
    amps.forEach((a, i) => { imag[i + 1] = a; });
    this.osc = keep(ctx.createOscillator());
    this.osc.setPeriodicWave(ctx.createPeriodicWave(real, imag, { disableNormalization: true }));
    this.osc.frequency.value = 110;
    this.tone = keep(ctx.createBiquadFilter());
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 1200;
    this.amp = gain(0);
    this.trem = keep(ctx.createOscillator());
    this.trem.frequency.value = sp.voice.trem.rate;
    this.tremDepth = gain(0);
    this.breath = keep(ctx.createOscillator());
    this.breath.frequency.value = sp.voice.breath.rate * (0.8 + ((fish.id * 0.618) % 1) * 0.4);
    this.breathDepth = gain(0);
    this.osc.connect(this.tone).connect(this.amp).connect(this.chain.input);
    this.trem.connect(this.tremDepth).connect(this.amp.gain);
    this.breath.connect(this.breathDepth).connect(this.amp.gain);
    this.stopAt = null;
    for (const o of [this.osc, this.trem, this.breath]) o.start(now);
  }

  get doppler() {
    return this.chain.doppler;
  }

  apply(plan, now, dt, rate) {
    const v = this.sp.voice;
    this.osc.frequency.setTargetAtTime(plan.f0, now, 0.35);                // glissando po skali
    this.tone.frequency.setTargetAtTime(Math.min(12000, plan.f0 * plan.bright), now, 0.2);
    const base = plan.level * (1 - v.breath.depth / 2 - v.trem.depth / 4);
    this.amp.gain.setTargetAtTime(base, now, 0.25);
    this.tremDepth.gain.setTargetAtTime(plan.level * v.trem.depth / 4, now, 0.25);
    this.breathDepth.gain.setTargetAtTime(plan.level * v.breath.depth / 2, now, 0.25);
    this.trem.frequency.setTargetAtTime(v.trem.rate * (1 + plan.excitement), now, 0.5);
    this.chain.apply(plan, now, dt, rate);
  }

  /** Wyciszenie; węzły zwalniamy dopiero, gdy z linii opóźniających wybrzmi wszystko. */
  release(now) {
    if (this.stopAt) return;
    // puls i oddech też dodają się do wzmocnienia — trzeba wyzerować wszystkie trzy,
    // inaczej modulacja brzmi dalej sama (ryba "nie cichnie")
    for (const g of [this.amp.gain, this.tremDepth.gain, this.breathDepth.gain]) {
      g.cancelScheduledValues(now);
      g.setTargetAtTime(0, now, 0.4);
    }
    this.stopAt = now + 2.5 + MAX_MAIN_DELAY + MAX_ECHO_DELAY;
    this.osc.onended = () => this.chain.dispose();
    for (const o of [this.osc, this.trem, this.breath]) o.stop(this.stopAt);
  }
}

/** Podwodny głośnik DJ: dowolna muzyka (bufor audio) -> ChannelChain -> statek.
 *  Równolegle tor "na lądzie" (bez wody) do porównania suwakiem. */
class MusicVoice {
  constructor(engine, buffer, now) {
    const ctx = engine.ctx;
    this.chain = new ChannelChain(engine, { maxMain: 20 });   // głośnik może stać daleko (20 s ≈ 29 km)
    this.src = ctx.createBufferSource();
    this.src.buffer = buffer;
    this.src.loop = true;
    this.wet = ctx.createGain(); this.wet.gain.value = 0;
    this.dry = ctx.createGain(); this.dry.gain.value = 0;
    this.src.connect(this.wet).connect(this.chain.input);
    this.src.connect(this.dry).connect(engine.nodes.master);
    this.src.start(now);
    this.stopped = false;
  }

  get doppler() {
    return this.chain.doppler;
  }

  apply(plan, now, dt, rate, { level, mix }) {
    // mix: 0 = słychać oryginał ("na lądzie"), 1 = tylko to, co dociera do statku
    this.wet.gain.setTargetAtTime(level * Math.sin((mix * Math.PI) / 2), now, 0.1);
    this.dry.gain.setTargetAtTime(0.35 * Math.cos((mix * Math.PI) / 2), now, 0.1);
    this.chain.apply(plan, now, dt, rate);
  }

  stop(now) {
    if (this.stopped) return;
    this.stopped = true;
    this.wet.gain.setTargetAtTime(0, now, 0.1);
    this.dry.gain.setTargetAtTime(0, now, 0.1);
    const end = now + 0.5 + this.chain.maxMain + MAX_ECHO_DELAY;
    this.src.stop(end);
    this.src.onended = () => { this.chain.dispose(); this.wet.disconnect(); this.dry.disconnect(); };
  }
}

// ---------------------------------------------------------------------------
export class SeaSoundEngine {
  constructor({ context = null } = {}) {
    this.ctx = context;
    this.params = clone(DEFAULT_PARAMS);
    this.nodes = null;
    this.running = false;
    this.mode = null;
    this.voices = new Map();
    this.info = { fish: [], listener: null, mode: null, voices: 0 };
    this.lookahead = LOOKAHEAD;
    this._bubbleClock = null;
    this._nextPing = null;
    this._lastChannels = null;
    this._lastInfo = -Infinity;
    this._lastBottomWobble = -Infinity;
    this._lastUpdate = null;
    this._scan = null;
    this._scanKey = null;
    this._acousticPos = new Map();   // id ryby -> wolniejsza, "dźwiękowa" pozycja
    this._reverbKey = null;
    this._plans = [];
  }

  async start() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'playback' });
    }
    const offline = typeof this.ctx.startRendering === 'function';
    if (!offline && this.ctx.state === 'suspended') await this.ctx.resume();
    if (!this.nodes) this._build();
    // _build stawia domyślne wzmocnienia — nałóż aktualne params (setParams
    // przed startem, np. z renderOffline, nie miało do czego ich zastosować).
    const t = this.ctx.currentTime;
    this.nodes.master.gain.setTargetAtTime(this.params.volume, t, 0.05);
    this.nodes.revOut.gain.setTargetAtTime(0.9 * this.params.reverb, t, 0.1);
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
    if (!this.nodes) return;
    const t = this.ctx.currentTime;
    if ('volume' in rest) this.nodes.master.gain.setTargetAtTime(rest.volume, t, 0.05);
    if ('reverb' in rest) this.nodes.revOut.gain.setTargetAtTime(0.9 * rest.reverb, t, 0.1);
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
    n.pingBus = gain(1); n.pingBus.connect(n.ambBus);
    n.lifeBus = gain(1); n.lifeBus.connect(n.master);

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

    // Pogłos słupa wody: dwa splotowe pogłosy na zmianę (płynne przejście przy zmianie
    // dna pod łódką — podmiana bufora w jednym węźle trzaskałaby).
    n.revIn = gain(1);
    n.revOut = gain(0.9);
    n.revOut.connect(n.master);
    n.rev = [0, 1].map(() => {
      const conv = ctx.createConvolver();
      conv.normalize = false;
      const g = gain(0);
      n.revIn.connect(conv).connect(g).connect(n.revOut);
      return { conv, g };
    });
    n.revActive = -1;

    this.nodes = n;
    this.lifeSound = new LifeSound(this);
  }

  // -------------------------------------------------------------------------
  // Pętla: wołana co klatkę z gry/laboratorium
  // -------------------------------------------------------------------------
  /**
   * @param listener {x,y, depth (hydrofon), seabed (dno pod łódką), heading (rad), speed, throttle}
   * @param fish     [{id, x, y, depth, seabed, species, excitement, alpha, state}] — ten sam układ co listener
   * @param env      {depthAt(x,y), profile?}
   * @param life     [{id, kind, x, y, depth, seabed}] — mieszkańcy morza (tło), ten sam układ
   * @param music    {x, y, depth, playing, level, mix} — podwodny głośnik DJ albo null
   * @param now      czas audio (domyślnie ctx.currentTime; offline — podawany ręcznie)
   */
  update({ listener, fish, env, life = [], music = null, now = null }) {
    if (!this.nodes || !this.running) return;
    now = now ?? this.ctx.currentTime;
    const gap = this._lastUpdate === null ? 0 : now - this._lastUpdate;
    this._lastUpdate = now;
    this.lookahead = Math.min(1.2, Math.max(LOOKAHEAD, gap * 1.6));
    this.mode = modeForSeabed(listener.seabed, this.mode);
    this._updateAmbient(listener, now);
    this._scheduleBubbles(listener, now);
    this._schedulePing(listener, now);
    this._updateReverb(listener, env, now);
    if (this.params.layers.life) {
      this.lifeSound.update(listener, life, env, this._reflectors(listener, env), now, this.lookahead);
    }
    if (this._lastChannels === null || now - this._lastChannels >= CHANNEL_DT) {
      const dt = this._lastChannels === null ? CHANNEL_DT : Math.min(1, now - this._lastChannels);
      this._lastChannels = now;
      this._updateFish(listener, fish, env, now, dt);
      this._updateMusic(listener, music, env, now, dt);
    }
    if (now - this._lastInfo > 0.25) {
      this._lastInfo = now;
      this._computeInfo(listener, env, now);
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

  /** Echosonda łódki: ping pod kadłubem, echo od dna wraca po 2D/c, a potem
   *  wybrzmiewa w pogłosie słupa wody. Prawdziwe echosondy pracują na 50–200 kHz;
   *  tu ping jest słyszalny (D6). */
  _schedulePing(listener, now) {
    if (this._nextPing === null || this._nextPing < now - 0.5) this._nextPing = now + 0.1;
    while (this._nextPing < now + this.lookahead) {
      if (this.params.layers.ping) this._ping(listener, this._nextPing);
      this._nextPing += this.params.pingPeriod;
    }
  }

  _ping(listener, te) {
    const D = Math.max(1, listener.seabed);
    const c = soundSpeedAt(D / 2);
    const echoDelay = (2 * D) / c;
    const echo = Math.min(0.8, Math.max(0.05, (bottomReflection(Math.PI / 2, D) * 40) / (2 * D)));
    const f = midiToHz(86);
    this._blip(f, te, 0.035, 0.018, 0, 0.15);
    this._blip(f, te + echoDelay, 0.035 * echo, 0.03, 0, 0.3);
  }

  _blip(f, t0, amp, dur, pan, revSend = 0) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(amp, t0 + 0.002);
    g.gain.setTargetAtTime(0, t0 + 0.002, dur / 2);
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    osc.connect(g).connect(p).connect(this.nodes.pingBus);
    let send = null;
    if (revSend > 0) {
      send = ctx.createGain();
      send.gain.value = revSend;
      g.connect(send).connect(this.nodes.revIn);
    }
    osc.start(t0); osc.stop(t0 + dur * 4);
    osc.onended = () => { p.disconnect(); send?.disconnect(); };
  }

  // -------------------------------------------------------------------------
  // Pogłos słupa wody: odpowiedź impulsowa z modelu (T60, trzepotanie)
  // -------------------------------------------------------------------------
  _updateReverb(listener, env, now) {
    const sand = sedimentSand(env, listener.x, listener.y).sand;
    const rv = waterColumnReverb(listener.seabed, this.params.seaState, env.profile || BALTIC_SUMMER, sand);
    const key = `${rv.t60.toFixed(1)}|${rv.t60High.toFixed(1)}|${(rv.flutterPeriod * 1000).toFixed(0)}|${(sand ?? -1).toFixed(2)}`;
    this.reverbInfo = rv;
    if (key === this._reverbKey) return;
    if (this._reverbAt && now - this._reverbAt < 1.5) return;   // nie częściej niż co 1,5 s
    this._reverbKey = key;
    this._reverbAt = now;
    const n = this.nodes;
    const next = n.revActive === 0 ? 1 : 0;
    n.rev[next].conv.buffer = this._reverbIR(rv);
    n.rev[next].g.gain.setTargetAtTime(1, now, 0.3);
    if (n.revActive >= 0) n.rev[n.revActive].g.gain.setTargetAtTime(0, now, 0.3);
    n.revActive = next;
  }

  /** IR: trzepotanie (odbicia pionowe co 2D/c, słabnące o |Rs·Rb|) + rozproszony ogon
   *  z zanikiem T60, wysokie tony gasną szybciej (T60 wysokich z szorstkości fal). */
  _reverbIR(rv) {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * Math.min(5.5, rv.t60 * 1.1 + 0.1));
    const buf = this.ctx.createBuffer(2, len, sr);
    const kLow = 6.91 / rv.t60, kHigh = 6.91 / rv.t60High;
    const a1 = 1 - Math.exp((-2 * Math.PI * 700) / sr);    // podział na niskie/wysokie ~700 Hz
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, hf = 0;
      let energy = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const w = Math.random() * 2 - 1;
        lp += a1 * (w - lp);
        // górne pasmo z filtrem, który z czasem się zamyka (4 kHz -> ~800 Hz):
        // im dłużej dźwięk krąży w wodzie, tym ciemniej brzmi
        const fc = 800 + 3200 * Math.exp(-t / 0.35);
        hf += (1 - Math.exp((-2 * Math.PI * fc) / sr)) * (w - lp - hf);
        const onset = Math.min(1, t / 0.02);
        d[i] = onset * (lp * 2.2 * Math.exp(-kLow * t) + hf * 0.5 * Math.exp(-kHigh * t));
      }
      // trzepotanie: pionowe odbicia dno–powierzchnia
      for (let k = 1; k < 40; k++) {
        const t = k * rv.flutterPeriod + (ch ? 0.0007 : 0);
        const i = Math.floor(t * sr);
        if (i >= len - 8) break;
        const a = 0.6 * rv.flutterGain ** k * (k % 2 ? -1 : 1);
        if (Math.abs(a) < 1e-3) break;
        for (let j = 0; j < 6; j++) d[i + j] += a * (1 - j / 6);
      }
      for (let i = 0; i < len; i++) energy += d[i] * d[i];
      const norm = 1 / Math.sqrt(energy || 1);
      for (let i = 0; i < len; i++) d[i] *= norm;
    }
    return buf;
  }

  // -------------------------------------------------------------------------
  // Ryby: kanał akustyczny -> plan -> węzły
  // -------------------------------------------------------------------------
  _reflectors(listener, env) {
    const key = `${Math.round(listener.x / 60)}|${Math.round(listener.y / 60)}|${Math.round(listener.seabed)}`;
    if (key !== this._scanKey) {
      this._scanKey = key;
      this._scan = scanReflectors({ x: listener.x, y: listener.y, z: listener.depth }, env);
    }
    return this._scan;
  }

  /** Z modelu kanału robi plan dla węzłów: 4 najsilniejsze drogi jako osobne
   *  linie, reszta dróg energetycznie do pogłosu, 2 echa od terenu.
   *  fRef — częstotliwość, przy której dopasowujemy filtry (środek pasma dźwięku). */
  _channelPlan(src, listener, env, scan, fRef, { taps: nTaps = TAPS, echoes: nEchoes = ECHOES, maxOrder, srcScan = null } = {}) {
    const rcv = { x: listener.x, y: listener.y, z: listener.depth };
    const opts = {
      seaState: this.params.seaState, absorptionGain: this.params.absorptionGain,
      maxOrder: maxOrder ?? this.params.maxOrder, paths: this.params.paths,
    };
    const ch = channel(src, rcv, env, opts);
    const baseline = this.params.baseline ?? 0;
    const cues = stereoCues(src, listener, baseline, ch.cMean);
    const ranked = ch.arrivals
      .map((a) => ({ a, g: gainAt(ch.freqs, a.gains, fRef) }))
      .filter((x) => Math.abs(x.g) > 1e-5);
    const byStrength = [...ranked].sort((x, y) => Math.abs(y.g) - Math.abs(x.g));
    const chosen = [];
    for (const x of byStrength) {
      if (chosen.length >= nTaps) break;
      if (chosen.length && x.a.delay - Math.min(...chosen.map((c) => c.a.delay)) > MAX_TAP_DELAY * 0.95) continue;
      chosen.push(x);
    }
    chosen.sort((x, y) => x.a.delay - y.a.delay);
    const main = chosen.length ? chosen[0].a.delay : ch.r / ch.cMean;
    let tailE = 0;
    const tailSpec = new Float64Array(ch.freqs.length);   // widmo energii dróg, które idą do pogłosu
    for (const x of ranked) {
      if (chosen.includes(x)) continue;
      tailE += x.g * x.g;
      for (let i = 0; i < ch.freqs.length; i++) tailSpec[i] += x.a.gains[i] * x.a.gains[i];
    }
    const tailCutoff = tailE > 0 ? fitTap(ch.freqs, Array.from(tailSpec, Math.sqrt), fRef).cutoff
      : (chosen.length ? fitTap(ch.freqs, chosen[0].a.gains, fRef).cutoff : 16000);

    const taps = chosen.map(({ a }) => {
      const fit = fitTap(ch.freqs, a.gains, fRef);
      return { extra: a.delay - main, gain: fit.gain, cutoff: fit.cutoff, label: a.label, kind: a.kind, delay: a.delay };
    });
    const echoes = this.params.echoes > 0 && nEchoes > 0
      ? terrainEchoes(src, rcv, srcScan ? { ...scan, reflectors: [...scan.reflectors, ...srcScan.reflectors] } : scan, env,
        { count: nEchoes, absorptionGain: this.params.absorptionGain, seaState: this.params.seaState })
        .filter((e) => e.delay - main > 0.02 && e.delay - main < MAX_ECHO_DELAY * 0.97)
        .map((e) => {
          const fit = fitTap(FREQ_GRID, e.gains, fRef);
          const rel = e.bearing - (listener.heading ?? 0);
          return {
            extra: e.delay - main, gain: fit.gain * this.params.echoes, cutoff: fit.cutoff, delay: e.delay,
            itd: planeWaveITD(e.bearing, listener.heading ?? 0, baseline, ch.cMean),
            ildDb: 0,   // echo z km: fala płaska, wskazówką jest sam czas
            pan: Math.sin(rel) * 0.85, label: e.label, range: e.reflector.range,
          };
        })
      : [];
    const directG = taps.length ? Math.abs(taps[0].gain) : 0;
    const tail = Math.sqrt(tailE) + 0.05 * directG;   // + trochę rozpraszania objętościowego
    const loud = Math.max(...taps.map((t) => Math.abs(t.gain)), ...echoes.map((e) => Math.abs(e.gain)), tail, 0);
    return {
      main, taps, echoes, tail, tailCutoff, loud, cMean: ch.cMean,
      itd: cues.itd, ildDb: cues.ildDb,
      pan: Math.sin(ch.bearing - (listener.heading ?? 0)) * 0.85,
      cutoffHz: ch.cutoffHz, landBlocked: ch.landBlocked,
      range: ch.rh, dist: ch.r, D: ch.D, Dmin: ch.Dmin, nArrivals: ch.arrivals.length, arrivals: ch.arrivals,
    };
  }

  /** Pozycja, którą "słyszy" model: goni wizualną z ograniczoną prędkością.
   *  Dzięki temu ryba może śmigać po mapie, a dźwięk zmienia się płynnie. */
  _acoustic(f, dt) {
    let a = this._acousticPos.get(f.id);
    if (!a) {
      a = { x: f.x, y: f.y, depth: f.depth, exc: f.excitement ?? 0 };
      this._acousticPos.set(f.id, a);
      return a;
    }
    const dx = f.x - a.x, dy = f.y - a.y;
    const d = Math.hypot(dx, dy);
    // Im dalej dźwiękowa pozycja została w tyle, tym szybciej nadrabia — płynnie,
    // bez przeskoku. Twardy przeskok robił dziurę w dźwięku co kilka sekund pogoni.
    const speed = this.params.acousticSpeed * (1 + Math.min(1, d / 800));   // najwyżej 2× (≈1 % przestrojenia)
    const step = speed * Math.max(0.01, dt);
    if (d > 3000) { a.x = f.x; a.y = f.y; }          // teleport łowiska — nie ma czego gonić
    else if (d > step) { a.x += (dx / d) * step; a.y += (dy / d) * step; }
    else { a.x = f.x; a.y = f.y; }
    const mz = this.params.acousticDepthRate * Math.max(0.01, dt);
    a.depth += Math.max(-mz, Math.min(mz, f.depth - a.depth));
    a.exc += ((f.excitement ?? 0) - a.exc) * Math.min(1, dt / 1.5);
    return a;
  }

  /** Odcięcie falowodu dla drogi źródło -> hydrofon (tanio: 3 punkty zamiast 16).
   *  Decyduje najpłytsze miejsce na drodze, nie głębokość źródła. */
  placeCutoffHz(src, listener, env) {
    const d = Math.min(
      env.depthAt(src.x, src.y),
      env.depthAt(listener.x, listener.y),
      env.depthAt((src.x + listener.x) / 2, (src.y + listener.y) / 2),
    );
    return waveguideCutoffHz(d, 1450);
  }

  _plan(f, listener, env, scan, dt = CHANNEL_DT) {
    const sp = SPECIES_BY_ID[f.species];
    const slow = this._acoustic(f, dt);
    // fizyczna podłoga wysokości: płytka woda po drodze nie przeniesie niskich tonów
    const minHz = this.placeCutoffHz(f, listener, env) * 1.35;
    const midi = fishMidi(f.depth, this.mode, minHz);
    const f0 = midiToHz(midi);
    const fRef = Math.max(f0 * 1.5, 90);   // barwa ryby leży głównie w 1.–3. harmonicznej
    const cp = this._channelPlan({ x: f.x, y: f.y, z: f.depth }, listener, env, scan, fRef);
    // Opóźnienie (a więc Doppler) z wolniejszej pozycji; odstępy między drogami
    // i echami zostają względne, więc cała wiązka przesuwa się razem.
    cp.main = Math.hypot(slow.x - listener.x, slow.y - listener.y, slow.depth - listener.depth) / cp.cMean;
    const alpha = f.state === 'leaving' ? 0 : Math.min(1, f.alpha ?? 1);
    const exc = slow.exc * this.params.motion;       // ruch słychać, ale delikatniej
    const level = sp.voice.level * alpha * (0.7 + 0.6 * exc);
    // odcięcie płytkiej wody: podstawowa ryby poniżej f_c nie przejdzie — zostają harmoniczne
    const partialsPass = sp.voice.partials.map((a, i) => (f0 * (i + 1) >= cp.cutoffHz ? a : 0)).reduce((s2, v) => s2 + v, 0);
    const passFrac = partialsPass / sp.voice.partials.reduce((s2, v) => s2 + v, 0);
    return {
      ...cp,
      id: f.id, species: sp.name, speciesId: f.species, depth: f.depth, midi, f0, note: noteName(midi),
      level, excitement: exc, bright: sp.voice.bright * (0.85 + 0.6 * exc),
      tail: cp.tail * level > 0 ? cp.tail : 0,
      priorityDb: dB(cp.loud * level * Math.max(passFrac, 1e-3)),
    };
  }

  _updateFish(listener, fish, env, now, dt) {
    const scan = this._reflectors(listener, env);
    const plans = [];
    if (this.params.layers.fish) {
      for (const f of fish) {
        if ((f.alpha ?? 1) < 0.02 && !this.voices.has(f.id)) continue;
        const p = this._plan(f, listener, env, scan, dt);
        if (p.main > MAX_MAIN_DELAY * 0.97) continue;   // za daleko
        plans.push(p);
      }
    }
    // najgłośniejsze dostają głos; istniejący głos trzymamy, dopóki nie przegra o 6 dB
    plans.sort((a, b) => b.priorityDb + (this.voices.has(b.id) ? 6 : 0) - (a.priorityDb + (this.voices.has(a.id) ? 6 : 0)));
    const selected = new Set(plans.slice(0, this.params.maxVoices).filter((p) => p.priorityDb > -95).map((p) => p.id));
    for (const [id, v] of this.voices) {
      if (!selected.has(id)) { v.release(now); this.voices.delete(id); }
    }
    const rate = this.params.doppler;
    for (const p of plans) {
      p.voiced = selected.has(p.id);
      if (!p.voiced) continue;
      let v = this.voices.get(p.id);
      if (!v) { v = new FishVoice(this, fish.find((f) => f.id === p.id), now); this.voices.set(p.id, v); }
      v.apply(p, now, dt, rate);
      p.doppler = v.doppler;
    }
    if (this._acousticPos.size > fish.length + 8) {
      const alive = new Set(fish.map((f) => f.id));
      for (const id of this._acousticPos.keys()) if (!alive.has(id)) this._acousticPos.delete(id);
    }
    this._plans = plans;
  }

  // -------------------------------------------------------------------------
  // Panel DJ: podwodny głośnik z dowolną muzyką
  // -------------------------------------------------------------------------
  /** Bufor muzyki (demo albo plik użytkownika). Zmiana w trakcie grania = płynne przejście. */
  setMusicBuffer(buffer) {
    this.musicBuffer = buffer;
    if (this.musicVoice && this.nodes) { this.musicVoice.stop(this.ctx.currentTime); this.musicVoice = null; }
  }

  _updateMusic(listener, music, env, now, dt) {
    if (!music || !music.playing || !this.musicBuffer) {
      if (this.musicVoice) { this.musicVoice.stop(now); this.musicVoice = null; }
      this.musicInfo = null;
      return;
    }
    if (!this.musicVoice) this.musicVoice = new MusicVoice(this, this.musicBuffer, now);
    if (music.moveId !== this._musicMoveId) {      // głośnik przestawiony
      if (this._musicMoveId !== undefined) this.musicVoice.chain.reset(now);
      this._musicMoveId = music.moveId;
    }
    // muzyka jest szerokopasmowa: filtry dopasowujemy w środku pasma (~500 Hz).
    // Ściany szukamy też wokół głośnika — postawiony pod klifem ma echo od klifu.
    const key = `${Math.round(music.x / 60)}|${Math.round(music.y / 60)}|${Math.round(music.depth)}`;
    if (key !== this._musicScanKey) {
      this._musicScanKey = key;
      this._musicScan = scanReflectors({ x: music.x, y: music.y, z: music.depth }, env, { maxRange: 3000 });
    }
    const plan = this._channelPlan({ x: music.x, y: music.y, z: music.depth }, listener, env, this._reflectors(listener, env), 500,
      { srcScan: this._musicScan });
    const blocked = plan.landBlocked;
    this.musicVoice.apply(plan, now, dt, this.params.doppler, { level: blocked ? 0 : music.level, mix: music.mix });
    this.musicInfo = {
      dist: plan.dist, range: plan.range, delay: plan.main, cutoffHz: plan.cutoffHz, landBlocked: blocked,
      tooFar: plan.main > this.musicVoice.chain.maxMain,
      taps: plan.taps.length, spreadMs: plan.taps.length ? (plan.taps[plan.taps.length - 1].delay - plan.main) * 1000 : 0,
      echoes: plan.echoes.map((e) => ({ label: e.label, delay: e.delay, gainDb: dB(e.gain), range: e.range })),
      levelDb: dB(plan.loud * music.level), doppler: this.musicVoice.doppler,
    };
  }

  // -------------------------------------------------------------------------
  // Informacje do UI
  // -------------------------------------------------------------------------
  _computeInfo(listener, env, now) {
    const h = listener.depth, D = listener.seabed;
    const profile = env.profile || BALTIC_SUMMER;
    const rows = this._plans.map((p) => ({
      id: p.id, species: p.species, speciesId: p.speciesId, depth: p.depth, midi: p.midi, note: p.note, hz: p.f0,
      range: p.range, dist: p.dist, delay: p.main, doppler: p.doppler ?? 0,
      itdMs: (p.itd ?? 0) * 1000, ildDb: p.ildDb ?? 0,
      levelDb: p.priorityDb, voiced: p.voiced, cutoffHz: p.cutoffHz, landBlocked: p.landBlocked,
      taps: p.taps.map((t) => ({ label: t.label, kind: t.kind, delay: t.delay, gainDb: dB(t.gain) })),
      echoes: p.echoes.map((e) => ({ label: e.label, delay: e.delay, gainDb: dB(e.gain), range: e.range })),
      tailDb: dB(p.tail), nArrivals: p.nArrivals,
    })).sort((a, b) => b.levelDb - a.levelDb);
    const rv = this.reverbInfo || waterColumnReverb(D, this.params.seaState, profile);
    const sed = sedimentSand(env, listener.x, listener.y);
    this.info = {
      fish: rows,
      mode: this.mode,
      voices: this.voices.size,
      jumps: [...this.voices.values()].reduce((n, v) => n + (v.chain?.jumps ?? 0), 0),
      life: this.lifeSound?.stats() ?? {},
      music: this.musicInfo,
      reverb: rv,
      reflectors: this._scan?.reflectors.length ?? 0,
      listener: {
        depth: h, seabed: D,
        c: soundSpeedAt(h, profile),
        temperature: profile.temperature(h),
        salinity: profile.salinity(h),
        sand: sed.sand, sandSource: sed.source,
        sediment: sed.sand === null ? 'model z głębokości' : sedimentName(sed.sand),
        pingEchoMs: ((2 * D) / soundSpeedAt(D / 2, profile)) * 1000,
      },
      ambient: this._ambient,
      sea: seaStateInfo(this.params.seaState),
    };
  }
}
