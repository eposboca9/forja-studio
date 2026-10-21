// Fondo de la app: piedra rugosa (ruido en varias escalas y arañazos sutiles), con una luz suave en el centro
// y los bordes en penumbra. Una sola imagen del tamaño de la pantalla, en versión clara u oscura.

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const PALETTES = {
  dark: { base: [34, 34, 35], light: 'rgba(255,255,255,', shade: 'rgba(0,0,0,', glow: 0.22, edge: 0.82 },
  light: { base: [206, 205, 202], light: 'rgba(255,255,255,', shade: 'rgba(40,38,34,', glow: 0.35, edge: 0.32 },
};

export function brushedTexture({ w = 1600, h = 900, theme = 'dark', seed = 11 } = {}) {
  const P = PALETTES[theme], r = rand(seed);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = `rgb(${P.base.join(',')})`;
  g.fillRect(0, 0, w, h);

  // Ruido en varias escalas (piedra rugosa): rejillas pequeñas de valores al azar, ampliadas con suavizado
  const octaves = [[6, 0.22], [16, 0.16], [44, 0.13], [120, 0.11], [320, 0.1], [700, 0.09]];
  for (const [cells, alpha] of octaves) {
    const cw = Math.max(2, Math.round(cells * (w / h))), ch = cells;
    const n = document.createElement('canvas');
    n.width = cw; n.height = ch;
    const ng = n.getContext('2d'), nd = ng.createImageData(cw, ch);
    for (let k = 0; k < nd.data.length; k += 4) {
      const v = Math.round(r() * 255);
      nd.data[k] = nd.data[k + 1] = nd.data[k + 2] = v; nd.data[k + 3] = 255;
    }
    ng.putImageData(nd, 0, 0);
    g.imageSmoothingEnabled = true;
    g.globalAlpha = alpha * (theme === 'dark' ? 0.55 : 0.4);
    g.globalCompositeOperation = 'overlay';
    g.drawImage(n, 0, 0, w, h);
  }
  g.globalAlpha = 1;
  g.globalCompositeOperation = 'source-over';

  // Pocos arañazos finos en direcciones al azar
  for (let i = 0; i < 70; i++) {
    const x = r() * w, y = r() * h, ang = r() * Math.PI, len = 20 + r() * 160;
    g.strokeStyle = (r() > 0.5 ? P.light : P.shade) + (0.03 + r() * 0.05) + ')';
    g.lineWidth = 0.6;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
  }
  // Grano fino y rugoso
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 14;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  // Luz suave en el centro
  const cx = w / 2, cy = h * 0.48, R = Math.hypot(w, h) / 2;
  let grd = g.createRadialGradient(cx, cy, 0, cx, cy, R * 0.75);
  grd.addColorStop(0, `rgba(255,255,255,${P.glow})`);
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  // Bordes en penumbra (viñeta)
  grd = g.createRadialGradient(cx, cy, R * 0.35, cx, cy, R * 1.05);
  grd.addColorStop(0, 'rgba(0,0,0,0)');
  grd.addColorStop(1, `rgba(0,0,0,${P.edge})`);
  g.fillStyle = grd; g.fillRect(0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.9);
}

// Una sola imagen del tamaño de la pantalla; se regenera al cambiar el tamaño o el tema.
export function applyBackground(getTheme) {
  const root = document.documentElement.style;
  const paint = () => {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    root.setProperty('--wall', `url(${brushedTexture({ w: Math.round(innerWidth * dpr), h: Math.round(innerHeight * dpr), theme: getTheme() })})`);
  };
  paint();
  let t = 0;
  addEventListener('resize', () => { clearTimeout(t); t = setTimeout(paint, 250); });
  return paint;
}
