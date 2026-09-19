// Siatka batymetrii: ładowanie JSON (EMODnet/GEBCO) + próbkowanie głębokości + mapowanie lat/lon <-> świat.
// Format JSON: { bbox:{latMin,latMax,lonMin,lonMax}, nLat, nLon, elevation:[...|null], ... }
// elevation: metry względem LAT, ujemne = pod wodą, null = ląd/brak danych.

export const METERS_PER_DEG_LAT = 111320;

export class BathymetryGrid {
  constructor(meta) {
    this.id = meta.id;
    this.name = meta.name;
    this.source = meta.source;
    this.bbox = meta.bbox;
    this.nLat = meta.nLat;
    this.nLon = meta.nLon;
    this.stats = meta.stats;
    this.latCenter = (meta.bbox.latMin + meta.bbox.latMax) / 2;
    this.lonCenter = (meta.bbox.lonMin + meta.bbox.lonMax) / 2;
    this.mPerDegLon = METERS_PER_DEG_LAT * Math.cos((this.latCenter * Math.PI) / 180);
    this.widthM = (meta.bbox.lonMax - meta.bbox.lonMin) * this.mPerDegLon;
    this.depthM = (meta.bbox.latMax - meta.bbox.latMin) * METERS_PER_DEG_LAT;
    // Siatka rośnie z lat (wiersze) i lon (kolumny). Zachowujemy dokładne współrzędne
    // pierwszej/ostatniej komórki z pliku (lat0/lat1/lon0/lon1), bo ERDDAP zwraca
    // środki komórek, nie idealny bbox.
    this.lat0 = meta.lat0 ?? meta.bbox.latMin;
    this.lat1 = meta.lat1 ?? meta.bbox.latMax;
    this.lon0 = meta.lon0 ?? meta.bbox.lonMin;
    this.lon1 = meta.lon1 ?? meta.bbox.lonMax;
    this.data = new Float32Array(meta.nLat * meta.nLon);
    for (let i = 0; i < meta.elevation.length; i++) {
      const v = meta.elevation[i];
      this.data[i] = v === null || v === undefined ? NaN : v;
    }
  }

  static async load(id) {
    const res = await fetch(`./data/${id}.json`);
    if (!res.ok) throw new Error(`Nie znaleziono danych regionu ${id}`);
    return new BathymetryGrid(await res.json());
  }

  /** Interpolacja bilinearna wysokości dna (m). Zwraca NaN na lądzie/poza mapą. */
  sampleElevation(lat, lon) {
    const { nLat, nLon } = this;
    const fx = ((lon - this.lon0) / (this.lon1 - this.lon0)) * (nLon - 1);
    const fy = ((lat - this.lat0) / (this.lat1 - this.lat0)) * (nLat - 1);
    if (fx < 0 || fy < 0 || fx > nLon - 1 || fy > nLat - 1) return NaN;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, nLon - 1), y1 = Math.min(y0 + 1, nLat - 1);
    const tx = fx - x0, ty = fy - y0;
    const a = this.data[y0 * nLon + x0];
    const b = this.data[y0 * nLon + x1];
    const c = this.data[y1 * nLon + x0];
    const d = this.data[y1 * nLon + x1];
    // Jeśli któryś róg to ląd (NaN) — użyj najbliższego sąsiada zamiast dziury.
    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c) || Number.isNaN(d)) {
      const nn = this.sampleNearest(lat, lon);
      // mieszaj: im bliżej środka komórki lądowej, tym bardziej "ląd"
      return nn;
    }
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }

  sampleNearest(lat, lon) {
    const fx = Math.round(((lon - this.lon0) / (this.lon1 - this.lon0)) * (this.nLon - 1));
    const fy = Math.round(((lat - this.lat0) / (this.lat1 - this.lat0)) * (this.nLat - 1));
    if (fx < 0 || fy < 0 || fx >= this.nLon || fy >= this.nLat) return NaN;
    return this.data[fy * this.nLon + fx];
  }

  /** Głębokość wody w metrach (0 na lądzie). */
  depthAt(lat, lon) {
    const e = this.sampleElevation(lat, lon);
    if (Number.isNaN(e) || e >= 0) return 0;
    return -e;
  }

  isLand(lat, lon) {
    const e = this.sampleElevation(lat, lon);
    return Number.isNaN(e) || e >= -0.5;
  }

  latLonToWorld(lat, lon) {
    return {
      x: (lon - this.lonCenter) * this.mPerDegLon,
      z: -(lat - this.latCenter) * METERS_PER_DEG_LAT,
    };
  }

  worldToLatLon(x, z) {
    return {
      lat: this.latCenter - z / METERS_PER_DEG_LAT,
      lon: this.lonCenter + x / this.mPerDegLon,
    };
  }

  inBounds(lat, lon, margin = 0) {
    const b = this.bbox;
    return (
      lat >= b.latMin + margin && lat <= b.latMax - margin &&
      lon >= b.lonMin + margin && lon <= b.lonMax - margin
    );
  }
}

/** Paleta głębokości (elewacja m) -> kolor [r,g,b] 0..1. */
export function depthColor(elev, out = [0, 0, 0]) {
  if (Number.isNaN(elev) || elev >= 0) {
    // ląd: piaskowo-zielony
    const t = Math.min(1, Math.max(0, elev / 30));
    out[0] = 0.76 - t * 0.35; out[1] = 0.70 - t * 0.18; out[2] = 0.50 - t * 0.2;
    return out;
  }
  const d = -elev;
  // 0-5: turkus płycizny, 5-20: jasny błękit, 20-60: niebieski, 60+: granat
  let r, g, b;
  if (d < 5) { const t = d / 5; r = 0.45 + 0.15 * t; g = 0.85 - 0.05 * t; b = 0.80 - 0.05 * t; }
  else if (d < 20) { const t = (d - 5) / 15; r = 0.60 - 0.35 * t; g = 0.80 - 0.25 * t; b = 0.75 + 0.1 * t; }
  else if (d < 60) { const t = (d - 20) / 40; r = 0.25 - 0.18 * t; g = 0.55 - 0.3 * t; b = 0.85 - 0.15 * t; }
  else { const t = Math.min(1, (d - 60) / 120); r = 0.07 - 0.05 * t; g = 0.25 - 0.17 * t; b = 0.70 - 0.3 * t; }
  out[0] = r; out[1] = g; out[2] = b;
  return out;
}
