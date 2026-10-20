# Memoria del proyecto Forja Studio

Este archivo es la memoria del proyecto entre sesiones. Léelo al empezar y actualízalo al terminar.

## Usuario

- Habla español; explicar las cosas de forma simple, sin jerga.
- Prueba en laptop. Decisión del usuario: por ahora NO diseñar para celular; todo para laptop.
- Presupuesto cero: solo herramientas gratuitas y de código abierto.

## Visión

Combinar Alias (superficies NURBS de clase A, análisis cebra/curvatura), Plasticity (modelado sólido rápido)
y Blender (render realista con shaders). Se empezó como app web para que cada avance se pruebe con un enlace.

## Concepto del usuario

`docs/concepto.md` es el documento de visión que escribió el usuario ("El Triángulo Perfecto"). Consúltalo antes de decidir funciones.
Puntos clave: continuidad G0–G3, red de curvas, modelado directo y booleanas/fillets, menús radiales,
viewport PBR con HDRI cambiable, materiales procedurales con proyección triplanar (sin UVs),
una tecla para alternar Diagnóstico (cebra/curvatura) ↔ Render, edición de CVs con reflejos en vivo sin lag.

## Estructura

- `index.html`: estructura y estilos. three.js 0.160.0 desde cdn.jsdelivr.net vía import map.
- `src/nurbs.js`: matemática NURBS pura (clampedKnots, greville, fitCurve/fitSurface, rebuild*, loft, extrude, revolve, planeData).
  OJO: en three 0.160 `NURBSSurface.getPoint(u, v, target)` NO devuelve el punto, solo rellena `target`.
- `src/main.js`: escena (array `objects`), selección, herramientas, paneles.
- Para publicar el Artifact: página = index.html sin <!doctype>/<html>/<head>/<body>, y `files` con src/main.js y src/nurbs.js.
- `docs/capturas/`: capturas de pantalla de cada versión.
- `docs/alias-referencia.md`: atajos y comportamiento de Alias (de la hoja oficial que pasó el usuario). Consúltalo.
- Desde este entorno no se puede abrir help.autodesk.com ni download.autodesk.com (DNS bloqueado); pedir capturas al usuario.

## Decisiones tomadas

- Nombre provisional: Forja Studio.
- Tema oscuro fijo, tipografía Geist / Geist Mono, acento ámbar `#f0a63a`, selección azul `#57b6ff`.
- Interfaz en español.

## Hecho (v0.1)

- Superficie NURBS 6×6 CVs, grado 3, nudos fijos, puntos editables con TransformControls y peso w.
- Modos: Realista (MeshPhysicalMaterial + RoomEnvironment), Cebra (shader propio), Curvatura (Laplaciano discreto), Malla.

## Hecho (v0.2)

- Herramienta Curva (tecla C): clic en el plano y=0.01 añade CVs; Enter o botón "Terminar curva" la crea; Esc cancela.
- Curvas NURBS clamped uniformes, grado min(3, n-1), dibujadas con Line2 (grosor en px).
- Peine de curvatura con derivadas numéricas, escala ajustable; imán a cuadrícula de 0.25.
- Selección genérica de CVs: userData.kind = 'surf' | 'curve'. Borrar curva con Supr o botón.
- Vista superior (T), mostrar/ocultar superficie. Hay una curva de ejemplo al abrir.
- Flujo de trabajo: la página se publica también como Artifact de Claude; index.html del repo = mismo contenido con <!doctype>/<head> añadidos.

## Hecho (v0.3)

- Navegación Alias: Shift+Alt + izq girar / medio desplazar / der dolly (OrbitControls.mouseButtons cambia según teclas; sin teclas = -1).
  Modo "Simple / táctil" por defecto si pointer: coarse. Selector en el panel.
- Pendiente: el usuario quiere los mismos atajos que Alias; preguntarle cuáles usa más y hacer un editor de atajos.

## Hecho (v0.4)

- Vista dividida en un solo canvas con scissor: izquierda Diagnóstico (cebra/curvatura/malla, teclas 1-3), derecha Render PBR.
  `layout` = split | diag | render, tecla V. Funciones clave: panes(), paneAt(), paneNDC(), renderPane().
- Capa 1 (DIAG) = solo diagnóstico: cuadrícula, isoparamétricas, polígonos de control, peines.
- gizmo._getPointer se sobrescribe para medir el puntero dentro de la mitad tocada (dragPane).
- Menú radial: mantener Espacio, soltar sobre la opción (array RADIAL).
- Biblioteca de 9 materiales con miniaturas renderizadas en un WebGLRenderer temporal.
- La imagen de referencia de interfaz del usuario: vista dividida, menú radial, biblioteca de materiales,
  pestañas de espacio de trabajo, árbol de objetos, línea de tiempo (convertirla en historial de versiones).

## Hecho (v0.5)

- Modelo de escena: `objects` = [{ id, kind: 'surface'|'curve', name, data, mat, visible, parts }]. updateObject(obj) regenera todo.
  Superficie: data = { degU, degV, knotsU, knotsV, cvs[nu][nv] }. Curva: data = { deg, knots, cvs[], plane }.
- Selección: pickMode 'object' | 'cv' (teclas O / P). Clic reemplaza, Shift alterna, Ctrl quita. Recuadro = crossing.
  selObjs guarda el orden (para el loft). El gizmo va en un `proxy` en el centroide y mueve todos los CVs afectados.
- Pivote: doble clic sobre objeto/suelo (animado), L = a la selección, marcador ámbar al navegar.
- Grado 1–7 y spans por U/V (y en curvas) desde el panel: rebuild con ajuste en Greville (error < 0.01 dm).
- Crear: Plano (clic), Loft (≥2 curvas, en orden), Extruir (distancia en el panel), Revolución (eje Y, círculo NURBS exacto).
  Plano de dibujo: suelo XZ o frontal XY.
- Paneles auto-ocultables (clase .auto en #app), chincheta para fijar. Lista de escena con ojo para ocultar.
- Navegación "Touchpad": Shift+arrastrar = recuadro.

## Hecho (v0.6)

- Cámara propia (sin OrbitControls): `pivot` fijo en el mundo; tumble orbita alrededor de él, track y dolly no lo mueven.
  Rueda = acercar hacia el cursor. Clic en un objeto fija el pivote (opción en el panel), doble clic también, L = a la selección.
- Pivote por objeto (`obj.pivot`, empieza en el centro de los CVs). Gizmo: W mover, E rotar, R escalar, D editar pivote.
  En modo Objetos cada objeto rota/escala alrededor de su propio pivote; el gizmo va en el pivote del último seleccionado.
- Snap como Alias: Alt rejilla, Ctrl punto, Ctrl+Alt curva (Cmd = Alt en Mac) + 3 botones fijos arriba.
  Punto: CVs, pivotes, extremos/puntos de edición, esquinas de superficies, origen, puntos del dibujo en curso.
  Curva: curvas y bordes de superficies (segmentos en pantalla). Funciona al mover con el gizmo, al dibujar curvas y al colocar planos.
  Con Alt, rotar va de 15 en 15 grados. `lastPtr` se actualiza en captura (antes que el gizmo) para que el snap no vaya un evento tarde.
- Selección con 3 botones (navegación Alias): izq elige (o alterna, opción), medio añade, der quita. Ctrl+flechas = pick walk.
  Ctrl+Shift+clic abre el menú radial. flushPending() aplica la última actualización al soltar el gizmo.
- Pruebas automáticas en el scratchpad (t8.mjs) con Playwright; los ataques al viewport usan proyección de puntos a pantalla.

## Siguiente paso

GitHub Pages ya está activo: https://eposboca9.github.io/forja-studio/

1. v0.6: sólidos estilo Plasticity con replicad/opencascade.js (WASM): caja/cilindro, extruir, fillet, chaflán, booleanas.
   Ojo: el Artifact de Claude bloquea fetch de .wasm; esto solo funcionará en GitHub Pages.
2. HDRI intercambiables (estudio, calle, desierto) y render con trazado de rayos (three-gpu-pathtracer).
3. Superficie a partir de curvas (loft / barrido) usando las curvas dibujadas.
4. Editor de atajos (esperando la lista de atajos de Alias del usuario).
5. Integrar OpenCASCADE (opencascade.js, WebAssembly) para sólidos, booleanas y redondeos.
6. Guardar y abrir proyectos (archivo .json) y exportar a STEP/OBJ.
