// Testy fizyki dźwięku: wartości z literatury + efekty, które mają być słyszalne.
// Uruchom: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  soundSpeed, soundSpeedAt, absorptionDbPerKm, spreadingLossDb, surfaceReflection,
  bottomReflection, knifeEdgeLossDb, propagate, coherentLevelDb, orbitalDecay, BALTIC_SUMMER,
} from '../src/sound/acoustics.js';

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

test('lustro Lloyda: płytki hydrofon słyszy rybę dużo ciszej niż głęboki (200 Hz)', () => {
  const env = { depthAt: () => 60 };
  const fish = { x: 1000, y: 0, z: 20 };
  const f = [200];
  const opts = { seaState: 0, paths: { bottom: false } };
  const shallow = coherentLevelDb(propagate(fish, { x: 0, y: 0, z: 2 }, env, f, opts), f);
  const deep = coherentLevelDb(propagate(fish, { x: 0, y: 0, z: 30 }, env, f, opts), f);
  assert.ok(deep - shallow > 15, `płytko ${shallow.toFixed(1)} dB, głęboko ${deep.toFixed(1)} dB`);
});

test('opóźnienie = droga / prędkość dźwięku (~0.69 s na 1 km)', () => {
  const env = { depthAt: () => 50 };
  const res = propagate({ x: 1000, y: 0, z: 10 }, { x: 0, y: 0, z: 10 }, env, [440]);
  const direct = res.paths.find((p) => p.kind === 'direct');
  near(direct.delay, 1000 / res.cMean, 1e-9);
  near(direct.delay, 0.69, 0.02);
  // echo od dna przychodzi później niż dźwięk bezpośredni
  assert.ok(res.paths.find((p) => p.kind === 'bottom').delay > direct.delay);
});

test('grzbiet dna między rybą a hydrofonem blokuje drogę bezpośrednią', () => {
  const ridge = { depthAt: (x) => (Math.abs(x - 1000) < 150 ? 12 : 70) };
  const flat = { depthAt: () => 70 };
  const fish = { x: 2000, y: 0, z: 50 }, hyd = { x: 0, y: 0, z: 50 };
  const f = [150, 3000];
  const blocked = propagate(fish, hyd, ridge, f).paths.find((p) => p.kind === 'direct');
  const open = propagate(fish, hyd, flat, f).paths.find((p) => p.kind === 'direct');
  assert.ok(Math.abs(blocked.gains[1]) < Math.abs(open.gains[1]) / 10, 'wysoki ton zza grzbietu');
  assert.ok(Math.abs(blocked.gains[0]) > Math.abs(blocked.gains[1]), 'niski ton przechodzi lepiej');
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
