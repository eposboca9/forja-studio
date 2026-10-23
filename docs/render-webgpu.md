# Motor de render nuevo (WebGPU) — análisis de referencias y pipeline propuesto

Estado: **estructura base hecha** (src/render: interfaz RenderBackend, backend WebGL clásico sin cambios, prueba de viabilidad de WebGPU en
Preferencias › Motor de render). **Iluminación y shaders: NO empezados**; este documento es la propuesta para aprobar antes de escribirlos.

## 1. Lo que muestran las referencias (6 imágenes)

| # | Imagen | Rasgos que hay que replicar |
|---|---|---|
| 1 | Casco rojo en Plasticity (vista frontal) | Pintura roja metalizada con barniz: base rojo oscuro profundo, brillos que viran a naranja y a casi blanco en el núcleo. Reflejos largos de cajas de luz que siguen la curvatura. Bordes de los biseles con una línea de brillo fina y nítida. Zonas ocultas (rejillas, huecos) muy oscuras. Líneas de panel finas y oscuras. Fondo gris carbón liso con rejilla tenue. |
| 2 | Primer plano del casco | Lo anterior en grande: la línea de brillo en un redondeo mide 1–2 px y no se rompe → hacen falta normales exactas y teselado denso en los redondeos. Degradados anchos y suaves sobre las caras planas. Oclusión fuerte en las ranuras. |
| 3 | Modo "pintura" frente a modo "gris con aristas" | Mismo modelo en dos modos: pintura roja y gris carbón mate con las aristas (bordes de caras) dibujadas en naranja/rojo, finas y limpias. Es casi el modo FORJA que ya tenemos, con aristas de color. |
| 4 | Panel "Render mode" de Plasticity + robot amarillo | Selector de modos con esferas de muestra, lista de entornos, Rotación e Intensidad del entorno, interruptores Mostrar aristas / curvas / caras. El robot (amarillo y negro mate) se apoya en un suelo oscuro invisible con **sombra de contacto suave** debajo y fondo oscuro con viñeta. |
| 5 | Palanca de mando (crema, negro mate, cobre) | Materiales variados: pintura crema, negro mate, cobre anodizado. **Todas las aristas de las caras** como líneas negras de 1 px. Iluminación suave tipo matcap con oclusión en las uniones. Rejilla de perspectiva que se desvanece a lo lejos. 144 FPS. |
| 6 | Figura en arcilla gris (la que mandaste después) | Material de arcilla mate casi sin brillo; **una luz principal dramática** desde un lado con caída fuerte, luz de contorno (rim) que separa del fondo, fondo negro con viñeta, oclusión y cavidades marcadas que dan el detalle. Es un modo "Arcilla de estudio". |

### Qué lo hace verse así (y qué no)
1. **Entorno de estudio HDR con cajas de luz** (rectángulos muy brillantes). Los reflejos alargados y las líneas de brillo vienen de ahí.
   RoomEnvironment (el actual) es demasiado plano y sin cajas de luz definidas.
2. **Pintura de dos capas**: base metálica de color + barniz transparente. El brillo naranja viene del mapeo tonal filmic (ACES) al sobreexponer el rojo,
   no de una luz naranja.
3. **Geometría exacta**: normales analíticas de la superficie NURBS y subdivisión por curvatura. Sin esto el brillo fino se rompe en facetas.
4. **Oclusión en ranuras con color** (multi-rebote, para que el rojo no se vuelva gris) y **sombra de contacto** en el suelo.
5. **Aristas** como pasada propia: líneas de 1 px con antialiasing y color según el modo.
6. **Antialiasing que respeta brillos finos** (suavizado especular + MSAA/TAA).
7. **No hay reflejos del suelo (SSR) en ninguna referencia.** Propongo dejar SSR fuera por ahora.

## 2. Pipeline propuesto (WebGPU, forward)

```
P0  Entorno (solo al cambiar)  → HDRI procedural de estudio (cajas de luz editables) o .hdr de Poly Haven (CC0)
                                 → cubemap → prefiltro GGX por mips (cómputo) + armónicos esféricos (difuso) + tabla BRDF
P1  Geometría                  → vértices con normal analítica; origen flotante (restar la cámara); profundidad invertida
P2  Prepass Z + normal         → depth32float + normal comprimida (+ velocidad si hay TAA)
P3  GTAO (media resolución)    → oclusión + normal "doblada"; multi-rebote con color; filtro bilateral; solo al estar quieto
P4  Suelo                      → "atrapasombra": sombra de contacto suave (caja de luz superior, desenfoque por distancia) + AO del suelo; alfa sobre el muro
P5  PBR forward (MSAA 4x)      → GGX + Smith + Schlick, compensación de rebotes múltiples; capa de barniz; IBL split-sum;
                                 oclusión especular; suavizado especular por varianza de normales
P6  Aristas / curvas / CVs     → líneas de 1 px con cobertura analítica, profundidad con sesgo; "crease" para mallas
P7  Resolución                 → (TAA opcional) → mapeo tonal ACES/AgX (selector actual) → viñeta suave → ruido de 1 LSB anti-bandas
P8  Interfaz sobre el lienzo   → cubo de vistas, gizmo, flechas
```

Los modos son **variantes del mismo shader**, no pipelines distintos:

| Modo | Referencia | Material | Aristas |
|---|---|---|---|
| Pintura (Visu) | 1, 2, 4 | base metálica de color + barniz, entorno de estudio | opcionales |
| Carbón con aristas (FORJA) | 3 der., 5 | difuso mate oscuro + IBL suave + AO | color de marca, 1 px |
| Arcilla de estudio | 6 | difuso casi sin brillo, luz principal + contorno | opcionales |
| Cebra / Curvatura / Showroom / Difuso / Sky | — | los actuales, portados | según el modo |

## 3. Parámetros expuestos (como el panel de Plasticity)
Entorno (lista), Rotación, Intensidad, color de pintura, rugosidad de la base, grosor del barniz, intensidad de AO, dureza de la sombra de
contacto, aristas (activar, color, grosor). "Copiar valores" para afinar contigo con capturas, como hicimos con el modo Forja.

## 4. Pasos exactos hasta el primer resultado visible
1. (hecho) F0 viabilidad + F1 interfaz RenderBackend.
2. F2 backend WebGPU vacío: mismo lienzo, paneles, carrusel y cubo; dibuja profundidad + color plano. Interruptor en Preferencias.
3. F3a entorno: generador procedural de estudio + prefiltro GGX + BRDF LUT (sin materiales todavía; se ve la esfera de prueba).
4. F3b PBR + barniz sobre las superficies de Forja; normales analíticas del NURBS.
5. F4 modos y aristas. F5 AO + sombra de contacto. F6 postproceso. F7 paridad y retirada del clásico.

## 5. Riesgos
- WebGPU dentro del Artifact: comprobar con el botón "Probar WebGPU" en el Artifact y en tu laptop.
- Mi navegador de pruebas usa un adaptador por software (SwiftShader): sirve para comprobar que funciona, no para medir velocidad.
- Los overlays (líneas, CVs, flechas, gizmo de three) hay que portarlos o componerlos aparte.
- Rendimiento en gráficos integrados: calidad distinta en reposo y en movimiento (como ya hacemos con AO y teselado).
