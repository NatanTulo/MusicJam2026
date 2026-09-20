// Akustyka podwodna — czyste funkcje (bez WebAudio i DOM), testowalne w Node.
//
// Model kanału ryba -> hydrofon (wzory i uproszczenia: docs/dzwiek.md):
//   1. metoda źródeł pozornych w lokalnym falowodzie (powierzchnia + dno):
//      droga bezpośrednia i wszystkie odbicia do zadanego rzędu,
//   2. blokady: cień za wzniesieniem dna (dyfrakcja), ląd na drodze,
//      częstotliwość odcięcia płytkiej wody (niskie tony nie przechodzą),
//   3. echa od terenu: stoki i brzegi wokół hydrofonu odbijają dźwięk z powrotem,
//   4. pogłos słupa wody: czas wybrzmiewania z głębokości, osadu i stanu morza.
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
// 1. Kanał: metoda źródeł pozornych (image method) + blokady
// ---------------------------------------------------------------------------
/** Siatka częstotliwości, na której liczymy tłumienie każdej drogi.
 *  Silnik dopasowuje do niej filtr (poziom + dolnoprzepustowy) dla każdego echa. */
export const FREQ_GRID = [63, 125, 250, 500, 1000, 2000, 4000, 8000];

/** Częstotliwość odcięcia płytkiej wody [Hz]. Falowód o głębokości D z miękką
 *  powierzchnią i piaszczystym dnem (c_dna ≈ 1650 m/s) nie przenosi fal
 *  dłuższych niż ~4D: f_c = c / (4D·sqrt(1 − (c/c_b)²)) ≈ 2,1·c/(4D).
 *  Poniżej f_c fala zanika wykładniczo — głęboki, niski ton nie dociera przez płyciznę. */
export function waveguideCutoffHz(Dmin, c = 1450) {
  if (Dmin < 0.5) return Infinity;   // ląd na drodze
  return (2.1 * c) / (4 * Dmin);
}

/** Tłumienie fali poniżej odcięcia [dB] na odcinku płytkiej wody o długości len. */
export function evanescentLossDb(fHz, cutoffHz, len, c = 1450) {
  if (!(fHz < cutoffHz)) return 0;
  if (!Number.isFinite(cutoffHz)) return 200;
  const gamma = ((2 * Math.PI) / c) * Math.sqrt(cutoffHz * cutoffHz - fHz * fHz);
  return Math.min(200, 8.686 * gamma * Math.max(len, 0));
}

/** Głębokość wzdłuż drogi poziomej src -> rcv: średnia, minimum, długość płycizny. */
export function pathDepths(src, rcv, depthAt, n = 16) {
  const rh = Math.hypot(src.x - rcv.x, src.y - rcv.y);
  const d = [];
  for (let i = 0; i <= n; i++) {
    const s = i / n;
    d.push(depthAt(src.x + (rcv.x - src.x) * s, src.y + (rcv.y - src.y) * s));
  }
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  const min = Math.min(...d);
  const shallow = d.filter((v) => v < 1.25 * min + 0.5).length / d.length;
  return { mean, min, shallowLen: shallow * rh, rh };
}

/** Najgorsze miejsce na odcinku a -> b (bez końców — tam są punkty odbicia). */
export function segmentObstacle(a, b, depthAt, samples = 16, skip = 0.08) {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const r = Math.hypot(dx, dy, dz);
  let best = null;
  for (let i = 1; i < samples; i++) {
    const s = i / samples;
    if (s < skip || s > 1 - skip) continue;
    const zRay = a.z + dz * s;
    const h = zRay - depthAt(a.x + dx * s, a.y + dy * s); // >0: dno wystaje ponad promień
    const d1 = r * s, d2 = r * (1 - s);
    const geo = h * Math.sqrt((d1 + d2) / (d1 * d2));
    if (!best || geo > best.geo) best = { h, d1, d2, geo, s };
  }
  return best;
}

function worstOfPolyline(points, depthAt) {
  let worst = null;
  for (let i = 0; i + 1 < points.length; i++) {
    const o = segmentObstacle(points[i], points[i + 1], depthAt, 14, i === 0 && points.length === 2 ? 0.02 : 0.1);
    if (o && (!worst || o.geo > worst.geo)) worst = o;
  }
  return worst;
}

/** Rozkład obrazu z powrotem do słupa wody: głębokość promienia w punkcie "rozwiniętym". */
function foldDepth(z, D) {
  const m = ((z % (2 * D)) + 2 * D) % (2 * D);
  return m <= D ? m : 2 * D - m;
}

/** Punkty łamanej prawdziwej drogi (źródło, odbicia, hydrofon) dla obrazu zi. */
function bouncePolyline(src, rcv, zi, D, depthAt) {
  const pts = [{ x: src.x, y: src.y, z: src.z }];
  const zr = rcv.z;
  const lo = Math.min(zi, zr), hi = Math.max(zi, zr);
  const ks = [];
  for (let k = Math.ceil(lo / D - 1e-9); k * D <= hi + 1e-9; k++) {
    const zb = k * D;
    if (Math.abs(zb - zi) < 1e-9 || Math.abs(zb - zr) < 1e-9) continue;
    ks.push(k);
  }
  const at = (k) => (k * D - zi) / (zr - zi);
  ks.sort((a, b) => at(a) - at(b));
  for (const k of ks) {
    const s = at(k);
    const x = src.x + (rcv.x - src.x) * s, y = src.y + (rcv.y - src.y) * s;
    const isBottom = Math.abs(k) % 2 === 1;
    pts.push({ x, y, z: isBottom ? Math.max(0.5, depthAt(x, y)) : 0 });
  }
  pts.push({ x: rcv.x, y: rcv.y, z: rcv.z });
  return pts;
}

/** Suma obrazów w płaskim falowodzie o głębokości D (bez blokad terenu).
 *  Obraz 2nD+zs: |n| odbić od dna i |n| od powierzchni;
 *  obraz 2nD−zs: n≥1 → n od dna, n−1 od powierzchni; n≤0 → |n| od dna, |n|+1 od powierzchni. */
export function imageArrivals(rh, D, zs, zr, freqs, { cMean, alpha, sigma, maxOrder = 6, enabled = {} }) {
  const on = { direct: true, surface: true, bottom: true, multi: true, ...enabled };
  const arrivals = [];
  for (let n = -maxOrder; n <= maxOrder; n++) {
    for (const fam of ['A', 'B']) {
      const zi = fam === 'A' ? 2 * n * D + zs : 2 * n * D - zs;
      let nb, ns;
      if (fam === 'A') { nb = Math.abs(n); ns = Math.abs(n); }
      else if (n >= 1) { nb = n; ns = n - 1; }
      else { nb = -n; ns = -n + 1; }
      const order = nb + ns;
      if (order > maxOrder) continue;
      const kind = order === 0 ? 'direct' : order === 1 ? (ns ? 'surface' : 'bottom') : 'multi';
      if (!on[kind]) continue;
      const dz = zi - zr;
      const r = Math.max(1, Math.hypot(rh, dz));
      const grazing = Math.atan2(Math.abs(dz), rh);
      const rb = nb ? bottomReflection(grazing, D) : 1;
      const gains = new Float64Array(freqs.length);
      let maxAbs = 0;
      for (let i = 0; i < freqs.length; i++) {
        const rs = ns ? surfaceReflection(freqs[i], grazing, sigma, cMean) : 1;
        const amp = Math.min(4, REF_DISTANCE / r) * rs ** ns * rb ** nb * 10 ** ((-alpha[i] * r) / 20000);
        gains[i] = amp;
        maxAbs = Math.max(maxAbs, Math.abs(amp));
      }
      if (maxAbs < 1e-5) continue; // < -100 dB: pomijamy
      arrivals.push({ kind, label: order ? `p${ns}d${nb}` : 'bezp.', ns, nb, order, zi, r, delay: r / cMean, grazing, gains, shadowDb: 0 });
    }
  }
  return arrivals;
}

/**
 * Kanał ryba -> hydrofon: wszystkie drogi do rzędu maxOrder.
 *
 * W płaskim falowodzie o głębokości D (średnia na drodze) obrazy źródła leżą
 * na z = 2nD ± zs (n całkowite) — patrz imageArrivals. Każda droga: długość r = sqrt(R² + (z_obrazu − zr)²), opóźnienie r/c,
 * amplituda (REF/r) · Rs(f,θ)^ns · Rb(θ)^nb · 10^(−α(f)r/20000) · cień(f).
 * Suma dróg wysokich rzędów daje "rozmyty ogon" — w płytkiej wodzie z piaskiem
 * dźwięk się przedłuża, nad mułem szybko gaśnie.
 */
export function channel(src, rcv, env, opts = {}) {
  const freqs = opts.freqs || FREQ_GRID;
  const profile = env.profile || BALTIC_SUMMER;
  const seaState = opts.seaState ?? 2;
  const absGain = opts.absorptionGain ?? 1;
  const maxOrder = opts.maxOrder ?? 6;
  const enabled = { direct: true, surface: true, bottom: true, multi: true, ...(opts.paths || {}) };
  const depthAt = env.depthAt;

  const pd = pathDepths(src, rcv, depthAt);
  const rh = Math.max(0.5, pd.rh);
  const bearing = Math.atan2(src.x - rcv.x, src.y - rcv.y); // 0 = N, zgodnie z zegarem
  const D = Math.max(pd.mean, src.z + 0.5, rcv.z + 0.5, 1);

  let cSum = 0, tSum = 0, sSum = 0;
  const zs3 = [src.z, (src.z + rcv.z) / 2, rcv.z];
  for (const z of zs3) {
    const T = profile.temperature(z), S = profile.salinity(z);
    cSum += soundSpeed(T, S, z); tSum += T; sSum += S;
  }
  const cMean = cSum / 3;
  const alpha = freqs.map((f) => absorptionDbPerKm(f, tSum / 3, sSum / 3, (src.z + rcv.z) / 2, profile.pH) * absGain);
  const sigma = seaStateInfo(seaState).sigma;
  const cutoffHz = waveguideCutoffHz(pd.min, cMean);
  const landBlocked = pd.min < 0.5;

  const arrivals = imageArrivals(rh, D, src.z, rcv.z, freqs, { cMean, alpha, sigma, maxOrder, enabled });
  arrivals.sort((a, b) => a.delay - b.delay);

  // Blokady: cień liczymy na prawdziwej łamanej (z realnym dnem w punktach odbicia)
  // dla dróg rzędu 0–1; wyższe rzędy dostają mniejszy z cieni bezpośredniej i od powierzchni
  // (promienie wielokrotnie odbite i tak przechodzą przez ten sam przekrój wody).
  const shadowFor = (a) => {
    const poly = bouncePolyline(src, rcv, a.zi, D, depthAt);
    const o = worstOfPolyline(poly, depthAt);
    return freqs.map((f) => (o ? knifeEdgeLossDb(o.h, o.d1, o.d2, f, cMean) : 0));
  };
  const low = {};
  for (const a of arrivals) {
    if (a.order <= 1) { a._shadow = shadowFor(a); low[a.kind] = a._shadow; }
  }
  const tailShadow = freqs.map((_, i) => Math.min(low.direct?.[i] ?? 0, low.surface?.[i] ?? low.direct?.[i] ?? 0));
  for (const a of arrivals) {
    const sh = a._shadow || tailShadow;
    for (let i = 0; i < freqs.length; i++) a.gains[i] *= landBlocked ? 0 : 10 ** (-sh[i] / 20);
    const i1k = freqs.indexOf(1000);
    a.shadowDb = landBlocked ? Infinity : sh[i1k >= 0 ? i1k : 0];
    a.blocked = landBlocked || a.shadowDb > 30;
    delete a._shadow;
  }

  return {
    freqs, rh, r: Math.hypot(rh, src.z - rcv.z), bearing, cMean, D, Dmin: pd.min,
    cutoffHz, shallowLen: pd.shallowLen, landBlocked,
    sediment: sandFraction(D) > 0.5 ? 'piasek' : 'muł',
    arrivals,
  };
}

/** Wartość z siatki częstotliwości w punkcie f (interpolacja w skali log). */
export function gainAt(freqs, gains, f) {
  if (f <= freqs[0]) return gains[0];
  for (let i = 1; i < freqs.length; i++) {
    if (f <= freqs[i]) {
      const t = Math.log(f / freqs[i - 1]) / Math.log(freqs[i] / freqs[i - 1]);
      return gains[i - 1] + (gains[i] - gains[i - 1]) * t;
    }
  }
  return gains[gains.length - 1];
}

/** Filtr dla jednej drogi: poziom przy f0 + częstotliwość, gdzie widmo spada o 3 dB. */
export function fitTap(freqs, gains, f0) {
  const g0 = gainAt(freqs, gains, f0);
  const ref = 20 * Math.log10(Math.abs(g0) + 1e-12);
  let cutoff = 16000;
  let prevF = f0, prevDb = ref;
  for (let i = 0; i < freqs.length; i++) {
    if (freqs[i] <= f0) continue;
    const db = 20 * Math.log10(Math.abs(gains[i]) + 1e-12);
    if (ref - db >= 3) {
      const t = (ref - 3 - prevDb) / (db - prevDb || -1e-9);
      cutoff = Math.exp(Math.log(prevF) + t * (Math.log(freqs[i]) - Math.log(prevF)));
      break;
    }
    prevF = freqs[i]; prevDb = db;
  }
  return { gain: g0, cutoff: Math.max(80, cutoff) };
}

/** Poziom wypadkowy wszystkich dróg przy częstotliwości f, z fazami (interferencja). */
export function coherentLevelDb(arrivals, freqs, f) {
  let re = 0, im = 0;
  for (const a of arrivals) {
    const g = gainAt(freqs, a.gains, f);
    const ph = -2 * Math.PI * f * a.delay;
    re += g * Math.cos(ph);
    im += g * Math.sin(ph);
  }
  return 20 * Math.log10(Math.max(1e-9, Math.hypot(re, im)));
}

// ---------------------------------------------------------------------------
// 2. Echa od terenu: stoki i brzegi wokół hydrofonu
// ---------------------------------------------------------------------------
/**
 * Promienie poziome z hydrofonu w `rays` kierunkach: pierwszy punkt, gdzie woda
 * robi się płytsza niż 55 % głębokości pod łódką, to "ściana" (stok, mielizna, brzeg).
 * Normalna ściany = gradient głębokości (w stronę głębszej wody).
 * Siła odbicia rośnie z nachyleniem: łagodny stok rozprasza, stromy stok i brzeg odbijają.
 */
export function scanReflectors(rcv, env, opts = {}) {
  const rays = opts.rays ?? 36, maxRange = opts.maxRange ?? 4500, step = opts.step ?? 90;
  const depthAt = env.depthAt;
  const D0 = depthAt(rcv.x, rcv.y);
  const wallDepth = Math.max(3, 0.55 * D0);
  const reflectors = [];
  for (let k = 0; k < rays; k++) {
    const az = (2 * Math.PI * k) / rays;
    const ux = Math.sin(az), uy = Math.cos(az);
    for (let r = step; r <= maxRange; r += step) {
      const px = rcv.x + ux * r, py = rcv.y + uy * r;
      const d = depthAt(px, py);
      if (d >= wallDepth) continue;
      const e = 60;
      const gx = (depthAt(px + e, py) - depthAt(px - e, py)) / (2 * e);
      const gy = (depthAt(px, py + e) - depthAt(px, py - e)) / (2 * e);
      const g = Math.hypot(gx, gy);
      const land = d < 0.5;
      const nx = g > 1e-4 ? gx / g : -ux, ny = g > 1e-4 ? gy / g : -uy;
      const strength = land ? 0.85 : 0.15 + 0.7 * Math.min(1, g / 0.05);
      reflectors.push({ x: px, y: py, depth: d, nx, ny, slope: g, strength, range: r, azimuth: az, land });
      break;
    }
  }
  return { reflectors, wallDepth, D0 };
}

/**
 * Echa ryby od ścian: ryba -> ściana -> hydrofon (ściana = lustro: obraz ryby za ścianą).
 * Kierunkowość: odbicie lustrzane (kąt padania = kąt odbicia, waga cos⁸ odchyłki)
 * + 15 % rozpraszania Lamberta. Energia echa = energia całego falowodu na rozwiniętej
 * drodze (wszystkie odbicia dno–powierzchnia po drodze) × siła ściany × kierunkowość.
 * Każde ramię drogi sprawdzane pod kątem cienia. Zwraca `count` najsilniejszych ech.
 */
export function terrainEchoes(src, rcv, scan, env, opts = {}) {
  const freqs = opts.freqs || FREQ_GRID;
  const count = opts.count ?? 2;
  const profile = env.profile || BALTIC_SUMMER;
  const absGain = opts.absorptionGain ?? 1;
  const zMid = (src.z + rcv.z) / 2;
  const c = soundSpeedAt(zMid, profile);
  const T = profile.temperature(zMid), S = profile.salinity(zMid);
  const alpha = freqs.map((f) => absorptionDbPerKm(f, T, S, zMid, profile.pH) * absGain);
  const rDirect = Math.hypot(src.x - rcv.x, src.y - rcv.y, src.z - rcv.z);
  const cands = [];
  for (const w of scan.reflectors) {
    const P = { x: w.x, y: w.y, z: Math.max(0.5, Math.min(zMid, scan.wallDepth - 0.5)) };
    let u1x = P.x - src.x, u1y = P.y - src.y;
    const l1h = Math.hypot(u1x, u1y) || 1; u1x /= l1h; u1y /= l1h;
    let u2x = rcv.x - P.x, u2y = rcv.y - P.y;
    const l2h = Math.hypot(u2x, u2y) || 1; u2x /= l2h; u2y /= l2h;
    const inc = u1x * w.nx + u1y * w.ny;
    if (inc > -0.05) continue;                    // dźwięk musi lecieć w stronę ściany
    const rx = u1x - 2 * inc * w.nx, ry = u1y - 2 * inc * w.ny;
    const spec = Math.max(0, rx * u2x + ry * u2y);
    const lam = Math.max(0, -inc) * Math.max(0, u2x * w.nx + u2y * w.ny);
    const weight = 0.85 * spec ** 8 + 0.15 * lam;
    if (weight < 0.01) continue;
    const L1 = Math.hypot(P.x - src.x, P.y - src.y, P.z - src.z);
    const L2 = Math.hypot(rcv.x - P.x, rcv.y - P.y, rcv.z - P.z);
    const L = L1 + L2;
    if (L - rDirect < 30) continue;              // zlewa się z dźwiękiem bezpośrednim
    const base = Math.min(4, REF_DISTANCE / L) * w.strength * weight;
    if (base < 2e-4) continue;
    cands.push({ w, P, L, base, weight });
  }
  cands.sort((a, b) => b.base - a.base);
  const sigma = seaStateInfo(opts.seaState ?? 2).sigma;
  const out = [];
  for (const cnd of cands.slice(0, count * 3)) {
    // Echo też płynie korytarzem między dnem a powierzchnią: zamiast jednego promienia
    // liczymy cały falowód na rozwiniętej drodze długości L (lustro w ścianie) i bierzemy
    // jego energię. Bez tego echo byłoby ~9 dB za słabe względem dźwięku bezpośredniego.
    const d1 = pathDepths(src, cnd.P, env.depthAt, 8), d2 = pathDepths(cnd.P, rcv, env.depthAt, 8);
    const Deff = Math.max(src.z + 0.5, rcv.z + 0.5, (d1.mean * d1.rh + d2.mean * d2.rh) / Math.max(1, d1.rh + d2.rh));
    const Lh = d1.rh + d2.rh;
    const imgs = imageArrivals(Lh, Deff, src.z, rcv.z, freqs, { cMean: c, alpha, sigma, maxOrder: opts.maxOrder ?? 6 });
    const o1 = segmentObstacle(src, cnd.P, env.depthAt, 14, 0.04);
    const o2 = segmentObstacle(cnd.P, rcv, env.depthAt, 14, 0.04);
    const gains = new Float64Array(freqs.length);
    for (let i = 0; i < freqs.length; i++) {
      let e = 0;
      for (const a of imgs) e += a.gains[i] * a.gains[i];
      const sh = (o1 ? knifeEdgeLossDb(o1.h, o1.d1, o1.d2, freqs[i], c) : 0)
        + (o2 ? knifeEdgeLossDb(o2.h, o2.d1, o2.d2, freqs[i], c) : 0);
      gains[i] = Math.sqrt(e) * cnd.w.strength * cnd.weight * 10 ** (-sh / 20);
    }
    out.push({
      kind: 'teren', label: cnd.w.land ? 'brzeg' : 'stok', r: cnd.L, delay: cnd.L / c, gains,
      bearing: Math.atan2(cnd.P.x - rcv.x, cnd.P.y - rcv.y),
      reflector: cnd.w, point: cnd.P, strength: Math.max(...gains.map(Math.abs)),
    });
  }
  out.sort((a, b) => b.strength - a.strength);
  return out.slice(0, count);
}

// ---------------------------------------------------------------------------
// 3. Pogłos słupa wody
// ---------------------------------------------------------------------------
/**
 * Czas wybrzmiewania T60 wokół hydrofonu. Promień pod kątem θ odbija się od pary
 * dno+powierzchnia co Δt = 2D/(c·sinθ) i traci przy tym L = −20·log|Rs·Rb| dB,
 * więc zanika z szybkością L/Δt [dB/s] i T60 = 60·Δt/L. Dla θ ≈ 12° (późną energię
 * niosą promienie płaskie). Piasek (mocne odbicie) → długi pogłos; muł → krótki.
 * Szorstka powierzchnia skraca pogłos wysokich tonów. Do tego "trzepotanie":
 * odbicia pionowe dno–powierzchnia co 2D/c (w płytkiej wodzie wyraźne powtórzenia).
 */
export function waterColumnReverb(D, seaState = 2, profile = BALTIC_SUMMER) {
  const d = Math.max(3, D);
  const c = soundSpeedAt(d / 2, profile);
  const theta = (12 * Math.PI) / 180;
  const sigma = seaStateInfo(seaState).sigma;
  const rb = bottomReflection(theta, d);
  const rsLow = Math.abs(surfaceReflection(500, theta, sigma, c));
  const rsHigh = Math.abs(surfaceReflection(4000, theta, sigma, c));
  const dtPair = (2 * d) / (c * Math.sin(theta));
  const lossLow = -20 * Math.log10(Math.max(1e-6, rb * rsLow));
  const lossHigh = -20 * Math.log10(Math.max(1e-6, rb * rsHigh));
  const t60 = Math.min(5, Math.max(0.6, (60 * dtPair) / lossLow));
  const t60High = Math.min(t60, Math.max(0.25, (60 * dtPair) / lossHigh));
  const flutterPeriod = (2 * d) / c;
  const flutterGain = bottomReflection(Math.PI / 2, d) * Math.abs(surfaceReflection(500, Math.PI / 2, sigma, c));
  return { t60, t60High, flutterPeriod, flutterGain, dtPair, rb, lossLow, depth: d };
}
