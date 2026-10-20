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

- `index.html`: toda la app por ahora (HTML + CSS + JS módulo). three.js 0.160.0 desde cdn.jsdelivr.net vía import map.
- `docs/capturas/`: capturas de pantalla de cada versión.

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

## Siguiente paso

GitHub Pages ya está activo: https://eposboca9.github.io/forja-studio/

1. v0.5: árbol de objetos a la izquierda, pestañas de espacio de trabajo, paneles plegables.
2. v0.6: HDRI intercambiables (estudio, calle, desierto) y render con trazado de rayos (three-gpu-pathtracer).
3. Superficie a partir de curvas (loft / barrido) usando las curvas dibujadas.
4. Editor de atajos (esperando la lista de atajos de Alias del usuario).
5. Integrar OpenCASCADE (opencascade.js, WebAssembly) para sólidos, booleanas y redondeos.
6. Guardar y abrir proyectos (archivo .json) y exportar a STEP/OBJ.
