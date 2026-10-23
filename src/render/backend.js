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
//   dispose()
// Para pasar de un backend a otro no cambia nada fuera de esta carpeta.
import { WebGLBackend } from './webgl-backend.js';

export const BACKENDS = ['webgl', 'webgpu'];

// ctx: lo que el backend clásico necesita del viewport actual (el renderer de three y las funciones que ya dibujaban cada panel)
export function createBackend(kind, ctx) {
  if (kind === 'webgpu') throw new Error('El backend WebGPU todavía no está construido (fase F2 del plan).');
  return new WebGLBackend(ctx);
}
