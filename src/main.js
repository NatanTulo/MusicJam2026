import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BathymetryGrid, depthColor } from './bathymetry.js';

// ---------------------------------------------------------------------------
// Konfiguracja
// ---------------------------------------------------------------------------
const REGIONS = [
  { id: 'baltic-full', name: 'Bałtyk — cały (EMODnet)', start: { lat: 54.52, lon: 18.95 } },
  { id: 'baltic-south', name: 'Bałtyk Południowy — Zatoka Gdańska (detal)', start: { lat: 54.52, lon: 18.95 } },
];
// Eksperymentalne nadpisanie gęstości siatki 3D/tekstury, np. ?meshstep=1&texss=2
// wymusza wierność detalu Zatoki na całej mapie (potrzebne do pomiaru kosztów).
const QRY = new URLSearchParams(location.search);
const MESH_STEP_OVERRIDE = parseInt(QRY.get('meshstep') || '', 10) || null;
const TEX_SS_OVERRIDE = parseInt(QRY.get('texss') || '', 10) || null;
let VEX = 20; // przewyższenie pionowe dna (wizualizacja)
let speedScale = 1; // tempo testowe: mnożnik prędkości (1 = realistycznie)
const MS_TO_KT = 1.94384;

const $ = (id) => document.getElementById(id);
const hud = {
  loading: $('loading'), loadingText: $('loading-text'),
  depth: $('depth-value'), pos: $('pos-value'), speed: $('speed-value'),
  course: $('course-value'), status: $('status-value'), throttle: $('throttle-fill'),
  echo: $('echo'), mini: $('mini'), toast: $('toast'),
  region: $('region-select'), vex: $('vex'), vexVal: $('vex-val'),
  waterXray: $('water-xray'), followCam: $('follow-cam'),
  tempo: $('tempo-select'), tempoBadge: $('tempo-badge'),
  bordersToggle: $('borders-toggle'), labelsToggle: $('labels-toggle'),
};

// ---------------------------------------------------------------------------
// Stan gry
// ---------------------------------------------------------------------------
let renderer, scene, camera, controls, clock;
let grid = null;
let terrainMesh = null, waterMesh = null, waterBase = null;
let boat = null;
let boatMarker = null;
let trailLine = null;
const trailPts = [];       // THREE.Vector3 (world)
const trailGeoPts = [];    // lat/lon do minimapy
const echoHistory = [];
// Granice państw + etykiety (tiny-world-map, ODbL): dane lat/lon ładowane raz,
// geometria 3D przebudowywana na nowo dla każdego regionu (inne mapowanie świata).
let borderData = null;     // { borders: [[[lat,lon]...]], labels: [{name,lat,lon}] }
let borderGroup = null;    // THREE.Group z liniami granic
let labelGroup = null;     // THREE.Group z etykietami państw
let borderVerts = [];      // [{ line, pts: [{lat,lon,elev}] }] — do aktualizacji przy zmianie VEX
let labelSprites = [];     // [{ sprite, lat, lon }]
let showBorders = true, showLabels = true;
let keys = { w: false, s: false, a: false, d: false };
let follow = true;
let aground = false, outOfMap = false;
let lastEchoPush = 0, lastTrailPush = 0, lastHud = 0;
let stepTime = 0; // czas symulacji dla kroku testowego _step (gdy rAF stoi)

const state = {
  lat: 54.52, lon: 18.95,
  heading: Math.PI * 0.75, // rad, 0 = N, zgodnie ze wskazówkami zegara
  speed: 0,                // m/s, ujemna = wstecz
  throttle: 0,             // -1..1 (wizualnie na HUD)
};

// Publiczne API dostępu do głębokości (wymaganie: "dostęp do głębokości do dna względem łódki")
window.boatAPI = {
  getDepth: () => (grid ? physDepthAt(state.lat, state.lon) : NaN),
  getElevation: () => {
    const g = grid ? physGrid(state.lat, state.lon) : null;
    return g ? g.sampleElevation(state.lat, state.lon) : NaN;
  },
  getPosition: () => ({ lat: state.lat, lon: state.lon }),
  getSpeedKnots: () => Math.abs(state.speed) * MS_TO_KT,
  getHeadingDeg: () => (state.heading * 180 / Math.PI + 360) % 360,
  getRegion: () => grid?.id,
  getDetail: () => (grid === fullGrid ? 'full' : 'coarse'),
  // Diagnostyka wydajności (eksperymenty z gęstością siatki).
  _stats: () => ({
    verts: terrainMesh?.geometry.attributes.position.count ?? 0,
    tris: (terrainMesh?.geometry.index?.count ?? 0) / 3,
    tex: terrainMesh?.material.map ? [terrainMesh.material.map.image.width, terrainMesh.material.map.image.height] : null,
    heapMB: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null,
    tile: tileMesh ? `on (${coastTile.nLat}x${coastTile.nLon})` : (tileLoading ? 'loading…' : 'off'),
  }),
  getSpeedScale: () => speedScale,
  setSpeedScale: (s) => setTempo(s),
  // Hak testowy: deterministyczny krok fizyki + render, gdy rAF jest zdławiony
  // (np. ukryta karta w teście). Zwraca pozycję i prędkość po kroku.
  _step: (dt = 1 / 60) => {
    if (!grid) return null;
    stepTime += dt;
    updateBoat(Math.min(dt, 0.05), stepTime);
    animateWater(stepTime);
    updateHud(stepTime);
    controls.update();
    renderer.render(scene, camera);
    return { lat: state.lat, lon: state.lon, speed: state.speed };
  },
};

// ---------------------------------------------------------------------------
// Scena
// ---------------------------------------------------------------------------
function initScene() {
  const canvas = $('scene');
  renderer = new THREE.WebGLRenderer({
    canvas, antialias: true,
    // Scena ma ~100 km rozpiętości i detale rzędu metrów — zwykły bufor głębi
    // (near=1/far=600000) powodował z-fighting i migotanie z daleka.
    logarithmicDepthBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b5d6);
  scene.fog = new THREE.Fog(0x87b5d6, 25000, 160000);

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 2, 5000000);
  camera.position.set(0, 90, 220);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 15;
  controls.maxDistance = 1500000; // da się oddalić na cały Bałtyk (~1300 km)
  controls.maxPolarAngle = Math.PI * 0.495;

  scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x1a3a52, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
  sun.position.set(-40000, 50000, 20000);
  scene.add(sun);

  boat = buildBoat();
  scene.add(boat);

  // Marker łódki: z daleka łódka jest podpikselowa, więc pokazujemy pinezkę
  // o stałym rozmiarze ekranowym (znika z bliska, gdy widać model).
  boatMarker = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeMarkerTexture(), depthTest: false, transparent: true, opacity: 0.95,
  }));
  boatMarker.renderOrder = 10;
  scene.add(boatMarker);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * 2000), 3));
  trailLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffe08a }));
  trailLine.frustumCulled = false;
  scene.add(trailLine);

  clock = new THREE.Clock();
  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
}

function buildBoat() {
  const g = new THREE.Group();
  const hullMat = new THREE.MeshPhongMaterial({ color: 0x8a2f23, shininess: 60 });
  const deckMat = new THREE.MeshPhongMaterial({ color: 0xd9c39a, shininess: 30 });
  const cabMat = new THREE.MeshPhongMaterial({ color: 0xf4f6f8, shininess: 80 });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x18394d, shininess: 120 });

  // Kadłub: skrzynia + dziób (klin). Dziób w stronę -Z.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 16), hullMat);
  hull.position.y = 1.2;
  g.add(hull);
  // Klin dziobowy: stożek o podstawie kwadratowej, obrócony czubkiem do przodu (-Z).
  const bowGeo = new THREE.ConeGeometry(3.5, 7, 4);
  bowGeo.rotateY(Math.PI / 4); // kwadratowa podstawa ścianami do burt
  bowGeo.rotateX(-Math.PI / 2); // oś wzdłuż Z, czubek na -Z
  const bow = new THREE.Mesh(bowGeo, hullMat);
  bow.scale.set(1, 0.45, 1); // spłaszcz do wysokości kadłuba
  bow.position.set(0, 1.2, -11);
  g.add(bow);
  const deck = new THREE.Mesh(new THREE.BoxGeometry(6.4, 0.5, 15), deckMat);
  deck.position.y = 2.9;
  g.add(deck);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(4.4, 2.6, 5.5), cabMat);
  cabin.position.set(0, 4.4, 2.2);
  g.add(cabin);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.0, 2.2), glassMat);
  glass.position.set(0, 4.9, -0.2);
  g.add(glass);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 6, 8), deckMat);
  mast.position.set(0, 8, 2.2);
  g.add(mast);
  // światła nawigacyjne: lewe czerwone, prawe zielone
  const port = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }));
  port.position.set(-3.6, 3.4, -6);
  g.add(port);
  const star = new THREE.Mesh(new THREE.SphereGeometry(0.35, 8, 8),
    new THREE.MeshBasicMaterial({ color: 0x22ff66 }));
  star.position.set(3.6, 3.4, -6);
  g.add(star);
  g.scale.setScalar(1.6);
  return g;
}

function makeMarkerTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = '#ffdf6b';
  ctx.lineWidth = 9;
  ctx.beginPath(); ctx.arc(64, 52, 34, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#ffdf6b';
  ctx.beginPath(); ctx.moveTo(64, 112); ctx.lineTo(50, 84); ctx.lineTo(78, 84);
  ctx.closePath(); ctx.fill();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------------------------------------------------------------------------
// Teren + woda z prawdziwej batymetrii
// ---------------------------------------------------------------------------
function buildTerrain() {
  if (terrainMesh) {
    scene.remove(terrainMesh);
    terrainMesh.geometry.dispose();
    terrainMesh.material.map?.dispose();
    terrainMesh.material.dispose();
  }
  if (waterMesh) { scene.remove(waterMesh); waterMesh.geometry.dispose(); }

  const { nLat, nLon, widthM, depthM } = grid;
  // Decymacja geometrii dla gęstych siatek (cel ~1 mln czworokątów): rzeźba 3D
  // musi nadążać za teksturą, inaczej przy VEX 20× krawędź klifu mija się
  // z linią brzegu z kolorów o ±2 km ("poucinany" ląd). Fizyka i tak próbkuje
  // pełną siatkę (bilinear).
  const step = MESH_STEP_OVERRIDE ?? Math.max(1, Math.round(Math.sqrt((nLat * nLon) / 1000000)));
  const segX = Math.floor((nLon - 1) / step), segY = Math.floor((nLat - 1) / step);
  const geo = new THREE.PlaneGeometry(widthM, depthM, segX, segY);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const baseElev = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const { lat, lon } = grid.worldToLatLon(x, z);
    // Renderowa siatka przybrzeżna: łagodna plaża zamiast klifu/kwadratów.
    // (Fizyka łódki cały czas używa ostrego sampleElevation.)
    let e = grid.sampleRenderElevation(lat, lon);
    if (Number.isNaN(e)) e = 2; // poza mapą: lekko nad wodą
    baseElev[i] = e;
    pos.setY(i, e * VEX);
  }
  geo.computeVertexNormals();
  geo.userData.baseElev = baseElev;

  // Kolor dna jako tekstura z mipmapami (zamiast kolorów per-wierzchołek):
  // z daleka mipmapy uśredniają kolor i nie ma migotania/pasków (aliasing).
  const mat = new THREE.MeshLambertMaterial({ map: makeSeabedTexture() });
  terrainMesh = new THREE.Mesh(geo, mat);
  scene.add(terrainMesh);

  // Woda: przezroczysta tafla na y=0 z animowanymi falami (niski segment).
  const wgeo = new THREE.PlaneGeometry(widthM, depthM, 72, 72);
  wgeo.rotateX(-Math.PI / 2);
  const wmat = new THREE.MeshPhongMaterial({
    color: 0x1b6f8f, transparent: true, opacity: 0.62,
    shininess: 140, specular: 0x99ddff, side: THREE.FrontSide,
    // Odsuń wodę minimalnie od dna w buforze głębi — brak migotania na płyciznach.
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  });
  waterMesh = new THREE.Mesh(wgeo, wmat);
  waterMesh.position.y = 0;
  waterMesh.renderOrder = 2;
  scene.add(waterMesh);
  waterBase = wgeo.attributes.position.array.slice();
  applyWaterXray();
}

/** Tekstura dna z siatki batymetrii. Canvas: góra = północ (v=1 w PlaneGeometry).
 *  Próbkowanie renderowe (wygładzony pas przybrzeżny) + nadpróbkowanie 2×:
 *  miękkie przejścia barwne przy brzegu zamiast twardych kwadratów komórek.
 *  Dla siatek >1 mln komórek SS=1 (tekstura i tak ma megapiksele). */
function makeSeabedTexture() {
  const SS = TEX_SS_OVERRIDE ?? ((grid.nLat * grid.nLon > 1000000) ? 1 : 2); // nadpróbkowanie
  const W = grid.nLon * SS, H = grid.nLat * SS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const c = [0, 0, 0];
  for (let cy = 0; cy < H; cy++) {
    // wiersz canvasu 0 (góra) = północ = lat1
    const lat = grid.lat1 - (cy / (H - 1)) * (grid.lat1 - grid.lat0);
    for (let cx = 0; cx < W; cx++) {
      const lon = grid.lon0 + (cx / (W - 1)) * (grid.lon1 - grid.lon0);
      let e = grid.sampleRenderElevation(lat, lon);
      if (Number.isNaN(e)) e = 2;
      depthColor(e, c);
      const i = (cy * W + cx) * 4;
      img.data[i] = c[0] * 255; img.data[i + 1] = c[1] * 255; img.data[i + 2] = c[2] * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter; // mipmapy = gładko z daleka
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

function applyWaterXray() {
  if (!waterMesh) return;
  waterMesh.material.opacity = hud.waterXray.checked ? 0.30 : 0.62;
}

function applyVex() {
  if (!terrainMesh) return;
  const pos = terrainMesh.geometry.attributes.position;
  const base = terrainMesh.geometry.userData.baseElev;
  for (let i = 0; i < pos.count; i++) pos.setY(i, base[i] * VEX);
  pos.needsUpdate = true;
  terrainMesh.geometry.computeVertexNormals();
  if (tileMesh) {
    const tp = tileMesh.geometry.attributes.position;
    const tb = tileMesh.geometry.userData.baseElev;
    for (let i = 0; i < tp.count; i++) tp.setY(i, tb[i] * VEX + TILE_LIFT);
    tp.needsUpdate = true;
    tileMesh.geometry.computeVertexNormals();
  }
  updateBorderHeights();
}

// ---------------------------------------------------------------------------
// Nakładka hi-res polskiego wybrzeża (kafel stride 2, ~230 m)
// Baza (580 m – 3,5 km) nie mieści Mierzei Helskiej (~300 m); kafel dokleja
// detal jako drugi mesh w światowych współrzędnych bazy (+2 m liftu przeciw
// z-fightingowi). Fizyka w bbox kafla próbkuje kafel, poza nim — bazę.
// ---------------------------------------------------------------------------
const TILE_LIFT = 2;    // metry świata ponad teren bazowy (niewidoczne przy VEX)
const TILE_FEATHER = 3; // komórek blendu krawędzi kafla do bazy (brak szwów/klifów)
const TILE_SS = 3;      // nadpróbkowanie tekstury kafla (~77 m/texel)
const TILE_SMOOTH_PASSES = 3; // przebiegi blur pasa przybrzeżnego kafla (szeroka plaża)
const TILE_LAPLACIAN_PASSES = 2; // wygładzanie geometrii kafla (zaokrąglenie kantów siatki)
// Bbox kafla musi być cały w bazie (UWAGA: po upgradzie grid.id to
// 'baltic-full-res', więc nie testujemy id tylko bbox).
const TILE_BBOX = { latMin: 54.15, latMax: 55.10, lonMin: 17.60, lonMax: 19.95 };
function baseContainsTile(g) {
  if (!g) return false;
  const b = g.bbox;
  return b.latMin <= TILE_BBOX.latMin && b.latMax >= TILE_BBOX.latMax &&
    b.lonMin <= TILE_BBOX.lonMin && b.lonMax >= TILE_BBOX.lonMax;
}

/** Siatka do fizyki/HUD: kafel gdy łódka w jego bbox i nakładka widoczna. */
function physGrid(lat, lon) {
  if (tileMesh && coastTile && coastTile.inBounds(lat, lon)) return coastTile;
  return grid;
}
function physDepthAt(lat, lon) {
  const g = physGrid(lat, lon);
  return g ? g.depthAt(lat, lon) : NaN;
}
function physIsLand(lat, lon) {
  const g = physGrid(lat, lon);
  return g ? g.isLand(lat, lon) : false;
}
function physInBounds(lat, lon, margin = 0) {
  return (tileMesh && coastTile && coastTile.inBounds(lat, lon, margin)) ||
    (grid && grid.inBounds(lat, lon, margin));
}

/** Wysokość renderowa kafla z featherem do bazy na krawędzi (STAŁY blend,
 *  żeby overlay nie robił klifu tam gdzie zgrubna baza widzi inaczej). */
function tileRenderElevation(lat, lon) {
  const t = coastTile;
  const { nLat, nLon } = t;
  const fx = ((lon - t.lon0) / (t.lon1 - t.lon0)) * (nLon - 1);
  const fy = ((lat - t.lat0) / (t.lat1 - t.lat0)) * (nLat - 1);
  if (fx < 0 || fy < 0 || fx > nLon - 1 || fy > nLat - 1) return NaN;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, nLon - 1), y1 = Math.min(y0 + 1, nLat - 1);
  const tx = fx - x0, ty = fy - y0;
  const rd = t.renderData;
  const tv = rd[y0 * nLon + x0] * (1 - tx) * (1 - ty) + rd[y0 * nLon + x1] * tx * (1 - ty) +
    rd[y1 * nLon + x0] * (1 - tx) * ty + rd[y1 * nLon + x1] * tx * ty;
  const edge = Math.min(fx, fy, (nLon - 1) - fx, (nLat - 1) - fy);
  if (edge >= TILE_FEATHER || !grid) return tv;
  let b = grid.sampleRenderElevation(lat, lon);
  if (Number.isNaN(b)) b = 2;
  const w = Math.max(0, edge / TILE_FEATHER); // 0 na krawędzi → baza, 1 w środku → kafel
  return b * (1 - w) + tv * w;
}

function tileContainsIn(base, t) {
  return baseContainsTile(base);
}

function disposeMesh(m) {
  if (!m) return;
  scene.remove(m);
  m.geometry.dispose();
  m.material.map?.dispose();
  m.material.dispose();
}

/** Buduje overlay kafla w ŚWIATOWYCH współrzędnych bazy (inny środek/ skala
 *  niż siatka kafla — wierzchołki liczone per-vertex przez bazę). */
function buildTileOverlay() {
  disposeMesh(tileMesh);
  tileMesh = null;
  if (!coastTile || !grid || !tileContainsIn(grid, coastTile)) return;
  const t = coastTile;
  const segX = t.nLon - 1, segY = t.nLat - 1;
  const nx = segX + 1, ny = segY + 1;
  const positions = new Float32Array(nx * ny * 3);
  const uvs = new Float32Array(nx * ny * 2);
  const baseElev = new Float32Array(nx * ny);
  for (let r = 0; r < ny; r++) {
    const lat = t.lat0 + ((t.lat1 - t.lat0) * r) / (t.nLat - 1);
    for (let c = 0; c < nx; c++) {
      const lon = t.lon0 + ((t.lon1 - t.lon0) * c) / (t.nLon - 1);
      let e = tileRenderElevation(lat, lon);
      if (Number.isNaN(e)) e = 2;
      const { x, z } = grid.latLonToWorld(lat, lon);
      const i = r * nx + c;
      positions[i * 3] = x;
      positions[i * 3 + 1] = e * VEX + TILE_LIFT;
      positions[i * 3 + 2] = z;
      uvs[i * 2] = c / (t.nLon - 1);
      uvs[i * 2 + 1] = r / (t.nLat - 1); // v=0 południe, v=1 północ
      baseElev[i] = e;
    }
  }
  // Laplacian pasa przybrzeżnego: zaokrągla kanty siatki (232 m) na stromych
  // zejściach plaży. Płaskie obszary (sąsiedzi równi) same się zerują.
  for (let pass = 0; pass < TILE_LAPLACIAN_PASSES; pass++) {
    const src = baseElev.slice();
    for (let r = 1; r < ny - 1; r++) {
      for (let c = 1; c < nx - 1; c++) {
        const i = r * nx + c;
        const avg = (src[i - 1] + src[i + 1] + src[i - nx] + src[i + nx]) * 0.25;
        baseElev[i] += (avg - baseElev[i]) * 0.5;
      }
    }
  }
  for (let i = 0; i < nx * ny; i++) {
    positions[i * 3 + 1] = baseElev[i] * VEX + TILE_LIFT;
  }
  const idx = new Uint32Array(segX * segY * 6);
  let k = 0;
  for (let r = 0; r < segY; r++) {
    for (let c = 0; c < segX; c++) {
      // a=SW, b=SE, d=NW, e2=NE — ten porządek daje normalne w górę (+Y),
      // jak w PlaneGeometry (zweryfikowane iloczynem wektorowym).
      const a = r * nx + c, b = a + 1, d = a + nx, e2 = d + 1;
      idx[k++] = a; idx[k++] = b; idx[k++] = d;
      idx[k++] = b; idx[k++] = e2; idx[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.userData.baseElev = baseElev;
  const mat = new THREE.MeshLambertMaterial({ map: makeTileTexture() });
  tileMesh = new THREE.Mesh(geo, mat);
  tileMesh.frustumCulled = false;
  scene.add(tileMesh);
}

function makeTileTexture() {
  const t = coastTile;
  const W = t.nLon * TILE_SS, H = t.nLat * TILE_SS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const c = [0, 0, 0];
  for (let cy = 0; cy < H; cy++) {
    const lat = t.lat1 - (cy / (H - 1)) * (t.lat1 - t.lat0);
    for (let cx = 0; cx < W; cx++) {
      const lon = t.lon0 + (cx / (W - 1)) * (t.lon1 - t.lon0);
      let e = tileRenderElevation(lat, lon);
      if (Number.isNaN(e)) e = 2;
      depthColor(e, c);
      const i = (cy * W + cx) * 4;
      img.data[i] = c[0] * 255; img.data[i + 1] = c[1] * 255; img.data[i + 2] = c[2] * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

/** Dociąga kafel w tle (po full-res); nakładka bez resetu łódki. */
async function kickTileUpgrade() {
  if (tileLoading || coastTile || !baseContainsTile(grid)) return;
  tileLoading = true;
  try {
    const t = await BathymetryGrid.load('baltic-polish-coast');
    t.buildRenderData(TILE_SMOOTH_PASSES); // szersza plaża niż w bazie
    coastTile = t;
    if (!baseContainsTile(grid)) return; // użytkownik zmienił region
    buildTileOverlay();
    if (tileMesh) toast('Detal wybrzeża gotowy (~230 m) — Mierzeja Helska wyraźniejsza');
  } catch (err) {
    console.warn('Kafel wybrzeża niedostępny, zostaje baza:', err.message);
  } finally {
    tileLoading = false;
  }
}

// ---------------------------------------------------------------------------
// Granice państw + nazwy (tiny-world-map, dane © OSM, licencja ODbL)
// Plik public/data/borders-baltic.json generuje scripts/extract-borders.mjs.
// ---------------------------------------------------------------------------
const BORDER_LIFT = () => Math.max(60, VEX * 3);   // unoszenie linii nad teren/wodę
const LABEL_LIFT = () => Math.max(300, VEX * 15);  // kotwica etykiety nad terenem

async function loadBorderData() {
  try {
    const res = await fetch('./data/borders-baltic.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    borderData = await res.json();
  } catch (err) {
    console.warn('Brak danych granic państw:', err.message);
    borderData = null;
  }
}

/** Wysokość linii/etykiety: na lądzie wzdłuż terenu, na wodzie tuż nad taflą. */
function borderGroundY(lat, lon) {
  let e = grid.sampleNearest(lat, lon);
  if (Number.isNaN(e)) e = 2; // jak w buildTerrain: ląd bez danych lekko nad wodą
  return Math.max(e * VEX, 0);
}

function inGridBounds(lat, lon, margin = 0) {
  if (!grid) return false;
  const b = grid.bbox;
  return lat >= b.latMin - margin && lat <= b.latMax + margin &&
    lon >= b.lonMin - margin && lon <= b.lonMax + margin;
}

function makeLabelSprite(text) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 128;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 56px system-ui, Segoe UI, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(6,20,32,0.85)';
  ctx.strokeText(text, 256, 64);
  ctx.fillStyle = '#f2f7fb';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, depthTest: false, transparent: true, opacity: 0.95,
  }));
  sp.renderOrder = 15;
  return sp;
}

/** Buduje linie granic + etykiety dla bieżącego regionu (po buildTerrain). */
function buildBorders() {
  for (const grp of [borderGroup, labelGroup]) {
    if (!grp) continue;
    scene.remove(grp);
    grp.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) {
        o.material.map?.dispose();
        o.material.dispose();
      }
    });
  }
  borderGroup = null;
  labelGroup = null;
  borderVerts = [];
  labelSprites = [];
  if (!borderData || !grid) return;

  borderGroup = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x4a1f18, transparent: true, opacity: 0.9 });
  for (const ring of borderData.borders) {
    // Dziel na ciągi wewnątrz siatki, żeby linie nie przecinały pustki poza terenem.
    // Rysuj tylko odcinki lądowe: zgrubne linie brzegowe tinyworldmap mijają się
    // z dokładną batymetrią EMODnet i z bliska "cięłyby" przez wodę.
    // (THREE.Vector3 nie ma userData — lat/lon trzymamy w równoległej tablicy.)
    let run = [], runLL = [];
    const flush = () => {
      if (run.length >= 2) {
        const g = new THREE.BufferGeometry().setFromPoints(run);
        const line = new THREE.Line(g, mat);
        borderGroup.add(line);
        borderVerts.push({ line, pts: runLL });
      }
      run = []; runLL = [];
    };
    for (const [lat, lon] of ring) {
      if (!inGridBounds(lat, lon, 0.15)) { flush(); continue; }
      const e = grid.sampleNearest(lat, lon);
      if (!Number.isNaN(e) && e < -1.5) { flush(); continue; } // woda — pomiń
      const { x, z } = grid.latLonToWorld(lat, lon);
      run.push(new THREE.Vector3(x, borderGroundY(lat, lon) + BORDER_LIFT(), z));
      runLL.push([lat, lon]);
    }
    flush();
  }
  borderGroup.visible = showBorders;
  scene.add(borderGroup);

  labelGroup = new THREE.Group();
  for (const { name, lat, lon } of borderData.labels) {
    if (!inGridBounds(lat, lon, 0.1)) continue; // etykieta spoza regionu (np. detal Zatoki)
    const { x, z } = grid.latLonToWorld(lat, lon);
    const sp = makeLabelSprite(name);
    sp.position.set(x, borderGroundY(lat, lon) + LABEL_LIFT(), z);
    sp.visible = showLabels;
    labelGroup.add(sp);
    labelSprites.push({ sprite: sp, lat, lon });
  }
  labelGroup.visible = true;
  scene.add(labelGroup);
}

/** Po zmianie VEX: unieś linie i etykiety na nowo (geometria świata bez zmian). */
function updateBorderHeights() {
  if (!grid) return;
  for (const { line, pts } of borderVerts) {
    const attr = line.geometry.attributes.position;
    pts.forEach(([lat, lon], i) => {
      attr.setY(i, borderGroundY(lat, lon) + BORDER_LIFT());
    });
    attr.needsUpdate = true;
  }
  for (const { sprite, lat, lon } of labelSprites) {
    sprite.position.y = borderGroundY(lat, lon) + LABEL_LIFT();
  }
}

/** Stały rozmiar ekranowy etykiet: skala ~ odległość kamery od danej etykiety
 *  (nie od łódki — inaczej przelot obok etykiety robi gigantyczną plamę). */
function updateLabelScales() {
  if (!labelSprites.length) return;
  for (const { sprite } of labelSprites) {
    const d = camera.position.distanceTo(sprite.position);
    const w = Math.max(d * 0.13, 1);
    sprite.scale.set(w, w / 4, 1);
  }
}

function waveHeight(x, z, t) {
  return (
    0.35 * Math.sin(x * 0.004 + t * 1.2) +
    0.30 * Math.sin(z * 0.005 - t * 0.9) +
    0.15 * Math.sin((x + z) * 0.010 + t * 2.0)
  );
}

function animateWater(t) {
  if (!waterMesh) return;
  const p = waterMesh.geometry.attributes.position;
  const arr = p.array, base = waterBase;
  for (let i = 0; i < p.count; i++) {
    const x = base[i * 3], z = base[i * 3 + 2];
    arr[i * 3 + 1] = waveHeight(x, z, t);
  }
  p.needsUpdate = true;
  waterMesh.geometry.computeVertexNormals(); // żeby fale było widać w świetle
}

// ---------------------------------------------------------------------------
// Logika łódki (WASD)
// ---------------------------------------------------------------------------
function findSeaNear(lat, lon) {
  if (!physIsLand(lat, lon) && physDepthAt(lat, lon) > 4) return { lat, lon };
  for (let r = 0.005; r < 0.5; r += 0.005) {
    for (let a = 0; a < 12; a++) {
      const la = lat + Math.sin((a / 12) * Math.PI * 2) * r;
      const lo = lon + Math.cos((a / 12) * Math.PI * 2) * r;
      if (physInBounds(la, lo) && !physIsLand(la, lo) && physDepthAt(la, lo) > 4)
        return { lat: la, lon: lo };
    }
  }
  return { lat, lon };
}

function resetBoatToStart(startLat, startLon) {
  const p = findSeaNear(startLat, startLon);
  state.lat = p.lat; state.lon = p.lon;
  state.heading = Math.PI * 0.75;
  state.speed = 0; state.throttle = 0;
  trailPts.length = 0; trailGeoPts.length = 0; echoHistory.length = 0;
}

function updateBoat(dt, t) {
  // Tempo testowe skaluje i przyspieszenie, i prędkość maks. (1 = realistycznie).
  const ACCEL = 7 * speedScale, MAX_FWD = 16 * speedScale, MAX_REV = -5 * speedScale;
  let throttleInput = 0;
  if (keys.w) throttleInput += 1;
  if (keys.s) throttleInput -= 1;
  state.throttle += (throttleInput - state.throttle) * Math.min(1, dt * 4);

  if (throttleInput > 0) state.speed += ACCEL * dt;
  else if (throttleInput < 0) state.speed -= ACCEL * 0.7 * dt;
  else {
    // opór wody
    state.speed -= state.speed * 0.7 * dt;
    if (Math.abs(state.speed) < 0.05) state.speed = 0;
  }
  state.speed = Math.max(MAX_REV, Math.min(MAX_FWD, state.speed));

  let rudder = 0;
  if (keys.a) rudder -= 1;
  if (keys.d) rudder += 1;
  const spdF = Math.min(1, Math.abs(state.speed) / 8);
  const dir = state.speed >= 0 ? 1 : -1;
  state.heading += rudder * (0.25 + 1.15 * spdF) * dir * dt;
  if (state.heading < 0) state.heading += Math.PI * 2;
  if (state.heading >= Math.PI * 2) state.heading -= Math.PI * 2;

  const fx = Math.sin(state.heading), fz = -Math.cos(state.heading);
  const mPerDegLat = 111320;
  // Przy 500× klatka to nawet ~400 m lotu — dzielimy ruch na podkroki ≤150 m,
  // żeby nie przelatywać przez wąski ląd (np. Mierzeja Helska) bez kolizji.
  const subSteps = Math.max(1, Math.ceil((Math.abs(state.speed) * dt) / 150));
  const sdt = dt / subSteps;
  aground = false; outOfMap = false;
  for (let s = 0; s < subSteps; s++) {
    const mPerDegLon = 111320 * Math.cos((state.lat * Math.PI) / 180);
    // dz (metry, ujemne = północ); dlat = -dz / mPerDegLat; dlon = dx / mPerDegLon
    const nLat = state.lat + (-(fz * state.speed * sdt)) / mPerDegLat;
    const nLon = state.lon + (fx * state.speed * sdt) / mPerDegLon;
    if (!physInBounds(nLat, nLon, 0.002)) {
      outOfMap = true;
      state.speed *= 0.9;
      break;
    } else if (physIsLand(nLat, nLon)) {
      // spróbuj ślizgu wzdłuż przeszkody: sam X albo sam Z
      const onlyLat = state.lat + (-(fz * state.speed * sdt)) / mPerDegLat;
      const onlyLon = state.lon + (fx * state.speed * sdt) / mPerDegLon;
      if (!physIsLand(onlyLat, state.lon)) { state.lat = onlyLat; }
      else if (!physIsLand(state.lat, onlyLon)) { state.lon = onlyLon; }
      aground = true;
      state.speed *= 0.5;
      if (Math.abs(state.speed) < 0.4) state.speed = 0;
      break;
    } else {
      state.lat = nLat; state.lon = nLon;
    }
  }

  // Pozycja 3D + kołysanie na fali
  const { x, z } = grid.latLonToWorld(state.lat, state.lon);
  const y = waveHeight(x, z, t);
  boat.position.set(x, y + 0.4, z);
  boat.rotation.y = -state.heading;
  boat.rotation.z = Math.sin(t * 1.1) * 0.03 - rudder * Math.min(1, Math.abs(state.speed) / 10) * 0.06;
  boat.rotation.x = Math.sin(t * 0.9 + 1) * 0.02 + state.throttle * 0.015;

  // Marker: stały rozmiar na ekranie, tylko gdy kamera daleko.
  const camDist = camera.position.distanceTo(boat.position);
  const showMarker = camDist > 900;
  boatMarker.visible = showMarker;
  if (showMarker) {
    boatMarker.position.set(x, y + 80, z);
    const s = camDist * 0.055;
    boatMarker.scale.set(s, s, 1);
  }

  // Ślad
  if (t - lastTrailPush > 0.4 && Math.abs(state.speed) > 0.5) {
    lastTrailPush = t;
    trailPts.push(new THREE.Vector3(x, 1.2, z));
    trailGeoPts.push({ lat: state.lat, lon: state.lon });
    if (trailPts.length > 2000) { trailPts.shift(); trailGeoPts.shift(); }
    const attr = trailLine.geometry.attributes.position;
    for (let i = 0; i < trailPts.length; i++) {
      attr.setXYZ(i, trailPts[i].x, trailPts[i].y, trailPts[i].z);
    }
    trailLine.geometry.setDrawRange(0, trailPts.length);
    attr.needsUpdate = true;
  }

  // Kamera podążająca (zachowuje orbitę użytkownika)
  if (follow) {
    const target = new THREE.Vector3(x, y, z);
    const delta = target.clone().sub(controls.target).multiplyScalar(0.18);
    controls.target.add(delta);
    camera.position.add(delta);
  } else {
    controls.target.set(x, y, z);
  }
}

// ---------------------------------------------------------------------------
// HUD: głębokość, echosonda, minimapa
// ---------------------------------------------------------------------------
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function fmtLat(lat) { return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}`; }
function fmtLon(lon) { return `${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`; }

function updateHud(t) {
  if (t - lastHud < 0.1) return;
  lastHud = t;
  const depth = grid ? physDepthAt(state.lat, state.lon) : NaN;
  const kn = Math.abs(state.speed) * MS_TO_KT;
  const hdg = (state.heading * 180 / Math.PI + 360) % 360;

  hud.depth.textContent = Number.isNaN(depth) ? '—' : depth.toFixed(1);
  hud.pos.textContent = `${fmtLat(state.lat)}  ${fmtLon(state.lon)}`;
  hud.speed.textContent = kn.toFixed(1);
  hud.course.textContent = `${hdg.toFixed(0)}° ${COMPASS[Math.round(hdg / 45) % 8]}`;
  hud.throttle.style.width = `${Math.abs(state.throttle) * 100}%`;
  hud.throttle.style.background = state.throttle < 0 ? '#e06c5b' : '#5fd68a';

  let status, cls;
  if (outOfMap) { status = 'KONIEC MAPY — zawróć'; cls = 'warn'; }
  else if (aground) { status = 'MIELIZNA! Osiadłeś na dnie'; cls = 'bad'; }
  else if (depth < 5) { status = 'Uwaga: bardzo płytko!'; cls = 'warn'; }
  else { status = 'Na wodzie — bezpieczna głębokość'; cls = 'ok'; }
  hud.status.textContent = status;
  hud.status.className = 'status ' + cls;

  if (t - lastEchoPush > 0.15) {
    lastEchoPush = t;
    echoHistory.push(Number.isNaN(depth) ? 0 : depth);
    if (echoHistory.length > 220) echoHistory.shift();
  }
  drawEcho();
  drawMini();
}

function drawEcho() {
  const cv = hud.echo, ctx = cv.getContext('2d');
  const W = (cv.width = cv.clientWidth * 2 || 520);
  const H = (cv.height = 170);
  ctx.fillStyle = '#06121d';
  ctx.fillRect(0, 0, W, H);
  if (!echoHistory.length) return;
  const maxD = Math.max(15, ...echoHistory) * 1.15;
  // siatka
  ctx.strokeStyle = 'rgba(120,200,255,0.15)';
  ctx.fillStyle = 'rgba(120,200,255,0.6)';
  ctx.font = '20px system-ui';
  ctx.lineWidth = 1;
  for (let m = 0; m <= maxD; m += niceStep(maxD)) {
    const y = 14 + (m / maxD) * (H - 28);
    ctx.beginPath(); ctx.moveTo(44, y); ctx.lineTo(W - 6, y); ctx.stroke();
    ctx.fillText(`${m.toFixed(0)}m`, 4, y + 6);
  }
  // profil dna
  ctx.beginPath();
  const n = echoHistory.length;
  echoHistory.forEach((d, i) => {
    const x = 44 + (i / 219) * (W - 50);
    const y = 14 + (d / maxD) * (H - 28);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.strokeStyle = '#5fd68a';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineTo(44 + ((n - 1) / 219) * (W - 50), H - 6);
  ctx.lineTo(44, H - 6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(95,214,138,0.18)';
  ctx.fill();
}
function niceStep(maxD) {
  const raw = maxD / 4;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

let miniImg = null;
function renderMiniBase() {
  const off = document.createElement('canvas');
  off.width = grid.nLon; off.height = grid.nLat;
  const ctx = off.getContext('2d');
  const img = ctx.createImageData(grid.nLon, grid.nLat);
  const c = [0, 0, 0];
  for (let r = 0; r < grid.nLat; r++) {
    for (let col = 0; col < grid.nLon; col++) {
      // rząd 0 = południe -> na canvasie na dół
      const e = grid.data[r * grid.nLon + col];
      depthColor(e, c);
      const y = grid.nLat - 1 - r;
      const i = (y * grid.nLon + col) * 4;
      img.data[i] = c[0] * 255; img.data[i + 1] = c[1] * 255; img.data[i + 2] = c[2] * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  miniImg = off;
}

function drawMini() {
  const cv = hud.mini, ctx = cv.getContext('2d');
  const S = (cv.width = cv.clientWidth * 2 || 440);
  cv.height = S;
  if (!miniImg) return;
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(miniImg, 0, 0, S, S * (grid.nLat / grid.nLon));
  const H = S * (grid.nLat / grid.nLon);
  const toXY = (lat, lon) => [
    ((lon - grid.lon0) / (grid.lon1 - grid.lon0)) * S,
    (1 - (lat - grid.lat0) / (grid.lat1 - grid.lat0)) * H,
  ];
  // granice państw (tiny-world-map)
  if (showBorders && borderData) {
    ctx.strokeStyle = 'rgba(74,31,24,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (const ring of borderData.borders) {
      let pen = false;
      for (const [lat, lon] of ring) {
        if (!inGridBounds(lat, lon, 0.02)) { pen = false; continue; }
        const [x, y] = toXY(lat, lon);
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        pen = true;
      }
    }
    ctx.stroke();
  }
  // ślad
  ctx.strokeStyle = '#ffe08a';
  ctx.lineWidth = 3;
  ctx.beginPath();
  trailGeoPts.forEach((p, i) => {
    const [x, y] = toXY(p.lat, p.lon);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
  // łódka
  const [bx, by] = toXY(state.lat, state.lon);
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(state.heading);
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0b2233';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -11); ctx.lineTo(7, 8); ctx.lineTo(0, 4); ctx.lineTo(-7, 8);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.font = 'bold 22px system-ui';
  ctx.fillText('N ↑', 8, 26);
  // nazwy państw (tylko w granicach regionu)
  if (showLabels && borderData) {
    ctx.font = 'bold 19px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (const { name, lat, lon } of borderData.labels) {
      if (!inGridBounds(lat, lon, 0.02)) continue;
      const [x, y] = toXY(lat, lon);
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(6,20,32,0.8)';
      ctx.strokeText(name, x, y);
      ctx.fillStyle = '#f2f7fb';
      ctx.fillText(name, x, y);
    }
    ctx.textAlign = 'start';
  }
}

// ---------------------------------------------------------------------------
// Ładowanie regionu (+ leniwy upgrade do pełnej rozdzielczości)
// ---------------------------------------------------------------------------
// Start jest natychmiastowy na zgrubnej siatce (~3,5 km, 1,4 MB); pełna
// rozdzielczość (~580 m, PNG 3,5 MB) dociąga się w tle i podmienia siatkę
// bez resetowania łódki ani kamery. Kształty przy oddaleniu pilnują mipmapy.
let fullGrid = null;   // zdekodowany PNG (cache na sesję)
let upgradeToken = 0;
let coastTile = null;  // hi-res kafel polskiego wybrzeża (stride 2, ~230 m), cache na sesję
let tileMesh = null;   // overlay mesh kafla (null = brak nakładki dla tego regionu)
let tileLoading = false;

function refreshMeshes() {
  buildTerrain();
  buildTileOverlay(); // nakładka hi-res, jeśli baza ją zawiera (tylko Bałtyk — cały)
  try {
    buildBorders();
  } catch (err) {
    // Granice to warstwa niekrytyczna — nie blokuj gry, gdy coś pójdzie nie tak.
    console.warn('Nie udało się zbudować granic państw:', err);
  }
  renderMiniBase();
}

async function loadRegion(id) {
  hud.loading.style.display = 'flex';
  const reg = REGIONS.find((r) => r.id === id);
  hud.loadingText.textContent = `Pobieranie batymetrii: ${reg.name}…`;
  if (id === 'baltic-full' && fullGrid) grid = fullGrid;
  else grid = await BathymetryGrid.load(id);
  refreshMeshes();
  resetBoatToStart(reg.start.lat, reg.start.lon);
  const { x, z } = grid.latLonToWorld(state.lat, state.lon);
  controls.target.set(x, 0, z);
  camera.position.set(x + 110, 100, z + 215); // lekko z góry: widać łódkę i dno
  hud.loading.style.display = 'none';
  toast(`Załadowano: ${reg.name} — min. głębokość ${Math.abs(grid.stats.min).toFixed(0)} m`);
  document.title = `Batymetry Boat — ${reg.name}`;
  if (id === 'baltic-full' && !fullGrid) kickFullResUpgrade();
  else if (id === 'baltic-full' && !coastTile) kickTileUpgrade(); // powrót do regionu: baza z cache
}

/** Dociąga pełną rozdzielczość w tle i podmienia siatkę w locie (bez resetu). */
async function kickFullResUpgrade() {
  const my = ++upgradeToken;
  toast('Dociąganie pełnej rozdzielczości dna (~580 m)…');
  try {
    const g = await BathymetryGrid.loadResPNG();
    fullGrid = g;
    if (my !== upgradeToken || grid.id !== 'baltic-full') return; // użytkownik zmienił region
    grid = fullGrid;
    refreshMeshes();
    toast('Pełna rozdzielczość gotowa — brzegi i rynny dokładniejsze');
    kickTileUpgrade(); // dalej: detal wybrzeża (~230 m) jako nakładka
  } catch (err) {
    console.warn('Upgrade pełnej rozdzielczości nieudany, zostaje siatka zgrubna:', err.message);
    kickTileUpgrade(); // kafel doklei się i na zgrubną bazę
  }
}

/** Ustawia tempo testowe (mnożnik prędkości). Zwraca znormalizowaną wartość. */
function setTempo(s) {
  const allowed = [1, 2, 5, 10, 25, 50, 100, 500];
  speedScale = allowed.includes(Number(s)) ? Number(s) : 1;
  if (hud.tempo) hud.tempo.value = String(speedScale);
  if (hud.tempoBadge) {
    hud.tempoBadge.style.display = speedScale > 1 ? 'inline-block' : 'none';
    hud.tempoBadge.textContent = `TEST ×${speedScale}`;
  }
  return speedScale;
}

let toastTimer = 0;
function toast(msg) {  hud.toast.textContent = msg;
  hud.toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (hud.toast.style.opacity = '0'), 4200);
}

// ---------------------------------------------------------------------------
// Wejście: klawiatura + dotyk
// ---------------------------------------------------------------------------
function bindInput() {
  const map = {
    KeyW: 'w', ArrowUp: 'w', KeyS: 's', ArrowDown: 's',
    KeyA: 'a', ArrowLeft: 'a', KeyD: 'd', ArrowRight: 'd',
  };
  addEventListener('keydown', (e) => {
    if (map[e.code]) { keys[map[e.code]] = true; e.preventDefault(); }
    if (e.code === 'KeyC') { follow = !follow; hud.followCam.checked = follow; toast(follow ? 'Kamera podąża za łódką' : 'Kamera swobodna (C = powrót)'); }
    if (e.code === 'KeyR') {
      const reg = REGIONS.find((r) => r.id === hud.region.value);
      resetBoatToStart(reg.start.lat, reg.start.lon);
      toast('Wrócono na pozycję startową');
    }
    // Szybkie tempa testowe: 1 = realistycznie, 2 = 10×, 3 = 100×, 4 = 500×
    if (e.code === 'Digit1') { setTempo(1); toast('Tempo realistyczne (1×)'); }
    if (e.code === 'Digit2') { setTempo(10); toast('Tempo testowe 10×'); }
    if (e.code === 'Digit3') { setTempo(100); toast('Tempo testowe 100×'); }
    if (e.code === 'Digit4') { setTempo(500); toast('Tempo testowe 500× — odrzutowiec'); }
  });
  addEventListener('keyup', (e) => {
    if (map[e.code]) keys[map[e.code]] = false;
  });
  document.querySelectorAll('[data-key]').forEach((btn) => {
    const k = btn.dataset.key;
    const on = (e) => { e.preventDefault(); keys[k] = true; };
    const off = (e) => { e.preventDefault(); keys[k] = false; };
    btn.addEventListener('pointerdown', on);
    btn.addEventListener('pointerup', off);
    btn.addEventListener('pointerleave', off);
    btn.addEventListener('pointercancel', off);
  });
  hud.region.addEventListener('change', () => loadRegion(hud.region.value));
  hud.vex.addEventListener('input', () => {
    VEX = parseFloat(hud.vex.value);
    hud.vexVal.textContent = `${VEX}×`;
    applyVex();
  });
  hud.waterXray.addEventListener('change', applyWaterXray);
  hud.tempo.addEventListener('change', () => {
    setTempo(hud.tempo.value);
    toast(speedScale > 1 ? `Tempo testowe ${speedScale}× (nierealistyczne)` : 'Tempo realistyczne (1×)');
  });
  hud.followCam.addEventListener('change', () => {
    follow = hud.followCam.checked;
  });
  hud.bordersToggle.addEventListener('change', () => {
    showBorders = hud.bordersToggle.checked;
    if (borderGroup) borderGroup.visible = showBorders;
  });
  hud.labelsToggle.addEventListener('change', () => {
    showLabels = hud.labelsToggle.checked;
    for (const { sprite } of labelSprites) sprite.visible = showLabels;
  });
}

// ---------------------------------------------------------------------------
// Pętla główna
// ---------------------------------------------------------------------------
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  if (grid) {
    updateBoat(dt, t);
    animateWater(t);
    updateHud(t);
    updateLabelScales();
  }
  // Mgła dopasowana do oddalenia: czytelna z bliska i z wysokości całego Bałtyku.
  const distToTarget = camera.position.distanceTo(controls.target);
  scene.fog.near = distToTarget * 1.1;
  scene.fog.far = distToTarget * 4.0;
  controls.update();
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
async function main() {
  for (const r of REGIONS) {
    const opt = document.createElement('option');
    opt.value = r.id; opt.textContent = r.name;
    hud.region.appendChild(opt);
  }
  initScene();
  bindInput();
  setTempo(1);
  showBorders = hud.bordersToggle.checked;
  showLabels = hud.labelsToggle.checked;
  loop();
  await loadBorderData(); // granice państw (nieblokujące dla reszty UI poza regionem)
  try {
    await loadRegion(REGIONS[0].id);
  } catch (err) {
    hud.loadingText.textContent = `Błąd ładowania danych: ${err.message}`;
    console.error(err);
  }
}

main();
