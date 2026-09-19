// Ryby w scenie Three.js. Tylko wygląd — stan przychodzi z FishSchool.list().
//
// Czytelność na mapie o skali kilometrów:
//  * rozmiar ekranowy prawie stały (jak pinezka łódki) — prawdziwa ryba byłaby podpikselowa,
//  * pionowa linia od powierzchni do ryby + kółko na tafli: widać, gdzie jest i jak głęboko,
//  * świecenie (emissive), bo pod półprzezroczystą wodą kolory gasną.
import * as THREE from 'three';
import { SPECIES_BY_ID, hsvToRgb } from './species.js';

function makeTailGeometry() {
  // widelec płetwy ogonowej w płaszczyźnie poziomej (czytelny z góry), nasada w (0,0,0)
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-0.26, 0.34);
  s.lineTo(0, 0.2);
  s.lineTo(0.26, 0.34);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2); // kształt z XY do XZ; "w górę" kształtu = +Z = do tyłu ryby
  return g;
}

function makeFinGeometry(side) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(side * 0.3, 0.16);
  s.lineTo(0, 0.14);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return g;
}

const GEO = {
  body: (() => { const g = new THREE.SphereGeometry(0.5, 20, 12); g.scale(0.34, 0.3, 1); return g; })(),
  tail: makeTailGeometry(),
  finL: makeFinGeometry(-1),
  finR: makeFinGeometry(1),
  eye: new THREE.SphereGeometry(0.045, 8, 6),
  ring: (() => { const g = new THREE.RingGeometry(0.78, 1, 40); g.rotateX(-Math.PI / 2); return g; })(),
};
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x0a1016 });

function labelTexture(text, color) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 96;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 44px system-ui, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 9;
  ctx.strokeStyle = 'rgba(4,14,24,0.9)';
  ctx.strokeText(text, 256, 48);
  ctx.fillStyle = color;
  ctx.fillText(text, 256, 48);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class FishRenderer {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'fish';
    scene.add(this.root);
    this.meshes = new Map();
    this.grid = null;
    this.showLabels = true;
  }

  setGrid(grid) {
    this.grid = grid;
  }

  _create(f) {
    const [r, g, b] = hsvToRgb(f.hue, 0.8, 1.0);
    const color = new THREE.Color(r, g, b);
    const css = `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`;
    const mat = new THREE.MeshPhongMaterial({
      color, emissive: color.clone().multiplyScalar(0.45), shininess: 70,
      transparent: true, side: THREE.DoubleSide,
    });

    const fish = new THREE.Group();
    const body = new THREE.Mesh(GEO.body, mat);
    fish.add(body);
    const tailPivot = new THREE.Group();
    tailPivot.position.z = 0.44;
    tailPivot.add(new THREE.Mesh(GEO.tail, mat));
    fish.add(tailPivot);
    const finL = new THREE.Mesh(GEO.finL, mat); finL.position.set(-0.12, -0.02, -0.12);
    const finR = new THREE.Mesh(GEO.finR, mat); finR.position.set(0.12, -0.02, -0.12);
    fish.add(finL, finR);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(GEO.eye, EYE_MAT);
      eye.position.set(side * 0.1, 0.08, -0.36);
      fish.add(eye);
    }

    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(lineGeo, lineMat);
    line.frustumCulled = false;

    const ring = new THREE.Mesh(GEO.ring, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.renderOrder = 4;

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    label.renderOrder = 16;

    this.root.add(fish, line, ring, label);
    const m = { fish, tailPivot, mat, line, ring, label, css, text: '' };
    this.meshes.set(f.id, m);
    return m;
  }

  _remove(id) {
    const m = this.meshes.get(id);
    if (!m) return;
    this.root.remove(m.fish, m.line, m.ring, m.label);
    m.mat.dispose();
    m.line.geometry.dispose(); m.line.material.dispose();
    m.ring.material.dispose();
    m.label.material.map?.dispose(); m.label.material.dispose();
    this.meshes.delete(id);
  }

  /** @param list  FishSchool.list()  @param ctx {camera, VEX, t} */
  sync(list, { camera, VEX, t }) {
    if (!this.grid) return;
    const alive = new Set();
    for (const f of list) {
      alive.add(f.id);
      const m = this.meshes.get(f.id) || this._create(f);
      // Pozycje na sferze (ENU środka siatki): ryba pod wodą, znaczniki na tafli.
      // h = wysokość nad poziomem morza; ryba: -depth*VEX, tafla: 0.
      const p = this.grid.latLonToWorld(f.lat, f.lon, -f.depth * VEX);
      const ps = this.grid.latLonToWorld(f.lat, f.lon, 0);
      const n = this.grid.normalAt(f.lat, f.lon);
      const sp = SPECIES_BY_ID[f.species];

      m.fish.position.set(p.x, p.y, p.z);
      m.fish.rotation.set(0, -f.heading, 0);
      const camDist = camera.position.distanceTo(m.fish.position);
      const s = Math.min(3500, Math.max(16, camDist * 0.03)) * sp.size * (0.85 + 0.3 * f.scale);
      m.fish.scale.setScalar(s);
      m.tailPivot.rotation.y = Math.sin(f.tail) * (0.35 + 0.3 * f.excitement);
      const a = Math.max(0, Math.min(1, f.alpha));
      m.mat.opacity = a;
      // "szukam człowieka" = miganie
      m.mat.emissiveIntensity = f.state === 'searching' ? 0.5 + 0.5 * Math.sin(t * 8) : 1;

      const pos = m.line.geometry.attributes.position;
      pos.setXYZ(0, ps.x + n.x, ps.y + n.y, ps.z + n.z);
      pos.setXYZ(1, p.x, p.y, p.z);
      pos.needsUpdate = true;
      m.line.material.opacity = 0.6 * a;

      m.ring.position.set(ps.x + n.x * 1.2, ps.y + n.y * 1.2, ps.z + n.z * 1.2);
      m.ring.scale.setScalar(s * 0.55);
      m.ring.material.opacity = 0.75 * a;

      m.label.visible = this.showLabels && a > 0.05;
      if (m.label.visible) {
        const text = `#${f.id} ${sp.name} · ${Math.round(f.depth)} m`;
        if (text !== m.text) {   // tekstura tylko przy zmianie napisu, nie co klatkę
          m.label.material.map?.dispose();
          m.label.material.map = labelTexture(text, m.css);
          m.label.material.needsUpdate = true;
          m.text = text;
        }
        const surfDist = camera.position.distanceTo(m.ring.position);
        const w = Math.max(50, surfDist * 0.085);
        m.label.scale.set(w, w * 0.1875, 1);
        m.label.position.set(
          ps.x + n.x * (s * 0.4 + w * 0.16),
          ps.y + n.y * (s * 0.4 + w * 0.16),
          ps.z + n.z * (s * 0.4 + w * 0.16),
        );
        m.label.material.opacity = a;
      }
    }
    for (const id of [...this.meshes.keys()]) if (!alive.has(id)) this._remove(id);
  }
}
