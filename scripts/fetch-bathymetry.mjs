// Pobiera rzeczywistą batymetrię Bałtyku z EMODnet DTM 2024 (ERDDAP griddap)
// i zapisuje jako lekką siatkę JSON do public/data/*.json
// Użycie: node scripts/fetch-bathymetry.mjs
import { writeFileSync, mkdirSync } from 'node:fs';

const ERDDAP = 'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.csv';

const REGIONS = [
  {
    id: 'baltic-full',
    name: 'Bałtyk — cały',
    latMin: 53.5, latMax: 66.0,
    lonMin: 9.0, lonMax: 31.0,
    stride: 30, // ~401 x 705 komórek (~3,5 km); cały Bałtyk w ~1,5 MB JSON
  },
  {
    id: 'baltic-full-hd',
    name: 'Bałtyk — cały (gęsty)',
    latMin: 53.5, latMax: 66.0,
    lonMin: 9.0, lonMax: 31.0,
    stride: 10, // ~1201 x 2113 komórek (~1,2 x 0,6 km); ~11 MB JSON
    round: 1, // przy tej gęstości 1 m precyzji wystarczy i odchudza plik
  },
  {
    id: 'baltic-south',
    name: 'Bałtyk Południowy — Zatoka Gdańska',
    latMin: 54.25, latMax: 55.05,
    lonMin: 18.2, lonMax: 19.9,
    stride: 5, // co ~5 komórek ~ 575 m; daje ~154 x 327
  },
  {
    id: 'baltic-polish-coast',
    name: 'Polskie wybrzeże — kafel hi-res (nakładka)',
    latMin: 54.15, latMax: 55.10,
    lonMin: 17.60, lonMax: 19.95,
    stride: 2, // ~230 m; ~456 x 1128 komórek — Mierzeja Helska (~300 m) mieści się w komórce
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

  // CSV: linia 0 nagłówek, linia 1 jednostki, dalej dane lat,lon,elev.
  // Dwa przebiegi bez trzymania wierszy w pamięci (region HD to ~2,5 mln wierszy).
  const lats = new Set(); const lons = new Set();
  for (let i = 2; i < lines.length; i++) {
    const c1 = lines[i].indexOf(','), c2 = lines[i].indexOf(',', c1 + 1);
    lats.add(parseFloat(lines[i].slice(0, c1)));
    lons.add(parseFloat(lines[i].slice(c1 + 1, c2)));
  }
  const latArr = [...lats].sort((a, b) => a - b);
  const lonArr = [...lons].sort((a, b) => a - b);
  const nLat = latArr.length, nLon = lonArr.length;
  console.log(`  siatka: ${nLat} x ${nLon} = ${nLat * nLon}`);

  // mapa indeksów (zaokrąglenie do 9 miejsc żeby uniknąć błędów float)
  const latIdx = new Map(latArr.map((v, i) => [v.toFixed(9), i]));
  const lonIdx = new Map(lonArr.map((v, i) => [v.toFixed(9), i]));
  const grid = new Array(nLat * nLon).fill(NaN);
  const prec = r.round ?? 0.1;
  let min = Infinity, max = -Infinity, seaCount = 0, landCount = 0;
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    const c1 = line.indexOf(','), c2 = line.indexOf(',', c1 + 1);
    const li = latIdx.get(parseFloat(line.slice(0, c1)).toFixed(9));
    const lo = lonIdx.get(parseFloat(line.slice(c1 + 1, c2)).toFixed(9));
    const elStr = line.slice(c2 + 1).trim();
    let v = parseFloat(elStr);
    if (Number.isNaN(v) || elStr === 'NaN' || elStr === '') v = NaN;
    else v = Math.round(v / prec) * prec;
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

// Użycie: node scripts/fetch-bathymetry.mjs [id...] — bez argumentów pobiera wszystko.
const wanted = new Set(process.argv.slice(2));
const results = [];
for (const r of REGIONS) {
  if (wanted.size && !wanted.has(r.id)) continue;
  try { results.push(await fetchRegion(r)); }
  catch (e) { console.error('BŁĄD', r.id, e.message); process.exitCode = 1; }
}
console.log('\nGotowe.');
