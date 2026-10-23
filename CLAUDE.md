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
- Para publicar el Artifact: página = index.html sin <!doctype>/<html>/<head>/<body>, y `files` con los src/*.js cambiados.
  OJO: al quitar <head> con una expresión regular NO tocar <header class="top"> (pasó en v0.18.3: el menú se fue abajo).
  Usar `</?head(\s[^>]*)?>` (con límite), no `</?head[^>]*>`.
- `src/exporters.js`: IGES 5.3 (128/126, lectura y escritura), STEP AP214 (GEOMETRIC_SET de B-splines), OBJ de cuadriláteros para SubD,
  SVG/DXF 2D (proyección paralela), .zip sin compresión. Validado con occt-import-js (OpenCASCADE) en el scratchpad.
- `src/logo.js`: logotipo Nodo.
- `src/freeform.js`: Freeform Blend / Skin por estaciones, curvas sobre superficie (proyectar), recortes (trimGeometry) y Extender. Pura matemática.
- `src/history.js`: historial de construcción (Align G0–G3, Blend G1/G2, Offset, Simetría, diagnóstico de unión). Pura matemática.
- `src/forge/engine.js` + `src/forge/replicad_single.wasm`: motor de FORGE = el código de modelado de BumpForge (app del usuario,
  https://claude.ai/artifact/S7MagYHBjK4qJ9bKmJjo3y) como módulo nativo de Forja (startForge(ctx)). Sus controles están en index.html
  dentro de <div class="bf-ui" data-module="forge"> (ids con prefijo bf-).
- `src/occ.js`: carga única de OpenCascade (replicad-opencascadejs 0.20.2) que comparten Forge y el Redondeo.
- `src/fillet.js`: Redondear / chaflán como Plasticity (makeShape cose superficies de Forja, edgeList, filletShape, toSurfaces
  devuelve B-splines recortadas a la caja UV de cada cara + lazos de recorte, previewMesh). Pura geometría, prueba en Node:
  scratchpad fil/t1.mjs (occ-node.mjs pone require/__dirname para el .js de replicad).
- `src/ao.js`: oclusión ambiental (GTAO de three sin EffectComposer) multiplicada sobre el lienzo tras dibujar cada vista; normales
  sacadas de derivadas de pantalla (las de vértice no sirven con el giro variable de los triángulos). Solo en modos Arcilla y Forja.
- `src/ai.js`: módulo IA: generadores paramétricos (tornillo ISO con rosca, tuerca, arandela, mesa, silla) y parsePrompt (español).
- `docs/capturas/`: capturas de pantalla de cada versión.
- `docs/alias-referencia.md`: atajos y comportamiento de Alias (de la hoja oficial que pasó el usuario). Consúltalo.
- Desde este entorno no se puede abrir help.autodesk.com ni download.autodesk.com (DNS bloqueado); pedir capturas al usuario.

## Decisiones tomadas

- Nombre: FORJA. Logotipo elegido "Nodo" (src/logo.js): FORJA en Outfit 500 dentro de un marco de construcción
  de 1 px que se pasa de largo en las esquinas; en la esquina inferior derecha las líneas paran antes de un + azul #2f7bff grueso.
- Interfaz (rama interfaz-concreto, pendiente de pasar a main): fondo de piedra rugosa a pantalla completa (src/concrete.js),
  tema claro/oscuro, sin marcos, menús que aparecen al acercar el ratón a cada borde, cabecera e info de vista siempre visibles y tenues.
- Por decisión del usuario se abre solo la vista Diagnóstico con las líneas de parche encendidas. Modo de arranque: FORJA (el modo
  propio de la marca, tecla 8; antes era Showroom). El usuario quiere que los modos de visualización ("map type") se vean mejor que Plasticity.
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

## Hecho (v0.6.1) — según la página "Tumble, Pan and Zoom the view" de Alias 2027

- Punto de interés: Shift+Alt + clic rápido sobre geometría (geometryPointAt). El clic simple ya NO fija el pivote por defecto (opción en el panel).
- dolly() siempre va hacia el pivote (botón derecho y rueda) y no lo atraviesa.
- Pistas de navegación (#navhint) arriba al mantener Shift+Alt.
- Modo de giro: cámara (por defecto) u objeto (tumbleObject: cruzar la vista = 180°; botón derecho horizontal = twist).

## Hecho (v0.7, rama interfaz-concreto)

- Shaders de evaluación Showroom (4), Difuso (5), Shade-Sky (6) en un ShaderMaterial (envDiagMat), con "luz ligada a la cámara".
- Escena de ejemplo: vaso de 4 superficies de revolución (Base, Cuerpo, Labio, Fondo interior). ?demo=capo carga la escena antigua (las pruebas t8 la usan).
- Líneas de parche con LineSegments2 (azul, 1.6 px). Línea de información de la vista junto a los modos de diagnóstico.

## Hecho (v0.7) — Archivo: importar y exportar

- Panel ARCHIVO (cabecera, Ctrl+E). Exporta IGES, STEP, OBJ, STL, GLB (Blender), PLY, OBJ cuadriláteros (SubD), SVG, DXF, .forja (Ctrl+S).
  Importa IGES (NURBS nativas 126/128), STEP (OpenCASCADE WASM desde jsdelivr, como malla), OBJ, STL, GLB/glTF, PLY, .forja (Ctrl+O, arrastrar).
- Unidades/eje automáticos: CAD en mm con Z arriba; OBJ/GLB en m con Y arriba. Forja internamente: dm, Y arriba.
- Objetos kind 'mesh' (sin CVs): se ven, se evalúan, se exportan; todavía no se pueden mover.
- Parasolid (.x_t) y .blend: formatos cerrados, no se escriben. Dentro del Artifact de Claude la descarga usa la capacidad
  `downloads` y los formatos no admitidos van en .zip; el STEP no se puede importar ahí (bloquea el .wasm).

## Hecho (v0.7.1)

- Modos MODELADO (diag) y VISU (render) en la cabecera; V alterna con giro de carrusel (switchLayout, Web Animations rotateY
  con transform-origin detrás de la pantalla). Dividida solo desde el menú radial.
- Info de la vista en la barra de estado; leyenda de curvatura abajo a la derecha; losa de propiedades con velo. Sin solapes a 1000 px.
- Showroom y Shade-Sky rehechos más parecidos a Alias (base gris clara ambiente 0.5 + difusa 0.5 + reflejo de estudio suave).

## Hecho (v0.7.2)

- Carrusel 3D (renderCarousel): durante el cambio se dibujan los dos módulos a la vez con dos poses de cámara
  (carouselPose): el que sale gira 150° sobre el pivote, se aleja y se va a un lado; el que entra hace lo contrario. 1,3 s.
  window.__forja.carousel() permite congelarlo en pruebas (c.dur = 1e7; c.t0 = ...).
- Panel por módulo: secciones con data-module="all|diag|render"; showModule()/flipPanel() con giro de placa.
  VISU: materiales, editor de material, entornos (Estudio RoomEnvironment, Exterior y Atardecer con Sky, Nublado), fondo desenfocado,
  gestión de color AgX/ACES, exposición, sombra.
- Contraste (v0.12): ni mix-blend difference ni halos. adaptInk() (cada 250 ms tras dibujar) lee con gl.readPixels la franja
  de la vista bajo cada rótulo (INK_SEL: cabecera, menús desplegados, pane-head, barra de estado; el lienzo transparente = muro)
  y pone .ink-dark (negro) o .ink-light (blanco) entero. El usuario quiere texto sólido negro/blanco, sin sombreado. El muro sigue en .app. No volver a poner
  z-index/opacity/transform en .top o .view: crean capas aisladas y rompen la mezcla. El <header> está después de <main> en el DOM.
- Showroom estilo Alias: horizonte bajo (-0.32), paredes claras, suelo oscuro reflejado, especular y luz de relleno.
- Idea del usuario para el futuro: carrusel configurable con más módulos, p. ej. "IA" (prompts que crean tornillos M6, mesas,
  sillas, o reconstruyen mallas como NURBS).

## Hecho (v0.8)

- Puck (Tab, como el de Alias, en limpio): anillo interior crear/superficies, exterior elegir/transformar/mostrar. Mantener y soltar,
  o pulsación corta = queda abierto. Comandos "próximamente" atenuados (Align, Blend, Round, Offset, Simetría, Distancia).
  Menú de visualización (Espacio o Ctrl+Shift+clic): Información, Modelado, Visu, IA, Controls ON/OFF, Toggle Grid, Toggle Model,
  Pantalla completa, Panel, Dividida. makeRadial(rings, radii) genera ambos.
- Nuevos comandos: Nada (pick nothing), Duplicar, Ocultar, Mostrar todo, Toggle Model (modelClean), Toggle Grid.
- Barra de dibujo de curva abajo (no tapa la cabecera).
- Mallas: el gizmo ahora las mueve/rota/escala (gizmoDrag.meshes, applyMatrix4 sobre la geometría original).
- Módulo IA (tercer módulo del carrusel, layout 'ai'): pedido en español -> parsePrompt -> generadores -> mallas colocadas en fila.
  Si no entiende, y está dentro de claude.ai, pregunta a Claude con la capacidad `sample` (CLAUDE_INSTRUCTIONS -> JSON).
  En GitHub Pages solo funciona el intérprete local.
- Pendiente IA: más generadores (ver v0.9), reconstruir mallas como NURBS.

## Hecho (v0.9)

- Carrusel en anillo (switchLayout/renderCarousel): los módulos (RING = diag, render, ai) se reparten a 360°/n sobre un anillo
  con eje vertical a la altura del horizonte; el radio crece con el número de módulos. La cámara sube a una vista elevada (24°),
  el anillo gira por el camino más corto y la cámara baja. Solo objetos 3D (el usuario NO quiere tarjetas ni nada 2D);
  sí quiere etiquetas (.ring-labels): la del módulo activo grande y azul. Cada módulo se dibuja con moduleCamera (cámara desgirada).
- Polígono de control: interior punteado naranja claro (#ffb46b), borde de la red continuo naranja oscuro (#c2560f, p.hullEdge hijo de p.hull).
- CVs: esfera invisible para elegir + figura dentro (makeHandle). "+" plana y fina orientada con la geometría (orientHandle:
  en superficies sobre el plano tangente U/V, en curvas tangente/normal en su plano); esquinas de superficies = cubo pequeño.
  scaleHandles() mantiene tamaño constante en pantalla. pickAt elige el CV más cercano al rayo, no a la cámara.
- Puck y menú de visualización en 3D: anillo elíptico (RADIAL_TILT), esferas con brillo y sombra, más grandes delante, crecen
  cerca del ratón. Puck: Objeto, Curvas, Superficies (pickFilter), CV, Mover, Rotar, Escalar...
- Transformar como Alias (mouseXform): tras W/E/R o Mover/Rotar/Escalar, arrastrar fuera del gizmo: izq = X, medio = Y, der = Z
  (escalar: izq uniforme, medio Y, der XZ). Usa los eventos del gizmo (mouseDown/objectChange/mouseUp). Esc o un pick lo quita.
- IA con preguntas (src/ai.js: CATALOG, parsePrompt -> items {type, given}, questionsFor (máx. 2), toCommands, describe).
  Conversación en #ai-chat con opciones de un clic, "Por defecto", "Crear ya" o respuesta escrita. Vaso, cuenco y botella
  salen como superficies NURBS de revolución. Pedidos desconocidos: dentro de claude.ai pregunta a Claude (sample), que puede
  devolver preguntas o items; en GitHub Pages muestra lo que sabe hacer. Pruebas del intérprete: scratchpad aitest/run.mjs.

## Hecho (v0.10)

- Carrusel con V mantenida (holdCarousel/releaseCarousel/pickModule): la cámara sube y se queda arriba; el módulo bajo el
  ratón se levanta (c.lift) y su etiqueta se aclara; clic = el anillo lo gira al frente y baja; soltar V sin elegir = cancela.
  Los botones de la cabecera y los menús siguen haciendo el giro automático (c.auto). ringSetup() calcula el anillo.
- Menús (v0.10.1): TODOS son anillos de esferas 3D (makeRadial(items, {r, title})); el usuario NO quiere menús planos.
  Esferas con brillo especular, sombra y el icono "grabado" (trazo oscuro + borde claro). Cada esfera del anillo puede tener
  `sub`: al pasar por encima salen esferas más pequeñas en un arco hacia fuera (submenú). Contenido distinto por menú:
  Puck (Tab) = PUCK (herramientas: Curva, Superficie, Editar, Elegir, Transformar, Duplicar, Mostrar, Borrar);
  Ctrl+Shift+izq = PICK_MM (selección), +medio = XFORM_MM (transformar), +der o Espacio = DISPLAY_MM (visualización).
  MENUS = [puck, pickMenu, xformMenu, disp].
- Etiqueta junto al cursor (.xf-prompt) cuando mover/rotar/escalar con los 3 botones está activo.
- IA libre: tipo "custom" con piezas (ai.js buildParts: revolve/sphere -> NURBS; extrude/box/torus/tube -> malla; position,
  rotation en grados, material). Claude (sample) primero pregunta (tier quick) y luego construye (tier default).
  "Crear ya" fuerza items sin preguntas. Fotos: botón "Añadir fotos" -> sample con images (capacidad {sample:{images:true}}).
  Pedidos de biblioteca con detalles extra (EXTRA: "con asa", "marca"...) van a Claude si está disponible.
  Prueba con Claude simulado: scratchpad taic.mjs y taierr.mjs (addInitScript define window.claude).
  Errores de Claude: askClaude rescata el JSON de una respuesta invalid_json (looseJSON); claudeError muestra el código y "Reintentar".
  Taza con asa (mug) local: cuerpo NURBS + asa de tubo. Un objeto conocido tras "de/para" ("lámpara de escritorio") no cuenta.
- Publicar el Artifact con capabilities {sample: {images: true}, downloads: true}.

## Hecho (v0.11)

- Barra de menús como Alias (MENUBAR en main.js, buildMenubar): Archivo, Editar, Borrar, Vistas, Mostrar, Capas, Visualización,
  Animación, Ventanas, Preferencias, Utilidades, Ayuda. Se quitaron de la cabecera Objetos/CVs, Snap (Rejilla/Curva/Punto) y el tema:
  los botones viven ocultos en #held-ctrls (el código y los menús los usan) y el tema está en Preferencias.
- Preferencias (<dialog id="prefs">, openPrefs): Interfaz (tema, modos de evaluación A/B/C, mover/rotar/escalar con botones,
  ambos o manipulador), Navegación (la sección del panel se movió aquí), Atajos. Se guardan en localStorage 'forja-prefs' (prefs).
- Modos de evaluación fuera de la cabecera, 3 opciones (prefs.evalUI, #app[data-evalui]): A esferas en la barra izquierda,
  B miniaturas en el panel derecho (por defecto), C una esfera que se despliega. Miniaturas renderizadas (buildEvalUI). Esperando
  que el usuario elija una. Captura: docs/capturas/v0.11-opciones-evaluacion.png.
- Mover con botones: con prefs.xform = 'mouse' (por defecto) el manipulador se esconde al pulsar W/E/R, así arrastrar sobre el
  objeto ya no lo agarra el gizmo (era la causa de que "no funcionara mover").
- Deshacer/rehacer (checkpoint/snapshot/restore, 50 pasos): Ctrl+Z y Ctrl+X deshacen (el usuario pidió Ctrl+X), Ctrl+Y / Ctrl+Shift+Z rehacen.
  checkpoint() se llama al crear/borrar objetos, al empezar a arrastrar el gizmo, ocultar, materiales, reconstruir, capas y grupos.
- Capas (layers, activeLayer; obj.layer) y grupos/carpetas (groups; obj.group). obj.visible es un getter = ojo propio Y capa
  encendida; obj.ownVisible = solo el ojo. Ctrl+G agrupa, Ctrl+Shift+G desagrupa; elegir un objeto agrupado elige el grupo.
  Escena = árbol con carpetas plegables; "Capas" plegable bajo la escena (ojo, nombre con doble clic, ← pasa la selección).
- Pedido del usuario pendiente: render realista nivel VRED/Cycles (imagen de la moto). Plan: three-gpu-pathtracer (WebGL, gratis)
  con HDRI, materiales PBR (pintura con flakes, fibra de carbono) y botón "Render" progresivo en VISU.

## Hecho (v0.12)

- Menús desplegables solo texto (sin ventana de fondo), con el mismo cambio de color negro/blanco según lo que haya detrás.
- Capas en una VENTANA FLOTANTE independiente (#layers-win, layersWin: arrastrar por la cabecera, plegar, cerrar; posición en
  prefs.layersWin; se reabre desde el menú Capas o Ventanas). refreshOutliner: cada capa es una carpeta (ojo, nombre = capa
  activa, doble clic renombra) con sus grupos y objetos dentro. Arrastrar objetos/grupos sobre otra capa los pasa (moveToLayer).
  layers/groups/EVAL_MODES se declaran arriba en main.js (antes de usarse).
- Puck por módulo y personalizable: PUCK_CMDS (biblioteca de comandos con submenús), PUCK_DEFAULT {diag, render, ai},
  prefs.puck[mod] = lista de ids. getPuck() rehace el Puck al cambiar de módulo o de personalización (MENUS[0]).
  Editor en Preferencias > Puck (subir/bajar/quitar/añadir, máx. 10, restablecer).
- Render: Unreal no es código abierto (licencia propia) ni corre en el navegador; plan sigue siendo three-gpu-pathtracer.

## Hecho (v0.13) — historial de construcción

- relations [{id, type: 'align'|'blend'|'offset'|'mirror', ...}] (arriba en main.js). updateObject() llama a propagateFrom(obj):
  cada relación cuya entrada cambió se recalcula (applyRelation) y sigue en cadena; un Align también se reaplica si se toca la
  superficie que se ajusta (sus filas del borde quedan atadas). Se guardan en el deshacer (snapshot.relations).
- Align (history.js alignRows): la superficie que se ajusta toma la estructura de la maestra a lo largo del borde (prepareSlave:
  rebuild si hace falta y copia nudos) y sus filas 0..cont se resuelven para que las derivadas de cruce sean (-λ)^k · las de la
  maestra (derivadas de B-spline en el borde, vale con grados/nudos distintos al cruzar). λ0 = naturalLambda (no cambia la forma
  al crear); "Tensión" lo multiplica. Medido: hueco 0, ángulo ~0.01°, curvatura < 2 %.
- Blend: superficie nueva entre dos bordes compatibles (mismo grado/CVs/nudos a lo largo), 4 filas G1 o 6 filas G2 (grado 5),
  alineada a los dos lados con alignRows. Offset: CVs desplazados por la normal en sus puntos de Greville (aproximado).
  Simetría: reflejo en x = 0 (invierte U para conservar la normal).
- Elegir bordes: tool 'edge' (startEdgeOp('align'|'blend')): clic cerca de un borde (nearestEdge con el uv del impacto);
  verde = el que se ajusta, azul = maestro, naranja = el que está bajo el ratón.
- Panel "Historial de construcción" (diag): cada relación con G0–G3 / G1–G2, tensión, distancia, diagnóstico ✓/✗ y quitar historial.
  Menú "Superficies" nuevo y Puck › Editar (Align, Blend, Offset) y Duplicar › Simetría ya funcionan. Round sigue pendiente.
- Pruebas: scratchpad aitest/hist.mjs (matemática), thist.mjs y thist2.mjs (en la app).

## Hecho (v0.14) — herramientas de superficies revisadas

- Fallos arreglados: Align se rompía si la maestra tenía menos filas que la continuidad (extrusión = 2 filas); Blend fallaba
  con bordes de distinta estructura. Ahora: Align 96/96 casos de prueba; Blend 231/240 (los 9 restantes = curva libre contra
  círculo exacto, hueco 0.24 mm, lo marca el diagnóstico). Blend usa como base el borde con más CVs y remuestrea el otro
  (resampleAlong: interpolación exacta en Greville, sistema lineal con funciones base Cox-de Boor). Continuidad por lado
  (contA/contB, G0–G3; filas = contA + contB + 2). Diagnóstico de curvatura con diferencias finitas de 4 puntos.
- Ventana de opciones por herramienta (TW, #toolwin): sin caja; ::before con backdrop-filter blur y máscara radial que
  difumina los bordes. Se arrastra por el título. Cambia con la herramienta. Al elegir un objeto que sale de una relación se
  abre su ventana para modificarla (relSpec / syncToolWinToSelection). toolDef (prefs.tools) recuerda los valores.
- Elección rápida junto al cursor (quickPick, #quickpick): Align = al elegir la maestra sale G0/G1/G2/G3 (o teclas 1–4);
  Blend = en cada borde. La herramienta sigue activa para la siguiente unión (restartEdgeOp); Esc / Terminar la cierra.
- Extruir con el ratón (extrudeSelection): crea la superficie y la distancia sigue al cursor a lo largo de la dirección
  (proyección en pantalla desde el centro de la curva) hasta hacer clic. Ventana: distancia, dirección (normal/X/Y/Z), dos lados.
  Extruir, Revolución y Loft ahora tienen historial (siguen a sus curvas). Simetría con plano YZ/XZ/XY.
- Pruebas: scratchpad aitest/hist2.mjs (todas las combinaciones), ttools.mjs (extruir, align y blend con el ratón).

## Hecho (v0.15)

- Ventana de herramienta: el desenfoque lleva el color del fondo (--bg al 88 %), bordes difuminados.
- CVs solo de lo elegido (cvTargets): al pasar a CV se encienden los de los objetos elegidos; en modo CV, clic en un objeto
  enciende solo los suyos (Shift / medio = añadir). pickAt devuelve {cvTarget}. Pruebas: window.__forja.cvAll() los enciende todos.
- Menús por módulo: en VISU el Puck, Espacio y Ctrl+Shift+botón solo tienen visualización (dispVisu; CMD_MODS limita el
  editor del Puck). Menús menos sensibles: solo se marca una esfera con el cursor a menos de 66 px (submenú 44 px).
- Flechas de manipulación (relArrows, relHandles): Align/Blend = azul en la 1.ª fila (tensión) y naranja en la 2.ª (forma mu:
  G2 geométrico S2 = lambda^2 M2 - mu M1; G3 S3 = -lambda^3 M3 + 3 lambda mu M2; la curvatura sigue igual). Blend: tensión y
  forma por lado. Extruir y Offset: flecha verde de distancia. Tras crear Align/Blend se abre su ventana con flechas y la
  herramienta sigue activa.
- Del video de Alias (Transform controls): nudge con flechas del teclado (paso según zoom, Shift x10, E/R giran 1° / escalan 1 %);
  snap combinado con la restricción de botón (solo cuenta la componente del eje); divisiones del snap de curva (prefs.snapDiv,
  por borde) y snap al centro de curvas (prefs.snapCenter). Preferencias > Snap.
- Del video de historial de Alias: colores (verde = tiene historial, rosa = depende de lo elegido, azul = sin historial;
  recomputeDeps/histState); aviso al transformar un resultado con historial (askBreakHistory: quitar historial o no; en CV se
  permite retocar la superficie de un Align); "Actualizar al momento" por relación (apagado = botón Actualizar);
  Opciones de control: Crear historial, Comprobar continuidad; Preferencias: actualizar durante el arrastre (prefs.histLive).
- Pruebas: tarrow.mjs, tnudge.mjs, thist3.mjs.

## Hecho (v0.16) — Freeform Blend, Skin, curvas sobre superficie, recortes, Extender (videos 5 y 6 de Alias)

- Lados de un blend (FF.prepSide): borde de superficie, curva sobre superficie (cos) o curvas libres encadenadas.
  FF.freeformBlend: en cada estación (Greville de la estructura U) una Bézier que cruza con las derivadas de cada lado
  (E_k = derivadas de S(uv + t·w) hacia fuera; G0–G3, forma = λ·tensión, flecha naranja mu = (p−1)·shape·λ) y cada fila se
  interpola en U. Con dos bordes completos y flujo isoparamétrico se sigue usando el Blend exacto de history.js (exactBlend).
- Opciones como Alias: Lado 1/2 G0–G3, Forma lado 1/2 + Bloquear formas, Corona, Modificar parámetro (costura/giro de lados
  cerrados), Control explícito (grado y spans U), Control de flujo (Inicio/Fin: Defecto | Alinear al borde; Interior: Libre |
  Isoparam.; Modificar rango por lado), Recortar automáticamente, Deshacer todo, Siguiente. Grupos plegables en TW (type 'group',
  campos con show()). Etiquetas en la vista (#rel-labels: Lado 1, Lado 2, Inicio/Fin o Costura, Corona).
- Curvas sobre superficie: relación 'project' {src, surf, mode view|y|normal, dir, trim}. data.cos = {surf, uv[], closed, trim};
  se dibujan exactas sobre la superficie. Recorte: trim 'inside'/'outside' con un lazo cerrado o de borde a borde (FF.trimLoop);
  updateSurface recorta la malla (marching squares con cruce exacto por bisección) y las isoparamétricas. Mover la curva original
  -> proyección -> recorte -> blend, todo en cadena (como al final del video).
- Skin (relación 'skin', aIds/bIds): entre curvas, con Encadenar (Enter = siguiente lado), Reconstruir (sin él y misma
  estructura = reglada exacta), Inicio/Fin: Unir extremos | Extender (recorta el lado que pasa de largo, a escuadra).
- Extender (relación 'extend'): superficie nueva desde un borde con Taylor G1–G3, flecha verde de distancia.
- Curvas › Círculo (NURBS exacto). Menús Curvas y Superficies, Puck › Curva / Editar. Ayuda › Ejemplo: Freeform Blend
  (?demo=asa: puerta + fondo recortados por círculos proyectados y unidos G2/G1).
- Pruebas: scratchpad aitest/ff.mjs (matemática), tff.mjs (ejemplo e historial), tff3.mjs (Skin, Proyectar y Extender con clics).

## Hecho (v0.17) — cubo de vistas, ortogonal y dibujo de curvas según la vista

- Cubo de vistas (ViewCube de Alias) arriba a la derecha de cada vista de modelado (cubeScene/cubeCam, renderViewCube después de
  cada pane con clearDepth). Cara = vista ortogonal de ese lado; arista/esquina = perspectiva desde ahí (goToView + camAnim,
  420 ms); arrastrar el cubo = girar. Resaltado azul de la región bajo el ratón (cubeRegionAt: componentes −1/0/1, umbral 0.3).
  CUBE_RIGHT = 66 px para no caer en la franja de 56 px que abre el panel derecho (si no, el panel tapaba el clic).
- Ortogonal: la misma cámara cambia de matriz (camera.updateProjectionMatrix sobrescrito; isOrthographicCamera se cambia para
  que Raycaster y los shaders lo sepan). Alto visible = 2·profundidad del pivote·tan(fov/2): pasar de una a otra no salta y dolly
  hace zoom. proj = {ortho, temp, keep}: temp = puesta por el cubo (girar vuelve a perspectiva); keep = botón PERSP/ORTO bajo el
  cubo (prefs.ortho). Nombre de la vista en la barra de estado (#vi-proj: "ORTOGONAL · FRENTE"). T = vista de arriba ortogonal.
- Dibujo (drawPlaneKind 'auto' por defecto; barra de dibujo y panel: Vista | Suelo | Frente | Lado): ortogonal de arriba = XZ,
  de frente (+Z) = XY, de lado = YZ (por el origen); en perspectiva = en el aire (plano de la pantalla por el pivote o por el
  primer punto). Círculos y planos en perspectiva van al suelo. Curvas con plane 'yz' o 'free' (N.curvePlaneNormal: Newell);
  extruir 'Normal' usa esa normal. Rejillas gridXY / gridYZ según el plano (updateDrawGrids).
- Snap al dibujar (botones en la barra de dibujo): rejilla (Alt; en perspectiva la del suelo), punto (Ctrl), curva (Ctrl+Alt:
  curvas, aristas y líneas de parche = obj.isoLines, sin lo recortado; prefs.snapIso), superficie (botón o Shift mantenido).
- Pruebas: scratchpad tcube.mjs (en swiftshader los cuadros son lentos: esperar ~1.5 s tras clic en el cubo).
- Cubo con el estilo del logo Nodo: trazo de 1 px, aristas que se pasan de largo en las esquinas y, en la esquina delante-abajo-
  derecha (PLUS_CORNER), las líneas paran antes de un + azul grueso (Sprite, visible cuando esa esquina mira a la cámara). Sin ejes.
- Cubo solo de líneas (LineSegments2) y nombres sin fondo; un cubo invisible (colorWrite false) tapa lo de atrás y sirve para
  elegir. Color negro/blanco desde .cube-probe (un div sobre el cubo que adaptInk clasifica).
- Velo "gaussiano" (clase .soft-veil y ::before de toolwin/quickpick): blur 18px + tinte --bg 50 % + máscara = producto de dos
  rampas erf (desenfoque gaussiano de un rectángulo, no se ve forma). Panel derecho: #panel transparente + panelVeil (div
  hermano antes de #panel, colocado cada cuadro). Puck: ::before con máscara radial de rampa gaussiana.
  Texto encima con negro/blanco: INK_SEL incluye secciones del panel, filas de la ventana de herramienta y etiquetas del Puck;
  adaptInk mezcla el tinte del velo (data-ink-tint="0.5") con lo que hay detrás. Botones activos (azules) siguen en blanco.

- (v0.17.1) Pedido del usuario: SIN fondo en la ventana de herramienta, la elección rápida, el panel derecho y la ventana de
  Capas (CSS al final de index.html oculta los velos; panelVeil queda oculto). Solo texto con negro/blanco por fila (INK_SEL:
  hijos de .panel .sec, filas de .tw-body, cabecera y filas de Capas). El Puck conserva su velo gaussiano.
  Cubo: se oculta mientras el panel derecho está abierto (panelOpen) y, con el panel fijado, se corre a su izquierda (cubeRight).

## Hecho (v0.18) — módulo FORGE (cuarto módulo del carrusel), nativo

- El usuario NO quiere BumpForge como app metida (se probó con iframe y se quitó). Forge = solo el código de modelado de
  BumpForge dentro de Forja, con el visor, la cámara, el fondo, el panel, el Puck y los menús de Forja.
- src/forge/engine.js: el <script type="module"> de BumpForge envuelto en `export async function startForge(ctx)`.
  Cambios: $ = getElementById con prefijo 'bf-' (idempotente); querySelector('#x') → '#bf-x'; sin renderer, cámara,
  OrbitControls, compositor ni GTAO propios (ctx.renderer, ctx.camera, ctx.controls = {target: pivot, autoRotate, enabled});
  `scene` = ctx.root (Group forgeRoot en la escena de Forja); toast → ctx.toast; resetCamera → ctx.setView; exposición y
  tono → ctx.setExposure/setTone; deliver (descargas) → ctx.deliver; clics en el lienzo solo si ctx.active(); el bucle es
  ctx.onFrame (devuelve true si dibujó el trazador de rayos); OCC_WASM = 'src/forge/replicad_single.wasm'. Sin iconos Font Awesome.
  Devuelve { openFile(file), resetCamera, invalidate }.
- Forja (main.js, bloque "Módulo FORGE"): ensureForge() importa el motor al entrar al módulo; renderPane(kind 'forge') →
  renderForgePane: oculta los demás hijos de la escena, dibuja forgeRoot con entorno 'studio', fondo null (muro), tono y
  exposición de Forge. En layout 'forge' la selección / recuadro / mover de Forja están desactivados y el gizmo apagado.
  "Traer de Forja" (forgeFromForja: STEP mm Z arriba si son superficies, STL si hay mallas → api.openFile) y "Enviar a Forja"
  (forgeToScene + bf-exportBtn: el horneado entra en la escena con importFile). Puck de Forge: De Forja, A Forja, Exportar,
  Encuadrar, Render. Import map con three-mesh-bvh y three-gpu-pathtracer (render realista de Forge).
- index.html: .bf-ui (estilos de los controles con el aspecto de Forja: títulos en mayúsculas espaciadas, botones planos,
  azul #2f7bff, sin fondos, texto negro/blanco por fila en INK_SEL), .bf-hud (datos de la pieza abajo a la izquierda) y
  .bf-loader. Las reglas generales de Forja (.hint, .seg button nowrap/mayúsculas, .chip) se anulan dentro de .bf-ui.
- (v0.18.1) Pedido del usuario: los objetos de Forja también se ven en Forge (como en Visu e IA). renderForgePane dibuja la
  escena con los materiales de Visu + forgeRoot. placeForge() cada cuadro: la pieza de Forge va a tamaño real (sizeMm/100 dm);
  si salió de "Traer de Forja" (forgeSource {ids, box}) y Forge está en modo archivo/NURBS, ocupa la caja del original y esos
  objetos se ocultan en esta vista; si es una forma de Forge (cubo, esfera...) se apoya en el suelo a la derecha de la escena.
  setView de Forge pasa por la matriz de forgeRoot. La selección de Forja funciona en Forge salvo mientras Forge elige
  caras / pinta (api.picking()). El suelo y la rejilla propios de Forge se ocultan (se usa el suelo de Forja).
- (v0.18.2) Pedido del usuario: en Forge NO hay objetos propios (ni el cubo / cilindro de arranque de BumpForge, ni Forma base,
  ni Subir modelo / Ejemplo): se trabaja eligiendo un objeto o superficie de la escena. Elegir con clic en Forge
  (selectionChanged → forgeSelectionChanged, 350 ms) o "Usar selección" → forgeFromForja (solo lo elegido) → pieza en su lugar.
  forgeSource = {key, ids, box, ready}; el motor llama ctx.onPiece al terminar rebuild en modo archivo/NURBS → ready, y
  #app[data-forge-piece] = 1. Sin pieza: forgeRoot no se dibuja, setView no mueve la cámara y el panel solo muestra
  "Pieza de trabajo" (CSS con data-forge-piece="0"). "Crear objeto" = hornear y dejarlo en la escena. En la vista de Forge se
  ocultan gizmo y marcas de pivote.
- Prueba: scratchpad forja/tbump.mjs [dark|light] [pull] [push] (jsdelivr bloqueado aquí: sirve paquetes de npm desde
  scratchpad/npmcdn). Resultado: arranca (cubo de ladrillos, 580.800 triángulos, hermética); el vaso de Forja llega como 4 caras
  NURBS, sólido cerrado; "Enviar a Forja" deja el STL horneado (841.208 triángulos) en la escena.

## Hecho (v0.18.3) — lo de Forge pasa a la escena

- Pedido del usuario: lo creado en un módulo se ve en los demás; el patrón de Forge debe ser geometría 3D real.
  "Aplicar a la escena" (bf-pushForja, Puck forgeOut) = forgeApply(): si hay vista previa NURBS sin cortar (forge.pendingCut,
  cadAppliedKey) corta primero (cadApply); luego forge.resultGeometry() (relieve horneado + logos con Manifold, o el teselado
  del B-rep en modo NURBS) en coordenadas de forgeRoot → matrixWorld → addMesh "<nombre> · patrón" en la capa del origen.
  Los objetos de origen se ocultan (Ctrl+Z deshace). Volver a aplicar sobre la misma pieza reemplaza el resultado
  (forgeSource.resultId). Al salir de Forge (setLayout) se aplica solo si patternStamp() cambió (forgeSource.applied).
  En la vista de Forge el resultado se oculta mientras se ve la pieza; elegirlo no cambia la pieza.
- Prueba: scratchpad forja/tapply.mjs dark cad|mesh.

## Hecho (v0.19)

- Menú arriba otra vez (el fallo era el script de publicar, ver Estructura).
- Forge: el corte NURBS de una piel abierta (una sola superficie) se quedaba colgado: occBooleanSafe exigía sólido y partía
  el lote en mitades sin fin. Ahora con pieles basta con que el resultado tenga caras. El progreso de "Aplicar al salir de
  Forge" se ve en el módulo al que se va (#app[data-forge-busy]).
- Modo Malla (tecla 3) como el wireframe de Alias: las superficies no se pintan (wireMat colorWrite false, siguen sirviendo
  para elegir y no dan sombra); se ven bordes (p.bound), líneas de parche y curvas sobre superficie en blanco/negro según el
  tema (wireLineMat). Las mallas muestran solo aristas vivas > 30° (meshFeatures, EdgesGeometry), no triángulos.
- Ortogonal fija en cualquier vista: botón ORTO bajo el cubo, Shift+O o Vistas › Ortogonal (fija) (toggleOrtho; girar no la quita).
- Redondear (tecla B como Plasticity, Superficies › Redondear / chaflán aristas, Puck › Editar › Redondear): startFillet cose las
  superficies elegidas (o todas las visibles) con OCC; aristas candidatas en gris (las tangentes no); clic elige,
  Ctrl/Shift/medio añade o quita; punto amarillo: arrastrar hacia dentro = redondeo, hacia fuera = chaflán (Alt: de 5 en 5 mm);
  V = punto de radio variable bajo el cursor (en la 1.ª arista, radios en la ventana); vista previa = malla de OCC con el
  sombreado de evaluación; Enter / clic derecho / Aceptar: las superficies de origen se sustituyen por NURBS exactas (nombre,
  material, capa y grupo del origen; "Redondeo n" las nuevas) y cada lazo de recorte es una curva sobre superficie
  (cos.edge = true, sin peine). Esc cancela. Formas Cónica/G2/Chordal de Plasticity: OCC solo hace redondeo circular y chaflán.
  Referencia: github.com/nkallen/plasticity-document pages/solid/fillet-shell.en.mdx.
- Pruebas: forja/tfillet.mjs (caja de 6 planos), tmisc.mjs (Malla + ortogonal), tapply.mjs dark cad1 (piel abierta).

## Hecho (v0.19.1) — acabado visual tipo Plasticity

- Modo de evaluación "Arcilla" (tecla 7, Visualización › Arcilla; envDiagMat uMode 4): base mate oscura que absorbe la luz de
  frente, brillos del estudio solo en ángulos rasantes (graze) y líneas de parche sutiles (isoMat fino y apagado en este modo,
  setDiag). Pedido del usuario: estética clínica/minimalista de Plasticity, AO pronunciado, brillos nítidos en bordes y biseles.
  PENDIENTE: oclusión ambiental real (hace falta un pase de post-proceso en el lienzo dividido) y probar en Visu / Forge.
- Los bordes de recorte (curvas con cos.edge) se dibujan finos (edgeCurveMat 1,1 px, claros en tema oscuro y negros en claro).
- Redondear: OpenCascade devuelve el sólido con volumen negativo (se corrige con Reverse en filletShape) y sus caras de redondeo
  pueden quedar orientadas al revés de las vecinas; toSurfaces(…, evalPt) y previewMesh deciden el giro con la prueba del rayo
  (paridad de cruces de la malla, no depende de ninguna orientación de OCC).
- CONVENCIÓN DE FORJA: la superficie se ve bien cuando Su × Sv apunta HACIA DENTRO del sólido (el giro de los triángulos de
  ParametricGeometry es el contrario de su normal y mira hacia fuera; con material DoubleSide manda el giro). Las superficies de
  revolución ya son así. No asumir "Su × Sv hacia fuera".
- El redondeo se ve gris/cromado en Visu con pintura roja: no es un fallo, es el barniz reflejando el estudio en ángulos rasantes.
- Pedidos pendientes del usuario: los "map type" de Forge (Superficie UV / Cilindro 360° / Plano) deben verse tan elegantes y
  definidos como la textura de Plasticity 2025.2, y las herramientas (redondeo...) deben funcionar con sólidos de Parasolid
  (STEP importado como B-rep, hoy entra como malla) y con superficies. Falta decidir con el usuario qué quiere exactamente.

## Hecho (v0.20) — modos de visualización propios, oclusión y calidad de línea

- Modo FORJA (tecla 8, envDiagMat uMode 5) = el modo de la marca y el de arranque: grafito azulado mate, brillos solo en ángulos
  rasantes (blanco frío a un lado y azul #2f7bff al otro) y líneas de parche azul marca finas. Arcilla (7) queda como el neutro.
- Oclusión ambiental real (src/ao.js, prefs.ao, Visualización › Oclusión ambiental): oscurece los contactos con el suelo, las uniones
  y las cavidades. El suelo cuenta en el pase pero el lienzo es transparente: el contacto se ve sobre los propios objetos.
- Calidad de línea ("se ve de baja resolución"): causa principal = las curvas exactas caían sobre una malla de triángulos y esta las
  tapaba a tramos (líneas "a rayas", sobre todo en ángulos rasantes). Arreglos: polygonOffset en todos los materiales de superficie,
  teselado adaptable (tessMul: normal al editar, ×2,2 tras 450 ms quieto, en trozos de 25 ms; updateObject lo reinicia),
  alphaToCoverage en LineMaterial y pixelRatio mínimo 1,5 (supersampling en pantallas de baja densidad).
- Pruebas: forja/tline.mjs (captura a doble densidad), tao.mjs / tao2.mjs (AO con y sin), tclay.mjs, ttess.mjs. En swiftshader con
  pixelRatio 1,5–2 + AO la página tarda en arrancar: subir los timeouts de las pruebas (240 s).
- (v0.20.1) Rendimiento (el usuario: "muy lento, solo con mover la vista"): el AO costaba ~6x el resto del cuadro. Ahora: se calcula a
  media resolución con 8 muestras, SOLO con la vista quieta (>140 ms sin cambios; la clave = cámara + sceneChangedAt) y se reutiliza
  mientras no cambie (solo la mezcla, barata); la sombra solo se recalcula si cambió la escena (sceneChangedAt, gizmoDrag, Forge,
  carrusel); adaptInk (lectura de píxeles) solo con la vista quieta y cada 400 ms; renderer sin preserveDrawingBuffer; TESS_HI 1,8.
  sceneChangedAt se actualiza en updateObject / applyVisibility / removeObject: cualquier cambio nuevo de escena debe pasar por ellos.
  Banderas solo para pruebas: window.__forjaPR (pixelRatio) y window.__forjaNoAO. Medición: forja/tperf.mjs.
- (v0.20.1) Interfaz: interruptor claro/oscuro arriba a la derecha (#theme-switch, estilo interruptor de luz, sin fondo);
  herramientas de selección y transformación (select, mover, rotar, escalar | pivote, encuadrar, vista superior) a los lados del cubo
  (#cube-tools, columnas #ct-left / #ct-right colocadas cada cuadro junto al cubo; CUBE_RIGHT = 112); la barra izquierda solo tiene
  Crear y Sólidos (redondeo y chaflán ya activos, t-fillet / t-chamfer); rejilla +15 % (opacidad 0,1035); la barra izquierda se abre
  a 81 px del borde (NEAR·0,9; ya abierta aguanta hasta 90).
- (v0.20.1) Preferencias › Interfaz: Oclusión ambiental (activar, intensidad prefs.aoInt, radio prefs.aoRad) y "Ajuste del modo
  Forja" (uBase, uRim, uSharp, uBlue, uSpec de envDiagMat, prefs.forjaShader) con "Copiar valores": el usuario los ajusta en vivo y
  pega el JSON para dejarlos como valores de arranque.
- (v0.20.2) La rejilla aparece sola en la vista ortogonal de cada cara (updateDrawGrids): frente/atrás = XY, derecha/izquierda = YZ,
  arriba/abajo = suelo XZ; en vista libre solo el suelo. gridUser = Mostrar › Rejilla. Las tres rejillas comparten estilo y tema.
  Prueba: forja/tgrid.mjs.
- (v0.20.3) Raya negra dentro de los objetos al mover la vista: era el AO. El pase de normales dibujaba las líneas gruesas de Forja
  (Line2 / LineSegments2 son mallas) con el material de normales, y salían como planos sueltos en el origen. src/ao.js sobrescribe
  overrideVisibility para esconder Line2, LineSegments2, sprites y mallas sin colorWrite. Prueba: forja/tstain.mjs (con y sin AO).
- (v0.20.3) Rejilla: opacidad 0,119 (+15 % más) y slider en Preferencias › Snap (prefs.gridOp). Cada celda = 1 dm = 100 × 100 mm;
  el snap a la rejilla es de 100 mm por omisión (opciones 10 / 25 / 50 / 100 mm); la barra de estado dice "CELDA 100 MM".
- (v0.20.3) Curvas: grado 3 por omisión y configurable en la ventana de la herramienta Curva (toolDef.curveDeg, curveSpans; draftCurveData).
  Spans "Auto" = cada punto es un CV, y con menos de grado + 1 puntos se eleva el grado (rebuildCurve, sin cambiar la forma) para tener
  1 span completo; con Spans fijo se reconstruye a ese número. "Nada" (pickNothing) termina la curva en dibujo (≥ 2 puntos) y sale
  de la herramienta. El snap al dibujar (rejilla, punto, curva, superficie) está probado: forja/tcurve.mjs.
- (v0.20.3) Deshacer / rehacer conservan lo activo: captureActive() / reactivate() vuelven a elegir objetos, CVs y la edición de
  pivote por id y clave de CV. Prueba: forja/tundo.mjs.
- (v0.21) CVs siempre a la vista en lo elegido: applyVisibility muestra handles y polígono de los objetos elegidos (curvas y superficies) en
  cualquier modo; la curva recién creada queda elegida; tras Align / Blend / Skin (continueEdgeOp) queda elegido el resultado.
  Clic sobre un CV de un objeto elegido → pickAt devuelve {cv, enterCV}: enterCvMode() pasa a modo CV SIN soltar Mover/Rotar/Escalar
  (setPickMode apaga mouseXform; se restaura), así con Mover activo se arrastran los CVs de curvas y superficies. Prueba: forja/tcv.mjs.
- (v0.21) Align: la ventana (edición y creación) tiene Continuidad, Tensión, Forma (mu, solo desde G2; rel.shape / toolDef.alignShape) e
  Invertir la dirección del borde (rel.rev). Align solo trabaja con bordes de superficies: PENDIENTE alinear curvas (extremo de curva a curva,
  G0–G3 con derivadas en el extremo: S^(k) = (in_s·out_m·λ)^k M^(k) y reparametrización φ'' = s·λ para la forma). Prueba: forja/talign.mjs.
- (v0.21) Líneas juntas → menú junto al puntero (como en los videos de Alias): lineCandidates(e, kinds, tol, filter) mide en pantalla la
  distancia a curvas (o.samples) y a los 4 bordes de cada superficie (surfaceEdgePts, en caché por o.data), ignora lo tapado por otra
  malla; chooseCandidate usa quickPick (teclas 1–9). clickPick (selección en modo Objetos): ≥ 2 objetos a ≤ 8 px → menú; sideChoice
  (herramientas de bordes: Align, Blend, Skin, Extender): ≥ 2 líneas a ≤ 9 px y diferencia < 7 px → menú con el nombre del borde.
  Con el redondeo activo (fil) el pointerup de selección se ignora. Prueba: forja/tmenu.mjs. El snap deslizante (Ctrl+Alt) ya recorre
  las líneas de parche, curvas y bordes: forja/tslide.mjs.
- (v0.22) Align ampliado. Curvas: la herramienta Align usa pick 'both' (curva o borde, con el menú de líneas juntas) y una curva libre se
  alinea por su extremo más cercano al clic (curveEndNearRay) a otra curva (extremo) o al borde de una superficie (r.mT = posición 0..1,
  deslizable). Es la misma relación type 'align' con r.curve = true, r.sEnd, r.mEnd | r.mEdge + r.mT (history.js alignCurve, curveEndDerivs,
  edgeCrossDerivs con base B-spline, masterDerivs, prepareCurve, curveNaturalLambda, diagnoseCurve); S^(k) = (-λ)^k M^(k) y forma mu como en
  superficies; r.rev = continuar hacia el otro lado. Flechas azul/naranja en los CVs 1 y 2 de la curva. Superficie: "Alcance a lo largo del
  borde" (r.modRange, r0, r1, soft: pesos por columna, rangeWeights; fuera del rango se vuelve a r.orig = forma original de las 4 filas) y
  "Tensión distinta al final" (r.varT, r.tensionEnd; alignRows acepta lambda/mu como función de la columna). Una superficie no se alinea a una
  curva (avisa). Pruebas: forja/talign2.mjs (matemática y ventana), talign3.mjs (clics reales), ttools.mjs ya elige en el menú.
- (v0.22.1) Del video 7 de Alias (Align de curva): flechas de G1 (azul, tangente), G2 (naranja, curvatura) y G3 (violeta, r.shape3 = término
  nu·M' en la 3.ª derivada) en los CVs 1–3 de curvas y superficies; flechas mucho más finas y pequeñas (escala 0,04·distancia, eje 0,011).
  "Mezcla (Blending)": r.extra filas de CVs extra y r.blendF (factor); las filas detrás de la continuidad siguen el desplazamiento de la
  última con caída lineal, siempre desde r.orig (forma original, 10 filas). Probado con Node (extra / factor) y talign2.mjs.
- PENDIENTE (en este orden): sólidos de Parasolid (STEP como B-rep para redondear y cortar sólidos importados) y AO también en Visu.

## Siguiente paso

GitHub Pages ya está activo: https://eposboca9.github.io/forja-studio/

1. v0.6: sólidos estilo Plasticity con replicad/opencascade.js (WASM): caja/cilindro, extruir, fillet, chaflán, booleanas.
   Ojo: el Artifact de Claude bloquea fetch de .wasm; esto solo funcionará en GitHub Pages.
2. HDRI intercambiables (estudio, calle, desierto) y render con trazado de rayos (three-gpu-pathtracer).
3. Superficie a partir de curvas (loft / barrido) usando las curvas dibujadas.
4. Editor de atajos (esperando la lista de atajos de Alias del usuario).
5. Integrar OpenCASCADE (opencascade.js, WebAssembly) para sólidos, booleanas y redondeos.
6. Guardar y abrir proyectos (archivo .json) y exportar a STEP/OBJ.
