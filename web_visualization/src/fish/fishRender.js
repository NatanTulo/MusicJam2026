// Ryby w scenie Three.js. Tylko wygląd — stan przychodzi z FishSchool.list().
//
// Każdy gatunek ma INNĄ sylwetkę (nie tylko kolor):
//  * szprot — smukła torpeda z dużym widelcem,
//  * śledź — klasyczna ryba ze średnim widelcem,
//  * dorsz — byczek: masywne ciało + łeb, wachlarz, podwójna płetwa i wąsik,
//  * flądra — płaski owal denny z oczami z góry i kryzą (falbanką) wokół obrysu.
//
// Czytelność na mapie o skali kilometrów:
//  * rozmiar ekranowy prawie stały (jak pinezka łódki) — prawdziwa ryba byłaby podpikselowa,
//  * pionowa linia od powierzchni do ryby + kółko na tafli: widać, gdzie jest i jak głęboko,
//  * świecenie (emissive), bo pod półprzezroczystą wodą kolory gasną.
//
// Kolor nadal = odcień osoby z kamery (species.personHue): ta sama osoba to ta sama
// barwa, ale kształt zdradza gatunek.
import * as THREE from 'three';
import { SPECIES_BY_ID, hsvToRgb } from './species.js';

function bodyGeo(sx, sy, sz) {
  const g = new THREE.SphereGeometry(0.5, 20, 12);
  g.scale(sx, sy, sz);
  return g;
}

/** Widelec ogona w płaszczyźnie poziomej, nasada w (0,0,0), tył ryby = +Z. */
function forkTail(len, spread, notch) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-spread, len);
  s.lineTo(0, len - notch);
  s.lineTo(spread, len);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Zaokrąglony wachlarz (dorsz, flądra) — bez wcięcia, w płaszczyźnie poziomej. */
function fanTail(width, len) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(-width, len * 0.55);
  s.quadraticCurveTo(0, len * 1.3, width, len * 0.55);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Płetwa grzbietowa: trójkąt w płaszczyźnie pionowej (wzdłuż ciała, czubek w +Y).
 *  Po rotateY(+90°): oś X kształtu -> -Z (przód ryby), więc płetwa ciągnie się do przodu
 *  od punktu zaczepienia. */
function dorsalFin(base, height) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(base, 0);
  s.lineTo(base * 0.35, height);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateY(Math.PI / 2);
  return g;
}

function pectoralFin(side, len = 0.3, wid = 0.16) {
  const s = new THREE.Shape();
  s.moveTo(0, 0);
  s.lineTo(side * len, wid);
  s.lineTo(0, wid * 0.9);
  s.closePath();
  const g = new THREE.ShapeGeometry(s);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Kryza flądry: płaski pierścień-owal pod ciałem, wystający poza jego obrys.
 *  Daje ciągłą falbankę wokół całego placka (płetwy grzbietowa+odbytowa zlane
 *  wokoło ciała, jak u prawdziwej flądry). Środek chowa się pod ciałem. */
function skirtFin() {
  const g = new THREE.RingGeometry(0.6, 1.0, 48);
  g.rotateX(-Math.PI / 2); // do poziomu: X = szerokość, Z = długość
  return g;
}

// Współdzielone geometrie — jedna na gatunek, nie na rybę (nie dispose'ujemy ich).
const GEO_CACHE = new Map();
const EYE_GEO = new THREE.SphereGeometry(0.045, 8, 6);
const EYE_GEO_BIG = new THREE.SphereGeometry(0.062, 8, 6);
const RING_GEO = (() => { const g = new THREE.RingGeometry(0.78, 1, 40); g.rotateX(-Math.PI / 2); return g; })();

function modelGeo(speciesId) {
  const hit = GEO_CACHE.get(speciesId);
  if (hit) return hit;
  const sp = SPECIES_BY_ID[speciesId];
  const m = sp?.model ?? { body: [0.3, 0.3, 1], tail: 'fork' };
  const [bx, by, bz] = m.body;
  const g = { model: m, body: bodyGeo(bx, by, bz), tailZ: 0.44 * bz + 0.02 };

  if (m.tail === 'fork-big') g.tail = forkTail(0.42, 0.3, 0.22);
  else if (m.tail === 'fan') g.tail = fanTail(0.3, 0.34);
  else if (m.tail === 'fan-small') g.tail = fanTail(0.2, 0.24);
  else g.tail = forkTail(0.34, 0.26, 0.14); // 'fork'

  if (m.dorsal === 'small') g.dorsals = [{ geo: dorsalFin(0.3, 0.2), pos: [0, by * 0.42, 0.12] }];
  else if (m.dorsal === 'double') {
    g.dorsals = [
      { geo: dorsalFin(0.34, 0.3), pos: [0, by * 0.42, 0.1] },
      { geo: dorsalFin(0.26, 0.22), pos: [0, by * 0.44, -0.22] },
    ];
  } else if (m.dorsal === 'rim') {
    g.dorsals = [];
    // kryza nieco większa od obrysu ciała, środek schowany pod ciałem
    g.skirt = skirtFin();
    g.skirtScale = [0.5 * bx + 0.16, 0.5 * bz + 0.14];
    g.skirtY = -0.03;
  } else {
    g.dorsals = [{ geo: dorsalFin(0.36, 0.26), pos: [0, by * 0.42, 0.05] }]; // 'mid'
  }

  if (m.flat) {
    // flądra: brak płetw piersiowych (kryza je zastępuje), ogon na końcu owalu
    g.finL = null;
    g.finR = null;
    g.tailZ = 0.5 * bz + 0.02;
  } else if (m.tail === 'fork-big') {
    g.finL = pectoralFin(-1, 0.2, 0.12);
    g.finR = pectoralFin(1, 0.2, 0.12);
  } else {
    g.finL = pectoralFin(-1);
    g.finR = pectoralFin(1);
  }

  if (m.head) {
    g.head = bodyGeo(0.52, 0.46, 0.5);
    g.barbel = new THREE.ConeGeometry(0.028, 0.16, 6);
  }

  GEO_CACHE.set(speciesId, g);
  return g;
}

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
    const sp = SPECIES_BY_ID[f.species];
    const mg = modelGeo(f.species);
    const flat = !!mg.model.flat;

    const fish = new THREE.Group();
    fish.add(new THREE.Mesh(mg.body, mat));

    if (mg.head) {
      const head = new THREE.Mesh(mg.head, mat);
      head.position.set(0, -0.04, -0.34);
      fish.add(head);
      const barbel = new THREE.Mesh(mg.barbel, mat);
      barbel.position.set(0, -0.2, -0.52);
      barbel.rotation.x = Math.PI; // czubkiem w dół (wąsik dorsza pod pyskiem)
      fish.add(barbel);
    }

    const tailPivot = new THREE.Group();
    tailPivot.position.z = mg.tailZ;
    tailPivot.add(new THREE.Mesh(mg.tail, mat));
    fish.add(tailPivot);

    for (const d of mg.dorsals) {
      const fin = new THREE.Mesh(d.geo, mat);
      fin.position.set(...d.pos);
      fish.add(fin);
    }
    if (mg.skirt) {
      // kryza flądry: falbanka wystająca spoza obrysu całego owalu
      const skirt = new THREE.Mesh(mg.skirt, mat);
      skirt.scale.set(mg.skirtScale[0], 1, mg.skirtScale[1]);
      skirt.position.y = mg.skirtY;
      fish.add(skirt);
    }
    if (mg.finL && mg.finR) {
      const finL = new THREE.Mesh(mg.finL, mat);
      finL.position.set(-0.12, -0.02, -0.12);
      const finR = new THREE.Mesh(mg.finR, mat);
      finR.position.set(0.12, -0.02, -0.12);
      fish.add(finL, finR);
    }

    if (mg.model.eyesTop) {
      // flądra: oba oczy z góry, blisko siebie, z przodu placka
      const eyeGeo = EYE_GEO;
      for (const dx of [-0.06, 0.06]) {
        const eye = new THREE.Mesh(eyeGeo, EYE_MAT);
        eye.position.set(dx, 0.1, -0.42);
        fish.add(eye);
      }
    } else {
      const eyeGeo = mg.head ? EYE_GEO_BIG : EYE_GEO;
      const eyeY = mg.head ? 0.06 : 0.08;
      const eyeZ = mg.head ? -0.52 : -0.36;
      const eyeX = flat ? 0.1 : mg.head ? 0.14 : 0.1;
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(eyeGeo, EYE_MAT);
        eye.position.set(side * eyeX, eyeY, eyeZ);
        fish.add(eye);
      }
    }

    const lineMat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.6 });
    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(lineGeo, lineMat);
    line.frustumCulled = false;

    const ring = new THREE.Mesh(RING_GEO, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide,
    }));
    ring.renderOrder = 4;

    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    label.renderOrder = 16;

    this.root.add(fish, line, ring, label);
    const rec = { fish, tailPivot, mat, line, ring, label, css, text: '', species: f.species, flat };
    this.meshes.set(f.id, rec);
    return rec;
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

  /** @param list  FishSchool.list()
   *  @param ctx {camera, VEX, t, audio} — audio: wiersze engine.info.fish
   *  ({id, note, levelDb, voiced}); brzmiąca ryba świeci mocniej, a etykieta
   *  pokazuje dźwięk, który śpiewa. */
  sync(list, { camera, VEX, t, audio = [] }) {
    if (!this.grid) return;
    const voices = new Map(audio.map((r) => [r.id, r]));
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
      const tailAmp = sp.model?.tailAmp ?? 0.35;

      m.fish.position.set(p.x, p.y, p.z);
      if (m.flat) {
        // flądra pełza nad dnem: lekkie kołysanie placka + kurs
        m.fish.rotation.set(Math.sin(t * 1.7 + f.id) * 0.1, -f.heading, Math.sin(t * 1.1 + f.id * 2) * 0.08);
      } else {
        m.fish.rotation.set(0, -f.heading, Math.sin(f.tail * 0.5) * 0.06);
      }
      const camDist = camera.position.distanceTo(m.fish.position);
      const s = Math.min(3500, Math.max(16, camDist * 0.03)) * sp.size * (0.85 + 0.3 * f.scale);
      m.fish.scale.setScalar(s);
      m.tailPivot.rotation.y = Math.sin(f.tail) * (tailAmp + 0.3 * f.excitement);
      const a = Math.max(0, Math.min(1, f.alpha));
      m.mat.opacity = a;
      // głos: brzmiąca ryba świeci mocniej (0 = nie brzmi, 1 = najgłośniej)
      const row = voices.get(f.id);
      const glow = row?.voiced
        ? Math.max(0.25, Math.min(1, (row.levelDb + 70) / 45))
        : 0;
      // "szukam człowieka" = miganie
      m.mat.emissiveIntensity = f.state === 'searching' ? 0.5 + 0.5 * Math.sin(t * 8) : 1 + 1.8 * glow;

      const pos = m.line.geometry.attributes.position;
      pos.setXYZ(0, ps.x + n.x, ps.y + n.y, ps.z + n.z);
      pos.setXYZ(1, p.x, p.y, p.z);
      pos.needsUpdate = true;
      m.line.material.opacity = 0.6 * a;

      m.ring.position.set(ps.x + n.x * 1.2, ps.y + n.y * 1.2, ps.z + n.z * 1.2);
      m.ring.scale.setScalar(s * 0.55);
      m.ring.material.opacity = (0.75 + 0.25 * glow) * a;

      m.label.visible = this.showLabels && a > 0.05;
      if (m.label.visible) {
        const text = `#${f.id} ${sp.name} · ${Math.round(f.depth)} m` + (glow > 0 ? ` · ♪${row.note}` : '');
        if (text !== m.text) {   // tekstura tylko przy zmianie napisu, nie co klatkę
          m.label.material.map?.dispose();
          m.label.material.map = labelTexture(text, m.css);
          m.label.material.needsUpdate = true;
          m.text = text;
        }
        const surfDist = camera.position.distanceTo(m.ring.position);
        const w = Math.max(65, surfDist * 0.11);
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
