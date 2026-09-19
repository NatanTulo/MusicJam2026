// Akustyka podwodna — czyste funkcje (bez WebAudio i DOM), testowalne w Node.
//
// Model: promienie proste + trzy drogi (bezpośrednia, odbita od powierzchni,
// odbita od dna), każda z własnym opóźnieniem i tłumieniem zależnym od
// częstotliwości. Wzory i uproszczenia opisuje docs/dzwiek.md.
//
// Układ współrzędnych: x = wschód [m], y = północ [m], z = głębokość [m] (w dół +).

export const REF_DISTANCE = 100; // [m] ryba w tej odległości gra z poziomem 0 dB

// ---------------------------------------------------------------------------
// Profil morza: temperatura i zasolenie w funkcji głębokości
// ---------------------------------------------------------------------------
/** Zatoka Gdańska latem: ciepła warstwa ~17°C nad termokliną (~20 m),
 *  zimna woda pośrednia ~5°C i haloklina ~70 m (słona woda z Morza Północnego). */
export const BALTIC_SUMMER = {
  name: 'Bałtyk (Zatoka Gdańska), lato',
  pH: 8.0,
  temperature: (z) => 5 + 12 / (1 + Math.exp((z - 22) / 4)) + 1.5 / (1 + Math.exp(-(z - 75) / 6)),
  salinity: (z) => 7.3 + 4.5 / (1 + Math.exp(-(z - 70) / 5)),
};

/** Prędkość dźwięku [m/s] — Coppens (1981). Ważna dla S = 0–45 PSU,
 *  więc (w przeciwieństwie do popularnego wzoru Mackenziego) obejmuje słonawy Bałtyk. */
export function soundSpeed(T, S, z) {
  const t = T / 10;
  const D = z / 1000;
  const c0 = 1449.05 + 45.7 * t - 5.21 * t * t + 0.23 * t * t * t
    + (1.333 - 0.126 * t + 0.009 * t * t) * (S - 35);
  return c0 + (16.23 + 0.253 * t) * D + (0.213 - 0.1 * t) * D * D
    + (0.016 + 0.0002 * (S - 35)) * (S - 35) * t * D;
}

export function soundSpeedAt(z, profile = BALTIC_SUMMER) {
  return soundSpeed(profile.temperature(z), profile.salinity(z), z);
}

/** Pochłanianie [dB/km] — Ainslie & McColm (1998): kwas borowy + MgSO4 + czysta woda.
 *  W Bałtyku (S≈7) człony solne są ~5× słabsze niż w oceanie. */
export function absorptionDbPerKm(fHz, T, S, z, pH = 8) {
  const f = fHz / 1000;
  const zk = z / 1000;
  const f1 = 0.78 * Math.sqrt(S / 35) * Math.exp(T / 26);
  const f2 = 42 * Math.exp(T / 17);
  const boric = 0.106 * (f1 * f * f) / (f1 * f1 + f * f) * Math.exp((pH - 8) / 0.56);
  const mgso4 = 0.52 * (1 + T / 43) * (S / 35) * (f2 * f * f) / (f2 * f2 + f * f) * Math.exp(-zk / 6);
  const water = 0.00049 * f * f * Math.exp(-(T / 27 + zk / 17));
  return boric + mgso4 + water;
}

// ---------------------------------------------------------------------------
// Stan morza (skala WMO/Douglasa) -> fale
// ---------------------------------------------------------------------------
export const SEA_STATES = [
  { name: 'gładkie jak lustro', hs: 0.0 },
  { name: 'zmarszczki', hs: 0.05 },
  { name: 'gładkie', hs: 0.3 },
  { name: 'lekko sfalowane', hs: 0.9 },
  { name: 'umiarkowane', hs: 1.9 },
  { name: 'wzburzone', hs: 3.2 },
  { name: 'bardzo wzburzone', hs: 5.0 },
];

export function seaStateInfo(ss) {
  const i = Math.max(0, Math.min(SEA_STATES.length - 1, Math.round(ss)));
  const { name, hs } = SEA_STATES[i];
  // Bałtyk ma krótkie fale: okres ~3 s przy ciszy do ~8 s przy sztormie.
  const period = 3 + 0.85 * i;
  const wavelength = 1.56 * period * period; // fala głębokowodna: λ = gT²/2π
  return { index: i, name, hs, sigma: hs / 4, period, wavelength };
}

/** Ile ruchu falowania dociera na głębokość h: ruch orbitalny zanika jak e^(-2πh/λ). */
export function orbitalDecay(h, ss) {
  const { wavelength } = seaStateInfo(ss);
  return Math.exp((-2 * Math.PI * Math.max(0, h)) / wavelength);
}

// ---------------------------------------------------------------------------
// Straty na drodze
// ---------------------------------------------------------------------------
/** Rozchodzenie: sferyczne (20 log r) do odległości rzędu głębokości wody,
 *  dalej cylindryczne (10 log r) — w płytkim morzu dźwięk jest "uwięziony"
 *  między powierzchnią a dnem, dlatego niesie się dalej. */
export function spreadingLossDb(r, waterDepth) {
  const rr = Math.max(r, 1);
  const rt = Math.max(waterDepth, 5);
  if (rr <= rt) return 20 * Math.log10(rr);
  return 20 * Math.log10(rt) + 10 * Math.log10(rr / rt);
}

/** Odbicie od powierzchni: -1 (odwrócenie fazy, powierzchnia "miękka"),
 *  osłabione przez szorstkość fal — współczynnik Rayleigha exp(-2(kσ sinθ)²).
 *  Wysokie częstotliwości przy wzburzonym morzu praktycznie nie wracają. */
export function surfaceReflection(fHz, grazing, sigma, c) {
  const k = (2 * Math.PI * fHz) / c;
  const g = k * sigma * Math.sin(grazing);
  return -Math.exp(-2 * g * g);
}

/** Osad z głębokości (uproszczenie dla Zatoki Gdańskiej): piasek na płyciznach,
 *  muł w Głębi Gdańskiej. 1 = piasek, 0 = muł. */
export function sandFraction(seabedDepth) {
  const t = (seabedDepth - 40) / 30;
  return 1 - Math.max(0, Math.min(1, t));
}

/** Odbicie od dna. Piasek jest "twardszy" od wody: przy płaskim kącie
 *  (poniżej kąta krytycznego ~25°) odbija prawie wszystko. Muł jest miękki
 *  i pochłania większość dźwięku. */
export function bottomReflection(grazing, seabedDepth) {
  const sand = sandFraction(seabedDepth);
  const crit = (25 * Math.PI) / 180;
  const soft = 0.5 + 0.5 * Math.tanh((crit - grazing) / 0.06); // 1 poniżej kąta krytycznego
  const rSand = 0.45 + 0.4 * soft;
  const rMud = 0.18;
  return sand * rSand + (1 - sand) * rMud;
}

/** Dyfrakcja na krawędzi (knife-edge, ITU-R P.526): strata za wzniesieniem dna.
 *  h > 0 — dno wystaje ponad linię promienia. Niskie częstotliwości
 *  "zaginają się" za przeszkodę, wysokie są ucinane — zza grzbietu słychać stłumiony dźwięk. */
export function knifeEdgeLossDb(h, d1, d2, fHz, c) {
  if (d1 <= 0 || d2 <= 0) return 0;
  const lambda = c / fHz;
  const v = h * Math.sqrt((2 * (d1 + d2)) / (lambda * d1 * d2));
  if (v <= -0.78) return 0;
  return 6.9 + 20 * Math.log10(Math.sqrt((v - 0.1) ** 2 + 1) + v - 0.1);
}

/** Najgorsze miejsce na drodze bezpośredniej: próbkuje dno wzdłuż promienia
 *  i zwraca przeszkodę o największym parametrze Fresnela (niezależnie od f). */
export function worstObstacle(src, rcv, depthAt, samples = 28) {
  const dx = rcv.x - src.x, dy = rcv.y - src.y, dz = rcv.z - src.z;
  const r = Math.hypot(dx, dy, dz);
  let best = null;
  for (let i = 1; i < samples; i++) {
    const s = i / samples;
    const zRay = src.z + dz * s;
    const seabed = depthAt(src.x + dx * s, src.y + dy * s);
    const h = zRay - seabed; // >0: dno płycej niż promień = przeszkoda
    const d1 = r * s, d2 = r * (1 - s);
    const geo = h * Math.sqrt((d1 + d2) / (d1 * d2));
    if (!best || geo > best.geo) best = { h, d1, d2, geo, s };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Pełna propagacja źródło -> hydrofon
// ---------------------------------------------------------------------------
/**
 * @param src  {x,y,z} ryba
 * @param rcv  {x,y,z} hydrofon
 * @param env  { depthAt(x,y) -> m, profile? }
 * @param freqs częstotliwości [Hz], dla których liczyć tłumienie (np. harmoniczne nuty)
 * @param opts { seaState, absorptionGain, paths:{direct,surface,bottom} }
 * @returns { rh, r, bearing, cMean, seabed, sediment, paths:[{kind, r, delay, grazing, gains[], tlDb, shadowDb, coef}] }
 *          gains[] — liniowe, ze znakiem (odbicie od powierzchni odwraca fazę), względem REF_DISTANCE.
 */
export function propagate(src, rcv, env, freqs, opts = {}) {
  const profile = env.profile || BALTIC_SUMMER;
  const seaState = opts.seaState ?? 2;
  const absGain = opts.absorptionGain ?? 1;
  const enabled = { direct: true, surface: true, bottom: true, ...(opts.paths || {}) };

  const dx = src.x - rcv.x, dy = src.y - rcv.y;
  const rh = Math.hypot(dx, dy);
  const bearing = Math.atan2(dx, dy); // 0 = północ, zgodnie z zegarem (jak kurs łódki)

  const dSrc = env.depthAt(src.x, src.y);
  const dRcv = env.depthAt(rcv.x, rcv.y);
  const dMid = env.depthAt((src.x + rcv.x) / 2, (src.y + rcv.y) / 2);
  const seabed = Math.max(1, (dSrc + dRcv + dMid) / 3);
  // dno "lustra" dla odbicia nie może być płycej niż źródło i odbiornik
  const bottomDepth = Math.max(dMid, src.z + 0.5, rcv.z + 0.5);

  // Średnie parametry wody na drodze (do opóźnień i pochłaniania).
  const zs = [src.z, (src.z + rcv.z) / 2, rcv.z];
  let cSum = 0, tSum = 0, sSum = 0;
  for (const z of zs) {
    const T = profile.temperature(z), S = profile.salinity(z);
    cSum += soundSpeed(T, S, z); tSum += T; sSum += S;
  }
  const cMean = cSum / 3, Tm = tSum / 3, Sm = sSum / 3, zm = (src.z + rcv.z) / 2;
  const alpha = freqs.map((f) => absorptionDbPerKm(f, Tm, Sm, zm, profile.pH) * absGain);

  const sigma = seaStateInfo(seaState).sigma;
  const refDb = 20 * Math.log10(REF_DISTANCE);
  const obstacle = enabled.direct ? worstObstacle(src, rcv, env.depthAt) : null;

  const geoms = [];
  if (enabled.direct) geoms.push({ kind: 'direct', dz: src.z - rcv.z });
  if (enabled.surface) geoms.push({ kind: 'surface', dz: src.z + rcv.z });
  if (enabled.bottom) geoms.push({ kind: 'bottom', dz: 2 * bottomDepth - src.z - rcv.z });

  const paths = geoms.map(({ kind, dz }) => {
    const r = Math.max(1, Math.hypot(rh, dz));
    const grazing = Math.atan2(Math.abs(dz), Math.max(rh, 0.01));
    const spreadDb = spreadingLossDb(r, seabed) - refDb;
    let coef0 = 1;
    const gains = freqs.map((f, i) => {
      let coef = 1;
      let shadow = 0;
      if (kind === 'surface') coef = surfaceReflection(f, grazing, sigma, cMean);
      else if (kind === 'bottom') coef = bottomReflection(grazing, bottomDepth);
      else if (obstacle) shadow = knifeEdgeLossDb(obstacle.h, obstacle.d1, obstacle.d2, f, cMean);
      if (i === 0) coef0 = coef;
      const lossDb = Math.max(-12, spreadDb) + (alpha[i] * r) / 1000 + shadow;
      return coef * 10 ** (-lossDb / 20);
    });
    const f0 = freqs[0];
    const shadowDb = kind === 'direct' && obstacle
      ? knifeEdgeLossDb(obstacle.h, obstacle.d1, obstacle.d2, f0, cMean) : 0;
    return {
      kind, r, grazing, gains, coef: coef0,
      delay: r / cMean,
      tlDb: spreadingLossDb(r, seabed) + (alpha[0] * r) / 1000,
      shadowDb,
    };
  });

  return {
    rh, r: Math.hypot(rh, src.z - rcv.z), bearing, cMean, seabed,
    bottomDepth, sediment: sandFraction(bottomDepth) > 0.5 ? 'piasek' : 'muł',
    blocked: !!obstacle && obstacle.h > 0,
    paths,
  };
}

/** Poziom wypadkowy wszystkich dróg dla częstotliwości freqs[idx], z fazami
 *  (interferencja). Tu widać np. efekt lustra Lloyda przy powierzchni. */
export function coherentLevelDb(result, freqs, idx = 0) {
  const f = freqs[idx];
  let re = 0, im = 0;
  for (const p of result.paths) {
    const ph = -2 * Math.PI * f * p.delay;
    re += p.gains[idx] * Math.cos(ph);
    im += p.gains[idx] * Math.sin(ph);
  }
  return 20 * Math.log10(Math.max(1e-9, Math.hypot(re, im)));
}
