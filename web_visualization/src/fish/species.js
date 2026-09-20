// Gatunki bałtyckie: każdy ma swoją warstwę wody i swój głos.
// Warstwa (band) to ułamek słupa wody pod rybą: 0 = powierzchnia, 1 = dno,
// więc ta sama ryba nad Głębią Gdańską pływa głębiej niż nad płycizną.
//
// Głos ryby brzmi ciągle. Wysokość NIE zależy od gatunku, tylko od głębokości
// (sound/music.js) — gatunek daje barwę (harmoniczne), puls (trem) i powolny
// "oddech" (breath). Inspiracje: dorsz naprawdę "chrząka" (50–500 Hz),
// flądra jest cicha, więc dostała miękki dron.
export const SPECIES = [
  {
    id: 'szprot', name: 'szprot', band: [0.05, 0.28], weight: 0.25, size: 0.75,
    voice: {
      // jasny, migoczący — szybkie drżenie jak ławica przy powierzchni
      partials: [1, 0.5, 0.33, 0.2, 0.12, 0.07],
      level: 0.07, trem: { rate: 7.5, depth: 0.25 }, breath: { rate: 0.13, depth: 0.35 }, bright: 6,
    },
    // smukła torpeda: wąskie ciało, duży widelec ogona, mała płetwa grzbietowa
    model: { body: [0.22, 0.24, 1.0], tail: 'fork-big', dorsal: 'small', tailAmp: 0.5 },
  },
  {
    id: 'sledz', name: 'śledź', band: [0.28, 0.58], weight: 0.3, size: 0.9,
    voice: {
      // miękki, fletowy
      partials: [1, 0.35, 0.18, 0.08],
      level: 0.08, trem: { rate: 4.2, depth: 0.12 }, breath: { rate: 0.09, depth: 0.4 }, bright: 4,
    },
    // klasyczna ryba: średnie ciało, widelec ogona, jedna płetwa grzbietowa
    model: { body: [0.3, 0.3, 1.0], tail: 'fork', dorsal: 'mid', tailAmp: 0.4 },
  },
  {
    id: 'dorsz', name: 'dorsz', band: [0.6, 0.86], weight: 0.3, size: 1.3,
    voice: {
      // "chrząkanie": bogate harmoniczne i głęboki puls (prawdziwe dorsze tak robią)
      partials: [1, 0.8, 0.55, 0.35, 0.22, 0.12],
      level: 0.1, trem: { rate: 3.2, depth: 0.6 }, breath: { rate: 0.07, depth: 0.3 }, bright: 7,
    },
    // byczek z wąsem: masywne ciało + łeb, wachlarz zamiast widelca,
    // podwójna płetwa grzbietowa i wąsik (barbel) pod pyskiem
    model: { body: [0.46, 0.42, 1.0], tail: 'fan', dorsal: 'double', barbel: true, head: true, tailAmp: 0.3 },
  },
  {
    id: 'fladra', name: 'flądra', band: [0.88, 0.97], weight: 0.15, size: 1.05,
    voice: {
      // cichy, niski dron przy dnie
      partials: [1, 0.3, 0.1],
      level: 0.11, trem: { rate: 0.8, depth: 0.2 }, breath: { rate: 0.05, depth: 0.45 }, bright: 3,
    },
    // placek denny: płaski owal, oczy z góry po jednej stronie,
    // mały wachlarz ogona i kryza (falbanka) wokół całego obrysu zamiast płetwy
    model: { body: [0.6, 0.18, 1.35], tail: 'fan-small', dorsal: 'rim', flat: true, eyesTop: true, tailAmp: 0.22 },
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
