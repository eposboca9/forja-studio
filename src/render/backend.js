// Capa de render de Forja (RenderBackend).
// El viewport de Forja (cámara, navegación, selección, snap, herramientas, historial) NO sabe cómo se dibuja: solo entrega a un backend
// lo que hay que dibujar y las matrices de la cámara. Hoy hay un backend, 'webgl' (el motor de siempre, movido sin cambios);
// 'webgpu' es el nuevo (en construcción: ver docs/render-webgpu.md).
//
// Contrato de un backend:
//   id                         'webgl' | 'webgpu'
//   drawPane(pane)             dibuja un panel del lienzo (pane = { x, y, w, h, kind }); el panel ya trae su cámara activa
//   drawOverlay(pane)          dibuja lo que va encima del panel (cubo de vistas)
//   resize(w, h)               tamaño del lienzo en píxeles CSS
//   readPixels(x, y, w, h)     lee un rectángulo del lienzo (RGBA, origen abajo-izquierda); lo usa adaptInk para el color del texto
//   beginFrame() / endFrame()  inicio y fin de cada cuadro (el híbrido limpia y lee píxeles)
//   readRow(x, y, w)           una fila de píxeles (lo usa adaptInk)
//   dispose()
// Para pasar de un backend a otro no cambia nada fuera de esta carpeta.
import { HybridBackend } from './webgpu-backend.js';

export const BACKENDS = ['webgl', 'webgpu'];

// ctx: lo que el backend clásico necesita del viewport actual (el renderer de three y las funciones que ya dibujaban cada panel)
export function createBackend(kind, ctx) {
  // siempre se crea el híbrido: arranca en modo clásico (hybrid = false) y backend.enable() lo pasa a dos lienzos si WebGPU funciona
  const b = new HybridBackend(ctx);
  if (kind === 'webgpu') b.enable();
  return b;
}
