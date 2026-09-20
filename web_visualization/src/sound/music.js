// Warstwa muzyczna: jak położenie ryb i dno zamieniają się w dźwięk.
//
//  * Każda ryba brzmi CIĄGLE (wszystkie naraz) — to hydrofon i woda decydują,
//    jak głośno, jak jasno i z jakim opóźnieniem ją słychać (acoustics.js).
//  * WYSOKOŚĆ zależy od głębokości ryby: głębiej = niżej (oktawa na 30 m).
//  * SKALA zależy od dna pod ŁÓDKĄ (miejsce słuchacza ustala harmonię):
//      płycizna -> pentatonika durowa, stok -> heksatonika durowa,
//      głębia -> skala yo (jasna, bez półtonów).
//    Wszystkie tryby są durowe/jasne, żeby morze brzmiało pogodnie.
//    Wysokości ryb są przyciągane do tej skali, więc współbrzmią.
//  * Gatunek daje BARWĘ i puls (dorsz "chrząka" rytmicznie, flądra ledwo faluje).
export const MODES = [
  { id: 'shallow', until: 35, name: 'D-dur pentatonika', mood: 'płycizna — jasno', steps: [0, 2, 4, 7, 9] },
  { id: 'slope', until: 75, name: 'D-dur heksatonika', mood: 'stok — pogodnie', steps: [0, 2, 4, 7, 9, 11] },
  { id: 'deep', until: Infinity, name: 'D yo', mood: 'głębia — świetliście', steps: [0, 2, 5, 7, 9] },
];

/** Skala z głębokości dna pod łódką, z histerezą 3 m (bez migotania na granicy). */
export function modeForSeabed(depth, current = null) {
  if (current) {
    const i = MODES.indexOf(current);
    const lo = i > 0 ? MODES[i - 1].until - 3 : -Infinity;
    const hi = current.until + 3;
    if (depth >= lo && depth < hi) return current;
  }
  return MODES.find((m) => depth < m.until);
}

export function midiToHz(m) {
  return 440 * 2 ** ((m - 69) / 12);
}

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'H'];
export function noteName(midi) {
  const r = Math.round(midi);
  return `${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`;
}

// ---------------------------------------------------------------------------
// Wysokość z głębokości: im głębiej, tym niżej
// ---------------------------------------------------------------------------
/** Powierzchnia = E5 (~659 Hz), oktawa niżej co 34 m wody, nie niżej niż D3 (~147 Hz).
 *  Przykład: 15 m ≈ 494 Hz, 34 m ≈ 330 Hz, 64 m ≈ 185 Hz, 100 m → 147 Hz.
 *  Rejestr podniesiony (było D2 73 Hz przy dnie): przy kilkunastu ciągłych głosach
 *  najniższe dudnienia zlewały się w mętny gul, a prawdziwe odgłosy ryb i tak
 *  leżą głównie w 100–1000 Hz (dorsz „chrząka” 50–500 Hz). */
export const PITCH = { surfaceMidi: 76, metersPerOctave: 34, minMidi: 50 };

export function depthMidi(depth) {
  return Math.max(PITCH.minMidi, PITCH.surfaceMidi - (12 * Math.max(0, depth)) / PITCH.metersPerOctave);
}

/** Najbliższy dźwięk skali (tonika D). Zmiana głębokości przesuwa rybę po skali,
 *  a silnik robi płynne glissando między stopniami. */
export function quantizeToMode(midi, mode) {
  const root = 2; // D
  let best = midi, bestD = Infinity;
  const base = Math.floor(midi / 12) * 12;
  for (let oct = -12; oct <= 12; oct += 12) {
    for (const st of mode.steps) {
      const m = base + oct + root + st;
      const d = Math.abs(m - midi);
      if (d < bestD - 1e-9) { best = m; bestD = d; }
    }
  }
  return Math.max(PITCH.minMidi, best);
}

/** Wysokość ryby: z głębokości (głębiej = niżej), ale nie niżej, niż niesie woda.
 *
 *  `minHz` to fizyczna podłoga miejsca: płytka woda nie przenosi długich fal
 *  (odcięcie falowodu, patrz acoustics.waveguideCutoffHz). Ryba nad 5-metrową
 *  mielizną nie może brzmieć nisko — nie dlatego, że tak chcemy, tylko dlatego,
 *  że taki dźwięk by stamtąd nie doszedł. Nad Głębią Gdańską podłoga znika
 *  i te same ryby mogą mruczeć. Całe stado podnosi się więc, gdy łódka wpływa
 *  na płyciznę, i opada nad głębią. */
export function fishMidi(depth, mode, minHz = 0) {
  let m = quantizeToMode(depthMidi(depth), mode);
  if (minHz > 0) {
    let guard = 0;
    while (midiToHz(m) < minHz && guard++ < 48) {
      let next = m + 1;
      while (quantizeToMode(next, mode) !== next) next++;
      m = next;
    }
  }
  return m;
}
