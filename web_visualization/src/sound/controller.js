// Dźwięk w grze: hydrofon opuszczony z łódki słucha ryb i morza.
// Łączy SeaSoundEngine z panelem, klawiszami Q/E i widokiem liny w 3D.
import * as THREE from 'three';
import { SeaSoundEngine } from './engine.js';
import { BALTIC_SUMMER } from './acoustics.js';

const M_PER_DEG_LAT = 111320;
const LIFE_NAMES = { meduza: 'meduzy', morswin: 'morświny', foka: 'foki', babka: 'babki', lawica: 'ławice', plankton: 'plankton' };

export class SoundController {
  constructor(scene, ui = {}) {
    this.engine = new SeaSoundEngine();
    this.ui = ui;
    this.wantedDepth = 10;       // [m] ustawienie suwaka
    this.depth = 10;             // [m] faktyczne (nie głębiej niż dno - 1 m)
    this._lastUi = -1;
    this._buildVisual(scene);
    this._bindUi();
  }

  _buildVisual(scene) {
    const cableGeo = new THREE.BufferGeometry();
    cableGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.cable = new THREE.Line(cableGeo, new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9 }));
    this.cable.frustumCulled = false;
    this.probe = new THREE.Mesh(
      new THREE.SphereGeometry(1, 16, 12),
      new THREE.MeshPhongMaterial({ color: 0xffd34d, emissive: 0x806010 }),
    );
    scene.add(this.cable, this.probe);
  }

  _bindUi() {
    const { toggle, depth, seaState, life } = this.ui;
    toggle?.addEventListener('click', () => this.toggle());
    life?.addEventListener('input', () => this.engine.setParams({ life: +life.value }));
    depth?.addEventListener('input', () => { this.wantedDepth = parseFloat(depth.value); });
    seaState?.addEventListener('input', () => this.engine.setParams({ seaState: parseInt(seaState.value, 10) }));
    if (depth) this.wantedDepth = parseFloat(depth.value);
    if (seaState) this.engine.setParams({ seaState: parseInt(seaState.value, 10) });
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyQ') this.nudge(-2);
      if (e.code === 'KeyE') this.nudge(2);
    });
  }

  nudge(dm) {
    this.wantedDepth = Math.max(0, Math.min(120, this.depth + dm));
    if (this.ui.depth) this.ui.depth.value = String(this.wantedDepth);
  }

  async toggle() {
    // AudioContext wolno uruchomić dopiero po kliknięciu (polityka przeglądarek)
    if (this.engine.running) await this.engine.stop();
    else await this.engine.start();
    if (this.ui.toggle) this.ui.toggle.textContent = this.engine.running ? '🔇 Wycisz' : '🔊 Włącz dźwięk';
  }

  /** @param state stan łódki z main.js; fish FishLayer.list(); grid BathymetryGrid */
  update(dt, t, { state, grid, fish, life = [], music = null, VEX, camera, boatY = 0 }) {
    if (!grid) return;
    const seabed = grid.depthAt(state.lat, state.lon);
    this.depth = Math.max(0.3, Math.min(this.wantedDepth, seabed - 1));

    // lina + sonda w 3D
    const { x, z } = grid.latLonToWorld(state.lat, state.lon);
    const y = -this.depth * VEX;
    const pos = this.cable.geometry.attributes.position;
    pos.setXYZ(0, x, boatY + 2, z);
    pos.setXYZ(1, x, y, z);
    pos.needsUpdate = true;
    this.probe.position.set(x, y, z);
    this.probe.scale.setScalar(Math.max(1.2, camera.position.distanceTo(this.probe.position) * 0.006));

    if (this.engine.running) {
      // Wszystko w metrach względem łódki: x = wschód, y = północ.
      const mPerDegLon = M_PER_DEG_LAT * Math.cos((state.lat * Math.PI) / 180);
      const env = {
        profile: BALTIC_SUMMER,
        depthAt: (px, py) => grid.depthAt(state.lat + py / M_PER_DEG_LAT, state.lon + px / mPerDegLon),
      };
      const toLocal = (o) => ({ ...o, x: (o.lon - state.lon) * mPerDegLon, y: (o.lat - state.lat) * M_PER_DEG_LAT });
      const local = fish.map(toLocal);
      this.engine.update({
        listener: {
          x: 0, y: 0, depth: this.depth, seabed,
          heading: state.heading, speed: state.speed, throttle: state.throttle,
        },
        fish: local,
        life: life.map(toLocal),
        music: music ? toLocal(music) : null,
        env,
      });
    }
    if (t - this._lastUi > 0.25) { this._lastUi = t; this._updateUi(); }
  }

  _updateUi() {
    const { depthVal, info, badge } = this.ui;
    if (depthVal) depthVal.textContent = this.depth.toFixed(1);
    if (badge) {
      badge.style.display = 'inline-block';
      badge.textContent = this.engine.running ? 'gra' : 'wył.';
    }
    if (!info) return;
    if (!this.engine.running) {
      info.textContent = 'Dźwięk wyłączony. Przeglądarka pozwala go włączyć dopiero po kliknięciu.';
      return;
    }
    const i = this.engine.info;
    const l = i.listener;
    if (!l) return;
    const voiced = i.fish.filter((r) => r.voiced);
    const top = voiced[0];
    const rv = i.reverb;
    const echo = voiced.flatMap((r) => r.echoes.map((e) => ({ ...e, id: r.id }))).sort((a, b) => b.gainDb - a.gainDb)[0];
    const blocked = i.fish.filter((r) => r.landBlocked).length;
    info.innerHTML = [
      `Skala: <strong>${i.mode?.name ?? '—'}</strong> (${i.mode?.mood ?? ''})`,
      `Woda przy hydrofonie: ${l.temperature.toFixed(1)}°C, ${l.salinity.toFixed(1)} PSU, c = ${l.c.toFixed(0)} m/s`,
      `Pogłos: ${rv ? rv.t60.toFixed(1) : '—'} s · trzepotanie co ${rv ? (rv.flutterPeriod * 1000).toFixed(0) : '—'} ms · ściany w zasięgu: ${i.reflectors}`,
      `Brzmi ryb: ${voiced.length}/${i.fish.length}${blocked ? ` · za lądem: ${blocked}` : ''} · morze: ${i.sea.name}`,
      top ? `Najgłośniej: #${top.id} ${top.species} ${top.note} (${top.hz.toFixed(0)} Hz, ${top.depth.toFixed(0)} m), `
        + `${(top.dist / 1000).toFixed(2)} km, ${(top.delay * 1000).toFixed(0)} ms, Doppler ${(top.doppler * 100).toFixed(1)} %` : 'Brak ryb w zasięgu.',
      `Tło (zdarzeń / 10 s): ${Object.entries(i.life || {}).map(([k, n]) => `${LIFE_NAMES[k] ?? k} ${n}`).join(' · ') || '—'}`,
      echo ? `Echo od terenu: #${echo.id} od ${echo.label}u ${(echo.range / 1000).toFixed(1)} km, po ${(echo.delay).toFixed(2)} s` : 'Echo od terenu: brak (brak ścian w zasięgu)',
    ].join('<br>');
  }
}
