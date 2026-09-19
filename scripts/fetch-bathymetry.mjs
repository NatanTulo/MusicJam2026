// Pobiera rzeczywistą batymetrię Bałtyku z EMODnet DTM 2024 (ERDDAP griddap)
// i zapisuje jako lekką siatkę JSON do public/data/*.json
// Użycie: node scripts/fetch-bathymetry.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const ERDDAP = 'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.csv';

const REGIONS = [
  {
    id: 'baltic-south',
    name: 'Bałtyk Południowy — Zatoka Gdańska',
    latMin: 54.25, latMax: 55.05,
    lonMin: 18.2, lonMax: 19.9,
    stride: 5, // co ~5 komórek ~ 575 m; daje ~154 x 327
  },
  {
    id: 'baltic-overview',
    name: 'Bałtyk — przegląd (niska rozdzielczość)',
    latMin: 53.8, latMax: 59.8,
    lonMin: 10.0, lonMax: 25.0,
    stride: 45, // ~200 x 320, podgląd + docelowo wybór regionu
  },
];

async function fetchRegion(r) {
  const q = `elevation[(${r.latMin}):${r.stride}:(${r.latMax})][(${r.lonMin}):${r.stride}:(${r.lonMax})]`;
  const url = `${ERDDAP}?${encodeURIComponent(q).replace(/%5B/g, '[').replace(/%5D/g, ']').replace(/%28/g, '(').replace(/%29/g, ')').replace(/%3A/g, ':')}`;
  // ERDDAP woli nawiasy niezakodowane — budujemy ręcznie:
  const rawUrl = `${ERDDAP}?elevation[(${r.latMin}):${r.stride}:(${r.latMax})][(${r.lonMin}):${r.stride}:(${r.lonMax})]`;
  console.log(`\n[${r.id}] pobieranie:\n  ${rawUrl}`);
  const res = await fetch(rawUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} dla ${r.id}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  console.log(`  wierszy CSV: ${lines.length}`);
  if (lines.length < 5) throw new Error('pusta odpowiedź: ' + text.slice(0, 300));

  // CSV: linia 0 nagłówek, linia 1 jednostki, dalej dane lat,lon,elev
  const lats = new Set(); const lons = new Set();
  const rows = [];
  for (let i = 2; i < lines.length; i++) {
    const [la, lo, el] = lines[i].split(',');
    const lat = parseFloat(la), lon = parseFloat(lo);
    let elev = parseFloat(el);
    if (Number.isNaN(elev) || el.trim() === 'NaN' || el.trim() === '') elev = NaN;
    lats.add(lat); lons.add(lon);
    rows.push([lat, lon, elev]);
  }
  const latArr = [...lats].sort((a, b) => a - b);
  const lonArr = [...lons].sort((a, b) => a - b);
  const nLat = latArr.length, nLon = lonArr.length;
  console.log(`  siatka: ${nLat} x ${nLon} = ${nLat * nLon}`);

  // mapa indeksów (zaokrąglenie do 9 miejsc żeby uniknąć błędów float)
  const latIdx = new Map(latArr.map((v, i) => [v.toFixed(9), i]));
  const lonIdx = new Map(lonArr.map((v, i) => [v.toFixed(9), i]));
  const grid = new Array(nLat * nLon).fill(NaN);
  let min = Infinity, max = -Infinity, seaCount = 0, landCount = 0;
  for (const [lat, lon, elev] of rows) {
    const li = latIdx.get(lat.toFixed(9)), lo = lonIdx.get(lon.toFixed(9));
    const v = Number.isNaN(elev) ? NaN : Math.round(elev * 10) / 10;
    grid[li * nLon + lo] = v;
    if (!Number.isNaN(v)) {
      seaCount++;
      if (v < min) min = v;
      if (v > max) max = v;
    } else landCount++;
  }
  // JSON: NaN -> null
  const elevJson = grid.map(v => (Number.isNaN(v) ? null : v));
  const out = {
    id: r.id, name: r.name,
    source: 'EMODnet Digital Bathymetry DTM 2024 (ERDDAP griddap bathymetry_dtm_2024, elevation względem LAT). Nie do nawigacji.',
    sourceUrl: 'https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1',
    bbox: { latMin: r.latMin, latMax: r.latMax, lonMin: r.lonMin, lonMax: r.lonMax },
    nLat, nLon,
    lat0: latArr[0], lat1: latArr[nLat - 1],
    lon0: lonArr[0], lon1: lonArr[nLon - 1],
    stride: r.stride,
    stats: { min, max, seaCells: seaCount, landCells: landCount },
    elevation: elevJson,
  };
  mkdirSync('public/data', { recursive: true });
  const path = `public/data/${r.id}.json`;
  writeFileSync(path, JSON.stringify(out));
  console.log(`  zapisano ${path} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB), min=${min} max=${max} morze=${seaCount} ląd=${landCount}`);
  return out;
}

const results = [];
for (const r of REGIONS) {
  try { results.push(await fetchRegion(r)); }
  catch (e) { console.error('BŁĄD', r.id, e.message); process.exitCode = 1; }
}
console.log('\nGotowe.');
