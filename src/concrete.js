// Fondo de la app: superficie cepillada (vetas horizontales finas), con una luz suave en el centro
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

  // Vetas horizontales: muchas líneas finas de largo y opacidad variables (efecto cepillado)
  const count = Math.round(h * 2.2);
  for (let i = 0; i < count; i++) {
    const y = r() * h, x = r() * w * 0.6 - w * 0.2, len = w * (0.2 + r() * 0.9);
    const a = 0.015 + r() * 0.05, lightLine = r() > 0.5;
    const grd = g.createLinearGradient(x, 0, x + len, 0);
    const col = (lightLine ? P.light : P.shade);
    grd.addColorStop(0, col + '0)');
    grd.addColorStop(0.5, col + a + ')');
    grd.addColorStop(1, col + '0)');
    g.fillStyle = grd;
    g.fillRect(x, y, len, r() > 0.85 ? 2 : 1);
  }
  // Grano muy fino
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 6;
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
