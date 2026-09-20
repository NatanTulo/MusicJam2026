// Symulacja ryb w morzu: pozycja na łowisku, głębokość, cykl życia.
// Bez Three.js — renderer tylko czyta stan z list().
import { FISH_CONFIG } from './config.js';
import { SPECIES_BY_ID, speciesFor, personHue } from './species.js';

const M_PER_DEG_LAT = 111320;
export const BOUND = 'bound', SEARCHING = 'searching', LEAVING = 'leaving';

export class FishSchool {
  constructor(cfg = FISH_CONFIG) {
    this.cfg = cfg;
    this.grid = null;
    this.fish = new Map();
    this.time = 0;
    const g = cfg.ground;
    this.lat0 = (g.latMin + g.latMax) / 2;
    this.lon0 = (g.lonMin + g.lonMax) / 2;
    this.mPerDegLon = M_PER_DEG_LAT * Math.cos((this.lat0 * Math.PI) / 180);
    this.width = (g.lonMax - g.lonMin) * this.mPerDegLon;   // [m]
    this.height = (g.latMax - g.latMin) * M_PER_DEG_LAT;    // [m]
    // Środek łowiska w układzie lokalnym [m]. followBoat() przesuwa go za łódką,
    // więc groundToLocal() zawsze mapuje ludzi na okolicę łódki.
    this.cx = 0;
    this.cy = 0;
    this._seaCache = new Map();
  }

  setGrid(grid) {
    this.grid = grid;
    this._seaCache.clear();
  }

  // --- geometria ----------------------------------------------------------
  toLatLon(x, y) {
    return { lat: this.lat0 + y / M_PER_DEG_LAT, lon: this.lon0 + x / this.mPerDegLon };
  }

  fromLatLon(lat, lon) {
    return { x: (lon - this.lon0) * this.mPerDegLon, y: (lat - this.lat0) * M_PER_DEG_LAT };
  }

  /** Głębokość wody [m] w punkcie lokalnym (0 = ląd). */
  depthAt(x, y) {
    if (!this.grid) return 40;
    const { lat, lon } = this.toLatLon(x, y);
    return this.grid.depthAt(lat, lon);
  }

  isWater(x, y) {
    return this.depthAt(x, y) >= this.cfg.minWaterDepth;
  }

  /** Podłoga z kamery (u,v) -> punkt na łowisku. v=0 (daleko od kamery) = północ.
   *  Łowisko jest zakotwiczone w (cx, cy) — followBoat() przenosi kotwicę za łódką. */
  groundToLocal(u, v) {
    return { x: this.cx + (u - 0.5) * this.width, y: this.cy + (0.5 - v) * this.height };
  }

  /** Kotwica łowiska jako lat/lon (do minimapy i przycisku "Pokaż łowisko"). */
  anchorLatLon() {
    return this.toLatLon(this.cx, this.cy);
  }

  /** Prostokąt łowiska jako lat/lon (do minimapy). */
  boundsLatLon() {
    const sw = this.toLatLon(this.cx - this.width / 2, this.cy - this.height / 2);
    const ne = this.toLatLon(this.cx + this.width / 2, this.cy + this.height / 2);
    return { latMin: sw.lat, latMax: ne.lat, lonMin: sw.lon, lonMax: ne.lon };
  }

  /** Łowisko podąża za łódką: gdy łódka jest daleko od kotwicy i w kadrze nie
   *  ma już żadnej ryby, cała kotwica (i z nią ryby) teleportuje się w okolice
   *  łódki. Dopóki choć jedna ryba jest widoczna, gracz swobodnie pływa między
   *  rybkami bez żadnych skoków. Teleport wchodzi gdy łódka nie płynie w pełnym
   *  biegu (stoi/płynie wolno albo gracz właśnie puścił gaz — wtedy od razu,
   *  bez czekania aż wyhamuje) i nie częściej niż raz na teleportCooldown.
   *  @param bx, by pozycja łódki w metrach lokalnych (z fromLatLon)
   *  @param boatSpeed prędkość łódki [m/s] (ujemna = wstecz)
   *  @param gasReleased true gdy gracz nie trzyma gazu (W/S puszczone)
   *  @param anyVisible true gdy w kadrze jest choć jedna ryba (z poprzedniej klatki)
   *  @returns true gdy nastąpił teleport */
  followBoat(bx, by, boatSpeed = 0, gasReleased = false, anyVisible = false) {
    if (anyVisible) return false;   // widać ryby = pływamy między nimi, nie ruszamy niczyjego kadru
    const radius = this.cfg.followRadius ?? 1200;
    const cooldown = this.cfg.teleportCooldown ?? 1.0;
    const maxBoatSpeed = this.cfg.teleportMaxBoatSpeed ?? 2.0;
    if (Math.abs(boatSpeed) > maxBoatSpeed && !gasReleased) return false;
    if (this.time - (this.lastTeleportAt ?? -Infinity) < cooldown) return false;
    const dx = bx - this.cx, dy = by - this.cy;
    if (Math.hypot(dx, dy) < radius) return false;
    this.lastTeleportAt = this.time;
    this.cx += dx;
    this.cy += dy;
    const scatter = this.cfg.teleportScatter ?? 120;
    for (const f of this.fish.values()) {
      f.x += dx + (Math.random() - 0.5) * scatter;
      f.y += dy + (Math.random() - 0.5) * scatter;
      f.tx += dx;
      f.ty += dy;
      // stara prędkość (pogoń przez kilometry) jest już nieaktualna —
      // wygaszamy ją, żeby nie było skoku Dopplera po teleportacji
      f.vx *= 0.2;
      f.vy *= 0.2;
      f.speed = Math.hypot(f.vx, f.vy);
      const p = this.seaPoint(f.x, f.y);
      f.x = p.x;
      f.y = p.y;
    }
    return true;
  }

  /** Najbliższy punkt wody — cel na lądzie (np. Mierzeja) przesuwamy do morza. */
  seaPoint(x, y) {
    if (this.isWater(x, y)) return { x, y };
    const key = `${Math.round(x / 150)}:${Math.round(y / 150)}`;
    const hit = this._seaCache.get(key);
    if (hit) return hit;
    let found = { x, y };
    outer: for (let r = 150; r < 8000; r += 150) {
      for (let a = 0; a < 16; a++) {
        const px = x + Math.cos((a / 16) * Math.PI * 2) * r;
        const py = y + Math.sin((a / 16) * Math.PI * 2) * r;
        if (this.isWater(px, py)) { found = { x: px, y: py }; break outer; }
      }
    }
    this._seaCache.set(key, found);
    return found;
  }

  // --- krok symulacji -------------------------------------------------------
  /** targets: [{id, u, v, scale, excitement, fresh}] z mostka albo z trybu demo.
   *  dt — krok ruchu (przycięty, jak w fizyce łódki); realDt — prawdziwy czas,
   *  żeby "czekanie na człowieka" i gaśnięcie trwały tyle samo przy 60 i przy 5 fps. */
  update(targets, dt, realDt = dt) {
    dt = Math.min(dt, 0.05);
    realDt = Math.min(Math.max(realDt, 0), 1);
    this.time += realDt;
    const seen = new Set();

    for (const t of targets) {
      seen.add(t.id);
      const p = this.groundToLocal(t.u, t.v);
      const goal = this.seaPoint(p.x, p.y);
      let f = this.fish.get(t.id);
      if (!f) f = this._spawn(t, goal);
      f.tx = goal.x; f.ty = goal.y;
      f.targetExcitement = t.excitement ?? 0;
      f.scale += ((t.scale ?? 1) - f.scale) * Math.min(1, dt * 2);
      if (f.state === LEAVING) f.alpha = Math.max(f.alpha, 0.3); // człowiek wrócił
      f.state = t.fresh === false ? SEARCHING : BOUND;
      f.lost = t.fresh === false ? f.lost + realDt : 0;
    }

    for (const f of this.fish.values()) {
      if (!seen.has(f.id) && f.state !== LEAVING) {
        f.lost += realDt;
        f.state = f.lost > this.cfg.searchGrace ? LEAVING : SEARCHING;
      }
      this._steer(f, dt);
      this._updateDepth(f, dt);
      f.excitement += (f.targetExcitement - f.excitement) * Math.min(1, dt * 2);
      f.tail += dt * (5 + 16 * f.excitement + f.speed / this.cfg.fishSpeed * 6);
      if (f.state === LEAVING) f.alpha -= realDt / this.cfg.leaveTime;
      else f.alpha = Math.min(1, f.alpha + realDt);       // pojawianie się
      if (f.alpha <= 0) this.fish.delete(f.id);
    }
  }

  _spawn(t, goal) {
    const sp = speciesFor(t.id);
    const seabed = this.depthAt(goal.x, goal.y);
    const f = {
      id: t.id, species: sp.id, hue: personHue(t.id),
      x: goal.x, y: goal.y, vx: 0, vy: 0, speed: 0, heading: Math.random() * Math.PI * 2,
      tx: goal.x, ty: goal.y,
      depth: Math.max(1, seabed * (sp.band[0] + sp.band[1]) / 2),
      seabed, scale: t.scale ?? 1, excitement: 0, targetExcitement: 0,
      state: BOUND, alpha: 0, lost: 0, tail: Math.random() * 10,
    };
    this.fish.set(t.id, f);
    return f;
  }

  _steer(f, dt) {
    const cfg = this.cfg;
    const maxSpeed = cfg.fishSpeed * (1 + 1.4 * f.excitement);
    let tx = f.tx, ty = f.ty;
    if (f.state === SEARCHING) {
      // detektor zgubił człowieka: ryba krąży wokół ostatniej pozycji.
      // Promień mały (dziesiątki metrów), żeby opóźnienia w hydrofonie
      // tylko lekko falowały, a nie skakały.
      const r = 45;
      tx += Math.cos(this.time * 0.35 + f.id) * r;
      ty += Math.sin(this.time * 0.35 + f.id) * r;
    } else if (f.state === LEAVING) {
      // odpływa od środka łowiska na zewnątrz
      const d = Math.hypot(f.x - this.cx, f.y - this.cy) || 1;
      tx = f.x + ((f.x - this.cx) / d) * 1500;
      ty = f.y + ((f.y - this.cy) / d) * 1500;
    }

    // dążenie z hamowaniem przy celu (bez drgania wokół punktu)
    let dx = tx - f.x, dy = ty - f.y;
    const dist = Math.hypot(dx, dy);
    let desired = maxSpeed;
    if (dist < 60) desired *= dist / 60;
    let ax = 0, ay = 0;
    if (dist > 1e-3) {
      ax += (dx / dist) * desired - f.vx;
      ay += (dy / dist) * desired - f.vy;
    }
    ax *= 2.5; ay *= 2.5;

    // rozsunięcie: ryby nie nakładają się na siebie (promień w metrach)
    for (const o of this.fish.values()) {
      if (o === f) continue;
      const ox = f.x - o.x, oy = f.y - o.y;
      const d = Math.hypot(ox, oy);
      if (d > 1e-3 && d < 40) {
        ax += (ox / d) * (40 - d) * 0.15;
        ay += (oy / d) * (40 - d) * 0.15;
      }
    }

    // omijanie płycizn: sonda przed rybą, ucieczka w stronę głębszej wody
    const look = Math.max(30, f.speed * 2);
    const hx = f.speed > 0.2 ? f.vx / f.speed : 0, hy = f.speed > 0.2 ? f.vy / f.speed : 0;
    if (f.state !== LEAVING && !this.isWater(f.x + hx * look, f.y + hy * look)) {
      const e = 30;
      const gx = this.depthAt(f.x + e, f.y) - this.depthAt(f.x - e, f.y);
      const gy = this.depthAt(f.x, f.y + e) - this.depthAt(f.x, f.y - e);
      const g = Math.hypot(gx, gy) || 1;
      ax += (gx / g) * cfg.fishAccel * 1.5;
      ay += (gy / g) * cfg.fishAccel * 1.5;
    }

    const a = Math.hypot(ax, ay);
    if (a > cfg.fishAccel) { ax *= cfg.fishAccel / a; ay *= cfg.fishAccel / a; }
    f.vx += ax * dt; f.vy += ay * dt;
    const s = Math.hypot(f.vx, f.vy);
    const cap = f.state === LEAVING ? cfg.fishSpeed * 1.5 : maxSpeed;
    if (s > cap) { f.vx *= cap / s; f.vy *= cap / s; }

    // twarde ograniczenie: nie wchodzimy na ląd (ślizg wzdłuż brzegu)
    const nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
    if (f.state === LEAVING || this.isWater(nx, ny)) { f.x = nx; f.y = ny; }
    else if (this.isWater(nx, f.y)) { f.x = nx; f.vy *= -0.3; }
    else if (this.isWater(f.x, ny)) { f.y = ny; f.vx *= -0.3; }
    else { f.vx *= -0.3; f.vy *= -0.3; }

    f.speed = Math.hypot(f.vx, f.vy);
    if (f.speed > 0.2) {
      const want = Math.atan2(f.vx, f.vy);       // 0 = N, zgodnie z zegarem (jak łódka)
      let diff = want - f.heading;
      diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      f.heading += diff * Math.min(1, dt * 6);
    }
  }

  /** Głębokość: warstwa gatunku × słup wody pod rybą, z powolnym falowaniem.
   *  Pobudzony człowiek (szybki ruch) = ryba wypływa wyżej w swojej warstwie. */
  _updateDepth(f, dt) {
    const sp = SPECIES_BY_ID[f.species];
    const seabed = this.depthAt(f.x, f.y);
    f.seabed = seabed;
    const [lo, hi] = sp.band;
    const mid = (lo + hi) / 2, half = (hi - lo) / 2;
    let frac = mid + 0.55 * half * Math.sin(this.time * 0.17 + f.id * 1.7) - 0.8 * half * f.excitement;
    frac = Math.max(lo, Math.min(hi, frac));
    const target = Math.max(1, Math.min(frac * seabed, seabed - 1));
    // pionowo też realistycznie: ryba zmienia głębokość ~1 m/s, nie nurkuje jak winda
    const step = Math.max(-1.5 * dt, Math.min(1.5 * dt, (target - f.depth) * 1.2 * dt));
    f.depth += step;
    if (seabed > 0) f.depth = Math.max(0.5, Math.min(f.depth, seabed - 0.5));
  }

  /** Stan do renderu i dźwięku (lat/lon + wszystko, co trzeba). */
  list() {
    const out = [];
    for (const f of this.fish.values()) {
      const { lat, lon } = this.toLatLon(f.x, f.y);
      out.push({ ...f, lat, lon });
    }
    return out;
  }
}
