// Módulo IA de Forja: generadores paramétricos exactos y un intérprete de pedidos en español.
// Los generadores trabajan en milímetros (tornillería) o centímetros (muebles) y devuelven geometría
// en decímetros con Y hacia arriba, que es como trabaja Forja. La base de cada pieza queda en y = 0.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

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
export function table({ w = 120, dep = 80, h = 75, legs = 'recta', top = 3 }) {
  const parts = [], r = Math.min(4, w * 0.04);
  const sh = new THREE.Shape(), x = w / 2, z = dep / 2, c = Math.min(3, Math.min(w, dep) * 0.08);
  sh.moveTo(-x + c, -z); sh.lineTo(x - c, -z); sh.quadraticCurveTo(x, -z, x, -z + c); sh.lineTo(x, z - c); sh.quadraticCurveTo(x, z, x - c, z);
  sh.lineTo(-x + c, z); sh.quadraticCurveTo(-x, z, -x, z - c); sh.lineTo(-x, -z + c); sh.quadraticCurveTo(-x, -z, -x + c, -z);
  parts.push(extrudeY(sh, top, h - top, 0.4));
  const lh = h - top, inset = 6;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = legs === 'conica' ? new THREE.CylinderGeometry(r, r * 0.45, lh, 32)
      : legs === 'redonda' ? new THREE.CylinderGeometry(r, r, lh, 32)
      : new THREE.BoxGeometry(r * 1.6, lh, r * 1.6);
    leg.translate(sx * (x - inset), lh / 2, sz * (z - inset));
    parts.push(leg);
  }
  return { geometry: finish(parts, CM), name: `Mesa ${w}×${dep}` };
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

export const GENERATORS = { bolt, nut, washer, table, chair };

// ---------- Intérprete de pedidos en español ----------
const NUMS = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10 };
function count(txt) {
  const m = txt.match(/^\s*(\d+|un[ao]?|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\b/);
  return m ? Math.min(20, +m[1] || NUMS[m[1]] || 1) : 1;
}
function nearestSize(d) { return SIZES.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a)); }

// Devuelve [{ type, params, n }] o null si no entiende el pedido
export function parsePrompt(text) {
  const out = [];
  const parts = text.toLowerCase().replace(/,/g, ' , ').split(/\s+y\s+|;|\s,\s(?=\s*(?:\d+|un|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)?\s*(?:tornillo|perno|tuerca|arandela|mesa|silla))/);
  for (const raw of parts) {
    const t = raw.trim();
    if (!t) continue;
    const n = count(t);
    const M = t.match(/\bm\s?(\d{1,2})(?:\s*[x×]\s*(\d+(?:\.\d+)?))?/);
    if (/tornillo|perno|bolt/.test(t)) {
      const d = nearestSize(M ? +M[1] : 6);
      const lm = M?.[2] || t.match(/(?:de|largo|longitud)\s*(\d+(?:\.\d+)?)\s*mm/)?.[1] || t.match(/(\d+(?:\.\d+)?)\s*mm/)?.[1];
      const head = /allen|hueca|hexagono interior|cil[ií]ndrica|socket/.test(t) ? 'allen' : 'hex';
      out.push({ type: 'bolt', params: { d, L: Math.max(d, Math.round(+(lm || d * 5))), head }, n });
    } else if (/tuerca/.test(t)) out.push({ type: 'nut', params: { d: nearestSize(M ? +M[1] : 6) }, n });
    else if (/arandela/.test(t)) out.push({ type: 'washer', params: { d: nearestSize(M ? +M[1] : 6) }, n });
    else if (/mesa/.test(t)) {
      const dim = t.match(/(\d+)\s*[x×]\s*(\d+)/);
      const h = t.match(/(?:alt[oa]|altura)\s*(?:de)?\s*(\d+)/)?.[1];
      const legs = /c[oó]nic/.test(t) ? 'conica' : /redond|cil[ií]ndr/.test(t) ? 'redonda' : 'recta';
      out.push({ type: 'table', params: { w: +(dim?.[1] || 120), dep: +(dim?.[2] || 80), h: +(h || 75), legs }, n });
    } else if (/silla/.test(t)) {
      const s = t.match(/(?:asiento|alt[oa]|altura)\s*(?:de)?\s*(\d+)/)?.[1];
      out.push({ type: 'chair', params: { seat: +(s || 45) }, n });
    }
  }
  return out.length ? out : null;
}

// Instrucciones para que Claude traduzca pedidos libres a los mismos comandos
export const CLAUDE_INSTRUCTIONS = `Eres el módulo IA de Forja, un modelador 3D. Traduce el pedido del usuario a un JSON
con la forma {"items":[{"type":"bolt|nut|washer|table|chair","params":{...},"n":1}],"note":"explicación breve en español"}.
Parámetros: bolt {d: métrica ISO en mm (3,4,5,6,8,10,12,16,20), L: largo en mm, head: "hex"|"allen"}; nut {d}; washer {d};
table {w, dep, h en cm, legs: "recta"|"conica"|"redonda"}; chair {seat: altura del asiento en cm}. n = cantidad (máx 20).
Si el pedido no se puede hacer con esos tipos, devuelve items vacío y explica en note qué falta. Responde solo con el JSON.`;
