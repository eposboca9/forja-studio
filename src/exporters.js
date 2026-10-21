// Exportación e importación de Forja: IGES y STEP (NURBS exactas), malla de cuadriláteros para SubD,
// líneas 2D (SVG y DXF) y un .zip sencillo. Las mallas OBJ/STL/GLB/PLY usan los exportadores de three.js (en main.js).
//
// Convención: Forja trabaja en decímetros con Y hacia arriba. Los formatos CAD usan normalmente milímetros
// y Z hacia arriba (Alias, CATIA, SolidWorks...). `toCAD` y `fromCAD` hacen ese cambio.

export const UNITS = { mm: 100, cm: 10, dm: 1, m: 0.1 };          // factor desde dm
const UNIT_NAMES = { mm: 'MM', cm: 'CM', dm: 'MM', m: 'M' };
const IGES_UNIT_FLAG = { mm: 2, cm: 10, m: 6 };

export function toCAD(p, o) {
  const s = UNITS[o.unit];
  return o.zUp ? [p.x * s, -p.z * s, p.y * s] : [p.x * s, p.y * s, p.z * s];
}
export function fromCAD(x, y, z, o) {
  const s = UNITS[o.unit];
  return o.zUp ? [x / s, z / s, -y / s] : [x / s, y / s, z / s];
}

// Número real con punto decimal y exponente en mayúscula (lo exigen IGES y STEP)
function real(v) {
  let s = (+Number(v).toPrecision(12)).toString();
  if (s === '-0') s = '0';
  if (/e/i.test(s)) {
    let [m, e] = s.split(/e/i);
    if (!m.includes('.')) m += '.';
    return `${m}E${e}`;
  }
  return s.includes('.') ? s : s + '.';
}

// Datos de una superficie en el orden de IGES (u varía más rápido)
function surfaceCVs(d) {
  const nu = d.cvs.length, nv = d.cvs[0].length, pts = [];
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) pts.push(d.cvs[i][j]);
  return pts;
}
const isRational = (cvs) => cvs.some((p) => Math.abs(p.w - 1) > 1e-12);

// ---------- IGES 5.3: entidades 128 (superficie NURBS) y 126 (curva NURBS) ----------

export function writeIGES(objects, o, filename = 'forja.igs') {
  const entities = [];
  for (const obj of objects) {
    const d = obj.data;
    if (obj.kind === 'surface') {
      const nu = d.cvs.length, nv = d.cvs[0].length, pts = surfaceCVs(d), rat = isRational(pts);
      const p = [128, nu - 1, nv - 1, d.degU, d.degV, 0, 0, rat ? 0 : 1, 0, 0,
        ...d.knotsU.map(real), ...d.knotsV.map(real), ...pts.map((q) => real(q.w)),
        ...pts.flatMap((q) => toCAD(q, o).map(real)),
        real(d.knotsU[0]), real(d.knotsU[d.knotsU.length - 1]), real(d.knotsV[0]), real(d.knotsV[d.knotsV.length - 1])];
      entities.push({ type: 128, params: p, label: obj.name });
    } else if (obj.kind === 'curve') {
      const n = d.cvs.length, rat = isRational(d.cvs);
      const p = [126, n - 1, d.deg, 0, 0, rat ? 0 : 1, 0,
        ...d.knots.map(real), ...d.cvs.map((q) => real(q.w)), ...d.cvs.flatMap((q) => toCAD(q, o).map(real)),
        real(d.knots[0]), real(d.knots[d.knots.length - 1]), '0.', '0.', '0.'];
      entities.push({ type: 126, params: p, label: obj.name });
    }
  }
  const lines = (txt, letter) => txt.map((t, i) => t.padEnd(72).slice(0, 72) + letter + String(i + 1).padStart(7));
  const holl = (s) => `${s.length}H${s}`;
  const wrap = (tokens, width, endChar) => {
    const out = [];
    let cur = '';
    tokens.forEach((tk, i) => {
      const piece = String(tk) + (i === tokens.length - 1 ? endChar : ',');
      if (cur.length + piece.length > width) { out.push(cur); cur = ''; }
      cur += piece;
    });
    if (cur) out.push(cur);
    return out;
  };
  const now = new Date(), stamp = now.toISOString().replace(/[-:]/g, '').replace('T', '.').slice(0, 15);
  const unit = o.unit === 'dm' ? 'mm' : o.unit;
  const start = lines(['Exportado desde Forja (forja studio). Superficies y curvas NURBS.'], 'S');
  const global = lines(wrap([holl(','), holl(';'), holl('Forja'), holl(filename), holl('Forja'), holl('Forja 0.7'),
    32, 38, 6, 308, 15, holl('Forja'), '1.', IGES_UNIT_FLAG[unit] || 2, holl(UNIT_NAMES[unit] || 'MM'), 1, '1.', holl(stamp),
    '1.E-6', '0.', holl(''), holl(''), 11, 0, holl(stamp)], 72, ';'), 'G');
  const de = [], pd = [];
  entities.forEach((e, k) => {
    const deSeq = k * 2 + 1, pStart = pd.length + 1;
    const pl = wrap(e.params, 64, ';').map((t) => t.padEnd(64) + ' ' + String(deSeq).padStart(7));
    pd.push(...pl);
    const f = (v) => String(v).padStart(8);
    de.push(f(e.type) + f(pStart) + f(0) + f(0) + f(0) + f(0) + f(0) + f(0) + '00000000');
    de.push(f(e.type) + f(0) + f(0) + f(pl.length) + f(0) + ' '.repeat(8) + ' '.repeat(8) + e.label.slice(0, 8).padStart(8) + f(0));
  });
  const D = lines(de, 'D'), P = lines(pd, 'P');
  const T = lines([`S${String(start.length).padStart(7)}G${String(global.length).padStart(7)}D${String(D.length).padStart(7)}P${String(P.length).padStart(7)}`], 'T');
  return [...start, ...global, ...D, ...P, ...T].join('\n') + '\n';
}

export function readIGES(text, o) {
  const rows = text.split(/\r?\n/).filter((l) => l.length >= 73);
  const sec = (c) => rows.filter((l) => l[72] === c);
  const D = sec('D'), P = sec('P');
  const out = { surfaces: [], curves: [], skipped: {} };
  for (let k = 0; k + 1 < D.length; k += 2) {
    const a = D[k], b = D[k + 1];
    const type = +a.slice(0, 8), pStart = +a.slice(8, 16), pCount = +b.slice(24, 32);
    const label = b.slice(56, 64).trim();
    const status = a.slice(64, 72);
    if (type !== 128 && type !== 126) { out.skipped[type] = (out.skipped[type] || 0) + 1; continue; }
    if (status.slice(4, 6) === '01') continue;           // entidad física dependiente (p. ej. parte de una superficie recortada)
    const raw = P.slice(pStart - 1, pStart - 1 + pCount).map((l) => l.slice(0, 64)).join('');
    const t = raw.split(';')[0].split(',').map((s) => s.trim());
    const num = (i) => parseFloat(t[i].replace(/D/i, 'E'));
    let i = 1;
    const knotsNorm = (ks) => { const a0 = ks[0], a1 = ks[ks.length - 1]; return ks.map((v) => (v - a0) / (a1 - a0 || 1)); };
    if (type === 128) {
      const K1 = num(i++), K2 = num(i++), M1 = num(i++), M2 = num(i++);
      i += 5;
      const ku = [], kv = [];
      for (let n = 0; n < K1 + M1 + 2; n++) ku.push(num(i++));
      for (let n = 0; n < K2 + M2 + 2; n++) kv.push(num(i++));
      const nu = K1 + 1, nv = K2 + 1, w = [];
      for (let n = 0; n < nu * nv; n++) w.push(num(i++));
      const cvs = Array.from({ length: nu }, () => []);
      for (let n = 0; n < nu * nv; n++) {
        const [x, y, z] = fromCAD(num(i++), num(i++), num(i++), o);
        cvs[n % nu][Math.floor(n / nu)] = { x, y, z, w: w[n] };
      }
      out.surfaces.push({ label, degU: M1, degV: M2, knotsU: knotsNorm(ku), knotsV: knotsNorm(kv), cvs });
    } else {
      const K = num(i++), M = num(i++);
      i += 4;
      const ks = [];
      for (let n = 0; n < K + M + 2; n++) ks.push(num(i++));
      const w = [];
      for (let n = 0; n <= K; n++) w.push(num(i++));
      const cvs = [];
      for (let n = 0; n <= K; n++) { const [x, y, z] = fromCAD(num(i++), num(i++), num(i++), o); cvs.push({ x, y, z, w: w[n] }); }
      out.curves.push({ label, deg: M, knots: knotsNorm(ks), cvs });
    }
  }
  return out;
}

// ---------- STEP AP214: superficies y curvas B-spline en un conjunto geométrico ----------

function multiplicities(knots) {
  const ks = [], ms = [];
  for (const k of knots) {
    if (ks.length && Math.abs(ks[ks.length - 1] - k) < 1e-12) ms[ms.length - 1]++;
    else { ks.push(k); ms.push(1); }
  }
  return { ks, ms };
}

export function writeSTEP(objects, o, filename = 'forja.step') {
  let id = 0;
  const ents = [];
  const add = (s) => { ents.push(`#${++id}=${s};`); return `#${id}`; };
  const str = (s) => `'${String(s).replace(/'/g, "''")}'`;
  const unit = o.unit === 'dm' ? 'mm' : o.unit;
  const prefix = { mm: '.MILLI.', cm: '.CENTI.', m: '$' }[unit];
  const ctx = add("APPLICATION_CONTEXT('automotive design')");
  add(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctx})`);
  const pc = add(`PRODUCT_CONTEXT('',${ctx},'mechanical')`);
  const prod = add(`PRODUCT('Forja','Forja','',(${pc}))`);
  const pdf = add(`PRODUCT_DEFINITION_FORMATION('','',${prod})`);
  const pdc = add(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctx},'design')`);
  const pd = add(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`);
  const pds = add(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
  const lu = add(`(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(${prefix},.METRE.))`);
  const au = add('(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.))');
  const su = add('(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT())');
  const unc = add(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-03),${lu},'distance_accuracy_value','')`);
  const gctx = add(`(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc}))GLOBAL_UNIT_ASSIGNED_CONTEXT((${lu},${au},${su}))REPRESENTATION_CONTEXT('',''))`);
  const point = (q) => add(`CARTESIAN_POINT('',(${toCAD(q, o).map(real).join(',')}))`);
  const items = [];
  for (const obj of objects) {
    const d = obj.data;
    if (obj.kind === 'surface') {
      const rows = d.cvs.map((row) => `(${row.map(point).join(',')})`).join(',');
      const U = multiplicities(d.knotsU), V = multiplicities(d.knotsV);
      const knots = `(${U.ms.join(',')}),(${V.ms.join(',')}),(${U.ks.map(real).join(',')}),(${V.ks.map(real).join(',')}),.UNSPECIFIED.`;
      if (isRational(d.cvs.flat())) {
        const ws = d.cvs.map((row) => `(${row.map((q) => real(q.w)).join(',')})`).join(',');
        items.push(add(`(BOUNDED_SURFACE()B_SPLINE_SURFACE(${d.degU},${d.degV},(${rows}),.UNSPECIFIED.,.F.,.F.,.F.)B_SPLINE_SURFACE_WITH_KNOTS(${knots})GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_SURFACE((${ws}))REPRESENTATION_ITEM(${str(obj.name)})SURFACE())`));
      } else {
        items.push(add(`B_SPLINE_SURFACE_WITH_KNOTS(${str(obj.name)},${d.degU},${d.degV},(${rows}),.UNSPECIFIED.,.F.,.F.,.F.,${knots})`));
      }
    } else if (obj.kind === 'curve') {
      const pts = d.cvs.map(point).join(','), K = multiplicities(d.knots);
      const knots = `(${K.ms.join(',')}),(${K.ks.map(real).join(',')}),.UNSPECIFIED.`;
      if (isRational(d.cvs)) {
        items.push(add(`(BOUNDED_CURVE()B_SPLINE_CURVE(${d.deg},(${pts}),.UNSPECIFIED.,.F.,.F.)B_SPLINE_CURVE_WITH_KNOTS(${knots})CURVE()GEOMETRIC_REPRESENTATION_ITEM()RATIONAL_B_SPLINE_CURVE((${d.cvs.map((q) => real(q.w)).join(',')}))REPRESENTATION_ITEM(${str(obj.name)}))`));
      } else {
        items.push(add(`B_SPLINE_CURVE_WITH_KNOTS(${str(obj.name)},${d.deg},(${pts}),.UNSPECIFIED.,.F.,.F.,${knots})`));
      }
    }
  }
  const gs = add(`GEOMETRIC_SET('',(${items.join(',')}))`);
  const rep = add(`GEOMETRICALLY_BOUNDED_SURFACE_SHAPE_REPRESENTATION('Forja',(${gs}),${gctx})`);
  add(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
  const stamp = new Date().toISOString().slice(0, 19);
  return ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION(('Forja: superficies y curvas NURBS'),'2;1');",
    `FILE_NAME(${str(filename)},'${stamp}',(''),(''),'Forja','Forja','');`,
    "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", 'ENDSEC;', 'DATA;', ...ents, 'ENDSEC;', 'END-ISO-10303-21;', ''].join('\n');
}

// ---------- Malla de cuadriláteros para SubD (OBJ) ----------
// Muestrea cada superficie en una rejilla de cuadriláteros (2 por span), soldando la costura de las superficies cerradas.
// En Blender, Plasticity o cualquier modelador SubD se le aplica subdivisión y queda muy cerca de la superficie NURBS.

export function writeSubDOBJ(objects, evalSurface, uniqueKnots, o) {
  const out = ['# Forja: malla de cuadriláteros para SubD', `# Unidades: ${o.unit}, ${o.zUp ? 'Z' : 'Y'} arriba`];
  let base = 1;
  for (const obj of objects) {
    if (obj.kind !== 'surface') continue;
    const d = obj.data, s = evalSurface(d);
    const nu = Math.max(2, (uniqueKnots(d.knotsU).length - 1) * 2), nv = Math.max(2, (uniqueKnots(d.knotsV).length - 1) * 2);
    const P = (u, v) => s(u, v);
    const closedU = P(0, 0.5).distanceTo(P(1, 0.5)) < 1e-6, closedV = P(0.5, 0).distanceTo(P(0.5, 1)) < 1e-6;
    const cu = closedU ? nu : nu + 1, cv = closedV ? nv : nv + 1;
    out.push(`o ${obj.name.replace(/\s+/g, '_')}`);
    for (let j = 0; j < cv; j++) for (let i = 0; i < cu; i++) out.push('v ' + toCAD(P(i / nu, j / nv), o).map((x) => +x.toFixed(6)).join(' '));
    const idx = (i, j) => base + (j % cv) * cu + (i % cu);
    for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) out.push(`f ${idx(i, j)} ${idx(i + 1, j)} ${idx(i + 1, j + 1)} ${idx(i, j + 1)}`);
    base += cu * cv;
  }
  return out.join('\n') + '\n';
}

// ---------- 2D: proyección paralela de líneas a un plano ----------

export function project2D(polylines, right, up, o) {
  const s = UNITS[o.unit];
  return polylines.map((pl) => ({ layer: pl.layer, pts: pl.pts.map((p) => [p.dot(right) * s, p.dot(up) * s]) }));
}
function bounds2D(lines) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  lines.forEach((l) => l.pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  return { x0, y0, x1, y1 };
}
const LAYER_STYLE = { BORDES: ['#111111', 0.5], PARCHES: ['#2f7bff', 0.25], CURVAS: ['#111111', 0.35], MALLAS: ['#777777', 0.2] };

export function writeSVG(lines, o) {
  const b = bounds2D(lines), m = 10, w = b.x1 - b.x0 + 2 * m, h = b.y1 - b.y0 + 2 * m;
  const groups = {};
  for (const l of lines) (groups[l.layer] ||= []).push(l);
  const body = Object.entries(groups).map(([layer, ls]) => {
    const [stroke, sw] = LAYER_STYLE[layer] || ['#111', 0.3];
    const paths = ls.map((l) => `<polyline points="${l.pts.map(([x, y]) => `${(x - b.x0 + m).toFixed(3)},${(b.y1 - y + m).toFixed(3)}`).join(' ')}"/>`).join('\n    ');
    return `  <g id="${layer.toLowerCase()}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">\n    ${paths}\n  </g>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(2)}${o.unit}" height="${h.toFixed(2)}${o.unit}" viewBox="0 0 ${w.toFixed(3)} ${h.toFixed(3)}">\n  <title>Forja</title>\n${body}\n</svg>\n`;
}

export function writeDXF(lines) {
  const out = ['0', 'SECTION', '2', 'ENTITIES'];
  for (const l of lines) {
    if (l.pts.length < 2) continue;
    out.push('0', 'POLYLINE', '8', l.layer, '66', '1', '70', '0');
    for (const [x, y] of l.pts) out.push('0', 'VERTEX', '8', l.layer, '10', x.toFixed(6), '20', y.toFixed(6), '30', '0.0');
    out.push('0', 'SEQEND', '8', l.layer);
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n') + '\n';
}

// ---------- .zip sin compresión (para entregar varios archivos o formatos no admitidos sueltos) ----------

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }

export function makeZip(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : new Uint8Array(f.data);
    const crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, 0, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true);
    head.setUint16(26, name.length, true);
    parts.push(new Uint8Array(head.buffer), name, data);
    const cd = new DataView(new ArrayBuffer(46));
    cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true);
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true);
    cd.setUint16(28, name.length, true); cd.setUint32(42, offset, true);
    central.push(new Uint8Array(cd.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((s, a) => s + a.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
