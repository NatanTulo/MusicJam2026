// Panel DJ: podwodny głośnik, który puszcza muzykę z wybranego miejsca w morzu.
// Statek słyszy ją hydrofonem przez ten sam model wody co ryby: opóźnienie,
// odbicia, echa od terenu, pogłos, odcięcie basu w płytkiej wodzie, Doppler przy ruchu łódki.
// Suwak "na lądzie ↔ na statku" porównuje oryginał z tym, co dociera pod wodą.
import * as THREE from 'three';
import { makeDemoTrack, DEMO_TRACK_NAME } from './demoTrack.js';
import { FISH_CONFIG } from '../fish/config.js';

const M = 111320;

function labelSprite(text) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(4,14,24,0.9)'; ctx.strokeText(text, 128, 32);
  ctx.fillStyle = '#ffb15c'; ctx.fillText(text, 128, 32);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.renderOrder = 17;
  return sp;
}

export class DjPanel {
  constructor(scene, ui, sound) {
    this.ui = ui;
    this.sound = sound;
    this.grid = null;
    this.pos = null;             // {lat, lon} głośnika
    this.wantedDepth = 8;
    this.depth = 8;
    this.powerDb = 20;           // moc głośnika względem głosu ryby
    this.mix = 1;                // 0 = na lądzie (oryginał), 1 = na statku
    this.playing = false;
    this.pickMode = false;
    this.trackName = null;
    this._buildVisual(scene);
    this._bind();
  }

  _buildVisual(scene) {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14),
      new THREE.MeshPhongMaterial({ color: 0xff9d4d, emissive: 0x9a4a10 }));
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    this.line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0xff9d4d, transparent: true, opacity: 0.8 }));
    this.line.frustumCulled = false;
    const ringGeo = new THREE.RingGeometry(0.75, 1, 40); ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xff9d4d, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.label = labelSprite('🔊 DJ');
    this.group.add(this.ball, this.line, this.ring, this.label);
    scene.add(this.group);
  }

  _bind() {
    const u = this.ui;
    u.toggle?.addEventListener('click', () => { u.panel.hidden = !u.panel.hidden; });
    u.demo?.addEventListener('click', () => this.loadDemo());
    u.file?.addEventListener('change', () => u.file.files[0] && this.loadFile(u.file.files[0]));
    u.play?.addEventListener('click', () => this.play());
    u.stop?.addEventListener('click', () => this.stop());
    u.ahead?.addEventListener('click', () => this.placeAhead());
    u.ground?.addEventListener('click', () => { const g = FISH_CONFIG.ground; this.placeAt((g.latMin + g.latMax) / 2, (g.lonMin + g.lonMax) / 2); });
    u.hel?.addEventListener('click', () => this.placeAt(54.62, 18.84));
    u.pick?.addEventListener('click', () => { this.pickMode = !this.pickMode; u.pick.classList.toggle('on', this.pickMode); });
    u.depth?.addEventListener('input', () => { this.wantedDepth = +u.depth.value; });
    u.power?.addEventListener('input', () => { this.powerDb = +u.power.value; u.powerVal.textContent = `+${this.powerDb} dB`; });
    u.mix?.addEventListener('input', () => { this.mix = +u.mix.value; });
  }

  setGrid(grid) {
    this.grid = grid;
  }

  async _engine() {
    const e = this.sound.engine;
    if (!e.running) await this.sound.toggle();
    return e;
  }

  async loadDemo() {
    const e = await this._engine();
    e.setMusicBuffer(makeDemoTrack(e.ctx));
    this.trackName = DEMO_TRACK_NAME;
    this._afterLoad();
  }

  async loadFile(file) {
    const e = await this._engine();
    try {
      const buf = await e.ctx.decodeAudioData(await file.arrayBuffer());
      e.setMusicBuffer(buf);
      this.trackName = file.name;
      this._afterLoad();
    } catch (err) {
      this.ui.track.textContent = `Nie da się odczytać pliku: ${err.message}`;
    }
  }

  _afterLoad() {
    this.ui.track.textContent = `♪ ${this.trackName}`;
    if (!this.pos) this.placeAhead();
    this.play();
  }

  async play() {
    const e = await this._engine();
    if (!e.musicBuffer) { await this.loadDemo(); return; }
    if (!this.pos) this.placeAhead();
    this.playing = true;
  }

  stop() {
    this.playing = false;
  }

  /** Głośnik 1 km przed dziobem łódki. */
  placeAhead(state = this._state) {
    if (!state) return;
    const d = 1000, mLon = M * Math.cos((state.lat * Math.PI) / 180);
    this.placeAt(state.lat + (Math.cos(state.heading) * d) / M, state.lon + (Math.sin(state.heading) * d) / mLon);
  }

  /** Stawia głośnik; na lądzie — przesuwa do najbliższej wody (>= 3 m). */
  placeAt(lat, lon) {
    this.pickMode = false;
    this.ui.pick?.classList.remove('on');
    if (this.grid && this.grid.depthAt(lat, lon) < 3) {
      outer: for (let r = 100; r < 20000; r += 100) {
        for (let a = 0; a < 24; a++) {
          const la = lat + (Math.cos((a / 24) * 2 * Math.PI) * r) / M;
          const lo = lon + (Math.sin((a / 24) * 2 * Math.PI) * r) / (M * Math.cos((lat * Math.PI) / 180));
          if (this.grid.depthAt(la, lo) >= 3) { lat = la; lon = lo; break outer; }
        }
      }
    }
    this.pos = { lat, lon };
    this.moveId = (this.moveId ?? 0) + 1;   // silnik przeskakuje do nowych opóźnień zamiast "dojeżdżać"
  }

  /** Źródło dla silnika (w metrach względem łódki robi to SoundController). */
  source() {
    if (!this.pos) return null;
    return {
      lat: this.pos.lat, lon: this.pos.lon, depth: this.depth, playing: this.playing,
      level: 0.03 * 10 ** (this.powerDb / 20), mix: this.mix, moveId: this.moveId,
    };
  }

  update(dt, t, { state, grid, VEX, camera }) {
    this._state = state;
    if (!grid) return;
    this.group.visible = !!this.pos;
    if (this.pos) {
      const seabed = grid.depthAt(this.pos.lat, this.pos.lon);
      this.depth = Math.max(0.5, Math.min(this.wantedDepth, seabed - 0.5));
      const { x, z } = grid.latLonToWorld(this.pos.lat, this.pos.lon);
      const y = -this.depth * VEX;
      const dist = camera.position.distanceTo(new THREE.Vector3(x, y, z));
      const s = Math.min(3000, Math.max(12, dist * 0.02));
      this.ball.position.set(x, y, z);
      this.ball.scale.setScalar(s * (this.playing ? 1 + 0.15 * Math.sin(t * 12.6) : 1));   // pulsuje w rytmie
      const pos = this.line.geometry.attributes.position;
      pos.setXYZ(0, x, 1, z); pos.setXYZ(1, x, y, z); pos.needsUpdate = true;
      this.ring.position.set(x, 1.3, z);
      this.ring.scale.setScalar(s * 1.6);
      const w = Math.max(50, camera.position.distanceTo(this.ring.position) * 0.07);
      this.label.scale.set(w, w / 4, 1);
      this.label.position.set(x, s * 2 + w * 0.2, z);
    }
    if (t - (this._lastUi ?? -1) > 0.25) { this._lastUi = t; this._ui(); }
  }

  _ui() {
    const u = this.ui;
    if (u.depthVal) u.depthVal.textContent = this.depth.toFixed(1);
    if (u.mixVal) u.mixVal.textContent = this.mix < 0.05 ? 'na lądzie' : this.mix > 0.95 ? 'na statku' : `${Math.round(this.mix * 100)} % statek`;
    if (!u.info) return;
    const mi = this.sound.engine.info?.music;
    if (!this.pos) { u.info.textContent = 'Postaw głośnik na mapie i kliknij „Graj”.'; return; }
    if (!this.playing || !mi) { u.info.textContent = this.playing ? 'Uruchamianie…' : 'Zatrzymane.'; return; }
    const e = mi.echoes[0];
    u.info.innerHTML = [
      `Odległość: <b>${(mi.dist / 1000).toFixed(2)} km</b>, dźwięk idzie <b>${(mi.delay).toFixed(2)} s</b>`
        + (mi.tooFar ? ' — <b>za daleko</b> (maks. ~29 km)' : ''),
      mi.landBlocked ? '<b>Ląd na drodze — nic nie dociera</b>'
        : `Bas ucięty poniżej <b>${Number.isFinite(mi.cutoffHz) ? mi.cutoffHz.toFixed(0) : '∞'} Hz</b> (płytka woda)`,
      `Odbicia: ${mi.taps} drogi, rozmycie ${mi.spreadMs.toFixed(0)} ms`,
      e ? `Echo od ${e.label}u: po ${e.delay.toFixed(2)} s` : 'Echo od terenu: brak ścian w zasięgu',
      `Doppler: ${(mi.doppler * 100).toFixed(2)} % · poziom ${mi.levelDb.toFixed(0)} dB`,
    ].join('<br>');
  }

  drawMinimap(ctx, toXY) {
    if (!this.pos) return;
    const [x, y] = toXY(this.pos.lat, this.pos.lon);
    ctx.save();
    ctx.fillStyle = '#ff9d4d';
    ctx.strokeStyle = '#1a0d04';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
}
