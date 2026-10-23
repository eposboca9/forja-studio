// Backend HÍBRIDO de dos lienzos (fase F2 del plan, docs/render-webgpu.md).
//   · Lienzo de ABAJO (WebGPU): dibuja las superficies con color plano y profundidad (MSAA 4x). Sin iluminación ni shaders de material todavía.
//   · Lienzo de ARRIBA (WebGL, el de siempre, transparente): dibuja todo lo demás (líneas, CVs, gizmo, cubo, sombra del suelo) y las superficies
//     solo en profundidad (colorWrite = false), así lo que está detrás de una superficie queda tapado igual que antes.
// La cámara, la selección, el snap y las herramientas no cambian: el backend solo recibe lo que ya dibujaba main.js.
// Si WebGPU no existe o falla, el backend se queda en modo clásico (hybrid = false) y se explica el motivo.
import * as THREE from 'three';
import { WebGLBackend } from './webgl-backend.js';

const WGSL = `
struct U { mvp: mat4x4f, color: vec4f };
@group(0) @binding(0) var<uniform> u: U;
@vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f { return u.mvp * vec4f(p, 1.0); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(u.color.rgb, 1.0); }
`;
const STRIDE = 256;                       // alineación de los uniformes dinámicos
const ZFIX = new THREE.Matrix4().set(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.5, 0.5, 0, 0, 0, 1);   // z de OpenGL [-1, 1] -> z de WebGPU [0, 1]

export class HybridBackend extends WebGLBackend {
  constructor(ctx) {
    super(ctx);
    this.ctx = ctx;   // camera y scene se leen al usarlos (main.js los declara después de crear el backend)
    this.hybrid = false; this.error = '';
    this.gpu = null; this._first = true; this._frame = 0; this._read = null; this._wantRead = false; this._cache = new Map();
  }
  // ---- activar / desactivar ----
  // opts.offscreen: solo para pruebas en navegadores sin presentación WebGPU (p. ej. Chromium sin cabeza): dibuja en una textura, la lee de vuelta y la pinta en un lienzo 2D
  async enable(opts = {}) {
    if (this.hybrid) return true;
    this.offscreen = !!opts.offscreen;
    try { if (!this.gpu) await this._init(); } catch (e) { this.error = e.message || String(e); this.hybrid = false; return false; }
    this.error = ''; this._setLayout(true); this.hybrid = true; this.resize(this._w, this._h);
    return true;
  }
  disable() { this.hybrid = false; this._setLayout(false); }
  _setLayout(on) {
    const c = this.renderer.domElement;
    if (this.gpu) { this.gpu.canvas.style.display = on ? 'block' : 'none'; }
    Object.assign(c.style, on ? { position: 'absolute', left: '0', top: '0' } : { position: '', left: '', top: '' });
  }
  async _init() {
    if (!navigator.gpu) throw new Error('Este navegador (o este marco del Artifact) no ofrece WebGPU.');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) throw new Error('No hay adaptador WebGPU (tarjeta gráfica no compatible o desactivada).');
    this.adapter = adapter;   // hay que conservarlo: si el recolector de basura lo libera, Chromium da el dispositivo por perdido
    const device = await adapter.requestDevice();
    device.lost.then((i) => { this.hybrid = false; this._setLayout(false); this.error = 'Se perdió el dispositivo WebGPU: ' + i.message; });
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block';
    this.renderer.domElement.parentNode.prepend(canvas);
    const format = this.offscreen ? 'rgba8unorm' : navigator.gpu.getPreferredCanvasFormat();
    const context = this.offscreen ? null : canvas.getContext('webgpu');
    context?.configure({ device, format, alphaMode: 'premultiplied', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    if (this.offscreen) this.paint = canvas.getContext('2d');
    const module = device.createShaderModule({ code: WGSL });
    const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
    const mk = (fmt) => device.createRenderPipeline({
      layout, vertex: { module, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4 },
    });
    this.gpu = { device, canvas, context, format, pipe: mk(format), bgl, ubuf: null, ucap: 0, bind: null, msaa: null, depth: null, w: 0, h: 0 };
  }
  // ---- tamaño ----
  resize(w, h) {
    super.resize(w, h);
    this._w = w; this._h = h;
    const g = this.gpu; if (!g) return;
    const dpr = this.renderer.getPixelRatio();
    g.canvas.width = Math.max(1, Math.round(w * dpr)); g.canvas.height = Math.max(1, Math.round(h * dpr));
    g.msaa?.destroy(); g.depth?.destroy();
    const size = [g.canvas.width, g.canvas.height];
    g.msaa = g.device.createTexture({ size, format: g.format, sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    g.depth = g.device.createTexture({ size, format: 'depth32float', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    g.w = size[0]; g.h = size[1];
    if (this.offscreen) { g.off?.destroy(); g.off = g.device.createTexture({ size, format: g.format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC }); }
  }
  beginFrame() { this._first = true; this._frame++; }
  // ---- dibujo ----
  drawPane(p) {
    super.drawPane(p);                       // el WebGL de siempre: deja la cámara lista y dibuja líneas + profundidad de las superficies
    if (!this.hybrid || !this.gpu?.msaa) return;
    try { this._gpuPane(p); } catch (e) { this.error = 'WebGPU: ' + e.message; this.hybrid = false; this._setLayout(false); }
  }
  _tex() { return this.offscreen ? this.gpu.off : this.gpu.context.getCurrentTexture(); }
  _buffers(geo) {
    let c = this._cache.get(geo);
    if (c) { c.used = this._frame; return c; }
    const g = this.gpu, pos = geo.attributes.position, idx = geo.index;
    if (!pos) return null;
    let arr = pos.array;
    if (pos.isInterleavedBufferAttribute || !(arr instanceof Float32Array)) { arr = new Float32Array(pos.count * 3); for (let i = 0; i < pos.count; i++) { arr[3 * i] = pos.getX(i); arr[3 * i + 1] = pos.getY(i); arr[3 * i + 2] = pos.getZ(i); } }
    const vb = g.device.createBuffer({ size: Math.ceil(arr.byteLength / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); g.device.queue.writeBuffer(vb, 0, arr);
    const ia = idx ? idx.array : Uint32Array.from({ length: pos.count }, (_, i) => i), u32 = ia instanceof Uint32Array, ib = g.device.createBuffer({ size: Math.ceil(ia.byteLength / 4) * 4, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST }); g.device.queue.writeBuffer(ib, 0, ia);
    c = { vb, ib, count: ia.length, fmt: u32 ? 'uint32' : 'uint16', used: this._frame };
    this._cache.set(geo, c);
    return c;
  }
  _gpuPane(p) {
    const g = this.gpu, cam = this.ctx.camera, dpr = g.w / Math.max(1, this._w);
    const list = [];
    this.ctx.scene.traverseVisible((o) => { if (o.isMesh && o.userData.gpuSurf && o.layers.test(cam.layers)) list.push(o); });
    // uniformes: mvp + color de cada superficie
    if (list.length > g.ucap) {
      g.ubuf?.destroy(); g.ucap = Math.max(64, list.length * 2);
      g.ubuf = g.device.createBuffer({ size: g.ucap * STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      g.bind = g.device.createBindGroup({ layout: g.bgl, entries: [{ binding: 0, resource: { buffer: g.ubuf, size: 80 } }] });
    }
    const VP = new THREE.Matrix4().multiplyMatrices(ZFIX, cam.projectionMatrix).multiply(cam.matrixWorldInverse), m = new THREE.Matrix4(), col = new THREE.Color();
    const data = new Float32Array(Math.max(1, list.length) * (STRIDE / 4));
    const draws = [];
    list.forEach((o) => {
      const b = this._buffers(o.geometry); if (!b) return;
      const k = draws.length;
      m.multiplyMatrices(VP, o.matrixWorld); data.set(m.elements, k * (STRIDE / 4));
      col.setHex(o.userData.gpuColor ?? 0x888888);   // getHex da sRGB; el lienzo no convierte, así que se escribe tal cual
      data.set([col.r, col.g, col.b, 1], k * (STRIDE / 4) + 16);
      draws.push({ b, k });
    });
    // sRGB: Color guarda lineal -> se codifica
    for (let i = 0; i < draws.length; i++) { const q = i * (STRIDE / 4) + 16; for (let c = 0; c < 3; c++) { const v = data[q + c]; data[q + c] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; } }
    if (draws.length) g.device.queue.writeBuffer(g.ubuf, 0, data.buffer, 0, draws.length * STRIDE);
    const enc = g.device.createCommandEncoder(), first = this._first; this._first = false;
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: g.msaa.createView(), resolveTarget: this._tex().createView(), clearValue: [0, 0, 0, 0], loadOp: first ? 'clear' : 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: g.depth.createView(), depthClearValue: 1, depthLoadOp: first ? 'clear' : 'load', depthStoreOp: 'store' },
    });
    const vx = Math.round(p.x * dpr), vw = Math.max(1, Math.min(g.w - vx, Math.round(p.w * dpr))), vh = Math.min(g.h, Math.round(p.h * dpr));
    pass.setViewport(vx, g.h - vh, vw, vh, 0, 1); pass.setScissorRect(vx, g.h - vh, vw, vh);
    pass.setPipeline(g.pipe);
    for (const d of draws) { pass.setBindGroup(0, g.bind, [d.k * STRIDE]); pass.setVertexBuffer(0, d.b.vb); pass.setIndexBuffer(d.b.ib, d.b.fmt); pass.drawIndexed(d.b.count); }
    pass.end();
    g.device.queue.submit([enc.finish()]);
  }
  // se llama al terminar el cuadro: libera lo que no se usa y, si adaptInk lo pidió, lee los píxeles del lienzo de abajo
  endFrame() {
    if (!this.hybrid || !this.gpu) return;
    if (this.offscreen && !this._reading && !this._read) this._wantRead = true;
    for (const [geo, c] of this._cache) if (this._frame - c.used > 90) { c.vb.destroy(); c.ib.destroy(); this._cache.delete(geo); }
    if (this._wantRead && !this._reading) this._startRead();
  }
  _startRead() {
    const g = this.gpu, w = g.w, h = g.h, bpr = Math.ceil(w * 4 / 256) * 256;
    this._reading = true; this._wantRead = false;
    const buf = g.device.createBuffer({ size: bpr * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const enc = g.device.createCommandEncoder();
    enc.copyTextureToBuffer({ texture: this._tex() }, { buffer: buf, bytesPerRow: bpr }, [w, h]);
    g.device.queue.submit([enc.finish()]);
    buf.mapAsync(GPUMapMode.READ).then(() => { this._read = { w, h, bpr, bgra: g.format.startsWith('bgra'), data: new Uint8Array(buf.getMappedRange().slice(0)) }; buf.unmap(); buf.destroy(); this._reading = false; if (this.offscreen) this._paintDebug(); }).catch(() => { this._reading = false; });
  }
  _paintDebug() {
    const r = this._read, img = new ImageData(r.w, r.h);
    for (let y = 0; y < r.h; y++) img.data.set(r.data.subarray(y * r.bpr, y * r.bpr + r.w * 4), y * r.w * 4);
    if (r.bgra) for (let i = 0; i < img.data.length; i += 4) { const t = img.data[i]; img.data[i] = img.data[i + 2]; img.data[i + 2] = t; }
    this.paint.putImageData(img, 0, 0); this._wantRead = true;
  }
  // fila de píxeles (RGBA premultiplicado, y = desde abajo) de lo que ve el usuario: lienzo de arriba SOBRE el de abajo
  readRow(x, y, w) {
    const top = super.readRow(x, y, w);
    if (!this.hybrid) return top;
    this._wantRead = true;
    const r = this._read; if (!r) return top;
    const row = r.h - 1 - y;
    if (row < 0 || row >= r.h) return top;
    const out = new Uint8Array(top);
    for (let i = 0; i < w; i++) {
      const j = row * r.bpr + (x + i) * 4; if (x + i >= r.w) break;
      const a = top[i * 4 + 3] / 255, c = r.bgra ? [r.data[j + 2], r.data[j + 1], r.data[j]] : [r.data[j], r.data[j + 1], r.data[j + 2]], al = r.data[j + 3];
      for (let k = 0; k < 3; k++) out[i * 4 + k] = Math.min(255, top[i * 4 + k] + c[k] * (1 - a));
      out[i * 4 + 3] = Math.min(255, top[i * 4 + 3] + al * (1 - a));
    }
    return out;
  }
  dispose() { this._cache.forEach((c) => { c.vb.destroy(); c.ib.destroy(); }); this._cache.clear(); this.gpu?.canvas.remove(); super.dispose(); }
}
