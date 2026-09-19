// Warstwa ryb dla Batymetry Boat: mostek/demo -> symulacja -> render -> panel.
// main.js woła tylko: setGrid(), update(), drawMinimap(), list().
import { FISH_CONFIG } from './config.js';
import { FishLink } from './link.js';
import { DemoPeople } from './demo.js';
import { FishSchool } from './fishSim.js';
import { FishRenderer } from './fishRender.js';
import { hsvToRgb } from './species.js';

export class FishLayer {
  constructor(scene, ui = {}) {
    this.cfg = FISH_CONFIG;
    this.link = new FishLink(this.cfg.bridgeUrl);
    this.demo = new DemoPeople();
    this.demoOn = this.cfg.demo;
    this.school = new FishSchool(this.cfg);
    this.renderer = new FishRenderer(scene);
    this.ui = ui;
    this._lastUi = -1;
    this._list = [];
    this._lastReal = null;

    if (ui.demo) {
      ui.demo.checked = this.demoOn;
      ui.demo.addEventListener('change', () => { this.demoOn = ui.demo.checked; });
    }
    if (ui.labels) {
      ui.labels.addEventListener('change', () => { this.renderer.showLabels = ui.labels.checked; });
    }
  }

  setGrid(grid) {
    this.school.setGrid(grid);
    this.renderer.setGrid(grid);
  }

  /** Źródło celów: tryb demo albo mostek z detekcji. */
  get sourceLabel() {
    if (this.demoOn) return 'demo';
    if (this.link.alive) return 'live';
    return 'offline';
  }

  update(dt, t, { camera, VEX }) {
    const nowMs = performance.now();
    const realDt = this._lastReal === null ? dt : (nowMs - this._lastReal) / 1000;
    this._lastReal = nowMs;
    const targets = this.demoOn ? this.demo.update(realDt) : this.link.current();
    this.school.update(targets, dt, realDt);
    this._list = this.school.list();
    this.renderer.sync(this._list, { camera, VEX, t });
    if (t - this._lastUi > 0.25) { this._lastUi = t; this._updateUi(); }
  }

  list() {
    return this._list;
  }

  /** Środek łowiska w lat/lon (do przycisku "Pokaż łowisko"). */
  groundCenter() {
    return { lat: this.school.lat0, lon: this.school.lon0, widthM: this.school.width, heightM: this.school.height };
  }

  _updateUi() {
    const { status, badge } = this.ui;
    if (!status) return;
    const n = this._list.filter((f) => f.state !== 'leaving').length;
    const leaving = this._list.length - n;
    const extra = leaving ? ` (+${leaving} odpływa)` : '';
    let text, cls;
    if (this.demoOn) {
      text = `Tryb demo: ${n} ryb${extra} (sztuczni ludzie)`;
      cls = 'warn';
    } else if (this.link.alive) {
      const st = this.link.stats || {};
      text = `Detekcja na żywo: ${st.people ?? '?'} osób → ${n} ryb${extra} · ${st.detect_fps ?? '?'} fps · ${this.link.source ?? '?'}`;
      cls = 'ok';
    } else if (!this.link.enabled) {
      text = 'Mostek wyłączony (?fish=off)';
      cls = 'warn';
    } else {
      text = 'Brak połączenia z detekcją — uruchom: cd people_detection && python serve.py';
      cls = 'bad';
    }
    status.textContent = text;
    status.className = `status ${cls}`;
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = String(n);
    }
  }

  drawMinimap(ctx, toXY) {
    const g = this.cfg.ground;
    const [x0, y0] = toXY(g.latMax, g.lonMin);
    const [x1, y1] = toXY(g.latMin, g.lonMax);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x0, y0, Math.max(4, x1 - x0), Math.max(4, y1 - y0));
    ctx.setLineDash([]);
    for (const f of this._list) {
      const [x, y] = toXY(f.lat, f.lon);
      const [r, gg, b] = hsvToRgb(f.hue, 0.8, 1);
      ctx.globalAlpha = Math.max(0.2, Math.min(1, f.alpha));
      ctx.fillStyle = `rgb(${r * 255},${gg * 255},${b * 255})`;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
