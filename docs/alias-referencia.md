# Referencia de Alias para Forja Studio

Notas sacadas de la hoja "Mouse and Keyboard Reminders" de Alias AutoStudio 2027 (captura que compartió el usuario)
y de guías de Alias. Sirven para que Forja Studio se comporte como Alias.

## Ver (navegación)
- `Shift + Alt` + botón izquierdo = Tumble (girar), central = Track (desplazar), derecho = Dolly (acercar).
- El pivote de giro queda fijo en el mundo; desplazar y acercar no lo mueven.

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

## Pendiente de implementar en Forja
- Un menú radial distinto por botón del ratón.
- Mover con restricción X/Y/Z según el botón (herramienta Move de Alias, sin gizmo).
- Snap en espacio de parámetros (UV) y opciones del snap de curva (divisiones, centro).
