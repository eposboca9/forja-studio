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
- `docs/alias-sdk.md`: lo que dicen los .h del SDK de Alias (AlBlendCurve, AlBlendPoint, AlCurveNode, AlDagNode) y qué se adoptó.
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

- Puck (antes Tab, hoy Z; como el de Alias, en limpio): anillo interior crear/superficies, exterior elegir/transformar/mostrar. Mantener y soltar,
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
- (v0.22.2) Rejilla: GridHelper multiplica el color del material por el de sus vértices (gris medio), por eso en oscuro casi no se veía.
  THEME_3D.dark.grid = blanco (antes gris); applyGridOp(): opacidad = prefs.gridOp × 1,15 en oscuro y × 1,05 en claro. Celda = 1 dm = 100 mm.
- (v0.22.3) Del video 8: moveSnap(pt, modos, ex, p0) = snap al mover CVs/objetos (con el gizmo y con mover con botones): punto, curva,
  superficie (botón o Shift; no cuenta la superficie que se mueve) y rejilla (punto de la rejilla del plano visible a la altura del CV).
  Con snap activo el CV cae en el punto exacto (ya no solo la componente del eje del botón). "Nada" tras dibujar una curva la deja elegida
  con sus CVs. Align: clic en la cara de una superficie = borde VISIBLE más cercano en pantalla (surfaceEdgeAt usa lineCandidates con la
  superficie impactada); en modo Malla (alambre) se pueden elegir las líneas de atrás pero ganan las más cercanas a la cámara
  (lineCandidates byDepth; el menú solo sale si están a profundidad parecida). Align curva→curva: "Punto de unión en la maestra"
  (r.mT 0..1, curveDerivsAt con derivadas en cualquier punto). Rejilla: opacidad × 1,32 en oscuro y × 1,21 en claro. Prueba: forja/talign4.mjs.
  Mover con botones: el CV agarrado (el más cercano al cursor, anchorOff) es el que cae en el snap, no el centro de todo lo elegido.
  OJO: forja/tslide.mjs esperaba el snap limitado al eje del botón (altura constante) y ahora falla en 2 comprobaciones; con el cambio el CV
  cae en el punto exacto de la línea (recorre una línea de parche vertical). Actualizar esa prueba si hace falta. Pruebas nuevas: talign4/5/6/7.mjs.
- (v0.23) Align según la explicación detallada del usuario (Alias): (1) editar a mano CVs de lo que sale de un Align rompe el historial con
  aviso (historyBlockers ya no exceptúa al esclavo); (2) "Control explícito (grado y spans)" cruzando el borde (r.explicit, xDeg, xSpans;
  prepareSlave / prepareCurve con ex); (3) letras P / T / C en la costura (alignLetters; verde / rojo; C = '–' si no se mide); (4) flecha rosa
  de inversión (kind 'f', handle con click) en curvas y superficies; (5) "Tipo de alineación" Natural / Normal / Vista / Vector
  (r.atype, r.avec, r.axis): Natural = exacto por CVs; los demás usan el camino libre (proyección del punto del esclavo sobre la maestra,
  projectParam). (6) Maestras libres: curva sobre superficie, borde de recorte (curva con data.cos) e isoparamétrica (r.mIso {dir, t};
  las isoLines llevan .iso). masterField(r) -> FF.alignField(side, flow) da punto y derivadas cruzadas (frames de freeform.js); history.js
  alignRows(..., ext) acepta objetivos por columna; freeTargets resuelve por interpolación en Greville (el esclavo sube a >= 12 CVs a lo
  largo, prepareSlaveFree); freeDiagnose mide hueco y ángulo (curvatura no se mide en maestras libres). Para curvas esclavas la maestra libre
  usa masterDerivs(..., field, puntoInterior): la orientación se toma de un punto 10 % dentro de la curva (el extremo ya coincide con la maestra).
  Elegir maestra: en el 2.º clic 'all' = también isoparamétricas (lineCandidates kinds 'all', menú con el nombre).
  NO hecho: esclavo = curva sobre superficie o isoparamétrica (no está claro qué se deforma; se avisa y se pide curva libre o borde).
  Pruebas: forja/talign8.mjs (letras, flecha, explícito), talign9.mjs (CoS, iso, tipos), tfree.mjs (Node).
- (Plan, sin código) Pedido del usuario: cambiar el solver del viewport a un rasterizador "Vulkan" (Forward+ o Deferred) con PBR GGX, IBL
  split-sum, SSAO, SSR, ACES y antialiasing, sin tocar cámara, inputs ni rendimiento. Vulkan no corre en una página web ni en el Artifact:
  la alternativa del navegador es WebGPU (WGSL; el mismo código serviría luego en escritorio con wgpu, que usa Vulkan por debajo).
  Propuesta pendiente de aprobación: interfaz RenderBackend (WebGL actual movido tal cual + backend nuevo), snapshot de escena de solo lectura,
  Forward con prepass de profundidad/normales (no deferred completo), fases F0 spike de viabilidad ... F8 teselado GPU. Puntos de enganche
  en main.js: renderer (l. 77), renderPane (5044), renderCarousel (2131), renderViewCube (4946), renderForgePane (5455), adaptInk (5104,
  lee píxeles), ao.js (GTAO sobre el lienzo), miniaturas con WebGLRenderer temporales (2273, 3411).
- (v0.24, base del motor nuevo) APROBADO por el usuario: camino A = WebGPU. Hecho: src/render/ (backend.js = interfaz RenderBackend y createBackend;
  webgl-backend.js = el motor clásico sin cambios; webgpu-probe.js = prueba de viabilidad F0). main.js dibuja los paneles con backend.drawPane /
  drawOverlay y redimensiona con backend.resize (window.__forja.backend). Preferencias › Motor de render: selector (WebGPU aún desactivado) y
  botón "Probar WebGPU" (render con MSAA 4x en rgba16float + depth32float + cómputo + lectura). En este entorno WebGPU SÍ funciona con Chromium
  headless: args '--enable-unsafe-webgpu --enable-features=Vulkan,WebGPU --use-webgpu-adapter=swiftshader' y la página en http://localhost/
  (navigator.gpu exige contexto seguro; con host "local" no existe). Adaptador por software: sirve para comprobar, no para medir velocidad.
  El usuario pidió NO programar iluminación ni shaders todavía: primero aprobar docs/render-webgpu.md (análisis de 6 imágenes de referencia:
  casco rojo Plasticity, robot amarillo, palanca crema/negro/cobre, figura en arcilla gris; pipeline forward con prepass, GTAO, atrapasombra,
  PBR con barniz, aristas de 1 px, ACES/AgX; sin SSR). Pruebas: forja/tprobe_b.mjs.
- (v0.24.1) Respuestas del usuario al plan WebGPU: (1) probar WebGPU (el resultado de su laptop y del Artifact está pendiente de que lo pegue);
  (2) look de Visu por defecto = azul metálico con base negra profunda, glossy → material 'candy' (color #0a1d6e, metalness 1, roughness 0.2,
  clearcoat 1) y matKey inicial 'candy'; con el entorno gris claro actual se ve azul marino brillante: el negro profundo llegará con el entorno
  de estudio oscuro con cajas de luz del motor nuevo; (3) mantener el fondo actual (muro de concreto) con sombra de contacto encima;
  (4) entorno: hacen falta AMBOS (estudio procedural editable y carga de archivos .hdr propios); (5) el usuario tiene UN modelo de prueba pero no
  pudo importar su STEP a Forja: pedirle el archivo para diagnosticar (STEP entra como malla vía OpenCascade WASM; en el Artifact el .wasm está
  bloqueado, en GitHub Pages sí funciona).
- (v0.25) STEP con lector propio (exporters.js readSTEP, sin WebAssembly): lee B_SPLINE_SURFACE_WITH_KNOTS (también racionales y entidades
  complejas) y curvas B-spline libres como NURBS reales; las caras con recorte (contorno que no son 4 aristas B-spline, elipses, agujeros) se
  importan como superficie + curvas sobre superficie (cos.edge, trim 'outside' el contorno exterior / 'inside' los agujeros) proyectando las
  aristas (B-spline, elipse, círculo, recta) a (u, v) (stepEdgePoints, projectUV). importFile: primero el lector propio; si hay caras analíticas
  (planos, cilindros: nat.other) usa OpenCascade como malla (jsdelivr; en el Artifact falla y entonces importa solo las NURBS y avisa).
  Probado con el STEP del usuario (fromaforja.stp, 46 superficies, 6 recortes): 42 coinciden con OpenCascade al milímetro; las 4 recortadas
  quedan bien con los recortes. Causa del fallo del usuario: en el Artifact no carga el WebAssembly de OpenCascade. Pruebas: forja/tstep2.mjs
  (Node), tstep4.mjs (en la app). Todavía sin: sólidos con cascarón cerrado (B-rep real), caras analíticas como NURBS, unidades leídas del archivo.
- PENDIENTE (en este orden): sólidos de Parasolid (STEP como B-rep para redondear y cortar sólidos importados) y AO también en Visu.

- (v0.25.1) STEP: superficies CERRADAS (huevo: u=0 y u=1 son la misma línea, polos colapsados) rompían el recorte: projectUV daba 0 o 1 al azar en la costura y el contorno
  exterior salía en zigzag (el cuerpo desaparecía y quedaba una "esfera de bandas"). fixSeams() (exporters.js) encadena cada contorno sin saltos y elige el lado
  de la costura que deja los agujeros dentro del exterior. El modelo del usuario (fromaforja.stp) = 2 mitades espejo (caras 0–22 y 23–45), cada una un cuerpo
  de huevo con una cavidad y el redondeo del borde; juntas dan las dos cavidades de su 2.ª captura. Prueba: scratchpad forja/tface2.mjs, tstep7.mjs;
  captura docs/capturas/v0.25.1-step-huevo.png. Pendiente: la cara 21 y la 44 son la misma superficie en las dos mitades (no duplicadas, espejo).

- (v0.25.2) Cruces de CVs: tamaño CONSTANTE en píxeles (scaleHandles usa la matriz de proyección: sirve en perspectiva y ortogonal, con cualquier zoom; HANDLE_PX = 5,5 px por unidad, cruz ≈ 6,6 px, esfera de elegir 2,2 unidades ≈ 12 px). Prueba: forja/tcvsize.mjs.

- (v0.25.3) Pivotes y manipulador más discretos y de tamaño fijo en píxeles: pxWorld(p, px) (main.js) = unidades de mundo por píxel; marcador de pivote de objeto 20 px, marcador de navegación 24 px, gizmo.setSize(0.5). Cada superficie tiene su pivote; un grupo elegido como un solo objeto tiene el suyo.

- (v0.25.4) Normales del STEP importado: (1) trimGeometry (freeform.js) daba a las caras RECORTADAS el giro de triángulos contrario al de ParametricGeometry, así que
  en Visu las caras recortadas se veían grises/cromadas y las demás azules ("normales distintas por superficie"); ahora cada triángulo se invierte para igualar el giro.
  (2) readSTEP orienta cada cara con same_sense: la normal STEP (hacia fuera) = Su×Sv, y Forja la quiere hacia dentro -> se traspone la malla de CVs (U<->V) y los lazos de recorte.
  Verificado contra las normales de OpenCascade (46/46 coinciden) y con Cebra continua entre caras; curvatura: exterior convexa (rojo), cavidad cóncava (azul). Pruebas: forja/tnorm.mjs, tnm2.mjs.

- (v0.26) Capas como Alias + funciones propias (main.js "Capas: color heredado, estado y simetría" + acciones en renderLayers): cada capa tiene
  mode 'pick' (E, elegible) | 'ref' (R, visible, no se elige ni se edita) | 'inactive' (I, líneas atenuadas); color (color picker en su fila: pasa a las
  isoparamétricas, bordes, curvas y polígono de control de TODO lo que contiene; layerMats(L) cachea LineMaterials por color y copia isoMat.resolution
  — sin eso un cuadro dibuja líneas gigantes y se cuelga); sym {on, plane xz|xy|yz|custom, n} con botón ⇋ (clic enciende/apaga; clic derecho o ▾ = menú
  de plano). La simetría es una instancia espejo en vivo: fantasmas (ghostOf) que comparten geometría y material del original dentro de un Group con
  matriz de reflexión (syncGhosts, se llama en renderPane/renderForgePane); no se pueden elegir (raycast vacío). Los nombres de plano son de CAD con Z arriba
  (XZ = plano central; en Forja = z = 0); 'custom' usa un vector en ejes de Forja. pickable() respeta el estado de la capa. snapshot/restore clonan sym (cloneLayer).
  Pruebas: forja/tlay.mjs (color, simetría, referencia), tlayui.mjs (captura de la ventana). PENDIENTE: Stages (etapas), atenuar también las mallas de capas inactivas,
  incluir el espejo en la exportación.

- (v0.27) WebGPU F2 = backend HÍBRIDO de dos lienzos (src/render/webgpu-backend.js, HybridBackend extiende WebGLBackend; createBackend siempre lo devuelve, arranca
  en modo clásico y backend.enable() lo activa; Preferencias › Motor de render › "Híbrido (WebGPU + WebGL)", prefs.engine). Lienzo de ABAJO (WebGPU, MSAA 4x,
  depth32float, z de OpenGL pasada a [0,1] con ZFIX, uniformes dinámicos de 256 B): superficies marcadas con userData.gpuSurf / gpuColor en COLOR PLANO (sin luces ni
  shaders, a propósito: el usuario pidió no programarlos hasta aprobar el pipeline). Lienzo de ARRIBA (WebGL de siempre, transparente): líneas, CVs, gizmo, cubo, sombra
  del suelo; las superficies pasan a depthOnlyMat (colorWrite false) con setSurfaceMaterial() para que tapen igual. En híbrido se apagan el AO y el fondo de Visu
  (taparía el lienzo de abajo). Interfaz del backend: beginFrame / endFrame / readRow (adaptInk lee filas con backend.readRow; el híbrido compone arriba SOBRE abajo
  con una lectura asíncrona del lienzo de WebGPU). Hay que conservar this.adapter (si no, Chromium pierde el dispositivo).
  LÍMITE DE ESTE ENTORNO: Chromium sin cabeza (SwiftShader) pierde el dispositivo en cuanto un lienzo WebGPU presenta ("A valid external Instance reference no longer
  exists"), incluso con una página mínima (forja/tcanvas.mjs); por eso las pruebas usan enable({ offscreen: true }) (dibuja en una textura, la lee y la pinta en un
  lienzo 2D). La presentación real SOLO está sin probar en la laptop del usuario. Pruebas: forja/thy2.mjs (capturas hy-gpuonly.png, hy-hybrid.png).
  Siguientes fases: F3a entorno de estudio procedural + prefiltro GGX, F3b PBR + barniz (ver docs/render-webgpu.md); PENDIENTE después: Stages.

- (v0.28) WebGPU F3: el híbrido ahora SOLO toma el módulo VISU (kind 'render'; Forja/Cebra/Curvatura/IA/Forge siguen enteros en WebGL, así el lienzo de abajo
  queda vacío y se borra con _clear()). Respuesta del usuario a la F2: en su laptop (Intel Iris) se vio el vaso en gris plano pero SIN líneas -> sospecha de
  orden de capas: ahora z-index explícito (WebGPU 0, WebGL 1). Superficies de VISU con PBR en WGSL (webgpu-backend.js): normal de dos caras hacia el observador, GGX por
  entorno prefiltrado (split-sum con BRDF analítica de Karis), difuso = último mip, barniz (clearcoat, F0 0.04, rugosidad propia) y ACES con la exposición del renderer;
  material tomado de materials[o.mat] (userData.gpuColor / gpuPbr = metal, rugosidad, barniz, rugosidad del barniz; ver setSurfaceMaterial). Entorno: src/render/webgpu-env.js =
  estudio oscuro procedural con 5 cajas de luz (arriba, laterales izq./der., contraluz, relleno), cubo rgba16float 256 px × 7 mips generado con cómputo (gen, down, filtro GGX con
  160 muestras). Falta: cargar .hdr propio, editar las cajas, rotación/intensidad en la interfaz (backend.envIntensity existe), AO y sombra de contacto propias, aristas de 1 px,
  Forge/IA en WebGPU. Resultado en prueba (offscreen): azul candy con base casi negra y reflejos de las cajas, sombra del suelo de WebGL encima del muro. Prueba: forja/thy3.mjs.

- (v0.29) WebGPU F4: (1) los modos FORJA y ARCILLA del módulo MODELADO también se dibujan en el motor nuevo (GPU_DIAG en main.js: forja = grafito azulado
  0x1d2028 rugosidad .36 con barniz .5; arcilla = gris 0x4d4e53 mate); Cebra, Curvatura, Malla, Showroom, Difuso y Shade-Sky siguen en WebGL. El panel decide por
  superficie con setSurfaceMaterial (gpuSurf); _gpuPane salta los paneles sin superficies de WebGPU (el lienzo de abajo se borra con _clear). (2) Oclusión ambiental en el
  híbrido: ao.js tiene mezcla "por encima" (negro con alfa = 1 - AO; también oscurece el muro cerca del objeto = sombra de contacto) y overrideVisibility conserva las
  superficies de solo profundidad (userData.gpuSurf); activa en FORJA/ARCILLA y en Visu (prefs.aoVisu). (3) Entorno: estudio retocado (cajas más suaves y menos
  intensas para que ACES no queme los reflejos a blanco plano), giro (misc.w) e intensidad en Preferencias › Motor de render, y carga de .hdr propio (RGBELoader de three,
  media precisión; equirectangular -> cubo con cómputo GEN_EQ, mismo filtro GGX); backend.setEnv(hdr | null). Pruebas: forja/tf4.mjs (capturas f4-*.png).
  PENDIENTE del plan: aristas de 1 px, Forge e IA en WebGPU, cajas de luz editables, modos Cebra/Curvatura en WGSL, sombra de contacto propia.

- (v0.29.1) FALLO: con el motor híbrido activo no se podía usar ninguna pestaña del menú. Causa: v0.28 puso z-index:1 al lienzo de WebGL; eso lo sube sobre la cabecera
  (la cabecera es position:relative con z-index auto, y .view no crea capa propia). Ahora SIN z-index (el orden lo da el DOM: WebGPU primero, WebGL después). Salida de
  emergencia: abrir la página con ?motor=clasico (vuelve al motor clásico y lo guarda). Prueba: forja/tz.mjs (elementFromPoint sobre el menú en clásico e híbrido).

- (v0.30) Aristas finas de cada cara en ARCILLA (faceEdgeMat, bordes de parche p.bound; prefs.edges) y etiqueta "· MOTOR WEBGPU" en la barra de estado cuando el híbrido está activo
  (para que el usuario sepa si lo está usando; vi-proj). Probado con el modelo del usuario en pintura roja (Visu) y Forja/Arcilla: forja/tegg.mjs, tegg2.mjs. El usuario pidió seguir
  hasta igualar las referencias (Plasticity/Alias): siguen pendientes cajas de luz editables, pintura con flakes, Forge/IA en WebGPU y probar en su laptop (aún no vio el híbrido bien).

- (v0.31) Capturas del usuario con el híbrido activo (su laptop, Intel Iris): funciona (Forja, Arcilla, Visu candy; sliders de entorno a 2,10 / 195°). Problema visto: ARCILLA salía casi
  blanca y plana (difuso = último mip, luz uniforme). Ahora el difuso toma el entorno poco desenfocado (mip·0,62 ×0,8) para que la luz tenga dirección (lado iluminado y lado en sombra, como
  la figura de arcilla de la referencia 6) y las cajas del estudio son menos intensas y más neutras (arriba 3,6; laterales 3,4 / frío; contraluz 6). Siguiente: pintura con flakes, cajas editables.

- (v0.32) Iluminación en espacio MUNDO: en los modos clásicos (envDiagMat: Forja, Arcilla, Showroom...) "Luz ligada a la cámara" venía ENCENDIDA por defecto (como Alias), por eso los brillos
  se quedaban pegados a la pantalla como un MatCap; ahora uLink = 0 y la casilla viene apagada (Visualización, sigue disponible). El motor híbrido (WGSL) ya usaba normales y entorno en
  mundo (con giro opcional del entorno). Sombra rara al girar: la luz de la sombra (key) estaba en (4, 9, 3) y la sombra cambiaba de lado según la vista; ahora casi vertical (0,9, 12, 0,7)
  = sombra debajo del objeto, igual desde cualquier ángulo; y el suelo ya no entra en el pase de AO (ground.userData.noAO) porque ensuciaba la sombra con ruido. Pruebas: forja/tworld.mjs, tshadow.mjs.

- (v0.32.1) El usuario dijo que el brillo seguía sin recorrer la pieza: con la luz ya en mundo, la pieza (vaso de revolución) casi no cambiaba al girar porque el sombreado era muy suave
  (arcilla clásica 0,55 + 1,5·wrap²; híbrido solo entorno desenfocado). Ahora: arcilla/forja clásicas usan wrap³ (0,2 + 2,6·wrap³: lado iluminado y lado en sombra marcados) y un brillo ancho
  extra; el híbrido añade una luz principal direccional FIJA EN EL MUNDO (ld = (-0,5, 0,78, 0,38), gira con el "giro del entorno") con difuso + GGX + barniz. Verificado con 4 acimuts
  (0/60/120/180) en clásico e híbrido: forja/trot.mjs (montajes mont-classic.png, mont-gpu.png).

- (v0.33) Videos del usuario (Video Project 9 = objetivo: Plasticity/Alias con estudio de HORIZONTE — cielo claro, franja luminosa en el horizonte, suelo oscuro — cuyos brillos barren la
  pieza al orbitar; Video Project 10 = Arcilla con la luz pegada a la cámara). Pedido: Arcilla industrial y mate, evaluada en espacio mundo, rugosidad 0,7-0,85, especular baja y AO profundo.
  Hecho: (1) Arcilla clásica (uMode 4) reescrita: hemisferio mundo (cielo 0,8 / suelo 0,045) + luz principal fija + reflejo de cielo muy ancho, sin puntos de luz; (2) Arcilla en el híbrido
  usa rugosidad 0,82, sin barniz y un SEGUNDO entorno "Horizonte" (webgpu-env.js buildStudioEnv(device, hdr, 'horizon'); userData.gpuEnv = 'horizon'; con un .hdr propio todos usan el .hdr);
  (3) AO más profundo: muestras 14 y intensidad ×1,55 en Arcilla (main.js, antes de ao.apply); (4) normal de reserva con derivadas de pantalla cuando la del vértice es indefinida (polos).
  Prueba: forja/trot.mjs, tpole.mjs (montajes mont-classic.png / mont-gpu.png). El resto de modos clásicos (Showroom...) no cambió.

- (v0.34) DECISIÓN del usuario: el motor clásico "va muy bien, los shaders no se tocan"; el problema eran Arcilla, Shade-Sky y Difuso en el HÍBRIDO. Ahora el híbrido SOLO toma VISU
  (GPU_MODELING = false en main.js: los modos de modelado usan siempre los shaders clásicos; el código de Forja/Arcilla en WGSL queda desactivado, no borrado).
  Panel de ENTORNOS en el panel de Visu (Plasticity "All environments"): miniaturas de esfera espejo (envlib.js thumb) de los 4 entornos de siempre + los .hdr que cargue el usuario
  (botón "+", RGBELoader media precisión; solo en memoria, no se guardan), OPCIONES con Rotación (°) e Intensidad (numéricas; setEnvOpts) y interruptores Mostrar aristas / curvas / caras
  (prefs.showEdges [defecto apagado: aristas de cada cara en Visu y en cualquier modo], showCurves, showFaces; applyVisibility y el bucle de renderPane). selectEnv(id): híbrido
  = backend.setEnv(mapa | null=estudio procedural); clásico = envKey + envTexture(k, rot) (PMREM; custom desde equirectangular; el giro se rehace con un retardo de 140 ms porque three 0.160 no
  tiene environmentRotation). Intensidad: envMapIntensity de los materiales + backend.envIntensity. envlib.js: mapas equirectangulares procedurales (estudio, exterior, atardecer, nublado),
  rollMap (giro), thumb. Las preferencias › Motor de render comparten las mismas funciones. Pruebas: forja/tenvp.mjs, tenvp2.mjs (capturas envp-*.png).

- (v0.35) Capas ANCLADAS a la izquierda por defecto (aparecen junto con las herramientas al acercar el ratón al borde izquierdo y siguen mientras el ratón esté encima) (layersWin.docked, prefs.layersWin {open, docked, v:2}; clase .float-win.docked: left 72px, top 96px, ancho 232 px, junto a las herramientas;
  botón ◧/◫ en su cabecera la suelta o la ancla; anclada no se arrastra). Migración: si prefs.layersWin.v !== 2 se reabre y se ancla.
  Análisis de shading (forja/tshade.mjs: sin errores de consola). OJO: los cambios de shader hechos en esa pasada (pow/smoothstep/normal de reserva) se REVIRTIERON (v0.35.1) porque el usuario notó que Forja dejó de brillar igual: NO tocar shaders aprobados aunque sean 'riesgos latentes'; solo avisar. (forja/tshade.mjs: modos 1–8 + Visu/IA/Forge sin errores de consola). Riesgos latentes corregidos SIN cambiar el aspecto: pow() con base negativa (indefinido en GLSL/WGSL:
  franja del horizonte en showroom y en webgpu-env, fresnel con 1-dot > 1 por redondeo) -> base acotada o producto; smoothstep con bordes invertidos (indefinido) -> 1 - smoothstep(e1,e0,x);
  Cebra sin normal de reserva en polos -> añadida; pase de normales del AO con normalize(0) -> protegido.

- (v0.35.2) Material importado de VRED: `.osb` = OpenSG binario (cabecera 16 bytes + zlib raw, wbits -15; campos 'nombre\0\0\0\0 tipo\0 tamaño(u32 BE) datos' en big-endian). E_Carpaint_AEROLITHEMETALLIC.osb = UMetallicPaintMaterial
  (base lineal 0.019/0.066/0.070, escamas 0.243/0.546/0.600, rugosidad 0.26, barniz rugosidad 0.08, flakeSize 7.7, densidad 0.94). Entró como `aerolite` en `materials` (Visu, clásico e híbrido) SIN escamas
  (aproximación: metal 0.7 + barniz). Pendiente: escamas procedurales (flakes) y un lector .osb general.

- (Investigación, sin código en la app) Archivos de entorno de Alias (Abstract, Diffuse, Evaluation, Hall, Showroom; 'StudioPacketFile', Autodesk Automotive 2010): cabecera de texto + bloques de
  4106 bytes (00 00 10 00 | ff ff ef ff | 2 bytes | 4096 de datos; el último más corto) cuya concatenación (sin las cabeceras) es UN flujo Unix-compress (.Z, magic 1f 9d 90) con una variante:
  primer código libre 258 (256 y 257 reservados), ancho 9 -> 16 bits, y al subir de ancho se alinea a grupos de 8 códigos. Decodificador de prueba: scratchpad/lzw3.py. Contiene una escena binaria de Alias:
  tabla de clases 'aw.*' y luego un 'Cube' con texturas .pix (p. ej. AST20C0.pix de 512x512, RLE) y luces: el entorno es la geometría + texturas, no un HDRI. Falta parsear las texturas (PIX) y la
  malla para reconstruir un mapa de entorno; alternativa más simple: pedir al usuario HDR/EXR exportados o capturas de esfera espejo.

- (v0.36) Barra izquierda = Capas ARRIBA y herramientas DEBAJO (las herramientas se bajan lo que mida Capas: --ly-h, layersWin.measure con ResizeObserver). Botón ●/○ en la cabecera de Capas (y Ventanas ›
  Anclar barra izquierda) = prefs.leftPin: anclada = clase .app.left-pinned y no se oculta; sin anclar sale al acercar el ratón al borde izquierdo. Ya no hay ventana flotante (se quitó el arrastre).
- (v0.36) ENTORNOS DE ALIAS: Showroom, Difuso (Diffuse), Evaluación y Abstracto, sacados de los archivos del usuario (el de Hall NO, por decisión suya). Extracción (scratchpad extract.py, tifflzw.py,
  lzw3.py): el flujo comprimido contiene registros [0x32 00 00 00 00 00 00 00 | u32 | ruta\0 | u32 LE longitud | datos] en trozos de 16384 B que se juntan por nombre de archivo; los TIFF son LZW de 341x341
  RGBA (cada tira se recorta a su tamaño: una tira sale 3 bytes larga); Abstract usa 3 texturas .pix (RLE BGR, 512x512): lados = AST20C0, arriba = AST20C1 (blanca), abajo = AST20C2 (asignación SUPUESTA).
  Cubo -> equirectangular 512x256 (convención de envlib: y arriba, izquierda -> frente(-Z) -> derecha -> atrás por azimut creciente) guardado como PNG base64 en src/env-alias.js (ALIAS_ENVS);
  envlib.decodePngEnv pasa sRGB -> lineal y estira las luces hasta x4 (el PNG de 8 bits las recorta); main.js loadAliasEnvs() los añade a envLib.items (aparecen como miniaturas en el panel de Visu).
- (v0.36) Freeform Blend revisado con la ficha del usuario: ya existían Lado 1/2 G0–G3 independientes, Forma, Corona, flujo (inicio/fin/interior) y sentido detectado solo. Añadido: flecha de giro (Flip,
  r.flip, kind 'f') en el lado 2 del blend (freeform.js orient invierte el sentido; con flip no se usa el blend exacto). PENDIENTE de la ficha: flujo "Perpendicular al lado 1" y "por vector";
  cebra/peines de curvatura en vivo sobre las secciones al arrastrar Corona/Forma (hoy solo se ven con el diagnóstico normal).

- (v0.37.2) El usuario NO quería revertir la v0.37 (la v0.37.1 la deshizo entera por error y se volvió a poner): solo quería recuperar el aspecto de FORJA de su video
  (negro brillante con reflejos suaves de las cajas de luz). Ese aspecto es Forja dibujado por el motor HÍBRIDO (GPU_DIAG.forja: 0x1d2028, rugosidad .36, barniz .5), que se
  apagó en la v0.34 junto con los demás modos (GPU_MODELING = false). Ahora gpuDiag() devuelve GPU_DIAG.forja cuando el híbrido está activo y el Map Type es Forja; Arcilla,
  Difuso, Shade-Sky, Showroom, Sky Shade, Abstracto, Cebra y Curvatura siguen en WebGL. Con el motor clásico Forja se ve con el shader clásico (uMode 5), sin cambios.
  Comparación: con la configuración por defecto Forja da 0 píxeles distintos entre v0.36 y v0.37 (forja/tcmp.mjs); montaje con el video: forja/fj-sheet2.png (tfj2.mjs).
  LECCIÓN: ante "regresa X", cambiar SOLO X; no revertir versiones enteras.

- (v0.38) Menús radiales (Puck/Tab, Espacio, Ctrl+Shift+botón: todos son makeRadial) con NEUMORFISMO (Soft UI), pedido del usuario con referencia "SHADOW" (botones extruidos
  del mismo material). Reemplaza las esferas 3D de la v0.10.1 (el usuario cambió de opinión). CSS en index.html ("Menú radial ... NEUMORFISMO"): variables --nm, --nm-hi, --nm-lo,
  --nm-ink, --nm-text por tema; botones circulares con sombra clara arriba-izquierda y oscura abajo-derecha; opción marcada = hundida (sombras inset) con icono azul #2f7bff.
  Sin fondo: .radial-veil (div al final de #view, backdrop-filter blur 9px) desenfoca SOLO el visor 3D (cabecera y paneles no); syncRadialVeil() lo enciende si algún menú está abierto.
  Anillo circular (RADIAL_TILT = 1), sin elipses ni línea guía, sin escalado por profundidad (base 1, aumento al pasar 1,14). Apertura en flor: show() quita .bloom, fuerza un reflow y la
  vuelve a poner; el centro escala .55→1 y sus sombras pasan de planas a extruidas (170 ms); los pétalos brotan desde el centro (--bx/--by = -x/-y, escala 0→1, opacidad, 200 ms,
  retraso n·8 ms); los del submenú brotan desde su opción (retraso j·10 ms, separación 62 px). .settled (280 ms) acorta las transiciones del aumento. El centro ya no está en INK_SEL.
  Prueba: forja/tnm2_dark.mjs / tnm2_light.mjs (montaje nm-sheet.png). En SwiftShader los cuadros tardan > 2 s: usar keyboard.down('Tab') real y esperar.

- (v0.39) PUCK DE MODELADO NUEVO (Tab en Modelado; src/puck3.js, createPuck3): 3 categorías Curvas · Superficies · Sólidos (PUCK3_CATS en main.js), cada una con hasta 3 anillos
  de herramientas (PUCK3_LIB = biblioteca; prefs.puck3.rings[cat] = anillos editados). Al abrir: las 3 en fila, cada una con tantas ONDAS comprimidas como anillos plegados.
  Clic en el círculo = suelta la 1.ª onda (gota .p3-drop que viaja hacia fuera, 240 ms) y se levanta el anillo 1; clic en la zona de ondas X (.p3-x, placa llena del material)
  = siguiente onda; sin ondas que soltar, X pliega la última; clic en el círculo abierto = plegar todo (vuelve la fila). Con una categoría abierta las otras dos quedan pequeñas
  arriba a los lados (clic = cambiar). Persistencia: prefs.puck3 {active, open{cat:n}, rings, inst}. Marking menu: mantener Tab, pasar por una herramienta y soltar (pickAt por
  radio y ángulo). Herramientas compartidas (shared: elegir, mover, rotar, escalar, duplicar, simetría, ocultar, borrar, encuadrar) = instancias por contexto (runPuck3): filtran la
  selección al tipo de la categoría (CTX_KIND: curve / surface / mesh) y guardan sus opciones por contexto (params -> prefs.puck3.inst['ctx:id'], p. ej. mirrorPlane).
  Color: el material (--p3 / --nm) es el color medio del muro en ese punto (concrete.js wallColorAt, lee la imagen del muro); volumen solo con sombras (--nm-hi / --nm-lo).
  Desenfoque LOCAL (.p3-veil elipse con máscara suave; los otros menús: .radial-veil circular en syncRadialVeil), el resto del visor nítido. Nombre de la herramienta en una
  pastilla neumórfica bajo el puck. Los demás menús radiales (Espacio, Ctrl+Shift, Puck de Visu/IA/Forge) siguen con makeRadial (un círculo central) con el mismo estilo.
  Editor: Preferencias › Puck › "Modelado · Curvas/Superficies/Sólidos" (renderPuck3Editor: subir, bajar, ⇥ pasar al anillo siguiente, quitar, añadir; máx. 10 por anillo).
  Sólidos = mallas (kind 'mesh') para las compartidas; Booleanas está como "próximamente". Prueba: forja/tp3_dark.mjs / tp3_light.mjs (montaje p3-sheet.png). En SwiftShader usar
  keyboard.down('Tab') (una pulsación corta tarda > 400 ms y el Puck se cierra en vez de quedar fijo).

- (v0.39.1) CACHÉ: el usuario seguía viendo el Puck anterior en el Artifact porque la página cargaba siempre ./src/main.js con el mismo nombre (el navegador usaba la copia
  guardada). Ahora index.html carga ./src/main.js?v=<versión> y main.js importa concrete.js / puck3.js con ?v=; FORJA_VERSION en main.js (Ayuda › Acerca de muestra la versión).
  REGLA: en cada publicación subir la versión en index.html (script de main.js), en FORJA_VERSION y en los imports de los .js que cambiaron. Probado en el visor real que ?v= funciona.

- (v0.39.2) El usuario (v0.39.1 cargada, motor WebGPU) dice que con Tab le sale el menú "Visualización" (DISPLAY_MM), que en el código solo abren Espacio y Ctrl+Shift+clic der.
  En las pruebas (clásico, híbrido y visor real) Tab abre el Puck nuevo. Cambios: bindKey reconoce la tecla por code, key o keyCode (isKey, KEY_IDS) y, de diagnóstico, un toast
  dice qué tecla llegó y qué menú se abrió (también para Ctrl+Shift+clic). QUITAR ese toast cuando se aclare el caso.

- (v0.39.3) Pedido del usuario: el Puck pasa de Tab a la tecla Z (en su visor Tab no llegaba bien). isKey ignora Z con Ctrl/Alt/Cmd, así Ctrl+Z sigue
  deshaciendo; Tab ya no abre nada. Se quitaron los toasts de diagnóstico de la v0.39.2. Menú Ventanas, Preferencias › Puck y la tabla de atajos dicen Z.
  Prueba: forja/tz2.mjs (Tab no abre, Z abre puck3, Ctrl+Z no abre menú).

- (v0.40) Controles como Alias (hoja "Mouse and Keyboard Reminders" del usuario):
  (1) Puck VIEJO eliminado: Z abre puck3 en todos los módulos (getPuck = () => puck3; desde Visu/IA/Forge las herramientas de modelado pasan antes a Modelado,
  runPuck3). Se quitaron PUCK_CMDS (queda VISU_CMDS solo para el menú de Espacio en Visu), PUCK_DEFAULT, CMD_MODS, puckIds y el editor viejo (Preferencias › Puck
  solo edita Curvas/Superficies/Sólidos). Tab: preventDefault fuera de cuadros de texto (no abre nada ni salta el foco).
  (2) Marking menus Ctrl+Shift + izq/medio/der (en TODOS los módulos) = PICK_MM / XFORM_MM / DISPLAY_MM con las opciones y posiciones de Alias: 8 en el anillo
  (desde arriba en el sentido del reloj) + items.extras en columna de pastillas debajo (makeRadial: extras, null = hueco; CSS .puck-item.extra). label en español,
  alias = nombre de Alias (sale en el centro). Sin equivalente aún (soon): Blend Point, Construction, Locator, Delete Locators, Plane Editor, Shelf. Nuevos:
  filtros Pick mesh y cos (PICK_FILTERS), Query Edit History (queryHistory: abre la ventana de la relación del objeto), NonProportional Scale (sclNP, scaleNP),
  Shade (Quality) = setShadeReal(true), Shade (Fast) = Map Type, Palette = anclar barra izquierda. Capturas docs/capturas/v0.40-menu-*.png.
  (3) Z ARRIBA como Alias, SOLO en lo que el usuario ve y usa (por dentro sigue Y arriba porque los shaders aprobados, el muro, entornos y la escena cuentan con eso):
  Alias (X, Y, Z) = Forja (x, -z, y), el mismo cambio que los exportadores CAD. AXES = ejes de Alias en coordenadas internas (botones izq X · medio Y · der Z al
  mover/rotar/escalar no prop., nudge, vector de Align por omisión = Z); toAlias() en las coordenadas del CV; gizmo con verde/azul intercambiados (vertical = azul Z);
  nombres de planos (suelo XY, frente XZ, lado YZ), Simetría y Extruir con nombres Z arriba. Las vistas Top/Front/Right ya coincidían (frente = cámara en -Y de Alias).
  (4) Selección "alternativa sugerida" de Alias por omisión (sel-buttons 'add', prefs.selButtons): izq añade, medio elige solo eso (y en vacío suelta todo),
  der quita. Navegación Shift+Alt y snap Ctrl/Alt/Ctrl+Alt ya eran así. Escalar con botones = proporcional (Scale) salvo NonProportional Scale.
  Prueba: scratchpad t40/t.cjs y t2.cjs (servidor python en :8765 y three desde scratchpad/npm; los scripts viejos de forja/ ya no existen).
- (v0.40.1) El usuario insiste en que Tab sigue desplegando un menú (no se reprodujo aquí: en las pruebas Tab no abre nada ni mueve el foco). Endurecido:
  Tab bloqueado en keydown y keyup (captura + stopImmediatePropagation) salvo en cuadros de texto y diálogos; focusin con :focus-visible (foco por teclado, p. ej. Tab
  desde fuera del iframe del Artifact) quita el foco del botón; se quitó :focus-within de la barra izquierda (se mostraba con el foco dentro). Si sigue: pedir captura.
- (v0.40.2) Captura del usuario: con Tab sale el menú VISUALIZACIÓN (disp = DISPLAY_MM), que solo abren Espacio y Ctrl+Shift+der. Única vía por tecla = bindKey('Space'),
  que aceptaba code, key O keyCode. Ahora isKey: Tab (key/code/keyCode/which 9) nunca cuenta, solo eventos isTrusted, y Espacio exige code 'Space' Y key ' '.
  menuLog + Ayuda › "Qué abrió el último menú" (toast con tecla key/code/keyCode o botón) para cazar el caso si sigue. Prueba t40/t4.cjs: Tab y Shift+Tab 0 menús.
- (v0.40.3) El usuario seguía viendo el menú Visualización al pulsar Tab. Se quitó la ÚNICA tecla que lo abría (Espacio, bindKey('Space')): ahora NINGUNA tecla abre
  menús salvo la Z (Puck). Visualización solo con Ctrl+Shift+clic derecho, como en Alias. Los menús son HTML encima del visor: no dependen del motor (clásico o híbrido);
  probado con los dos (t40/t5.cjs: Tab, Shift+Tab y Espacio = 0 menús; Z = Puck).
- (v0.41) HUD "Transform info" (main.js, bloque "HUD de información"; #hud, CSS .hud* neumórfico con --nm): sale al elegir algo y se va al soltar la selección
  (clic en el vacío con izq o medio = soltar todo). hudTargets(): modos 'cv' (CVs elegidos, centro), 'pivot' (editar pivote: solo mueve el pivote), 'single' (info:
  grado, tramos, CVs, caja en mm; pivote), 'multi' (lista de cada elemento con su info y pivote; rotar/escalar cada uno sobre su pivote) y 'group' (todos los de un
  grupo de Ctrl+G = Objeto: una sola lectura y un pivote maestro hud.gp = centro de la caja). Filas Traslación (pivote en mm, ejes de Alias) / Rotación / Escala
  (acumuladas en la sesión de esa selección). Arrastrar un número en horizontal (0,5 mm·°/px, escala 0,005/px; Shift ×10, Ctrl ×0,1) o doble clic para escribirlo.
  hudApply(g, eje, de, a) mueve CVs / geometría de mallas / pivotes y usa pendingObjs + flushPending; hudBegin = historyBlockers + checkpoint. Se arrastra por la
  cabecera (prefs.hudPos). Canvas y Shells no existen todavía en Forja (KIND_NAMES ya los nombra). hudOn (var) protege los enganches de antes de crearse.
  Origen Z arriba: marcador de 3 ejes (ArrowHelper + letras x/y/z, tamaño fijo en px) y líneas principales AZULES #2f7bff hijas de cada rejilla (suelo: X e Y;
  frente: X y Z; lado: Y y Z) en tramos de 5 dm hasta ±300 dm. OJO: sueltas en la escena o como una sola línea larga NO se dibujaban en perspectiva.
  Pruebas: scratchpad t40/t6.cjs, t7.cjs (HUD), t8.cjs (ejes; capturas ax-persp.png, hud-*.png).
- (v0.42) "Documento de arquitectura" del usuario (Alias + Plasticity). Lo que ya existía (Puck 3 círculos, marking menus, HUD, Z arriba, Shift+Alt, botones
  añadir/elegir/quitar, Align con filas extra = "Mezcla") se dejó. Nuevo:
  (1) Revolución (nurbs.js revolve(c, o)): o.origin/o.axis, o.angle (1–360°, hasta 3600 con paso), o.pitch (hélice, dm por vuelta), o.rational=false o paso → arcos
  NO racionales de o.deg / o.spans interpolados en Greville (fitCurve por fila; error de radio 2,5e-4 dm con g3 6 tramos en 180°). Racional: n = ceil(θ/90°) arcos,
  pesos cos(Δ/2); sin opciones = idéntico al de antes (8e-16). main.js: revOpts(r, src) (axisMode 'world' | 'pivot' | 'vector' con r.origin/r.axis), revFrame,
  revolveSelection crea con 1° y el ángulo sigue al ratón alrededor del eje (plano ⟂ eje; Alt de 15 en 15°); clic izq = fijar; clic DERECHO o Esc = aceptar y cerrar
  (commitRevolve; también con la ventana abierta). Eje Vector = 2 clics con placePoint (snaps). Flechas: verde = grados (en el extremo del arco, tangente), azul = paso.
  (2) Redondeo "Cuerda (chordal)": fillet.js filletShape o.chordal → radio = cuerda / (2 sen(ángulo entre normales / 2)) por arista; toolDef.filChordal. G2/G3 y
  Form factor NO (OpenCascade solo hace arco circular): se avisa en la ventana. Las superficies base ya se recortaban solas.
  (3) Snap + restricción (constrainPt, gizmoConstraint): con eje (botón del ratón o flecha del gizmo) solo cuenta la componente del eje; plano del gizmo = 2
  componentes; varios CVs + snap = TODOS al mismo valor/punto (gizmoDrag.collapse). Vista ortogonal de cara (orthoLocked): la profundidad nunca cambia y mover con
  botones pasa a 2D como Alias (izq libre en la vista · medio horizontal · der vertical; nearestAxis(camAxis)).
  (4) Move Pivot (D): arrastrar el pivote desde su marca (≤ 26 px) en el plano de la pantalla, con snaps (pivotDrag); el gizmo sigue valiendo.
  (5) Recuadro: en sombreado solo lo visible (rayos contra las superficies, sin contar la propia; seen()); en Malla (alambre) a través.
  (6) HUD: la lista de varios elementos es plegable (<details>, hud.listClosed).
  NO hecho del documento: Align Edge Align / Continuous / Default (hoy Natural = copia la estructura del maestro = Edge Align) y Skew / Tangent Balance;
  máscaras de selección por herramienta (el redondeo ya elige solo aristas); trim convert. Pruebas: t40/t15.cjs (recuadro, pivote, revolución, hélice), t16.cjs (orto 2D).
- (v0.43) Fase 2 del usuario:
  (1) REDONDEO G2/G3 (macro, Superficies › Redondeo G2 / G3, Puck Superficies anillo 2; EDGE_OPS.gfillet, un clic en el borde común, noMenu): findMateEdge busca la
  superficie cuyo borde coincide ENTERO (5 muestras, tol 1 %); createGFillet crea 2 relaciones 'fcurve' {src, edge, other, otherEdge, dist, measure, fg} (salida =
  curva sobre superficie con cos.edge y trim = FF.railTrimSide: el lado del borde se recorta) + 1 'blend' (lados = esas 2 curvas, flowInt free, contA = contB,
  tension = Form factor, fg). FF.filletRail: en cada estación θ = π − ángulo entre las isoparamétricas cruzadas de A y B; retirada = d·tan(θ/2) (radio),
  d/(2cos(θ/2)) (cuerda) o d (distancia); se camina por la isoparamétrica cruzada de A. Un solo nodo para el usuario: relSpec(r) con r.fg → gfilletSpec (Medida,
  Valor, G0–G3, Form factor, Quitar redondeo = borra blend y carriles y las superficies vuelven enteras); flecha verde 'valor'; clic derecho = aceptar.
  Con superficies tangentes (vaso Base/Cuerpo) la retirada con radio es ~0 (no hay esquina). Probado con 2 planos a 90°: carriles a 0,2 y 0,4 dm exactos.
  (2) Align de CURVA a BORDE: tipo Normal / Vector / Vista ya cambian la dirección (history.js curveEdgeDirDerivs: en el plano tangente, perpendicular al borde o el
  vector proyectado; G2/G3 de la superficie a lo largo de esa dirección); Natural = isoparamétrica cruzada exacta. Al cambiar el tipo se recalcula lambda0.
  Prueba (plano cizallado): Natural 63,4° (iso), Normal 90°, hueco 0 / ángulo 0.
  (3) Deslizador amarillo (kind 'm') del punto de unión en la maestra (borde o curva) en la vista; r.mT con edgeLengthApprox / curveLen.
  (4) Snap a curva deslizante exacto: curvePolylines da line.ev (curva NURBS o, si es curva sobre superficie, la superficie en su uv sin el levantado visual);
  findSnap afina con sección áurea en pantalla → best.point exacto y best.param.
  (5) Ventanas flotantes (toolwin, quickpick, HUD) = mismo panel: --win-bg translúcido por tema, blur 14 px, borde y sombra; se quitaron de INK_SEL (texto por tema).
  HUD por omisión abajo a la DERECHA (right 84 px). Pruebas: t40/t18.cjs (redondeo G2 con planos), t19.cjs (Align de curva, flecha amarilla, captura al-1.png).
- (v0.43.1) SNAP unificado (pruebas del usuario: al crear se "congelaba", al editar se "aplastaba" a 2 ejes). Regla: snap TOPOLÓGICO (punto, curva, superficie;
  isTopoSnap = kind ≠ 'rejilla') = punto 3D absoluto, sin eje del botón, sin plano del gizmo y sin bloqueo ortogonal (constrainPt con {free:true}); solo la REJILLA (Alt)
  respeta la restricción. Vale para dibujar (placePoint), mover con botones (3D y 2D), gizmo (applySnapToProxy, colapso de varios CVs) y pivote (pivotDrag).
  Ctrl / Ctrl+Alt sin punto ni curva cerca = el punto se desliza sobre la superficie de debajo (como Shift). surfacePointAt(own) evalúa la NURBS EXACTA S(u, v)
  con el uv del triángulo tocado (no el triángulo). Al pulsar/soltar Ctrl/Alt/Shift sin mover el ratón, la vista previa del dibujo se recalcula (keydown/keyup).
  Causa del "congelado": pointCandidates metía TODOS los CVs y pivotes de todos los objetos (invisibles) y el punto se pegaba a ellos; ahora solo CVs con handles
  visibles y pivotes de lo elegido. Prueba t40/t20.cjs: creación con Ctrl sobre el vaso a ≤ 7e-4 dm de la superficie; CV movido con botón der + Ctrl a 7e-6 dm.

## Siguiente paso

GitHub Pages ya está activo: https://eposboca9.github.io/forja-studio/

1. v0.6: sólidos estilo Plasticity con replicad/opencascade.js (WASM): caja/cilindro, extruir, fillet, chaflán, booleanas.
   Ojo: el Artifact de Claude bloquea fetch de .wasm; esto solo funcionará en GitHub Pages.
2. HDRI intercambiables (estudio, calle, desierto) y render con trazado de rayos (three-gpu-pathtracer).
3. Superficie a partir de curvas (loft / barrido) usando las curvas dibujadas.
4. Editor de atajos (esperando la lista de atajos de Alias del usuario).
5. Integrar OpenCASCADE (opencascade.js, WebAssembly) para sólidos, booleanas y redondeos.
6. Guardar y abrir proyectos (archivo .json) y exportar a STEP/OBJ.
- (v0.43.2) Align de curva corregido (pedido "Normal vs. tangente isoparamétrica"): la dirección ya era la isoparamétrica cruzada (Natural; Normal solo si se
  elige). Fallos reales: (1) bordes RACIONALES (revoluciones, círculos): edgeCrossDerivs, curveEndDerivs y curveDerivsAt ignoraban los pesos -> hueco de hasta
  0,08 dm entre CVs; ahora derivadas homogéneas + regla del cociente (ratDerivs, history.js). (2) Escala del casco (Tangent Scale): en G2/G3 el 3.er/4.º CV salía
  a 20-30 dm (λ³·M'''). alignCurve elige el término libre sobre la tangente (mu, nu: no cambian la curvatura) para conservar el tramo original, y curveNaturalLambda
  busca λ (hullLambda) para que los tramos CV0..CV(K+1) se parezcan a los de la curva original (rel.hullScale = false lo apaga). Resultado en 30 casos sobre el vaso:
  hueco 0, ángulo 0°, curvatura 0 % (G2/G3); círculo racional exacto en cualquier punto. Pruebas: scratchpad t40/t22.cjs, t23.cjs, t24.cjs (captura
  docs/capturas/v0.43.2-align-casco.png: antes / ahora).
- (v0.44) Refactor con el patrón del SDK de Alias (docs/alias-sdk.md), SIN cambiar la matemática: REGISTRO DE CONSTRUCCIONES en main.js
  (defineConstruction(type, {name, inputs, output, build, panel, points, diagnose, summary, labels, editsOutput, curvePoints, retool}),
  constructionOf(r), inputsOf/outputOf/relName salen del registro). Ya no hay cadenas de r.type === '...' en relationData, relSpec,
  relHandles, relDiag, updateRelLabels ni renderHistory: una herramienta nueva = un bloque defineConstruction. PUNTOS DE CONSTRUCCIÓN
  (como AlBlendPoint): cpoint(role, pos, dir, {get, drag, click, attach}) con POINT_ROLES (tension t, shape s, g3 g, distance d,
  flip f, slide m); continuityPoints(r, P(k), cont, keys) da tensión/forma/G3 igual para curvas y superficies; rowChain(d, edge).
  OJO: G_OPTS (quickPick, con nombres largos) ya existía: el de las ventanas se llama G_SEG. __forja expone relSpec, relHandles, relDiag,
  addRelation, applyRelation, propagateFrom, renderHistory. Prueba de regresión: scratchpad ref/t25.cjs old|new (17 recetas de 11 tipos:
  geometría al crear, al mover entradas y al arrastrar cada manija, ventanas, diagnósticos, etiquetas e historial) = IDÉNTICO a v0.43.2.
  Siguiente (pedido del usuario): bugs de Align (torsión, "proyección hacia arriba"; ojo: el vector por omisión del tipo Vector es Z de
  Alias = arriba) y el snap que no se desliza (idea de AlBlendPoint: guardar objeto + u,v / t y deslizar cambiando el parámetro).
- (v0.44.1) Caso del usuario: curva alineada al borde de arriba de un CILINDRO "se proyecta hacia arriba" en Natural/Normal/Vector. No era un fallo de
  cálculo: en un cilindro el plano tangente del borde es vertical y la isoparamétrica cruzada, la perpendicular al borde y el eje Z proyectado son
  TODOS verticales. Faltaba el modo de AlBlendPoint kGeometricInterp: nuevo tipo 'tangent' ("Tangente", el primero de la lista para curva→borde y el de
  ARRANQUE en curvas nuevas; toolDef.alignCurveType recuerda la elección): r.tdir = dirección con la que salía la curva al crearla, acostada en el plano
  tangente (history.js curveEdgeDirDerivs; G2/G3 = derivadas de la superficie a lo largo de esa dirección en (u, v); si la dirección sale de la superficie
  se mide hacia el otro lado y se cambia el signo de las impares). Curva dibujada exactamente por la normal (perpendicular a la pared) → no tiene dirección
  tangente: vuelve a la isoparamétrica. Medido (scratchpad al/t27.cjs): en el plano tangente 0°, curva por el labio conserva su dirección (2°), hueco 0,
  ángulo 0, curvatura 0 % en G2/G3. Captura docs/capturas/v0.44.1-align-tangente.png (al/t28.cjs).
- (v0.44.2) Herramienta Curva como Alias: pulsar · arrastrar · SOLTAR = CV (ya no hace falta un segundo clic). pointermove actualiza draft.hover también con el botón
  izquierdo pulsado (down && buttons === 1), así el punto se desliza con el snap mientras se arrastra; el pointerup de la herramienta Curva añade el punto aunque el ratón
  se haya movido (antes > 5 px = nada). ANCLAJE como AlBlendPoint::attachedTo: placePoint deja placeAnchor = {obj, t} en una curva, {obj, edge, t} en un borde de superficie
  (curvePolylines da a cada borde su evaluador exacto l.ev reconociendo u0/u1/v0/v1 y el sentido por los extremos; findSnap guarda best.edge/param),
  {obj, u, v} sobre una superficie (surfacePointAt → surfAnchor) y null si es libre. draft.anchors va en paralelo a draft.pts y la curva creada guarda obj.drawAnchors.
  Prueba: scratchpad al/t29.cjs (ratón real: clic simple, arrastre con Ctrl+Alt hasta un borde y con Shift sobre una cara; punto = S(anclaje) exacto), t40/t20.cjs sigue igual.
  Captura docs/capturas/v0.44.2-curva-arrastrar.png.
- (Plan, sin código) docs/plan-revolve-trim-revert.md: análisis de AlSurface/AlTrimRegion/AlTrimBoundary/AlDagNode/AlSnap.h y 5 fases (v0.45 ventanas flotantes con _ y × +
  casillas numéricas junto a cada deslizador; v0.46 revolución con ángulo inicio-fin y ejes X/Y/Z/pivote/elegido/manipulador; v0.47 Trim por regiones como construcción con
  etapas; v0.48 Untrim Última/Todas + Revert genérico en el registro y Redondeo no destructivo; v0.49 recorte con superficies = intersección). Esperando aprobación del usuario.
  OJO: los .h NO traen untrim, etapas ni revert (son de la interfaz de Alias), y AlDagNode es jerarquía de TRANSFORMACIONES, no historial de construcción.
- (v0.45) Ventanas flotantes y números exactos (fase 1 de docs/plan-revolve-trim-revert.md). main.js "Ventanas flotantes": winState(id) = prefs.wins[id] {x, y, min, closed};
  placeWin (libre por la pantalla, siempre quedan 80 px de la barra a la vista), dragWin(el, id, selectorBarra), setWinMin, winButtons() (_ y ×). Ventana de herramienta
  (id 'tool', #tw-min nuevo; × sigue cerrando la herramienta) y Transform info (id 'hud'; × = closed hasta Ventanas › Transform info; migra prefs.hudPos).
  Ventanas › Recolocar ventanas borra posiciones. Capas sigue anclada a la barra izquierda (decisión de la v0.36). Cada campo 'range' de TW lleva casilla .tw-num:
  rangeScale(f) saca la escala y la unidad del texto fmt (p. ej. paso dm → mm/vuelta), hasta 4 decimales, coma o punto, Enter/salir aplica, Esc deja, se limita a
  [min, max] y a entero si step ≥ 1; la tecla no llega a los atajos (stopPropagation). Prueba: scratchpad al/t30.cjs (37,25° exacto, paso 12,5 mm/vuelta = 0,125 dm,
  tramos 7,6 → 8, tope 1440°, arrastrar / minimizar / cerrar / reabrir / recargar). Capturas docs/capturas/v0.45-*.png.
- (v0.46) Revolución (fase 2 del plan): nurbs.revolve acepta o.start (grados; el giro va de start a start + angle, la hélice sube según lo girado desde el inicio).
  main.js: revAxis(r, src) = eje por modo: 'x' | 'y' | 'z'/'world' (AXES de Alias por el origen; 'world' = Z, el de siempre), 'pivot' (Z por el pivote), 'picked'
  (r.axisObj + r.axisEdge: de inicio a fin de esa curva o borde, pickedAxisPts; la revolución lo tiene como ENTRADA, así sigue a la línea con historial), 'manip'
  (r.origin + r.tip, dos puntos de construcción nuevos role 'axis' kind 'a' cian que se arrastran LIBRES en 3D con snap: cpoint {move}; arrowDrag con h.move usa
  findSnap o el plano de la pantalla) y 'vector' (eje antiguo de 2 clics, se muestra como Manip). r.a0 = inicio, r.angle = barrido; ventana: Eje X·Y·Z·Pivote·Elegido·Manip,
  Inicio, Fin (= a0 + angle), Barrido (+ casillas numéricas de la v0.45); flechas verdes 'fin' e 'inicio' (inicio mueve el comienzo y deja el fin). El clic de "Elegido"
  pone down = null (si no, también elegía la línea y la ventana se cerraba). Filas 'seg' con más de 4 opciones: .tw-wide (etiqueta encima, botones a todo el ancho).
  OJO sentido: el barrido gira como siempre (visto desde arriba en ejes de Alias, en el sentido del reloj); cambiarlo invertiría las normales (convención Su×Sv hacia dentro).
  Prueba: scratchpad al/t31.cjs (radio constante alrededor de X/Y/Z ~1e-15; inicio 30° / fin 120° exactos; Fin 200 escrito → barrido 170; eje elegido con clic real y la
  línea movida → la superficie la sigue; punta del manipulador arrastrada con el ratón → la superficie gira alrededor del eje nuevo). Captura docs/capturas/v0.46-revolucion-ventana.png.
- (v0.47) Revolución: (1) se crea a 360° (antes 1° siguiendo al ratón); en la sesión (revolveDrag {rels, dragging}) pulsar y arrastrar en la vista = el fin sigue al ratón,
  soltar = se queda, clic derecho / Esc = aceptar; Shift+Alt navega. (2) SENTIDO como Alias: antihorario visto desde la punta del eje (regla de la mano derecha): nurbs.revolve
  usa e2 = D × e1 y guarda las filas de CVs AL REVÉS (u = 0 en el fin del barrido, nudos 1 − k) para no invertir las caras; una vuelta completa sale IDÉNTICA a antes
  (1,8e-15, también no racional), así que el vaso y lo ya guardado no cambian. revFrame usa el mismo e2. Medido: inicio 30 / barrido 90 → de 30° a 120° antihorario.
  TRIM POR REGIONES (como AlSurface::trim(n, u[], v[])): Superficies › Trim (recortar por piezas) y Puck Superficies anillo 2 (trimSelection: elegir la superficie + curvas
  de corte). Construcción 'trim' {surf, tools[], proj 'view'|'y'|'normal', dir, keep, picks [[u, v, firma]]}, output = la propia superficie (editable: true = tocar sus CVs no
  rompe el historial; historyBlockers lo respeta). build = trimData: cada curva se proyecta (o se usa su CoS si ya está sobre esa superficie) → FF.trimLoop → data.rtrim
  {loops, picks, mode}. freeform.js: regionSig(loops, u, v) = '0110…' (dentro/fuera de cada lazo) y regionRemovedFn(rt) (sin piezas elegidas no recorta). updateSurface
  combina rtrim con los recortes de CoS. Las piezas se recuerdan por su FIRMA (p[2]), no por el punto: si se mueve una curva de corte el recorte la sigue.
  Sesión trimOp {rel, full}: clic izq = elegir/soltar pieza (se mide contra la superficie ENTERA, malla de doble cara, para poder elegir piezas ya quitadas), clic der o
  Enter = aceptar (sin piezas = no se crea), Esc = cancelar. Ventana: Las piezas elegidas Se conservan | Se quitan, Proyección, botón "Soltar todas las piezas elegidas"
  (campo nuevo de TW type 'button'). cloneData copia data.rtrim (deshacer y .forja). Prueba: scratchpad al/t32.cjs. Captura docs/capturas/v0.47-trim.png.
  PENDIENTE: Untrim Última/Todas (v0.48), Revert y Redondeo no destructivo; dibujar el borde del corte cuando la curva no está sobre la superficie.
- (v0.48) Untrim, Revert y Redondeo no destructivo (fase 4 de docs/plan-revolve-trim-revert.md). ETAPAS de Trim: data.rtrims = [{rel, loops, picks, mode}] en
  orden (trimStages(d) también lee el data.rtrim de la v0.47; cloneStage, setTrimStages, stageOf(r)); updateSurface quita lo de CUALQUIER etapa; .forja guarda rtrims.
  Borde del corte: parte nueva p.tedge (edgeCurveMat, siempre visible) con los tramos de cada lazo que separan lo que se queda de lo quitado.
  UNTRIM (Superficies › Untrim, Puck Superficies anillo 2): ventana con "Etapas: Última | Todas" (toolDef.untrimStage; TW.spec.untrim = herramienta activa); aplica a lo
  elegido y luego clic en cada superficie; clic derecho / Esc = terminar. Última = quita la última etapa (y su relación) o, si no hay, el último recorte de curva sobre
  superficie (trim 'none', edge false; también la relación project); Todas = la deja entera. Las curvas de corte no se borran.
  REVERT (botón en la ventana de cada operación, revertConstruction(r)): C.revert(r, salida) si existe; si no, con editsOutput (Align) vuelve a los datos de ANTES
  (revertStore: Map id → cloneData, se llena en createAlign / createAlignCurve; no persiste al recargar); si la salida es nueva, la borra. Luego vuelve a mostrar
  r.consumed (con su nombre r.names) y quita la relación. REDONDEO: al aceptar ya NO borra las superficies de origen: las oculta (nombre "· original") y crea la
  relación 'fillet' {srcs, consumed, names, outs (superficies + bordes de recorte), kind, n, dist}, editable, sin recálculo (OpenCascade no tiene historial);
  Revert borra outs y devuelve las originales. Prueba: scratchpad v48/t33.cjs (Playwright global, no el de fil/node_modules; OpenCascade servido desde
  /tmp/claude-0/-home-user/.../npmcdn/replicad-opencascadejs@0.20.2). Siguiente: v0.49 recorte con superficies (intersección).
- (v0.49) Documento "State Machine, UX industrial y Glassmorphism" del usuario + Trim superficie-superficie.
  (1) MÁQUINA DE ESTADOS (main.js, antes de "Herramientas"): UNA herramienta activa (var activeTool) o IDLE. beginTool(id, {label, cleanup(reason),
  voidKill, hit(e)}) llama antes a endActiveTool('switch'); endActiveTool(reason) ejecuta el cleanup y cierra la ventana TW si reason ≠ 'done';
  toolDone(id) = la herramienta terminó sola (sin cleanup). reason: 'switch' | 'esc' | 'void' | 'done'. Registradas: setTool (ids 'tool:curve|plane|circle|edge';
  setToolRaw = el setTool de antes; dibujar no muere con clic en el vacío), 'xform' (setXform), 'pivot', 'trim' (Esc cancela, lo demás acepta; hit = malla
  entera), 'untrim', 'revolve' (cleanup = commitRevolve), 'revaxis', 'extrude', 'fillet' (Esc cancela; otra cosa acepta si hay resultado; hit = arista) y
  'await:<id>'. KILL SWITCH: escapeAll(reason) = cleanup + pivote/mover fuera + TW.hide + soltar todo; Esc (un solo manejador en captura; con menú abierto solo
  cierra el menú; no con quickpick ni escribiendo) y CLIC EN EL VACÍO (pointerdown/up en captura en window, < 5 px, isVoidAt: ni objeto, ni CV, ni línea a 8 px,
  ni flecha, ni gizmo, ni activeTool.hit). "Nada" (pickNothing) = escapeAll('void') salvo terminar una curva en dibujo. Se quitaron los Esc propios de
  Trim, Untrim, Revolución, Extruir y Redondeo. Revolución: arrastrar en el vacío sigue cambiando el fin; un clic sin arrastrar = aceptar e IDLE.
  La barra de estado dice la herramienta activa o "IDLE" (updateStatus). checkpoint() respeta var cpMuted (vistas previas en vivo).
  (2) MENÚS: makeRadial({keepTool}): al soltar sobre una opción corta la herramienta activa (endActiveTool('switch')) salvo Visualización / Visu (keepTool);
  mientras se mantiene el botón o la tecla manda la DIRECCIÓN (pasado el centro, hasta r + 90 px), ya abierto (sticky) la cercanía. Puck (puck3.js): pulsar en un
  círculo lo abre al momento, arrastrar a la herramienta y soltar = ejecutar (st.drag, pointerup en captura); con Z mantenida, pasar por un círculo 170 ms lo abre y
  por la zona de ondas 320 ms suelta otro anillo (catAt, armDwell). runPuck3 y los menús Editar/Borrar/Curvas/Superficies/Utilidades (TOOL_MENUS) cortan la anterior.
  (3) SELECCIÓN EN LOS DOS SENTIDOS: withSelection(key) con SEL_SPECS {label, what, pick (filtro temporal), ok, ready, multi, run, preview, commit}; las funciones
  públicas (revolveSelection, extrudeSelection, loftSelection, offsetSelection, mirrorSelection, projectSelection, trimSelection) la llaman y las de antes se
  llaman *Run. Pre-selección lista → run al momento; si no → 'await:<id>' (var awaitSel, ventana awaitSpec con lo elegido), selectionChanged → awaitChanged:
  las de una entrada se ejecutan solas al elegirla, las multi esperan Enter / clic derecho / Aceptar; Loft = vista previa en vivo (preview/commit, sin pasos de
  deshacer extra); Esc la quita. syncToolWinToSelection no toca la ventana mientras se espera.
  (4) CRISTAL (index.html, bloque "(v0.49) GLASSMORPHIC SOFT UI"): .toolwin, .quickpick y .hud con --glass-bg rgba(30,32,36,.6) en oscuro (claro: rgba(246,246,244,.6)),
  blur 16 px, sin borde, radio 18 px, sombra 0 12 32 rgba(0,0,0,.4) + reflejo arriba de 1 px; .tw-seg = cápsula (activo rgba(255,255,255,.1)); botones .tw-btn
  en gris mate (sin azul), casillas y HUD con --pill-bg.
  (5) TRIM SUPERFICIE-SUPERFICIE: freeform.js intersectSurfaces(dA, dB, n = 40): rejillas n × n, cruce triángulo-triángulo con cubetas 3D, tramos encadenados
  (sin repetidos; los trozos que se cortan sobre vértices de la rejilla se unen si sus extremos están a menos de una celda), Gauss-Newton de norma mínima sobre
  SA − SB (solve3) → puntos exactos en las dos; extremos pegados al borde. trimToolUV devuelve LISTA de cortes; una superficie como herramienta = sus curvas de
  intersección (entrada de la relación: moverla rehace el corte). trimRun: la 1.ª superficie elegida se recorta, las demás superficies y curvas cortan.
  Medido: plano/plano exacto (2e-16), plano/esfera en 80 ms con puntos a 6e-9 de las dos.
  Pruebas: scratchpad v49app/t34.cjs [state|menu|trim] (Playwright global), v49/tx.mjs (Node; node_modules = enlace a fil/node_modules, por eso las .cjs van en
  v49app), v48/t33b.cjs y t33.cjs siguen igual. Capturas docs/capturas/v0.49-*.png.
- (v0.49.1) Parches del documento "UX industrial, State Machine y Tolerancias CAD":
  (1) COMMIT vs ABORTAR: el cleanup de 'tool:<t>' llama a commitWIP() antes de limpiar: la curva en dibujo con ≥ 2 CVs se GUARDA (finishDraft) con Esc, "Nada" u otra
  herramienta; con 0 o 1 CV se descarta. escapeAll también hace el commit y avisa "<curva> guardada". (El clic en el vacío dentro de Curva sigue añadiendo CVs.)
  (2) MENÚS A CERO LATENCIA: CSS (v0.49.1) quita transition/animation de .puck, .radial-veil, .p3-veil y oculta .p3-drop; puck3.js sin animaciones (reduce = {matches:true}, T = 0)
  y sin esperas (entrar en un círculo lo abre en el mismo movimiento; cada entrada en la zona de ondas suelta un anillo); makeRadial sin el temporizador .settled. Al soltar
  (botón, Z o Ctrl+Shift+botón) se vuelve a calcular la opción bajo el cursor en ese instante (pickAt en pointerup / keyup) antes de ejecutar.
  (3) TOLERANCIA DE CVs: cvAtScreen(e, objs, px = CV_HIT = 8) = el CV más cercano al cursor EN PANTALLA dentro de 8 px (a igual distancia, el más cercano a la cámara);
  lo usa pickAt (modo CV y CVs de lo elegido) en lugar del rayo contra la esfera.
  (4) MOVER / ROTAR / ESCALAR PERSISTENTES: beginTool('xform', {persist: true}); escapeAll con reason ≠ 'esc' y herramienta persist solo suelta la selección ("Nada" y clic en
  el vacío no la cierran); solo Esc u otro comando la cierran. setPickMode ya no apaga mouseXform si la herramienta activa es 'xform'.
  Prueba: scratchpad v49app/t35.cjs (curva 3 CVs + Esc = guardada, 1 CV = nada, 2 CVs + otra herramienta = guardada; W, clic a 6 px de un CV, Nada, vacío, clic en otro CV
  y arrastrar = se mueve sin volver a pulsar W; marking y Puck sin pausas). t34.cjs y v48/t33b.cjs siguen igual.
- (v0.49.2) Documento "Puck animado, Locators y Normales" (los puntos 2, 3 y 6 ya estaban en v0.49 / v0.49.1):
  (1) PUCK con animaciones otra vez (puck3.js: reduce = matchMedia, T(ms); cierre animado 120 ms y oculta al terminar si no se reabrió); la regla CSS de 0 ms solo
  aplica a .puck:not(.puck3) (marking menus) y .radial-veil. Las ondas se despliegan / repliegan clic a clic (xClick) y cada categoría recuerda sus anillos (cfg.open[cat]).
  OJO pruebas: en SwiftShader las transiciones del Puck tardan varios segundos; esperar a document.getAnimations() vacío antes de medir botones (t35.cjs).
  (2) LOCATORS (main.js "Locators de medición"): locators [{mode 'min'|'max', a, b, r}] anclados por id; updateLocators() en el bucle (recalcula solo si cambia
  sceneChangedAt): muestreo (curva 161 puntos, superficie 35×35 sin lo recortado) + locRefine (búsqueda de patrón en los parámetros de los dos). Máx = la mayor de las
  distancias de los puntos de A a B. Línea y puntos ámbar + etiqueta "mín/máx N mm" (.loc-label). Utilidades › Locator mínima / máxima / Borrar; Ctrl+Shift+izq ›
  Localizador; Ctrl+Shift+medio › Borrar localizadores; SEL_SPECS locmin/locmax (2 objetos, pre o post selección). No van en el deshacer ni en el .forja.
  (3) INVERTIR NORMALES (Superficies › Invertir normales, Puck Superficies anillo 2, SEL_SPECS flip): invierte U (cvs y nudos 1 − k) y pasa los recortes (etapas, picks y
  curvas sobre superficie) a 1 − u. Prueba: scratchpad v49app/t36.cjs (locators 50 / 140 / 30 mm exactos y 50 mm tras mover la recta; normal y −1 → +1 con la misma forma).
- (v0.50) Documento "Paleta Forja, Puck, Spans/Grados, coordenadas locales y .forja":
  (1) PALETA FORJA: curvas en oscuro #E2E8F0 (THEME_3D.dark.curve); CVs dorado #D69E2E y elegido #F6E05E (handleMat / handleSelMat); ejes X #E53E3E, Y #38A169, Z #3182CE
  (originAxes, AXIS_BLUE de las líneas de la rejilla, gizmo, HUD .ax*); historial #48BB78 (isoHistMat, curveHistMat); pivotes y locators turquesa #4FD1C5; recuadro de
  selección azul eléctrico translúcido (.marquee). No se tocó ningún shader.
  (2) PUCK: nada se abre por pasar el cursor (se quitó el bloque de gesto de st.pickAt en puck3.js): categorías centrales y laterales y ondas solo con clic; el pickAt
  sigue marcando herramientas de anillos ya abiertos (mantener Z y soltar sobre una herramienta sigue valiendo).
  (3) GRADO / SPANS: Revolución muestra siempre Grado y Spans (tocarlos pasa a no racional); Extruir tiene Grado (Curva = el de la curva) y Spans del perfil (r.deg, r.spans:
  el perfil se reconstruye antes de extruir); la Curva ya los tenía. INSPECTOR en Transform info (modo single, curvas y superficies): casillas Grado/Spans (U/V) +
  "parametrización uniforme" (geoInfo, geoRows, applyGeo): salida de una Revolución → cambia rel.deg/spans (historial intacto); salida de otra construcción no editable →
  se quita esa relación con aviso; si no, N.rebuildCurve / rebuildSurface y updateObject (lo que depende se recalcula).
  (4) ORIGEN LOCAL: initObj guarda obj.origin0 = pivote al crearse; Transform info (single / multi) muestra "Traslación (local)" = pivote − origin0 → todo nace en (0, 0, 0)
  (rotación 0 y escala 1 ya empezaban así); origin0 va en snapshot / restore / .forja.
  (5) CVs POR OBJETO: obj.showCVs (se enciende al elegirlo y sigue encendido al elegir otra cosa; los CVs de objetos con showCVs se pueden agarrar sin elegirlos);
  se apagan con "Nada", Esc o clic en el vacío (escapeAll → cvsOff; la curva recién guardada los conserva) y con Mostrar › Apagar CVs (elegidos) / Apagar todos;
  Mostrar › Encender CVs (elegidos). Va en snapshot / .forja.
  (6) .FORJA v2 = la escena completa con el formato del deshacer (snapshot: ids, relaciones = historial, capas con color / modo / simetría, grupos, materiales, pivotes,
  origin0, showCVs, recortes; mallas como posiciones + índices) + locators; reviveThree vuelve a crear Vector3/4 dentro de las relaciones; loadProjectV2 = restore + sin
  deshacer previo. Los .forja v1 se siguen abriendo. ARCHIVOS RECIENTES (Archivo › Archivos recientes…): IndexedDB 'forja-recent' (nombre, fecha, contenido; 8 últimos), se
  apuntan al guardar y al abrir; lista con quickPick. Prueba: scratchpad v49app/t37.cjs. OJO: t35.cjs (Puck por pasar el cursor) ya no vale por diseño.
