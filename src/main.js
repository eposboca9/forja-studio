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
import * as N from './nurbs.js?v=0.47.0';
import { applyBackground, wallColorAt } from './concrete.js?v=0.39.3';
import { createPuck3 } from './puck3.js?v=0.50.0';
// versión visible (Ayuda › Acerca de). Los archivos que cambian llevan ?v= en su ruta para que el navegador no use una copia vieja guardada.
const FORJA_VERSION = '0.51.0';
import { drawLogo } from './logo.js';
import * as X from './exporters.js';
import * as AI from './ai.js';
import * as HX from './history.js?v=0.44.1';
import * as FF from './freeform.js?v=0.49.0';
import * as FL from './fillet.js?v=0.42.0';
import { getOCC } from './occ.js';
import { createAO } from './ao.js';
import { createBackend } from './render/backend.js';
import { BUILTIN, builtinMap, rollMap, thumb } from './envlib.js';
import { ALIAS_ENVS } from './env-alias.js';
import { probeWebGPU, describeProbe } from './render/webgpu-probe.js';
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
// Dos sistemas separados, como en Alias:
// 1) MAP TYPES = shaders de DIAGNÓSTICO para auditar la superficie mientras se modela. Sustituyen el material del objeto solo en la vista
//    de modelado. Showroom, Sky Shade y Abstracto usan los mapas de entorno reales de Alias (src/env-alias.js); Forja, Cebra y Curvatura
//    son shaders propios. Malla (alambre) no es un Map Type: es un interruptor aparte (tecla 3).
// 2) ENTORNOS DE RENDER = materiales PBR + HDRI (envLib). Se ajustan en Visu; en Modelado se pueden ver con "Sombreado realista"
//    (prefs.shadeReal, como Shade Quality de Alias) sin salir del módulo.
const MAP_TYPES = [
  { k: 'forja', label: 'Forja', key: '8' }, { k: 'showroom', label: 'Showroom', key: '4' }, { k: 'skyshade', label: 'Sky Shade', key: '5' },
  { k: 'abstract', label: 'Abstracto', key: '6' }, { k: 'zebra', label: 'Cebra', key: '1' }, { k: 'curv', label: 'Curvatura', key: '2' },
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
// sin preserveDrawingBuffer: conservar cada cuadro obliga a copiarlo y frena en muchos portátiles (adaptInk lee los píxeles justo tras dibujar)
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(window.__forjaPR || Math.min(Math.max(devicePixelRatio, 1.5), 2));   // window.__forjaPR: solo para pruebas automáticas   // en pantallas de baja densidad se dibuja a 1,5x y se reduce: bordes y líneas más limpios
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // la sombra se calcula una vez por cuadro aunque haya dos vistas
renderer.setScissorTest(true);
view.prepend(renderer.domElement);
$('loading').remove();

// Capa de render (src/render): main.js ya no dibuja los paneles directamente, se los pide al backend. Hoy el único es el clásico (WebGL, sin cambios);
// el nuevo (WebGPU) se enchufa aquí. renderPane y renderViewCube son las funciones de siempre (se declaran más abajo).
const backend = createBackend('webgl', { renderer, drawPane: (p) => renderPane(p), drawOverlay: (p) => renderViewCube(p), get camera() { return camera; }, get scene() { return scene; } });
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
// Biblioteca de entornos del panel: los 4 de siempre + los .hdr que cargue el usuario (item = { id, name, builtin?, map: { w, h, data } })
const envLib = { items: BUILTIN.map((b) => ({ id: b.id, name: b.name, builtin: true })), rot: 0, rotApplied: 0, int: 1, nextHdr: 1 };
const envMap = (it) => (it.map ||= builtinMap(it.id));
function envTexture(k, rot = 0) {
  const ck = k + '|' + rot;
  if (envCache[ck]) return envCache[ck];
  let tex;
  const custom = envLib.items.find((x) => x.id === k && !x.builtin);
  if (custom) {
    const mp = rollMap(custom.map, rot), dt = new THREE.DataTexture(mp.data, mp.w, mp.h, THREE.RGBAFormat, THREE.HalfFloatType);
    dt.mapping = THREE.EquirectangularReflectionMapping; dt.colorSpace = THREE.LinearSRGBColorSpace; dt.flipY = true;
    dt.minFilter = dt.magFilter = THREE.LinearFilter; dt.generateMipmaps = false; dt.needsUpdate = true;
    tex = pmrem.fromEquirectangular(dt).texture; dt.dispose();
  } else if (k === 'studio') { const re = new RoomEnvironment(renderer); re.rotation.y = THREE.MathUtils.degToRad(rot); tex = pmrem.fromScene(re, 0.04).texture; }
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
    u.sunPosition.value.setFromSphericalCoords(1, THREE.MathUtils.degToRad(sunset ? 87 : 52), THREE.MathUtils.degToRad(140 + rot));
    const sc = new THREE.Scene(); sc.add(sky);
    // suelo neutro para que la parte baja del reflejo no sea negra
    const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 48), new THREE.MeshBasicMaterial({ color: sunset ? 0x2a2018 : 0x3a3834 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1; sc.add(ground);
    tex = pmrem.fromScene(sc, 0.01).texture;
  }
  return (envCache[ck] = tex);
}
let envKey = 'studio', envBg = true;
scene.environment = envTexture('studio', 0);
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

// oclusión ambiental (Arcilla y Forja); se activa en Visualización › Oclusión ambiental
const ao = createAO(renderer, scene, camera);
const AO_MODES = new Set(['clay', 'forja']);
let aoLastKey = '', aoMovedAt = 0;
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(0.9, 12, 0.7);   // luz casi vertical: la sombra queda DEBAJO del objeto (como sombra de contacto) y no cambia de lado al girar la vista
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8 });
key.shadow.radius = 6;
scene.add(key);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.35 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.userData.noAO = true;   // el suelo no entra en el pase de oclusión: ensuciaba la sombra con ruido
scene.add(ground);
const grid = new THREE.GridHelper(30, 30, 0x8a8781, 0xa3a09a);
grid.position.y = 0.001;
grid.layers.set(DIAG);
const GRID_OP0 = 0.119;   // +15 % sobre 0,1035 (que ya era +15 % sobre 0,09); ajustable en Preferencias
grid.material.transparent = true; grid.material.opacity = GRID_OP0;
scene.add(grid);
const gridXY = new THREE.GridHelper(30, 30, 0x8a8781, 0xa3a09a);
gridXY.material.transparent = true; gridXY.material.opacity = GRID_OP0;
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
// Ejes como en Alias (Z arriba): X, Y (profundidad) y Z (altura), escritos en las coordenadas internas de Forja (Y arriba).
// Por dentro Forja sigue con Y arriba (los shaders aprobados y la escena cuentan con eso); lo que el usuario ve y usa es Z arriba,
// con el mismo cambio que los exportadores CAD: Alias (X, Y, Z) = Forja (x, -z, y).
const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)];
const toAlias = (p) => ({ x: p.x, y: -p.z, z: p.y });
let scaleNP = false;   // Scale (proporcional: los 3 botones escalan igual) o NonProportional Scale (izq X · medio Y · der Z)
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
  // el CV que se agarra (el más cercano al cursor): es ese el que cae en el snap, no el centro de todo lo elegido
  let anchorOff = new THREE.Vector3(), bd = Infinity;
  for (const cr of selectedCVRefs()) {
    const q = cvRef(cr), w = new THREE.Vector3(q.x, q.y, q.z), d = scr(w).distanceTo(new THREE.Vector2(e.clientX, e.clientY));
    if (d < bd) { bd = d; anchorOff = w.sub(a); }
  }
  mxDrag = { x: e.clientX, y: e.clientY, button: e.button, moved: false, dirs, e0: e, depth: camera.position.distanceTo(a), pane, anchorOff,
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
  if (xform === 'translate' && orthoLocked()) {
    // vistas 2D (Alias "F H V"): izq = libre en el plano de la vista, medio = horizontal, der = vertical; la profundidad no cambia
    const right = nearestAxis(camAxis(1, 0)), up = nearestAxis(camAxis(0, 1)), k = pxWorld(m.p0, 1);
    const c = m.button === 0 ? { normal: viewDir() } : { dir: m.button === 1 ? right : up };
    const modes = snapModes(e), sn = gizmoDrag && moveSnap(e, modes, gizmoDrag.ex, m.p0);
    if (sn) {
      const cc = isTopoSnap(sn) ? { free: true } : c;
      proxy.position.copy(constrainPt(sn.point.clone().sub(m.anchorOff), m.p0, cc)); showSnap(sn);
      gizmoDrag.collapse = pickMode === 'cv' && selCVs.size > 1 ? { P: sn.point.clone(), c: cc } : null;
    } else {
      hideSnap(); if (gizmoDrag) gizmoDrag.collapse = null;
      const mv = new THREE.Vector3();
      if (m.button !== 2) mv.addScaledVector(right, dx * k);
      if (m.button !== 1) mv.addScaledVector(up, -dy * k);
      proxy.position.copy(m.p0).add(mv);
    }
  } else if (xform === 'translate') {
    const d = m.dirs[m.button], L = d.lengthSq(), ax = AXES[m.button];
    // si el eje apunta a la cámara casi no se ve en pantalla: entonces se usa el movimiento vertical
    let t = L > 4 ? (dx * d.x + dy * d.y) / L : (-dy * m.depth) / m.pane.h;
    // snap combinado con la restricción del botón (como en Alias): solo se toma la componente del eje
    const modes = snapModes(e), sn = gizmoDrag && moveSnap(e, modes, gizmoDrag.ex, m.p0);
    // snap + eje del botón (Alias): el objeto se desliza por su carril; solo se toma la componente del eje
    if (sn) {
      const cc = isTopoSnap(sn) ? { free: true } : { dir: ax };
      proxy.position.copy(constrainPt(sn.point.clone().sub(m.anchorOff), m.p0, cc)); showSnap(sn);
      gizmoDrag.collapse = pickMode === 'cv' && selCVs.size > 1 ? { P: sn.point.clone(), c: cc } : null;
    } else { hideSnap(); if (gizmoDrag) gizmoDrag.collapse = null; proxy.position.copy(m.p0).addScaledVector(ax, t); }
  } else if (xform === 'rotate') {
    let ang = (dx - dy) * 0.012;
    if (snapModes(mods).grid) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);   // Alt: de 15 en 15 grados
    proxy.quaternion.copy(new THREE.Quaternion().setFromAxisAngle(AXES[m.button], ang).multiply(m.q0));
  } else {
    let k = Math.exp((dx - dy) * 0.006);
    if (snapModes(mods).grid) k = Math.max(0.25, Math.round(k / 0.25) * 0.25);
    const v = !scaleNP ? new THREE.Vector3(k, k, k) : new THREE.Vector3(1, 1, 1).addScaledVector(new THREE.Vector3(...AXES[m.button].toArray().map(Math.abs)), k - 1);
    proxy.scale.copy(m.s0).multiply(v);
  }
  gizmo.dispatchEvent({ type: 'objectChange' });
});
addEventListener('pointerup', (e) => {
  const m = mxDrag;
  if (!m) return;
  mxDrag = null;
  if (m.moved) { gizmo.dispatchEvent({ type: 'mouseUp', mode: xform }); hideSnap(); return; }
  // clic sin arrastrar: elegir, como siempre (con menú si hay líneas juntas)
  clickPick(e, howFor(e));
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
const pivotMarker = makeCross('#4fd1c5', 0.5, true);   // paleta Forja: pivotes y locators en turquesa
pivotMarker.visible = false;
scene.add(pivotMarker);
let pivotShowUntil = 0;
function setPivot(pt) {
  pivot.copy(pt);
  pivotShowUntil = performance.now() + 1500;
}

// ---------- Materiales ----------
const materials = {
  // Aerolite Metallic (de E_Carpaint_AEROLITHEMETALLIC.osb, pintura metálica de VRED): base verde-azulada muy oscura, escamas cian y barniz de rugosidad 0,08.
  // Valores del archivo (lineales): base (0.019, 0.066, 0.070), escamas (0.243, 0.546, 0.600), rugosidad 0,26, reflectividad de escama 0,75, barniz rugosidad 0,08.
  aerolite: new THREE.MeshPhysicalMaterial({ color: new THREE.Color().setRGB(0.085, 0.15, 0.17, THREE.LinearSRGBColorSpace), metalness: 0.7, roughness: 0.26, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide }),
  // azul candy: cuerpo casi negro y reflejos azules (metal de color bajo un barniz muy brillante)
  candy: new THREE.MeshPhysicalMaterial({ color: '#0a1d6e', metalness: 1, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, side: THREE.DoubleSide }),
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
const MAT_NAMES = { candy: 'Azul candy', aerolite: 'Aerolite metálico', paint: 'Pintura roja', black: 'Negro metalizado', pearl: 'Azul perlado', alu: 'Aluminio', chrome: 'Cromo', ceram: 'Cerámica', glass: 'Vidrio', plastic: 'Plástico negro', clay: 'Arcilla' };
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
// uLink = luz ligada a la cámara: el entorno gira con la vista, como "Link Light to Camera" en Alias. Por defecto APAGADO (luz fija en el mundo): con la luz ligada los brillos se quedan pegados a la pantalla y parece una textura pintada.
const envDiagMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uMode: { value: 1 }, uLink: { value: 0 }, uBase: { value: 1 }, uRim: { value: 1 }, uSharp: { value: 2.6 }, uBlue: { value: 1 }, uSpec: { value: 1 } },
  vertexShader: `
    varying vec3 vWN; varying vec3 vWP;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWP = wp.xyz;
      vWN = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform int uMode; uniform int uLink; uniform float uBase, uRim, uSharp, uBlue, uSpec;   // ajuste del modo Forja (Preferencias)
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
      vec3 nd = normalize(cross(dFdx(vWP), dFdy(vWP)));   // normal de reserva: en los polos de una superficie de revolución la normal del vértice sale indefinida (punto negro)
      vec3 n = normalize(vWN);
      if (!(dot(n, n) > 0.5)) n = nd;
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
      } else if (uMode == 5) {
        // FORJA, el modo de la marca: grafito azulado mate que absorbe la luz de frente; solo brilla en ángulos rasantes,
        // frío a un lado y azul Forja (#2f7bff) al otro, con el estudio reflejado nítido sobre bordes y biseles.
        // uBase = claridad de la base · uRim = fuerza del brillo rasante · uSharp = nitidez (más alto = más estrecho) ·
        // uBlue = cuánto azul de marca · uSpec = brillo puntual
        float graze = pow(1.0 - max(dot(ve, ne), 0.0), uSharp);
        float wrap = clamp(dot(ne, L) * 0.5 + 0.5, 0.0, 1.0);
        vec3 base = vec3(0.12, 0.125, 0.145) * (0.25 + 2.4 * wrap * wrap * wrap + 0.3 * dif2) * uBase + vec3(0.03, 0.034, 0.045) * hemi;
        float below = smoothstep(0.1, -0.7, ne.y);
        base *= 1.0 - 0.55 * below;
        float side = smoothstep(-0.35, 0.55, ne.x);                                   // lado de la pantalla hacia el que mira
        vec3 rim = mix(vec3(0.92, 0.94, 0.98), vec3(0.18, 0.48, 1.0), smoothstep(0.25, 0.75, side) * uBlue);
        vec3 env = showroom(r);
        float k = graze * (0.35 + 0.65 * fres);
        col = base + (env * 0.55 + vec3(0.45)) * rim * k * 0.9 * uRim * (1.0 - 0.6 * below) + vec3(0.25, 0.36, 0.6) * spec * 0.6 * uSpec;
      } else if (uMode == 4) {
        // ARCILLA (industrial y mate, como Plasticity) evaluada en el espacio MUNDO: hemisferio de cielo claro arriba y suelo oscuro abajo + una luz
        // principal fija. Al orbitar la cámara el degradado y la sombra recorren la pieza (el horizonte "barre" la superficie), sin puntos de luz afilados:
        // el brillo es muy ancho (rugosidad alta) y de poca intensidad. La lectura de volúmenes la completa la oclusión ambiental.
        float sky = smoothstep(-0.3, 0.7, ne.y);
        vec3 amb = mix(vec3(0.045, 0.045, 0.05), vec3(0.8, 0.82, 0.86), sky);
        float wrap = clamp(dot(ne, L) * 0.5 + 0.5, 0.0, 1.0);
        vec3 albedo = vec3(0.42, 0.43, 0.46);
        vec3 base = albedo * (amb * 0.5 + vec3(1.0) * wrap * wrap * 0.85 + 0.12 * dif2);
        vec3 broad = mix(vec3(0.03), vec3(0.62), smoothstep(-0.5, 0.5, r.y)) * (0.05 + 0.22 * fres);   // reflejo difuso del cielo, muy amplio
        col = base + broad + vec3(0.035) * pow(max(dot(ne, normalize(L + ve)), 0.0), 5.0);
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
const ENV_MODES = { showroom: 1, diffuse: 2, sky: 3, clay: 4, forja: 5 };
// Map Types con los mapas de entorno de Alias: el reflejo del mapa multiplicado por luz ambiente + difusa (Ambient Light / Diffuse Light
// de Alias, 0,5 y 0,5 por defecto) y opción de "Luz ligada a la cámara" (Link Light to Camera). El mapa es equirectangular (fila 0 = arriba).
const ALIAS_MAP_OF = { showroom: 'alias-showroom', skyshade: 'alias-diffuse', abstract: 'alias-abstract' };
const aliasTex = {};
const aliasTexReady = Promise.all(Object.entries(ALIAS_MAP_OF).map(([k, id]) => new Promise((done) => {
  const e = ALIAS_ENVS.find((x) => x.id === id);
  if (!e) return done();
  new THREE.TextureLoader().load('data:image/png;base64,' + e.png, (t) => {
    t.minFilter = t.magFilter = THREE.LinearFilter; t.generateMipmaps = false; t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    aliasTex[k] = t; sceneChangedAt = performance.now(); done();
  }, undefined, () => done());
})));
const mapTypeMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide,
  uniforms: { uMap: { value: null }, uAmb: { value: prefs.mtAmb ?? 0.5 }, uDif: { value: prefs.mtDif ?? 0.5 }, uLink: { value: prefs.mtLink ? 1 : 0 } },
  vertexShader: envDiagMat.vertexShader,
  fragmentShader: `
    uniform sampler2D uMap; uniform float uAmb, uDif; uniform int uLink;
    varying vec3 vWN; varying vec3 vWP;
    vec3 toEnv(vec3 d) { return uLink == 1 ? normalize((viewMatrix * vec4(d, 0.0)).xyz) : d; }
    vec3 envAt(vec3 d) {
      float u = atan(d.z, d.x) * 0.15915494 + 0.5;
      float t = 1.0 - acos(clamp(d.y, -1.0, 1.0)) * 0.31830989;
      return texture2D(uMap, vec2(u, t)).rgb;
    }
    void main() {
      vec3 n = vWN;
      if (!(dot(n, n) > 0.25)) n = cross(dFdx(vWP), dFdy(vWP));   // normal de reserva en los polos
      n = normalize(n);
      if (!gl_FrontFacing) n = -n;
      vec3 v = normalize(vWP - cameraPosition);
      vec3 r = toEnv(reflect(v, n)), ne = toEnv(n);
      float dif = max(dot(ne, normalize(vec3(-0.45, 0.7, 0.55))), 0.0);
      gl_FragColor = vec4(envAt(r) * (uAmb + uDif * dif), 1.0);
    }`,
});
mapTypeMat.extensions = { derivatives: true };
const DIAG_NAMES = { forja: 'FORJA', showroom: 'SHOWROOM', skyshade: 'SKY SHADE', abstract: 'ABSTRACTO', clay: 'ARCILLA', diffuse: 'DIFUSO', sky: 'SHADE-SKY', zebra: 'CEBRA', curv: 'CURVATURA', wire: 'MALLA' };
const curvMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
// Las líneas (curvas exactas) caen justo sobre una malla de triángulos: sin ayuda, la malla las tapa a tramos y se ven cortadas a rayas.
// Se empuja un poco hacia atrás todo lo que es superficie (como hace Plasticity) para que las líneas siempre ganen la prueba de profundidad.
for (const m of [envDiagMat, mapTypeMat, zebraMat, curvMat, ...Object.values(materials)]) { m.polygonOffset = true; m.polygonOffsetFactor = 1.5; m.polygonOffsetUnits = 2; }
// Modo Malla como el wireframe de Alias: las superficies no se pintan (siguen sirviendo para elegir) y solo se ven sus
// líneas: bordes, líneas de parche y curvas sobre superficie. Las mallas muestran solo sus aristas vivas, no los triángulos.
const wireMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, side: THREE.DoubleSide });
// Modo híbrido (WebGPU abajo + WebGL arriba): en el lienzo de WebGL las superficies solo escriben profundidad
const depthOnlyMat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1.5, polygonOffsetUnits: 2 });
// material de la superficie de un objeto en el panel actual; en modo híbrido la deja marcada para que el lienzo de WebGPU la pinte (color plano)
// Modos de modelado que ya viven en el motor nuevo (PBR con estudio HDR): FORJA = grafito azulado con barniz tenue; ARCILLA = gris mate
const GPU_DIAG = { forja: { color: 0x1d2028, pbr: [0, 0.36, 0.5, 0.16] }, clay: { color: 0x6a6b70, pbr: [0, 0.82, 0, 0.3], env: 'horizon' } };
// El motor híbrido SOLO toma Visu: los modos de modelado (Forja, Arcilla, Difuso, Shade-Sky...) se quedan con los shaders clásicos, que son los buenos.
const GPU_MODELING = false;
// Excepción pedida por el usuario (v0.37.2): el Map Type FORJA sí usa el motor híbrido cuando está activo (grafito negro brillante con los reflejos
// suaves de las cajas de luz del estudio, como en su video); Arcilla, Difuso, Shade-Sky y los demás siguen en los shaders clásicos.
const gpuDiag = () => (backend.hybrid && (GPU_MODELING || diagMode === 'forja') ? GPU_DIAG[diagMode] : null);
function setSurfaceMaterial(o, diag, dm, wire, hy = backend.hybrid && (!diag || !!gpuDiag())) {
  const mesh = o.parts.mesh, mt = materials[o.mat], gd = diag ? gpuDiag() : null;
  mesh.material = hy ? depthOnlyMat : diag ? dm : mt;
  mesh.userData.gpuSurf = hy && !wire;
  mesh.userData.gpuColor = gd ? gd.color : mt.color.getHex();
  mesh.userData.gpuEnv = gd?.env || 'studio';
  mesh.userData.gpuPbr = gd ? gd.pbr : [mt.metalness ?? 0, mt.roughness ?? 0.6, mt.clearcoat ?? 0, mt.clearcoatRoughness ?? 0.1];
}
const wireFeatMat = new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.8 });

const lineMats = [];
// (v0.51) líneas más finas, estilo Alias: todo grosor × LINE_K (mínimo 1 px)
const LINE_K = 0.68;
const LM = (o) => { const m = new LineMaterial({ alphaToCoverage: true, ...o, linewidth: Math.max(1, (o.linewidth ?? 1) * LINE_K) }); lineMats.push(m); return m; };   // alphaToCoverage: bordes de línea suaves con MSAA
const curveMat = LM({ color: 0x2b2a27, linewidth: 2.5 });
const curveSelMat = LM({ color: 0xe07a1f, linewidth: 3 });
const draftMat = LM({ color: 0xe07a1f, linewidth: 2 });
const edgeSelMat = LM({ color: 0xe07a1f, linewidth: 2.5 });
// Líneas de los parches (límites de cada span), siempre visibles en el diagnóstico
const isoMat = LM({ color: 0x4a8fe0, linewidth: 1.6 }); // líneas de parche en azul: se ven sobre cebra blanca y negra
const isoSelMat = LM({ color: 0xe07a1f, linewidth: 1.8 });
const wireLineMat = LM({ color: 0xe8e8e8, linewidth: 1.1 });   // líneas del modo Malla (blancas u oscuras según el tema)
// Colores del historial (como Alias): verde = tiene historial de construcción, rosa = depende de lo elegido, azul = sin historial
const isoHistMat = LM({ color: 0x48bb78, linewidth: 1.8 });   // paleta Forja: historial = verde #48BB78
const isoDepMat = LM({ color: 0xff5fb0, linewidth: 1.8 });
const curveHistMat = LM({ color: 0x48bb78, linewidth: 2.5 });
// bordes de recorte (límite entre caras): líneas finas y nítidas, como los filos de Plasticity
const edgeCurveMat = LM({ color: 0x1b1d21, linewidth: 1.1, transparent: true, opacity: 0.9 });
// aristas finas de cada cara (bordes de los parches) en ARCILLA, como el modo gris con aristas de Plasticity
const faceEdgeMat = LM({ color: 0x08090b, linewidth: 1.15, transparent: true, opacity: 0.85 });
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
const handleGeo = new THREE.SphereGeometry(2.2, 10, 8);
const handlePickMat = new THREE.MeshBasicMaterial({ visible: false });
const plusGeo = mergeGeometries([new THREE.BoxGeometry(1.2, 0.2, 0.055), new THREE.BoxGeometry(0.2, 1.2, 0.055)]);
const cornerGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
// (v0.51) CVs en AZUL por omisión (pedido del usuario); el elegido en ámbar claro brillante
const handleMat = new THREE.MeshStandardMaterial({ color: '#3182ce', roughness: 0.4, metalness: 0.1, depthTest: false, transparent: true, opacity: 0.85 });
const handleSelMat = new THREE.MeshStandardMaterial({ color: '#f6e05e', emissive: '#6b5a10', roughness: 0.4, metalness: 0.1, depthTest: false, transparent: true });

// ---------- Capas: color heredado, estado (elegible / referencia / inactiva) y simetría dinámica ----------
// Color de capa: las líneas (isoparamétricas, bordes, curvas) y el polígono de control de todo lo que hay en la capa toman su color.
// Una capa "inactiva" dibuja esas líneas atenuadas. Los materiales se cachean por color.
const layerById = (id) => layers.find((l) => l.id === id);
const layerMatCache = new Map();
function layerMats(L) {
  const dim = L.mode === 'inactive', col = L.color || '#8a8d93', key = col + (dim ? '|d' : '');
  let m = layerMatCache.get(key);
  if (!m) {
    const mk = (base) => { const m = LM({ color: col, linewidth: base.linewidth, transparent: dim, opacity: dim ? 0.38 : 1 }); m.resolution.copy(isoMat.resolution); return m; };   // sin copiar la resolución un cuadro dibuja líneas gigantes
    const hull = hullMat.clone(); hull.color.set(col); if (dim) hull.opacity = 0.3;
    const hullEdge = hullEdgeMat.clone(); hullEdge.color.set(col);
    m = { iso: mk(isoMat), bound: mk(wireLineMat), curve: mk(curveMat), edgeCurve: mk(edgeCurveMat), hull, hullEdge };
    layerMatCache.set(key, m);
  }
  return m;
}
const layerStyled = (L) => !!L && !!(L.color || L.mode === 'inactive');
const layerPickable = (o) => (layerById(o.layer)?.mode || 'pick') === 'pick';
// Simetría por capa: una instancia espejo EN VIVO (fantasmas que comparten la geometría y el material del original, sin copiar datos).
// Planos con los nombres de CAD (Z arriba, como Alias): XZ = plano central del coche; en Forja (Y arriba) es el plano z = 0.
const SYM_PLANES = { xz: [0, 0, 1], xy: [0, 1, 0], yz: [1, 0, 0] };
const SYM_NAMES = { xz: 'XZ (por defecto)', xy: 'XY', yz: 'YZ', custom: 'Plano personalizado' };
function symNormal(sym) {
  const a = sym.plane === 'custom' ? sym.n || [0, 0, 1] : SYM_PLANES[sym.plane] || SYM_PLANES.xz;
  const v = new THREE.Vector3(...a); return v.lengthSq() < 1e-9 ? new THREE.Vector3(0, 0, 1) : v.normalize();
}
function mirrorMatrix(n) {
  return new THREE.Matrix4().set(1 - 2 * n.x * n.x, -2 * n.x * n.y, -2 * n.x * n.z, 0, -2 * n.x * n.y, 1 - 2 * n.y * n.y, -2 * n.y * n.z, 0, -2 * n.x * n.z, -2 * n.y * n.z, 1 - 2 * n.z * n.z, 0, 0, 0, 0, 1);
}
const mirrorRoots = new Map();   // id de capa -> { group, ents: Map(id de objeto -> { obj, list: [{ s, g }] }), key }
function ghostOf(src) {
  const g = src.isLine2 ? new Line2(src.geometry, src.material) : src.isLineSegments2 ? new LineSegments2(src.geometry, src.material) : new THREE.Mesh(src.geometry, src.material);
  g.raycast = () => {}; g.castShadow = src.castShadow; g.receiveShadow = src.receiveShadow; g.renderOrder = src.renderOrder; g.layers.mask = src.layers.mask; g.frustumCulled = false;
  return g;
}
function syncGhosts() {
  if (!mirrorRoots.size && !layers.some((l) => l.sym?.on)) return;
  const active = layers.filter((l) => l.sym?.on);
  for (const [id, r] of mirrorRoots) if (!active.some((l) => l.id === id)) { scene.remove(r.group); mirrorRoots.delete(id); sceneChangedAt = performance.now(); }
  for (const L of active) {
    let r = mirrorRoots.get(L.id);
    if (!r) { r = { group: new THREE.Group(), ents: new Map(), key: '' }; r.group.matrixAutoUpdate = false; scene.add(r.group); mirrorRoots.set(L.id, r); sceneChangedAt = performance.now(); }
    const key = L.sym.plane + (L.sym.plane === 'custom' ? (L.sym.n || []).join(',') : '');
    if (key !== r.key) { r.key = key; r.group.matrix.copy(mirrorMatrix(symNormal(L.sym))); r.group.matrixWorldNeedsUpdate = true; sceneChangedAt = performance.now(); }
    const mine = objects.filter((o) => o.layer === L.id);
    for (const [oid, e] of r.ents) if (!mine.includes(e.obj)) { e.list.forEach((x) => r.group.remove(x.g)); r.ents.delete(oid); sceneChangedAt = performance.now(); }
    for (const o of mine) {
      let e = r.ents.get(o.id);
      if (!e) {
        const srcs = o.kind === 'surface' ? [o.parts.mesh, o.parts.iso, o.parts.bound, o.parts.tedge] : o.kind === 'curve' ? [o.parts.line] : [o.parts.mesh];
        e = { obj: o, list: srcs.map((sr) => ({ s: sr, g: ghostOf(sr) })) };
        e.list.forEach((x) => r.group.add(x.g)); r.ents.set(o.id, e); sceneChangedAt = performance.now();
      }
      for (const x of e.list) {
        x.g.visible = x.s.visible && o.visible;
        if (x.g.geometry !== x.s.geometry) x.g.geometry = x.s.geometry;
        if (x.g.material !== x.s.material) x.g.material = x.s.material;
        if (x.s.userData.gpuSurf !== undefined) { Object.assign(x.g.userData, { gpuSurf: x.s.userData.gpuSurf, gpuColor: x.s.userData.gpuColor, gpuPbr: x.s.userData.gpuPbr, gpuEnv: x.s.userData.gpuEnv }); }
      }
    }
  }
}

const HANDLE_PX = 5.5;   // píxeles de pantalla por unidad de la cruz (la cruz mide 1,2 unidades ≈ 6,6 px de punta a punta)
function makeHandle(corner, sel) {
  const h = new THREE.Mesh(handleGeo, handlePickMat);
  const shape = new THREE.Mesh(corner ? cornerGeo : plusGeo, sel ? handleSelMat : handleMat);
  shape.renderOrder = 10;
  h.add(shape);
  h.renderOrder = 10;
  return h;
}
// unidades de mundo que miden `px` píxeles de pantalla en el punto p (perspectiva y ortogonal)
function pxWorld(p, px) {
  const e = camera.projectionMatrix.elements, mi = camera.matrixWorldInverse.elements;
  const H = Math.max(200, renderer.domElement.clientHeight || 800);
  const vz = mi[2] * p.x + mi[6] * p.y + mi[10] * p.z + mi[14], vx = mi[0] * p.x + mi[4] * p.y + mi[8] * p.z + mi[12], vy = mi[1] * p.x + mi[5] * p.y + mi[9] * p.z + mi[13];
  return Math.max(1e-6, Math.abs(e[3] * vx + e[7] * vy + e[11] * vz + e[15])) * (2 / (e[5] * H)) * px;
}
function scaleHandles(only) {
  const groups = only ? [only] : objects.filter((o) => o.parts.handles.visible).map((o) => o.parts.handles);
  if (!only && draftHandles.visible) groups.push(draftHandles);
  // tamaño CONSTANTE en pantalla (perspectiva y ortogonal, con cualquier zoom): unidades de mundo por píxel = 2·w / (m5·alto),
  // con w = profundidad en la matriz de proyección (en ortogonal w = 1 y sale alto visible / alto en píxeles)
  const e = camera.projectionMatrix.elements, mi = camera.matrixWorldInverse.elements;
  const H = Math.max(200, renderer.domElement.clientHeight || 800), k = (2 / (e[5] * H)) * HANDLE_PX;
  for (const g of groups) for (const h of g.children) {
    const p = h.position, vz = mi[2] * p.x + mi[6] * p.y + mi[10] * p.z + mi[14], vx = mi[0] * p.x + mi[4] * p.y + mi[8] * p.z + mi[12], vy = mi[1] * p.x + mi[5] * p.y + mi[9] * p.z + mi[13];
    const w = e[3] * vx + e[7] * vy + e[11] * vz + e[15];
    h.scale.setScalar(Math.max(1e-6, Math.abs(w)) * k);
  }
}

const THEME_3D = {
  dark: { curve: 0xe2e8f0, grid: 0xffffff, iso: '#000000', shadow: 0.55 },
  light: { curve: 0x2b2a27, grid: 0x6e6b66, iso: '#0b0d10', shadow: 0.35 },
};
// la rejilla multiplica su color por el de los vértices (gris medio): en oscuro se deja blanca para que se vea clara sobre el fondo,
// y la opacidad lleva +15 % en oscuro y +5 % en claro sobre el valor de Preferencias
let gridBaseOp = GRID_OP0;
function applyGridOp() { const m = theme === 'dark' ? 1.32 : 1.21; for (const g of [grid, gridXY, gridYZ]) g.material.opacity = Math.min(1, gridBaseOp * m); }
function applyTheme3D() {
  const t = THEME_3D[theme];
  curveMat.color.setHex(t.curve);
  edgeCurveMat.color.setHex(theme === 'dark' ? 0xd6dae2 : 0x1b1d21);
  grid.material.color.setHex(t.grid); gridXY.material.color.setHex(t.grid); gridYZ.material.color.setHex(t.grid);
  ground.material.opacity = t.shadow;
  applyGridOp();
}
function setTheme(t) {
  theme = t;
  $('theme-switch')?.setAttribute('aria-pressed', String(t === 'light'));
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('forja-theme', t); } catch (e) { /* sin almacenamiento */ }
  document.querySelectorAll('[data-theme-btn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.themeBtn === t)));
  repaintWall();
  applyTheme3D();
}
document.querySelectorAll('[data-theme-btn]').forEach((b) => b.addEventListener('click', () => setTheme(b.dataset.themeBtn)));
$('theme-switch').addEventListener('click', () => setTheme(theme === 'dark' ? 'light' : 'dark'));

let diagMode = 'forja', layout = 'diag', matKey = 'candy', res = 90, combScale = 0.8;

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
  p.bound = new LineSegments2(new LineSegmentsGeometry(), wireLineMat);   // bordes (modo Malla y aristas); su visibilidad se decide en cada panel
  p.hull = new THREE.LineSegments(new THREE.BufferGeometry(), hullMat); p.hull.layers.set(DIAG);
  p.hullEdge = new THREE.LineSegments(new THREE.BufferGeometry(), hullEdgeMat); p.hullEdge.layers.set(DIAG);
  p.hull.add(p.hullEdge);   // hijo: se muestra y se oculta junto con el polígono
  p.edge = new Line2(new LineGeometry(), edgeSelMat); p.edge.renderOrder = 6;
  p.tedge = new LineSegments2(new LineSegmentsGeometry(), edgeCurveMat); p.tedge.renderOrder = 5;   // borde de los Trim por regiones
  p.handles = new THREE.Group();
  scene.add(p.mesh, p.iso, p.bound, p.hull, p.edge, p.tedge, p.handles);
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
  sceneChangedAt = performance.now();
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

// Teselado adaptable: mientras se edita se usa el básico (rápido); cuando se deja de tocar, tras un momento, las superficies y las
// curvas se vuelven a teselar más finas (silueta, líneas y reflejos nítidos) como hace Plasticity.
let tessMul = 1, refineT = 0;
let shadowEvery = false, sceneChangedAt = 0;   // shadowEvery: true = recalcular la sombra en todos los cuadros (solo para medir)
const TESS_HI = 2.4;   // (v0.51) teselado fino al quedarse quieto: uniones entre parches más continuas
function scheduleRefine() {
  clearTimeout(refineT);
  refineT = setTimeout(refineTess, 450);
}
function refineTess() {
  if (gizmoDrag || navDrag || restoring || extrudeDrag || fil) { scheduleRefine(); return; }
  if (tessMul === TESS_HI) return;
  tessMul = TESS_HI;
  // en trozos de ~25 ms para que una escena grande no congele la vista; si se vuelve a editar, se abandona
  const list = objects.filter((o) => o.kind === 'surface' || o.kind === 'curve');
  const step = () => {
    const t0 = performance.now();
    while (list.length && performance.now() - t0 < 25) {
      const o = list.shift();
      if (!objects.includes(o)) continue;
      if (o.kind === 'surface') updateSurface(o); else updateCurve(o);
      applyVisibility(o);
    }
    sceneChangedAt = performance.now();
    if (list.length && tessMul === TESS_HI) setTimeout(step, 0);
  };
  step();
}
function updateObject(obj) {
  sceneChangedAt = performance.now();
  if (tessMul !== 1) tessMul = 1;
  scheduleRefine();
  if (obj.kind === 'mesh') { applyVisibility(obj); return; }
  if (obj.kind === 'surface') updateSurface(obj); else updateCurve(obj);
  rebuildHandles(obj);
  applyVisibility(obj);
  if (!propagating && !restoring && relations.length && !(prefs.histLive === false && gizmoDrag)) propagateFrom(obj);
}

function updateSurface(obj) {
  const p = obj.parts, d = obj.data;
  const s = N.surfaceOf(d), R = Math.round(res * tessMul);   // R: teselado (más fino cuando no se está editando)
  let geo = new ParametricGeometry((u, v, t) => s.getPoint(u, v, t), R, R);
  if (diagMode === 'curv') curvatureColors(geo, R);
  // recortes: curvas sobre esta superficie con "Recortar" dentro o fuera
  const trims = objects.filter((c) => c.kind === 'curve' && c.data.cos?.surf === obj.id && c.data.cos.trim && c.data.cos.trim !== 'none')
    .map((c) => ({ loop: FF.trimLoop(c.data.cos), trim: c.data.cos.trim })).filter((x) => x.loop);
  const rm0 = trims.length ? FF.removedFn(trims) : null;
  // + regiones del Trim: cada etapa quita lo suyo (lo quitado por cualquiera de ellas queda quitado)
  const stages = trimStages(d), rrs = stages.map(FF.regionRemovedFn).filter(Boolean), rr = rrs.length ? (u, v) => rrs.some((f) => f(u, v)) : null;
  const rm = rm0 && rr ? (u, v) => rm0(u, v) || rr(u, v) : rm0 || rr;
  obj.removed = rm;
  if (rm) geo = FF.trimGeometry(geo, R, rm, (u, v) => { const q = new THREE.Vector3(); s.getPoint(u, v, q); return q; });
  setGeo(p.mesh, geo);
  // Isoparamétricas en los límites de cada span, como en Alias (sin lo recortado)
  const iso = [], S = Math.round(60 * tessMul), t = new THREE.Vector3();
  obj.isoLines = [];   // polilíneas de cada isoparamétrica interior (para el snap de curva)
  const seg = (uv, inner, meta) => {
    let line = null;
    for (let k = 0; k < S; k++) {
      const [u0, v0] = uv(k / S), [u1, v1] = uv((k + 1) / S);
      if (rm && rm((u0 + u1) / 2, (v0 + v1) / 2)) { line = null; continue; }
      s.getPoint(u0, v0, t); iso.push(t.x, t.y, t.z);
      if (inner) { if (!line) { obj.isoLines.push((line = [t.clone()])); line.iso = meta; } }
      s.getPoint(u1, v1, t); iso.push(t.x, t.y, t.z);
      if (inner) line.push(t.clone());
    }
  };
  const inside = (k) => k > 1e-6 && k < 1 - 1e-6;
  N.uniqueKnots(d.knotsU).forEach((u) => seg((a) => [u, a], inside(u), { dir: 'u', t: u }));
  N.uniqueKnots(d.knotsV).forEach((v) => seg((a) => [a, v], inside(v), { dir: 'v', t: v }));
  { const g = new LineSegmentsGeometry(); g.setPositions(iso); setGeo(p.iso, g); }
  // bordes de la superficie (modo Malla); los bordes de un recorte los dibuja su curva sobre superficie
  {
    const b = [], a = new THREE.Vector3(), c = new THREE.Vector3(), B = Math.round(80 * tessMul);
    const edge = (uv) => { for (let k = 0; k < B; k++) { const [u0, v0] = uv(k / B), [u1, v1] = uv((k + 1) / B); if (rm && rm((u0 + u1) / 2, (v0 + v1) / 2)) continue; s.getPoint(u0, v0, a); s.getPoint(u1, v1, c); b.push(a.x, a.y, a.z, c.x, c.y, c.z); } };
    edge((x) => [x, 0]); edge((x) => [x, 1]); edge((x) => [0, x]); edge((x) => [1, x]);
    const g = new LineSegmentsGeometry(); g.setPositions(b.length ? b : [0, 0, 0, 0, 0, 0]); setGeo(p.bound, g);
  }
  // borde del recorte por regiones: los tramos de cada corte que separan lo que se queda de lo quitado (los de los recortes con
  // curva sobre superficie ya los dibuja esa curva)
  {
    const b = [], a = new THREE.Vector3(), c = new THREE.Vector3(), e = 1.5e-3, inD = (u, v) => u > 0 && u < 1 && v > 0 && v < 1;
    if (rr) for (const st of stages) for (const l of st.loops) for (let k = 0; k < l.length; k++) {
      const [u0, v0] = l[k], [u1, v1] = l[(k + 1) % l.length];
      if (k === l.length - 1 && Math.hypot(u1 - u0, v1 - v0) > 0.05) continue;   // lazo abierto que se cierra por los bordes
      const mu = (u0 + u1) / 2, mv = (v0 + v1) / 2, L = Math.hypot(u1 - u0, v1 - v0) || 1, nu = -(v1 - v0) / L * e, nv = (u1 - u0) / L * e;
      if (!inD(mu + nu, mv + nv) || !inD(mu - nu, mv - nv) || rm(mu + nu, mv + nv) === rm(mu - nu, mv - nv)) continue;
      s.getPoint(u0, v0, a); s.getPoint(u1, v1, c); b.push(a.x, a.y, a.z, c.x, c.y, c.z);
    }
    const g = new LineSegmentsGeometry(); g.setPositions(b.length ? b : [0, 0, 0, 0, 0, 0]); setGeo(p.tedge, g);
    p.tedge.userData.empty = !b.length;
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
  const loop = [], E = Math.round(40 * tessMul);
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
  const crv = N.curveOf(d), pts = [], S = Math.round(200 * Math.max(1, tessMul));
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
    h.scale.setScalar(1e-6);   // hasta medirlo no se dibuja (antes nacía a escala 1 = CV gigante en el primer cuadro)
  }
  scaleHandles(g);   // tamaño correcto en pantalla desde el primer cuadro
}

function applyVisibility(obj) {
  sceneChangedAt = performance.now();
  const p = obj.parts, vis = obj.visible, sel = selObjs.includes(obj), cvMode = pickMode === 'cv';
  const LY = layerById(obj.layer), lm = layerStyled(LY) ? layerMats(LY) : null;   // color / estado de la capa
  // los CVs se ven en el modo CV (los de los objetos encendidos) y, en cualquier modo, en los objetos elegidos: al crear, mover o alinear
  // CVs por objeto: se encienden al elegirlo (obj.showCVs) y siguen encendidos aunque se elija otra cosa; se apagan con "Nada", Esc,
  // el clic en el vacío o Mostrar › Apagar CVs
  if (sel && obj.kind !== 'mesh') obj.showCVs = true;
  p.handles.visible = p.hull.visible = vis && !modelClean && ((cvMode && cvTargets.has(obj.id)) || ((sel || obj.showCVs) && obj.kind !== 'mesh'));
  const showFaces = prefs.showFaces !== false, showCurves = prefs.showCurves !== false;
  if (obj.kind === 'mesh') {
    p.mesh.visible = vis && showFaces;
  } else if (obj.kind === 'surface') {
    p.mesh.visible = vis && showFaces;
    const wire = diagMode === 'wire';
    p.iso.visible = vis && (wire || ($('show-iso').checked && !modelClean));
    p.iso.material = sel ? isoSelMat : lm ? lm.iso : histState(obj) === 'dep' ? isoDepMat : histState(obj) === 'hist' ? isoHistMat : wire ? wireLineMat : isoMat;
    if (p.bound) { p.bound.visible = vis && wire; p.bound.material = sel ? isoSelMat : lm ? lm.bound : wireLineMat; }
    p.hull.material = lm ? lm.hull : hullMat; p.hullEdge.material = lm ? lm.hullEdge : hullEdgeMat;
    p.edge.visible = vis && sel;
    if (p.tedge) { p.tedge.visible = vis && !p.tedge.userData.empty; p.tedge.material = lm ? lm.edgeCurve : edgeCurveMat; }
  } else {
    const curveOn = obj.data.cos?.edge || showCurves;   // los bordes de recorte son aristas, no curvas de construcción
    p.line.visible = vis && curveOn;
    p.line.material = sel ? curveSelMat : lm ? (obj.data.cos?.edge ? lm.edgeCurve : lm.curve) : histState(obj) === 'dep' ? curveDepMat : histState(obj) === 'hist' ? curveHistMat : obj.data.cos?.edge ? edgeCurveMat : curveMat;
    p.hull.material = lm ? lm.hull : hullMat;
    p.comb.visible = p.env.visible = vis && curveOn && $('show-comb').checked && !modelClean && !obj.data.cos?.edge;   // los bordes de recorte no llevan peine
  }
}

// ---------- Selección ----------
let pickMode = 'object';
// En modo CV solo se encienden los CVs de los objetos elegidos (como en Alias): los que estaban elegidos al pasar a CV,
// y los que se tocan con un clic en modo CV (clic = solo ese, Shift / medio = añadir).
const cvTargets = new Set();
// Filtro del modo Objetos (como Pick Curves / Pick Surfaces de Alias): null = todo, 'curve' o 'surface'
let pickFilter = null;
// filtros como los Pick de Alias: Curves, Surface, Mesh y Curve-on-Surface
const PICK_FILTERS = { curve: (o) => o.kind === 'curve' && !o.data?.cos, surface: (o) => o.kind === 'surface', mesh: (o) => o.kind === 'mesh', cos: (o) => o.kind === 'curve' && !!o.data?.cos };
const pickable = (o) => o.visible && layerPickable(o) && (!pickFilter || PICK_FILTERS[pickFilter](o));
const PICK_NAMES = { curve: 'curvas', surface: 'superficies', mesh: 'mallas', cos: 'curvas sobre superficie' };
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
  selObjs.length = 0; selCVs.clear();
  if (!toolIs('xform')) mouseXform = false;   // Mover / Rotar / Escalar siguen activos al cambiar entre Objetos y CVs
  selectionChanged(); updateHint();
}

// tocar un CV de un objeto elegido pasa a modo CV sin soltar la herramienta activa (Mover / Rotar / Escalar)
function enterCvMode() { const mx = mouseXform; setPickMode('cv'); mouseXform = mx; updateHint(); }
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
  if (awaitSel) awaitChanged();
}

// Gizmo: se coloca en el centro de lo seleccionado y mueve todos los CVs afectados a la vez
const gizmo = new TransformControls(camera, renderer.domElement);
gizmo.setSize(0.5);
// Z arriba como Alias: el eje vertical (Y interno) se pinta azul y el de profundidad (Z interno) verde
{ const seen = new Set(), R = 0xff0000, G = 0x00ff00, B = 0x0000ff;
  // vertical (Y interno) = azul Z de Alias; colores mate de la paleta Forja
  gizmo.traverse((o) => { const m = o.material; if (!m?.color || seen.has(m)) return; seen.add(m); const h = m.color.getHex(); if (h === G) m.color.setHex(0x3182ce); else if (h === B) m.color.setHex(0x38a169); else if (h === R) m.color.setHex(0xe53e3e); }); }
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
const XFORM_LABELS = { translate: 'Mover', rotate: 'Rotar', scale: 'Escalar' };
function setXform(m) {
  // Mover / Rotar / Escalar son herramientas: quitan la anterior. Arrastrar en el vacío sigue moviendo (no es un clic)
  beginTool('xform', { label: XFORM_LABELS[m], persist: true, cleanup: () => { mouseXform = false; updateHint(); } });
  xform = m; pivotEdit = false; mouseXform = true;
  gizmo.setMode(m);
  updateXformButtons(); attachGizmo();
}
function togglePivotEdit() {
  if (pivotEdit) { pivotEdit = false; toolDone('pivot'); gizmo.setMode(xform); updateXformButtons(); attachGizmo(); renderSelectionPanel(); return; }
  if (pickMode !== 'object' || !selObjs.length) return toast('Selecciona un objeto (modo Objetos) para editar su pivote.');
  beginTool('pivot', { label: 'Pivote', voidKill: false, cleanup: () => { if (pivotEdit) { pivotEdit = false; gizmo.setMode(xform); updateXformButtons(); attachGizmo(); renderSelectionPanel(); } } });
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
  if (hudOn) hudRefresh();
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
    if (g.collapse) g.items.forEach(({ v, orig }) => { const q = constrainPt(g.collapse.P, new THREE.Vector3(orig.x, orig.y, orig.z), g.collapse.c); v.x = q.x; v.y = q.y; v.z = q.z; });
    else g.items.forEach(({ v, orig }) => { v.x = orig.x + d.x; v.y = orig.y + d.y; v.z = orig.z + d.z; });
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
  if (pivotEdit) { updatePivotReadout(); if (hudOn) hudRefresh(); return; }
  pendingObjs = g.objs;
  if (!pendingUpdate) pendingUpdate = requestAnimationFrame(flushPending);
});

// ---------- Snap ----------
// Como en Alias: mantener Alt = rejilla, Ctrl = punto, Ctrl+Alt = curva (en Mac, Cmd hace de Alt).
// Los botones de arriba los dejan activos sin mantener teclas.
const snapToggles = { grid: false, curve: false, point: false, surface: false };
let gridStep = 1;   // snap a la rejilla: 1 dm = 100 mm, igual que las celdas dibujadas (cada celda = 100 × 100 mm)
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
    if (!ex.pivots?.has(o) && pickMode === 'object' && selObjs.includes(o)) out.push(o.pivot);   // solo los pivotes que se ven (los de lo elegido)
    if (o.parts.handles?.visible) allCVRefs(o).forEach((r) => { const v = cvRef(r); if (!ex.cvs?.has(v)) out.push(new THREE.Vector3(v.x, v.y, v.z)); });
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
    if (o.kind === 'curve') {
      if (!o.samples) continue;
      // evaluador exacto para afinar el snap deslizante: la curva matemática (o su superficie, si es una curva sobre superficie)
      const line = o.samples.slice(), n = line.length - 1, host = o.data.cos && byId(o.data.cos.surf);
      if (host) { const S = FF.surfEval(host.data), uv = o.data.cos.uv; if (uv.length === line.length) line.ev = (t) => { const x = t * (uv.length - 1), i = Math.min(uv.length - 2, Math.floor(x)), f = x - i; return S(uv[i][0] + (uv[i + 1][0] - uv[i][0]) * f, uv[i][1] + (uv[i + 1][1] - uv[i][1]) * f); }; }
      else { const c = N.curveOf(o.data); line.ev = (t) => c.getPoint(Math.min(1, Math.max(0, t))); }
      line.n = n; line.obj = o; out.push(line); continue;
    }
    const e = o.edgePts || [], E = (e.length - 1) / 4;   // el contorno son 4 bordes seguidos
    const S = o.kind === 'surface' ? FF.surfEval(o.data) : null;
    for (let k = 0; k < 4 && E >= 1; k++) {
      const l = e.slice(k * E, k * E + E + 1); l.obj = o; l.n = l.length - 1;
      // evaluador exacto del borde: se reconoce cuál de los 4 bordes (u0, u1, v0, v1) y en qué sentido es por sus extremos
      if (S) for (const ed of ['u0', 'u1', 'v0', 'v1']) {
        const uv = (t) => (ed[0] === 'u' ? [+ed[1], t] : [t, +ed[1]]), a0 = S(...uv(0)), a1 = S(...uv(1)), tol = 1e-4 + 1e-3 * a0.distanceTo(a1);
        if (a0.distanceTo(l[0]) < tol && a1.distanceTo(l[l.n]) < tol) { l.ev = (t) => S(...uv(Math.min(1, Math.max(0, t)))); l.edge = ed; break; }
        if (a1.distanceTo(l[0]) < tol && a0.distanceTo(l[l.n]) < tol) { l.ev = (t) => S(...uv(1 - Math.min(1, Math.max(0, t)))); l.edge = ed; l.rev = true; break; }
      }
      out.push(l);
    }
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
          if (d < bestD) { bestD = d; best = { point: line[i - 1].clone().lerp(line[i], t), kind: 'curva', line, i, f: t }; }
        }
        prev = s ? { s: { ...s } } : null;
      }
    }
    // afinado paramétrico: el punto cae EXACTO sobre la curva matemática (no sobre la cuerda de la polilínea) y desliza continuo
    if (best?.line?.ev) {
      const L = best.line, n = L.n, t0 = (best.i - 1 + best.f) / n, dist = (t) => { const q = scr(L.ev(t)); return q ? Math.hypot(q.x - x, q.y - y) : Infinity; };
      let a = Math.max(0, t0 - 1 / n), b = Math.min(1, t0 + 1 / n);
      const g = 0.381966;
      for (let k = 0; k < 24; k++) { const m1 = a + (b - a) * g, m2 = b - (b - a) * g; if (dist(m1) < dist(m2)) b = m2; else a = m1; }
      const t = (a + b) / 2;
      best.point = L.ev(t); best.param = t;
    }
    if (best) {
      best.obj = best.line?.obj;
      // en un borde de superficie el parámetro se guarda a lo largo del borde (0..1 de u o v), no de la polilínea
      if (best.line?.edge && best.param != null) { best.edge = best.line.edge; if (best.line.rev) best.param = 1 - best.param; }
      delete best.line; delete best.i; delete best.f;
    }
  }
  return best;
}
// Snap al mover CVs u objetos: punto, curva, superficie (botón o Shift) y rejilla. El resultado es el punto exacto
// (no solo la componente del eje del botón): el CV cae justo donde está el snap.
function moveSnap(pt, m, ex, p0) {
  let s = findSnap(pt.clientX, pt.clientY, m, ex);
  if (s) return s;
  setRay(pt);
  if (m.surface || m.point || m.curve || (pt.shiftKey && !pt.altKey)) {
    // la superficie que se mueve (la de los CVs elegidos) no cuenta: se persigue a sí misma
    const own = new Set([...selectedCVRefs().map((r) => r.obj), ...selObjs]);
    const q = surfacePointAt(own);
    if (q) return { point: q, kind: 'superficie' };
  }
  if (m.grid) {
    // rejilla del plano que se ve (cara ortogonal) o la del suelo, a la altura del punto que se mueve
    const i = axisView(), k = i != null && proj.ortho ? ['yz', 'xz', 'xy'][i] : 'xz';
    const n = k === 'xz' ? new THREE.Vector3(0, 1, 0) : k === 'xy' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const q = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(n, p0), new THREE.Vector3());
    if (q) { snapGrid(q, k); return { point: q, kind: 'rejilla' }; }
  }
  return null;
}
// Restricción del snap (como Alias): con un eje (botón del ratón o flecha del gizmo) solo se toma la componente de ese eje;
// con un plano del gizmo, solo las dos del plano; libre = el punto exacto. En una vista ORTOGONAL de cara la profundidad
// (dirección de la vista) queda bloqueada: nada se va hacia el fondo por accidente.
function orthoLocked() { return proj.ortho && axisView() != null; }
function constrainPt(P, base, c) {
  if (c?.free) return P.clone();   // snap topológico: el punto exacto, también en vistas ortogonales
  let q = P.clone();
  if (c?.dir) q = base.clone().addScaledVector(c.dir, P.clone().sub(base).dot(c.dir));
  else if (c?.normal) q = P.clone().addScaledVector(c.normal, -P.clone().sub(base).dot(c.normal));
  if (orthoLocked()) { const vd = viewDir(); q.addScaledVector(vd, -q.clone().sub(base).dot(vd)); }
  return q;
}
// restricción del gizmo según la flecha o el plano que se arrastra (X/Y/Z internos de three)
function gizmoConstraint() {
  const a = gizmo.axis, U = { X: new THREE.Vector3(1, 0, 0), Y: new THREE.Vector3(0, 1, 0), Z: new THREE.Vector3(0, 0, 1) };
  if (U[a]) return { dir: U[a] };
  if (a === 'XY' || a === 'YZ' || a === 'XZ') return { normal: U[['X', 'Y', 'Z'].find((k) => !a.includes(k))] };
  return null;
}
function applySnapToProxy(ex) {
  const modes = snapModes(mods), g = gizmoDrag, p0 = g?.p0 || proxy.position;
  const s = moveSnap({ clientX: lastPtr.x, clientY: lastPtr.y, shiftKey: mods.shiftKey, altKey: mods.altKey }, modes, ex, p0);
  const c = gizmoConstraint();
  if (s) {
    // topológico (punto / curva / superficie) = el punto 3D absoluto, sin eje ni plano; rejilla = respeta la restricción
    const cc = isTopoSnap(s) ? { free: true } : c;
    proxy.position.copy(constrainPt(s.point, p0, cc)); showSnap(s);
    // varios CVs + snap = todos al mismo punto (topológico) o al mismo valor en el eje restringido (rejilla)
    if (g) g.collapse = pickMode === 'cv' && selCVs.size > 1 ? { P: s.point.clone(), c: cc } : null;
    return;
  }
  if (g) g.collapse = null;
  if (orthoLocked() && !c) proxy.position.copy(constrainPt(proxy.position, p0, null));
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
  while (objPivotMarkers.children.length < list.length) objPivotMarkers.add(makeCross('#4fd1c5', 0.35, false));
  objPivotMarkers.children.forEach((m, i) => {
    m.visible = i < list.length;
    if (m.visible) { m.position.copy(list[i].pivot); m.scale.setScalar(pxWorld(list[i].pivot, 20)); }
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

// Clic de selección. Si hay 2 o más objetos con líneas a menos de 8 px del cursor (p. ej. el borde común de dos superficies, o una
// curva sobre una superficie), sale un menú junto al puntero para elegir cuál; si no, se elige lo de siempre.
let clickBusy = false;
async function clickPick(e, how) {
  if (clickBusy) return;
  if (pickMode === 'object' && !gizmo.dragging) {
    const near = lineCandidates(e, 'both', 8, pickable), objsC = [];
    for (const c of near) if (!objsC.some((x) => x.obj === c.obj)) objsC.push(c);
    if (objsC.length >= 2) {
      clickBusy = true;
      try { const c = await chooseCandidate(e, objsC, 'Elegir'); if (c) { applySelection([c.obj], how); if ($('click-pivot').checked) setPivot(c.q); } }
      finally { clickBusy = false; }
      return;
    }
  }
  const hit = pickAt(e);
  if (hit?.cvTarget) { setCvTarget(hit.cvTarget, how); return; }
  if (hit) {
    if (hit.enterCV && pickMode !== 'cv') enterCvMode();
    applySelection([hit.cv || hit.obj], how);
    if ($('click-pivot').checked) setPivot(hit.point || (() => { const c = cvRef(hit.cv); return new THREE.Vector3(c.x, c.y, c.z); })());
  } else if (how === 'replace' || how === 'add') clearSelection();   // clic en el vacío: se suelta todo (y el HUD se va)
}
// CV más cercano al cursor EN PANTALLA dentro de una caja de tolerancia de CV_HIT px (no hace falta acertar al píxel); a igual distancia
// gana el más cercano a la cámara. Devuelve el userData del CV o null.
const CV_HIT = 8;
function cvAtScreen(e, objs, px = CV_HIT) {
  const pn = paneAt(e.clientX), r = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  const q = new THREE.Vector3();
  let best = null, bd = px * px + 1e-9, bz = Infinity;
  for (const o of objs) for (const h of o.parts.handles.children) {
    q.copy(h.position).project(camera);
    if (q.z < -1 || q.z > 1) continue;
    const dx = r.left + pn.x + ((q.x + 1) / 2) * pn.w - e.clientX, dy = r.top + ((1 - q.y) / 2) * pn.h - e.clientY, d = dx * dx + dy * dy;
    if (d < bd - 0.25 || (Math.abs(d - bd) <= 0.25 && q.z < bz)) { bd = d; bz = q.z; best = h.userData; }
  }
  return best;
}
function pickAt(e) {
  setRay(e);
  const live = objects.filter((o) => o.visible);
  if (pickMode === 'cv') {
    const best = cvAtScreen(e, live.filter((o) => cvTargets.has(o.id) && o.parts.handles.visible));
    if (best) return { cv: best };
    setRay(e);
    // si no se tocó un CV, el objeto bajo el cursor enciende (o apaga) sus CVs
    ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
    const oh = ray.intersectObjects(live.filter((o) => o.kind !== 'mesh').map((o) => pickTarget(o)), false)[0];
    return oh ? { cvTarget: oh.object.userData.obj } : null;
  }
  // los CVs de los objetos elegidos se pueden tocar directamente (con Mover activo se arrastran sin cambiar de modo)
  const bestCv = cvAtScreen(e, live.filter((o) => (selObjs.includes(o) || o.showCVs) && o.kind !== 'mesh' && o.parts.handles.visible));
  setRay(e);
  if (bestCv) return { cv: bestCv, enterCV: true };
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(live.filter(pickable).map((o) => pickTarget(o)), false)[0];
  return hit ? { obj: hit.object.userData.obj, point: hit.point } : null;
}

// ---------- Máquina de estados de las herramientas (UNA sola activa; sin ninguna = IDLE) ----------
// Toda herramienta que se queda con el ratón o el teclado (dibujar, bordes, Trim, Untrim, Revolución, Extruir, Redondear, pivote,
// mover / rotar / escalar, esperar selección...) se registra con beginTool(id, { label, cleanup(reason), voidKill, hit(e) }).
// Empezar otra, Esc, "Nada" o un clic en el vacío llaman a endActiveTool(reason) → cleanup() de la activa: suelta sus estados
// temporales, cierra su ventana y quita sus manijas. reason: 'switch' (otra herramienta) | 'esc' | 'void' (clic en el vacío) | 'done'.
// Cuando la herramienta termina sola (Aceptar, Enter, clic derecho) llama a toolDone(id): sale sin volver a ejecutar su cleanup.
var activeTool = null;   // var: se lee desde funciones que pueden correr antes de esta línea al arrancar
function beginTool(id, def = {}) {
  endActiveTool('switch');
  activeTool = { id, label: id, voidKill: true, ...def };
  syncToolState();
  return activeTool;
}
function endActiveTool(reason = 'done') {
  const t = activeTool;
  if (!t) return false;
  activeTool = null;
  try { t.cleanup?.(reason); } catch (err) { console.warn('cleanup de', t.id, err); }
  // la ventana de opciones y las manijas de la herramienta se van con ella (al terminar bien se deja la del resultado)
  if (reason !== 'done' && typeof TW !== 'undefined' && TW.spec) TW.hide();
  syncToolState();
  return true;
}
function toolDone(id) { if (activeTool && (activeTool.id === id || id == null)) { activeTool = null; syncToolState(); } }
const toolIs = (id) => activeTool?.id === id;
function syncToolState() {
  const app = document.getElementById('app');
  if (app) app.dataset.tool = activeTool ? activeTool.id : 'idle';
  if (typeof updateStatus === 'function' && toolsReady) updateStatus();
}

// ---------- Herramientas ----------
let tool = 'select';
// Plano de construcción. 'auto' (por defecto) depende de la vista, como en Alias: vista de arriba = suelo XZ,
// de frente = XY, de lado = YZ (por el origen); en perspectiva las curvas se dibujan en el aire, en el plano de la pantalla
// que pasa por el pivote (o por el primer punto de la curva). También se puede fijar: suelo, frente o lado.
let drawPlaneKind = 'auto';
// nombres con Z arriba (Alias): el suelo es XY, el frente XZ y el lado YZ
const PLANE_NAMES = { xz: 'el suelo (XY)', xy: 'el plano frontal (XZ)', yz: 'el plano lateral (YZ)', free: 'el aire (plano de la pantalla)' };
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
// punto de la superficie bajo el rayo, EXACTO: se toma el (u, v) del triángulo tocado y se evalúa la NURBS S(u, v) (no el triángulo)
function surfacePointAt(own = null) {
  const list = objects.filter((o) => o.visible && o.kind !== 'curve' && !own?.has(o));
  const hit = ray.intersectObjects(list.map((o) => o.parts.mesh), false)[0];
  if (!hit) return null;
  const o = list.find((x) => x.parts.mesh === hit.object);
  if (o?.kind === 'surface' && hit.uv) { const S = FF.surfEval(o.data); surfAnchor = { obj: o.id, u: hit.uv.x, v: hit.uv.y }; return S(hit.uv.x, hit.uv.y); }
  surfAnchor = o ? { obj: o.id } : null;
  return hit.point.clone();
}
let surfAnchor = null;
// "Snap topológico" (punto, curva o superficie): el resultado es el punto 3D absoluto y NO se aplana a ningún plano ni eje;
// solo el snap a la REJILLA (Alt) respeta la restricción del eje o del plano. Lo usan dibujar, mover CVs/objetos y el pivote.
const isTopoSnap = (s) => !!s && s.kind !== 'rejilla';
// placeAnchor = a qué quedó pegado el último punto (como attachedTo() de AlBlendPoint): {obj, t} en una curva, {obj, u, v} en una
// superficie, {obj} en un borde o un punto suelto de un objeto; null = punto libre (plano de dibujo o rejilla)
let placeAnchor = null;
// (v0.51) dibujo con EJE: tras el 1.er CV, el siguiente punto queda en la recta por el último punto paralela a X / Y / Z de Alias
// (teclas X, Y, Z mientras se dibuja, o "Recta" en la ventana: Auto = el eje más cercano al movimiento). Con un snap (punto, curva,
// rejilla...) se toma la coordenada EXACTA de ese punto sobre el eje (como createLine + worldPosition); sin snap, el punto de la recta
// más cercano al rayo del ratón.
let lastPlaceSnap = null, lineMode = false;
const draftAxisLine = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0x3182ce, dashSize: 0.08, gapSize: 0.06, depthTest: false, transparent: true }));
draftAxisLine.renderOrder = 7; draftAxisLine.visible = false; scene.add(draftAxisLine);
function draftAxisIndex(p) {
  const mode = draft?.axis || toolDef.curveOrtho || 'free';
  if (!draft?.pts.length || mode === 'free') return -1;
  if (mode !== 'auto') return { x: 0, y: 1, z: 2 }[mode];
  const d = p.clone().sub(draft.pts[draft.pts.length - 1]); let bi = 0, bv = -1;
  AXES.forEach((a, i) => { const v = Math.abs(d.dot(a)); if (v > bv) { bv = v; bi = i; } });
  return bi;
}
function draftPoint(e) {
  const p = placePoint(e);
  draftAxisLine.visible = false;
  if (!p || !draft?.pts.length) return p;
  const i = draftAxisIndex(p);
  if (i < 0) return p;
  const o = draft.pts[draft.pts.length - 1], a = AXES[i];
  let q;
  if (lastPlaceSnap) q = o.clone().addScaledVector(a, p.clone().sub(o).dot(a));   // coordenada exacta del punto de referencia
  else {   // punto de la recta del eje más cercano al rayo del ratón
    setRay(e);
    const r = ray.ray, w = o.clone().sub(r.origin), b = a.dot(r.direction), den = 1 - b * b;
    const t = Math.abs(den) < 1e-6 ? p.clone().sub(o).dot(a) : (b * w.dot(r.direction) - w.dot(a)) / den;
    q = o.clone().addScaledVector(a, t);
  }
  placeAnchor = null;
  const L = Math.max(1, o.distanceTo(camera.position) * 2);
  draftAxisLine.geometry.dispose();
  draftAxisLine.geometry = new THREE.BufferGeometry().setFromPoints([o.clone().addScaledVector(a, -L), o.clone().addScaledVector(a, L)]);
  draftAxisLine.computeLineDistances(); draftAxisLine.material.color.setHex([0xe53e3e, 0x38a169, 0x3182ce][i]); draftAxisLine.visible = true;
  return q;
}
function placePoint(e, solid = false) {
  lastPlaceSnap = null;
  const modes = snapModes(e);
  const s = findSnap(e.clientX, e.clientY, modes, {});
  placeAnchor = null;
  if (s) { lastPlaceSnap = s.kind || 'punto'; showSnap(s); if (s.obj) placeAnchor = { obj: s.obj.id, ...(s.edge ? { edge: s.edge } : {}), ...(s.param != null ? { t: s.param } : {}) }; return s.point; }
  setRay(e);
  // superficie: botón fijo o Shift mantenido al dibujar; con Ctrl o Ctrl+Alt, si no hay punto ni curva cerca, el punto se desliza
  // sobre la superficie que hay debajo (S(u, v) exacta en cada movimiento del ratón)
  if (modes.surface || modes.point || modes.curve || (e.shiftKey && !e.altKey)) {
    const q = surfacePointAt();
    if (q) { lastPlaceSnap = 'superficie'; showSnap({ point: q, kind: 'superficie' }); placeAnchor = surfAnchor; return q; }
  }
  const k = resolvePlaneKind(solid), gk = modes.grid && k === 'free' ? 'xz' : k;   // en perspectiva la rejilla es la del suelo
  const p = ray.ray.intersectPlane(planeFor(gk), new THREE.Vector3());
  if (p && modes.grid) { lastPlaceSnap = 'rejilla'; snapGrid(p, gk); showSnap({ point: p, kind: 'rejilla' }); } else hideSnap();
  return p;
}
function setDrawPlane(k) {
  drawPlaneKind = k;
  document.querySelectorAll('[data-plane]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.plane === k)));
  updateDrawGrids();
  if (draft) showDraft();
}
// rejilla del plano de construcción mientras se dibuja
const gridYZ = new THREE.GridHelper(30, 30, 0x8a8781, 0xa3a09a);
gridYZ.material.transparent = true; gridYZ.material.opacity = GRID_OP0;
gridYZ.rotation.z = Math.PI / 2;
gridYZ.layers.set(DIAG);
gridYZ.visible = false;
scene.add(gridYZ);
// Origen como Alias (Z arriba): líneas principales "infinitas" en azul nítido por el origen (las del plano de la rejilla visible)
// y un marcador de 3 ejes (X rojo, Y verde, Z azul) de tamaño fijo en pantalla. AXES = ejes de Alias en coordenadas internas.
const AXIS_BLUE = 0x3182ce;   // paleta Forja: ejes rojo carmesí / verde esmeralda / azul zafiro
// las líneas van DENTRO de cada rejilla (sueltas en la escena no se veían en perspectiva): salen y se ocultan con su rejilla.
// Coordenadas locales de GridHelper (plano local XZ): suelo x→X, z→Y; frente (gridXY) x→X, z→Z; lado (gridYZ) x→Z, z→Y.
const axisLine = (parent, dir) => {
  // "infinita" = 300 dm a cada lado, en tramos de 5 dm (una sola línea muy larga se perdía al recortarla contra la cámara)
  const pts = []; for (let t = -300; t < 300; t += 5) pts.push(dir.clone().multiplyScalar(t), dir.clone().multiplyScalar(t + 5));
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: AXIS_BLUE, toneMapped: false }));   // opaca: transparente no se veía
  l.layers.set(DIAG); l.frustumCulled = false; parent.add(l); return l;
};
const LX = new THREE.Vector3(1, 0, 0), LZ = new THREE.Vector3(0, 0, 1);
[[grid, LX], [grid, LZ], [gridXY, LX], [gridXY, LZ], [gridYZ, LX], [gridYZ, LZ]].forEach(([g, d]) => axisLine(g, d));
const originAxes = new THREE.Group();
originAxes.layers.set(DIAG);
[[0xe53e3e, 'x'], [0x38a169, 'y'], [AXIS_BLUE, 'z']].forEach(([col, name], i) => {
  const a = new THREE.ArrowHelper(AXES[i], new THREE.Vector3(), 46, col, 9, 5);
  a.traverse((o) => { o.layers.set(DIAG); o.renderOrder = 30; if (o.material) { o.material.depthTest = false; o.material.transparent = true; } });
  originAxes.add(a);
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const c2 = cv.getContext('2d'); c2.font = '600 44px Outfit, system-ui, sans-serif'; c2.textAlign = 'center'; c2.textBaseline = 'middle';
  c2.fillStyle = '#' + col.toString(16).padStart(6, '0'); c2.fillText(name, 32, 34);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), depthTest: false, transparent: true }));
  sp.position.copy(AXES[i]).multiplyScalar(60); sp.scale.setScalar(18); sp.layers.set(DIAG); sp.renderOrder = 31;
  originAxes.add(sp);
});
scene.add(originAxes);
function updateDrawGrids() {
  const drawing = tool === 'curve' || tool === 'plane' || tool === 'circle', k = drawing ? resolvePlaneKind(tool !== 'curve') : null;
  // vista ortogonal de una cara (cubo de vistas): aparece la rejilla del plano que se ve de frente
  // (frente/atrás = XY, derecha/izquierda = YZ, arriba/abajo = el suelo XZ)
  let face = null;
  if (proj.ortho) {
    const d = viewDir(), a = [Math.abs(d.x), Math.abs(d.y), Math.abs(d.z)];
    if (Math.max(...a) > 0.9995) face = a[2] > 0.9995 ? 'xy' : a[0] > 0.9995 ? 'yz' : 'xz';
  }
  const show = gridUser;
  grid.visible = show && face !== 'xy' && face !== 'yz';          // de canto, el suelo no aporta
  gridXY.visible = k === 'xy' || (show && face === 'xy');
  gridYZ.visible = k === 'yz' || (show && face === 'yz');
  originAxes.visible = grid.visible || gridXY.visible || gridYZ.visible;
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
    const verb = { translate: 'Mover', rotate: 'Rotar', scale: scaleNP ? 'Escalar (no proporcional)' : 'Escalar' }[xform];
    const axes = xform === 'scale' && !scaleNP ? 'cualquier botón = proporcional' : xform === 'translate' && orthoLocked() ? 'izq = libre en la vista · medio = horizontal · der = vertical (sin profundidad)' : 'izq = X · medio = Y · der = Z (arriba)';
    $('hint').textContent = `${verb}: arrastra en la vista con ${axes} · o usa el gizmo · clic sin arrastrar: elegir · Esc: salir`;
    return;
  }
  const nav = navStyle === 'alias' ? 'Shift+Alt: navegar' : 'Shift+arrastrar: recuadro';
  const what = pickMode === 'cv' ? 'CVs' : PICK_NAMES[pickFilter] || 'objetos';
  const sb = navStyle === 'alias' && $('sel-buttons')?.value === 'add' ? `Izq: añadir ${what} · medio: elegir solo eso · der: quitar` : `Clic: seleccionar ${what}`;
  $('hint').textContent = `${sb} · Arrastrar: recuadro · ${nav} (clic rápido: punto de interés) · W/E/R: mover/rotar/escalar · Alt/Ctrl/Ctrl+Alt: snap · Z: Puck · Ctrl+Shift+botón: menús`;
}
const TOOL_LABELS = { curve: 'Curva', plane: 'Plano', circle: 'Círculo', edge: 'Bordes' };
function setTool(t) {
  if (t === 'select') { if (activeTool?.id.startsWith('tool:')) endActiveTool('done'); else setToolRaw('select'); return; }
  // dibujar no se corta con un clic en el vacío (ahí se ponen los puntos): solo Esc, "Nada" u otra herramienta
  // cleanup con COMMIT del trabajo en curso: una curva con 2 o más CVs se guarda antes de limpiar (Esc, "Nada", otra herramienta);
  // solo se descarta si tiene 0 o 1 CV
  beginTool('tool:' + t, { label: TOOL_LABELS[t] || t, voidKill: t === 'edge', cleanup: () => { if (tool !== t) return; commitWIP(); setToolRaw('select'); } });
  setToolRaw(t);
}
function setToolRaw(t) {
  if (tool === 'curve' && t !== 'curve') { cancelDraft(); lineMode = false; draftAxisLine.visible = false; }
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
  // ventana de opciones de la herramienta Curva (grado y spans)
  if (typeof TW !== 'undefined') { if (t === 'curve') TW.show(curveSpec()); else if (TW.spec?.curveTool) TW.hide(); }
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
function startDraft() { draft = { pts: [], anchors: [], hover: null, axis: null }; draftAxisLine.visible = false; showDraft(); }
function showDraft() {
  draftHandles.clear();
  draftLine.visible = false;
  if (!draft) { $('draw-msg').textContent = ''; return; }
  const pts = draft.hover ? [...draft.pts, draft.hover] : draft.pts;
  if (pts.length >= 2) {
    const crv = N.curveOf(draftCurveData(pts)), out = [];
    for (let s = 0; s <= 120; s++) { const q = crv.getPoint(s / 120); out.push(q.x, q.y, q.z); }
    setGeo(draftLine, line2Geo(out));
    draftLine.visible = true;
  }
  pts.forEach((p) => { const h = makeHandle(false, false); h.position.copy(p); draftHandles.add(h); });
  const n = draft.pts.length;
  $('draw-msg').textContent = n === 0 ? `Clic: primer punto en ${PLANE_NAMES[resolvePlaneKind()]}` : `${n} ${n === 1 ? 'punto' : 'puntos'} · sigue haciendo clic`;
  $('draw-done').disabled = n < 2;
}
// Curva que se dibuja: grado y spans configurables (ventana de la herramienta Curva). Por omisión grado 3 y, como mínimo, 1 span:
// con menos de grado + 1 puntos se eleva el grado (la forma no cambia) para que siempre sea un span completo del grado elegido.
// Con "Spans" fijo se reconstruye la curva a ese número de spans; con "Auto" cada punto que pones es un CV.
function draftCurveData(pts, plane = 'xz') {
  const deg = toolDef.curveDeg, n = pts.length;
  if (n < 2) return N.curveData(pts, deg, plane);
  let c = N.curveData(pts, deg, plane);
  if (n < deg + 1) c = N.rebuildCurve(N.curveData(pts, n - 1, plane), deg, 1);
  else if (toolDef.curveSpans > 0 && n - deg !== toolDef.curveSpans) c = N.rebuildCurve(c, deg, toolDef.curveSpans);
  return c;
}
function curveSpec() {
  const keep = (k, v) => { toolDef[k] = v; saveToolDef(); showDraft(); };
  return {
    title: 'Curva', curveTool: true,
    hint: () => 'Grado y spans de las curvas nuevas. En Auto, cada punto que pones es un CV (con menos puntos de los que pide el grado, el grado se eleva y queda 1 span). "Nada" o Enter terminan la curva; Esc la cancela.',
    fields: [
      { type: 'seg', label: 'Grado', opts: [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [7, '7']], get: () => toolDef.curveDeg, set: (v) => keep('curveDeg', v) },
      { type: 'seg', label: 'Spans', opts: [[0, 'Auto'], [1, '1'], [2, '2'], [3, '3'], [4, '4'], [6, '6'], [8, '8']], get: () => toolDef.curveSpans, set: (v) => keep('curveSpans', v) },
      { type: 'seg', label: 'Recta', opts: [['free', 'Libre'], ['auto', 'Auto'], ['x', 'X'], ['y', 'Y'], ['z', 'Z']], get: () => toolDef.curveOrtho || 'free', set: (v) => keep('curveOrtho', v) },
      { type: 'html', html: () => '<span class="tw-note">Tras el 1.er punto: teclas X / Y / Z = el siguiente punto en esa recta (otra vez = libre). Con snap (Ctrl punto, Alt rejilla, Ctrl+Alt curva) toma la coordenada exacta de ese punto sobre el eje.</span>' },
    ],
    actions: [{ label: 'Terminar curva', primary: true, run: () => finishDraft() }],
  };
}
function finishDraft() {
  if (!draft || draft.pts.length < 2) return;
  // el plano de la curva: el de construcción si todos los puntos están en él (un snap pudo sacarlos)
  let pk = resolvePlaneKind();
  const ax = { xz: 'y', xy: 'z', yz: 'x' }[pk];
  if (ax && draft.pts.some((q) => Math.abs(q[ax] - draft.pts[0][ax]) > 1e-6)) pk = 'free';
  const obj = addCurve(draftCurveData(draft.pts, pk));
  // anclaje de cada punto dibujado (objeto + t o u, v), como AlBlendPoint::attachedTo; null = punto libre
  if (draft.anchors.some(Boolean)) obj.drawAnchors = draft.anchors.slice();
  startDraft();
  applySelection([obj], 'replace');   // la curva recién creada queda activa, con sus CVs a la vista
  toast(`${obj.name} creada`);
}
function cancelDraft() { draft = null; showDraft(); }
// trabajo en curso de las herramientas de creación secuencial: devuelve lo creado (o null si no había bastante para crear nada)
function commitWIP() {
  if (tool === 'curve' && draft && draft.pts.length >= 2) { const n = objects.length; finishDraft(); return objects.length > n ? objects[objects.length - 1] : null; }
  return null;
}

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
// ---------- Selección en los dos sentidos ----------
// Objeto → Acción (pre-selección): si al llamar la herramienta ya hay lo que necesita elegido, arranca con eso al momento.
// Acción → Objeto (post-selección): si no, la herramienta queda ESPERANDO (estado 'await:<id>') y cada clic (Shift / Ctrl como
// siempre) va sumando entradas; las que tienen vista previa (Loft) se rehacen en vivo con cada entrada. Las de una sola entrada
// (Revolución, Extruir, Offset, Simetría) se ejecutan en cuanto se elige; las de varias (Loft, Proyectar, Trim) con Enter, clic
// derecho o Aceptar. Esc = cancelar (se quita la vista previa); otra herramienta o clic en el vacío = aceptar lo que haya.
const isFreeCurve = (o) => o.kind === 'curve' && !o.data.cos;
const SEL_SPECS = {
  revolve: { label: 'Revolución', what: 'una curva de perfil', pick: 'curve', ok: isFreeCurve, ready: (v) => v.length >= 1, run: () => revolveRun() },
  extrude: { label: 'Extruir', what: 'una o más curvas', pick: 'curve', ok: isFreeCurve, ready: (v) => v.length >= 1, run: () => extrudeRun() },
  offset: { label: 'Offset', what: 'una superficie', pick: 'surface', ok: (o) => o.kind === 'surface', ready: (v) => v.length >= 1, run: () => offsetRun() },
  mirror: { label: 'Simetría', what: 'superficies o curvas', ok: (o) => o.kind !== 'mesh', ready: (v) => v.length >= 1, run: () => mirrorRun() },
  loft: { label: 'Loft', what: '2 o más curvas, en orden', pick: 'curve', ok: isFreeCurve, ready: (v) => v.length >= 2, multi: true, run: () => loftRun(),
    preview(st, v) {
      if (v.length < 2) { if (st.out) { const o = byId(st.out); st.out = null; if (o) removeObject(o); } return; }
      const r = st.out && relations.find((x) => x.out === st.out);
      if (r) { r.srcs = v.map((c) => c.id); applyRelation(r); renderHistory(); return; }
      const o = addSurface(N.loft(v.map((c) => c.data)), 'Loft');
      addRelation({ type: 'loft', srcs: v.map((c) => c.id), out: o.id }); st.out = o.id;
    },
    commit: (st) => { const o = byId(st.out); if (o) finishCreate([o], `${o.name} por ${relations.find((x) => x.out === o.id)?.srcs.length} curvas, con historial`); } },
  project: { label: 'Proyectar', what: 'las curvas y la superficie', ok: (o) => o.kind === 'surface' || isFreeCurve(o), multi: true,
    ready: (v) => v.some((o) => o.kind === 'surface') && v.some(isFreeCurve), run: () => projectRun() },
  flip: { label: 'Invertir normales', what: 'una o más superficies', pick: 'surface', ok: (o) => o.kind === 'surface', ready: (v) => v.length >= 1, run: () => flipNormalsRun() },
  locmin: { label: 'Locator mínima', what: '2 objetos (curvas o superficies)', ok: (o) => o.kind === 'curve' || o.kind === 'surface', ready: (v) => v.length === 2, run: () => addLocator('min') },
  locmax: { label: 'Locator máxima', what: '2 objetos (curvas o superficies)', ok: (o) => o.kind === 'curve' || o.kind === 'surface', ready: (v) => v.length === 2, run: () => addLocator('max') },
  trim: { label: 'Trim', what: 'la superficie a recortar y sus cortes (curvas u otras superficies)', ok: (o) => o.kind === 'surface' || o.kind === 'curve', multi: true,
    ready: (v) => v[0]?.kind === 'surface' && v.length >= 2, run: () => trimRun() },
};
var awaitSel = null;
function withSelection(key) {
  const sp = SEL_SPECS[key];
  if (pickMode !== 'object') setPickMode('object');
  if (sp.ready(selObjs.filter(sp.ok))) { endActiveTool('switch'); return sp.run(); }   // Objeto → Acción
  // Acción → Objeto: lo ya elegido que sirve se queda como primera entrada
  const keep = selObjs.filter(sp.ok);
  beginTool('await:' + key, { label: sp.label, cleanup: (why) => endAwait(why === 'esc' ? 'cancel' : 'accept') });
  checkpoint();   // un solo paso de deshacer para todo lo que se vaya previsualizando
  awaitSel = { key, sp, keepFilter: pickFilter, out: null };
  if (sp.pick) pickFilter = sp.pick;
  if (keep.length !== selObjs.length) applySelection(keep, 'replace');
  TW.show(awaitSpec());
  toast(`${sp.label}: elige ${sp.what}${sp.multi ? ' · Enter o clic derecho: aceptar' : ''} · Esc: cancelar`);
  awaitChanged();
}
function awaitSpec() {
  const st = awaitSel;
  return { title: st.sp.label, awaitSel: true,
    hint: () => `Elige ${st.sp.what} (clic; Shift o Ctrl como siempre). ${st.sp.multi ? 'Enter o clic derecho: aceptar.' : 'Arranca en cuanto lo eliges.'} Esc: cancelar.`,
    fields: [{ type: 'html', html: () => { const v = selObjs.filter(st.sp.ok); return `<span class="tw-note">${v.length ? v.map((o) => esc(o.name)).join(' · ') : 'Nada elegido todavía'}${st.sp.multi ? (st.sp.ready(v) ? ' — listo' : ' — falta') : ''}</span>`; } }],
    actions: [{ label: 'Cancelar', run: () => endActiveTool('esc') }, ...(st.sp.multi ? [{ label: 'Aceptar', primary: true, run: () => endActiveTool('done') }] : [])] };
}
function awaitChanged() {
  const st = awaitSel;
  if (!st || st.busy) return;
  const v = selObjs.filter(st.sp.ok);
  if (st.sp.preview) { st.busy = true; cpMuted++; try { st.sp.preview(st, v); } catch (err) { console.warn(err); } finally { cpMuted--; st.busy = false; } }
  if (TW.spec?.awaitSel) TW.render();
  if (!st.sp.multi && st.sp.ready(v)) queueMicrotask(() => { if (awaitSel === st) { toolDone('await:' + st.key); endAwait('accept'); } });
}
function endAwait(mode) {
  const st = awaitSel;
  if (!st) return;
  awaitSel = null; pickFilter = st.keepFilter;
  if (TW.spec?.awaitSel) TW.hide();
  const v = selObjs.filter(st.sp.ok);
  if (mode === 'cancel') {
    if (st.out) { cpMuted++; try { const o = byId(st.out); if (o) removeObject(o); } finally { cpMuted--; } }
    return toast(`${st.sp.label} cancelado`);
  }
  if (st.sp.commit && st.out) return st.sp.commit(st);
  if (st.sp.ready(v)) return st.sp.run();
  toast(`${st.sp.label}: faltan entradas (${st.sp.what}); no se hizo nada`);
}
addEventListener('keydown', (e) => {
  if (!awaitSel || e.key !== 'Enter' || typing(e.target)) return;
  e.preventDefault(); e.stopImmediatePropagation(); endActiveTool('done');
}, true);
addEventListener('pointerdown', (e) => {
  if (!awaitSel || e.button !== 2 || e.target !== renderer.domElement || navHeld || (e.ctrlKey && e.shiftKey)) return;
  e.preventDefault(); e.stopImmediatePropagation(); endActiveTool('done');
}, true);
function revolveSelection() { withSelection('revolve'); }
function extrudeSelection() { withSelection('extrude'); }
function loftSelection() { withSelection('loft'); }
function offsetSelection() { withSelection('offset'); }
function mirrorSelection() { withSelection('mirror'); }
function projectSelection() { withSelection('project'); }
function trimSelection() { withSelection('trim'); }

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
// Botones de selección (hoja de atajos de Alias). Alternativa sugerida (por omisión) = izq añade (Add), medio elige (Pick: suelta
// todo lo demás), der quita (Unpick). Por defecto de Alias = izq alterna, medio añade, der quita. Shift alterna y Ctrl quita.
function howFor(e) {
  if (e.shiftKey) return 'toggle';
  if (e.ctrlKey || e.metaKey) return 'remove';
  if (navStyle !== 'alias') return 'replace';
  const v = $('sel-buttons').value;
  if (e.button === 2) return 'remove';
  if (v === 'add') return e.button === 1 ? 'replace' : 'add';
  if (e.button === 1) return 'add';
  return v === 'default' ? 'toggle' : 'replace';
}
try { if (prefs.selButtons) $('sel-buttons').value = prefs.selButtons; } catch { /* opción vieja */ }
if (!$('sel-buttons').value) $('sel-buttons').value = 'add';
$('sel-buttons').addEventListener('change', (e) => { prefs.selButtons = e.target.value; savePrefs(); updateHint(); });
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
  if (tool === 'curve' && draft && (!e.buttons || (down && e.buttons === 1))) { draft.hover = draftPoint(e); showDraft(); }
});
renderer.domElement.addEventListener('pointerleave', () => { if (draft) { draft.hover = null; showDraft(); } });
addEventListener('keydown', (e) => {
  if (tool !== 'curve' || !draft?.pts.length || e.ctrlKey || e.altKey || e.metaKey || e.repeat || typing(e.target)) return;
  const k = { KeyX: 'x', KeyY: 'y', KeyZ: 'z' }[e.code];
  if (!k) return;
  e.preventDefault(); e.stopImmediatePropagation();   // con un punto puesto, la Z fija el eje en vez de abrir el Puck
  draft.axis = draft.axis === k ? null : k;
  toast(draft.axis ? `Recta en ${k.toUpperCase()} desde el último punto (vuelve a pulsar ${k.toUpperCase()} para soltar)` : 'Eje libre');
  draft.hover = draftPoint({ clientX: lastPtr.x, clientY: lastPtr.y, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false }); showDraft();
}, true);
['keydown', 'keyup'].forEach((t) => addEventListener(t, (e) => {
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(e.key) || tool !== 'curve' || !draft) return;
  draft.hover = draftPoint({ clientX: lastPtr.x, clientY: lastPtr.y, ctrlKey: e.ctrlKey, altKey: e.altKey, shiftKey: e.shiftKey, metaKey: e.metaKey });
  showDraft();
}));
addEventListener('pointerup', (e) => {
  const d = down;
  down = null;
  requestAnimationFrame(() => { dragPane = null; });
  if (navMovedLast) { navMovedLast = false; return; }
  if (!d || e.target !== renderer.domElement && !d.boxing) return;
  const how = howFor(e);
  if (d.boxing) { marquee.hidden = true; boxSelect(d, e, how); return; }
  // Curva (como Alias): pulsar, arrastrar (el punto se desliza con el snap por la curva o la superficie) y SOLTAR = el CV queda donde
  // se soltó, con su anclaje paramétrico. No hace falta un segundo clic aunque el ratón se haya movido.
  if (tool === 'curve' && !gizmo.dragging) {
    if (e.button !== 0 || !draft) return;
    const p = draftPoint(e);
    if (p) { draft.pts.push(p); draft.anchors.push(placeAnchor); draft.hover = null; draft.axis = null; draftAxisLine.visible = false; showDraft(); }
    if (lineMode && draft.pts.length >= 2) finishDraft();   // Línea: 2 puntos y se crea (la herramienta sigue para la siguiente)
    return;
  }
  if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5 || gizmo.dragging) return;
  if (fil) return;   // el redondeo (Redondear) se queda con sus propios clics
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
  clickPick(e, how);
});

// Move Pivot (D) como Alias/Plasticity: el pivote es un punto libre. Se arrastra con el botón izquierdo desde cerca de su marca
// (a ≤ 26 px; el gizmo de flechas sigue valiendo), en el plano de la pantalla que pasa por él, con todos los snaps
// (Ctrl punto, Ctrl+Alt curva, Alt rejilla). En vistas ortogonales la profundidad no cambia.
let pivotDrag = null;
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!pivotEdit || e.button !== 0 || gizmo.axis || navHeld || (e.ctrlKey && e.shiftKey) || !selObjs.length) return;
  const o = selObjs[selObjs.length - 1], pn = paneAt(e.clientX), r = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  const q = o.pivot.clone().project(camera), sx = r.left + pn.x + ((q.x + 1) / 2) * pn.w, sy = r.top + ((1 - q.y) / 2) * pn.h;
  if (Math.hypot(sx - e.clientX, sy - e.clientY) > 26) return;
  e.stopImmediatePropagation(); e.preventDefault();
  down = null; checkpoint();
  pivotDrag = { o, p0: o.pivot.clone(), plane: new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir(), o.pivot), off: o.pivot.clone() };
  setRay(e);
  const h = ray.ray.intersectPlane(pivotDrag.plane, new THREE.Vector3());
  if (h) pivotDrag.off = o.pivot.clone().sub(h);
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);
addEventListener('pointermove', (e) => {
  const d = pivotDrag;
  if (!d) return;
  const sn = moveSnap(e, snapModes(e), { pivots: new Set([d.o]) }, d.p0);
  if (sn) { d.o.pivot.copy(isTopoSnap(sn) ? sn.point : constrainPt(sn.point, d.p0, null)); showSnap(sn); }
  else { hideSnap(); setRay(e); const h = ray.ray.intersectPlane(d.plane, new THREE.Vector3()); if (h) d.o.pivot.copy(h.add(d.off)); }
  attachGizmo(); updatePivotReadout(); if (hudOn) hudRefresh();
});
addEventListener('pointerup', () => { if (!pivotDrag) return; pivotDrag = null; hideSnap(); attachGizmo(); renderSelectionPanel(); });

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
  // Sombreado: solo entra lo que se VE (lo tapado por otra superficie no, como la selección por cámara de Alias).
  // Malla (alambre): se elige a través (select through), todo lo que cae en el recuadro.
  const through = layout !== 'render' && diagMode === 'wire';
  const occluders = through ? [] : live.filter((o) => o.kind !== 'curve').map((o) => o.parts.mesh).filter(Boolean);
  const rc = new THREE.Raycaster(), cam = camera.position.clone(), w = new THREE.Vector3();
  const seen = (x, y, z, self) => {
    if (through || !occluders.length) return true;
    w.set(x, y, z);
    if (camera.isOrthographicCamera) { const vd = viewDir(); rc.set(w.clone().addScaledVector(vd, -1000), vd); }
    else rc.set(cam, w.clone().sub(cam).normalize());
    const dist = camera.isOrthographicCamera ? 1000 : w.distanceTo(cam);
    const hit = rc.intersectObjects(occluders, false).find((h) => h.object !== self);
    return !hit || hit.distance > dist - Math.max(1e-3, dist * 0.004);
  };
  let items;
  if (pickMode === 'cv') {
    items = live.filter((o) => cvTargets.has(o.id)).flatMap(allCVRefs).filter((ref) => { const q = cvRef(ref); return inside(q.x, q.y, q.z) && seen(q.x, q.y, q.z, null); });
  } else {
    items = live.filter(pickable).filter((o) => {
      const a = pickTarget(o).geometry.attributes.position, self = o.parts.mesh;
      const step = o.kind === 'curve' ? 3 : 5;
      let tests = 0;
      for (let i = 0; i < a.count; i += step) {
        if (!inside(a.getX(i), a.getY(i), a.getZ(i))) continue;
        if (seen(a.getX(i), a.getY(i), a.getZ(i), self)) return true;
        if (++tests > 60) return false;   // muchas muestras tapadas: está detrás
      }
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
  // barra izquierda: se abre con el ratón a menos de 81 px del borde (10 % menos sensible que los 90 px del resto) y, ya abierta, no se cierra hasta pasar de 90 px
  app.classList.toggle('near-left', x < (app.classList.contains('near-left') ? NEAR : NEAR * 0.9));
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
    const mode = l.mode || 'pick', symOn = !!l.sym?.on;
    li.innerHTML = `<div class="ly-head"><button class="ol-fold" title="Abrir / cerrar">▸</button>
      <button class="ly-eye" aria-pressed="${l.visible}" title="${l.visible ? 'Ocultar capa' : 'Mostrar capa'}">${EYE}</button>
      <span class="ly-symw"><button class="ly-sym" aria-pressed="${symOn}" title="Simetría de la capa: ${symOn ? 'activa (' + SYM_NAMES[l.sym.plane] + ')' : 'apagada'} · clic: encender / apagar · clic derecho o ▾: plano">⇋</button><button class="ly-symp" title="Plano de simetría">▾</button></span>
      <input type="color" class="ly-col" value="${l.color || '#8a8d93'}" data-set="${l.color ? 1 : 0}" title="Color de la capa: pasa a las líneas, curvas y polígonos de control de todo lo que contiene (clic derecho: quitar color)">
      <button class="ly-name" title="Clic: capa activa (lo nuevo va aquí) · doble clic: renombrar · suelta aquí objetos para pasarlos">${esc(l.name)}</button>
      <button class="ly-mode" data-mode="${mode}" title="Estado de la capa: ${LAYER_MODES[mode]} (clic: cambiar)">${LAYER_MODE_LETTER[mode]}</button>
      <span class="ly-n">${mine.length}</span></div><ul></ul>`;
    li.querySelector('.ly-mode').addEventListener('click', () => setLayerMode(l, LAYER_MODE_NEXT[mode]));
    li.querySelector('.ly-sym').addEventListener('click', () => toggleSym(l));
    li.querySelector('.ly-sym').addEventListener('contextmenu', (e) => { e.preventDefault(); symMenu(l, e.currentTarget); });
    li.querySelector('.ly-symp').addEventListener('click', (e) => symMenu(l, e.currentTarget));
    { const ci = li.querySelector('.ly-col'); let armed = false;
      ci.addEventListener('input', () => { if (!armed) { checkpoint(); armed = true; } setLayerColor(l, ci.value); });
      ci.addEventListener('change', () => { armed = false; refreshOutliner(); });
      ci.addEventListener('contextmenu', (e) => { e.preventDefault(); if (l.color) { checkpoint(); setLayerColor(l, null); refreshOutliner(); } }); }
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
function renderSelectionPanel() { renderSelectionBody(); pivotBlock(); if (hudOn) hudRender(); }
function renderSelectionBody() {
  const box = $('sel-body');
  const refs = [...selCVs.values()];
  if (pickMode === 'cv' && refs.length) {
    const single = refs.length === 1;
    const p = single ? cvRef(refs[0]) : centroid(refs), pa = toAlias(p);
    box.innerHTML = `
      <p class="muted">${single ? `CV de <b>${refs[0].obj.name}</b>` : `${refs.length} CVs seleccionados · centro del grupo`}</p>
      <div class="coords">
        <div class="coord"><b class="x">X</b><span id="cx">${fmt(pa.x)}</span></div>
        <div class="coord"><b class="y">Y</b><span id="cy">${fmt(pa.y)}</span></div>
        <div class="coord"><b class="z">Z</b><span id="cz">${fmt(pa.z)}</span></div>
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
  const pa = toAlias(p); $('cx').textContent = fmt(pa.x); $('cy').textContent = fmt(pa.y); $('cz').textContent = fmt(pa.z);
}
function updateStatus() {
  const n = pickMode === 'cv' ? selCVs.size : selObjs.length;
  const what = pickMode === 'cv' ? (n === 1 ? 'CV' : 'CVs') : (n === 1 ? 'objeto' : 'objetos');
  $('st-sel').textContent = n ? `Selección: ${n} ${what}` : 'Nada seleccionado';
  // la herramienta activa (máquina de estados): "IDLE" si no hay ninguna; con espera de selección dice qué falta
  $('st-sel').textContent += activeTool ? ` · ${activeTool.label.toUpperCase()}${activeTool.id.startsWith('await:') ? ' (eligiendo)' : ''}` : ' · IDLE';
  const ns = objects.filter((o) => o.kind === 'surface').length;
  const nc = objects.filter((o) => o.kind === 'curve').length, nm = objects.filter((o) => o.kind === 'mesh').length;
  const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
  $('st-scene').textContent = `DM · CELDA 100 MM · ${plural(nc, 'CURVA', 'CURVAS')}`;
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
let lastMapType = 'forja';
function setDiag(m) {
  diagMode = m;
  if (m !== 'wire') lastMapType = m;
  if (prefs.shadeReal) setShadeReal(false, true);   // elegir un Map Type vuelve al diagnóstico
  // en Arcilla las líneas de parche son sutiles (finas y apagadas) para no ensuciar la superficie
  const clay = m === 'clay' || m === 'forja';
  isoMat.color.setHex(m === 'forja' ? 0x2f7bff : clay ? 0x9aa3b3 : 0x4a8fe0); isoMat.linewidth = clay ? 0.9 : 1.6; isoMat.transparent = clay; isoMat.opacity = m === 'forja' ? 0.7 : clay ? 0.5 : 1; isoMat.needsUpdate = true;
  $('vi-shader').textContent = prefs.shadeReal ? 'REALISTA' : DIAG_NAMES[m];
  document.querySelectorAll('[data-diag]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.diag === m)));
  if (layout === 'render') switchLayout('diag');
  $('legend').hidden = m !== 'curv';
  objects.forEach(updateObject);
  if ($('mt-wire')) $('mt-wire').checked = m === 'wire';
  updateEvalUI();
}
document.querySelectorAll('[data-diag]').forEach((b) => b.addEventListener('click', () => setDiag(b.dataset.diag)));
// Malla (alambre): interruptor aparte de los Map Types
function toggleWire() { setDiag(diagMode === 'wire' ? lastMapType : 'wire'); }
{
  const mt = (id, key, uni, fmt) => {
    const el = $(id); if (!el) return;
    el.value = prefs[key] ?? 0.5;
    el.addEventListener('input', () => { prefs[key] = +el.value; mapTypeMat.uniforms[uni].value = +el.value; $(id + '-o').textContent = (+el.value).toFixed(2); savePrefs(); sceneChangedAt = performance.now(); });
    $(id + '-o').textContent = (+el.value).toFixed(2);
  };
  mt('mt-amb', 'mtAmb', 'uAmb'); mt('mt-dif', 'mtDif', 'uDif');
  $('mt-link').checked = !!prefs.mtLink;
  $('mt-link').addEventListener('change', (e) => { prefs.mtLink = e.target.checked; mapTypeMat.uniforms.uLink.value = e.target.checked ? 1 : 0; savePrefs(); sceneChangedAt = performance.now(); });
  $('mt-wire').addEventListener('change', () => toggleWire());
  $('sq-real').checked = !!prefs.shadeReal;
  $('sq-real').addEventListener('change', (e) => setShadeReal(e.target.checked));
  $('sq-env').addEventListener('change', (e) => selectEnv(e.target.value));
}
// Sombreado realista en Modelado (Shade Quality de Alias): materiales PBR y el entorno de render elegido, sin salir del módulo
function setShadeReal(on, quiet) {
  prefs.shadeReal = !!on; savePrefs();
  if (on && diagMode === 'wire') diagMode = lastMapType;
  $('sq-real').checked = !!on;
  document.querySelectorAll('[data-diag]').forEach((b) => b.setAttribute('aria-pressed', String(!on && b.dataset.diag === diagMode)));
  $('vi-shader').textContent = on ? 'REALISTA' : DIAG_NAMES[diagMode];
  $('legend').hidden = on || diagMode !== 'curv';
  if (!quiet) { objects.forEach(updateObject); updateEvalUI(); }
}
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
    backend.drawPane({ ...full, kind });
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
// ----- Panel de entornos: miniaturas, rotación, intensidad y carga de .hdr (clásico y motor híbrido a la vez) -----
function setEnvOpts(o = {}) {
  if (o.rot !== undefined) envLib.rot = ((Math.round(+o.rot || 0) % 360) + 360) % 360;
  if (o.int !== undefined) envLib.int = Math.max(0, Math.min(5, +o.int || 0));
  backend.envRotation = (envLib.rot * Math.PI) / 180; backend.envIntensity = envLib.int;
  Object.values(materials).forEach((mt) => (mt.envMapIntensity = envLib.int));
  $('env-rot').value = envLib.rot; $('env-int').value = +envLib.int.toFixed(2);
  for (const [id, v, out, f] of [['pref-env-int', envLib.int, 'pref-env-int-o', (x) => x.toFixed(2)], ['pref-env-rot', envLib.rot, 'pref-env-rot-o', (x) => x + '°']]) { const el = $(id); if (el) { el.value = v; $(out).textContent = f(v); } }
  prefs.envInt = envLib.int; prefs.envRot = envLib.rot; savePrefs();
  sceneChangedAt = performance.now();
  // el motor clásico no sabe girar el entorno: se rehace el PMREM con el giro (con retardo, para no hacerlo en cada paso del control)
  clearTimeout(setEnvOpts.t); setEnvOpts.t = setTimeout(() => { envLib.rotApplied = envLib.rot; sceneChangedAt = performance.now(); }, 140);
}
function selectEnv(id) {
  const it = envLib.items.find((x) => x.id === id) || envLib.items[0];
  envKey = it.id;
  backend.setEnv(it.id === 'studio' ? null : envMap(it));   // motor híbrido: estudio procedural de la tarjeta o mapa equirectangular
  $('expo').value = it.id === 'sun' || it.id === 'sunset' ? -1.4 : 0; $('expo').dispatchEvent(new Event('input'));
  document.querySelectorAll('#env-grid [data-env]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.env === it.id)));
  if ($('sq-env')) $('sq-env').value = it.id;
  sceneChangedAt = performance.now();
}
function buildEnvGrid() {
  const g = $('env-grid'); g.innerHTML = '';
  for (const it of envLib.items) {
    const b = document.createElement('button');
    b.className = 'envt'; b.dataset.env = it.id; b.title = it.name; b.setAttribute('aria-pressed', String(it.id === envKey));
    b.append(thumb(envMap(it), 64));
    b.addEventListener('click', () => selectEnv(it.id));
    g.append(b);
  }
  const add = document.createElement('button');
  add.className = 'envt add'; add.textContent = '+'; add.title = 'Cargar un HDRI (.hdr) propio';
  add.addEventListener('click', () => $('env-file').click());
  g.append(add);
  // la misma lista en Modelado (Sombreado realista): solo se elige; los ajustes viven en Visu
  const sel = $('sq-env');
  if (sel) { sel.innerHTML = envLib.items.map((it) => `<option value="${it.id}">${it.name}</option>`).join(''); sel.value = envKey; }
}
async function loadHdrFile(f) {
  try {
    const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
    const ld = new RGBELoader(); ld.setDataType(THREE.HalfFloatType);
    const tex = ld.parse(await f.arrayBuffer());
    const it = { id: 'hdr' + envLib.nextHdr++, name: f.name.replace(/\.hdr$/i, ''), map: { w: tex.width, h: tex.height, data: tex.data } };
    envLib.items.push(it); buildEnvGrid(); selectEnv(it.id);
    toast(`Entorno "${it.name}" cargado${backend.hybrid ? '' : ' (el motor híbrido lo usa al activarlo)'}`);
  } catch (err) { toast('No se pudo leer el .hdr: ' + err.message); }
}
$('env-file').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) loadHdrFile(f); });
$('env-rot').addEventListener('input', (e) => { if (e.target.value !== '') setEnvOpts({ rot: e.target.value }); });
$('env-int').addEventListener('input', (e) => { if (e.target.value !== '') setEnvOpts({ int: e.target.value }); });
for (const [id, key] of [['show-edges', 'showEdges'], ['show-curves', 'showCurves'], ['show-faces', 'showFaces']]) {
  $(id).checked = key === 'showEdges' ? prefs[key] === true : prefs[key] !== false;
  $(id).addEventListener('change', (e) => { prefs[key] = e.target.checked; savePrefs(); objects.forEach(applyVisibility); sceneChangedAt = performance.now(); });
}
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
$('t-fillet').addEventListener('click', () => startFillet());
$('t-chamfer').addEventListener('click', async () => { await startFillet(); if (fil) { fil.dist = -Math.abs(fil.dist); filRefresh(); showFilletWin(); } });
$('t-move').addEventListener('click', () => { setTool('select'); setXform('translate'); });
$('t-rotate').addEventListener('click', () => { setTool('select'); setXform('rotate'); });
$('t-scale').addEventListener('click', () => { scaleNP = false; setTool('select'); setXform('scale'); });
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

// .forja v2: la escena COMPLETA (objetos con sus ids, historial de construcción, capas con color y simetría, grupos, materiales,
// pivotes, origen local, CVs encendidos, recortes y locators), con el mismo formato que el deshacer
function serializeProject() {
  const st = snapshot();
  st.objects = st.objects.map((it) => it.kind === 'mesh'
    ? { ...it, data: { positions: Array.from(it.data.geometry.attributes.position.array), index: it.data.geometry.index ? Array.from(it.data.geometry.index.array) : null } } : it);
  return JSON.stringify({ format: 'forja', version: 2, units: 'dm', up: 'y', app: FORJA_VERSION, scene: st, locators: locators.map(({ mode, a, b }) => ({ mode, a, b })) });
}
function reviveThree(v) {
  if (Array.isArray(v)) return v.map(reviveThree);
  if (!v || typeof v !== 'object') return v;
  const k = Object.keys(v).sort().join(',');
  if (k === 'w,x,y,z') return new THREE.Vector4(v.x, v.y, v.z, v.w);
  if (k === 'x,y,z') return new THREE.Vector3(v.x, v.y, v.z);
  return Object.fromEntries(Object.entries(v).map(([a, b]) => [a, reviveThree(b)]));
}
function loadProjectV2(j) {
  const st = j.scene;
  st.relations = reviveThree(st.relations || []);
  st.objects = st.objects.map((it) => {
    const o = { ...it, pivot: new THREE.Vector3(it.pivot.x, it.pivot.y, it.pivot.z), origin0: it.origin0 ? new THREE.Vector3(it.origin0.x, it.origin0.y, it.origin0.z) : null };
    if (it.kind === 'mesh') { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(it.data.positions, 3)); if (it.data.index) g.setIndex(it.data.index); g.computeVertexNormals(); g.computeBoundingBox(); o.data = { geometry: g }; }
    return o;
  });
  restore(st);
  clearHistory();
  locators.length = 0; (j.locators || []).forEach((L) => locators.push({ ...L, id: Math.random() })); locStamp = -1;
}
// archivos recientes: los últimos proyectos .forja (nombre, fecha y contenido) en la base local del navegador (IndexedDB)
const RECENT_MAX = 8;
function recentDB() {
  return new Promise((ok, ko) => { const r = indexedDB.open('forja-recent', 1); r.onupgradeneeded = () => r.result.createObjectStore('files', { keyPath: 'name' }); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
}
async function recentAll() {
  try { const db = await recentDB(); return await new Promise((ok) => { const q = db.transaction('files').objectStore('files').getAll(); q.onsuccess = () => ok(q.result.sort((a, b) => b.date - a.date)); q.onerror = () => ok([]); }); } catch (e) { return []; }
}
async function recentAdd(name, text) {
  try {
    const db = await recentDB(), all = await recentAll();
    const tx = db.transaction('files', 'readwrite'), os = tx.objectStore('files');
    os.put({ name, date: Date.now(), text });
    all.filter((x) => x.name !== name).slice(RECENT_MAX - 1).forEach((x) => os.delete(x.name));
  } catch (e) { /* sin almacenamiento local */ }
}
async function openRecent() {
  const all = await recentAll();
  if (!all.length) return toast('Todavía no hay archivos recientes (se apuntan al guardar o abrir un .forja).');
  const v = await quickPick(innerWidth / 2 - 150, 120, 'Archivos recientes', all.slice(0, 9).map((x, i) => [i, `${x.name} · ${new Date(x.date).toLocaleString()}`]), 0);
  if (v == null) return;
  const f = all[v];
  checkpoint();
  loadProjectV2orV1(JSON.parse(f.text), f.name);
}
function loadProjectV2orV1(j, name) {
  if (j.version >= 2 && j.scene) { loadProjectV2(j); $('file-name').textContent = name.replace(/\.json$/, '.forja'); recentAdd(name, JSON.stringify(j)); toast(`${name} abierto`); return true; }
  return false;
}
function serializeProjectV1() {
  const v4 = (q) => [q.x, q.y, q.z, q.w];
  return JSON.stringify({
    format: 'forja', version: 1, units: 'dm', up: 'y',
    objects: objects.map((o) => {
      const base = { kind: o.kind, name: o.name, mat: o.mat, visible: o.visible, pivot: o.pivot.toArray() };
      const d = o.data;
      if (o.kind === 'surface') return { ...base, degU: d.degU, degV: d.degV, knotsU: d.knotsU, knotsV: d.knotsV, cvs: d.cvs.map((r) => r.map(v4)),
        ...(trimStages(d).length ? { rtrims: trimStages(d).map((st) => ({ ...cloneStage(st), rel: null })) } : {}) };
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
      const txt = serializeProject();
      await saveFile(name, txt);
      recentAdd(name, txt);
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
    const txt = await file.text(), j = JSON.parse(txt);
    if (j.format !== 'forja') throw new Error('no es un proyecto de Forja');
    if (loadProjectV2orV1(j, file.name)) return;
    const V4 = (a) => new THREE.Vector4(...a);
    for (const it of j.objects) {
      let ob;
      if (it.kind === 'surface') ob = addSurface({ degU: it.degU, degV: it.degV, knotsU: it.knotsU, knotsV: it.knotsV, cvs: it.cvs.map((r) => r.map(V4)), ...(it.rtrims ? { rtrims: it.rtrims.map(cloneStage) } : {}) }, it.name);
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
    // 1) lector propio (sin WebAssembly): superficies y curvas B-spline como NURBS reales, con sus recortes; funciona también en el Artifact
    const text = await file.text();
    let nat = null;
    try { nat = X.readSTEP(text, o); } catch (e) { console.warn('STEP propio:', e); }
    const hasNat = nat && (nat.surfaces.length || nat.curves.length);
    let viaOCC = false;
    // 2) si hay caras que no son B-spline (planos, cilindros...), OpenCascade las convierte en malla (necesita descargar su WebAssembly)
    if (!hasNat || nat.other) {
      try {
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
        viaOCC = true;
      } catch (err) {
        if (!hasNat) throw new Error(`${err.message || err}. En el Artifact OpenCascade no puede cargarse; en GitHub Pages sí`);
        toast(`OpenCASCADE no se pudo cargar (${err.message || err}): se importan solo las superficies NURBS (${nat.other} caras analíticas quedan fuera)`);
      }
    }
    if (!viaOCC && hasNat) {
      const V4 = (q) => new THREE.Vector4(q.x, q.y, q.z, q.w);
      let nTrim = 0;
      nat.surfaces.forEach((d, k) => {
        const so = addSurface({ degU: d.degU, degV: d.degV, knotsU: d.knotsU, knotsV: d.knotsV, cvs: d.cvs.map((row) => row.map(V4)) }, nat.surfaces.length === 1 ? base : `${base} ${k + 1}`);
        created.push(so);
        // recortes: una curva sobre superficie por contorno (fuera del exterior, dentro de cada agujero), como las del redondeo
        for (const l of d.loops || []) {
          const cd = FF.cosCurveData(so.data, l.uv);
          cd.cos = { surf: so.id, uv: l.uv, closed: true, trim: l.trim, edge: true };
          created.push(addCurve(cd, 'Borde de recorte'));
          nTrim++;
        }
        if (d.loops) updateObject(so);
      });
      nat.curves.forEach((d, k) => created.push(addCurve({ deg: d.deg, knots: d.knots, plane: 'xz', cvs: d.cvs.map(V4) }, `${base} curva ${k + 1}`)));
      const extra = [];
      if (nTrim) extra.push(`${nTrim} recortes importados`);
      if (nat.trimFailed) extra.push(`${nat.trimFailed} caras con recorte que no se pudo leer (quedan sin recortar)`);
      toast(`STEP: ${nat.surfaces.length} superficies NURBS${extra.length ? ' · ' + extra.join(' · ') : ''}`);
    }
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
  else if (k === 'r') { scaleNP = false; setXform('scale'); }
  else if (k === 'd' || k === 'insert') togglePivotEdit();
  else if (k === 'c') setTool('curve');
  else if (k === 'b') startFillet();
  else if (k === 'o' && e.shiftKey) toggleOrtho();
  else if (k === 'o') setPickMode('object');
  else if (k === 'p') setPickMode('cv');
  else if (k === '4') setDiag('showroom');
  else if (k === '5') setDiag('skyshade');
  else if (k === '6') setDiag('abstract');
  else if (k === '1') setDiag('zebra');
  else if (k === '2') setDiag('curv');
  else if (k === '3') toggleWire();
  else if (k === '8') setDiag('forja');
  else if (k === 'enter' && tool === 'curve') finishDraft();
  else if (k === 'enter' && tool === 'edge' && edgeOp && EDGE_OPS[edgeOp.type].enter) EDGE_OPS[edgeOp.type].enter();
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
function pickNothing() {
  // dibujando una curva, "Nada" la termina (con 2 puntos o más) y sale de la herramienta
  // y en cualquier otra herramienta es el kill switch: cleanup(), soltar todo e IDLE
  const made = tool === 'curve' && draft && draft.pts.length >= 2;
  if (!made) return escapeAll('void');
  finishDraft();   // la curva recién terminada queda elegida, con sus CVs a la vista
  endActiveTool('done'); mouseXform = false;
  updateHint();
}
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
  toast(`${n} ${n === 1 ? 'objeto oculto' : 'objetos ocultos'} · Mostrar todo en el Puck (Z)`);
}
function unhideAll() { checkpoint(); objects.forEach((o) => (o.visible = true)); selectionChanged(); toast('Todo visible'); }
let modelClean = false;
function toggleModel() {
  modelClean = !modelClean;
  objects.forEach(applyVisibility);
  toast(modelClean ? 'Toggle Model: parches, hulls y CVs ocultos' : 'Toggle Model: parches, hulls y CVs visibles');
}
let gridUser = true;   // la rejilla que elige el usuario (Mostrar › Rejilla); además aparece sola en las vistas ortogonales de cada cara
function toggleGrid() { gridUser = !gridUser; }
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
  panel: 'M4 4h16v16H4zM14 4v16',
  mesh: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8M8 6l8 4M8 18V10', cos: 'M3 15l5-8h13l-5 8zM7 12c3-2 6 0 10-2',
  blendPt: 'M3 18C9 18 9 6 15 6h6M15 3v6', construct: 'M4 20L20 4M4 4h4M4 4v4M20 20h-4M20 20v-4', locator: 'M12 3v18M3 12h18M7 7l10 10',
  centerPivot: 'M4 4h16v16H4zM12 9v6M9 12h6', npScale: 'M4 12h10v8H4zM14 12h6M18 10l2 2-2 2M9 12V5M7 7l2-2 2 2',
  history: 'M12 3a9 9 0 1 0 9 9M12 7v5l3 3M21 3v5h-5', delLoc: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11l4 4M14 11l-4 4',
  shadeQ: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 3c-4 3-4 15 0 18M3 12h18', shadeF: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM13 7l-3 5h4l-3 5',
  planeEd: 'M3 16l6-9h12l-6 9zM12 4v8', palette: 'M4 4h6v16H4zM6 7h2M6 11h2M6 15h2', shelf: 'M3 8h18M3 16h18M6 8v8M11 8v8M16 8v8', split: 'M4 4h16v16H4zM12 4v16', ai: 'M12 3l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM19 15l1 2 2 1-2 1-1 2-1-2-2-1 2-1z',
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
const mv = () => { setTool('select'); setXform('translate'); }, rot = () => { setTool('select'); setXform('rotate'); }, scl = () => { scaleNP = false; setTool('select'); setXform('scale'); };
const sclNP = () => { scaleNP = true; setTool('select'); setXform('scale'); };
const env = (k) => () => { document.querySelector(`[data-env="${k}"]`)?.click(); if (layout !== 'render') switchLayout('render'); };
Object.assign(IC, {
  mat: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 9a5 5 0 0 1 5-3', bg: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6', tone: 'M3 17c4 0 5-10 9-10s5 10 9 10M3 21h18',
  expo: 'M12 3v2M12 19v2M3 12h2M19 12h2M12 8a4 4 0 1 0 0 8zM12 8a4 4 0 0 1 0 8', render: 'M4 6h16v12H4zM4 10h16M8 6v12',
  chat: 'M4 5h16v11H9l-5 4z', photo: 'M4 7h4l2-2h4l2 2h4v12H4zM12 10a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  undo: 'M9 7L4 12l5 5M4 12h11a5 5 0 0 1 0 10h-3', redo: 'M15 7l5 5-5 5M20 12H9a5 5 0 0 0 0 10h3',
  layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', gear: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2',
  modules: 'M12 4a8 3 0 1 0 0 6 8 3 0 0 0 0-6zM4 7v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7', cube: 'M4 8l8-4 8 4v8l-8 4-8-4zM4 8l8 4 8-4M12 12v8',
});
// Menú de Visu (hoy sin tecla): solo visualización. El Puck por módulo de antes ya no existe: Z abre siempre el Puck nuevo.
const setInput = (id, v, ev = 'input') => { const el = $(id); el.value = v; el.dispatchEvent(new Event(ev)); };
const matSub = (keys) => keys.map((k) => ({ k: 'mat', label: MAT_NAMES[k], run: () => setMaterial(k) }));
const VISU_CMDS = {
  mats: { k: 'mat', label: 'Materiales', run: () => setMaterial(matKey), sub: matSub(['candy', 'paint', 'black', 'pearl', 'alu', 'chrome']) },
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
  frame: { k: 'frame', label: 'Encuadrar', key: 'F', run: frameSelection, sub: [{ k: 'frame', label: 'Todo', run: () => frameObjects([]) }] },
};
// Marking menus de Alias (Ctrl+Shift + botón del ratón), cada uno con las opciones y el lugar de la hoja de Alias:
// 8 en el anillo (empezando arriba y en el sentido del reloj) y el resto en una columna debajo (extras; null = hueco).
// label = nombre en Forja; alias = nombre en Alias (sale en el centro al pasar por encima).
const queryHistory = () => {
  const o = selObjs.length === 1 && pickMode === 'object' ? selObjs[0] : null, r = o && relations.find((x) => outputOf(x) === o.id);
  if (r) TW.show(relSpec(r)); else toast(o ? `${o.name} no tiene historial de construcción.` : 'Elige un objeto con historial (verde) y vuelve a usar Query Edit History.');
};
const PICK_MM = [
  { k: 'nothing', label: 'Nada', alias: 'Nothing', run: pickNothing },
  { k: 'cv', label: 'CV', alias: 'CV', key: 'P', run: () => setPickMode('cv') },
  { k: 'pickCurve', label: 'Curvas', alias: 'Curves', run: () => setPickMode('object', 'curve') },
  { k: 'blendPt', label: 'Punto de blend', alias: 'Blend Point', soon: true },
  { k: 'object', label: 'Objeto', alias: 'Object', key: 'O', run: () => setPickMode('object') },
  { k: 'pickSurf', label: 'Superficie', alias: 'Surface', run: () => setPickMode('object', 'surface') },
  { k: 'mesh', label: 'Malla', alias: 'Mesh', run: () => setPickMode('object', 'mesh') },
  { k: 'cos', label: 'Curva s/ superficie', alias: 'Curve-on-Surface', run: () => setPickMode('object', 'cos') },
];
PICK_MM.extras = [
  { k: 'construct', label: 'Construcción', alias: 'Construction', soon: true },
  { k: 'locator', label: 'Localizador', alias: 'Locator', run: () => withSelection('locmin') },
];
const XFORM_MM = [
  { k: 'move', label: 'Mover', alias: 'Move', key: 'W', run: mv },
  { k: 'pivot', label: 'Mover pivote', alias: 'Move Pivot', key: 'D', run: togglePivotEdit },
  { k: 'scale', label: 'Escalar', alias: 'Scale', key: 'R', run: scl },
  { k: 'centerPivot', label: 'Centrar pivote', alias: 'Center Pivot', run: centerPivots },
  { k: 'rotate', label: 'Rotar', alias: 'Rotate', key: 'E', run: rot },
  { k: 'npScale', label: 'Escalar no prop.', alias: 'NonProportional Scale', run: sclNP },
  { k: 'history', label: 'Ver historial', alias: 'Query Edit History', run: queryHistory },
  { k: 'frame', label: 'Mirar a', alias: 'Look At', key: 'F', run: frameSelection },
];
XFORM_MM.extras = [{ k: 'delLoc', label: 'Borrar localizadores', alias: 'Delete Locators', run: () => deleteLocators() }];
const DISPLAY_MM = [
  { k: 'info', label: 'Información', alias: 'Information Window', run: () => $('panel').classList.add('show') },
  { k: 'shadeQ', label: 'Sombreado calidad', alias: 'Shade (Quality)', run: () => { if (layout !== 'diag') switchLayout('diag'); if (diagMode === 'wire') toggleWire(); setShadeReal(true); } },
  { k: 'shadeF', label: 'Sombreado rápido', alias: 'Shade (Fast)', run: () => { if (layout !== 'diag') switchLayout('diag'); if (diagMode === 'wire') toggleWire(); setShadeReal(false); } },
  { k: 'ctrlOn', label: 'Controles ON', alias: 'Controls ON', run: () => setPickMode('cv') },
  { k: 'planeEd', label: 'Editor de plano', alias: 'Plane Editor', soon: true },
  { k: 'ctrlOff', label: 'Controles OFF', alias: 'Controls OFF', run: () => setPickMode('object') },
  { k: 'grid', label: 'Rejilla', alias: 'Toggle Grid', run: toggleGrid },
  { k: 'model', label: 'Modelo', alias: 'Toggle Model', run: toggleModel },
];
DISPLAY_MM.extras = [
  { k: 'palette', label: 'Paleta', alias: 'Palette', run: () => layersWin.togglePin() },
  { k: 'shelf', label: 'Estante', alias: 'Shelf', soon: true },
  { k: 'panel', label: 'Panel', alias: 'Panel', run: () => setPinned(!pinned) },
  null,
  { k: 'full', label: 'Pantalla completa', alias: 'Fullscreen Display', run: fullscreen },
];

const RADIAL_TILT = 1;     // anillo circular (neumorfismo plano; antes 0,6 = anillo 3D visto desde arriba)
// desenfoque del visor 3D bajo los menús radiales (solo el visor: la cabecera y los paneles no se desenfocan)
const radialVeil = document.createElement('div');
radialVeil.className = 'radial-veil';
$('view').append(radialVeil);
// desenfoque LOCAL: un círculo de bordes suaves alrededor del menú abierto (el resto del visor queda nítido)
const syncRadialVeil = () => {
  const m = MENUS.find((q) => q?.open && q !== puck3);
  radialVeil.classList.toggle('on', !!m);
  if (!m) return;
  const v = $('view').getBoundingClientRect(), R = m.radius || 260;
  Object.assign(radialVeil.style, { left: m.at.x - v.left - R + 'px', top: m.at.y - v.top - R + 'px', width: 2 * R + 'px', height: 2 * R + 'px' });
};
function makeRadial(items, { r = 140, title = '', keepTool = false } = {}) {
  const K = RADIAL_TILT, r2 = r + 78, R = r2 + 46;
  const el = document.createElement('div');
  el.className = 'puck'; el.hidden = true;
  el.innerHTML = `<svg class="puck-lines" viewBox="${-R} ${-R} ${2 * R} ${2 * R}" width="${2 * R}" height="${2 * R}" style="left:${-R}px;top:${-R}px">
      <ellipse rx="${r}" ry="${r * K}" /><ellipse class="outer" rx="${r2}" ry="${r2 * K}" /><line x1="0" y1="0" x2="0" y2="0" /></svg>
    <div class="puck-center"><b></b><span></span></div>`;
  document.body.append(el);
  const line = el.querySelector('line'), cName = el.querySelector('.puck-center b'), cHint = el.querySelector('.puck-center span');
  const mains = [], all = [];
  const button = (it, x, y, depth, cls, from = [0, 0], delay = 0) => {
    const b = document.createElement('button');
    // de dónde brota (el centro, o su opción si es de un submenú) y su pequeño retraso: apertura en flor
    b.style.setProperty('--bx', from[0] - x + 'px'); b.style.setProperty('--by', from[1] - y + 'px'); b.style.setProperty('--d', delay + 'ms');
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
    const m = { it, a, x, y, base: 1, subs: [] };
    m.b = button(it, x, y, depth, 'main', [0, 0], n * 8);
    // submenú: esferas pequeñas en un arco hacia fuera, centrado en la dirección de su esfera
    const subs = it.sub || [], step = 62 / r2;   // 62 px entre pétalos del submenú: deja sitio a su etiqueta
    subs.forEach((sit, j) => {
      const sa = a + (j - (subs.length - 1) / 2) * step, sd = (Math.sin(sa) + 1) / 2;
      const sx = Math.cos(sa) * r2, sy = Math.sin(sa) * r2 * K;
      const sm = { it: sit, a: sa, x: sx, y: sy, base: 1, parent: m, sub: true };
      sm.b = button(sit, sx, sy, sd, 'sub', [x, y], j * 10);
      m.subs.push(sm); all.push(sm);
    });
    mains.push(m); all.push(m);
  });
  // extras: columna de pastillas debajo del anillo (como en los marking menus de Alias); null deja un hueco
  const extras = [];
  let ey = r + 74;
  (items.extras || []).forEach((it, n) => {
    if (!it) { ey += 18; return; }
    const m = { it, x: 0, y: ey, base: 1, subs: [], extra: true };
    m.b = button(it, 0, ey, 1, 'extra', [0, 0], (items.length + n) * 8);
    extras.push(m); all.push(m); ey += 44;
  });
  const below = extras.length ? ey - 44 + 30 : 0;
  const st = { el, title, open: false, at: { x: 0, y: 0 }, hover: null, active: null, sticky: false, radius: Math.max(R + 40, below + 50) };
  const magnify = (mx, my) => all.forEach((x) => {
    const d = mx == null ? 1e9 : Math.hypot(x.x - mx, x.y - my);
    const s = x.base * (1 + 0.14 * Math.exp(-(d * d) / (2 * 42 * 42))) * (x === st.hover ? 1.06 : 1);
    x.b.style.setProperty('--s', s.toFixed(3));
  });
  st.highlight = (h) => {
    st.hover = h;
    if (h) st.active = h.sub ? h.parent : h;
    mains.forEach((m) => m.subs.forEach((x) => x.b.classList.toggle('open', m === st.active)));
    all.forEach((x) => { x.b.classList.toggle('on', x === h); x.b.classList.toggle('parent', !!h?.sub && x === h.parent); });
    line.setAttribute('x2', h ? h.x : 0); line.setAttribute('y2', h ? h.y : 0);
    cName.textContent = h ? h.it.label : title;
    cHint.textContent = h ? ([h.it.alias, h.it.soon ? 'próximamente' : h.it.key].filter(Boolean).join(' · ') || (h.subs?.length ? 'más opciones afuera' : '')) : 'suelta sobre una opción';
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
    const ex = extras.find((o) => Math.abs(dx - o.x) < 105 && Math.abs(dy - o.y) < 21);
    if (ex) { st.highlight(ex); magnify(dx, dy); return; }
    if (d < 52) { st.highlight(null); st.active = null; magnify(dx, dy); return; }
    // marking menu: mientras se mantiene el botón (o la tecla) manda la DIRECCIÓN, como en Alias; ya abierto (sticky), la cercanía
    if (d < r + 38 || !st.active?.subs.length) { const m = nearest(mains, ang)[0]; st.highlight(near(m, 66) || (!st.sticky && d < r + 90) ? m : null); }
    else {
      const sub = nearest(st.active.subs, ang)[0];
      st.highlight(near(sub, 44) ? sub : near(st.active, 70) ? st.active : null);
    }
    magnify(dx, dy);
  };
  st.show = (x, y) => {
    const m = R * 0.92;
    st.at = { x: Math.min(innerWidth - m, Math.max(m, x)), y: Math.min(innerHeight - Math.max(m * K, below) - 40, Math.max(m * K + 40, y)) };
    el.style.left = st.at.x + 'px'; el.style.top = st.at.y + 'px';
    el.classList.remove('bloom', 'settled');
    const wc = wallColorAt(st.at.x, st.at.y); if (wc) el.style.setProperty('--nm', wc);   // el color exacto del muro detrás
    el.hidden = false; st.open = true; st.sticky = false; st.active = null; st.highlight(null); magnify(null); st.t0 = performance.now();
    syncRadialVeil();
    void el.offsetWidth;                       // parte del estado cerrado (todo en el centro) para que la flor se abra
    el.classList.add('bloom');
    el.classList.add('settled');
  };
  st.close = (run) => {
    if (!st.open) return;
    st.open = false; el.hidden = true; el.classList.remove('bloom', 'settled');
    syncRadialVeil();
    const h = st.hover;
    if (!run || !h) return;
    if (h.it.soon || !h.it.run) return soon(h.it.label);
    if (!keepTool && !h.it.keepTool) endActiveTool('switch');   // una herramienta nueva corta la anterior (su cleanup)
    h.it.run();
  };
  all.forEach((x) => {
    x.b.addEventListener('pointerenter', () => st.highlight(x));
    x.b.addEventListener('click', () => { st.highlight(x); st.close(true); });
  });
  return st;
}
// ---------- Puck de MODELADO (Z): Curvas · Superficies · Sólidos, cada una con hasta 3 anillos de herramientas (src/puck3.js) ----------
// PUCK3_LIB = biblioteca de herramientas. Las 'shared' (mover, duplicar, simetría, borrar...) son instancias por contexto: al usarlas
// desde un anillo se quedan solo con lo elegido de ese tipo (curvas / superficies / sólidos) y guardan sus opciones por contexto
// (params = claves de toolDef, p. ej. el plano de la simetría de Superficies no es el de Curvas).
const PUCK3_LIB = {
  curve: { k: 'curve', label: 'Curva', run: () => setTool('curve') }, line: { k: 'curve', label: 'Línea', run: () => startLine() }, circle: { k: 'circle', label: 'Círculo', run: () => setTool('circle') },
  ground: { k: 'ground', label: 'Curva en el suelo', run: () => { setDrawPlane('xz'); setTool('curve'); } },
  front: { k: 'front', label: 'Curva de frente', run: () => { setDrawPlane('xy'); setTool('curve'); } },
  project: { k: 'project', label: 'Proyectar', run: () => projectSelection() }, trim: { k: 'project', label: 'Trim', run: () => trimSelection() }, untrim: { k: 'project', label: 'Untrim', run: () => untrimSelection() }, flip: { k: 'symm', label: 'Invertir normales', run: () => withSelection('flip') },
  locmin: { k: 'pivot', label: 'Locator mínima', run: () => withSelection('locmin') }, locmax: { k: 'pivot', label: 'Locator máxima', run: () => withSelection('locmax') }, cv: { k: 'cv', label: 'CV', run: () => setPickMode('cv') },
  plane: { k: 'plane', label: 'Plano', run: () => setTool('plane') }, revolve: { k: 'revolve', label: 'Revolución', run: () => OPS.revolve() },
  loft: { k: 'loft', label: 'Loft', run: () => OPS.loft() }, extrude: { k: 'extrude', label: 'Extruir', run: () => OPS.extrude() },
  skin: { k: 'loft', label: 'Skin', run: () => startEdgeOp('skin') }, blend: { k: 'edit', label: 'Blend', run: () => startEdgeOp('blend') },
  align: { k: 'align', label: 'Align', run: () => startEdgeOp('align') }, extend: { k: 'extend', label: 'Extender', run: () => startExtendU() },
  offset: { k: 'offset', label: 'Offset', run: () => offsetSelection() },
  fillet: { k: 'round', label: 'Redondear', run: () => $('t-fillet').click() }, gfillet: { k: 'round', label: 'Redondeo G2', run: () => startEdgeOp('gfillet') }, chamfer: { k: 'round', label: 'Chaflán', run: () => $('t-chamfer').click() },
  bool: { k: 'object', label: 'Booleanas', soon: true }, forge: { k: 'cube', label: 'Forge (relieves)', run: () => switchLayout('forge') },
  pivot: { k: 'pivot', label: 'Pivote', run: () => togglePivotEdit() }, undo: { k: 'undo', label: 'Deshacer', run: () => undo() },
  layers: { k: 'layers', label: 'Capas', run: () => layersWin.show() }, showAll: { k: 'show', label: 'Mostrar todo', run: () => unhideAll() },
  prefs: { k: 'gear', label: 'Personalizar el Puck', run: () => openPrefs('puck') },
  // compartidas (se aplican al tipo del anillo)
  pick: { k: 'arrow', label: 'Elegir', shared: true, run: (c) => setPickMode('object', c === 'curves' ? 'curve' : 'surface') },
  move: { k: 'move', label: 'Mover', shared: true, run: () => mv() }, rotate: { k: 'rotate', label: 'Rotar', shared: true, run: () => rot() },
  scale: { k: 'scale', label: 'Escalar', shared: true, run: () => scl() }, dup: { k: 'dup', label: 'Duplicar', shared: true, run: () => duplicateSelection() },
  mirror: { k: 'symm', label: 'Simetría', shared: true, params: ['mirrorPlane'], run: () => mirrorSelection() },
  hide: { k: 'hide', label: 'Ocultar', shared: true, run: () => hideSelection() }, del: { k: 'del', label: 'Borrar', shared: true, run: () => deleteSelection() },
  frame: { k: 'frame', label: 'Encuadrar', shared: true, run: () => frameSelection() },
};
const PUCK3_CATS = [
  { id: 'curves', label: 'Curvas', k: 'curve', rings: [['curve', 'circle', 'project', 'align', 'pick', 'move'], ['mirror', 'dup', 'rotate', 'scale', 'hide', 'del'], ['ground', 'front', 'cv', 'pivot', 'frame', 'undo']] },
  { id: 'surfaces', label: 'Superficies', k: 'surf', rings: [['plane', 'revolve', 'loft', 'extrude', 'skin', 'blend'], ['align', 'extend', 'offset', 'fillet', 'gfillet', 'trim', 'untrim', 'flip', 'mirror', 'dup'], ['move', 'rotate', 'scale', 'pick', 'hide', 'del']] },
  { id: 'solids', label: 'Sólidos', k: 'cube', rings: [['fillet', 'chamfer', 'bool', 'forge', 'move', 'dup'], ['rotate', 'scale', 'mirror', 'hide', 'del', 'frame'], ['layers', 'showAll', 'undo', 'prefs']] },
];
const CTX_KIND = { curves: (o) => o.kind === 'curve', surfaces: (o) => o.kind === 'surface', solids: (o) => o.kind === 'mesh' };
let ctxInst = null;   // la última instancia usada: sus opciones se guardan al usar otra o al volver a abrir el Puck
function runPuck3(id, ctx) {
  const t = PUCK3_LIB[id], P = prefs.puck3 || (prefs.puck3 = {});
  // desde Visu, IA o Forge las herramientas de modelado llevan antes al módulo Modelado
  if (layout !== 'diag' && layout !== 'split' && !['forge', 'prefs', 'undo', 'layers', 'showAll'].includes(id)) switchLayout('diag');
  if (!['prefs', 'undo', 'layers', 'showAll'].includes(id)) endActiveTool('switch');   // la herramienta anterior hace su cleanup
  if (ctxInst) { const [cId, cCtx] = ctxInst, ct = PUCK3_LIB[cId]; if (ct?.params) { P.inst = { ...(P.inst || {}), [cCtx + ':' + cId]: Object.fromEntries(ct.params.map((k) => [k, toolDef[k]])) }; savePrefs(); } }
  if (t.shared) {
    const keep = selObjs.filter(CTX_KIND[ctx]);
    if (keep.length !== selObjs.length) { selObjs.length = 0; selObjs.push(...keep); selectionChanged(); }
    const inst = P.inst?.[ctx + ':' + id];
    if (t.params && inst) Object.assign(toolDef, inst);
    ctxInst = [id, ctx];
  }
  t.run(ctx);
}
const puck3 = createPuck3({
  cats: PUCK3_CATS, lib: PUCK3_LIB, icon, esc, soon,
  cfg: prefs.puck3 || (prefs.puck3 = {}), save: savePrefs, run: runPuck3,
  wallColor: (x, y) => wallColorAt(x, y) || getComputedStyle(document.documentElement).getPropertyValue('--bg'),
});
// Z = el Puck (Curvas · Superficies · Sólidos) en todos los módulos
const getPuck = () => puck3;
const pickMenu = makeRadial(PICK_MM, { r: 128, title: 'Selección' });
const xformMenu = makeRadial(XFORM_MM, { r: 128, title: 'Transformar' });
const disp = makeRadial(DISPLAY_MM, { r: 140, title: 'Visualización', keepTool: true });
// En VISU los menús solo llevan cosas de visualización (nada de modelado ni de IA, que cambiarían de módulo)
const VISU_MM = ['mats', 'mats2', 'env', 'bg', 'tone', 'expo', 'frame'].map((id) => VISU_CMDS[id])
  .concat([{ k: 'screen', label: 'Pantalla', run: fullscreen, sub: [{ k: 'full', label: 'Completa', run: fullscreen }, { k: 'panel', label: 'Panel', run: () => setPinned(!pinned) }] }]);
const dispVisu = makeRadial(VISU_MM, { r: 140, title: 'Visu', keepTool: true });
const MENUS = [puck3, pickMenu, xformMenu, disp, dispVisu];
// Ctrl+Shift + izq / medio / der = Selección / Transformar / Visualización (en todos los módulos, como Alias)
const menuFor = (button) => [pickMenu, xformMenu, disp][button] || disp;
let lastPtr = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  lastPtr = { x: e.clientX, y: e.clientY };
  for (const m of MENUS) if (m.open) m.pickAt(e.clientX, e.clientY);
});
addEventListener('pointerdown', (e) => {
  for (const m of MENUS) if (m.open && m.sticky && !e.target.closest('.puck, .mmenu')) m.close(false);
}, true);
// Z = Puck. Mantener y soltar sobre la opción; una pulsación corta lo deja abierto para hacer clic.
// la tecla se reconoce por code, key o keyCode (algunos visores entregan solo uno de los tres)
// El Puck va en la Z (antes Tab: en el visor del usuario Tab no llegaba bien a la página). Sin Ctrl/Alt/Cmd: Ctrl+Z sigue siendo deshacer.
const KEY_IDS = { KeyZ: ['KeyZ', 'z', 90] };
// Tab nunca cuenta como ninguna tecla de menú, venga como venga el evento (key, code o keyCode 9)
const isTab = (e) => e.key === 'Tab' || e.code === 'Tab' || e.keyCode === 9 || e.which === 9;
const isKey = (e, code) => {
  if (e.ctrlKey || e.metaKey || e.altKey || isTab(e) || !e.isTrusted) return false;
  const [c, k, n] = KEY_IDS[code];
  return e.code === c || (e.key || '').toLowerCase() === k || e.keyCode === n;
};
// registro de qué abrió cada menú (Ayuda › Qué abrió el último menú): para encontrar fallos de teclas en el equipo del usuario
const menuLog = [];
const logMenu = (m, how) => { menuLog.push(`${m.title || 'Puck'} ← ${how}`); if (menuLog.length > 8) menuLog.shift(); };
function bindKey(code, getMenu) {
  let m = null;
  addEventListener('keydown', (e) => {
    if (!isKey(e, code) || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName) || e.target.closest?.('dialog')) return;
    e.preventDefault();
    if (e.repeat) return;
    if (m?.open && m.sticky) return m.close(false);
    m = getMenu();
    logMenu(m, `tecla key="${e.key}" code="${e.code}" keyCode=${e.keyCode}`);
    m.show(lastPtr.x, lastPtr.y); m.t0 = performance.now();
  }, true);
  addEventListener('keyup', (e) => {
    if (!m) return;
    if (!isKey(e, code) || !m.open || m.sticky) return;
    e.preventDefault();
    m.pickAt(lastPtr.x, lastPtr.y);
    if (m.hover) m.close(true);
    else if (performance.now() - m.t0 < 400) m.sticky = true;
    else m.close(false);
  }, true);
}
bindKey('KeyZ', getPuck);
// NINGUNA tecla abre el menú de Visualización (antes Espacio): solo Ctrl+Shift+clic derecho, como en Alias. La única tecla de menú es la Z.
// Tab NO hace nada en Forja (el Puck está en la Z). Tab movía el foco a un botón de la barra izquierda y, como esa barra se mostraba
// con el foco dentro (:focus-within), "desplegaba" el menú. Ahora: Tab bloqueado en todas partes salvo en cuadros de texto y diálogos,
// y si el foco llega igual a un botón (p. ej. con Tab desde fuera de la página) se le quita.
const typing = (el) => ['INPUT', 'SELECT', 'TEXTAREA'].includes(el?.tagName) || !!el?.closest?.('dialog');
addEventListener('keydown', (e) => { if (e.key === 'Tab' && !typing(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
addEventListener('keyup', (e) => { if (e.key === 'Tab' && !typing(e.target)) { e.preventDefault(); e.stopImmediatePropagation(); } }, true);
addEventListener('focusin', (e) => { if (!typing(e.target) && e.target !== document.body && e.target.matches?.(':focus-visible')) e.target.blur(); }, true);
// Esc con un menú abierto solo cierra el menú; si no, lo atiende escapeAll (kill switch)
addEventListener('keydown', (e) => { if (e.key === 'Escape' && MENUS.some((m) => m.open)) { e.stopImmediatePropagation(); MENUS.forEach((m) => m.close(false)); } }, true);
// ---------- Kill switch: Esc o clic en el vacío → cleanup() de la herramienta activa, soltar todo y volver a IDLE ----------
function cvsOff(list = objects) { list.forEach((o) => { o.showCVs = false; applyVisibility(o); }); }
function escapeAll(reason = 'esc') {
  // Mover / Rotar / Escalar son PERSISTENTES: "Nada" o un clic en el vacío solo sueltan la selección (la herramienta sigue lista para
  // los siguientes CVs u objetos); solo Esc u otro comando las cierran
  // "Pick Nothing" (como unpick de AlPickable): suelta el NODO; los CVs siguen a la vista hasta Mostrar › Apagar CVs
  if (reason !== 'esc' && activeTool?.persist) { clearSelection(); updateHint(); return; }
  // la curva en dibujo con 2 o más CVs se guarda (commit) y queda en la escena; luego todo se suelta
  const made = activeTool?.id === 'tool:curve' ? commitWIP() : null;
  endActiveTool(reason);
  if (pivotEdit) togglePivotEdit();
  mouseXform = false;
  if (TW.spec) TW.hide();
  clearSelection(); updateHint();   // los CVs encendidos se quedan (solo Mostrar › Apagar CVs los oculta)
  if (made) toast(`${made.name} guardada`);
}
addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || typing(e.target) || !$('quickpick').hidden || e.defaultPrevented) return;
  e.preventDefault(); e.stopImmediatePropagation();
  escapeAll('esc');
}, true);
// ¿el clic cae en el vacío? (ni objeto, ni CV, ni línea, ni manija, ni manipulador, ni lo que la herramienta diga que es suyo)
function isVoidAt(e) {
  if (gizmo.axis) return false;
  if (activeTool?.hit?.(e)) return false;
  if (pickAt(e)) return false;
  if (lineCandidates(e, 'both', 8, pickable).length) return false;
  setRay(e);
  if (relArrows.children.length && ray.intersectObjects(relArrows.children.map((a) => a.userData.pick), false).length) return false;
  return true;
}
let voidDown = null;
addEventListener('pointerdown', (e) => {
  voidDown = null;
  if (e.target !== renderer.domElement || e.button !== 0 || e.ctrlKey || e.shiftKey || e.altKey || e.metaKey || navHeld) return;
  if (!activeTool || activeTool.voidKill === false) return;
  voidDown = { x: e.clientX, y: e.clientY, empty: isVoidAt(e) };
}, true);
addEventListener('pointerup', (e) => {
  const v = voidDown; voidDown = null;
  if (!v?.empty || !activeTool || Math.hypot(e.clientX - v.x, e.clientY - v.y) > 5) return;
  const name = activeTool.label, persist = activeTool.persist;
  escapeAll('void');
  if (!persist) toast(`${name}: terminada (clic en el vacío)`);
}, true);
let mouseMenu = null;
addEventListener('pointerdown', (e) => {
  if (!(e.ctrlKey && e.shiftKey) || e.target !== renderer.domElement || carousel) return;
  e.stopImmediatePropagation(); e.preventDefault();
  MENUS.forEach((m) => m.close(false));
  mouseMenu = menuFor(e.button);
  logMenu(mouseMenu, `Ctrl+Shift + botón ${e.button} (${e.pointerType})`);
  mouseMenu.show(e.clientX, e.clientY);
}, true);
addEventListener('pointerup', (e) => {
  const m = mouseMenu;
  if (!m) return;
  mouseMenu = null; e.stopImmediatePropagation();
  m.pickAt(e.clientX, e.clientY);   // la opción bajo el cursor en el instante de soltar (sin depender del último movimiento)
  if (m.hover) m.close(true);
  else if (performance.now() - m.t0 < 350) m.sticky = true;      // clic rápido: queda abierto
  else m.close(false);
}, true);

// ---------- Capas y grupos ----------
// Cada objeto vive en una capa (se puede ocultar entera) y puede estar en un grupo (carpeta en la escena).
// Elegir un objeto agrupado elige el grupo entero, como un nodo de grupo de Alias.
const layerOn = (id) => layers.find((l) => l.id === id)?.visible !== false;
function initObj(obj) {
  // origen LOCAL: al crearse, el objeto está en (0, 0, 0) de su propio sistema; Transform info mide desde aquí
  if (obj.pivot && !obj.origin0) obj.origin0 = obj.pivot.clone();
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
// ---------- Capas: estado, color y simetría (acciones de la interfaz) ----------
const LAYER_MODES = { pick: 'Elegible (editable)', ref: 'Referencia (visible, no se elige ni se edita)', inactive: 'Inactiva (visible, atenuada, no se elige)' };
const LAYER_MODE_LETTER = { pick: 'E', ref: 'R', inactive: 'I' };
const LAYER_MODE_NEXT = { pick: 'ref', ref: 'inactive', inactive: 'pick' };
function setLayerMode(l, m) {
  checkpoint();
  l.mode = m;
  if (m !== 'pick') for (let i = selObjs.length - 1; i >= 0; i--) if (selObjs[i].layer === l.id) { cvTargets.delete(selObjs[i].id); selObjs.splice(i, 1); }
  for (const [k, c] of selCVs) { if (c.obj?.layer === l.id && m !== 'pick') selCVs.delete(k); }
  objects.forEach(applyVisibility); selectionChanged(); renderLayers();
  toast(`${l.name}: ${LAYER_MODES[m]}`);
}
function setLayerColor(l, c) {
  l.color = c || null;
  objects.forEach(applyVisibility);
}
function toggleSym(l, on = !l.sym?.on) {
  checkpoint();
  l.sym = { plane: 'xz', ...(l.sym || {}), on };
  sceneChangedAt = performance.now(); renderLayers();
  toast(on ? `${l.name}: simetría ${SYM_NAMES[l.sym.plane]}` : `${l.name}: simetría apagada`);
}
function symMenu(l, anchor) {
  document.querySelectorAll('.sym-menu').forEach((m) => m.remove());
  const m = document.createElement('div');
  m.className = 'sym-menu';
  const cur = l.sym?.plane || 'xz';
  const item = (label, on, fn) => { const b = document.createElement('button'); b.textContent = (on ? '● ' : '○ ') + label; b.addEventListener('click', () => { m.remove(); fn(); }); m.append(b); };
  item(l.sym?.on ? 'Simetría activada' : 'Activar simetría', !!l.sym?.on, () => toggleSym(l));
  m.append(document.createElement('hr'));
  for (const k of ['xz', 'xy', 'yz']) item(SYM_NAMES[k], cur === k, () => { checkpoint(); l.sym = { ...(l.sym || {}), plane: k, on: true }; sceneChangedAt = performance.now(); renderLayers(); });
  item('Plano personalizado (vector)…', cur === 'custom', () => {
    const v = prompt('Vector normal del plano de simetría (x, y, z) — en ejes de Forja, Y arriba', (l.sym?.n || [1, 0, 0]).join(', '));
    const n = v && v.split(/[ ,;]+/).map(Number).filter((x) => Number.isFinite(x));
    if (n && n.length === 3 && Math.hypot(...n) > 1e-6) { checkpoint(); l.sym = { ...(l.sym || {}), plane: 'custom', n, on: true }; sceneChangedAt = performance.now(); renderLayers(); }
    else if (v) toast('Hacen falta tres números distintos de cero, p. ej. 1, 0, 0');
  });
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.min(r.left, innerWidth - 220) + 'px'; m.style.top = r.bottom + 2 + 'px';
  document.body.append(m);
  const off = (e) => { if (!m.contains(e.target)) { m.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
}


// ---------- Deshacer / rehacer ----------
// Antes de cada cambio se guarda una copia de la escena (como mucho una por tarea del navegador, así un
// arrastre o una operación que crea varios objetos cuentan como un solo paso). Ctrl+Z o Ctrl+X deshacen.
const undoStack = [], redoStack = [];
let restoring = false, cpArmed = false;
function cloneData(o) {
  const d = o.data ?? o;
  if (o.kind === 'mesh') return { geometry: d.geometry.clone() };
  if (o.kind === 'surface') {
    const c = { degU: d.degU, degV: d.degV, knotsU: d.knotsU.slice(), knotsV: d.knotsV.slice(), cvs: d.cvs.map((r) => r.map(cloneV4)) };
    const st = trimStages(d);
    if (st.length) c.rtrims = st.map(cloneStage);
    return c;
  }
  const c = { deg: d.deg, knots: d.knots.slice(), plane: d.plane, cvs: d.cvs.map(cloneV4) };
  if (d.cos) c.cos = { ...d.cos, uv: d.cos.uv.map((q) => q.slice()) };
  return c;
}
const cloneLayer = (l) => ({ ...l, sym: l.sym ? { ...l.sym, n: l.sym.n ? [...l.sym.n] : undefined } : undefined });
function snapshot() {
  return {
    layers: layers.map(cloneLayer), activeLayer, nextLayerId, groups: groups.map((g) => ({ ...g })), nextGroupId,
    relations: relations.map((r) => ({ ...r })), nextRelId,
    objects: objects.map((o) => ({ id: o.id, kind: o.kind, name: o.name, mat: o.mat, own: o.ownVisible, layer: o.layer, group: o.group, pivot: o.pivot.clone(), origin0: (o.origin0 || o.pivot).clone(), showCVs: !!o.showCVs, data: cloneData(o) })),
  };
}
var cpMuted = 0;   // > 0: no se guardan pasos de deshacer (vistas previas en vivo; el paso se guardó al empezar)
function checkpoint() {
  if (restoring || cpArmed || cpMuted) return;
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
  layers.splice(0, layers.length, ...st.layers.map(cloneLayer));
  groups.splice(0, groups.length, ...st.groups.map((g) => ({ ...g })));
  nextLayerId = st.nextLayerId; nextGroupId = st.nextGroupId;
  relations.splice(0, relations.length, ...(st.relations || []).map((r) => ({ ...r }))); nextRelId = st.nextRelId || nextRelId;
  const act = st.activeLayer;
  for (const it of st.objects) {
    nextId = it.id; activeLayer = it.layer;
    const d = cloneData({ kind: it.kind, data: it.data });
    const o = it.kind === 'surface' ? addSurface(d, it.name) : it.kind === 'curve' ? addCurve(d, it.name) : addMesh(d.geometry, it.name);
    o.name = it.name; o.mat = it.mat; o.visible = it.own; o.group = it.group; o.pivot.copy(it.pivot);
    if (it.origin0) o.origin0 = new THREE.Vector3().copy(it.origin0);
    o.showCVs = !!it.showCVs;
  }
  activeLayer = act;
  nextId = Math.max(1, ...objects.map((o) => o.id + 1));
  restoring = false;
  // las curvas sobre superficie se crean después de su superficie: se recortan ahora
  objects.filter((o) => o.kind === 'curve' && o.data.cos).forEach(updateObject);
  objects.forEach(applyVisibility);
  selectionChanged(); refreshOutliner(); renderLayers(); renderHistory();
}
// Al deshacer o rehacer, lo que estaba activo y elegido (objetos, CVs, el pivote en edición) sigue activo y elegido si todavía existe.
// restore() recrea los objetos con los mismos ids, así que se vuelve a elegir por id y por clave de CV.
function captureActive() {
  return { objs: selObjs.map((o) => o.id), cvs: [...selCVs.keys()], targets: [...cvTargets], pivot: pivotEdit };
}
function reactivate(st) {
  const objs = st.objs.map(byId).filter(Boolean);
  const refs = [];
  if (st.cvs.length) {
    const want = new Set(st.cvs);
    for (const o of objects) for (const h of o.parts.handles.children) if (want.has(h.userData.key)) refs.push(h.userData);
  }
  if (!objs.length && !refs.length) return;
  cvTargets.clear(); st.targets.filter((id) => byId(id)).forEach((id) => cvTargets.add(id));
  selObjs.length = 0; selCVs.clear();
  objs.forEach((o) => selObjs.push(o));
  refs.forEach((r) => selCVs.set(r.key, r));
  selectionChanged();
  if (st.pivot && selObjs.length && pickMode === 'object') { pivotEdit = true; gizmo.setMode('translate'); updateXformButtons(); attachGizmo(); renderSelectionPanel(); }
}
function undo() {
  if (!undoStack.length) return toast('Nada que deshacer');
  const act = captureActive();
  redoStack.push(snapshot()); restore(undoStack.pop()); reactivate(act); toast('Deshacer');
}
function redo() {
  if (!redoStack.length) return toast('Nada que rehacer');
  const act = captureActive();
  undoStack.push(snapshot()); restore(redoStack.pop()); reactivate(act); toast('Rehacer');
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
  $('eval-a').innerHTML = MAP_TYPES.map((m) => `<button class="ev-ball" data-diag="${m.k}" title="${m.label} (${m.key})">${ph(m)}</button>`).join('');
  $('eval-b').innerHTML = MAP_TYPES.map((m) => `<button class="ev-tile" data-diag="${m.k}">${ph(m)}<b>${m.label}</b><kbd>${m.key}</kbd></button>`).join('');
  $('eval-c-fly').innerHTML = MAP_TYPES.map((m) => `<button class="ev-row" data-diag="${m.k}">${ph(m)}<b>${m.label}</b><kbd>${m.key}</kbd></button>`).join('');
  $('eval-c-btn').innerHTML = `<span class="ev-ph" data-thumb="current"></span>`;
  document.querySelectorAll('#eval-a [data-diag], #eval-b [data-diag], #eval-c-fly [data-diag]').forEach((b) => b.addEventListener('click', () => setDiag(b.dataset.diag)));
  // miniaturas: una esfera con cada shader, renderizada una vez en un lienzo aparte (cuando ya cargaron los mapas de Alias)
  aliasTexReady.then(() => requestAnimationFrame(() => {
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
    for (const m of MAP_TYPES) {
      const mats = { forja: envDiagMat, zebra: zebraMat, curv: curvMat };
      if (ALIAS_MAP_OF[m.k]) { mats[m.k] = mapTypeMat; mapTypeMat.uniforms.uMap.value = aliasTex[m.k] || null; }
      ts.remove(ball, wire);
      if (m.k === 'wire') ts.add(wire); else { ball.material = mats[m.k]; ts.add(ball); }
      const keep = envDiagMat.uniforms.uMode.value;
      if (ENV_MODES[m.k] && !ALIAS_MAP_OF[m.k]) envDiagMat.uniforms.uMode.value = ENV_MODES[m.k];
      tr.render(ts, tc);
      envDiagMat.uniforms.uMode.value = keep;
      evalThumbs[m.k] = tr.domElement.toDataURL();
    }
    tr.dispose(); tr.forceContextLoss();
    updateEvalUI();
  }));
}
function updateEvalUI() {
  const app = $('app');
  if (!app || !$('eval-a')) return;
  app.dataset.evalui = prefs.evalUI;
  document.querySelectorAll('[data-thumb]').forEach((el) => {
    const k = el.dataset.thumb === 'current' ? diagMode : el.dataset.thumb;
    if (evalThumbs[k]) el.style.backgroundImage = `url(${evalThumbs[k]})`;
  });
  const cur = MAP_TYPES.find((m) => m.k === diagMode);
  $('eval-c-btn').title = `Map Type: ${cur?.label || 'Malla'} (pasa el ratón para cambiar)`;
  if ($('pane-mode')) $('pane-mode').textContent = prefs.shadeReal ? '· REALISTA' : cur ? '· ' + cur.label.toUpperCase() : diagMode === 'wire' ? '· MALLA' : '';
}

// ---------- Barra de menús (como la de Alias) ----------
const chk = (f) => ({ check: f });
const MENUBAR = [
  ['Archivo', [
    { label: 'Abrir…', key: 'Ctrl+O', run: () => $('io-file').click() }, { label: 'Guardar proyecto', key: 'Ctrl+S', run: () => doExport('forja') }, { label: 'Archivos recientes…', run: () => openRecent() },
    { sep: true }, { label: 'Importar y exportar…', key: 'Ctrl+E', run: () => toggleFilePanel() }]],
  ['Editar', [
    { label: 'Deshacer', key: 'Ctrl+Z · Ctrl+X', run: undo }, { label: 'Rehacer', key: 'Ctrl+Y', run: redo }, { sep: true },
    { label: 'Duplicar', run: duplicateSelection }, { label: 'Agrupar', key: 'Ctrl+G', run: groupSelection }, { label: 'Desagrupar', key: 'Ctrl+Shift+G', run: ungroupSelection },
    { sep: true }, { title: 'Elegir' },
    { label: 'Objetos', key: 'O', run: () => setPickMode('object'), ...chk(() => pickMode === 'object' && !pickFilter) },
    { label: 'Solo curvas', run: () => setPickMode('object', 'curve'), ...chk(() => pickFilter === 'curve') },
    { label: 'Solo superficies', run: () => setPickMode('object', 'surface'), ...chk(() => pickFilter === 'surface') },
    { label: 'Solo mallas', run: () => setPickMode('object', 'mesh'), ...chk(() => pickFilter === 'mesh') },
    { label: 'Solo curvas sobre superficie', run: () => setPickMode('object', 'cos'), ...chk(() => pickFilter === 'cos') },
    { label: 'CVs', key: 'P', run: () => setPickMode('cv'), ...chk(() => pickMode === 'cv') },
    { label: 'Nada', run: pickNothing }, { sep: true }, { title: 'Snap fijo' },
    { label: 'Rejilla', key: 'Alt', run: () => $('snap-grid').click(), ...chk(() => snapToggles.grid) },
    { label: 'Curva', key: 'Ctrl+Alt', run: () => $('snap-curve').click(), ...chk(() => snapToggles.curve) },
    { label: 'Punto', key: 'Ctrl', run: () => $('snap-point').click(), ...chk(() => snapToggles.point) }]],
  ['Curvas', [
    { label: 'Curva', key: 'C', run: () => setTool('curve') }, { label: 'Línea (2 puntos)', run: () => startLine() }, { label: 'Círculo', run: () => setTool('circle') },
    { label: 'Extender (curva o superficie)', run: () => startExtendU() },
    { sep: true }, { label: 'Proyectar en superficie', run: projectSelection }]],
  ['Superficies', [
    { label: 'Plano', run: () => setTool('plane') }, { label: 'Revolución', run: () => OPS.revolve() }, { label: 'Loft', run: () => OPS.loft() },
    { label: 'Extruir', run: () => OPS.extrude() }, { sep: true }, { title: 'Con historial' },
    { label: 'Align (G0 · G1 · G2 · G3)', run: () => startEdgeOp('align') }, { label: 'Freeform Blend (bordes y curvas)', run: () => startEdgeOp('blend') },
    { label: 'Skin (entre curvas)', run: () => startEdgeOp('skin') }, { label: 'Extender', run: () => startEdgeOp('extend') },
    { label: 'Offset', run: offsetSelection }, { label: 'Simetría (plano YZ)', run: mirrorSelection },
    { sep: true }, { title: 'Sólidos (como Plasticity)' }, { label: 'Redondear / chaflán aristas', key: 'B', run: () => startFillet() }, { label: 'Redondeo G2 / G3 (superficies)', run: () => startEdgeOp('gfillet') },
    { sep: true }, { title: 'Curvas sobre superficie' },
    { label: 'Proyectar curva en superficie', run: projectSelection },
    { label: 'Trim (recortar por piezas)', run: () => trimSelection() },
    { label: 'Untrim (quitar recorte)', run: () => untrimSelection() },
    { label: 'Invertir normales', run: () => withSelection('flip') },
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
    { label: 'Encender CVs (elegidos)', run: () => { selObjs.forEach((o) => { o.showCVs = true; applyVisibility(o); }); } }, { label: 'Apagar CVs (elegidos)', run: () => cvsOff(selObjs.slice()) }, { label: 'Apagar todos los CVs', run: () => cvsOff() },
    { label: 'Toggle Model', run: toggleModel, ...chk(() => modelClean) }, { label: 'Rejilla', run: toggleGrid, ...chk(() => gridUser) },
    { label: 'Líneas de parche', run: () => $('show-iso').click(), ...chk(() => $('show-iso').checked) },
    { label: 'Peine de curvatura', run: () => $('show-comb').click(), ...chk(() => $('show-comb').checked) },
    { sep: true }, { label: 'Ocultar selección', run: hideSelection }, { label: 'Mostrar todo', run: unhideAll }]],
  ['Capas', [
    { label: 'Nueva capa', run: newLayer }, { label: 'Pasar selección a la capa activa', run: () => assignToLayer() },
    { label: 'Mostrar todas las capas', run: () => { checkpoint(); layers.forEach((l) => (l.visible = true)); selectionChanged(); renderLayers(); } },
    { sep: true }, { label: 'Anclar barra izquierda', run: () => layersWin.togglePin(), ...chk(() => !!prefs.leftPin) },
    { label: 'Ventana de capas', run: () => (prefs.layersWin?.open === false ? layersWin.show() : layersWin.set({ open: false })), ...chk(() => prefs.layersWin?.open !== false) }]],
  ['Visualización', [
    { title: 'Map Types (diagnóstico)' },
    ...MAP_TYPES.map((m) => ({ label: m.label, key: m.key, run: () => setDiag(m.k), ...chk(() => layout !== 'render' && !prefs.shadeReal && diagMode === m.k) })),
    { label: 'Malla (alambre)', key: '3', run: toggleWire, ...chk(() => diagMode === 'wire') },
    { label: 'Oclusión ambiental', run: () => { prefs.ao = prefs.ao === false; savePrefs(); $('pref-ao').checked = prefs.ao !== false; }, ...chk(() => prefs.ao !== false) },
    { sep: true }, { title: 'Entornos de render' },
    { label: 'Sombreado realista en Modelado', run: () => { if (layout !== 'diag') switchLayout('diag'); setShadeReal(!prefs.shadeReal); }, ...chk(() => !!prefs.shadeReal) },
    ...[['studio', 'Estudio'], ['sun', 'Exterior'], ['sunset', 'Atardecer'], ['overcast', 'Nublado']].map(([k, l]) => ({ label: l, run: env(k), ...chk(() => envKey === k) }))]],
  ['Animación', [{ label: 'Plato giratorio', soon: true }, { label: 'Línea de tiempo', soon: true }]],
  ['Ventanas', [
    { label: 'Panel lateral fijo', run: () => setPinned(!pinned), ...chk(() => pinned) }, { label: 'Pantalla completa', run: fullscreen },
    { label: 'Capas', run: () => (prefs.layersWin?.open === false ? layersWin.show() : layersWin.set({ open: false })), ...chk(() => prefs.layersWin?.open !== false) },
    { label: 'Transform info', run: () => { const st = winState('hud'); st.closed = !st.closed; savePrefs(); hudRender(); }, ...chk(() => !winState('hud').closed) },
    { label: 'Recolocar ventanas', run: () => { ['tool', 'hud'].forEach((id) => { const st = winState(id); delete st.x; delete st.y; st.min = false; }); savePrefs(); location.reload(); } },
    { label: 'Puck', key: 'Z', run: () => getPuck().show(innerWidth / 2, innerHeight / 2) }]],
  ['Preferencias', [{ label: 'Preferencias…', run: () => openPrefs() }, { label: 'Personalizar el Puck…', run: () => openPrefs('puck') }]],
  ['Utilidades', [
    { label: 'Centrar pivote', run: centerPivots },
    { label: 'Locator: distancia mínima', run: () => withSelection('locmin') }, { label: 'Locator: distancia máxima', run: () => withSelection('locmax') },
    { label: 'Borrar locators', run: () => deleteLocators() }, { label: 'Punto de interés a la selección', key: 'L', run: pivotToSelection },
    { label: 'Medir distancia', soon: true }]],
  ['Ayuda', [{ label: 'Atajos de teclado', run: () => openPrefs('help') }, { label: 'Ejemplo: Freeform Blend (manija)', run: () => blendDemo() }, { label: 'Qué abrió el último menú', run: () => toast(menuLog.length ? menuLog.slice(-3).reverse().join('  ·  ') : 'Todavía no se abrió ningún menú.') }, { label: 'Acerca de Forja', run: () => toast('FORJA v' + FORJA_VERSION + ' · ' + 'FORJA · modelador NURBS libre (Alias + Plasticity + Blender)') }]],
];
// menús cuyos comandos son herramientas o cambian la escena: antes de ejecutarlos la herramienta activa hace su cleanup
const TOOL_MENUS = ['Editar', 'Borrar', 'Curvas', 'Superficies', 'Utilidades'];
function buildMenubar() {
  const bar = $('menubar');
  let openBtn = null;
  const drop = document.createElement('div');
  drop.className = 'mb-drop'; drop.hidden = true;
  document.body.append(drop);
  const close = () => { drop.hidden = true; openBtn?.setAttribute('aria-expanded', 'false'); openBtn = null; };
  const open = (btn, items, name = btn.textContent) => {
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
      b.addEventListener('click', () => { close(); if (it.soon) return soon(it.label); if (TOOL_MENUS.includes(name)) endActiveTool('switch'); it.run(); });
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
  if (tab === 'puck') { $('pk-mod').value = 'p3-' + (prefs.puck3?.active || 'curves'); if (!$('pk-mod').value) $('pk-mod').value = 'p3-curves'; renderPuckEditor(); }
  d.querySelectorAll('[data-pref-snap]').forEach((c) => (c.checked = !!snapToggles[c.dataset.prefSnap]));
  if (!d.open) d.showModal();
}
function renderPuckEditor() { renderPuck3Editor(($('pk-mod').value || 'p3-curves').slice(3)); }
// Editor del Puck de Modelado: los 3 anillos de una categoría (subir, bajar, quitar, pasar a otro anillo, añadir)
function renderPuck3Editor(cat) {
  const P = prefs.puck3 || (prefs.puck3 = {}), def = PUCK3_CATS.find((c) => c.id === cat);
  const rings = (P.rings?.[cat] || def.rings).map((r) => r.slice());
  while (rings.length < 3) rings.push([]);
  const save = () => { P.rings = { ...(P.rings || {}), [cat]: rings }; savePrefs(); if (puck3.open) puck3.close(false); renderPuck3Editor(cat); };
  $('pk-list').innerHTML = rings.map((ids, k) => `<li class="pk-ring"><b>Anillo ${k + 1}</b><small>${ids.length} herramientas</small></li>` + ids.map((id, i) => {
    const t = PUCK3_LIB[id];
    return `<li><i>${icon(t.k)}</i><span>${esc(t.label)}${t.shared ? '<small>compartida: actúa sobre ' + def.label.toLowerCase() + '</small>' : ''}${t.soon ? '<small>próximamente</small>' : ''}</span>
      <span class="pk-btns"><button data-r="${k}" data-up="${i}" title="Subir">↑</button><button data-r="${k}" data-down="${i}" title="Bajar">↓</button>
      <button data-r="${k}" data-mv="${i}" title="Pasar al anillo siguiente">⇥</button><button data-r="${k}" data-del="${i}" title="Quitar">×</button></span></li>`;
  }).join('') + `<li class="pk-addrow"><select class="sel" data-addsel="${k}">${Object.keys(PUCK3_LIB).filter((id) => !ids.includes(id)).map((id) => `<option value="${id}">${esc(PUCK3_LIB[id].label)}</option>`).join('')}</select><button class="btn" data-add="${k}" ${ids.length >= 10 ? 'disabled' : ''}>Añadir al anillo ${k + 1}</button></li>`).join('')
    + `<li class="pk-addrow"><button class="btn" id="pk3-reset">Restablecer ${esc(def.label)}</button></li>`;
  const L = $('pk-list'), at = (b, key) => [+b.dataset.r, +b.dataset[key]];
  L.querySelectorAll('[data-up]').forEach((b) => b.onclick = () => { const [k, i] = at(b, 'up'); if (i > 0) { const r = rings[k]; [r[i - 1], r[i]] = [r[i], r[i - 1]]; save(); } });
  L.querySelectorAll('[data-down]').forEach((b) => b.onclick = () => { const [k, i] = at(b, 'down'), r = rings[k]; if (i < r.length - 1) { [r[i + 1], r[i]] = [r[i], r[i + 1]]; save(); } });
  L.querySelectorAll('[data-mv]').forEach((b) => b.onclick = () => { const [k, i] = at(b, 'mv'), to = (k + 1) % 3; if (rings[to].length < 10 && !rings[to].includes(rings[k][i])) { rings[to].push(rings[k].splice(i, 1)[0]); save(); } });
  L.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { const [k, i] = at(b, 'del'); rings[k].splice(i, 1); save(); });
  L.querySelectorAll('[data-add]').forEach((b) => b.onclick = () => { const k = +b.dataset.add, v = L.querySelector(`[data-addsel="${k}"]`).value; if (v && rings[k].length < 10) { rings[k].push(v); save(); } });
  $('pk3-reset').onclick = () => { const r2 = { ...(P.rings || {}) }; delete r2[cat]; P.rings = r2; savePrefs(); renderPuck3Editor(cat); };
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
  // oclusión ambiental ajustable (se guarda en las preferencias)
  // ajuste del modo Forja: sliders en vivo + botón para copiar los valores
  const FJ = { base: 1, rim: 1, sharp: 2.6, blue: 1, spec: 1, ...(prefs.forjaShader || {}) };
  const applyFJ = () => { const u = envDiagMat.uniforms; u.uBase.value = FJ.base; u.uRim.value = FJ.rim; u.uSharp.value = FJ.sharp; u.uBlue.value = FJ.blue; u.uSpec.value = FJ.spec; };
  applyFJ();
  for (const k of Object.keys(FJ)) {
    const el = $('fj-' + k); if (!el) continue;
    el.value = FJ[k]; $('fj-' + k + '-o').textContent = (+FJ[k]).toFixed(2);
    el.addEventListener('input', () => { FJ[k] = +el.value; $('fj-' + k + '-o').textContent = FJ[k].toFixed(2); prefs.forjaShader = { ...FJ }; savePrefs(); applyFJ(); });
  }
  $('fj-reset').addEventListener('click', () => { Object.assign(FJ, { base: 1, rim: 1, sharp: 2.6, blue: 1, spec: 1 }); for (const k of Object.keys(FJ)) { $('fj-' + k).value = FJ[k]; $('fj-' + k + '-o').textContent = FJ[k].toFixed(2); } prefs.forjaShader = { ...FJ }; savePrefs(); applyFJ(); });
  $('fj-copy').addEventListener('click', async () => {
    const txt = JSON.stringify({ modo: 'forja', ...FJ, ao: { activa: prefs.ao !== false, intensidad: prefs.aoInt ?? 2.1, radio: prefs.aoRad ?? 0.7 } });
    try { await navigator.clipboard.writeText(txt); toast('Valores copiados: pégalos en el chat'); } catch (e) { prompt('Copia estos valores:', txt); }
  });
  const setGridOp = (v) => { gridBaseOp = +v; applyGridOp(); $('pref-grid-op-o').textContent = (+v).toFixed(3); };
  $('pref-grid-op').value = prefs.gridOp ?? GRID_OP0; setGridOp(prefs.gridOp ?? GRID_OP0);
  $('pref-grid-op').addEventListener('input', (e) => { prefs.gridOp = +e.target.value; setGridOp(+e.target.value); savePrefs(); });
  const aoInt = prefs.aoInt ?? 2.1, aoRad = prefs.aoRad ?? 0.7;
  ao.intensity = aoInt; ao.radius = aoRad;
  $('pref-ao').checked = prefs.ao !== false; $('pref-ao-int').value = aoInt; $('pref-ao-rad').value = aoRad;
  $('pref-ao-int-o').textContent = (+aoInt).toFixed(2); $('pref-ao-rad-o').textContent = (+aoRad).toFixed(2);
  $('pref-ao').addEventListener('change', (e) => { prefs.ao = e.target.checked; savePrefs(); });
  // Motor de render: hoy solo el clásico; la prueba dice si este navegador (y este marco) puede correr el nuevo
  { const sel = $('pref-engine'), out = $('pref-webgpu-out');
    if (new URLSearchParams(location.search).get('motor') === 'clasico') { prefs.engine = 'webgl'; savePrefs(); }   // salida de emergencia: ?motor=clasico
    sel.value = prefs.engine === 'webgpu' ? 'webgpu' : 'webgl';
    const apply = async (kind) => {
      if (kind === 'webgpu') {
        out.textContent = 'Activando WebGPU (dos lienzos)…';
        const ok = await backend.enable();
        if (!ok) { sel.value = 'webgl'; prefs.engine = 'webgl'; savePrefs(); out.textContent = 'No se pudo activar: ' + backend.error; return; }
        out.textContent = 'Motor híbrido activo: las superficies se dibujan con WebGPU (color plano, F2) y las líneas con WebGL encima.';
      } else { backend.disable(); out.textContent = ''; }
      sceneChangedAt = performance.now(); aoLastKey = '';
    };
    sel.addEventListener('change', () => { prefs.engine = sel.value; savePrefs(); apply(sel.value); });
    if (prefs.engine === 'webgpu') apply('webgpu');
    // entorno del motor nuevo: intensidad, giro y archivo .hdr propio (comparte funciones con el panel de Entornos de Visu)
    const ei = $('pref-env-int'), er = $('pref-env-rot');
    ei.addEventListener('input', () => setEnvOpts({ int: +ei.value }));
    er.addEventListener('input', () => setEnvOpts({ rot: +er.value }));
    $('pref-env-hdr').addEventListener('click', () => $('env-file').click());
    $('pref-env-studio').addEventListener('click', () => { selectEnv('studio'); $('pref-env-name').textContent = 'Estudio procedural'; });
    $('pref-edges').checked = prefs.edges !== false;
    $('pref-edges').addEventListener('change', (e) => { prefs.edges = e.target.checked; savePrefs(); });
    $('pref-ao-visu').checked = prefs.aoVisu !== false;
    $('pref-ao-visu').addEventListener('change', (e) => { prefs.aoVisu = e.target.checked; savePrefs(); aoLastKey = ''; });
  }
  $('pref-webgpu-test').addEventListener('click', async () => {
    const out = $('pref-webgpu-out');
    out.textContent = 'Probando WebGPU…';
    try { out.textContent = describeProbe(await probeWebGPU()); } catch (err) { out.textContent = 'La prueba falló: ' + err.message; }
  });
  $('pref-ao-int').addEventListener('input', (e) => { prefs.aoInt = +e.target.value; ao.intensity = +e.target.value; $('pref-ao-int-o').textContent = (+e.target.value).toFixed(2); aoLastKey = ''; savePrefs(); });
  $('pref-ao-rad').addEventListener('input', (e) => { prefs.aoRad = +e.target.value; ao.radius = +e.target.value; $('pref-ao-rad-o').textContent = (+e.target.value).toFixed(2); aoLastKey = ''; savePrefs(); });
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
  // Barra izquierda = Capas arriba + herramientas debajo. Se muestra al acercar el ratón al borde izquierdo o, si está anclada (prefs.leftPin), se queda siempre.
  apply() {
    if ((prefs.layersWin || {}).v !== 3) { prefs.layersWin = { open: true, v: 3 }; savePrefs(); }
    const w = prefs.layersWin || {}, el = this.el, pin = !!prefs.leftPin;
    el.classList.add('docked');
    el.hidden = w.open === false;
    el.classList.toggle('folded', !!w.folded);
    $('ly-fold').setAttribute('aria-expanded', String(!w.folded));
    app.classList.toggle('left-pinned', pin);
    const b = $('ly-dock');
    b.textContent = pin ? '●' : '○'; b.setAttribute('aria-pressed', String(pin));
    b.title = pin ? 'Anclada: la barra izquierda no se oculta (clic para que se oculte sola)' : 'Anclar la barra izquierda (que no se oculte)';
    this.measure();
  },
  // las herramientas se bajan lo que mida la ventana de Capas
  measure() {
    const t = $('tools'), root = document.documentElement.style, cur = parseFloat(root.getPropertyValue('--ly-h')) || 0;
    const base = t.getBoundingClientRect().top - cur;   // dónde empezarían las herramientas sin Capas
    root.setProperty('--ly-h', (this.el.hidden ? 0 : Math.max(0, Math.round(this.el.getBoundingClientRect().bottom - base + 12))) + 'px');
  },
  set(patch) { prefs.layersWin = { ...(prefs.layersWin || {}), ...patch }; savePrefs(); this.apply(); },
  show() { this.set({ open: true, folded: false }); },
  togglePin() { prefs.leftPin = !prefs.leftPin; savePrefs(); this.apply(); },
};
{
  $('ly-dock').addEventListener('click', () => layersWin.togglePin());
  $('ly-fold').addEventListener('click', () => layersWin.set({ folded: !prefs.layersWin?.folded }));
  $('ly-close').addEventListener('click', () => layersWin.set({ open: false }));
  addEventListener('resize', () => layersWin.measure());
  if (window.ResizeObserver) new ResizeObserver(() => layersWin.measure()).observe(layersWin.el);
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
// ---------- Registro de construcciones (patrón del SDK de Alias) ----------
// Alias separa la RECETA (AlBlendCurve: parámetros + entradas), el NODO que produce en la escena (AlCurveNode = un objeto de
// `objects`) y sus PUNTOS DE CONSTRUCCIÓN (AlBlendPoint = las manijas de la vista). Aquí cada tipo de receta (una entrada de
// `relations`) declara todo lo suyo en un solo bloque, en defineConstruction (más abajo):
//   name · inputs(r) → ids de los nodos de los que depende · output(r) → id del nodo que produce
//   build(r, ins, out) → geometría nueva del nodo · panel(r, c) → campos de su ventana (devuelve el resto del título)
//   points(r, out) → puntos de construcción · diagnose(r, ins, out, fmt) → html del diagnóstico de la unión
//   summary(r, nm) → línea del panel de historial · labels(r) → etiquetas en la vista [{pos, html}]
//   editsOutput → también se recalcula si se toca su propio nodo de salida (Align: las filas del borde quedan atadas)
//   curvePoints → tiene puntos aunque su salida sea una curva · retool → ventana con "Deshacer todo" y "Siguiente"
const CONSTRUCTIONS = {};
function defineConstruction(type, def) {
  CONSTRUCTIONS[type] = { type, inputs: (r) => [r.src], output: (r) => r.out, panel: (r, c) => ` · ${c.nm(r.src)}`, points: () => [], diagnose: null,
    summary: (r, nm) => `${nm(r.out)} ← ${nm(r.src)}`, labels: null, editsOutput: false, curvePoints: false, retool: false, ...def };
}
const constructionOf = (r) => CONSTRUCTIONS[r.type];
const inputsOf = (r) => constructionOf(r).inputs(r);
const outputOf = (r) => constructionOf(r).output(r);
const relName = (r) => constructionOf(r).name;
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
  && !r.explicit && !r.modRange && !r.crown && !r.flip && (r.flowInt ?? 'iso') === 'iso';
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
// Maestra libre de un Align (curva sobre superficie, borde de recorte, isoparamétrica, o un borde con tipo Normal / Vista / Vector):
// da el punto y las derivadas cruzadas en cualquier parámetro. null = maestra normal (borde o curva) con el cálculo exacto.
function masterField(r) {
  if (r.type !== 'align') return null;
  const m = byId(r.master);
  if (!m) return null;
  let side = null;
  if (r.mIso) {
    const uv = [];
    for (let k = 0; k <= 60; k++) uv.push(r.mIso.dir === 'u' ? [r.mIso.t, k / 60] : [k / 60, r.mIso.t]);
    side = { kind: 'cos', data: m.data, uv, closed: false };
  } else if (m.kind === 'curve' && m.data.cos) side = sideOf([m.id]);
  else if (r.mEdge && !r.curve && r.atype && r.atype !== 'natural') side = { kind: 'edge', data: m.data, edge: r.mEdge };
  if (!side) return null;
  const F = FF.alignField(side, r.atype && r.atype !== 'natural' ? 'free' : 'iso');
  F.params = (pts, rev, rel, sig) => {
    if (!rel.atype || rel.atype === 'natural') return sig.map((t) => (rev ? 1 - t : t));
    const S = []; for (let i = 0; i <= 600; i++) S.push(F.at(i / 600));
    return pts.map((pt) => projectParam(S, pt, rel));
  };
  return F;
}
// parámetro (0..1) del punto de la maestra más cercano a pt, según el tipo de alineación: Normal (el más cercano),
// Vista o Vector (el que queda más cerca de la recta que pasa por pt en esa dirección)
function projectParam(samples, pt, rel) {
  const dv = rel.atype === 'view' || rel.atype === 'vector' ? new THREE.Vector3(...(rel.avec || [0, 1, 0])).normalize() : null;
  let best = 0, bd = Infinity;
  const w = new THREE.Vector3();
  samples.forEach((q, i) => {
    w.copy(q).sub(pt);
    if (dv) w.addScaledVector(dv, -w.dot(dv));
    const d = w.lengthSq();
    if (d < bd) { bd = d; best = i; }
  });
  return best / (samples.length - 1);
}
// muestras de la maestra de un Align de curva (para recolocar el punto de unión al cambiar el tipo)
function masterSamples(r) {
  const m = byId(r.master), f = masterField(r), out = [];
  if (f) { for (let i = 0; i <= 600; i++) out.push(f.at(i / 600)); return out; }
  if (r.mEdge) return HX.edgePoints(m.data, r.mEdge, 600);
  const c = N.curveOf(m.data); for (let i = 0; i <= 600; i++) out.push(c.getPoint(i / 600));
  return out;
}
function retargetCurve(r) {
  const o = byId(r.slave), c = o.data.cvs, e = c[r.sEnd ? c.length - 1 : 0];
  r.mT = projectParam(masterSamples(r), new THREE.Vector3(e.x, e.y, e.z), r.atype === 'natural' ? { atype: 'normal' } : r);
}
const curveLen = (d) => { const c = N.curveOf(d); let L = 0, p = c.getPoint(0); for (let i = 1; i <= 64; i++) { const q = c.getPoint(i / 64); L += q.distanceTo(p); p = q; } return L || 1; };
// diagnóstico de un Align (hueco, ángulo, curvatura; curvatura null = no se mide)
function alignDiag(r) {
  const out = byId(r.slave), m = byId(r.master);
  if (!out || !m) return null;
  const f = masterField(r);
  if (r.curve) return HX.diagnoseCurve(r, m.data, out.data, f);
  return f ? HX.freeDiagnose(r, out.data, f) : HX.diagnose(m.data, r.mEdge, out.data, r.sEdge, r.rev);
}
// ---------- Puntos de construcción (como AlBlendPoint) ----------
// Una manija de la vista con identidad dentro de su receta: su papel (role) fija el color y el nombre; get/drag leen y cambian
// el parámetro de la receta; click = punto de un clic; attach = a qué está pegado ({obj, edge, t} o {obj, t}), como attachedTo().
const POINT_ROLES = { tension: { kind: 't', label: 'tensión' }, shape: { kind: 's', label: 'forma' }, g3: { kind: 'g', label: 'G3' },
  distance: { kind: 'd', label: 'distancia' }, flip: { kind: 'f', label: 'invertir' }, slide: { kind: 'm', label: 'punto de unión' },
  axis: { kind: 'a', label: 'eje' } };
function cpoint(role, pos, dir, o = {}) {
  const R = POINT_ROLES[role];
  return { role, kind: R.kind, label: o.label || R.label, pos, dir: dir.lengthSq() > 1e-12 ? dir : new THREE.Vector3(0, 1, 0),
    start: o.get, drag: o.drag, click: o.click, move: o.move, attach: o.attach || null };
}
// cadena de CVs desde la costura P[0..]: tensión en el CV 1, forma en el 2 y G3 en el 3 (solo si keys.g)
function continuityPoints(r, P, cont, keys) {
  const H = [], len = (k) => P(k).distanceTo(P(k - 1)) || 1e-3, dir = (k) => P(k).clone().sub(P(k - 1)).normalize();
  if (cont >= 1) { const l1 = len(1); H.push(cpoint('tension', P(1), dir(1), { get: () => r[keys.t] ?? r.tension, drag: (delta, s0) => { r[keys.t] = Math.max(0.05, s0 * (1 + delta / l1)); } })); }
  if (cont >= 2) { const l2 = len(2); H.push(cpoint('shape', P(2), dir(2), { get: () => r[keys.s] || 0, drag: (delta, s0) => { r[keys.s] = s0 + delta / l2; } })); }
  if (cont >= 3 && keys.g) { const l3 = len(3); H.push(cpoint('g3', P(3), dir(3), { get: () => r[keys.g] || 0, drag: (delta, s0) => { r[keys.g] = s0 + delta / l3; } })); }
  return H;
}
// puntos de una cadena de filas de CVs de una superficie: el CV central de cada fila desde el borde
const rowChain = (d, edge) => (k) => v3(mid(HX.row(d, edge, k)));
const relationData = (r, ins, out) => constructionOf(r).build(r, ins, out);
const G_SEG = (from, to) => [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']].filter(([v]) => v >= from && v <= to);

defineConstruction('align', {
  name: 'Align', inputs: (r) => [r.master], output: (r) => r.slave, editsOutput: true, curvePoints: true,
  build: (r, ins, out) => HX.align(r, ins[0].data, out.data, masterField(r)),
  summary: (r, nm) => `${nm(r.slave)} → ${nm(r.master)} · G${r.cont}`,
  diagnose: (r, ins, out, fmt) => fmt(alignDiag(r), r.cont),
  labels: (r) => { const a = alignLetters(r); return a ? [{ pos: a[0], html: a[2] }] : []; },
  panel(r, c) {
    const { group, fields, set, live, redo, nm } = c;
    fields.push({ type: 'seg', label: 'Continuidad', opts: G_SEG(0, 3), get: () => r.cont, set: (v) => set('cont', v) },
      { type: 'range', label: r.curve || !r.varT ? 'Tensión' : 'Tensión inicio', min: 0.2, max: 3, step: 0.05, get: () => r.tension, start: checkpoint, set: live('tension'), fmt: (v) => v.toFixed(2) },
      // la forma (mu) cambia cómo llega la superficie al borde sin cambiar la curvatura en él: solo aplica desde G2
      { type: 'range', label: 'Forma', min: -2, max: 2, step: 0.05, get: () => r.shape ?? 0, start: checkpoint, set: live('shape'), fmt: (v) => v.toFixed(2), show: () => r.cont >= 2 },
      { type: 'range', label: 'Escala G3', min: -2, max: 2, step: 0.05, get: () => r.shape3 ?? 0, start: checkpoint, set: live('shape3'), fmt: (v) => v.toFixed(2), show: () => r.cont >= 3 },
      { type: 'group', key: 'alexp', label: 'Control explícito (grado y spans)', fields: [
        { type: 'check', label: 'Control explícito', get: () => !!r.explicit, set: (v) => { if (v && r.xDeg == null) { const d = byId(r.slave)?.data; r.xDeg = r.curve ? d.deg : (r.sEdge[0] === 'u' ? d.degU : d.degV); r.xSpans = r.curve ? d.cvs.length - d.deg : (r.sEdge[0] === 'u' ? d.cvs.length - d.degU : d.cvs[0].length - d.degV); } set('explicit', v); TW.show(relSpec(r, group)); } },
        { type: 'seg', label: r.curve ? 'Grado' : 'Grado (cruzando el borde)', opts: [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [7, '7']], show: () => !!r.explicit, get: () => r.xDeg ?? 3, set: (v) => set('xDeg', v) },
        { type: 'range', label: r.curve ? 'Spans' : 'Spans (cruzando el borde)', min: 1, max: 16, step: 1, show: () => !!r.explicit, get: () => r.xSpans ?? 4, start: checkpoint, set: live('xSpans'), fmt: (v) => String(v) }] },
      { type: 'group', key: 'alblend', label: 'Mezcla (Blending)', fields: [
        { type: 'range', label: 'Filas de CVs extra', min: 0, max: 6, step: 1, get: () => r.extra || 0, start: checkpoint, set: live('extra'), fmt: (v) => String(v) },
        { type: 'range', label: 'Factor de mezcla', min: 0, max: 1, step: 0.01, show: () => (r.extra || 0) > 0, get: () => r.blendF ?? 1, start: checkpoint, set: live('blendF'), fmt: (v) => v.toFixed(2) }] },
      { type: 'check', label: r.curve ? 'Continuar hacia el otro lado' : 'Invertir la dirección del borde', get: () => !!r.rev, set: (v) => set('rev', v) });
    // tipo de alineación (Alignment Type): Natural = por el flujo propio de la superficie; Normal = el punto más cercano de la maestra;
    // Vista = proyectando en la dirección en que se miraba; Vector = proyectando a lo largo de un eje
    const setType = (v) => {
      checkpoint(); r.atype = v;
      if (r.curve && r.mEdge) { toolDef.alignCurveType = v; saveToolDef(); }
      if (v === 'tangent' && !r.tdir && r.orig) { const [a, b] = r.orig.pts; r.tdir = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]).normalize().toArray(); }
      if (v === 'view') r.avec = camera.getWorldDirection(new THREE.Vector3()).toArray();
      if (v === 'vector') r.avec = AXES[r.axis ?? 2].toArray();
      if (r.curve) { retargetCurve(r); try { r.lambda0 = HX.curveNaturalLambda(byId(r.slave).data, r.sEnd, byId(r.master).data, r, masterField(r)); } catch (e) { /* se queda la anterior */ } }
      redo(); TW.show(relSpec(r, group));
    };
    const types = [['natural', 'Natural'], ['normal', 'Normal'], ['view', 'Vista'], ['vector', 'Vector']];
    // curva a un borde: también "Tangente de la curva" (la dirección que traía la curva, acostada en el plano tangente de la superficie)
    if (r.curve && r.mEdge) types.unshift(['tangent', 'Tangente']);
    fields.push({ type: 'seg', label: 'Tipo de alineación', opts: types, get: () => r.atype || 'natural', set: setType },
      { type: 'seg', label: 'Eje del vector', opts: [[0, 'X'], [1, 'Y'], [2, 'Z']], show: () => r.atype === 'vector', get: () => r.axis ?? 2, set: (v) => { r.axis = v; r.avec = AXES[v].toArray(); if (r.curve) retargetCurve(r); set('axis', v); } });
    if (r.curve) {
      const ms = byId(r.master);
      fields.push({ type: 'check', label: 'Extremo contrario de la curva', get: () => !!r.sEnd, set: (v) => { checkpoint(); r.sEnd = v ? 1 : 0; r.lambda0 = HX.curveNaturalLambda(byId(r.slave).data, r.sEnd, ms.data, r); redo(); } });
      if (ms?.kind === 'curve') fields.push({ type: 'check', label: 'Extremo contrario de la maestra', get: () => !!r.mEnd, set: (v) => { checkpoint(); r.mEnd = v ? 1 : 0; r.mT = v ? 1 : 0; redo(); TW.render(); } },
        { type: 'range', label: 'Punto de unión en la maestra', min: 0, max: 1, step: 0.005, get: () => r.mT ?? (r.mEnd ? 1 : 0), start: checkpoint, set: live('mT'), fmt: (v) => v.toFixed(3) });
      else fields.push({ type: 'range', label: 'Posición en el borde', min: 0, max: 1, step: 0.005, get: () => r.mT ?? 0.5, start: checkpoint, set: live('mT'), fmt: (v) => v.toFixed(3) });
    } else {
      fields.push({ type: 'group', key: 'alrange', label: 'Alcance a lo largo del borde', fields: [
        { type: 'check', label: 'Modificar rango', get: () => !!r.modRange, set: (v) => set('modRange', v) },
        { type: 'range', label: 'Inicio del rango', min: 0, max: 1, step: 0.005, show: () => !!r.modRange, get: () => r.r0 ?? 0, start: checkpoint, set: live('r0'), fmt: (v) => v.toFixed(3) },
        { type: 'range', label: 'Fin del rango', min: 0, max: 1, step: 0.005, show: () => !!r.modRange, get: () => r.r1 ?? 1, start: checkpoint, set: live('r1'), fmt: (v) => v.toFixed(3) },
        { type: 'range', label: 'Suavizado', min: 0, max: 0.6, step: 0.005, show: () => !!r.modRange, get: () => r.soft ?? 0, start: checkpoint, set: live('soft'), fmt: (v) => (v ? v.toFixed(3) : 'no') },
        { type: 'check', label: 'Tensión distinta al final', get: () => !!r.varT, set: (v) => { if (v && r.tensionEnd == null) r.tensionEnd = r.tension; set('varT', v); } },
        { type: 'range', label: 'Tensión final', min: 0.2, max: 3, step: 0.05, show: () => !!r.varT, get: () => r.tensionEnd ?? r.tension, start: checkpoint, set: live('tensionEnd'), fmt: (v) => v.toFixed(2) }] });
    }
    return ` · ${nm(r.slave)} → ${nm(r.master)}`;
  },
  points(r, out) {
    const keys = { t: 'tension', s: 'shape', g: 'shape3' };
    if (out.kind === 'curve') {
      // curva alineada: tensión (CV 1), forma (CV 2) y G3 (CV 3) contados desde el extremo, invertir en el CV 0
      const c = out.data.cvs, at = (k) => v3(c[r.sEnd ? c.length - 1 - k : k]), p0 = at(0), p1 = at(1);
      const H = continuityPoints(r, at, r.cont, keys);
      H.push(cpoint('flip', p0, p1.clone().sub(p0).normalize(), { click: () => { r.rev = !r.rev; } }));
      // deslizador amarillo del punto de unión en la maestra (borde o curva): se arrastra a lo largo de ella y la curva la sigue
      const ms = byId(r.master);
      if (ms && !r.mIso && !ms.data.cos && (r.mEdge || ms.kind === 'curve')) {
        const D = r.mEdge ? HX.edgeCrossDerivs(ms.data, r.mEdge, r.mT ?? 0.5, 1) : HX.curveDerivsAt(ms.data, r.mT ?? 0.5, 1);
        H.push(cpoint('slide', v3(D[0]), D[1].clone().normalize(), { attach: r.mEdge ? { obj: ms.id, edge: r.mEdge, t: r.mT ?? 0.5 } : { obj: ms.id, t: r.mT ?? 0.5 },
          get: () => r.mT ?? 0.5,
          drag: (delta, s0) => { r.mT = Math.min(1, Math.max(0, s0 + delta / (r.mEdge ? HX.edgeLengthApprox(ms.data, r.mEdge) : curveLen(ms.data)))); } }));
      }
      return H;
    }
    if (out.kind !== 'surface') return [];
    const d = out.data, H = continuityPoints(r, rowChain(d, r.sEdge), r.cont, keys);
    // flecha de giro (Flip): en el inicio del borde, apunta a lo largo de él; un clic invierte su dirección
    const a0 = HX.row(d, r.sEdge, 0), fa = v3(a0[0]), fb = v3(a0[1]);
    H.push(cpoint('flip', fa, fb.clone().sub(fa).normalize(), { click: () => { r.rev = !r.rev; } }));
    return H;
  },
});

const blendInputs = (r) => [...(r.aIds || [r.a]), ...(r.bIds || [r.b])];
const blendDiagnose = (r, ins, out, fmt) => {
  if (exactBlend(r)) return `1: ${fmt(HX.diagnose(ins[0].data, r.aEdge, out.data, 'v0', false), r.contA ?? r.cont)}<br>2: ${fmt(HX.diagnose(ins[1].data, r.bEdge, out.data, 'v1', r.rev), r.contB ?? r.cont)}`;
  const [A, B] = blendSides(r), [dA, dB] = FF.diagnoseBlend(r, A, B, out.data);
  return `1: ${fmt(dA, A.kind === 'curves' ? 0 : r.contA ?? 2)}<br>2: ${fmt(dB, B.kind === 'curves' ? 0 : r.contB ?? 2)}`;
};
// Lado 1, Lado 2, Inicio [..], Fin [..], Corona: las etiquetas en la vista de Alias
function blendLabels(r) {
  const out = byId(r.out);
  if (!out) return [];
  const O = FF.surfEval(out.data);
  const fl = (v) => ({ default: r.type === 'skin' ? 'Unir extremos' : 'Defecto', edge: 'Alinear al borde', extend: 'Extender' })[v || 'default'];
  // en lados cerrados el inicio y el fin coinciden: una sola etiqueta en la costura
  const closed = O(0, 0.5).distanceTo(O(1, 0.5)) < 1e-3;
  return [[O(0.5, 0), 'Lado 1'], [O(0.5, 1), 'Lado 2'], [O(0.25, 0.5), `Corona [${r.crown ? r.crown.toFixed(2) : 'no'}]`],
    ...(closed ? [[O(0, 0.5), 'Costura (Modificar parámetro)']] : [[O(0, 0.5), `Inicio [${fl(r.flowStart)}]`], [O(1, 0.5), `Fin [${fl(r.flowEnd)}]`]])]
    .map(([pos, t]) => ({ pos, html: esc(t) }));
}
function blendPanel(r, c) {
  const { group, fields, set, live, redo, nm } = c;
  const sk = r.type === 'skin', ids = (x) => x.map(nm).join(' + ');
  const freeA = byId(r.a)?.kind === 'curve' && !byId(r.a)?.data.cos, freeB = byId(r.b)?.kind === 'curve' && !byId(r.b)?.data.cos;
  if (!sk) {
    fields.push({ type: 'seg', label: 'Lado 1', opts: G_SEG(0, freeA ? 0 : 3), get: () => r.contA ?? r.cont, set: (v) => set('contA', v) },
      { type: 'seg', label: 'Lado 2', opts: G_SEG(0, freeB ? 0 : 3), get: () => r.contB ?? r.cont, set: (v) => set('contB', v) },
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
  return ` · ${ids(r.aIds || [r.a])} ↔ ${ids(r.bIds || [r.b])}`;
}
// punto del redondeo G2/G3 (macro: 2 carriles 'fcurve' + 1 blend con la misma r.fg): flecha verde del valor en el carril A
function gfilletPoints(r) {
  const rails = relations.filter((x) => x.fg === r.fg && x.type === 'fcurve'), rA = rails[0], c = rA && byId(rA.out), src = rA && byId(rA.src);
  if (!c || !src) return [];
  const S = FF.surfEval(src.data), uv = c.data.cos.uv, m = uv[uv.length >> 1], pos = S(m[0], m[1]);
  const U = rA.edge[0] === 'u', end = rA.edge[1] === '1', e0 = U ? S(end ? 1 : 0, m[1]) : S(m[0], end ? 1 : 0);
  return [cpoint('distance', pos, pos.clone().sub(e0).normalize(), { label: 'valor', attach: { obj: src.id, edge: rA.edge }, get: () => rA.dist,
    drag: (delta, s0) => { const v = Math.max(0.01, Math.round((s0 + delta) * 1000) / 1000); rails.forEach((x) => { x.dist = v; if (applyRelation(x)) propagateFrom(byId(x.out)); }); } })];
}
defineConstruction('blend', {
  name: 'Freeform Blend', inputs: blendInputs, retool: true,
  // Revert: borra el blend y DESHACE los recortes automáticos que hizo en sus lados (dominio paramétrico entero otra vez)
  revert: (r, out) => {
    (r.autoTrimmed || []).map(byId).filter(Boolean).forEach((c) => {
      c.data = { ...c.data, cos: { ...c.data.cos, trim: 'none' } };
      relations.filter((x) => x.type === 'project' && x.out === c.id).forEach((x) => (x.trim = 'none'));
      updateObject(c);
    });
    if (out) removeObject(out);
  },
  build: (r) => blendRelData(r), panel: blendPanel, diagnose: blendDiagnose, labels: blendLabels,
  summary: (r, nm) => `${nm(r.out)} · G${r.contA ?? r.cont}/G${r.contB ?? r.cont}`,
  points(r, out) {
    if (r.fg) return gfilletPoints(r);
    const d = out.data;
    // con "Bloquear formas" las dos flechas azules mueven la misma forma
    const H = [...continuityPoints(r, rowChain(d, 'v0'), r.contA ?? r.cont, { t: 'tensionA', s: 'shapeA' }),
      ...continuityPoints(r, rowChain(d, 'v1'), r.contB ?? r.cont, { t: r.lockShape ? 'tensionA' : 'tensionB', s: 'shapeB' })];
    // flecha de giro (Flip) del lado 2: si las direcciones no fluyen hacia el mismo lado la superficie se retuerce; un clic invierte el lado 2
    const b0 = HX.row(d, 'v1', 0), fa = v3(b0[0]), fb = v3(b0[1]);
    H.push(cpoint('flip', fa, fb.clone().sub(fa).normalize(), { label: 'invertir lado 2', click: () => { r.flip = !r.flip; } }));
    return H;
  },
});
defineConstruction('skin', {
  name: 'Skin', inputs: blendInputs, retool: true,
  build: (r) => blendRelData(r), panel: blendPanel, diagnose: blendDiagnose, labels: blendLabels,
  summary: (r, nm) => `${nm(r.out)} ← ${(r.aIds || [r.a]).length + (r.bIds || [r.b]).length} curvas`,
});
defineConstruction('project', {
  name: 'Proyectar', inputs: (r) => [r.src, r.surf],
  build: (r, ins) => projData(r, ins[0], ins[1]),
  summary: (r, nm) => `${nm(r.out)} ← ${nm(r.src)} en ${nm(r.surf)}`,
  panel(r, c) {
    const { group, fields, set, redo, nm } = c;
    fields.push({ type: 'seg', label: 'Dirección', opts: [['view', 'Vista'], ['y', 'Z'], ['normal', 'Normal']], get: () => r.mode,
      set: (v) => { toolDef.projMode = v; saveToolDef(); checkpoint(); const d = projDir(v); group.forEach((x) => { x.mode = v; x.dir = d; }); redo(); } },
    { type: 'seg', label: 'Recortar', opts: [['none', 'No'], ['inside', 'Dentro'], ['outside', 'Fuera']], get: () => r.trim || 'none',
      set: (v) => { toolDef.projTrim = v; saveToolDef(); set('trim', v); } },
    { type: 'html', html: () => '<span class="tw-note">Recortar necesita una curva cerrada o que vaya de borde a borde. Mueve la curva original y la proyección, el recorte y los blends la siguen.</span>' });
    return group.length > 1 ? ` · ${group.length} curvas → ${nm(r.surf)}` : ` · ${nm(r.src)} → ${nm(r.surf)}`;
  },
});
defineConstruction('extend', {
  name: 'Extender', retool: true,
  build: (r, ins) => FF.extendData(ins[0].data, r.edge, r.dist, r.cont),
  diagnose: (r, ins, out, fmt) => fmt(HX.diagnose(ins[0].data, r.edge, out.data, 'v0', false), r.cont),
  panel(r, c) {
    const { fields, set, live, nm } = c;
    fields.push({ type: 'range', label: 'Distancia', min: 0.05, max: 6, step: 0.05, get: () => r.dist, start: checkpoint, set: (v) => { toolDef.extendDist = v; saveToolDef(); live('dist')(v); }, fmt: (v) => v.toFixed(2) + ' dm' },
      { type: 'seg', label: 'Continuidad', opts: [[1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => r.cont, set: (v) => { toolDef.extendCont = v; saveToolDef(); set('cont', v); } });
    return ` · ${nm(r.src)}`;
  },
  points(r, out) {
    const d = out.data, p0 = v3(mid(HX.row(d, 'v0', 0))), p = v3(mid(HX.row(d, 'v1', 0)));
    return [cpoint('distance', p, p.clone().sub(p0).normalize(), { get: () => r.dist, drag: (delta, s0) => { r.dist = Math.max(0.01, Math.round((s0 + delta) * 100) / 100); } })];
  },
});
defineConstruction('offset', {
  name: 'Offset',
  build: (r, ins) => HX.offsetData(ins[0].data, r.dist),
  panel(r, c) {
    c.fields.push({ type: 'range', label: 'Distancia', min: -2, max: 2, step: 0.01, get: () => r.dist, start: checkpoint, set: (v) => { toolDef.offsetDist = v; saveToolDef(); c.live('dist')(v); }, fmt: (v) => v.toFixed(2) + ' dm' });
    return ` · ${c.nm(r.src)}`;
  },
  points(r, out) {
    const src = byId(r.src), d = out.data;
    if (!src) return [];
    const i = Math.floor(d.cvs.length / 2), j = Math.floor(d.cvs[0].length / 2), p = v3(d.cvs[i][j]), q = v3(src.data.cvs[i][j]);
    let dir = p.clone().sub(q);
    const sgn = Math.sign(r.dist) || 1;
    dir = dir.lengthSq() > 1e-10 ? dir.normalize().multiplyScalar(sgn) : new THREE.Vector3(0, 1, 0);
    return [cpoint('distance', p, dir.clone().multiplyScalar(sgn), { get: () => r.dist, drag: (delta, s0) => { r.dist = Math.round((s0 + delta) * 100) / 100; } })];
  },
});
defineConstruction('mirror', {
  name: 'Simetría',
  build: (r, ins) => HX.mirrorData(ins[0].data, ins[0].kind, r.plane || 'x'),
  panel(r, c) {
    c.fields.push({ type: 'seg', label: 'Plano', opts: [['x', 'YZ'], ['z', 'XZ'], ['y', 'XY']], get: () => r.plane || 'x', set: (v) => { toolDef.mirrorPlane = v; saveToolDef(); c.set('plane', v); } });
    return ` · ${c.nm(r.src)}`;
  },
});
defineConstruction('extrude', {
  name: 'Extruir',
  build: (r, ins) => HX.extrudeData(r.deg ? N.rebuildCurve(ins[0].data, r.deg, r.spans || Math.max(1, ins[0].data.cvs.length - r.deg)) : ins[0].data, r.dist, r.dir, r.both),
  panel(r, c) {
    const { group, fields, set, live, nm } = c;
    // grado y spans del perfil (0 = los de la curva); la dirección de extrusión es lineal (grado 1, 1 span)
    fields.push({ type: 'seg', label: 'Grado', opts: [[0, 'Curva'], [1, '1'], [2, '2'], [3, '3'], [5, '5']], get: () => r.deg || 0, set: (v) => set('deg', v || undefined) },
      { type: 'range', label: 'Spans', min: 1, max: 32, step: 1, show: () => !!r.deg, get: () => r.spans || Math.max(1, (byId(r.src)?.data.cvs.length || 4) - (r.deg || 3)), start: checkpoint, set: live('spans'), fmt: (v) => String(v) });
    fields.push({ type: 'range', label: 'Distancia', min: -10, max: 10, step: 0.01, get: () => r.dist, start: checkpoint, set: live('dist'), fmt: (v) => v.toFixed(2) + ' dm' },
      { type: 'seg', label: 'Dirección', opts: [['auto', 'Normal'], ['x', 'X'], ['z', 'Y'], ['y', 'Z']], get: () => r.dir, set: (v) => { toolDef.extDir = v; saveToolDef(); set('dir', v); } },
      { type: 'check', label: 'Hacia los dos lados', get: () => r.both, set: (v) => { toolDef.extBoth = v; saveToolDef(); set('both', v); } });
    return group.length > 1 ? ` · ${group.length} curvas` : ` · ${nm(r.src)}`;
  },
  points(r, out) {
    const d = out.data, p = v3(mid(d.cvs[1])), sgn = Math.sign(r.dist) || 1;
    return [cpoint('distance', p, p.clone().sub(v3(mid(d.cvs[0]))).normalize(), { get: () => r.dist, drag: (delta, s0) => { r.dist = Math.round((s0 + delta * sgn) * 100) / 100 || 0.01; } })];
  },
});
defineConstruction('revolve', {
  name: 'Revolución', inputs: (r) => (r.axisMode === 'picked' && r.axisObj != null ? [r.src, r.axisObj] : [r.src]),
  build: (r, ins) => N.revolve(ins[0].data, revOpts(r, ins[0])),
  panel(r, c) {
    const { group, fields, set, live, nm } = c;
    const setAxis = (v) => {
      if (v in AXIS_IDX || v === 'pivot') { toolDef.revAxis = v; saveToolDef(); }
      if (v === 'picked') {
        revolveDrag = null;
        beginTool('revaxis', { label: 'Eje elegido', voidKill: false, cleanup: () => { revAxisPick = null; } });
        revAxisPick = { rels: group }; toast('Eje elegido: haz clic en una línea, curva o borde'); return;
      }
      if (v === 'manip') {
        // el manipulador empieza en el eje que había: base en su origen y punta a 2 dm a lo largo de él
        checkpoint();
        group.forEach((x) => { const ax = revAxis(x, byId(x.src)); x.origin = ax.origin.toArray(); x.tip = ax.origin.clone().addScaledVector(ax.axis.normalize(), 2).toArray(); x.axisMode = 'manip'; });
        redo(); TW.show(relSpec(r, group));
        toast('Arrastra los puntos cian (base y punta del eje) · Ctrl: a un punto · Ctrl+Alt: a una curva');
        return;
      }
      set('axisMode', v);
    };
    const mode = () => (r.axisMode === 'vector' ? 'manip' : r.axisMode || 'world');
    const MAXA = r.pitch ? 1440 : 360;
    fields.push({ type: 'seg', label: 'Eje', opts: [['x', 'X'], ['y', 'Y'], ['world', 'Z'], ['pivot', 'Pivote'], ['picked', 'Elegido'], ['manip', 'Manip']], get: mode, set: setAxis },
      { type: 'html', show: () => mode() === 'picked', html: () => `<span class="tw-note">Eje: ${esc(byId(r.axisObj)?.name || '¿?')}${r.axisEdge ? ' · ' + EDGE_NAMES[r.axisEdge] : ''} (si lo mueves, la revolución lo sigue)</span>` },
      { type: 'range', label: 'Inicio', min: -360, max: 360, step: 0.5, get: () => r.a0 || 0, start: checkpoint, set: live('a0'), fmt: (v) => v.toFixed(1) + '°' },
      { type: 'range', label: 'Fin', min: -360, max: 360 + MAXA, step: 0.5, get: () => (r.a0 || 0) + (r.angle ?? 360), start: checkpoint,
        set: (v) => { group.forEach((x) => (x.angle = Math.max(1, Math.min(MAXA, v - (x.a0 || 0))))); redo(); }, fmt: (v) => v.toFixed(1) + '°' },
      { type: 'range', label: 'Barrido', min: 1, max: MAXA, step: 0.5, get: () => r.angle ?? 360, start: checkpoint, set: live('angle'), fmt: (v) => v.toFixed(1) + '°' },
      { type: 'range', label: 'Paso (hélice)', min: -5, max: 5, step: 0.01, get: () => r.pitch || 0, start: checkpoint, set: (v) => { toolDef.revPitch = v; saveToolDef(); live('pitch')(v); }, fmt: (v) => (v ? (v * 100).toFixed(0) + ' mm/vuelta' : 'no') },
      { type: 'check', label: 'Racional (arco exacto)', get: () => r.rational !== false && !r.pitch, set: (v) => { toolDef.revRational = v; saveToolDef(); set('rational', v); TW.show(relSpec(r, group)); } },
      { type: 'seg', label: 'Grado', opts: [[1, '1'], [2, '2'], [3, '3'], [5, '5'], [7, '7']], get: () => (r.rational === false || r.pitch ? r.deg || 3 : 2), set: (v) => { toolDef.revDeg = v; toolDef.revRational = false; saveToolDef(); group.forEach((x) => (x.rational = false)); set('deg', v); } },
      { type: 'range', label: 'Spans', min: 1, max: 32, step: 1, get: () => (r.rational === false || r.pitch ? r.spans || 8 : Math.ceil((r.angle || 360) / 90)), start: checkpoint, set: (v) => { toolDef.revSpans = v; toolDef.revRational = false; saveToolDef(); group.forEach((x) => (x.rational = false)); live('spans')(v); }, fmt: (v) => String(v) },
      { type: 'html', html: () => '<span class="tw-note">Flechas verdes = inicio y fin del barrido · azul = paso · cian = base y punta del eje (Manip). Clic derecho en la vista = aceptar y cerrar.</span>' });
    return group.length > 1 ? ` · ${group.length} curvas` : ` · ${nm(r.src)}`;
  },
  points(r) {
    const F = revFrame(r), H = [];
    if (r.axisMode === 'manip' && r.origin && r.tip) {
      // manipulador del eje: base y punta, libres en 3D con snap
      const O = new THREE.Vector3(...r.origin), T = new THREE.Vector3(...r.tip), d = T.clone().sub(O).normalize();
      H.push(cpoint('axis', O, d, { label: 'base del eje', move: (p) => { r.origin = p.toArray(); } }),
        cpoint('axis', T, d, { label: 'punta del eje', move: (p) => { r.tip = p.toArray(); } }));
    }
    if (!F) return H;
    const MAXA = r.pitch ? 1440 : 360, S = THREE.MathUtils.degToRad(r.a0 || 0), A = THREE.MathUtils.degToRad(r.angle ?? 360), adv = (r.pitch || 0) * A / (2 * Math.PI);
    const ptAt = (a, h) => F.foot.clone().addScaledVector(F.e1, Math.cos(a) * F.r).addScaledVector(F.e2, Math.sin(a) * F.r).addScaledVector(F.D, h);
    const tanAt = (a) => F.e2.clone().multiplyScalar(Math.cos(a)).addScaledVector(F.e1, -Math.sin(a)).normalize();
    const pos = ptAt(S + A, adv), deg = (delta) => THREE.MathUtils.radToDeg(delta / F.r);
    H.push(cpoint('distance', pos, tanAt(S + A), { label: 'fin', get: () => r.angle ?? 360,
        drag: (delta, s0) => { r.angle = Math.max(1, Math.min(MAXA, Math.round((s0 + deg(delta)) * 2) / 2)); } }),
      // inicio: se mueve el comienzo del barrido y el fin se queda donde estaba
      cpoint('distance', ptAt(S, 0), tanAt(S).negate(), { label: 'inicio', get: () => [r.a0 || 0, r.angle ?? 360],
        drag: (delta, s0) => { const d = Math.round(-deg(delta) * 2) / 2, ang = Math.max(1, Math.min(MAXA, s0[1] - d)); r.a0 = s0[0] + (s0[1] - ang); r.angle = ang; } }),
      cpoint('tension', pos.clone(), F.D.clone(), { label: 'paso', get: () => r.pitch || 0,
        drag: (delta, s0) => { r.pitch = Math.round((s0 + (delta * 2 * Math.PI) / Math.max(A, 0.1)) * 100) / 100; } }));
    return H;
  },
});
defineConstruction('loft', {
  name: 'Loft', inputs: (r) => r.srcs,
  build: (r, ins) => N.loft(ins.map((c) => c.data)),
  panel: (r) => ` · ${r.srcs.length} curvas`,
  summary: (r, nm) => `${nm(r.out)} ← ${r.srcs.length} curvas`,
});
// ---------- Trim por regiones (como trim(n, u[], v[]) de AlSurface: puntos (u, v) dicen qué piezas se quedan) ----------
// Herramientas de corte = curvas: las libres se proyectan sobre la superficie (Vista / Z / Normal); las curvas sobre esa superficie se usan
// tal cual. Cada una, cerrada o de borde a borde, parte la superficie. r.picks = puntos (u, v) elegidos con clics; r.keep = esas regiones se
// conservan (true) o se quitan (false). La salida es la propia superficie (sus CVs no cambian: se guarda data.rtrim y se dibuja recortada).
// devuelve una lista de cortes [{uv, closed}] en el (u, v) de la superficie: una curva da uno; otra SUPERFICIE da las curvas de
// intersección de las dos (FF.intersectSurfaces), que siguen a esa superficie con historial si se mueve
function trimToolUV(r, c, srf) {
  if (c.kind === 'surface') return FF.intersectSurfaces(srf.data, c.data).map((x) => ({ uv: x.a, closed: x.closed }));
  if (c.data.cos?.surf === srf.id) return [{ uv: c.data.cos.uv, closed: !!c.data.cos.closed }];
  const pr = FF.projectCurve(c.data, srf.data, r.proj === 'normal' ? 'normal' : 'dir', r.dir);
  return [{ uv: pr.uv, closed: pr.closed }];
}
// ETAPAS: cada Trim es una etapa de la superficie, data.rtrims = [{ rel, loops, picks, mode }] en el orden en que se hicieron (Untrim
// "Última" quita la de más atrás). data.rtrim (v0.47) = una sola etapa antigua, se lee igual.
function trimStages(d) { return d.rtrims || (d.rtrim ? [{ rel: null, ...d.rtrim }] : []); }
function cloneStage(st) { return { rel: st.rel ?? null, mode: st.mode, loops: st.loops.map((l) => l.map((q) => q.slice())), picks: st.picks.map((q) => q.slice()) }; }
function setTrimStages(o, st) { const d = { ...o.data }; delete d.rtrim; if (st.length) d.rtrims = st; else delete d.rtrims; o.data = d; }
const stageOf = (r) => trimStages(byId(r.surf)?.data || {}).find((st) => st.rel === r.id);
function trimData(r, ins, out) {
  const srf = ins[0], loops = [];
  ins.slice(1).forEach((c) => trimToolUV(r, c, srf).forEach((t) => { const l = t.uv?.length > 1 ? FF.trimLoop(t) : null; if (l) loops.push(l); }));
  const stage = { rel: r.id, loops, picks: (r.picks || []).map((q) => q.slice()), mode: r.keep === false ? 'discard' : 'keep' };
  const st = trimStages(out.data).slice(), i = st.findIndex((x) => x.rel === r.id);
  if (i >= 0) st[i] = stage; else st.push(stage);
  const d = { ...out.data, rtrims: st }; delete d.rtrim;
  return d;
}
defineConstruction('trim', {
  name: 'Trim', inputs: (r) => [r.surf, ...r.tools], output: (r) => r.surf, editable: true,
  build: (r, ins, out) => trimData(r, ins, out),
  revert: (r, out) => { if (out) setTrimStages(out, trimStages(out.data).filter((x) => x.rel !== r.id)); },
  summary: (r, nm) => `${nm(r.surf)} · ${r.picks?.length || 0} región(es) ${r.keep === false ? 'quitada(s)' : 'conservada(s)'}`,
  panel(r, c) {
    const { fields, set, redo, nm } = c;
    fields.push({ type: 'seg', label: 'Las piezas elegidas', opts: [['keep', 'Se conservan'], ['discard', 'Se quitan']], get: () => (r.keep === false ? 'discard' : 'keep'),
        set: (v) => { toolDef.trimKeep = v === 'keep'; saveToolDef(); set('keep', v === 'keep'); } },
      { type: 'seg', label: 'Proyección', opts: [['view', 'Vista'], ['y', 'Z'], ['normal', 'Normal']], get: () => r.proj || 'view',
        set: (v) => { toolDef.trimProj = v; saveToolDef(); checkpoint(); r.proj = v; r.dir = projDir(v); redo(); } },
      { type: 'html', html: () => `<span class="tw-note">${r.tools.length} herramienta(s) de corte (curvas o superficies) · ${stageOf(r)?.loops.length ?? 0} corte(s) sobre la superficie · ${r.picks?.length || 0} pieza(s) elegida(s).${trimOp?.rel === r ? '<br>Clic en una pieza = elegirla o soltarla · clic derecho o Enter = aceptar · Esc = cancelar.' : ''}</span>` },
      { type: 'button', label: 'Soltar todas las piezas elegidas', run: () => { checkpoint(); r.picks = []; redo(); TW.render(); } });
    return ` · ${nm(r.surf)}`;
  },
});
// Redondeo / chaflán de OpenCascade: no se recalcula solo (el núcleo no tiene historial), pero guarda las superficies de origen
// ocultas (consumed) para que Revert las devuelva y borre el resultado.
defineConstruction('fillet', {
  name: 'Redondeo', inputs: (r) => r.srcs, output: (r) => r.outs[0], editable: true,
  build: (r, ins, out) => out.data,
  summary: (r, nm) => `${r.kind || 'Redondeo'} · ${r.n || 0} arista(s) · ${r.srcs.length} original(es) oculta(s)`,
  panel(r, c) {
    c.fields.push({ type: 'html', html: () => `<span class="tw-note">${r.kind || 'Redondeo'} de ${Math.abs((r.dist || 0) * 100).toFixed(1)} mm en ${r.n || 0} arista(s). Las superficies de origen (${r.srcs.map((id) => c.nm(id)).join(', ')}) están ocultas y atadas a esta operación: <b>Revert</b> borra el resultado y las devuelve.</span>` });
    return ` · ${r.n || 0} arista(s)`;
  },
  revert: (r) => { r.outs.slice().reverse().map(byId).filter(Boolean).forEach(removeObject); },
});
defineConstruction('fcurve', {
  name: 'Carril de redondeo', inputs: (r) => [r.src, r.other],
  build: (r, ins) => fcurveData(r, ins[0], ins[1]),
  points: (r) => (r.fg ? gfilletPoints(r) : []),
});
function applyRelation(r) {
  const out = byId(outputOf(r)), ins = inputsOf(r).map(byId);
  if (!out || ins.some((o) => !o)) return false;
  try { out.data = relationData(r, ins, out); }
  catch (e) { console.warn(e); toast(`${relName(r)}: no se pudo recalcular (${e.message})`); return false; }
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
        const hit = inputsOf(r).includes(id) || (constructionOf(r).editsOutput && outputOf(r) === id && id === obj.id);
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
const toolDef = Object.assign({ curveDeg: 3, curveSpans: 0, alignCont: 2, alignTension: 1, blendA: 2, blendB: 2, blendTension: 1, extDir: 'auto', extBoth: false, offsetDist: 0.2, mirrorPlane: 'x' }, prefs.tools || {});
const saveToolDef = () => { prefs.tools = toolDef; savePrefs(); };

// --- Ventana de opciones de la herramienta: un desenfoque de lo que hay detrás, sin marco, con los ajustes encima ---
// ---------- Ventanas flotantes (opciones de herramienta, Transform info) ----------
// Barra de título: arrastrar = mover libre por toda la pantalla (la barra nunca se pierde fuera de ella), _ = minimizar
// (queda solo la barra), × = cerrar. Posición, minimizado y cerrado se recuerdan en prefs.wins[id].
function winState(id) { return ((prefs.wins ||= {})[id] ||= {}); }
function winButtons() {
  return '<button class="win-btn" data-win="min" title="Minimizar" aria-label="Minimizar">_</button>'
    + '<button class="win-btn" data-win="close" title="Cerrar" aria-label="Cerrar">×</button>';
}
function placeWin(el, id) {
  const st = winState(id);
  el.classList.toggle('win-min', !!st.min);
  el.querySelectorAll('[data-win="min"]').forEach((b) => { b.textContent = st.min ? '▢' : '_'; b.title = st.min ? 'Restaurar' : 'Minimizar'; });
  if (st.x == null) return;
  const w = el.offsetWidth || 280;
  // libre por la pantalla, pero siempre quedan 80 px de la barra a la vista para poder agarrarla
  const x = Math.min(innerWidth - 80, Math.max(80 - w, st.x)), y = Math.min(innerHeight - 32, Math.max(0, st.y));
  Object.assign(el.style, { left: x + 'px', top: y + 'px', right: 'auto', bottom: 'auto', translate: 'none' });
}
function setWinMin(el, id, v) { winState(id).min = v; placeWin(el, id); savePrefs(); }
function dragWin(el, id, headSel) {
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !e.target.closest(headSel) || e.target.closest('button, input')) return;
    e.preventDefault();
    const r = el.getBoundingClientRect(), ox = e.clientX - r.left, oy = e.clientY - r.top, st = winState(id);
    const mv = (m) => { st.x = m.clientX - ox; st.y = m.clientY - oy; placeWin(el, id); };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); savePrefs(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  });
}
// Casilla numérica de un deslizador: el número se muestra en las mismas unidades que su texto (fmt; p. ej. el paso de la hélice
// se guarda en dm y se lee en mm/vuelta), con hasta 4 decimales, sin redondear a lo que muestra el deslizador.
function rangeScale(f) {
  const probe = f.max || f.min || 1, t = String(f.fmt(probe)), m = t.match(/^-?\d+(?:[.,]\d+)?/);
  const k = m ? parseFloat(m[0].replace(',', '.')) / probe : 1;
  return { k: Number.isFinite(k) && k ? Math.round(k * 1e6) / 1e6 : 1, unit: m ? t.slice(m[0].length).trim() : '' };
}
const numShow = (x) => String(+(+x).toFixed(4));
const TW = {
  spec: null,
  show(spec) { this.spec = spec; this.render(); $('toolwin').hidden = false; placeWin($('toolwin'), 'tool'); updateRelArrows(); },
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
        if (f.opts.length > 4) row.classList.add('tw-wide');   // muchas opciones: la etiqueta encima y los botones a todo el ancho
        row.innerHTML = `<label>${esc(f.label)}</label><div class="tw-seg">${f.opts.map(([v, l]) => `<button data-v="${v}" aria-pressed="${String(f.get() === v)}">${esc(l)}</button>`).join('')}</div>`;
        row.querySelectorAll('button').forEach((bt) => bt.addEventListener('click', () => {
          const v = f.opts.find(([x]) => String(x) === bt.dataset.v)[0];
          f.set(v); this.render();
        }));
      } else if (f.type === 'range') {
        // deslizador + casilla para escribir el valor exacto (como los campos de Alias): Enter o salir de la casilla = aplicar, Esc = dejarlo
        const { k, unit } = rangeScale(f);
        row.innerHTML = `<label>${esc(f.label)}</label><input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.get()}">`
          + `<span class="tw-numw"><input class="tw-num" type="text" inputmode="decimal" spellcheck="false" value="${numShow(f.get() * k)}"><em>${esc(unit)}</em></span>`;
        const inp = row.querySelector('input[type=range]'), num = row.querySelector('.tw-num');
        inp.addEventListener('pointerdown', () => f.start?.());
        inp.addEventListener('input', () => { f.set(+inp.value); num.value = numShow(+inp.value * k); });
        num.addEventListener('focus', () => num.select());
        num.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter') num.blur();
          else if (e.key === 'Escape') { num.value = numShow(f.get() * k); num.blur(); }
        });
        num.addEventListener('change', () => {
          let v = parseFloat(num.value.replace(',', '.')) / k;
          if (!Number.isFinite(v)) { num.value = numShow(f.get() * k); return; }
          v = Math.min(f.max, Math.max(f.min, v));
          if (f.step >= 1) v = Math.round(v);
          f.start?.(); f.set(v); this.render();
        });
      } else if (f.type === 'button') {
        row.innerHTML = `<button class="tw-btn tw-rowbtn">${esc(f.label)}</button>`;
        row.querySelector('button').addEventListener('click', () => f.run());
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
$('tw-close').addEventListener('click', () => { endActiveTool('esc'); if (tool !== 'select') setToolRaw('select'); TW.hide(); });
// la ventana se arrastra por su título a cualquier sitio; _ la minimiza (solo queda la barra)
dragWin($('toolwin'), 'tool', '.tw-head');
$('tw-min').addEventListener('click', () => setWinMin($('toolwin'), 'tool', !winState('tool').min));
addEventListener('resize', () => { if (!$('toolwin').hidden) placeWin($('toolwin'), 'tool'); });

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

// --- Líneas juntas: si bajo el cursor hay dos o más (curvas, bordes de superficies), sale un menú al lado del puntero ---
const EDGE_NAMES = { u0: 'borde U inicial', u1: 'borde U final', v0: 'borde V inicial', v1: 'borde V final' };
const edgeCache = new WeakMap();   // data de la superficie → puntos de sus 4 bordes
function surfaceEdgePts(o) {
  let c = edgeCache.get(o.data);
  if (!c) { c = {}; for (const ed of ['u0', 'u1', 'v0', 'v1']) c[ed] = HX.edgePoints(o.data, ed, 24); edgeCache.set(o.data, c); }
  return c;
}
// Candidatos bajo el cursor a menos de `tol` píxeles: [{ obj, edge?, d }] de más cerca a más lejos. kinds: 'edge' | 'curve' | 'both'.
// Se ignoran las líneas tapadas por otra superficie.
function lineCandidates(e, kinds = 'both', tol = 8, filter = () => true, byDepth = diagMode === 'wire') {
  const pn = paneAt(e.clientX);
  useAspect(pn);
  const r = renderer.domElement.getBoundingClientRect(), v = new THREE.Vector3();
  const scr = (q) => { v.copy(q).project(camera); return [r.left + pn.x + ((v.x + 1) / 2) * pn.w, r.top + ((1 - v.y) / 2) * pn.h, v.z]; };
  const best = (pts) => {
    let bd = Infinity, bq = null;
    const S = pts.map(scr);
    for (let k = 0; k < S.length - 1; k++) {
      const [ax, ay, az] = S[k], [bx, by, bz] = S[k + 1];
      if (az > 1 || bz > 1) continue;
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((e.clientX - ax) * dx + (e.clientY - ay) * dy) / L)), d = Math.hypot(e.clientX - ax - t * dx, e.clientY - ay - t * dy);
      if (d < bd) { bd = d; bq = pts[k].clone().lerp(pts[k + 1], t); }
    }
    return { d: bd, q: bq };
  };
  const out = [];
  for (const o of objects) {
    if (!o.visible || !filter(o)) continue;
    if (o.kind === 'curve' && kinds !== 'edge') { const b = best(o.samples || []); if (b.d <= tol) out.push({ obj: o, d: b.d, q: b.q }); }
    else if (o.kind === 'surface' && kinds !== 'curve') {
      const E = surfaceEdgePts(o);
      for (const ed of ['u0', 'u1', 'v0', 'v1']) { const b = best(E[ed]); if (b.d <= tol) out.push({ obj: o, edge: ed, d: b.d, q: b.q }); }
      if (kinds === 'all') for (const l of o.isoLines || []) { if (!l.iso) continue; const b = best(l); if (b.d <= tol) out.push({ obj: o, iso: l.iso, d: b.d, q: b.q }); }
    }
  }
  // fuera las que tapa otra superficie (el rayo de la cámara al punto topa antes con una malla ajena)
  const meshes = objects.filter((o) => o.visible && o.kind !== 'curve').map((o) => o.parts.mesh);
  // con el modo Malla (alambre) se pueden elegir también las líneas de atrás, pero ganan las más cercanas a la cámara
  const vis = diagMode === 'wire' ? out : out.filter((c) => {
    const dir = c.q.clone().sub(camera.position), dist = dir.length();
    ray.set(camera.position, dir.normalize());
    const h = ray.intersectObjects(meshes, false)[0];
    return !h || h.distance > dist - Math.max(0.03, dist * 0.03);
  });
  const cd = (c) => camera.position.distanceTo(c.q);
  vis.forEach((c) => (c.depth = cd(c)));
  return vis.sort(byDepth ? (a, b) => a.depth - b.depth : (a, b) => a.d - b.d);
}
// una persona entiende "Cuerpo" o "Curva 3": el borde solo se nombra cuando hay que distinguir bordes de una misma superficie
function candLabel(c, withEdge) {
  const kind = c.obj.data?.cos ? '∿ ' : c.obj.kind === 'curve' ? '∿ ' : c.iso ? '≡ ' : '◩ ';
  return kind + c.obj.name + (withEdge && c.edge ? ` · ${EDGE_NAMES[c.edge]}` : c.iso ? ` · isoparamétrica ${c.iso.dir.toUpperCase()}=${c.iso.t.toFixed(2)}` : '') + (c.obj.data?.cos ? (c.obj.data.cos.edge ? ' · borde de recorte' : ' · curva sobre superficie') : '');
}
async function chooseCandidate(e, cands, title = 'Elegir', withEdge = false) {
  const i = await quickPick(e.clientX, e.clientY, title, cands.map((c, k) => [k, candLabel(c, withEdge)]), 0);
  return i == null ? null : cands[i];
}

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
  // clic sobre la cara: el borde VISIBLE más cercano en pantalla de esa superficie (no el que está por detrás)
  const obj = hit.object.userData.obj;
  const near = lineCandidates(e, 'edge', 4000, (o) => o === obj, false);
  if (near.length) return { obj, edge: near[0].edge };
  return { obj, edge: HX.nearestEdge(hit.uv.x, hit.uv.y) };
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
    title: 'Align', pick: 'both',
    steps: ['1 · Clic cerca del borde de la superficie (o la curva) que se ajusta (verde)', '2 · Clic en la maestra (azul): borde, curva, curva sobre superficie, borde de recorte o isoparamétrica'],
    fields: () => [
      { type: 'seg', label: 'Continuidad', opts: [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => toolDef.alignCont, set: (v) => { toolDef.alignCont = v; saveToolDef(); } },
      { type: 'range', label: 'Tensión', min: 0.2, max: 3, step: 0.05, get: () => toolDef.alignTension, set: (v) => { toolDef.alignTension = v; saveToolDef(); }, fmt: (v) => v.toFixed(2) },
      { type: 'range', label: 'Forma (G2 y G3)', min: -2, max: 2, step: 0.05, get: () => toolDef.alignShape ?? 0, set: (v) => { toolDef.alignShape = v; saveToolDef(); }, fmt: (v) => v.toFixed(2) },
      ...CONTROL_OPTS(),
      { type: 'html', html: () => '<span class="tw-note">Una curva se alinea por el extremo más cercano al clic, a otra curva o al borde de una superficie. Si hay varias líneas juntas sale un menú para elegir. Al elegir la maestra sale G0–G3 junto al cursor (o pulsa 1–4). Ya creado, en su ventana: rango, suavizado y tensión inicio / fin.</span>' }],
    async afterPick(i, p, e) {
      if (i === 0 && p.iso) { toast('Una isoparamétrica solo puede ser la maestra (azul). Elige primero un borde o una curva libre.'); return restartEdgeOp(); }
      if (i === 0 && p.obj.kind === 'curve') {
        if (p.obj.data.cos) { toast('Una curva sobre superficie o un borde de recorte solo puede ser la maestra (azul). Elige primero un borde o una curva libre.'); return restartEdgeOp(); }
        p.end = curveEndNearRay(p.obj, e);
        markEnd(0, p.obj, p.end);
      }
      if (i === 1) {
        const a = edgeOp.picks[0];
        if (a.obj.kind === 'surface' && p.obj.kind === 'curve' && !p.obj.data.cos) { toast('Una superficie se alinea a otra superficie, a una curva sobre superficie, a un borde de recorte o a una isoparamétrica. Una curva libre no tiene superficie con la que cruzar.'); return restartEdgeOp(); }
        if (p.obj.kind === 'curve' && !p.iso) { p.end = curveEndNearRay(p.obj, e); markEnd(1, p.obj, p.end); }
        const c = await quickPick(e.clientX, e.clientY, 'Continuidad', G_OPTS(0, 3), toolDef.alignCont);
        if (c == null) return restartEdgeOp();
        toolDef.alignCont = c; saveToolDef();
        if (a.obj.kind === 'curve') createAlignCurve(a, p, c); else createAlign(a, p, c);
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
  // Redondeo G2/G3 (macro): un clic en el borde común de dos superficies = carriles sobre cada una (curvas sobre superficie que las
  // recortan) + Freeform Blend G2 entre ellos. Todo queda en el historial como un solo redondeo (r.fg) con su ventana.
  gfillet: {
    title: 'Redondeo G2 / G3', pick: 'edge', noMenu: true, steps: ['Clic en el borde común de dos superficies'],
    fields: () => [
      { type: 'seg', label: 'Medida', opts: [['radius', 'Radio'], ['chord', 'Cuerda'], ['distance', 'Distancia']], get: () => toolDef.gfMeasure || 'radius', set: (v) => { toolDef.gfMeasure = v; saveToolDef(); } },
      { type: 'range', label: 'Valor', min: 0.01, max: 2, step: 0.005, get: () => toolDef.gfDist ?? 0.2, set: (v) => { toolDef.gfDist = v; saveToolDef(); }, fmt: (v) => (v * 100).toFixed(1) + ' mm' },
      { type: 'seg', label: 'Continuidad', opts: [[1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => toolDef.gfCont ?? 2, set: (v) => { toolDef.gfCont = v; saveToolDef(); } },
      { type: 'range', label: 'Form factor', min: 0.2, max: 3, step: 0.05, get: () => toolDef.gfForm ?? 1, set: (v) => { toolDef.gfForm = v; saveToolDef(); }, fmt: (v) => v.toFixed(2) },
      { type: 'html', html: () => '<span class="tw-note">Por dentro: carril sobre cada superficie (las recorta) + Freeform Blend con la continuidad elegida. Funciona con superficies que se tocan por un borde completo.</span>' }],
    afterPick(i, p) { createGFillet(p); },
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
function restartEdgeOp() { if (!edgeOp) return; markEnd(0, null); markEnd(1, null); edgeOp.picks = []; edgeOp.sides = null; edgeOp.cur = 0; [0, 1, 2].forEach((k) => markEdge(k, null)); updateHint(); TW.show(edgeSpec()); }
// tras crear: se ve la ventana de lo creado (con sus flechas) y la herramienta sigue lista para la siguiente unión
function continueEdgeOp(r) {
  if (!edgeOp) return;
  markEnd(0, null); markEnd(1, null);
  edgeOp.picks = []; edgeOp.sides = null; edgeOp.cur = 0; [0, 1, 2].forEach((k) => markEdge(k, null)); updateHint();
  const out = byId(outputOf(r));
  if (out) applySelection([out], 'replace');   // lo que se acaba de alinear o unir queda activo, con sus CVs a la vista
  const sp = relSpec(r);
  if (r.fg) { TW.show(sp); return; }   // redondeo G2: su propia ventana (un solo nodo)
  sp.actions = [{ label: 'Quitar historial', run: () => removeRelation(r.id) }, { label: 'Terminar', primary: true, run: () => { setTool('select'); TW.hide(); } }];
  sp.hint = () => (r.type === 'skin' ? 'Cambia sus opciones aquí · clic en otra curva = nuevo Skin' : r.type === 'extend' ? 'Arrastra la flecha verde (distancia) · clic en otro borde = otra extensión'
    : 'Arrastra las flechas: azul = tangente (G1), naranja = curvatura (G2), violeta = G3 · clic en otro borde = nueva unión');
  TW.show(sp);
}
function endEdgeOp() { markEnd(0, null); markEnd(1, null); edgeOp = null; [0, 1, 2].forEach((k) => markEdge(k, null)); if (TW.spec && !TW.spec.rel) TW.hide(); }
let edgeBusy = false;
// lado elegido con el ratón: la línea más cercana (≤ 9 px); si hay dos o más juntas, menú junto al puntero
async function sideChoice(e, kinds) {
  const near = lineCandidates(e, kinds === 'curve' ? 'curve' : kinds === 'both' ? 'both' : kinds === 'all' ? 'all' : 'edge', 9);
  // en alambre ganan las más cercanas a la cámara; el menú solo sale si están casi a la misma profundidad
  const closeDepth = diagMode !== 'wire' || Math.abs(near[1]?.depth - near[0]?.depth) < near[0]?.depth * 0.03;
  if (near.length >= 2 && Math.abs(near[1].d - near[0].d) < 7 && closeDepth) {
    const c = await chooseCandidate(e, near.slice(0, 6), 'Elegir línea', true);
    return c === null ? 'cancel' : { obj: c.obj, edge: c.edge, iso: c.iso };
  }
  if (near.length) return { obj: near[0].obj, edge: near[0].edge, iso: near[0].iso };
  return sideAt(e, kinds);
}
async function edgeClick(e) {
  if (!edgeOp || e.button !== 0 || edgeBusy) return;
  const op = EDGE_OPS[edgeOp.type];
  edgeBusy = true;
  let p;
  try { p = op.noMenu ? (() => { const nr = lineCandidates(e, 'edge', 9); return nr.length ? { obj: nr[0].obj, edge: nr[0].edge } : sideAt(e, op.pick); })() : await sideChoice(e, edgeOp.type === 'align' && edgeOp.picks.length === 1 ? 'all' : op.pick); } finally { edgeBusy = false; }
  if (p === 'cancel') return;
  if (!p) return toast(op.pick === 'curve' ? 'Haz clic sobre una curva.' : op.pick === 'both' ? 'Haz clic cerca de un borde de superficie o sobre una curva.' : 'Haz clic sobre una superficie, cerca del borde que quieres.');
  if (op.click) { if (TW.spec?.rel) TW.show(edgeSpec()); op.click(p, e); return; }
  const p0 = edgeOp.picks[0];
  if (p0 && p0.obj === p.obj && (p.obj.kind === 'curve' || p0.edge === p.edge)) return toast('Elige otro borde u otra curva.');
  const i = edgeOp.picks.length;
  if (i === 0 && TW.spec?.rel) TW.show(edgeSpec());
  markEdge(i, p.iso ? null : p.obj, p.edge);
  edgeOp.picks.push(p);
  updateHint(); TW.render();
  edgeBusy = true;
  try { await EDGE_OPS[edgeOp.type].afterPick(i, p, e); } finally { edgeBusy = false; }
}
renderer.domElement.addEventListener('pointermove', (e) => {
  if (tool !== 'edge' || e.buttons || edgeBusy) return;
  const kk = edgeOp && (edgeOp.type === 'align' && edgeOp.picks.length === 1 ? 'all' : EDGE_OPS[edgeOp.type].pick);
  const near = edgeOp && lineCandidates(e, kk === 'curve' ? 'curve' : kk === 'both' ? 'both' : kk === 'all' ? 'all' : 'edge', 9);
  const p = edgeOp && (near.length ? { obj: near[0].obj, edge: near[0].edge, iso: near[0].iso } : sideAt(e, kk));
  if (p && !p.iso) markEdge(2, p.obj, p.edge); else if (p?.iso) markEdge(2, null); else markEdge(2, null);
});

// extremo de una curva más cercano al rayo del cursor
function curveEndNearRay(o, e) {
  setRay(e);
  const c = o.data.cvs;
  return ray.ray.distanceToPoint(v3(c[0])) <= ray.ray.distanceToPoint(v3(c[c.length - 1])) ? 0 : 1;
}
// marca un extremo de curva (bolita en el color del lado)
const endMarks = [];
function markEnd(i, obj, end) {
  if (endMarks[i]) { scene.remove(endMarks[i]); endMarks[i] = null; }
  if (!obj) return;
  const c = obj.data.cvs[end ? obj.data.cvs.length - 1 : 0];
  const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshBasicMaterial({ color: i ? '#2f7bff' : '#2fb36b', depthTest: false, transparent: true }));
  m.position.set(c.x, c.y, c.z); m.renderOrder = 45; scene.add(m); endMarks[i] = m;
}
function createAlignCurve(s, m, cont = toolDef.alignCont) {
  checkpoint();
  const before = cloneData(s.obj);
  const r = { type: 'align', curve: true, slave: s.obj.id, sEnd: s.end, master: m.obj.id, cont, tension: toolDef.alignTension, shape: toolDef.alignShape ?? 0, atype: 'natural' };
  try {
    if (m.iso) { r.mIso = m.iso; retargetCurve(r); }
    else if (m.obj.kind === 'curve') { r.mEnd = m.end; r.mT = m.end ? 1 : 0; }
    else {
      r.mEdge = m.edge; const cv = s.obj.data.cvs, c = cv[s.end ? cv.length - 1 : 0], c1 = cv[s.end ? cv.length - 2 : 1]; r.mT = HX.edgeParamNear(m.obj.data, m.edge, v3(c));
      // por omisión la curva conserva su propia dirección acostada sobre la superficie (Tangente de la curva); Natural = isoparamétrica cruzada
      r.tdir = v3(c1).sub(v3(c)).normalize().toArray();
      r.atype = toolDef.alignCurveType || 'tangent';
    }
    s.obj.data = HX.prepareCurve(s.obj.data, cont);
    r.lambda0 = HX.curveNaturalLambda(s.obj.data, r.sEnd, m.obj.data, r, masterField(r));
    addRelation(r); revertStore.set(r.id, before);
    applyRelation(r);
  } catch (err) { console.warn(err); toast(`Align no se pudo hacer: ${err.message}`); return restartEdgeOp(); }
  if (maybeDropHistory(r)) { toast(`Align G${cont} hecho, sin historial`); return restartEdgeOp(); }
  toast(`Align G${cont}: ${s.obj.name} sigue a ${m.obj.name}. Ajusta con las flechas o en su ventana.`);
  continueEdgeOp(r);
}
function createAlign(s, m, cont = toolDef.alignCont) {
  checkpoint();
  const before = cloneData(s.obj);
  const r = { type: 'align', slave: s.obj.id, sEdge: s.edge, master: m.obj.id, mEdge: m.edge, cont, tension: toolDef.alignTension, shape: toolDef.alignShape ?? 0, atype: 'natural' };
  if (m.iso) { r.mIso = m.iso; delete r.mEdge; }
  try {
    const free = !!m.iso || m.obj.kind === 'curve';   // maestra que no es un borde: curva sobre superficie, borde de recorte o isoparamétrica
    if (free) {
      const f = masterField(r);
      const sd = s.obj.data, e = s.edge, a0 = HX.row(sd, e, 0), a = v3(a0[0]), b = v3(a0[a0.length - 1]), p0 = f.at(0), p1 = f.at(1);
      r.rev = a.distanceTo(p0) + b.distanceTo(p1) > a.distanceTo(p1) + b.distanceTo(p0);
      s.obj.data = HX.prepareSlaveFree(s.obj.data, s.edge, r.cont);
    } else {
      r.rev = HX.reversed(m.obj.data, m.edge, s.obj.data, s.edge);
      s.obj.data = HX.prepareSlave(s.obj.data, s.edge, m.obj.data, m.edge, r.cont, r.rev);
      r.lambda0 = HX.naturalLambda(s.obj.data, s.edge, m.obj.data, m.edge, r.rev);
    }
    addRelation(r); revertStore.set(r.id, before);
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
    (r.autoTrimmed ||= []).push(c.id);
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
// --- Redondeo G2 / G3 (macro) ---
// borde de otra superficie que coincide con el borde `edge` de `obj` (mismo recorrido, en cualquier sentido)
function findMateEdge(obj, edge) {
  const pts = (d, e) => { const S = FF.surfEval(d), U = e[0] === 'u', end = e[1] === '1'; return [0, 0.25, 0.5, 0.75, 1].map((t) => (U ? S(end ? 1 : 0, t) : S(t, end ? 1 : 0))); };
  const a = pts(obj.data, edge), size = a[0].distanceTo(a[4]) + a[0].distanceTo(a[2]), tol = Math.max(1e-3, size * 0.01);
  let best = null;
  for (const o of objects) {
    if (o === obj || o.kind !== 'surface' || !o.visible) continue;
    for (const e of ['u0', 'u1', 'v0', 'v1']) {
      const b = pts(o.data, e), f = Math.max(...a.map((p, i) => p.distanceTo(b[i]))), r = Math.max(...a.map((p, i) => p.distanceTo(b[4 - i])));
      const d = Math.min(f, r);
      if (d < tol && (!best || d < best.d)) best = { obj: o, edge: e, d };
    }
  }
  return best;
}
function fcurveData(r, src, other) {
  const uv = FF.filletRail(src.data, r.edge, other.data, r.otherEdge, r.dist, r.measure);
  const d = FF.cosCurveData(src.data, uv), cos = { surf: src.id, uv, closed: false, edge: true };
  cos.trim = r.untrimmed ? 'none' : FF.railTrimSide(cos, r.edge) || 'none';
  d.cos = cos;
  return d;
}
let nextFg = 1;
function createGFillet(p) {
  if (p.obj.kind !== 'surface' || !p.edge) { toast('Redondeo G2: haz clic cerca del borde común de dos superficies.'); return restartEdgeOp(); }
  const m = findMateEdge(p.obj, p.edge);
  if (!m) { toast(`Redondeo G2: el borde de ${p.obj.name} no coincide entero con el de otra superficie.`); return restartEdgeOp(); }
  checkpoint();
  const fg = nextFg++ + '-' + Date.now(), dist = toolDef.gfDist ?? 0.2, measure = toolDef.gfMeasure || 'radius', cont = toolDef.gfCont ?? 2, form = toolDef.gfForm ?? 1;
  try {
    const mk = (src, e, oth, oe) => {
      const r = { type: 'fcurve', src: src.id, edge: e, other: oth.id, otherEdge: oe, dist, measure, fg };
      const c = addCurve(fcurveData(r, src, oth), 'Carril'); r.out = c.id; addRelation(r); return c;
    };
    const cA = mk(p.obj, p.edge, m.obj, m.edge), cB = mk(m.obj, m.edge, p.obj, p.edge);
    const b = { type: 'blend', a: cA.id, aEdge: null, b: cB.id, bEdge: null, contA: cont, contB: cont, tension: form, tensionA: form, tensionB: form, lockShape: true,
      flowInt: 'free', flowStart: 'default', flowEnd: 'default', fg };
    const o = addSurface(blendRelData(b), 'Redondeo G' + cont);
    b.out = o.id; addRelation(b);
    toast(`${o.name} entre ${p.obj.name} y ${m.obj.name}: ajusta valor, continuidad y form factor en su ventana (clic derecho: aceptar)`);
    continueEdgeOp(b);
  } catch (err) { console.warn(err); toast(`Redondeo G2 no se pudo hacer: ${err.message}`); undo(); restartEdgeOp(); }
}
// ventana de un redondeo G2 ya creado: cambia sus carriles y su blend a la vez (un solo nodo para el usuario)
function gfilletSpec(r) {
  const rels = relations.filter((x) => x.fg === r.fg), rails = rels.filter((x) => x.type === 'fcurve'), bl = rels.find((x) => x.type === 'blend');
  const nm = (id) => byId(id)?.name || '¿?';
  const redo = () => { rails.forEach((x) => { if (applyRelation(x)) propagateFrom(byId(x.out)); }); if (bl && applyRelation(bl)) propagateFrom(byId(bl.out)); scheduleHistoryDiag(); renderHistory(); updateRelArrows(); if (hudOn) hudRender(); };
  const blendSet = (o) => { Object.assign(bl, o); if (applyRelation(bl)) propagateFrom(byId(bl.out)); scheduleHistoryDiag(); updateRelArrows(); };
  return {
    title: `Redondeo G${bl?.contA ?? 2} · ${nm(rails[0]?.src)} / ${nm(rails[1]?.src)}`, rel: bl,
    hint: () => 'Flecha verde = valor · clic derecho en la vista = aceptar y cerrar',
    fields: [
      { type: 'seg', label: 'Medida', opts: [['radius', 'Radio'], ['chord', 'Cuerda'], ['distance', 'Distancia']], get: () => rails[0]?.measure || 'radius', set: (v) => { checkpoint(); rails.forEach((x) => (x.measure = v)); toolDef.gfMeasure = v; saveToolDef(); redo(); } },
      { type: 'range', label: 'Valor', min: 0.01, max: 2, step: 0.005, get: () => rails[0]?.dist ?? 0.2, start: checkpoint, set: (v) => { rails.forEach((x) => (x.dist = v)); toolDef.gfDist = v; saveToolDef(); redo(); }, fmt: (v) => (v * 100).toFixed(1) + ' mm' },
      { type: 'seg', label: 'Continuidad', opts: [[0, 'G0'], [1, 'G1'], [2, 'G2'], [3, 'G3']], get: () => bl?.contA ?? 2, set: (v) => { checkpoint(); toolDef.gfCont = v; saveToolDef(); blendSet({ contA: v, contB: v }); const o = byId(bl.out); if (o && /^Redondeo G\d/.test(o.name)) { o.name = o.name.replace(/G\d/, 'G' + v); refreshOutliner(); } TW.render(); } },
      { type: 'range', label: 'Form factor', min: 0.2, max: 3, step: 0.05, get: () => bl?.tensionA ?? 1, start: checkpoint, set: (v) => { toolDef.gfForm = v; saveToolDef(); blendSet({ tension: v, tensionA: v, tensionB: v }); }, fmt: (v) => v.toFixed(2) },
      { type: 'html', html: () => '<span class="tw-note">Un solo nodo con historial: si mueves los CVs de las superficies, los carriles, el recorte y el redondeo se recalculan.</span>' }],
    actions: [
      { label: 'Revert', run: () => { checkpoint(); const outs = rels.map((x) => byId(x.out)).filter(Boolean); outs.reverse().forEach((o) => removeObject(o)); selectionChanged(); refreshOutliner(); renderHistory(); TW.hide(); toast('Redondeo quitado: las superficies vuelven a estar enteras'); } },
      { label: 'Aceptar', primary: true, run: () => { TW.hide(); if (edgeOp?.type === 'gfillet') setTool('select'); } }],
  };
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
// ---------- Línea y Extender unificado ----------
function startLine() { setTool('curve'); lineMode = true; startDraft(); toast('Línea: 2 clics (con snaps; X / Y / Z fijan el eje tras el 1.er punto)'); }
// Extender (como extendCurve(param, point[4]) de AlCurve, también para superficies): 1) clic cerca del EXTREMO de una curva o del
// BORDE de una superficie; 2) clic en el punto de destino, con snap (Alt rejilla, Ctrl punto / CV, Ctrl+Alt curva). La curva se
// alarga con continuidad tangente hasta ese punto EXACTO; la superficie se extiende (G1–G3, con historial) hasta el plano que pasa por
// el punto, perpendicular a la dirección de extensión. La herramienta sigue para la siguiente; Esc o clic derecho la cierran.
let extU = null;
function startExtendU() {
  beginTool('extendU', { label: 'Extender', voidKill: false, cleanup: () => { extU = null; hideSnap(); } });
  extU = { stage: 'pick' };
  toast('Extender: clic cerca del extremo de una curva o del borde de una superficie');
}
function curveEndAt(o, e) {
  const d = o.data, c = N.curveOf(d), a = c.getPoint(0), b = c.getPoint(1);
  const sa = toScreen(new THREE.Vector3(a.x, a.y, a.z)), sb = toScreen(new THREE.Vector3(b.x, b.y, b.z));
  return Math.hypot(sa.x - e.clientX, sa.y - e.clientY) <= Math.hypot(sb.x - e.clientX, sb.y - e.clientY) ? 0 : 1;
}
function toScreen(v) {
  const pn = paneAt(lastPtr.x), r = renderer.domElement.getBoundingClientRect(); useAspect(pn);
  const q = v.clone().project(camera); return { x: r.left + pn.x + ((q.x + 1) / 2) * pn.w, y: r.top + ((1 - q.y) / 2) * pn.h };
}
// alarga la curva por su extremo `end` hasta P con continuidad G1 (tramo de Hermite) y la reajusta con el mismo grado
function extendCurveData(d, end, P) {
  let c = N.curveOf(d);
  const at = (t) => { const q = c.getPoint(t); return new THREE.Vector3(q.x, q.y, q.z); };
  const t0 = end ? 1 : 0, E = at(t0), h = 1e-4, T = at(end ? 1 - h : h).sub(E).multiplyScalar(-1).normalize();
  const L = E.distanceTo(P);
  if (L < 1e-9) return d;
  const nOrig = Math.max(d.cvs.length + 2, 8), nExt = Math.max(3, Math.round(nOrig * 0.4));
  const orig = []; for (let i = 0; i < nOrig; i++) { const u = i / (nOrig - 1); orig.push(at(end ? u : 1 - u)); }   // termina en E
  const D = P.clone().sub(E), T1 = D.clone().normalize();
  const ext = []; for (let k = 1; k <= nExt; k++) { const s = k / nExt, h00 = 2 * s ** 3 - 3 * s ** 2 + 1, h10 = s ** 3 - 2 * s ** 2 + s, h01 = -2 * s ** 3 + 3 * s ** 2, h11 = s ** 3 - s ** 2;
    ext.push(E.clone().multiplyScalar(h00).addScaledVector(T, h10 * L).addScaledVector(P, h01).addScaledVector(T1, h11 * L)); }
  let pts = orig.concat(ext);
  if (!end) pts = pts.reverse();
  const out = N.fitCurve(pts, d.deg, d.plane);
  return { ...out, plane: d.plane };
}
function surfaceExtendTo(o, edge, P) {
  // el borde lejano de la extensión (punto medio) debe llegar al plano de P perpendicular a la dirección de extensión; como con G2/G3 el
  // desplazamiento no es lineal en la distancia, se ajusta con unos pasos de secante
  const cont = toolDef.extendCont ?? 2, S0 = FF.surfEval(o.data), mids = (S) => [[0.5, 0], [0.5, 1], [0, 0.5], [1, 0.5]].map(([u, v]) => S(u, v));
  const m0 = mids(S0);
  // el borde lejano es el OPUESTO en parámetros al borde compartido (no el más distante: en una franja ancha lo serían los laterales)
  const OPP = [1, 0, 3, 2];
  const ends = (dist) => { const m = mids(FF.surfEval(FF.extendData(o.data, edge, dist, cont))); let ni = 0, nd = Infinity;
    m.forEach((q, i) => { for (const r of m0) { const dd = q.distanceTo(r); if (dd < nd) { nd = dd; ni = i; } } });
    return { M: m[ni], F: m[OPP[ni]] }; };
  const e1 = ends(1), t = e1.F.clone().sub(e1.M);
  if (t.length() < 1e-9) return null;
  t.normalize();
  const goal = P.clone().sub(e1.M).dot(t);
  if (goal <= 1e-4) return null;
  const f = (d) => { const e = ends(d); return e.F.clone().sub(e.M).dot(t) - goal; };
  let d0 = 0.5, d1 = 1, f0 = f(d0), f1 = f(d1);
  for (let it = 0; it < 12 && Math.abs(f1) > 1e-7; it++) { const d2 = d1 - f1 * (d1 - d0) / ((f1 - f0) || 1e-12); d0 = d1; f0 = f1; d1 = Math.max(1e-4, d2); f1 = f(d1); }
  return d1;
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!extU || navHeld || e.button === 1 || (e.ctrlKey && e.shiftKey && !e.altKey)) return;
  if (e.button === 2) { e.preventDefault(); e.stopImmediatePropagation(); return endActiveTool('done'); }
  if (extU.stage === 'pick' && (e.ctrlKey || e.altKey)) return;
  e.preventDefault(); e.stopImmediatePropagation(); down = null;
  if (extU.stage === 'pick') {
    const c = lineCandidates(e, 'both', 12, pickable)[0];
    if (!c) return toast('Extender: haz clic cerca del extremo de una curva o del borde de una superficie.');
    if (c.obj.kind === 'curve' && !c.obj.data.cos) extU = { stage: 'target', obj: c.obj, end: curveEndAt(c.obj, e) };
    else if (c.obj.kind === 'surface' && c.edge) extU = { stage: 'target', obj: c.obj, edge: c.edge };
    else return toast('Extender: elige una curva libre o el borde de una superficie.');
    return toast(`Extender ${c.obj.name}: ahora clic en el punto de destino (Alt rejilla · Ctrl punto o CV · Ctrl+Alt curva)`);
  }
  const P = placePoint(e);
  if (!P) return;
  checkpoint();
  const o = extU.obj;
  if (o.kind === 'curve') {
    const rel = relations.find((r) => outputOf(r) === o.id && !constructionOf(r).editable);
    if (rel) relations.splice(relations.indexOf(rel), 1);
    o.data = extendCurveData(o.data, extU.end, P); updateObject(o);
    toast(`${o.name} extendida hasta el punto (${fmtA(P).map((v) => v.toFixed(1)).join(', ')} mm)`);
  } else {
    const dist = surfaceExtendTo(o, extU.edge, P);
    if (!dist) { toast('Ese punto queda por dentro del borde: elige uno hacia fuera.'); return; }
    const r = { type: 'extend', src: o.id, edge: extU.edge, dist, cont: toolDef.extendCont ?? 2 };
    const out = addSurface(FF.extendData(o.data, r.edge, r.dist, r.cont), 'Extensión'); r.out = out.id; addRelation(r);
    toast(`${out.name}: ${o.name} extendida G${r.cont} hasta el plano del punto (${(dist * 100).toFixed(1)} mm)`);
  }
  hideSnap(); extU = { stage: 'pick' };
}, true);
addEventListener('pointermove', (e) => { if (extU?.stage === 'target' && e.target === renderer.domElement) placePoint(e); });
// Proyectar curvas sobre una superficie (curvas sobre superficie con historial: si mueves la curva, la proyección la sigue)
function projectRun() {
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
let trimOp = null;
function trimRun() {
  // la PRIMERA superficie elegida es la que se recorta; las demás superficies y las curvas son los cortes
  const srf = selObjs.find((o) => o.kind === 'surface'), tools = selObjs.filter((o) => o !== srf && (o.kind === 'curve' || o.kind === 'surface'));
  if (!srf || !tools.length) return toast('Trim: elige la superficie y uno o más cortes (curvas cerradas o de borde a borde, u otras superficies) y vuelve a pulsar Trim.');
  checkpoint();
  const proj = toolDef.trimProj || 'view';
  const r = { type: 'trim', surf: srf.id, tools: tools.map((c) => c.id), proj, dir: projDir(proj), keep: toolDef.trimKeep !== false, picks: [] };
  addRelation(r); applyRelation(r);
  if (!stageOf(r)?.loops.length) {
    relations.splice(relations.indexOf(r), 1); setTrimStages(srf, trimStages(srf.data).filter((x) => x.rel !== r.id)); updateObject(srf); renderHistory();
    return toast('Eso no corta la superficie: las curvas tienen que ser cerradas o ir de borde a borde (prueba otra Proyección); una superficie tiene que atravesarla.');
  }
  // para elegir también piezas ya quitadas, los clics se miden contra la superficie entera (no contra la malla recortada)
  const S = N.surfaceOf(srf.data);
  // Esc = cancelar; otra herramienta o clic en el vacío = aceptar lo elegido (sin piezas no se recorta nada)
  beginTool('trim', { label: 'Trim', cleanup: (why) => finishTrim(why !== 'esc'), hit: (e) => { setRay(e); return !!(trimOp && ray.intersectObject(trimOp.full, false)[0]); } });
  trimOp = { rel: r, full: new THREE.Mesh(new ParametricGeometry((u, v, t) => S.getPoint(u, v, t), 48, 48), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })) };
  TW.show(relSpec(r));
  toast(`Trim: ${stageOf(r).loops.length} corte(s). Clic en las piezas que quieres ${r.keep ? 'conservar' : 'quitar'} · clic derecho o Enter = aceptar · Esc = cancelar`);
}
function finishTrim(accept) {
  const op = trimOp;
  if (!op) return;
  trimOp = null; toolDone('trim');
  const r = op.rel, srf = byId(r.surf);
  if (!accept || !r.picks.length) {
    const i = relations.indexOf(r); if (i >= 0) relations.splice(i, 1);
    if (srf) { setTrimStages(srf, trimStages(srf.data).filter((x) => x.rel !== r.id)); updateObject(srf); }
    renderHistory(); TW.hide();
    return toast(accept ? 'Trim sin piezas elegidas: no se recortó nada' : 'Trim cancelado');
  }
  TW.hide(); renderHistory();
  toast(`Trim hecho: ${r.picks.length} pieza(s) ${r.keep ? 'conservada(s)' : 'quitada(s)'}, con historial (mueve una curva de corte y el recorte la sigue)`);
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!trimOp || navHeld || e.button === 1 || (e.ctrlKey && e.shiftKey)) return;
  e.stopImmediatePropagation(); e.preventDefault(); down = null;
  if (e.button === 2) return finishTrim(true);
  setRay(e);
  const hit = ray.intersectObject(trimOp.full, false)[0];
  if (!hit?.uv) return toast('Haz clic sobre la superficie que se recorta.');
  const r = trimOp.rel, rt = stageOf(r);
  if (!rt) return;
  // clic en una pieza ya elegida = soltarla; si no, se añade
  checkpoint();
  const sig = FF.regionSig(rt.loops, hit.uv.x, hit.uv.y), sigOf = (q) => q[2] ?? FF.regionSig(rt.loops, q[0], q[1]), same = r.picks.filter((q) => sigOf(q) === sig);
  r.picks = same.length ? r.picks.filter((q) => !same.includes(q)) : [...r.picks, [hit.uv.x, hit.uv.y, sig]];   // [u, v, firma de la pieza]
  applyRelation(r); TW.render(); renderHistory();
}, true);
addEventListener('keydown', (e) => {
  if (!trimOp || typing(e.target)) return;
  if (e.key === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); finishTrim(true); }
}, true);
// ---------- Untrim (como Alias: Etapas Última | Todas) ----------
// Última = quita el recorte más reciente de la superficie (la última etapa de Trim; si no tiene, el último recorte con curva sobre
// superficie); Todas = la deja entera. Las curvas de corte se quedan (las curvas sobre superficie dejan de recortar).
function untrimSurface(o, all) {
  const st = trimStages(o.data), cosT = objects.filter((c) => c.kind === 'curve' && c.data.cos?.surf === o.id && c.data.cos.trim && c.data.cos.trim !== 'none');
  if (!st.length && !cosT.length) return 0;
  const dropStage = (x) => { const i = x.rel == null ? -1 : relations.findIndex((r) => r.id === x.rel); if (i >= 0) relations.splice(i, 1); };
  const dropCos = (c) => {
    relations.filter((r) => r.type === 'project' && r.out === c.id).forEach((r) => (r.trim = 'none'));
    relations.filter((r) => r.type === 'fcurve' && r.out === c.id).forEach((r) => (r.untrimmed = true));   // si no, el carril se volvía a recortar al recalcularse
    relations.filter((r) => r.autoTrimmed?.includes(c.id)).forEach((r) => (r.autoTrimmed = r.autoTrimmed.filter((x) => x !== c.id)));
    c.data = { ...c.data, cos: { ...c.data.cos, trim: 'none', edge: false } };   // un borde de recorte pasa a ser una curva sobre superficie
    updateObject(c);
  };
  let n = 1;
  if (all) { st.forEach(dropStage); setTrimStages(o, []); cosT.forEach(dropCos); n = st.length + cosT.length; }
  else if (st.length) { dropStage(st[st.length - 1]); setTrimStages(o, st.slice(0, -1)); }
  else dropCos(cosT.reduce((a, b) => (b.id > a.id ? b : a)));
  updateObject(o);
  return n;
}
const untrimActive = () => toolIs('untrim');
function untrimSpec() {
  return { title: 'Untrim', untrim: true,
    hint: () => 'Clic en una superficie recortada = quitarle el recorte · clic derecho o Esc = terminar',
    fields: [{ type: 'seg', label: 'Etapas', opts: [['last', 'Última'], ['all', 'Todas']], get: () => toolDef.untrimStage || 'last', set: (v) => { toolDef.untrimStage = v; saveToolDef(); } },
      { type: 'html', html: () => '<span class="tw-note">Última = quita solo el recorte más reciente (puedes repetir). Todas = la superficie vuelve entera. Las curvas de corte no se borran.</span>' }],
    actions: [{ label: 'Terminar', primary: true, run: () => endActiveTool('done') }] };
}
function doUntrim(srfs) {
  checkpoint();
  const all = toolDef.untrimStage === 'all';
  let n = 0;
  srfs.forEach((o) => (n += untrimSurface(o, all)));
  renderHistory(); refreshOutliner(); scheduleHistoryDiag();
  toast(n ? `Untrim (${all ? 'todas las etapas' : 'última etapa'}): ${n} recorte(s) quitado(s) en ${srfs.map((o) => o.name).join(', ')} (Ctrl+Z deshace)` : `${srfs.map((o) => o.name).join(', ')} no tiene recortes`);
}
function untrimSelection() {
  beginTool('untrim', { label: 'Untrim', cleanup: () => { if (TW.spec?.untrim) TW.hide(); } });
  TW.show(untrimSpec());
  const srfs = selObjs.filter((o) => o.kind === 'surface');
  if (srfs.length) doUntrim(srfs);
  else toast('Untrim: clic en una superficie recortada');
}
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (!untrimActive() || navHeld || e.button === 1 || (e.ctrlKey && e.shiftKey)) return;
  e.stopImmediatePropagation(); e.preventDefault(); down = null;
  if (e.button === 2) return endActiveTool('done');
  setRay(e);
  const hit = ray.intersectObjects(objects.filter((o) => o.kind === 'surface' && o.visible && pickable(o)).map((o) => o.parts.mesh), false)[0];
  if (!hit) return;   // en el vacío: lo atiende el kill switch
  doUntrim([hit.object.userData.obj]);
  TW.render();
}, true);

// ---------- Revert (deshacer una operación sin perder lo demás) ----------
// Borra lo que creó la operación, o devuelve el nodo que modificó a como estaba antes, vuelve a mostrar las superficies que la
// operación ocultó (r.consumed) y quita la relación. Cada construcción puede dar su propio revert(r, salida).
const revertStore = new Map();   // id de la relación → datos del nodo que modifica, tal como estaban ANTES (Align)
function revertConstruction(r) {
  const C = constructionOf(r);
  checkpoint();
  let out = byId(outputOf(r)), msg = 'la operación se quitó';
  if (C.revert) C.revert(r, out);
  else if (C.editsOutput) {
    const b = revertStore.get(r.id);
    if (out && b) { out.data = cloneData({ kind: out.kind, data: b }); msg = `${out.name} vuelve a como estaba antes`; }
    else msg = 'no se guardó la forma de antes: se quita solo el historial';
  } else if (out && !C.editable) { removeObject(out); out = null; msg = 'se borró lo que había creado'; }
  (r.consumed || []).forEach((id) => {
    const s = byId(id);
    if (!s) return;
    s.visible = true; if (r.names?.[id]) s.name = r.names[id];
    applyVisibility(s);
  });
  const i = relations.findIndex((x) => x.id === r.id);
  if (i >= 0) relations.splice(i, 1);
  revertStore.delete(r.id);
  if (out && objects.includes(out)) updateObject(out);
  if (r.consumed?.length) applySelection(r.consumed.map(byId).filter(Boolean), 'replace'); else selectionChanged();
  refreshOutliner(); renderHistory(); TW.hide();
  toast(`Revert ${C.name}: ${msg}${r.consumed?.length ? `; vuelven ${r.consumed.length} superficie(s) de origen` : ''} (Ctrl+Z deshace)`);
}
const projDir = (mode) => (mode === 'y' ? [0, -1, 0] : mode === 'normal' ? null : camera.getWorldDirection(new THREE.Vector3()).toArray());
function offsetRun() {
  const src = selObjs.filter((o) => o.kind === 'surface');
  if (!src.length) return toast('Offset: elige una o más superficies y vuelve a pulsar Offset.');
  checkpoint();
  const made = src.map((s) => { const r = { type: 'offset', src: s.id, dist: toolDef.offsetDist }; const o = addSurface(HX.offsetData(s.data, r.dist), 'Offset'); r.out = o.id; addRelation(r); return o; });
  finishCreate(made, `Offset a ${toolDef.offsetDist.toFixed(2)} dm, con historial`);
}
function mirrorRun() {
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
// Revolución: se crea al momento con la vuelta completa (360°). Pulsar y arrastrar en la vista = el fin del barrido sigue al ratón
// alrededor del eje (Alt: de 15 en 15°); soltar = se queda; clic derecho o Esc = aceptar y cerrar. Los números exactos, en la ventana.
// Sentido antihorario visto desde la punta del eje (regla de la mano derecha, como Alias).
// Eje (como la ventana Revolve de Alias): X · Y · Z por el origen (ejes de Alias, Z arriba) · Z por el pivote de la curva ·
// Elegido (una línea, curva o borde: va de su inicio a su fin y lo sigue con historial) · Manip (base y punta que se arrastran
// con snap; 'vector' = el eje antiguo de 2 clics). Barrido: de r.a0 (inicio) a r.a0 + r.angle (fin), en grados.
const AXIS_IDX = { x: 0, y: 1, z: 2, world: 2 };
function pickedAxisPts(r) {
  const o = byId(r.axisObj);
  if (!o) return null;
  let a, b;
  if (r.axisEdge && o.kind === 'surface') {
    const S = FF.surfEval(o.data), uv = (t) => (r.axisEdge[0] === 'u' ? [+r.axisEdge[1], t] : [t, +r.axisEdge[1]]);
    a = S(...uv(0)); b = S(...uv(1));
  } else if (o.kind === 'curve') { const c = N.curveOf(o.data); a = c.getPoint(0); b = c.getPoint(1); }
  return a && b && a.distanceTo(b) > 1e-6 ? [a, b] : null;
}
function revAxis(r, src) {
  const m = r.axisMode || 'world';
  if (m in AXIS_IDX) return { origin: new THREE.Vector3(), axis: AXES[AXIS_IDX[m]].clone() };
  if (m === 'pivot' && src?.pivot) return { origin: src.pivot.clone(), axis: AXES[2].clone() };
  if (m === 'picked') { const L = pickedAxisPts(r); if (L) return { origin: L[0], axis: L[1].clone().sub(L[0]) }; }
  if (m === 'manip' && r.origin && r.tip) { const O = new THREE.Vector3(...r.origin), d = new THREE.Vector3(...r.tip).sub(O); if (d.lengthSq() > 1e-10) return { origin: O, axis: d }; }
  if (m === 'vector' && r.origin && r.axis) return { origin: new THREE.Vector3(...r.origin), axis: new THREE.Vector3(...r.axis) };
  return { origin: new THREE.Vector3(), axis: AXES[2].clone() };
}
function revOpts(r, src) {
  return { angle: r.angle ?? 360, start: r.a0 || 0, pitch: r.pitch || 0, rational: r.rational !== false, deg: r.deg || 3, spans: r.spans || 8, ...revAxis(r, src) };
}
// eje y CV del perfil más alejado del eje (para la flecha del ángulo y el arrastre)
function revFrame(r) {
  const src = byId(r.src); if (!src) return null;
  const o = revOpts(r, src), O = o.origin || new THREE.Vector3(), D = (o.axis || AXES[2]).clone().normalize();
  let best = null;
  for (const p of src.data.cvs) {
    const v = new THREE.Vector3(p.x, p.y, p.z), foot = O.clone().addScaledVector(D, v.clone().sub(O).dot(D)), rv = v.clone().sub(foot);
    if (!best || rv.length() > best.r) best = { foot, r: rv.length(), e1: rv.clone().normalize() };
  }
  if (!best || best.r < 1e-6) return null;
  best.e2 = D.clone().cross(best.e1); best.D = D; best.o = o;   // antihorario alrededor del eje (como nurbs.revolve)
  return best;
}
let revolveDrag = null, revAxisPick = null;
function revolveRun() {
  const cs = selCurves();
  if (!cs.length) return toast('Revolución: elige una curva de perfil (mejor dibujada de frente) y vuelve a pulsar Revolución.');
  checkpoint();
  const rels = cs.map((c) => {
    const r = { type: 'revolve', src: c.id, angle: 360, pitch: toolDef.revPitch || 0, rational: toolDef.revRational !== false, deg: toolDef.revDeg || 3, spans: toolDef.revSpans || 8, axisMode: toolDef.revAxis || 'world' };
    const o = addSurface(N.revolve(c.data, revOpts(r, c)), 'Revolución'); r.out = o.id; addRelation(r); return r;
  });
  revolveDrag = { rels, dragging: false };
  beginTool('revolve', { label: 'Revolución', cleanup: () => commitRevolve(true) });
  TW.show(relSpec(rels[0], rels));
  toast('Revolución de 360° · arrastra en la vista para cambiar el fin (Alt: de 15 en 15°) o escribe los grados en la ventana · clic derecho o Esc: aceptar');
}
function setRevolve(rels, k, v) { rels.forEach((r) => { r[k] = v; applyRelation(r); }); if (TW.spec?.rel === rels[0]) TW.render(); }
function commitRevolve(close) {
  const g = revolveDrag?.rels || (TW.spec?.rel?.type === 'revolve' ? [TW.spec.rel] : null);
  revolveDrag = null; revAxisPick = null; toolDone('revolve'); toolDone('revaxis');
  if (!g) return;
  toolDef.revAngle = g[0].angle; saveToolDef();
  finishCreate(g.map((x) => byId(x.out)).filter(Boolean), `Revolución de ${Math.round(g[0].angle)}° aceptada, con historial`);
  if (close) TW.hide(); else TW.show(relSpec(g[0], g));
}
addEventListener('pointermove', (e) => {
  if (!revolveDrag?.dragging) return;
  const r = revolveDrag.rels[0], F = revFrame(r);
  if (!F) return;
  setRay(e);
  const q = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(F.D, F.foot), new THREE.Vector3());
  if (!q) return;
  const v = q.sub(F.foot);
  // ángulo medido desde el inicio del barrido (r.a0)
  let a = THREE.MathUtils.radToDeg(Math.atan2(v.dot(F.e2), v.dot(F.e1))) - (r.a0 || 0);
  a = ((a % 360) + 360) % 360;
  if (a <= 0) a += 360;
  if (e.altKey || snapToggles.grid) a = Math.max(15, Math.round(a / 15) * 15);
  setRevolve(revolveDrag.rels, 'angle', Math.round(a * 10) / 10);
});
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (revAxisPick) {
    if (e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    down = null;   // este clic solo elige el eje: no selecciona la línea (si no, la ventana de la revolución se cerraría)
    // Eje elegido (Picked): la línea, curva o borde más cercano al clic; el eje va de su inicio a su fin y la sigue con historial
    const rels = revAxisPick.rels, srcIds = new Set(rels.map((r) => r.src));
    const c = lineCandidates(e, 'both', 12, (o) => !srcIds.has(o.id))[0];
    if (!c) return toast('Eje elegido: haz clic cerca de una línea, curva o borde (no del perfil).');
    revAxisPick = null; toolDone('revaxis');
    checkpoint();
    rels.forEach((r) => { r.axisMode = 'picked'; r.axisObj = c.obj.id; r.axisEdge = c.edge || null; applyRelation(r); });
    if (!pickedAxisPts(rels[0])) toast('Esa curva empieza y acaba en el mismo punto: no sirve de eje.');
    else toast(`Eje = ${c.obj.name}${c.edge ? ' · ' + EDGE_NAMES[c.edge] : ''}. Si lo mueves, la revolución lo sigue.`);
    TW.show(relSpec(rels[0], rels)); renderHistory();
    return;
  }
  if (!revolveDrag || navHeld) return;
  e.stopImmediatePropagation(); e.preventDefault(); down = null;
  if (e.button === 2) commitRevolve(true);
  else if (e.button === 0) { checkpoint(); revolveDrag.dragging = true; }   // pulsar y arrastrar = el fin sigue al ratón
}, true);
addEventListener('pointerup', () => { if (revolveDrag?.dragging) { revolveDrag.dragging = false; TW.render(); } });
// clic derecho con la ventana de una Revolución abierta = aceptar y cerrar (como Plasticity)
renderer.domElement.addEventListener('pointerdown', (e) => {
  if (e.button !== 2 || revolveDrag || revAxisPick || navHeld || (e.ctrlKey && e.shiftKey)) return;
  if (TW.spec?.rel?.fg) { e.stopImmediatePropagation(); e.preventDefault(); TW.hide(); if (edgeOp?.type === 'gfillet') setTool('select'); toast('Redondeo aceptado'); return; }
  if (TW.spec?.rel?.type !== 'revolve') return;
  e.stopImmediatePropagation(); e.preventDefault(); commitRevolve(true);
}, true);
function loftRun() {
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
function extrudeRun() {
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
  beginTool('extrude', { label: 'Extruir', voidKill: false, cleanup: () => cancelExtrudeDrag(true) });
  TW.show(relSpec(rels[0], rels));
  toast('Mueve el ratón arriba / abajo para extruir · clic para terminar · Esc: también termina');
}
function setExtrudeDist(rels, d) { rels.forEach((r) => { r.dist = d; applyRelation(r); }); }
function cancelExtrudeDrag(keep) { if (!extrudeDrag) return; const r = extrudeDrag.rels; extrudeDrag = null; toolDone('extrude'); if (keep) { finishCreate(r.map((x) => byId(x.out)).filter(Boolean), 'Extrusión terminada (cambia la distancia en su ventana)'); TW.show(relSpec(r[0], r)); } }
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

// --- Ventana de opciones de una relación ya creada (al elegir su resultado se abre para modificarla) ---
function relSpec(r, group = [r]) {
  if (r.fg) return gfilletSpec(relations.find((x) => x.fg === r.fg && x.type === 'blend') || r);
  const apply = () => { group.forEach((x) => { x.pending = false; if (applyRelation(x)) { const out = byId(outputOf(x)); if (out) propagateFrom(out); } }); scheduleHistoryDiag(); renderHistory(); };
  // "Auto Update" de Alias: apagado, los cambios esperan al botón Actualizar
  const redo = () => { if (r.auto === false) { group.forEach((x) => (x.pending = true)); TW.render(); return; } apply(); };
  const set = (k, v) => { checkpoint(); group.forEach((x) => (x[k] = v)); redo(); };
  const live = (k) => (v) => { group.forEach((x) => (x[k] = v)); redo(); };
  const nm = (id) => byId(id)?.name || '¿?';
  const fields = [], C = constructionOf(r);
  const title = C.name + C.panel(r, { group, fields, set, live, redo, apply, nm });
  if (C.diagnose && toolDef.contCheck !== false) fields.push({ type: 'html', html: () => relDiag(r), diagOf: r.id });
  fields.push({ type: 'check', label: 'Actualizar al momento', get: () => r.auto !== false, set: (v) => { group.forEach((x) => (x.auto = v)); if (v && r.pending) apply(); } });
  const actions = [{ label: 'Revert', run: () => { const g = group.slice(); g.forEach(revertConstruction); } },
    { label: 'Quitar historial', run: () => removeRelation(r.id) }, { label: 'Cerrar', primary: true, run: () => TW.hide() }];
  if (r.auto === false) actions.splice(1, 0, { label: r.pending ? 'Actualizar •' : 'Actualizar', primary: !!r.pending, run: () => { apply(); TW.render(); } });
  if (C.retool) {
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
const ARROW_COLORS = { t: '#2f7bff', s: '#ff9a1f', g: '#a46bff', d: '#2fb36b', f: '#ff5fb0', m: '#ffd400', a: '#14b8c8' };
function makeArrow(color) {
  const g = new THREE.Group(), m = new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true });
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.8, 8), m); shaft.position.y = 0.4;
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.17, 12), m); head.position.y = 0.885;
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.04, 12, 8), m);
  const pick = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 1.1, 8), new THREE.MeshBasicMaterial({ visible: false })); pick.position.y = 0.5;
  [shaft, head, ball].forEach((x) => { x.renderOrder = 41; });
  g.add(shaft, head, ball, pick);
  g.userData.pick = pick;
  return g;
}
const mid = (arr) => arr[Math.floor(arr.length / 2)];
const v3 = (q) => new THREE.Vector3(q.x, q.y, q.z);
// puntos de construcción de la receta abierta (ver defineConstruction): { role, kind, pos, dir, label, start, drag | click, attach }
function relHandles(r) {
  const out = byId(outputOf(r)), C = constructionOf(r);
  if (!out || (out.kind !== 'surface' && !(C.curvePoints && out.kind === 'curve'))) return [];
  return C.points(r, out);
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
// letras P (posición), T (tangente), C (curvatura) en la costura de un Align: verde = dentro de la tolerancia, rojo = no
function alignLetters(r) {
  const out = byId(r.slave), m = byId(r.master);
  if (!out || !m) return null;
  let d, at;
  try {
    d = alignDiag(r);
    if (r.curve) { const c = out.data.cvs; at = v3(c[r.sEnd ? c.length - 1 : 0]); } else at = v3(mid(HX.row(out.data, r.sEdge, 0)));
  } catch (e) { return null; }
  if (!d) return null;
  const L = (ok, k, v) => `<b style="color:${ok ? '#2fb36b' : '#e5484d'}">${k}</b> ${v}`;
  const parts = [L(d.gap < 1e-3, 'P', d.gap.toFixed(4) + ' dm')];
  if (r.cont >= 1) parts.push(L(d.angle < 0.1, 'T', d.angle.toFixed(2) + '°'));
  if (r.cont >= 2) parts.push(d.curv == null ? '<b>C</b> –' : L(d.curv < 0.05, 'C', (d.curv * 100).toFixed(1) + ' %'));
  return [at, '', parts.join(' · ')];
}
function updateRelLabels() {
  const r = arrowsFor, C = r && constructionOf(r);
  let L = [];
  try { L = C?.labels ? C.labels(r) : []; } catch (e) { L = []; }
  relLabelPts = L.map((x) => [x.pos]);
  relLabelBox.innerHTML = L.map((x) => `<span class="rel-label">${x.html}</span>`).join('');
}
// ---------- Locators de medición (distancia mínima / máxima entre curvas y superficies) ----------
// Cada locator queda ANCLADO a sus dos objetos (por id) y se recalcula solo cuando la escena cambia (sceneChangedAt): línea entre los dos
// puntos + etiqueta en mm. Mínima = el par de puntos más cercano (muestreo + refinado local de los parámetros). Máxima = la mayor separación
// de A respecto de B (para cada punto de A su distancia a B; la mayor de ellas, como la desviación de Alias).
const locators = [];
let locStamp = -1;
const locGroup = new THREE.Group(); locGroup.renderOrder = 30; scene.add(locGroup);
const locBox = document.createElement('div'); locBox.className = 'rel-labels loc-labels'; document.body.append(locBox);
const locMat = new THREE.LineBasicMaterial({ color: 0x4fd1c5, depthTest: false, transparent: true });
function locEval(o) {   // parámetros → punto; dominio 1D (curva) o 2D (superficie)
  if (o.kind === 'curve') { const c = N.curveOf(o.data), t = new THREE.Vector3(); return { dim: 1, at: (a) => { const q = c.getPoint(Math.min(1, Math.max(0, a[0]))); return t.set(q.x, q.y, q.z).clone(); } }; }
  const S = FF.surfEval(o.data), rm = o.removed;
  return { dim: 2, at: (a) => S(Math.min(1, Math.max(0, a[0])), Math.min(1, Math.max(0, a[1]))), keep: (a) => !rm || !rm(a[0], a[1]) };
}
function locSamples(E, n1 = 160, n2 = 34) {
  const out = [];
  if (E.dim === 1) for (let i = 0; i <= n1; i++) out.push([i / n1]);
  else for (let i = 0; i <= n2; i++) for (let j = 0; j <= n2; j++) { const a = [i / n2, j / n2]; if (!E.keep || E.keep(a)) out.push(a); }
  return out.map((a) => ({ a, p: E.at(a) }));
}
function locRefine(EA, EB, a, b) {   // búsqueda local de patrón sobre los parámetros de los dos (minimiza la distancia)
  let d = EA.at(a).distanceTo(EB.at(b)), h = 0.02;
  const ok = (E, x) => !E.keep || E.keep(x);
  for (let it = 0; it < 60 && h > 1e-7; it++) {
    let moved = false;
    for (const [E, v] of [[EA, a], [EB, b]]) for (let k = 0; k < E.dim; k++) for (const sg of [-1, 1]) {
      const x = v.slice(); x[k] = Math.min(1, Math.max(0, x[k] + sg * h));
      if (!ok(E, x)) continue;
      const dd = (E === EA ? E.at(x).distanceTo(EB.at(b)) : EA.at(a).distanceTo(E.at(x)));
      if (dd < d - 1e-12) { d = dd; v.splice(0, v.length, ...x); moved = true; }
    }
    if (!moved) h /= 2;
  }
  return { d, pa: EA.at(a), pb: EB.at(b) };
}
function measureLocator(L) {
  const A = byId(L.a), B = byId(L.b);
  if (!A || !B) return null;
  const EA = locEval(A), EB = locEval(B), SA = locSamples(EA), SB = locSamples(EB);
  const nearest = (p) => { let bd = Infinity, bi = null; for (const s of SB) { const d = p.distanceToSquared(s.p); if (d < bd) { bd = d; bi = s; } } return { d: Math.sqrt(bd), s: bi }; };
  if (L.mode === 'max') {
    let best = null;
    for (const s of SA) { const n = nearest(s.p); if (!best || n.d > best.d) best = { d: n.d, s, n: n.s }; }
    const r = locRefine({ ...EA, at: () => best.s.p, dim: 0 }, EB, [], best.n.a.slice());   // distancia de ese punto de A a B, afinada en B
    return { d: r.d, pa: best.s.p, pb: r.pb };
  }
  let best = null;
  for (const s of SA) { const n = nearest(s.p); if (!best || n.d < best.d) best = { d: n.d, s, n: n.s }; }
  return locRefine(EA, EB, best.s.a.slice(), best.n.a.slice());
}
function addLocator(mode) {
  const v = selObjs.filter((o) => o.kind === 'curve' || o.kind === 'surface');
  if (v.length !== 2) return toast('Locator: elige 2 objetos (curvas o superficies).');
  locators.push({ id: Date.now() + Math.random(), mode, a: v[0].id, b: v[1].id });
  locStamp = -1; updateLocators();
  const L = locators[locators.length - 1];
  toast(`Locator de distancia ${mode === 'max' ? 'MÁXIMA' : 'MÍNIMA'}: ${v[0].name} ↔ ${v[1].name} = ${L.r ? (L.r.d * 100).toFixed(2) + ' mm' : '—'} (se actualiza solo)`);
}
function deleteLocators() { const n = locators.length; locators.length = 0; locStamp = -1; updateLocators(); toast(n ? `${n} locator(es) borrado(s)` : 'No hay locators'); }
function updateLocators() {
  if (locStamp !== sceneChangedAt) {
    locStamp = sceneChangedAt;
    for (let i = locators.length - 1; i >= 0; i--) if (!byId(locators[i].a) || !byId(locators[i].b)) locators.splice(i, 1);
    locGroup.clear();
    locBox.innerHTML = '';
    for (const L of locators) {
      L.r = measureLocator(L);
      if (!L.r) continue;
      const g = new THREE.BufferGeometry().setFromPoints([L.r.pa, L.r.pb]), ln = new THREE.Line(g, locMat);
      const dot = (p) => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), new THREE.MeshBasicMaterial({ color: 0x4fd1c5, depthTest: false })); m.position.copy(p); m.renderOrder = 31; m.userData.locDot = true; return m; };
      ln.renderOrder = 30; locGroup.add(ln, dot(L.r.pa), dot(L.r.pb));
      const el = document.createElement('span'); el.className = 'rel-label loc-label';
      el.textContent = `${L.mode === 'max' ? 'máx' : 'mín'} ${(L.r.d * 100).toFixed(2)} mm`;
      locBox.append(el);
    }
  }
  locBox.hidden = !locators.length || !!carousel || layout === 'render' || layout === 'ai';
  if (locBox.hidden) return;
  const pn = panes().find((p) => p.kind !== 'render') || panes()[0], rc = renderer.domElement.getBoundingClientRect();
  useAspect(pn);
  locGroup.children.forEach((m) => { if (m.userData.locDot) m.scale.setScalar(pxWorld(m.position, 3.5)); });
  locators.filter((L) => L.r).forEach((L, i) => {
    const el = locBox.children[i]; if (!el) return;
    const q = L.r.pa.clone().add(L.r.pb).multiplyScalar(0.5).project(camera);
    el.style.display = q.z < 1 ? '' : 'none';
    el.style.left = rc.left + pn.x + ((q.x + 1) / 2) * pn.w + 'px';
    el.style.top = rc.top + ((1 - q.y) / 2) * pn.h + 'px';
  });
}
// ---------- Invertir normales: invierte la dirección U (la cara de fuera pasa a ser la de dentro) ----------
// Los recortes (etapas de Trim y curvas sobre la superficie) se pasan a la nueva U = 1 − u para que sigan en su sitio.
function flipNormalsRun() {
  const v = selObjs.filter((o) => o.kind === 'surface');
  if (!v.length) return toast('Invertir normales: elige una o más superficies.');
  checkpoint();
  const fu = (q) => [1 - q[0], q[1], ...q.slice(2)];
  for (const o of v) {
    const d = o.data, nd = { ...d, cvs: d.cvs.slice().reverse(), knotsU: d.knotsU.map((k) => 1 - k).reverse() };
    const st = trimStages(d);
    if (st.length) { nd.rtrims = st.map((x) => ({ ...cloneStage(x), loops: x.loops.map((l) => l.map(fu)), picks: x.picks.map((p) => [1 - p[0], p[1]]) })); delete nd.rtrim; }
    o.data = nd;
    objects.filter((c) => c.kind === 'curve' && c.data.cos?.surf === o.id).forEach((c) => { c.data = { ...c.data, cos: { ...c.data.cos, uv: c.data.cos.uv.map(fu) } }; });
    o.flipped = !o.flipped;
    updateObject(o);
    objects.filter((c) => c.kind === 'curve' && c.data.cos?.surf === o.id).forEach(updateObject);
  }
  toast(`Normales invertidas en ${v.map((o) => o.name).join(', ')}`);
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
  for (const a of relArrows.children) a.scale.setScalar(camera.position.distanceTo(a.position) * 0.04);
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
  if (h.click) {   // flecha de un solo clic (invertir dirección)
    h.click();
    if (applyRelation(arrowsFor)) { const out = byId(outputOf(arrowsFor)); if (out) propagateFrom(out); }
    updateRelArrows(); TW.render(); renderHistory(); scheduleHistoryDiag();
    return;
  }
  arrowDrag = { h, s0: h.start ? h.start() : null, x: e.clientX, y: e.clientY, pos: h.pos.clone(), dir: h.dir.clone(), pane: paneAt(e.clientX) };
  renderer.domElement.setPointerCapture(e.pointerId);
}, true);
addEventListener('pointermove', (e) => {
  const g = arrowDrag;
  if (!g) return;
  const r = renderer.domElement.getBoundingClientRect();
  useAspect(g.pane);
  if (g.h.move) {
    // punto libre (extremo del eje de una revolución): snap a punto (Ctrl) / curva (Ctrl+Alt) o, sin snap, en el plano de la pantalla
    const sn = findSnap(e.clientX, e.clientY, snapModes(e), {});
    let p = sn?.point;
    if (sn) showSnap(sn);
    else { hideSnap(); setRay(e); p = ray.ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(viewDir(), g.pos), new THREE.Vector3()); }
    if (!p) return;
    g.h.move(p);
    if (applyRelation(arrowsFor)) { const out = byId(outputOf(arrowsFor)); if (out) propagateFrom(out); }
    updateRelArrows();
    return;
  }
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
  if (arrowDrag.h.move) hideSnap();
  arrowDrag = null;
  TW.render(); renderHistory(); scheduleHistoryDiag();
});
// --- Aviso de Alias: transformar algo que SALE de una operación con historial rompe el historial ---
// (mover sus entradas sí está bien: el resultado las sigue). Se pregunta antes de empezar a moverlo.
function historyBlockers() {
  if (!relations.length) return [];
  const outs = new Set(relations.filter((r) => !constructionOf(r).editable).map(outputOf));
  // como en Alias: tocar a mano lo que sale de una operación (también las filas atadas de un Align) rompe el historial, con aviso
  const objs = pickMode === 'cv'
    ? [...new Set([...selCVs.values()].map((r) => r.obj))].filter((o) => outs.has(o.id))
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
  if (tool !== 'select' || extrudeDrag || awaitSel) return;
  const o = selObjs.length === 1 && pickMode === 'object' ? selObjs[0] : null;
  const r = o && relations.find((x) => outputOf(x) === o.id);
  if (r) { if (TW.spec?.rel !== r) TW.show(relSpec(r)); }
  else if (TW.spec?.rel) TW.hide();
}

// --- Panel "Historial de construcción" ---
function relDiag(r) {
  const out = byId(outputOf(r)), ins = inputsOf(r).map(byId), C = constructionOf(r);
  if (!C.diagnose || !out || ins.some((o) => !o) || (out.kind !== 'surface' && !(C.curvePoints && r.curve))) return '';
  const fmtD = (d, cont) => {
    const ok = (c) => `<b class="${c ? 'ok' : 'bad'}">${c ? '✓' : '✗'}</b>`;
    return `${ok(d.gap < 1e-3)} hueco ${d.gap.toFixed(4)} dm · ${cont >= 1 ? ok(d.angle < 0.1) : ''} ángulo ${d.angle.toFixed(2)}° · ${d.curv == null ? 'curvatura –' : `${cont >= 2 ? ok(d.curv < 0.05) : ''} curvatura ${(d.curv * 100).toFixed(1)}%`}`;
  };
  try { return C.diagnose(r, ins, out, fmtD); } catch (e) { return ''; }
}
let histDiagT = 0;
function scheduleHistoryDiag() {
  clearTimeout(histDiagT);
  histDiagT = setTimeout(() => { document.querySelectorAll('[data-diag-of]').forEach((el) => { const r = relations.find((x) => x.id === +el.dataset.diagOf); if (r) el.innerHTML = relDiag(r); }); if (arrowsFor && constructionOf(arrowsFor).labels) updateRelLabels(); }, 250);
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
    const C = constructionOf(r), title = C.summary(r, nm);
    return `<div class="hist-rel" data-rel="${r.id}"><div class="hist-h"><b>${C.name}</b><span>${title}</span>
      <button class="mini" data-edit title="Abrir sus opciones">⋯</button><button class="mini" data-del title="Quitar historial (la forma se queda)">×</button></div>
      ${C.diagnose ? `<p class="hist-diag" data-diag-of="${r.id}">${relDiag(r)}</p>` : ''}</div>`;
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
  const d = AXES.map((a) => a.dot(v)), a = d.map(Math.abs), i = a.indexOf(Math.max(...a));
  return AXES[i].clone().multiplyScalar(Math.sign(d[i]) || 1);
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
const CUBE_PX = 92, CUBE_TOP = 58, CUBE_RIGHT = 112;   // la columna de herramientas de la derecha cabe y queda fuera de la franja que abre el panel (56 px)
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
// las herramientas de selección y transformación viven a los lados del cubo de vistas
const cubeTools = $('cube-tools');
['t-select', 't-move', 't-rotate', 't-scale'].forEach((id) => $('ct-left').append($(id)));
['t-pivot', 't-frame', 't-top'].forEach((id) => $('ct-right').append($(id)));
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
  const n = viewName() + (backend.hybrid ? ' · MOTOR WEBGPU' : ''), el = $('vi-proj');
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
  // herramientas a los lados del cubo
  cubeTools.hidden = projBtn.hidden;
  if (p && !projBtn.hidden) {
    const c = cubeRect(p), L = $('ct-left'), R = $('ct-right');
    L.style.left = c.x - 40 + 'px'; L.style.top = c.y + 'px';
    R.style.left = c.x + c.s + 6 + 'px'; R.style.top = c.y + 'px';
  }
}
if (prefs.ortho) { proj.keep = true; setProjection(true); }

// ---------- Dibujo de cada cuadro ----------
function renderPane(p) {
  renderer.setViewport(p.x, 0, p.w, p.h);
  renderer.setScissor(p.x, 0, p.w, p.h);
  useAspect(p);
  if (p.kind === 'forge') return renderForgePane(p);
  const real = p.kind === 'diag' && !!prefs.shadeReal;   // Modelado con sombreado realista (materiales PBR + entorno de render)
  const diag = p.kind !== 'render' && !real;        // MODELADO e IA usan los Map Types (shaders de diagnóstico)
  const dm = diagMaterial(), wire = diag && diagMode === 'wire';
  if (wire) { const c = theme === 'dark' ? 0xe8e8e8 : 0x1b1d21; wireLineMat.color.setHex(c); wireFeatMat.color.setHex(c); }
  faceEdgeMat.color.setHex(diag && diagMode === 'clay' ? 0x08090b : theme === 'dark' ? 0xe6eaf2 : 0x14161a);   // aristas: oscuras sobre arcilla, claras u oscuras según el tema
  if (fil?.preview) fil.preview.material = diag && !wire ? dm : materials[fil.items[0].mat];
  objects.forEach((o) => {
    if (o.kind === 'curve') return;
    setSurfaceMaterial(o, diag, dm, wire);
    if (o.kind === 'surface' && o.parts.bound && !wire) {
      const show = ((diag && diagMode === 'clay' && prefs.edges !== false) || prefs.showEdges === true) && o.visible && !modelClean && prefs.showFaces !== false;
      o.parts.bound.visible = show;
      if (show) { const L = layerById(o.layer); o.parts.bound.material = selObjs.includes(o) ? isoSelMat : layerStyled(L) ? layerMats(L).bound : faceEdgeMat; }
    }
    if (o.parts.mesh.castShadow === wire) { o.parts.mesh.castShadow = !wire; renderer.shadowMap.needsUpdate = true; }   // el wireframe no da sombra
    if (o.kind === 'mesh') meshFeatures(o, wire);
  });
  syncGhosts();
  scene.background = p.kind === 'render' && envBg && !backend.hybrid ? scene.environment : null;   // en híbrido el fondo es el muro (el lienzo de abajo no se tapa)
  renderer.toneMapping = diag ? THREE.ACESFilmicToneMapping : TONES[toneKey];
  scene.environment = diag ? envTexture('studio', 0) : envTexture(envKey, envLib.rotApplied);
  camera.layers.set(0);
  if (p.kind !== 'render') camera.layers.enable(DIAG);   // en Modelado las líneas de diagnóstico siguen aunque el sombreado sea realista
  renderer.render(scene, camera);
  if (!carousel && prefs.ao !== false && !window.__forjaNoAO && (diag ? AO_MODES.has(diagMode) : backend.hybrid && prefs.aoVisu !== false)) {
    // la oclusión se calcula cuando la vista está quieta (y se reutiliza mientras no cambie la cámara ni la escena)
    const e = camera.matrixWorld.elements, pe = camera.projectionMatrix.elements;
    const key = `${p.w}x${p.h}|${e[12].toFixed(4)},${e[13].toFixed(4)},${e[14].toFixed(4)},${e[0].toFixed(4)},${e[1].toFixed(4)},${e[2].toFixed(4)},${e[4].toFixed(4)},${e[5].toFixed(4)},${e[6].toFixed(4)}|${pe[0].toFixed(4)},${pe[5].toFixed(4)}|${sceneChangedAt}|${proj.ortho}`;
    ao.intensity = (prefs.aoInt ?? 2.1) * (diag && diagMode === 'clay' ? 1.55 : 1);   // arcilla: oclusión más profunda para leer los volúmenes
    if (key !== aoLastKey) { aoLastKey = key; aoMovedAt = performance.now(); }
    ao.apply(p.w, p.h, key, performance.now() - aoMovedAt < 140 || !!gizmoDrag || !!navDrag, backend.hybrid && !!(diag ? gpuDiag() : true));
  }
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
  if (ALIAS_MAP_OF[diagMode]) { mapTypeMat.uniforms.uMap.value = aliasTex[diagMode] || null; return mapTypeMat; }
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
  const txt = xform === 'scale' ? (scaleNP ? 'ESCALAR NO PROP. <i>izq</i> X · <i>medio</i> Y · <i>der</i> Z' : 'ESCALAR <i>cualquier botón</i> proporcional')
    : xform === 'translate' && orthoLocked() ? 'MOVER 2D <i>izq</i> libre · <i>medio</i> H · <i>der</i> V'
    : `${xform === 'rotate' ? 'ROTAR' : 'MOVER'} <i>izq</i> X · <i>medio</i> Y · <i>der</i> Z`;
  if (xfPrompt.dataset.t !== txt) { xfPrompt.innerHTML = txt; xfPrompt.dataset.t = txt; }
  xfPrompt.style.transform = `translate(${lastPtr.x + 18}px, ${lastPtr.y + 20}px)`;
}
// Color del texto de los menús según lo que tiene detrás: se leen los píxeles de la vista bajo cada rótulo
// (donde no hay objeto se ve el muro) y el texto pasa entero a negro o a blanco.
let inkT = 0;
const INK_SEL = '.cube-probe:not([hidden]), .proj-btn, .app .panel .sec > *, .app .panel .panel-head, .app[data-layout-now="forge"] .panel .bf-ui details.grp > summary, .app[data-layout-now="forge"] .panel .bf-ui .grp-body > *, .app[data-layout-now="forge"] .bf-hud .chip:not([hidden]), .app[data-layout-now="forge"] .bf-loader:not([hidden]), #layers-win:not([hidden]) .fw-head, #layers-win:not([hidden]) .ly-head, #layers-win:not([hidden]) .ly-item, #layers-win:not([hidden]) .ol-item, #layers-win:not([hidden]) .fw-body > p, .puck:not([hidden]) .puck-item span, #rel-labels:not([hidden]) .rel-label, .top .brand, .top .light-switch, .cube-tools .ct-col button, .top .mb-btn, .top .seg button, .top .tag, .top .file, .pane-head .pane-title, .status > span, .status .viewinfo > span, .mb-drop:not([hidden]) .mb-item, .mb-drop:not([hidden]) .mb-title';
function adaptInk(now) {
  if (now - inkT < 400) return;
  inkT = now;
  const cv = renderer.domElement, r = cv.getBoundingClientRect(), k = cv.width / Math.max(1, r.width);
  const bgL = theme === 'light' ? 0.86 : 0.1;
  for (const el of document.querySelectorAll(INK_SEL)) {
    const b = el.getBoundingClientRect();
    if (!b.width || !b.height) continue;
    const x0 = Math.max(0, Math.floor((b.left - r.left) * k)), x1 = Math.min(cv.width, Math.ceil((b.right - r.left) * k));
    let sum = 0, n = 0;
    for (const f of [0.35, 0.65]) {
      const y = Math.floor(cv.height - (b.top + b.height * f - r.top) * k);
      if (x1 <= x0 || y < 0 || y >= cv.height) continue;
      const buf = backend.readRow(x0, y, x1 - x0);
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
const filOpts = () => ({ r: Math.abs(fil.dist), kind: fil.dist < 0 ? 'chamfer' : 'fillet', chordal: fil.dist > 0 && !!toolDef.filChordal });
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
  // Esc = cancelar; otra herramienta o clic en el vacío = aceptar (si hay resultado)
  beginTool('fillet', { label: 'Redondear', cleanup: (why) => { if (why !== 'esc' && fil?.sel.length) endFillet(true); if (fil) endFillet(false); }, hit: (e) => filEdgeAt(e).i >= 0 });
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
    fil.items.forEach((o) => { o.parts.mesh.visible = false; o.parts.iso.visible = false; if (o.parts.bound) o.parts.bound.visible = false; if (o.parts.tedge) o.parts.tedge.visible = false; });
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
      { type: 'seg', label: 'Medida', opts: [['radius', 'Radio constante'], ['chord', 'Cuerda (chordal)']], show: () => (fil?.dist ?? 1) > 0,
        get: () => (toolDef.filChordal ? 'chord' : 'radius'), set: (v) => { toolDef.filChordal = v === 'chord'; saveToolDef(); filRefresh(); filPreview(true); } },
      { type: 'html', html: () => '<span class="tw-note">Continuidad del redondeo: G1 (arco circular). G2/G3 y "Form factor" no los hace el núcleo OpenCascade; para G2 usa Freeform Blend entre los bordes. Las superficies base se recortan solas (auto-trim).</span>' },
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
    // las superficies de origen NO se borran: se ocultan y quedan atadas a la operación (Revert las devuelve); las nuevas llevan su
    // nombre, material, capa y grupo
    const info = new Map(srcs.map((o) => [o.id, { name: o.name, mat: o.mat, layer: o.layer, group: o.group }]));
    filClearPreview();
    const names = {};
    srcs.forEach((o) => { if (!byId(o.id)) return; names[o.id] = o.name; o.name = `${o.name} · original`; o.visible = false; applyVisibility(o); });
    const edgesMade = [];
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
        c.group = o.group; edgesMade.push(c);
      }
      updateObject(o);
    }
    activeLayer = layer;
    const n = fil.sel.length, kind = fil.dist < 0 ? 'Chaflán' : 'Redondeo';
    addRelation({ type: 'fillet', srcs: Object.keys(names).map(Number), consumed: Object.keys(names).map(Number), names,
      outs: [...made.map((o) => o.id), ...edgesMade.map((c) => c.id)], kind, n, dist: fil.dist });
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
  filGroup.visible = false; fil = null; tool = 'select'; toolDone('fillet');
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
  if (e.key === 'Enter') { e.stopImmediatePropagation(); endFillet(true); }
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
    if (o.kind !== 'curve') setSurfaceMaterial(o, false, null, false, false);
    if (o.parts.bound) o.parts.bound.visible = false;
    if (forgeHidesSource() && (forgeSource.ids.includes(o.id) || o.id === forgeSource.resultId)) for (const part of Object.values(o.parts)) if (part.visible) { part.visible = false; hid.push(part); }
  });
  syncGhosts();
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
// ---------- HUD de información (Transform Info), neumórfico ----------
// Sale al elegir algo y se va al soltar la selección. Lee CVs, curvas, superficies, mallas (sólidos), grupos y pivotes.
// Un elemento: su información + posición del pivote. Varios sueltos: lista de cada uno + transformación conjunta (cada uno gira y escala
// sobre su pivote, como Alias). Un grupo entero: una sola lectura y un solo pivote maestro. Ejes de Alias (Z arriba), en mm.
// Arrastrar un número en horizontal = cambiarlo en vivo (Shift ×10, Ctrl ×0,1); doble clic = escribirlo.
var hudOn = false;   // var: los enganches de arriba pueden llamarse antes de que exista el HUD
const MM = 100;   // Forja trabaja en dm
const hudEl = document.createElement('div');
hudEl.id = 'hud'; hudEl.className = 'hud'; hudEl.hidden = true;
document.body.append(hudEl);
const hud = { key: '', rot: [0, 0, 0], scl: [1, 1, 1], gp: null, drag: null };
const KIND_NAMES = { surface: 'Superficie', curve: 'Curva', cos: 'Curva sobre superficie', mesh: 'Sólido (malla)', canvas: 'Canvas', shell: 'Shell' };
const kindOf = (o) => (o.kind === 'curve' && o.data?.cos ? 'cos' : o.kind);
function objBox(o) {
  if (o.kind === 'mesh') { const g = o.data.geometry; if (!g.boundingBox) g.computeBoundingBox(); return g.boundingBox.clone(); }
  const b = new THREE.Box3(); (o.data.cvs || []).flat().forEach((p) => b.expandByPoint(new THREE.Vector3(p.x, p.y, p.z))); return b;
}
const sizeMM = (b) => { const s = b.getSize(new THREE.Vector3()); return `${(s.x * MM).toFixed(1)} × ${(s.z * MM).toFixed(1)} × ${(s.y * MM).toFixed(1)} mm`; };
function objInfo(o) {
  const d = o.data;
  if (o.kind === 'surface') return `grado ${d.degU}×${d.degV} · tramos ${N.spansOf(d.cvs.length, d.degU)}×${N.spansOf(d.cvs[0].length, d.degV)} · ${d.cvs.length}×${d.cvs[0].length} CVs · caja ${sizeMM(objBox(o))}`;
  if (o.kind === 'curve') return `grado ${d.deg} · tramos ${N.spansOf(d.cvs.length, d.deg)} · ${d.cvs.length} CVs${d.cos ? ' · sobre ' + (byId(d.cos.surf)?.name || 'superficie') : ''} · caja ${sizeMM(objBox(o))}`;
  if (o.kind === 'mesh') { const g = d.geometry; return `${Math.round((g.index ? g.index.count : g.attributes.position.count) / 3).toLocaleString('es')} triángulos · caja ${sizeMM(objBox(o))}`; }
  return '';
}
function hudTargets() {
  if (pickMode === 'cv') {
    const refs = [...selCVs.values()];
    if (!refs.length) return null;
    return { mode: 'cv', refs, center: centroid(refs), key: 'cv:' + refs.map((r) => r.key).join(',') };
  }
  const objs = selObjs.filter((o) => o.visible);
  if (!objs.length) return null;
  const key = 'obj:' + objs.map((o) => o.id).join(',') + (pivotEdit ? ':piv' : '');
  if (pivotEdit) { const o = objs[objs.length - 1]; return { mode: 'pivot', objs: [o], center: o.pivot, key }; }
  const g0 = objs[0].group, grp = objs.length > 1 && g0 != null && objs.every((o) => o.group === g0) && objects.filter((o) => o.group === g0 && o.visible).every((o) => objs.includes(o));
  if (grp) {
    if (hud.key !== key || !hud.gp) { const b = new THREE.Box3(); objs.forEach((o) => b.union(objBox(o))); hud.gp = b.getCenter(new THREE.Vector3()); }
    return { mode: 'group', objs, center: hud.gp, group: groups.find((g) => g.id === g0), key };
  }
  if (objs.length === 1) return { mode: 'single', objs, center: objs[0].pivot, key };
  const c = new THREE.Vector3(); objs.forEach((o) => c.add(o.pivot)); c.divideScalar(objs.length);
  return { mode: 'multi', objs, center: c, key };
}
const fmtA = (p) => { const a = toAlias(p); return [a.x * MM, a.y * MM, a.z * MM]; };
const HUD_ROWS = { t: ['Traslación', 'mm', 4], r: ['Rotación', '°', 2], s: ['Escala', '', 3] };
// traslación LOCAL: desde donde se creó el objeto (origin0), así todo nace en (0, 0, 0); los CVs y el pivote se siguen viendo en mundo
function hudT(T) {
  if (T.mode !== 'single' && T.mode !== 'multi') return fmtA(T.center);
  const o0 = new THREE.Vector3(); T.objs.forEach((o) => o0.add(o.origin0 || o.pivot)); o0.divideScalar(T.objs.length);
  return fmtA(T.center.clone().sub(o0));
}
function hudVal(T, g, a) { const v = g === 't' ? hudT(T)[a] : g === 'r' ? hud.rot[a] : hud.scl[a]; return Math.abs(v) < 5e-5 ? 0 : v; }
function hudRender() {
  const T = carousel ? null : hudTargets();
  hudEl.hidden = !T || !!winState('hud').closed;   // × la cierra hasta que se vuelva a abrir desde Ventanas
  if (!T) { hud.key = ''; return; }
  if (T.key !== hud.key) { hud.key = T.key; hud.rot = [0, 0, 0]; hud.scl = [1, 1, 1]; }
  if (hud.drag) return hudRefresh();
  const one = T.objs?.[0];
  const title = T.mode === 'cv' ? (T.refs.length === 1 ? `CV de ${T.refs[0].obj.name}` : `${T.refs.length} CVs`)
    : T.mode === 'pivot' ? `Pivote de ${one.name}` : T.mode === 'group' ? `${T.group?.name || 'Objeto'} · ${T.objs.length} elementos`
    : T.mode === 'single' ? one.name : `${T.objs.length} elementos`;
  const sub = T.mode === 'cv' ? (T.refs.length === 1 ? `peso ${fmt(cvRef(T.refs[0]).w ?? 1)}` : 'centro de los CVs elegidos')
    : T.mode === 'single' ? `${KIND_NAMES[kindOf(one)]} · ${objInfo(one)}`
    : T.mode === 'group' ? `Objeto (grupo) · una sola lectura · caja ${sizeMM(T.objs.reduce((b, o) => b.union(objBox(o)), new THREE.Box3()))}`
    : T.mode === 'pivot' ? 'mueve solo el pivote' : 'cada uno gira y escala sobre su propio pivote';
  const list = T.mode === 'multi' ? `<details class="hud-det" ${hud.listClosed ? '' : 'open'}><summary>${T.objs.length} elementos elegidos</summary><ol class="hud-list">${T.objs.map((o) => { const p = fmtA(o.pivot); return `<li><b>${esc(o.name)}</b><span>${KIND_NAMES[kindOf(o)]} · ${objInfo(o)}</span><em>pivote ${p.map((v) => v.toFixed(1)).join(' · ')}</em></li>`; }).join('')}</ol></details>` : '';
  const rows = (T.mode === 'pivot' ? ['t'] : ['t', 'r', 's']).map((g) => {
    const [lab, unit, dec] = HUD_ROWS[g];
    return `<div class="hud-row"><label>${T.mode === 'pivot' && g === 't' ? 'Pivote' : T.mode === 'cv' && g === 't' ? 'Posición' : g === 't' && (T.mode === 'single' || T.mode === 'multi') ? 'Traslación (local)' : lab}</label>${[0, 1, 2].map((a) =>
      `<div class="hud-f" data-g="${g}" data-a="${a}" title="Arrastra en horizontal (Shift ×10, Ctrl ×0,1) · doble clic para escribir"><i class="ax ax${a}"></i><span>${hudVal(T, g, a).toFixed(dec)}</span></div>`).join('')}<u>${unit}</u></div>`;
  }).join('');
  hudEl.innerHTML = `<div class="hud-head"><b>Transform info</b><span>${esc(title)}</span>${winButtons()}</div><p class="hud-sub">${esc(sub)}</p>${list}${T.mode === 'single' ? geoRows(one) : ''}${rows}`;
  placeWin(hudEl, 'hud');
}
// Inspector del objeto: grado y spans (U y V en superficies) editables; parametrización uniforme (nudos sujetos). Si el objeto sale de
// una construcción con grado / spans propios (Revolución), se cambian en la receta (historial intacto); si no, se reconstruye y los
// que dependen de él se recalculan.
function geoInfo(o) {
  const d = o.data, sp = (k, deg) => N.uniqueKnots(k).length - 1;
  if (o.kind === 'curve' && !d.cos) return [['deg', 'Grado', d.deg, 1, 7], ['spans', 'Spans', sp(d.knots), 1, N.MAX_SPANS]];
  if (o.kind === 'surface') return [['degU', 'Grado U', d.degU, 1, 7], ['spansU', 'Spans U', sp(d.knotsU), 1, N.MAX_SPANS], ['degV', 'Grado V', d.degV, 1, 7], ['spansV', 'Spans V', sp(d.knotsV), 1, N.MAX_SPANS]];
  return null;
}
function geoRows(o) {
  const g = geoInfo(o);
  if (!g) return '';
  return `<div class="hud-geo">${g.map(([k, l, v, mn, mx]) => `<label>${l}<input type="number" data-geo="${k}" min="${mn}" max="${mx}" step="1" value="${v}"></label>`).join('')}<em>parametrización uniforme</em></div>`;
}
function applyGeo(o, k, val) {
  const rel = relations.find((r) => outputOf(r) === o.id);
  checkpoint();
  if (rel?.type === 'revolve' && (k === 'degU' || k === 'spansU')) {   // la Revolución guarda grado / tramos de su barrido: se cambia la receta
    rel.rational = false; rel[k === 'degU' ? 'deg' : 'spans'] = val; applyRelation(rel); propagateFrom(o);
  } else {
    if (rel && !constructionOf(rel).editable) { const i = relations.indexOf(rel); relations.splice(i, 1); toast('El objeto tenía historial de construcción: se quitó para cambiar su estructura'); }
    const g = Object.fromEntries(geoInfo(o).map(([kk, , v]) => [kk, v])); g[k] = val;
    o.data = o.kind === 'curve' ? N.rebuildCurve(o.data, g.deg, g.spans) : { ...N.rebuildSurface(o.data, g.degU, g.spansU, g.degV, g.spansV), ...(o.data.rtrims ? { rtrims: o.data.rtrims } : {}) };
    updateObject(o);
  }
  renderHistory(); hudRender(); renderSelectionBody();
}
hudEl.addEventListener('change', (e) => {
  const inp = e.target.closest('[data-geo]'), T = hudTargets();
  if (!inp || T?.mode !== 'single') return;
  const v = Math.round(+inp.value);
  if (Number.isFinite(v) && v >= +inp.min && v <= +inp.max) applyGeo(T.objs[0], inp.dataset.geo, v);
});
hudEl.addEventListener('keydown', (e) => { if (e.target.closest('[data-geo]')) e.stopPropagation(); });
function hudRefresh() {
  const T = hudTargets();
  if (!T || hudEl.hidden) return;
  hudEl.querySelectorAll('.hud-f').forEach((f) => {
    if (f.querySelector('input')) return;
    const g = f.dataset.g, a = +f.dataset.a; f.querySelector('span').textContent = hudVal(T, g, a).toFixed(HUD_ROWS[g][2]);
  });
}
// aplica el cambio de un campo (de `from` a `to`) a lo elegido
function hudApply(g, a, from, to) {
  const T = hudTargets();
  if (!T || from === to) return;
  const ax = AXES[a], M = new THREE.Matrix4();
  const about = (c, L) => new THREE.Matrix4().makeTranslation(c.x, c.y, c.z).multiply(L).multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  let L;
  if (g === 't') { const d = ax.clone().multiplyScalar((to - from) / MM); L = new THREE.Matrix4().makeTranslation(d.x, d.y, d.z); }
  else if (g === 'r') L = new THREE.Matrix4().makeRotationAxis(ax, THREE.MathUtils.degToRad(to - from));
  else { const k = Math.abs(from) < 1e-6 ? 1 : to / from, v = [ax.x, ax.y, ax.z].map((c) => 1 + (k - 1) * Math.abs(c)); L = new THREE.Matrix4().makeScale(...v); }
  const v3 = new THREE.Vector3(), moveCV = (p, m) => { v3.set(p.x, p.y, p.z).applyMatrix4(m); p.x = v3.x; p.y = v3.y; p.z = v3.z; };
  let objs = [];
  if (T.mode === 'pivot') { T.objs[0].pivot.applyMatrix4(L); attachGizmo(); hudRefresh(); updatePivotReadout(); return; }
  if (T.mode === 'cv') { M.copy(about(T.center, L)); T.refs.forEach((r) => moveCV(cvRef(r), M)); objs = [...new Set(T.refs.map((r) => r.obj))]; }
  else {
    for (const o of T.objs) {
      const m = g === 't' ? L : about(T.mode === 'multi' ? o.pivot : T.center, L);
      if (o.kind === 'mesh') { const geo = o.data.geometry; geo.applyMatrix4(m); geo.computeBoundingBox(); geo.computeBoundingSphere(); }
      else allCVRefs(o).forEach((r) => moveCV(cvRef(r), m));
      if (T.mode === 'multi' || g === 't') o.pivot.applyMatrix4(m); else o.pivot.applyMatrix4(about(T.center, L));
    }
    if (T.mode === 'group') hud.gp.applyMatrix4(g === 't' ? L : new THREE.Matrix4());
    objs = T.objs;
  }
  if (g === 'r') hud.rot[a] = to; else if (g === 's') hud.scl[a] = to;
  pendingObjs = objs;
  if (!pendingUpdate) pendingUpdate = requestAnimationFrame(flushPending);
}
// antes de cambiar nada: historial de construcción (como al mover) y un paso de deshacer
function hudBegin(e) {
  const blk = historyBlockers();
  if (blk.length) { askBreakHistory(e.clientX, e.clientY, blk); return false; }
  checkpoint(); return true;
}
function hudEnd() { flushPending(); attachGizmo(); renderSelectionBody(); pivotBlock(); hudRefresh(); }
const hudStep = (g, e) => (g === 't' ? 0.5 : g === 'r' ? 0.5 : 0.005) * (e.shiftKey ? 10 : e.ctrlKey || e.metaKey ? 0.1 : 1);
hudEl.addEventListener('pointerdown', (e) => {
  const f = e.target.closest('.hud-f');
  if (!f || e.button !== 0 || f.querySelector('input')) return;
  e.preventDefault(); e.stopPropagation();
  const T = hudTargets(), g = f.dataset.g, a = +f.dataset.a;
  hud.drag = { f, g, a, x: e.clientX, v0: hudVal(T, g, a), last: hudVal(T, g, a), moved: false };
  f.setPointerCapture(e.pointerId); f.classList.add('on');
});
hudEl.addEventListener('pointermove', (e) => {
  const d = hud.drag;
  if (!d) return;
  const dx = e.clientX - d.x;
  if (!d.moved) { if (Math.abs(dx) < 3) return; if (!hudBegin(e)) { d.f.classList.remove('on'); hud.drag = null; return; } d.moved = true; }
  let v = d.v0 + dx * hudStep(d.g, e);
  if (d.g === 's' && Math.abs(v) < 0.001) v = 0.001 * Math.sign(v || 1);
  hudApply(d.g, d.a, d.last, v); d.last = v;
  d.f.querySelector('span').textContent = v.toFixed(HUD_ROWS[d.g][2]);
});
const hudUp = () => { const d = hud.drag; if (!d) return; hud.drag = null; d.f.classList.remove('on'); if (d.moved) hudEnd(); };
hudEl.addEventListener('pointerup', hudUp); hudEl.addEventListener('pointercancel', hudUp);
hudEl.addEventListener('dblclick', (e) => {
  const f = e.target.closest('.hud-f');
  if (!f || f.querySelector('input')) return;
  const g = f.dataset.g, a = +f.dataset.a, span = f.querySelector('span'), cur = +span.textContent;
  const inp = document.createElement('input'); inp.type = 'text'; inp.inputMode = 'decimal'; inp.value = span.textContent;
  span.hidden = true; f.append(inp); inp.focus(); inp.select();
  let done = false;
  const finish = (ok) => {
    if (done) return; done = true;
    const v = parseFloat(inp.value.replace(',', '.'));
    inp.remove(); span.hidden = false;
    if (ok && Number.isFinite(v) && v !== cur && !(g === 's' && v === 0) && hudBegin(e)) { hudApply(g, a, cur, v); hudEnd(); }
    else hudRefresh();
  };
  inp.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') finish(true); else if (k.key === 'Escape') finish(false); });
  inp.addEventListener('blur', () => finish(true));
});
hudEl.addEventListener('contextmenu', (e) => e.preventDefault());
hudEl.addEventListener('toggle', (e) => { if (e.target.classList?.contains('hud-det')) hud.listClosed = !e.target.open; }, true);
// ventana flotante: se arrastra por la cabecera a cualquier sitio, _ minimiza, × cierra (Ventanas › Transform info la reabre)
if (prefs.hudPos && winState('hud').x == null) { winState('hud').x = prefs.hudPos.x; winState('hud').y = prefs.hudPos.y; }
placeWin(hudEl, 'hud'); addEventListener('resize', () => placeWin(hudEl, 'hud'));
dragWin(hudEl, 'hud', '.hud-head');
hudEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-win]');
  if (!b) return;
  if (b.dataset.win === 'min') setWinMin(hudEl, 'hud', !winState('hud').min);
  else { winState('hud').closed = true; savePrefs(); hudRender(); toast('Transform info cerrado · Ventanas › Transform info lo vuelve a abrir'); }
});
hudOn = true;

function renderFrame(now) {
  if (layout === 'forge' && !carousel && forgeCtx.controls.autoRotate) tumble(1.2, 0);   // "Girar" de Forge
  stepCamAnim(now);
  placePanelVeil();
  updateViewName();
  updateDrawGrids();
  updateXfPrompt();
  pivotMarker.position.copy(pivot);
  pivotMarker.scale.setScalar(pxWorld(pivot, 24));
  pivotMarker.visible = navHeld || !!navDrag || now < pivotShowUntil;
  snapRing.quaternion.copy(camera.quaternion);
  snapRing.scale.setScalar(camera.position.distanceTo(snapRing.position) * 0.06);
  syncPivotMarkers();
  scaleHandles();
  originAxes.scale.setScalar(pxWorld(originAxes.position, 1));
  if (relArrows.children.length) scaleRelArrows();
  placeRelLabels(); updateLocators();
  // la sombra solo cambia si cambia la escena (no al mover la cámara): se recalcula si algo cambió hace poco, si se arrastra el gizmo,
  // y siempre en Forge y durante el carrusel (sus objetos cambian por dentro)
  if (gizmoDrag) sceneChangedAt = performance.now();
  if (shadowEvery || layout === 'forge' || carousel || performance.now() - sceneChangedAt < 700) renderer.shadowMap.needsUpdate = true;
  backend.beginFrame();
  if (carousel) renderCarousel(now);
  else { panes().forEach((p) => backend.drawPane(p)); panes().forEach((p) => backend.drawOverlay(p)); }
  backend.endFrame();
  scene.backgroundIntensity = Math.min(1, (now - bgFadeT0) / 450);   // el fondo de VISU aparece suave tras el giro
  // El ratio de la cámara queda con el de la vista bajo el puntero, para que seleccionar y el gizmo coincidan.
  useAspect(dragPane || paneAt(lastPtr.x));
  // el color del texto (negro/blanco) se mide con la vista quieta: cada lectura de píxeles obliga a la tarjeta gráfica a esperar
  { const e = camera.matrixWorld.elements, k = `${e[12].toFixed(3)},${e[13].toFixed(3)},${e[14].toFixed(3)},${e[0].toFixed(3)},${e[2].toFixed(3)},${e[6].toFixed(3)}`;
    if (k !== camInkKey) { camInkKey = k; camMovedAt = now; } }
  if (!navDrag && !gizmoDrag && !carousel && now - camMovedAt > 160) adaptInk(now);
}
let camInkKey = '', camMovedAt = 0;

function resize() {
  const w = view.clientWidth, h = view.clientHeight;
  backend.resize(w, h);
  const p = panes()[0];
  lineMats.forEach((m) => m.resolution.set(p.w, p.h));
}

// ---------- Arranque ----------
buildEnvGrid(); setEnvOpts({ rot: prefs.envRot ?? 0, int: prefs.envInt ?? 1 });
new ResizeObserver(resize).observe(view);
resize();
buildMaterialLibrary();
syncMaterialEditor(); $('rough').value = materials[matKey].roughness; $('rough-o').textContent = (+materials[matKey].roughness).toFixed(2);

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
setDiag(diagMode);   // modo de arranque (Forja): pone el nombre, las líneas de parche y la leyenda
setLayout(layout);
setPinned(false);
frameObjects([]);
setTool('select');
selectionChanged();

renderer.setAnimationLoop(renderFrame);
window.__forja = { layers, setLayerMode, setLayerColor, toggleSym, syncGhosts, mirrorRoots, layerMats, pickable, importFile, removeObject, backend, lineCandidates, pickMode: () => pickMode, undoDepth: () => undoStack.length, pickNothing, tool: () => tool, draft: () => draft, toolDef, grids: () => [grid.visible, gridXY.visible, gridYZ.visible], sceneStamp: () => sceneChangedAt, renderer, setShadowEvery: (v) => (shadowEvery = v), setDiagMode: (m) => setDiag(m), THREE, refineTess, tess: () => tessMul, addSurface, startFillet, fil: () => fil, FL, camera, objects, panes, pivot, selObjs, selCVs, gizmo, proxy, carousel: () => carousel, runAI, relations, createAlign, createAlignCurve, alignDiag, masterField, edgeInfo: () => edgeOp && edgeOp.picks.map((p) => [p.obj.name, p.edge, p.end]), moveSnap, snapModes, N, createBlend, createSkin, createExtend, blendDemo, projectSelection, applySelection, addCurve, circleData, startEdgeOp, updateObject, undo, proj, setProjection, goToView, cubeRegionAt, forgeFromForja, forge: () => forge, setTool, setDrawPlane, snapToggles, HX, FF, TW: () => TW, arrows: () => relArrows.children, cvAll: () => { objects.forEach((o) => o.kind !== "mesh" && cvTargets.add(o.id)); selectionChanged(); }, createGFillet, findMateEdge, FFm: FF, relSpec, relHandles, relDiag, addRelation, trimSelection, finishTrim, untrimSelection, doUntrim, revertConstruction, endFillet, serializeProject, loadProjectV2orV1, extendCurveData, surfaceExtendTo, cvsOff, startExtendU, startLine, untrimSurface, draftPoint, recentAll, locators, addLocator, deleteLocators, flipNormalsRun, withSelection, activeTool: () => activeTool?.id || "idle", escapeAll, awaitSel: () => awaitSel, revolveDrag: () => revolveDrag, MENUS: () => MENUS, setXform, offsetSelection, loftSelection, revolveSelection, extrudeSelection, filPreview, trimStages, relSpecOf: (r) => relSpec(r), trimOp: () => trimOp, applyRelation, propagateFrom, renderHistory };
syncMaterialEditor();
showModule(layout);
window.__ready = true;
