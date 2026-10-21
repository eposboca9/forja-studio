// Textura de hormigón visto generada por código (sin imágenes): manchas suaves, grano, poros,
// juntas del encofrado y los agujeros de los tensores, como en un muro arquitectónico.
const PANEL_W = 350, PANEL_H = 175;

function rand(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export function concreteTexture({ w = 1400, h = 1050, base = '#c7c5c0', seed = 7, joints = true, mottle = 1 } = {}) {
  const r = rand(seed);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Manchas grandes y suaves (variación del vertido)
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h, rad = 40 + r() * 260, light = r() > 0.5;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, light ? `rgba(255,255,255,${0.05 * mottle})` : `rgba(70,64,56,${0.05 * mottle})`);
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  // Escurrimientos verticales de humedad
  for (let i = 0; i < 26; i++) {
    const x = r() * w, y = r() * h * 0.7, len = 80 + r() * 320, wd = 6 + r() * 26;
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, `rgba(60,56,50,${0.05 * mottle})`);
    grd.addColorStop(1, 'rgba(60,56,50,0)');
    g.fillStyle = grd;
    g.fillRect(x, y, wd, len);
  }
  // Grano fino
  const img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 5; // grano muy fino: el hormigón visto es liso
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // Poros (burbujas de aire)
  for (let i = 0; i < 420 * mottle; i++) {
    const x = r() * w, y = r() * h, rad = 0.4 + r() * r() * 1.4;
    g.fillStyle = `rgba(45,42,38,${0.12 + r() * 0.25})`;
    g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }

  if (joints) {
    // Juntas del encofrado: una línea oscura con un filo de luz debajo
    g.lineWidth = 1;
    for (let x = 0; x <= w; x += PANEL_W) {
      g.strokeStyle = 'rgba(40,37,33,0.30)'; g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, h); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(x + 1.5, 0); g.lineTo(x + 1.5, h); g.stroke();
    }
    for (let y = 0; y <= h; y += PANEL_H) {
      g.strokeStyle = 'rgba(40,37,33,0.30)'; g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(w, y + 0.5); g.stroke();
      g.strokeStyle = 'rgba(255,255,255,0.28)'; g.beginPath(); g.moveTo(0, y + 1.5); g.lineTo(w, y + 1.5); g.stroke();
    }
    // Agujeros de los tensores: dos por panel, en el tercio superior e inferior
    for (let px = 0; px < w; px += PANEL_W) for (let py = 0; py < h; py += PANEL_H) {
      for (const [fx, fy] of [[0.25, 0.3], [0.75, 0.3], [0.25, 0.7], [0.75, 0.7]]) {
        const x = px + PANEL_W * fx, y = py + PANEL_H * fy;
        const grd = g.createRadialGradient(x, y - 0.6, 0, x, y, 3.6);
        grd.addColorStop(0, 'rgba(25,23,20,0.85)');
        grd.addColorStop(0.7, 'rgba(40,37,33,0.55)');
        grd.addColorStop(1, 'rgba(255,255,255,0.12)');
        g.fillStyle = grd;
        g.beginPath(); g.arc(x, y, 3.6, 0, Math.PI * 2); g.fill();
      }
    }
  }
  return c.toDataURL('image/jpeg', 0.86);
}

export function applyConcrete() {
  const root = document.documentElement.style;
  root.setProperty('--concrete', `url(${concreteTexture()})`);
  root.setProperty('--concrete-slab', `url(${concreteTexture({ w: 700, h: 700, base: '#d6d4cf', seed: 21, joints: false, mottle: 0.45 })})`);
}
