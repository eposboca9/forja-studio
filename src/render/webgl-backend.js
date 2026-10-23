// Backend clásico: el WebGLRenderer de three.js y las funciones de dibujo que ya existían en main.js (renderPane, renderViewCube...).
// No cambia ningún comportamiento: solo es la costura por la que main.js llama al dibujo.
export class WebGLBackend {
  constructor({ renderer, drawPane, drawOverlay }) {
    this.id = 'webgl';
    this.renderer = renderer;
    this._drawPane = drawPane;
    this._drawOverlay = drawOverlay;
  }
  get canvas() { return this.renderer.domElement; }
  drawPane(p) { this._drawPane(p); }
  drawOverlay(p) { if (this._drawOverlay) this._drawOverlay(p); }
  resize(w, h) { this.renderer.setSize(w, h, false); }
  readPixels(x, y, w, h) {
    const gl = this.renderer.getContext(), out = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, out);
    return out;
  }
  dispose() { this.renderer.dispose(); }
}
