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
  for (let it = 0; it < 12; it++) {
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
  for (let it = 0; it < 12; it++) {
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

export function planeData(center, plane = 'xz', w = 4, h = 3) {
  const rows = [];
  for (let i = 0; i < 4; i++) {
    const row = [];
    for (let j = 0; j < 4; j++) {
      const a = (i / 3 - 0.5) * w, b = (j / 3 - 0.5) * h;
      row.push(plane === 'xz'
        ? new THREE.Vector4(center.x + a, center.y, center.z + b, 1)
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

// Revolución alrededor del eje Y. El círculo es NURBS exacto: grado 2, 9 CVs con pesos √2/2 en las esquinas.
export function revolve(c) {
  const s = Math.SQRT1_2;
  const cvs = [];
  for (let k = 0; k < 9; k++) {
    const corner = k % 2 === 1;
    const ang = (k * Math.PI) / 4, rf = corner ? Math.SQRT2 : 1, wc = corner ? s : 1;
    cvs.push(c.cvs.map((p) => {
      const r = Math.hypot(p.x, p.z), a = Math.atan2(p.z, p.x) + ang;
      return new THREE.Vector4(Math.cos(a) * r * rf, p.y, Math.sin(a) * r * rf, p.w * wc);
    }));
  }
  return { degU: 2, knotsU: [0, 0, 0, 0.25, 0.25, 0.5, 0.5, 0.75, 0.75, 1, 1, 1], degV: c.deg, knotsV: c.knots.slice(), cvs };
}
