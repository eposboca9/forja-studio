# Lo que enseñan los .h del SDK de Alias (AlBlendCurve, AlBlendPoint, AlCurveNode, AlDagNode)

Solo hay declaraciones, no la matemática. Lo marcado **(deducción)** no lo dice el archivo: es interpretación y hay que confirmarla
con la ventana de opciones de Alias.

## Tres capas (adoptado en Forja v0.44)

| Alias | Qué es | Forja |
|---|---|---|
| `AlBlendCurve` | receta: grado, espaciado de nudos, puntos | entrada de `relations`, tipo registrado con `defineConstruction` |
| `AlBlendPoint` | punto de la receta, con identidad | `cpoint(role, pos, dir, {get, drag, click, attach})` |
| `AlCurveNode` / `AlDagNode` | nodo en la escena (transformación, capa, se elige) | objeto de `objects` |

## AlBlendCurve
- `AlKnotSpacingType { kChord, kUniform }`: parametrización de la curva que **pasa por** los puntos. Forja aún no la tiene.
- `create(grado, espaciado, n, puntos[][3])`, `setDegree`, `insert(i, x,y,z)`, `append(...)`: se añaden puntos sin romper el historial.
- `param(i)`: parámetro del punto i en la curva. `curveNode()`: el nodo que produce. Solo una blend curve activa a la vez.

## AlBlendPoint
- `AlConstraintContinuityType { kG0, kG1, kG2, kG3, kG4 }`: llega hasta **G4** (Forja: G3).
- `AlCurvatureType { kGeometricCurv, kParametric }`: continuidad **geométrica** (G, con reparametrización λ / mu, lo que hace Forja)
  o **paramétrica** (C: las derivadas iguales tal cual, λ = 1 y sin término de forma) **(deducción del nombre)**.
- `AlInterpolationDirectionType { kLocation, kWorldSpace, kGeometricInterp }`: de dónde sale la dirección de la tangente en el punto
  **(deducción)**: kLocation = de la posición de los puntos vecinos; kWorldSpace = un vector fijo del mundo (`setTangent(x,y,z)`);
  kGeometricInterp = de la geometría a la que está pegado. Nota 6 del archivo: algunos métodos solo valen con cierto tipo de dirección.
- `AlDirectionType { kRay, kParallel }`: sin explicación en el archivo **(desconocido; pedir captura de la ventana Blend Curve)**.
- `attachConstraint(AlSurface*, u, v)`, `attachConstraint(AlCurve*, t)`, `attachConstraint(AlCurveOnSurface*, t)`,
  `attachedTo(obj, &p1, &p2)`, `disassociateConstraint()`: el punto guarda **a qué está pegado y en qué parámetro** (u, v o t).
- Nota 3: `setPoint(x, y, z)` **suelta** el punto de su geometría. Nota 4: no fiarse de `param()`, cambia cada vez que cambia la curva.
  Consecuencia: la verdad es (objeto, u, v / t); la posición 3D se calcula de ahí. Para deslizar sobre una geometría se cambian los
  parámetros (proyectando el ratón sobre ella), nunca la posición 3D.
- No hay un enum "tangente isoparamétrica vs normal". La dirección = tangente guardada como vector 3D + el tipo de dirección.
- `isSlave()` / `makeMaster()`: puntos compartidos entre dos blend curves; uno manda (maestro) y el otro lo sigue (esclavo).
- Nota 7: con menos de 2 puntos la blend curve se borra sola (la receta inválida desaparece).

## AlCurveNode / AlDagNode
- El nodo guarda la transformación (traslación, rotación, escala, pivote de rotación y de escala por separado, ejes de rotación locales);
  la geometría (`curve()`) está en coordenadas **locales**; `curve(AlTM&)` la da junto con la matriz para pasarla a mundo.
  Global = local × padres. Forja hoy hornea las transformaciones en los CVs (no hay matriz por objeto).
- Grupos = nodos padre (`AlGroupNode`), instancias (`isInstanceable`, `instanceCopy`), `createSymmetricGeometry` (≈ simetría de capa),
  capa como atributo del nodo, `persistentID`, `blindData` / `toolMetaData` (datos de herramientas pegados al nodo).
- Borrar el nodo borra la geometría y al revés (1:1). Errores con tipo (`AlCurveNodeJoinErrors`) en vez de excepciones.

## AlPickable, AlCurve, AlCurveCV, AlCurveOnSurface, AlCurveNode (v0.51)
- `AlPickable::pick/unpick/isPicked`: elegir es un estado del NODO, separado de mostrar sus CVs. Adoptado: "Nada" suelta la selección y los CVs
  encendidos (obj.showCVs) siguen a la vista hasta Mostrar › Apagar CVs.
- `AlCurve::createLine(p0, p1)` → Curvas › Línea (2 puntos). `AlCurveCV::worldPosition` → con eje fijo (X/Y/Z) el punto toma la coordenada exacta
  del punto de snap sobre ese eje. `AlCurve::extendCurve(double, double[4])` → Extender: curva hasta un punto exacto (tramo G1 y reajuste).
- `AlCurveOnSurface::inTrim()`, `visible()`: una CoS puede existir sin recortar; Untrim deja la curva y quita solo su efecto (trim 'none').
