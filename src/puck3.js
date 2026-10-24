// Puck de MODELADO (Z): tres categorías (Curvas, Superficies, Sólidos) con hasta 3 anillos de herramientas cada una.
// Estética neumórfica de vista frontal: todo es del color del muro que hay detrás (se mide al abrir) y el volumen sale solo
// de sombras exteriores e interiores. Cada categoría guarda sus anillos plegados como "ondas" comprimidas alrededor de su
// círculo: clic en el círculo suelta la 1.ª onda (gota que se expande y levanta el anillo 1); clic en la zona de ondas (X)
// suelta la siguiente. Lo desplegado se recuerda entre aperturas (cfg.open). Interfaz igual a la de los menús radiales:
// show / close / pickAt / open / sticky / hover / t0 / el (para mantener Z, pasar por una herramienta y soltar).

const RC = 40;                 // radio del círculo de categoría
const WAVE0 = RC + 9, WAVE_STEP = 9, WAVE_W = 7;   // ondas comprimidas
const RX = RC + 36;            // fin de la zona de ondas (X)
const RW = 50, RGAP = 6;       // ancho de cada anillo de herramientas y separación
const ringIn = (k) => RX + 6 + k * (RW + RGAP), ringOut = (k) => ringIn(k) + RW, ringMid = (k) => ringIn(k) + RW / 2;
const ROW_STEP = 2 * RX + 18;  // separación de las 3 categorías al abrir
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const T = (ms) => (reduce.matches ? 0 : ms);

export function createPuck3({ cats, lib, icon, esc, cfg, save, run, wallColor, soon }) {
  const el = document.createElement('div');
  el.className = 'puck puck3'; el.hidden = true;
  el.innerHTML = '<div class="p3-veil"></div><div class="p3-stage"></div><div class="p3-label"><b></b><span></span></div>';
  document.body.append(el);
  const veil = el.querySelector('.p3-veil'), stage = el.querySelector('.p3-stage'), lab = el.querySelector('.p3-label');
  const st = { el, open: false, sticky: false, hover: null, t0: 0, at: { x: 0, y: 0 } };
  const ringsOf = (c) => (cfg.rings?.[c] || cats.find((x) => x.id === c).rings).map((r) => r.filter((id) => lib[id])).filter((r) => r.length);
  const openOf = (c) => Math.min(cfg.open?.[c] || 0, ringsOf(c).length);
  const setOpen = (c, n) => { cfg.open = { ...(cfg.open || {}), [c]: n }; save(); };
  const catEls = {};
  let ringEls = [], tools = [], ripple = null;

  // ---------- construcción ----------
  for (const c of cats) {
    const g = document.createElement('div');
    g.className = 'p3-cat'; g.dataset.cat = c.id;
    g.innerHTML = `<div class="p3-x" title="Clic: soltar la siguiente onda (otro anillo de herramientas)"></div><div class="p3-waves"></div>
      <button class="p3-core" aria-label="${esc(c.label)}">${icon(c.k)}<span>${esc(c.label)}</span></button>`;
    stage.append(g);
    catEls[c.id] = g;
    g.querySelector('.p3-core').addEventListener('click', (e) => { e.stopPropagation(); coreClick(c.id); });
    g.querySelector('.p3-x').addEventListener('click', (e) => { e.stopPropagation(); xClick(c.id); });
    g.querySelector('.p3-core').addEventListener('pointerenter', () => setLabel(c.label, cfg.active === c.id && openOf(c.id) ? 'clic: plegar todo' : 'clic: abrir'));
  }
  const waves = (c) => {
    const box = catEls[c].querySelector('.p3-waves'), n = ringsOf(c).length - (cfg.active === c ? openOf(c) : 0);
    box.innerHTML = Array.from({ length: n }, (_, i) => { const r = WAVE0 + i * WAVE_STEP; return `<i style="width:${2 * r}px;height:${2 * r}px;left:${-r}px;top:${-r}px"></i>`; }).join('');
  };
  const setLabel = (b, s = '') => { lab.querySelector('b').textContent = b; lab.querySelector('span').textContent = s; };

  // anillos de la categoría activa
  function buildRings() {
    ringEls.forEach((r) => r.remove()); ringEls = []; tools = [];
    const c = cfg.active; if (!c) return;
    ringsOf(c).forEach((ids, k) => {
      const a = ringIn(k), b = ringOut(k), r = document.createElement('div');
      r.className = 'p3-ring'; r.hidden = true;
      r.style.cssText = `width:${2 * b}px;height:${2 * b}px;left:${-b}px;top:${-b}px;border-width:${b - a}px`;
      ids.forEach((id, i) => {
        const t = lib[id], ang = -Math.PI / 2 + (i / ids.length) * Math.PI * 2, m = ringMid(k);
        const btn = document.createElement('button');
        btn.className = 'p3-tool' + (t.soon ? ' soon' : '');
        btn.innerHTML = icon(t.k); btn.setAttribute('aria-label', t.label);
        // los hijos se miden desde dentro del borde: el centro del anillo queda en (a, a)
        btn.style.left = a + Math.cos(ang) * m + 'px'; btn.style.top = a + Math.sin(ang) * m + 'px';
        const tool = { id, t, k, ang, x: Math.cos(ang) * m, y: Math.sin(ang) * m, btn };
        btn.addEventListener('pointerenter', () => hoverTool(tool));
        btn.addEventListener('click', (e) => { e.stopPropagation(); hoverTool(tool); st.close(true); });
        r.append(btn); tools.push(tool);
      });
      catEls[c].append(r); ringEls.push(r);
    });
  }
  function hoverTool(tool) {
    st.hover = tool;
    tools.forEach((x) => x.btn.classList.toggle('on', x === tool));
    if (tool) setLabel(tool.t.label, tool.t.soon ? 'próximamente' : lib[tool.id].shared ? 'en ' + cats.find((c) => c.id === cfg.active).label.toLowerCase() : '');
    else setLabel(cfg.active ? cats.find((c) => c.id === cfg.active).label : 'Puck', cfg.active ? 'clic en las ondas: otro anillo' : 'elige una categoría');
  }

  // ---------- colocación (fila de 3 o categoría activa en el centro) ----------
  function outerR() { const c = cfg.active, n = c ? openOf(c) : 0; return n ? ringOut(n - 1) : RX; }
  function layout(animate = true) {
    const c = cfg.active, n = c ? openOf(c) : 0, expanded = !!(c && n);
    el.classList.toggle('expanded', expanded);
    const dur = animate ? T(230) : 0;
    cats.forEach((cat, i) => {
      let x, y, s;
      if (!expanded) { x = (i - 1) * ROW_STEP; y = 0; s = 1; }
      else if (cat.id === c) { x = 0; y = 0; s = 1; }
      else { const others = cats.filter((q) => q.id !== c), j = others.indexOf(cat), a = (j ? -40 : -140) * Math.PI / 180, d = outerR() + 52;
        x = Math.cos(a) * d; y = Math.sin(a) * d; s = 0.6; }
      const g = catEls[cat.id];
      g.style.transition = dur ? `transform ${dur}ms cubic-bezier(.2,.9,.3,1.1)` : 'none';
      g.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      g.classList.toggle('active', cat.id === c && expanded);
      waves(cat.id);
    });
    // desenfoque local: una elipse suave que encierra lo que se ve (no toda la pantalla)
    const w = expanded ? 2 * (outerR() + 96) : 3 * ROW_STEP + 40, h = expanded ? w : 2 * RX + 90;
    veil.style.transition = dur ? `width ${dur}ms ease-out, height ${dur}ms ease-out, left ${dur}ms ease-out, top ${dur}ms ease-out` : 'none';
    Object.assign(veil.style, { width: w + 'px', height: h + 'px', left: -w / 2 + 'px', top: -h / 2 + 'px' });
    ringEls.forEach((r, k) => (r.hidden = !(expanded && k < n)));
    lab.style.top = (expanded ? outerR() + 16 : RX + 22) + 'px';
    hoverTool(null);
  }

  // ---------- ondas ----------
  function release(c) {               // suelta la siguiente onda: gota que se expande y levanta el anillo
    const n = openOf(c), total = ringsOf(c).length;
    if (n >= total) return false;
    const r0 = WAVE0 + (total - n - 1) * WAVE_STEP, r1 = ringMid(n);
    setOpen(c, n + 1);
    drop(c, r0, r1, false);
    layout(true);
    const ring = ringEls[n];
    if (ring && !reduce.matches) {
      ring.animate([{ opacity: 0, transform: 'scale(.9)', boxShadow: 'none' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: T(190), delay: T(90), easing: 'cubic-bezier(.2,.9,.3,1.15)', fill: 'backwards' });
      ring.querySelectorAll('.p3-tool').forEach((b, i) => b.animate([{ opacity: 0, transform: 'scale(.4)' }, { opacity: 1, transform: 'scale(1)' }],
        { duration: T(170), delay: T(130 + i * 12), easing: 'ease-out', fill: 'backwards' }));
    }
    return true;
  }
  function retract(c) {               // la última onda vuelve a la zona comprimida
    const n = openOf(c); if (!n) return;
    const ring = ringEls[n - 1], total = ringsOf(c).length;
    drop(c, ringMid(n - 1), WAVE0 + (total - n) * WAVE_STEP, true);
    const done = () => { setOpen(c, n - 1); layout(true); };
    if (ring && !reduce.matches) ring.animate([{ opacity: 1, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(.9)' }], { duration: T(140), easing: 'ease-in' }).onfinish = done;
    else done();
  }
  function drop(c, r0, r1, inward) {   // anillo fino que viaja como una gota sobre el agua
    ripple?.remove();
    const d = document.createElement('i'); d.className = 'p3-drop';
    const R = Math.max(r0, r1);
    d.style.cssText = `width:${2 * R}px;height:${2 * R}px;left:${-R}px;top:${-R}px`;
    catEls[c].append(d); ripple = d;
    const a = d.animate([{ transform: `scale(${r0 / R})`, opacity: 0.95 }, { transform: `scale(${r1 / R})`, opacity: 0 }],
      { duration: T(inward ? 160 : 240), easing: inward ? 'ease-in' : 'cubic-bezier(.15,.8,.3,1)' });
    a.onfinish = () => d.remove();
  }
  function coreClick(c) {
    if (cfg.active !== c || !openOf(c)) {     // abrir esta categoría (su 1.ª onda, o como la dejaste)
      const prev = cfg.active; cfg.active = c; save();
      if (prev !== c) buildRings();
      if (!openOf(c)) release(c); else layout(true);
    } else { setOpen(c, 0); layout(true); }   // plegar todo: vuelven las 3 categorías
  }
  function xClick(c) {
    if (cfg.active !== c || !openOf(c)) return coreClick(c);
    if (!release(c)) retract(c);            // sin ondas que soltar: la última vuelve a plegarse
  }

  // ---------- interfaz común con los menús radiales ----------
  st.show = (x, y) => {
    const m = ringOut(2) + 70, mx = 3 * ROW_STEP / 2 + 30;
    st.at = { x: Math.min(innerWidth - mx, Math.max(mx, x)), y: Math.min(innerHeight - m * 0.92, Math.max(m * 0.85, y)) };
    el.style.left = st.at.x + 'px'; el.style.top = st.at.y + 'px';
    el.style.setProperty('--p3', wallColor(st.at.x, st.at.y));   // el color exacto del muro en ese sitio
    if (cfg.active && !ringsOf(cfg.active).length) cfg.active = null;
    buildRings(); layout(false);
    el.hidden = false; st.open = true; st.sticky = false; st.t0 = performance.now();
    if (!reduce.matches) {
      veil.animate([{ opacity: 0 }, { opacity: 1 }], { duration: T(150) });
      stage.animate([{ opacity: 0, transform: 'scale(.86)' }, { opacity: 1, transform: 'scale(1)' }], { duration: T(170), easing: 'cubic-bezier(.2,.9,.3,1.15)' });
    }
  };
  st.close = (go) => {
    if (!st.open) return;
    st.open = false; el.hidden = true;
    const h = st.hover; st.hover = null;
    if (go && h) (h.t.soon || !h.t.run ? soon(h.t.label) : () => run(h.id, cfg.active))();
  };
  // mantener Z y pasar por encima: marca la herramienta del anillo (por distancia al centro y ángulo)
  st.pickAt = (px, py) => {
    const c = cfg.active, n = c ? openOf(c) : 0;
    if (!n) return;
    const dx = px - st.at.x, dy = py - st.at.y, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    const k = [...Array(n).keys()].find((q) => d >= ringIn(q) - 4 && d <= ringOut(q) + 4);
    if (k == null) { if (st.hover && !st.hover.btn.matches(':hover')) hoverTool(null); return; }
    let best = null, bd = 1e9;
    for (const t of tools) if (t.k === k) { const da = Math.abs(Math.atan2(Math.sin(a - t.ang), Math.cos(a - t.ang))); if (da < bd) { bd = da; best = t; } }
    if (best !== st.hover) hoverTool(best);
  };
  return st;
}
