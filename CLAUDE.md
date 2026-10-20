# Memoria del proyecto Forja Studio

Este archivo es la memoria del proyecto entre sesiones. Léelo al empezar y actualízalo al terminar.

## Usuario

- Habla español; explicar las cosas de forma simple, sin jerga.
- Prueba desde el celular (iPhone) y quizá desde computadora.
- Presupuesto cero: solo herramientas gratuitas y de código abierto.

## Visión

Combinar Alias (superficies NURBS de clase A, análisis cebra/curvatura), Plasticity (modelado sólido rápido)
y Blender (render realista con shaders). Se empezó como app web para que cada avance se pruebe con un enlace.

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

## Siguiente paso

1. Activar GitHub Pages (rama `main`, carpeta raíz) para tener un enlace público.
2. Herramienta para dibujar curvas NURBS en el plano.
3. Integrar OpenCASCADE (opencascade.js, WebAssembly) para sólidos, booleanas y redondeos.
