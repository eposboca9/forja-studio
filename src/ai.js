// Módulo IA de Forja: generadores paramétricos exactos y un intérprete de pedidos en español.
// Los generadores trabajan en milímetros (tornillería) o centímetros (muebles) y devuelven geometría
// en decímetros con Y hacia arriba, que es como trabaja Forja. La base de cada pieza queda en y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as N from './nurbs.js';

const MM = 0.01, CM = 0.1;   // a decímetros

// Rosca métrica ISO gruesa: paso; cabeza hexagonal ISO 4017 (entre caras s, altura k);
// Allen DIN 912 / ISO 4762 (diámetro dk, altura k, llave s); tuerca ISO 4032 (altura m); arandela ISO 7089 (d1, d2, h)
export const ISO = {
  3: { p: 0.5, s: 5.5, k: 2, dk: 5.5, ka: 3, sa: 2.5, m: 2.4, w: [3.2, 7, 0.5] },
  4: { p: 0.7, s: 7, k: 2.8, dk: 7, ka: 4, sa: 3, m: 3.2, w: [4.3, 9, 0.8] },
  5: { p: 0.8, s: 8, k: 3.5, dk: 8.5, ka: 5, sa: 4, m: 4.7, w: [5.3, 10, 1] },
  6: { p: 1, s: 10, k: 4, dk: 10, ka: 6, sa: 5, m: 5.2, w: [6.4, 12, 1.6] },
  8: { p: 1.25, s: 13, k: 5.3, dk: 13, ka: 8, sa: 6, m: 6.8, w: [8.4, 16, 1.6] },
  10: { p: 1.5, s: 16, k: 6.4, dk: 16, ka: 10, sa: 8, m: 8.4, w: [10.5, 20, 2] },
  12: { p: 1.75, s: 18, k: 7.5, dk: 18, ka: 12, sa: 10, m: 10.8, w: [13, 24, 2.5] },
  16: { p: 2, s: 24, k: 10, dk: 24, ka: 16, sa: 14, m: 14.8, w: [17, 30, 3] },
  20: { p: 2.5, s: 30, k: 12.5, dk: 30, ka: 20, sa: 17, m: 18, w: [21, 37, 3] },
};
export const SIZES = Object.keys(ISO).map(Number);

const hexShape = (s) => {
  const r = s / Math.sqrt(3), sh = new THREE.Shape();
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6; i ? sh.lineTo(r * Math.cos(a), r * Math.sin(a)) : sh.moveTo(r * Math.cos(a), r * Math.sin(a)); }
  sh.closePath();
  return sh;
};
const hexPath = (s) => { const p = new THREE.Path(); hexShape(s).getPoints().forEach((v, i) => (i ? p.lineTo(v.x, v.y) : p.moveTo(v.x, v.y))); p.closePath(); return p; };
const circlePath = (r) => { const p = new THREE.Path(); p.absarc(0, 0, r, 0, Math.PI * 2, true); return p; };

// Extrusión vertical de una forma 2D (plano XZ), de y0 a y0 + h
function extrudeY(shape, h, y0, bevel = 0) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: h - 2 * bevel, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 48 });
  g.rotateX(-Math.PI / 2);
  g.translate(0, y0 + bevel, 0);
  return g;
}
function finish(parts, scale) {
  const g = mergeGeometries(parts.map((p) => { const q = p.index ? p.toNonIndexed() : p; q.deleteAttribute('uv'); if (!q.attributes.normal) q.computeVertexNormals(); return q; }));
  g.scale(scale, scale, scale);
  g.computeVertexNormals();
  return g;
}

// Rosca: superficie helicoidal con el perfil triangular ISO (60°), entre y = yBot e y = yTop
function threadGeometry(d, p, yBot, yTop) {
  const H = 0.866025 * p, rMaj = d / 2, rMin = rMaj - 0.625 * H;
  const NA = 64, perTurn = 28, turns = (yTop - yBot) / p, NZ = Math.max(8, Math.ceil(turns * perTurn));
  const pos = [], idx = [];
  // perfil periódico en función de la fase: cresta plana p/8, flancos a 60°, fondo plano p/4
  const prof = (ph) => {
    const t = ((ph % 1) + 1) % 1;
    if (t < 0.0625 || t > 0.9375) return rMaj;
    if (t < 0.4375) return rMaj - (rMaj - rMin) * (t - 0.0625) / 0.375;
    if (t < 0.5625) return rMin;
    return rMin + (rMaj - rMin) * (t - 0.5625) / 0.375;
  };
  for (let j = 0; j <= NZ; j++) {
    const y = yBot + (yTop - yBot) * (j / NZ);
    for (let i = 0; i <= NA; i++) {
      const a = (i / NA) * Math.PI * 2;
      let r = prof(y / p - a / (Math.PI * 2));
      const fade = Math.min(1, (y - yBot) / (1.5 * p), (yTop - y) / (0.8 * p));      // entrada y salida de la rosca
      r = rMin + (r - rMin) * Math.max(0, fade);
      pos.push(r * Math.cos(a), y, -r * Math.sin(a));
    }
  }
  for (let j = 0; j < NZ; j++) for (let i = 0; i < NA; i++) {
    const a = j * (NA + 1) + i, b = a + NA + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Tornillo. d en mm (M), L longitud bajo cabeza en mm, cabeza 'hex' | 'allen'
export function bolt({ d = 6, L = 30, head = 'hex' }) {
  const t = ISO[d] || ISO[6], parts = [];
  const b = Math.min(L, 2 * d + 6);                       // longitud roscada (ISO 4014 para L > b)
  const cham = 0.6 * t.p;
  // punta achaflanada
  parts.push(new THREE.CylinderGeometry(d / 2 - 0.625 * 0.866 * t.p, d / 2 - cham, cham, 48, 1).translate(0, cham / 2, 0));
  parts.push(new THREE.CircleGeometry(d / 2 - cham, 48).rotateX(Math.PI / 2));
  parts.push(threadGeometry(d, t.p, cham, b));
  if (L > b) parts.push(new THREE.CylinderGeometry(d / 2, d / 2, L - b, 48, 1, true).translate(0, b + (L - b) / 2, 0));
  if (head === 'allen') {
    const sh = new THREE.Shape(); sh.absarc(0, 0, t.dk / 2, 0, Math.PI * 2, false);
    const depth = 0.55 * d;
    parts.push(extrudeY(sh, t.ka - depth, L, 0));
    const ring = new THREE.Shape(); ring.absarc(0, 0, t.dk / 2, 0, Math.PI * 2, false); ring.holes.push(hexPath(t.sa));
    parts.push(extrudeY(ring, depth, L + t.ka - depth, 0));
  } else {
    parts.push(extrudeY(hexShape(t.s), t.k, L, Math.min(0.4, t.k * 0.08)));
  }
  const g = finish(parts, MM);
  return { geometry: g, name: `Tornillo M${d}×${L}${head === 'allen' ? ' Allen' : ''}` };
}
export function nut({ d = 6 }) {
  const t = ISO[d] || ISO[6], sh = hexShape(t.s);
  sh.holes.push(circlePath(d / 2 - 0.54 * t.p));
  return { geometry: finish([extrudeY(sh, t.m, 0, Math.min(0.4, t.m * 0.06))], MM), name: `Tuerca M${d}` };
}
export function washer({ d = 6 }) {
  const [d1, d2, h] = (ISO[d] || ISO[6]).w, sh = new THREE.Shape();
  sh.absarc(0, 0, d2 / 2, 0, Math.PI * 2, false); sh.holes.push(circlePath(d1 / 2));
  return { geometry: finish([extrudeY(sh, h, 0, 0)], MM), name: `Arandela M${d}` };
}

// Mesa: medidas en cm. legs: 'recta' | 'conica' | 'redonda' (pata cilíndrica)
// shape: 'rect' | 'redonda' (tablero circular de diámetro w)
export function table({ w = 120, dep = 80, h = 75, legs = 'recta', top = 3, shape = 'rect' }) {
  const parts = [], r = Math.min(4, w * 0.04), round = shape === 'redonda';
  if (round) dep = w;
  const sh = new THREE.Shape(), x = w / 2, z = dep / 2, c = Math.min(3, Math.min(w, dep) * 0.08);
  if (round) sh.absarc(0, 0, w / 2, 0, Math.PI * 2, false);
  else {
    sh.moveTo(-x + c, -z); sh.lineTo(x - c, -z); sh.quadraticCurveTo(x, -z, x, -z + c); sh.lineTo(x, z - c); sh.quadraticCurveTo(x, z, x - c, z);
    sh.lineTo(-x + c, z); sh.quadraticCurveTo(-x, z, -x, z - c); sh.lineTo(-x, -z + c); sh.quadraticCurveTo(-x, -z, -x + c, -z);
  }
  parts.push(extrudeY(sh, top, h - top, 0.4));
  const lh = h - top, inset = round ? w * 0.5 - (w * 0.5 - 6) * Math.SQRT1_2 : 6;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = legs === 'conica' ? new THREE.CylinderGeometry(r, r * 0.45, lh, 32)
      : legs === 'redonda' ? new THREE.CylinderGeometry(r, r, lh, 32)
      : new THREE.BoxGeometry(r * 1.6, lh, r * 1.6);
    leg.translate(sx * (x - inset), lh / 2, sz * (z - inset));
    parts.push(leg);
  }
  return { geometry: finish(parts, CM), name: round ? `Mesa redonda ⌀${w}` : `Mesa ${w}×${dep}` };
}
export function chair({ seat = 45, w = 45, dep = 45, back = 85 }) {
  const parts = [], t = 3, r = 1.6, x = w / 2 - 3, z = dep / 2 - 3;
  parts.push(new THREE.BoxGeometry(w, t, dep).translate(0, seat - t / 2, 0));
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const top = sz < 0 ? back : seat - t;                 // las patas traseras suben y sostienen el respaldo
    parts.push(new THREE.CylinderGeometry(r, r * 0.8, top, 24).translate(sx * x, top / 2, sz * z));
  }
  parts.push(new THREE.BoxGeometry(w - 2, 14, 2).translate(0, back - 9, -z));
  return { geometry: finish(parts, CM), name: `Silla ${seat} cm` };
}

// ---------- Piezas de revolución como superficies NURBS (no mallas) ----------
// Perfil (radio, altura) en cm como CVs de una curva NURBS cúbica, que se gira alrededor del eje Y con un
// círculo NURBS exacto. Devuelven { surfaces: [{ data, name }], name } en decímetros.
const revolveProfile = (pts) => N.revolve(N.curveData(pts.map(([r, y]) => new THREE.Vector3(r * CM, y * CM, 0)), 3, 'xy'));
// forma: 'recto' | 'abombado' | 'conico'
export function vase({ h = 10, d = 8, forma = 'recto', t = 0.3 }) {
  const R = d / 2, rb = forma === 'conico' ? R * 0.7 : R * 0.92, rm = forma === 'abombado' ? R * 1.15 : forma === 'conico' ? R * 0.86 : R * 0.97, b = Math.max(0.5, h * 0.05);
  const pts = [[0, 0], [rb * 0.6, 0], [rb, 0], [rb, h * 0.06], [rm, h * 0.5], [R, h * 0.92], [R, h],
    [R - t / 2, h + t * 0.6], [R - t, h], [R - t, h * 0.92], [rm - t, h * 0.5], [rb - t, b + h * 0.06], [(rb - t) * 0.6, b], [0, b]];
  return { surfaces: [{ data: revolveProfile(pts), name: 'Vaso' }], name: `Vaso ${h} cm` };
}
// Taza con asa: el cuerpo es el vaso NURBS y el asa un tubo curvo pegado al costado
export function mug({ h = 9, d = 8, forma = 'recto' }) {
  const body = vase({ h, d, forma });
  const R = d / 2, x0 = R * (forma === 'abombado' ? 1.05 : 0.98), a = h * 0.78, b = h * 0.25, out = Math.max(2.4, h * 0.32);
  const path = [[x0 - 0.3, a, 0], [x0 + out * 0.6, a + 0.5, 0], [x0 + out, (a + b) / 2 + 0.4, 0], [x0 + out * 0.75, b + 0.3, 0], [x0 - 0.3, b, 0]]
    .map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const g = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path), 64, Math.max(0.35, h * 0.045), 20, false);
  g.scale(CM, CM, CM);
  return { surfaces: [{ data: body.surfaces[0].data, name: 'Cuerpo' }], meshes: [{ geometry: finish([g], 1), name: 'Asa' }], name: `Taza ${h} cm` };
}
export function bowl({ d = 15, h = 7, t = 0.4 }) {
  const R = d / 2, rb = R * 0.42;
  const pts = [[0, 0], [rb * 0.7, 0], [rb, 0], [rb, h * 0.08], [R * 0.82, h * 0.25], [R * 0.98, h * 0.7], [R, h],
    [R - t / 2, h + t * 0.6], [R - t, h], [R * 0.98 - t, h * 0.7], [R * 0.82 - t, h * 0.25 + t], [rb * 0.9, t * 1.5], [0, t * 1.5]];
  return { surfaces: [{ data: revolveProfile(pts), name: 'Cuenco' }], name: `Cuenco ⌀${d}` };
}
export function bottle({ h = 25, d = 7, t = 0.25 }) {
  const R = d / 2, rn = Math.max(1, R * 0.34);
  const pts = [[0, h * 0.01], [R * 0.7, 0], [R, 0], [R, h * 0.04], [R, h * 0.4], [R, h * 0.62], [R * 0.98, h * 0.72],
    [rn * 1.05, h * 0.82], [rn, h * 0.9], [rn, h * 0.98], [rn + t, h], [rn - t, h + t * 0.4], [rn - t, h * 0.95]];
  return { surfaces: [{ data: revolveProfile(pts), name: 'Botella' }], name: `Botella ${h} cm` };
}

// ---------- Objetos libres hechos de piezas (para lo que no está en la biblioteca) ----------
// Claude describe el objeto como piezas sencillas en cm, Y hacia arriba, base del objeto en y = 0:
//   revolve  { profile: [[r, y], ...], smooth }  perfil girado alrededor del eje Y de la pieza -> superficie NURBS
//   extrude  { outline: [[x, z], ...], height, smooth }  contorno cerrado en el plano XZ, extruido hacia arriba -> malla
//   box      { size: [w, h, d], radius }  -> malla (radius = canto redondeado)
//   sphere   { radius }  -> superficie NURBS
//   torus    { radius, tube, arc }  -> malla (asas, aros)
//   tube     { path: [[x, y, z], ...], radius }  -> malla (cables, asas curvas)
// Todas aceptan position [x, y, z], rotation [rx, ry, rz] en grados, name y material.
export const PART_MATERIALS = ['paint', 'black', 'pearl', 'alu', 'chrome', 'ceram', 'glass', 'plastic', 'clay'];
const V3 = (a, d = 0) => new THREE.Vector3(+(a?.[0] ?? d), +(a?.[1] ?? d), +(a?.[2] ?? d));
function partMatrix(pt) {
  const r = V3(pt.rotation).multiplyScalar(Math.PI / 180);
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(r.x, r.y, r.z, 'XYZ'));
  return new THREE.Matrix4().compose(V3(pt.position).multiplyScalar(CM), q, new THREE.Vector3(1, 1, 1));
}
function profileSurface(pts, smooth) {
  const v = pts.map(([r, y]) => new THREE.Vector3(Math.max(0, +r) * CM, +y * CM, 0));
  const c = smooth === false || v.length < 3 ? N.curveData(v, 1, 'xy') : N.fitCurve(v, 3, 'xy');
  return N.revolve(c);
}
export function buildParts(spec) {
  const surfaces = [], meshes = [];
  const parts = Array.isArray(spec?.parts) ? spec.parts.slice(0, 40) : [];
  for (const pt of parts) {
    const M = partMatrix(pt), name = String(pt.name || pt.shape || 'Pieza').slice(0, 40);
    const material = PART_MATERIALS.includes(pt.material) ? pt.material : undefined;
    try {
      if (pt.shape === 'revolve' || pt.shape === 'sphere') {
        let prof = pt.profile;
        if (pt.shape === 'sphere') {
          const R = +pt.radius || 5;
          prof = Array.from({ length: 9 }, (_, k) => { const a = -Math.PI / 2 + (k / 8) * Math.PI; return [R * Math.cos(a), R + R * Math.sin(a)]; });
        }
        if (!Array.isArray(prof) || prof.length < 2) continue;
        const data = profileSurface(prof.slice(0, 60), pt.smooth);
        const v = new THREE.Vector3();
        data.cvs.forEach((row) => row.forEach((c) => { v.set(c.x, c.y, c.z).applyMatrix4(M); c.x = v.x; c.y = v.y; c.z = v.z; }));
        surfaces.push({ data, name, material });
        continue;
      }
      let g = null;
      if (pt.shape === 'extrude' && Array.isArray(pt.outline) && pt.outline.length >= 3) {
        const sh = new THREE.Shape();
        const o = pt.outline.slice(0, 200).map(([x, z]) => new THREE.Vector2(+x, -+z));
        if (pt.smooth) sh.splineThru([...o, o[0]]); else sh.setFromPoints(o);
        g = extrudeY(sh, Math.max(0.05, +pt.height || 1), 0, Math.min(0.2, (+pt.height || 1) * 0.05));
      } else if (pt.shape === 'box') {
        const [w, h, d] = [0, 1, 2].map((i) => Math.max(0.05, +(pt.size?.[i] ?? 5)));
        g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0);
      } else if (pt.shape === 'torus') {
        g = new THREE.TorusGeometry(+pt.radius || 3, +pt.tube || 0.5, 24, 64, ((+pt.arc || 360) * Math.PI) / 180);
      } else if (pt.shape === 'tube' && Array.isArray(pt.path) && pt.path.length >= 2) {
        const curve = new THREE.CatmullRomCurve3(pt.path.slice(0, 60).map((q) => V3(q)));
        g = new THREE.TubeGeometry(curve, 96, +pt.radius || 0.5, 20, false);
      }
      if (!g) continue;
      g.scale(CM, CM, CM);
      g.applyMatrix4(M);
      meshes.push({ geometry: finish([g], 1), name, material });
    } catch (e) { console.warn('pieza no válida', pt, e); }
  }
  return { surfaces, meshes, name: String(spec?.name || 'Objeto').slice(0, 40) };
}
// Generador "custom": un objeto libre descrito por piezas
export const custom = (params) => buildParts(params);

export const GENERATORS = { bolt, nut, washer, table, chair, mug, vase, bowl, bottle, custom };

// ---------- Intérprete de pedidos en español, con preguntas ----------
// Cada tipo tiene sus parámetros en orden de importancia. Lo que el pedido no diga se pregunta
// (como mucho un par de preguntas por pedido) y, si no, se usa el valor por defecto.
const opt = (label, value) => ({ label, value });
const num = (t) => { const m = t.match(/(\d+(?:[.,]\d+)?)/); return m ? +m[1].replace(',', '.') : undefined; };
function nearestSize(d) { return SIZES.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a)); }
export const CATALOG = {
  bolt: {
    label: 'tornillo', plural: 'tornillos', match: /tornillo|perno|bulon|bolt/,
    params: [
      { key: 'd', q: '¿Qué métrica (diámetro)?', options: [3, 4, 5, 6, 8, 10, 12, 16].map((v) => opt('M' + v, v)), def: 6, answer: (t) => { const v = num(t); return v ? nearestSize(v) : undefined; } },
      { key: 'L', q: '¿Qué largo bajo la cabeza?', options: [10, 16, 20, 25, 30, 40, 50, 60].map((v) => opt(v + ' mm', v)), def: (p) => p.d * 5, answer: num },
      { key: 'head', q: '¿Qué cabeza?', options: [opt('Hexagonal', 'hex'), opt('Allen', 'allen')], def: 'hex', answer: (t) => (/allen|hueca|interior|cilindr/.test(t) ? 'allen' : /hex/.test(t) ? 'hex' : undefined) },
      { key: 'n', q: '¿Cuántos?', options: [1, 2, 4, 6, 8].map((v) => opt(String(v), v)), def: 1, answer: num },
    ],
  },
  nut: {
    label: 'tuerca', plural: 'tuercas', match: /tuerca/,
    params: [
      { key: 'd', q: '¿Para qué métrica?', options: [3, 4, 5, 6, 8, 10, 12, 16].map((v) => opt('M' + v, v)), def: 6, answer: (t) => { const v = num(t); return v ? nearestSize(v) : undefined; } },
      { key: 'n', q: '¿Cuántas?', options: [1, 2, 4, 6, 8].map((v) => opt(String(v), v)), def: 1, answer: num },
    ],
  },
  washer: {
    label: 'arandela', plural: 'arandelas', match: /arandela|rondana/,
    params: [
      { key: 'd', q: '¿Para qué métrica?', options: [3, 4, 5, 6, 8, 10, 12, 16].map((v) => opt('M' + v, v)), def: 6, answer: (t) => { const v = num(t); return v ? nearestSize(v) : undefined; } },
      { key: 'n', q: '¿Cuántas?', options: [1, 2, 4, 6, 8].map((v) => opt(String(v), v)), def: 1, answer: num },
    ],
  },
  table: {
    label: 'mesa', plural: 'mesas', match: /mesa|escritorio/,
    params: [
      { key: 'shape', q: '¿Tablero rectangular o redondo?', options: [opt('Rectangular', 'rect'), opt('Redondo', 'redonda')], def: 'rect', answer: (t) => (/redond|circul/.test(t) ? 'redonda' : /rect|cuadr/.test(t) ? 'rect' : undefined) },
      { key: 'size', q: '¿Qué medidas de tablero (cm)?', options: [opt('80 × 80', [80, 80]), opt('120 × 80', [120, 80]), opt('160 × 90', [160, 90]), opt('200 × 100', [200, 100])], def: [120, 80],
        answer: (t) => { const m = t.match(/(\d+)\s*(?:x|×|por)\s*(\d+)/); if (m) return [+m[1], +m[2]]; const v = num(t); return v ? [v, v] : undefined; } },
      { key: 'legs', q: '¿Cómo son las patas?', options: [opt('Rectas', 'recta'), opt('Cónicas', 'conica'), opt('Redondas', 'redonda')], def: 'recta', answer: (t) => (/conic/.test(t) ? 'conica' : /redond|cilindr/.test(t) ? 'redonda' : /rect|cuadrad/.test(t) ? 'recta' : undefined) },
      { key: 'h', q: '¿Qué altura?', options: [opt('45 cm (centro)', 45), opt('75 cm (comedor)', 75), opt('105 cm (barra)', 105)], def: 75, answer: num },
    ],
  },
  chair: {
    label: 'silla', plural: 'sillas', match: /silla|taburete/,
    params: [
      { key: 'seat', q: '¿Qué altura de asiento?', options: [opt('45 cm (normal)', 45), opt('65 cm (cocina)', 65), opt('75 cm (barra)', 75)], def: 45, answer: num },
      { key: 'backH', q: '¿Respaldo bajo, normal o alto?', options: [opt('Bajo', 'bajo'), opt('Normal', 'normal'), opt('Alto', 'alto')], def: 'normal', answer: (t) => (/bajo/.test(t) ? 'bajo' : /alto/.test(t) ? 'alto' : /normal|medio/.test(t) ? 'normal' : undefined) },
      { key: 'n', q: '¿Cuántas?', options: [1, 2, 4, 6].map((v) => opt(String(v), v)), def: 1, answer: num },
    ],
  },
  mug: {
    label: 'taza', plural: 'tazas', match: /taza|tarro|mug\b|jarra/,
    params: [
      { key: 'forma', q: '¿Qué forma de taza?', options: [opt('Recta', 'recto'), opt('Abombada', 'abombado'), opt('Cónica', 'conico')], def: 'recto', answer: (t) => (/abomb|barril|panzon/.test(t) ? 'abombado' : /conic/.test(t) ? 'conico' : /rect/.test(t) ? 'recto' : undefined) },
      { key: 'h', q: '¿Qué tamaño?', options: [opt('Espresso (6 cm)', 6), opt('Normal (9 cm)', 9), opt('Grande (11 cm)', 11)], def: 9, answer: num },
      { key: 'd', q: '¿Qué diámetro de boca?', options: [5, 7, 8, 9].map((v) => opt(v + ' cm', v)), def: 8, answer: num },
    ],
  },
  vase: {
    label: 'vaso', plural: 'vasos', match: /vaso|copa|jarron|florero|maceta/,
    params: [
      { key: 'forma', q: '¿Qué forma?', options: [opt('Recto', 'recto'), opt('Abombado', 'abombado'), opt('Cónico', 'conico')], def: 'recto', answer: (t) => (/abomb|barril|panzon/.test(t) ? 'abombado' : /conic/.test(t) ? 'conico' : /rect/.test(t) ? 'recto' : undefined) },
      { key: 'h', q: '¿Qué altura?', options: [8, 10, 12, 15, 20].map((v) => opt(v + ' cm', v)), def: 10, answer: num },
      { key: 'd', q: '¿Qué diámetro de boca?', options: [6, 7, 8, 10, 12].map((v) => opt(v + ' cm', v)), def: 8, answer: num },
    ],
  },
  bowl: {
    label: 'cuenco', plural: 'cuencos', match: /cuenco|bol\b|bowl|tazon|plato hondo/,
    params: [
      { key: 'd', q: '¿Qué diámetro?', options: [12, 15, 18, 22].map((v) => opt(v + ' cm', v)), def: 15, answer: num },
      { key: 'h', q: '¿Qué profundidad?', options: [5, 7, 9].map((v) => opt(v + ' cm', v)), def: 7, answer: num },
    ],
  },
  bottle: {
    label: 'botella', plural: 'botellas', match: /botella/,
    params: [
      { key: 'h', q: '¿Qué altura?', options: [18, 22, 25, 30].map((v) => opt(v + ' cm', v)), def: 25, answer: num },
      { key: 'd', q: '¿Qué diámetro?', options: [6, 7, 8, 9].map((v) => opt(v + ' cm', v)), def: 7, answer: num },
    ],
  },
};

// Texto normalizado: minúsculas, sin acentos, unidades y "por" unificados
export function normalize(text) {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/milimetros?/g, 'mm').replace(/centimetros?/g, 'cm').replace(/(\d)\s*(?:por|×)\s*(\d)/g, '$1x$2')
    .replace(/(\d),(\d)/g, '$1.$2');
}
const NUMS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, veinte: 20, par: 2 };
const COUNT = '(\\d+|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|doce|veinte|par de)';

// Lo que el texto ya dice de cada parámetro
function extract(type, t) {
  const p = {};
  if (type === 'bolt' || type === 'nut' || type === 'washer') {
    const M = t.match(/\bm\s?(\d{1,2})(?:\s*x\s*(\d+(?:\.\d+)?))?/);
    if (M) { p.d = nearestSize(+M[1]); if (M[2]) p.L = Math.round(+M[2]); }
    if (type === 'bolt') {
      const L = t.match(/(?:largo|longitud|long\.?)\s*(?:de)?\s*(\d+(?:\.\d+)?)/);
      if (L) p.L = Math.round(+L[1]);
      const mm = [...t.matchAll(/(\d+(?:\.\d+)?)\s*mm/g)].map((m) => +m[1]).filter((v) => v !== p.d && v !== p.L);
      for (const v of mm) {
        // un número suelto: si es una métrica ISO y aún no hay diámetro, es el diámetro; si no, el largo
        if (p.d === undefined && SIZES.includes(v) && (mm.length > 1 || v <= 12)) p.d = v;
        else if (p.L === undefined) p.L = Math.round(v);
      }
      if (/allen|cabeza hueca|hexagono interior|cilindric|socket/.test(t)) p.head = 'allen';
      else if (/hexagonal|cabeza hex/.test(t)) p.head = 'hex';
    } else if (p.d === undefined) { const v = t.match(/(\d+(?:\.\d+)?)\s*mm/); if (v) p.d = nearestSize(+v[1]); }
  } else if (type === 'table') {
    const dim = t.match(/(\d+)\s*x\s*(\d+)/);
    if (/redond|circular/.test(t.replace(/patas?\s+redond\w*/, ''))) p.shape = 'redonda';
    else if (/rectangul|cuadrad/.test(t)) p.shape = 'rect';
    if (dim) { p.size = [+dim[1], +dim[2]]; p.shape ??= 'rect'; }
    else { const di = t.match(/(?:diametro|de)\s*(\d+)\s*cm/); if (di && p.shape === 'redonda') p.size = [+di[1], +di[1]]; }
    const h = t.match(/(?:alt[oa]|altura)\s*(?:de)?\s*(\d+)/); if (h) p.h = +h[1];
    if (/centro|baja/.test(t)) p.h ??= 45; if (/barra|alta/.test(t)) p.h ??= 105; if (/comedor/.test(t)) p.h ??= 75;
    if (/conic/.test(t)) p.legs = 'conica'; else if (/patas?\s+(?:\w+\s+)?(?:redond|cilindr)/.test(t)) p.legs = 'redonda'; else if (/patas?\s+rect/.test(t)) p.legs = 'recta';
  } else if (type === 'chair') {
    const s = t.match(/(?:asiento|alt[oa]|altura)\s*(?:de)?\s*(\d+)/); if (s) p.seat = +s[1];
    if (/barra/.test(t)) p.seat ??= 75; if (/cocina/.test(t)) p.seat ??= 65;
    if (/respaldo\s+(?:\w+\s+)?bajo/.test(t)) p.backH = 'bajo'; else if (/respaldo\s+(?:\w+\s+)?alto/.test(t)) p.backH = 'alto';
  } else {
    const h = t.match(/(?:alt[oa]|altura)\s*(?:de)?\s*(\d+(?:\.\d+)?)/); if (h) p.h = +h[1];
    const d = t.match(/(?:diametro|ancho|boca)\s*(?:de)?\s*(\d+(?:\.\d+)?)/); if (d) p.d = +d[1];
    const cms = [...t.matchAll(/(\d+(?:\.\d+)?)\s*cm/g)].map((m) => +m[1]).filter((v) => v !== p.h && v !== p.d);
    for (const v of cms) { if (type === 'bowl' ? p.d === undefined : p.h === undefined) type === 'bowl' ? (p.d = v) : (p.h = v); else if (type === 'bowl' ? p.h === undefined : p.d === undefined) type === 'bowl' ? (p.h = v) : (p.d = v); }
    if (type === 'vase' || type === 'mug') { const a = CATALOG.vase.params[0].answer(t); if (a) p.forma = a; }
  }
  return p;
}

// Devuelve [{ type, given: {...}, n? }] con lo que el pedido dice, o null si no reconoce ningún objeto
export function parsePrompt(text) {
  const t = normalize(text);
  const nouns = Object.values(CATALOG).map((c) => c.match.source).join('|');
  const re = new RegExp(`(?:${COUNT}\\s+(?:\\w+\\s+)?)?(?:${nouns})`, 'g');
  // "lámpara de escritorio", "funda para silla": el objeto conocido solo describe a otro, así que no cuenta
  const hits = [...t.matchAll(re)].filter((m) => m[1] || !/\b(?:de|para|del)\s+$/.test(t.slice(0, m.index)));
  if (!hits.length) return null;
  const out = [];
  hits.forEach((m, i) => {
    const seg = t.slice(m.index, i + 1 < hits.length ? hits[i + 1].index : t.length);
    const type = Object.keys(CATALOG).find((k) => CATALOG[k].match.test(m[0]));
    const given = extract(type, seg);
    if (m[1]) given.n = Math.min(20, +m[1] || NUMS[m[1].replace(' de', '')] || 1);
    out.push({ type, given });
  });
  // "4 tornillos M8 y 4 tuercas": la tuerca y la arandela toman la métrica del tornillo del mismo pedido
  const metric = out.find((it) => it.given.d && ['bolt', 'nut', 'washer'].includes(it.type))?.given.d;
  if (metric) out.forEach((it) => { if (['nut', 'washer'].includes(it.type)) it.given.d ??= metric; });
  return out;
}

// Preguntas pendientes: como mucho `max`, las más importantes de cada objeto que falten
export function questionsFor(items, max = 2) {
  const qs = [];
  for (let round = 0; round < 4 && qs.length < max; round++) {
    items.forEach((it, idx) => {
      const missing = CATALOG[it.type].params.filter((p) => it.given[p.key] === undefined);
      if (missing[round] && qs.length < max) qs.push({ idx, param: missing[round] });
    });
  }
  return qs;
}
// Parámetros finales de cada objeto (lo dicho + respuestas + valores por defecto) -> comandos para los generadores
export function toCommands(items) {
  return items.map((it) => {
    const p = {};
    for (const par of CATALOG[it.type].params) p[par.key] = it.given[par.key] ?? (typeof par.def === 'function' ? par.def(p) : par.def);
    const n = p.n || 1; delete p.n;
    if (it.type === 'table') { [p.w, p.dep] = p.size; delete p.size; }
    if (it.type === 'chair') { p.back = p.seat + ({ bajo: 25, normal: 40, alto: 55 }[p.backH] || 40); delete p.backH; }
    if (it.type === 'bolt') p.L = Math.max(p.d, Math.round(p.L));
    return { type: it.type, params: p, n };
  });
}
// Resumen en palabras de lo que se va a crear
export function describe(cmd) {
  const p = cmd.params, n = cmd.n > 1 ? cmd.n + ' ' : '';
  const c = CATALOG[cmd.type], name = cmd.n > 1 ? c.plural : c.label;
  if (cmd.type === 'bolt') return `${n}${name} M${p.d}×${p.L} cabeza ${p.head === 'allen' ? 'Allen' : 'hexagonal'}`;
  if (cmd.type === 'nut' || cmd.type === 'washer') return `${n}${name} M${p.d}`;
  if (cmd.type === 'table') return `${n}${name} ${p.shape === 'redonda' ? 'redonda ⌀' + p.w : p.w + '×' + p.dep} cm, ${p.h} cm de alto, patas ${p.legs === 'conica' ? 'cónicas' : p.legs === 'redonda' ? 'redondas' : 'rectas'}`;
  if (cmd.type === 'chair') return `${n}${name} con asiento a ${p.seat} cm`;
  if (cmd.type === 'mug') return `${name} ${p.forma === 'conico' ? 'cónica' : p.forma === 'abombado' ? 'abombada' : 'recta'} con asa, ${p.h} cm de alto`;
  if (cmd.type === 'vase') return `${name} ${p.forma === 'conico' ? 'cónico' : p.forma}, ${p.h} cm de alto y ${p.d} cm de boca`;
  return `${name} de ${p.d} cm de diámetro`;
}

// Instrucciones para Claude (cuando la página corre dentro de claude.ai, capacidad "sample")
export const CLAUDE_INSTRUCTIONS = `Eres el módulo IA de Forja, un modelador 3D de superficies NURBS. El usuario pide un objeto en español
(a veces con fotos). Responde SOLO con JSON, de una de estas dos formas:

1) Preguntas, si faltan datos importantes y todavía no hay respuestas (máximo 2, concretas, con 2-4 opciones cortas):
   {"questions":[{"q":"¿...?","options":["...","..."]}]}
   Pregunta lo que más cambia la forma: medida principal real, proporción, estilo/variante, detalles que no se ven en las fotos.

2) El objeto:
   {"items":[{"type":"...","params":{...},"n":1}],"note":"frase corta en español de lo que hiciste"}

Tipos de la biblioteca (úsalos si encajan exactamente):
 bolt {d: métrica ISO mm (3,4,5,6,8,10,12,16,20), L: largo mm, head: "hex"|"allen"}; nut {d}; washer {d};
 table {w, dep, h cm, legs: "recta"|"conica"|"redonda", shape: "rect"|"redonda"}; chair {seat, back cm};
 vase {h, d cm, forma: "recto"|"abombado"|"conico"}; mug (taza con asa) {h, d cm, forma}; bowl {d, h cm}; bottle {h, d cm}.

Para CUALQUIER otro objeto usa "custom" y constrúyelo con piezas (nunca digas que no se puede):
 {"type":"custom","params":{"name":"Lápiz","parts":[ ...piezas... ]}}
 Unidades cm, Y hacia arriba, el objeto apoyado en y = 0 (o tumbado si es su posición natural), centrado en x = z = 0.
 Piezas (todas aceptan "name", "position":[x,y,z], "rotation":[rx,ry,rz] en grados, "material"):
  - {"shape":"revolve","profile":[[r,y],...],"smooth":true}  perfil (radio, altura) girado alrededor del eje Y local; empieza y acaba
    en r = 0 si la pieza es cerrada. smooth:false = tramos rectos con esquinas vivas. Ideal para piezas redondas (es NURBS).
  - {"shape":"extrude","outline":[[x,z],...],"height":h,"smooth":false}  contorno cerrado en el plano XZ extruido hacia +Y
    (perfiles hexagonales, placas, siluetas). smooth:true lo redondea.
  - {"shape":"box","size":[ancho,alto,fondo]}  apoyada en y = 0 local.
  - {"shape":"sphere","radius":r}  apoyada en y = 0 local.
  - {"shape":"torus","radius":R,"tube":r,"arc":360}  en el plano XY local (asas, aros).
  - {"shape":"tube","path":[[x,y,z],...],"radius":r}  tubo por una curva suave (asas, cables, patas curvas).
 materials: paint (pintura roja), black, pearl (azul perlado), alu, chrome, ceram (cerámica), glass, plastic (negro), clay.
 Usa medidas reales y proporciones correctas (consulta lo que sabes del objeto real, p. ej. un lápiz BIC mide 17,5 cm y 0,7 cm
 entre caras hexagonales). Para piezas tumbadas usa rotation (p. ej. [0,0,90] tumba un eje Y sobre X). Entre 1 y 25 piezas.
 Con fotos: estima las proporciones midiendo en las fotos, respeta la silueta y los detalles visibles, y usa la medida real
 que te dé el usuario como escala.`;
