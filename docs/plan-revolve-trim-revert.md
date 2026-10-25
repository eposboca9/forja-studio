# Plan: Revolución precisa, Trim / Untrim, Revert y ventanas flotantes

Basado en `AlSurface.h`, `AlTrimRegion.h`, `AlTrimBoundary.h`, `AlDagNode.h` y `AlSnap.h`, y en cómo está hecho Forja hoy (v0.44.2).
**(deducción)** = no lo dice el archivo; es interpretación.

## Lo que dicen los archivos

| Archivo | Qué aporta | Qué NO trae |
|---|---|---|
| `AlSurface.h` | `createRevolvedSurface(double[3], double[3], double, double, AlCurve*)`: dos vectores (eje: punto + dirección, **deducción**) y **dos ángulos** (inicio y fin del barrido, **deducción**). `project`, `projectNormal`, `intersect(AlSurface*)` crean curvas sobre superficie (CoS). `trim(n, u[], v[], bool)` = recortar diciendo **qué piezas se quedan con puntos (u, v)**; `trim(n, CoS[], bool)` = recortar con curvas sobre superficie. `isPointActive(u, v)`, `trimmed()`, `firstTrimRegion()`, `add/removeCurveOnSurface` | No hay `untrim` ni "etapas" |
| `AlTrimRegion.h` | Una región = una pieza que se conserva; su 1.ª frontera es la exterior y las demás son agujeros. Cada isla es una región aparte | Contradicción: dice que la superficie queda a la IZQUIERDA de la frontera y `AlTrimBoundary.h` dice a la DERECHA. Forja ya usa inside/outside, no le afecta |
| `AlTrimBoundary.h` | Frontera = lista de curvas de recorte cerradas en el espacio (u, v), cada una empieza donde acaba la anterior. `convertToUVPolyline` | — |
| `AlDagNode.h` | Jerarquía de **transformaciones** (traslación, rotación, escala, pivotes; global = local × padres), capa, nombre | El historial de construcción NO está en el DAG: en Alias va aparte (`isConstructionHistoryResultingSurface`). En Forja ese papel lo hace el registro de construcciones |
| `AlSnap.h` | `AlSnapMode` por bits (rejilla 1, CV 2, curva 4); `toCurve` devuelve objeto + **parámetro de la curva** | No hay snap a superficie (Forja sí lo tiene) |

## Fases

1. **v0.45 – Ventanas flotantes y números exactos**
   - `makeFloating(el, {id, title, close, min})`: barra de título que se arrastra libre por la pantalla; `_` minimiza (queda solo la barra) y `×` cierra.
   - Posición, minimizado y abierto se guardan en `prefs.wins[id]`; se reabren desde el menú Ventanas.
   - Aplica a: ventana de herramienta, Transform info y Capas (cuando se suelta del ancla).
   - Todos los campos `range` de las ventanas de herramienta ganan una casilla numérica al lado: se escribe el valor exacto con decimales, Enter o salir de la casilla lo aplica, y puede pasar del tope del deslizador dentro de los límites reales.
2. **v0.46 – Revolución**
   - Barrido con **ángulo inicial y final** (`r.a0`, `r.a1`, como los dos `double` de `createRevolvedSurface`).
   - Eje: X · Y · Z (ejes de Alias) · Por el pivote · Elegido (clic en una línea recta, un borde o dos puntos) · Manipulador (dos puntos de construcción, base y punta, que se arrastran con snap).
3. **v0.47 – Trim por regiones**
   - Nueva construcción `trim {surf, tools[], keep[[u, v]], mode: 'keep' | 'discard'}`.
   - Las herramientas de corte son curvas (se proyectan como CoS) o, en la fase 5, superficies.
   - El usuario hace clic en las piezas que quiere conservar o quitar (como `trim(n, u[], v[])`), y cada clic se clasifica con punto-dentro-de-polígono en (u, v).
   - Cada Trim es una **etapa**: `surf.trimStages = [relId, …]`.
4. **v0.48 – Untrim y Revert**
   - Untrim con la opción "Etapas: Última | Todas": quita la última etapa, o todas, y devuelve la superficie original.
   - Revert genérico en el registro (`revert(r)`): borra lo que creó la operación, vuelve a mostrar sus entradas, quita sus CoS de recorte y borra la relación.
   - El Redondeo deja de borrar las superficies de origen: las **oculta** y las ata a su construcción, así Revert puede devolverlas.
5. **v0.49 – Recorte con superficies**
   - `FF.intersectSurfaces(A, B)`: marcha sobre las dos superficies y devuelve la curva de corte en (u, v) de cada una; con eso se usa la fase 3 en las dos.

## Bloques clave

```js
// 1 · casilla numérica junto a cada deslizador (TW.render, type 'range')
row.innerHTML = `<label>${esc(f.label)}</label><input type="range" …><input class="tw-num" type="number" step="any" value="${f.get()}">`;
num.addEventListener('change', () => { f.start?.(); const v = Math.min(f.hardMax ?? Infinity, Math.max(f.hardMin ?? -Infinity, +num.value)); f.set(v); this.render(); });

// 1 · ventanas flotantes
function makeFloating(el, { id, close = true, min = true }) {
  const st = (prefs.wins ||= {})[id] ||= {};
  // barra: arrastre libre (la barra nunca sale de la pantalla), _ = el.classList.toggle('min'), × = el.hidden = true
  // st.x, st.y, st.min, st.open se guardan con savePrefs()
}

// 2 · revolución con barrido inicio–fin y ejes nuevos
defineConstruction('revolve', { …, build: (r, ins) => N.revolve(ins[0].data, { ...revOpts(r, ins[0]), start: r.a0 ?? 0, angle: (r.a1 ?? 360) - (r.a0 ?? 0) }) });
// axisMode: 'x' | 'y' | 'z' | 'pivot' | 'picked' {obj, edge|t0,t1} | 'manip' {origin, tip}
// 'manip' añade dos cpoint('axis', …) que se arrastran con snap

// 3 · trim como construcción con etapas
defineConstruction('trim', {
  name: 'Trim', inputs: (r) => [r.surf, ...r.tools], output: (r) => r.surf, editsOutput: true,
  build: (r, ins, out) => trimData(r, out),   // CoS de cada herramienta + lado según los clics (u, v)
  revert: (r) => untrimStage(r),
});

// 4 · Revert genérico (en relSpec, botón "Revert")
function revertConstruction(r) {
  checkpoint();
  const C = constructionOf(r);
  if (C.revert) C.revert(r);
  else { const o = byId(outputOf(r)); if (o && !C.editsOutput) removeObject(o); }
  (r.consumed || []).forEach((id) => { const s = byId(id); if (s) { s.ownVisible = true; delete s.consumedBy; } });
  objects.filter((c) => c.data.cos?.byRel === r.id).forEach(removeObject);
  removeRelation(r.id);
}
```

## Pruebas por fase

- Casilla numérica: escribir 37,25 en Grados y obtener un ángulo exacto de 37,25°.
- Ventanas: arrastrar, minimizar, cerrar y reabrir, y que la posición siga al recargar.
- Trim: plano + círculo proyectado; clic dentro = agujero, clic fuera = isla.
- Untrim: con 2 etapas, "Última" deja 1 y "Todas" deja la superficie entera.
- Revert de un redondeo: vuelven las superficies originales con su nombre, capa y material.
