// Redondeo (fillet) y chaflán de aristas como en Plasticity, sobre el núcleo exacto de OpenCascade.
// Pura geometría: recibe `oc` (replicad-opencascadejs) y superficies de Forja { degU, degV, knotsU, knotsV, cvs[nu][nv] }
// con cvs = {x, y, z, w} (cartesianas + peso). Forja trabaja en dm; aquí todo va en mm (×100) para las tolerancias de OCC.
// Devuelve superficies NURBS de Forja (sin malla): cada cara del resultado es su B-spline recortada a la caja UV de la cara
// y, si su borde no es un rectángulo en UV, los lazos de recorte (fuera del borde exterior y dentro de cada agujero).

export const MM = 100;
const pr = (oc) => new oc.Message_ProgressRange_1();
const T = (oc) => oc.TopAbs_ShapeEnum;

function explore(oc, s, kind, fn) {
  const e = new oc.TopExp_Explorer_2(s, kind, T(oc).TopAbs_SHAPE);
  for (; e.More(); e.Next()) fn(e.Current());
  e.delete();
}
const uniq = (knots) => {
  const k = [], m = [];
  for (const x of knots) { if (k.length && Math.abs(x - k[k.length - 1]) < 1e-12) m[m.length - 1]++; else { k.push(x); m.push(1); } }
  return { k, m };
};
const real1 = (oc, a) => { const r = new oc.TColStd_Array1OfReal_2(1, a.length); a.forEach((v, i) => r.SetValue(i + 1, v)); return r; };
const int1 = (oc, a) => { const r = new oc.TColStd_Array1OfInteger_2(1, a.length); a.forEach((v, i) => r.SetValue(i + 1, v)); return r; };

// Una superficie de Forja → cara de OCC (mm)
export function faceFromData(oc, d) {
  const nu = d.cvs.length, nv = d.cvs[0].length;
  const P = new oc.TColgp_Array2OfPnt_2(1, nu, 1, nv);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const c = d.cvs[i][j]; const p = new oc.gp_Pnt_3(c.x * MM, c.y * MM, c.z * MM); P.SetValue(i + 1, j + 1, p); p.delete(); }
  const U = uniq(d.knotsU), V = uniq(d.knotsV);
  const bs = new oc.Geom_BSplineSurface_1(P, real1(oc, U.k), real1(oc, V.k), int1(oc, U.m), int1(oc, V.m), d.degU, d.degV, false, false);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const w = d.cvs[i][j].w ?? 1; if (Math.abs(w - 1) > 1e-12) bs.SetWeight(i + 1, j + 1, w); }
  const mf = new oc.BRepBuilderAPI_MakeFace_8(new oc.Handle_Geom_Surface_2(bs), 1e-6);
  if (!mf.IsDone()) throw new Error('no se pudo crear la cara');
  return mf.Face();
}

// Cose las superficies (y si cierran, sólido). items: [{ id, data }]
export function makeShape(oc, items) {
  let ext = 0;
  for (const it of items) for (const row of it.data.cvs) for (const c of row) ext = Math.max(ext, Math.abs(c.x), Math.abs(c.y), Math.abs(c.z));
  const sew = new oc.BRepBuilderAPI_Sewing(Math.max(0.01, ext * MM * 2e-4), true, true, true, false);
  const faces = items.map((it) => { const f = faceFromData(oc, it.data); sew.Add(f); return f; });
  sew.Perform(pr(oc));
  let shape = sew.SewedShape();
  const free = sew.NbFreeEdges();
  // la cara cosida de cada superficie de Forja (para saber de qué objeto sale cada cara del resultado)
  const src = items.map((it, i) => ({ id: it.id, face: oc.TopoDS.Face_1(sew.IsModifiedSubShape(faces[i]) ? sew.ModifiedSubShape(faces[i]) : faces[i]) }));
  sew.delete();
  let solid = false;
  if (free === 0) {
    const ms = new oc.BRepBuilderAPI_MakeSolid_1();
    let k = 0;
    explore(oc, shape, T(oc).TopAbs_SHELL, (s) => { ms.Add(oc.TopoDS.Shell_1(s)); k++; });
    if (k && ms.IsDone()) { const so = ms.Solid(); oc.BRepLib.OrientClosedSolid(so); shape = so; solid = true; }
  }
  return { shape, solid, free, src };
}

// Normal de la cara en el punto (u, v) (tiene en cuenta la orientación de la cara)
function faceNormal(oc, face, u, v) {
  const g = new oc.BRepGProp_Face_2(face, false), p = new oc.gp_Pnt_1(), n = new oc.gp_Vec_1();
  g.Normal(u, v, p, n);
  const l = Math.hypot(n.X(), n.Y(), n.Z()) || 1, r = [n.X() / l, n.Y() / l, n.Z() / l];
  g.delete(); p.delete(); n.delete();
  return r;
}

// Aristas que se pueden redondear: compartidas por dos caras distintas. Para cada una: polilínea (dm) para dibujarla y
// elegirla, ángulo entre las caras (las tangentes no se redondean solas: OCC las incluye en la cadena de la arista vecina).
export function edgeList(oc, shape) {
  const faces = [];
  explore(oc, shape, T(oc).TopAbs_FACE, (f) => faces.push(oc.TopoDS.Face_1(f)));
  const buckets = new Map(), list = [];
  faces.forEach((f, fi) => explore(oc, f, T(oc).TopAbs_EDGE, (e0) => {
    const e = oc.TopoDS.Edge_1(e0), h = e.HashCode(1 << 30);
    const b = buckets.get(h) || []; buckets.set(h, b);
    let rec = b.find((r) => r.edge.IsSame(e));
    if (!rec) { rec = { edge: e, faces: [] }; b.push(rec); list.push(rec); }
    if (!rec.faces.includes(fi)) rec.faces.push(fi);
  }));
  const out = [];
  for (const rec of list) {
    if (rec.faces.length !== 2 || oc.BRep_Tool.Degenerated(rec.edge)) continue;
    const c = new oc.BRepAdaptor_Curve_2(rec.edge), t0 = c.FirstParameter(), t1 = c.LastParameter(), pts = [];
    for (let k = 0; k <= 40; k++) { const p = c.Value(t0 + ((t1 - t0) * k) / 40); pts.push([p.X() / MM, p.Y() / MM, p.Z() / MM]); p.delete(); }
    // ángulo entre caras a mitad de arista
    let angle = 180;
    try {
      const tm = (t0 + t1) / 2, n = rec.faces.map((fi) => {
        const a = new oc.BRepAdaptor_Curve2d_2(rec.edge, faces[fi]), q = a.Value(tm), r = faceNormal(oc, faces[fi], q.X(), q.Y());
        q.delete(); a.delete(); return r;
      });
      angle = (Math.acos(Math.max(-1, Math.min(1, n[0][0] * n[1][0] + n[0][1] * n[1][1] + n[0][2] * n[1][2]))) * 180) / Math.PI;
    } catch (e) { /* sin curva en la cara: se deja como arista viva */ }
    c.delete();
    out.push({ edge: rec.edge, faces: rec.faces, faceShapes: rec.faces.map((fi) => faces[fi]), pts, angle, tangent: angle < 1 });
  }
  return out;
}

export function volume(oc, shape) {
  const g = new oc.GProp_GProps_1(); oc.BRepGProp.VolumeProperties_1(shape, g, false, false, false);
  const v = g.Mass(); g.delete(); return v;
}

// Redondeo / chaflán. edges: aristas de edgeList; o = { r (dm), kind: 'fillet' | 'chamfer', vary: [[t 0..1, r dm], ...] | null }.
// src: caras de origen (makeShape) → origin: [{ id, faces }] con las caras del resultado que vienen de cada una.
export function filletShape(oc, shape, edges, o, src = []) {
  const r = o.r * MM;
  let mk;
  if (o.kind === 'chamfer') {
    mk = new oc.BRepFilletAPI_MakeChamfer(shape);
    for (const e of edges) mk.Add_2(r, e.edge);
  } else {
    mk = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
    for (const e of edges) {
      if (o.vary && o.vary.length) {
        const pts = [[0, o.r], ...o.vary.filter(([t]) => t > 1e-3 && t < 1 - 1e-3), [1, o.r]].sort((a, b) => a[0] - b[0]);
        const arr = new oc.TColgp_Array1OfPnt2d_2(1, pts.length);
        pts.forEach(([t, rr], i) => { const p = new oc.gp_Pnt2d_3(t, rr * MM); arr.SetValue(i + 1, p); p.delete(); });
        mk.Add_5(arr, e.edge);
      } else mk.Add_2(r, e.edge);
    }
  }
  mk.Build(pr(oc));
  if (!mk.IsDone()) { mk.delete(); throw new Error(o.kind === 'chamfer' ? 'el chaflán no cabe con esa distancia' : 'el redondeo no cabe con ese radio'); }
  const res = mk.Shape();
  // OpenCascade puede devolver el sólido "del revés" (volumen negativo, caras hacia dentro): se da la vuelta
  if (volume(oc, res) < 0) res.Reverse();
  const origin = src.map(({ id, face }) => {
    const faces = [];
    if (!mk.IsDeleted(face)) {
      const l = mk.Modified(face);
      if (l.Size()) { const copy = new oc.TopTools_ListOfShape_1(); copy.Assign(l); while (copy.Size()) { faces.push(copy.First_1()); copy.RemoveFirst(); } }
      else faces.push(face);
    }
    return { id, faces };
  });
  mk.delete();
  return { shape: res, origin };
}

// Resultado → superficies de Forja. Devuelve [{ data, loops: [{ uv: [[u, v]...], trim: 'outside' | 'inside' }] }]
// evalPt(data, u, v) → [x, y, z] (la superficie de Forja); sirve para saber hacia dónde mira su normal Su × Sv.
export function toSurfaces(oc, shape, fit, origin = [], evalPt = null) {
  const out = [], REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
  let solidTris = null;
  if (evalPt) { const m = new oc.BRepMesh_IncrementalMesh_2(shape, 0.5, false, 0.5, false); m.delete(); solidTris = meshTriangles(oc, shape); }
  explore(oc, shape, T(oc).TopAbs_FACE, (f0) => {
    const face = oc.TopoDS.Face_1(f0), ad = new oc.BRepAdaptor_Surface_2(face, true);
    const u0 = ad.FirstUParameter(), u1 = ad.LastUParameter(), v0 = ad.FirstVParameter(), v1 = ad.LastVParameter();
    let data = null;
    if (ad.GetType() === oc.GeomAbs_SurfaceType.GeomAbs_BSplineSurface) {
      const bs = ad.BSpline().get();
      try { bs.Segment(u0, u1, v0, v1, 1e-9, 1e-9); data = readBSpline(bs); } catch (e) { data = null; }
    }
    // planos, cilindros, toros... y lo que no se dejó cortar: se ajusta una B-spline por puntos (como Rebuild)
    if (!data) {
      const N = 12, grid = [];
      for (let i = 0; i <= N; i++) { const row = []; for (let j = 0; j <= N; j++) { const p = ad.Value(u0 + ((u1 - u0) * i) / N, v0 + ((v1 - v0) * j) / N); row.push([p.X() / MM, p.Y() / MM, p.Z() / MM]); p.delete(); } grid.push(row); }
      data = fit(grid);
    }
    const nrm = (u, v) => [(u - u0) / (u1 - u0 || 1), (v - v0) / (v1 - v0 || 1)];
    // lazos de recorte en UV normalizada
    const loops = [];
    let outerDone = false;
    const outerWire = oc.BRepTools.OuterWire(face);
    explore(oc, face, T(oc).TopAbs_WIRE, (w0) => {
      const w = oc.TopoDS.Wire_1(w0), segs = [];
      explore(oc, w, T(oc).TopAbs_EDGE, (e0) => {
        const e = oc.TopoDS.Edge_1(e0);
        if (oc.BRep_Tool.Degenerated(e)) return;
        const a = new oc.BRepAdaptor_Curve2d_2(e, face), t0 = a.FirstParameter(), t1 = a.LastParameter(), seg = [];
        for (let k = 0; k <= 24; k++) { const q = a.Value(t0 + ((t1 - t0) * k) / 24); seg.push(nrm(q.X(), q.Y())); q.delete(); }
        if (e.Orientation_1() === REV) seg.reverse();
        a.delete();
        segs.push(seg);
      });
      const uv = chain(segs);
      const outer = w.IsSame(outerWire);
      if (outer) outerDone = true;
      const onBox = uv.every(([u, v]) => Math.min(Math.abs(u), Math.abs(1 - u), Math.abs(v), Math.abs(1 - v)) < 2e-3);
      if (outer && onBox) return;   // borde rectangular: superficie sin recorte
      if (uv.length > 2) loops.push({ uv, trim: outer ? 'outside' : 'inside' });
    });
    // dirección de Su × Sv respecto al sólido. Prueba que no depende de ninguna orientación:
    // un punto un poco delante de la cara (según Su × Sv) está dentro del sólido si un rayo suyo cruza la malla un nº impar de veces.
    let flip = false;
    const pt = evalPt && centerPoint(oc, face);
    if (pt && solidTris) {
      let best = null;
      for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
        const q = evalPt(data, i / 12, j / 12), d = (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2 + (q[2] - pt[2]) ** 2;
        if (!best || d < best.d) best = { d, u: i / 12, v: j / 12, q };
      }
      const h = 1e-3, a = best.q, b = evalPt(data, Math.min(1, best.u + h), best.v), c = evalPt(data, best.u, Math.min(1, best.v + h));
      const su = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], sv = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      const n = [su[1] * sv[2] - su[2] * sv[1], su[2] * sv[0] - su[0] * sv[2], su[0] * sv[1] - su[1] * sv[0]], l = Math.hypot(...n) || 1;
      const eps = solidTris.eps / MM;
      // convención de Forja: Su × Sv apunta HACIA DENTRO (el giro de los triángulos de ParametricGeometry es el contrario y mira hacia fuera,
      // que es lo que cuenta para la luz); así son también las superficies de revolución. Si apunta hacia fuera, se invierte.
      flip = !insideMesh(solidTris, [(a[0] + (n[0] / l) * eps) * MM, (a[1] + (n[1] / l) * eps) * MM, (a[2] + (n[2] / l) * eps) * MM]);
    } else flip = face.Orientation_1() === REV;
    if (flip) flipU(data, loops);
    const from = origin.find((o) => o.faces.some((f) => f.IsSame(face)));
    out.push({ data, loops, src: from ? from.id : null });
    ad.delete();
  });
  return out;
}

// une los tramos de un lazo por sus extremos (el explorador de OCC no los da en orden)
function chain(segs) {
  if (!segs.length) return [];
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const left = segs.slice(1), uv = segs[0].slice();
  while (left.length) {
    const end = uv[uv.length - 1];
    let best = 0, rev = false, bd = Infinity;
    left.forEach((s, i) => { const a = d(end, s[0]), b = d(end, s[s.length - 1]); if (a < bd) { bd = a; best = i; rev = false; } if (b < bd) { bd = b; best = i; rev = true; } });
    const s = left.splice(best, 1)[0];
    for (const p of rev ? s.slice().reverse() : s) if (d(uv[uv.length - 1], p) > 1e-6) uv.push(p);
  }
  return uv;
}
// punto (dm) de un triángulo central del teselado de la cara
function centerPoint(oc, face) {
  const loc = new oc.TopLoc_Location_1(), h = oc.BRep_Tool.Triangulation(face, loc, 0);
  if (h.IsNull()) { loc.delete(); return null; }
  const tr = h.get(), tf = loc.Transformation(), nt = tr.NbTriangles();
  if (!nt) { loc.delete(); return null; }
  const t = tr.Triangle(Math.max(1, Math.round(nt / 2))), c = [0, 0, 0];
  for (let k = 1; k <= 3; k++) { const q = tr.Node(t.Value(k)), p = q.Transformed(tf); c[0] += p.X() / 3; c[1] += p.Y() / 3; c[2] += p.Z() / 3; p.delete(); q.delete(); }
  t.delete(); loc.delete();
  return c.map((x) => x / MM);
}
// todos los triángulos del sólido (mm) para contar cruces de un rayo
function meshTriangles(oc, shape) {
  const T3 = [];
  explore(oc, shape, T(oc).TopAbs_FACE, (f0) => {
    const f = oc.TopoDS.Face_1(f0), loc = new oc.TopLoc_Location_1(), h = oc.BRep_Tool.Triangulation(f, loc, 0);
    if (h.IsNull()) { loc.delete(); return; }
    const tr = h.get(), tf = loc.Transformation(), pts = [];
    for (let i = 1; i <= tr.NbNodes(); i++) { const q = tr.Node(i), p = q.Transformed(tf); pts.push([p.X(), p.Y(), p.Z()]); p.delete(); q.delete(); }
    for (let i = 1; i <= tr.NbTriangles(); i++) { const t = tr.Triangle(i); T3.push(pts[t.Value(1) - 1], pts[t.Value(2) - 1], pts[t.Value(3) - 1]); t.delete(); }
    loc.delete();
  });
  let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const p of T3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
  return { T3, eps: Math.max(0.02, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 2e-3) };
}
function insideMesh(m, q) {
  const d = [0.5773502, 0.5774101, 0.5772903];   // dirección "irracional": no pasa justo por aristas
  let hits = 0;
  const T3 = m.T3;
  for (let i = 0; i < T3.length; i += 3) {
    const a = T3[i], b = T3[i + 1], c = T3[i + 2];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const pv = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
    const det = e1[0] * pv[0] + e1[1] * pv[1] + e1[2] * pv[2];
    if (Math.abs(det) < 1e-12) continue;
    const tv = [q[0] - a[0], q[1] - a[1], q[2] - a[2]], u = (tv[0] * pv[0] + tv[1] * pv[1] + tv[2] * pv[2]) / det;
    if (u < 0 || u > 1) continue;
    const qv = [tv[1] * e1[2] - tv[2] * e1[1], tv[2] * e1[0] - tv[0] * e1[2], tv[0] * e1[1] - tv[1] * e1[0]];
    const v = (d[0] * qv[0] + d[1] * qv[1] + d[2] * qv[2]) / det;
    if (v < 0 || u + v > 1) continue;
    if ((e2[0] * qv[0] + e2[1] * qv[1] + e2[2] * qv[2]) / det > 0) hits++;
  }
  return hits % 2 === 1;
}
function readBSpline(bs) {
  const nu = bs.NbUPoles(), nv = bs.NbVPoles(), cvs = [];
  for (let i = 1; i <= nu; i++) {
    const row = [];
    for (let j = 1; j <= nv; j++) { const p = bs.Pole(i, j); row.push({ x: p.X() / MM, y: p.Y() / MM, z: p.Z() / MM, w: bs.Weight(i, j) }); p.delete(); }
    cvs.push(row);
  }
  const knots = (n, k, m) => { const a = []; for (let i = 1; i <= n; i++) for (let r = 0; r < m(i); r++) a.push(k(i)); const lo = a[0], hi = a[a.length - 1]; return a.map((x) => (x - lo) / (hi - lo)); };
  return {
    degU: bs.UDegree(), degV: bs.VDegree(), cvs,
    knotsU: knots(bs.NbUKnots(), (i) => bs.UKnot(i), (i) => bs.UMultiplicity(i)),
    knotsV: knots(bs.NbVKnots(), (i) => bs.VKnot(i), (i) => bs.VMultiplicity(i)),
  };
}
// invierte U (para que la normal de Forja coincida con la de la cara del sólido)
function flipU(d, loops) {
  d.cvs.reverse();
  d.knotsU = d.knotsU.map((k) => 1 - k).reverse();
  for (const l of loops) { l.uv = l.uv.map(([u, v]) => [1 - u, v]); l.uv.reverse(); }
}

// Malla rápida del resultado (vista previa mientras se arrastra el punto amarillo). Posiciones en dm. El giro de cada cara se
// comprueba con la prueba del rayo (OpenCascade a veces deja caras de redondeo orientadas al revés de sus vecinas).
export function previewMesh(oc, shape, defl = 0.05) {
  const m = new oc.BRepMesh_IncrementalMesh_2(shape, defl, false, 0.3, false); m.delete();
  const faces = [], REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
  explore(oc, shape, T(oc).TopAbs_FACE, (f0) => {
    const f = oc.TopoDS.Face_1(f0), loc = new oc.TopLoc_Location_1(), h = oc.BRep_Tool.Triangulation(f, loc, 0);
    if (h.IsNull()) { loc.delete(); return; }
    const tr = h.get(), tf = loc.Transformation(), P = [], I = [], rev = f.Orientation_1() === REV;
    for (let i = 1; i <= tr.NbNodes(); i++) { const q = tr.Node(i), p = q.Transformed(tf); P.push(p.X(), p.Y(), p.Z()); p.delete(); q.delete(); }
    for (let i = 1; i <= tr.NbTriangles(); i++) {
      const t = tr.Triangle(i), a = t.Value(1) - 1, b = t.Value(2) - 1, c = t.Value(3) - 1;
      if (rev) I.push(a, c, b); else I.push(a, b, c);
      t.delete();
    }
    loc.delete();
    faces.push({ P, I });
  });
  let nTri = 0;
  for (const f of faces) nTri += f.I.length / 3;
  let solid = null;
  if (faces.length * nTri < 4e7) {
    const T3 = [];
    for (const f of faces) for (let i = 0; i < f.I.length; i += 3) for (let k = 0; k < 3; k++) { const o = f.I[i + k] * 3; T3.push([f.P[o], f.P[o + 1], f.P[o + 2]]); }
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (const p of T3) for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], p[k]); mx[k] = Math.max(mx[k], p[k]); }
    solid = { T3, eps: Math.max(0.02, Math.hypot(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) * 2e-3) };
  }
  const P = [], I = [];
  for (const f of faces) {
    if (solid && f.I.length) {
      const t = Math.floor(f.I.length / 6) * 3, a = f.I[t] * 3, b = f.I[t + 1] * 3, c = f.I[t + 2] * 3;
      const u = [f.P[b] - f.P[a], f.P[b + 1] - f.P[a + 1], f.P[b + 2] - f.P[a + 2]], v = [f.P[c] - f.P[a], f.P[c + 1] - f.P[a + 1], f.P[c + 2] - f.P[a + 2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], l = Math.hypot(...n) || 1;
      const g = [(f.P[a] + f.P[b] + f.P[c]) / 3, (f.P[a + 1] + f.P[b + 1] + f.P[c + 1]) / 3, (f.P[a + 2] + f.P[b + 2] + f.P[c + 2]) / 3];
      if (insideMesh(solid, [g[0] + (n[0] / l) * solid.eps, g[1] + (n[1] / l) * solid.eps, g[2] + (n[2] / l) * solid.eps])) for (let i = 0; i < f.I.length; i += 3) { const x = f.I[i + 1]; f.I[i + 1] = f.I[i + 2]; f.I[i + 2] = x; }
    }
    const base = P.length / 3;
    for (let i = 0; i < f.P.length; i += 3) P.push(f.P[i] / MM, f.P[i + 1] / MM, f.P[i + 2] / MM);
    for (const k of f.I) I.push(k + base);
  }
  return { pos: new Float32Array(P), idx: new Uint32Array(I) };
}
