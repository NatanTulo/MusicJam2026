// Gatunki bałtyckie: każdy ma swoją warstwę wody i swój głos.
// Warstwa (band) to ułamek słupa wody pod rybą: 0 = powierzchnia, 1 = dno,
// więc ta sama ryba nad Głębią Gdańską pływa głębiej niż nad płycizną.
//
// Głosy inspirowane prawdziwymi dźwiękami ryb, ale ustawione muzycznie:
// dorsz naprawdę "chrząka" (50–500 Hz), śledź wydaje trzaski (FRT),
// flądra jest cicha, więc dostała niski, długi dron.
export const SPECIES = [
  {
    id: 'szprot', name: 'szprot', band: [0.05, 0.28], weight: 0.25, size: 0.75,
    voice: {
      base: 74,                        // D5 — najwyżej, przy powierzchni
      partials: [1, 0.55, 0.32, 0.2, 0.12, 0.08, 0.05],
      attack: 0.004, decay: 0.28, level: 0.11,
      pulses: 3,                       // uderzeń na takt (rytm euklidesowy z 8)
    },
  },
  {
    id: 'sledz', name: 'śledź', band: [0.28, 0.58], weight: 0.3, size: 0.9,
    voice: {
      base: 62,                        // D4
      partials: [1, 0.25, 0.45, 0.12, 0.2, 0.05],
      attack: 0.012, decay: 0.55, level: 0.12,
      pulses: 2,
    },
  },
  {
    id: 'dorsz', name: 'dorsz', band: [0.6, 0.86], weight: 0.3, size: 1.3,
    voice: {
      base: 50,                        // D3 — chrząkanie
      partials: [1, 0.9, 0.55, 0.35, 0.22, 0.12],
      attack: 0.02, decay: 0.42, level: 0.16,
      pulses: 3,
    },
  },
  {
    id: 'fladra', name: 'flądra', band: [0.88, 0.97], weight: 0.15, size: 1.05,
    voice: {
      base: 38,                        // D2 — przy dnie
      partials: [1, 0.4, 0.18, 0.08],
      attack: 0.09, decay: 1.4, level: 0.2,
      pulses: 1,
    },
  },
];

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/** Stały gatunek z ID osoby (ta sama osoba = ta sama ryba = ten sam głos). */
export function speciesFor(personId) {
  let h = (personId * 2654435761) >>> 0;       // mieszanie Knutha
  const u = (h % 10000) / 10000;
  let acc = 0;
  for (const s of SPECIES) {
    acc += s.weight;
    if (u < acc) return s;
  }
  return SPECIES[SPECIES.length - 1];
}

/** Kolor jak w podglądzie kamery (people_detection/preview_window.py):
 *  ramka osoby i jej ryba mają ten sam odcień. */
export function personHue(personId) {
  return (personId * 0.381966) % 1;
}

export function hsvToRgb(h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i;
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}
