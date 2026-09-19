// Buduje pełną rozdzielczość Bałtyku (stride 5 jak detal Zatoki, ~580x340 m)
// jako skompresowany PNG wysokości + meta JSON do public/data/baltic-full-res.*
// Użycie: node scripts/build-fullres.mjs [--patch-only]
//   --patch-only: bez pobierania; dekoduje istniejący PNG, dokleja łatkę detalu
//   i koduje od nowa (szybkie poprawki bez katowania ERDDAP).
// Format PNG: 8-bit RGB, R=starszy bajt, G=młodszy bajt q, B=0;
//   q = round(elev_m * 10) + 32768 (decymetry, offset binarny), q=0 → ląd/brak danych.
//   Wiersz 0 PNG = północ. Dekoder: src/bathymetry.js (BathymetryGrid.loadResPNG).
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';

const ERDDAP = 'https://erddap.emodnet.eu/erddap/griddap/bathymetry_dtm_2024.csv';
const LAT = [53.5, 66.0];
const LON_CUTS = [9.0, 14.5, 20.0, 25.5, 31.0];
const STRIDE = 5;
const OUT_PNG = 'public/data/baltic-full-res.png';
const OUT_META = 'public/data/baltic-full-res.meta.json';

async function fetchStrip(lonMin, lonMax) {
  const url = `${ERDDAP}?elevation[(${LAT[0]}):${STRIDE}:(${LAT[1]})][(${lonMin}):${STRIDE}:(${lonMax})]`;
  console.log(`  fetch lon ${lonMin}..${lonMax} …`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  const lines = text.trim().split('\n');
  if (lines.length < 5) throw new Error('pusta odpowiedź: ' + text.slice(0, 200));
  console.log(`    wierszy: ${lines.length}`);

  // Przebieg 1: współrzędne pasa.
  const lats = new Set(), lons = new Set();
  for (let i = 2; i < lines.length; i++) {
    const c = lines[i].indexOf(',');
    lats.add(parseFloat(lines[i].slice(0, c)));
    lons.add(parseFloat(lines[i].slice(c + 1, lines[i].indexOf(',', c + 1))));
  }
  const latArr = [...lats].sort((a, b) => a - b);
  const lonArr = [...lons].sort((a, b) => a - b);
  const nLat = latArr.length, nLon = lonArr.length;
  const latIdx = new Map(latArr.map((v, i) => [v.toFixed(9), i]));
  const lonIdx = new Map(lonArr.map((v, i) => [v.toFixed(9), i]));
  // Przebieg 2: wartości.
  const data = new Float32Array(nLat * nLon);
  for (let i = 2; i < lines.length; i++) {
    const line = lines[i];
    const c1 = line.indexOf(','), c2 = line.indexOf(',', c1 + 1);
    const li = latIdx.get(parseFloat(line.slice(0, c1)).toFixed(9));
    const lo = lonIdx.get(parseFloat(line.slice(c1 + 1, c2)).toFixed(9));
    const el = line.slice(c2 + 1).trim();
    let v = parseFloat(el);
    data[li * nLon + lo] = (Number.isNaN(v) || el === 'NaN' || el === '') ? NaN : Math.round(v * 10) / 10;
  }
  return { latArr, lonArr, nLat, nLon, data };
}

// --- CRC32 (do chunków PNG) ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Enkoduje Float32Array (wiersz 0 = południe) do PNG RGB, wiersz 0 pliku = północ. */
function encodeHeightPNG(data, nLat, nLon) {
  const W = nLon, H = nLat;
  const raw = Buffer.alloc(H * (1 + W * 3));
  const q = new Array(W);
  let min = Infinity, max = -Infinity, sea = 0, land = 0;
  for (let r = 0; r < H; r++) {
    const srcRow = (H - 1 - r) * W; //_flip: północ na górę
    let off = r * (1 + W * 3);
    raw[off++] = 1; // filtr Sub
    for (let c = 0; c < W; c++) {
      const e = data[srcRow + c];
      let v;
      if (Number.isNaN(e)) { v = 0; land++; }
      else { v = Math.round(e * 10) + 32768; sea++; if (e < min) min = e; if (e > max) max = e; }
      q[c] = v;
    }
    // filtr Sub: bajt minus bajt 3 pozycje wcześniej (w obrębie wiersza)
    let prev = [0, 0, 0];
    for (let c = 0; c < W; c++) {
      const R = (q[c] >> 8) & 0xff, G = q[c] & 0xff;
      raw[off++] = (R - prev[0]) & 0xff;
      raw[off++] = (G - prev[1]) & 0xff;
      raw[off++] = 0; // B stałe — Sub daje 0
      prev = [R, G, 0];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor
  const idat = deflateSync(raw, { level: 6 });
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0)),
  ]);
  // Samokontrola: rozmiar po inflacie musi się zgadzać z wejściem.
  const check = inflateSync(idat);
  if (check.length !== raw.length) throw new Error('niespójny IDAT po inflacie');
  return { png, stats: { min, max, seaCells: sea, landCells: land } };
}

/** Dekoduje PNG wysokości z powrotem do Float32Array (wiersz 0 = południe). */
function decodeHeightPNG(pngBuf) {
  let off = 8;
  const parts = [];
  let W = 0, H = 0;
  while (off < pngBuf.length) {
    const len = pngBuf.readUInt32BE(off);
    const type = pngBuf.toString('ascii', off + 4, off + 8);
    if (type === 'IHDR') { W = pngBuf.readUInt32BE(off + 8); H = pngBuf.readUInt32BE(off + 12); }
    if (type === 'IDAT') parts.push(pngBuf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const rb = 1 + W * 3;
  if (raw.length !== H * rb) throw new Error('niespójny rozmiar IDAT');
  const data = new Float32Array(W * H);
  for (let r = 0; r < H; r++) {
    const o = r * rb + 1;
    let pr = 0, pg = 0;
    for (let c = 0; c < W; c++) {
      const R = (raw[o + c * 3] + pr) & 0xff, G = (raw[o + c * 3 + 1] + pg) & 0xff;
      const q = R * 256 + G;
      data[(H - 1 - r) * W + c] = q === 0 ? NaN : (q - 32768) / 10;
      pr = R; pg = G;
    }
  }
  return { data, nLat: H, nLon: W };
}

/** Łata z detalu Zatoki (public/data/baltic-south.json): nadpisuje komórki
 *  pełnej siatki wewnątrz bbox detalu wartościami z siatki detalicznej.
 *  Ta sama rozdzielczość i źródło, ale korzystniejsza faza próbkowania —
 *  mierzeja Helska jest tam ciągła, a w globalnej siatce wypada między próbkami.
 *  Dzięki temu przełączanie regionów nie zmienia mapy pod łódką. */
function applyDetailPatch(global, latArr, lonArr) {
  const path = 'public/data/baltic-south.json';
  if (!existsSync(path)) {
    console.log('  (brak detalu Zatoki — pomijam łatkę)');
    return 0;
  }
  const d = JSON.parse(readFileSync(path, 'utf8'));
  const { nLat: dnLat, nLon: dnLon } = d;
  const ddata = new Float32Array(dnLat * dnLon);
  for (let i = 0; i < d.elevation.length; i++) {
    const v = d.elevation[i];
    ddata[i] = v === null || v === undefined ? NaN : v;
  }
  // Próbkowanie bilinearne z fallbackiem do nearest (jak BathymetryGrid).
  const sample = (lat, lon) => {
    const fx = ((lon - d.lon0) / (d.lon1 - d.lon0)) * (dnLon - 1);
    const fy = ((lat - d.lat0) / (d.lat1 - d.lat0)) * (dnLat - 1);
    if (fx < 0 || fy < 0 || fx > dnLon - 1 || fy > dnLat - 1) return undefined;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, dnLon - 1), y1 = Math.min(y0 + 1, dnLat - 1);
    const tx = fx - x0, ty = fy - y0;
    const a = ddata[y0 * dnLon + x0], b = ddata[y0 * dnLon + x1];
    const c = ddata[y1 * dnLon + x0], e = ddata[y1 * dnLon + x1];
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(e)) {
      return ddata[Math.round(fy) * dnLon + Math.round(fx)];
    }
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + e * tx * ty;
  };
  const nLat = latArr.length, nLon = lonArr.length;
  let patched = 0, dilated = 0;
  for (let r = 0; r < nLat; r++) {
    const lat = latArr[r];
    if (lat < d.lat0 || lat > d.lat1) continue;
    for (let c = 0; c < nLon; c++) {
      const lon = lonArr[c];
      if (lon < d.lon0 || lon > d.lon1) continue;
      const i = r * nLon + c;
      // Dylatacja maski lądu: ląd, jeśli KTÓRAKOLWIEK komórka detalu w promieniu
      // 1 (3x3) jest lądem. Wstęga węższa od komórki (Mierzeja Helska ~300 m
      // przy komórkach ~580 m) inaczej rwie się po resamplingu na przesuniętą
      // fazę siatki — a z samych nulli nie da się odróżnić mierzei od dziury
      // w sondowaniach, więc ufamy tu siatce detalicznej. Efekt uboczny:
      // brzegi w bbox Zatoki są ~1 komórkę (~575 m) "tłustsze".
      const fx = ((lon - d.lon0) / (d.lon1 - d.lon0)) * (dnLon - 1);
      const fy = ((lat - d.lat0) / (d.lat1 - d.lat0)) * (dnLat - 1);
      const nx = Math.round(fx), ny = Math.round(fy);
      let landNear = false;
      for (let dr = -1; dr <= 1 && !landNear; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const rr = ny + dr, cc = nx + dc;
          if (rr < 0 || cc < 0 || rr >= dnLat || cc >= dnLon) continue;
          if (Number.isNaN(ddata[rr * dnLon + cc])) { landNear = true; break; }
        }
      }
      if (landNear) {
        if (!Number.isNaN(global[i])) dilated++;
        global[i] = NaN;
        patched++;
        continue;
      }
      const v = sample(lat, lon);
      if (v === undefined) continue;
      global[i] = Number.isNaN(v) ? NaN : Math.round(v * 10) / 10;
      patched++;
    }
  }
  console.log(`  łatka detalu: nadpisano ${patched} komórek w bbox Zatoki (doszerzono ląd w ${dilated})`);
  return patched;
}

function writeOutputs(global, latArr, lonArr) {
  const nLat = latArr.length, nLon = lonArr.length;
  console.log('kodowanie PNG…');
  const { png, stats } = encodeHeightPNG(global, nLat, nLon);
  // Wersja = hash zawartości PNG: loader dokleja ?v= do URL, więc przeglądarka
  // nigdy nie podstawi starego pliku z cache po regeneracji danych.
  let h = 0x811c9dc5;
  for (let i = 0; i < png.length; i++) { h ^= png[i]; h = Math.imul(h, 0x01000193); }
  const v = (h >>> 0).toString(16);
  mkdirSync('public/data', { recursive: true });
  writeFileSync(OUT_PNG, png);
  const meta = {
    id: 'baltic-full-res',
    name: 'Bałtyk — cały (pełna rozdzielczość)',
    source: 'EMODnet Digital Bathymetry DTM 2024 (ERDDAP griddap bathymetry_dtm_2024, elevation względem LAT). Nie do nawigacji.',
    sourceUrl: 'https://doi.org/10.12770/cf51df64-56f9-4a99-b1aa-36b8d7b743a1',
    format: 'png-rgb-q10-offset32768, q=0 → ląd/brak danych, wiersz 0 = północ',
    bbox: { latMin: LAT[0], latMax: LAT[1], lonMin: LON_CUTS[0], lonMax: LON_CUTS[LON_CUTS.length - 1] },
    nLat, nLon,
    lat0: latArr[0], lat1: latArr[nLat - 1],
    lon0: lonArr[0], lon1: lonArr[nLon - 1],
    stride: STRIDE,
    detailPatch: 'baltic-south.json',
    v,
    stats,
  };
  writeFileSync(OUT_META, JSON.stringify(meta));
  console.log(`zapisano ${OUT_PNG} (${(png.length / 1048576).toFixed(1)} MB), min=${stats.min} max=${stats.max}`);
}

if (process.argv.includes('--patch-only')) {
  console.log('tryb --patch-only: dekoduję istniejący PNG, doklejam detal, koduję od nowa');
  const meta = JSON.parse(readFileSync(OUT_META, 'utf8'));
  const { data: global, nLat, nLon } = decodeHeightPNG(readFileSync(OUT_PNG));
  if (nLat !== meta.nLat || nLon !== meta.nLon) throw new Error('PNG nie pasuje do meta');
  // Odtworzenie równomiernych tablic współrzędnych (siatka strided ERDDAP).
  const latArr = Array.from({ length: nLat }, (_, i) => meta.lat0 + (i * (meta.lat1 - meta.lat0)) / (nLat - 1));
  const lonArr = Array.from({ length: nLon }, (_, i) => meta.lon0 + (i * (meta.lon1 - meta.lon0)) / (nLon - 1));
  applyDetailPatch(global, latArr, lonArr);
  writeOutputs(global, latArr, lonArr);
  console.log('Gotowe.');
  process.exit(0);
}

const strips = [];
for (let i = 0; i < LON_CUTS.length - 1; i++) {
  strips.push(await fetchStrip(LON_CUTS[i], LON_CUTS[i + 1]));
}
// Weryfikacja spójności pasa: te same szerokości geograficzne wszędzie.
const refLat = JSON.stringify(strips[0].latArr);
for (const s of strips) {
  if (JSON.stringify(s.latArr) !== refLat) throw new Error('rozjazd siatki lat między pasami');
}
// Globalne współrzędne (deduplikacja kolumn granicznych).
const lonSet = new Set();
for (const s of strips) for (const lo of s.lonArr) lonSet.add(lo.toFixed(9));
const lonArr = [...lonSet].map(Number).sort((a, b) => a - b);
const latArr = strips[0].latArr;
const nLat = latArr.length, nLon = lonArr.length;
console.log(`siatka globalna: ${nLat} x ${nLon} = ${(nLat * nLon).toLocaleString('pl-PL')}`);
const latIdx = new Map(latArr.map((v, i) => [v.toFixed(9), i]));
const lonIdx = new Map(lonArr.map((v, i) => [v.toFixed(9), i]));
const global = new Float32Array(nLat * nLon).fill(NaN);
for (const s of strips) {
  for (let r = 0; r < s.nLat; r++) {
    const gr = latIdx.get(s.latArr[r].toFixed(9));
    for (let c = 0; c < s.nLon; c++) {
      const gc = lonIdx.get(s.lonArr[c].toFixed(9));
      global[gr * nLon + gc] = s.data[r * s.nLon + c];
    }
  }
  s.data = null; // zwolnij pas
}

console.log('łatanie detalem Zatoki…');
applyDetailPatch(global, latArr, lonArr);

writeOutputs(global, latArr, lonArr);
console.log('Gotowe.');
