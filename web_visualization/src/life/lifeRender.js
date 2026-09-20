// Stworzenia jako maleńkie kropki (stały rozmiar w pikselach, bez etykiet):
// mają być ledwo widoczne — tylko żeby morze nie było puste.
import * as THREE from 'three';
import { KINDS } from './creatures.js';

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
    for (const [kind, k] of Object.entries(KINDS)) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 400), 3));
      geo.setDrawRange(0, 0);
      const mat = new THREE.PointsMaterial({
        color: k.color, size: k.px, sizeAttenuation: false, map: tex,
        transparent: true, opacity: k.opacity, depthWrite: false,
      });
      const pts = new THREE.Points(geo, mat);
      pts.frustumCulled = false;
      pts.renderOrder = 1;     // przed taflą wody (2), żeby prześwitywały spod niej
      this.root.add(pts);
      this.layers[kind] = pts;
    }
  }

  set visible(v) {
    this.root.visible = v;
  }

  sync(items, grid, VEX) {
    const counts = {};
    for (const kind of Object.keys(this.layers)) counts[kind] = 0;
    for (const it of items) {
      const pts = this.layers[it.kind];
      const arr = pts.geometry.attributes.position.array;
      const i = counts[it.kind]++;
      if (i * 3 + 2 >= arr.length) continue;
      const { x, z } = grid.latLonToWorld(it.lat, it.lon);
      arr[i * 3] = x; arr[i * 3 + 1] = -it.depth * VEX; arr[i * 3 + 2] = z;
    }
    for (const [kind, pts] of Object.entries(this.layers)) {
      pts.geometry.setDrawRange(0, counts[kind]);
      pts.geometry.attributes.position.needsUpdate = true;
    }
  }
}
