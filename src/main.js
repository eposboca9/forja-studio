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
const hullMat = new THREE.LineDashedMaterial({ color: '#2d6aa8', dashSize: 0.12, gapSize: 0.08, transparent: true, opacity: 0.7 });
const combMat = new THREE.LineBasicMaterial({ color: '#e07a1f', transparent: true, opacity: 0.55 });
const envMat = new THREE.LineBasicMaterial({ color: '#e07a1f' });
const handleGeo = new THREE.SphereGeometry(0.075, 16, 12);
const handleMat = new THREE.MeshBasicMaterial({ color: '#2d6aa8', depthTest: false, transparent: true });
const handleSelMat = new THREE.MeshBasicMaterial({ color: '#e07a1f', depthTest: false, transparent: true });

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
  const obj = { id: nextId++, kind: 'surface', name: nameFor(base), data, mat: matKey, visible: true, parts: {}, pivot: cvCenter(data) };
  const p = obj.parts;
  p.mesh = new THREE.Mesh(new THREE.BufferGeometry(), materials[obj.mat]);
  p.mesh.castShadow = true;
  p.mesh.userData.obj = obj;
  p.iso = new LineSegments2(new LineSegmentsGeometry(), isoMat); p.iso.layers.set(DIAG);
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
  const obj = { id: nextId++, kind: 'curve', name: nameFor(base), data, visible: true, parts: {}, pivot: cvCenter(data) };
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
  const obj = { id: nextId++, kind: 'mesh', name: nameFor(base), data: { geometry }, mat: matKey, visible: true, parts: {},
    pivot: geometry.boundingBox.getCenter(new THREE.Vector3()) };
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
  if (pivotEdit && (pickMode !== 'object' || !selObjs.length)) { pivotEdit = false; gizmo.setMode(xform); updateXformButtons(); }
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
function setXform(m) {
  xform = m; pivotEdit = false;
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
  gizmo.attach(proxy);
}
let gizmoDrag = null;
gizmo.addEventListener('mouseDown', () => {
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
    const hit = ray.intersectObjects(live.flatMap((o) => o.parts.handles.children), false)[0];
    return hit ? { cv: hit.object.userData } : null;
  }
  ray.params.Line.threshold = camera.position.distanceTo(pivot) * 0.012;
  const hit = ray.intersectObjects(live.map((o) => pickTarget(o)), false)[0];
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
  const nav = navStyle === 'alias' ? 'Shift+Alt: navegar' : 'Shift+arrastrar: recuadro';
  const what = pickMode === 'cv' ? 'CVs' : 'objetos';
  $('hint').textContent = `Clic: seleccionar ${what} · Arrastrar: recuadro · ${nav} (clic rápido: punto de interés) · W/E/R: mover/rotar/escalar · Alt/Ctrl/Ctrl+Alt: snap · Espacio: menú`;
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
    items = live.filter((o) => {
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
function refreshOutliner() {
  const ul = $('outliner');
  ul.innerHTML = '';
  for (const o of objects) {
    const li = document.createElement('li');
    li.className = 'ol-item' + (selObjs.includes(o) ? ' sel' : '') + (o.visible ? '' : ' off');
    li.innerHTML = `<button class="ol-name" title="Seleccionar (Shift: añadir)"><span class="ol-ico">${{ surface: '◩', curve: '∿', mesh: '△' }[o.kind]}</span>${o.name}</button><button class="ol-eye" aria-pressed="${o.visible}" title="${o.visible ? 'Ocultar' : 'Mostrar'}">${EYE}</button>`;
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
}
document.querySelectorAll('[data-diag]').forEach((b) => b.addEventListener('click', () => setDiag(b.dataset.diag)));
const LAYOUTS = ['split', 'diag', 'render'];
// Carrusel 3D: el módulo actual gira sobre sí mismo, se aleja y se hace pequeño hacia un lado,
// mientras el siguiente entra por el otro lado girando y creciendo. Los dos se dibujan a la vez.
let carousel = null;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
function switchLayout(l) {
  if (l === layout || carousel) return;
  if (l === 'split' || layout === 'split' || reduceMotion.matches) { setLayout(l); return; }
  const ORDER = ['diag', 'render', 'ai'];
  carousel = { t0: performance.now(), dur: 1300, from: layout, to: l, swapped: false, dir: ORDER.indexOf(l) > ORDER.indexOf(layout) ? 1 : -1,
    pos: camera.position.clone(), quat: camera.quaternion.clone(), piv: pivot.clone() };
  flipPanel(l);
}
// Pose de la cámara para un módulo en la posición s del carrusel (0 = delante, ±1 = fuera, a un lado)
function carouselPose(c, s) {
  const d = c.pos.distanceTo(c.piv), a = Math.abs(s);
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s * c.dir * THREE.MathUtils.degToRad(150));
  const pos = c.pos.clone().sub(c.piv).applyQuaternion(q).multiplyScalar(1 + 4.5 * a * a).add(c.piv);
  const quat = q.clone().multiply(c.quat);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
  pos.addScaledVector(right, -s * c.dir * d * 2.2 * a);            // se desplaza hacia un lado mientras se aleja
  return { pos, quat };
}
function renderCarousel(now) {
  const c = carousel, k = Math.min(1, (now - c.t0) / c.dur);
  const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;   // suave al empezar y al terminar
  if (!c.swapped && e >= 0.5) { c.swapped = true; setLayout(c.to); }
  const full = { x: 0, w: view.clientWidth, h: Math.max(view.clientHeight, 1) };
  const showG = ground.visible;
  ground.visible = false;                                             // sin sombra doble durante el giro
  const bg = envBg; envBg = false;
  // primero el que está más lejos, después el más cercano
  const passes = [[c.from, e], [c.to, e - 1]].sort((p1, p2) => Math.abs(p2[1]) - Math.abs(p1[1]));
  passes.forEach(([kind, s], n) => {
    const p = carouselPose(c, s);
    camera.position.copy(p.pos); camera.quaternion.copy(p.quat);
    renderer.autoClear = n === 0;
    if (n > 0) renderer.clearDepth();
    renderPane({ ...full, kind });
  });
  renderer.autoClear = true;
  envBg = bg; ground.visible = showG;
  camera.position.copy(c.pos); camera.quaternion.copy(c.quat);
  if (k === 1) { carousel = null; bgFadeT0 = now; }
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
async function askClaude(text) {
  // Dentro de claude.ai la página puede preguntarle a Claude (capacidad "sample"); en GitHub Pages no hay IA conectada
  sampleCap ??= window.claude?.use ? await window.claude.use('sample').catch(() => null) : null;
  if (!sampleCap) return null;
  const r = await sampleCap.json(`${AI.CLAUDE_INSTRUCTIONS}\n\nPedido: ${text}`, { modelTier: 'quick' });
  return r && Array.isArray(r.items) ? r : null;
}
function placeGenerated(cmds) {
  const box = boundsOf(objects.filter((o) => o.visible));
  let x = box.isEmpty() ? 0 : box.max.x + 1;
  const created = [];
  for (const c of cmds) {
    const gen = AI.GENERATORS[c.type];
    if (!gen) continue;
    for (let k = 0; k < Math.min(20, c.n || 1); k++) {
      const { geometry, name } = gen(c.params || {});
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
async function runAI(text) {
  text = text.trim();
  if (!text) return;
  const log = (msg) => { const li = document.createElement('li'); li.innerHTML = msg; $('ai-log').prepend(li); };
  $('ai-status').textContent = 'Pensando…';
  let cmds = AI.parsePrompt(text), note = '';
  if (!cmds) {
    try { const r = await askClaude(text); if (r) { cmds = r.items; note = r.note || ''; } } catch (e) { console.warn(e); }
  }
  if (!cmds || !cmds.length) {
    $('ai-status').textContent = note || 'No entendí el pedido. Prueba con tornillos, tuercas, arandelas, mesas o sillas, con sus medidas.';
    log(`<b>${text.replace(/</g, '&lt;')}</b> · sin resultado`);
    return;
  }
  const created = placeGenerated(cmds);
  setPickMode('object');
  applySelection(created, 'replace');
  frameObjects(created);
  $('ai-status').textContent = note || `Creado: ${created.map((o) => o.name).join(', ')}.`;
  log(`<b>${text.replace(/</g, '&lt;')}</b> → ${created.length} ${created.length === 1 ? 'objeto' : 'objetos'}`);
  updateStatus();
}
$('ai-go').addEventListener('click', () => runAI($('ai-prompt').value));
$('ai-prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runAI(e.target.value); } });
document.querySelectorAll('#ai-chips .chip').forEach((b) => b.addEventListener('click', () => { $('ai-prompt').value = b.textContent; runAI(b.textContent); }));

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
  else if (k === 'v') cycleLayout();
  else if (k === 'o') setPickMode('object');
  else if (k === 'p') setPickMode('cv');
  else if (k === '4') setDiag('showroom');
  else if (k === '5') setDiag('diffuse');
  else if (k === '6') setDiag('sky');
  else if (k === '1') setDiag('zebra');
  else if (k === '2') setDiag('curv');
  else if (k === '3') setDiag('wire');
  else if (k === 'enter' && tool === 'curve') finishDraft();
  else if (k === 'escape') { if (tool !== 'select') setTool('select'); else if (pivotEdit) togglePivotEdit(); else clearSelection(); }
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
function pickNothing() { setTool('select'); clearSelection(); }
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
  selObjs.forEach((o) => (o.visible = false));
  clearSelection();
  toast(`${n} ${n === 1 ? 'objeto oculto' : 'objetos ocultos'} · Mostrar todo en el Puck (Tab)`);
}
function unhideAll() { objects.forEach((o) => (o.visible = true)); selectionChanged(); toast('Todo visible'); }
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
  cv: 'M4 18C8 6 16 18 20 6M3 17h2v2H3zM19 5h2v2h-2zM11 11h2v2h-2z', move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
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

// Puck (Tab): anillo interior = crear y superficies; anillo exterior = elegir, transformar y mostrar.
const PUCK = [
  [
    { k: 'curve', label: 'Curva', key: 'C', run: () => setTool('curve') },
    { k: 'plane', label: 'Plano', run: () => setTool('plane') },
    { k: 'revolve', label: 'Revolución', run: () => OPS.revolve() },
    { k: 'loft', label: 'Loft', run: () => OPS.loft() },
    { k: 'extrude', label: 'Extruir', run: () => OPS.extrude() },
    { k: 'dup', label: 'Duplicar', run: duplicateSelection },
    { k: 'align', label: 'Align', soon: true },
    { k: 'blend', label: 'Blend', soon: true },
    { k: 'round', label: 'Round', soon: true },
    { k: 'offset', label: 'Offset', soon: true },
  ],
  [
    { k: 'nothing', label: 'Nada', run: pickNothing },
    { k: 'object', label: 'Objeto', key: 'O', run: () => setPickMode('object') },
    { k: 'cv', label: 'CV', key: 'P', run: () => setPickMode('cv') },
    { k: 'move', label: 'Mover', key: 'W', run: () => { setTool('select'); setXform('translate'); } },
    { k: 'rotate', label: 'Rotar', key: 'E', run: () => { setTool('select'); setXform('rotate'); } },
    { k: 'scale', label: 'Escalar', key: 'R', run: () => { setTool('select'); setXform('scale'); } },
    { k: 'pivot', label: 'Pivote', key: 'D', run: togglePivotEdit },
    { k: 'frame', label: 'Encuadrar', key: 'F', run: frameSelection },
    { k: 'top', label: 'Vista sup.', key: 'T', run: topView },
    { k: 'hide', label: 'Ocultar', run: hideSelection },
    { k: 'show', label: 'Mostrar todo', run: unhideAll },
    { k: 'del', label: 'Borrar', key: 'Supr', run: deleteSelection },
    { k: 'symm', label: 'Simetría', soon: true },
    { k: 'measure', label: 'Distancia', soon: true },
  ],
];
// Menú de visualización (Espacio o Ctrl+Shift+clic), como el marking menu de Alias
const DISPLAY = [[
  { k: 'info', label: 'Información', run: () => { $('panel').classList.add('show'); } },
  { k: 'shade', label: 'Modelado', key: 'V', run: () => switchLayout('diag') },
  { k: 'visu', label: 'Visu', key: 'V', run: () => switchLayout('render') },
  { k: 'ai', label: 'IA', run: () => switchLayout('ai') },
  { k: 'ctrlOn', label: 'Controls ON', run: () => setPickMode('cv') },
  { k: 'full', label: 'Pantalla completa', run: fullscreen },
  { k: 'panel', label: 'Panel', run: () => setPinned(!pinned) },
  { k: 'split', label: 'Dividida', run: () => switchLayout('split') },
  { k: 'ctrlOff', label: 'Controls OFF', run: () => setPickMode('object') },
  { k: 'grid', label: 'Toggle Grid', run: toggleGrid },
  { k: 'model', label: 'Toggle Model', run: toggleModel },
]];

function makeRadial(rings, radii) {
  const el = document.createElement('div');
  el.className = 'puck'; el.hidden = true;
  const R = radii[radii.length - 1] + 48;
  el.innerHTML = `<svg class="puck-lines" viewBox="${-R} ${-R} ${2 * R} ${2 * R}" width="${2 * R}" height="${2 * R}" style="left:${-R}px;top:${-R}px">
      ${radii.map((r) => `<circle r="${r}" />`).join('')}<line id="" x1="0" y1="0" x2="0" y2="0" /></svg>
    <div class="puck-center"><b></b><span></span></div>`;
  document.body.append(el);
  const line = el.querySelector('line'), cName = el.querySelector('.puck-center b'), cHint = el.querySelector('.puck-center span');
  const items = [];
  rings.forEach((ring, ri) => ring.forEach((it, n) => {
    const a = -Math.PI / 2 + (n / ring.length) * Math.PI * 2, r = radii[ri];
    const b = document.createElement('button');
    b.className = 'puck-item' + (it.soon ? ' soon' : '');
    b.innerHTML = `<i>${icon(it.k)}</i><span>${it.label}</span>`;
    b.style.left = Math.cos(a) * r + 'px'; b.style.top = Math.sin(a) * r + 'px';
    b.setAttribute('aria-label', it.label);
    el.append(b);
    items.push({ it, b, a, ri, x: Math.cos(a) * r, y: Math.sin(a) * r });
  }));
  const st = { el, open: false, at: { x: 0, y: 0 }, hover: null, sticky: false };
  st.highlight = (h) => {
    st.hover = h;
    items.forEach((x) => x.b.classList.toggle('on', x === h));
    line.setAttribute('x2', h ? h.x : 0); line.setAttribute('y2', h ? h.y : 0);
    cName.textContent = h ? h.it.label : '';
    cHint.textContent = h ? (h.it.soon ? 'próximamente' : h.it.key || '') : 'suelta sobre una opción';
  };
  st.pickAt = (x, y) => {
    const dx = x - st.at.x, dy = y - st.at.y, d = Math.hypot(dx, dy);
    if (d < 42) return st.highlight(null);
    const ri = radii.length === 1 || d < (radii[0] + radii[1]) / 2 ? 0 : 1;
    const ring = items.filter((x) => x.ri === ri), ang = Math.atan2(dy, dx);
    let best = null, bd = 1e9;
    for (const x of ring) { const da = Math.abs(Math.atan2(Math.sin(ang - x.a), Math.cos(ang - x.a))); if (da < bd) { bd = da; best = x; } }
    st.highlight(best);
  };
  st.show = (x, y) => {
    const m = R * 0.9;
    st.at = { x: Math.min(innerWidth - m, Math.max(m, x)), y: Math.min(innerHeight - m, Math.max(m, y)) };
    el.style.left = st.at.x + 'px'; el.style.top = st.at.y + 'px';
    el.hidden = false; st.open = true; st.sticky = false; st.highlight(null);
  };
  st.close = (run) => {
    if (!st.open) return;
    st.open = false; el.hidden = true;
    const h = st.hover;
    if (run && h) (h.it.soon ? soon(h.it.label) : h.it.run)();
  };
  items.forEach((x) => {
    x.b.addEventListener('pointerenter', () => st.highlight(x));
    x.b.addEventListener('click', () => { st.highlight(x); st.close(true); });
  });
  return st;
}
const puck = makeRadial(PUCK, [96, 178]);
const disp = makeRadial(DISPLAY, [132]);
let lastPtr = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => {
  lastPtr = { x: e.clientX, y: e.clientY };
  for (const m of [puck, disp]) if (m.open) m.pickAt(e.clientX, e.clientY);
});
addEventListener('pointerdown', (e) => {
  for (const m of [puck, disp]) if (m.open && m.sticky && !e.target.closest('.puck')) m.close(false);
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
addEventListener('keydown', (e) => { if (e.key === 'Escape') { puck.close(false); disp.close(false); } }, true);
let radialByMouse = false;
addEventListener('pointerdown', (e) => {
  if (!(e.ctrlKey && e.shiftKey) || e.target !== renderer.domElement) return;
  e.stopImmediatePropagation(); e.preventDefault();
  radialByMouse = true; disp.show(e.clientX, e.clientY);
}, true);
addEventListener('pointerup', (e) => {
  if (!radialByMouse) return;
  radialByMouse = false; e.stopImmediatePropagation(); disp.close(true);
}, true);

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
function renderFrame(now) {
  pivotMarker.position.copy(pivot);
  pivotMarker.scale.setScalar(camera.position.distanceTo(pivot) * 0.06);
  pivotMarker.visible = navHeld || !!navDrag || now < pivotShowUntil;
  snapRing.quaternion.copy(camera.quaternion);
  snapRing.scale.setScalar(camera.position.distanceTo(snapRing.position) * 0.06);
  syncPivotMarkers();
  renderer.shadowMap.needsUpdate = true;
  if (carousel) renderCarousel(now); else panes().forEach(renderPane);
  scene.backgroundIntensity = Math.min(1, (now - bgFadeT0) / 450);   // el fondo de VISU aparece suave tras el giro
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
