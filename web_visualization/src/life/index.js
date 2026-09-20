// Warstwa "mieszkańcy morza" dla Batymetry Boat: symulacja + kropki + lista źródeł dźwięku.
import { LifeSim, KINDS } from './creatures.js';
import { LifeRenderer } from './lifeRender.js';

export { KINDS };

export class LifeLayer {
  constructor(scene, ui = {}) {
    this.sim = new LifeSim();
    this.render = new LifeRenderer(scene);
    this.ui = ui;
    this.enabled = ui.toggle ? ui.toggle.checked : true;
    this.grid = null;
    this._lastReal = null;
    ui.toggle?.addEventListener('change', () => { this.enabled = ui.toggle.checked; });
  }

  setGrid(grid) {
    this.grid = grid;
    this.sim.setGrid(grid);
  }

  update(dt, t, { VEX, state }) {
    this.render.visible = this.enabled;
    if (!this.enabled || !this.grid) return;
    const nowMs = performance.now();
    const realDt = this._lastReal === null ? dt : (nowMs - this._lastReal) / 1000;
    this._lastReal = nowMs;
    this.sim.update(realDt, { lat: state.lat, lon: state.lon });
    this.render.sync(this.sim.items, this.grid, VEX);
    if (this.ui.count && Math.floor(t * 2) !== this._lastCount) {
      this._lastCount = Math.floor(t * 2);
      const by = {};
      for (const it of this.sim.items) by[it.kind] = (by[it.kind] || 0) + 1;
      this.ui.count.textContent = Object.entries(by).map(([k, n]) => `${KINDS[k].name.split(' ')[0]} ${n}`).join(' · ');
    }
  }

  /** Źródła dźwięku (lat/lon) — puste, gdy warstwa wyłączona. */
  emitters() {
    return this.enabled ? this.sim.emitters() : [];
  }
}
