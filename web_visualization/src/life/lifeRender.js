// Stworzenia jako maleńkie kropki (stały rozmiar w pikselach, bez etykiet):
// mają być ledwo widoczne — tylko żeby morze nie było puste.
// Kropka, której stworzenie właśnie się odzywa, rozbłyska (kolor × jasność).
import * as THREE from 'three';
import { KINDS } from './creatures.js';

const MAX_PER_KIND = 400;

function dotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(cv);
}

export class LifeRenderer {
  constructor(scene) {
    this.root = new THREE.Group();
    this.root.name = 'life';
    scene.add(this.root);
    const tex = dotTexture();
    this.layers = {};
    this.halo = {};
    this.baseColors = {};
    for (const [kind, k] of Object.entries(KINDS)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * MAX_PER_KIND), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * MAX_PER_KIND), 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({
        color: 0xffffff, size: k.px, sizeAttenuation: false, map: tex, vertexColors: true,
        transparent: true, opacity: k.opacity, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 1;     // przed taflą wody (2), żeby prześwitywały spod niej
      this.root.add(pts);
      this.layers[kind] = pts;
      // poświata grających: większe kropki, dodawanie światła (widoczne z daleka)
      const hgeo = new THREE.BufferGeometry();
      hgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * MAX_PER_KIND), 3));
      hgeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * MAX_PER_KIND), 3));
      hgeo.setDrawRange(0, 0);
      const hmat = new THREE.PointsMaterial({
        color: 0xffffff, size: k.px * 3.5, sizeAttenuation: false, map: tex, vertexColors: true,
        transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const hpts = new THREE.Points(hgeo, hmat);
      hpts.frustumCulled = false;
      hpts.renderOrder = 3;    // po tafli wody — poświata ma świecić, nie tonąć
      this.root.add(hpts);
      this.halo[kind] = hpts;
      this.baseColors[kind] = new THREE.Color(k.color);
    }
  }

  set visible(v) {
    this.root.visible = v;
  }

  /** @param lifeSound LifeSound albo null; całe stado/ławica błyska
   *  razem z liderem (it.group = id lidera). */
  sync(items, grid, VEX, lifeSound = null) {
    const counts = {}, halos = {};
    for (const kind of Object.keys(this.layers)) { counts[kind] = 0; halos[kind] = 0; }
    const wallMs = performance.now();
    for (const it of items) {
      const pts = this.layers[it.kind];
      const pos = pts.geometry.attributes.position.array;
      const col = pts.geometry.attributes.color.array;
      const i = counts[it.kind]++;
      if (i * 3 + 2 >= pos.length) continue;
      const p = grid.latLonToWorld(it.lat, it.lon, -it.depth * VEX);
      pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
      const glow = lifeSound?.glowFor(it.group ?? it.id, wallMs) ?? 0;
      const b = this.baseColors[it.kind], k = 1 + 2.5 * glow;
      col[i * 3] = Math.min(1, b.r * k);
      col[i * 3 + 1] = Math.min(1, b.g * k);
      col[i * 3 + 2] = Math.min(1, b.b * k);
      if (glow > 0.02) {
        const hp = this.halo[it.kind];
        const hpos = hp.geometry.attributes.position.array;
        const hcol = hp.geometry.attributes.color.array;
        const h = halos[it.kind]++;
        if (h * 3 + 2 < hpos.length) {
          hpos[h * 3] = p.x; hpos[h * 3 + 1] = p.y; hpos[h * 3 + 2] = p.z;
          // kolor gatunku rozbielony, jasność = glow (gaśnie z dźwiękiem)
          hcol[h * 3] = Math.min(1, b.r + 0.7 * glow) * glow;
          hcol[h * 3 + 1] = Math.min(1, b.g + 0.7 * glow) * glow;
          hcol[h * 3 + 2] = Math.min(1, b.b + 0.7 * glow) * glow;
        }
      }
    }
    for (const [kind, pts] of Object.entries(this.layers)) {
      pts.geometry.setDrawRange(0, counts[kind]);
      pts.geometry.attributes.position.needsUpdate = true;
      pts.geometry.attributes.color.needsUpdate = true;
      const hp = this.halo[kind];
      hp.geometry.setDrawRange(0, halos[kind]);
      hp.geometry.attributes.position.needsUpdate = true;
      hp.geometry.attributes.color.needsUpdate = true;
    }
  }
}
