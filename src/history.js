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
export const reverseKnots = (k) => { const a = k[0], b = k[k.length - 1]; return k.slice().reverse().map((t) => a + b - t); };
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
export function prepareSlave(S, sEdge, M, mEdge, cont, rev, ex = null) {
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
  if (ex) {
    // control explícito: grado y spans al cruzar el borde (nunca menos de lo que pide la continuidad)
    const c2 = cross(d, sEdge), deg = Math.min(7, Math.max(ex.deg || c2.deg, cont, 1)), n = Math.max(deg + (ex.spans || (c2.n - c2.deg)), cont + 2, deg + 1);
    if (c2.deg !== deg || c2.n !== n) d = isU(sEdge) ? N.rebuildSurface(d, deg, n - deg, d.degV, d.cvs[0].length - d.degV) : N.rebuildSurface(d, d.degU, d.cvs.length - d.degU, deg, n - deg);
  }
  const k = rev ? reverseKnots(ma.knots) : ma.knots.slice();
  if (isU(sEdge)) { if (!sameKnots(d.knotsV, k)) d = { ...d, knotsV: k }; } else if (!sameKnots(d.knotsU, k)) d = { ...d, knotsU: k };
  return d;
}

// Ajuste: las filas 0..cont de S (desde su borde) se calculan para que sus derivadas al cruzar el borde sean
// las de M multiplicadas por (-λ)^k (el signo porque cada superficie avanza hacia su propio lado).
// G0 = posición, G1 = tangencia, G2 = curvatura, G3 = variación de curvatura.
// mu = término de forma: la continuidad geométrica G2 permite S'' = λ²M'' − μM' (y para G3 S''' = −λ³M''' + 3λμM''),
// así la segunda fila de CVs se puede mover (flecha de "forma") sin romper la curvatura.
export function alignRows(S, sEdge, M, mEdge, cont, lambda, rev, mu = 0, nu = 0, ext = null) {
  const mc = M ? cross(M, mEdge) : null, sc = cross(S, sEdge);
  const mRows = [], sRows = [];
  // la maestra puede tener menos filas que las que pide la continuidad (p. ej. una extrusión tiene 2): sus derivadas
  // de orden mayor son cero
  if (M) for (let k = 0; k <= Math.min(cont, mc.n - 1); k++) mRows.push(row(M, mEdge, k));
  for (let k = 0; k <= cont; k++) sRows.push(row(S, sEdge, k));
  const n = sRows[0].length;
  const lamF = typeof lambda === 'function' ? lambda : () => lambda, muF = typeof mu === 'function' ? mu : () => mu, nuF = typeof nu === 'function' ? nu : () => nu;
  for (let j = 0; j < n; j++) {
    const lambda = lamF(j, n), mu = muF(j, n, lambda);
    const jm = rev ? n - 1 - j : j;
    // con ext las derivadas objetivo de cada columna vienen ya calculadas (maestra libre: curva sobre superficie, isoparamétrica...)
    const E = ext && ext[j];
    const m0 = E ? { x: E[0].x, y: E[0].y, z: E[0].z, w: sRows[0][j].w } : mRows[0][jm];
    const s0 = sRows[0][j];
    s0.set(m0.x, m0.y, m0.z, m0.w);
    if (!cont) continue;
    const Dm = E ? null : startDerivs(mRows.map((r) => xyz(r[jm])), mc.knots, mc.deg, cont);
    const P = sRows.map((r) => xyz(r[j]));
    for (let k = 1; k <= cont; k++) {
      let target;
      if (E) target = E[k].clone();
      else {
        target = Dm[k].clone().multiplyScalar((-lambda) ** k);
        if (k === 2) target.addScaledVector(Dm[1], -mu);
        if (k === 3) { target.addScaledVector(Dm[2], 3 * lambda * mu); target.addScaledVector(Dm[1], nuF(j, n, lambda)); }
      }
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
// Peso de cada columna del borde (0..1): "Modificar rango" deja el Align solo en el tramo [r0, r1] del borde, con un
// suavizado (soft) a cada lado para que la superficie vuelva a su forma sin escalón.
export function rangeWeights(rel, knots, deg, n) {
  const g = N.greville(knots, deg, n), a = knots[deg], b = knots[n];
  const r0 = rel.r0 ?? 0, r1 = rel.r1 ?? 1, soft = Math.max(0, rel.soft ?? 0);
  const sm = (x) => x * x * (3 - 2 * x);
  return g.map((t) => {
    t = (t - a) / ((b - a) || 1);
    if (!rel.modRange) return 1;
    const wi = soft > 1e-6 ? sm(Math.min(1, Math.max(0, (t - (r0 - soft)) / soft))) : (t >= r0 - 1e-6 ? 1 : 0);
    const wo = soft > 1e-6 ? sm(Math.min(1, Math.max(0, ((r1 + soft) - t) / soft))) : (t <= r1 + 1e-6 ? 1 : 0);
    return wi * wo;
  });
}
// cabecera común de un Align de superficie: estructura, copia de la forma original y pesos (rango, tensión que varía)
export function align(rel, M, S, field = null) {
  if (rel.curve) return alignCurve(rel, M, S, field);
  const xex = rel.explicit ? { deg: rel.xDeg, spans: rel.xSpans } : null;
  const d = field ? prepareSlaveFree(S, rel.sEdge, rel.cont, xex) : prepareSlave(S, rel.sEdge, M, rel.mEdge, rel.cont, rel.rev, xex);
  const sc = cross(d, rel.sEdge), sa = along(d, rel.sEdge);
  const nr = Math.min(10, sc.n), rowsAt = () => { const R = []; for (let k = 0; k < nr; k++) R.push(row(d, rel.sEdge, k).map((q) => [q.x, q.y, q.z, q.w])); return R; };
  // forma original de las filas del borde (para el rango parcial)
  if (!rel.orig || rel.orig.n !== sa.n || rel.orig.nc !== sc.n) rel.orig = { n: sa.n, nc: sc.n, rows: rowsAt() };
  const w = rangeWeights(rel, sa.knots, sa.deg, sa.n);
  const g = N.greville(sa.knots, sa.deg, sa.n), g0 = sa.knots[sa.deg], g1 = sa.knots[sa.n];
  // tensión que cambia a lo largo del borde (de "Tensión" al inicio a "Tensión final" al final)
  const tAt = (j) => (rel.varT ? rel.tension + ((rel.tensionEnd ?? rel.tension) - rel.tension) * ((g[j] - g0) / ((g1 - g0) || 1)) : rel.tension);
  const lamAt = (j) => rel.lambda0 * tAt(j), muAt = (j, n, lam) => (rel.shape || 0) * lam, nuAt = (j, n, lam) => (rel.shape3 || 0) * lam ** 2;
  if (field) alignRows(d, rel.sEdge, null, null, rel.cont, lamAt, rel.rev, muAt, nuAt, freeTargets(rel, d, sa, g, g0, g1, field, lamAt, muAt, nuAt));
  else alignRows(d, rel.sEdge, M, rel.mEdge, rel.cont, lamAt, rel.rev, muAt, nuAt);
  if (w.some((x) => x < 1)) {
    for (let k = 0; k < nr; k++) {
      const r = row(d, rel.sEdge, k);
      for (let j = 0; j < r.length; j++) {
        const o = rel.orig.rows[k][j], a = w[j];
        if (a >= 1) continue;
        r[j].set(o[0] + (r[j].x - o[0]) * a, o[1] + (r[j].y - o[1]) * a, o[2] + (r[j].z - o[2]) * a, r[j].w);
      }
    }
  }
  // "Blending": filas de CVs extra detrás de las de continuidad se mueven con el desplazamiento de la última, cada vez menos
  const ex = Math.min(rel.extra || 0, nr - 1 - rel.cont), exPrev = Math.min(rel.extraPrev || 0, nr - 1 - rel.cont);
  if (ex > 0 || exPrev > 0) {
    const last = row(d, rel.sEdge, rel.cont), f = rel.blendF ?? 1;
    for (let k = rel.cont + 1; k <= rel.cont + Math.max(ex, exPrev) && k < nr; k++) {
      const r = row(d, rel.sEdge, k), e = k - rel.cont, wk = e <= ex ? f * (1 - e / (ex + 1)) : 0;
      for (let j = 0; j < r.length; j++) {
        const o = rel.orig.rows[k][j], o0 = rel.orig.rows[rel.cont][j];
        r[j].set(o[0] + (last[j].x - o0[0]) * wk, o[1] + (last[j].y - o0[1]) * wk, o[2] + (last[j].z - o0[2]) * wk, r[j].w);
      }
    }
  }
  rel.extraPrev = ex;
  return d;
}

// Estructura de una esclava cuando la maestra es libre: se queda con la suya a lo largo del borde y solo se cuida el grado y las filas al cruzar
export function prepareSlaveFree(S, sEdge, cont, ex = null) {
  let d = S;
  const sc = cross(d, sEdge);
  let deg = sc.deg, n = sc.n;
  if (ex) { deg = Math.min(7, Math.max(ex.deg || deg, cont, 1)); n = Math.max(deg + (ex.spans || (sc.n - sc.deg)), cont + 2, deg + 1); }
  else if (sc.deg < cont || sc.n < cont + 2) { n = Math.max(sc.n, cont + 2); deg = Math.min(Math.max(sc.deg, cont, 1), n - 1); }
  if (deg !== sc.deg || n !== sc.n) d = isU(sEdge) ? N.rebuildSurface(d, deg, n - deg, d.degV, d.cvs[0].length - d.degV) : N.rebuildSurface(d, d.degU, d.cvs.length - d.degU, deg, n - deg);
  // a lo largo del borde hacen falta CVs de sobra para copiar una maestra curva (un círculo con 4 CVs no se sigue)
  const al = along(d, sEdge);
  if (al.n < 12) {
    const ad = Math.max(al.deg, 3), an = 12;
    d = isU(sEdge) ? N.rebuildSurface(d, d.degU, d.cvs.length - d.degU, ad, an - ad) : N.rebuildSurface(d, ad, an - ad, d.degV, d.cvs[0].length - d.degV);
  }
  return d;
}
// Objetivos por columna de CVs cuando la maestra es libre. field = { params(pts, rev, rel), frames(ts, otherPts) } (main.js).
// En cada estación (abscisa de Greville) se piden el punto y las derivadas cruzadas de la maestra; luego se resuelve el
// sistema de interpolación para que el campo de derivadas pase por esos valores (CVs de derivada = solución).
function freeTargets(rel, d, sa, g, g0, g1, field, lamAt, muAt, nuAt) {
  const n = sa.n, sig = g.map((t) => (t - g0) / ((g1 - g0) || 1));
  const row0 = rel.orig.rows[0].map((q) => new THREE.Vector4(q[0], q[1], q[2], q[3]));
  const crv = N.curveOf({ deg: sa.deg, knots: sa.knots, cvs: row0 });
  const pts = sig.map((t) => crv.getPoint(Math.min(1, Math.max(0, t))));
  const ts = field.params(pts, rel.rev, rel, sig);
  const F = field.frames(ts, pts);
  if (rel.lambda0 == null) {
    let a = 0, b = 0;
    const sc = cross(d, rel.sEdge);
    const r0 = row(d, rel.sEdge, 0), r1 = row(d, rel.sEdge, 1);
    for (let j = 0; j < n; j++) { a += startDerivs([xyz(r0[j]), xyz(r1[j])], sc.knots, sc.deg, 1)[1].length(); b += F[j].E[1].length(); }
    rel.lambda0 = b > 1e-9 && a > 1e-9 ? a / b : 1;
  }
  const D = F.map((f, j) => {
    const lam = lamAt(j), mu = muAt(j, n, lam), nu = nuAt(j, n, lam), E = f.E;
    const t = [f.P.clone(), E[1].clone().multiplyScalar(lam), E[2].clone().multiplyScalar(lam * lam).addScaledVector(E[1], mu),
      E[3].clone().multiplyScalar(lam ** 3).addScaledVector(E[2], 3 * lam * mu).addScaledVector(E[1], nu)];
    return t;
  });
  const A = sig.map((u) => basisFns(sa.knots, sa.deg, n, g0 + u * (g1 - g0)));
  const out = Array.from({ length: n }, () => []);
  for (let k = 0; k <= Math.min(3, rel.cont); k++) {
    const R = solve(A, D.map((x) => x[k]));
    R.forEach((v, i) => (out[i][k] = v));
  }
  return out;
}
export function freeDiagnose(rel, d, field) {
  const sc = N.surfaceOf(d), e = rel.sEdge, nS = 9;
  const sig = Array.from({ length: nS }, (_, k) => (k + 1) / (nS + 1));
  const pt = (t, h, out) => (isU(e) ? sc.getPoint(atEnd(e) ? 1 - h : h, t, out) : sc.getPoint(t, atEnd(e) ? 1 - h : h, out));
  const P = sig.map((t) => { const q = new THREE.Vector3(); pt(t, 0, q); return q; });
  // para orientar a la maestra se usa un punto un poco dentro de la esclava (el borde ya coincide con la maestra)
  const inner = sig.map((t) => { const q = new THREE.Vector3(); pt(t, 0.08, q); return q; });
  const ts = field.params(P, rel.rev, rel, sig), F = field.frames(ts, inner);
  let gap = 0, ang = 0;
  sig.forEach((t, j) => {
    gap = Math.max(gap, P[j].distanceTo(F[j].P));
    if (!F[j].n) return;
    const hh = 1e-3, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    pt(t, 0, a); pt(Math.min(1, t + hh), 0, b); pt(t, hh, c);
    const ns = b.sub(a).cross(c.sub(a)).normalize();
    ang = Math.max(ang, THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(ns.dot(F[j].n))))));
  });
  return { gap, angle: ang, curv: null };
}

// ---------- Align de una curva (su extremo) a otra curva o al borde de una superficie ----------
// La curva cruza el punto de unión como un borde de superficie de una sola fila: sus derivadas en el extremo
// son (-λ)^k veces las de la maestra (más el término de forma μ en G2 / G3), igual que en el Align de superficies.
function basisFns(knots, p, n, t) {
  const N0 = new Array(n).fill(0);
  let span = p;
  while (span < n - 1 && t >= knots[span + 1]) span++;
  const left = [], right = [], Nn = [1];
  for (let j = 1; j <= p; j++) {
    left[j] = t - knots[span + 1 - j]; right[j] = knots[span + j] - t;
    let saved = 0;
    for (let r = 0; r < j; r++) {
      const den = right[r + 1] + left[j - r], tmp = den ? Nn[r] / den : 0;
      Nn[r] = saved + right[r + 1] * tmp; saved = left[j - r] * tmp;
    }
    Nn[j] = saved;
  }
  for (let i = 0; i <= p; i++) N0[span - p + i] = Nn[i];
  return N0;
}
const curveFromEnd = (c, end) => ({ P: (end ? c.cvs.slice().reverse() : c.cvs.slice()), knots: end ? reverseKnots(c.knots) : c.knots, deg: c.deg });
// derivadas 0..K en el extremo de una curva (hacia dentro de la curva)
export function curveEndDerivs(c, end, K) {
  const f = curveFromEnd(c, end), d = startDerivs(f.P.map(xyz), f.knots, f.deg, Math.min(K, f.P.length - 1));
  while (d.length <= K) d.push(new THREE.Vector3());
  return d;
}
// derivadas en el cruce de un borde de superficie, en la posición t (0..1) a lo largo de él
export function edgeCrossDerivs(M, mEdge, t, K) {
  const al = along(M, mEdge), cr = cross(M, mEdge);
  const u = al.knots[al.deg] + t * (al.knots[al.n] - al.knots[al.deg]);
  const B = basisFns(al.knots, al.deg, al.n, u);
  const nr = Math.min(K, cr.n - 1) + 1, P = [];
  for (let k = 0; k < nr; k++) {
    const r = row(M, mEdge, k), q = new THREE.Vector3();
    for (let j = 0; j < r.length; j++) q.addScaledVector(xyz(r[j]), B[j]);
    P.push(q);
  }
  const d = startDerivs(P, cr.knots, cr.deg, nr - 1);
  while (d.length <= K) d.push(new THREE.Vector3());
  return d;
}
// derivadas 0..K de una curva en cualquier punto t (0..1); sign = -1 mira hacia el inicio (hacia dentro desde el extremo final)
export function curveDerivsAt(c, t, K, sign = 1) {
  const p = c.deg, n = c.cvs.length, u = c.knots[p] + t * (c.knots[n] - c.knots[p]);
  const ev = (Q, kn, deg) => { const B = basisFns(kn, deg, Q.length, u), q = new THREE.Vector3(); Q.forEach((v, i) => q.addScaledVector(v, B[i])); return q; };
  let Q = c.cvs.map(xyz);
  const out = [ev(Q, c.knots, p)];
  for (let k = 1; k <= K; k++) {
    if (k > p || Q.length < 2) { out.push(new THREE.Vector3()); continue; }
    Q = Q.slice(0, -1).map((v, i) => { const den = c.knots[i + p + 1] - c.knots[i + k]; return Q[i + 1].clone().sub(v).multiplyScalar(den > 1e-12 ? (p - k + 1) / den : 0); });
    out.push(ev(Q, c.knots.slice(k, c.knots.length - k), p - k).multiplyScalar(sign ** k));
  }
  return out;
}
export function masterDerivs(rel, M, K, field = null, endPt = null) {
  if (field) {
    // maestra libre (curva sobre superficie, isoparamétrica, borde de recorte): derivadas hacia dentro de la superficie de la maestra
    const F = field.frames([rel.mT ?? 0], [endPt || new THREE.Vector3()])[0], E = F.E;
    return [F.P.clone(), E[1].clone().negate(), E[2].clone(), E[3].clone().negate()].slice(0, K + 1).concat(Array(Math.max(0, K - 3)).fill(0).map(() => new THREE.Vector3()));
  }
  if (rel.mEdge && rel.curve && ['normal', 'vector', 'view'].includes(rel.atype)) return curveEdgeDirDerivs(rel, M, K);
  if (rel.mEdge) return edgeCrossDerivs(M, rel.mEdge, rel.mT ?? 0.5, K);
  // curva maestra: el punto de unión se puede recorrer de principio a fin (mT); la curva esclava sale hacia el lado contrario al extremo elegido
  return curveDerivsAt(M, rel.mT ?? (rel.mEnd ? 1 : 0), K, rel.mEnd ? -1 : 1);
}
// Curva alineada a un BORDE con tipo Normal / Vector / Vista: la curva sale en otra dirección que la isoparamétrica cruzada,
// pero siempre DENTRO del plano tangente del borde, y su curvatura (G2/G3) se toma de la superficie a lo largo de esa dirección:
//   Normal = perpendicular al borde (en el plano tangente) · Vector / Vista = el vector rel.avec proyectado en el plano tangente.
// Natural sigue usando las derivadas exactas de la isoparamétrica cruzada (edgeCrossDerivs).
function curveEdgeDirDerivs(rel, M, K) {
  const t = rel.mT ?? 0.5, e = rel.mEdge, S = N.surfaceOf(M), base = edgeCrossDerivs(M, e, t, 1)[1];
  const uv = isU(e) ? [atEnd(e) ? 1 : 0, t] : [t, atEnd(e) ? 1 : 0];
  const P = (u, v) => { const q = new THREE.Vector3(); S.getPoint(Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v)), q); return q; };
  const h = 1e-4, Su = P(uv[0] + h, uv[1]).sub(P(uv[0] - h, uv[1])).divideScalar(2 * h), Sv = P(uv[0], uv[1] + h).sub(P(uv[0], uv[1] - h)).divideScalar(2 * h);
  const nrm = Su.clone().cross(Sv).normalize(), T = (isU(e) ? Sv : Su).clone().normalize();
  let d = rel.atype === 'normal' ? base.clone().addScaledVector(T, -base.dot(T)) : new THREE.Vector3(...(rel.avec || [0, 1, 0]));
  d.addScaledVector(nrm, -d.dot(nrm));
  if (d.lengthSq() < 1e-12) return edgeCrossDerivs(M, e, t, K);
  if (d.dot(base) < 0) d.negate();
  d.normalize().multiplyScalar(base.length());
  // dirección en (u, v) que da ese vector, y derivadas de S a lo largo de esa línea (hacia dentro: diferencias de un lado)
  const a = Su.dot(Su), b = Su.dot(Sv), c = Sv.dot(Sv), p = Su.dot(d), q = Sv.dot(d), det = a * c - b * b || 1e-12;
  const w = [(p * c - q * b) / det, (a * q - b * p) / det];
  let hh = 4e-3;
  const inside = (k) => { const u = uv[0] + k * hh * w[0], v = uv[1] + k * hh * w[1]; return u > -1e-9 && u < 1 + 1e-9 && v > -1e-9 && v < 1 + 1e-9; };
  while (hh > 1e-5 && !inside(4)) hh /= 2;
  const pts = [0, 1, 2, 3, 4].map((k) => P(uv[0] + k * hh * w[0], uv[1] + k * hh * w[1]));
  const comb = (cf, div) => cf.reduce((acc, x, i) => acc.addScaledVector(pts[i], x), new THREE.Vector3()).divideScalar(div);
  const out = [P(uv[0], uv[1]), d.clone(), comb([35, -104, 114, -56, 11], 12 * hh * hh), comb([-5, 18, -24, 14, -3], 2 * hh ** 3)];
  while (out.length <= K) out.push(new THREE.Vector3());
  return out.slice(0, K + 1);
}
// largo aproximado de un borde (para pasar un arrastre en la vista a fracción 0..1 del borde)
export function edgeLengthApprox(M, mEdge, n = 64) {
  const s = N.surfaceOf(M), q = new THREE.Vector3(), p = new THREE.Vector3();
  let L = 0;
  for (let k = 0; k <= n; k++) { const t = k / n; if (isU(mEdge)) s.getPoint(atEnd(mEdge) ? 1 : 0, t, q); else s.getPoint(t, atEnd(mEdge) ? 1 : 0, q); if (k) L += q.distanceTo(p); p.copy(q); }
  return L || 1;
}
// punto del borde más cercano a un punto, como fracción 0..1 a lo largo del borde
export function edgeParamNear(M, mEdge, p, n = 200) {
  const s = N.surfaceOf(M), q = new THREE.Vector3();
  let best = 0, bd = Infinity;
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (isU(mEdge)) s.getPoint(atEnd(mEdge) ? 1 : 0, t, q); else s.getPoint(t, atEnd(mEdge) ? 1 : 0, q);
    const d = q.distanceToSquared(p);
    if (d < bd) { bd = d; best = t; }
  }
  return best;
}
export function prepareCurve(S, cont, ex = null) {
  if (ex) {
    const deg = Math.min(7, Math.max(ex.deg || S.deg, cont, 1)), n = Math.max(deg + (ex.spans || (S.cvs.length - S.deg)), cont + 2, deg + 1);
    if (S.deg === deg && S.cvs.length === n) return S;
    const d = N.rebuildCurve(S, deg, n - deg); d.plane = 'free'; return d;
  }
  if (S.deg >= cont && S.cvs.length >= cont + 2) return S;
  const n = Math.max(S.cvs.length, cont + 2), deg = Math.min(Math.max(S.deg, cont, 1), n - 1);
  const d = N.rebuildCurve(S, deg, n - deg);
  d.plane = 'free';
  return d;
}
export function curveNaturalLambda(S, sEnd, M, rel, field = null) {
  const a = curveEndDerivs(S, sEnd, 1)[1].length(), b = masterDerivs(rel, M, 1, field, N.curveOf(S).getPoint(sEnd ? 0.9 : 0.1))[1].length();
  return a > 1e-9 && b > 1e-9 ? a / b : 1;
}
export function alignCurve(rel, M, S, field = null) {
  const d = prepareCurve(S, rel.cont, rel.explicit ? { deg: rel.xDeg, spans: rel.xSpans } : null), end = rel.sEnd || 0, K = rel.cont;
  const Dm = masterDerivs(rel, M, K, field, N.curveOf(d).getPoint(end ? 0.9 : 0.1));
  const f = curveFromEnd(d, end), P = f.P.map(xyz);
  const sign = rel.rev ? 1 : -1, lam = rel.lambda0 * rel.tension, mu = (rel.shape || 0) * lam;
  P[0].copy(Dm[0]);
  for (let k = 1; k <= K; k++) {
    const target = Dm[k].clone().multiplyScalar((sign * lam) ** k);
    if (k === 2) target.addScaledVector(Dm[1], mu * sign);
    if (k === 3) { target.addScaledVector(Dm[2], 3 * lam * mu); target.addScaledVector(Dm[1], (rel.shape3 || 0) * lam ** 2); }
    P[k].set(0, 0, 0);
    const D0 = startDerivs(P.slice(0, k + 1), f.knots, f.deg, k)[k];
    P[k].set(1, 1, 1);
    const c = startDerivs(P.slice(0, k + 1), f.knots, f.deg, k)[k].x - D0.x;
    P[k].copy(target.sub(D0).divideScalar(Math.abs(c) > 1e-12 ? c : 1));
  }
  const out = { ...d, cvs: d.cvs.map((q) => q.clone()) };
  const n = out.cvs.length, at = (k) => out.cvs[end ? n - 1 - k : k];
  // forma original de los primeros CVs desde el extremo (para el "Blending" de filas extra)
  const nr = Math.min(10, n);
  if (!rel.orig || rel.orig.n !== n || rel.orig.end !== end) rel.orig = { n, end, pts: Array.from({ length: nr }, (_, k) => { const q = d.cvs[end ? n - 1 - k : k]; return [q.x, q.y, q.z]; }) };
  for (let k = 0; k <= K; k++) at(k).set(P[k].x, P[k].y, P[k].z, at(k).w);
  const ex = Math.max(0, Math.min(rel.extra || 0, nr - 2 - K)), bf = rel.blendF ?? 1, top = Math.max(ex, Math.min(rel.extraPrev || 0, nr - 2 - K));
  rel.extraPrev = ex;
  for (let k = K + 1; k < nr - 1 && k <= K + top; k++) {
    const o = rel.orig.pts[k], o0 = rel.orig.pts[K], w = k - K <= ex ? bf * (1 - (k - K) / (ex + 1)) : 0;
    at(k).set(o[0] + (P[K].x - o0[0]) * w, o[1] + (P[K].y - o0[1]) * w, o[2] + (P[K].z - o0[2]) * w, at(k).w);
  }
  return out;
}
export function diagnoseCurve(rel, M, S, field = null) {
  const A = curveEndDerivs(S, rel.sEnd || 0, 3), B = masterDerivs(rel, M, 3, field, N.curveOf(S).getPoint(rel.sEnd ? 0.9 : 0.1));
  const sg = rel.rev ? 1 : -1;
  const kap = (D) => D[1].clone().cross(D[2]).length() / Math.max(1e-12, D[1].length() ** 3);
  const ang = THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.max(-1, A[1].clone().normalize().dot(B[1].clone().normalize().multiplyScalar(sg))))));
  const ks = kap(A), km = kap(B);
  return { gap: A[0].distanceTo(B[0]), angle: Number.isNaN(ang) ? 0 : ang, curv: Math.abs(ks - km) / Math.max(ks, km, 0.02) };
}

// ---------- Blend: superficie de unión entre dos bordes ----------
// La superficie nueva corre en U a lo largo de los bordes (con la estructura del borde A) y en V los cruza.
// Cada lado tiene su continuidad (G0, G1, G2 o G3): filas = contA + contB + 2, grado = filas - 1.
// Si el borde B no tiene la misma estructura que el A, se usa una copia de B reconstruida con la del A.
const cloneSurf = (d) => ({ ...d, knotsU: d.knotsU.slice(), knotsV: d.knotsV.slice(), cvs: d.cvs.map((r) => r.map((c) => c.clone())) });
export function blendCompatible(A, eA, B, eB) {
  const a = along(A, eA), b = along(B, eB), rev = reversed(A, eA, B, eB);
  return a.deg === b.deg && a.n === b.n && sameKnots(a.knots, rev ? reverseKnots(b.knots) : b.knots);
}
// Funciones base B-spline (Cox-de Boor) en el parámetro u del vector de nudos K
export function basis(K, p, u) {
  const n = K.length - p - 1, N0 = [];
  for (let j = 0; j < K.length - 1; j++) N0.push(u >= K[j] && u < K[j + 1] ? 1 : 0);
  if (u >= K[K.length - 1]) { for (let j = K.length - 2; j >= 0; j--) if (K[j] < K[j + 1]) { N0[j] = 1; break; } }
  let Np = N0;
  for (let d = 1; d <= p; d++) {
    const nx = [];
    for (let j = 0; j < K.length - 1 - d; j++) {
      const a = K[j + d] - K[j], b = K[j + d + 1] - K[j + 1];
      nx.push((a > 0 ? ((u - K[j]) / a) * Np[j] : 0) + (b > 0 ? ((K[j + d + 1] - u) / b) * Np[j + 1] : 0));
    }
    Np = nx;
  }
  return Np.slice(0, n);
}
export function solve(A, B) { // Gauss con pivote; B: vectores
  const n = A.length, M = A.map((r, i) => [...r, B[i].clone()]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / d;
      if (!f) continue;
      for (let k = c; k < n; k++) M[r][k] -= f * M[c][k];
      M[r][n].addScaledVector(M[c][n], -f);
    }
  }
  return M.map((r, i) => r[n].divideScalar(M[i][i] || 1e-12));
}
// Copia de B con otra estructura a lo largo de su borde (grado p, nudos K): cada fila de CVs se interpola en los
// puntos de Greville de K. rev = recorrerla al revés para que vaya en el mismo sentido que el otro borde.
export function resampleAlong(B, e, p, K, rev) {
  const n = K.length - p - 1, g = N.greville(K, p, n), k0 = K[0], k1 = K[K.length - 1];
  const A = g.map((u) => basis(K, p, u));
  const curveOfRow = (cvs, deg, knots) => N.curveOf({ deg, knots, cvs });
  const fit = (crv) => solve(A, g.map((u) => { let t = (u - k0) / (k1 - k0); if (rev) t = 1 - t; return crv.getPoint(Math.min(1, Math.max(0, t))); }))
    .map((v) => new THREE.Vector4(v.x, v.y, v.z, 1));
  if (isU(e)) {
    const cvs = B.cvs.map((r) => fit(curveOfRow(r, B.degV, B.knotsV)));
    return { degU: B.degU, knotsU: B.knotsU.slice(), degV: p, knotsV: K.slice(), cvs };
  }
  const cols = B.cvs[0].map((_, j) => fit(curveOfRow(B.cvs.map((r) => r[j]), B.degU, B.knotsU)));
  return { degU: p, knotsU: K.slice(), degV: B.degV, knotsV: B.knotsV.slice(), cvs: cols[0].map((_, i) => cols.map((c) => c[i])) };
}
export function blendData(rel, A, B) {
  const compat = blendCompatible(A, rel.aEdge, B, rel.bEdge);
  // la estructura a lo largo la pone el borde con más CVs (así un círculo no se aproxima con pocos CVs)
  const swap = !compat && along(B, rel.bEdge).n > along(A, rel.aEdge).n;
  const [base, eBase, oth, eOth] = swap ? [B, rel.bEdge, A, rel.aEdge] : [A, rel.aEdge, B, rel.bEdge];
  const bs = along(base, eBase);
  const om = compat ? oth : resampleAlong(oth, eOth, bs.deg, bs.knots, rel.rev);
  const r = swap
    ? { aEdge: rel.bEdge, bEdge: rel.aEdge, contA: rel.contB ?? rel.cont ?? 2, contB: rel.contA ?? rel.cont ?? 2, tension: rel.tension, tensionA: rel.tensionB, tensionB: rel.tensionA, shapeA: rel.shapeB, shapeB: rel.shapeA, rev: false, lambdaA: rel.lambdaB, lambdaB: rel.lambdaA, lambdaN: rel.lambdaN }
    : { ...rel, rev: compat ? rel.rev : false };
  const d = blendOn(r, base, om);
  rel.lambdaN = r.lambdaN;
  if (!swap) { rel.lambdaA = r.lambdaA; rel.lambdaB = r.lambdaB; return d; }
  rel.lambdaA = r.lambdaB; rel.lambdaB = r.lambdaA;
  // se calculó desde B: se da la vuelta para que v0 toque A y U corra como el borde A
  let cvs = d.cvs.map((col) => col.slice().reverse()), knotsU = d.knotsU;
  if (rel.rev) { cvs = cvs.reverse(); knotsU = reverseKnots(knotsU); }
  return { ...d, knotsU, knotsV: reverseKnots(d.knotsV), cvs };
}
function blendOn(rel, A, B) {
  const cA = rel.contA ?? rel.cont ?? 2, cB = rel.contB ?? rel.cont ?? 2, Bm = B;
  const a = along(A, rel.aEdge), nv = cA + cB + 2, degV = nv - 1;
  const r0 = row(A, rel.aEdge, 0), b0 = row(Bm, rel.bEdge, 0), n = r0.length;
  const cvs = [];
  for (let i = 0; i < n; i++) {
    const p = r0[i], q = b0[rel.rev ? n - 1 - i : i], col = [];
    for (let j = 0; j < nv; j++) { const t = j / (nv - 1); col.push(new THREE.Vector4(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t, p.w)); }
    cvs.push(col);
  }
  const d = { degU: a.deg, degV, knotsU: a.knots.slice(), knotsV: N.clampedKnots(nv, degV), cvs };
  if (rel.lambdaA == null || rel.lambdaN !== nv) {
    rel.lambdaA = naturalLambda(d, 'v0', A, rel.aEdge, false); rel.lambdaB = naturalLambda(d, 'v1', Bm, rel.bEdge, rel.rev); rel.lambdaN = nv;
  }
  // cada lado con su tensión y su forma (las flechas de cada lado)
  const lA = rel.lambdaA * (rel.tensionA ?? rel.tension), lB = rel.lambdaB * (rel.tensionB ?? rel.tension);
  alignRows(d, 'v0', A, rel.aEdge, cA, lA, false, (rel.shapeA || 0) * lA);
  alignRows(d, 'v1', Bm, rel.bEdge, cB, lB, rel.rev, (rel.shapeB || 0) * lB);
  return d;
}

// ---------- Extrusión, revolución y loft (con historial: siguen a sus curvas) ----------
// dirección: 'auto' = perpendicular al plano de la curva; 'x' | 'y' | 'z'. both = hacia los dos lados.
export function extrudeData(c, dist, dir = 'auto', both = false) {
  const v = dir === 'x' ? new THREE.Vector3(1, 0, 0) : dir === 'z' ? new THREE.Vector3(0, 0, 1)
    : dir === 'y' ? new THREE.Vector3(0, 1, 0) : N.curvePlaneNormal(c);
  const a = v.clone().multiplyScalar(both ? -dist : 0), b = v.clone().multiplyScalar(dist);
  const sh = (p, o) => new THREE.Vector4(p.x + o.x * p.w / p.w, p.y + o.y, p.z + o.z, p.w);
  return { degU: 1, knotsU: [0, 0, 1, 1], degV: c.deg, knotsV: c.knots.slice(), cvs: [c.cvs.map((p) => sh(p, a)), c.cvs.map((p) => sh(p, b))] };
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
// Reflejo en x = 0 (o y = 0, z = 0); se invierte el orden en U para que la normal siga apuntando hacia fuera
export function mirrorData(src, kind, plane = 'x') {
  const m = (c) => new THREE.Vector4(plane === 'x' ? -c.x : c.x, plane === 'y' ? -c.y : c.y, plane === 'z' ? -c.z : c.z, c.w);
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
  const h = 2e-3;
  for (let k = 1; k <= 9; k++) {
    const t = k / 10, tm = rev ? 1 - t : t;
    const P0 = at(ss, sEdge, t, 0), Q0 = at(sm, mEdge, tm, 0);
    gap = Math.max(gap, P0.distanceTo(Q0));
    const ns = crossNormal(ss, sEdge, t), nm = crossNormal(sm, mEdge, tm);
    ang = Math.max(ang, THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(ns.dot(nm))))));
    // diferencias finitas de un solo lado de 4 puntos (más exactas): f' error h³, f'' error h²
    const kappa = (s, e, tt, n) => {
      const [p0, p1, p2, p3] = [0, 1, 2, 3].map((k) => at(s, e, tt, k * h));
      const d1 = p0.clone().multiplyScalar(-11).add(p1.clone().multiplyScalar(18)).add(p2.clone().multiplyScalar(-9)).add(p3.clone().multiplyScalar(2)).divideScalar(6 * h);
      const d2 = p0.clone().multiplyScalar(2).add(p1.clone().multiplyScalar(-5)).add(p2.clone().multiplyScalar(4)).sub(p3).divideScalar(h * h);
      return d2.dot(n) / Math.max(1e-12, d1.lengthSq());
    };
    const ks = kappa(ss, sEdge, t, ns), km = kappa(sm, mEdge, tm, ns);
    curv = Math.max(curv, Math.abs(ks - km));
    kmax = Math.max(kmax, Math.abs(ks), Math.abs(km));
  }
  // relativa a la curvatura mayor; si las dos son casi planas (radio > 50 dm) se compara con 1/50
  return { gap, angle: ang, curv: curv / Math.max(kmax, 0.02) };
}
