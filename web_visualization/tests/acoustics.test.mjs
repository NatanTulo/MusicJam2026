// Testy fizyki dźwięku: wartości z literatury + efekty, które mają być słyszalne.
// Uruchom: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soundSpeed, soundSpeedAt, absorptionDbPerKm, spreadingLossDb, surfaceReflection,
  bottomReflection, knifeEdgeLossDb, orbitalDecay, BALTIC_SUMMER,
  channel, coherentLevelDb, gainAt, fitTap, waveguideCutoffHz, evanescentLossDb,
  scanReflectors, terrainEchoes, waterColumnReverb,
  folkToSand, sedimentSand, sedimentName, sandFraction,
  stereoCues, planeWaveITD,
} from '../src/sound/acoustics.js';
import { depthMidi, fishMidi, MODES } from '../src/sound/music.js';

const near = (a, b, tol) => assert.ok(Math.abs(a - b) <= tol, `${a} != ${b} ±${tol}`);

test('prędkość dźwięku: wartość tablicowa oceanu (10°C, 35 PSU, 0 m) = 1489.8 m/s', () => {
  near(soundSpeed(10, 35, 0), 1489.8, 0.3);
});

test('Bałtyk latem: ~1480 m/s przy powierzchni, ~1437 m/s pod termokliną', () => {
  near(soundSpeedAt(0), 1480, 3);
  near(soundSpeedAt(40), 1437, 3);
});

test('pochłanianie w oceanie: ~0.06 dB/km przy 1 kHz, ~1 dB/km przy 10 kHz', () => {
  near(absorptionDbPerKm(1000, 10, 35, 0), 0.061, 0.005);
  near(absorptionDbPerKm(10000, 10, 35, 0), 0.99, 0.05);
});

test('słonawy Bałtyk pochłania wysokie tony kilka razy słabiej niż ocean', () => {
  const ocean = absorptionDbPerKm(10000, 10, 35, 0);
  const baltic = absorptionDbPerKm(10000, 10, 7, 0);
  assert.ok(baltic < ocean / 3, `${baltic} vs ${ocean}`);
});

test('rozchodzenie: sferyczne blisko, cylindryczne dalej niż głębokość wody', () => {
  near(spreadingLossDb(50, 60), 20 * Math.log10(50), 1e-9);
  // 10 km w 50 m wody: 20log(50) + 10log(200) = 34 + 23 = 57 dB zamiast 80 dB sferycznie
  near(spreadingLossDb(10000, 50), 57, 0.1);
});

test('powierzchnia odwraca fazę; szorstka fala zjada wysokie tony', () => {
  near(surfaceReflection(200, 0.3, 0, 1480), -1, 1e-9);
  const low = Math.abs(surfaceReflection(200, 0.3, 0.5, 1480));
  const high = Math.abs(surfaceReflection(4000, 0.3, 0.5, 1480));
  assert.ok(low > 0.95 && high < 0.2, `low ${low}, high ${high}`);
});

test('dno: piasek przy płaskim kącie odbija mocno, muł słabo', () => {
  assert.ok(bottomReflection(0.1, 20) > 0.8);
  assert.ok(bottomReflection(0.1, 100) < 0.25);
});

test('cień za grzbietem: strata rośnie z częstotliwością (~3 dB/oktawę, bo v ~ sqrt(f))', () => {
  const loss = [100, 400, 1600, 6400].map((f) => knifeEdgeLossDb(15, 1000, 1000, f, 1480));
  for (let i = 1; i < loss.length; i++) assert.ok(loss[i] > loss[i - 1], loss.join(' < '));
  // dwie oktawy wyżej w reżimie głębokiego cienia: ~ +6 dB
  near(loss[3] - loss[2], 6, 1);
});

const direct = (ch) => ch.arrivals.find((a) => a.kind === 'direct');
const db = (x) => 20 * Math.log10(Math.abs(x) + 1e-12);

test('lustro Lloyda: płytki hydrofon słyszy rybę dużo ciszej niż głęboki (200 Hz)', () => {
  const env = { depthAt: () => 60 };
  const fish = { x: 1000, y: 0, z: 20 };
  const opts = { seaState: 0, paths: { bottom: false, multi: false } };
  const lvl = (z) => {
    const ch = channel(fish, { x: 0, y: 0, z }, env, opts);
    return coherentLevelDb(ch.arrivals, ch.freqs, 200);
  };
  assert.ok(lvl(30) - lvl(2) > 15, `płytko ${lvl(2).toFixed(1)} dB, głęboko ${lvl(30).toFixed(1)} dB`);
});

test('opóźnienie = droga / prędkość dźwięku (~0.69 s na 1 km)', () => {
  const ch = channel({ x: 1000, y: 0, z: 10 }, { x: 0, y: 0, z: 10 }, { depthAt: () => 50 });
  near(direct(ch).delay, 1000 / ch.cMean, 1e-9);
  near(direct(ch).delay, 0.69, 0.02);
});

test('metoda źródeł pozornych: kolejne odbicia przychodzą później, droga bezpośrednia pierwsza', () => {
  const ch = channel({ x: 300, y: 0, z: 25 }, { x: 0, y: 0, z: 10 }, { depthAt: () => 40 }, { maxOrder: 4 });
  assert.equal(ch.arrivals[0].kind, 'direct');
  for (let i = 1; i < ch.arrivals.length; i++) assert.ok(ch.arrivals[i].delay >= ch.arrivals[i - 1].delay);
  // geometria rzędu 1: od powierzchni = obraz na -zs, od dna = obraz na 2D - zs
  const s1 = ch.arrivals.find((a) => a.kind === 'surface');
  const b1 = ch.arrivals.find((a) => a.kind === 'bottom');
  near(s1.r, Math.hypot(300, 25 + 10), 1e-9);
  near(b1.r, Math.hypot(300, 2 * 40 - 25 - 10), 1e-9);
  // nieparzysta liczba odbić od powierzchni = odwrócona faza
  for (const a of ch.arrivals) assert.equal(Math.sign(a.gains[3]), a.ns % 2 ? -1 : 1, a.label);
});

test('płytka woda z piaskiem przedłuża dźwięk (więcej energii w odbiciach) niż głęboki muł', () => {
  const tail = (D) => {
    const ch = channel({ x: 1500, y: 0, z: D * 0.5 }, { x: 0, y: 0, z: D * 0.4 }, { depthAt: () => D }, { maxOrder: 6 });
    const dir = gainAt(ch.freqs, direct(ch).gains, 250) ** 2;
    const rest = ch.arrivals.filter((a) => a.kind !== 'direct').reduce((s, a) => s + gainAt(ch.freqs, a.gains, 250) ** 2, 0);
    return 10 * Math.log10(rest / dir);
  };
  assert.ok(tail(20) > tail(100) + 6, `piasek 20 m: ${tail(20).toFixed(1)} dB, muł 100 m: ${tail(100).toFixed(1)} dB`);
});

test('grzbiet dna między rybą a hydrofonem blokuje drogę bezpośrednią (wysokie tony bardziej)', () => {
  const ridge = { depthAt: (x) => (Math.abs(x - 1000) < 150 ? 12 : 70) };
  const flat = { depthAt: () => 70 };
  const fish = { x: 2000, y: 0, z: 50 }, hyd = { x: 0, y: 0, z: 50 };
  const b = direct(channel(fish, hyd, ridge)), o = direct(channel(fish, hyd, flat));
  const loss = (f) => db(gainAt(FG, o.gains, f)) - db(gainAt(FG, b.gains, f));
  const FG = channel(fish, hyd, flat).freqs;
  assert.ok(loss(4000) > 20, `strata 4 kHz: ${loss(4000).toFixed(1)} dB`);
  assert.ok(loss(4000) > loss(125) + 5, 'niski ton przechodzi lepiej');
});

test('ląd na drodze: dźwięk nie dociera wcale', () => {
  const env = { depthAt: (x) => (x > 400 && x < 600 ? 0 : 40) };
  const ch = channel({ x: 1000, y: 0, z: 20 }, { x: 0, y: 0, z: 20 }, env);
  assert.ok(ch.landBlocked);
  assert.ok(ch.arrivals.every((a) => a.gains.every((g) => g === 0)));
});

test('odcięcie płytkiej wody: niskie tony nie przechodzą przez płyciznę', () => {
  near(waveguideCutoffHz(25, 1450), 30.4, 0.5);     // 25 m: poniżej ~30 Hz nic
  near(waveguideCutoffHz(5, 1450), 152, 1);         // 5 m: poniżej ~150 Hz nic
  assert.ok(evanescentLossDb(40, waveguideCutoffHz(5), 500) > 60, 'D1 przez 500 m płycizny 5 m');
  assert.equal(evanescentLossDb(300, waveguideCutoffHz(5), 500), 0);
});

test('filtr drogi: poziom przy f0 i częstotliwość -3 dB', () => {
  const freqs = [63, 125, 250, 500, 1000, 2000, 4000, 8000];
  const gains = freqs.map((f) => 0.5 / Math.sqrt(1 + (f / 1000) ** 4));   // "prawdziwy" dolnoprzepust 1 kHz
  const fit = fitTap(freqs, gains, 125);
  near(fit.gain, 0.5, 0.01);
  near(fit.cutoff, 1000, 150);
});

test('echo od brzegu: znalezione we właściwej odległości, opóźnienie z geometrii', () => {
  // brzeg na wschód od hydrofonu, 2 km
  const env = { depthAt: (x) => (x > 2000 ? 0 : x > 1700 ? 40 * (2000 - x) / 300 : 40) };
  const hyd = { x: 0, y: 0, z: 15 };
  const scan = scanReflectors(hyd, env, { rays: 36 });
  const east = scan.reflectors.find((r) => Math.abs(r.azimuth - Math.PI / 2) < 0.01);
  assert.ok(east && Math.abs(east.range - 1860) < 150, `ściana na ${east?.range} m`);
  // ryba na zachód: dźwięk mija łódkę, odbija się od brzegu i wraca
  const fish = { x: -500, y: 0, z: 15 };
  const echoes = terrainEchoes(fish, hyd, scan, env, { count: 2 });
  assert.ok(echoes.length >= 1, 'jest echo');
  const e = echoes[0];
  const expected = (Math.hypot(e.point.x - fish.x, e.point.z - fish.z) + Math.hypot(e.point.x, e.point.z - hyd.z)) / soundSpeedAt(15);
  near(e.delay, expected, 0.01);
  assert.ok(e.delay - 500 / 1480 > 2, `echo ${(e.delay).toFixed(2)} s po ~2,5 s drogi tam i z powrotem`);
});

test('pogłos: płycizna z piaskiem wybrzmiewa dłużej niż woda nad mułem przy tej samej głębokości rzędu', () => {
  const sand = waterColumnReverb(25, 2), mud = waterColumnReverb(80, 2);
  assert.ok(sand.t60 > mud.t60, `piasek ${sand.t60.toFixed(2)} s, muł ${mud.t60.toFixed(2)} s`);
  near(sand.flutterPeriod, 50 / soundSpeedAt(12.5), 1e-6);   // trzepotanie co 2D/c
  const calm = waterColumnReverb(40, 0), rough = waterColumnReverb(40, 6);
  assert.ok(rough.t60High < calm.t60High, 'szorstka fala skraca pogłos wysokich tonów');
});

test('wysokość z głębokości: im głębiej, tym niżej (oktawa na 30 m)', () => {
  near(depthMidi(0) - depthMidi(30), 12, 1e-9);
  let prev = Infinity;
  for (let d = 0; d <= 100; d += 5) {
    const m = fishMidi(d, MODES[1]);
    assert.ok(m <= prev, `${d} m`);
    prev = m;
  }
  assert.ok(fishMidi(100, MODES[1]) <= 38 + 1e-9);
});

test('falowanie zanika z głębokością (ruch orbitalny)', () => {
  assert.ok(orbitalDecay(0, 3) === 1);
  assert.ok(orbitalDecay(10, 3) < 0.4);
  assert.ok(orbitalDecay(40, 3) < 0.02);
});

test('profil Bałtyku: termoklina i haloklina we właściwych miejscach', () => {
  near(BALTIC_SUMMER.temperature(0), 17, 0.2);
  near(BALTIC_SUMMER.temperature(40), 5.1, 0.3);
  assert.ok(BALTIC_SUMMER.salinity(90) > 11);
});

test('osad: Folk z EMODnet mapuje się na piasek, brak danych wraca do modelu', () => {
  assert.equal(folkToSand(13, 1), 0.5);      // muddy Sand (7cl wygrywa z 5cl)
  assert.equal(folkToSand(11, 2), 0.0);      // muł
  assert.equal(folkToSand(2, null), 1.0);    // piasek
  assert.equal(folkToSand(6, 1), 0.15);      // "no data" na 7cl -> fallback do 5cl
  assert.equal(folkToSand(6, null), null);   // brak danych -> model z głębokości
  assert.equal(folkToSand(null, null), null);
  assert.equal(sedimentName(0.9), 'piasek');
  assert.equal(sedimentName(0.5), 'mieszany');
  assert.equal(sedimentName(0.1), 'muł');
  const map = sedimentSand({ sedimentAt: () => 0.8 }, 0, 0);
  assert.equal(map.source, 'mapa');
  near(map.sand, 0.8, 1e-9);
  const model = sedimentSand({ depthAt: () => 60 }, 0, 0);
  assert.equal(model.source, 'model');
  assert.equal(model.sand, null);
});

test('osad z mapy przebija zgadywanie: to samo D, inne dno', () => {
  // głęboka woda (model mówi muł), ale mapa mówi piasek — odbicie jak na płyciznie
  assert.ok(bottomReflection(0.1, 100, 1.0) > 0.8);
  assert.ok(bottomReflection(0.1, 20, 0.0) < 0.25);
  const env = (sand) => ({ depthAt: () => 60, sedimentAt: () => sand });
  const fish = { x: 1500, y: 0, z: 30 }, hyd = { x: 0, y: 0, z: 25 };
  const chSand = channel(fish, hyd, env(1.0));
  const chMud = channel(fish, hyd, env(0.0));
  assert.equal(chSand.sandSource, 'mapa');
  assert.equal(chSand.sediment, 'piasek');
  assert.equal(chMud.sediment, 'muł');
  const g = (ch) => gainAt(ch.freqs, ch.arrivals.find((a) => a.kind === 'bottom').gains, 2000);
  assert.ok(g(chSand) > g(chMud) * 1.5, 'piasek niesie górę lepiej niż muł');
  const chModel = channel(fish, hyd, { depthAt: () => 60 });
  assert.equal(chModel.sandSource, 'model');   // stara ścieżka działa bez mapy
  near(chModel.sand, sandFraction(60), 1e-9);
  assert.ok(waterColumnReverb(60, 2, BALTIC_SUMMER, 1.0).t60
    > waterColumnReverb(60, 2, BALTIC_SUMMER, 0.0).t60 + 0.5, 'pogłos zależy od osadu, nie tylko D');
});

test('stereo: z przodu ITD=0, z boku ±baseline/c, znak poprawny', () => {
  const L = { x: 0, y: 0, depth: 10, heading: 0 };
  const front = stereoCues({ x: 0, y: 1000, z: 10 }, L, 3, 1450);
  near(front.itd, 0, 1e-9);
  near(front.ildDb, 0, 1e-9);
  const right = stereoCues({ x: 1000, y: 0, z: 10 }, L, 3, 1450);
  near(right.itd, -3 / 1450, 1e-6);   // prawa burta: prawe ucho wcześniej
  assert.ok(right.ildDb < 0, 'prawe głośniej');
  const left = stereoCues({ x: -1000, y: 0, z: 10 }, L, 3, 1450);
  near(left.itd, 3 / 1450, 1e-6);
  assert.ok(left.ildDb > 0, 'lewe głośniej');
  const mono = stereoCues({ x: 1000, y: 0, z: 10 }, L, 0, 1450);
  near(mono.itd, 0, 1e-12);           // baseline 0 = mono
});

test('stereo: fala płaska zgadza się ze sferyczną dla dalekich źródeł', () => {
  near(planeWaveITD(Math.PI / 2, 0, 3, 1450), -3 / 1450, 1e-12);
  near(planeWaveITD(0, 0, 3, 1450), 0, 1e-12);
  const L = { x: 0, y: 0, depth: 10, heading: 0.7 };
  const far = stereoCues({ x: 3000, y: 1000, z: 10 }, L, 3, 1450);
  const bearing = Math.atan2(3000 - 0, 1000 - 0);
  const pw = planeWaveITD(bearing, 0.7, 3, 1450);
  assert.ok(Math.abs(far.itd - pw) / Math.max(1e-9, Math.abs(pw)) < 0.05, `${far.itd} vs ${pw}`);
});
