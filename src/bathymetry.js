// Siatka batymetrii: ładowanie JSON (EMODnet/GEBCO) + próbkowanie głębokości + mapowanie lat/lon <-> świat.
// Format JSON: { bbox:{latMin,latMax,lonMin,lonMax}, nLat, nLon, elevation:[...|null], ... }
// elevation: metry względem LAT, ujemne = pod wodą, null = ląd/brak danych.

export const METERS_PER_DEG_LAT = 111320;
// Promień Ziemi: wycinek mapy jest płatem powierzchni kuli (sfera WGS84
// przybliżona kulą), a nie płaską kartką. Współrzędne świata to lokalny
// układ ENU styczny do sfery w środku siatki: x = wschód, y = góra
// (radialnie od środka Ziemi), z = -północ (południe dodatnie).
export const EARTH_R = 6371000;
const D2R = Math.PI / 180;

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
    // Cache trygonometrii środka siatki do mapowania sferycznego (ENU).
    const latC = this.latCenter * D2R, lonC = this.lonCenter * D2R;
    this._sinLatC = Math.sin(latC);
    this._cosLatC = Math.cos(latC);
    this._sinLonC = Math.sin(lonC);
    this._cosLonC = Math.cos(lonC);
    // ECEF środka (poziom morza, h=0) — odejmowane w latLonToWorld.
    this._Xc = EARTH_R * this._cosLatC * this._cosLonC;
    this._Yc = EARTH_R * this._cosLatC * this._sinLonC;
    this._Zc = EARTH_R * this._sinLatC;
    this.fillEnclosedNulls();
    this.buildRenderData();
  }

  /** Małe dziury null w pełnym morzu (brak sondowań EMODnet) zalewa morzem.
   *  Bez tego każda taka komórka rysuje się jako piaskowa wysepka i blokuje łódkę.
   *  Prawdziwy ląd (duże spójne obszary, w tym sięgające brzegu mapy) zostaje
   *  nietknięty — kryterium to rozmiar spójnej składowej nulli. */
  fillEnclosedNulls(maxHole = 8) {
    const { nLat, nLon, data } = this;
    const N = nLat * nLon;
    const comp = new Int32Array(N).fill(-1); // -1 = woda, >=0 = id składowej nulli
    let nComp = 0;
    const sizes = [];
    const touchesBorder = [];
    // Etykietowanie spójnych składowych nulli (BFS, 4-sąsiedztwo).
    for (let i = 0; i < N; i++) {
      if (!Number.isNaN(data[i]) || comp[i] !== -1) continue;
      const id = nComp++;
      let size = 0, border = false;
      const stack = [i];
      comp[i] = id;
      while (stack.length) {
        const j = stack.pop();
        size++;
        const r = (j / nLon) | 0, c = j % nLon;
        if (r === 0 || c === 0 || r === nLat - 1 || c === nLon - 1) border = true;
        if (r > 0 && Number.isNaN(data[j - nLon]) && comp[j - nLon] === -1) { comp[j - nLon] = id; stack.push(j - nLon); }
        if (r < nLat - 1 && Number.isNaN(data[j + nLon]) && comp[j + nLon] === -1) { comp[j + nLon] = id; stack.push(j + nLon); }
        if (c > 0 && Number.isNaN(data[j - 1]) && comp[j - 1] === -1) { comp[j - 1] = id; stack.push(j - 1); }
        if (c < nLon - 1 && Number.isNaN(data[j + 1]) && comp[j + 1] === -1) { comp[j + 1] = id; stack.push(j + 1); }
      }
      sizes[id] = size;
      touchesBorder[id] = border;
    }
    // Małe śródmorskie dziury: średnia ze skończonych sąsiadów (iteracyjnie,
    // żeby wypełnić też środki kilkukomórkowych plam).
    for (let pass = 0; pass < 4; pass++) {
      let changed = false;
      for (let r = 0; r < nLat; r++) {
        for (let c = 0; c < nLon; c++) {
          const i = r * nLon + c;
          const id = comp[i];
          if (id < 0 || touchesBorder[id] || sizes[id] > maxHole || !Number.isNaN(data[i])) continue;
          let s = 0, k = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= nLat || cc >= nLon) continue;
              const v = data[rr * nLon + cc];
              if (!Number.isNaN(v)) { s += v; k++; }
            }
          }
          if (k > 0) { data[i] = s / k; changed = true; }
        }
      }
      if (!changed) break;
    }
    // Statystyki od nowa (liczba komórek morza mogła urosnąć).
    let min = Infinity, max = -Infinity, sea = 0;
    for (let i = 0; i < N; i++) {
      const v = data[i];
      if (Number.isNaN(v)) continue;
      sea++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    this.stats = { ...(this.stats || {}), min, max, seaCells: sea, landCells: N - sea };
  }

  /** Wersja renderowa siatki: ląd (NaN) zawsze +2 m, a komórki MORZA
   *  stykające się z lądem dostają średnią 3×3 (płycizna/plaża).
   *  Komórek lądu nie ruszamy — inaczej wąskie mierzeje (Helska, ~1 komórka)
   *  renderowałyby się jako woda, a fizyka (ostre `data`) i tak by blokowała
   *  łódkę, tworząc niewidzialne ściany. Pełne morze i środek lądu nietknięte.
   *  `passes` (domyślnie 1) poszerza plażę: każdy przebieg rozlewa wygładzenie
   *  o kolejną komórkę w głąb morza (aproksymacja Gaussa, ping-pong buforów).
   *  Fizyka (sampleElevation/depthAt/isLand) cały czas używa surowego `data`. */
  buildRenderData(passes = 1) {
    const { nLat, nLon, data } = this;
    const N = nLat * nLon;
    const filled = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const v = data[i];
      filled[i] = Number.isNaN(v) ? 2 : v;
    }
    let src = filled;
    let dst = new Float32Array(N);
    for (let p = 0; p < Math.max(1, passes); p++) {
      dst.set(src);
      for (let r = 0; r < nLat; r++) {
        for (let c = 0; c < nLon; c++) {
          const i = r * nLon + c;
          if (Number.isNaN(data[i])) continue; // ląd zostaje +2
          let coastal = false;
          for (let dr = -1; dr <= 1 && !coastal; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              if (!dr && !dc) continue;
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= nLat || cc >= nLon) continue;
              if (Number.isNaN(data[rr * nLon + cc])) { coastal = true; break; }
            }
          }
          if (!coastal && p === 0) continue;
          // W kolejnych przebiegach wygładzaj też już-wygładzone sąsiedztwo
          // (fala relaksacji), żeby plaża się poszerzała, nie tylko pogłębiała.
          if (!coastal && p > 0) {
            let touched = false;
            for (let dr = -2; dr <= 2 && !touched; dr++) {
              for (let dc = -2; dc <= 2; dc++) {
                if (!dr && !dc) continue;
                const rr = r + dr, cc = c + dc;
                if (rr < 0 || cc < 0 || rr >= nLat || cc >= nLon) continue;
                if (src[rr * nLon + cc] !== filled[rr * nLon + cc]) { touched = true; break; }
              }
            }
            if (!touched) continue;
          }
          let s = 0, k = 0;
          for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
              const rr = r + dr, cc = c + dc;
              if (rr < 0 || cc < 0 || rr >= nLat || cc >= nLon) continue;
              s += src[rr * nLon + cc]; k++;
            }
          }
          dst[i] = s / k;
        }
      }
      const tmp = src; src = dst; dst = tmp === filled ? new Float32Array(N) : tmp;
    }
    this.renderData = src === filled ? filled.slice() : src;
  }

  /** Wysokość do renderu (geometria + tekstura): bilinear po wygładzonej
   *  siatce przybrzeżnej. Nigdy nie zwraca NaN wewnątrz mapy (ląd = +2 m
   *  z łagodnym zejściem). Poza mapą NaN. */
  sampleRenderElevation(lat, lon) {
    const { nLat, nLon } = this;
    const fx = ((lon - this.lon0) / (this.lon1 - this.lon0)) * (nLon - 1);
    const fy = ((lat - this.lat0) / (this.lat1 - this.lat0)) * (nLat - 1);
    if (fx < 0 || fy < 0 || fx > nLon - 1 || fy > nLat - 1) return NaN;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const x1 = Math.min(x0 + 1, nLon - 1), y1 = Math.min(y0 + 1, nLat - 1);
    const tx = fx - x0, ty = fy - y0;
    const rd = this.renderData;
    const a = rd[y0 * nLon + x0];
    const b = rd[y0 * nLon + x1];
    const c = rd[y1 * nLon + x0];
    const d = rd[y1 * nLon + x1];
    return a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + c * (1 - tx) * ty + d * tx * ty;
  }

  static async load(id) {
    const res = await fetch(`./data/${id}.json`);
    if (!res.ok) throw new Error(`Nie znaleziono danych regionu ${id}`);
    return new BathymetryGrid(await res.json());
  }

  /** Buduje siatkę z gotowego Float32Array (np. zdekodowanego z PNG). */
  static fromData(meta, data) {
    const g = new BathymetryGrid({ ...meta, elevation: [] });
    g.data.set(data);
    g.fillEnclosedNulls();
    g.buildRenderData();
    return g;
  }

  /** Pełna rozdzielczość Bałtyku z PNG wysokości (scripts/build-fullres.mjs):
   *  RGB, q = R*256+G, q=0 → ląd/brak danych, w przeciwnym razie (q-32768)/10 m.
   *  Wiersz 0 PNG = północ, wiersz 0 siatki = południe (odwracamy). */
  static async loadResPNG(id = 'baltic-full-res') {
    // meta zawsze świeża (ma 4 KB), a PNG cache'owany po hashu zawartości (?v=)
    // — po regeneracji danych przeglądarka nie podstawi starego pliku z cache.
    const metaRes = await fetch(`./data/${id}.meta.json`, { cache: 'no-store' });
    if (!metaRes.ok) throw new Error(`Brak meta pełnej rozdzielczości (${id})`);
    const meta = await metaRes.json();
    const v = meta.v ? `?v=${meta.v}` : '';
    const blob = await (await fetch(`./data/${id}.png${v}`)).blob();
    const bmp = await createImageBitmap(blob);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0);
    const px = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    if (bmp.width !== meta.nLon || bmp.height !== meta.nLat)
      throw new Error(`Niezgodny rozmiar PNG: ${bmp.width}x${bmp.height} vs meta ${meta.nLon}x${meta.nLat}`);
    const { nLat, nLon } = meta;
    const data = new Float32Array(nLat * nLon);
    for (let r = 0; r < nLat; r++) {
      const src = r * nLon, dst = (nLat - 1 - r) * nLon;
      for (let c = 0; c < nLon; c++) {
        const q = px[(src + c) * 4] * 256 + px[(src + c) * 4 + 1];
        data[dst + c] = q === 0 ? NaN : (q - 32768) / 10;
      }
    }
    if (bmp.close) bmp.close();
    return BathymetryGrid.fromData(meta, data);
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

  latLonToWorld(lat, lon, h = 0) {
    // Pozycja punktu (lat, lon, wysokość h nad poziomem morza) na kuli
    // o promieniu EARTH_R, wyrażona w lokalnym ENU środka siatki.
    // x = wschód, y = góra (radialnie), z = -północ.
    const latR = lat * D2R, lonR = lon * D2R;
    const cosLat = Math.cos(latR), sinLat = Math.sin(latR);
    const cosLon = Math.cos(lonR), sinLon = Math.sin(lonR);
    const Rp = EARTH_R + h;
    const dx = Rp * cosLat * cosLon - this._Xc;
    const dy = Rp * cosLat * sinLon - this._Yc;
    const dz = Rp * sinLat - this._Zc;
    const sLc = this._sinLatC, cLc = this._cosLatC;
    const sNc = this._sinLonC, cNc = this._cosLonC;
    const east = -sNc * dx + cNc * dy;
    const north = -sLc * cNc * dx - sLc * sNc * dy + cLc * dz;
    const up = cLc * cNc * dx + cLc * sNc * dy + sLc * dz;
    return { x: east, y: up, z: -north };
  }

  /** Wersor normalnej (pion radialny) w punkcie lat/lon, w układzie świata. */
  normalAt(lat, lon, out) {
    const latR = lat * D2R, lonR = lon * D2R;
    const ux = Math.cos(latR) * Math.cos(lonR);
    const uy = Math.cos(latR) * Math.sin(lonR);
    const uz = Math.sin(latR);
    const sLc = this._sinLatC, cLc = this._cosLatC;
    const sNc = this._sinLonC, cNc = this._cosLonC;
    const east = -sNc * ux + cNc * uy;
    const north = -sLc * cNc * ux - sLc * sNc * uy + cLc * uz;
    const up = cLc * cNc * ux + cLc * sNc * uy + sLc * uz;
    if (out) { out.x = east; out.y = up; out.z = -north; return out; }
    return { x: east, y: up, z: -north };
  }

  worldToLatLon(x, z) {
    // Odwrotność latLonToWorld dla h=0 (iteracyjnie, bo rzut sfery na
    // płaszczyznę styczną jest nieliniowy). Start z przybliżenia płaskiego.
    let lat = this.latCenter - z / METERS_PER_DEG_LAT;
    let lon = this.lonCenter + x / this.mPerDegLon;
    for (let k = 0; k < 4; k++) {
      const p = this.latLonToWorld(lat, lon, 0);
      const mPerDegLon = METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
      lat += -(z - p.z) / METERS_PER_DEG_LAT;
      lon += (x - p.x) / mPerDegLon;
    }
    return { lat, lon };
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
