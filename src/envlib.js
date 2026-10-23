// Biblioteca de entornos (HDRI) de Forja: generadores procedurales, miniaturas de esfera espejo y giro de mapas equirectangulares.
// Convención de los mapas (la misma del motor WebGPU y de PMREM de three): fila 0 = arriba; u = atan2(z, x) / 2π + 0.5; v = acos(y) / π.
// Un mapa es { w, h, data } con data = Uint16Array RGBA en media precisión (half float).
import * as THREE from 'three';

const half = THREE.DataUtils.toHalfFloat, unhalf = THREE.DataUtils.fromHalfFloat;

function make(w, h, fn) {
  const data = new Uint16Array(w * h * 4), d = [0, 0, 0];
  for (let j = 0; j < h; j++) {
    const th = ((j + 0.5) / h) * Math.PI, sy = Math.cos(th), sr = Math.sin(th);
    for (let i = 0; i < w; i++) {
      const ph = ((i + 0.5) / w - 0.5) * 2 * Math.PI;
      d[0] = Math.cos(ph) * sr; d[1] = sy; d[2] = Math.sin(ph) * sr;
      const c = fn(d), o = (j * w + i) * 4;
      data[o] = half(c[0]); data[o + 1] = half(c[1]); data[o + 2] = half(c[2]); data[o + 3] = half(1);
    }
  }
  return { w, h, data };
}
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

// caja de luz rectangular (igual que en webgpu-env.js)
function box(d, c, ex, ey, w, h, col) {
  const t = dot(d, c); if (t <= 0.05) return [0, 0, 0];
  const p = [d[0] / t - c[0], d[1] / t - c[1], d[2] / t - c[2]];
  const u = Math.abs(dot(p, ex)) / w, v = Math.abs(dot(p, ey)) / h;
  const m = (1 - ss(0.55, 1, u)) * (1 - ss(0.55, 1, v)), core = 0.55 + 0.45 * (1 - ss(0, 1, Math.max(u, v)));
  return [col[0] * m * core, col[1] * m * core, col[2] * m * core];
}
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

export const BUILTIN = [
  { id: 'studio', name: 'Estudio' },
  { id: 'sun', name: 'Exterior' },
  { id: 'sunset', name: 'Atardecer' },
  { id: 'overcast', name: 'Nublado' },
];

export function builtinMap(id, w = 256, h = 128) {
  if (id === 'studio') return make(w, h, (d) => {
    let c = mix([0.004, 0.005, 0.008], [0.035, 0.04, 0.055], ss(-0.3, 1, d[1]));
    if (d[1] < 0) c = [0.005 * (1 + 2 * d[1]), 0.005 * (1 + 2 * d[1]), 0.006 * (1 + 2 * d[1])];
    c = add(c, box(d, norm([0, 1, 0.12]), [1, 0, 0], [0, 0, 1], 1, 0.7, [3.6, 3.6, 3.7]));
    c = add(c, box(d, norm([-1, 0.25, 0.35]), [0, 0, 1], [0, 1, 0], 0.55, 1, [3.4, 3.4, 3.5]));
    c = add(c, box(d, norm([1, 0.2, -0.25]), [0, 0, 1], [0, 1, 0], 0.5, 0.95, [2.2, 2.6, 3.4]));
    c = add(c, box(d, norm([0.25, 0.45, -1]), [1, 0, 0], [0, 1, 0], 1, 0.25, [6, 5.6, 5.2]));
    return add(c, box(d, norm([-0.1, 0.1, 1]), [1, 0, 0], [0, 1, 0], 0.6, 0.14, [1.2, 1.2, 1.3]));
  });
  if (id === 'overcast') return make(w, h, (d) => { const t = ss(-0.15, 0.5, d[1]), c = mix([0.16, 0.15, 0.14], [0.85, 0.87, 0.9], t); return [c[0] * 1.4, c[1] * 1.4, c[2] * 1.4]; });
  const sunset = id === 'sunset';
  const sun = norm([Math.cos((140 * Math.PI) / 180) * Math.cos(((sunset ? 3 : 38) * Math.PI) / 180), Math.sin(((sunset ? 3 : 38) * Math.PI) / 180), Math.sin((140 * Math.PI) / 180) * Math.cos(((sunset ? 3 : 38) * Math.PI) / 180)]);
  return make(w, h, (d) => {
    const y = d[1];
    let c = y > 0 ? mix(sunset ? [1.5, 0.75, 0.4] : [1.3, 1.25, 1.1], sunset ? [0.25, 0.3, 0.6] : [0.3, 0.55, 1.2], ss(0, 0.8, y)) : mix(sunset ? [0.3, 0.18, 0.1] : [0.4, 0.37, 0.3], [0.05, 0.045, 0.04], ss(0, -0.6, y));
    const a = Math.acos(Math.min(1, Math.max(-1, dot(d, sun))));
    const s = Math.exp(-((a / 0.045) ** 2)) * (sunset ? 40 : 70) + Math.exp(-((a / 0.4) ** 2)) * 1.2;
    return add(c, sunset ? [s, s * 0.7, s * 0.4] : [s, s * 0.95, s * 0.85]);
  });
}

// gira el mapa en horizontal (grados): para el motor clásico, que no sabe girar el entorno
export function rollMap(m, deg) {
  const sh = Math.round(((((deg % 360) + 360) % 360) / 360) * m.w);
  if (!sh) return m;
  const data = new Uint16Array(m.data.length);
  for (let j = 0; j < m.h; j++) for (let i = 0; i < m.w; i++) {
    const s = (j * m.w + ((i + sh) % m.w)) * 4, o = (j * m.w + i) * 4;
    data[o] = m.data[s]; data[o + 1] = m.data[s + 1]; data[o + 2] = m.data[s + 2]; data[o + 3] = m.data[s + 3];
  }
  return { w: m.w, h: m.h, data };
}

// miniatura: esfera espejo (como las esferas de Plasticity) vista de frente
export function thumb(m, size = 56) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const nx = ((x + 0.5) / size) * 2 - 1, ny = 1 - ((y + 0.5) / size) * 2, r2 = nx * nx + ny * ny, o = (y * size + x) * 4;
    if (r2 > 1) { img.data[o + 3] = 0; continue; }
    const nz = Math.sqrt(1 - r2), k = 2 * nz;
    const r = [k * nx, k * ny, k * nz - 1];
    const u = Math.atan2(r[2], r[0]) / (2 * Math.PI) + 0.5, v = Math.acos(Math.min(1, Math.max(-1, r[1]))) / Math.PI;
    const i = Math.min(m.w - 1, Math.max(0, Math.floor(u * m.w))), j = Math.min(m.h - 1, Math.max(0, Math.floor(v * m.h))), s = (j * m.w + i) * 4;
    for (let q = 0; q < 3; q++) { const val = Math.max(0, unhalf(m.data[s + q])) * 0.9, t = val / (1 + val); img.data[o + q] = Math.round(255 * Math.pow(t, 1 / 2.2) * (0.35 + 0.65 * nz ** 0.3)); }
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Entornos de Alias: PNG sRGB de 8 bits -> mapa lineal en media precisión. Un PNG de 8 bits recorta las luces a blanco, así que se estiran
// suavemente (hasta x4 en lo más blanco) para que la franja del horizonte o las cajas de luz sigan iluminando y reflejándose como luces de verdad.
export async function decodePngEnv(b64) {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, c.width, c.height).data, data = new Uint16Array(c.width * c.height * 4);
  for (let i = 0; i < px.length; i += 4) {
    for (let q = 0; q < 3; q++) {
      const s = px[i + q] / 255, lin = s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      data[i + q] = half(lin * (1 + 3 * ss(0.8, 1, s)));
    }
    data[i + 3] = half(1);
  }
  return { w: c.width, h: c.height, data };
}
