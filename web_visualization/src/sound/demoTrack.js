// Podkład demo dla panelu DJ, generowany w kodzie (bez plików, bez licencji).
// Szerokie pasmo celowo: stopa i bas (czy przejdą przez płytką wodę?), hi-hat
// i arpeggio (czy woda zje górę?), akordy w środku.
// 120 BPM, 8 taktów (16 s), pętla, D-dur: D – A – Bm – G (I–V–vi–IV).
export function makeDemoTrack(ctx) {
  const sr = ctx.sampleRate;
  const bpm = 120, beat = 60 / bpm, bars = 8;
  const len = Math.floor(sr * beat * 4 * bars);
  const L = new Float32Array(len), R = new Float32Array(len);
  const hz = (m) => 440 * 2 ** ((m - 69) / 12);
  const add = (t0, dur, fn, pan = 0, gain = 1) => {
    const i0 = Math.floor(t0 * sr), n = Math.floor(dur * sr);
    const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
    for (let j = 0; j < n; j++) {
      const i = (i0 + j) % len;   // zawijanie: pętla bez szwu
      const v = fn(j / sr);
      L[i] += v * gl; R[i] += v * gr;
    }
  };
  const chords = [[50, 54, 57, 61], [45, 49, 52, 56], [47, 50, 54, 57], [43, 47, 50, 54]]; // Dmaj7 Amaj7 Bm7 Gmaj7
  const roots = [38, 33, 35, 31];

  for (let bar = 0; bar < bars; bar++) {
    const ch = chords[bar % 4], root = roots[bar % 4];
    for (let b = 0; b < 4; b++) {
      const t = (bar * 4 + b) * beat;
      // stopa: sinus ze zjazdem 150 -> 45 Hz
      add(t, 0.4, (x) => Math.exp(-x / 0.11) * Math.sin(2 * Math.PI * (45 * x + (105 * 0.03) * (1 - Math.exp(-x / 0.03)))), 0, 0.9);
      // hi-hat na "i": szum z różniczkowaniem (góra pasma)
      let prev = 0;
      add(t + beat / 2, 0.06, (x) => { const w = Math.random() * 2 - 1; const v = w - prev; prev = w; return Math.exp(-x / 0.018) * v; }, 0.3, 0.18);
      // bas: ósemki, piła z kilku harmonicznych
      for (const off of [0, 0.5]) {
        const f = hz(root + (off && b % 2 ? 12 : 0));
        add(t + off * beat, beat * 0.45, (x) => {
          let s = 0;
          for (let h = 1; h <= 6; h++) s += Math.sin(2 * Math.PI * f * h * x) / h;
          return Math.min(1, x / 0.005) * Math.exp(-x / 0.18) * s;
        }, 0, 0.32);
      }
      // akord na 2 i 4, po "i"
      if (b % 2 === 1) {
        for (const m of ch) {
          const f = hz(m);
          add(t + beat / 2, 0.5, (x) => Math.exp(-x / 0.16) * (Math.sin(2 * Math.PI * f * x) + 0.3 * Math.sin(4 * Math.PI * f * x)), -0.25, 0.09);
        }
      }
    }
    // arpeggio szesnastkami w drugiej połowie
    if (bar >= 4) {
      for (let k = 0; k < 16; k++) {
        const m = ch[k % 4] + 24 - (k % 8 >= 4 ? 12 : 0);
        const f = hz(m);
        add((bar * 4) * beat + k * beat / 4, 0.2, (x) => Math.exp(-x / 0.06) * (Math.sin(2 * Math.PI * f * x) + 0.2 * Math.sin(6 * Math.PI * f * x)), 0.35 * Math.sin(k), 0.1);
      }
    }
  }
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const buf = ctx.createBuffer(2, len, sr);
  const k = 0.9 / (peak || 1);
  buf.copyToChannel(L.map((v) => v * k), 0);
  buf.copyToChannel(R.map((v) => v * k), 1);
  return buf;
}

export const DEMO_TRACK_NAME = 'Bałtycki podkład demo (120 BPM, D-dur)';
