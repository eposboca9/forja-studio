// Construcción con historial de Forja: operaciones que dependen de otras superficies y se recalculan
// cuando cambian (como el "construction history" de Alias).
//  - Align: el borde de una superficie se ajusta al de otra con continuidad G0, G1, G2 o G3.
//  - Blend: superficie de unión entre dos bordes, G1 o G2 en ambos lados.
//  - Offset: copia separada una distancia a lo largo de la normal.
//  - Simetría: copia reflejada en el plano YZ (x = 0).
import * as THREE from 'three';
import * as N from './nurbs.js';

// ---------- Bordes y filas de CVs ----------
// Bordes: 'u0' / 'u1' = primera / última fila en U (el borde corre en V); 'v0' / 'v1' = en V (corre en U).
export const EDGE_NAMES = { u0: 'borde U inicial', u1: 'borde U final', v0: 'borde V inicial', v1: 'borde V final' };
const isU = (e) => e[0] === 'u';
const atEnd = (e) => e[1] === '1';
const sizes = (d) => ({ nu: d.cvs.length, nv: d.cvs[0].length });
// fila k contando desde el borde, en el orden de la dirección del borde
export function row(d, e, k) {
  const { nu, nv } = sizes(d);
  if (isU(e)) { const i = atEnd(e) ? nu - 1 - k : k; return d.cvs[i]; }
  const j = atEnd(e) ? nv - 1 - k : k;
  return d.cvs.map((r) => r[j]);
}
// dirección a lo largo del borde y dirección que lo cruza
export const along = (d, e) => (isU(e) ? { deg: d.degV, knots: d.knotsV, n: sizes(d).nv } : { deg: d.degU, knots: d.knotsU, n: sizes(d).nu });
const reverseKnots = (k) => { const a = k[0], b = k[k.length - 1]; return k.slice().reverse().map((t) => a + b - t); };
export function cross(d, e) {
  const c = isU(e) ? { deg: d.degU, knots: d.knotsU, n: sizes(d).nu } : { deg: d.degV, knots: d.knotsV, n: sizes(d).nv };
  return { ...c, knots: atEnd(e) ? reverseKnots(c.knots) : c.knots }; // nudos vistos desde el borde
}
const sameKnots = (a, b) => a.length === b.length && a.every((t, i) => Math.abs(t - b[i]) < 1e-6);
// borde más cercano a un punto (u, v) de la superficie
export function nearestEdge(u, v) {
  const c = [['u0', u], ['u1', 1 - u], ['v0', v], ['v1', 1 - v]];
  return c.sort((a, b) => a[1] - b[1])[0][0];
}
// puntos del borde, para dibujarlo
export function edgePoints(d, e, n = 48) {
  const s = N.surfaceOf(d), out = [];
  for (let k = 0; k <= n; k++) {
    const t = k / n, p = new THREE.Vector3();
    if (isU(e)) s.getPoint(atEnd(e) ? 1 : 0, t, p); else s.getPoint(t, atEnd(e) ? 1 : 0, p);
    out.push(p);
  }
  return out;
}
// ¿el borde B va en sentido contrario al A? (se compara por los extremos)
export function reversed(dA, eA, dB, eB) {
  const a = row(dA, eA, 0), b = row(dB, eB, 0);
  const d = (p, q) => Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z);
  return d(a[0], b[0]) + d(a[a.length - 1], b[b.length - 1]) > d(a[0], b[b.length - 1]) + d(a[a.length - 1], b[0]);
}

// ---------- Derivadas en el borde ----------
// Derivadas 0..K de una B-spline "clamped" en su inicio, a partir de sus primeros CVs y nudos (Piegl & Tiller).
function startDerivs(P, knots, p, K) {
  let Q = P.map((v) => v.clone());
  const out = [Q[0].clone()];
  for (let k = 1; k <= K; k++) {
    const nq = [];
    for (let i = 0; i < Q.length - 1; i++) {
      const den = knots[i + p + 1] - knots[i + k];
      nq.push(Q[i + 1].clone().sub(Q[i]).multiplyScalar(k <= p && den > 1e-12 ? (p - k + 1) / den : 0));
    }
    Q = nq;
    out.push(Q[0] ? Q[0].clone() : new THREE.Vector3());
  }
  return out;
}
const xyz = (v) => new THREE.Vector3(v.x, v.y, v.z);

// Deja la superficie que se ajusta lista: misma estructura que la maestra a lo largo del borde (grado, CVs y nudos)
// y grado y filas suficientes al cruzarlo. Devuelve los datos (nuevos solo si hizo falta reconstruir).
export function prepareSlave(S, sEdge, M, mEdge, cont, rev) {
  const ma = along(M, mEdge);
  let d = S;
  const sa = along(d, sEdge);
  if (sa.deg !== ma.deg || sa.n !== ma.n) {
    d = isU(sEdge) ? N.rebuildSurface(d, d.degU, d.cvs.length - d.degU, ma.deg, ma.n - ma.deg) : N.rebuildSurface(d, ma.deg, ma.n - ma.deg, d.degV, d.cvs[0].length - d.degV);
  }
  const sc = cross(d, sEdge);
  if (sc.deg < cont || sc.n < cont + 2) {
    const n = Math.max(sc.n, cont + 2), deg = Math.min(Math.max(sc.deg, cont, 1), n - 1);
    d = isU(sEdge) ? N.rebuildSurface(d, deg, n - deg, d.degV, d.cvs[0].length - d.degV) : N.rebuildSurface(d, d.degU, d.cvs.length - d.degU, deg, n - deg);
  }
  const k = rev ? reverseKnots(ma.knots) : ma.knots.slice();
  if (isU(sEdge)) { if (!sameKnots(d.knotsV, k)) d = { ...d, knotsV: k }; } else if (!sameKnots(d.knotsU, k)) d = { ...d, knotsU: k };
  return d;
}

// Ajuste: las filas 0..cont de S (desde su borde) se calculan para que sus derivadas al cruzar el borde sean
// las de M multiplicadas por (-λ)^k (el signo porque cada superficie avanza hacia su propio lado).
// G0 = posición, G1 = tangencia, G2 = curvatura, G3 = variación de curvatura.
export function alignRows(S, sEdge, M, mEdge, cont, lambda, rev) {
  const mc = cross(M, mEdge), sc = cross(S, sEdge);
  const mRows = [], sRows = [];
  for (let k = 0; k <= cont; k++) { mRows.push(row(M, mEdge, k)); sRows.push(row(S, sEdge, k)); }
  const n = sRows[0].length;
  for (let j = 0; j < n; j++) {
    const jm = rev ? n - 1 - j : j;
    const m0 = mRows[0][jm];
    const s0 = sRows[0][j];
    s0.set(m0.x, m0.y, m0.z, m0.w);
    if (!cont) continue;
    const Dm = startDerivs(mRows.map((r) => xyz(r[jm])), mc.knots, mc.deg, cont);
    const P = sRows.map((r) => xyz(r[j]));
    for (let k = 1; k <= cont; k++) {
      const target = Dm[k].clone().multiplyScalar((-lambda) ** k);
      P[k].set(0, 0, 0);
      const D0 = startDerivs(P.slice(0, k + 1), sc.knots, sc.deg, k)[k];
      P[k].set(1, 1, 1);
      const c = startDerivs(P.slice(0, k + 1), sc.knots, sc.deg, k)[k].x - D0.x;
      P[k].copy(target.sub(D0).divideScalar(Math.abs(c) > 1e-12 ? c : 1));
      sRows[k][j].set(P[k].x, P[k].y, P[k].z, m0.w);
    }
  }
}
// λ inicial: que la tangente de S conserve su tamaño actual (así al crear el ajuste la forma cambia lo mínimo)
export function naturalLambda(S, sEdge, M, mEdge, rev) {
  const mc = cross(M, mEdge), sc = cross(S, sEdge);
  const m0 = row(M, mEdge, 0), m1 = row(M, mEdge, 1), s0 = row(S, sEdge, 0), s1 = row(S, sEdge, 1);
  let a = 0, b = 0;
  for (let j = 0; j < s0.length; j++) {
    const jm = rev ? s0.length - 1 - j : j;
    a += startDerivs([xyz(s0[j]), xyz(s1[j])], sc.knots, sc.deg, 1)[1].length();
    b += startDerivs([xyz(m0[jm]), xyz(m1[jm])], mc.knots, mc.deg, 1)[1].length();
  }
  return b > 1e-9 && a > 1e-9 ? a / b : 1;
}
export function align(rel, M, S) {
  const d = prepareSlave(S, rel.sEdge, M, rel.mEdge, rel.cont, rel.rev);
  alignRows(d, rel.sEdge, M, rel.mEdge, rel.cont, rel.lambda0 * rel.tension, rel.rev);
  return d;
}

// ---------- Blend: superficie de unión entre dos bordes ----------
// Hace falta que los dos bordes tengan la misma estructura (grado, CVs y nudos), como en un Freeform Blend
// "explícito". La superficie nueva corre en U a lo largo de los bordes y en V los cruza (4 filas G1, 6 filas G2).
export function blendCompatible(A, eA, B, eB) {
  const a = along(A, eA), b = along(B, eB), rev = reversed(A, eA, B, eB);
  return a.deg === b.deg && a.n === b.n && sameKnots(a.knots, rev ? reverseKnots(b.knots) : b.knots);
}
export function blendData(rel, A, B) {
  const a = along(A, rel.aEdge), cont = rel.cont, nv = cont === 2 ? 6 : 4, degV = nv - 1;
  const r0 = row(A, rel.aEdge, 0), b0 = row(B, rel.bEdge, 0), n = r0.length;
  const cvs = [];
  for (let i = 0; i < n; i++) {
    const p = r0[i], q = b0[rel.rev ? n - 1 - i : i], col = [];
    for (let j = 0; j < nv; j++) { const t = j / (nv - 1); col.push(new THREE.Vector4(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t, p.w)); }
    cvs.push(col);
  }
  const d = { degU: a.deg, degV, knotsU: a.knots.slice(), knotsV: N.clampedKnots(nv, degV), cvs };
  if (rel.lambdaA == null) { rel.lambdaA = naturalLambda(d, 'v0', A, rel.aEdge, false); rel.lambdaB = naturalLambda(d, 'v1', B, rel.bEdge, rel.rev); }
  alignRows(d, 'v0', A, rel.aEdge, cont, rel.lambdaA * rel.tension, false);
  alignRows(d, 'v1', B, rel.bEdge, cont, rel.lambdaB * rel.tension, rel.rev);
  return d;
}

// ---------- Offset y simetría ----------
function normalAt(s, u, v) {
  const e = 1e-3, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3();
  const u0 = Math.max(0, u - e), u1 = Math.min(1, u + e), v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
  s.getPoint(u1, v, a); s.getPoint(u0, v, b); s.getPoint(u, v1, c); s.getPoint(u, v0, d);
  return a.sub(b).cross(c.sub(d)).normalize();
}
export function offsetData(src, dist) {
  const s = N.surfaceOf(src), nu = src.cvs.length, nv = src.cvs[0].length;
  const kn = (k) => (k - src.knotsU[0]) / (src.knotsU[src.knotsU.length - 1] - src.knotsU[0]);
  const kv = (k) => (k - src.knotsV[0]) / (src.knotsV[src.knotsV.length - 1] - src.knotsV[0]);
  const gu = N.greville(src.knotsU, src.degU, nu).map(kn), gv = N.greville(src.knotsV, src.degV, nv).map(kv);
  return {
    degU: src.degU, degV: src.degV, knotsU: src.knotsU.slice(), knotsV: src.knotsV.slice(),
    cvs: src.cvs.map((r, i) => r.map((c, j) => { const n = normalAt(s, gu[i], gv[j]); return new THREE.Vector4(c.x + n.x * dist, c.y + n.y * dist, c.z + n.z * dist, c.w); })),
  };
}
// Reflejo en x = 0; se invierte el orden en U para que la normal siga apuntando hacia fuera
export function mirrorData(src, kind) {
  const m = (c) => new THREE.Vector4(-c.x, c.y, c.z, c.w);
  if (kind === 'curve') return { deg: src.deg, knots: reverseKnots(src.knots), plane: src.plane, cvs: src.cvs.slice().reverse().map(m) };
  return { degU: src.degU, degV: src.degV, knotsU: reverseKnots(src.knotsU), knotsV: src.knotsV.slice(), cvs: src.cvs.slice().reverse().map((r) => r.map(m)) };
}

// ---------- Diagnóstico de la unión ----------
// Mide en 9 puntos del borde: hueco (G0), ángulo entre normales (G1) y diferencia de curvatura al cruzar (G2).
export function diagnose(M, mEdge, S, sEdge, rev) {
  const sm = N.surfaceOf(M), ss = N.surfaceOf(S);
  const at = (s, e, t, h) => {
    const p = new THREE.Vector3(), w = atEnd(e) ? 1 - h : h;
    if (isU(e)) s.getPoint(w, t, p); else s.getPoint(t, w, p);
    return p;
  };
  const crossNormal = (s, e, t) => {
    const a = at(s, e, Math.min(1, t + 1e-4), 0), b = at(s, e, Math.max(0, t - 1e-4), 0), c = at(s, e, t, 1e-4);
    return a.sub(b).cross(c.sub(at(s, e, t, 0))).normalize();
  };
  let gap = 0, ang = 0, curv = 0, kmax = 1e-9;
  const h = 4e-3;
  for (let k = 1; k <= 9; k++) {
    const t = k / 10, tm = rev ? 1 - t : t;
    const P0 = at(ss, sEdge, t, 0), Q0 = at(sm, mEdge, tm, 0);
    gap = Math.max(gap, P0.distanceTo(Q0));
    const ns = crossNormal(ss, sEdge, t), nm = crossNormal(sm, mEdge, tm);
    ang = Math.max(ang, THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(ns.dot(nm))))));
    const kappa = (s, e, tt, n) => {
      const p0 = at(s, e, tt, 0), p1 = at(s, e, tt, h), p2 = at(s, e, tt, 2 * h);
      const d1 = p1.clone().multiplyScalar(4).sub(p0.clone().multiplyScalar(3)).sub(p2).divideScalar(2 * h);
      const d2 = p0.clone().sub(p1.clone().multiplyScalar(2)).add(p2).divideScalar(h * h);
      return d2.dot(n) / Math.max(1e-12, d1.lengthSq());
    };
    const ks = kappa(ss, sEdge, t, ns), km = kappa(sm, mEdge, tm, ns);
    curv = Math.max(curv, Math.abs(ks - km));
    kmax = Math.max(kmax, Math.abs(ks), Math.abs(km));
  }
  // relativa a la curvatura mayor; si las dos son casi planas (radio > 50 dm) se compara con 1/50
  return { gap, angle: ang, curv: curv / Math.max(kmax, 0.02) };
}
