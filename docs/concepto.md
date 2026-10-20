# Concepto de Software: El Modelador Híbrido Definitivo

Para crear una herramienta revolucionaria, combinaremos la precisión matemática de **Autodesk Alias**, la agilidad y versatilidad CAD de **Plasticity**, y la potencia visual en tiempo real de **Blender**.

---

## 1. El ADN de Autodesk Alias (Precision & Superficies)
Alias es la referencia en la industria cuando se requiere control absoluto sobre cómo interactúa la luz con las formas.
*   **Superficies Clase-A (NURBS):** Manipulación de Puntos de Control (CVs) con continuidad $G0, G1, G2$ y $G3$.
*   **Análisis Matemático:** Herramientas de diagnóstico visual (cebras, peines de curvatura, mapas de reflexión) para verificar imperfecciones en tiempo real.
*   **Modelado por Red de Curvas:** Definición de volúmenes complejos mediante proyecciones e intersecciones espaciales.

---

## 2. El ADN de Plasticity (Agilidad & Flujo CAD Directo)
Plasticity revolucionó el mundo CAD al eliminar la rigidez de los árboles de historial tradicionales.
*   **Modelado Directo:** Empujar, tirar y modificar caras, aristas y bordes sin romper dependencias complejas.
*   **UI/UX Enfocada en el Artista:** Atajos fluidos, menús radiales y ausencia de paneles abarrotados.
*   **Operaciones Booleana y Fillets Sólidos:** Cortar, unir y redondear volúmenes de manera instantánea utilizando motores CAD avanzados (como Parasolid).

---

## 3. El ADN de Blender (Fidelidad Visual & Sombreado en Tiempo Real)
Blender (a través de motores como EEVEE y Cycles) demuestra la importancia de diseñar viendo el resultado final con calidad fotográfica.
*   **Viewport Fotorrealista (Ray Tracing / PBR):** Sombras suaves, reflexiones exactas y oclusión ambiental en tiempo real mientras se esculpe o modela.
*   **Shaders Procedurales y Materiales Directos:** Aplicar acabados técnicos (pintura automotriz multicapa, fibra de carbono, plásticos texturizados, cristales con refracción) con un clic y sin necesidad de despliegue UV (*UV unwrapping*).
*   **Entornos HDRI y Luces de Estudio Integradas:** Cambiar instantáneamente entre un estudio fotográfico, una calle urbana o un desierto para evaluar cómo responde la geometría bajo distintas condiciones lumínicas.

---

## 4. La Visión de la App: "El Triángulo Perfecto"

El problema actual del diseñador industrial/automotriz es la **fragmentación**:
1. Construye curvas en Alias o Rhino.
2. Pasa a SolidWorks o Plasticity para piezas mecánicas o detalles.
3. Exporta a Blender, KeyShot o Unreal Engine para presentar renders.

**Nuestra solución:** Un único entorno donde la geometría matemática se combina con sombreadores fotorrealistas en vivo.

```
       [ Alias ]
   (Superficies G3 / NURBS)
          /   \
         /     \
        /       \
[ Plasticity ]---[ Blender ]
 (CAD Directo)   (Real-time PBR / Shaders)
```

### Características Clave del Software:

1. **Motor Híbrido Geometría + Visualización:**
   * Núcleo geométrico dual (NURBS / B-Rep) integrado directamente con un pipeline de renderizado moderno (ej. Vulkan / WebGPU / Metal) tipo EEVEE.
2. **Proyecciones de Material sin UVs (Triplanar Mapping para CAD):**
   * En CAD no existe el desplegado de mapas UV tradicional. La app debe aplicar patrones procedurales (texturas de plásticos, metales cepillados) usando proyección triplanar automática basada en las normales de las superficies NURBS.
3. **Diagnóstico Lumínico Visual:**
   * Alternar con una tecla (*HotKey*) entre el modo **Diagnóstico Técnico** (líneas de cebra, curvatura en falso color) y el modo **Render Fotorrealista** (luces de estudio, ray tracing en tiempo real).
4. **Gizmos Híbridos e Interacción Directa:**
   * Posibilidad de editar un punto de control $G3$ sobre un panel de un coche y ver instantáneamente cómo cambia la reflexión del entorno HDRI sobre la pintura metalizada sin retardos (*lag*).