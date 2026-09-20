// Podkład demo dla panelu DJ, generowany w kodzie (bez plików, bez licencji).
// Szerokie pasmo celowo: stopa i bas (czy przejdą przez płytką wodę?), hi-hat
// i arpeggio (czy woda zje górę?), akordy w środku.
// 120 BPM, 8 taktów (16 s), pętla, D-dur: D – A – Bm – G (I–V–vi–IV).
//
// Perkusja jest celowo WYRAZISTA — puls ma być czytelny nie tylko dla ucha,
// ale i dla detekcji rytmu (amplituda + bit sterują ruchem muszelek), a woda
// rozmywa transjenty: pogłos i echa zalewają wszystko, co za miękko uderza.
// Stąd stopa z klikiem, werbel na 2 i 4 (backbeat niesie puls, gdy płytka woda
// odetnie bas) i hi-haty na ósemkach z akcentami.
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
  const noise = () => Math.random() * 2 - 1;

  // --- perkusja ---------------------------------------------------------
  /** Stopa: klik na ataku (przebija się przez pogłos) + zjazd 150 -> 45 Hz. */
  const kick = (t, gain = 1) => add(t, 0.45, (x) => {
    const swept = Math.sin(2 * Math.PI * (45 * x + 105 * 0.03 * (1 - Math.exp(-x / 0.03))));
    const click = Math.exp(-x / 0.0025) * (0.7 * Math.sin(2 * Math.PI * 1600 * x) + 0.3 * noise());
    return Math.exp(-x / 0.11) * swept + 2 * click;
  }, 0, gain);

  /** Werbel: trzask w górze pasma + korpus 186/330 Hz. Backbeat na 2 i 4 niesie
   *  puls nawet wtedy, gdy płytka woda odetnie stopę. */
  const snare = (t, gain = 1) => {
    let prev = 0, lp = 0;
    add(t, 0.3, (x) => {
      const w = noise();
      lp += (w - lp) * 0.25;                  // szum z przytłumioną górą = korpus
      const crack = w - prev; prev = w;       // różniczka = trzask
      const body = Math.sin(2 * Math.PI * 186 * x) + 0.6 * Math.sin(2 * Math.PI * 330 * x);
      return Math.exp(-x / 0.055) * (1.1 * lp + 0.8 * crack) + Math.exp(-x / 0.045) * 0.45 * body;
    }, -0.08, gain);
  };

  /** Hi-hat: różniczkowany szum (góra pasma); `open` wydłuża wybrzmienie. */
  const hat = (t, gain = 1, open = false) => {
    let prev = 0;
    add(t, open ? 0.22 : 0.06, (x) => {
      const w = noise(); const v = w - prev; prev = w;
      return Math.exp(-x / (open ? 0.085 : 0.016)) * v;
    }, 0.3, gain);
  };

  for (let bar = 0; bar < bars; bar++) {
    const ch = chords[bar % 4], root = roots[bar % 4];
    for (let b = 0; b < 4; b++) {
      const t = (bar * 4 + b) * beat;
      kick(t, b % 2 === 0 ? 0.95 : 0.7);            // akcent na 1 i 3
      if (b === 2) kick(t + beat * 0.75, 0.45);     // synkopa tuż przed "4"
      if (b % 2 === 1) snare(t, 0.6);               // backbeat: 2 i 4
      // hi-hat głośniej na ćwierćnucie niż na "i" — inaczej ósemki rozmywają puls,
      // za którym ma chodzić wykrywanie bitu
      hat(t, 0.22);
      hat(t + beat / 2, 0.13, b === 3 && bar % 2 === 1);  // co drugi takt otwarty
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
    // fill szesnastkami na ostatniej ćwierci 4. i 8. taktu: zapowiada zmianę
    // i daje detekcji rytmu wyraźny znacznik końca frazy
    if (bar % 4 === 3) {
      for (let k = 1; k < 4; k++) snare((bar * 4 + 3) * beat + (k * beat) / 4, 0.4 + 0.15 * k);
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
  // Miękkie ograniczenie zamiast dzielenia całości przez szczyt stopy: transjenty
  // perkusji zostają ostre, a reszta miksu nie robi się od nich cicha.
  let peak = 0;
  for (let i = 0; i < len; i++) {
    L[i] = Math.tanh(1.1 * L[i]); R[i] = Math.tanh(1.1 * R[i]);
    peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  }
  const buf = ctx.createBuffer(2, len, sr);
  const k = 0.9 / (peak || 1);
  buf.copyToChannel(L.map((v) => v * k), 0);
  buf.copyToChannel(R.map((v) => v * k), 1);
  return buf;
}

export const DEMO_TRACK_NAME = 'Bałtycki podkład demo (120 BPM, D-dur)';
