// Pobiera osad dna (EMODnet Geology, Seabed Substrate 1:250k, WFS) i rasteryzuje
// go do siatki zgodnej z batymetrią danego regionu (public/data/<id>.json).
// Wynik: public/data/<id>.sediment.json — udział piasku 0..1 (null = brak danych
// w EMODnet, wtedy akustyka używa starego zgadywania z głębokości).
//
// Klasyfikacja Folk (Long 2006, wariant EMODnet):
//   folk_7cl: 11 Mud, 12 sandy Mud, 13 muddy Sand, 2 Sand, 3 Coarse, 4 Mixed,
//             5 Rock & boulders, 6 No data -> fallback do folk_5cl.
//   folk_5cl: 1 Mud to muddy Sand, 2 Sand, 3 Coarse, 4 Mixed, 5 Rock & boulders.
//
// Użycie: node scripts/fetch-sediment.mjs [region...]
//   bez argumentów: baltic-south + baltic-polish-coast (detal; pełny Bałtyk
//   zostaje na zgadywaniu z głębokości — za dużo poligonów na raster w locie).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { folkToSand } from '../src/sound/acoustics.js';

const WFS = 'https://drive.emodnet-geology.eu/geoserver/ows';
const LAYER = 'gtk:seabed_substrate_250k';

async function fetchBbox(lonMin, latMin, lonMax, latMax) {
  const params = new URLSearchParams({
    service: 'WFS', version: '1.0.0', request: 'GetFeature',
    typeName: LAYER, outputFormat: 'application/json',
    bbox: `${lonMin},${latMin},${lonMax},${latMax},EPSG:4326`,
  });
  const url = `${WFS}?${params}`;
  console.log(`  WFS: ${url.slice(0, 160)}…`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`WFS HTTP ${res.status} ${res.statusText}`);
  const fc = await res.json();
  // GeoServer może ucinać do maxFeatures — sprawdzamy numberMatched.
  if (fc.numberMatched > fc.features.length) {
    throw new Error(`za dużo poligonów (${fc.numberMatched}) — zawęź bbox albo dopisz stronicowanie`);
  }
  return fc.features;
}

function ringBbox(ring) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of ring) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}

// Geometria WFS jest w EPSG:3857 (metry); przeliczamy rogi na lon/lat.
function toLonLat(x, y) {
  return [(x / 20037508.34) * 180, (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90];
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function rasterize(regionId) {
  const bathy = JSON.parse(readFileSync(`public/data/${regionId}.json`, 'utf8'));
  const { nLat, nLon } = bathy;
  const lat0 = bathy.lat0 ?? bathy.bbox.latMin, lat1 = bathy.lat1 ?? bathy.bbox.latMax;
  const lon0 = bathy.lon0 ?? bathy.bbox.lonMin, lon1 = bathy.lon1 ?? bathy.bbox.lonMax;
  console.log(`\n[${regionId}] siatka ${nLat}x${nLon}, bbox ${lat0},${lon0} ${lat1},${lon1}`);

  const t0 = Date.now();
  const feats = await fetchBbox(bathy.bbox.lonMin, bathy.bbox.latMin, bathy.bbox.lonMax, bathy.bbox.latMax);
  console.log(`  poligonów: ${feats.length} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // Spłaszczamy do listy {bboxLonLat, outers[], sand} — Multipolygony 250k bywają duże,
  // więc najpierw szybki test bbox, potem pełny point-in-polygon.
  const polys = [];
  for (const f of feats) {
    const sand = folkToSand(f.properties?.folk_7cl, f.properties?.folk_5cl);
    const g = f.geometry;
    if (!g) continue;
    const multi = g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : null;
    if (!multi) continue;
    for (const poly of multi) {
      const outer = poly[0].map(([x, y]) => toLonLat(x, y));
      const bb = ringBbox(outer);
      polys.push({ bb, outer, holes: poly.slice(1).map((r) => r.map(([x, y]) => toLonLat(x, y))), sand });
    }
  }
  console.log(`  pierścieni po spłaszczeniu: ${polys.length}`);

  const sand = new Array(nLat * nLon).fill(null);
  let hits = 0, nulls = 0;
  const t1 = Date.now();
  for (let r = 0; r < nLat; r++) {
    const lat = lat0 + ((lat1 - lat0) * r) / (nLat - 1);
    for (let c = 0; c < nLon; c++) {
      const lon = lon0 + ((lon1 - lon0) * c) / (nLon - 1);
      let v = null;
      for (const p of polys) {
        if (lon < p.bb[0] || lat < p.bb[1] || lon > p.bb[2] || lat > p.bb[3]) continue;
        if (!pointInRing(lon, lat, p.outer)) continue;
        if (p.holes.some((h) => pointInRing(lon, lat, h))) continue;
        v = p.sand; // ostatni wygrywający poligon; nakładki 250k są rozłączne
      }
      sand[r * nLon + c] = v === null ? null : Math.round(v * 100) / 100;
      if (v === null) nulls++;
      else hits++;
    }
    if (r % 50 === 0) process.stdout.write(`\r  raster: ${r}/${nLat}`);
  }
  console.log(`\r  raster: ${nLat}/${nLat} (${((Date.now() - t1) / 1000).toFixed(1)} s), trafień=${hits}, brak danych=${nulls}`);

  const out = {
    id: `${regionId}.sediment`, region: regionId,
    source: 'EMODnet Geology, Seabed Substrate 1:250k (WFS gtk:seabed_substrate_250k), Folk->piasek: 7cl {Mud 0, sandy Mud 0.25, muddy Sand 0.5, Sand/Coarse/Rock 1, Mixed 0.6} fallback 5cl. CC-BY, nie do nawigacji.',
    sourceUrl: 'https://emodnet.ec.europa.eu/en/geology',
    bbox: bathy.bbox, nLat, nLon, lat0, lat1, lon0, lon1,
    stats: { cells: nLat * nLon, withData: hits, noData: nulls },
    sand,
  };
  mkdirSync('public/data', { recursive: true });
  const path = `public/data/${regionId}.sediment.json`;
  writeFileSync(path, JSON.stringify(out));
  console.log(`  zapisano ${path} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
  return out;
}

const wanted = process.argv.slice(2);
const regions = wanted.length ? wanted : ['baltic-south', 'baltic-polish-coast'];
for (const r of regions) {
  try { await rasterize(r); }
  catch (e) { console.error('BŁĄD', r, e.message); process.exitCode = 1; }
}
console.log('\nGotowe.');
