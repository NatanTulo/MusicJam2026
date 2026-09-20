// Mieszkańcy morza: tło życia i tło muzyczne. Zawsze pływają wokół łódki
// (w promieniu ~4,5 km), więc morze nigdy nie jest puste, gdziekolwiek płyniesz.
// Każdy gatunek ma swoje siedlisko, sposób ruchu i swoją rolę w muzyce (sound/life.js).
// Bez Three.js — renderer tylko czyta pozycje.

const M = 111320;
const rand = (a, b) => a + Math.random() * (b - a);

export const KINDS = {
  meduza: {
    name: 'meduza (chełbia modra)', role: 'harmonia — długie, miękkie plamy dźwięku',
    count: 26, color: 0xcdb8ff, px: 3.5, opacity: 0.55,
    band: [0.15, 0.6], speed: 0.8,           // dryfuje z prądem
  },
  morswin: {
    name: 'morświn', role: 'rytm — serie kliknięć (echolokacja)',
    pods: 2, podSize: 3, color: 0xb3c2cf, px: 5, opacity: 0.8,
    band: [0.05, 0.45], speed: 24, minDepth: 10,
  },
  foka: {
    name: 'foka szara', role: 'melodia — przeciągłe zawodzenie',
    count: 4, color: 0x9b8b78, px: 5.5, opacity: 0.8,
    band: [0.0, 0.4], speed: 14, minDepth: 5,
  },
  babka: {
    name: 'babka bycza', role: 'perkusja — stuki przy dnie',
    count: 22, color: 0xe6c46e, px: 3, opacity: 0.75,
    onBottom: true, minDepth: 4, maxDepth: 38, speed: 0.6,
  },
  lawica: {
    name: 'ławica szprota', role: 'migotanie — jasne, szybkie arpeggia',
    schools: 2, members: 28, color: 0xd6ecff, px: 2.5, opacity: 0.7,
    band: [0.2, 0.5], speed: 10, minDepth: 8,
  },
  plankton: {
    name: 'plankton', role: 'faktura — ciche iskierki blisko hydrofonu',
    count: 150, color: 0x7fffd4, px: 2, opacity: 0.4,
    band: [0.05, 0.95], speed: 0.25,
  },
};

export class LifeSim {
  constructor({ radius = 4500, despawn = 6500 } = {}) {
    this.radius = radius;
    this.despawn = despawn;
    this.grid = null;
    this.items = [];          // wszystkie osobniki
    this.time = 0;
    this.current = { x: 0.25, y: 0.15 };   // słaby prąd [m/s] — dryf meduz i planktonu
    this._id = 1;
    this.boat = null;
  }

  setGrid(grid) {
    this.grid = grid;
    this.items = [];          // nowa mapa = nowe siedliska
  }

  depthAt(lat, lon) {
    return this.grid ? this.grid.depthAt(lat, lon) : 0;
  }

  _ok(kind, lat, lon) {
    const d = this.depthAt(lat, lon);
    const k = KINDS[kind];
    if (d < (k.minDepth ?? 3)) return false;
    if (k.maxDepth && d > k.maxDepth) return false;
    return true;
  }

  _randomPoint(kind, near = null, spread = null) {
    const b = this.boat;
    for (let i = 0; i < 25; i++) {
      const r = spread ?? this.radius * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      const c = near ?? b;
      const lat = c.lat + (Math.cos(a) * r) / M;
      const lon = c.lon + (Math.sin(a) * r) / (M * Math.cos((c.lat * Math.PI) / 180));
      if (this._ok(kind, lat, lon)) return { lat, lon };
    }
    return null;
  }

  _spawn(kind, extra = {}) {
    const p = this._randomPoint(kind);
    if (!p) return null;
    const k = KINDS[kind];
    const seabed = this.depthAt(p.lat, p.lon);
    const frac = k.onBottom ? 1 : rand(k.band[0], k.band[1]);
    const it = {
      id: this._id++, kind, lat: p.lat, lon: p.lon,
      depth: k.onBottom ? Math.max(0.5, seabed - 0.3) : Math.max(0.5, frac * seabed),
      frac, seabed, heading: Math.random() * Math.PI * 2, phase: Math.random() * 10,
      speed: k.speed * rand(0.7, 1.3), ...extra,
    };
    this.items.push(it);
    return it;
  }

  _populate() {
    for (const [kind, k] of Object.entries(KINDS)) {
      if (k.pods) {
        for (let p = 0; p < k.pods; p++) {
          const lead = this._spawn(kind, { leader: true });
          if (!lead) continue;
          lead.group = lead.id;
          for (let m = 1; m < k.podSize; m++) {
            this.items.push({ ...lead, id: this._id++, leader: false, group: lead.id, off: { x: rand(-60, 60), y: rand(-60, 60) } });
          }
        }
      } else if (k.schools) {
        for (let s = 0; s < k.schools; s++) {
          const c = this._spawn(kind, { leader: true, emitter: true });
          if (!c) continue;
          c.group = c.id;
          for (let m = 1; m < k.members; m++) {
            this.items.push({ ...c, id: this._id++, leader: false, emitter: false, group: c.id,
              off: { x: rand(-120, 120), y: rand(-60, 60), z: rand(-3, 3) }, spin: rand(0.2, 0.6) });
          }
        }
      } else {
        for (let i = 0; i < k.count; i++) this._spawn(kind);
      }
    }
  }

  /** Gatunki, których brakuje (np. babki — żyją tylko na płyciźnie), dosiewamy co kilka
   *  sekund: gdy łódka wpłynie na płytką wodę, pojawią się same. */
  _topUp() {
    for (const [kind, k] of Object.entries(KINDS)) {
      if (k.pods || k.schools) continue;
      const have = this.items.filter((it) => it.kind === kind).length;
      for (let i = have; i < k.count; i++) if (!this._spawn(kind)) break;
    }
  }

  /** @param boat {lat, lon} — wokół niej żyją stworzenia */
  update(dt, boat) {
    if (!this.grid) return;
    dt = Math.min(Math.max(dt, 0), 0.5);
    this.time += dt;
    this.boat = boat;
    if (!this.items.length) this._populate();
    if (Math.floor(this.time / 4) !== this._lastTopUp) { this._lastTopUp = Math.floor(this.time / 4); this._topUp(); }
    const leaders = new Map();

    for (const it of this.items) {
      const k = KINDS[it.kind];
      if (it.group && !it.leader) continue;          // członkowie grup po liderach
      const mLon = M * Math.cos((it.lat * Math.PI) / 180);
      // za daleko od łódki (łódka odpłynęła) -> nowe miejsce w pobliżu
      const dx = (it.lon - boat.lon) * mLon, dy = (it.lat - boat.lat) * M;
      if (Math.hypot(dx, dy) > this.despawn || !this._ok(it.kind, it.lat, it.lon)) {
        const p = this._randomPoint(it.kind);
        if (p) { it.lat = p.lat; it.lon = p.lon; }
        else if (!it.group) { it.dead = true; continue; }   // brak siedliska w pobliżu (np. babka nad głębią)
      }

      // ruch: błądzenie + prąd; przed płycizną zawracamy
      it.heading += rand(-0.6, 0.6) * dt;
      let vx = Math.sin(it.heading) * it.speed, vy = Math.cos(it.heading) * it.speed;
      if (it.kind === 'meduza' || it.kind === 'plankton') { vx += this.current.x; vy += this.current.y; }
      if (it.kind === 'babka') {
        // siedzi przy dnie i co jakiś czas przeskakuje kawałek
        if (Math.random() < dt * 0.15) it.hop = 1.5;
        const go = it.hop > 0 ? 25 : 0;
        it.hop = Math.max(0, (it.hop || 0) - dt);
        vx = Math.sin(it.heading) * go; vy = Math.cos(it.heading) * go;
      }
      const look = Math.max(80, it.speed * 4);
      const ahead = { lat: it.lat + ((vy / (it.speed || 1)) * look) / M, lon: it.lon + ((vx / (it.speed || 1)) * look) / mLon };
      if (!this._ok(it.kind, ahead.lat, ahead.lon)) { it.heading += Math.PI * rand(0.6, 1.4); continue; }
      it.lat += (vy * dt) / M;
      it.lon += (vx * dt) / mLon;

      // głębokość: warstwa gatunku w słupie wody pod stworzeniem
      it.seabed = this.depthAt(it.lat, it.lon);
      let target;
      if (k.onBottom) target = it.seabed - 0.3;
      else {
        target = it.frac * it.seabed + Math.sin(this.time * 0.2 + it.phase) * 2;
        // morświny i foki co jakiś czas wynurzają się po powietrze
        if ((it.kind === 'morswin' || it.kind === 'foka') && Math.sin(this.time * 0.09 + it.phase) > 0.93) target = 0.5;
      }
      target = Math.max(0.4, Math.min(target, it.seabed - 0.3));
      it.depth += Math.max(-6 * dt, Math.min(6 * dt, target - it.depth));
      if (it.leader) leaders.set(it.group, it);
    }

    if (this.items.some((it) => it.dead)) this.items = this.items.filter((it) => !it.dead);

    // członkowie stad i ławic trzymają się lidera
    for (const it of this.items) {
      if (!it.group || it.leader) continue;
      const L = leaders.get(it.group);
      if (!L) continue;
      const mLon = M * Math.cos((L.lat * Math.PI) / 180);
      let ox = it.off.x, oy = it.off.y;
      if (it.spin) {   // ławica się kłębi
        const a = this.time * it.spin + it.phase;
        ox = it.off.x * Math.cos(a) - it.off.y * Math.sin(a);
        oy = it.off.x * Math.sin(a) + it.off.y * Math.cos(a);
      }
      it.lat = L.lat + oy / M;
      it.lon = L.lon + ox / mLon;
      it.seabed = this.depthAt(it.lat, it.lon);
      it.depth = Math.max(0.4, Math.min(L.depth + (it.off.z ?? 0), it.seabed - 0.3));
    }
  }

  /** Źródła dźwięku: osobniki, a dla stad/ławic — lider (jedno źródło na grupę). */
  emitters() {
    return this.items.filter((it) => !it.group || it.leader);
  }
}
