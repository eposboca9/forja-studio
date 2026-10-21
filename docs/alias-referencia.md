# Referencia de Alias para Forja Studio

Notas sacadas de la hoja "Mouse and Keyboard Reminders" de Alias AutoStudio 2027 (captura que compartió el usuario)
y de guías de Alias. Sirven para que Forja Studio se comporte como Alias.

## Ver (navegación)
- `Shift + Alt` + botón izquierdo = Tumble (girar), central = Track (desplazar), derecho = Dolly (acercar).
- El pivote de giro queda fijo en el mundo; desplazar y acercar no lo mueven.

## Tumble, Pan and Zoom (página de ayuda de Alias 2027)
- Tres formas: Shift + Alt con los botones del ratón, arrastrar el ViewCube, iconos de la barra de navegación. La rueda también hace zoom.
- En vistas ortográficas solo hay Pan y Zoom.
- Al mantener Shift + Alt aparecen pistas arriba de la vista con lo que hace cada botón.
- Zoom con botón derecho: mover en diagonal es lo más efectivo.
- Punto de interés (POI): girar y acercar se centran en él. Para moverlo: Shift + Alt y clic rápido (sin arrastrar) sobre la geometría.
- Las "clutch keys" se cambian en Preferences > Clutch Keys Editor: Viewing Control (Shift+Alt), Grid Snap (Alt),
  Curve Snap (Control+Alt), Point/Magnet Snap (Control), Marking Menu (Shift+Control).
- Modos de giro: basado en cámara (por defecto, mantiene la vertical como una cámara de cine) y basado en objeto
  (como tener el modelo en la mano: izq = azimut/elevación, cruzar la ventana gira 180°; medio = pan;
  derecho: arrastre vertical = zoom, horizontal = twist). Se elige en Preferences > General > Navigation, en el ViewCube o con un atajo.
- Ojo: Alias usa Z hacia arriba por defecto; Forja usa Y hacia arriba (three.js).

## Marking menus (menús radiales)
- `Ctrl + Shift` + botón izquierdo / central / derecho abre un menú radial distinto por botón
  (en la hoja: menú de selección, herramientas de transformación y visualización).

## Snap
| Teclas | Espacio del mundo (XYZ) | Espacio de parámetros (UV) |
|---|---|---|
| `Ctrl` | Snap a punto | Snap a keypoints / puntos de edición |
| `Alt` | Snap a rejilla | Snap a isoparamétricas |
| `Ctrl + Alt` | Snap a curva | Ajustes |
- También hay 3 botones arriba a la derecha para dejar el snap de punto, rejilla y curva fijo.
- Opciones del snap de curva: divisiones (2 = punto medio), centro, pivote, intersecciones proyectadas.

## Restricciones de transformación con los botones
- Vistas 3D: botón izquierdo = X, central = Y, derecho = Z.
- Vistas 2D: izquierdo = libre, central = horizontal, derecho = vertical.

## Selección con los botones
- Por defecto: izquierdo = alternar, central = añadir, derecho = quitar.
- Alternativa sugerida por Autodesk: izquierdo = elegir (reemplaza), central = añadir, derecho = quitar.

## Pick walk
- `Ctrl` + flechas recorre los CVs: curvas con izquierda/derecha; superficies: izq/der = U, arriba/abajo = V.

## Videos del usuario (flujo de trabajo real en Alias)

### Video 1: Align
- Flujo: Revert → elegir el borde que se mueve ("Select a natural surface boundary or a free curve as input", queda en verde "Input")
  → elegir la geometría maestra ("Select the master geometry for input alignment") → "Align was successful".
- Si hay varios bordes bajo el cursor, sale una lista para elegir (Fillet_srf#208.V=..., Blend_srf#219.V=...).
- Opciones: Continuity G0/G1/G2/G3, Lock Position Row, Alignment Type Edge/Project, Vector, Tangent Balance, Blending, Partial,
  Explicit Control (U Degree 6, V Degree 3, U/V Spans 1), Position Influence 1.0, Outer Edge, Tangent and Curvature CV Adjustment,
  Partials, Auto Update, Create History, Continuity Check (Tool Defined), Proxy Display, Diagnostic. Botones Update/Revert/Accept.
- Asas Start/End [Skew] en los extremos del borde alineado.
- Query Edit (qryed): "Use [LEFT MOUSE] to edit construction history or [RIGHT MOUSE] to query" → reabre Align con sus opciones.
- Pista de navegación en giro por objeto: [Left = Azimuth/Elevation] [Middle = Track] [Right = Vertical Dolly] [Right = Horizontal Twist] [ArrowKeys = Step Azimuth/Elevation].

### Video 2: shaders de evaluación, selección y Freeform Blend
- Paleta Diagnostic Shade: ShdOff, MulCol, RanCol, CurEvl, IsoAng, HorVer, SurEvl, UseTex, LTunnel, ClayAO, Isophotes, Vis1-3, FileSt, BoxMd.
- Shader Settings: Layer (Isophotes), Map Type (Showroom, Photo-Horizon, Diffuse, Shade-Sky, Double-horizon, User Defined),
  Transparency, Lock Texture, Repeats 1, Ambient 0.5, Diffuse 0.5, Link Light to Camera.
  Isófotas: Base Color blanco, Stripe Color negro, Transparency 0.8, Count 50, Thickness 0.01, Sharpness 0.5, Use Camera View Vector.
- EL USUARIO USA SOBRE TODO EL MAP TYPE "SHOWROOM" para evaluar.
- "Toggle Model" (marking menu): oculta las líneas de los parches, los hulls y los CVs; el objeto se ve completo y limpio.
- Herramienta de selección "Surface": "[Left Toggle] [Middle Add] [Right Unpick]", también se puede escribir el nombre.
- Freeform Blend (ffblnd): Side 1 Continuity (G2 Curvature), Side 2 Continuity (G0 Position), Lock Shape Controls,
  Side 1/2 Shape 1.0, Modify Parameter, Crown Mode, Explicit Control (U Degree 6, Uniform Spans), Flow Control
  (Start Edge Align, Interior Free, End Edge Align), Modify Range (Side 1/2 Start/End). "Pick input curves or modify the parameters".

### Video 3: borrar historial, template, Freeform Blend
- Selección "Surface" → trim (Shift añade/quita superficies, clic o recuadro elige regiones de recorte) → dact (Delete Active):
  aviso "Construction history will be deleted. Delete active?" Yes/No → borra la superficie seleccionada (una franja del cuerpo).
- templ (Template): "Use mouse or enter name of template to pick/unpick: [Left Toggle] [Middle Add] [Right Unpick]".
  Las plantillas se ven en alambre gris y no se seleccionan como objetos normales; clic en vacío muestra la etiqueta "Nothing".
  Se alterna entre objeto normal (sombreado) y plantilla (alambre) para usarlo de referencia.
- Freeform Blend Control: elige borde 1 (sale lista si hay varios: Loft/Blend/Fillet...), borde 2.
  Etiquetas en pantalla: Start [Edge Align], End [Edge Align], Side 1 Continuity [G2], Side 2 Continuity [G0].
  Botones Update, Undo All, Next. Panel derecho: "2 picked surfaces", Degree 6x3, Spans 1x1.

## Pendiente de implementar en Forja
- Editor de clutch keys (cambiar Shift+Alt, Alt, Ctrl+Alt, Ctrl, Shift+Ctrl).
- ViewCube.
- (Hecho) Un menú radial distinto por botón del ratón.
- (Hecho) Mover con restricción X/Y/Z según el botón (herramienta Move de Alias, sin gizmo).
- Snap en espacio de parámetros (UV) y opciones del snap de curva (divisiones, centro).
