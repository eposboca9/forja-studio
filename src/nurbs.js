// Matemática NURBS de Forja Studio: vectores de nudos, ajuste de puntos y operaciones
// que crean superficies (plano, loft, extrusión, revolución) o cambian grado y spans.
import * as THREE from 'three';
import { NURBSSurface } from 'three/addons/curves/NURBSSurface.js';
import { NURBSCurve } from 'three/addons/curves/NURBSCurve.js';

export const MAX_DEGREE = 7;
export const MAX_SPANS = 16;

// Vector de nudos "clamped" uniforme: la forma empieza y termina en el primer y último CV.
export function clampedKnots(n, p) {
  const k = [];
  for (let i = 0; i <= p; i++) k.push(0);
  const inner = n - p - 1;
  for (let i = 1; i <= inner; i++) k.push(i / (inner + 1));
  for (let i = 0; i <= p; i++) k.push(1);
  return k;
}

// Abscisas de Greville: el parámetro "natural" de cada CV. Sirve para remuestrear una forma con otros CVs.
export function greville(knots, p, n) {
  const g = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = 1; k <= p; k++) s += knots[i + k];
    g.push(p ? s / p : knots[i]);
  }
  return g;
}

export const uniqueKnots = (knots) => [...new Set(knots.map((k) => +k.toFixed(6)))];
export const curveOf = (c) => new NURBSCurve(c.deg, c.knots, c.cvs);
export const surfaceOf = (s) => new NURBSSurface(s.degU, s.degV, s.knotsU, s.knotsV, s.cvs);
const v4 = (p, w = 1) => new THREE.Vector4(p.x, p.y, p.z, w);

export function curveData(points, deg = 3, plane = 'xz') {
  const n = points.length, d = Math.min(deg, n - 1);
  return { deg: d, knots: clampedKnots(n, d), cvs: points.map((p) => v4(p)), plane };
}

// Coloca los CVs para que la curva pase por los puntos objetivo (en sus parámetros de Greville).
// Es una iteración sencilla que converge rápido en formas suaves.
export function fitCurve(targets, deg, plane) {
  const n = targets.length, d = Math.min(deg, n - 1);
  const knots = clampedKnots(n, d), g = greville(knots, d, n);
  const cvs = targets.map((p) => v4(p));
  for (let it = 0; it < 30; it++) {
    const c = new NURBSCurve(d, knots, cvs);
    for (let i = 1; i < n - 1; i++) {
      const p = c.getPoint(g[i]);
      cvs[i].x += targets[i].x - p.x; cvs[i].y += targets[i].y - p.y; cvs[i].z += targets[i].z - p.z;
    }
  }
  return { deg: d, knots, cvs, plane };
}

export function fitSurface(targets, degU, degV) {
  const nu = targets.length, nv = targets[0].length;
  const dU = Math.min(degU, nu - 1), dV = Math.min(degV, nv - 1);
  const knotsU = clampedKnots(nu, dU), knotsV = clampedKnots(nv, dV);
  const gu = greville(knotsU, dU, nu), gv = greville(knotsV, dV, nv);
  const cvs = targets.map((row) => row.map((p) => v4(p)));
  const t = new THREE.Vector3();
  for (let it = 0; it < 30; it++) {
    const s = new NURBSSurface(dU, dV, knotsU, knotsV, cvs);
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
      s.getPoint(gu[i], gv[j], t);
      const c = cvs[i][j], p = targets[i][j];
      c.x += p.x - t.x; c.y += p.y - t.y; c.z += p.z - t.z;
    }
  }
  return { degU: dU, degV: dV, knotsU, knotsV, cvs };
}

const spanParams = (deg, spans) => {
  const n = deg + spans, knots = clampedKnots(n, deg);
  return greville(knots, deg, n);
};

// Cambia grado y spans conservando la forma lo mejor posible (como "Rebuild" en Alias).
export function rebuildCurve(c, deg, spans) {
  const crv = curveOf(c);
  return fitCurve(spanParams(deg, spans).map((t) => crv.getPoint(t)), deg, c.plane);
}

export function rebuildSurface(s, degU, spansU, degV, spansV) {
  const srf = surfaceOf(s);
  const gu = spanParams(degU, spansU), gv = spanParams(degV, spansV);
  // getPoint de la superficie rellena el punto pero no lo devuelve
  const targets = gu.map((u) => gv.map((v) => { const t = new THREE.Vector3(); srf.getPoint(u, v, t); return t; }));
  return fitSurface(targets, degU, degV);
}

export const spansOf = (n, deg) => n - deg;

// ---------- Creación de superficies ----------

// Normal del plano de una curva: 'xz' suelo, 'xy' frente, 'yz' lado; 'free' (dibujada en el aire) = la del polígono de CVs
export function curvePlaneNormal(c) {
  if (c.plane === 'xy') return new THREE.Vector3(0, 0, 1);
  if (c.plane === 'yz') return new THREE.Vector3(1, 0, 0);
  if (c.plane === 'free') {
    // método de Newell sobre el polígono cerrado de CVs
    const n = new THREE.Vector3(), P = c.cvs;
    for (let i = 0; i < P.length; i++) {
      const a = P[i], b = P[(i + 1) % P.length];
      n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
    }
    if (n.lengthSq() > 1e-12) return n.normalize();
  }
  return new THREE.Vector3(0, 1, 0);
}

export function planeData(center, plane = 'xz', w = 4, h = 3) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      const a = (i / 3 - 0.5) * w, b = (j / 3 - 0.5) * h;
      row.push(plane === 'xz'
        ? new THREE.Vector4(center.x + a, center.y, center.z + b, 1)
        : plane === 'yz' ? new THREE.Vector4(center.x, center.y + b, center.z - a, 1)
        : new THREE.Vector4(center.x + a, center.y + b, center.z, 1));
    }
    rows.push(row);
  }
  return { degU: 3, degV: 3, knotsU: clampedKnots(4, 3), knotsV: clampedKnots(4, 3), cvs: rows };
}

// Loft: una superficie que pasa por varias curvas, en el orden en que se seleccionaron.
export function loft(curveList) {
  const n = Math.max(4, ...curveList.map((c) => c.cvs.length));
  const degV = Math.min(3, n - 1);
  const gv = greville(clampedKnots(n, degV), degV, n);
  const targets = curveList.map((c) => { const crv = curveOf(c); return gv.map((t) => crv.getPoint(t)); });
  return fitSurface(targets, Math.min(3, curveList.length - 1), degV);
}

// Extrusión: la curva se desplaza en línea recta. Es exacta: grado 1 en la dirección de extrusión.
export function extrude(c, dir) {
  return {
    degU: 1, knotsU: [0, 0, 1, 1],
    degV: c.deg, knotsV: c.knots.slice(),
    cvs: [c.cvs.map((p) => p.clone()), c.cvs.map((p) => new THREE.Vector4(p.x + dir.x, p.y + dir.y, p.z + dir.z, p.w))],
  };
}

// Revolución. Sin opciones = la de siempre: 360° alrededor del eje vertical por el origen, círculo NURBS exacto.
// o.origin / o.axis: eje de giro (punto y dirección, coordenadas internas); o.angle: grados de barrido (1–360);
// o.pitch: paso helicoidal (avance a lo largo del eje por cada vuelta completa, dm);
// o.rational = false (o pitch ≠ 0): arcos NO racionales de grado o.deg y o.spans tramos, interpolados en sus Greville
// (una hélice no se puede escribir exacta con NURBS; un arco sí, con pesos cos(Δ/2)).
export function revolve(c, o = {}) {
  const O = o.origin ? new THREE.Vector3().copy(o.origin) : new THREE.Vector3();
  const D = (o.axis ? new THREE.Vector3().copy(o.axis) : new THREE.Vector3(0, 1, 0)).normalize();
  const pitch = o.pitch || 0, ang = THREE.MathUtils.degToRad(Math.max(0.5, Math.min(pitch ? 3600 : 360, o.angle ?? 360)));   // más de una vuelta solo con paso (hélice)
  // marco de cada CV del perfil: pie sobre el eje, radio y dos direcciones (e2 = e1 × D, igual que antes: misma orientación)
  const frames = c.cvs.map((p) => {
    const v = new THREE.Vector3(p.x, p.y, p.z), foot = O.clone().addScaledVector(D, v.clone().sub(O).dot(D));
    const rv = v.clone().sub(foot), r = rv.length();
    let e1 = r > 1e-12 ? rv.divideScalar(r) : new THREE.Vector3(1, 0, 0);
    if (r <= 1e-12) { e1 = Math.abs(D.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1); e1.addScaledVector(D, -e1.dot(D)).normalize(); }
    return { foot, r, e1, e2: e1.clone().cross(D), w: p.w ?? 1 };
  });
  // o.start = ángulo inicial del barrido (grados, como el 1.º de los dos ángulos de createRevolvedSurface de Alias): el giro va de
  // start a start + angle; la hélice sube según lo girado desde el inicio (el perfil girado a "start" no cambia de altura)
  const a0 = THREE.MathUtils.degToRad(o.start || 0);
  const at = (f, a, rr = f.r) => f.foot.clone().addScaledVector(f.e1, Math.cos(a0 + a) * rr).addScaledVector(f.e2, Math.sin(a0 + a) * rr).addScaledVector(D, (pitch * a) / (2 * Math.PI));
  const rational = o.rational !== false && !pitch;
  if (rational) {
    const n = Math.max(1, Math.ceil(ang / (Math.PI / 2) - 1e-9)), dA = ang / n, cw = Math.cos(dA / 2);
    const knotsU = [0, 0, 0]; for (let k = 1; k < n; k++) knotsU.push(k / n, k / n); knotsU.push(1, 1, 1);
    const cvs = [];
    for (let k = 0; k <= 2 * n; k++) {
      const mid = k % 2 === 1, a = (k * dA) / 2;
      cvs.push(frames.map((f) => { const q = at(f, a, mid ? f.r / cw : f.r); return new THREE.Vector4(q.x, q.y, q.z, f.w * (mid ? cw : 1)); }));
    }
    return { degU: 2, knotsU, degV: c.deg, knotsV: c.knots.slice(), cvs };
  }
  const deg = Math.max(1, Math.min(MAX_DEGREE, o.deg || 3)), spans = Math.max(1, Math.min(MAX_SPANS * 2, o.spans || Math.max(4, Math.ceil((ang / (Math.PI / 2)) * 2))));
  const nU = deg + spans, knotsU = clampedKnots(nU, deg), g = greville(knotsU, deg, nU);
  // cada fila (un CV del perfil) se interpola como curva no racional a lo largo del giro; todas comparten nudos
  const rows = frames.map((f) => fitCurve(g.map((t) => at(f, t * ang)), deg).cvs);
  const cvs = g.map((_, i) => frames.map((f, j) => new THREE.Vector4(rows[j][i].x, rows[j][i].y, rows[j][i].z, f.w)));
  return { degU: deg, knotsU, degV: c.deg, knotsV: c.knots.slice(), cvs };
}
