// Logotipo "Nodo": FORJA dentro de un marco de construcción en trazo fino. Las líneas se pasan de largo
// en las esquinas, como en un dibujo técnico, y en la esquina inferior derecha se detienen antes de
// un + azul grueso, que queda como un punto de control.
const NS = 'http://www.w3.org/2000/svg';
const FS = 100, LS = 0.12 * FS, BLUE = '#2f7bff';

const el = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };

export async function drawLogo(svg) {
  try { await document.fonts.load(`500 ${FS}px Outfit`); } catch (e) { /* sin la fuente, se usa la de respaldo */ }
  const ctx = document.createElement('canvas').getContext('2d');
  ctx.font = `500 ${FS}px Outfit, Jost, system-ui, sans-serif`;
  const capH = ctx.measureText('F').actualBoundingBoxAscent;
  const w = ctx.measureText('FORJA').width + LS * 4;
  const p = 0.42 * capH, o = 0.5 * capH;
  const L = -p, R = w + LS + 0.7 * capH, T = -capH - p, B = p;
  const arm = 0.62 * capH, gap = 0.34 * capH, plusW = 0.14 * FS;
  // el marco siempre mide 1 px en pantalla, para que se vea fino a cualquier tamaño
  const frame = (x1, y1, x2, y2) => el('line', { x1, y1, x2, y2, stroke: 'currentColor', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' });
  svg.replaceChildren(
    frame(L - o, T, R + o * 0.6, T),
    frame(L - o * 0.7, B, R - arm - gap, B),
    frame(L, T - o * 0.6, L, B + o),
    frame(R, T - o, R, B - arm - gap),
    Object.assign(el('text', { x: 0, y: 0, 'font-family': 'Outfit, Jost, system-ui, sans-serif', 'font-weight': 500, 'font-size': FS, 'letter-spacing': LS, fill: 'currentColor' }), { textContent: 'FORJA' }),
    el('rect', { x: R - arm, y: B - plusW / 2, width: arm * 2, height: plusW, fill: BLUE }),
    el('rect', { x: R - plusW / 2, y: B - arm, width: plusW, height: arm * 2, fill: BLUE }),
  );
  const pad = 2;
  svg.setAttribute('viewBox', [L - o - pad, T - o - pad, R + arm - (L - o) + 2 * pad, B + Math.max(o, arm) - (T - o) + 2 * pad].join(' '));
}
