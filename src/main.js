import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { ParametricGeometry } from 'three/addons/geometries/ParametricGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as N from './nurbs.js';
import { applyBackground } from './concrete.js';
import { drawLogo } from './logo.js';
import * as X from './exporters.js';
import * as AI from './ai.js';
import * as HX from './history.js';
import * as FF from './freeform.js';
import * as FL from './fillet.js';
import { getOCC } from './occ.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { PLYExporter } from 'three/addons/exporters/PLYExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { PLYLoader } from 'three/addons/loaders/PLYLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ---------- Preferencias (se recuerdan en este navegador) ----------
const prefs = { evalUI: 'b', xform: 'mouse', theme: null };
try { Object.assign(prefs, JSON.parse(localStorage.getItem('forja-prefs') || '{}')); } catch { /* sin almacenamiento */ }
function savePrefs() { try { localStorage.setItem('forja-prefs', JSON.stringify(prefs)); } catch { /* sin almacenamiento */ } }
// modos de evaluación (los usan el Puck, los menús y la interfaz lateral)
const EVAL_MODES = [
  { k: 'showroom', label: 'Showroom', key: '4' }, { k: 'clay', label: 'Arcilla', key: '7' }, { k: 'diffuse', label: 'Difuso', key: '5' }, { k: 'sky', label: 'Shade-Sky', key: '6' },
  { k: 'zebra', label: 'Cebra', key: '1' }, { k: 'curv', label: 'Curvatura', key: '2' }, { k: 'wire', label: 'Malla', key: '3' },
];
// historial de construcción: relaciones entre objetos que se recalculan solas (ver "Historial de construcción")
const relations = [];
let nextRelId = 1, propagating = false, toolsReady = false;
// objetos que dependen (en cadena) de lo elegido: se pintan en rosa, como en Alias
let depSet = new Set();
function recomputeDeps() {
  depSet = new Set();
  if (!relations.length) return;
  const q = selObjs.map((o) => o.id);
  while (q.length) { const id = q.shift(); for (const r of relations) if (inputsOf(r).includes(id) && !depSet.has(outputOf(r))) { depSet.add(outputOf(r)); q.push(outputOf(r)); } }
}
function histState(o) {
  if (depSet.has(o.id)) return 'dep';
  return relations.length && relations.some((r) => outputOf(r) === o.id) ? 'hist' : null;
}
// capas y grupos de la escena (ver más abajo)
const layers = [{ id: 1, name: 'Predeterminada', visible: true }];
let activeLayer = 1, nextLayerId = 2;
const groups = [];
let nextGroupId = 1;


drawLogo(document.getElementById('logo'));

// Tema claro u oscuro (se recuerda en este navegador)
let theme = 'dark';
try { theme = localStorage.getItem('forja-theme') || 'dark'; } catch (e) { /* sin almacenamiento */ }
document.documentElement.dataset.theme = theme;
const repaintWall = applyBackground(() => theme);

const $ = (id) => document.getElementById(id);
const view = $('view');
const app = $('app');

// ---------- Renderer y escena ----------
// Lienzo transparente: el muro de hormigón de la página se ve detrás del modelo (una sola imagen)
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // la sombra se calcula una vez por cuadro aunque haya dos vistas
renderer.setScissorTest(true);
view.prepend(renderer.domElement);
$('loading').remove();

const scene = new THREE.Scene();
const diagBg = new THREE.Color('#b9b8b4');
const renderBg = (() => {
  const c = document.createElement('canvas'); c.width = 16; c.height = 256;
  const g = c.getContext('2d'), grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#e4e6e5'); grd.addColorStop(0.55, '#d6d6d3'); grd.addColorStop(1, '#bcbab5');
  g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
// Capa 1 = solo en la vista de diagnóstico (cuadrícula, isoparamétricas, polígonos de control, peines)
const DIAG = 1;
// Entornos de VISU (como los HDRI de Blender), generados por código y guardados al primer uso
const pmrem = new THREE.PMREMGenerator(renderer);
const envCache = {};
function envTexture(k) {
  if (envCache[k]) return envCache[k];
  let tex;
  if (k === 'studio') tex = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
  else if (k === 'overcast') {
    const sc = new THREE.Scene();
    sc.add(new THREE.Mesh(new THREE.SphereGeometry(10, 48, 24), new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float y = normalize(vP).y; vec3 c = mix(vec3(0.16,0.15,0.14), vec3(0.85,0.87,0.9), smoothstep(-0.15, 0.5, y)); gl_FragColor = vec4(c * 1.4, 1.0); }',
    })));
    tex = pmrem.fromScene(sc, 0.02).texture;
  } else {
    const sky = new Sky(), u = sky.material.uniforms, sunset = k === 'sunset';
    sky.scale.setScalar(50);
    u.turbidity.value = sunset ? 8 : 2.5; u.rayleigh.value = sunset ? 2.5 : 1; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
    u.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(sunset ? 87 : 52), THREE.MathUtils.degToRad(140));
    const sc = new THREE.Scene(); sc.add(sky);
    // suelo neutro para que la parte baja del reflejo no sea negra
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: sunset ? 0x2a2018 : 0x3a3834 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; sc.add(ground);
    tex = pmrem.fromScene(sc, 0.01).texture;
  }
  return (envCache[k] = tex);
}
let envKey = 'studio', envBg = true;
scene.environment = envTexture('studio');
scene.backgroundBlurriness = 0.55;

const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 400);
// Proyección ortogonal (como Alias: al elegir una cara del cubo de vistas la vista se vuelve ortogonal y al girarla
// vuelve a perspectiva). Es la misma cámara con otra matriz: el alto visible es el que tenía la perspectiva a la
// profundidad del pivote, así el cambio no salta; acercar (dolly) hacia el pivote hace zoom.
const proj = { ortho: false, temp: false, keep: false };
const perspUpdate = camera.updateProjectionMatrix.bind(camera);
camera.updateProjectionMatrix = function () {
  if (!proj.ortho) return perspUpdate();
  const h = orthoHeight(), w = h * this.aspect;
  this.projectionMatrix.makeOrthographic(-w / 2, w / 2, h / 2, -h / 2, -400, 400);
  this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
};
function orthoHeight() {
  const depth = Math.max(0.05, pivot.clone().sub(camera.position).dot(viewDir()));
  return 2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
}
// temp = la puso el cubo (girar la devuelve a perspectiva); keep = el usuario eligió trabajar siempre en ortogonal
function setProjection(ortho, temp = false) {
  proj.ortho = ortho || proj.keep;
  proj.temp = proj.ortho && !proj.keep && temp;
  camera.isOrthographicCamera = proj.ortho;
  camera.isPerspectiveCamera = !proj.ortho;
  camera.updateProjectionMatrix();
  if (typeof updateViewName === 'function') updateViewName();
}

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
const grid = new THREE.GridHelper(30, 30, 0x8a8781, 0xa3a09a);
grid.position.y = 0.001;
grid.layers.set(DIAG);
grid.material.transparent = true; grid.material.opacity = 0.09;
scene.add(grid);
const gridXY = new THREE.GridHelper(30, 30, 0x4a3a22, 0x2a251d);
gridXY.rotation.x = Math.PI / 2;
gridXY.layers.set(DIAG);
gridXY.visible = false;
scene.add(gridXY);

// ---------- Navegación ----------
// Cámara propia, como en Alias: el pivote de giro queda anclado en el mundo.
// Girar orbita alrededor del pivote; desplazar y acercar mueven la cámara sin mover el pivote.
// Estilo Alias: Shift + Alt (Option en Mac) + botón izquierdo = girar, central = desplazar, derecho = acercar.
const NAV_HELP = {
  alias: 'Mantén Shift + Alt (Option en Mac) y arrastra: botón izquierdo gira, central desplaza, derecho acerca o aleja. Shift + Alt + clic rápido sobre un objeto: mover ahí el punto de interés (pivote). Girar y acercar se centran en él.',
  simple: 'Para touchpad. Arrastra para girar, botón derecho para desplazar, dos dedos para zoom. Shift + arrastrar: selección por recuadro.',
};
const pivot = new THREE.Vector3();
let navStyle = 'alias';
// Modos de giro de Alias: 'camera' mantiene la vertical (como una cámara de cine);
// 'object' es como tener el modelo en la mano: cruzar la vista gira 180° y el botón derecho en horizontal hace twist.
let tumbleMode = 'camera';
let navHeld = false, navDrag = null, navMovedLast = false;
const mods = { shiftKey: false, altKey: false, ctrlKey: false, metaKey: false };
function applyNav() {
  const on = navStyle === 'alias' && navHeld;
  renderer.domElement.style.cursor = on ? 'move' : '';
  // Pistas de navegación arriba de la vista, como en Alias al mantener Shift + Alt
  $('navhint').hidden = !on;
  $('nh-right').textContent = tumbleMode === 'object' ? 'Zoom (vertical) · Twist (horizontal)' : 'Zoom';
  $('nh-left').textContent = tumbleMode === 'object' ? 'Azimut / Elevación' : 'Girar';
}
function setNavStyle(st) {
  navStyle = st;
  document.querySelectorAll('[data-nav]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.nav === st)));
  $('nav-help').textContent = NAV_HELP[st];
  updateHint();
  applyNav();
}
function trackMods(e) {
  if (e.clientX !== undefined) lastPtr = { x: e.clientX, y: e.clientY }; // antes que nadie: el snap lee esta posición
  Object.assign(mods, { shiftKey: !!e.shiftKey, altKey: !!e.altKey, ctrlKey: !!e.ctrlKey, metaKey: !!e.metaKey });
  const held = mods.shiftKey && mods.altKey;
  if (held !== navHeld) { navHeld = held; applyNav(); }
  updateSnapButtons();
}
addEventListener('keydown', (e) => { if (e.key === 'Alt') e.preventDefault(); trackMods(e); });
addEventListener('keyup', trackMods);
addEventListener('pointerdown', trackMods, true);
addEventListener('pointermove', trackMods, true);
addEventListener('blur', () => trackMods({}));
document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => setNavStyle(b.dataset.nav)));
$('tumble-mode').addEventListener('change', (e) => { tumbleMode = e.target.value; applyNav(); });

const viewDir = () => new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
const camAxis = (x, y) => new THREE.Vector3(x, y, 0).applyQuaternion(camera.quaternion);
function tumble(dx, dy) {
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -dx * 0.006)
    .multiply(new THREE.Quaternion().setFromAxisAngle(camAxis(1, 0), -dy * 0.006));
  camera.position.sub(pivot).applyQuaternion(q).add(pivot);
  camera.quaternion.premultiply(q);
}
function track(dx, dy, pane) {
  const depth = Math.max(0.05, pivot.clone().sub(camera.position).dot(viewDir()));
  const k = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))) / pane.h;
  camera.position.addScaledVector(camAxis(1, 0), -dx * k).addScaledVector(camAxis(0, 1), dy * k);
}
// Acercar se centra en el punto de interés (pivote), como en Alias; nunca lo atraviesa.
function dolly(amount) {
  const to = pivot.clone().sub(camera.position), dist = to.length();
  if (dist < 1e-6) return;
  const step = Math.min(amount * Math.max(0.2, dist), dist - 0.05);
  camera.position.addScaledVector(to.normalize(), step);
}
function tumbleObject(dx, dy, pane) {
  const q = new THREE.Quaternion().setFromAxisAngle(camAxis(0, 1), (-dx / pane.w) * Math.PI)
    .multiply(new THREE.Quaternion().setFromAxisAngle(camAxis(1, 0), (-dy / pane.h) * Math.PI));
  camera.position.sub(pivot).applyQuaternion(q).add(pivot);
  camera.quaternion.premultiply(q);
}
function twist(dx) {
  const q = new THREE.Quaternion().setFromAxisAngle(pivot.clone().sub(camera.position).normalize(), dx * 0.005);
  camera.position.sub(pivot).applyQuaternion(q).add(pivot);
  camera.quaternion.premultiply(q);
}
// Punto de la geometría bajo el cursor (superficies y curvas visibles)
function geometryPointAt(e) {
  setRay(e);
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(objects.filter((o) => o.visible).map((o) => pickTarget(o)), false)[0];
  return hit ? hit.point : null;
}
function navModeFor(e) {
  if (navStyle === 'alias') return e.shiftKey && e.altKey ? ['tumble', 'track', 'dolly'][e.button] || null : null;
  if (e.shiftKey) return null; // Shift + arrastrar = recuadro
  return ['tumble', 'dolly', 'track'][e.button] || null;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  const m = navModeFor(e);
  if (carousel) return;
  if (!m || (navStyle === 'simple' && gizmo.axis)) return; // en modo touchpad el gizmo tiene prioridad
  navDrag = { mode: m, x: e.clientX, y: e.clientY, moved: false, pane: paneAt(e.clientX) };
  renderer.domElement.setPointerCapture(e.pointerId);
  if (navStyle === 'alias') e.stopImmediatePropagation();
}, true);
addEventListener('pointermove', (e) => {
  if (!navDrag) return;
  const dx = e.clientX - navDrag.x, dy = e.clientY - navDrag.y;
  if (!navDrag.moved && Math.hypot(dx, dy) < 3) return;
  navDrag.moved = true; navDrag.x = e.clientX; navDrag.y = e.clientY;
  if (navDrag.mode === 'tumble' && proj.temp) setProjection(false);   // girar una vista del cubo vuelve a perspectiva
  const obj = tumbleMode === 'object' && navStyle === 'alias';
  if (navDrag.mode === 'tumble') obj ? tumbleObject(dx, dy, navDrag.pane) : tumble(dx, dy);
  else if (navDrag.mode === 'track') track(dx, dy, navDrag.pane);
  else if (obj) { if (Math.abs(dx) > Math.abs(dy)) twist(dx); else dolly(-dy * 0.006); }
  else dolly((dx - dy) * 0.004); // diagonal, como recomienda Alias
});
addEventListener('pointerup', (e) => {
  // Shift + Alt + clic rápido (sin arrastrar) sobre la geometría: nuevo punto de interés
  if (navDrag && !navDrag.moved && navStyle === 'alias' && e.button === 0) {
    const p = geometryPointAt(e);
    if (p) setPivot(p);
  }
  navMovedLast = !!navDrag && (navDrag.moved || navStyle === 'alias');
  if (navDrag) pivotShowUntil = performance.now() + 600;
  navDrag = null;
});
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());

// Transformar con los tres botones del ratón (Alias). Usa el mismo camino que el gizmo (mouseDown /
// objectChange / mouseUp sobre el proxy), así el snap, las mallas y los pivotes funcionan igual.
let mxDrag = null;
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
function hasTransformable() {
  return selectedCVRefs().length > 0 || (pickMode === 'object' && selObjs.some((o) => o.kind === 'mesh' && o.visible));
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!mouseXform || prefs.xform === 'gizmo' || carousel || layout === 'forge' || tool !== 'select' || pivotEdit || navHeld || (e.ctrlKey && e.shiftKey) || e.button > 2) return;
  if ((gizmo.axis && e.button === 0) || !hasTransformable()) return;
  e.stopImmediatePropagation(); e.preventDefault();
  attachGizmo();
  const pane = paneAt(e.clientX);
  useAspect(pane);
  // dirección en pantalla de cada eje (píxeles por unidad), medida en el punto de anclaje
  const r = renderer.domElement.getBoundingClientRect(), a = proxy.position.clone();
  const scr = (q) => { const v = q.clone().project(camera); return new THREE.Vector2(r.left + pane.x + ((v.x + 1) / 2) * pane.w, r.top + ((1 - v.y) / 2) * pane.h); };
  const s0 = scr(a), unit = camera.position.distanceTo(a) * 0.1;
  const dirs = AXES.map((ax) => scr(a.clone().addScaledVector(ax, unit)).sub(s0).divideScalar(unit));
  mxDrag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, dirs, e0: e, depth: camera.position.distanceTo(a), pane,
    p0: proxy.position.clone(), q0: proxy.quaternion.clone(), s0: proxy.scale.clone() };
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);
addEventListener('pointermove', (e) => {
  const m = mxDrag;
  if (!m) return;
  const dx = e.clientX - m.x, dy = e.clientY - m.y;
  if (!m.moved) {
    if (Math.hypot(dx, dy) < 3) return;
    const blk = historyBlockers();
    if (blk.length) { mxDrag = null; askBreakHistory(e.clientX, e.clientY, blk); return; }
    m.moved = true;
    gizmo.dispatchEvent({ type: 'mouseDown', mode: xform });
    if (gizmoDrag) gizmoDrag.noSnap = true;
  }
  if (xform === 'translate') {
    const d = m.dirs[m.button], L = d.lengthSq(), ax = AXES[m.button];
    // si el eje apunta a la cámara casi no se ve en pantalla: entonces se usa el movimiento vertical
    let t = L > 4 ? (dx * d.x + dy * d.y) / L : (-dy * m.depth) / m.pane.h;
    // snap combinado con la restricción del botón (como en Alias): solo se toma la componente del eje
    const modes = snapModes(e), sn = gizmoDrag && findSnap(e.clientX, e.clientY, modes, gizmoDrag.ex);
    if (sn) { t = sn.point.clone().sub(m.p0).dot(ax); showSnap(sn); }
    else if (modes.grid) { const c = m.p0.dot(ax) + t; t = Math.round(c / gridStep) * gridStep - m.p0.dot(ax); showSnap({ point: m.p0.clone().addScaledVector(ax, t), kind: 'rejilla' }); }
    else hideSnap();
    proxy.position.copy(m.p0).addScaledVector(ax, t);
  } else if (xform === 'rotate') {
    let ang = (dx - dy) * 0.012;
    if (snapModes(mods).grid) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);   // Alt: de 15 en 15 grados
    proxy.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(AXES[m.button], ang).multiply(m.q0));
  } else {
    let k = Math.exp((dx - dy) * 0.006);
    if (snapModes(mods).grid) k = Math.max(0.25, Math.round(k / 0.25) * 0.25);
    const v = m.button === 0 ? new THREE.Vector3(k, k, k) : m.button === 1 ? new THREE.Vector3(1, k, 1) : new THREE.Vector3(k, 1, k);
    proxy.scale.copy(m.s0).multiply(v);
  }
  gizmo.dispatchEvent({ type: 'objectChange' });
});
addEventListener('pointerup', (e) => {
  const m = mxDrag;
  if (!m) return;
  mxDrag = null;
  if (m.moved) { gizmo.dispatchEvent({ type: 'mouseUp', mode: xform }); hideSnap(); return; }
  // clic sin arrastrar: elegir, como siempre
  const hit = pickAt(e);
  const how = howFor(e);
  if (hit?.cvTarget) setCvTarget(hit.cvTarget, how);
  else if (hit) applySelection([hit.cv || hit.obj], how); else if (how === 'replace' && e.button === 0) clearSelection();
});
renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  const step = Math.min(Math.abs(e.deltaY), 120) / 120;
  dolly(-Math.sign(e.deltaY) * step * 0.18);
  pivotShowUntil = performance.now() + 400;
}, { passive: false });

// ---------- Pivote de la cámara ----------
// Clic o doble clic sobre un objeto lo coloca ahí; L lo lleva a la selección. Queda fijo al navegar.
function makeCross(color, size, withBall) {
  const g = new THREE.Group();
  const m = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
  const s = size, pts = [-s, 0, 0, s, 0, 0, 0, -s, 0, 0, s, 0, 0, 0, -s, 0, 0, s];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  g.add(new THREE.LineSegments(geo, m));
  if (withBall) g.add(new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true })));
  else g.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.12), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, wireframe: true })));
  g.children.forEach((c) => (c.renderOrder = 20));
  return g;
}
const pivotMarker = makeCross('#e07a1f', 0.5, true);
pivotMarker.visible = false;
scene.add(pivotMarker);
let pivotShowUntil = 0;
function setPivot(pt) {
  pivot.copy(pt);
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
// Entornos de evaluación (Map Type de Alias), generados en el shader a partir del reflejo o de la normal.
// 1 = Showroom (paneles de techo, tiras laterales, horizonte), 2 = Difuso (mate), 3 = Shade-Sky (cielo y tierra).
// uLink = luz ligada a la cámara: el entorno gira con la vista, como "Link Light to Camera" en Alias.
const envDiagMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uMode: { value: 1 }, uLink: { value: 1 } },
  vertexShader: `
    varying vec3 vWN; varying vec3 vWP;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz;
      vWN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform int uMode; uniform int uLink;
    varying vec3 vWN; varying vec3 vWP;
    vec3 toEnv(vec3 d) { return uLink == 1 ? normalize((viewMatrix * vec4(d, 0.0)).xyz) : d; }
    float box(vec2 p, vec2 c, vec2 h, float soft) {
      vec2 q = abs(p - c) - h;
      return 1.0 - smoothstep(0.0, soft, max(q.x, q.y));
    }
    // Estudio de Alias: techo y paredes claros, horizonte marcado y suelo oscuro que se refleja en la parte baja.
    // Es ese contraste claro arriba / oscuro abajo el que da brillo, sombra y profundidad a la superficie.
    vec3 showroom(vec3 d) {
      float y = d.y;
      float hz = -0.32;                                                              // horizonte bajo: las paredes claras ocupan la vista de frente
      vec3 up = mix(vec3(0.66, 0.67, 0.69), vec3(0.97, 0.97, 0.98), smoothstep(hz, 0.85, y));
      vec3 down = mix(vec3(0.12, 0.11, 0.1), vec3(0.03, 0.028, 0.026), smoothstep(hz, -0.9, y));
      vec3 col = mix(down, up, smoothstep(hz - 0.03, hz + 0.03, y));               // horizonte nítido
      col += vec3(0.3) * exp(-pow((y - hz - 0.07) * 12.0, 2.0));                   // franja luminosa sobre el horizonte
      if (y > 0.12) {                                                                // dos softbox largos en el techo
        vec2 p = vec2(d.x, d.z) / y;
        float l = box(p, vec2(-0.6, 0.0), vec2(0.16, 2.6), 0.18) + box(p, vec2(0.6, 0.0), vec2(0.16, 2.6), 0.18);
        col += vec3(1.1) * l * smoothstep(0.12, 0.35, y);
      }
      float a = atan(d.x, d.z);                                                      // ventanales verticales a los lados
      col += vec3(0.7) * (1.0 - smoothstep(0.05, 0.16, abs(abs(a) - 1.25))) * smoothstep(-0.05, 0.1, y) * (1.0 - smoothstep(0.5, 0.75, y));
      return col;
    }
    void main() {
      vec3 n = normalize(vWN);
      if (!gl_FrontFacing) n = -n;
      vec3 v = normalize(vWP - cameraPosition);
      vec3 r = toEnv(reflect(v, n));
      vec3 ne = toEnv(n);
      vec3 ve = toEnv(-v);
      vec3 L = normalize(vec3(-0.45, 0.7, 0.55)), L2 = normalize(vec3(0.6, 0.25, 0.4));   // luz principal y de relleno, ligadas a la cámara
      float dif = max(dot(ne, L), 0.0), dif2 = max(dot(ne, L2), 0.0);
      float spec = pow(max(dot(ne, normalize(L + ve)), 0.0), 90.0);
      float hemi = smoothstep(-0.9, 0.9, ne.y);                                        // oscurece lo que mira al suelo
      float fres = 0.04 + 0.96 * pow(1.0 - max(dot(ve, ne), 0.0), 5.0);
      vec3 col;
      if (uMode == 1) {
        vec3 base = vec3(0.70) * (0.12 + 0.48 * dif + 0.12 * dif2 + 0.28 * hemi);
        vec3 env = showroom(r);
        col = mix(base, env, 0.5 + 0.45 * fres) + vec3(0.9) * spec;
      } else if (uMode == 4) {
        // Arcilla oscura (estilo Plasticity): base mate que absorbe la luz de frente y solo brilla en ángulos rasantes,
        // donde el estudio se refleja nítido y traza el recorrido de la luz sobre bordes y biseles (continuidad G1/G2).
        float graze = pow(1.0 - max(dot(ve, ne), 0.0), 2.4);                          // 0 de frente, 1 rasante
        float wrap = clamp(dot(ne, L) * 0.5 + 0.5, 0.0, 1.0);
        vec3 base = vec3(0.13, 0.135, 0.145) * (0.55 + 1.5 * wrap * wrap + 0.5 * dif2) + vec3(0.06) * hemi;
        float below = smoothstep(0.1, -0.7, ne.y);                                    // lo que mira al suelo queda asentado
        base *= 1.0 - 0.55 * below;
        vec3 env = showroom(r);
        col = base + env * (0.025 + 0.95 * graze * (0.35 + 0.65 * fres)) * (1.0 - 0.6 * below) + vec3(0.35) * spec;
      } else if (uMode == 2) {
        col = vec3(0.78, 0.77, 0.75) * (0.08 + 0.62 * dif + 0.12 * dif2 + 0.3 * hemi) + vec3(0.12) * spec;
      } else {
        float t = 0.75 * ne.y + 0.25 * r.y;
        vec3 sky = vec3(0.36, 0.5, 0.92), horizon = vec3(0.97, 0.96, 0.9), ground = vec3(0.86, 0.8, 0.62), deep = vec3(0.32, 0.27, 0.2);
        col = mix(horizon, sky, smoothstep(0.3, 0.92, t));
        col = mix(col, ground, smoothstep(0.12, -0.2, t));
        col = mix(col, deep, smoothstep(-0.25, -0.9, t));
        col *= 0.55 + 0.45 * dif + 0.15 * dif2;
        col += vec3(0.7) * spec + vec3(0.25) * fres * smoothstep(0.0, 0.6, r.y);
      }
      gl_FragColor = vec4(col, 1.0);
    }`,
});
const ENV_MODES = { showroom: 1, diffuse: 2, sky: 3, clay: 4 };
const DIAG_NAMES = { showroom: 'SHOWROOM', clay: 'ARCILLA', diffuse: 'DIFUSO', sky: 'SHADE-SKY', zebra: 'CEBRA', curv: 'CURVATURA', wire: 'MALLA' };
const curvMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
// Modo Malla como el wireframe de Alias: las superficies no se pintan (siguen sirviendo para elegir) y solo se ven sus
// líneas: bordes, líneas de parche y curvas sobre superficie. Las mallas muestran solo sus aristas vivas, no los triángulos.
const wireMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
const wireFeatMat = new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.8 });

const lineMats = [];
const LM = (o) => { const m = new LineMaterial(o); lineMats.push(m); return m; };
const curveMat = LM({ color: 0x2b2a27, linewidth: 2.5 });
const curveSelMat = LM({ color: 0xe07a1f, linewidth: 3 });
const draftMat = LM({ color: 0xe07a1f, linewidth: 2 });
const edgeSelMat = LM({ color: 0xe07a1f, linewidth: 2.5 });
// Líneas de los parches (límites de cada span), siempre visibles en el diagnóstico
const isoMat = LM({ color: 0x4a8fe0, linewidth: 1.6 }); // líneas de parche en azul: se ven sobre cebra blanca y negra
const isoSelMat = LM({ color: 0xe07a1f, linewidth: 1.8 });
const wireLineMat = LM({ color: 0xe8e8e8, linewidth: 1.1 });   // líneas del modo Malla (blancas u oscuras según el tema)
// Colores del historial (como Alias): verde = tiene historial de construcción, rosa = depende de lo elegido, azul = sin historial
const isoHistMat = LM({ color: 0x2fb36b, linewidth: 1.8 });
const isoDepMat = LM({ color: 0xff5fb0, linewidth: 1.8 });
const curveHistMat = LM({ color: 0x2fb36b, linewidth: 2.5 });
// bordes de recorte (límite entre caras): líneas finas y nítidas, como los filos de Plasticity
const edgeCurveMat = LM({ color: 0x1b1d21, linewidth: 1.1, transparent: true, opacity: 0.9 });
const curveDepMat = LM({ color: 0xff5fb0, linewidth: 2.5 });
// Polígono de control: punteado en naranja claro; las aristas (borde de la red de una superficie), continuas en naranja oscuro
const hullMat = new THREE.LineDashedMaterial({ color: '#ffb46b', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.85 });
const hullEdgeMat = new THREE.LineBasicMaterial({ color: '#c2560f' });
const combMat = new THREE.LineBasicMaterial({ color: '#e07a1f', transparent: true, opacity: 0.55 });
const envMat = new THREE.LineBasicMaterial({ color: '#e07a1f' });
// CVs como pequeños objetos 3D: una cruz "+" fina, plana y orientada con la geometría (en superficies queda
// tumbada sobre el plano tangente, con los brazos en U y V; en curvas, sobre la tangente y la normal) y,
// en las esquinas de las superficies, un cubo pequeño para distinguirlas. Cada CV es una esfera invisible (fácil de elegir) con la figura dentro;
// se escalan con la distancia a la cámara para verse siempre del mismo tamaño.
const handleGeo = new THREE.SphereGeometry(0.75, 10, 8);
const handlePickMat = new THREE.MeshBasicMaterial({ visible: false });
const plusGeo = mergeGeometries([new THREE.BoxGeometry(1.2, 0.121, 0.055), new THREE.BoxGeometry(0.121, 1.2, 0.055)]);
const cornerGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
const handleMat = new THREE.MeshStandardMaterial({ color: '#2f7bff', roughness: 0.4, metalness: 0.1, depthTest: false, transparent: true, opacity: 0.85 });
const handleSelMat = new THREE.MeshStandardMaterial({ color: '#ff8a1f', emissive: '#5a2400', roughness: 0.4, metalness: 0.1, depthTest: false, transparent: true });
const HANDLE_PX = 0.013;   // tamaño en pantalla (fracción de la distancia a la cámara)
function makeHandle(corner, sel) {
  const h = new THREE.Mesh(handleGeo, handlePickMat);
  const shape = new THREE.Mesh(corner ? cornerGeo : plusGeo, sel ? handleSelMat : handleMat);
  shape.renderOrder = 10;
  h.add(shape);
  h.renderOrder = 10;
  return h;
}
function scaleHandles() {
  const groups = objects.filter((o) => o.parts.handles.visible).map((o) => o.parts.handles);
  if (draftHandles.visible) groups.push(draftHandles);
  for (const g of groups) for (const h of g.children) h.scale.setScalar(camera.position.distanceTo(h.position) * HANDLE_PX);
}

const THEME_3D = {
  dark: { curve: 0xe8e6e1, grid: 0x8a8781, iso: '#000000', shadow: 0.55 },
  light: { curve: 0x2b2a27, grid: 0x6e6b66, iso: '#0b0d10', shadow: 0.35 },
};
function applyTheme3D() {
  const t = THEME_3D[theme];
  curveMat.color.setHex(t.curve);
  edgeCurveMat.color.setHex(theme === 'dark' ? 0xd6dae2 : 0x1b1d21);
  grid.material.color.setHex(t.grid);
  ground.material.opacity = t.shadow;
}
function setTheme(t) {
  theme = t;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('forja-theme', t); } catch (e) { /* sin almacenamiento */ }
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)));
  repaintWall();
  applyTheme3D();
}
document.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)));

let diagMode = 'showroom', layout = 'diag', matKey = 'paint', res = 90, combScale = 0.8;

// ---------- Objetos de la escena ----------
const objects = [];
let nextId = 1;
const counters = {};
const nameFor = (base) => { counters[base] = (counters[base] || 0) + 1; return `${base} ${counters[base]}`; };

function addSurface(data, base = 'Superficie') {
  checkpoint();
  const obj = { id: nextId++, kind: 'surface', name: nameFor(base), data, mat: matKey, visible: true, parts: {}, pivot: cvCenter(data) };
  initObj(obj);
  const p = obj.parts;
  p.mesh = new THREE.Mesh(new THREE.BufferGeometry(), materials[obj.mat]);
  p.mesh.castShadow = true;
  p.mesh.userData.obj = obj;
  p.iso = new LineSegments2(new LineSegmentsGeometry(), isoMat); p.iso.layers.set(DIAG);
  p.bound = new LineSegments2(new LineSegmentsGeometry(), wireLineMat); p.bound.layers.set(DIAG);   // bordes (modo Malla)
  p.hull = new THREE.LineSegments(new THREE.BufferGeometry(), hullMat); p.hull.layers.set(DIAG);
  p.hullEdge = new THREE.LineSegments(new THREE.BufferGeometry(), hullEdgeMat); p.hullEdge.layers.set(DIAG);
  p.hull.add(p.hullEdge);   // hijo: se muestra y se oculta junto con el polígono
  p.edge = new Line2(new LineGeometry(), edgeSelMat); p.edge.renderOrder = 6;
  p.handles = new THREE.Group();
  scene.add(p.mesh, p.iso, p.bound, p.hull, p.edge, p.handles);
  objects.push(obj);
  updateObject(obj);
  refreshOutliner();
  return obj;
}

function addCurve(data, base = 'Curva') {
  checkpoint();
  const obj = { id: nextId++, kind: 'curve', name: nameFor(base), data, visible: true, parts: {}, pivot: cvCenter(data) };
  initObj(obj);
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

// Malla importada (OBJ, STL, GLB, PLY): se ve, se evalúa con los shaders y se exporta, pero no tiene CVs.
function addMesh(geometry, base = 'Malla') {
  geometry.computeBoundingBox();
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  if (!geometry.attributes.color) {
    // color blanco para el mapa de curvatura (que en las mallas no se calcula)
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geometry.attributes.position.count * 3).fill(1), 3));
  }
  checkpoint();
  const obj = { id: nextId++, kind: 'mesh', name: nameFor(base), data: { geometry }, mat: matKey, visible: true, parts: {},
    pivot: geometry.boundingBox.getCenter(new THREE.Vector3()) };
  initObj(obj);
  const p = obj.parts;
  p.mesh = new THREE.Mesh(geometry, materials[obj.mat]);
  p.mesh.castShadow = true;
  p.mesh.userData.obj = obj;
  p.hull = new THREE.LineSegments(new THREE.BufferGeometry(), hullMat);
  p.handles = new THREE.Group();
  scene.add(p.mesh, p.hull, p.handles);
  objects.push(obj);
  applyVisibility(obj);
  refreshOutliner();
  return obj;
}
const pickTarget = (o) => (o.kind === 'curve' ? o.parts.pick : o.parts.mesh);

function removeObject(obj) {
  checkpoint();
  if (!restoring) dropRelations(obj.id);
  for (const o of Object.values(obj.parts)) { o.geometry?.dispose(); scene.remove(o); }
  objects.splice(objects.indexOf(obj), 1);
  selObjs.splice(0, selObjs.length, ...selObjs.filter((o) => o !== obj));
  const host = !restoring && obj.data?.cos && byId(obj.data.cos.surf);
  if (host) { updateSurface(host); applyVisibility(host); }
  for (const [k, ref] of selCVs) if (ref.obj === obj) selCVs.delete(k);
}

// Pivote del objeto: centro de giro y escala al transformarlo. Empieza en el centro de sus CVs.
function cvCenter(data) {
  const all = data.cvs.flat(), c = new THREE.Vector3();
  all.forEach((p) => { c.x += p.x; c.y += p.y; c.z += p.z; });
  return c.divideScalar(all.length);
}

const setGeo = (o, g) => { o.geometry.dispose(); o.geometry = g; };
const posGeo = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3)); return g; };
const line2Geo = (pts) => { const g = new LineGeometry(); g.setPositions(pts); return g; };

function updateObject(obj) {
  if (obj.kind === 'mesh') { applyVisibility(obj); return; }
  if (obj.kind === 'surface') updateSurface(obj); else updateCurve(obj);
  rebuildHandles(obj);
  applyVisibility(obj);
  if (!propagating && !restoring && relations.length && !(prefs.histLive === false && gizmoDrag)) propagateFrom(obj);
}

function updateSurface(obj) {
  const p = obj.parts, d = obj.data;
  const s = N.surfaceOf(d);
  let geo = new ParametricGeometry((u, v, t) => s.getPoint(u, v, t), res, res);
  if (diagMode === 'curv') curvatureColors(geo, res);
  // recortes: curvas sobre esta superficie con "Recortar" dentro o fuera
  const trims = objects.filter((c) => c.kind === 'curve' && c.data.cos?.surf === obj.id && c.data.cos.trim && c.data.cos.trim !== 'none')
    .map((c) => ({ loop: FF.trimLoop(c.data.cos), trim: c.data.cos.trim })).filter((x) => x.loop);
  const rm = trims.length ? FF.removedFn(trims) : null;
  obj.removed = rm;
  if (rm) geo = FF.trimGeometry(geo, res, rm, (u, v) => { const q = new THREE.Vector3(); s.getPoint(u, v, q); return q; });
  setGeo(p.mesh, geo);
  // Isoparamétricas en los límites de cada span, como en Alias (sin lo recortado)
  const iso = [], S = 60, t = new THREE.Vector3();
  obj.isoLines = [];   // polilíneas de cada isoparamétrica interior (para el snap de curva)
  const seg = (uv, inner) => {
    let line = null;
    for (let k = 0; k < S; k++) {
      const [u0, v0] = uv(k / S), [u1, v1] = uv((k + 1) / S);
      if (rm && rm((u0 + u1) / 2, (v0 + v1) / 2)) { line = null; continue; }
      s.getPoint(u0, v0, t); iso.push(t.x, t.y, t.z);
      if (inner) { if (!line) obj.isoLines.push((line = [t.clone()])); }
      s.getPoint(u1, v1, t); iso.push(t.x, t.y, t.z);
      if (inner) line.push(t.clone());
    }
  };
  const inside = (k) => k > 1e-6 && k < 1 - 1e-6;
  N.uniqueKnots(d.knotsU).forEach((u) => seg((a) => [u, a], inside(u)));
  N.uniqueKnots(d.knotsV).forEach((v) => seg((a) => [a, v], inside(v)));
  { const g = new LineSegmentsGeometry(); g.setPositions(iso); setGeo(p.iso, g); }
  // bordes de la superficie (modo Malla); los bordes de un recorte los dibuja su curva sobre superficie
  {
    const b = [], a = new THREE.Vector3(), c = new THREE.Vector3(), B = 80;
    const edge = (uv) => { for (let k = 0; k < B; k++) { const [u0, v0] = uv(k / B), [u1, v1] = uv((k + 1) / B); if (rm && rm((u0 + u1) / 2, (v0 + v1) / 2)) continue; s.getPoint(u0, v0, a); s.getPoint(u1, v1, c); b.push(a.x, a.y, a.z, c.x, c.y, c.z); } };
    edge((x) => [x, 0]); edge((x) => [x, 1]); edge((x) => [0, x]); edge((x) => [1, x]);
    const g = new LineSegmentsGeometry(); g.setPositions(b.length ? b : [0, 0, 0, 0, 0, 0]); setGeo(p.bound, g);
  }
  const hull = [], rim = [], nu = d.cvs.length, nv = d.cvs[0].length;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = d.cvs[i][j];
    if (i < nu - 1) { const b = d.cvs[i + 1][j]; (j === 0 || j === nv - 1 ? rim : hull).push(a.x, a.y, a.z, b.x, b.y, b.z); }
    if (j < nv - 1) { const b = d.cvs[i][j + 1]; (i === 0 || i === nu - 1 ? rim : hull).push(a.x, a.y, a.z, b.x, b.y, b.z); }
  }
  setGeo(p.hull, posGeo(hull));
  setGeo(p.hullEdge, posGeo(rim));
  p.hull.computeLineDistances();
  const loop = [], E = 40;
  const at = (u, v) => { s.getPoint(u, v, t); loop.push(t.x, t.y, t.z); };
  for (let k = 0; k <= E; k++) at(k / E, 0);
  for (let k = 1; k <= E; k++) at(1, k / E);
  for (let k = 1; k <= E; k++) at(1 - k / E, 1);
  for (let k = 1; k <= E; k++) at(0, 1 - k / E);
  setGeo(p.edge, line2Geo(loop));
  obj.edgePts = [];
  for (let k = 0; k < loop.length; k += 3) obj.edgePts.push(new THREE.Vector3(loop[k], loop[k + 1], loop[k + 2]));
  obj.corners = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => { const c = new THREE.Vector3(); s.getPoint(u, v, c); return c; });
}

function updateCurve(obj) {
  const p = obj.parts, d = obj.data;
  const crv = N.curveOf(d), pts = [], S = 200;
  const host = d.cos && byId(d.cos.surf);
  // curva sobre superficie: se dibuja exacta sobre ella (un poco levantada por la normal para que se vea)
  if (host) FF.cosPoints(host.data, d.cos.uv, 0.004).forEach((q) => pts.push(q.x, q.y, q.z));
  else for (let s = 0; s <= S; s++) { const q = crv.getPoint(s / S); pts.push(q.x, q.y, q.z); }
  setGeo(p.line, line2Geo(pts));
  setGeo(p.pick, posGeo(pts));
  obj.samples = [];
  for (let k = 0; k < pts.length; k += 3) obj.samples.push(new THREE.Vector3(pts[k], pts[k + 1], pts[k + 2]));
  obj.editPts = N.uniqueKnots(d.knots).map((k) => crv.getPoint(k));
  setGeo(p.hull, posGeo(d.cvs.flatMap((q) => [q.x, q.y, q.z])));
  p.hull.computeLineDistances();
  buildComb(p, crv);
  // la superficie que la lleva se vuelve a recortar
  if (host && !restoring) { updateSurface(host); applyVisibility(host); }
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
  if (obj.kind === 'mesh') return out;
  if (obj.kind === 'surface') obj.data.cvs.forEach((row, i) => row.forEach((_, j) => out.push({ obj, i, j, key: cvKey(obj, i, j) })));
  else obj.data.cvs.forEach((_, i) => out.push({ obj, i, key: cvKey(obj, i) }));
  return out;
}
// Orientación de la cruz a partir de los CVs vecinos (direcciones U y V, o tangente de la curva)
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3(), _m = new THREE.Matrix4();
function orientHandle(shape, obj, ref) {
  const cv = (q) => _n.set(q.x, q.y, q.z);
  if (obj.kind === 'surface') {
    const g = obj.data.cvs, nu = g.length, nv = g[0].length, i = ref.i, j = ref.j;
    _a.copy(cv(g[Math.min(nu - 1, i + 1)][j])).sub(cv(g[Math.max(0, i - 1)][j]));
    _b.copy(cv(g[i][Math.min(nv - 1, j + 1)])).sub(cv(g[i][Math.max(0, j - 1)]));
    const z = new THREE.Vector3().crossVectors(_a, _b);
    if (z.lengthSq() < 1e-12 || _a.lengthSq() < 1e-12) return;
    z.normalize(); const x = _a.normalize(), y = new THREE.Vector3().crossVectors(z, x);
    shape.quaternion.setFromRotationMatrix(_m.makeBasis(x, y, z));
  } else {
    // curvas: un brazo sobre la tangente y el otro sobre la normal, en el plano de la curva
    const c = obj.data.cvs, i = ref.i;
    const x = cv(c[Math.min(c.length - 1, i + 1)]).clone().sub(cv(c[Math.max(0, i - 1)]));
    if (x.lengthSq() < 1e-12) return;
    x.normalize();
    const z = N.curvePlaneNormal(obj.data);
    z.addScaledVector(x, -z.dot(x));
    if (z.lengthSq() < 1e-6) return;
    z.normalize();
    shape.quaternion.setFromRotationMatrix(_m.makeBasis(x, new THREE.Vector3().crossVectors(z, x), z));
  }
}
function rebuildHandles(obj) {
  const g = obj.parts.handles;
  g.clear();
  for (const ref of allCVRefs(obj)) {
    const p = cvRef(ref);
    const nu = obj.kind === 'surface' ? obj.data.cvs.length : 0, nv = nu ? obj.data.cvs[0].length : 0;
    const corner = nu > 0 && (ref.i === 0 || ref.i === nu - 1) && (ref.j === 0 || ref.j === nv - 1);
    const h = makeHandle(corner, selCVs.has(ref.key));
    h.position.set(p.x, p.y, p.z);
    orientHandle(h.children[0], obj, ref);
    h.userData = ref;
    g.add(h);
  }
}

function applyVisibility(obj) {
  const p = obj.parts, vis = obj.visible, sel = selObjs.includes(obj), cvMode = pickMode === 'cv';
  p.handles.visible = p.hull.visible = vis && cvMode && !modelClean && cvTargets.has(obj.id);
  if (obj.kind === 'mesh') {
    p.mesh.visible = vis;
  } else if (obj.kind === 'surface') {
    p.mesh.visible = vis;
    const wire = diagMode === 'wire';
    p.iso.visible = vis && (wire || ($('show-iso').checked && !modelClean));
    p.iso.material = sel ? isoSelMat : histState(obj) === 'dep' ? isoDepMat : histState(obj) === 'hist' ? isoHistMat : wire ? wireLineMat : isoMat;
    if (p.bound) { p.bound.visible = vis && wire; p.bound.material = sel ? isoSelMat : wireLineMat; }
    p.edge.visible = vis && sel;
  } else {
    p.line.visible = vis;
    p.line.material = sel ? curveSelMat : histState(obj) === 'dep' ? curveDepMat : histState(obj) === 'hist' ? curveHistMat : obj.data.cos?.edge ? edgeCurveMat : curveMat;
    p.comb.visible = p.env.visible = vis && $('show-comb').checked && !modelClean && !obj.data.cos?.edge;   // los bordes de recorte no llevan peine
  }
}

// ---------- Selección ----------
let pickMode = 'object';
// En modo CV solo se encienden los CVs de los objetos elegidos (como en Alias): los que estaban elegidos al pasar a CV,
// y los que se tocan con un clic en modo CV (clic = solo ese, Shift / medio = añadir).
const cvTargets = new Set();
// Filtro del modo Objetos (como Pick Curves / Pick Surfaces de Alias): null = todo, 'curve' o 'surface'
let pickFilter = null;
const pickable = (o) => o.visible && (!pickFilter || (pickFilter === 'curve' ? o.kind === 'curve' : o.kind !== 'curve'));
const PICK_NAMES = { curve: 'curvas', surface: 'superficies' };
const selObjs = []; // en orden de selección (importa para el loft)
const selCVs = new Map();

function setPickMode(m, filter = null) {
  if (m === pickMode && filter === pickFilter) return;
  if (m === 'cv' && pickMode !== 'cv') {
    cvTargets.clear();
    selObjs.filter((o) => o.kind !== 'mesh').forEach((o) => cvTargets.add(o.id));
    if (!cvTargets.size) toast('Modo CV: haz clic en una superficie o curva para encender sus CVs (Shift: añadir otra).');
  }
  pickMode = m; pickFilter = m === 'object' ? filter : null;
  if (pickFilter) toast(`Elegir solo ${PICK_NAMES[pickFilter]}.`);
  document.querySelectorAll('[data-pick]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pick === m)));
  selObjs.length = 0; selCVs.clear(); mouseXform = false;
  selectionChanged(); updateHint();
}

// how: 'replace' | 'toggle' | 'remove'
function applySelection(items, how) {
  items = expandGroups(items);
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
function setCvTarget(obj, how) {
  if (how === 'replace') { cvTargets.clear(); cvTargets.add(obj.id); for (const [k, r] of selCVs) if (r.obj !== obj) selCVs.delete(k); }
  else if (how === 'remove' || (how === 'toggle' && cvTargets.has(obj.id))) { cvTargets.delete(obj.id); for (const [k, r] of selCVs) if (r.obj === obj) selCVs.delete(k); }
  else cvTargets.add(obj.id);
  selectionChanged();
  toast(`CVs encendidos: ${objects.filter((o) => cvTargets.has(o.id)).map((o) => o.name).join(', ') || 'ninguno'}`);
}
function clearSelection() { selObjs.length = 0; selCVs.clear(); selectionChanged(); }

function selectionChanged() {
  recomputeDeps();
  if (typeof forgeSelectionChanged === 'function') forgeSelectionChanged();
  if (pivotEdit && (pickMode !== 'object' || !selObjs.length)) { pivotEdit = false; gizmo.setMode(xform); updateXformButtons(); }
  objects.forEach((o) => {
    applyVisibility(o);
    o.parts.handles.children.forEach((h) => (h.children[0].material = selCVs.has(h.userData.key) ? handleSelMat : handleMat));
  });
  attachGizmo();
  renderSelectionPanel();
  refreshOutliner();
  updateStatus();
  if (toolsReady) syncToolWinToSelection();
}

// Gizmo: se coloca en el centro de lo seleccionado y mueve todos los CVs afectados a la vez
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.8);
gizmo._getPointer = (e) => { const n = paneNDC(e, dragPane || paneAt(e.clientX)); return { x: n.x, y: n.y, button: e.button }; };
scene.add(gizmo);
const proxy = new THREE.Object3D();
scene.add(proxy);

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
// Transformar: mover, rotar o escalar. En modo Objetos cada objeto gira y escala alrededor de su
// propio pivote (como en Alias); en modo CVs, alrededor del centro de los CVs elegidos.
let xform = 'translate', pivotEdit = false;
// Como en Alias: con Mover/Rotar/Escalar activo, arrastrar en la vista transforma lo elegido con los tres
// botones del ratón (izq = X, medio = Y, der = Z). El gizmo de ejes sigue funcionando igual.
let mouseXform = false;
function setXform(m) {
  xform = m; pivotEdit = false; mouseXform = true;
  gizmo.setMode(m);
  updateXformButtons(); attachGizmo();
}
function togglePivotEdit() {
  if (pivotEdit) { pivotEdit = false; gizmo.setMode(xform); updateXformButtons(); attachGizmo(); renderSelectionPanel(); return; }
  if (pickMode !== 'object' || !selObjs.length) return toast('Selecciona un objeto (modo Objetos) para editar su pivote.');
  pivotEdit = true;
  gizmo.setMode('translate');
  updateXformButtons(); attachGizmo(); renderSelectionPanel();
  toast('Editar pivote: mueve el pivote. Ctrl = pegarlo a un punto, Ctrl+Alt = a una curva, Alt = a la rejilla.');
}
function centerPivots() {
  selObjs.forEach((o) => (o.pivot = o.kind === 'mesh' ? o.data.geometry.boundingBox.getCenter(new THREE.Vector3()) : cvCenter(o.data)));
  attachGizmo(); renderSelectionPanel();
}
function updateXformButtons() {
  [['t-move', 'translate'], ['t-rotate', 'rotate'], ['t-scale', 'scale']].forEach(([id, m]) => $(id).setAttribute('aria-pressed', String(!pivotEdit && xform === m)));
  $('t-pivot').setAttribute('aria-pressed', String(pivotEdit));
  updateHint();
}
function gizmoAnchor() {
  if (pickMode === 'object' && selObjs.length) return selObjs[selObjs.length - 1].pivot.clone();
  return centroid(selectedCVRefs());
}
function attachGizmo() {
  const refs = selectedCVRefs();
  const meshSel = pickMode === 'object' && selObjs.some((o) => o.kind === 'mesh' && o.visible);
  if ((!refs.length && !meshSel) || tool !== 'select') { gizmo.detach(); return; }
  proxy.position.copy(gizmoAnchor());
  proxy.quaternion.identity(); proxy.scale.set(1, 1, 1);
  // como en Alias: con Mover/Rotar/Escalar activos se transforma con los botones del ratón y el manipulador no estorba
  if (mouseXform && !pivotEdit && prefs.xform === 'mouse') { gizmo.detach(); return; }
  gizmo.attach(proxy);
}
let gizmoDrag = null;
gizmo.addEventListener('mouseDown', () => {
  checkpoint();
  const refs = pivotEdit ? [] : selectedCVRefs();
  const objs = affectedObjects(), center = proxy.position.clone(), objMode = pickMode === 'object';
  gizmoDrag = {
    p0: proxy.position.clone(), q0: proxy.quaternion.clone(), s0: proxy.scale.clone(),
    items: refs.map((r) => ({ v: cvRef(r), orig: cvRef(r).clone(), c: objMode ? r.obj.pivot.clone() : center })),
    pivots: objMode ? objs.map((o) => ({ o, orig: o.pivot.clone() })) : [],
    // las mallas no tienen CVs: se guarda su geometría original y se le aplica la transformación entera
    meshes: !pivotEdit && objMode ? objs.filter((o) => o.kind === 'mesh').map((o) => {
      const g = o.data.geometry;
      return { o, pos: g.attributes.position.array.slice(), nor: g.attributes.normal?.array.slice(), c: o.pivot.clone() };
    }) : [],
    objs,
    ex: pivotEdit
      ? { pivots: new Set(objs) }
      : { cvs: new Set(refs.map(cvRef)), [objMode ? 'full' : 'partial']: new Set(objs), pivots: new Set(objMode ? objs : []) },
  };
});
let pendingUpdate = null, pendingObjs = [];
// Aplica la última actualización pendiente (si se suelta el ratón justo después de mover, no se pierde)
function flushPending() {
  if (pendingUpdate) cancelAnimationFrame(pendingUpdate);
  pendingUpdate = null;
  pendingObjs.forEach(updateObject);
  pendingObjs = [];
  updateCVReadout();
}
gizmo.addEventListener('mouseUp', () => { gizmoDrag = null; flushPending(); hideSnap(); attachGizmo(); renderSelectionPanel(); });
gizmo.addEventListener('objectChange', () => {
  const g = gizmoDrag;
  if (!g) return;
  const mode = pivotEdit ? 'translate' : xform;
  const t = new THREE.Vector3();
  if (mode === 'translate') {
    if (!g.noSnap) applySnapToProxy(g.ex);
    const d = proxy.position.clone().sub(g.p0);
    g.items.forEach(({ v, orig }) => { v.x = orig.x + d.x; v.y = orig.y + d.y; v.z = orig.z + d.z; });
    g.pivots.forEach(({ o, orig }) => o.pivot.copy(orig).add(d));
  } else if (mode === 'rotate') {
    const q = proxy.quaternion.clone().multiply(g.q0.clone().invert());
    g.items.forEach(({ v, orig, c }) => { t.set(orig.x - c.x, orig.y - c.y, orig.z - c.z).applyQuaternion(q).add(c); v.x = t.x; v.y = t.y; v.z = t.z; });
  } else {
    const k = proxy.scale.clone().divide(g.s0);
    g.items.forEach(({ v, orig, c }) => { v.x = c.x + (orig.x - c.x) * k.x; v.y = c.y + (orig.y - c.y) * k.y; v.z = c.z + (orig.z - c.z) * k.z; });
  }
  if (!pivotEdit && g.meshes.length) {
    const M = new THREE.Matrix4();
    for (const m of g.meshes) {
      const T = new THREE.Matrix4().makeTranslation(m.c.x, m.c.y, m.c.z), Ti = new THREE.Matrix4().makeTranslation(-m.c.x, -m.c.y, -m.c.z);
      if (mode === 'translate') M.makeTranslation(...proxy.position.clone().sub(g.p0).toArray());
      else if (mode === 'rotate') M.copy(T).multiply(new THREE.Matrix4().makeRotationFromQuaternion(proxy.quaternion.clone().multiply(g.q0.clone().invert()))).multiply(Ti);
      else { const k = proxy.scale.clone().divide(g.s0); M.copy(T).multiply(new THREE.Matrix4().makeScale(k.x, k.y, k.z)).multiply(Ti); }
      const geo = m.o.data.geometry;
      geo.attributes.position.array.set(m.pos);
      if (m.nor) geo.attributes.normal.array.set(m.nor);
      geo.applyMatrix4(M);
      geo.computeBoundingBox(); geo.computeBoundingSphere();
    }
  }
  if (pivotEdit) { updatePivotReadout(); return; }
  pendingObjs = g.objs;
  if (!pendingUpdate) pendingUpdate = requestAnimationFrame(flushPending);
});

// ---------- Snap ----------
// Como en Alias: mantener Alt = rejilla, Ctrl = punto, Ctrl+Alt = curva (en Mac, Cmd hace de Alt).
// Los botones de arriba los dejan activos sin mantener teclas.
const snapToggles = { grid: false, curve: false, point: false, surface: false };
let gridStep = 0.25;
const SNAP_PX = 22;
function snapModes(e) {
  const m = { ...snapToggles };
  if (e && !(e.shiftKey && e.altKey)) {
    const alt = e.altKey || e.metaKey;
    if (e.ctrlKey && alt) m.curve = true; else if (e.ctrlKey) m.point = true; else if (alt) m.grid = true;
  }
  return m;
}
function updateSnapButtons() {
  const held = snapModes(mods);
  for (const k of ['grid', 'curve', 'point']) {
    const b = $('snap-' + k);
    b.setAttribute('aria-pressed', String(snapToggles[k]));
    b.classList.toggle('held', held[k] && !snapToggles[k]);
  }
  // los mismos snaps en la barra de dibujo (más el de superficie: fijo o Shift mantenido)
  document.querySelectorAll('[data-snapbtn]').forEach((b) => {
    const k = b.dataset.snapbtn, h = k === 'surface' ? mods.shiftKey && !mods.altKey : held[k];
    b.setAttribute('aria-pressed', String(!!snapToggles[k]));
    b.classList.toggle('held', !!h && !snapToggles[k]);
  });
  gizmo.setRotationSnap(held.grid ? Math.PI / 12 : null);
  gizmo.setScaleSnap(held.grid ? 0.25 : null);
}
function snapGrid(p, planeKind) {
  const r = (v) => Math.round(v / gridStep) * gridStep;
  if (planeKind !== 'yz') p.x = r(p.x);
  if (planeKind !== 'xz') p.y = r(p.y);
  if (planeKind !== 'xy') p.z = r(p.z);
  return p;
}
// Candidatos para el snap de punto: CVs, pivotes, puntos de edición y extremos de curvas, esquinas, origen
function pointCandidates(ex) {
  const out = [new THREE.Vector3()];
  if (draft) draft.pts.forEach((p) => out.push(p));
  for (const o of objects) {
    if (!o.visible || ex.full?.has(o)) continue;
    if (!ex.pivots?.has(o)) out.push(o.pivot);
    allCVRefs(o).forEach((r) => { const v = cvRef(r); if (!ex.cvs?.has(v)) out.push(new THREE.Vector3(v.x, v.y, v.z)); });
    if (!ex.partial?.has(o)) ((o.kind === 'curve' ? o.editPts : o.corners) || []).forEach((v) => out.push(v));
    // "Snap al centro" (opciones del snap de curva de Alias): centro de la caja de cada curva
    if (prefs.snapCenter && o.kind === 'curve' && o.samples?.length && !ex.partial?.has(o)) out.push(new THREE.Box3().setFromPoints(o.samples).getCenter(new THREE.Vector3()));
  }
  return out;
}
// Para el snap de curva: curvas y bordes de superficies, como polilíneas
function curvePolylines(ex) {
  const out = [];
  for (const o of objects.filter((o) => o.visible && o.kind !== 'mesh' && !ex.full?.has(o) && !ex.partial?.has(o))) {
    if (o.kind === 'curve') { if (o.samples) out.push(o.samples); continue; }
    const e = o.edgePts || [], E = (e.length - 1) / 4;   // el contorno son 4 bordes seguidos
    for (let k = 0; k < 4 && E >= 1; k++) out.push(e.slice(k * E, k * E + E + 1));
    // y las líneas de parche (isoparamétricas de los límites de span), sin las partes recortadas
    if (prefs.snapIso !== false) (o.isoLines || []).forEach((l) => out.push(l));
  }
  return out;
}
// Divisiones (Alias: "Snap Divisions"): con 2 se puede pegar al punto medio, con 3 a los tercios, etc. (por longitud)
function divisionPoints(line, n) {
  const acc = [0];
  for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + line[i].distanceTo(line[i - 1]));
  const L = acc[acc.length - 1], out = [];
  for (let k = 0; k <= n; k++) {
    const t = (k / n) * L;
    let i = 1; while (i < acc.length - 1 && acc[i] < t) i++;
    const f = (t - acc[i - 1]) / ((acc[i] - acc[i - 1]) || 1);
    out.push(line[i - 1].clone().lerp(line[i], Math.min(1, Math.max(0, f))));
  }
  return out;
}
function findSnap(x, y, modes, ex = {}) {
  if (!modes.point && !modes.curve) return null;
  const p = paneAt(x);
  useAspect(p);
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
  const scr = (q) => { v.copy(q).project(camera); return v.z > 1 ? null : { x: r.left + p.x + ((v.x + 1) / 2) * p.w, y: r.top + ((1 - v.y) / 2) * p.h }; };
  let best = null, bestD = SNAP_PX;
  if (modes.point) {
    for (const q of pointCandidates(ex)) {
      const s = scr(q);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bestD) { bestD = d; best = { point: q.clone(), kind: 'punto' }; }
    }
  }
  if (!best && modes.curve && (prefs.snapDiv || 0) >= 2) {
    let bd = SNAP_PX * 1.6;
    for (const line of curvePolylines(ex)) for (const q of divisionPoints(line, prefs.snapDiv)) {
      const s = scr(q);
      if (!s) continue;
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < bd) { bd = d; best = { point: q, kind: `curva · 1/${prefs.snapDiv}` }; }
    }
  }
  if (!best && modes.curve) {
    for (const line of curvePolylines(ex)) {
      let prev = null;
      for (let i = 0; i < line.length; i++) {
        const s = scr(line[i]);
        if (s && prev) {
          // punto más cercano al cursor sobre el segmento en pantalla, llevado al segmento 3D
          const ax = prev.s.x, ay = prev.s.y, bx = s.x - ax, by = s.y - ay, L = bx * bx + by * by || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * bx + (y - ay) * by) / L));
          const d = Math.hypot(ax + bx * t - x, ay + by * t - y);
          if (d < bestD) { bestD = d; best = { point: line[i - 1].clone().lerp(line[i], t), kind: 'curva' }; }
        }
        prev = s ? { s: { ...s } } : null;
      }
    }
  }
  return best;
}
function applySnapToProxy(ex) {
  const modes = snapModes(mods);
  const s = findSnap(lastPtr.x, lastPtr.y, modes, ex);
  if (s) { proxy.position.copy(s.point); showSnap(s); return; }
  if (modes.grid) { snapGrid(proxy.position, null); showSnap({ point: proxy.position, kind: 'rejilla' }); return; }
  hideSnap();
}
const snapRing = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.15, 28), new THREE.MeshBasicMaterial({ color: '#2f8a57', depthTest: false, transparent: true, side: THREE.DoubleSide }));
snapRing.renderOrder = 30; snapRing.visible = false;
scene.add(snapRing);
function showSnap(s) { snapRing.position.copy(s.point); snapRing.visible = true; $('st-snap').textContent = `Snap: ${s.kind}`; }
function hideSnap() { snapRing.visible = false; $('st-snap').textContent = ''; }

// Marcadores del pivote de cada objeto seleccionado
const objPivotMarkers = new THREE.Group();
scene.add(objPivotMarkers);
function syncPivotMarkers() {
  const list = pickMode === 'object' ? selObjs.filter((o) => o.visible) : [];
  while (objPivotMarkers.children.length < list.length) objPivotMarkers.add(makeCross('#2d6aa8', 0.35, false));
  objPivotMarkers.children.forEach((m, i) => {
    m.visible = i < list.length;
    if (m.visible) { m.position.copy(list[i].pivot); m.scale.setScalar(camera.position.distanceTo(list[i].pivot) * 0.05); }
  });
}

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
    // de los CVs tocados, el más cercano al rayo (al cursor en pantalla), no el más cercano a la cámara
    const hits = ray.intersectObjects(live.filter((o) => cvTargets.has(o.id)).flatMap((o) => o.parts.handles.children), false);
    let best = null, bd = Infinity;
    for (const h of hits) { const d = ray.ray.distanceSqToPoint(h.object.position) / h.object.scale.x ** 2; if (d < bd) { bd = d; best = h; } }
    if (best) return { cv: best.object.userData };
    // si no se tocó un CV, el objeto bajo el cursor enciende (o apaga) sus CVs
    ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
    const oh = ray.intersectObjects(live.filter((o) => o.kind !== 'mesh').map((o) => pickTarget(o)), false)[0];
    return oh ? { cvTarget: oh.object.userData.obj } : null;
  }
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(live.filter(pickable).map((o) => pickTarget(o)), false)[0];
  return hit ? { obj: hit.object.userData.obj, point: hit.point } : null;
}

// ---------- Herramientas ----------
let tool = 'select';
// Plano de construcción. 'auto' (por defecto) depende de la vista, como en Alias: vista de arriba = suelo XZ,
// de frente = XY, de lado = YZ (por el origen); en perspectiva las curvas se dibujan en el aire, en el plano de la pantalla
// que pasa por el pivote (o por el primer punto de la curva). También se puede fijar: suelo, frente o lado.
let drawPlaneKind = 'auto';
const PLANE_NAMES = { xz: 'el suelo (XZ)', xy: 'el plano frontal (XY)', yz: 'el plano lateral (YZ)', free: 'el aire (plano de la pantalla)' };
function axisView() {
  const d = viewDir(), a = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)], i = a.indexOf(Math.max(...a));
  return a[i] > 0.9995 ? i : null;
}
// solid = círculos y planos: en perspectiva van al suelo
function resolvePlaneKind(solid = false) {
  if (drawPlaneKind !== 'auto') return drawPlaneKind;
  const i = axisView();
  if (i != null && proj.ortho) return ['yz', 'xz', 'xy'][i];
  return solid ? 'xz' : 'free';
}
function planeFor(k) {
  if (k === 'xz') return new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.01);
  if (k === 'xy') return new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  if (k === 'yz') return new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  return new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir().negate(), draft?.pts[0] || pivot);
}
// punto de una superficie bajo el cursor (snap a superficie)
function surfacePointAt() {
  const hit = ray.intersectObjects(objects.filter((o) => o.visible && o.kind !== 'curve').map((o) => o.parts.mesh), false)[0];
  return hit ? hit.point.clone() : null;
}
function placePoint(e, solid = false) {
  const modes = snapModes(e);
  const s = findSnap(e.clientX, e.clientY, modes, {});
  if (s) { showSnap(s); return s.point; }
  setRay(e);
  // superficie: botón fijo o Shift mantenido al dibujar
  if (modes.surface || (e.shiftKey && !e.altKey)) {
    const q = surfacePointAt();
    if (q) { showSnap({ point: q, kind: 'superficie' }); return q; }
  }
  const k = resolvePlaneKind(solid), gk = modes.grid && k === 'free' ? 'xz' : k;   // en perspectiva la rejilla es la del suelo
  const p = ray.ray.intersectPlane(planeFor(gk), new THREE.Vector3());
  if (p && modes.grid) { snapGrid(p, gk); showSnap({ point: p, kind: 'rejilla' }); } else hideSnap();
  return p;
}
function setDrawPlane(k) {
  drawPlaneKind = k;
  document.querySelectorAll('[data-plane]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plane === k)));
  updateDrawGrids();
  if (draft) showDraft();
}
// rejilla del plano de construcción mientras se dibuja
const gridYZ = new THREE.GridHelper(30, 30, 0x4a3a22, 0x2a251d);
gridYZ.rotation.z = Math.PI / 2;
gridYZ.layers.set(DIAG);
gridYZ.visible = false;
scene.add(gridYZ);
function updateDrawGrids() {
  const drawing = tool === 'curve' || tool === 'plane' || tool === 'circle', k = drawing ? resolvePlaneKind(tool !== 'curve') : null;
  gridXY.visible = k === 'xy'; gridYZ.visible = k === 'yz';
}

const HINTS = {
  curve: 'Clic: añadir punto · Enter: terminar · Esc: cancelar · T: vista superior',
  plane: 'Clic en el plano de dibujo para colocar una superficie plana · Esc: cancelar',
  fillet: 'Redondear: clic en una arista (Ctrl/Shift: añadir) · arrastra el punto amarillo (dentro = redondeo, fuera = chaflán; Alt: de 5 en 5 mm) · V: radio variable · Enter o clic derecho: aceptar · Esc: cancelar',
  circle: 'Clic en el plano de dibujo para colocar un círculo (radio 1 dm; luego escálalo con R) · Esc: cancelar',
};
function updateHint() {
  if (tool === 'edge' && edgeOp) { $('hint').textContent = edgeOp.hint(); return; }
  if (HINTS[tool]) { $('hint').textContent = HINTS[tool]; return; }
  if (typeof pivotEdit !== 'undefined' && pivotEdit) { $('hint').textContent = 'Editar pivote: arrastra el gizmo · Ctrl: snap a punto · Ctrl+Alt: a curva · Alt: rejilla · D o Esc: terminar'; return; }
  if (mouseXform) {
    const verb = { translate: 'Mover', rotate: 'Rotar', scale: 'Escalar' }[xform];
    const axes = xform === 'scale' ? 'izq = uniforme · medio = Y · der = X y Z' : 'izq = X · medio = Y · der = Z';
    $('hint').textContent = `${verb}: arrastra en la vista con ${axes} · o usa el gizmo · clic sin arrastrar: elegir · Esc: salir`;
    return;
  }
  const nav = navStyle === 'alias' ? 'Shift+Alt: navegar' : 'Shift+arrastrar: recuadro';
  const what = pickMode === 'cv' ? 'CVs' : PICK_NAMES[pickFilter] || 'objetos';
  $('hint').textContent = `Clic: seleccionar ${what} · Arrastrar: recuadro · ${nav} (clic rápido: punto de interés) · W/E/R: mover/rotar/escalar · Alt/Ctrl/Ctrl+Alt: snap · Espacio: menú`;
}
function setTool(t) {
  if (tool === 'curve' && t !== 'curve') cancelDraft();
  if (tool === 'edge' && t !== 'edge') endEdgeOp();
  if (t !== 'select') mouseXform = false;
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

// Círculo NURBS exacto: grado 2, 9 CVs, pesos √2/2 en las esquinas
function circleData(c, R, plane = 'xz') {
  const cvs = [];
  for (let k = 0; k <= 8; k++) {
    const a = (k * Math.PI) / 4, f = k % 2 ? Math.SQRT2 : 1, x = Math.cos(a) * R * f, y = Math.sin(a) * R * f;
    const w = k % 2 ? Math.SQRT1_2 : 1;
    cvs.push(plane === 'xz' ? new THREE.Vector4(c.x + x, c.y, c.z - y, w) : plane === 'yz' ? new THREE.Vector4(c.x, c.y + y, c.z - x, w) : new THREE.Vector4(c.x + x, c.y + y, c.z, w));
  }
  return { deg: 2, knots: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1], cvs, plane };
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
  pts.forEach((p) => { const h = makeHandle(false, false); h.position.copy(p); draftHandles.add(h); });
  const n = draft.pts.length;
  $('draw-msg').textContent = n === 0 ? `Clic: primer punto en ${PLANE_NAMES[resolvePlaneKind()]}` : `${n} ${n === 1 ? 'punto' : 'puntos'} · sigue haciendo clic`;
  $('draw-done').disabled = n < 2;
}
function finishDraft() {
  if (!draft || draft.pts.length < 2) return;
  // el plano de la curva: el de construcción si todos los puntos están en él (un snap pudo sacarlos)
  let pk = resolvePlaneKind();
  const ax = { xz: 'y', xy: 'z', yz: 'x' }[pk];
  if (ax && draft.pts.some((q) => Math.abs(q[ax] - draft.pts[0][ax]) > 1e-6)) pk = 'free';
  const obj = addCurve(N.curveData(draft.pts, 3, pk));
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
  loft: () => loftSelection(),
  extrude: () => extrudeSelection(),
  revolve: () => revolveSelection(),
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
// Botones de selección (hoja de atajos de Alias): alternativa sugerida = izq elige, medio añade, der quita;
// por defecto de Alias = izq alterna. Shift alterna y Ctrl quita con cualquier botón.
function howFor(e) {
  if (e.shiftKey) return 'toggle';
  if (e.ctrlKey || e.metaKey) return 'remove';
  if (navStyle !== 'alias') return 'replace';
  if (e.button === 1) return 'add';
  if (e.button === 2) return 'remove';
  return $('sel-buttons').value === 'default' ? 'toggle' : 'replace';
}
renderer.domElement.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); }); // sin autodesplazamiento
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragPane = paneAt(e.clientX);
  if (carousel || extrudeDrag || (layout === 'forge' && forge?.picking())) { down = null; return; }   // en Forge, elegir caras / pincel es de Forge
  if (navHeld || (e.button !== 0 && !(navStyle === 'alias' && tool === 'select'))) { down = null; return; }
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
  if (tool === 'curve' && draft && !e.buttons) { draft.hover = placePoint(e); showDraft(); }
});
renderer.domElement.addEventListener('pointerleave', () => { if (draft) { draft.hover = null; showDraft(); } });
addEventListener('pointerup', (e) => {
  const d = down;
  down = null;
  requestAnimationFrame(() => { dragPane = null; });
  if (navMovedLast) { navMovedLast = false; return; }
  if (!d || e.target !== renderer.domElement && !d.boxing) return;
  const how = howFor(e);
  if (d.boxing) { marquee.hidden = true; boxSelect(d, e, how); return; }
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || gizmo.dragging) return;
  if (tool === 'curve') {
    if (e.button !== 0) return;
    const p = placePoint(e);
    if (p) { draft.pts.push(p); draft.hover = null; showDraft(); }
    return;
  }
  if (tool === 'edge') { edgeClick(e); return; }
  if (tool === 'circle') {
    if (e.button !== 0) return;
    const p = placePoint(e, true);
    if (!p) return;
    const o = addCurve(circleData(p, toolDef.circleR ?? 1, resolvePlaneKind(true)), 'Círculo');
    setTool('select');
    finishCreate([o], `${o.name} creado (NURBS exacto, grado 2)`);
    return;
  }
  if (tool === 'plane') {
    const p = placePoint(e, true);
    if (!p) return;
    const o = addSurface(N.planeData(p, resolvePlaneKind(true)), 'Plano');
    setTool('select');
    finishCreate([o], `${o.name} creado`);
    return;
  }
  if (gizmo.axis && e.button === 0) return; // el gizmo solo usa el botón izquierdo
  const hit = pickAt(e);
  if (hit?.cvTarget) { setCvTarget(hit.cvTarget, how); return; }
  if (hit) {
    applySelection([hit.cv || hit.obj], how);
    if ($('click-pivot').checked) setPivot(hit.point || (() => { const c = cvRef(hit.cv); return new THREE.Vector3(c.x, c.y, c.z); })());
  } else if (how === 'replace' && e.button === 0) clearSelection();
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
    items = live.filter((o) => cvTargets.has(o.id)).flatMap(allCVRefs).filter((ref) => { const q = cvRef(ref); return inside(q.x, q.y, q.z); });
  } else {
    items = live.filter(pickable).filter((o) => {
      const a = pickTarget(o).geometry.attributes.position;
      const step = o.kind === 'curve' ? 3 : 5;
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
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(live.map((o) => pickTarget(o)), false)[0];
  const pt = hit ? hit.point : ray.ray.intersectPlane(planeFor('xz'), new THREE.Vector3());
  if (pt) setPivot(pt);
});

// ---------- Encuadre ----------
function boundsOf(list) {
  const box = new THREE.Box3();
  list.forEach((o) => {
    const g = pickTarget(o).geometry;
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
  const dist = rad / Math.sin(Math.min(vf, hf)) * 1.12; // margen: los menús grabados quedan encima de la vista
  pivot.copy(c);
  camera.position.copy(c).addScaledVector(viewDir(), -dist);
}
const frameSelection = () => frameObjects(pickMode === 'cv' ? affectedObjects() : selObjs);
function pivotToSelection() {
  const refs = selectedCVRefs();
  setPivot(refs.length ? centroid(refs) : boundsOf(objects).getCenter(new THREE.Vector3()));
}
function topView() {
  pivot.copy(boundsOf(objects).getCenter(new THREE.Vector3()));
  goToView(new THREE.Vector3(0, 1, 0), true);
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
$('open-panel').addEventListener('click', () => { if (!pinned) $('panel').classList.toggle('show'); });
document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => {
  $('panel').classList.add('show');
  $(b.dataset.goto).scrollIntoView({ block: 'start', behavior: 'smooth' });
}));
// Bordes que muestran los menús ocultos (la losa de propiedades sigue su propia regla, abajo)
const NEAR = 90;
function revealEdges(x, y) {
  app.classList.toggle('near-top', y < NEAR);
  app.classList.toggle('near-left', x < NEAR);
  app.classList.toggle('near-right', x > innerWidth - NEAR || $('panel').classList.contains('show') || pinned);
  app.classList.toggle('near-bottom', y > innerHeight - NEAR * 0.7);
}
addEventListener('pointermove', (e) => { if (!e.buttons) revealEdges(e.clientX, e.clientY); });
document.addEventListener('pointerleave', () => revealEdges(innerWidth / 2, innerHeight / 2));
addEventListener('pointermove', (e) => {
  if (pinned) return;
  const r = view.getBoundingClientRect(), panel = $('panel'), tools = $('tools');
  const busy = e.buttons !== 0;
  // El muro derecho (últimos 56 px) abre la losa; se cierra al alejarse de ella
  const edge = innerWidth - 56;
  if (e.clientX > edge && e.clientY > 58 && e.clientY < innerHeight - 34) panel.classList.add('show');
  else if (!busy && panel.classList.contains('show') && e.clientX < edge - panel.offsetWidth - 40) panel.classList.remove('show');
  if (e.clientX < r.left + 64 && e.clientY > r.top && e.clientY < r.bottom) tools.classList.add('show');
  else if (!busy && e.clientX > r.left + 140) tools.classList.remove('show');
});

// ---------- Panel: escena (lista de objetos) ----------
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
// Panel de capas: cada capa es una carpeta con sus grupos y objetos dentro. Los objetos se arrastran de una capa a otra.
function refreshOutliner() {
  const ul = $('outliner');
  if (!ul) return;
  ul.innerHTML = '';
  const dragIds = (objs) => (e) => {
    const ids = objs.some((o) => selObjs.includes(o)) ? [...new Set([...selObjs, ...objs])].map((o) => o.id) : objs.map((o) => o.id);
    e.dataTransfer.setData('text/forja-ids', JSON.stringify(ids)); e.dataTransfer.effectAllowed = 'move';
  };
  const row = (o) => {
    const li = document.createElement('li');
    li.className = 'ol-item' + (selObjs.includes(o) ? ' sel' : '') + (o.visible ? '' : ' off');
    li.draggable = true;
    li.innerHTML = `<button class="ol-name" title="Seleccionar (Shift: añadir) · arrastrar a otra capa"><span class="ol-ico">${{ surface: '◩', curve: '∿', mesh: '△' }[o.kind]}</span>${esc(o.name)}</button><button class="ol-eye" aria-pressed="${o.ownVisible}" title="${o.ownVisible ? 'Ocultar' : 'Mostrar'}">${EYE}</button>`;
    li.addEventListener('dragstart', dragIds([o]));
    li.querySelector('.ol-name').addEventListener('click', (e) => { setPickMode('object'); applySelection([o], e.shiftKey ? 'toggle' : 'replace'); });
    li.querySelector('.ol-eye').addEventListener('click', () => {
      checkpoint();
      o.visible = !o.ownVisible;
      if (!o.visible) { const i = selObjs.indexOf(o); if (i >= 0) selObjs.splice(i, 1); }
      selectionChanged();
    });
    return li;
  };
  const folder = (g, kids) => {
    const li = document.createElement('li');
    li.className = 'ol-group' + (g.open ? ' open' : '') + (kids.every((k) => selObjs.includes(k)) ? ' sel' : '');
    li.draggable = true;
    li.innerHTML = `<div class="ol-gh"><button class="ol-fold" aria-expanded="${g.open}" title="Abrir / cerrar">▸</button>
      <button class="ol-name" title="Elegir el grupo · doble clic: renombrar"><span class="ol-ico">▤</span>${esc(g.name)} <small>${kids.length}</small></button>
      <button class="ol-eye" aria-pressed="${kids.some((k) => k.ownVisible)}" title="Ocultar / mostrar el grupo">${EYE}</button></div><ul></ul>`;
    li.addEventListener('dragstart', dragIds(kids));
    li.querySelector('.ol-fold').addEventListener('click', () => { g.open = !g.open; refreshOutliner(); });
    li.querySelector('.ol-name').addEventListener('click', (e) => { setPickMode('object'); applySelection(kids, e.shiftKey ? 'toggle' : 'replace'); });
    li.querySelector('.ol-name').addEventListener('dblclick', () => { const v = prompt('Nombre del grupo', g.name); if (v) { checkpoint(); g.name = v.trim() || g.name; refreshOutliner(); } });
    li.querySelector('.ol-eye').addEventListener('click', () => {
      checkpoint();
      const show = !kids.some((k) => k.ownVisible);
      kids.forEach((k) => (k.visible = show));
      if (!show) kids.forEach((k) => { const i = selObjs.indexOf(k); if (i >= 0) selObjs.splice(i, 1); });
      selectionChanged();
    });
    if (g.open) kids.forEach((k) => li.querySelector('ul').append(row(k)));
    return li;
  };
  for (const l of layers) {
    l.open ??= true;
    const mine = objects.filter((o) => o.layer === l.id);
    const li = document.createElement('li');
    li.className = 'ly' + (l.open ? ' open' : '') + (l.visible ? '' : ' off') + (l.id === activeLayer ? ' active' : '');
    li.innerHTML = `<div class="ly-head"><button class="ol-fold" title="Abrir / cerrar">▸</button>
      <button class="ly-eye" aria-pressed="${l.visible}" title="${l.visible ? 'Ocultar capa' : 'Mostrar capa'}">${EYE}</button>
      <button class="ly-name" title="Clic: capa activa (lo nuevo va aquí) · doble clic: renombrar · suelta aquí objetos para pasarlos">${esc(l.name)}</button>
      <span class="ly-n">${mine.length}</span></div><ul></ul>`;
    const head = li.querySelector('.ly-head'), inner = li.querySelector('ul');
    li.querySelector('.ol-fold').addEventListener('click', () => { l.open = !l.open; refreshOutliner(); });
    li.querySelector('.ly-eye').addEventListener('click', () => setLayerVisible(l, !l.visible));
    li.querySelector('.ly-name').addEventListener('click', () => { activeLayer = l.id; refreshOutliner(); });
    li.querySelector('.ly-name').addEventListener('dblclick', () => { const v = prompt('Nombre de la capa', l.name); if (v) { checkpoint(); l.name = v.trim() || l.name; refreshOutliner(); } });
    // soltar objetos sobre la capa (cabecera o su lista) los pasa a esa capa
    li.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/forja-ids')) { e.preventDefault(); li.classList.add('drop'); } });
    li.addEventListener('dragleave', (e) => { if (!li.contains(e.relatedTarget)) li.classList.remove('drop'); });
    li.addEventListener('drop', (e) => {
      e.preventDefault(); e.stopPropagation(); li.classList.remove('drop');
      const ids = JSON.parse(e.dataTransfer.getData('text/forja-ids') || '[]');
      moveToLayer(objects.filter((o) => ids.includes(o.id)), l.id);
    });
    const done = new Set();
    for (const o of mine) {
      if (done.has(o)) continue;
      const g = o.group && groups.find((x) => x.id === o.group);
      if (!g) { inner.append(row(o)); continue; }
      const kids = mine.filter((x) => x.group === o.group);
      kids.forEach((k) => done.add(k));
      inner.append(folder(g, kids));
    }
    ul.append(li);
  }
  $('scene-count').textContent = `${objects.length} ${objects.length === 1 ? 'objeto' : 'objetos'}`;
}
function moveToLayer(objs, id) {
  if (!objs.length) return;
  checkpoint();
  objs.forEach((o) => (o.layer = id));
  for (let i = selObjs.length - 1; i >= 0; i--) if (!selObjs[i].visible) selObjs.splice(i, 1);
  objects.forEach(applyVisibility);
  selectionChanged();
  toast(`${objs.length} ${objs.length === 1 ? 'objeto pasado' : 'objetos pasados'} a ${layers.find((l) => l.id === id)?.name}`);
}

// ---------- Panel: selección ----------
const fmt = (v) => v.toFixed(2);
function degreeOptions(sel) {
  let h = '';
  for (let d = 1; d <= N.MAX_DEGREE; d++) h += `<option value="${d}" ${d === sel ? 'selected' : ''}>${d}</option>`;
  return h;
}
function renderSelectionPanel() { renderSelectionBody(); pivotBlock(); }
function renderSelectionBody() {
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
      checkpoint();
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
    if (o.kind === 'mesh') {
      const g = d.geometry, tris = (g.index ? g.index.count : g.attributes.position.count) / 3;
      box.innerHTML = `<p class="muted"><b>${o.name}</b> · malla importada · ${Math.round(tris).toLocaleString('es')} triángulos</p>
        <p class="muted">Las mallas se ven, se evalúan con los shaders y se exportan. Para editarlas como NURBS habrá que reconstruirlas (próximamente).</p>`;
      return;
    }
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
        checkpoint();
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
        checkpoint();
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
function pivotBlock() {
  if (pickMode !== 'object' || !selObjs.length) return;
  const o = selObjs[selObjs.length - 1], p = o.pivot;
  $('sel-body').insertAdjacentHTML('beforeend', `
    <p class="muted">Pivote de <b>${o.name}</b></p>
    <div class="coords">
      <div class="coord"><b class="x">X</b><span id="px">${fmt(p.x)}</span></div>
      <div class="coord"><b class="y">Y</b><span id="py">${fmt(p.y)}</span></div>
      <div class="coord"><b class="z">Z</b><span id="pz">${fmt(p.z)}</span></div>
    </div>
    <div class="ops2">
      <button class="btn" id="b-pivot-edit" aria-pressed="${pivotEdit}">${pivotEdit ? 'Terminar pivote' : 'Editar pivote (D)'}</button>
      <button class="btn" id="b-pivot-center">Centrar pivote</button>
    </div>`);
  $('b-pivot-edit').addEventListener('click', togglePivotEdit);
  $('b-pivot-center').addEventListener('click', centerPivots);
}
function updatePivotReadout() {
  if (!$('px') || !selObjs.length) return;
  const p = selObjs[selObjs.length - 1].pivot;
  $('px').textContent = fmt(p.x); $('py').textContent = fmt(p.y); $('pz').textContent = fmt(p.z);
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
  const nc = objects.filter((o) => o.kind === 'curve').length, nm = objects.filter((o) => o.kind === 'mesh').length;
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  $('st-scene').textContent = `DM · ${plural(nc, 'CURVA', 'CURVAS')}`;
  // Información de la vista (arriba a la derecha)
  const cvs = objects.reduce((s, o) => s + (o.data.cvs ? o.data.cvs.flat().length : 0), 0);
  const patches = objects.filter((o) => o.kind === 'surface')
    .reduce((s, o) => s + (N.uniqueKnots(o.data.knotsU).length - 1) * (N.uniqueKnots(o.data.knotsV).length - 1), 0);
  $('vi-objs').textContent = `${ns} SUPERFICIES · ${patches} PARCHES` + (nm ? ` · ${nm} MALLAS` : '');
  $('vi-cvs').textContent = `${cvs} CVS`;
  const last = selObjs[selObjs.length - 1];
  $('vi-sel').textContent = pickMode === 'cv' && selCVs.size ? `${selCVs.size} CVS SELECCIONADOS`
    : last ? (last.kind === 'surface' ? `${last.name.toUpperCase()} · GRADO ${last.data.degU}×${last.data.degV} · SPANS ${N.spansOf(last.data.cvs.length, last.data.degU)}×${N.spansOf(last.data.cvs[0].length, last.data.degV)}` : last.name.toUpperCase())
    : 'SIN SELECCIÓN';
}

// ---------- Panel: modos, materiales, análisis ----------
function setDiag(m) {
  diagMode = m;
  // en Arcilla las líneas de parche son sutiles (finas y apagadas) para no ensuciar la superficie
  const clay = m === 'clay';
  isoMat.color.setHex(clay ? 0x9aa3b3 : 0x4a8fe0); isoMat.linewidth = clay ? 0.9 : 1.6; isoMat.transparent = clay; isoMat.opacity = clay ? 0.5 : 1; isoMat.needsUpdate = true;
  $('vi-shader').textContent = DIAG_NAMES[m];
  document.querySelectorAll('[data-diag]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diag === m)));
  if (layout === 'render') switchLayout('diag');
  $('legend').hidden = m !== 'curv';
  objects.forEach(updateObject);
  updateEvalUI();
}
document.querySelectorAll('[data-diag]').forEach((b) => b.addEventListener('click', () => setDiag(b.dataset.diag)));
const LAYOUTS = ['split', 'diag', 'render'];
// Carrusel 3D: cada módulo es el propio modelo 3D (con su sombreado: evaluación, PBR o IA) puesto en un
// anillo; el eje de giro es vertical y está a la altura del horizonte. Al cambiar, la cámara sube a una
// vista un poco elevada (se ven todos los módulos), el anillo gira hasta dejar delante el módulo nuevo y la cámara vuelve a bajar a la vista de trabajo.
let carousel = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const RING = ['diag', 'render', 'ai', 'forge'];
const RING_NAMES = { diag: 'MODELADO', render: 'VISU', ai: 'IA', forge: 'FORGE' };
// Etiquetas de cada módulo, flotando sobre su modelo durante el giro (la del módulo activo, más grande y en azul)
const ringLabels = document.createElement('div');
ringLabels.className = 'ring-labels';
ringLabels.innerHTML = RING.map((k) => `<span data-k="${k}">${RING_NAMES[k]}</span>`).join('');
view.appendChild(ringLabels);
const ease = (k) => (k <= 0 ? 0 : k >= 1 ? 1 : k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const UP = new THREE.Vector3(0, 1, 0);
// Geometría del anillo para la escena actual
function ringSetup() {
  const box = boundsOf(objects.filter((o) => o.visible));
  const bc = box.isEmpty() ? pivot.clone() : box.getCenter(new THREE.Vector3());
  const size = box.isEmpty() ? new THREE.Vector3(4, 2, 4) : box.getSize(new THREE.Vector3());
  const r = Math.max(Math.hypot(size.x, size.z) / 2, size.y / 2, 0.5);
  const floorY = box.isEmpty() ? 0 : box.min.y, topY = box.isEmpty() ? 2 : box.max.y;
  const f = pivot.clone().sub(camera.position).setY(0);
  if (f.lengthSq() < 1e-8) f.set(0, 0, -1).applyQuaternion(camera.quaternion).setY(0);
  if (f.lengthSq() < 1e-8) f.set(0, 0, -1);
  f.normalize();
  // Anillo completo: los módulos se reparten a la misma distancia (360° / número de módulos) y el anillo
  // crece con el número de módulos; la vista elevada se aleja lo necesario para verlo entero.
  const n = RING.length, slotW = 2.1 * r, slotH = Math.max(size.y + 0.6 * r, 1.6 * r);
  const R = Math.max(slotW * 1.7 / (2 * Math.sin(Math.PI / n)), 1.2 * r), step = (2 * Math.PI) / n;
  const center = bc.clone().addScaledVector(f, R); center.y = floorY;
  const p = panes()[0], vf = THREE.MathUtils.degToRad(camera.fov) / 2, hf = Math.atan(Math.tan(vf) * (p.w / p.h));
  const el = THREE.MathUtils.degToRad(24);
  const D = Math.max((R + r) / Math.tan(hf), ((R + r) * Math.sin(el) + slotH * Math.cos(el)) / Math.tan(vf)) * 1.2;
  const look = center.clone(); look.y = floorY + slotH * 0.3;
  const overPos = look.clone().addScaledVector(f, -D * Math.cos(el)).addScaledVector(UP, D * Math.sin(el));
  const overQuat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(overPos, look, UP));
  return { from: layout, to: null, swapped: false, center, R, step, r, bc, f, floorY, topY, slotW, slotH, size,
    overPos, overQuat, pos: camera.position.clone(), quat: camera.quaternion.clone(), hover: null, lift: RING.map(() => 0), screen: [] };
}
// Cambio directo (botones de la cabecera, menús): sube, gira y baja de una vez
function switchLayout(l) {
  if (l === layout || carousel) return;
  if (l === 'split' || layout === 'split' || reduceMotion.matches) { setLayout(l); return; }
  carousel = Object.assign(ringSetup(), { auto: true, to: l, t0: performance.now(), dur: 2100 });
  flipPanel(l);
}
// Mantener V: la cámara sube y se queda arriba; con el ratón se elige un módulo (clic) y el anillo lo gira
// hacia delante. Soltar V sin elegir nada cancela y la cámara vuelve a bajar al módulo de antes.
const W_DUR = 520, SPIN_DUR = 800;
function holdCarousel() {
  if (carousel || layout === 'split' || reduceMotion.matches) return;
  carousel = Object.assign(ringSetup(), { hold: true, held: true, anim: { a: 0, b: 1, t0: performance.now() } });
  view.classList.add('ring-picking');
}
const animW = (c, now) => c.anim.a + (c.anim.b - c.anim.a) * ease((now - c.anim.t0) / W_DUR);
function descend(c, now) { if (c.anim.b !== 0) c.anim = { a: animW(c, now), b: 0, t0: now }; view.classList.remove('ring-picking'); }
function releaseCarousel() {
  const c = carousel;
  if (!c?.hold) return;
  c.held = false;
  if (!c.to) descend(c, performance.now());
}
function pickModule(kind) {
  const c = carousel, now = performance.now();
  if (!c?.hold || c.to) return;
  if (kind === c.from) { descend(c, now); return; }
  c.to = kind; c.spinT0 = now;
  view.classList.remove('ring-picking');
  flipPanel(kind);
}
// módulo bajo el cursor (el más cercano en pantalla a su modelo)
function moduleAt(x, y) {
  const c = carousel;
  if (!c?.screen.length) return null;
  let best = null, bd = Infinity;
  c.screen.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < p.rad && d < bd) { bd = d; best = RING[i]; } });
  return best;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!carousel) return;
  e.stopImmediatePropagation(); e.preventDefault();          // durante el carrusel el ratón solo elige módulo
  if (carousel.hold && !carousel.to && e.button === 0) { const r = renderer.domElement.getBoundingClientRect(); const k = moduleAt(e.clientX - r.left, e.clientY - r.top); if (k) pickModule(k); }
}, true);
addEventListener('pointermove', (e) => {
  if (!carousel?.hold) return;
  const r = renderer.domElement.getBoundingClientRect();
  carousel.hover = carousel.to ? null : moduleAt(e.clientX - r.left, e.clientY - r.top);
});
addEventListener('blur', () => releaseCarousel());
// Cámara del espectador: sube (w: 0 -> 1), gira el anillo (spin: 0 -> 1) y vuelve a bajar
function carouselState(c, now) {
  let w, spin;
  if (c.auto) {
    const k = Math.min(1, (now - c.t0) / c.dur);
    w = ease(k / 0.3) * (1 - ease((k - 0.7) / 0.3));
    spin = ease((k - 0.24) / 0.52);
    c.done = k === 1;
  } else {
    spin = c.to ? ease((now - c.spinT0) / SPIN_DUR) : 0;
    if (c.to && spin >= 1) descend(c, now);
    w = animW(c, now);
    c.done = c.anim.b === 0 && now - c.anim.t0 >= W_DUR;
  }
  return { pos: c.pos.clone().lerp(c.overPos, w), quat: c.quat.clone().slerp(c.overQuat, w), w, spin };
}
// Ángulo de cada módulo en el anillo (0 = delante; el siguiente queda a la derecha)
function ringAngle(c, kind, spin) {
  if (!c.to) return (RING.indexOf(kind) - RING.indexOf(c.from)) * c.step;
  const n = RING.length, from = RING.indexOf(c.from);
  let d = (RING.indexOf(c.to) - from + n) % n; if (d > n / 2) d -= n;      // el camino más corto
  return (RING.indexOf(kind) - from - spin * d) * c.step;
}
// Un módulo colocado en el anillo se dibuja con la cámara del espectador "desgirada" alrededor del eje
// (y bajada un poco si el módulo está levantado porque el ratón está encima)
function moduleCamera(c, V, a, lift = 0) {
  const q = new THREE.Quaternion().setFromAxisAngle(UP, -a);
  return { pos: V.pos.clone().sub(c.center).applyQuaternion(q).add(c.center).addScaledVector(UP, -lift), quat: q.multiply(V.quat) };
}
function renderCarousel(now) {
  const c = carousel;
  const V = carouselState(c, now);
  if (c.to && !c.swapped && V.spin >= 0.5) { c.swapped = true; setLayout(c.to); }
  const full = { x: 0, w: view.clientWidth, h: Math.max(view.clientHeight, 1) };
  const showG = ground.visible, showGz = gizmo.visible;
  ground.visible = false; gizmo.visible = false;
  const bg = envBg; envBg = false;
  renderer.setViewport(0, 0, full.w, full.h); renderer.setScissor(0, 0, full.w, full.h);
  renderer.clear();
  renderer.autoClear = false;
  // los módulos comparten el mismo espacio de profundidad, así que se tapan entre sí bien
  const angles = RING.map((kind) => ringAngle(c, kind, V.spin));
  RING.forEach((kind, i) => {
    c.lift[i] += ((kind === c.hover ? c.slotH * 0.12 : 0) - c.lift[i]) * 0.2;          // el módulo bajo el ratón se levanta
    if (kind !== c.from && kind !== c.to && V.w < 0.02) return;      // abajo solo se ven los que cambian
    const p = moduleCamera(c, V, angles[i], c.lift[i]);
    camera.position.copy(p.pos); camera.quaternion.copy(p.quat);
    renderPane({ ...full, kind });
  });
  // etiquetas sobre cada modelo y zona de cada módulo en pantalla (para elegirlo con el ratón)
  camera.position.copy(V.pos); camera.quaternion.copy(V.quat);
  camera.updateMatrixWorld(); useAspect(full);
  const active = c.to && V.spin >= 0.5 ? c.to : c.from, v = new THREE.Vector3(), m = new THREE.Vector3();
  RING.forEach((kind, i) => {
    const lab = ringLabels.children[i];
    v.copy(c.bc).sub(c.center).setY(0).applyAxisAngle(UP, angles[i]).add(c.center);
    m.copy(v); m.y = c.floorY + c.size.y / 2 + c.lift[i]; m.project(camera);
    const edge = v.clone(); edge.y = m.y; edge.addScaledVector(new THREE.Vector3().crossVectors(UP, c.f), c.r).project(camera);
    c.screen[i] = { x: ((m.x + 1) / 2) * full.w, y: ((1 - m.y) / 2) * full.h, rad: Math.max(40, Math.abs(edge.x - m.x) * full.w * 0.75) };
    v.y = c.topY + c.r * 0.25 + c.lift[i];
    v.project(camera);
    lab.style.transform = `translate(${((v.x + 1) / 2) * full.w}px, ${((1 - v.y) / 2) * full.h}px) translate(-50%, -100%)`;
    lab.style.opacity = String(V.w * (kind === active || kind === c.hover ? 1 : 0.6));
    lab.classList.toggle('on', kind === active);
    lab.classList.toggle('hover', kind === c.hover && kind !== active);
  });
  ringLabels.style.visibility = V.w > 0.01 ? 'visible' : 'hidden';
  renderer.autoClear = true;
  envBg = bg; ground.visible = showG; gizmo.visible = showGz;
  camera.position.copy(c.pos); camera.quaternion.copy(c.quat);
  if (c.done) { carousel = null; bgFadeT0 = now; ringLabels.style.visibility = 'hidden'; view.classList.remove('ring-picking'); }
}
let bgFadeT0 = -1e9;
// El panel derecho cambia de módulo girando como una placa
const MODULE_TITLES = { diag: 'Modelado', render: 'Visu', ai: 'IA', forge: 'Forge', split: 'Modelado + Visu' };
function showModule(l) {
  document.querySelectorAll('#panel-body [data-module]').forEach((sec) => {
    const m = sec.dataset.module;
    sec.hidden = !(m === 'all' || m === l || l === 'split');
  });
  $('panel-title').textContent = MODULE_TITLES[l];
}
async function flipPanel(l) {
  const body = $('panel-body');
  if (reduceMotion.matches || !body.animate) { showModule(l); return; }
  const ORDER = ['diag', 'render', 'ai', 'forge'], dir = ORDER.indexOf(l) > ORDER.indexOf(layout) ? 1 : -1;
  await body.animate([{ transform: 'perspective(900px) rotateY(0deg)', opacity: 1 }, { transform: `perspective(900px) rotateY(${-90 * dir}deg)`, opacity: 0 }],
    { duration: 380, easing: 'cubic-bezier(.55,0,.8,.4)' }).finished;
  showModule(l);
  body.animate([{ transform: `perspective(900px) rotateY(${90 * dir}deg)`, opacity: 0 }, { transform: 'perspective(900px) rotateY(0deg)', opacity: 1 }],
    { duration: 480, easing: 'cubic-bezier(.2,.6,.3,1)' });
}
function setLayout(l) {
  if (layout === 'forge' && l !== 'forge') forgeApply(true);   // lo hecho en Forge pasa a los demás módulos
  layout = l;
  if (l === 'forge') ensureForge();
  gizmo.enabled = l !== 'forge';
  $('app').dataset.layoutNow = l;
  document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === l)));
  $('pane-diag').hidden = l === 'render';
  $('pane-render').hidden = l !== 'render' && l !== 'split';
  $('pane-diag').className = 'pane left' + (l !== 'split' ? ' full' : '');
  $('pane-diag').querySelector('.pane-title b').textContent = l === 'ai' ? 'IA' : l === 'forge' ? 'FORGE' : 'MODELADO';
  $('pane-render').className = 'pane right' + (l === 'render' ? ' full' : '');
  if (!carousel) showModule(l);
  resize();
}
const cycleLayout = () => switchLayout({ diag: 'render', render: 'ai', ai: 'forge', forge: 'diag', split: 'diag' }[layout]);
// V: mantener para ver todos los módulos y elegir uno con el ratón; soltar sin elegir = cancelar
addEventListener('keydown', (e) => {
  if (e.code !== 'KeyV' || e.repeat || e.altKey || e.ctrlKey || e.metaKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  holdCarousel();
});
addEventListener('keyup', (e) => { if (e.code === 'KeyV') releaseCarousel(); });
document.querySelectorAll('[data-layout]').forEach((b) => b.addEventListener('click', () => switchLayout(b.dataset.layout)));
document.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => setPickMode(b.dataset.pick)));
document.querySelectorAll('[data-plane]').forEach((b) => b.addEventListener('click', () => setDrawPlane(b.dataset.plane)));

// ---------- VISU: editor de material, entorno y color ----------
const TONES = { agx: THREE.AgXToneMapping, aces: THREE.ACESFilmicToneMapping, none: THREE.NoToneMapping };
let toneKey = 'agx';
const fmt2 = (v) => (+v).toFixed(2);
function syncMaterialEditor() {
  const m = materials[matKey];
  $('me-name').textContent = MAT_NAMES[matKey];
  $('me-color').value = '#' + m.color.getHexString(); $('me-color-o').textContent = $('me-color').value;
  for (const [id, prop] of [['me-metal', 'metalness'], ['rough', 'roughness'], ['me-coat', 'clearcoat'], ['me-coatr', 'clearcoatRoughness'], ['me-trans', 'transmission']]) {
    $(id).value = m[prop]; $(id + '-o').textContent = fmt2(m[prop]);
  }
}
$('me-color').addEventListener('input', (e) => { materials[matKey].color.set(e.target.value); $('me-color-o').textContent = e.target.value; });
for (const [id, prop] of [['me-metal', 'metalness'], ['me-coat', 'clearcoat'], ['me-coatr', 'clearcoatRoughness'], ['me-trans', 'transmission']]) {
  $(id).addEventListener('input', (e) => { materials[matKey][prop] = +e.target.value; $(id + '-o').textContent = fmt2(e.target.value); });
}
document.querySelectorAll('[data-env]').forEach((b) => b.addEventListener('click', () => {
  envKey = b.dataset.env;
  document.querySelectorAll('[data-env]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  $('expo').value = envKey === 'sun' || envKey === 'sunset' ? -1.4 : 0; $('expo').dispatchEvent(new Event('input'));
}));
$('env-int').addEventListener('input', (e) => { Object.values(materials).forEach((m) => (m.envMapIntensity = +e.target.value)); $('env-int-o').textContent = fmt2(e.target.value); });
$('env-bg').addEventListener('change', (e) => { envBg = e.target.checked; });
$('env-blur').addEventListener('input', (e) => { scene.backgroundBlurriness = +e.target.value; $('env-blur-o').textContent = fmt2(e.target.value); });
$('tone').addEventListener('change', (e) => { toneKey = e.target.value; });
$('expo').addEventListener('input', (e) => { renderer.toneMappingExposure = Math.pow(2, +e.target.value); $('expo-o').textContent = (+e.target.value).toFixed(1); });
$('shadow-int').addEventListener('input', (e) => { ground.material.opacity = +e.target.value; $('shadow-int-o').textContent = fmt2(e.target.value); });

// El material se aplica a las superficies seleccionadas; si no hay ninguna, a todas.
function setMaterial(k) {
  checkpoint();
  matKey = k;
  const sel = selObjs.filter((o) => o.kind !== 'curve');
  (sel.length ? sel : objects.filter((o) => o.kind !== 'curve')).forEach((o) => (o.mat = k));
  document.querySelectorAll('.mat').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.mat === k)));
  $('rough').value = materials[k].roughness;
  $('rough-o').textContent = (+materials[k].roughness).toFixed(2);
  $('mat-name').textContent = MAT_NAMES[k];
  syncMaterialEditor();
  if (layout === 'diag') switchLayout('render');
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
    const tr = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    tr.setClearColor(0x000000, 0);
    tr.setSize(128, 128); tr.toneMapping = THREE.ACESFilmicToneMapping;
    const ts = new THREE.Scene(); // sin fondo: las esferas flotan sobre la superficie de la app
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
$('link-light').addEventListener('change', (e) => { envDiagMat.uniforms.uLink.value = e.target.checked ? 1 : 0; });
$('show-iso').addEventListener('change', () => objects.forEach(applyVisibility));
$('show-comb').addEventListener('change', () => objects.forEach(applyVisibility));
$('comb').addEventListener('input', (e) => {
  combScale = +e.target.value; $('comb-o').textContent = combScale.toFixed(1);
  objects.filter((o) => o.kind === 'curve').forEach(updateObject);
});
$('op-dist').addEventListener('input', (e) => { $('op-dist-o').textContent = (+e.target.value).toFixed(1); });

$('t-select').addEventListener('click', () => setTool('select'));
$('t-move').addEventListener('click', () => { setTool('select'); setXform('translate'); });
$('t-rotate').addEventListener('click', () => { setTool('select'); setXform('rotate'); });
$('t-scale').addEventListener('click', () => { setTool('select'); setXform('scale'); });
$('t-pivot').addEventListener('click', togglePivotEdit);
document.querySelectorAll('[data-snap]').forEach((b) => b.addEventListener('click', () => { snapToggles[b.dataset.snap] = !snapToggles[b.dataset.snap]; updateSnapButtons(); }));
document.querySelectorAll('[data-snapbtn]').forEach((b) => b.addEventListener('click', () => { snapToggles[b.dataset.snapbtn] = !snapToggles[b.dataset.snapbtn]; updateSnapButtons(); }));
$('grid-step').addEventListener('change', (e) => { gridStep = +e.target.value; });
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

// ---------- Archivo: exportar e importar ----------
// NURBS exactas: IGES y STEP. Malla: OBJ, STL, GLB (para Blender, con materiales), PLY.
// SubD: malla de cuadriláteros OBJ. 2D: SVG y DXF. Proyecto: .forja (JSON).
const FORMATS = {
  igs: { label: 'IGES', ext: 'igs', group: 'nurbs', axis: 'z', unit: 'mm' },
  step: { label: 'STEP', ext: 'step', group: 'nurbs', axis: 'z', unit: 'mm' },
  obj: { label: 'OBJ', ext: 'obj', group: 'mesh', axis: 'y', unit: 'm' },
  stl: { label: 'STL', ext: 'stl', group: 'mesh', axis: 'z', unit: 'mm' },
  glb: { label: 'GLB · Blender', ext: 'glb', group: 'mesh', axis: 'y', unit: 'm' },
  ply: { label: 'PLY', ext: 'ply', group: 'mesh', axis: 'z', unit: 'mm' },
  subd: { label: 'OBJ cuadriláteros', ext: 'obj', group: 'subd', axis: 'y', unit: 'm', suffix: '-subd' },
  svg: { label: 'SVG', ext: 'svg', group: '2d', unit: 'mm' },
  dxf: { label: 'DXF', ext: 'dxf', group: '2d', unit: 'mm' },
  forja: { label: 'Proyecto .forja', ext: 'forja', group: 'project' },
};
// Lo que la página de Claude deja descargar tal cual; el resto se entrega dentro de un .zip
const ARTIFACT_EXTS = new Set(['json', 'svg', 'zip', 'txt', 'md', 'csv', 'html', 'pdf', 'png']);

function exportOptions(fmt) {
  const F = FORMATS[fmt], unitSel = $('io-unit').value, axisSel = $('io-axis').value;
  const unit = unitSel === 'auto' ? F.unit || 'mm' : unitSel;
  const zUp = (axisSel === 'auto' ? F.axis : axisSel) === 'z';
  return { unit, zUp };
}
function exportTargets() {
  const list = $('io-selonly').checked && selObjs.length ? selObjs : objects;
  return list.filter((o) => o.visible);
}
function baseName() { return ($('file-name').textContent || 'forja').replace(/\.forja$/, '') || 'forja'; }

async function saveFile(name, data) {
  const blob = data instanceof Blob ? data : new Blob([data]);
  const ext = name.split('.').pop().toLowerCase();
  // Dentro de la página de Claude la descarga pasa por el permiso "downloads"; en GitHub Pages es una descarga normal
  const dl = window.claude?.use ? await window.claude.use('downloads').catch(() => null) : null;
  if (dl) {
    const req = ARTIFACT_EXTS.has(ext) ? { filename: name, data: blob }
      : { filename: name + '.zip', data: X.makeZip([{ name, data: new Uint8Array(await blob.arrayBuffer()) }]) };
    try {
      await dl.save(req);
      toast(req.filename.endsWith('.zip') && !name.endsWith('.zip') ? `${name} guardado dentro de un .zip` : `${name} guardado`);
    } catch (e) {
      if (e?.code !== 'declined') toast(`No se pudo guardar ${name} aquí. Prueba desde el enlace de GitHub Pages.`);
    }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast(`${name} descargado`);
}

// Escena temporal con las mallas a exportar, ya en las unidades y el eje del formato
function meshExportScene(targets, o) {
  const root = new THREE.Group(), s = X.UNITS[o.unit];
  root.scale.setScalar(s);
  if (o.zUp) root.rotation.x = Math.PI / 2;
  for (const t of targets) {
    if (t.kind === 'curve') continue;
    const m = new THREE.Mesh(t.parts.mesh.geometry, materials[t.mat]);
    m.name = t.name;
    root.add(m);
  }
  const sc = new THREE.Scene(); sc.add(root); sc.updateMatrixWorld(true);
  return sc;
}

function polylines2D(targets) {
  const out = [], t = new THREE.Vector3();
  for (const o of targets) {
    if (o.kind === 'surface') {
      const s = N.surfaceOf(o.data), S = 60;
      const line = (fn) => { const pts = []; for (let k = 0; k <= S; k++) { fn(k / S, t); pts.push(t.clone()); } return pts; };
      for (const u of N.uniqueKnots(o.data.knotsU)) out.push({ layer: u === 0 || u === 1 ? 'BORDES' : 'PARCHES', pts: line((a, v) => s.getPoint(u, a, v)) });
      for (const v of N.uniqueKnots(o.data.knotsV)) out.push({ layer: v === 0 || v === 1 ? 'BORDES' : 'PARCHES', pts: line((a, w) => s.getPoint(a, v, w)) });
    } else if (o.kind === 'curve') {
      out.push({ layer: 'CURVAS', pts: o.samples.map((p) => p.clone()) });
    }
  }
  return out;
}
function view2DAxes() {
  const v = $('io-view').value;
  if (v === 'top') return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1)];
  if (v === 'front') return [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0)];
  if (v === 'side') return [new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)];
  return [new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion), new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion)];
}

function serializeProject() {
  const v4 = (q) => [q.x, q.y, q.z, q.w];
  return JSON.stringify({
    format: 'forja', version: 1, units: 'dm', up: 'y',
    objects: objects.map((o) => {
      const base = { kind: o.kind, name: o.name, mat: o.mat, visible: o.visible, pivot: o.pivot.toArray() };
      const d = o.data;
      if (o.kind === 'surface') return { ...base, degU: d.degU, degV: d.degV, knotsU: d.knotsU, knotsV: d.knotsV, cvs: d.cvs.map((r) => r.map(v4)) };
      if (o.kind === 'curve') return { ...base, deg: d.deg, knots: d.knots, plane: d.plane, cvs: d.cvs.map(v4),
        ...(d.cos ? { cos: { ...d.cos, surf: objects.findIndex((x) => x.id === d.cos.surf) } } : {}) };
      const g = d.geometry;
      return { ...base, positions: Array.from(g.attributes.position.array), index: g.index ? Array.from(g.index.array) : null };
    }),
  });
}

async function doExport(fmt) {
  const F = FORMATS[fmt], targets = exportTargets(), o = exportOptions(fmt);
  const name = `${baseName()}${F.suffix || ''}.${F.ext}`;
  const nurbs = targets.filter((t) => t.kind !== 'mesh');
  if (!targets.length) return toast('No hay nada visible que exportar.');
  try {
    if (fmt === 'igs' || fmt === 'step') {
      if (!nurbs.length) return toast(`${F.label} guarda NURBS: las mallas importadas no se incluyen.`);
      await saveFile(name, fmt === 'igs' ? X.writeIGES(nurbs, o, name) : X.writeSTEP(nurbs, o, name));
    } else if (fmt === 'subd') {
      const ev = (d) => { const s = N.surfaceOf(d); return (u, v) => { const t = new THREE.Vector3(); s.getPoint(u, v, t); return t; }; };
      await saveFile(name, X.writeSubDOBJ(targets, ev, N.uniqueKnots, o));
    } else if (fmt === 'svg' || fmt === 'dxf') {
      const [right, up] = view2DAxes();
      const lines = X.project2D(polylines2D(targets), right, up, o);
      if (!lines.length) return toast('Para 2D hacen falta superficies o curvas visibles.');
      await saveFile(name, fmt === 'svg' ? X.writeSVG(lines, o) : X.writeDXF(lines));
    } else if (fmt === 'forja') {
      await saveFile(name, serializeProject());
    } else {
      const sc = meshExportScene(targets, o);
      if (fmt === 'obj') await saveFile(name, new OBJExporter().parse(sc));
      else if (fmt === 'stl') await saveFile(name, new Blob([new STLExporter().parse(sc, { binary: true })]));
      else if (fmt === 'ply') await saveFile(name, new Blob([await new Promise((res) => new PLYExporter().parse(sc, res, { binary: true }))]));
      else if (fmt === 'glb') {
        const buf = await new Promise((res, rej) => new GLTFExporter().parse(sc, res, rej, { binary: true }));
        await saveFile(name, new Blob([buf]));
      }
    }
  } catch (e) {
    console.error(e);
    toast(`No se pudo exportar ${F.label}: ${e.message || e}`);
  }
}

// ---------- Importar ----------
const IMPORT_DEFAULTS = { igs: ['mm', 'z'], iges: ['mm', 'z'], step: ['mm', 'z'], stp: ['mm', 'z'], stl: ['mm', 'z'], ply: ['mm', 'z'], obj: ['m', 'y'], glb: ['m', 'y'], gltf: ['m', 'y'] };
function importOptions(ext) {
  const [du, da] = IMPORT_DEFAULTS[ext] || ['mm', 'z'];
  const u = $('io-unit').value, a = $('io-axis').value;
  return { unit: u === 'auto' ? du : u, zUp: (a === 'auto' ? da : a) === 'z' };
}
function cadMatrix(o) {
  // del sistema del archivo al de Forja (dm, Y arriba)
  const m = new THREE.Matrix4().makeScale(1 / X.UNITS[o.unit], 1 / X.UNITS[o.unit], 1 / X.UNITS[o.unit]);
  if (o.zUp) m.multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
  return m;
}
function meshesFrom(object3d, o, base) {
  const out = [], m = cadMatrix(o);
  object3d.updateMatrixWorld(true);
  object3d.traverse((c) => {
    if (!c.isMesh) return;
    const g = c.geometry.clone();
    g.applyMatrix4(c.matrixWorld).applyMatrix4(m);
    out.push(addMesh(g, c.name || base));
  });
  return out;
}
let occtPromise = null;
function loadOCCT() {
  // OpenCASCADE (WebAssembly) para leer STEP. Se carga solo cuando hace falta.
  occtPromise ||= new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/occt-import-js.js';
    sc.onload = () => window.occtimportjs({ locateFile: (f) => `https://cdn.jsdelivr.net/npm/occt-import-js@0.0.22/dist/${f}` }).then(res, rej);
    sc.onerror = () => rej(new Error('no se pudo cargar OpenCASCADE'));
    document.head.append(sc);
  });
  return occtPromise;
}

async function importFile(file) {
  const ext = file.name.split('.').pop().toLowerCase(), base = file.name.replace(/\.[^.]+$/, '');
  const o = importOptions(ext);
  let created = [];
  if (ext === 'forja' || ext === 'json') {
    const j = JSON.parse(await file.text());
    if (j.format !== 'forja') throw new Error('no es un proyecto de Forja');
    const V4 = (a) => new THREE.Vector4(...a);
    for (const it of j.objects) {
      let ob;
      if (it.kind === 'surface') ob = addSurface({ degU: it.degU, degV: it.degV, knotsU: it.knotsU, knotsV: it.knotsV, cvs: it.cvs.map((r) => r.map(V4)) }, it.name);
      else if (it.kind === 'curve') ob = addCurve({ deg: it.deg, knots: it.knots, plane: it.plane, cvs: it.cvs.map(V4) }, it.name);
      else {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(it.positions, 3));
        if (it.index) g.setIndex(it.index);
        ob = addMesh(g, it.name);
      }
      ob.name = it.name; ob.mat = it.mat || matKey; ob.visible = it.visible !== false; ob.pivot.fromArray(it.pivot || ob.pivot.toArray());
      created.push(ob);
    }
    // curvas sobre superficie: el índice guardado apunta a su superficie
    j.objects.forEach((it, i) => { if (it.cos && created[it.cos.surf]) { created[i].data.cos = { ...it.cos, surf: created[it.cos.surf].id }; updateObject(created[i]); } });
    $('file-name').textContent = file.name.replace(/\.json$/, '.forja');
  } else if (ext === 'igs' || ext === 'iges') {
    const r = X.readIGES(await file.text(), o);
    const V4 = (q) => new THREE.Vector4(q.x, q.y, q.z, q.w);
    r.surfaces.forEach((d, k) => created.push(addSurface({ degU: d.degU, degV: d.degV, knotsU: d.knotsU, knotsV: d.knotsV, cvs: d.cvs.map((row) => row.map(V4)) }, d.label || `${base} ${k + 1}`)));
    r.curves.forEach((d, k) => created.push(addCurve({ deg: d.deg, knots: d.knots, plane: 'xz', cvs: d.cvs.map(V4) }, d.label || `${base} curva ${k + 1}`)));
    const skipped = Object.entries(r.skipped).map(([t, n]) => `${n}× tipo ${t}`).join(', ');
    if (skipped) toast(`IGES: importadas las superficies y curvas NURBS. Sin soporte todavía: ${skipped}.`);
  } else if (ext === 'step' || ext === 'stp') {
    toast('Cargando OpenCASCADE para leer STEP…');
    const occt = await loadOCCT();
    const r = occt.ReadStepFile(new Uint8Array(await file.arrayBuffer()), null);
    if (!r.success) throw new Error('OpenCASCADE no pudo leer el archivo');
    const grp = new THREE.Group();
    r.meshes.forEach((mm, k) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(mm.attributes.position.array, 3));
      if (mm.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(mm.attributes.normal.array, 3));
      g.setIndex(Array.from(mm.index.array));
      const me = new THREE.Mesh(g); me.name = mm.name || `${base} ${k + 1}`; grp.add(me);
    });
    created = meshesFrom(grp, o, base);
  } else if (ext === 'obj') {
    created = meshesFrom(new OBJLoader().parse(await file.text()), o, base);
  } else if (ext === 'stl') {
    created = meshesFrom(new THREE.Mesh(new STLLoader().parse(await file.arrayBuffer())), o, base);
  } else if (ext === 'ply') {
    created = meshesFrom(new THREE.Mesh(new PLYLoader().parse(await file.arrayBuffer())), o, base);
  } else if (ext === 'glb' || ext === 'gltf') {
    const data = ext === 'glb' ? await file.arrayBuffer() : await file.text();
    const gl = await new Promise((res, rej) => new GLTFLoader().parse(data, '', res, rej));
    created = meshesFrom(gl.scene, o, base);
  } else if (ext === 'x_t' || ext === 'x_b' || ext === 'blend' || ext === '3dm' || ext === 'wire') {
    throw new Error(`.${ext} es un formato cerrado: expórtalo como STEP o IGES desde su programa`);
  } else {
    throw new Error(`formato .${ext} no reconocido`);
  }
  if (created.length) {
    setPickMode('object');
    applySelection(created, 'replace');
    frameObjects(created);
    toast(`${file.name}: ${created.length} ${created.length === 1 ? 'objeto importado' : 'objetos importados'}`);
  }
}
async function importFiles(files) {
  for (const f of files) {
    try { await importFile(f); } catch (e) { console.error(e); toast(`No se pudo importar ${f.name}: ${e.message || e}`); }
  }
}

// Panel Archivo
function toggleFilePanel(force) {
  const p = $('filepanel'), open = force ?? p.hidden;
  p.hidden = !open;
  $('file-btn').setAttribute('aria-expanded', String(open));
}
$('file-btn').addEventListener('click', () => toggleFilePanel());
$('file-close').addEventListener('click', () => toggleFilePanel(false));
document.querySelectorAll('[data-export]').forEach((b) => b.addEventListener('click', () => doExport(b.dataset.export)));
$('io-import').addEventListener('click', () => $('io-file').click());
$('io-file').addEventListener('change', async (e) => { await importFiles([...e.target.files]); e.target.value = ''; });
addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); app.classList.add('dropping'); } });
addEventListener('dragleave', (e) => { if (e.target === document.documentElement || !e.relatedTarget) app.classList.remove('dropping'); });
addEventListener('drop', (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); app.classList.remove('dropping'); importFiles([...e.dataTransfer.files]); });
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 's') { e.preventDefault(); doExport('forja'); }
  else if (k === 'o') { e.preventDefault(); $('io-file').click(); }
  else if (k === 'e') { e.preventDefault(); toggleFilePanel(); }
});

// ---------- Módulo IA ----------
let sampleCap;
async function claudeSample() {
  // Dentro de claude.ai la página puede preguntarle a Claude (capacidad "sample"); en GitHub Pages no hay IA conectada
  sampleCap ??= window.claude?.use ? await window.claude.use('sample').catch(() => null) : null;
  return sampleCap;
}
async function askClaude(text, answers, images = [], force = false) {
  const cap = await claudeSample();
  if (!cap) return null;
  const done = force && !answers.length ? '\n\nNo hagas preguntas: devuelve items ya, con suposiciones razonables.' : answers.length ? `\n\nRespuestas del usuario a tus preguntas:\n${answers.map((a) => `- ${a.q} → ${a.a}`).join('\n')}\nYa no preguntes más: devuelve items.` : '';
  const pics = images.length ? `\n\nEl usuario adjunta ${images.length} foto(s) del mismo objeto desde distintos ángulos: modélalo lo más fiel posible.` : '';
  // primero (preguntas) basta el modelo rápido; para construir la pieza se usa el normal, que piensa mejor la forma
  const prompt = `${AI.CLAUDE_INSTRUCTIONS}\n\nPedido: ${text}${pics}${done}`;
  const opts = { modelTier: answers.length || images.length || force ? 'default' : 'quick', ...(images.length ? { images } : {}) };
  let r;
  try { r = await cap.json(prompt, opts); }
  catch (e) {
    // si Claude escribió algo más que el JSON (o lo cortó), se intenta rescatar el JSON del texto
    if (e?.code !== 'invalid_json' || !(r = looseJSON(e.text))) throw e;
  }
  return r && (Array.isArray(r.items) || Array.isArray(r.questions)) ? r : null;
}
function looseJSON(t) {
  if (!t) return null;
  t = String(t).replace(/```(?:json)?/g, '');
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(t.slice(a, b + 1)); } catch { return null; }
}
// Mensaje claro según el código de error de Claude, con botón para reintentar
const CLAUDE_ERRORS = {
  not_granted: 'No hay permiso para usar Claude en esta página. Ábrelo desde el menú de permisos del artifact y permite "Claude".',
  sampling_disabled: 'Claude no está disponible para esta cuenta.',
  rate_limited: 'Demasiadas peticiones seguidas o se acabó el uso disponible. Espera un poco y reintenta.',
  session_expired: 'Tu sesión de Claude caducó: vuelve a iniciar sesión.',
  images_unavailable: 'Esta vista no puede enviar fotos a Claude.',
  image_rejected: 'Alguna foto no sirve (formato o tamaño). Prueba con JPG o PNG más pequeños.',
  refused: 'Claude no quiso responder a ese pedido. Prueba a describirlo de otra forma.',
  empty_completion: 'Claude no respondió nada. Prueba a describirlo más corto.',
  invalid_json: 'Claude respondió sin el formato que entiende Forja.',
  prompt_too_large: 'El pedido es demasiado largo.',
};
function claudeError(e, retry) {
  console.warn(e);
  const code = e?.code || 'upstream_error';
  const el = aiSay(`${esc(CLAUDE_ERRORS[code] || 'No pude hablar con Claude ahora (fallo de conexión).')} <small>(${esc(code)})</small>
    ${retry ? '<div class="ai-chips"><button class="chip">Reintentar</button></div>' : ''}`);
  if (retry) el.querySelector('.chip').addEventListener('click', (ev) => { markChosen(ev.target); retry(); }, { once: true });
}
// Coloca lo generado en fila a la derecha de la escena. Mallas (tornillería, muebles) o superficies NURBS (vasos…)
function placeGenerated(cmds) {
  const box = boundsOf(objects.filter((o) => o.visible));
  let x = box.isEmpty() ? 0 : box.max.x + 1;
  const created = [];
  for (const c of cmds) {
    const gen = AI.GENERATORS[c.type];
    if (!gen) continue;
    for (let k = 0; k < Math.min(20, c.n || 1); k++) {
      const res = gen(c.params || {});
      if (res.surfaces || res.meshes) {
        // varias piezas (superficies NURBS y mallas): se colocan juntas, apoyadas en el suelo
        const sfs = res.surfaces || [], ms = res.meshes || [];
        const box = new THREE.Box3();
        sfs.forEach((sf) => sf.data.cvs.flat().forEach((v) => box.expandByPoint(new THREE.Vector3(v.x, v.y, v.z))));
        ms.forEach((m) => { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox); });
        if (box.isEmpty()) continue;
        const d = new THREE.Vector3(x - box.min.x, -box.min.y, -(box.min.z + box.max.z) / 2);
        const many = sfs.length + ms.length > 1;
        for (const sf of sfs) {
          sf.data.cvs.forEach((row) => row.forEach((v) => { v.x += d.x; v.y += d.y; v.z += d.z; }));
          const o = addSurface(sf.data, sf.name);
          o.name = many ? `${res.name} · ${sf.name}` : res.name + (k ? ` ${k + 1}` : '');
          if (sf.material) o.mat = sf.material;
          created.push(o);
        }
        for (const m of ms) {
          m.geometry.translate(d.x, d.y, d.z);
          const o = addMesh(m.geometry, m.name);
          o.name = many ? `${res.name} · ${m.name}` : res.name;
          if (m.material) o.mat = m.material;
          created.push(o);
        }
        x += (box.max.x - box.min.x) * 1.35 + 0.15;
        continue;
      }
      const { geometry, name } = res;
      geometry.computeBoundingBox();
      const bb = geometry.boundingBox, w = bb.max.x - bb.min.x;
      geometry.translate(x - bb.min.x, 0, -(bb.min.z + bb.max.z) / 2);
      x += w + Math.max(0.15, w * 0.35);
      const o = addMesh(geometry, name);
      o.name = name.replace(/ \d+$/, '') + (k ? ` ${k + 1}` : '');
      created.push(o);
    }
  }
  return created;
}

// Conversación del módulo IA: el pedido se interpreta y, si le faltan datos, la IA hace un par de
// preguntas concretas (con opciones para elegir de un clic) antes de crear nada.
let aiConv = null;   // { text, items, queue: [{ idx, param }], total }  o  { text, claude: true, queue: [{ q, options }], answers: [] }
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function aiSay(html, who = 'ai') {
  const el = document.createElement('div');
  el.className = 'msg ' + who;
  el.innerHTML = html;
  $('ai-chat').append(el);
  $('ai-chat').scrollTop = 1e9;
  return el;
}
function aiAsk() {
  const c = aiConv, item = c.queue[0], n = c.total - c.queue.length + 1;
  const q = c.claude ? item.q : item.param.q;
  const options = c.claude ? (item.options || []).map((o) => ({ label: o, value: o })) : item.param.options;
  const el = aiSay(`<small>Pregunta ${n} de ${c.total}${!c.claude && c.items.length > 1 ? ' · ' + AI.CATALOG[c.items[item.idx].type].label : ''}</small><p>${esc(q)}</p>
    <div class="ai-chips">${options.map((o, i) => `<button class="chip" data-i="${i}">${esc(o.label)}</button>`).join('')}
    <button class="chip ghost" data-def>${c.claude ? 'Como veas' : 'Por defecto'}</button><button class="chip ghost" data-now>Crear ya</button></div>`);
  el.querySelectorAll('[data-i]').forEach((b) => b.addEventListener('click', () => aiAnswer(options[+b.dataset.i], b)));
  el.querySelector('[data-def]').addEventListener('click', (e) => aiAnswer(null, e.target));
  el.querySelector('[data-now]').addEventListener('click', (e) => { if (aiConv !== c) return; c.queue.length = 0; c.forced = true; markChosen(e.target); aiNext(); });
  $('ai-status').textContent = 'Elige una opción o escribe la respuesta.';
}
function markChosen(btn) { btn.closest('.ai-chips').querySelectorAll('button').forEach((b) => { b.disabled = true; b.classList.toggle('on', b === btn); }); }
// Respuesta a la pregunta actual: una opción ({label, value}), null = por defecto, o texto escrito
function aiAnswer(choice, btn, typed) {
  const c = aiConv;
  if (!c || !c.queue.length || (btn && btn.disabled)) return;
  const item = c.queue[0];
  if (c.claude) {
    c.answers.push({ q: item.q, a: typed ?? (choice ? choice.label : 'lo que mejor quede') });
  } else if (typed !== undefined) {
    const v = item.param.answer(AI.normalize(typed));
    if (v === undefined) { aiSay('No te entendí. Elige una de las opciones o escribe un número.'); return; }
    c.items[item.idx].given[item.param.key] = v;
  } else if (choice) c.items[item.idx].given[item.param.key] = choice.value;
  if (btn) markChosen(btn);
  if (typed !== undefined) aiSay(esc(typed), 'user');
  c.queue.shift();
  aiNext();
}
async function aiNext() {
  const c = aiConv;
  if (c.queue.length) return aiAsk();
  aiConv = null;
  if (c.claude) {
    $('ai-status').textContent = 'Modelando… (puede tardar hasta un minuto)';
    try { const r = await askClaude(c.text, c.answers, c.images || [], !!c.forced); if (r?.items?.length) return aiCreate(c.text, r.items, r.note); aiSay(esc(r?.note || 'No pude hacerlo.')); }
    catch (e) { claudeError(e, () => { aiConv = c; aiNext(); }); }
    $('ai-status').textContent = '';
    return;
  }
  aiCreate(c.text, AI.toCommands(c.items));
}
function aiCreate(text, cmds, note) {
  const created = placeGenerated(cmds);
  if (!created.length) { aiSay('No pude crear nada con eso.'); return; }
  setPickMode('object');
  applySelection(created, 'replace');
  frameObjects(created);
  const what = cmds.filter((c) => AI.CATALOG[c.type]).map((c) => AI.describe({ ...c, n: c.n || 1, params: { ...c.params } }));
  aiSay(`Listo: ${esc((note || what.join(' · ') || [...new Set(created.map((o) => o.name.split(' · ')[0]))].join(', ')).replace(/[.\s]+$/, ''))}.`);
  $('ai-status').textContent = '';
  const li = document.createElement('li');
  li.innerHTML = `<b>${esc(text)}</b> → ${created.length} ${created.length === 1 ? 'objeto' : 'objetos'}`;
  $('ai-log').prepend(li);
  updateStatus();
}
// Fotos del objeto (solo dentro de claude.ai, con la capacidad sample + imágenes)
let aiPhotos = [];
function renderPhotos() {
  $('ai-photos').innerHTML = aiPhotos.map((f, i) => `<span class="ai-photo"><img src="${URL.createObjectURL(f)}" alt="Foto ${i + 1}"><button data-i="${i}" aria-label="Quitar foto">×</button></span>`).join('');
  $('ai-photos').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { aiPhotos.splice(+b.dataset.i, 1); renderPhotos(); }));
}
$('ai-photo-btn').addEventListener('click', () => $('ai-photo-in').click());
$('ai-photo-in').addEventListener('change', async (e) => {
  const lim = (await (await claudeSample())?.limits().catch(() => null))?.images;
  if (!lim) { aiSay('Las fotos solo funcionan con Forja abierto dentro de Claude (allí la IA puede ver las imágenes).'); e.target.value = ''; return; }
  aiPhotos = [...aiPhotos, ...[...e.target.files].filter((f) => lim.mediaTypes.includes(f.type))].slice(0, lim.maxCount);
  e.target.value = '';
  renderPhotos();
  $('ai-status').textContent = 'Escribe qué es (y una medida real si la sabes) y pulsa Crear.';
});
// Un pedido "sencillo" de la biblioteca se resuelve aquí mismo; uno con detalles extra (marca, "con asa"...) va a Claude si está
const EXTRA = /\bcon (?!asa|oreja|patas|asiento|respaldo|cabeza|sus tuercas|tuercas|arandelas)|\bmarca\b|\bestilo\b|\bcomo (?:el|la|un|una)\b|\bpara\b|\bde (?:madera|metal|vidrio|plastico|plástico)\b/i;
async function runAI(text) {
  text = text.trim();
  const photos = aiPhotos.slice();
  if (!text && !photos.length) return;
  $('ai-prompt').value = '';
  // si hay una pregunta abierta, lo escrito es la respuesta
  if (aiConv?.queue.length && !photos.length && !AI.parsePrompt(text)) return aiAnswer(null, null, text);
  aiConv = null;
  const shown = text || 'el objeto de las fotos';
  aiSay(esc(shown) + (photos.length ? `<div class="ai-photos small">${photos.map((f) => `<img src="${URL.createObjectURL(f)}" alt="">`).join('')}</div>` : ''), 'user');
  aiPhotos = []; renderPhotos();
  const cap = await claudeSample();
  const items = photos.length ? null : AI.parsePrompt(text);
  if (items && !(cap && EXTRA.test(text))) {
    const queue = AI.questionsFor(items, 2);
    aiConv = { text, items, queue, total: queue.length };
    if (queue.length) aiSay(`Voy a hacer ${items.map((it) => AI.CATALOG[it.type].label).join(' y ')}. Para que salga como quieres, ${queue.length === 1 ? 'una pregunta' : 'un par de preguntas'}:`);
    return aiNext();
  }
  if (!cap) {
    const known = Object.values(AI.CATALOG);
    const el = aiSay(`${photos.length ? 'Para modelar desde fotos' : 'Para objetos fuera de la biblioteca'} hace falta la IA de Claude: abre Forja dentro de Claude.
      Aquí, sin conexión, sé hacer: <div class="ai-chips">${known.map((k) => `<button class="chip">${k.label}</button>`).join('')}</div>`);
    el.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => runAI('un ' + b.textContent)));
    return;
  }
  // Claude: primero un par de preguntas para concretar, después construye el objeto (de la biblioteca o con piezas)
  $('ai-status').textContent = 'Pensando…';
  let r = null;
  try { r = await askClaude(shown, [], photos); }
  catch (e) { claudeError(e, () => { aiPhotos = photos; runAI(text); }); }
  $('ai-status').textContent = '';
  if (r?.questions?.length) {
    aiConv = { text: shown, claude: true, queue: r.questions.slice(0, 2), answers: [], images: photos };
    aiConv.total = aiConv.queue.length;
    aiSay(`Para que salga ${photos.length ? 'igual que en las fotos' : 'lo más parecido posible'}, ${aiConv.total === 1 ? 'una pregunta' : 'un par de preguntas'}:`);
    return aiNext();
  }
  if (r?.items?.length) return aiCreate(shown, r.items, r.note);
  if (r) aiSay(esc(r.note || 'No pude hacerlo.'));
}
$('ai-go').addEventListener('click', () => runAI($('ai-prompt').value));
$('ai-prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAI(e.target.value); } });
document.querySelectorAll('#ai-chips .chip').forEach((b) => b.addEventListener('click', () => runAI(b.textContent)));

// ---------- Atajos de teclado ----------
addEventListener('keydown', (e) => {
  if (['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.altKey || e.ctrlKey || e.metaKey) return;
  const k = e.key.toLowerCase();
  if (k === 'f') frameSelection();
  else if (k === 't') topView();
  else if (k === 'l') pivotToSelection();
  else if (k === 'w') setXform('translate');
  else if (k === 'e') setXform('rotate');
  else if (k === 'r') setXform('scale');
  else if (k === 'd' || k === 'insert') togglePivotEdit();
  else if (k === 'c') setTool('curve');
  else if (k === 'b') startFillet();
  else if (k === 'o' && e.shiftKey) toggleOrtho();
  else if (k === 'o') setPickMode('object');
  else if (k === 'p') setPickMode('cv');
  else if (k === '4') setDiag('showroom');
  else if (k === '5') setDiag('diffuse');
  else if (k === '6') setDiag('sky');
  else if (k === '1') setDiag('zebra');
  else if (k === '2') setDiag('curv');
  else if (k === '3') setDiag('wire');
  else if (k === '7') setDiag('clay');
  else if (k === 'enter' && tool === 'curve') finishDraft();
  else if (k === 'enter' && tool === 'edge' && edgeOp && EDGE_OPS[edgeOp.type].enter) EDGE_OPS[edgeOp.type].enter();
  else if (k === 'escape') {
    if (tool !== 'select') setTool('select'); else if (pivotEdit) togglePivotEdit();
    else if (mouseXform) { mouseXform = false; updateHint(); } else clearSelection();
  }
  else if (k === 'delete' || k === 'backspace') deleteSelection();
});

// Pick walk (como en Alias): Ctrl + flechas pasa al CV vecino. Curvas: izq/der. Superficies: izq/der = U, arriba/abajo = V.
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || !e.key.startsWith('Arrow') || pickMode !== 'cv' || selCVs.size !== 1) return;
  e.preventDefault();
  const r = [...selCVs.values()][0], o = r.obj, cl = THREE.MathUtils.clamp;
  const du = { ArrowRight: 1, ArrowLeft: -1 }[e.key] || 0, dv = { ArrowUp: 1, ArrowDown: -1 }[e.key] || 0;
  if (o.kind === 'curve') {
    const i = cl(r.i + du, 0, o.data.cvs.length - 1);
    applySelection([{ obj: o, i, key: cvKey(o, i) }], 'replace');
  } else {
    const i = cl(r.i + du, 0, o.data.cvs.length - 1), j = cl(r.j + dv, 0, o.data.cvs[0].length - 1);
    applySelection([{ obj: o, i, j, key: cvKey(o, i, j) }], 'replace');
  }
});

// ---------- Comandos de los menús radiales ----------
function pickNothing() { setTool('select'); mouseXform = false; clearSelection(); updateHint(); }
const cloneV4 = (v) => new THREE.Vector4(v.x, v.y, v.z, v.w);
function duplicateSelection() {
  if (pickMode !== 'object' || !selObjs.length) return toast('Duplicar: selecciona objetos (modo Objetos).');
  const out = selObjs.map((o) => {
    const d = o.data;
    const c = o.kind === 'surface' ? addSurface({ degU: d.degU, degV: d.degV, knotsU: d.knotsU.slice(), knotsV: d.knotsV.slice(), cvs: d.cvs.map((r) => r.map(cloneV4)) }, o.name.replace(/ \d+$/, ''))
      : o.kind === 'curve' ? addCurve({ deg: d.deg, knots: d.knots.slice(), plane: d.plane, cvs: d.cvs.map(cloneV4) }, o.name.replace(/ \d+$/, ''))
      : addMesh(d.geometry.clone(), o.name.replace(/ \d+$/, ''));
    c.mat = o.mat; c.pivot.copy(o.pivot);
    return c;
  });
  applySelection(out, 'replace');
  toast(`${out.length} ${out.length === 1 ? 'objeto duplicado' : 'objetos duplicados'} en el mismo sitio · W para moverlo`);
}
function hideSelection() {
  if (!selObjs.length) return toast('Ocultar: selecciona objetos.');
  const n = selObjs.length;
  checkpoint();
  selObjs.forEach((o) => (o.visible = false));
  clearSelection();
  toast(`${n} ${n === 1 ? 'objeto oculto' : 'objetos ocultos'} · Mostrar todo en el Puck (Tab)`);
}
function unhideAll() { checkpoint(); objects.forEach((o) => (o.visible = true)); selectionChanged(); toast('Todo visible'); }
let modelClean = false;
function toggleModel() {
  modelClean = !modelClean;
  objects.forEach(applyVisibility);
  toast(modelClean ? 'Toggle Model: parches, hulls y CVs ocultos' : 'Toggle Model: parches, hulls y CVs visibles');
}
function toggleGrid() { grid.visible = !grid.visible; }
function fullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => toast('La pantalla completa no está disponible en esta vista.'));
}
const soon = (name) => () => toast(`${name}: próximamente`);

// Iconos de línea (24×24) para los menús radiales
const IC = {
  curve: 'M3 18C7 4 17 20 21 6', plane: 'M3 16l6-9h12l-6 9z', revolve: 'M12 3v18M4 12a8 3 0 0 0 16 0M15 6c2 2 2 9 0 12',
  loft: 'M4 18c3-4 6-4 9-2s5 1 7-2M4 12c3-4 6-4 9-2s5 1 7-2M4 6c3-4 6-4 9-2s5 1 7-2', extrude: 'M4 18c4-3 8 1 12-2M8 6c4-3 8 1 12-2M4 18l4-12M16 16l4-12',
  dup: 'M9 9h11v11H9zM4 15V4h11', align: 'M4 20V4M8 12c4 0 6-6 12-6M8 12c4 0 6 6 12 6', round: 'M4 20V12a8 8 0 0 1 8-8h8',
  extend: 'M4 18C8 8 12 6 14 6M16 6h5M19 3l3 3-3 3', circle: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z', project: 'M12 3v9M9 9l3 3 3-3M3 17c5-3 13-3 18 0', offset: 'M3 15c5-6 13-6 18 0M3 20c5-6 13-6 18 0', blend: 'M3 6h6c6 0 6 12 12 12M3 18h6',
  nothing: 'M4 4h4M16 4h4M4 20h4M16 20h4M4 4v4M20 4v4M4 16v4M20 16v4M9 9l6 6M15 9l-6 6', object: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
  cv: 'M4 18C8 6 16 18 20 6M3 17h2v2H3zM19 5h2v2h-2zM11 11h2v2h-2z', pickCurve: 'M3 17C7 5 13 19 21 7M17 4l4 3-4 3',
  pickSurf: 'M3 15l5-8h13l-5 8zM6 19h13', move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  rotate: 'M20 12a8 8 0 1 1-3-6.2M20 4v5h-5', scale: 'M4 10h10v10H4zM13 4h7v7M20 4l-8 8', pivot: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v5M12 17v5M2 12h5M17 12h5',
  frame: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5', top: 'M4 4h16v16H4zM12 8v8M8 12h8', hide: 'M3 3l18 18M10.6 6.1A9 9 0 0 1 22 12s-1.3 2.6-4 4.6M6.6 6.6C3.7 8.6 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1',
  show: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', del: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  symm: 'M12 3v18M9 6L4 12l5 6M15 6l5 6-5 6', measure: 'M3 17l14-14 4 4L7 21zM7 13l2 2M10 10l2 2M13 7l2 2',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7v.5', model: 'M7 4h10l2 5-2 11H7L5 9z', grid: 'M4 4h16v16H4zM4 10h16M4 15h16M10 4v16M15 4v16',
  ctrlOn: 'M4 18C8 6 16 18 20 6M3 17h2v2H3zM19 5h2v2h-2z', ctrlOff: 'M4 18C8 6 16 18 20 6M3 3l18 18', shade: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3c-4 3-4 15 0 18',
  visu: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM8 9a3 2 0 0 1 4-1', full: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5M9 9l-4-4M15 9l4-4M9 15l-4 4M15 15l4 4',
  panel: 'M4 4h16v16H4zM14 4v16', split: 'M4 4h16v16H4zM12 4v16', ai: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
};
const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="${IC[k]}"/></svg>`;

Object.assign(IC, {
  arrow: 'M6 3l12 8-5.5 1.5L9.5 19z', surf: 'M3 14c4-6 14-6 18 0M3 14l3 6h12l3-6', edit: 'M4 18c4-8 12-8 16 0M12 3v7M8.5 6.5h7',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  cloud: 'M7 18h10a4 4 0 0 0 0-8 6 6 0 0 0-11.5 1.5A3.3 3.3 0 0 0 7 18z', sunset: 'M3 17h18M7 17a5 5 0 0 1 10 0M12 5v4M5 9l2 2M19 9l-2 2',
  studio: 'M4 20V9l8-5 8 5v11M8 20v-6h8v6', zebra: 'M4 4h16v16H4zM4 10l6-6M4 16L16 4M10 20L20 10M16 20l4-4',
  curvz: 'M3 18c5-12 13-12 18 0M7 11v7M12 8v10M17 11v7', wire: 'M4 4h16v16H4zM4 12h16M12 4v16M4 4l16 16', screen: 'M3 5h18v12H3zM8 21h8M12 17v4',
  ground: 'M3 18h18M5 18l4-8 3 5 2-3 5 6', front: 'M5 4h14v16H5zM9 9c2 6 4-4 6 2',
});
// Menús radiales en 3D: un anillo de esferas visto desde arriba (elipse), más grandes delante y crecen junto al
// ratón. Cada esfera del anillo puede tener un submenú: al pasar sobre ella salen esferas más pequeñas hacia fuera.
const mv = () => { setTool('select'); setXform('translate'); }, rot = () => { setTool('select'); setXform('rotate'); }, scl = () => { setTool('select'); setXform('scale'); };
const env = (k) => () => { document.querySelector(`[data-env="${k}"]`)?.click(); if (layout !== 'render') switchLayout('render'); };
Object.assign(IC, {
  mat: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 9a5 5 0 0 1 5-3', bg: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6', tone: 'M3 17c4 0 5-10 9-10s5 10 9 10M3 21h18',
  expo: 'M12 3v2M12 19v2M3 12h2M19 12h2M12 8a4 4 0 1 0 0 8zM12 8a4 4 0 0 1 0 8', render: 'M4 6h16v12H4zM4 10h16M8 6v12',
  chat: 'M4 5h16v11H9l-5 4z', photo: 'M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3', redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  modules: 'M12 4a8 3 0 1 0 0 6 8 3 0 0 0 0-6zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7', cube: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
});
// Puck (Tab): cada módulo tiene el suyo, con sus herramientas, y cada quien lo puede personalizar
// (Preferencias > Puck). PUCK_CMDS es la biblioteca de comandos; PUCK_DEFAULT, lo que trae cada módulo de fábrica.
const setInput = (id, v, ev = 'input') => { const el = $(id); el.value = v; el.dispatchEvent(new Event(ev)); };
const matSub = (keys) => keys.map((k) => ({ k: 'mat', label: MAT_NAMES[k], run: () => setMaterial(k) }));
const PUCK_CMDS = {
  // Modelado
  curve: { k: 'curve', label: 'Curva', key: 'C', run: () => setTool('curve'), sub: [
    { k: 'ground', label: 'En el suelo', run: () => { setDrawPlane('xz'); setTool('curve'); } },
    { k: 'front', label: 'De frente', run: () => { setDrawPlane('xy'); setTool('curve'); } },
    { k: 'circle', label: 'Círculo', run: () => setTool('circle') }, { k: 'project', label: 'Proyectar', run: projectSelection }] },
  surface: { k: 'surf', label: 'Superficie', run: () => setTool('plane'), sub: [
    { k: 'plane', label: 'Plano', run: () => setTool('plane') }, { k: 'revolve', label: 'Revolución', run: () => OPS.revolve() },
    { k: 'loft', label: 'Loft', run: () => OPS.loft() }, { k: 'extrude', label: 'Extruir', run: () => OPS.extrude() }] },
  edit: { k: 'edit', label: 'Editar', run: () => startEdgeOp('align'), sub: [
    { k: 'align', label: 'Align', run: () => startEdgeOp('align') }, { k: 'blend', label: 'Blend', run: () => startEdgeOp('blend') },
    { k: 'loft', label: 'Skin', run: () => startEdgeOp('skin') }, { k: 'extend', label: 'Extender', run: () => startEdgeOp('extend') },
    { k: 'offset', label: 'Offset', run: offsetSelection }, { k: 'round', label: 'Redondear', run: () => startFillet() }] },
  pick: { k: 'arrow', label: 'Elegir', key: 'O', run: () => setPickMode('object'), sub: [
    { k: 'object', label: 'Objeto', run: () => setPickMode('object') }, { k: 'pickCurve', label: 'Curvas', run: () => setPickMode('object', 'curve') },
    { k: 'pickSurf', label: 'Superficies', run: () => setPickMode('object', 'surface') }, { k: 'cv', label: 'CV', run: () => setPickMode('cv') },
    { k: 'nothing', label: 'Nada', run: pickNothing }] },
  xform: { k: 'move', label: 'Transformar', key: 'W', run: mv, sub: [
    { k: 'move', label: 'Mover', run: mv }, { k: 'rotate', label: 'Rotar', run: rot }, { k: 'scale', label: 'Escalar', run: scl }, { k: 'pivot', label: 'Pivote', run: togglePivotEdit }] },
  dup: { k: 'dup', label: 'Duplicar', run: duplicateSelection, sub: [{ k: 'symm', label: 'Simetría', run: mirrorSelection }, { k: 'measure', label: 'Distancia', soon: true }] },
  show: { k: 'show', label: 'Mostrar', run: unhideAll, sub: [
    { k: 'hide', label: 'Ocultar', run: hideSelection }, { k: 'show', label: 'Mostrar todo', run: unhideAll },
    { k: 'frame', label: 'Encuadrar', run: frameSelection }, { k: 'top', label: 'Vista sup.', run: topView }] },
  del: { k: 'del', label: 'Borrar', key: 'Supr', run: deleteSelection },
  eval: { k: 'zebra', label: 'Evaluar', run: () => setDiag('showroom'), sub: EVAL_MODES.map((m) => ({ k: { showroom: 'studio', clay: 'studio', diffuse: 'shade', sky: 'sun', zebra: 'zebra', curv: 'curvz', wire: 'wire' }[m.k], label: m.label, run: () => setDiag(m.k) })) },
  // Visu
  mats: { k: 'mat', label: 'Materiales', run: () => setMaterial(matKey), sub: matSub(['paint', 'black', 'pearl', 'alu', 'chrome']) },
  mats2: { k: 'mat', label: 'Más materiales', run: () => setMaterial('ceram'), sub: matSub(['ceram', 'glass', 'plastic', 'clay']) },
  env: { k: 'sun', label: 'Entorno', run: env('studio'), sub: [
    { k: 'studio', label: 'Estudio', run: env('studio') }, { k: 'sun', label: 'Exterior', run: env('sun') },
    { k: 'sunset', label: 'Atardecer', run: env('sunset') }, { k: 'cloud', label: 'Nublado', run: env('overcast') }] },
  bg: { k: 'bg', label: 'Fondo', run: () => $('env-bg').click(), sub: [
    { k: 'bg', label: 'Ver / quitar', run: () => $('env-bg').click() }, { k: 'bg', label: 'Nítido', run: () => setInput('env-blur', 0) },
    { k: 'bg', label: 'Desenfocado', run: () => setInput('env-blur', 0.6) }] },
  tone: { k: 'tone', label: 'Color', run: () => setInput('tone', 'agx', 'change'), sub: [
    { k: 'tone', label: 'AgX', run: () => setInput('tone', 'agx', 'change') }, { k: 'tone', label: 'ACES', run: () => setInput('tone', 'aces', 'change') },
    { k: 'tone', label: 'Estándar', run: () => setInput('tone', 'none', 'change') }] },
  expo: { k: 'expo', label: 'Exposición', run: () => setInput('expo', 0), sub: [
    { k: 'expo', label: 'Más luz', run: () => setInput('expo', Math.min(3, +$('expo').value + 0.5)) },
    { k: 'expo', label: 'Normal', run: () => setInput('expo', 0) }, { k: 'expo', label: 'Menos luz', run: () => setInput('expo', Math.max(-3, +$('expo').value - 0.5)) }] },
  render: { k: 'render', label: 'Render', soon: true, sub: [{ k: 'render', label: 'Trazado de rayos', soon: true }, { k: 'photo', label: 'Guardar imagen', soon: true }] },
  // IA
  aiNew: { k: 'chat', label: 'Nuevo pedido', run: () => { setPinned(true); $('ai-prompt').focus(); } },
  aiPhoto: { k: 'photo', label: 'Desde fotos', run: () => $('ai-photo-btn').click() },
  aiEx: { k: 'ai', label: 'Ejemplos', run: () => runAI('una taza'), sub: [
    { k: 'cube', label: 'Tornillo', run: () => runAI('tornillo') }, { k: 'cube', label: 'Mesa', run: () => runAI('una mesa') },
    { k: 'cube', label: 'Silla', run: () => runAI('una silla') }, { k: 'cube', label: 'Taza', run: () => runAI('una taza') }, { k: 'cube', label: 'Botella', run: () => runAI('una botella') }] },
  // comunes
  undo: { k: 'undo', label: 'Deshacer', key: 'Ctrl+Z', run: undo, sub: [{ k: 'redo', label: 'Rehacer', run: redo }] },
  forgeIn: { k: 'object', label: 'Usar selección', run: () => forgeFromForja() },
  forgeOut: { k: 'dup', label: 'Aplicar', run: () => forgeApply() },
  forgeExport: { k: 'object', label: 'Exportar', run: () => $('bf-exportBtn').click() },
  forgeFrame: { k: 'frame', label: 'Encuadrar', run: () => forge?.resetCamera() },
  forgeRender: { k: 'sun', label: 'Render', run: () => $('bf-ptTool').click() },
  frame: { k: 'frame', label: 'Encuadrar', key: 'F', run: frameSelection, sub: [{ k: 'frame', label: 'Todo', run: () => frameObjects([]) }, { k: 'top', label: 'Vista sup.', run: topView }] },
  layers: { k: 'layers', label: 'Capas', run: () => layersWin.show(), sub: [
    { k: 'layers', label: 'Nueva capa', run: newLayer }, { k: 'layers', label: 'Pasar selección', run: () => assignToLayer() }] },
  modules: { k: 'modules', label: 'Módulos', run: holdHint, sub: [
    { k: 'shade', label: 'Modelado', run: () => switchLayout('diag') }, { k: 'visu', label: 'Visu', run: () => switchLayout('render') }, { k: 'ai', label: 'IA', run: () => switchLayout('ai') }, { k: 'object', label: 'Forge', run: () => switchLayout('forge') }] },
  prefs: { k: 'gear', label: 'Personalizar', run: () => openPrefs('puck') },
};
function holdHint() { toast('Mantén V para ver los módulos y elige uno con el ratón'); }
const PUCK_DEFAULT = {
  diag: ['curve', 'surface', 'edit', 'pick', 'xform', 'dup', 'show', 'del'],
  render: ['mats', 'mats2', 'env', 'bg', 'tone', 'expo', 'render', 'frame'],
  ai: ['aiNew', 'aiPhoto', 'aiEx', 'frame', 'undo', 'layers'],
  forge: ['forgeIn', 'forgeOut', 'forgeExport', 'forgeFrame', 'forgeRender'],
};
const PUCK_MODULES = { diag: 'Modelado', render: 'Visu', ai: 'IA', forge: 'Forge' };
// qué comandos caben en el Puck de cada módulo (VISU solo visualización; nada que cambie de módulo sin querer)
const CMD_MODS = {
  diag: ['curve', 'surface', 'edit', 'pick', 'xform', 'dup', 'show', 'del', 'eval', 'undo', 'frame', 'layers', 'modules', 'prefs'],
  render: ['mats', 'mats2', 'env', 'bg', 'tone', 'expo', 'render', 'frame', 'prefs'],
  ai: ['aiNew', 'aiPhoto', 'aiEx', 'undo', 'frame', 'layers', 'prefs'],
  forge: ['forgeIn', 'forgeOut', 'forgeExport', 'forgeFrame', 'forgeRender', 'prefs'],
};
const puckIds = (mod) => (prefs.puck?.[mod] || PUCK_DEFAULT[mod]).filter((id) => PUCK_CMDS[id] && CMD_MODS[mod].includes(id));
// Marking menus (Ctrl+Shift + botón del ratón), con la misma forma pero otra información
const PICK_MM = [
  { k: 'object', label: 'Objeto', key: 'O', run: () => setPickMode('object'), sub: [
    { k: 'pickCurve', label: 'Curvas', run: () => setPickMode('object', 'curve') }, { k: 'pickSurf', label: 'Superficies', run: () => setPickMode('object', 'surface') }] },
  { k: 'cv', label: 'CV', key: 'P', run: () => setPickMode('cv') },
  { k: 'frame', label: 'Encuadrar', key: 'F', run: frameSelection, sub: [{ k: 'frame', label: 'Todo', run: () => frameObjects([]) }, { k: 'top', label: 'Vista sup.', run: topView }] },
  { k: 'hide', label: 'Ocultar', run: hideSelection, sub: [{ k: 'show', label: 'Mostrar todo', run: unhideAll }] },
  { k: 'pivot', label: 'Punto de interés', key: 'L', run: pivotToSelection },
  { k: 'nothing', label: 'Nada', run: pickNothing },
];
const XFORM_MM = [
  { k: 'move', label: 'Mover', key: 'W', run: mv },
  { k: 'rotate', label: 'Rotar', key: 'E', run: rot },
  { k: 'scale', label: 'Escalar', key: 'R', run: scl },
  { k: 'pivot', label: 'Pivote', key: 'D', run: togglePivotEdit, sub: [{ k: 'pivot', label: 'Centrar pivote', run: centerPivots }, { k: 'frame', label: 'Punto de interés', run: pivotToSelection }] },
  { k: 'dup', label: 'Duplicar', run: duplicateSelection },
  { k: 'del', label: 'Borrar', key: 'Supr', run: deleteSelection },
];
const DISPLAY_MM = [
  { k: 'shade', label: 'Modelado', run: () => switchLayout('diag'), sub: [
    { k: 'studio', label: 'Showroom', run: () => setDiag('showroom') }, { k: 'shade', label: 'Difuso', run: () => setDiag('diffuse') },
    { k: 'sun', label: 'Shade-Sky', run: () => setDiag('sky') }, { k: 'zebra', label: 'Cebra', run: () => setDiag('zebra') },
    { k: 'curvz', label: 'Curvatura', run: () => setDiag('curv') }, { k: 'wire', label: 'Malla', run: () => setDiag('wire') }] },
  { k: 'visu', label: 'Visu', run: () => switchLayout('render'), sub: [
    { k: 'studio', label: 'Estudio', run: env('studio') }, { k: 'sun', label: 'Exterior', run: env('sun') },
    { k: 'sunset', label: 'Atardecer', run: env('sunset') }, { k: 'cloud', label: 'Nublado', run: env('overcast') }] },
  { k: 'ai', label: 'IA', run: () => switchLayout('ai') },
  { k: 'object', label: 'Forge', run: () => switchLayout('forge') },
  { k: 'model', label: 'Toggle Model', run: toggleModel },
  { k: 'grid', label: 'Toggle Grid', run: toggleGrid },
  { k: 'ctrlOn', label: 'Controls', run: () => setPickMode(pickMode === 'cv' ? 'object' : 'cv'), sub: [
    { k: 'ctrlOn', label: 'Controls ON', run: () => setPickMode('cv') }, { k: 'ctrlOff', label: 'Controls OFF', run: () => setPickMode('object') }] },
  { k: 'screen', label: 'Pantalla', run: fullscreen, sub: [
    { k: 'full', label: 'Completa', run: fullscreen }, { k: 'panel', label: 'Panel', run: () => setPinned(!pinned) }, { k: 'split', label: 'Dividida', run: () => switchLayout('split') }] },
  { k: 'info', label: 'Información', run: () => $('panel').classList.add('show') },
];

const RADIAL_TILT = 0.6;   // achatamiento vertical del anillo (vista elevada)
function makeRadial(items, { r = 140, title = '' } = {}) {
  const K = RADIAL_TILT, r2 = r + 78, R = r2 + 46;
  const el = document.createElement('div');
  el.className = 'puck'; el.hidden = true; el.dataset.inkTint = '0.5';
  el.innerHTML = `<svg class="puck-lines" viewBox="${-R} ${-R} ${2 * R} ${2 * R}" width="${2 * R}" height="${2 * R}" style="left:${-R}px;top:${-R}px">
      <ellipse rx="${r}" ry="${r * K}" /><ellipse class="outer" rx="${r2}" ry="${r2 * K}" /><line x1="0" y1="0" x2="0" y2="0" /></svg>
    <div class="puck-center"><b></b><span></span></div>`;
  document.body.append(el);
  const line = el.querySelector('line'), cName = el.querySelector('.puck-center b'), cHint = el.querySelector('.puck-center span');
  const mains = [], all = [];
  const button = (it, x, y, depth, cls) => {
    const b = document.createElement('button');
    b.className = 'puck-item ' + cls + (it.soon ? ' soon' : '');
    b.innerHTML = `<i>${icon(it.k)}</i><span>${esc(it.label)}</span>`;
    b.style.left = x + 'px'; b.style.top = y + 'px';
    b.style.zIndex = String((cls === 'sub' ? 120 : 10) + Math.round(depth * 80));
    b.setAttribute('aria-label', it.label);
    el.append(b);
    return b;
  };
  items.forEach((it, n) => {
    const a = -Math.PI / 2 + (n / items.length) * Math.PI * 2, depth = (Math.sin(a) + 1) / 2;
    const x = Math.cos(a) * r, y = Math.sin(a) * r * K;
    const m = { it, a, x, y, base: 0.76 + 0.34 * depth, subs: [] };
    m.b = button(it, x, y, depth, 'main');
    // submenú: esferas pequeñas en un arco hacia fuera, centrado en la dirección de su esfera
    const subs = it.sub || [], step = 44 / r2;
    subs.forEach((sit, j) => {
      const sa = a + (j - (subs.length - 1) / 2) * step, sd = (Math.sin(sa) + 1) / 2;
      const sx = Math.cos(sa) * r2, sy = Math.sin(sa) * r2 * K;
      const sm = { it: sit, a: sa, x: sx, y: sy, base: 0.62 + 0.24 * sd, parent: m, sub: true };
      sm.b = button(sit, sx, sy, sd, 'sub');
      m.subs.push(sm); all.push(sm);
    });
    mains.push(m); all.push(m);
  });
  const st = { el, open: false, at: { x: 0, y: 0 }, hover: null, active: null, sticky: false };
  const magnify = (mx, my) => all.forEach((x) => {
    const d = mx == null ? 1e9 : Math.hypot(x.x - mx, x.y - my);
    const s = x.base * (1 + 0.35 * Math.exp(-(d * d) / (2 * 42 * 42))) * (x === st.hover ? 1.12 : 1);
    x.b.style.setProperty('--s', s.toFixed(3));
  });
  st.highlight = (h) => {
    st.hover = h;
    if (h) st.active = h.sub ? h.parent : h;
    mains.forEach((m) => m.subs.forEach((x) => x.b.classList.toggle('open', m === st.active)));
    all.forEach((x) => { x.b.classList.toggle('on', x === h); x.b.classList.toggle('parent', !!h?.sub && x === h.parent); });
    line.setAttribute('x2', h ? h.x : 0); line.setAttribute('y2', h ? h.y : 0);
    cName.textContent = h ? h.it.label : title;
    cHint.textContent = h ? (h.it.soon ? 'próximamente' : h.it.key || (h.subs?.length ? 'más opciones afuera' : '')) : 'suelta sobre una opción';
  };
  const nearest = (list, ang) => {
    let best = null, bd = 1e9;
    for (const x of list) { const da = Math.abs(Math.atan2(Math.sin(ang - x.a), Math.cos(ang - x.a))); if (da < bd) { bd = da; best = x; } }
    return [best, bd];
  };
  st.pickAt = (x, y) => {
    const dx = x - st.at.x, dy = y - st.at.y, d = Math.hypot(dx, dy / K), ang = Math.atan2(dy / K, dx);
    // menos sensible: solo se marca una esfera si el cursor está realmente cerca de ella (no solo en su dirección)
    const near = (o, lim) => o && Math.hypot(o.x - dx, o.y - dy) < lim;
    if (d < 52) { st.highlight(null); st.active = null; magnify(dx, dy); return; }
    if (d < r + 38 || !st.active?.subs.length) { const m = nearest(mains, ang)[0]; st.highlight(near(m, 66) ? m : null); }
    else {
      const sub = nearest(st.active.subs, ang)[0];
      st.highlight(near(sub, 44) ? sub : near(st.active, 70) ? st.active : null);
    }
    magnify(dx, dy);
  };
  st.show = (x, y) => {
    const m = R * 0.92;
    st.at = { x: Math.min(innerWidth - m, Math.max(m, x)), y: Math.min(innerHeight - m * K - 40, Math.max(m * K + 40, y)) };
    el.style.left = st.at.x + 'px'; el.style.top = st.at.y + 'px';
    el.hidden = false; st.open = true; st.sticky = false; st.active = null; st.highlight(null); magnify(null); st.t0 = performance.now();
  };
  st.close = (run) => {
    if (!st.open) return;
    st.open = false; el.hidden = true;
    const h = st.hover;
    if (run && h) (h.it.soon || !h.it.run ? soon(h.it.label) : h.it.run)();
  };
  all.forEach((x) => {
    x.b.addEventListener('pointerenter', () => st.highlight(x));
    x.b.addEventListener('click', () => { st.highlight(x); st.close(true); });
  });
  return st;
}
let puck = null, puckKey = '';
// el Puck se construye para el módulo actual (y se rehace si cambia el módulo o la personalización)
function getPuck() {
  const mod = layout === 'split' ? 'diag' : layout, ids = puckIds(mod), key = mod + ':' + ids.join(',');
  if (key !== puckKey) {
    puck?.el.remove();
    puck = makeRadial(ids.map((id) => PUCK_CMDS[id]), { r: 150, title: 'Puck · ' + PUCK_MODULES[mod] });
    puckKey = key;
    MENUS[0] = puck;
  }
  return puck;
}
const pickMenu = makeRadial(PICK_MM, { r: 128, title: 'Selección' });
const xformMenu = makeRadial(XFORM_MM, { r: 128, title: 'Transformar' });
const disp = makeRadial(DISPLAY_MM, { r: 140, title: 'Visualización' });
// En VISU los menús solo llevan cosas de visualización (nada de modelado ni de IA, que cambiarían de módulo)
const VISU_MM = ['mats', 'mats2', 'env', 'bg', 'tone', 'expo', 'frame'].map((id) => PUCK_CMDS[id])
  .concat([{ k: 'screen', label: 'Pantalla', run: fullscreen, sub: [{ k: 'full', label: 'Completa', run: fullscreen }, { k: 'panel', label: 'Panel', run: () => setPinned(!pinned) }] }]);
const dispVisu = makeRadial(VISU_MM, { r: 140, title: 'Visu' });
const MENUS = [null, pickMenu, xformMenu, disp, dispVisu];
const menuFor = (button) => (layout === 'render' ? dispVisu : [pickMenu, xformMenu, disp][button] || disp);
getPuck();
let lastPtr = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  lastPtr = { x: e.clientX, y: e.clientY };
  for (const m of MENUS) if (m.open) m.pickAt(e.clientX, e.clientY);
});
addEventListener('pointerdown', (e) => {
  for (const m of MENUS) if (m.open && m.sticky && !e.target.closest('.puck, .mmenu')) m.close(false);
}, true);
// Tab = Puck. Mantener y soltar sobre la opción; una pulsación corta lo deja abierto para hacer clic.
function bindKey(code, getMenu) {
  let m = null;
  addEventListener('keydown', (e) => {
    if (e.code !== code || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.closest?.('dialog')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (m?.open && m.sticky) return m.close(false);
    m = getMenu();
    m.show(lastPtr.x, lastPtr.y); m.t0 = performance.now();
  }, true);
  addEventListener('keyup', (e) => {
    if (!m) return;
    if (e.code !== code || !m.open || m.sticky) return;
    e.preventDefault();
    if (m.hover) m.close(true);
    else if (performance.now() - m.t0 < 400) m.sticky = true;
    else m.close(false);
  }, true);
}
bindKey('Tab', getPuck);
bindKey('Space', () => menuFor(2));
addEventListener('keydown', (e) => { if (e.key === 'Escape') MENUS.forEach((m) => m.close(false)); }, true);
let mouseMenu = null;
addEventListener('pointerdown', (e) => {
  if (!(e.ctrlKey && e.shiftKey) || e.target !== renderer.domElement || carousel) return;
  e.stopImmediatePropagation(); e.preventDefault();
  MENUS.forEach((m) => m.close(false));
  mouseMenu = menuFor(e.button);
  mouseMenu.show(e.clientX, e.clientY);
}, true);
addEventListener('pointerup', (e) => {
  const m = mouseMenu;
  if (!m) return;
  mouseMenu = null; e.stopImmediatePropagation();
  if (m.hover) m.close(true);
  else if (performance.now() - m.t0 < 350) m.sticky = true;      // clic rápido: queda abierto
  else m.close(false);
}, true);

// ---------- Capas y grupos ----------
// Cada objeto vive en una capa (se puede ocultar entera) y puede estar en un grupo (carpeta en la escena).
// Elegir un objeto agrupado elige el grupo entero, como un nodo de grupo de Alias.
const layerOn = (id) => layers.find((l) => l.id === id)?.visible !== false;
function initObj(obj) {
  obj.layer = activeLayer; obj.group = null;
  let own = obj.visible !== false;
  // visible = el objeto no está oculto Y su capa está encendida; ownVisible = solo el ojo del objeto
  Object.defineProperty(obj, 'visible', { get: () => own && layerOn(obj.layer), set: (v) => { own = !!v; }, enumerable: true, configurable: true });
  Object.defineProperty(obj, 'ownVisible', { get: () => own });
}
function expandGroups(items) {
  if (pickMode !== 'object') return items;
  const out = [];
  for (const it of items) {
    if (!it.key && it.group) objects.filter((o) => o.group === it.group && o.visible).forEach((o) => out.includes(o) || out.push(o));
    else if (!out.includes(it)) out.push(it);
  }
  return out;
}
function groupSelection() {
  const sel = selObjs.slice();
  if (sel.length < 2) return toast('Agrupar: elige 2 o más objetos (modo Objetos).');
  checkpoint();
  const g = { id: nextGroupId++, name: `Grupo ${groups.length + 1}`, open: true };
  groups.push(g);
  sel.forEach((o) => (o.group = g.id));
  pruneGroups(); refreshOutliner();
  toast(`${g.name}: ${sel.length} objetos (Ctrl+Shift+G para desagrupar)`);
}
function ungroupSelection() {
  const ids = new Set(selObjs.map((o) => o.group).filter(Boolean));
  if (!ids.size) return toast('Desagrupar: elige un grupo.');
  checkpoint();
  objects.forEach((o) => { if (ids.has(o.group)) o.group = null; });
  pruneGroups(); refreshOutliner(); toast('Desagrupado');
}
function pruneGroups() {
  for (let i = groups.length - 1; i >= 0; i--) if (!objects.some((o) => o.group === groups[i].id)) groups.splice(i, 1);
}
function newLayer() {
  checkpoint();
  const l = { id: nextLayerId++, name: `Capa ${layers.length}`, visible: true };
  layers.push(l); activeLayer = l.id;
  renderLayers(); toast(`${l.name} creada: lo nuevo irá a esta capa`);
}
function assignToLayer(id = activeLayer) {
  if (!selObjs.length) return toast('Elige objetos para pasarlos a la capa.');
  moveToLayer(selObjs.slice(), id);
}
function setLayerVisible(l, v) {
  checkpoint();
  l.visible = v;
  for (let i = selObjs.length - 1; i >= 0; i--) if (!selObjs[i].visible) selObjs.splice(i, 1);
  selectionChanged(); renderLayers();
}
function renderLayers() { refreshOutliner(); }

// ---------- Deshacer / rehacer ----------
// Antes de cada cambio se guarda una copia de la escena (como mucho una por tarea del navegador, así un
// arrastre o una operación que crea varios objetos cuentan como un solo paso). Ctrl+Z o Ctrl+X deshacen.
const undoStack = [], redoStack = [];
let restoring = false, cpArmed = false;
function cloneData(o) {
  const d = o.data ?? o;
  if (o.kind === 'mesh') return { geometry: d.geometry.clone() };
  if (o.kind === 'surface') return { degU: d.degU, degV: d.degV, knotsU: d.knotsU.slice(), knotsV: d.knotsV.slice(), cvs: d.cvs.map((r) => r.map(cloneV4)) };
  const c = { deg: d.deg, knots: d.knots.slice(), plane: d.plane, cvs: d.cvs.map(cloneV4) };
  if (d.cos) c.cos = { ...d.cos, uv: d.cos.uv.map((q) => q.slice()) };
  return c;
}
function snapshot() {
  return {
    layers: layers.map((l) => ({ ...l })), activeLayer, nextLayerId, groups: groups.map((g) => ({ ...g })), nextGroupId,
    relations: relations.map((r) => ({ ...r })), nextRelId,
    objects: objects.map((o) => ({ id: o.id, kind: o.kind, name: o.name, mat: o.mat, own: o.ownVisible, layer: o.layer, group: o.group, pivot: o.pivot.clone(), data: cloneData(o) })),
  };
}
function checkpoint() {
  if (restoring || cpArmed) return;
  cpArmed = true; setTimeout(() => { cpArmed = false; }, 0);
  undoStack.push(snapshot());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}
function clearHistory() { undoStack.length = 0; redoStack.length = 0; }
function restore(st) {
  restoring = true;
  selObjs.length = 0; selCVs.clear();
  objects.slice().forEach(removeObject);
  layers.splice(0, layers.length, ...st.layers.map((l) => ({ ...l })));
  groups.splice(0, groups.length, ...st.groups.map((g) => ({ ...g })));
  nextLayerId = st.nextLayerId; nextGroupId = st.nextGroupId;
  relations.splice(0, relations.length, ...(st.relations || []).map((r) => ({ ...r }))); nextRelId = st.nextRelId || nextRelId;
  const act = st.activeLayer;
  for (const it of st.objects) {
    nextId = it.id; activeLayer = it.layer;
    const d = cloneData({ kind: it.kind, data: it.data });
    const o = it.kind === 'surface' ? addSurface(d, it.name) : it.kind === 'curve' ? addCurve(d, it.name) : addMesh(d.geometry, it.name);
    o.name = it.name; o.mat = it.mat; o.visible = it.own; o.group = it.group; o.pivot.copy(it.pivot);
  }
  activeLayer = act;
  nextId = Math.max(1, ...objects.map((o) => o.id + 1));
  restoring = false;
  // las curvas sobre superficie se crean después de su superficie: se recortan ahora
  objects.filter((o) => o.kind === 'curve' && o.data.cos).forEach(updateObject);
  objects.forEach(applyVisibility);
  selectionChanged(); refreshOutliner(); renderLayers(); renderHistory();
}
function undo() {
  if (!undoStack.length) return toast('Nada que deshacer');
  redoStack.push(snapshot()); restore(undoStack.pop()); toast('Deshacer');
}
function redo() {
  if (!redoStack.length) return toast('Nada que rehacer');
  undoStack.push(snapshot()); restore(redoStack.pop()); toast('Rehacer');
}
addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if ((k === 'z' || k === 'x') && !e.shiftKey) { e.preventDefault(); undo(); }
  else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  else if (k === 'g') { e.preventDefault(); e.shiftKey ? ungroupSelection() : groupSelection(); }
});

// ---------- Modos de evaluación (antes en la barra de arriba): 3 formas de ponerlos en los menús laterales ----------
// A = esferas en la barra izquierda · B = sección con miniaturas en el panel derecho · C = una esfera que se despliega
const evalThumbs = {};
function buildEvalUI() {
  const ph = (m) => `<span class="ev-ph" data-thumb="${m.k}"></span>`;
  $('eval-a').innerHTML = EVAL_MODES.map((m) => `<button class="ev-ball" data-diag="${m.k}" title="${m.label} (${m.key})">${ph(m)}</button>`).join('');
  $('eval-b').innerHTML = EVAL_MODES.map((m) => `<button class="ev-tile" data-diag="${m.k}">${ph(m)}<b>${m.label}</b><kbd>${m.key}</kbd></button>`).join('');
  $('eval-c-fly').innerHTML = EVAL_MODES.map((m) => `<button class="ev-row" data-diag="${m.k}">${ph(m)}<b>${m.label}</b><kbd>${m.key}</kbd></button>`).join('');
  $('eval-c-btn').innerHTML = `<span class="ev-ph" data-thumb="current"></span>`;
  document.querySelectorAll('#eval-a [data-diag], #eval-b [data-diag], #eval-c-fly [data-diag]').forEach((b) => b.addEventListener('click', () => setDiag(b.dataset.diag)));
  // miniaturas: una esfera con cada shader, renderizada una vez en un lienzo aparte
  requestAnimationFrame(() => {
    const tr = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    tr.setClearColor(0x000000, 0); tr.setSize(96, 96); tr.toneMapping = THREE.ACESFilmicToneMapping;
    const ts = new THREE.Scene();
    ts.environment = new THREE.PMREMGenerator(tr).fromScene(new RoomEnvironment(tr), 0.04).texture;
    const tc = new THREE.PerspectiveCamera(30, 1, 0.1, 10); tc.position.set(0, 0.3, 3.9); tc.lookAt(0, 0, 0);
    const geo = new THREE.SphereGeometry(1, 64, 48), col = [];
    for (let i = 0; i < geo.attributes.position.count; i++) {
      const y = geo.attributes.position.getY(i), c = new THREE.Color().setHSL(0.66 - 0.66 * (y * 0.5 + 0.5), 0.75, 0.5);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const ball = new THREE.Mesh(geo); ts.add(ball);
    const wire = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), wireMat);
    for (const m of EVAL_MODES) {
      const mats = { showroom: envDiagMat, clay: envDiagMat, diffuse: envDiagMat, sky: envDiagMat, zebra: zebraMat, curv: curvMat };
      ts.remove(ball, wire);
      if (m.k === 'wire') ts.add(wire); else { ball.material = mats[m.k]; ts.add(ball); }
      const keep = envDiagMat.uniforms.uMode.value;
      if (ENV_MODES[m.k]) envDiagMat.uniforms.uMode.value = ENV_MODES[m.k];
      tr.render(ts, tc);
      envDiagMat.uniforms.uMode.value = keep;
      evalThumbs[m.k] = tr.domElement.toDataURL();
    }
    tr.dispose(); tr.forceContextLoss();
    updateEvalUI();
  });
}
function updateEvalUI() {
  const app = $('app');
  if (!app || !$('eval-a')) return;
  app.dataset.evalui = prefs.evalUI;
  document.querySelectorAll('[data-thumb]').forEach((el) => {
    const k = el.dataset.thumb === 'current' ? diagMode : el.dataset.thumb;
    if (evalThumbs[k]) el.style.backgroundImage = `url(${evalThumbs[k]})`;
  });
  const cur = EVAL_MODES.find((m) => m.k === diagMode);
  $('eval-c-btn').title = `Evaluación: ${cur?.label} (pasa el ratón para cambiar)`;
  if ($('pane-mode')) $('pane-mode').textContent = cur ? '· ' + cur.label.toUpperCase() : '';
}

// ---------- Barra de menús (como la de Alias) ----------
const chk = (f) => ({ check: f });
const MENUBAR = [
  ['Archivo', [
    { label: 'Abrir…', key: 'Ctrl+O', run: () => $('io-file').click() }, { label: 'Guardar proyecto', key: 'Ctrl+S', run: () => doExport('forja') },
    { sep: true }, { label: 'Importar y exportar…', key: 'Ctrl+E', run: () => toggleFilePanel() }]],
  ['Editar', [
    { label: 'Deshacer', key: 'Ctrl+Z · Ctrl+X', run: undo }, { label: 'Rehacer', key: 'Ctrl+Y', run: redo }, { sep: true },
    { label: 'Duplicar', run: duplicateSelection }, { label: 'Agrupar', key: 'Ctrl+G', run: groupSelection }, { label: 'Desagrupar', key: 'Ctrl+Shift+G', run: ungroupSelection },
    { sep: true }, { title: 'Elegir' },
    { label: 'Objetos', key: 'O', run: () => setPickMode('object'), ...chk(() => pickMode === 'object' && !pickFilter) },
    { label: 'Solo curvas', run: () => setPickMode('object', 'curve'), ...chk(() => pickFilter === 'curve') },
    { label: 'Solo superficies', run: () => setPickMode('object', 'surface'), ...chk(() => pickFilter === 'surface') },
    { label: 'CVs', key: 'P', run: () => setPickMode('cv'), ...chk(() => pickMode === 'cv') },
    { label: 'Nada', run: pickNothing }, { sep: true }, { title: 'Snap fijo' },
    { label: 'Rejilla', key: 'Alt', run: () => $('snap-grid').click(), ...chk(() => snapToggles.grid) },
    { label: 'Curva', key: 'Ctrl+Alt', run: () => $('snap-curve').click(), ...chk(() => snapToggles.curve) },
    { label: 'Punto', key: 'Ctrl', run: () => $('snap-point').click(), ...chk(() => snapToggles.point) }]],
  ['Curvas', [
    { label: 'Curva', key: 'C', run: () => setTool('curve') }, { label: 'Círculo', run: () => setTool('circle') },
    { sep: true }, { label: 'Proyectar en superficie', run: projectSelection }]],
  ['Superficies', [
    { label: 'Plano', run: () => setTool('plane') }, { label: 'Revolución', run: () => OPS.revolve() }, { label: 'Loft', run: () => OPS.loft() },
    { label: 'Extruir', run: () => OPS.extrude() }, { sep: true }, { title: 'Con historial' },
    { label: 'Align (G0 · G1 · G2 · G3)', run: () => startEdgeOp('align') }, { label: 'Freeform Blend (bordes y curvas)', run: () => startEdgeOp('blend') },
    { label: 'Skin (entre curvas)', run: () => startEdgeOp('skin') }, { label: 'Extender', run: () => startEdgeOp('extend') },
    { label: 'Offset', run: offsetSelection }, { label: 'Simetría (plano YZ)', run: mirrorSelection },
    { sep: true }, { title: 'Sólidos (como Plasticity)' }, { label: 'Redondear / chaflán aristas', key: 'B', run: () => startFillet() },
    { sep: true }, { title: 'Curvas sobre superficie' },
    { label: 'Proyectar curva en superficie', run: projectSelection },
    { sep: true }, { label: 'Quitar historial de la selección', run: () => { const ids = new Set(selObjs.map((o) => o.id)); relations.filter((r) => ids.has(outputOf(r))).forEach((r) => removeRelation(r.id)); } }]],
  ['Borrar', [
    { label: 'Borrar selección', key: 'Supr', run: deleteSelection },
    { label: 'Borrar todas las curvas', run: () => { selObjs.splice(0, selObjs.length, ...objects.filter((o) => o.kind === 'curve')); deleteSelection(); } },
    { label: 'Borrar todo', run: () => { if (confirm('¿Borrar toda la escena? (se puede deshacer con Ctrl+Z)')) { setPickMode('object'); selObjs.splice(0, selObjs.length, ...objects); deleteSelection(); } } }]],
  ['Vistas', [
    { label: 'Encuadrar selección', key: 'F', run: frameSelection }, { label: 'Encuadrar todo', run: () => frameObjects([]) }, { label: 'Vista superior', key: 'T', run: topView },
    { label: 'Ortogonal (fija)', key: 'Shift+O', run: () => toggleOrtho(), ...chk(() => proj.keep) },
    { sep: true }, { label: 'Modelado', run: () => switchLayout('diag'), ...chk(() => layout === 'diag') },
    { label: 'Visu', run: () => switchLayout('render'), ...chk(() => layout === 'render') }, { label: 'IA', run: () => switchLayout('ai'), ...chk(() => layout === 'ai') },
    { label: 'Forge', run: () => switchLayout('forge'), ...chk(() => layout === 'forge') },
    { label: 'Dividida', run: () => switchLayout('split'), ...chk(() => layout === 'split') }, { label: 'Elegir módulo', key: 'mantener V', run: () => toast('Mantén V y haz clic en un módulo') }]],
  ['Mostrar', [
    { label: 'Toggle Model', run: toggleModel, ...chk(() => modelClean) }, { label: 'Rejilla', run: toggleGrid, ...chk(() => grid.visible) },
    { label: 'Líneas de parche', run: () => $('show-iso').click(), ...chk(() => $('show-iso').checked) },
    { label: 'Peine de curvatura', run: () => $('show-comb').click(), ...chk(() => $('show-comb').checked) },
    { sep: true }, { label: 'Ocultar selección', run: hideSelection }, { label: 'Mostrar todo', run: unhideAll }]],
  ['Capas', [
    { label: 'Nueva capa', run: newLayer }, { label: 'Pasar selección a la capa activa', run: () => assignToLayer() },
    { label: 'Mostrar todas las capas', run: () => { checkpoint(); layers.forEach((l) => (l.visible = true)); selectionChanged(); renderLayers(); } },
    { sep: true }, { label: 'Ventana de capas', run: () => (prefs.layersWin?.open === false ? layersWin.show() : layersWin.set({ open: false })), ...chk(() => prefs.layersWin?.open !== false) }]],
  ['Visualización', [
    ...EVAL_MODES.map((m) => ({ label: m.label, key: m.key, run: () => setDiag(m.k), ...chk(() => layout !== 'render' && diagMode === m.k) })),
    { sep: true }, { title: 'Entorno (Visu)' },
    ...[['studio', 'Estudio'], ['sun', 'Exterior'], ['sunset', 'Atardecer'], ['overcast', 'Nublado']].map(([k, l]) => ({ label: l, run: env(k), ...chk(() => envKey === k) }))]],
  ['Animación', [{ label: 'Plato giratorio', soon: true }, { label: 'Línea de tiempo', soon: true }]],
  ['Ventanas', [
    { label: 'Panel lateral fijo', run: () => setPinned(!pinned), ...chk(() => pinned) }, { label: 'Pantalla completa', run: fullscreen },
    { label: 'Capas', run: () => (prefs.layersWin?.open === false ? layersWin.show() : layersWin.set({ open: false })), ...chk(() => prefs.layersWin?.open !== false) },
    { label: 'Puck', key: 'Tab', run: () => getPuck().show(innerWidth / 2, innerHeight / 2) }]],
  ['Preferencias', [{ label: 'Preferencias…', run: () => openPrefs() }, { label: 'Personalizar el Puck…', run: () => openPrefs('puck') }]],
  ['Utilidades', [
    { label: 'Centrar pivote', run: centerPivots }, { label: 'Punto de interés a la selección', key: 'L', run: pivotToSelection },
    { label: 'Medir distancia', soon: true }]],
  ['Ayuda', [{ label: 'Atajos de teclado', run: () => openPrefs('help') }, { label: 'Ejemplo: Freeform Blend (manija)', run: () => blendDemo() }, { label: 'Acerca de Forja', run: () => toast('FORJA · modelador NURBS libre (Alias + Plasticity + Blender)') }]],
];
function buildMenubar() {
  const bar = $('menubar');
  let openBtn = null;
  const drop = document.createElement('div');
  drop.className = 'mb-drop'; drop.hidden = true;
  document.body.append(drop);
  const close = () => { drop.hidden = true; openBtn?.setAttribute('aria-expanded', 'false'); openBtn = null; };
  const open = (btn, items) => {
    openBtn?.setAttribute('aria-expanded', 'false');
    openBtn = btn; btn.setAttribute('aria-expanded', 'true');
    drop.innerHTML = '';
    for (const it of items) {
      if (it.sep) { drop.append(document.createElement('hr')); continue; }
      if (it.title) { const t = document.createElement('div'); t.className = 'mb-title'; t.textContent = it.title; drop.append(t); continue; }
      const b = document.createElement('button');
      b.className = 'mb-item' + (it.soon ? ' soon' : '');
      const on = it.check?.();
      b.innerHTML = `<span class="mb-chk">${on ? '✓' : ''}</span><span>${esc(it.label)}</span><kbd>${it.soon ? 'pronto' : esc(it.key || '')}</kbd>`;
      b.addEventListener('click', () => { close(); it.soon ? soon(it.label) : it.run(); });
      drop.append(b);
    }
    const r = btn.getBoundingClientRect();
    drop.style.left = Math.min(r.left, innerWidth - 260) + 'px'; drop.style.top = r.bottom + 6 + 'px';
    drop.hidden = false;
  };
  for (const [name, items] of MENUBAR) {
    const b = document.createElement('button');
    b.className = 'mb-btn'; b.textContent = name; b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => (openBtn === b ? close() : open(b, items)));
    b.addEventListener('pointerenter', () => { if (openBtn && openBtn !== b) open(b, items); });
    bar.append(b);
  }
  addEventListener('pointerdown', (e) => { if (openBtn && !e.target.closest('.mb-drop, .mb-btn')) close(); }, true);
  addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}

// ---------- Ventana de preferencias ----------
function openPrefs(tab = 'ui') {
  const d = $('prefs');
  d.querySelectorAll('[data-ptab]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ptab === tab)));
  d.querySelectorAll('[data-ppage]').forEach((p) => (p.hidden = p.dataset.ppage !== tab));
  d.querySelectorAll('[name="pref-eval"]').forEach((r) => (r.checked = r.value === prefs.evalUI));
  $('pref-xform').value = prefs.xform;
  if (tab === 'puck') { $('pk-mod').value = layout === 'split' ? 'diag' : layout; renderPuckEditor(); }
  d.querySelectorAll('[data-pref-snap]').forEach((c) => (c.checked = !!snapToggles[c.dataset.prefSnap]));
  if (!d.open) d.showModal();
}
// Editor del Puck: lista de esferas del módulo elegido, con subir / bajar / quitar y añadir de la biblioteca
function renderPuckEditor() {
  const mod = $('pk-mod').value, ids = puckIds(mod).slice();
  const save = (next) => { prefs.puck = { ...(prefs.puck || {}), [mod]: next }; savePrefs(); renderPuckEditor(); };
  $('pk-list').innerHTML = ids.map((id, i) => {
    const c = PUCK_CMDS[id];
    return `<li><i>${icon(c.k)}</i><span>${esc(c.label)}${c.sub ? `<small>${c.sub.length} en submenú</small>` : ''}${c.soon ? '<small>próximamente</small>' : ''}</span>
      <span class="pk-btns"><button data-up="${i}" title="Subir" aria-label="Subir">↑</button><button data-down="${i}" title="Bajar" aria-label="Bajar">↓</button><button data-del="${i}" title="Quitar" aria-label="Quitar">×</button></span></li>`;
  }).join('');
  $('pk-list').querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.up; if (i > 0) { [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; save(ids); } }));
  $('pk-list').querySelectorAll('[data-down]').forEach((b) => b.addEventListener('click', () => { const i = +b.dataset.down; if (i < ids.length - 1) { [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; save(ids); } }));
  $('pk-list').querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { if (ids.length > 1) { ids.splice(+b.dataset.del, 1); save(ids); } }));
  const rest = CMD_MODS[mod].filter((id) => PUCK_CMDS[id] && !ids.includes(id));
  $('pk-add').innerHTML = rest.map((id) => `<option value="${id}">${esc(PUCK_CMDS[id].label)}</option>`).join('');
  $('pk-add-btn').disabled = !rest.length || ids.length >= 10;
  $('pk-add-btn').onclick = () => { if ($('pk-add').value && ids.length < 10) save([...ids, $('pk-add').value]); };
  $('pk-reset').onclick = () => { const p2 = { ...(prefs.puck || {}) }; delete p2[mod]; prefs.puck = p2; savePrefs(); renderPuckEditor(); };
}
function initPrefs() {
  const d = $('prefs');
  // lo que antes estaba en la cabecera o en el panel pasa aquí
  $('pref-theme').append(document.querySelector('.seg.theme'));
  const nav = $('nav-help')?.closest('section');
  if (nav) { [...nav.children].filter((c) => c.tagName !== 'H2').forEach((c) => $('pref-nav').append(c)); nav.remove(); }
  d.querySelectorAll('[data-ptab]').forEach((b) => b.addEventListener('click', () => openPrefs(b.dataset.ptab)));
  d.querySelectorAll('[name="pref-eval"]').forEach((r) => r.addEventListener('change', () => { prefs.evalUI = r.value; savePrefs(); updateEvalUI(); }));
  $('pref-xform').addEventListener('change', (e) => { prefs.xform = e.target.value; savePrefs(); attachGizmo(); });
  $('pref-histlive').checked = prefs.histLive !== false;
  $('pref-histlive').addEventListener('change', (e) => { prefs.histLive = e.target.checked; savePrefs(); });
  $('pk-mod').addEventListener('change', renderPuckEditor);
  // Snap: rejilla, divisiones de curva, centro y snap fijo
  $('pref-grid').value = String(gridStep);
  $('pref-grid').addEventListener('change', (e) => { gridStep = +e.target.value; $('grid-step').value = e.target.value; });
  $('pref-div').value = prefs.snapDiv || 0;
  $('pref-div').addEventListener('change', (e) => { prefs.snapDiv = Math.max(0, Math.min(100, Math.round(+e.target.value || 0))); e.target.value = prefs.snapDiv; savePrefs(); });
  $('pref-center').checked = !!prefs.snapCenter;
  $('pref-center').addEventListener('change', (e) => { prefs.snapCenter = e.target.checked; savePrefs(); });
  d.querySelectorAll('[data-pref-snap]').forEach((c) => c.addEventListener('change', () => { if (snapToggles[c.dataset.prefSnap] !== c.checked) $('snap-' + c.dataset.prefSnap).click(); }));
  $('prefs-close').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
$('ly-new').addEventListener('click', (e) => { e.preventDefault(); newLayer(); });
// Ventana flotante de capas: se arrastra por la cabecera, se pliega o se cierra; recuerda su sitio
const layersWin = {
  el: $('layers-win'),
  apply() {
    const w = prefs.layersWin || {}, el = this.el;
    el.hidden = w.open === false;
    el.classList.toggle('folded', !!w.folded);
    $('ly-fold').setAttribute('aria-expanded', String(!w.folded));
    const x = w.x ?? innerWidth - 270 - 330, y = w.y ?? 84;
    el.style.left = Math.max(8, Math.min(innerWidth - 120, x)) + 'px';
    el.style.top = Math.max(8, Math.min(innerHeight - 60, y)) + 'px';
  },
  set(patch) { prefs.layersWin = { ...(prefs.layersWin || {}), ...patch }; savePrefs(); this.apply(); },
  show() { this.set({ open: true, folded: false }); },
};
{
  const head = $('layers-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = layersWin.el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    layersWin.el.style.left = e.clientX - drag.dx + 'px'; layersWin.el.style.top = e.clientY - drag.dy + 'px';
  });
  head.addEventListener('pointerup', () => {
    if (!drag) return;
    drag = null;
    const r = layersWin.el.getBoundingClientRect();
    layersWin.set({ x: Math.round(r.left), y: Math.round(r.top) });
  });
  $('ly-fold').addEventListener('click', () => layersWin.set({ folded: !prefs.layersWin?.folded }));
  $('ly-close').addEventListener('click', () => layersWin.set({ open: false }));
  addEventListener('resize', () => layersWin.apply());
  layersWin.apply();
}
// opción C: la esfera del modo actual despliega las demás al pasar el ratón
{
  const btn = $('eval-c-btn'), fly = $('eval-c-fly');
  let t = 0;
  const show = () => { clearTimeout(t); const r = btn.getBoundingClientRect(); fly.style.left = r.right + 10 + 'px'; fly.style.top = Math.min(innerHeight - 290, r.top - 100) + 'px'; fly.classList.add('show'); };
  const hide = () => { t = setTimeout(() => fly.classList.remove('show'), 220); };
  [btn, fly].forEach((el) => { el.addEventListener('pointerenter', show); el.addEventListener('pointerleave', hide); });
  btn.addEventListener('click', show);
  fly.addEventListener('click', () => fly.classList.remove('show'));
}
buildMenubar();
initPrefs();
buildEvalUI();
renderLayers();
updateEvalUI();

// ---------- Historial de construcción y herramientas de superficies ----------
// Relaciones entre objetos (src/history.js). Cuando cambia una entrada (p. ej. se mueve un CV de la superficie
// maestra o de la curva extruida) se recalcula la salida, y en cadena lo que dependa de ella.
function byId(id) { return objects.find((o) => o.id === id); }
const inputsOf = (r) => (r.type === 'align' ? [r.master] : r.type === 'blend' || r.type === 'skin' ? [...(r.aIds || [r.a]), ...(r.bIds || [r.b])]
  : r.type === 'loft' ? r.srcs : r.type === 'project' ? [r.src, r.surf] : [r.src]);
const outputOf = (r) => (r.type === 'align' ? r.slave : r.out);
const REL_NAMES = { align: 'Align', blend: 'Freeform Blend', skin: 'Skin', offset: 'Offset', mirror: 'Simetría', extrude: 'Extruir', revolve: 'Revolución', loft: 'Loft',
  project: 'Proyectar', extend: 'Extender' };
// Lado de un Blend / Skin: borde de superficie, curva sobre superficie o una o varias curvas libres encadenadas
function sideOf(ids, edge) {
  const objs = ids.map(byId);
  if (objs.some((o) => !o)) throw new Error('falta un objeto de entrada');
  const o = objs[0];
  if (o.kind === 'surface') return { kind: 'edge', data: o.data, edge };
  const host = objs.length === 1 && o.data.cos && byId(o.data.cos.surf);
  if (host) {
    const c = o.data.cos;
    return { kind: 'cos', data: host.data, uv: c.uv, closed: c.closed, loop: FF.trimLoop(c), toward: c.trim && c.trim !== 'none' ? c.trim : null };
  }
  return { kind: 'curves', curves: objs.map((x) => x.data) };
}
const blendSides = (r) => [sideOf(r.aIds || [r.a], r.aEdge), sideOf(r.bIds || [r.b], r.bEdge)];
// con dos bordes completos y flujo isoparamétrico se usa el Blend exacto de CVs (history.js); si no, el Freeform por estaciones
const exactBlend = (r) => r.type === 'blend' && byId(r.a)?.kind === 'surface' && byId(r.b)?.kind === 'surface'
  && !r.explicit && !r.modRange && !r.crown && (r.flowInt ?? 'iso') === 'iso';
function blendRelData(r) {
  if (exactBlend(r)) {
    if (r.lockShape) r.tensionB = r.tensionA ?? r.tension;
    r.info = { exact: true };
    return HX.blendData(r, byId(r.a).data, byId(r.b).data);
  }
  const [A, B] = blendSides(r);
  return FF.freeformBlend(r, A, B);
}
// Curva sobre superficie a partir de una curva y una superficie (con su recorte)
function projData(r, c, srf) {
  const pr = FF.projectCurve(c.data, srf.data, r.mode === 'normal' ? 'normal' : 'dir', r.dir);
  const d = FF.cosCurveData(srf.data, pr.uv);
  d.cos = { surf: srf.id, uv: pr.uv, closed: pr.closed, trim: r.trim || 'none' };
  return d;
}
function relationData(r, ins, out) {
  if (r.type === 'align') return HX.align(r, ins[0].data, out.data);
  if (r.type === 'blend' || r.type === 'skin') return blendRelData(r);
  if (r.type === 'project') return projData(r, ins[0], ins[1]);
  if (r.type === 'extend') return FF.extendData(ins[0].data, r.edge, r.dist, r.cont);
  if (r.type === 'offset') return HX.offsetData(ins[0].data, r.dist);
  if (r.type === 'mirror') return HX.mirrorData(ins[0].data, ins[0].kind, r.plane || 'x');
  if (r.type === 'extrude') return HX.extrudeData(ins[0].data, r.dist, r.dir, r.both);
  if (r.type === 'revolve') return N.revolve(ins[0].data);
  return N.loft(ins.map((c) => c.data));
}
function applyRelation(r) {
  const out = byId(outputOf(r)), ins = inputsOf(r).map(byId);
  if (!out || ins.some((o) => !o)) return false;
  try { out.data = relationData(r, ins, out); }
  catch (e) { console.warn(e); toast(`${REL_NAMES[r.type]}: no se pudo recalcular (${e.message})`); return false; }
  const was = propagating;
  propagating = true; updateObject(out); propagating = was;
  if (r === arrowsFor && !arrowDrag) updateRelArrows();
  return true;
}
function propagateFrom(obj) {
  propagating = true;
  const done = new Set(), queue = [obj.id];
  try {
    while (queue.length) {
      const id = queue.shift();
      for (const r of relations) {
        if (done.has(r.id)) continue;
        // un Align también se reaplica si se toca la superficie que se ajusta: sus filas del borde quedan atadas a la maestra
        const hit = inputsOf(r).includes(id) || (r.type === 'align' && r.slave === id && id === obj.id);
        if (!hit) continue;
        done.add(r.id);
        if (applyRelation(r)) queue.push(outputOf(r));
      }
    }
  } finally { propagating = false; }
  scheduleHistoryDiag();
}
function dropRelations(id) {
  for (let i = relations.length - 1; i >= 0; i--) if (outputOf(relations[i]) === id || inputsOf(relations[i]).includes(id)) relations.splice(i, 1);
  renderHistory();
}
function removeRelation(id) {
  checkpoint();
  const i = relations.findIndex((r) => r.id === id);
  if (i >= 0) relations.splice(i, 1);
  renderHistory(); TW.hide();
  toast('Historial quitado: la superficie queda como está');
}
function addRelation(r) { r.id = nextRelId++; relations.push(r); renderHistory(); return r; }
// valores que usa cada herramienta la próxima vez (se recuerdan)
const toolDef = Object.assign({ alignCont: 2, alignTension: 1, blendA: 2, blendB: 2, blendTension: 1, extDir: 'auto', extBoth: false, offsetDist: 0.2, mirrorPlane: 'x' }, prefs.tools || {});
const saveToolDef = () => { prefs.tools = toolDef; savePrefs(); };

// --- Ventana de opciones de la herramienta: un desenfoque de lo que hay detrás, sin marco, con los ajustes encima ---
const TW = {
  spec: null,
  show(spec) { this.spec = spec; this.render(); $('toolwin').hidden = false; updateRelArrows(); },
  hide() { this.spec = null; $('toolwin').hidden = true; updateRelArrows(); },
  render() {
    const sp = this.spec;
    if (!sp) return;
    $('tw-title').textContent = sp.title;
    const body = $('tw-body');
    body.innerHTML = '';
    if (sp.hint) { const h = document.createElement('p'); h.className = 'tw-hint'; h.textContent = sp.hint(); body.append(h); }
    const add = (f) => {
      if (f.show && !f.show()) return;
      const row = document.createElement('div');
      row.className = 'tw-row';
      if (f.type === 'group') {
        // sección plegable (como Flow Control / Surface Structure / Control Options de Alias)
        const open = !!(toolDef.twOpen || {})[f.key];
        row.className = 'tw-group';
        row.innerHTML = `<button aria-expanded="${open}">${open ? '▾' : '▸'} ${esc(f.label)}</button>`;
        row.querySelector('button').addEventListener('click', () => { toolDef.twOpen = { ...(toolDef.twOpen || {}), [f.key]: !open }; saveToolDef(); this.render(); });
        body.append(row);
        if (open) f.fields.forEach(add);
        return;
      }
      if (f.type === 'seg') {
        row.innerHTML = `<label>${esc(f.label)}</label><div class="tw-seg">${f.opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(f.get() === v)}">${esc(l)}</button>`).join('')}</div>`;
        row.querySelectorAll('button').forEach((bt) => bt.addEventListener('click', () => {
          const v = f.opts.find(([x]) => String(x) === bt.dataset.v)[0];
          f.set(v); this.render();
        }));
      } else if (f.type === 'range') {
        row.innerHTML = `<label>${esc(f.label)}</label><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.get()}"><output>${f.fmt(f.get())}</output>`;
        const inp = row.querySelector('input'), out = row.querySelector('output');
        inp.addEventListener('pointerdown', () => f.start?.());
        inp.addEventListener('input', () => { f.set(+inp.value); out.textContent = f.fmt(+inp.value); });
      } else if (f.type === 'check') {
        row.innerHTML = `<label class="tw-check"><input type="checkbox" ${f.get() ? 'checked' : ''}> ${esc(f.label)}</label>`;
        row.querySelector('input').addEventListener('change', (e) => { f.set(e.target.checked); this.render(); });
      } else if (f.type === 'html') {
        row.className = 'tw-diag'; row.innerHTML = f.html();
        if (f.diagOf) row.dataset.diagOf = f.diagOf;
      }
      body.append(row);
    };
    (sp.fields || []).forEach(add);
    if (sp.actions?.length) {
      const a = document.createElement('div');
      a.className = 'tw-actions';
      sp.actions.forEach((x) => { const b = document.createElement('button'); b.className = 'tw-btn' + (x.primary ? ' primary' : ''); b.textContent = x.label; b.addEventListener('click', x.run); a.append(b); });
      body.append(a);
    }
  },
};
$('tw-close').addEventListener('click', () => { if (tool !== 'select') setTool('select'); cancelExtrudeDrag(true); TW.hide(); });
// la ventana se arrastra por su título
{
  const h = $('tw-head'); let d = null;
  h.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) return; const r = $('toolwin').getBoundingClientRect(); d = { dx: e.clientX - r.left, dy: e.clientY - r.top }; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointermove', (e) => { if (d) { $('toolwin').style.left = e.clientX - d.dx + 'px'; $('toolwin').style.top = e.clientY - d.dy + 'px'; } });
  h.addEventListener('pointerup', () => { d = null; });
}

// --- Elección rápida junto al cursor (G0 · G1 · G2 · G3 al unir superficies) ---
function quickPick(x, y, title, opts, def) {
  return new Promise((resolve) => {
    const el = $('quickpick');
    el.innerHTML = `<b>${esc(title)}</b><div>${opts.map(([v, l], i) => `<button data-i="${i}" class="${v === def ? 'def' : ''}"><kbd>${i + 1}</kbd>${esc(l)}</button>`).join('')}</div>`;
    el.style.left = Math.min(innerWidth - 300, x + 14) + 'px'; el.style.top = Math.min(innerHeight - 90, y + 14) + 'px';
    el.hidden = false;
    const done = (v) => { el.hidden = true; removeEventListener('keydown', key, true); removeEventListener('pointerdown', out, true); resolve(v); };
    const key = (e) => {
      if (/^[1-9]$/.test(e.key) && opts[+e.key - 1]) { e.preventDefault(); e.stopPropagation(); done(opts[+e.key - 1][0]); }
      else if (e.key === 'Enter') { e.preventDefault(); done(def); } else if (e.key === 'Escape') { e.stopPropagation(); done(null); }
    };
    const out = (e) => { if (!el.contains(e.target)) { e.stopPropagation(); e.preventDefault(); done(null); } };
    el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => done(opts[+b.dataset.i][0])));
    addEventListener('keydown', key, true);
    setTimeout(() => addEventListener('pointerdown', out, true), 0);
  });
}
const G_OPTS = (from, to) => [[0, 'G0 posición'], [1, 'G1 tangente'], [2, 'G2 curvatura'], [3, 'G3']].filter(([v]) => v >= from && v <= to);

// --- Elegir bordes (Align y Blend) ---
let edgeOp = null;
const edgeMarks = new THREE.Group();
scene.add(edgeMarks);
const EDGE_COLORS = [0x2fb36b, 0x2f7bff, 0xffa31a];
const edgeLineMats = EDGE_COLORS.map((c) => LM({ color: c, linewidth: 5, depthTest: false }));
// marca un borde de superficie o una curva (o varias, encadenadas) con el color del paso
function markEdge(slot, obj, edge, more = []) {
  edgeMarks.children.filter((c) => c.userData.slot === slot).forEach((old) => { old.geometry.dispose(); edgeMarks.remove(old); });
  if (!obj) return;
  for (const o of [obj, ...more]) {
    const src = o.kind === 'curve' ? o.samples : HX.edgePoints(o.data, edge);
    const l = new Line2(line2Geo(src.flatMap((p) => [p.x, p.y, p.z])), edgeLineMats[slot]);
    l.userData.slot = slot; l.renderOrder = 20;
    edgeMarks.add(l);
  }
}
function curveAt(e) {
  setRay(e);
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(objects.filter((o) => o.visible && o.kind === 'curve').map((o) => o.parts.pick), false)[0];
  return hit ? { obj: hit.object.userData.obj } : null;
}
// lo que se puede elegir con cada herramienta: 'edge' bordes, 'curve' curvas, 'both' (las curvas ganan si están cerca)
function sideAt(e, kinds = 'edge') {
  if (kinds !== 'edge') { const c = curveAt(e); if (c || kinds === 'curve') return c; }
  return surfaceEdgeAt(e);
}
function surfaceEdgeAt(e) {
  setRay(e);
  const hit = ray.intersectObjects(objects.filter((o) => o.visible && o.kind === 'surface').map((o) => o.parts.mesh), false)[0];
  if (!hit?.uv) return null;
  return { obj: hit.object.userData.obj, edge: HX.nearestEdge(hit.uv.x, hit.uv.y) };
}
// Opciones de control (como el "Control Options" de Alias)
const CONTROL_OPTS = () => [
  { type: 'check', label: 'Crear historial', get: () => toolDef.createHist !== false, set: (v) => { toolDef.createHist = v; saveToolDef(); } },
  { type: 'check', label: 'Comprobar continuidad', get: () => toolDef.contCheck !== false, set: (v) => { toolDef.contCheck = v; saveToolDef(); } },
];
// sin "Crear historial", la forma se queda pero no sigue a las originales
function maybeDropHistory(r) {
  if (toolDef.createHist !== false) return false;
  const i = relations.indexOf(r);
  if (i >= 0) relations.splice(i, 1);
  renderHistory();
  return true;
}
const EDGE_OPS = {
  align: {
    title: 'Align', steps: ['1 · Clic cerca del borde de la superficie que se ajusta (verde)', '2 · Clic en el borde de la superficie maestra (azul)'],
    fields: () => [
      { type: 'seg', label: 'Continuidad', opts: [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => toolDef.alignCont, set: (v) => { toolDef.alignCont = v; saveToolDef(); } },
      { type: 'range', label: 'Tensión', min: 0.2, max: 3, step: 0.05, get: () => toolDef.alignTension, set: (v) => { toolDef.alignTension = v; saveToolDef(); }, fmt: (v) => v.toFixed(2) },
      ...CONTROL_OPTS(),
      { type: 'html', html: () => '<span class="tw-note">Al elegir la maestra sale G0–G3 junto al cursor (o pulsa 1–4).</span>' }],
    async afterPick(i, p, e) {
      if (i === 1) {
        const c = await quickPick(e.clientX, e.clientY, 'Continuidad', G_OPTS(0, 3), toolDef.alignCont);
        if (c == null) return restartEdgeOp();
        toolDef.alignCont = c; saveToolDef();
        createAlign(edgeOp.picks[0], edgeOp.picks[1], c);
      }
    },
  },
  blend: {
    title: 'Freeform Blend', pick: 'both',
    steps: ['1 · Clic en el primer lado: borde de superficie, curva sobre superficie o curva', '2 · Clic en el segundo lado'],
    fields: () => [
      { type: 'seg', label: 'Lado 1', opts: [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => toolDef.blendA, set: (v) => { toolDef.blendA = v; saveToolDef(); } },
      { type: 'seg', label: 'Lado 2', opts: [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => toolDef.blendB, set: (v) => { toolDef.blendB = v; saveToolDef(); } },
      { type: 'range', label: 'Forma', min: 0.2, max: 3, step: 0.05, get: () => toolDef.blendTension, set: (v) => { toolDef.blendTension = v; saveToolDef(); }, fmt: (v) => v.toFixed(2) },
      { type: 'check', label: 'Recortar automáticamente', get: () => toolDef.autoTrim !== false, set: (v) => { toolDef.autoTrim = v; saveToolDef(); } },
      ...CONTROL_OPTS(),
      { type: 'html', html: () => '<span class="tw-note">Cada lado puede ser un borde, una curva proyectada (Superficies › Proyectar) o una curva libre (G0). En cada lado sale la continuidad junto al cursor (1–4).</span>' }],
    async afterPick(i, p, e) {
      let c = 0;
      if (p.obj.kind === 'surface' || p.obj.data.cos) {
        c = await quickPick(e.clientX, e.clientY, `Continuidad lado ${i + 1}`, G_OPTS(0, 3), i ? toolDef.blendB : toolDef.blendA);
        if (c == null) return restartEdgeOp();
        if (i === 0) toolDef.blendA = c; else toolDef.blendB = c;
        saveToolDef(); TW.render();
      }
      edgeOp.conts = [...(edgeOp.conts || []).slice(0, i), c];
      if (i === 1) createBlend(edgeOp.picks[0], edgeOp.picks[1], edgeOp.conts[0], edgeOp.conts[1]);
    },
  },
  // Skin: superficie entre dos curvas (o dos cadenas de curvas con "Encadenar")
  skin: {
    title: 'Skin', pick: 'curve',
    steps: ['1 · Clic en la primera curva', '2 · Clic en la segunda curva'],
    chainSteps: ['1 · Clic en las curvas del primer lado · Enter: siguiente lado', '2 · Clic en las curvas del segundo lado · Enter: crear'],
    fields: () => [
      { type: 'check', label: 'Encadenar curvas (Chain select)', get: () => !!toolDef.skinChain, set: (v) => { toolDef.skinChain = v; saveToolDef(); restartEdgeOp(); } },
      { type: 'check', label: 'Reconstruir (Rebuild)', get: () => toolDef.skinRebuild !== false, set: (v) => { toolDef.skinRebuild = v; saveToolDef(); } },
      ...CONTROL_OPTS()],
    click(p) {
      const sd = edgeOp.sides || (edgeOp.sides = [[], []]), cur = edgeOp.cur || 0;
      if (sd[cur].includes(p.obj) || (cur === 1 && sd[0].includes(p.obj))) return toast('Esa curva ya está elegida.');
      sd[cur].push(p.obj);
      markEdge(cur, sd[cur][0], null, sd[cur].slice(1));
      edgeOp.picks = cur ? [sd[0][0], p] : [p];
      if (!toolDef.skinChain) { if (cur === 0) edgeOp.cur = 1; else createSkin(sd[0], sd[1]); }
      updateHint(); TW.render();
    },
    enter() {
      const sd = edgeOp.sides, cur = edgeOp.cur || 0;
      if (!sd?.[cur]?.length) return;
      if (cur === 0) { edgeOp.cur = 1; edgeOp.picks = [sd[0][0]]; updateHint(); TW.render(); } else createSkin(sd[0], sd[1]);
    },
  },
  extend: {
    title: 'Extender', pick: 'edge', steps: ['Clic cerca del borde que quieres alargar'],
    fields: () => [
      { type: 'range', label: 'Distancia', min: 0.05, max: 6, step: 0.05, get: () => toolDef.extendDist ?? 1, set: (v) => { toolDef.extendDist = v; saveToolDef(); }, fmt: (v) => v.toFixed(2) + ' dm' },
      { type: 'seg', label: 'Continuidad', opts: [[1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => toolDef.extendCont ?? 2, set: (v) => { toolDef.extendCont = v; saveToolDef(); } },
      ...CONTROL_OPTS()],
    afterPick(i, p) { createExtend(p); },
  },
};
const opStep = () => {
  const op = EDGE_OPS[edgeOp.type];
  if (edgeOp.type === 'skin') return (toolDef.skinChain ? op.chainSteps : op.steps)[edgeOp.cur || 0];
  return op.steps[Math.min(edgeOp.picks.length, op.steps.length - 1)];
};
function edgeSpec() {
  const op = EDGE_OPS[edgeOp.type];
  const actions = [{ label: 'Terminar', run: () => setTool('select') }];
  if (op.enter) actions.unshift({ label: 'Siguiente lado / Crear', primary: true, run: () => op.enter() });
  return { title: op.title, hint: opStep, fields: op.fields(), actions };
}
function startEdgeOp(type) {
  setTool('select'); setPickMode('object');
  if (layout === 'render' || layout === 'ai') switchLayout('diag');
  edgeOp = { type, picks: [], hint: () => `${opStep()} · Esc: terminar` };
  setTool('edge');
  TW.show(edgeSpec());
}
// tras crear (o cancelar) la herramienta sigue activa para la siguiente unión, como en Alias
function restartEdgeOp() { if (!edgeOp) return; edgeOp.picks = []; edgeOp.sides = null; edgeOp.cur = 0; [0, 1, 2].forEach((k) => markEdge(k, null)); updateHint(); TW.show(edgeSpec()); }
// tras crear: se ve la ventana de lo creado (con sus flechas) y la herramienta sigue lista para la siguiente unión
function continueEdgeOp(r) {
  if (!edgeOp) return;
  edgeOp.picks = []; edgeOp.sides = null; edgeOp.cur = 0; [0, 1, 2].forEach((k) => markEdge(k, null)); updateHint();
  const sp = relSpec(r);
  sp.actions = [{ label: 'Quitar historial', run: () => removeRelation(r.id) }, { label: 'Terminar', primary: true, run: () => { setTool('select'); TW.hide(); } }];
  sp.hint = () => (r.type === 'skin' ? 'Cambia sus opciones aquí · clic en otra curva = nuevo Skin' : r.type === 'extend' ? 'Arrastra la flecha verde (distancia) · clic en otro borde = otra extensión'
    : 'Arrastra las flechas: azul = forma, naranja = curvatura · clic en otro borde = nueva unión');
  TW.show(sp);
}
function endEdgeOp() { edgeOp = null; [0, 1, 2].forEach((k) => markEdge(k, null)); if (TW.spec && !TW.spec.rel) TW.hide(); }
let edgeBusy = false;
async function edgeClick(e) {
  if (!edgeOp || e.button !== 0 || edgeBusy) return;
  const op = EDGE_OPS[edgeOp.type], p = sideAt(e, op.pick);
  if (!p) return toast(op.pick === 'curve' ? 'Haz clic sobre una curva.' : op.pick === 'both' ? 'Haz clic cerca de un borde de superficie o sobre una curva.' : 'Haz clic sobre una superficie, cerca del borde que quieres.');
  if (op.click) { if (TW.spec?.rel) TW.show(edgeSpec()); op.click(p, e); return; }
  const p0 = edgeOp.picks[0];
  if (p0 && p0.obj === p.obj && (p.obj.kind === 'curve' || p0.edge === p.edge)) return toast('Elige otro borde u otra curva.');
  const i = edgeOp.picks.length;
  if (i === 0 && TW.spec?.rel) TW.show(edgeSpec());
  markEdge(i, p.obj, p.edge);
  edgeOp.picks.push(p);
  updateHint(); TW.render();
  edgeBusy = true;
  try { await EDGE_OPS[edgeOp.type].afterPick(i, p, e); } finally { edgeBusy = false; }
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (tool !== 'edge' || e.buttons || edgeBusy) return;
  const p = edgeOp && sideAt(e, EDGE_OPS[edgeOp.type].pick);
  if (p) markEdge(2, p.obj, p.edge); else markEdge(2, null);
});

function createAlign(s, m, cont = toolDef.alignCont) {
  checkpoint();
  const r = { type: 'align', slave: s.obj.id, sEdge: s.edge, master: m.obj.id, mEdge: m.edge, cont, tension: toolDef.alignTension };
  try {
    r.rev = HX.reversed(m.obj.data, m.edge, s.obj.data, s.edge);
    s.obj.data = HX.prepareSlave(s.obj.data, s.edge, m.obj.data, m.edge, r.cont, r.rev);
    r.lambda0 = HX.naturalLambda(s.obj.data, s.edge, m.obj.data, m.edge, r.rev);
    addRelation(r);
    applyRelation(r);
  } catch (err) { console.warn(err); toast(`Align no se pudo hacer: ${err.message}`); return restartEdgeOp(); }
  if (maybeDropHistory(r)) { toast(`Align G${cont} hecho, sin historial`); return restartEdgeOp(); }
  toast(`Align G${cont}: ${s.obj.name} sigue a ${m.obj.name}. Ajusta con las flechas; clic en otro borde para otro Align.`);
  continueEdgeOp(r);
}
function createBlend(a, b, cA = toolDef.blendA, cB = toolDef.blendB) {
  checkpoint();
  const edges = a.obj.kind === 'surface' && b.obj.kind === 'surface', t = toolDef.blendTension;
  const r = { type: 'blend', a: a.obj.id, aEdge: a.edge || null, b: b.obj.id, bEdge: b.edge || null, contA: cA, contB: cB,
    tension: t, tensionA: t, tensionB: t, lockShape: true, flowInt: edges ? 'iso' : 'free', flowStart: 'default', flowEnd: 'default' };
  if (edges) r.rev = HX.reversed(a.obj.data, a.edge, b.obj.data, b.edge);
  let o;
  try { o = addSurface(blendRelData(r), 'Blend'); }
  catch (err) { console.warn(err); toast(`Blend no se pudo hacer: ${err.message}`); return restartEdgeOp(); }
  r.out = o.id;
  addRelation(r);
  autoTrim(r);
  if (maybeDropHistory(r)) { toast(`${o.name}: G${cA} / G${cB}, sin historial`); return restartEdgeOp(); }
  toast(`${o.name}: G${cA} / G${cB} · ajusta con las flechas o en su ventana (flujo, rango, corona...)`);
  continueEdgeOp(r);
}
// "Trim Type: Automatic" de Alias: una curva cerrada (o de borde a borde) sobre superficie recorta el lado hacia el que entra el blend
function autoTrim(r) {
  if (toolDef.autoTrim === false || !r.info) return;
  [[r.a, r.info.towardA], [r.b, r.info.towardB]].forEach(([id, toward]) => {
    const c = byId(id);
    if (!c?.data.cos || !toward || (c.data.cos.trim && c.data.cos.trim !== 'none')) return;
    c.data.cos.trim = toward;
    const pr = relations.find((x) => x.type === 'project' && x.out === c.id);
    if (pr) pr.trim = toward;
    updateObject(c);
    toast(`${byId(c.data.cos.surf)?.name || 'Superficie'} recortada ${toward === 'inside' ? 'por dentro' : 'por fuera'} de ${c.name}`);
  });
}
function createSkin(sa, sb) {
  if (!sa.length || !sb.length) return;
  checkpoint();
  const r = { type: 'skin', a: sa[0].id, b: sb[0].id, aIds: sa.map((o) => o.id), bIds: sb.map((o) => o.id), contA: 0, contB: 0,
    rebuild: toolDef.skinRebuild !== false, flowStart: 'default', flowEnd: 'default' };
  let o;
  try { o = addSurface(blendRelData(r), 'Skin'); }
  catch (err) { console.warn(err); toast(`Skin no se pudo hacer: ${err.message}`); return restartEdgeOp(); }
  r.out = o.id;
  addRelation(r);
  if (maybeDropHistory(r)) { toast(`${o.name} creada, sin historial`); return restartEdgeOp(); }
  toast(`${o.name}: sigue a sus curvas · Inicio / Fin: unir extremos o extender · clic en otra curva para otro Skin`);
  continueEdgeOp(r);
}
function createExtend(p) {
  checkpoint();
  const r = { type: 'extend', src: p.obj.id, edge: p.edge, dist: toolDef.extendDist ?? 1, cont: toolDef.extendCont ?? 2 };
  let o;
  try { o = addSurface(FF.extendData(p.obj.data, r.edge, r.dist, r.cont), 'Extensión'); }
  catch (err) { console.warn(err); toast(`Extender no se pudo hacer: ${err.message}`); return restartEdgeOp(); }
  r.out = o.id;
  addRelation(r);
  if (maybeDropHistory(r)) { toast(`${o.name} creada, sin historial`); return restartEdgeOp(); }
  toast(`${o.name}: G${r.cont} con ${p.obj.name} · arrastra la flecha verde para la distancia`);
  continueEdgeOp(r);
}
// Proyectar curvas sobre una superficie (curvas sobre superficie con historial: si mueves la curva, la proyección la sigue)
function projectSelection() {
  const cs = selCurves().filter((c) => !c.data.cos), srf = selObjs.find((o) => o.kind === 'surface');
  if (!cs.length || !srf) return toast('Proyectar: elige una o más curvas y la superficie (Shift + clic para añadir) y vuelve a pulsar Proyectar.');
  checkpoint();
  const mode = toolDef.projMode || 'view', dir = projDir(mode);
  const rels = [], made = [];
  for (const c of cs) {
    const r = { type: 'project', src: c.id, surf: srf.id, mode, dir, trim: toolDef.projTrim || 'none' };
    const o = addCurve(projData(r, c, srf), 'Proyección');
    r.out = o.id; addRelation(r); rels.push(r); made.push(o);
  }
  finishCreate(made, `${made.length} ${made.length === 1 ? 'curva proyectada' : 'curvas proyectadas'} en ${srf.name}, con historial`);
  TW.show(relSpec(rels[0], rels));
}
const projDir = (mode) => (mode === 'y' ? [0, -1, 0] : mode === 'normal' ? null : camera.getWorldDirection(new THREE.Vector3()).toArray());
function offsetSelection() {
  const src = selObjs.filter((o) => o.kind === 'surface');
  if (!src.length) return toast('Offset: elige una o más superficies y vuelve a pulsar Offset.');
  checkpoint();
  const made = src.map((s) => { const r = { type: 'offset', src: s.id, dist: toolDef.offsetDist }; const o = addSurface(HX.offsetData(s.data, r.dist), 'Offset'); r.out = o.id; addRelation(r); return o; });
  finishCreate(made, `Offset a ${toolDef.offsetDist.toFixed(2)} dm, con historial`);
}
function mirrorSelection() {
  const src = selObjs.filter((o) => o.kind !== 'mesh');
  if (!src.length) return toast('Simetría: elige superficies o curvas y vuelve a pulsar Simetría.');
  checkpoint();
  const made = src.map((s) => {
    const r = { type: 'mirror', src: s.id, plane: toolDef.mirrorPlane };
    const d = HX.mirrorData(s.data, s.kind, r.plane), o = s.kind === 'curve' ? addCurve(d, s.name + ' sim.') : addSurface(d, s.name + ' sim.');
    r.out = o.id; addRelation(r); return o;
  });
  finishCreate(made, 'Simetría con historial: la copia sigue al original');
}
// --- Revolución y loft con historial ---
function revolveSelection() {
  const cs = selCurves();
  if (!cs.length) return toast('Revolución: elige una curva de perfil (mejor dibujada de frente) y vuelve a pulsar Revolución.');
  checkpoint();
  const made = cs.map((c) => { const r = { type: 'revolve', src: c.id }; const o = addSurface(N.revolve(c.data), 'Revolución'); r.out = o.id; addRelation(r); return o; });
  finishCreate(made, 'Revolución alrededor del eje Y, con historial: sigue a su curva');
}
function loftSelection() {
  const cs = selCurves();
  if (cs.length < 2) return toast('Loft: elige 2 o más curvas, en orden, y vuelve a pulsar Loft.');
  checkpoint();
  const r = { type: 'loft', srcs: cs.map((c) => c.id) };
  const o = addSurface(N.loft(cs.map((c) => c.data)), 'Loft');
  r.out = o.id; addRelation(r);
  finishCreate([o], `${o.name} por ${cs.length} curvas, con historial`);
}
// --- Extruir con el ratón: se crea la superficie y la distancia sigue al ratón hasta hacer clic ---
let extrudeDrag = null;
function extrudeSelection() {
  const cs = selCurves();
  if (!cs.length) return toast('Extruir: elige una o más curvas y vuelve a pulsar Extruir.');
  checkpoint();
  const rels = cs.map((c) => {
    const r = { type: 'extrude', src: c.id, dist: 0.01, dir: toolDef.extDir, both: toolDef.extBoth };
    const o = addSurface(HX.extrudeData(c.data, r.dist, r.dir, r.both), 'Extrusión');
    r.out = o.id; addRelation(r); return r;
  });
  // la distancia sigue al cursor a lo largo de la dirección de extrusión, medida desde el centro de la curva
  const c0 = cvCenter(cs[0].data), dirv = HX.extrudeData(cs[0].data, 1, rels[0].dir, false).cvs[1][0];
  const d0 = HX.extrudeData(cs[0].data, 0, rels[0].dir, false).cvs[1][0];
  const axis = new THREE.Vector3(dirv.x - d0.x, dirv.y - d0.y, dirv.z - d0.z);
  extrudeDrag = { rels, c0, axis };
  TW.show(relSpec(rels[0], rels));
  toast('Mueve el ratón arriba / abajo para extruir · clic para terminar · Esc: también termina');
}
function setExtrudeDist(rels, d) { rels.forEach((r) => { r.dist = d; applyRelation(r); }); }
function cancelExtrudeDrag(keep) { if (!extrudeDrag) return; const r = extrudeDrag.rels; extrudeDrag = null; if (keep) { finishCreate(r.map((x) => byId(x.out)).filter(Boolean), 'Extrusión terminada (cambia la distancia en su ventana)'); TW.show(relSpec(r[0], r)); } }
addEventListener('pointermove', (e) => {
  if (!extrudeDrag) return;
  const pn = paneAt(e.clientX), r = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  const toScr = (v) => { const q = v.clone().project(camera); return new THREE.Vector2(r.left + pn.x + ((q.x + 1) / 2) * pn.w, r.top + ((1 - q.y) / 2) * pn.h); };
  const a = toScr(extrudeDrag.c0), b = toScr(extrudeDrag.c0.clone().add(extrudeDrag.axis)), s2 = b.clone().sub(a);
  const m = new THREE.Vector2(e.clientX, e.clientY).sub(a);
  const d = Math.round((s2.lengthSq() > 4 ? m.dot(s2) / s2.lengthSq() : (a.y - e.clientY) * 0.01) * 100) / 100 || 0.01;
  setExtrudeDist(extrudeDrag.rels, d);
  if (TW.spec?.rel === extrudeDrag.rels[0]) { const o = document.querySelector('#tw-body input[type=range]'); if (o) { o.value = d; o.nextElementSibling.textContent = d.toFixed(2); } }
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!extrudeDrag) return;
  e.stopImmediatePropagation(); e.preventDefault();
  cancelExtrudeDrag(true);
}, true);
addEventListener('keydown', (e) => { if (e.key === 'Escape' && extrudeDrag) cancelExtrudeDrag(true); }, true);

// --- Ventana de opciones de una relación ya creada (al elegir su resultado se abre para modificarla) ---
function relSpec(r, group = [r]) {
  const apply = () => { group.forEach((x) => { x.pending = false; if (applyRelation(x)) { const out = byId(outputOf(x)); if (out) propagateFrom(out); } }); scheduleHistoryDiag(); renderHistory(); };
  // "Auto Update" de Alias: apagado, los cambios esperan al botón Actualizar
  const redo = () => { if (r.auto === false) { group.forEach((x) => (x.pending = true)); TW.render(); return; } apply(); };
  const set = (k, v) => { checkpoint(); group.forEach((x) => (x[k] = v)); redo(); };
  const live = (k) => (v) => { group.forEach((x) => (x[k] = v)); redo(); };
  const G = (from, to) => [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']].filter(([v]) => v >= from && v <= to);
  const nm = (id) => byId(id)?.name || '¿?';
  const fields = [];
  let title = REL_NAMES[r.type];
  if (r.type === 'align') {
    title += ` · ${nm(r.slave)} → ${nm(r.master)}`;
    fields.push({ type: 'seg', label: 'Continuidad', opts: G(0, 3), get: () => r.cont, set: (v) => set('cont', v) },
      { type: 'range', label: 'Tensión', min: 0.2, max: 3, step: 0.05, get: () => r.tension, start: checkpoint, set: live('tension'), fmt: (v) => v.toFixed(2) });
  } else if (r.type === 'blend' || r.type === 'skin') {
    const sk = r.type === 'skin', ids = (x) => x.map(nm).join(' + ');
    title += ` · ${ids(r.aIds || [r.a])} ↔ ${ids(r.bIds || [r.b])}`;
    const freeA = byId(r.a)?.kind === 'curve' && !byId(r.a)?.data.cos, freeB = byId(r.b)?.kind === 'curve' && !byId(r.b)?.data.cos;
    if (!sk) {
      fields.push({ type: 'seg', label: 'Lado 1', opts: G(0, freeA ? 0 : 3), get: () => r.contA ?? r.cont, set: (v) => set('contA', v) },
        { type: 'seg', label: 'Lado 2', opts: G(0, freeB ? 0 : 3), get: () => r.contB ?? r.cont, set: (v) => set('contB', v) },
        { type: 'range', label: 'Forma lado 1', min: 0.2, max: 3, step: 0.05, get: () => r.tensionA ?? r.tension, start: checkpoint,
          set: (v) => { r.tensionA = v; if (r.lockShape) r.tensionB = v; redo(); }, fmt: (v) => v.toFixed(2) },
        { type: 'range', label: 'Forma lado 2', min: 0.2, max: 3, step: 0.05, show: () => !r.lockShape, get: () => r.tensionB ?? r.tension, start: checkpoint, set: live('tensionB'), fmt: (v) => v.toFixed(2) },
        { type: 'check', label: 'Bloquear formas (Lock Shape Controls)', get: () => !!r.lockShape, set: (v) => { r.lockShape = v; if (v) { r.tensionB = r.tensionA ?? r.tension; redo(); } } });
    }
    fields.push({ type: 'range', label: 'Corona (Crown)', min: -1, max: 1, step: 0.02, get: () => r.crown || 0, start: checkpoint, set: live('crown'), fmt: (v) => (v ? v.toFixed(2) : 'no') },
      { type: 'check', label: 'Modificar parámetro (curvas cerradas)', get: () => !!r.modParam, set: (v) => set('modParam', v) },
      { type: 'range', label: 'Inicio lado 1', min: 0, max: 1, step: 0.005, show: () => !!r.modParam, get: () => r.pA || 0, start: checkpoint, set: live('pA'), fmt: (v) => v.toFixed(3) },
      { type: 'range', label: 'Giro lado 2', min: -0.5, max: 0.5, step: 0.005, show: () => !!r.modParam, get: () => r.pB || 0, start: checkpoint, set: live('pB'), fmt: (v) => v.toFixed(3) });
    const ends = sk ? [['default', 'Unir extremos'], ['extend', 'Extender']] : [['default', 'Defecto'], ['edge', 'Alinear al borde']];
    fields.push({ type: 'group', key: 'explicit', label: 'Control explícito', fields: [
      { type: 'check', label: 'Control explícito', get: () => !!r.explicit, set: (v) => set('explicit', v) },
      { type: 'seg', label: 'Grado U', opts: [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [7, '7']], show: () => !!r.explicit, get: () => r.degU ?? 3, set: (v) => set('degU', v) },
      { type: 'range', label: 'Spans U', min: 1, max: 32, step: 1, show: () => !!r.explicit, get: () => r.spansU ?? 8, start: checkpoint, set: live('spansU'), fmt: (v) => String(v) },
      ...(sk ? [{ type: 'check', label: 'Reconstruir (Rebuild)', get: () => r.rebuild !== false, set: (v) => set('rebuild', v) }] : [])] },
    { type: 'group', key: 'flow', label: 'Control de flujo', fields: [
      { type: 'seg', label: 'Inicio', opts: ends, get: () => r.flowStart || 'default', set: (v) => set('flowStart', v) },
      ...(sk ? [] : [{ type: 'seg', label: 'Interior', opts: [['free', 'Libre'], ['iso', 'Isoparam.']], get: () => r.flowInt || 'free', set: (v) => set('flowInt', v) }]),
      { type: 'seg', label: 'Fin', opts: ends, get: () => r.flowEnd || 'default', set: (v) => set('flowEnd', v) },
      { type: 'check', label: 'Modificar rango', get: () => !!r.modRange, set: (v) => set('modRange', v) },
      ...[['rA0', 'Lado 1 inicio', 0], ['rA1', 'Lado 1 fin', 1], ['rB0', 'Lado 2 inicio', 0], ['rB1', 'Lado 2 fin', 1]].map(([k, l, d]) => (
        { type: 'range', label: l, min: 0, max: 1, step: 0.005, show: () => !!r.modRange, get: () => r[k] ?? d, start: checkpoint, set: live(k), fmt: (v) => v.toFixed(3) }))] },
    { type: 'group', key: 'ctrl', label: 'Opciones de control', fields: [
      ...(sk ? [] : [{ type: 'check', label: 'Recortar automáticamente', get: () => toolDef.autoTrim !== false, set: (v) => { toolDef.autoTrim = v; saveToolDef(); if (v) autoTrim(r); } }]),
      { type: 'check', label: 'Comprobar continuidad', get: () => toolDef.contCheck !== false, set: (v) => { toolDef.contCheck = v; saveToolDef(); TW.show(relSpec(r, group)); } }] });
  } else if (r.type === 'project') {
    title += group.length > 1 ? ` · ${group.length} curvas → ${nm(r.surf)}` : ` · ${nm(r.src)} → ${nm(r.surf)}`;
    fields.push({ type: 'seg', label: 'Dirección', opts: [['view', 'Vista'], ['y', 'Y'], ['normal', 'Normal']], get: () => r.mode,
      set: (v) => { toolDef.projMode = v; saveToolDef(); checkpoint(); const d = projDir(v); group.forEach((x) => { x.mode = v; x.dir = d; }); redo(); } },
    { type: 'seg', label: 'Recortar', opts: [['none', 'No'], ['inside', 'Dentro'], ['outside', 'Fuera']], get: () => r.trim || 'none',
      set: (v) => { toolDef.projTrim = v; saveToolDef(); set('trim', v); } },
    { type: 'html', html: () => '<span class="tw-note">Recortar necesita una curva cerrada o que vaya de borde a borde. Mueve la curva original y la proyección, el recorte y los blends la siguen.</span>' });
  } else if (r.type === 'extend') {
    title += ` · ${nm(r.src)}`;
    fields.push({ type: 'range', label: 'Distancia', min: 0.05, max: 6, step: 0.05, get: () => r.dist, start: checkpoint, set: (v) => { toolDef.extendDist = v; saveToolDef(); live('dist')(v); }, fmt: (v) => v.toFixed(2) + ' dm' },
      { type: 'seg', label: 'Continuidad', opts: [[1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => r.cont, set: (v) => { toolDef.extendCont = v; saveToolDef(); set('cont', v); } });
  } else if (r.type === 'extrude') {
    title += group.length > 1 ? ` · ${group.length} curvas` : ` · ${nm(r.src)}`;
    fields.push({ type: 'range', label: 'Distancia', min: -10, max: 10, step: 0.01, get: () => r.dist, start: checkpoint, set: live('dist'), fmt: (v) => v.toFixed(2) + ' dm' },
      { type: 'seg', label: 'Dirección', opts: [['auto', 'Normal'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], get: () => r.dir, set: (v) => { toolDef.extDir = v; saveToolDef(); set('dir', v); } },
      { type: 'check', label: 'Hacia los dos lados', get: () => r.both, set: (v) => { toolDef.extBoth = v; saveToolDef(); set('both', v); } });
  } else if (r.type === 'offset') {
    title += ` · ${nm(r.src)}`;
    fields.push({ type: 'range', label: 'Distancia', min: -2, max: 2, step: 0.01, get: () => r.dist, start: checkpoint, set: (v) => { toolDef.offsetDist = v; saveToolDef(); live('dist')(v); }, fmt: (v) => v.toFixed(2) + ' dm' });
  } else if (r.type === 'mirror') {
    title += ` · ${nm(r.src)}`;
    fields.push({ type: 'seg', label: 'Plano', opts: [['x', 'YZ'], ['y', 'XZ'], ['z', 'XY']], get: () => r.plane || 'x', set: (v) => { toolDef.mirrorPlane = v; saveToolDef(); set('plane', v); } });
  } else title += ` · ${r.type === 'loft' ? r.srcs.length + ' curvas' : nm(r.src)}`;
  if (['align', 'blend', 'skin', 'extend'].includes(r.type) && toolDef.contCheck !== false) fields.push({ type: 'html', html: () => relDiag(r), diagOf: r.id });
  fields.push({ type: 'check', label: 'Actualizar al momento', get: () => r.auto !== false, set: (v) => { group.forEach((x) => (x.auto = v)); if (v && r.pending) apply(); } });
  const actions = [{ label: 'Quitar historial', run: () => removeRelation(r.id) }, { label: 'Cerrar', primary: true, run: () => TW.hide() }];
  if (r.auto === false) actions.splice(1, 0, { label: r.pending ? 'Actualizar •' : 'Actualizar', primary: !!r.pending, run: () => { apply(); TW.render(); } });
  if (['blend', 'skin', 'extend'].includes(r.type)) {
    // Undo All (borra lo creado) y Next (lo deja y sigue con otro), como en Alias
    actions.unshift({ label: 'Deshacer todo', run: () => { const o = byId(r.out); checkpoint(); if (o) removeObject(o); selectionChanged(); refreshOutliner(); renderHistory(); TW.hide(); if (edgeOp) restartEdgeOp(); } },
      { label: 'Siguiente', run: () => { if (edgeOp?.type === r.type) restartEdgeOp(); else startEdgeOp(r.type); } });
  }
  return { title, rel: r, fields, actions };
}
// --- Flechas para manipular cada herramienta en la vista (como los manipuladores de Alias) ---
// Align / Blend: una flecha en la 1.ª fila de CVs (tensión) y otra en la 2.ª (forma, sin romper G2).
// Extruir: flecha en el extremo (distancia). Offset: flecha a lo largo de la normal (distancia).
const relArrows = new THREE.Group();
relArrows.renderOrder = 40;
scene.add(relArrows);
const ARROW_COLORS = { t: '#2f7bff', s: '#ff9a1f', d: '#2fb36b' };
function makeArrow(color) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 10), m); shaft.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 16), m); head.position.y = 0.95;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), m);
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 8), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = 0.55;
  [shaft, head, ball].forEach((x) => { x.renderOrder = 41; });
  g.add(shaft, head, ball, pick);
  g.userData.pick = pick;
  return g;
}
const mid = (arr) => arr[Math.floor(arr.length / 2)];
const v3 = (q) => new THREE.Vector3(q.x, q.y, q.z);
// manijas de la relación abierta: { pos, dir, kind: 't' | 's' | 'd', drag(delta, start) }
function relHandles(r) {
  const out = byId(outputOf(r));
  if (!out || out.kind !== 'surface') return [];
  const d = out.data, H = [];
  const rows = (edge, cont, tKey, sKey) => {
    const p0 = v3(mid(HX.row(d, edge, 0))), p1 = v3(mid(HX.row(d, edge, 1)));
    const l1 = p1.distanceTo(p0) || 1e-3;
    if (cont >= 1) H.push({ pos: p1, dir: p1.clone().sub(p0).normalize(), kind: 't', label: 'tensión',
      start: () => r[tKey] ?? r.tension, drag: (delta, s0) => { r[tKey] = Math.max(0.05, s0 * (1 + delta / l1)); } });
    if (cont >= 2) {
      const p2 = v3(mid(HX.row(d, edge, 2))), l2 = p2.distanceTo(p1) || 1e-3;
      H.push({ pos: p2, dir: p2.clone().sub(p1).normalize(), kind: 's', label: 'forma',
        start: () => r[sKey] || 0, drag: (delta, s0) => { r[sKey] = s0 + delta / l2; } });
    }
  };
  if (r.type === 'align') rows(r.sEdge, r.cont, 'tension', 'shape');
  else if (r.type === 'blend') {
    // con "Bloquear formas" las dos flechas azules mueven la misma forma
    rows('v0', r.contA ?? r.cont, 'tensionA', 'shapeA');
    rows('v1', r.contB ?? r.cont, r.lockShape ? 'tensionA' : 'tensionB', 'shapeB');
  } else if (r.type === 'extend') {
    const p0 = v3(mid(HX.row(d, 'v0', 0))), p = v3(mid(HX.row(d, 'v1', 0))), dir = p.clone().sub(p0).normalize();
    H.push({ pos: p, dir: dir.lengthSq() ? dir : new THREE.Vector3(0, 1, 0), kind: 'd', label: 'distancia', start: () => r.dist, drag: (delta, s0) => { r.dist = Math.max(0.01, Math.round((s0 + delta) * 100) / 100); } });
  }
  else if (r.type === 'extrude') {
    const top = d.cvs[1], bot = d.cvs[0], p = v3(mid(top)), dir = p.clone().sub(v3(mid(bot))).normalize();
    const sgn = Math.sign(r.dist) || 1;
    H.push({ pos: p, dir: dir.lengthSq() ? dir : new THREE.Vector3(0, 1, 0), kind: 'd', label: 'distancia', start: () => r.dist, drag: (delta, s0) => { r.dist = Math.round((s0 + delta * sgn) * 100) / 100 || 0.01; } });
  } else if (r.type === 'offset') {
    const src = byId(r.src);
    if (!src) return H;
    const i = Math.floor(d.cvs.length / 2), j = Math.floor(d.cvs[0].length / 2), p = v3(d.cvs[i][j]), q = v3(src.data.cvs[i][j]);
    let dir = p.clone().sub(q);
    const sgn = Math.sign(r.dist) || 1;
    dir = dir.lengthSq() > 1e-10 ? dir.normalize().multiplyScalar(sgn) : new THREE.Vector3(0, 1, 0);
    H.push({ pos: p, dir: dir.clone().multiplyScalar(sgn), kind: 'd', label: 'distancia', start: () => r.dist, drag: (delta, s0) => { r.dist = Math.round((s0 + delta) * 100) / 100; } });
  }
  return H;
}
let arrowsFor = null, arrowDrag = null;
function updateRelArrows() {
  const r = TW.spec?.rel || (extrudeDrag ? null : null);
  arrowsFor = r && relations.includes(r) ? r : null;
  const H = arrowsFor ? relHandles(arrowsFor) : [];
  while (relArrows.children.length > H.length) relArrows.remove(relArrows.children[relArrows.children.length - 1]);
  H.forEach((h, i) => {
    let a = relArrows.children[i];
    if (!a || a.userData.kind !== h.kind) { a = makeArrow(ARROW_COLORS[h.kind]); a.userData.kind = h.kind; if (relArrows.children[i]) relArrows.remove(relArrows.children[i]); relArrows.add(a); relArrows.children.splice(i, 0, relArrows.children.pop()); }
    a.position.copy(h.pos);
    a.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), h.dir);
    a.userData.h = h;
  });
  updateRelLabels();
}
// Etiquetas en la vista (Lado 1, Lado 2, Inicio [..], Fin [..], Corona), como las de Alias
const relLabelBox = document.createElement('div');
relLabelBox.id = 'rel-labels';
document.body.append(relLabelBox);
let relLabelPts = [];
function updateRelLabels() {
  const r = arrowsFor, out = r && ['blend', 'skin'].includes(r.type) && byId(r.out);
  relLabelPts = [];
  if (!out) { relLabelBox.innerHTML = ''; return; }
  const O = FF.surfEval(out.data);
  const fl = (v) => ({ default: r.type === 'skin' ? 'Unir extremos' : 'Defecto', edge: 'Alinear al borde', extend: 'Extender' })[v || 'default'];
  // en lados cerrados el inicio y el fin coinciden: una sola etiqueta en la costura
  const closed = O(0, 0.5).distanceTo(O(1, 0.5)) < 1e-3;
  relLabelPts = [[O(0.5, 0), 'Lado 1'], [O(0.5, 1), 'Lado 2'], [O(0.25, 0.5), `Corona [${r.crown ? r.crown.toFixed(2) : 'no'}]`],
    ...(closed ? [[O(0, 0.5), 'Costura (Modificar parámetro)']] : [[O(0, 0.5), `Inicio [${fl(r.flowStart)}]`], [O(1, 0.5), `Fin [${fl(r.flowEnd)}]`]])];
  relLabelBox.innerHTML = relLabelPts.map(([, t]) => `<span class="rel-label">${esc(t)}</span>`).join('');
}
function placeRelLabels() {
  relLabelBox.hidden = !relLabelPts.length || !!carousel || layout === 'render' || layout === 'ai';
  if (relLabelBox.hidden) return;
  const pn = panes().find((p) => p.kind !== 'render') || panes()[0], rc = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  relLabelPts.forEach(([p], i) => {
    const el = relLabelBox.children[i], q = p.clone().project(camera);
    if (!el) return;
    el.style.display = q.z < 1 ? '' : 'none';
    el.style.left = rc.left + pn.x + ((q.x + 1) / 2) * pn.w + 'px';
    el.style.top = rc.top + ((1 - q.y) / 2) * pn.h + 'px';
  });
}
function scaleRelArrows() {
  for (const a of relArrows.children) a.scale.setScalar(camera.position.distanceTo(a.position) * 0.075);
}
// en captura sobre la ventana: así la flecha gana a la selección y a mover con los botones
addEventListener('pointerdown', (e) => {
  if (e.target !== renderer.domElement || !relArrows.children.length || e.button !== 0 || carousel) return;
  setRay(e);
  const hit = ray.intersectObjects(relArrows.children.map((a) => a.userData.pick), false)[0];
  if (!hit) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const a = hit.object.parent, h = a.userData.h;
  checkpoint();
  arrowDrag = { h, s0: h.start(), x: e.clientX, y: e.clientY, pos: h.pos.clone(), dir: h.dir.clone(), pane: paneAt(e.clientX) };
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);
addEventListener('pointermove', (e) => {
  const g = arrowDrag;
  if (!g) return;
  const r = renderer.domElement.getBoundingClientRect();
  useAspect(g.pane);
  const scr = (v) => { const q = v.clone().project(camera); return new THREE.Vector2(r.left + g.pane.x + ((q.x + 1) / 2) * g.pane.w, r.top + ((1 - q.y) / 2) * g.pane.h); };
  const unit = camera.position.distanceTo(g.pos) * 0.1;
  const s = scr(g.pos.clone().addScaledVector(g.dir, unit)).sub(scr(g.pos)).divideScalar(unit);
  if (s.lengthSq() < 1e-6) return;
  const delta = ((e.clientX - g.x) * s.x + (e.clientY - g.y) * s.y) / s.lengthSq();
  g.h.drag(delta, g.s0);
  if (applyRelation(arrowsFor)) { const out = byId(outputOf(arrowsFor)); if (out) propagateFrom(out); }
  updateRelArrows();
});
addEventListener('pointerup', () => {
  if (!arrowDrag) return;
  arrowDrag = null;
  TW.render(); renderHistory(); scheduleHistoryDiag();
});
// --- Aviso de Alias: transformar algo que SALE de una operación con historial rompe el historial ---
// (mover sus entradas sí está bien: el resultado las sigue). Se pregunta antes de empezar a moverlo.
function historyBlockers() {
  if (!relations.length) return [];
  const outs = new Set(relations.map(outputOf));
  const objs = pickMode === 'cv'
    // en modo CV, la superficie de un Align se puede retocar: sus filas del borde siguen atadas a la maestra
    ? [...new Set([...selCVs.values()].map((r) => r.obj))].filter((o) => outs.has(o.id) && !relations.some((r) => r.type === 'align' && r.slave === o.id))
    : selObjs.filter((o) => outs.has(o.id));
  return objs;
}
async function askBreakHistory(x, y, objs) {
  const v = await quickPick(x, y, `${objs.map((o) => o.name).join(', ')} tiene historial de construcción`,
    [['yes', 'Quitar historial y transformar'], ['no', 'No, dejarlo']], 'no');
  if (v !== 'yes') return false;
  checkpoint();
  const ids = new Set(objs.map((o) => o.id));
  for (let i = relations.length - 1; i >= 0; i--) if (ids.has(outputOf(relations[i]))) relations.splice(i, 1);
  renderHistory(); TW.hide();
  toast('Historial quitado: ya puedes transformarlo');
  return true;
}
// manipulador de flechas (gizmo): se intercepta antes de que empiece a arrastrar
addEventListener('pointerdown', (e) => {
  if (e.target !== renderer.domElement || e.button !== 0 || pivotEdit || !gizmo.axis || !gizmo.object) return;
  const b = historyBlockers();
  if (!b.length) return;
  e.stopImmediatePropagation(); e.preventDefault();
  askBreakHistory(e.clientX, e.clientY, b);
}, true);

// al elegir un solo objeto que sale de una relación, su ventana de opciones se abre para modificarla
function syncToolWinToSelection() {
  if (tool !== 'select' || extrudeDrag) return;
  const o = selObjs.length === 1 && pickMode === 'object' ? selObjs[0] : null;
  const r = o && relations.find((x) => outputOf(x) === o.id);
  if (r) { if (TW.spec?.rel !== r) TW.show(relSpec(r)); }
  else if (TW.spec?.rel) TW.hide();
}

// --- Panel "Historial de construcción" ---
function relDiag(r) {
  const out = byId(outputOf(r)), ins = inputsOf(r).map(byId);
  if (!out || ins.some((o) => !o) || out.kind !== 'surface') return '';
  const fmtD = (d, cont) => {
    const ok = (c) => `<b class="${c ? 'ok' : 'bad'}">${c ? '✓' : '✗'}</b>`;
    return `${ok(d.gap < 1e-3)} hueco ${d.gap.toFixed(4)} dm · ${cont >= 1 ? ok(d.angle < 0.1) : ''} ángulo ${d.angle.toFixed(2)}° · ${cont >= 2 ? ok(d.curv < 0.05) : ''} curvatura ${(d.curv * 100).toFixed(1)}%`;
  };
  try {
    if (r.type === 'align') return fmtD(HX.diagnose(ins[0].data, r.mEdge, out.data, r.sEdge, r.rev), r.cont);
    if (r.type === 'blend' && exactBlend(r)) return `1: ${fmtD(HX.diagnose(ins[0].data, r.aEdge, out.data, 'v0', false), r.contA ?? r.cont)}<br>2: ${fmtD(HX.diagnose(ins[1].data, r.bEdge, out.data, 'v1', r.rev), r.contB ?? r.cont)}`;
    if (r.type === 'blend' || r.type === 'skin') {
      const [A, B] = blendSides(r), [dA, dB] = FF.diagnoseBlend(r, A, B, out.data);
      return `1: ${fmtD(dA, A.kind === 'curves' ? 0 : r.contA ?? 2)}<br>2: ${fmtD(dB, B.kind === 'curves' ? 0 : r.contB ?? 2)}`;
    }
    if (r.type === 'extend') return fmtD(HX.diagnose(ins[0].data, r.edge, out.data, 'v0', false), r.cont);
  } catch (e) { return ''; }
  return '';
}
let histDiagT = 0;
function scheduleHistoryDiag() {
  clearTimeout(histDiagT);
  histDiagT = setTimeout(() => document.querySelectorAll('[data-diag-of]').forEach((el) => { const r = relations.find((x) => x.id === +el.dataset.diagOf); if (r) el.innerHTML = relDiag(r); }), 250);
}
function renderHistory() {
  recomputeDeps(); objects.forEach(applyVisibility);
  const box = $('hist-body');
  if (!box) return;
  if (!relations.length) {
    box.innerHTML = '<p class="muted">Sin historial. Align, Blend, Extruir, Revolución, Loft, Offset y Simetría (menú Superficies o Puck) crean superficies que siguen a las originales.</p>';
    return;
  }
  const nm = (id) => esc(byId(id)?.name || '¿?');
  box.innerHTML = relations.map((r) => {
    const title = r.type === 'align' ? `${nm(r.slave)} → ${nm(r.master)} · G${r.cont}` : r.type === 'blend' ? `${nm(r.out)} · G${r.contA ?? r.cont}/G${r.contB ?? r.cont}`
      : r.type === 'skin' ? `${nm(r.out)} ← ${(r.aIds || [r.a]).length + (r.bIds || [r.b]).length} curvas` : r.type === 'project' ? `${nm(r.out)} ← ${nm(r.src)} en ${nm(r.surf)}`
      : r.type === 'loft' ? `${nm(r.out)} ← ${r.srcs.length} curvas` : `${nm(r.out)} ← ${nm(r.src)}`;
    return `<div class="hist-rel" data-rel="${r.id}"><div class="hist-h"><b>${REL_NAMES[r.type]}</b><span>${title}</span>
      <button class="mini" data-edit title="Abrir sus opciones">⋯</button><button class="mini" data-del title="Quitar historial (la forma se queda)">×</button></div>
      ${['align', 'blend', 'skin', 'extend'].includes(r.type) ? `<p class="hist-diag" data-diag-of="${r.id}">${relDiag(r)}</p>` : ''}</div>`;
  }).join('');
  box.querySelectorAll('.hist-rel').forEach((el) => {
    const r = relations.find((x) => x.id === +el.dataset.rel);
    el.querySelector('[data-del]').addEventListener('click', () => removeRelation(r.id));
    el.querySelector('[data-edit]').addEventListener('click', () => TW.show(relSpec(r)));
  });
}
renderHistory();
toolsReady = true;

// Ejemplo del video de Alias: hueco de manija en una puerta. Dos círculos proyectados (con historial) recortan la puerta
// y el fondo, y un Freeform Blend G2 / G1 los une. Mueve un círculo y todo se recalcula.
function blendDemo() {
  checkpoint();
  const door = N.planeData(new THREE.Vector3(0, 0, 0), 'xz', 6, 4);
  door.cvs.forEach((row, i) => row.forEach((c, j) => { c.y += 0.35 * Math.sin((i / 3) * Math.PI) + 0.12 * (j - 1.5); }));
  const floor = N.planeData(new THREE.Vector3(0, -0.75, 0), 'xz', 2.6, 2.2);
  floor.cvs.forEach((row) => row.forEach((c) => { c.y += 0.08 * c.x; }));
  const dObj = addSurface(door, 'Puerta'), fObj = addSurface(floor, 'Fondo');
  const c1 = addCurve(circleData(new THREE.Vector3(0, 1.4, 0), 0.95), 'Círculo'), c2 = addCurve(circleData(new THREE.Vector3(0, 1.4, 0), 0.5), 'Círculo');
  const proj = (c, srf, trim) => {
    const r = { type: 'project', src: c.id, surf: srf.id, mode: 'y', dir: [0, -1, 0], trim };
    const o = addCurve(projData(r, c, srf), 'Proyección');
    r.out = o.id; addRelation(r); return o;
  };
  const p1 = proj(c1, dObj, 'inside'), p2 = proj(c2, fObj, 'outside');
  createBlend({ obj: p1 }, { obj: p2 }, 2, 1);
  frameObjects([]);
  return { door: dObj, floor: fObj, c1, c2, p1, p2 };
}

// ---------- Nudge (Alias): las flechas del teclado mueven, giran o escalan lo elegido un poquito ----------
// El paso depende de lo cerca que esté la cámara (acercarse = pasos más finos). Shift = 10 veces más.
// Izq/der usan el eje del mundo más parecido al "derecha" de la pantalla; arriba/abajo, el más parecido al "arriba".
function nearestAxis(v) {
  const a = [Math.abs(v.x), Math.abs(v.y), Math.abs(v.z)], i = a.indexOf(Math.max(...a));
  return AXES[i].clone().multiplyScalar(Math.sign([v.x, v.y, v.z][i]) || 1);
}
addEventListener('keydown', (e) => {
  if (!e.key.startsWith('Arrow') || e.ctrlKey || e.metaKey || e.altKey || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (tool !== 'select' || carousel || MENUS.some((m) => m?.open) || pivotEdit) return;
  if (!hasTransformable()) return;
  e.preventDefault();
  const blk = historyBlockers();
  if (blk.length) { askBreakHistory(lastPtr.x, lastPtr.y, blk); return; }
  const horiz = e.key === 'ArrowLeft' || e.key === 'ArrowRight', sgn = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 1 : -1;
  const big = e.shiftKey ? 10 : 1;
  attachGizmo();
  gizmo.dispatchEvent({ type: 'mouseDown', mode: xform });
  if (!gizmoDrag) return;
  gizmoDrag.noSnap = true;
  const ax = nearestAxis(camAxis(horiz ? 1 : 0, horiz ? 0 : 1));
  if (xform === 'translate') proxy.position.addScaledVector(ax, sgn * big * camera.position.distanceTo(proxy.position) * 0.004);
  else if (xform === 'rotate') proxy.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(horiz ? new THREE.Vector3(0, 1, 0) : nearestAxis(camAxis(1, 0)), sgn * THREE.MathUtils.degToRad(big)));
  else proxy.scale.multiplyScalar(1 + sgn * 0.01 * big);
  gizmo.dispatchEvent({ type: 'objectChange' });
  gizmo.dispatchEvent({ type: 'mouseUp', mode: xform });
  $('st-snap').textContent = xform === 'translate' ? `Nudge ${'XYZ'[AXES.findIndex((a) => Math.abs(a.dot(ax)) > 0.5)]}` : xform === 'rotate' ? `Nudge ${big}°` : `Nudge ${big}%`;
});

// ---------- Cubo de vistas (el ViewCube de Alias) ----------
// Arriba a la derecha de cada vista. Clic en una cara: vista ortogonal de ese lado (girar la devuelve a perspectiva);
// clic en una arista o esquina: vista en perspectiva desde ahí. Arrastrar el cubo gira la vista.
// Debajo, PERSP / ORTO: trabajar siempre en ortogonal o en perspectiva.
const CUBE_PX = 92, CUBE_TOP = 58, CUBE_RIGHT = 66;   // fuera de la franja derecha que abre el panel
const cubeScene = new THREE.Scene();
const cubeCam = new THREE.PerspectiveCamera(28, 1, 0.1, 20);
const FACE_LABELS = ['DERECHA', 'IZQUIERDA', 'ARRIBA', 'ABAJO', 'FRENTE', 'ATRÁS'];   // +X −X +Y −Y +Z −Z
// Solo líneas y nombres, sin relleno; su color (negro o blanco) cambia según lo que hay detrás, como los menús
function faceTex(label) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.font = `500 ${label.length > 7 ? 21 : 26}px Outfit, Jost, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(label, 64, 66);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// el cubo invisible solo escribe profundidad (tapa las aristas y nombres de atrás) y sirve para saber qué se toca
const viewCube = new THREE.Mesh(new THREE.BoxGeometry(0.995, 0.995, 0.995), new THREE.MeshBasicMaterial({ colorWrite: false }));
const cubeInk = new THREE.Color('#0b0d10');
// Como el logotipo "Nodo": trazo de 1 px, las aristas se pasan de largo en las esquinas (como un dibujo técnico) y en la
// esquina de delante abajo a la derecha se detienen antes de un + azul grueso.
const PLUS_CORNER = new THREE.Vector3(0.5, -0.5, 0.5);
const cubeEdges = (() => {
  const pos = [], o = 0.2, gap = 0.2;
  let i = 0;
  for (const ax of [0, 1, 2]) for (const a of [-0.5, 0.5]) for (const b of [-0.5, 0.5]) {
    const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), [u, v] = [0, 1, 2].filter((k) => k !== ax);
    p0.setComponent(u, a).setComponent(v, b).setComponent(ax, -0.5);
    p1.copy(p0).setComponent(ax, 0.5);
    const d = new THREE.Vector3().setComponent(ax, 1), ext = o * (i++ % 3 === 1 ? 0.6 : 1);
    const end = (p, sgn) => (p.equals(PLUS_CORNER) ? p.clone().addScaledVector(d, -sgn * gap) : p.clone().addScaledVector(d, sgn * ext));
    const q0 = end(p0, -1), q1 = end(p1, 1);
    pos.push(q0.x, q0.y, q0.z, q1.x, q1.y, q1.z);
  }
  const g = new LineSegmentsGeometry(); g.setPositions(pos);
  return new LineSegments2(g, new LineMaterial({ color: cubeInk, linewidth: 1, resolution: new THREE.Vector2(92, 92), toneMapped: false }));
})();
const cubePlus = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#2f7bff';
  g.fillRect(0, 25, 64, 14); g.fillRect(25, 0, 14, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, toneMapped: false }));
  sp.position.copy(PLUS_CORNER); sp.scale.setScalar(0.27); sp.renderOrder = 3;
  return sp;
})();
const cubeLabels = FACE_LABELS.map((l, i) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.92), new THREE.MeshBasicMaterial({ map: faceTex(l), color: cubeInk, transparent: true, toneMapped: false }));
  const n = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]][i];
  m.position.set(...n).multiplyScalar(0.502);
  if (i === 2) m.rotation.x = -Math.PI / 2;        // ARRIBA se lee con FRENTE abajo (vista de arriba)
  else if (i === 3) m.rotation.x = Math.PI / 2;
  else m.lookAt(m.position.clone().multiplyScalar(2));
  return m;
});
viewCube.renderOrder = 0; cubeEdges.renderOrder = 1; cubeLabels.forEach((m) => (m.renderOrder = 1));
const cubeHot = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: '#2f7bff', transparent: true, opacity: 0.32, toneMapped: false, depthTest: false }));
cubeHot.renderOrder = 2; cubeHot.visible = false;
// ejes junto a la esquina de atrás abajo a la izquierda: X rojo, Y verde, Z azul
cubeScene.add(viewCube, cubeEdges, ...cubeLabels, cubeHot, cubePlus);
// muestra invisible sobre el cubo: adaptInk le pone .ink-dark / .ink-light y de ahí sale el color de las líneas
const cubeProbe = document.createElement('div');
cubeProbe.className = 'cube-probe';
document.body.append(cubeProbe);
let cubeHover = null, cubeDrag = null, camAnim = null;
// con el panel derecho abierto (ya no tiene fondo) el cubo se oculta: quedaría detrás de su texto (el panel se esconde solo)
// con el panel fijado (chincheta) el cubo se corre a su izquierda
function panelOpen() { if (pinned) return false; const pr = $('panel').getBoundingClientRect(); return pr.width > 0 && pr.left < innerWidth - 60; }
function cubeRight(r) {
  if (!pinned) return CUBE_RIGHT;
  const pr = $('panel').getBoundingClientRect();
  return pr.width ? Math.max(CUBE_RIGHT, r.right - pr.left + 14) : CUBE_RIGHT;
}
function cubeRect(p) { const r = renderer.domElement.getBoundingClientRect(); return { x: r.left + p.x + p.w - CUBE_PX - cubeRight(r), y: r.top + CUBE_TOP, s: CUBE_PX }; }
function placeCubeCam() { cubeCam.quaternion.copy(camera.quaternion); cubeCam.position.copy(viewDir()).multiplyScalar(-4.2); cubeCam.updateMatrixWorld(); }
// región del cubo bajo el cursor (cara, arista o esquina) como dirección con componentes −1, 0 o 1
function cubeRegionAt(x, y) {
  if (prefs.viewCube === false || carousel || layout === 'render' || panelOpen()) return null;
  for (const p of panes()) {
    if (p.kind === 'render') continue;
    const c = cubeRect(p);
    if (x < c.x || x > c.x + c.s || y < c.y || y > c.y + c.s) continue;
    placeCubeCam();
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(((x - c.x) / c.s) * 2 - 1, -((y - c.y) / c.s) * 2 + 1), cubeCam);
    const hit = rc.intersectObject(viewCube, false)[0];
    if (!hit) return { pane: p, dir: null };
    const k = (v) => (v > 0.3 ? 1 : v < -0.3 ? -1 : 0), q = hit.point;
    return { pane: p, dir: new THREE.Vector3(k(q.x), k(q.y), k(q.z)) };
  }
  return null;
}
const DIR_NAMES = { '1,0,0': 'DERECHA', '-1,0,0': 'IZQUIERDA', '0,1,0': 'ARRIBA', '0,-1,0': 'ABAJO', '0,0,1': 'FRENTE', '0,0,-1': 'ATRÁS' };
// Lleva la cámara a mirar desde la dirección dir (desde el pivote hacia la cámara), con una animación corta
function goToView(dir, ortho) {
  const d = dir.clone().normalize(), dist = camera.position.distanceTo(pivot);
  const up = Math.abs(d.y) > 0.99 ? new THREE.Vector3(0, 0, -Math.sign(d.y)) : new THREE.Vector3(0, 1, 0);
  const q1 = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(d, new THREE.Vector3(), up));
  if (!ortho) setProjection(false);
  camAnim = { q0: camera.quaternion.clone(), q1, dist, t0: performance.now(), dur: 420, ortho };
}
function stepCamAnim(now) {
  const a = camAnim;
  if (!a) return;
  const t = Math.min(1, (now - a.t0) / a.dur), e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
  camera.quaternion.slerpQuaternions(a.q0, a.q1, e);
  camera.position.copy(pivot).addScaledVector(viewDir(), -a.dist);
  if (t >= 1) { camAnim = null; if (a.ortho) setProjection(true, true); }
}
function renderViewCube(p) {
  if (prefs.viewCube === false || p.kind === 'render' || panelOpen()) return;
  const S = CUBE_PX, x = p.x + p.w - S - cubeRight(renderer.domElement.getBoundingClientRect()), y = p.h - S - CUBE_TOP;
  placeCubeCam();
  const hv = cubeHover?.pane.x === p.x ? cubeHover.dir : null;
  cubeHot.visible = !!hv;
  if (hv) {
    const sz = (c) => (c ? 0.22 : 0.62), ps = (c) => c * 0.4;
    cubeHot.scale.set(sz(hv.x), sz(hv.y), sz(hv.z));
    cubeHot.position.set(ps(hv.x), ps(hv.y), ps(hv.z)).multiplyScalar(1.03);
  }
  cubeInk.set(cubeProbe.classList.contains('ink-light') ? '#f4f5f7' : '#0b0d10');
  cubeEdges.material.color.copy(cubeInk);
  cubePlus.visible = PLUS_CORNER.dot(viewDir()) < 0.15;   // el + solo cuando su esquina mira hacia la cámara
  cubeLabels.forEach((m) => m.material.color.copy(cubeInk));
  renderer.setViewport(x, y, S, S); renderer.setScissor(x, y, S, S);
  renderer.autoClear = false; renderer.clearDepth();
  const tm = renderer.toneMapping;
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(cubeScene, cubeCam);
  renderer.toneMapping = tm; renderer.autoClear = true;
}
addEventListener('pointerdown', (e) => {
  if (e.target !== renderer.domElement || e.button !== 0) return;
  const h = cubeRegionAt(e.clientX, e.clientY);
  if (!h) return;
  e.stopImmediatePropagation(); e.preventDefault();
  cubeDrag = { x: e.clientX, y: e.clientY, moved: false, h };
}, true);
addEventListener('pointermove', (e) => {
  if (cubeDrag) {
    const dx = e.clientX - cubeDrag.x, dy = e.clientY - cubeDrag.y;
    if (!cubeDrag.moved && Math.hypot(dx, dy) < 3) return;
    if (!cubeDrag.moved && proj.temp) setProjection(false);
    cubeDrag.moved = true; cubeDrag.x = e.clientX; cubeDrag.y = e.clientY;
    camAnim = null;
    tumble(dx, dy);
    return;
  }
  if (e.buttons) return;
  const h = cubeRegionAt(e.clientX, e.clientY), was = !!cubeHover;
  cubeHover = h?.dir ? h : null;
  if (was !== !!cubeHover) renderer.domElement.style.cursor = cubeHover ? 'pointer' : '';
}, true);
addEventListener('pointerup', (e) => {
  const c = cubeDrag;
  if (!c) return;
  cubeDrag = null;
  e.stopImmediatePropagation();
  if (c.moved || !c.h.dir) return;
  const faces = Math.abs(c.h.dir.x) + Math.abs(c.h.dir.y) + Math.abs(c.h.dir.z);
  goToView(c.h.dir, faces === 1);
}, true);
// botón PERSP / ORTO debajo del cubo y nombre de la vista en la barra de estado
const projBtn = document.createElement('button');
projBtn.className = 'proj-btn';
projBtn.title = 'Perspectiva u ortogonal. Con PERSP, elegir una cara del cubo da una vista ortogonal que vuelve a perspectiva al girarla.';
document.body.append(projBtn);
// ortogonal fija: se queda aunque la vista no esté de frente a un lado (girar no la quita). Botón, Shift+O o Vistas.
function toggleOrtho() {
  proj.keep = !proj.keep; prefs.ortho = proj.keep; savePrefs(); setProjection(proj.keep);
  toast(proj.keep ? 'Vista ortogonal fija: se queda al girar (Shift+O para volver a perspectiva)' : 'Perspectiva');
}
projBtn.addEventListener('click', toggleOrtho);
function viewName() {
  const d = viewDir().negate(), k = [d.x, d.y, d.z].map((v) => (Math.abs(v) > 0.9995 ? Math.sign(v) : 0));
  const face = Math.abs(k[0]) + Math.abs(k[1]) + Math.abs(k[2]) === 1 ? DIR_NAMES[k.join(',')] : null;
  return (proj.ortho ? 'ORTOGONAL' : 'PERSPECTIVA') + (face ? ' · ' + face : '');
}
function updateViewName() {
  const n = viewName(), el = $('vi-proj');
  if (el && el.textContent !== n) el.textContent = n;
  const t = proj.ortho ? 'ORTO' : 'PERSP';
  if (projBtn.textContent !== t) projBtn.textContent = t;
  projBtn.setAttribute('aria-pressed', String(proj.keep));
  const p = panes().find((x) => x.kind !== 'render');
  projBtn.hidden = !p || prefs.viewCube === false || !!carousel || layout === 'render' || panelOpen();
  if (p && !projBtn.hidden) {
    const c = cubeRect(p);
    projBtn.style.left = c.x + c.s / 2 + 'px'; projBtn.style.top = c.y + c.s + 4 + 'px';
    Object.assign(cubeProbe.style, { left: c.x + 'px', top: c.y + 'px', width: c.s + 'px', height: c.s + 'px' });
  }
  cubeProbe.hidden = projBtn.hidden;
}
if (prefs.ortho) { proj.keep = true; setProjection(true); }

// ---------- Dibujo de cada cuadro ----------
function renderPane(p) {
  renderer.setViewport(p.x, 0, p.w, p.h);
  renderer.setScissor(p.x, 0, p.w, p.h);
  useAspect(p);
  if (p.kind === 'forge') return renderForgePane(p);
  const diag = p.kind !== 'render';                 // MODELADO e IA usan los shaders de evaluación
  const dm = diagMaterial(), wire = diag && diagMode === 'wire';
  if (wire) { const c = theme === 'dark' ? 0xe8e8e8 : 0x1b1d21; wireLineMat.color.setHex(c); wireFeatMat.color.setHex(c); }
  if (fil?.preview) fil.preview.material = diag && !wire ? dm : materials[fil.items[0].mat];
  objects.forEach((o) => {
    if (o.kind === 'curve') return;
    o.parts.mesh.material = diag ? dm : materials[o.mat];
    if (o.parts.mesh.castShadow === wire) { o.parts.mesh.castShadow = !wire; renderer.shadowMap.needsUpdate = true; }   // el wireframe no da sombra
    if (o.kind === 'mesh') meshFeatures(o, wire);
  });
  scene.background = !diag && envBg ? scene.environment : null;
  renderer.toneMapping = diag ? THREE.ACESFilmicToneMapping : TONES[toneKey];
  scene.environment = diag ? envTexture('studio') : envTexture(envKey);
  camera.layers.set(0);
  if (diag) camera.layers.enable(DIAG);
  renderer.render(scene, camera);
}
// aristas vivas de una malla (ángulo > 30°) para el modo Malla; se recalculan si la malla se movió
function meshFeatures(o, show) {
  const p = o.parts, pos = o.data.geometry.attributes.position;
  if (show && o.visible && o.featVer !== pos.version + ':' + pos.count) {
    if (!p.feat) { p.feat = new THREE.LineSegments(new THREE.BufferGeometry(), wireFeatMat); p.feat.layers.set(DIAG); scene.add(p.feat); }
    setGeo(p.feat, new THREE.EdgesGeometry(o.data.geometry, 30));
    o.featVer = pos.version + ':' + pos.count;
  }
  if (p.feat) p.feat.visible = show && o.visible;
}
function diagMaterial() {
  if (ENV_MODES[diagMode]) { envDiagMat.uniforms.uMode.value = ENV_MODES[diagMode]; return envDiagMat; }
  return diagMode === 'curv' ? curvMat : diagMode === 'wire' ? wireMat : zebraMat;
}
// Etiqueta junto al cursor mientras mover/rotar/escalar con los botones del ratón está activo (como la línea de ayuda de Alias)
const xfPrompt = document.createElement('div');
xfPrompt.className = 'xf-prompt'; xfPrompt.hidden = true;
document.body.append(xfPrompt);
function updateXfPrompt() {
  const on = $('quickpick').hidden && mouseXform && prefs.xform !== 'gizmo' && tool === 'select' && !pivotEdit && !carousel && !MENUS.some((m) => m.open) && hasTransformable();
  xfPrompt.hidden = !on;
  if (!on) return;
  const txt = xform === 'scale' ? 'ESCALAR <i>izq</i> todo · <i>medio</i> Y · <i>der</i> X Z'
    : `${xform === 'rotate' ? 'ROTAR' : 'MOVER'} <i>izq</i> X · <i>medio</i> Y · <i>der</i> Z`;
  if (xfPrompt.dataset.t !== txt) { xfPrompt.innerHTML = txt; xfPrompt.dataset.t = txt; }
  xfPrompt.style.transform = `translate(${lastPtr.x + 18}px, ${lastPtr.y + 20}px)`;
}
// Color del texto de los menús según lo que tiene detrás: se leen los píxeles de la vista bajo cada rótulo
// (donde no hay objeto se ve el muro) y el texto pasa entero a negro o a blanco.
let inkT = 0;
const INK_SEL = '.cube-probe:not([hidden]), .proj-btn, .app .panel .sec > *, .app .panel .panel-head, .app[data-layout-now="forge"] .panel .bf-ui details.grp > summary, .app[data-layout-now="forge"] .panel .bf-ui .grp-body > *, .app[data-layout-now="forge"] .bf-hud .chip:not([hidden]), .app[data-layout-now="forge"] .bf-loader:not([hidden]), #toolwin:not([hidden]) .tw-head, #toolwin:not([hidden]) .tw-body > *, #quickpick:not([hidden]) > b, #layers-win:not([hidden]) .fw-head, #layers-win:not([hidden]) .ly-head, #layers-win:not([hidden]) .ly-item, #layers-win:not([hidden]) .ol-item, #layers-win:not([hidden]) .fw-body > p, .puck:not([hidden]) .puck-item span, .puck:not([hidden]) .puck-center, #rel-labels:not([hidden]) .rel-label, .top .brand, .top .mb-btn, .top .seg button, .top .tag, .top .file, .pane-head .pane-title, .status > span, .status .viewinfo > span, .mb-drop:not([hidden]) .mb-item, .mb-drop:not([hidden]) .mb-title';
function adaptInk(now) {
  if (now - inkT < 250) return;
  inkT = now;
  const cv = renderer.domElement, gl = renderer.getContext(), r = cv.getBoundingClientRect(), k = cv.width / Math.max(1, r.width);
  const bgL = theme === 'light' ? 0.86 : 0.1;
  for (const el of document.querySelectorAll(INK_SEL)) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const x0 = Math.max(0, Math.floor((b.left - r.left) * k)), x1 = Math.min(cv.width, Math.ceil((b.right - r.left) * k));
    let sum = 0, n = 0;
    for (const f of [0.35, 0.65]) {
      const y = Math.floor(cv.height - (b.top + b.height * f - r.top) * k);
      if (x1 <= x0 || y < 0 || y >= cv.height) continue;
      const buf = new Uint8Array((x1 - x0) * 4);
      gl.readPixels(x0, y, x1 - x0, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      // el lienzo es transparente donde no hay objeto (color premultiplicado): ahí cuenta el muro
      for (let i = 0; i < buf.length; i += 4) { sum += (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255 + (1 - buf[i + 3] / 255) * bgL; n++; }
    }
    let L = n ? sum / n : bgL;
    // bajo un velo desenfocado se ve una mezcla del tinte del fondo y de lo de detrás
    const t = +(el.closest('[data-ink-tint]')?.dataset.inkTint || 0);
    if (t) L = t * bgL + (1 - t) * L;
    el.classList.toggle('ink-dark', L > 0.5);
    el.classList.toggle('ink-light', L <= 0.5);
  }
}
// velo desenfocado detrás del panel derecho (sigue al panel mientras entra y sale)
const panelVeil = document.createElement('div');
panelVeil.className = 'soft-veil';   // (oculto por CSS: el usuario quiere el panel sin fondo)
$('panel').before(panelVeil);   // misma capa que el panel, justo detrás
function placePanelVeil() {
  const r = $('panel').getBoundingClientRect(), on = r.width > 0 && r.left < innerWidth - 4;
  panelVeil.hidden = !on;
  if (on) Object.assign(panelVeil.style, { left: r.left - 30 + 'px', top: r.top - 30 + 'px', width: r.width + 60 + 'px', height: r.height + 60 + 'px' });
}
// ---------- Redondear (fillet) y chaflán como en Plasticity ----------
// Las superficies elegidas (o todas las visibles) se cosen en OpenCascade; se ven sus aristas vivas y se eligen con clic
// (Ctrl/Shift o botón medio: añadir o quitar). El punto amarillo da la distancia: hacia dentro = redondeo, hacia fuera =
// chaflán. V añade un punto de radio variable donde está el cursor. Enter / clic derecho / Aceptar: el resultado sustituye
// a las superficies de origen por superficies NURBS exactas (con sus recortes); Esc cancela.
let fil = null;
const filEdgeMat = LM({ color: 0x9aa4b2, linewidth: 1.4, transparent: true, opacity: 0.75 });
const filSelMat = LM({ color: 0x2f7bff, linewidth: 3.5 });
const filHovMat = LM({ color: 0xffa31a, linewidth: 3.5 });
const filGroup = new THREE.Group();
scene.add(filGroup);
const filDot = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd400, depthTest: false }));
filDot.renderOrder = 20;
const filVarDots = new THREE.Group();
filGroup.add(filDot, filVarDots);
filGroup.visible = false;
const filOpts = () => ({ r: Math.abs(fil.dist), kind: fil.dist < 0 ? 'chamfer' : 'fillet' });
async function startFillet() {
  const items = (selObjs.some((o) => o.kind === 'surface') ? selObjs : objects).filter((o) => o.kind === 'surface' && o.visible);
  if (!items.length) return toast('Redondear: no hay superficies. Elige las superficies que comparten la arista (o deja nada elegido para usar todas).');
  setTool('select');
  toast('Preparando el núcleo CAD para redondear…');
  let oc;
  try { oc = await getOCC(); } catch (e) { return toast(`Redondear: ${e.message}`); }
  let built;
  try { built = FL.makeShape(oc, items.map((o) => ({ id: o.id, data: o.data }))); } catch (e) { return toast(`Redondear: no se pudieron coser las superficies (${e.message || e})`); }
  const edges = FL.edgeList(oc, built.shape).filter((e) => !e.tangent);
  // de qué superficie de Forja sale cada cara de la arista (para la dirección "hacia dentro")
  edges.forEach((e) => { e.srcIds = e.faceShapes.map((f) => built.src.find((s) => s.face.IsSame(f))?.id); });
  if (!edges.length) return toast('Redondear: estas superficies no tienen aristas vivas compartidas (las uniones tangentes no se redondean).');
  fil = { oc, built, items, edges, sel: [], hover: -1, dist: toolDef.filDist ?? 0.1, vary: [], preview: null, drag: null, busy: false };
  tool = 'fillet';
  // todas las aristas candidatas en gris; las elegidas en azul
  const all = [];
  for (const e of edges) for (let k = 0; k < e.pts.length - 1; k++) all.push(...e.pts[k], ...e.pts[k + 1]);
  const g = new LineSegmentsGeometry(); g.setPositions(all);
  const base = new LineSegments2(g, filEdgeMat); base.renderOrder = 8;
  fil.lines = { base, sel: new LineSegments2(new LineSegmentsGeometry(), filSelMat), hov: new LineSegments2(new LineSegmentsGeometry(), filHovMat) };
  fil.lines.sel.renderOrder = fil.lines.hov.renderOrder = 9;
  filGroup.add(base, fil.lines.sel, fil.lines.hov);
  filGroup.visible = true;
  filRefresh();
  showFilletWin();
  toast(`Redondear: ${edges.length} aristas · clic en una arista para elegirla`);
}
const edgeSegs = (list) => { const a = []; for (const e of list) for (let k = 0; k < e.pts.length - 1; k++) a.push(...e.pts[k], ...e.pts[k + 1]); return a; };
function setSegs(l, a) { const g = new LineSegmentsGeometry(); if (a.length) g.setPositions(a); setGeo(l, g); l.visible = a.length > 0; }
// punto en la arista (t 0..1) y dirección "hacia dentro" (contra la suma de las normales de sus dos superficies)
function filEdgeFrame(e, t = 0.5) {
  const i = Math.min(e.pts.length - 2, Math.floor(t * (e.pts.length - 1))), f = t * (e.pts.length - 1) - i;
  const p = new THREE.Vector3(...e.pts[i]).lerp(new THREE.Vector3(...e.pts[i + 1]), f);
  const nrm = new THREE.Vector3();
  for (const id of e.srcIds || []) {
    const o = byId(id);
    const hit = o && nearestOnSurface(o, p);
    if (hit) nrm.add(hit.n);
  }
  if (nrm.lengthSq() < 1e-9) nrm.copy(p).sub(boundsOf(fil.items).getCenter(new THREE.Vector3())).negate();
  return { p, dir: nrm.normalize().negate() };
}
// normal de la superficie en el punto más cercano a p (búsqueda en una rejilla y refinado)
function nearestOnSurface(o, p) {
  const s = N.surfaceOf(o.data), q = new THREE.Vector3();
  let best = null;
  for (let i = 0; i <= 24; i++) for (let j = 0; j <= 24; j++) { s.getPoint(i / 24, j / 24, q); const d = q.distanceToSquared(p); if (!best || d < best.d) best = { d, u: i / 24, v: j / 24 }; }
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), h = 1e-3;
  const u = Math.min(1 - h, Math.max(h, best.u)), v = Math.min(1 - h, Math.max(h, best.v));
  s.getPoint(u, v, a); s.getPoint(u + h, v, b); s.getPoint(u, v + h, c);
  return { n: b.sub(a).cross(c.sub(a)).normalize() };
}
function filRefresh() {
  if (!fil) return;
  setSegs(fil.lines.sel, edgeSegs(fil.sel.map((i) => fil.edges[i])));
  setSegs(fil.lines.hov, fil.hover >= 0 && !fil.sel.includes(fil.hover) ? edgeSegs([fil.edges[fil.hover]]) : []);
  filDot.visible = fil.sel.length > 0;
  filVarDots.clear();
  if (fil.sel.length) {
    const { p, dir } = filEdgeFrame(fil.edges[fil.sel[0]]);
    fil.frame = { p, dir };
    filDot.position.copy(p).addScaledVector(dir, fil.dist);
    for (const [t] of fil.vary) { const d = new THREE.Mesh(filDot.geometry, filDot.material); d.position.copy(filEdgeFrame(fil.edges[fil.sel[0]], t).p); d.renderOrder = 20; filVarDots.add(d); }
  }
  const s = camera.position.distanceTo(filDot.position) * 0.012;
  filDot.scale.setScalar(s); filVarDots.children.forEach((d) => d.scale.setScalar(s * 0.7));
}
// arista bajo el ratón (distancia en pantalla a sus tramos, como mucho 10 px)
function filEdgeAt(e) {
  const pn = paneAt(e.clientX), r = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  const scr = (v) => { const q = new THREE.Vector3(...v).project(camera); return [r.left + pn.x + ((q.x + 1) / 2) * pn.w, r.top + ((1 - q.y) / 2) * pn.h, q.z]; };
  let best = -1, bd = 10, bt = 0;
  fil.edges.forEach((ed, i) => {
    const S = ed.pts.map(scr);
    for (let k = 0; k < S.length - 1; k++) {
      const [ax, ay, az] = S[k], [bx, by] = S[k + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      if (az > 1) continue;
      const t = Math.max(0, Math.min(1, ((e.clientX - ax) * dx + (e.clientY - ay) * dy) / L)), d = Math.hypot(e.clientX - ax - t * dx, e.clientY - ay - t * dy);
      if (d < bd) { bd = d; best = i; bt = (k + t) / (S.length - 1); }
    }
  });
  return { i: best, t: bt };
}
// distancia del punto amarillo según el ratón: proyección sobre la recta (arista, dirección hacia dentro) en pantalla
function filDistAt(e) {
  const pn = paneAt(e.clientX), r = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  const toScr = (v) => { const q = v.clone().project(camera); return new THREE.Vector2(r.left + pn.x + ((q.x + 1) / 2) * pn.w, r.top + ((1 - q.y) / 2) * pn.h); };
  const { p, dir } = fil.frame, a = toScr(p), b = toScr(p.clone().add(dir)), ab = b.clone().sub(a);
  const t = ab.lengthSq() > 4 ? new THREE.Vector2(e.clientX, e.clientY).sub(a).dot(ab) / ab.lengthSq() : 0;
  const snap = e.altKey ? 0.05 : 0.005;   // Alt: de 5 en 5 mm
  return Math.round(t / snap) * snap || snap;
}
// vista previa: el sólido redondeado como malla (con el sombreado de evaluación) en lugar de las superficies de origen
let filTimer = 0;
function filPreview(now = false) {
  clearTimeout(filTimer);
  if (!fil || !fil.sel.length) { filClearPreview(); return; }
  if (!now) { filTimer = setTimeout(() => filPreview(true), 60); return; }
  const t0 = performance.now();
  try {
    const res = FL.filletShape(fil.oc, fil.built.shape, fil.sel.map((i) => fil.edges[i]), { ...filOpts(), vary: fil.vary }, fil.built.src);
    fil.result = res;
    const m = FL.previewMesh(fil.oc, res.shape, Math.max(0.005, boundsOf(fil.items).getSize(new THREE.Vector3()).length() * 0.002));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3)); g.setIndex(new THREE.BufferAttribute(m.idx, 1)); g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(m.pos.length).fill(1), 3));
    if (!fil.preview) { fil.preview = new THREE.Mesh(g, materials[fil.items[0].mat]); fil.preview.castShadow = true; fil.preview.userData.filPreview = true; scene.add(fil.preview); }
    else setGeo(fil.preview, g);
    fil.items.forEach((o) => { o.parts.mesh.visible = false; o.parts.iso.visible = false; if (o.parts.bound) o.parts.bound.visible = false; });
    fil.error = null;
  } catch (err) {
    fil.result = null; fil.error = err.message || String(err);
  }
  fil.ms = performance.now() - t0;
  TW.render();
}
function filClearPreview() {
  if (!fil) return;
  if (fil.preview) { scene.remove(fil.preview); fil.preview.geometry.dispose(); fil.preview = null; }
  fil.result = null;
  fil.items.forEach(applyVisibility);
}
function showFilletWin() {
  const pct = (t) => Math.round(t * 100) + ' %';
  TW.show({
    title: 'Redondear (como Plasticity)',
    hint: () => !fil ? '' : !fil.sel.length ? 'Clic en una arista (Ctrl/Shift: añadir o quitar). Arrastra el punto amarillo: hacia dentro redondea, hacia fuera hace chaflán.'
      : fil.error ? `No cabe: ${fil.error}. Prueba con menos distancia.` : `${fil.sel.length} arista${fil.sel.length > 1 ? 's' : ''} · ${fil.dist < 0 ? 'chaflán' : 'redondeo'} ${Math.abs(fil.dist * 100).toFixed(1)} mm${fil.ms ? ` · ${Math.round(fil.ms)} ms` : ''} · V: radio variable · Enter: aceptar`,
    fields: [
      { type: 'seg', label: 'Forma', opts: [['fillet', 'Redondeo'], ['chamfer', 'Chaflán']], get: () => (fil?.dist < 0 ? 'chamfer' : 'fillet'), set: (v) => { fil.dist = (v === 'chamfer' ? -1 : 1) * Math.abs(fil.dist); filRefresh(); filPreview(true); } },
      { type: 'range', label: 'Distancia', min: 0.005, max: 1, step: 0.005, get: () => Math.abs(fil?.dist ?? 0.1), set: (v) => { fil.dist = Math.sign(fil.dist || 1) * v; toolDef.filDist = fil.dist; filRefresh(); filPreview(); }, fmt: (v) => (v * 100).toFixed(1) + ' mm' },
      ...(fil?.vary || []).map((pt, k) => ({ type: 'range', label: `Radio en ${pct(pt[0])}`, min: 0.005, max: 1, step: 0.005, get: () => pt[1], set: (v) => { pt[1] = v; filPreview(); }, fmt: (v) => (v * 100).toFixed(1) + ' mm' })),
    ],
    actions: [
      ...(fil?.vary.length ? [{ label: 'Quitar variables', run: () => { fil.vary = []; filRefresh(); filPreview(true); } }] : []),
      { label: 'Cancelar', run: () => endFillet(false) }, { label: 'Aceptar', primary: true, run: () => endFillet(true) },
    ],
  });
}
function endFillet(accept) {
  if (!fil) return;
  clearTimeout(filTimer);
  if (accept && fil.sel.length) {
    if (!fil.result) filPreview(true);
    if (!fil.result) { toast(`El redondeo no se pudo hacer: ${fil.error || 'sin resultado'}`); return; }
    const fitData = (grid) => N.fitSurface(grid.map((row) => row.map(([x, y, z]) => new THREE.Vector3(x, y, z))), 3, 3);
    let surfs;
    try { surfs = FL.toSurfaces(fil.oc, fil.result.shape, fitData, fil.result.origin, (d, u, v) => {
      const t = new THREE.Vector3(); N.surfaceOf({ ...d, cvs: d.cvs.map((row) => row.map((c) => new THREE.Vector4(c.x, c.y, c.z, c.w ?? 1))) }).getPoint(Math.min(1, u), Math.min(1, v), t);
      return [t.x, t.y, t.z];
    }); } catch (e) { toast(`No se pudo convertir el resultado: ${e.message || e}`); return; }
    checkpoint();
    const srcs = fil.items, made = [];
    // las superficies de origen se quitan antes, así las nuevas conservan su nombre, material, capa y grupo
    const info = new Map(srcs.map((o) => [o.id, { name: o.name, mat: o.mat, layer: o.layer, group: o.group }]));
    filClearPreview();
    srcs.forEach((o) => byId(o.id) && removeObject(o));
    let nFil = 0;
    const layer = activeLayer;
    for (const s of surfs) {
      const from = s.src != null ? info.get(s.src) : null;
      activeLayer = from ? from.layer : info.get(srcs[0].id).layer;
      const d = { ...s.data, cvs: s.data.cvs.map((row) => row.map((c) => new THREE.Vector4(c.x, c.y, c.z, c.w ?? 1))) };
      const o = addSurface(d, from ? from.name : 'Redondeo');
      o.name = from ? from.name : `${fil.dist < 0 ? 'Chaflán' : 'Redondeo'} ${++nFil}`;
      o.mat = (from || info.get(srcs[0].id)).mat; o.group = from?.group ?? null;
      made.push(o);
      // recortes: una curva sobre la superficie por lazo (fuera del borde exterior, dentro de cada agujero)
      for (const l of s.loops) {
        const cd = FF.cosCurveData(o.data, l.uv);
        cd.cos = { surf: o.id, uv: l.uv, closed: true, trim: l.trim, edge: true };
        const c = addCurve(cd, 'Borde de recorte');
        c.group = o.group;
      }
      updateObject(o);
    }
    activeLayer = layer;
    const n = fil.sel.length, kind = fil.dist < 0 ? 'Chaflán' : 'Redondeo';
    filCleanup();
    applySelection(made, 'replace');
    refreshOutliner();
    toast(`${kind} hecho en ${n} arista${n > 1 ? 's' : ''}: ${made.length} superficies NURBS (Ctrl+Z deshace)`);
    return;
  }
  filClearPreview();
  filCleanup();
}
function filCleanup() {
  for (const l of Object.values(fil.lines)) { l.geometry.dispose(); filGroup.remove(l); }
  filGroup.visible = false; fil = null; tool = 'select';
  TW.hide(); updateHint();
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!fil || e.altKey && e.shiftKey) return;   // Shift+Alt: navegar como siempre
  if (e.button === 2) { e.stopImmediatePropagation(); e.preventDefault(); endFillet(true); return; }
  // agarrar el punto amarillo
  if (fil.sel.length) {
    const pn = paneAt(e.clientX), r = renderer.domElement.getBoundingClientRect();
    useAspect(pn);
    const q = filDot.position.clone().project(camera), x = r.left + pn.x + ((q.x + 1) / 2) * pn.w, y = r.top + ((1 - q.y) / 2) * pn.h;
    if (Math.hypot(e.clientX - x, e.clientY - y) < 14) { e.stopImmediatePropagation(); e.preventDefault(); fil.drag = true; renderer.domElement.setPointerCapture(e.pointerId); return; }
  }
  const { i } = filEdgeAt(e);
  if (i < 0) return;   // fuera de las aristas: el clic sigue su camino (navegar)
  e.stopImmediatePropagation(); e.preventDefault();
  const add = e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1;
  if (add) { const k = fil.sel.indexOf(i); if (k >= 0) fil.sel.splice(k, 1); else fil.sel.push(i); }
  else fil.sel = fil.sel.length === 1 && fil.sel[0] === i ? [] : [i];
  fil.vary = [];
  filRefresh(); filPreview(true); showFilletWin();
}, true);
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!fil) return;
  if (fil.drag) { fil.dist = filDistAt(e); toolDef.filDist = fil.dist; filRefresh(); filPreview(); TW.render(); return; }
  const h = filEdgeAt(e);
  fil.hoverT = h.t;
  if (h.i !== fil.hover) { fil.hover = h.i; fil.hoverEdgeT = h.t; filRefresh(); }
});
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!fil || !fil.drag) return;
  fil.drag = false; saveToolDef(); filPreview(true);
});
renderer.domElement.addEventListener('contextmenu', (e) => { if (fil) e.preventDefault(); });
addEventListener('keydown', (e) => {
  if (!fil || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
  if (e.key === 'Escape') { e.stopImmediatePropagation(); endFillet(false); }
  else if (e.key === 'Enter') { e.stopImmediatePropagation(); endFillet(true); }
  else if (e.key.toLowerCase() === 'v' && !e.ctrlKey) {
    // radio variable en el punto de la arista bajo el cursor (en la primera arista elegida)
    e.stopImmediatePropagation();
    if (e.repeat) return;
    if (!fil.sel.length || fil.hover !== fil.sel[0]) { toast('V: pon el cursor sobre la primera arista elegida para añadir un punto de radio variable'); return; }
    fil.vary.push([Math.round(fil.hoverT * 100) / 100, Math.abs(fil.dist) * 1.8]);
    filRefresh(); filPreview(true); showFilletWin();
  }
}, true);

// ---------- Módulo FORGE: relieve físico, patrones y cortes exactos para impresión 3D ----------
// El modelado es el código de BumpForge (src/forge/engine.js); el visor, la cámara, el fondo, el panel y los menús son
// los de Forja. Sus objetos viven en forgeRoot, que solo se dibuja en la vista del módulo Forge (y en su lugar del carrusel).
const forgeRoot = new THREE.Group();
forgeRoot.visible = false;
scene.add(forgeRoot);
let forge = null, forgeLoading = null, forgeExposure = 1, forgeTone = THREE.ACESFilmicToneMapping, forgeToScene = false;
const forgeCtx = {
  renderer, camera, root: forgeRoot,
  controls: { target: pivot, autoRotate: false, enabled: true, update: () => false, addEventListener() {} },
  toast: (msg) => toast(msg),
  // Forge da la vista en sus unidades: se pasa a la escena de Forja con la colocación de la pieza
  setView: (pos, target) => {
    if (!forgeSource) return;   // sin pieza elegida, Forge no mueve la cámara
    placeForge(); forgeRoot.updateMatrixWorld(true);
    pos.applyMatrix4(forgeRoot.matrixWorld); target.applyMatrix4(forgeRoot.matrixWorld);
    pivot.copy(target); camera.position.copy(pos); camera.lookAt(target);
  },
  setExposure: (v) => { forgeExposure = v; },
  setTone: (k) => { forgeTone = k === 'agx' ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping; },
  active: () => layout === 'forge' && !carousel,
  // lo que Forge exporta se descarga como en Forja, o entra en la escena con "Enviar a Forja"
  deliver: async (base, bytes, ext) => {
    const name = `${base}.${ext}`;
    if (forgeToScene) { forgeToScene = false; await importFile(new File([bytes], name)); return `${name} está en la escena de Forja (Modelado / Visu)`; }
    await saveFile(name, new Blob([bytes]));
    return `Guardado ${name}`;
  },
};
function ensureForge() {
  if (forge) return Promise.resolve(forge);
  forgeLoading ||= import('./forge/engine.js')
    .then((m) => m.startForge(forgeCtx))
    .then((api) => { forge = api; return api; })
    .catch((e) => { console.error(e); toast(`Forge no pudo arrancar: ${e.message}`); forgeLoading = null; });
  return forgeLoading;
}
// Forge solo trabaja sobre objetos de la escena: la pieza ocupa el lugar de lo elegido (que se oculta en esta vista) y
// sin pieza elegida no se dibuja nada de Forge (ni su cubo de arranque).
let forgeSource = null;   // { ids, box } de lo que se trajo de Forja
const _fb = new THREE.Vector3(), _fc = new THREE.Vector3();
function placeForge() {
  const b = forge?.pieceBox();
  if (!b || b.isEmpty()) return;
  const size = b.getSize(_fb), c = b.getCenter(_fc), big = Math.max(size.x, size.y, size.z) || 1;
  if (forgeSource) {
    const sb = forgeSource.box, ss = sb.getSize(new THREE.Vector3()), s = Math.max(ss.x, ss.y, ss.z) / big;
    forgeRoot.scale.setScalar(s);
    forgeRoot.position.copy(sb.getCenter(new THREE.Vector3())).addScaledVector(c, -s);
  } else {
    const s = forge.sizeMm() / 100 / big, vis = objects.filter((o) => o.visible), sb = boundsOf(vis);
    const x = sb.isEmpty() ? 0 : sb.max.x + 0.3 + (size.x * s) / 2, z = sb.isEmpty() ? 0 : (sb.min.z + sb.max.z) / 2;
    forgeRoot.scale.setScalar(s);
    forgeRoot.position.set(x - c.x * s, -b.min.y * s, z - c.z * s);
  }
}
const forgePiece = () => !!(forge && forgeSource && forge.fromFile() && forgeSource.ready);
const forgeHidesSource = forgePiece;
// la vista de Forge: los objetos de Forja con sus materiales (como Visu) y la pieza de Forge con su exposición y tono
function renderForgePane(p) {
  if (forge) { placeForge(); forge.ground.visible = false; forge.grid.visible = false; }
  const hid = [];
  objects.forEach((o) => {
    if (o.kind !== 'curve') o.parts.mesh.material = materials[o.mat];
    if (forgeHidesSource() && (forgeSource.ids.includes(o.id) || o.id === forgeSource.resultId)) for (const part of Object.values(o.parts)) if (part.visible) { part.visible = false; hid.push(part); }
  });
  forgeRoot.visible = forgePiece();
  // en Forge no se mueve nada de Forja: sin manipulador ni marcas de pivote
  for (const x of [gizmo, objPivotMarkers, pivotMarker]) if (x.visible) { x.visible = false; hid.push(x); }
  scene.background = null;
  scene.environment = envTexture('studio');
  const expo = renderer.toneMappingExposure;
  renderer.toneMapping = forgeTone; renderer.toneMappingExposure = forgeExposure;
  camera.layers.set(0);
  if (carousel || !forgeCtx.onFrame?.()) renderer.render(scene, camera);
  renderer.toneMappingExposure = expo;
  forgeRoot.visible = false;
  hid.forEach((x) => (x.visible = true));
}
// la selección de Forja (o todo lo visible) pasa a Forge como su pieza: superficies NURBS en STEP (modo exacto), mallas en STL
async function forgeFromForja() {
  const list = selObjs.filter((o) => o.visible && o.kind !== 'curve');
  if (!list.length) return toast('Elige con clic un objeto o una superficie de la escena para trabajar sobre él.');
  const key = list.map((x) => x.id).join(',');
  if (forgeSource?.key === key || (list.length === 1 && list[0].id === forgeSource?.resultId)) return;
  const api = await ensureForge();
  if (!api) return;
  const o = { unit: 'mm', zUp: true }, nurbs = list.filter((x) => x.kind === 'surface');
  forgeSource = { key, ids: list.map((x) => x.id), box: boundsOf(list), ready: false };
  $('bf-pieceName').textContent = `Pieza: ${list.map((x) => x.name).join(', ')} · preparando…`;
  const file = nurbs.length === list.length
    ? new File([X.writeSTEP(nurbs, o, `${baseName()}.step`)], `${baseName()}.step`)
    : new File([new STLExporter().parse(meshExportScene(list, o), { binary: true })], `${baseName()}.stl`);
  await api.openFile(file);
}
// cuando Forge termina de preparar la malla de la pieza
forgeCtx.onPiece = () => {
  if (!forgeSource) return;
  forgeSource.ready = true;
  $('app').dataset.forgePiece = '1';
  $('bf-pieceName').textContent = `Pieza: ${forgeSource.ids.map((id) => byId(id)?.name || '¿?').join(', ')} · clic en otro objeto para cambiarla`;
};
// en Forge, elegir un objeto o superficie de la escena lo convierte en la pieza de trabajo
let forgePickT = 0;
function forgeSelectionChanged() {
  if (layout !== 'forge' || !selObjs.some((o) => o.kind !== 'curve')) return;
  clearTimeout(forgePickT);
  forgePickT = setTimeout(forgeFromForja, 350);
}
$('bf-pullForja').addEventListener('click', forgeFromForja);
$('bf-pushForja').addEventListener('click', () => forgeApply());
// Aplicar: el patrón de Forge se hornea en geometría real y entra en la escena en el lugar de la pieza. El resultado
// sustituye a los objetos de origen (se ocultan, Ctrl+Z lo deshace) y se ve en Modelado, Visu e IA. Volver a aplicar
// sobre la misma pieza actualiza el mismo objeto. Al salir de Forge se aplica solo si el patrón cambió.
let forgeApplying = false;
async function forgeApply(auto = false) {
  if (forgeApplying) return;
  if (auto && forgePiece()) $('app').dataset.forgeBusy = '1';   // el progreso de Forge se ve también en el módulo al que se va
  try { await forgeApplyNow(auto); } finally { delete $('app').dataset.forgeBusy; }
}
async function forgeApplyNow(auto) {
  if (!forgePiece()) { if (!auto) toast('Primero elige con clic el objeto o la superficie en la que quieres el patrón.'); return; }
  const src = forgeSource;
  // en modo NURBS el patrón elegido es una vista previa hasta cortarlo: se corta ahora (booleanas exactas)
  if (forge.pendingCut()) {
    forgeApplying = true;
    if (auto) toast('Cortando el patrón NURBS de Forge…');
    try { await forge.applyCut(); } finally { forgeApplying = false; }
    if (forgeSource !== src) return;
  }
  const stamp = forge.patternStamp();
  if (!stamp) { if (!auto) toast('No hay ningún patrón activo que aplicar: enciende una capa, un logo o un corte NURBS.'); return; }
  if (auto && stamp === src.applied) return;
  forgeApplying = true;
  if (auto) toast('Aplicando el patrón de Forge a la escena…');
  try {
    const g = await forge.resultGeometry();
    if (!g || forgeSource !== src) return;
    placeForge(); forgeRoot.updateMatrixWorld(true);
    g.applyMatrix4(forgeRoot.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    checkpoint();
    const old = byId(src.resultId), srcObjs = src.ids.map(byId).filter(Boolean);
    const layer = activeLayer;
    if (srcObjs[0]) activeLayer = srcObjs[0].layer;
    const base = srcObjs.length === 1 ? srcObjs[0].name : 'Pieza';
    const obj = addMesh(g, `${base} · patrón`);
    activeLayer = layer;
    obj.mat = old?.mat || srcObjs[0]?.mat || obj.mat;
    if (old) { obj.name = old.name; obj.group = old.group; removeObject(old); }
    obj.parts.mesh.material = materials[obj.mat];
    srcObjs.forEach((o) => { o.visible = false; applyVisibility(o); });
    src.resultId = obj.id; src.applied = stamp;
    applySelection([obj], 'replace');   // lo oculto deja de estar elegido
    refreshOutliner();
    toast(`${obj.name}: el patrón ya es geometría 3D (${Math.round((g.index ? g.index.count : g.attributes.position.count) / 3).toLocaleString('es')} triángulos) y se ve en todos los módulos`);
  } catch (e) {
    console.error(e); toast(`No se pudo aplicar el patrón: ${e.message || e}`);
  } finally { forgeApplying = false; }
}
function renderFrame(now) {
  if (layout === 'forge' && !carousel && forgeCtx.controls.autoRotate) tumble(1.2, 0);   // "Girar" de Forge
  stepCamAnim(now);
  placePanelVeil();
  updateViewName();
  updateDrawGrids();
  updateXfPrompt();
  pivotMarker.position.copy(pivot);
  pivotMarker.scale.setScalar(camera.position.distanceTo(pivot) * 0.06);
  pivotMarker.visible = navHeld || !!navDrag || now < pivotShowUntil;
  snapRing.quaternion.copy(camera.quaternion);
  snapRing.scale.setScalar(camera.position.distanceTo(snapRing.position) * 0.06);
  syncPivotMarkers();
  scaleHandles();
  if (relArrows.children.length) scaleRelArrows();
  placeRelLabels();
  renderer.shadowMap.needsUpdate = true;
  if (carousel) renderCarousel(now);
  else { panes().forEach(renderPane); panes().forEach(renderViewCube); }
  scene.backgroundIntensity = Math.min(1, (now - bgFadeT0) / 450);   // el fondo de VISU aparece suave tras el giro
  // El ratio de la cámara queda con el de la vista bajo el puntero, para que seleccionar y el gizmo coincidan.
  useAspect(dragPane || paneAt(lastPtr.x));
  adaptInk(now);
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

// Escena de ejemplo. Por defecto: un vaso hecho con 4 superficies de revolución unidas por sus bordes
// (base, cuerpo, labio enrollado y fondo interior), como el modelo de los videos de Alias.
// Con ?demo=capo se carga la escena antigua (capó + curva), que usan las pruebas automáticas.
if (new URLSearchParams(location.search).get('demo') === 'capo') {
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
  addCurve(N.curveData([[-3.25, 3.75], [-2, 2.75], [-0.5, 4.5], [1, 3], [2.25, 4.25], [3.25, 3.5]].map(([x, z]) => new THREE.Vector3(x, 0.01, z))));
} else {
  const P = (pts) => N.curveData(pts.map(([x, y]) => new THREE.Vector3(x, y, 0)), 3, 'xy');
  // Perfiles (radio, altura) en dm. Los CVs a ambos lados de cada unión están alineados: tangencia (G1).
  const parts = [
    ['Base', [[0, 0], [0.6, 0], [1.2, 0], [1.55, 0.05], [1.7, 0.35]]],
    ['Cuerpo', [[1.7, 0.35], [1.85, 0.65], [1.98, 1.5], [1.88, 2.5], [1.65, 3.1], [1.6, 3.3]]],
    ['Labio', [[1.6, 3.3], [1.55, 3.5], [1.42, 3.58], [1.3, 3.42], [1.3, 2.8], [1.25, 1.0]]],
    ['Fondo interior', [[1.25, 1.0], [1.22, 0.55], [0.9, 0.42], [0, 0.42]]],
  ];
  for (const [name, pts] of parts) addSurface(N.revolve(P(pts)), name).name = name;
}
refreshOutliner();
if (new URLSearchParams(location.search).get('demo') === 'asa') { objects.slice().forEach(removeObject); blendDemo(); }
clearHistory();
camera.position.set(8, 6.4, 10.5);
camera.lookAt(0, 0.6, 0.6);
pivot.set(0, 0.6, 0.6);

setNavStyle(navStyle);
setTheme(theme);
setLayout(layout);
setPinned(false);
frameObjects([]);
setTool('select');
selectionChanged();

renderer.setAnimationLoop(renderFrame);
window.__forja = { THREE, addSurface, startFillet, fil: () => fil, FL, camera, objects, panes, pivot, selObjs, selCVs, gizmo, proxy, carousel: () => carousel, runAI, relations, createAlign, createBlend, createSkin, createExtend, blendDemo, projectSelection, applySelection, addCurve, circleData, startEdgeOp, updateObject, undo, proj, setProjection, goToView, cubeRegionAt, forgeFromForja, forge: () => forge, setTool, setDrawPlane, snapToggles, HX, FF, TW: () => TW, arrows: () => relArrows.children, cvAll: () => { objects.forEach((o) => o.kind !== "mesh" && cvTargets.add(o.id)); selectionChanged(); } };
syncMaterialEditor();
showModule(layout);
window.__ready = true;
