import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BathymetryGrid, depthColor } from './bathymetry.js';

// ---------------------------------------------------------------------------
// Konfiguracja
// ---------------------------------------------------------------------------
const REGIONS = [
  { id: 'baltic-south', name: 'Bałtyk Południowy — Zatoka Gdańska (detal)', start: { lat: 54.52, lon: 18.95 } },
  { id: 'baltic-overview', name: 'Bałtyk — przegląd (niski detal)', start: { lat: 55.2, lon: 18.5 } },
];
let VEX = 20; // przewyższenie pionowe dna (wizualizacja)
const MS_TO_KT = 1.94384;

const $ = (id) => document.getElementById(id);
const hud = {
  loading: $('loading'), loadingText: $('loading-text'),
  depth: $('depth-value'), pos: $('pos-value'), speed: $('speed-value'),
  course: $('course-value'), status: $('status-value'), throttle: $('throttle-fill'),
  echo: $('echo'), mini: $('mini'), toast: $('toast'),
  region: $('region-select'), vex: $('vex'), vexVal: $('vex-val'),
  waterXray: $('water-xray'), followCam: $('follow-cam'),
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
let keys = { w: false, s: false, a: false, d: false };
let follow = true;
let aground = false, outOfMap = false;
let lastEchoPush = 0, lastTrailPush = 0, lastHud = 0;

const state = {
  lat: 54.52, lon: 18.95,
  heading: Math.PI * 0.75, // rad, 0 = N, zgodnie ze wskazówkami zegara
  speed: 0,                // m/s, ujemna = wstecz
  throttle: 0,             // -1..1 (wizualnie na HUD)
};

// Publiczne API dostępu do głębokości (wymaganie: "dostęp do głębokości do dna względem łódki")
window.boatAPI = {
  getDepth: () => (grid ? grid.depthAt(state.lat, state.lon) : NaN),
  getElevation: () => (grid ? grid.sampleElevation(state.lat, state.lon) : NaN),
  getPosition: () => ({ lat: state.lat, lon: state.lon }),
  getSpeedKnots: () => Math.abs(state.speed) * MS_TO_KT,
  getHeadingDeg: () => (state.heading * 180 / Math.PI + 360) % 360,
  getRegion: () => grid?.id,
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

  camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 2, 500000);
  camera.position.set(0, 90, 220);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 15;
  controls.maxDistance = 40000;
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

  // Kadłub: skrzynia + dziób (klin), rufa. Dziób w stronę -Z.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(7, 3, 16), hullMat);
  hull.position.y = 1.2;
  g.add(hull);
  const bowShape = new THREE.CylinderGeometry(0.01, 3.5, 3, 4, 1);
  const bow = new THREE.Mesh(bowShape, hullMat);
  bow.rotation.y = Math.PI / 4;
  bow.scale.set(1, 1, 1.6);
  bow.position.set(0, 1.2, -10.6);
  bow.rotation.x = 0;
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
  const geo = new THREE.PlaneGeometry(widthM, depthM, nLon - 1, nLat - 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const baseElev = new Float32Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const { lat, lon } = grid.worldToLatLon(x, z);
    let e = grid.sampleNearest(lat, lon);
    if (Number.isNaN(e)) e = 2; // ląd bez danych: lekko nad wodą
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

/** Tekstura dna z siatki batymetrii. Canvas: góra = północ (v=1 w PlaneGeometry). */
function makeSeabedTexture() {
  const { nLat, nLon } = grid;
  const cv = document.createElement('canvas');
  cv.width = nLon; cv.height = nLat;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(nLon, nLat);
  const c = [0, 0, 0];
  for (let r = 0; r < nLat; r++) {
    for (let col = 0; col < nLon; col++) {
      let e = grid.data[r * nLon + col];
      if (Number.isNaN(e)) e = 2;
      depthColor(e, c);
      const y = nLat - 1 - r; // wiersz 0 (południe) na dół canvasu
      const i = (y * nLon + col) * 4;
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
  if (!grid.isLand(lat, lon) && grid.depthAt(lat, lon) > 4) return { lat, lon };
  for (let r = 0.005; r < 0.5; r += 0.005) {
    for (let a = 0; a < 12; a++) {
      const la = lat + Math.sin((a / 12) * Math.PI * 2) * r;
      const lo = lon + Math.cos((a / 12) * Math.PI * 2) * r;
      if (grid.inBounds(la, lo) && !grid.isLand(la, lo) && grid.depthAt(la, lo) > 4)
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
  const ACCEL = 7, MAX_FWD = 16, MAX_REV = -5;
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
  const mPerDegLon = 111320 * Math.cos((state.lat * Math.PI) / 180);
  // dz (metry, ujemne = północ); dlat = -dz / mPerDegLat; dlon = dx / mPerDegLon
  const nLat = state.lat + (-(fz * state.speed * dt)) / mPerDegLat;
  const nLon = state.lon + (fx * state.speed * dt) / mPerDegLon;

  aground = false; outOfMap = false;
  if (!grid.inBounds(nLat, nLon, 0.002)) {
    outOfMap = true;
    state.speed *= 0.9;
  } else if (grid.isLand(nLat, nLon)) {
    // spróbuj ślizgu wzdłuż przeszkody: sam X albo sam Z
    const onlyLat = state.lat + (-(fz * state.speed * dt)) / mPerDegLat;
    const onlyLon = state.lon + (fx * state.speed * dt) / mPerDegLon;
    if (!grid.isLand(onlyLat, state.lon)) { state.lat = onlyLat; }
    else if (!grid.isLand(state.lat, onlyLon)) { state.lon = onlyLon; }
    aground = true;
    state.speed *= 0.5;
    if (Math.abs(state.speed) < 0.4) state.speed = 0;
  } else {
    state.lat = nLat; state.lon = nLon;
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
  const depth = grid ? grid.depthAt(state.lat, state.lon) : NaN;
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
}

// ---------------------------------------------------------------------------
// Ładowanie regionu
// ---------------------------------------------------------------------------
async function loadRegion(id) {
  hud.loading.style.display = 'flex';
  const reg = REGIONS.find((r) => r.id === id);
  hud.loadingText.textContent = `Pobieranie batymetrii: ${reg.name}…`;
  grid = await BathymetryGrid.load(id);
  buildTerrain();
  renderMiniBase();
  resetBoatToStart(reg.start.lat, reg.start.lon);
  const { x, z } = grid.latLonToWorld(state.lat, state.lon);
  controls.target.set(x, 0, z);
  camera.position.set(x + 90, 70, z + 170);
  hud.loading.style.display = 'none';
  toast(`Załadowano: ${reg.name} — min. głębokość ${Math.abs(grid.stats.min).toFixed(0)} m`);
  document.title = `Batymetry Boat — ${reg.name}`;
}

let toastTimer = 0;
function toast(msg) {
  hud.toast.textContent = msg;
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
  hud.followCam.addEventListener('change', () => {
    follow = hud.followCam.checked;
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
  }
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
  loop();
  try {
    await loadRegion(REGIONS[0].id);
  } catch (err) {
    hud.loadingText.textContent = `Błąd ładowania danych: ${err.message}`;
    console.error(err);
  }
}

main();
