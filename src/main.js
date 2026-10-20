import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import * as N from './nurbs.js';

const $ = (id) => document.getElementById(id);
const view = $('view');
const app = $('app');

// ---------- Renderer y escena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // la sombra se calcula una vez por cuadro aunque haya dos vistas
renderer.setScissorTest(true);
view.prepend(renderer.domElement);
$('loading').remove();

const scene = new THREE.Scene();
const diagBg = new THREE.Color('#14171b');
const renderBg = (() => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#2b3038'); grd.addColorStop(0.6, '#1a1d22'); grd.addColorStop(1, '#101215');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
// Capa 1 = solo en la vista de diagnóstico (cuadrícula, isoparamétricas, polígonos de control, peines)
const DIAG = 1;
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;

const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(4, 9, 3);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
key.shadow.radius = 6;
scene.add(key);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(30, 30, 0x3a414a, 0x23282e);
grid.position.y = 0.001;
grid.layers.set(DIAG);
scene.add(grid);
const gridXY = new THREE.GridHelper(30, 30, 0x4a3a22, 0x2a251d);
gridXY.rotation.x = Math.PI / 2;
gridXY.layers.set(DIAG);
gridXY.visible = false;
scene.add(gridXY);

// ---------- Navegación ----------
// Estilo Alias: Shift + Alt (Option en Mac) y botón izquierdo = girar, central = desplazar, derecho = acercar.
// Sin esas teclas el ratón queda libre para seleccionar. La rueda siempre hace zoom.
const NAV_ALIAS = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.DOLLY };
const NAV_OFF = { LEFT: -1, MIDDLE: -1, RIGHT: -1 };
const NAV_SIMPLE = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
const NAV_HELP = {
  alias: 'Mantén Shift + Alt (Option en Mac) y arrastra: botón izquierdo gira, central desplaza, derecho acerca o aleja. Doble clic sobre un objeto: mover ahí el pivote.',
  simple: 'Para touchpad. Arrastra para girar, dos dedos para zoom, botón derecho para desplazar. Shift + arrastrar: selección por recuadro.',
};
let navStyle = 'alias';
let navHeld = false, shiftHeld = false;
function applyNav() {
  if (navStyle === 'simple') orbit.mouseButtons = shiftHeld ? { ...NAV_SIMPLE, LEFT: -1 } : NAV_SIMPLE;
  else orbit.mouseButtons = navHeld ? NAV_ALIAS : NAV_OFF;
  renderer.domElement.style.cursor = navStyle === 'alias' && navHeld ? 'move' : '';
}
function setNavStyle(st) {
  navStyle = st;
  document.querySelectorAll('[data-nav]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.nav === st)));
  $('nav-help').textContent = NAV_HELP[st];
  updateHint();
  applyNav();
}
function trackMods(e) {
  const held = e.shiftKey && e.altKey;
  if (held !== navHeld || e.shiftKey !== shiftHeld) { navHeld = held; shiftHeld = e.shiftKey; applyNav(); }
}
addEventListener('keydown', (e) => { if (e.key === 'Alt') e.preventDefault(); trackMods(e); });
addEventListener('keyup', trackMods);
addEventListener('pointerdown', trackMods, true);
addEventListener('blur', () => { navHeld = shiftHeld = false; applyNav(); });
document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => setNavStyle(b.dataset.nav)));

// ---------- Pivote ----------
// Doble clic sobre un objeto (o el suelo) mueve ahí el centro de giro; L lo lleva a la selección.
const pivotMarker = (() => {
  const g = new THREE.Group();
  const m = new THREE.LineBasicMaterial({ color: '#f0a63a', depthTest: false, transparent: true });
  const s = 0.5, pts = [-s, 0, 0, s, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, m));
  g.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color: '#f0a63a', depthTest: false, transparent: true })));
  g.renderOrder = 20; g.children.forEach((c) => (c.renderOrder = 20));
  g.visible = false;
  scene.add(g);
  return g;
})();
let pivotAnim = null, pivotShowUntil = 0, orbiting = false;
orbit.addEventListener('start', () => { orbiting = true; });
orbit.addEventListener('end', () => { orbiting = false; pivotShowUntil = performance.now() + 600; });
function setPivot(pt) {
  pivotAnim = { from: orbit.target.clone(), to: pt.clone(), t0: performance.now() };
  pivotShowUntil = performance.now() + 1500;
}

// ---------- Materiales ----------
const materials = {
  paint: new THREE.MeshPhysicalMaterial({ color: '#b0121c', metalness: 0.55, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.03, side: THREE.DoubleSide }),
  black: new THREE.MeshPhysicalMaterial({ color: '#111216', metalness: 0.7, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide }),
  pearl: new THREE.MeshPhysicalMaterial({ color: '#1d3f8c', metalness: 0.6, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.6, iridescenceIOR: 1.4, side: THREE.DoubleSide }),
  alu: new THREE.MeshPhysicalMaterial({ color: '#cfd3d8', metalness: 1, roughness: 0.22, side: THREE.DoubleSide }),
  chrome: new THREE.MeshPhysicalMaterial({ color: '#ffffff', metalness: 1, roughness: 0.04, side: THREE.DoubleSide }),
  ceram: new THREE.MeshPhysicalMaterial({ color: '#f1ede6', metalness: 0, roughness: 0.18, clearcoat: 0.8, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
  glass: new THREE.MeshPhysicalMaterial({ color: '#e4f5ff', metalness: 0, roughness: 0.03, transmission: 1, thickness: 0.4, ior: 1.5, side: THREE.DoubleSide }),
  plastic: new THREE.MeshPhysicalMaterial({ color: '#1c1d20', metalness: 0, roughness: 0.55, side: THREE.DoubleSide }),
  clay: new THREE.MeshPhysicalMaterial({ color: '#b3a08c', metalness: 0, roughness: 0.85, side: THREE.DoubleSide }),
};
const MAT_NAMES = { paint: 'Pintura roja', black: 'Negro metalizado', pearl: 'Azul perlado', alu: 'Aluminio', chrome: 'Cromo', ceram: 'Cerámica', glass: 'Vidrio', plastic: 'Plástico negro', clay: 'Arcilla' };
const zebraMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uFreq: { value: 14 } },
  vertexShader: `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalize(normalMatrix * normal);
      vV = mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform float uFreq; varying vec3 vN; varying vec3 vV;
    void main() {
      vec3 n = normalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 r = reflect(normalize(vV), n);
      float s = (r.y * 0.5 + 0.5) * uFreq;
      float f = fract(s);
      float w = fwidth(s) * 1.2;
      float stripe = smoothstep(0.5 - w, 0.5 + w, f) - smoothstep(1.0 - w, 1.0, f);
      float shade = 0.82 + 0.18 * max(dot(n, normalize(vec3(0.3, 1.0, 0.5))), 0.0);
      gl_FragColor = vec4(vec3(mix(0.06, 0.96, stripe) * shade), 1.0);
    }`,
});
zebraMat.extensions = { derivatives: true };
const curvMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
const wireMat = new THREE.MeshBasicMaterial({ color: '#57b6ff', wireframe: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide });

const lineMats = [];
const LM = (o) => { const m = new LineMaterial(o); lineMats.push(m); return m; };
const curveMat = LM({ color: 0xe9edf2, linewidth: 2.5 });
const curveSelMat = LM({ color: 0xf0a63a, linewidth: 3 });
const draftMat = LM({ color: 0xf0a63a, linewidth: 2 });
const edgeSelMat = LM({ color: 0xf0a63a, linewidth: 2.5 });
const isoMat = new THREE.LineBasicMaterial({ color: '#0b0d10', transparent: true, opacity: 0.35 });
const isoSelMat = new THREE.LineBasicMaterial({ color: '#f0a63a', transparent: true, opacity: 0.75 });
const hullMat = new THREE.LineDashedMaterial({ color: '#57b6ff', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.7 });
const combMat = new THREE.LineBasicMaterial({ color: '#f0a63a', transparent: true, opacity: 0.55 });
const envMat = new THREE.LineBasicMaterial({ color: '#f0a63a' });
const handleGeo = new THREE.SphereGeometry(0.075, 16, 12);
const handleMat = new THREE.MeshBasicMaterial({ color: '#57b6ff', depthTest: false, transparent: true });
const handleSelMat = new THREE.MeshBasicMaterial({ color: '#f0a63a', depthTest: false, transparent: true });

let diagMode = 'zebra', layout = 'split', matKey = 'paint', res = 90, combScale = 0.8;

// ---------- Objetos de la escena ----------
const objects = [];
let nextId = 1;
const counters = {};
const nameFor = (base) => { counters[base] = (counters[base] || 0) + 1; return `${base} ${counters[base]}`; };

function addSurface(data, base = 'Superficie') {
  const obj = { id: nextId++, kind: 'surface', name: nameFor(base), data, mat: matKey, visible: true, parts: {} };
  const p = obj.parts;
  p.mesh = new THREE.Mesh(new THREE.BufferGeometry(), materials[obj.mat]);
  p.mesh.castShadow = true;
  p.mesh.userData.obj = obj;
  p.iso = new THREE.LineSegments(new THREE.BufferGeometry(), isoMat); p.iso.layers.set(DIAG);
  p.hull = new THREE.LineSegments(new THREE.BufferGeometry(), hullMat); p.hull.layers.set(DIAG);
  p.edge = new Line2(new LineGeometry(), edgeSelMat); p.edge.renderOrder = 6;
  p.handles = new THREE.Group();
  scene.add(p.mesh, p.iso, p.hull, p.edge, p.handles);
  objects.push(obj);
  updateObject(obj);
  refreshOutliner();
  return obj;
}

function addCurve(data, base = 'Curva') {
  const obj = { id: nextId++, kind: 'curve', name: nameFor(base), data, visible: true, parts: {} };
  const p = obj.parts;
  p.line = new Line2(new LineGeometry(), curveMat); p.line.renderOrder = 5;
  p.pick = new THREE.Line(new THREE.BufferGeometry()); // invisible, solo para seleccionar con el ratón
  p.pick.userData.obj = obj;
  p.hull = new THREE.Line(new THREE.BufferGeometry(), hullMat); p.hull.layers.set(DIAG);
  p.comb = new THREE.LineSegments(new THREE.BufferGeometry(), combMat); p.comb.layers.set(DIAG);
  p.env = new THREE.Line(new THREE.BufferGeometry(), envMat); p.env.layers.set(DIAG);
  p.handles = new THREE.Group();
  scene.add(p.line, p.hull, p.comb, p.env, p.handles);
  objects.push(obj);
  updateObject(obj);
  refreshOutliner();
  return obj;
}

function removeObject(obj) {
  for (const o of Object.values(obj.parts)) { o.geometry?.dispose(); scene.remove(o); }
  objects.splice(objects.indexOf(obj), 1);
  selObjs.splice(0, selObjs.length, ...selObjs.filter((o) => o !== obj));
  for (const [k, ref] of selCVs) if (ref.obj === obj) selCVs.delete(k);
}

const setGeo = (o, g) => { o.geometry.dispose(); o.geometry = g; };
const posGeo = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g; };
const line2Geo = (pts) => { const g = new LineGeometry(); g.setPositions(pts); return g; };

function updateObject(obj) {
  if (obj.kind === 'surface') updateSurface(obj); else updateCurve(obj);
  rebuildHandles(obj);
  applyVisibility(obj);
}

function updateSurface(obj) {
  const p = obj.parts, d = obj.data;
  const s = N.surfaceOf(d);
  const geo = new ParametricGeometry((u, v, t) => s.getPoint(u, v, t), res, res);
  if (diagMode === 'curv') curvatureColors(geo, res);
  setGeo(p.mesh, geo);
  // Isoparamétricas en los límites de cada span, como en Alias
  const iso = [], S = 60, t = new THREE.Vector3();
  const seg = (fn) => { for (let k = 0; k < S; k++) { fn(k / S, t); iso.push(t.x, t.y, t.z); fn((k + 1) / S, t); iso.push(t.x, t.y, t.z); } };
  N.uniqueKnots(d.knotsU).forEach((u) => seg((a, tt) => s.getPoint(u, a, tt)));
  N.uniqueKnots(d.knotsV).forEach((v) => seg((a, tt) => s.getPoint(a, v, tt)));
  setGeo(p.iso, posGeo(iso));
  const hull = [], nu = d.cvs.length, nv = d.cvs[0].length;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = d.cvs[i][j];
    if (i < nu - 1) { const b = d.cvs[i + 1][j]; hull.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    if (j < nv - 1) { const b = d.cvs[i][j + 1]; hull.push(a.x, a.y, a.z, b.x, b.y, b.z); }
  }
  setGeo(p.hull, posGeo(hull));
  p.hull.computeLineDistances();
  const loop = [], E = 40;
  const at = (u, v) => { s.getPoint(u, v, t); loop.push(t.x, t.y, t.z); };
  for (let k = 0; k <= E; k++) at(k / E, 0);
  for (let k = 1; k <= E; k++) at(1, k / E);
  for (let k = 1; k <= E; k++) at(1 - k / E, 1);
  for (let k = 1; k <= E; k++) at(0, 1 - k / E);
  setGeo(p.edge, line2Geo(loop));
}

function updateCurve(obj) {
  const p = obj.parts, d = obj.data;
  const crv = N.curveOf(d), pts = [], S = 200;
  for (let s = 0; s <= S; s++) { const q = crv.getPoint(s / S); pts.push(q.x, q.y, q.z); }
  setGeo(p.line, line2Geo(pts));
  setGeo(p.pick, posGeo(pts));
  setGeo(p.hull, posGeo(d.cvs.flatMap((q) => [q.x, q.y, q.z])));
  p.hull.computeLineDistances();
  buildComb(p, crv);
}

function buildComb(p, crv) {
  const S = 140, h = 1e-3, segs = [], env = [];
  const at = (t) => crv.getPoint(THREE.MathUtils.clamp(t, 0, 1));
  for (let s = 0; s <= S; s++) {
    const t = s / S, t0 = Math.max(0, t - h), t1 = Math.min(1, t + h), dt = t1 - t0;
    const q = at(t), a = at(t0), b = at(t1), m = at((t0 + t1) / 2);
    const d1 = b.clone().sub(a).divideScalar(dt);
    const d2 = b.clone().add(a).sub(m.clone().multiplyScalar(2)).divideScalar((dt / 2) ** 2);
    const sp = d1.length();
    if (sp < 1e-6) continue;
    const kappa = d1.clone().cross(d2).length() / sp ** 3;
    const nrm = d2.clone().sub(d1.clone().multiplyScalar(d1.dot(d2) / (sp * sp)));
    if (nrm.lengthSq() < 1e-12) nrm.set(0, 0, 0); else nrm.normalize();
    const tip = q.clone().addScaledVector(nrm, -kappa * combScale);
    if (s % 2 === 0) segs.push(q.x, q.y, q.z, tip.x, tip.y, tip.z);
    env.push(tip.x, tip.y, tip.z);
  }
  setGeo(p.comb, posGeo(segs));
  setGeo(p.env, posGeo(env));
}

function curvatureColors(geo, seg) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const n = seg + 1, count = pos.count;
  const k = new Float32Array(count);
  const P = (i) => new THREE.Vector3().fromBufferAttribute(pos, i);
  const idx = (a, b) => Math.min(n - 1, Math.max(0, a)) * n + Math.min(n - 1, Math.max(0, b));
  let maxAbs = 1e-6;
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    const ia = Math.min(n - 2, Math.max(1, a)), ib = Math.min(n - 2, Math.max(1, b));
    const c = idx(ia, ib), p = P(c);
    const nb = [idx(ia - 1, ib), idx(ia + 1, ib), idx(ia, ib - 1), idx(ia, ib + 1)].map(P);
    const avg = nb.reduce((s, q) => s.add(q), new THREE.Vector3()).multiplyScalar(0.25);
    const e2 = nb.reduce((s, q) => s + q.distanceToSquared(p), 0) / 4;
    const val = (2 * avg.sub(p).dot(new THREE.Vector3().fromBufferAttribute(nor, c))) / Math.max(e2, 1e-9);
    k[a * n + b] = val;
    maxAbs = Math.max(maxAbs, Math.abs(val));
  }
  const ramp = ['#2b6cff', '#27c2b5', '#e9e46a', '#ff6a3d', '#d81b4a'].map((h) => new THREE.Color(h));
  const colors = new Float32Array(count * 3), tmp = new THREE.Color();
  const scale = Math.min(maxAbs, 1.2);
  for (let i = 0; i < count; i++) {
    const t = THREE.MathUtils.clamp(0.5 + 0.5 * (k[i] / scale), 0, 1) * (ramp.length - 1);
    const lo = Math.floor(t), hi = Math.min(ramp.length - 1, lo + 1);
    tmp.copy(ramp[lo]).lerp(ramp[hi], t - lo);
    colors.set([tmp.r, tmp.g, tmp.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}

// Puntos de control (CVs) que se ven y se seleccionan en modo CVs
const cvKey = (obj, i, j) => (obj.kind === 'surface' ? `${obj.id}:${i}:${j}` : `${obj.id}:${i}`);
function cvRef(ref) { return ref.obj.kind === 'surface' ? ref.obj.data.cvs[ref.i][ref.j] : ref.obj.data.cvs[ref.i]; }
function allCVRefs(obj) {
  const out = [];
  if (obj.kind === 'surface') obj.data.cvs.forEach((row, i) => row.forEach((_, j) => out.push({ obj, i, j, key: cvKey(obj, i, j) })));
  else obj.data.cvs.forEach((_, i) => out.push({ obj, i, key: cvKey(obj, i) }));
  return out;
}
function rebuildHandles(obj) {
  const g = obj.parts.handles;
  g.clear();
  for (const ref of allCVRefs(obj)) {
    const p = cvRef(ref);
    const h = new THREE.Mesh(handleGeo, selCVs.has(ref.key) ? handleSelMat : handleMat);
    h.position.set(p.x, p.y, p.z);
    h.userData = ref;
    h.renderOrder = 10;
    g.add(h);
  }
}

function applyVisibility(obj) {
  const p = obj.parts, vis = obj.visible, sel = selObjs.includes(obj), cvMode = pickMode === 'cv';
  p.handles.visible = p.hull.visible = vis && cvMode;
  if (obj.kind === 'surface') {
    p.mesh.visible = vis;
    p.iso.visible = vis && $('show-iso').checked && diagMode !== 'wire';
    p.iso.material = sel ? isoSelMat : isoMat;
    p.edge.visible = vis && sel;
  } else {
    p.line.visible = vis;
    p.line.material = sel ? curveSelMat : curveMat;
    p.comb.visible = p.env.visible = vis && $('show-comb').checked;
  }
}

// ---------- Selección ----------
let pickMode = 'object';
const selObjs = []; // en orden de selección (importa para el loft)
const selCVs = new Map();

function setPickMode(m) {
  if (m === pickMode) return;
  pickMode = m;
  document.querySelectorAll('[data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === m)));
  selObjs.length = 0; selCVs.clear();
  selectionChanged();
}

// how: 'replace' | 'toggle' | 'remove'
function applySelection(items, how) {
  if (how === 'replace') { selObjs.length = 0; selCVs.clear(); }
  for (const it of items) {
    if (it.key) {
      const has = selCVs.has(it.key);
      if (how === 'remove' || (how === 'toggle' && has)) selCVs.delete(it.key); else selCVs.set(it.key, it);
    } else {
      const i = selObjs.indexOf(it);
      if (how === 'remove' || (how === 'toggle' && i >= 0)) { if (i >= 0) selObjs.splice(i, 1); } else if (i < 0) selObjs.push(it);
    }
  }
  selectionChanged();
}
function clearSelection() { selObjs.length = 0; selCVs.clear(); selectionChanged(); }

function selectionChanged() {
  objects.forEach((o) => {
    applyVisibility(o);
    o.parts.handles.children.forEach((h) => (h.material = selCVs.has(h.userData.key) ? handleSelMat : handleMat));
  });
  attachGizmo();
  renderSelectionPanel();
  refreshOutliner();
  updateStatus();
}

// Gizmo: se coloca en el centro de lo seleccionado y mueve todos los CVs afectados a la vez
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.8);
gizmo._getPointer = (e) => { const n = paneNDC(e, dragPane || paneAt(e.clientX)); return { x: n.x, y: n.y, button: e.button }; };
scene.add(gizmo);
const proxy = new THREE.Object3D();
scene.add(proxy);
gizmo.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });

function selectedCVRefs() {
  if (pickMode === 'cv') return [...selCVs.values()];
  return selObjs.filter((o) => o.visible).flatMap(allCVRefs);
}
function affectedObjects() {
  return pickMode === 'cv' ? [...new Set([...selCVs.values()].map((r) => r.obj))] : selObjs.slice();
}
function centroid(refs) {
  const c = new THREE.Vector3();
  refs.forEach((r) => { const p = cvRef(r); c.x += p.x; c.y += p.y; c.z += p.z; });
  return c.divideScalar(Math.max(refs.length, 1));
}
function attachGizmo() {
  const refs = selectedCVRefs();
  if (!refs.length || tool !== 'select') { gizmo.detach(); return; }
  proxy.position.copy(centroid(refs));
  gizmo.attach(proxy);
}
let gizmoDrag = null;
gizmo.addEventListener('mouseDown', () => {
  const refs = selectedCVRefs();
  gizmoDrag = { p0: proxy.position.clone(), cvs: refs.map(cvRef), orig: refs.map((r) => cvRef(r).clone()), objs: affectedObjects() };
});
gizmo.addEventListener('mouseUp', () => { gizmoDrag = null; renderSelectionPanel(); });
let pendingUpdate = null;
gizmo.addEventListener('objectChange', () => {
  if (!gizmoDrag) return;
  const d = proxy.position.clone().sub(gizmoDrag.p0);
  gizmoDrag.cvs.forEach((c, n) => { const o = gizmoDrag.orig[n]; c.x = o.x + d.x; c.y = o.y + d.y; c.z = o.z + d.z; });
  if (!pendingUpdate) {
    pendingUpdate = requestAnimationFrame(() => { pendingUpdate = null; gizmoDrag?.objs.forEach(updateObject); updateCVReadout(); });
  }
});

// ---------- Vistas (dividida / diagnóstico / render) ----------
let dragPane = null;
function panes() {
  const w = view.clientWidth, h = Math.max(view.clientHeight, 1);
  if (layout !== 'split') return [{ kind: layout, x: 0, w, h }];
  const hw = Math.floor(w / 2);
  return [{ kind: 'diag', x: 0, w: hw, h }, { kind: 'render', x: hw, w: w - hw, h }];
}
function paneAt(clientX) {
  const x = clientX - renderer.domElement.getBoundingClientRect().left;
  const ps = panes();
  return ps.find((p) => x >= p.x && x < p.x + p.w) || ps[ps.length - 1];
}
function paneNDC(e, p) {
  const r = renderer.domElement.getBoundingClientRect();
  return { x: ((e.clientX - r.left - p.x) / p.w) * 2 - 1, y: -((e.clientY - r.top) / p.h) * 2 + 1 };
}
function useAspect(p) { camera.aspect = p.w / p.h; camera.updateProjectionMatrix(); }

const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
function setRay(e) {
  const p = dragPane || paneAt(e.clientX);
  useAspect(p);
  const n = paneNDC(e, p);
  mouse.set(n.x, n.y);
  ray.setFromCamera(mouse, camera);
}

function pickAt(e) {
  setRay(e);
  const live = objects.filter((o) => o.visible);
  if (pickMode === 'cv') {
    const hit = ray.intersectObjects(live.flatMap((o) => o.parts.handles.children), false)[0];
    return hit ? { cv: hit.object.userData } : null;
  }
  ray.params.Line.threshold = camera.position.distanceTo(orbit.target) * 0.012;
  const hit = ray.intersectObjects(live.map((o) => (o.kind === 'surface' ? o.parts.mesh : o.parts.pick)), false)[0];
  return hit ? { obj: hit.object.userData.obj, point: hit.point } : null;
}

// ---------- Herramientas ----------
let tool = 'select';
let drawPlaneKind = 'xz';
const drawPlanes = { xz: new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.01), xy: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) };
function planePoint(e) {
  setRay(e);
  const p = ray.ray.intersectPlane(drawPlanes[drawPlaneKind], new THREE.Vector3());
  if (p && $('snap').checked) {
    p.x = Math.round(p.x * 4) / 4;
    if (drawPlaneKind === 'xz') p.z = Math.round(p.z * 4) / 4; else p.y = Math.round(p.y * 4) / 4;
  }
  return p;
}
function setDrawPlane(k) {
  drawPlaneKind = k;
  document.querySelectorAll('[data-plane]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plane === k)));
  gridXY.visible = k === 'xy' && (tool === 'curve' || tool === 'plane');
}

const HINTS = {
  curve: 'Clic: añadir punto · Enter: terminar · Esc: cancelar · T: vista superior',
  plane: 'Clic en el plano de dibujo para colocar una superficie plana · Esc: cancelar',
};
function updateHint() {
  if (HINTS[tool]) { $('hint').textContent = HINTS[tool]; return; }
  const nav = navStyle === 'alias' ? 'Shift+Alt + izq/medio/der: girar/desplazar/zoom' : 'Shift + arrastrar: recuadro';
  const what = pickMode === 'cv' ? 'CVs' : 'objetos';
  $('hint').textContent = `Clic: seleccionar ${what} · Arrastrar: recuadro · Shift: alternar · Ctrl: quitar · ${nav} · Doble clic: pivote · Espacio: menú`;
}
function setTool(t) {
  if (tool === 'curve' && t !== 'curve') cancelDraft();
  tool = t;
  $('t-select').setAttribute('aria-pressed', String(t === 'select'));
  $('t-curve').setAttribute('aria-pressed', String(t === 'curve'));
  $('t-plane').setAttribute('aria-pressed', String(t === 'plane'));
  $('drawbar').hidden = t !== 'curve';
  setDrawPlane(drawPlaneKind);
  updateHint();
  if (t === 'curve') startDraft();
  attachGizmo();
}

// Dibujo de curvas
let draft = null;
const draftLine = new Line2(new LineGeometry(), draftMat);
const draftHandles = new THREE.Group();
scene.add(draftLine, draftHandles);
draftLine.visible = false;
function startDraft() { draft = { pts: [], hover: null }; showDraft(); }
function showDraft() {
  draftHandles.clear();
  draftLine.visible = false;
  if (!draft) { $('draw-msg').textContent = ''; return; }
  const pts = draft.hover ? [...draft.pts, draft.hover] : draft.pts;
  if (pts.length >= 2) {
    const crv = N.curveOf(N.curveData(pts)), out = [];
    for (let s = 0; s <= 120; s++) { const q = crv.getPoint(s / 120); out.push(q.x, q.y, q.z); }
    setGeo(draftLine, line2Geo(out));
    draftLine.visible = true;
  }
  pts.forEach((p) => { const h = new THREE.Mesh(handleGeo, handleMat); h.position.copy(p); h.renderOrder = 10; draftHandles.add(h); });
  const n = draft.pts.length;
  $('draw-msg').textContent = n === 0 ? `Haz clic en el plano ${drawPlaneKind === 'xz' ? 'del suelo' : 'frontal'} para el primer punto` : `${n} ${n === 1 ? 'punto' : 'puntos'} · sigue haciendo clic para añadir más`;
  $('draw-done').disabled = n < 2;
}
function finishDraft() {
  if (!draft || draft.pts.length < 2) return;
  const obj = addCurve(N.curveData(draft.pts, 3, drawPlaneKind));
  startDraft();
  toast(`${obj.name} creada`);
}
function cancelDraft() { draft = null; showDraft(); }

// ---------- Operaciones (un clic, estilo Plasticity) ----------
const selCurves = () => selObjs.filter((o) => o.kind === 'curve');
function finishCreate(created, msg) {
  if (!created.length) return;
  setPickMode('object');
  applySelection(created, 'replace');
  toast(msg);
}
const OPS = {
  loft() {
    const cs = selCurves();
    if (cs.length < 2) return toast('Loft: selecciona 2 o más curvas, en el orden en que la superficie debe pasar por ellas.');
    const o = addSurface(N.loft(cs.map((c) => c.data)), 'Loft');
    finishCreate([o], `${o.name} creado a partir de ${cs.length} curvas`);
  },
  extrude() {
    const cs = selCurves();
    if (!cs.length) return toast('Extruir: selecciona una o más curvas.');
    const h = +$('op-dist').value;
    const out = cs.map((c) => addSurface(N.extrude(c.data, c.data.plane === 'xy' ? new THREE.Vector3(0, 0, h) : new THREE.Vector3(0, h, 0)), 'Extrusión'));
    finishCreate(out, `${out.length} ${out.length === 1 ? 'extrusión creada' : 'extrusiones creadas'} (${h.toFixed(1)} dm)`);
  },
  revolve() {
    const cs = selCurves();
    if (!cs.length) return toast('Revolución: selecciona una curva de perfil. Funciona mejor dibujada en el plano frontal.');
    const out = cs.map((c) => addSurface(N.revolve(c.data), 'Revolución'));
    finishCreate(out, 'Revolución creada alrededor del eje Y');
  },
};

function deleteSelection() {
  if (pickMode === 'cv') return toast('Para borrar, cambia a modo Objetos (O).');
  if (!selObjs.length) return;
  const n = selObjs.length;
  selObjs.slice().forEach(removeObject);
  selectionChanged();
  toast(`${n} ${n === 1 ? 'objeto borrado' : 'objetos borrados'}`);
}

// ---------- Ratón en el viewport ----------
let down = null; // { x, y, marquee }
const marquee = $('marquee');
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragPane = paneAt(e.clientX);
  if (e.button !== 0 || navHeld) { down = null; return; }
  const canBox = tool === 'select' && !gizmo.axis && (navStyle === 'alias' || e.shiftKey);
  down = { x: e.clientX, y: e.clientY, box: canBox, boxing: false };
}, true);
renderer.domElement.addEventListener('pointermove', (e) => {
  if (down?.box && !gizmo.dragging) {
    if (!down.boxing && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) down.boxing = true;
    if (down.boxing) {
      const r = view.getBoundingClientRect();
      Object.assign(marquee.style, {
        left: Math.min(down.x, e.clientX) - r.left + 'px', top: Math.min(down.y, e.clientY) - r.top + 'px',
        width: Math.abs(e.clientX - down.x) + 'px', height: Math.abs(e.clientY - down.y) + 'px',
      });
      marquee.hidden = false;
    }
  }
  if (tool === 'curve' && draft && !e.buttons) { draft.hover = planePoint(e); showDraft(); }
});
renderer.domElement.addEventListener('pointerleave', () => { if (draft) { draft.hover = null; showDraft(); } });
addEventListener('pointerup', (e) => {
  const d = down;
  down = null;
  requestAnimationFrame(() => { dragPane = null; });
  if (!d || e.target !== renderer.domElement && !d.boxing) return;
  const how = e.shiftKey ? 'toggle' : e.ctrlKey || e.metaKey ? 'remove' : 'replace';
  if (d.boxing) { marquee.hidden = true; boxSelect(d, e, how); return; }
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || gizmo.dragging) return;
  if (tool === 'curve') {
    const p = planePoint(e);
    if (p) { draft.pts.push(p); draft.hover = null; showDraft(); }
    return;
  }
  if (tool === 'plane') {
    const p = planePoint(e);
    if (!p) return;
    const o = addSurface(N.planeData(p, drawPlaneKind), 'Plano');
    setTool('select');
    finishCreate([o], `${o.name} creado`);
    return;
  }
  if (gizmo.axis) return;
  const hit = pickAt(e);
  if (hit) applySelection([hit.cv || hit.obj], how);
  else if (how === 'replace') clearSelection();
});

// Selección por recuadro: entra todo lo que el recuadro toque (como "crossing" en Alias)
function boxSelect(d, e, how) {
  const p = paneAt(d.x);
  useAspect(p);
  const r = renderer.domElement.getBoundingClientRect();
  const x0 = Math.min(d.x, e.clientX), x1 = Math.max(d.x, e.clientX), y0 = Math.min(d.y, e.clientY), y1 = Math.max(d.y, e.clientY);
  const v = new THREE.Vector3();
  const inside = (x, y, z) => {
    v.set(x, y, z).project(camera);
    if (v.z > 1) return false;
    const sx = r.left + p.x + ((v.x + 1) / 2) * p.w, sy = r.top + ((1 - v.y) / 2) * p.h;
    return sx >= x0 && sx <= x1 && sy >= y0 && sy <= y1;
  };
  const live = objects.filter((o) => o.visible);
  let items;
  if (pickMode === 'cv') {
    items = live.flatMap(allCVRefs).filter((ref) => { const q = cvRef(ref); return inside(q.x, q.y, q.z); });
  } else {
    items = live.filter((o) => {
      const a = (o.kind === 'surface' ? o.parts.mesh : o.parts.pick).geometry.attributes.position;
      const step = o.kind === 'surface' ? 5 : 3;
      for (let i = 0; i < a.count; i += step) if (inside(a.getX(i), a.getY(i), a.getZ(i))) return true;
      return false;
    });
  }
  applySelection(items, how);
}

renderer.domElement.addEventListener('dblclick', (e) => {
  if (tool !== 'select') return;
  setRay(e);
  const live = objects.filter((o) => o.visible);
  ray.params.Line.threshold = camera.position.distanceTo(orbit.target) * 0.012;
  const hit = ray.intersectObjects(live.map((o) => (o.kind === 'surface' ? o.parts.mesh : o.parts.pick)), false)[0];
  const pt = hit ? hit.point : ray.ray.intersectPlane(drawPlanes.xz, new THREE.Vector3());
  if (pt) setPivot(pt);
});

// ---------- Encuadre ----------
function boundsOf(list) {
  const box = new THREE.Box3();
  list.forEach((o) => {
    const g = (o.kind === 'surface' ? o.parts.mesh : o.parts.pick).geometry;
    g.computeBoundingBox(); box.union(g.boundingBox);
  });
  return box;
}
function frameObjects(list) {
  const box = boundsOf(list.length ? list : objects);
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), rad = box.getSize(new THREE.Vector3()).length() / 2;
  const p = panes()[0], vf = THREE.MathUtils.degToRad(camera.fov) / 2;
  const hf = Math.atan(Math.tan(vf) * (p.w / p.h));
  const dist = rad / Math.sin(Math.min(vf, hf)) * 1.05;
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, dist);
}
const frameSelection = () => frameObjects(pickMode === 'cv' ? affectedObjects() : selObjs);
function pivotToSelection() {
  const refs = selectedCVRefs();
  setPivot(refs.length ? centroid(refs) : boundsOf(objects).getCenter(new THREE.Vector3()));
}
function topView() {
  const c = boundsOf(objects).getCenter(new THREE.Vector3());
  orbit.target.copy(c);
  camera.position.set(c.x, c.y + 18, c.z + 0.001);
}

// ---------- Paneles laterales que se ocultan solos (como Alias) ----------
let pinned = false;
function setPinned(v) {
  pinned = v;
  app.classList.toggle('auto', !v);
  $('pin').setAttribute('aria-pressed', String(v));
  $('pin').title = v ? 'Panel fijo: clic para que se oculte solo' : 'Panel automático: clic para fijarlo';
  $('panel').classList.remove('show'); $('tools').classList.remove('show');
  requestAnimationFrame(resize);
}
$('pin').addEventListener('click', () => setPinned(!pinned));
addEventListener('pointermove', (e) => {
  if (pinned) return;
  const r = view.getBoundingClientRect(), panel = $('panel'), tools = $('tools');
  const busy = e.buttons !== 0;
  if (e.clientX > r.right - 18 && e.clientY > r.top && e.clientY < r.bottom) panel.classList.add('show');
  else if (!busy && panel.classList.contains('show') && e.clientX < r.right - panel.offsetWidth - 40) panel.classList.remove('show');
  if (e.clientX < r.left + 64 && e.clientY > r.top && e.clientY < r.bottom) tools.classList.add('show');
  else if (!busy && e.clientX > r.left + 140) tools.classList.remove('show');
});

// ---------- Panel: escena (lista de objetos) ----------
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function refreshOutliner() {
  const ul = $('outliner');
  ul.innerHTML = '';
  for (const o of objects) {
    const li = document.createElement('li');
    li.className = 'ol-item' + (selObjs.includes(o) ? ' sel' : '') + (o.visible ? '' : ' off');
    li.innerHTML = `<button class="ol-name" title="Seleccionar (Shift: añadir)"><span class="ol-ico">${o.kind === 'surface' ? '◩' : '∿'}</span>${o.name}</button><button class="ol-eye" aria-pressed="${o.visible}" title="${o.visible ? 'Ocultar' : 'Mostrar'}">${EYE}</button>`;
    li.querySelector('.ol-name').addEventListener('click', (e) => { setPickMode('object'); applySelection([o], e.shiftKey ? 'toggle' : 'replace'); });
    li.querySelector('.ol-eye').addEventListener('click', () => {
      o.visible = !o.visible;
      if (!o.visible) { const i = selObjs.indexOf(o); if (i >= 0) selObjs.splice(i, 1); }
      selectionChanged();
    });
    ul.append(li);
  }
  $('scene-count').textContent = `${objects.length} ${objects.length === 1 ? 'objeto' : 'objetos'}`;
}

// ---------- Panel: selección ----------
const fmt = (v) => v.toFixed(2);
function degreeOptions(sel) {
  let h = '';
  for (let d = 1; d <= N.MAX_DEGREE; d++) h += `<option value="${d}" ${d === sel ? 'selected' : ''}>${d}</option>`;
  return h;
}
function renderSelectionPanel() {
  const box = $('sel-body');
  const refs = [...selCVs.values()];
  if (pickMode === 'cv' && refs.length) {
    const single = refs.length === 1;
    const p = single ? cvRef(refs[0]) : centroid(refs);
    box.innerHTML = `
      <p class="muted">${single ? `CV de <b>${refs[0].obj.name}</b>` : `${refs.length} CVs seleccionados · centro del grupo`}</p>
      <div class="coords">
        <div class="coord"><b class="x">X</b><span id="cx">${fmt(p.x)}</span></div>
        <div class="coord"><b class="y">Y</b><span id="cy">${fmt(p.y)}</span></div>
        <div class="coord"><b class="z">Z</b><span id="cz">${fmt(p.z)}</span></div>
      </div>
      <div class="row"><label for="weight">Peso (w)</label><input id="weight" type="range" min="0.2" max="5" step="0.05" value="${single ? p.w : 1}"><output id="weight-o">${single ? fmt(p.w) : '—'}</output></div>
      <p class="muted">Un peso mayor atrae la superficie hacia el punto.</p>`;
    $('weight').addEventListener('input', (e) => {
      refs.forEach((r) => (cvRef(r).w = +e.target.value));
      $('weight-o').textContent = fmt(+e.target.value);
      [...new Set(refs.map((r) => r.obj))].forEach(updateObject);
    });
    return;
  }
  if (pickMode === 'cv') { box.innerHTML = '<p class="muted">Haz clic en un CV o arrastra un recuadro para seleccionar varios.</p>'; return; }
  if (!selObjs.length) {
    box.innerHTML = '<p class="muted">Nada seleccionado. Haz clic en un objeto, arrastra un recuadro o elígelo en la lista de la escena.</p>';
    return;
  }
  if (selObjs.length === 1) {
    const o = selObjs[0], d = o.data;
    if (o.kind === 'surface') {
      const nu = d.cvs.length, nv = d.cvs[0].length;
      box.innerHTML = `
        <p class="muted"><b>${o.name}</b> · superficie NURBS · ${nu}×${nv} CVs</p>
        <div class="grid4">
          <span></span><span class="gh">Grado</span><span class="gh">Spans</span><span class="gh">CVs</span>
          <span class="gl">U</span><select id="degU">${degreeOptions(d.degU)}</select><input id="spU" type="number" min="1" max="${N.MAX_SPANS}" value="${N.spansOf(nu, d.degU)}"><span class="gv">${nu}</span>
          <span class="gl">V</span><select id="degV">${degreeOptions(d.degV)}</select><input id="spV" type="number" min="1" max="${N.MAX_SPANS}" value="${N.spansOf(nv, d.degV)}"><span class="gv">${nv}</span>
        </div>
        <p class="muted">Cambiar grado o spans reconstruye la superficie conservando su forma. CVs = grado + spans.</p>`;
      const apply = () => {
        const cl = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || a)));
        o.data = N.rebuildSurface(o.data, cl($('degU').value, 1, 7), cl($('spU').value, 1, N.MAX_SPANS), cl($('degV').value, 1, 7), cl($('spV').value, 1, N.MAX_SPANS));
        updateObject(o); selectionChanged();
        toast(`${o.name} reconstruida: ${o.data.cvs.length}×${o.data.cvs[0].length} CVs`);
      };
      ['degU', 'degV', 'spU', 'spV'].forEach((id) => $(id).addEventListener('change', apply));
    } else {
      const n = d.cvs.length;
      box.innerHTML = `
        <p class="muted"><b>${o.name}</b> · curva NURBS · ${n} CVs</p>
        <div class="grid4 g3">
          <span class="gh">Grado</span><span class="gh">Spans</span><span class="gh">CVs</span>
          <select id="degC">${degreeOptions(d.deg)}</select><input id="spC" type="number" min="1" max="${N.MAX_SPANS}" value="${N.spansOf(n, d.deg)}"><span class="gv">${n}</span>
        </div>`;
      const apply = () => {
        const deg = Math.max(1, Math.min(7, +$('degC').value)), sp = Math.max(1, Math.min(N.MAX_SPANS, Math.round(+$('spC').value || 1)));
        o.data = N.rebuildCurve(o.data, deg, sp);
        updateObject(o); selectionChanged();
      };
      ['degC', 'spC'].forEach((id) => $(id).addEventListener('change', apply));
    }
    return;
  }
  const ns = selObjs.filter((o) => o.kind === 'surface').length, nc = selObjs.length - ns;
  box.innerHTML = `<p class="muted">${selObjs.length} objetos: ${ns} ${ns === 1 ? 'superficie' : 'superficies'}, ${nc} ${nc === 1 ? 'curva' : 'curvas'}.</p>
    <ol class="selorder">${selObjs.map((o) => `<li>${o.name}</li>`).join('')}</ol>`;
}
function updateCVReadout() {
  if (pickMode !== 'cv' || !$('cx')) return;
  const refs = [...selCVs.values()];
  const p = refs.length === 1 ? cvRef(refs[0]) : centroid(refs);
  $('cx').textContent = fmt(p.x); $('cy').textContent = fmt(p.y); $('cz').textContent = fmt(p.z);
}
function updateStatus() {
  const n = pickMode === 'cv' ? selCVs.size : selObjs.length;
  const what = pickMode === 'cv' ? (n === 1 ? 'CV' : 'CVs') : (n === 1 ? 'objeto' : 'objetos');
  $('st-sel').textContent = n ? `Selección: ${n} ${what}` : 'Nada seleccionado';
  const ns = objects.filter((o) => o.kind === 'surface').length;
  $('st-scene').textContent = `Unidades: dm · Escena: ${ns} ${ns === 1 ? 'superficie' : 'superficies'} · ${objects.length - ns} ${objects.length - ns === 1 ? 'curva' : 'curvas'}`;
}

// ---------- Panel: modos, materiales, análisis ----------
function setDiag(m) {
  diagMode = m;
  document.querySelectorAll('[data-diag]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diag === m)));
  if (layout === 'render') setLayout('split');
  $('legend').hidden = m !== 'curv';
  objects.forEach(updateObject);
}
document.querySelectorAll('[data-diag]').forEach((b) => b.addEventListener('click', () => setDiag(b.dataset.diag)));
const LAYOUTS = ['split', 'diag', 'render'];
function setLayout(l) {
  layout = l;
  document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === l)));
  $('pane-diag').hidden = l === 'render';
  $('pane-render').hidden = l === 'diag';
  $('pane-diag').className = 'pane left' + (l === 'diag' ? ' full' : '');
  $('pane-render').className = 'pane right' + (l === 'render' ? ' full' : '');
  resize();
}
const cycleLayout = () => setLayout(LAYOUTS[(LAYOUTS.indexOf(layout) + 1) % LAYOUTS.length]);
document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => setLayout(b.dataset.layout)));
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => setPickMode(b.dataset.pick)));
document.querySelectorAll('[data-plane]').forEach((b) => b.addEventListener('click', () => setDrawPlane(b.dataset.plane)));

// El material se aplica a las superficies seleccionadas; si no hay ninguna, a todas.
function setMaterial(k) {
  matKey = k;
  const sel = selObjs.filter((o) => o.kind === 'surface');
  (sel.length ? sel : objects.filter((o) => o.kind === 'surface')).forEach((o) => (o.mat = k));
  document.querySelectorAll('.mat').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mat === k)));
  $('rough').value = materials[k].roughness;
  $('rough-o').textContent = (+materials[k].roughness).toFixed(2);
  $('mat-name').textContent = MAT_NAMES[k];
  if (layout === 'diag') setLayout('split');
}
function buildMaterialLibrary() {
  const lib = $('matlib');
  for (const k of Object.keys(materials)) {
    const b = document.createElement('button');
    b.className = 'mat'; b.dataset.mat = k; b.id = 'mat-' + k;
    b.setAttribute('aria-pressed', String(k === matKey));
    b.innerHTML = `<span class="ph"></span>${MAT_NAMES[k]}`;
    b.addEventListener('click', () => setMaterial(k));
    lib.append(b);
  }
  // Miniaturas: una esfera con cada material, renderizada una sola vez en un lienzo aparte
  requestAnimationFrame(() => {
    const tr = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    tr.setSize(128, 128); tr.toneMapping = THREE.ACESFilmicToneMapping;
    const ts = new THREE.Scene(); ts.background = new THREE.Color('#1b1f24');
    ts.environment = new THREE.PMREMGenerator(tr).fromScene(new RoomEnvironment(tr), 0.04).texture;
    const l = new THREE.DirectionalLight(0xffffff, 1.4); l.position.set(2, 3, 2); ts.add(l);
    const tc = new THREE.PerspectiveCamera(30, 1, 0.1, 10); tc.position.set(0, 0.25, 3.9); tc.lookAt(0, 0, 0);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 48)); ts.add(ball);
    for (const k of Object.keys(materials)) {
      ball.material = materials[k];
      tr.render(ts, tc);
      const img = new Image(); img.alt = ''; img.src = tr.domElement.toDataURL();
      $('mat-' + k).querySelector('.ph').replaceWith(img);
    }
    tr.dispose(); tr.forceContextLoss();
  });
}
$('rough').addEventListener('input', (e) => {
  materials[matKey].roughness = +e.target.value;
  $('rough-o').textContent = (+e.target.value).toFixed(2);
});
$('zfreq').addEventListener('input', (e) => {
  zebraMat.uniforms.uFreq.value = +e.target.value;
  $('zfreq-o').textContent = e.target.value;
  if (diagMode !== 'zebra') setDiag('zebra');
});
$('res').addEventListener('input', (e) => { res = +e.target.value; $('res-o').textContent = res; objects.forEach(updateObject); });
$('show-iso').addEventListener('change', () => objects.forEach(applyVisibility));
$('show-comb').addEventListener('change', () => objects.forEach(applyVisibility));
$('comb').addEventListener('input', (e) => {
  combScale = +e.target.value; $('comb-o').textContent = combScale.toFixed(1);
  objects.filter((o) => o.kind === 'curve').forEach(updateObject);
});
$('op-dist').addEventListener('input', (e) => { $('op-dist-o').textContent = (+e.target.value).toFixed(1); });

$('t-select').addEventListener('click', () => setTool('select'));
$('t-frame').addEventListener('click', frameSelection);
$('t-top').addEventListener('click', topView);
$('t-curve').addEventListener('click', () => setTool(tool === 'curve' ? 'select' : 'curve'));
$('t-plane').addEventListener('click', () => setTool(tool === 'plane' ? 'select' : 'plane'));
$('t-loft').addEventListener('click', OPS.loft);
$('t-extrude').addEventListener('click', OPS.extrude);
$('t-revolve').addEventListener('click', OPS.revolve);
$('b-loft').addEventListener('click', OPS.loft);
$('b-extrude').addEventListener('click', OPS.extrude);
$('b-revolve').addEventListener('click', OPS.revolve);
$('draw-done').addEventListener('click', finishDraft);
$('draw-cancel').addEventListener('click', () => setTool('select'));

let toastTimer = 0;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 2800);
}

// ---------- Atajos de teclado ----------
addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT'].includes(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') frameSelection();
  else if (k === 't') topView();
  else if (k === 'l') pivotToSelection();
  else if (k === 'c') setTool('curve');
  else if (k === 'v') cycleLayout();
  else if (k === 'o') setPickMode('object');
  else if (k === 'p') setPickMode('cv');
  else if (k === '1') setDiag('zebra');
  else if (k === '2') setDiag('curv');
  else if (k === '3') setDiag('wire');
  else if (k === 'enter' && tool === 'curve') finishDraft();
  else if (k === 'escape') { if (tool !== 'select') setTool('select'); else clearSelection(); }
  else if (k === 'delete' || k === 'backspace') deleteSelection();
});

// ---------- Menú radial (mantener Espacio) ----------
const RADIAL = [
  { label: 'Curva', key: 'C', run: () => setTool('curve') },
  { label: 'Plano', key: '', run: () => setTool('plane') },
  { label: 'Loft', key: '', run: OPS.loft },
  { label: 'Extruir', key: '', run: OPS.extrude },
  { label: 'Revolución', key: '', run: OPS.revolve },
  { label: 'Objetos/CVs', key: 'O/P', run: () => setPickMode(pickMode === 'cv' ? 'object' : 'cv') },
  { label: 'Pivote', key: 'L', run: pivotToSelection },
  { label: 'Encuadrar', key: 'F', run: frameSelection },
  { label: 'Vista sup.', key: 'T', run: topView },
  { label: 'Cambiar vista', key: 'V', run: cycleLayout },
];
const radialEl = $('radial');
let radialOn = false, radialPick = -1, lastPtr = { x: innerWidth / 2, y: innerHeight / 2 }, radialAt = lastPtr;
// Las opciones van en un óvalo, desplazadas medio paso para que ninguna quede justo arriba o abajo
const RSTEP = (Math.PI * 2) / RADIAL.length, ROFF = -Math.PI / 2 + RSTEP / 2;
RADIAL.forEach((it, n) => {
  const a = ROFF + n * RSTEP;
  const b = document.createElement('button');
  b.className = 'item';
  b.innerHTML = it.key ? `${it.label}<kbd>${it.key}</kbd>` : it.label;
  b.style.left = Math.cos(a) * 165 + 'px'; b.style.top = Math.sin(a) * 120 + 'px';
  b.addEventListener('pointerenter', () => highlightRadial(n));
  b.addEventListener('click', () => { radialPick = n; closeRadial(true); });
  radialEl.append(b);
});
function highlightRadial(n) {
  radialPick = n;
  radialEl.querySelectorAll('.item').forEach((el, m) => el.classList.toggle('on', m === n));
  $('radial-center').textContent = n >= 0 ? RADIAL[n].label : 'Suelta sobre una opción';
}
function openRadial() {
  radialOn = true; radialAt = { ...lastPtr };
  radialEl.style.left = radialAt.x + 'px'; radialEl.style.top = radialAt.y + 'px';
  radialEl.hidden = false; highlightRadial(-1);
}
function closeRadial(run) {
  if (!radialOn) return;
  radialOn = false; radialEl.hidden = true;
  if (run && radialPick >= 0) RADIAL[radialPick].run();
}
addEventListener('pointermove', (e) => {
  lastPtr = { x: e.clientX, y: e.clientY };
  if (!radialOn) return;
  const dx = e.clientX - radialAt.x, dy = e.clientY - radialAt.y;
  if (Math.hypot(dx, dy) < 30) return highlightRadial(-1);
  const a = Math.atan2(dy / 120, dx / 165) - ROFF;
  highlightRadial(Math.round(((a + Math.PI * 4) % (Math.PI * 2)) / RSTEP) % RADIAL.length);
});
addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || ['INPUT', 'SELECT'].includes(e.target.tagName)) return;
  e.preventDefault();
  if (!e.repeat && !radialOn) openRadial();
}, true);
addEventListener('keyup', (e) => {
  if (e.code !== 'Space') return;
  e.preventDefault();
  closeRadial(true);
}, true);

// ---------- Dibujo de cada cuadro ----------
function renderPane(p) {
  renderer.setViewport(p.x, 0, p.w, p.h);
  renderer.setScissor(p.x, 0, p.w, p.h);
  useAspect(p);
  const diag = p.kind === 'diag';
  const dm = diagMaterial();
  objects.forEach((o) => { if (o.kind === 'surface') o.parts.mesh.material = diag ? dm : materials[o.mat]; });
  scene.background = diag ? diagBg : renderBg;
  camera.layers.set(0);
  if (diag) camera.layers.enable(DIAG);
  renderer.render(scene, camera);
}
function diagMaterial() { return diagMode === 'curv' ? curvMat : diagMode === 'wire' ? wireMat : zebraMat; }
function renderFrame(now) {
  if (pivotAnim) {
    const k = Math.min(1, (now - pivotAnim.t0) / 260), ease = 1 - (1 - k) ** 3;
    orbit.target.lerpVectors(pivotAnim.from, pivotAnim.to, ease);
    if (k === 1) pivotAnim = null;
  }
  orbit.update();
  pivotMarker.position.copy(orbit.target);
  pivotMarker.scale.setScalar(camera.position.distanceTo(orbit.target) * 0.06);
  pivotMarker.visible = navHeld || orbiting || now < pivotShowUntil;
  renderer.shadowMap.needsUpdate = true;
  panes().forEach(renderPane);
  // El ratio de la cámara queda con el de la vista bajo el puntero, para que seleccionar y el gizmo coincidan.
  useAspect(dragPane || paneAt(lastPtr.x));
}

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  renderer.setSize(w, h, false);
  const p = panes()[0];
  lineMats.forEach((m) => m.resolution.set(p.w, p.h));
}

// ---------- Arranque ----------
new ResizeObserver(resize).observe(view);
resize();
buildMaterialLibrary();

// Escena de ejemplo: un capó (superficie 6×6, grado 3) y una curva frente a él
const hood = [];
for (let i = 0; i < 6; i++) {
  const row = [], u = i / 5;
  for (let j = 0; j < 6; j++) {
    const v = j / 5;
    const crown = Math.pow(Math.sin(Math.PI * u), 1.1) * (0.55 + 0.45 * Math.sin(Math.PI * v));
    row.push(new THREE.Vector4((u - 0.5) * 6.4, 0.35 + 1.35 * crown + 0.45 * u, (v - 0.5) * 4.4, 1));
  }
  hood.push(row);
}
addSurface({ degU: 3, degV: 3, knotsU: N.clampedKnots(6, 3), knotsV: N.clampedKnots(6, 3), cvs: hood }, 'Capó').name = 'Capó';
refreshOutliner();
addCurve(N.curveData([[-3.25, 3.75], [-2, 2.75], [-0.5, 4.5], [1, 3], [2.25, 4.25], [3.25, 3.5]].map(([x, z]) => new THREE.Vector3(x, 0.01, z))));
camera.position.set(8, 6.4, 10.5);
orbit.target.set(0, 0.6, 0.6);

setNavStyle(navStyle);
setLayout(layout);
setPinned(false);
frameObjects([]);
setTool('select');
selectionChanged();

renderer.setAnimationLoop(renderFrame);
window.__forja = { camera, objects, panes, orbit, selObjs, selCVs };
window.__ready = true;
