// Freeform Blend y Skin (como los de Alias), curvas sobre superficie (proyectar), recortes y extender superficies.
// Un "lado" puede ser:
//   { kind: 'edge',   data, edge }            borde de una superficie ('u0' | 'u1' | 'v0' | 'v1')
//   { kind: 'cos',    data, uv, closed, trim }  curva sobre superficie: polilínea en (u, v) de la superficie data
//   { kind: 'curves', curves: [data...] }       una o varias curvas libres encadenadas (Chain select)
// El blend se construye por estaciones a lo largo de los lados: en cada una se calcula una curva de Bézier que cruza
// de un lado al otro con las derivadas de cada lado (G0–G3) y luego cada fila de CVs se interpola a lo largo (en U).
import * as THREE from 'three';
import * as N from './nurbs.js';
import { basis, solve, along, reverseKnots } from './history.js';

const V3 = () => new THREE.Vector3();
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const frac = (x) => ((x % 1) + 1) % 1;

export function surfEval(d) {
  const s = N.surfaceOf(d);
  return (u, v) => { const t = new THREE.Vector3(); s.getPoint(clamp01(u), clamp01(v), t); return t; };
}
function tangents(S, u, v) {
  const e = 1e-4, u0 = Math.max(0, u - e), u1 = Math.min(1, u + e), v0 = Math.max(0, v - e), v1 = Math.min(1, v + e);
  const Su = S(u1, v).sub(S(u0, v)).divideScalar(u1 - u0), Sv = S(u, v1).sub(S(u, v0)).divideScalar(v1 - v0);
  return { Su, Sv, n: Su.clone().cross(Sv).normalize() };
}
// dirección (du, dv) cuyo vector 3D es k (k en el plano tangente)
function uvDir(f, k) {
  const { Su, Sv } = f, a = Su.dot(Su), b = Su.dot(Sv), c = Sv.dot(Sv), p = Su.dot(k), q = Sv.dot(k), det = a * c - b * b || 1e-12;
  return [(p * c - q * b) / det, (a * q - b * p) / det];
}
const inDom = (u, v) => u > -1e-9 && u < 1 + 1e-9 && v > -1e-9 && v < 1 + 1e-9;
// derivadas 1..3 de la curva c(t) = S(uv + t·w) en t = 0 (diferencias de un lado, 5 puntos)
function lineDerivs(S, u, v, w, h = 6e-3) {
  let hh = h;
  while (hh > 2e-4 && !inDom(u + 4 * hh * w[0], v + 4 * hh * w[1])) hh /= 2;
  const p = [0, 1, 2, 3, 4].map((i) => S(u + i * hh * w[0], v + i * hh * w[1]));
  const comb = (c, div) => c.reduce((a, x, i) => a.addScaledVector(p[i], x), V3()).divideScalar(div);
  return [p[0], comb([-25, 48, -36, 16, -3], 12 * hh), comb([35, -104, 114, -56, 11], 12 * hh * hh), comb([-5, 18, -24, 14, -3], 2 * hh ** 3)];
}

// ---------- Polilíneas por longitud de arco ----------
function arcSampler(pts) {
  const L = [0];
  for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
  const tot = L[L.length - 1] || 1;
  // devuelve (índice del tramo, fracción) para s en [0, 1]
  return { tot, at(s) {
    const x = clamp01(s) * tot;
    let lo = 0, hi = L.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= x) lo = m; else hi = m; }
    const seg = L[hi] - L[lo] || 1;
    return [lo, (x - L[lo]) / seg];
  } };
}

// ---------- Lados ----------
export function prepSide(side) {
  if (side.kind === 'curves') {
    // varias curvas: se encadenan en el orden en que se tocan los extremos
    const polys = side.curves.map((c) => { const k = N.curveOf(c), out = []; for (let i = 0; i <= 120; i++) out.push(k.getPoint(i / 120)); return out; });
    let chain = polys[0].slice();
    const rest = polys.slice(1);
    while (rest.length) {
      let best = null;
      rest.forEach((p, i) => {
        const a = chain[0], b = chain[chain.length - 1], s = p[0], e = p[p.length - 1];
        [[b.distanceTo(s), 'end', false], [b.distanceTo(e), 'end', true], [a.distanceTo(e), 'start', false], [a.distanceTo(s), 'start', true]]
          .forEach(([d, where, flip]) => { if (!best || d < best.d) best = { d, i, where, flip }; });
      });
      let p = rest.splice(best.i, 1)[0];
      if (best.flip) p = p.slice().reverse();
      chain = best.where === 'end' ? chain.concat(p.slice(1)) : p.slice(0, -1).concat(chain);
    }
    const sm = arcSampler(chain);
    side.pts = chain;
    // una sola curva: su propio parámetro (así la estructura de la curva se conserva); varias: longitud de arco
    const one = side.curves.length === 1 ? N.curveOf(side.curves[0]) : null;
    side.at = one ? (s) => ({ P: one.getPoint(clamp01(s)) })
      : (s) => { const [i, f] = sm.at(s); const a = chain[i], b = chain[Math.min(chain.length - 1, i + 1)]; return { P: a.clone().lerp(b, f) }; };
    side.closed = chain[0].distanceTo(chain[chain.length - 1]) < 1e-4;
    side.single = side.curves.length === 1 ? side.curves[0] : null;
    return side;
  }
  const S = side.S = surfEval(side.data);
  if (side.kind === 'edge') {
    const e = side.edge, U = e[0] === 'u', end = e[1] === '1';
    side.uvAt = (s) => (U ? [end ? 1 : 0, clamp01(s)] : [clamp01(s), end ? 1 : 0]);
    side.isoIn = U ? [end ? -1 : 1, 0] : [0, end ? -1 : 1];
  } else {
    const pts = side.uv.map(([u, v]) => S(u, v)), sm = arcSampler(pts), uv = side.uv;
    side.uvAt = (s) => { const [i, f] = sm.at(s); const a = uv[i], b = uv[Math.min(uv.length - 1, i + 1)]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; };
  }
  side.at = (s) => { const [u, v] = side.uvAt(s); return { u, v, P: S(u, v) }; };
  if (side.closed == null) side.closed = side.at(0).P.distanceTo(side.at(1).P) < 1e-4;
  return side;
}
function alongWeights(d, e) {
  const U = e[0] === 'u', end = e[1] === '1';
  return U ? d.cvs[end ? d.cvs.length - 1 : 0].map((c) => c.w) : d.cvs.map((r) => r[end ? r.length - 1 : 0].w);
}
const contOf = (side, c) => (side.kind === 'curves' ? 0 : c ?? 2);

// parámetro del lado para la estación σ (0..1, en el sentido del lado 1)
function mapper(side, rev, range, off) {
  return (sig) => {
    let t = rev ? 1 - sig : sig;
    t = range[0] + t * (range[1] - range[0]);
    return side.closed ? frac(t + off) : clamp01(t);
  };
}
function closestParam(side, P, n = 200) {
  let best = 0, bd = Infinity;
  for (let i = 0; i <= n; i++) { const d = side.at(i / n).P.distanceToSquared(P); if (d < bd) { bd = d; best = i / n; } }
  return best;
}

// Orientación del lado 2 respecto al 1 y desfase de los lados cerrados ("Modify Parameter")
function orient(r, A, B) {
  const rA = r.modRange ? [r.rA0 ?? 0, r.rA1 ?? 1] : [0, 1];
  let rB = r.modRange ? [r.rB0 ?? 0, r.rB1 ?? 1] : [0, 1];
  const offA = A.closed && r.modParam ? r.pA || 0 : 0;
  let offB = 0, rev = false;
  const mA = mapper(A, false, rA, offA);
  if (A.closed && B.closed) {
    const a0 = A.at(mA(0)).P, a1 = A.at(mA(0.1)).P;
    offB = closestParam(B, a0);
    rev = B.at(frac(offB + 0.1)).P.distanceTo(a1) > B.at(frac(offB - 0.1)).P.distanceTo(a1);
    if (rev) offB = frac(offB - 1); // con rev, σ = 0 → t = 1 → 1 + off
    if (r.modParam) offB += r.pB || 0;
  } else {
    const a0 = A.at(mA(0)).P, a1 = A.at(mA(1)).P, b0 = B.at(rB[0]).P, b1 = B.at(rB[1]).P;
    rev = a0.distanceTo(b0) + a1.distanceTo(b1) > a0.distanceTo(b1) + a1.distanceTo(b0);
  }
  return { rA, rB, offA, offB, rev };
}

// Extremos "Extend" (Skin): en vez de unir los extremos tal cual, el borde del inicio (o del fin) sale "a escuadra":
// el lado cuyo extremo queda más atrás (medido a lo largo de las curvas) se recorta frente al extremo del otro.
function extendEnds(r, A, B, o) {
  if (A.closed || B.closed) return;
  for (const at of [0, 1]) {
    if (r[at ? 'flowEnd' : 'flowStart'] !== 'extend') continue;
    const mA = mapper(A, false, o.rA, o.offA), mB = mapper(B, o.rev, o.rB, o.offB);
    const pa = A.at(mA(at)).P, pb = B.at(mB(at)).P;
    // dirección media de avance hacia dentro de la superficie desde ese extremo
    // dirección general de las curvas (de su inicio a su fin), hacia dentro desde este extremo
    const T = A.at(mA(1)).P.sub(A.at(mA(0)).P).normalize().add(B.at(mB(1)).P.sub(B.at(mB(0)).P).normalize()).normalize();
    if (at) T.negate();
    const behindA = pb.clone().sub(pa).dot(T) > 0; // A empieza antes que B: A se recorta
    const [side, m, P] = behindA ? [A, mA, pb] : [B, mB, pa];
    // σ donde (side(σ) − P)·T = 0, buscando desde el extremo hacia dentro
    const f = (sg) => side.at(m(sg)).P.sub(P).dot(T);
    let lo = at, hi = at ? 0 : 1;
    if (Math.sign(f(lo)) === Math.sign(f(hi))) continue;
    for (let k = 0; k < 40; k++) { const mid = (lo + hi) / 2; if (Math.sign(f(mid)) === Math.sign(f(lo))) lo = mid; else hi = mid; }
    const t = m((lo + hi) / 2); // parámetro propio del lado
    if (behindA) { o.rA = o.rA.slice(); o.rA[at] = t; }
    else { const i = (at === 0) !== o.rev ? 0 : 1; o.rB = o.rB.slice(); o.rB[i] = t; }
  }
}

// Estructura a lo largo (U): explícita, la del borde de más CVs (si va completo) o cúbica uniforme
function structure(r, A, B, o) {
  if (r.explicit) {
    const deg = Math.min(7, Math.max(1, r.degU ?? 3)), spans = Math.min(64, Math.max(1, r.spansU ?? 8));
    return { deg, K: N.clampedKnots(deg + spans, deg) };
  }
  // se usa la estructura de un lado solo si es polinómica (sin pesos) y el otro lado tiene la misma o es plano de ajustar;
  // si no, cúbica uniforme con spans suficientes (un círculo racional no se copia con una B-spline de sus mismos CVs)
  const full = (rg) => rg[0] === 0 && rg[1] === 1;
  const info = (side, rg, off, rev) => {
    if (!full(rg) || off) return null;
    const al = side.kind === 'edge' ? { ...along(side.data, side.edge), w: alongWeights(side.data, side.edge) }
      : side.single ? { deg: side.single.deg, knots: side.single.knots, n: side.single.cvs.length, w: side.single.cvs.map((c) => c.w) } : null;
    return al && al.w.every((w) => Math.abs(w - 1) < 1e-9) ? { ...al, rev } : null;
  };
  const a = info(A, o.rA, o.offA, false), b = info(B, o.rB, B.closed ? o.offB : 0, o.rev);
  const same = a && b && a.deg === b.deg && a.n === b.n && a.n >= 6;
  const best = same ? a : [a, b].filter((x) => x && x.n >= 8).sort((x, y) => y.n - x.n)[0];
  if (best) {
    const k0 = best.knots[0], k1 = best.knots[best.knots.length - 1];
    let K = best.knots.map((k) => (k - k0) / (k1 - k0));
    if (best.rev) K = reverseKnots(K);
    return { deg: best.deg, K };
  }
  const nMax = Math.max(a?.n || 0, b?.n || 0, A.kind === 'edge' ? along(A.data, A.edge).n : 0, B.kind === 'edge' ? along(B.data, B.edge).n : 0);
  const spans = Math.min(32, Math.max(A.closed || B.closed ? 24 : 16, nMax * 3));
  return { deg: 3, K: N.clampedKnots(3 + spans, 3) };
}

// Dirección del blend en cada estación de un lado y derivadas de la superficie del lado en esa dirección.
// Flujo: interior 'free' (perpendicular al lado) o 'iso' (sigue las isoparamétricas, solo bordes);
// Inicio / Fin 'edge' = Edge Align: cerca del extremo la dirección se alinea con el borde de la superficie.
function frames(side, sigs, map, otherP, r) {
  const n = sigs.length;
  if (side.kind === 'curves') return sigs.map((s, i) => ({ P: side.at(map(s)).P, E: [null, V3(), V3(), V3()], T: tangentAt(side, map, s) }));
  const S = side.S, raw = [];
  for (let i = 0; i < n; i++) {
    const s = sigs[i], { u, v, P } = side.at(map(s)), f = tangents(S, u, v), T = tangentAt(side, map, s);
    const perp = f.n.clone().cross(T).normalize();
    let iso = null;
    if (side.isoIn) iso = f.Su.clone().multiplyScalar(-side.isoIn[0]).addScaledVector(f.Sv, -side.isoIn[1]).normalize();
    raw.push({ u, v, P, f, T, perp, iso });
  }
  // sentido de la perpendicular: hacia fuera del borde, o (curva sobre superficie) hacia el otro lado / el recorte
  let sgn = 1;
  if (side.kind === 'edge') raw.forEach((x) => { if (x.perp.dot(x.iso) < 0) x.perp.negate(); });
  else {
    if (side.toward && side.loop) {
      let votes = 0;
      raw.forEach((x) => { const w = uvDir(x.f, x.perp), l = Math.hypot(w[0], w[1]) || 1; votes += pointInPoly(side.loop, x.u + (w[0] / l) * 2e-3, x.v + (w[1] / l) * 2e-3) ? 1 : -1; });
      sgn = (votes > 0) === (side.toward === 'inside') ? 1 : -1;
    } else {
      let acc = 0;
      raw.forEach((x, i) => { acc += x.perp.dot(otherP[i].clone().sub(x.P)); });
      sgn = acc < 0 ? -1 : 1;
    }
    raw.forEach((x) => x.perp.multiplyScalar(sgn));
  }
  const intIso = r.flowInt === 'iso' && side.kind === 'edge';
  const base = (x) => (intIso ? x.iso : x.perp);
  // dirección de alineación de cada extremo
  const alignAt = (x) => {
    if (side.kind === 'edge') return x.iso;
    const b = 2e-3;
    const along = x.u < b || x.u > 1 - b ? x.f.Sv.clone() : x.v < b || x.v > 1 - b ? x.f.Su.clone() : null;
    if (!along) return base(x);
    along.normalize();
    return along.dot(base(x)) < 0 ? along.negate() : along;
  };
  const a0 = alignAt(raw[0]), a1 = alignAt(raw[n - 1]);
  const ramp = (s) => { const x = clamp01(1 - s / 0.35); return x * x * (3 - 2 * x); };
  return raw.map((x, i) => {
    const s = sigs[i], wS = r.flowStart === 'edge' ? ramp(s) : 0, wE = r.flowEnd === 'edge' ? ramp(1 - s) : 0;
    const b = base(x).clone().multiplyScalar(Math.max(0, 1 - wS - wE)).addScaledVector(a0, wS).addScaledVector(a1, wE);
    b.addScaledVector(x.f.n, -b.dot(x.f.n));
    if (b.lengthSq() < 1e-12) b.copy(base(x));
    b.normalize();
    // derivadas de la superficie del lado hacia dentro (−b) y su continuación hacia fuera: E_k = (−1)^k d_k
    const k = b.clone().negate(), w = uvDir(x.f, k), sp = x.f.Su.clone().multiplyScalar(w[0]).addScaledVector(x.f.Sv, w[1]).length() || 1;
    const d = lineDerivs(S, x.u, x.v, [w[0] / sp, w[1] / sp]);
    return { P: x.P, T: x.T, n: x.f.n, uv: [x.u, x.v], b, E: [null, d[1].clone().negate(), d[2], d[3].clone().negate()] };
  });
}
function tangentAt(side, map, s) {
  const e = 2e-3, s0 = side.closed ? s - e : Math.max(0, s - e), s1 = side.closed ? s + e : Math.min(1, s + e);
  const t = side.at(map(s1)).P.sub(side.at(map(s0)).P);
  return t.lengthSq() > 1e-18 ? t.normalize() : new THREE.Vector3(1, 0, 0);
}

// CVs de la curva de Bézier de grado p que cruza: filas 0..cA las fija el lado A, p−cB..p el lado B
const binom = (n, k) => { let r = 1; for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i; return r; };
const fall = (p, k) => { let r = 1; for (let i = 0; i < k; i++) r *= p - i; return r; }; // p!/(p−k)!
function targets(F, lam, mu) {
  return [F.P.clone(), F.E[1].clone().multiplyScalar(lam), F.E[2].clone().multiplyScalar(lam * lam).addScaledVector(F.E[1], mu),
    F.E[3].clone().multiplyScalar(lam ** 3).addScaledVector(F.E[2], 3 * lam * mu)];
}
function crossRow(FA, cA, lA, mA, FB, cB, lB, mB, p, crownVec) {
  const Q = new Array(p + 1);
  const DA = targets(FA, lA, mA);
  for (let k = 0; k <= cA; k++) {
    const dk = DA[k].clone().divideScalar(fall(p, k));
    for (let i = 0; i < k; i++) dk.addScaledVector(Q[i], -((-1) ** (k - i)) * binom(k, i));
    Q[k] = dk;
  }
  if (FB) {
    const DB = targets(FB, lB, mB);
    for (let k = 0; k <= cB; k++) {
      const nk = DB[k].clone().multiplyScalar((-1) ** k / fall(p, k)); // ∇^k Q_p
      for (let i = 0; i < k; i++) nk.addScaledVector(Q[p - i], -((-1) ** i) * binom(k, i));
      Q[p - k] = nk.multiplyScalar((-1) ** k);
    }
  }
  // filas libres (corona): entre las dos que las rodean, desplazadas hacia fuera
  for (let j = 0; j <= p; j++) {
    if (Q[j]) continue;
    let a = j - 1, b = j + 1;
    while (!Q[b]) b++;
    Q[j] = Q[a].clone().lerp(Q[b], 1 / (b - a));
    if (crownVec) Q[j].add(crownVec);
  }
  return Q;
}
function fitRows(K, deg, sigs, rows) {
  const M = sigs.map((s) => basis(K, deg, s)), p = rows[0].length;
  const out = [];
  for (let j = 0; j < p; j++) out.push(solve(M, rows.map((q) => q[j])));
  return out[0].map((_, i) => out.map((col) => new THREE.Vector4(col[i].x, col[i].y, col[i].z, 1)));
}

function setup(r, sideA, sideB) {
  const A = prepSide(sideA), B = prepSide(sideB);
  const o = orient(r, A, B);
  extendEnds(r, A, B, o);
  return { A, B, o, mA: mapper(A, false, o.rA, o.offA), mB: mapper(B, o.rev, o.rB, o.offB) };
}

// ---------- Freeform Blend / Skin ----------
// r: contA/contB (G0–G3), tensionA/B (forma), shapeA/B (flecha naranja), crown, explicit/degU/spansU,
//    flowStart/flowEnd ('default' | 'edge' | 'extend'), flowInt ('free' | 'iso'), modRange rA0..rB1, modParam pA/pB.
export function freeformBlend(r, sideA, sideB) {
  const { A, B, o, mA, mB } = setup(r, sideA, sideB);
  // Skin sin reconstruir: dos curvas con la misma estructura → superficie reglada exacta con sus CVs
  if (A.single && B.single && r.rebuild === false && !r.crown && !r.modRange && !r.explicit) {
    const a = A.single, b = B.single;
    if (a.deg === b.deg && a.cvs.length === b.cvs.length) {
      const bc = o.rev ? b.cvs.slice().reverse() : b.cvs;
      r.info = { exact: true, rev: o.rev };
      return { degU: a.deg, degV: 1, knotsU: a.knots.slice(), knotsV: [0, 0, 1, 1], cvs: a.cvs.map((p, i) => [p.clone(), bc[i].clone()]) };
    }
  }
  const { deg, K } = structure(r, A, B, o);
  const n = K.length - deg - 1, sigs = N.greville(K, deg, n);
  const PA = sigs.map((s) => A.at(mA(s)).P), PB = sigs.map((s) => B.at(mB(s)).P);
  const FA = frames(A, sigs, mA, PB, r), FB = frames(B, sigs, mB, PA, r);
  const cA = contOf(A, r.contA), cB = contOf(B, r.contB);
  const crown = r.crown || 0, p = Math.max(1, cA + cB + 1 + (crown ? 1 : 0));
  const tA = r.tensionA ?? r.tension ?? 1, tB = r.lockShape ? tA : r.tensionB ?? r.tension ?? 1;
  const rows = sigs.map((s, i) => {
    const L = PA[i].distanceTo(PB[i]) || 1e-6, lA = L * tA, lB = L * tB;
    let cv = null;
    if (crown) {
      cv = FA[i].T.clone().cross(PB[i].clone().sub(PA[i]));
      if (cv.lengthSq() > 1e-18) cv.normalize().multiplyScalar(crown * L * 0.5); else cv = null;
    }
    return crossRow(FA[i], cA, lA, (p - 1) * (r.shapeA || 0) * lA, FB[i], cB, lB, (p - 1) * (r.shapeB || 0) * lB, p, cv);
  });
  // hacia dónde entra el blend en cada curva cerrada sobre superficie (para recortar automáticamente)
  const towards = (side, F) => {
    if (side.kind !== 'cos' || !side.loop) return null;
    const x = F[Math.floor(F.length / 2)], f = tangents(side.S, x.uv[0], x.uv[1]), w = uvDir(f, x.b), l = Math.hypot(w[0], w[1]) || 1;
    return pointInPoly(side.loop, x.uv[0] + (w[0] / l) * 2e-3, x.uv[1] + (w[1] / l) * 2e-3) ? 'inside' : 'outside';
  };
  r.info = { exact: false, rev: o.rev, towardA: towards(A, FA), towardB: towards(B, FB) };
  return { degU: deg, degV: p, knotsU: K.slice(), knotsV: N.clampedKnots(p + 1, p), cvs: fitRows(K, deg, sigs, rows) };
}

// Diagnóstico de cada lado en 9 estaciones: hueco, ángulo entre normales y curvatura normal al cruzar
export function diagnoseBlend(r, sideA, sideB, out) {
  const { A, B, mA, mB } = setup(r, sideA, sideB);
  const sigs = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => k / 10);
  const PA = sigs.map((s) => A.at(mA(s)).P), PB = sigs.map((s) => B.at(mB(s)).P);
  const O = surfEval(out), res = [];
  for (const [side, F, v0] of [[A, frames(A, sigs, mA, PB, r), 0], [B, frames(B, sigs, mB, PA, r), 1]]) {
    let gap = 0, ang = 0, curv = 0, kmax = 1e-9;
    sigs.forEach((s, i) => {
      const q = O(s, v0);
      gap = Math.max(gap, q.distanceTo(F[i].P));
      if (side.kind === 'curves') return;
      const nb = tangents(O, s, v0).n, ns = F[i].n;
      ang = Math.max(ang, THREE.MathUtils.radToDeg(Math.acos(Math.min(1, Math.abs(nb.dot(ns))))));
      const h = 2e-3, sg = v0 ? -1 : 1, pts = [0, 1, 2, 3].map((k) => O(s, v0 + sg * k * h));
      const d1 = pts[0].clone().multiplyScalar(-11).add(pts[1].clone().multiplyScalar(18)).add(pts[2].clone().multiplyScalar(-9)).add(pts[3].clone().multiplyScalar(2)).divideScalar(6 * h);
      const d2 = pts[0].clone().multiplyScalar(2).add(pts[1].clone().multiplyScalar(-5)).add(pts[2].clone().multiplyScalar(4)).sub(pts[3]).divideScalar(h * h);
      const kb = d2.dot(ns) / Math.max(1e-12, d1.lengthSq()), ks = F[i].E[2].dot(ns) / Math.max(1e-12, F[i].E[1].lengthSq());
      curv = Math.max(curv, Math.abs(kb - ks)); kmax = Math.max(kmax, Math.abs(kb), Math.abs(ks));
    });
    res.push({ gap, angle: ang, curv: curv / Math.max(kmax, 0.02) });
  }
  return res;
}
// puntos de cada lado para dibujar (y las etiquetas Inicio / Fin)
export function blendSidePoints(r, sideA, sideB, n = 60) {
  const { A, B, mA, mB } = setup(r, sideA, sideB);
  const pts = (side, m) => { const out = []; for (let i = 0; i <= n; i++) out.push(side.at(m(i / n)).P); return out; };
  return [pts(A, mA), pts(B, mB)];
}

// ---------- Extender una superficie desde un borde ----------
// La extensión sigue a la superficie con su desarrollo de Taylor (G1, G2 o G3) a lo largo de las isoparamétricas.
export function extendData(d, edge, dist, cont = 2) {
  const A = prepSide({ kind: 'edge', data: d, edge });
  const al = along(d, edge), k0 = al.knots[0], k1 = al.knots[al.knots.length - 1];
  const K = al.knots.map((k) => (k - k0) / (k1 - k0)), deg = al.deg, n = al.n, sigs = N.greville(K, deg, n);
  const map = (s) => s;
  const F = frames(A, sigs, map, sigs.map(() => V3()), { flowInt: 'iso' });
  const p = Math.max(1, Math.min(3, cont));
  const rows = F.map((f) => crossRow(f, p, Math.max(1e-4, dist), 0, null, 0, 0, 0, p, null));
  return { degU: deg, degV: p, knotsU: K, knotsV: N.clampedKnots(p + 1, p), cvs: fitRows(K, deg, sigs, rows) };
}

// ---------- Curvas sobre superficie (proyección) ----------
// mode: 'dir' = a lo largo de dir (vista o eje); 'normal' = punto más cercano. Devuelve la polilínea en (u, v).
export function projectCurve(curveData, surfData, mode, dir, n = 140) {
  const S = surfEval(surfData), c = N.curveOf(curveData);
  const d = dir ? new THREE.Vector3(...dir).normalize() : null, line = mode !== 'normal' && d;
  const resid = (P, X) => { const r = P.clone().sub(X); if (line) r.addScaledVector(d, -r.dot(d)); return r; };
  const grid = [];
  for (let i = 0; i <= 20; i++) for (let j = 0; j <= 20; j++) grid.push({ u: i / 20, v: j / 20, P: S(i / 20, j / 20) });
  const solveAt = (X, u, v) => {
    for (let it = 0; it < 18; it++) {
      const f = tangents(S, u, v);
      let Ju = f.Su, Jv = f.Sv;
      if (line) { Ju = Ju.clone().addScaledVector(d, -Ju.dot(d)); Jv = Jv.clone().addScaledVector(d, -Jv.dot(d)); }
      const r = resid(S(u, v), X), a = Ju.dot(Ju), b = Ju.dot(Jv), cc = Jv.dot(Jv), p = -Ju.dot(r), q = -Jv.dot(r), det = a * cc - b * b || 1e-12;
      let du = (p * cc - q * b) / det, dv = (a * q - b * p) / det;
      const m = Math.hypot(du, dv);
      if (m > 0.15) { du *= 0.15 / m; dv *= 0.15 / m; }
      u = clamp01(u + du); v = clamp01(v + dv);
      if (m < 1e-10) break;
    }
    return { u, v, err: resid(S(u, v), X).length() };
  };
  const uv = [];
  let prev = null;
  for (let k = 0; k <= n; k++) {
    const X = c.getPoint(k / n);
    let best = prev ? solveAt(X, prev.u, prev.v) : null;
    if (!best || best.err > 1e-3) {
      let g = grid[0], gd = Infinity;
      for (const q of grid) { const e = resid(q.P, X).lengthSq(); if (e < gd) { gd = e; g = q; } }
      const s2 = solveAt(X, g.u, g.v);
      if (!best || s2.err < best.err) best = s2;
    }
    uv.push([best.u, best.v]);
    prev = best;
  }
  const closed = c.getPoint(0).distanceTo(c.getPoint(1)) < 1e-4;
  if (closed) uv[n] = uv[0].slice();
  return { uv, closed };
}
// puntos 3D de una curva sobre superficie (lift = separarlos un poco por la normal para que se vean)
export function cosPoints(surfData, uv, lift = 0) {
  const S = surfEval(surfData);
  return uv.map(([u, v]) => { const p = S(u, v); if (lift) p.addScaledVector(tangents(S, u, v).n, lift); return p; });
}
// curva NURBS 3D que la representa (para elegirla, snap, extruirla...)
export function cosCurveData(surfData, uv, ncv = 24) {
  const pts = cosPoints(surfData, uv), sm = arcSampler(pts), K = N.clampedKnots(ncv, 3), g = N.greville(K, 3, ncv);
  return N.fitCurve(g.map((s) => { const [i, f] = sm.at(s); return pts[i].clone().lerp(pts[Math.min(pts.length - 1, i + 1)], f); }), 3, 'xz');
}

// ---------- Recortes ----------
export function pointInPoly(poly, u, v) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [ui, vi] = poly[i], [uj, vj] = poly[j];
    if ((vi > v) !== (vj > v) && u < ((uj - ui) * (v - vi)) / (vj - vi) + ui) inside = !inside;
  }
  return inside;
}
// lazo cerrado en (u, v): la curva si es cerrada; si va de borde a borde se cierra por el contorno (sentido antihorario)
export function trimLoop(cos) {
  if (cos.closed) return cos.uv;
  const b = 3e-3, uv = cos.uv;
  const per = ([u, v]) => (v < b ? u : u > 1 - b ? 1 + v : v > 1 - b ? 2 + (1 - u) : u < b ? 3 + (1 - v) : -1);
  const pa = per(uv[0]), pb = per(uv[uv.length - 1]);
  if (pa < 0 || pb < 0) return null;
  const loop = uv.slice(), target = pa <= pb ? pa + 4 : pa;
  const corner = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let c = Math.floor(pb) + 1; c < target; c++) loop.push(corner[c % 4]);
  return loop;
}
// (u, v) → true si ese punto queda recortado. trims: [{ loop, trim: 'inside' | 'outside' }]
export const removedFn = (trims) => (u, v) => trims.some((t) => pointInPoly(t.loop, u, v) === (t.trim === 'inside'));

// Recorta la malla de ParametricGeometry (segs × segs): celdas fuera se quitan, las que cruzan el borde se cortan
// buscando el cruce exacto en sus aristas (bisección). S da los puntos nuevos sobre la superficie.
export function trimGeometry(geo, segs, removed, S) {
  const n1 = segs + 1, uvA = geo.attributes.uv, count = uvA.count;
  const P = Array.from(geo.attributes.position.array), Nn = Array.from(geo.attributes.normal.array), UV = Array.from(uvA.array);
  const C = geo.attributes.color ? Array.from(geo.attributes.color.array) : null;
  const R = new Uint8Array(count);
  for (let i = 0; i < count; i++) R[i] = removed(UV[2 * i], UV[2 * i + 1]) ? 1 : 0;
  const cache = new Map(), index = [];
  let next = count;
  const edgeVert = (i0, i1) => {
    const key = i0 < i1 ? i0 * count + i1 : i1 * count + i0;
    if (cache.has(key)) return cache.get(key);
    const u0 = UV[2 * i0], v0 = UV[2 * i0 + 1], u1 = UV[2 * i1], v1 = UV[2 * i1 + 1], r0 = !!R[i0];
    let lo = 0, hi = 1;
    for (let k = 0; k < 18; k++) { const m = (lo + hi) / 2; if (removed(u0 + (u1 - u0) * m, v0 + (v1 - v0) * m) === r0) lo = m; else hi = m; }
    const f = (lo + hi) / 2, u = u0 + (u1 - u0) * f, v = v0 + (v1 - v0) * f, p = S(u, v);
    P.push(p.x, p.y, p.z); UV.push(u, v);
    const nn = [0, 1, 2].map((k) => Nn[3 * i0 + k] * (1 - f) + Nn[3 * i1 + k] * f), l = Math.hypot(...nn) || 1;
    Nn.push(nn[0] / l, nn[1] / l, nn[2] / l);
    if (C) for (let k = 0; k < 3; k++) C.push(C[3 * i0 + k] * (1 - f) + C[3 * i1 + k] * f);
    cache.set(key, next);
    return next++;
  };
  for (let i = 0; i < segs; i++) for (let j = 0; j < segs; j++) {
    const a = i * n1 + j, b = (i + 1) * n1 + j, c = (i + 1) * n1 + j + 1, d = i * n1 + j + 1;
    const q = [a, b, c, d], cut = R[a] + R[b] + R[c] + R[d];
    if (cut === 0) { index.push(a, b, d, b, c, d); continue; }
    if (cut === 4) continue;
    const poly = [];
    for (let k = 0; k < 4; k++) {
      const x = q[k], y = q[(k + 1) % 4];
      if (!R[x]) poly.push(x);
      if (R[x] !== R[y]) poly.push(edgeVert(x, y));
    }
    for (let m = 1; m < poly.length - 1; m++) index.push(poly[0], poly[m], poly[m + 1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  if (C) g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  g.setIndex(index);
  return g;
}
