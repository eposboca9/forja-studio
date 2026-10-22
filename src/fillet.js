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
export function toSurfaces(oc, shape, fit, origin = []) {
  const out = [], REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
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
    if (face.Orientation_1() === REV) flipU(data, loops);
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

// Malla rápida del resultado (vista previa mientras se arrastra el punto amarillo). Posiciones en dm.
export function previewMesh(oc, shape, defl = 0.05) {
  const m = new oc.BRepMesh_IncrementalMesh_2(shape, defl, false, 0.3, false); m.delete();
  const P = [], I = [], REV = oc.TopAbs_Orientation.TopAbs_REVERSED;
  explore(oc, shape, T(oc).TopAbs_FACE, (f0) => {
    const f = oc.TopoDS.Face_1(f0), loc = new oc.TopLoc_Location_1(), h = oc.BRep_Tool.Triangulation(f, loc, 0);
    if (h.IsNull()) { loc.delete(); return; }
    const tr = h.get(), tf = loc.Transformation(), base = P.length / 3, rev = f.Orientation_1() === REV;
    for (let i = 1; i <= tr.NbNodes(); i++) { const q = tr.Node(i), p = q.Transformed(tf); P.push(p.X() / MM, p.Y() / MM, p.Z() / MM); p.delete(); q.delete(); }
    for (let i = 1; i <= tr.NbTriangles(); i++) {
      const t = tr.Triangle(i), a = t.Value(1) - 1 + base, b = t.Value(2) - 1 + base, c = t.Value(3) - 1 + base;
      if (rev) I.push(a, c, b); else I.push(a, b, c);
      t.delete();
    }
    loc.delete();
  });
  return { pos: new Float32Array(P), idx: new Uint32Array(I) };
}
