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
- `src/exporters.js`: IGES 5.3 (128/126, lectura y escritura), STEP AP214 (GEOMETRIC_SET de B-splines), OBJ de cuadriláteros para SubD,
  SVG/DXF 2D (proyección paralela), .zip sin compresión. Validado con occt-import-js (OpenCASCADE) en el scratchpad.
- `src/logo.js`: logotipo Nodo.
- `src/freeform.js`: Freeform Blend / Skin por estaciones, curvas sobre superficie (proyectar), recortes (trimGeometry) y Extender. Pura matemática.
- `src/history.js`: historial de construcción (Align G0–G3, Blend G1/G2, Offset, Simetría, diagnóstico de unión). Pura matemática.
- `src/ai.js`: módulo IA: generadores paramétricos (tornillo ISO con rosca, tuerca, arandela, mesa, silla) y parsePrompt (español).
- `docs/capturas/`: capturas de pantalla de cada versión.
- `docs/alias-referencia.md`: atajos y comportamiento de Alias (de la hoja oficial que pasó el usuario). Consúltalo.
- Desde este entorno no se puede abrir help.autodesk.com ni download.autodesk.com (DNS bloqueado); pedir capturas al usuario.

## Decisiones tomadas

- Nombre: FORJA. Logotipo elegido "Nodo" (src/logo.js): FORJA en Outfit 500 dentro de un marco de construcción
  de 1 px que se pasa de largo en las esquinas; en la esquina inferior derecha las líneas paran antes de un + azul #2f7bff grueso.
- Interfaz (rama interfaz-concreto, pendiente de pasar a main): fondo de piedra rugosa a pantalla completa (src/concrete.js),
  tema claro/oscuro, sin marcos, menús que aparecen al acercar el ratón a cada borde, cabecera e info de vista siempre visibles y tenues.
- Por decisión del usuario se abre solo la vista Diagnóstico (Showroom por defecto) con las líneas de parche encendidas.
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

## Siguiente paso

GitHub Pages ya está activo: https://eposboca9.github.io/forja-studio/

1. v0.6: sólidos estilo Plasticity con replicad/opencascade.js (WASM): caja/cilindro, extruir, fillet, chaflán, booleanas.
   Ojo: el Artifact de Claude bloquea fetch de .wasm; esto solo funcionará en GitHub Pages.
2. HDRI intercambiables (estudio, calle, desierto) y render con trazado de rayos (three-gpu-pathtracer).
3. Superficie a partir de curvas (loft / barrido) usando las curvas dibujadas.
4. Editor de atajos (esperando la lista de atajos de Alias del usuario).
5. Integrar OpenCASCADE (opencascade.js, WebAssembly) para sólidos, booleanas y redondeos.
6. Guardar y abrir proyectos (archivo .json) y exportar a STEP/OBJ.
