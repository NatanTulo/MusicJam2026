// Generuje lekkie granice państw + etykiety dla regionu Bałtyku
// na podstawie tiny-world-map (tinyworldmap/tiny-world-map, licencja ODbL).
// Użycie: node scripts/extract-borders.mjs
// Wynik: public/data/borders-baltic.json — tylko linie i etykiety
// w pobliżu Bałtyku (przycięte do bbox + margines), współrzędne lat/lon.
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

const SRC_URL = 'https://raw.githubusercontent.com/tinyworldmap/tiny-world-map/gh-pages/dist/v3/tiny-world-borders.json';
const CACHE = '/tmp/tiny-world-borders.json';
const OUT = 'public/data/borders-baltic.json';

// Bbox gry (Bałtyk — cały) + margines, żeby złapać też etykiety krajów ościennych.
// latMin schodzi do 50.5, żeby zachować niemieckie wybrzeże Bałtyku.
const BBOX = { latMin: 50.5, latMax: 67.0, lonMin: 7.5, lonMax: 32.0 };

// Ręczne kotwice etykiet dla krajów, których środek z tinyworldmap leży daleko
// poza Bałtykiem (etykieta Rosji jest na Syberii, Niemiec pod Harzem) — stawiamy
// je nad widocznym w grze fragmentem kraju.
const LABEL_OVERRIDES = {
  Germany: { lat: 54.08, lon: 12.0 },
  Russia: { lat: 54.72, lon: 21.1, name: 'Rosja (Kaliningrad)' },
  Poland: { lat: 53.95, lon: 19.3 },
  Norway: { lat: 59.6, lon: 10.3 },
  Denmark: { lat: 55.5, lon: 10.4 },
};

// Polskie nazwy krajów widocznych w regionie (reszta zostaje po angielsku).
const PL_NAMES = {
  Poland: 'Polska', Germany: 'Niemcy', Denmark: 'Dania', Sweden: 'Szwecja',
  Norway: 'Norwegia', Finland: 'Finlandia', Russia: 'Rosja', Lithuania: 'Litwa',
  Latvia: 'Łotwa', Estonia: 'Estonia', Belarus: 'Białoruś', Ukraine: 'Ukraina',
  Netherlands: 'Holandia', Belgium: 'Belgia', 'Czech Republic': 'Czechy',
  Czechia: 'Czechy', Slovakia: 'Słowacja', Kaliningrad: 'Kaliningrad',
};

const normToLon = (x) => x * 360 - 180;
const normToLat = (y) => Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180 / Math.PI;

function parsePathString(s) {
  // Format tinyworldmap: "M x y x y ... Z" z możliwymi wieloma podścieżkami "M ... Z M ... Z".
  const rings = [];
  const parts = s.split('M').map((t) => t.trim()).filter(Boolean);
  for (const part of parts) {
    const tokens = part.replace(/Z.*$/, '').trim().split(/\s+/).map(Number).filter((n) => !Number.isNaN(n));
    const ring = [];
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      const lon = normToLon(tokens[i] / 800);
      const lat = normToLat(tokens[i + 1] / 800);
      ring.push([Math.round(lat * 10000) / 10000, Math.round(lon * 10000) / 10000]);
    }
    if (ring.length >= 2) rings.push(ring);
  }
  return rings;
}

const inBbox = (lat, lon, m = 0) =>
  lat >= BBOX.latMin - m && lat <= BBOX.latMax + m && lon >= BBOX.lonMin - m && lon <= BBOX.lonMax + m;

async function loadSource() {
  if (existsSync(CACHE)) {
    console.log(`  używam cache: ${CACHE}`);
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  }
  console.log(`  pobieranie: ${SRC_URL}`);
  const res = await fetch(SRC_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
  const data = await res.json();
  writeFileSync(CACHE, JSON.stringify(data));
  return data;
}

const data = await loadSource();
const bordersLayer = data.find((l) => l.id === 'country_borders');
const labelsLayer = data.find((l) => l.id === 'country_labels');
if (!bordersLayer || !labelsLayer) throw new Error('Nie znaleziono warstw country_borders/country_labels');

const MARGIN = 0.6; // stopnie — przycięcie z zapasem, żeby linie nie urywały się na krawędzi
let inCount = 0, outCount = 0;
const borders = [];
for (const [pathStr, bbox] of bordersLayer.paths) {
  // Szybki test bbox (znormalizowany, x=lon, y=mercator).
  const [x0, y0, x1, y1] = bbox;
  const lon0 = normToLon(x0), lon1 = normToLon(x1);
  const latTop = normToLat(y0), latBot = normToLat(y1); // y0 < y1 -> latTop > latBot
  const hits = !(lon1 < BBOX.lonMin - MARGIN || lon0 > BBOX.lonMax + MARGIN ||
    latBot > BBOX.latMax + MARGIN || latTop < BBOX.latMin - MARGIN);
  if (!hits) { outCount++; continue; }
  inCount++;
  for (const ring of parsePathString(pathStr)) {
    // Zachowaj punkty w/near bbox (z marginesem); odrzuć pierścienie w całości poza.
    const pts = ring.filter(([la, lo]) => inBbox(la, lo, MARGIN));
    if (pts.length >= 2) borders.push(pts);
  }
}

const labels = [];
for (const [yc, xc, name] of labelsLayer.labels) {
  const lon = normToLon(xc), lat = normToLat(yc);
  if (!inBbox(lat, lon)) continue;
  const override = LABEL_OVERRIDES[name];
  labels.push({
    name: override?.name ?? PL_NAMES[name] ?? name,
    nameEn: name,
    lat: override?.lat ?? Math.round(lat * 10000) / 10000,
    lon: override?.lon ?? Math.round(lon * 10000) / 10000,
  });
}
// Etykieta Rosji z tinyworldmap leży na Syberii (poza bbox) — dodaj jawną kotwicę
// nad Obwodem Kaliningradzkim, widocznym w grze.
if (!labels.some((l) => l.nameEn === 'Russia')) {
  const o = LABEL_OVERRIDES.Russia;
  labels.push({ name: o.name, nameEn: 'Russia', lat: o.lat, lon: o.lon });
}
// Etykieta Polski z tinyworldmap leży na południe od bbox (52.2°N) — dociągnij jawnie,
// bo to kluczowy kraj dla Zatoki Gdańskiej.
if (!labels.some((l) => l.nameEn === 'Poland')) {
  const hit = labelsLayer.labels.find((l) => l[2] === 'Poland');
  if (hit) {
    const lat = normToLat(hit[1]), lon = normToLon(hit[0]);
    labels.push({ name: 'Polska', nameEn: 'Poland', lat: Math.round(lat * 10000) / 10000, lon: Math.round(lon * 10000) / 10000 });
  }
}
labels.sort((a, b) => a.name.localeCompare(b.name, 'pl'));

const out = {
  source: 'tinyworldmap (https://github.com/tinyworldmap/tiny-world-map), dane © OpenStreetMap contributors, licencja ODbL 1.0 (https://opendatacommons.org/licenses/odbl/).',
  sourceUrl: 'https://github.com/tinyworldmap/tiny-world-map',
  attribution: 'Granice i nazwy państw: © OpenStreetMap contributors, tinyworldmap (ODbL)',
  bbox: BBOX,
  borders,
  labels,
};

mkdirSync('public/data', { recursive: true });
writeFileSync(OUT, JSON.stringify(out));
const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`  ścieżki w regionie: ${inCount}, odrzucone: ${outCount}`);
console.log(`  pierścienie po przycięciu: ${borders.length}, etykiety: ${labels.map((l) => l.name).join(', ')}`);
console.log(`  zapisano ${OUT} (${kb} KB)`);
