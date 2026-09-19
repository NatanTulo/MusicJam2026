// Warstwa muzyczna: jak położenie ryb i dno zamieniają się w nuty.
//
//  * SKALA zależy od dna pod ŁÓDKĄ (miejsce słuchacza ustala harmonię):
//      płycizna -> jasna pentatonika durowa, stok -> mollowa, głębia -> mroczne in-sen.
//    Wszystkie ryby grają w tej samej skali, więc nic się nie gryzie.
//  * WYSOKOŚĆ zależy od głębokości RYBY w jej warstwie: niżej = niższa nuta.
//    Rejestr (oktawa) daje gatunek: szprot przy powierzchni wysoko, flądra przy dnie nisko.
//  * RYTM: rytm euklidesowy (k uderzeń na 8 ósemek), k rośnie, gdy człowiek się rusza.
//    Przesunięcie wzoru z ID ryby — ryby nie grają unisono.
//  * Dopiero potem akustyka: opóźnienie, tłumienie, echa (acoustics.js).
export const MODES = [
  { id: 'shallow', until: 35, name: 'D-dur pentatonika', mood: 'płycizna — jasno', steps: [0, 2, 4, 7, 9] },
  { id: 'slope', until: 75, name: 'D-moll pentatonika', mood: 'stok — melancholijnie', steps: [0, 3, 5, 7, 10] },
  { id: 'deep', until: Infinity, name: 'D in-sen', mood: 'głębia — mrocznie', steps: [0, 1, 5, 7, 10] },
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

/** Rytm euklidesowy: k uderzeń rozłożonych możliwie równo na n krokach. */
export function euclidHit(k, n, i) {
  return ((i * k) % n) < k;
}

/** Nuta ryby: pozycja w jej warstwie wody -> stopień skali (głębiej = niżej). */
export function pitchFor(fish, species, mode, degrees = 7) {
  const [lo, hi] = species.band;
  const frac = fish.seabed > 0 ? fish.depth / fish.seabed : (lo + hi) / 2;
  const pos = Math.max(0, Math.min(1, (frac - lo) / (hi - lo)));
  const idx = Math.round((1 - pos) * (degrees - 1));
  const n = mode.steps.length;
  return species.voice.base + 12 * Math.floor(idx / n) + mode.steps[idx % n];
}
