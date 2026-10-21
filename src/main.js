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
  if (!mouseXform || prefs.xform === 'gizmo' || carousel || tool !== 'select' || pivotEdit || navHeld || (e.ctrlKey && e.shiftKey) || e.button > 2) return;
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
    m.moved = true;
    gizmo.dispatchEvent({ type: 'mouseDown', mode: xform });
  }
  if (xform === 'translate') {
    const d = m.dirs[m.button], L = d.lengthSq();
    // si el eje apunta a la cámara casi no se ve en pantalla: entonces se usa el movimiento vertical
    const t = L > 4 ? (dx * d.x + dy * d.y) / L : (-dy * m.depth) / m.pane.h;
    proxy.position.copy(m.p0).addScaledVector(AXES[m.button], t);
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
  if (m.moved) { gizmo.dispatchEvent({ type: 'mouseUp', mode: xform }); return; }
  // clic sin arrastrar: elegir, como siempre
  const hit = pickAt(e);
  const how = howFor(e);
  if (hit) applySelection([hit.cv || hit.obj], how); else if (how === 'replace' && e.button === 0) clearSelection();
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
const ENV_MODES = { showroom: 1, diffuse: 2, sky: 3 };
const DIAG_NAMES = { showroom: 'SHOWROOM', diffuse: 'DIFUSO', sky: 'SHADE-SKY', zebra: 'CEBRA', curv: 'CURVATURA', wire: 'MALLA' };
const curvMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0, side: THREE.DoubleSide });
const wireMat = new THREE.MeshBasicMaterial({ color: '#2d6aa8', wireframe: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide });

const lineMats = [];
const LM = (o) => { const m = new LineMaterial(o); lineMats.push(m); return m; };
const curveMat = LM({ color: 0x2b2a27, linewidth: 2.5 });
const curveSelMat = LM({ color: 0xe07a1f, linewidth: 3 });
const draftMat = LM({ color: 0xe07a1f, linewidth: 2 });
const edgeSelMat = LM({ color: 0xe07a1f, linewidth: 2.5 });
// Líneas de los parches (límites de cada span), siempre visibles en el diagnóstico
const isoMat = LM({ color: 0x4a8fe0, linewidth: 1.6 }); // líneas de parche en azul: se ven sobre cebra blanca y negra
const isoSelMat = LM({ color: 0xe07a1f, linewidth: 1.8 });
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
  p.hull = new THREE.LineSegments(new THREE.BufferGeometry(), hullMat); p.hull.layers.set(DIAG);
  p.hullEdge = new THREE.LineSegments(new THREE.BufferGeometry(), hullEdgeMat); p.hullEdge.layers.set(DIAG);
  p.hull.add(p.hullEdge);   // hijo: se muestra y se oculta junto con el polígono
  p.edge = new Line2(new LineGeometry(), edgeSelMat); p.edge.renderOrder = 6;
  p.handles = new THREE.Group();
  scene.add(p.mesh, p.iso, p.hull, p.edge, p.handles);
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
  for (const o of Object.values(obj.parts)) { o.geometry?.dispose(); scene.remove(o); }
  objects.splice(objects.indexOf(obj), 1);
  selObjs.splice(0, selObjs.length, ...selObjs.filter((o) => o !== obj));
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
  { const g = new LineSegmentsGeometry(); g.setPositions(iso); setGeo(p.iso, g); }
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
  for (let s = 0; s <= S; s++) { const q = crv.getPoint(s / S); pts.push(q.x, q.y, q.z); }
  setGeo(p.line, line2Geo(pts));
  setGeo(p.pick, posGeo(pts));
  obj.samples = [];
  for (let k = 0; k < pts.length; k += 3) obj.samples.push(new THREE.Vector3(pts[k], pts[k + 1], pts[k + 2]));
  obj.editPts = N.uniqueKnots(d.knots).map((k) => crv.getPoint(k));
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
    const z = obj.data.plane === 'xy' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0);
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
  p.handles.visible = p.hull.visible = vis && cvMode && !modelClean;
  if (obj.kind === 'mesh') {
    p.mesh.visible = vis;
  } else if (obj.kind === 'surface') {
    p.mesh.visible = vis;
    p.iso.visible = vis && $('show-iso').checked && diagMode !== 'wire' && !modelClean;
    p.iso.material = sel ? isoSelMat : isoMat;
    p.edge.visible = vis && sel;
  } else {
    p.line.visible = vis;
    p.line.material = sel ? curveSelMat : curveMat;
    p.comb.visible = p.env.visible = vis && $('show-comb').checked && !modelClean;
  }
}

// ---------- Selección ----------
let pickMode = 'object';
// Filtro del modo Objetos (como Pick Curves / Pick Surfaces de Alias): null = todo, 'curve' o 'surface'
let pickFilter = null;
const pickable = (o) => o.visible && (!pickFilter || (pickFilter === 'curve' ? o.kind === 'curve' : o.kind !== 'curve'));
const PICK_NAMES = { curve: 'curvas', surface: 'superficies' };
const selObjs = []; // en orden de selección (importa para el loft)
const selCVs = new Map();

function setPickMode(m, filter = null) {
  if (m === pickMode && filter === pickFilter) return;
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
function clearSelection() { selObjs.length = 0; selCVs.clear(); selectionChanged(); }

function selectionChanged() {
  if (pivotEdit && (pickMode !== 'object' || !selObjs.length)) { pivotEdit = false; gizmo.setMode(xform); updateXformButtons(); }
  objects.forEach((o) => {
    applyVisibility(o);
    o.parts.handles.children.forEach((h) => (h.children[0].material = selCVs.has(h.userData.key) ? handleSelMat : handleMat));
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
    applySnapToProxy(g.ex);
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
const snapToggles = { grid: false, curve: false, point: false };
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
  gizmo.setRotationSnap(held.grid ? Math.PI / 12 : null);
  gizmo.setScaleSnap(held.grid ? 0.25 : null);
}
function snapGrid(p, planeKind) {
  const r = (v) => Math.round(v / gridStep) * gridStep;
  p.x = r(p.x);
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
  }
  return out;
}
// Para el snap de curva: curvas y bordes de superficies, como polilíneas
function curvePolylines(ex) {
  return objects.filter((o) => o.visible && o.kind !== 'mesh' && !ex.full?.has(o) && !ex.partial?.has(o)).map((o) => (o.kind === 'curve' ? o.samples : o.edgePts));
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
    const hits = ray.intersectObjects(live.flatMap((o) => o.parts.handles.children), false);
    let best = null, bd = Infinity;
    for (const h of hits) { const d = ray.ray.distanceSqToPoint(h.object.position) / h.object.scale.x ** 2; if (d < bd) { bd = d; best = h; } }
    return best ? { cv: best.object.userData } : null;
  }
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(live.filter(pickable).map((o) => pickTarget(o)), false)[0];
  return hit ? { obj: hit.object.userData.obj, point: hit.point } : null;
}

// ---------- Herramientas ----------
let tool = 'select';
let drawPlaneKind = 'xz';
const drawPlanes = { xz: new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.01), xy: new THREE.Plane(new THREE.Vector3(0, 0, 1), 0) };
function placePoint(e) {
  const modes = snapModes(e);
  const s = findSnap(e.clientX, e.clientY, modes, {});
  if (s) { showSnap(s); return s.point; }
  setRay(e);
  const p = ray.ray.intersectPlane(drawPlanes[drawPlaneKind], new THREE.Vector3());
  if (p && modes.grid) { snapGrid(p, drawPlaneKind); showSnap({ point: p, kind: 'rejilla' }); } else hideSnap();
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
  if (carousel) { down = null; return; }
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
  if (tool === 'plane') {
    const p = placePoint(e);
    if (!p) return;
    const o = addSurface(N.planeData(p, drawPlaneKind), 'Plano');
    setTool('select');
    finishCreate([o], `${o.name} creado`);
    return;
  }
  if (gizmo.axis && e.button === 0) return; // el gizmo solo usa el botón izquierdo
  const hit = pickAt(e);
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
    items = live.flatMap(allCVRefs).filter((ref) => { const q = cvRef(ref); return inside(q.x, q.y, q.z); });
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
  const pt = hit ? hit.point : ray.ray.intersectPlane(drawPlanes.xz, new THREE.Vector3());
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
  const c = boundsOf(objects).getCenter(new THREE.Vector3());
  pivot.copy(c);
  camera.position.set(c.x, c.y + 18, c.z);
  camera.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
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
const RING = ['diag', 'render', 'ai'];
const RING_NAMES = { diag: 'MODELADO', render: 'VISU', ai: 'IA' };
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
const MODULE_TITLES = { diag: 'Modelado', render: 'Visu', ai: 'IA', split: 'Modelado + Visu' };
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
  const ORDER = ['diag', 'render', 'ai'], dir = ORDER.indexOf(l) > ORDER.indexOf(layout) ? 1 : -1;
  await body.animate([{ transform: 'perspective(900px) rotateY(0deg)', opacity: 1 }, { transform: `perspective(900px) rotateY(${-90 * dir}deg)`, opacity: 0 }],
    { duration: 380, easing: 'cubic-bezier(.55,0,.8,.4)' }).finished;
  showModule(l);
  body.animate([{ transform: `perspective(900px) rotateY(${90 * dir}deg)`, opacity: 0 }, { transform: 'perspective(900px) rotateY(0deg)', opacity: 1 }],
    { duration: 480, easing: 'cubic-bezier(.2,.6,.3,1)' });
}
function setLayout(l) {
  layout = l;
  $('app').dataset.layoutNow = l;
  document.querySelectorAll('[data-layout]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layout === l)));
  $('pane-diag').hidden = l === 'render';
  $('pane-render').hidden = l !== 'render' && l !== 'split';
  $('pane-diag').className = 'pane left' + (l !== 'split' ? ' full' : '');
  $('pane-diag').querySelector('.pane-title b').textContent = l === 'ai' ? 'IA' : 'MODELADO';
  $('pane-render').className = 'pane right' + (l === 'render' ? ' full' : '');
  if (!carousel) showModule(l);
  resize();
}
const cycleLayout = () => switchLayout({ diag: 'render', render: 'ai', ai: 'diag', split: 'diag' }[layout]);
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
      if (o.kind === 'curve') return { ...base, deg: d.deg, knots: d.knots, plane: d.plane, cvs: d.cvs.map(v4) };
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
  else if (k === 'o') setPickMode('object');
  else if (k === 'p') setPickMode('cv');
  else if (k === '4') setDiag('showroom');
  else if (k === '5') setDiag('diffuse');
  else if (k === '6') setDiag('sky');
  else if (k === '1') setDiag('zebra');
  else if (k === '2') setDiag('curv');
  else if (k === '3') setDiag('wire');
  else if (k === 'enter' && tool === 'curve') finishDraft();
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
  extend: 'M4 18C8 8 12 6 14 6M16 6h5M19 3l3 3-3 3', offset: 'M3 15c5-6 13-6 18 0M3 20c5-6 13-6 18 0', blend: 'M3 6h6c6 0 6 12 12 12M3 18h6',
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
// Puck (Tab): la caja de herramientas: crear, editar, elegir, transformar y mostrar
const PUCK = [
  { k: 'curve', label: 'Curva', key: 'C', run: () => setTool('curve'), sub: [
    { k: 'ground', label: 'En el suelo', run: () => { setDrawPlane('xz'); setTool('curve'); } },
    { k: 'front', label: 'De frente', run: () => { setDrawPlane('xy'); setTool('curve'); } }] },
  { k: 'surf', label: 'Superficie', run: () => setTool('plane'), sub: [
    { k: 'plane', label: 'Plano', run: () => setTool('plane') }, { k: 'revolve', label: 'Revolución', run: () => OPS.revolve() },
    { k: 'loft', label: 'Loft', run: () => OPS.loft() }, { k: 'extrude', label: 'Extruir', run: () => OPS.extrude() }] },
  { k: 'edit', label: 'Editar', soon: true, sub: [
    { k: 'align', label: 'Align', soon: true }, { k: 'blend', label: 'Blend', soon: true }, { k: 'round', label: 'Round', soon: true }, { k: 'offset', label: 'Offset', soon: true }] },
  { k: 'arrow', label: 'Elegir', key: 'O', run: () => setPickMode('object'), sub: [
    { k: 'object', label: 'Objeto', run: () => setPickMode('object') }, { k: 'pickCurve', label: 'Curvas', run: () => setPickMode('object', 'curve') },
    { k: 'pickSurf', label: 'Superficies', run: () => setPickMode('object', 'surface') }, { k: 'cv', label: 'CV', run: () => setPickMode('cv') },
    { k: 'nothing', label: 'Nada', run: pickNothing }] },
  { k: 'move', label: 'Transformar', key: 'W', run: mv, sub: [
    { k: 'move', label: 'Mover', run: mv }, { k: 'rotate', label: 'Rotar', run: rot }, { k: 'scale', label: 'Escalar', run: scl }, { k: 'pivot', label: 'Pivote', run: togglePivotEdit }] },
  { k: 'dup', label: 'Duplicar', run: duplicateSelection, sub: [{ k: 'symm', label: 'Simetría', soon: true }, { k: 'measure', label: 'Distancia', soon: true }] },
  { k: 'show', label: 'Mostrar', run: unhideAll, sub: [
    { k: 'hide', label: 'Ocultar', run: hideSelection }, { k: 'show', label: 'Mostrar todo', run: unhideAll },
    { k: 'frame', label: 'Encuadrar', run: frameSelection }, { k: 'top', label: 'Vista sup.', run: topView }] },
  { k: 'del', label: 'Borrar', key: 'Supr', run: deleteSelection },
];
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
  el.className = 'puck'; el.hidden = true;
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
    if (d < 44) { st.highlight(null); st.active = null; magnify(dx, dy); return; }
    if (d < r + 38 || !st.active?.subs.length) st.highlight(nearest(mains, ang)[0]);
    else {
      const [sub, da] = nearest(st.active.subs, ang);
      st.highlight(da < 44 / r2 + 0.12 ? sub : st.active);
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
const puck = makeRadial(PUCK, { r: 150, title: 'Herramientas' });
const pickMenu = makeRadial(PICK_MM, { r: 128, title: 'Selección' });
const xformMenu = makeRadial(XFORM_MM, { r: 128, title: 'Transformar' });
const disp = makeRadial(DISPLAY_MM, { r: 140, title: 'Visualización' });
const MENUS = [puck, pickMenu, xformMenu, disp];
let lastPtr = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  lastPtr = { x: e.clientX, y: e.clientY };
  for (const m of MENUS) if (m.open) m.pickAt(e.clientX, e.clientY);
});
addEventListener('pointerdown', (e) => {
  for (const m of MENUS) if (m.open && m.sticky && !e.target.closest('.puck, .mmenu')) m.close(false);
}, true);
// Tab = Puck. Mantener y soltar sobre la opción; una pulsación corta lo deja abierto para hacer clic.
function bindKey(code, m) {
  addEventListener('keydown', (e) => {
    if (e.code !== code || ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    e.preventDefault();
    if (e.repeat) return;
    if (m.open && m.sticky) return m.close(false);
    m.show(lastPtr.x, lastPtr.y); m.t0 = performance.now();
  }, true);
  addEventListener('keyup', (e) => {
    if (e.code !== code || !m.open || m.sticky) return;
    e.preventDefault();
    if (m.hover) m.close(true);
    else if (performance.now() - m.t0 < 400) m.sticky = true;
    else m.close(false);
  }, true);
}
bindKey('Tab', puck);
bindKey('Space', disp);
addEventListener('keydown', (e) => { if (e.key === 'Escape') MENUS.forEach((m) => m.close(false)); }, true);
let mouseMenu = null;
addEventListener('pointerdown', (e) => {
  if (!(e.ctrlKey && e.shiftKey) || e.target !== renderer.domElement || carousel) return;
  e.stopImmediatePropagation(); e.preventDefault();
  MENUS.forEach((m) => m.close(false));
  mouseMenu = [pickMenu, xformMenu, disp][e.button] || disp;
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
  return { deg: d.deg, knots: d.knots.slice(), plane: d.plane, cvs: d.cvs.map(cloneV4) };
}
function snapshot() {
  return {
    layers: layers.map((l) => ({ ...l })), activeLayer, nextLayerId, groups: groups.map((g) => ({ ...g })), nextGroupId,
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
  objects.forEach(applyVisibility);
  selectionChanged(); refreshOutliner(); renderLayers();
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
const EVAL_MODES = [
  { k: 'showroom', label: 'Showroom', key: '4' }, { k: 'diffuse', label: 'Difuso', key: '5' }, { k: 'sky', label: 'Shade-Sky', key: '6' },
  { k: 'zebra', label: 'Cebra', key: '1' }, { k: 'curv', label: 'Curvatura', key: '2' }, { k: 'wire', label: 'Malla', key: '3' },
];
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
      const mats = { showroom: envDiagMat, diffuse: envDiagMat, sky: envDiagMat, zebra: zebraMat, curv: curvMat };
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
  ['Borrar', [
    { label: 'Borrar selección', key: 'Supr', run: deleteSelection },
    { label: 'Borrar todas las curvas', run: () => { selObjs.splice(0, selObjs.length, ...objects.filter((o) => o.kind === 'curve')); deleteSelection(); } },
    { label: 'Borrar todo', run: () => { if (confirm('¿Borrar toda la escena? (se puede deshacer con Ctrl+Z)')) { setPickMode('object'); selObjs.splice(0, selObjs.length, ...objects); deleteSelection(); } } }]],
  ['Vistas', [
    { label: 'Encuadrar selección', key: 'F', run: frameSelection }, { label: 'Encuadrar todo', run: () => frameObjects([]) }, { label: 'Vista superior', key: 'T', run: topView },
    { sep: true }, { label: 'Modelado', run: () => switchLayout('diag'), ...chk(() => layout === 'diag') },
    { label: 'Visu', run: () => switchLayout('render'), ...chk(() => layout === 'render') }, { label: 'IA', run: () => switchLayout('ai'), ...chk(() => layout === 'ai') },
    { label: 'Dividida', run: () => switchLayout('split'), ...chk(() => layout === 'split') }, { label: 'Elegir módulo', key: 'mantener V', run: () => toast('Mantén V y haz clic en un módulo') }]],
  ['Mostrar', [
    { label: 'Toggle Model', run: toggleModel, ...chk(() => modelClean) }, { label: 'Rejilla', run: toggleGrid, ...chk(() => grid.visible) },
    { label: 'Líneas de parche', run: () => $('show-iso').click(), ...chk(() => $('show-iso').checked) },
    { label: 'Peine de curvatura', run: () => $('show-comb').click(), ...chk(() => $('show-comb').checked) },
    { sep: true }, { label: 'Ocultar selección', run: hideSelection }, { label: 'Mostrar todo', run: unhideAll }]],
  ['Capas', [
    { label: 'Nueva capa', run: newLayer }, { label: 'Pasar selección a la capa activa', run: () => assignToLayer() },
    { label: 'Mostrar todas las capas', run: () => { checkpoint(); layers.forEach((l) => (l.visible = true)); selectionChanged(); renderLayers(); } },
    { sep: true }, { label: 'Ver capas en el panel', run: () => { setPinned(true); $('outliner').scrollIntoView({ block: 'nearest' }); } }]],
  ['Visualización', [
    ...EVAL_MODES.map((m) => ({ label: m.label, key: m.key, run: () => setDiag(m.k), ...chk(() => layout !== 'render' && diagMode === m.k) })),
    { sep: true }, { title: 'Entorno (Visu)' },
    ...[['studio', 'Estudio'], ['sun', 'Exterior'], ['sunset', 'Atardecer'], ['overcast', 'Nublado']].map(([k, l]) => ({ label: l, run: env(k), ...chk(() => envKey === k) }))]],
  ['Animación', [{ label: 'Plato giratorio', soon: true }, { label: 'Línea de tiempo', soon: true }]],
  ['Ventanas', [
    { label: 'Panel lateral fijo', run: () => setPinned(!pinned), ...chk(() => pinned) }, { label: 'Pantalla completa', run: fullscreen },
    { label: 'Puck', key: 'Tab', run: () => puck.show(innerWidth / 2, innerHeight / 2) }]],
  ['Preferencias', [{ label: 'Preferencias…', run: () => openPrefs() }]],
  ['Utilidades', [
    { label: 'Centrar pivote', run: centerPivots }, { label: 'Punto de interés a la selección', key: 'L', run: pivotToSelection },
    { label: 'Medir distancia', soon: true }]],
  ['Ayuda', [{ label: 'Atajos de teclado', run: () => openPrefs('help') }, { label: 'Acerca de Forja', run: () => toast('FORJA · modelador NURBS libre (Alias + Plasticity + Blender)') }]],
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
  if (!d.open) d.showModal();
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
  $('prefs-close').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => { if (e.target === d) d.close(); });
}
$('ly-new').addEventListener('click', (e) => { e.preventDefault(); newLayer(); });
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

// ---------- Dibujo de cada cuadro ----------
function renderPane(p) {
  renderer.setViewport(p.x, 0, p.w, p.h);
  renderer.setScissor(p.x, 0, p.w, p.h);
  useAspect(p);
  const diag = p.kind !== 'render';                 // MODELADO e IA usan los shaders de evaluación
  const dm = diagMaterial();
  objects.forEach((o) => { if (o.kind !== 'curve') o.parts.mesh.material = diag ? dm : materials[o.mat]; });
  scene.background = !diag && envBg ? scene.environment : null;
  renderer.toneMapping = diag ? THREE.ACESFilmicToneMapping : TONES[toneKey];
  scene.environment = diag ? envTexture('studio') : envTexture(envKey);
  camera.layers.set(0);
  if (diag) camera.layers.enable(DIAG);
  renderer.render(scene, camera);
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
  const on = mouseXform && prefs.xform !== 'gizmo' && tool === 'select' && !pivotEdit && !carousel && !MENUS.some((m) => m.open) && hasTransformable();
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
const INK_SEL = '.top .brand, .top .mb-btn, .top .seg button, .top .tag, .top .file, .pane-head .pane-title, .status > span, .status .viewinfo > span, .mb-drop:not([hidden]) .mb-item, .mb-drop:not([hidden]) .mb-title';
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
    const L = n ? sum / n : bgL;
    el.classList.toggle('ink-dark', L > 0.5);
    el.classList.toggle('ink-light', L <= 0.5);
  }
}
function renderFrame(now) {
  updateXfPrompt();
  pivotMarker.position.copy(pivot);
  pivotMarker.scale.setScalar(camera.position.distanceTo(pivot) * 0.06);
  pivotMarker.visible = navHeld || !!navDrag || now < pivotShowUntil;
  snapRing.quaternion.copy(camera.quaternion);
  snapRing.scale.setScalar(camera.position.distanceTo(snapRing.position) * 0.06);
  syncPivotMarkers();
  scaleHandles();
  renderer.shadowMap.needsUpdate = true;
  if (carousel) renderCarousel(now); else panes().forEach(renderPane);
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
window.__forja = { camera, objects, panes, pivot, selObjs, selCVs, gizmo, proxy, carousel: () => carousel, runAI };
syncMaterialEditor();
showModule(layout);
window.__ready = true;
