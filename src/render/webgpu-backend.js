// Backend HÍBRIDO de dos lienzos (fases F2 + F3 del plan, docs/render-webgpu.md).
//   · Lienzo de ABAJO (WebGPU): dibuja las superficies del módulo VISU con PBR (GGX + barniz) iluminadas por un estudio HDR procedural (webgpu-env.js),
//     MSAA 4x, ACES. Los módulos de modelado (Forja, Cebra, Curvatura…) siguen enteros en WebGL: allí el lienzo de abajo queda vacío.
//   · Lienzo de ARRIBA (WebGL, el de siempre, transparente): dibuja todo lo demás (líneas, CVs, gizmo, cubo, sombra del suelo) y las superficies
//     solo en profundidad (colorWrite = false), así lo que está detrás de una superficie queda tapado igual que antes.
// La cámara, la selección, el snap y las herramientas no cambian: el backend solo recibe lo que ya dibujaba main.js.
// Si WebGPU no existe o falla, el backend se queda en modo clásico (hybrid = false) y se explica el motivo.
import * as THREE from 'three';
import { WebGLBackend } from './webgl-backend.js';
import { buildStudioEnv } from './webgpu-env.js';

const WGSL = `
struct Draw { mvp: mat4x4f, model: mat4x4f, color: vec4f, pbr: vec4f };
struct Frame { cam: vec4f, misc: vec4f };      // misc: exposición, intensidad del entorno, nivel máximo de mip, giro del entorno (radianes)
@group(0) @binding(0) var<uniform> d: Draw;
@group(1) @binding(0) var<uniform> fr: Frame;
@group(1) @binding(1) var envT: texture_cube<f32>;
@group(1) @binding(2) var envS: sampler;
struct VO { @builtin(position) pos: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f };
@vertex fn vs(@location(0) p: vec3f, @location(1) n: vec3f) -> VO {
  var o: VO;
  o.pos = d.mvp * vec4f(p, 1.0);
  o.wp = (d.model * vec4f(p, 1.0)).xyz;
  o.n = (d.model * vec4f(n, 0.0)).xyz;
  return o;
}
fn aces(x: vec3f) -> vec3f { return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3f(0.0), vec3f(1.0)); }
// aproximación analítica de la tabla BRDF (Karis): escala y sesgo de F0
fn envBRDF(noV: f32, rough: f32) -> vec2f {
  let c0 = vec4f(-1.0, -0.0275, -0.572, 0.022); let c1 = vec4f(1.0, 0.0425, 1.04, -0.04);
  let r = rough * c0 + c1;
  let a004 = min(r.x * r.x, exp2(-9.28 * noV)) * r.x + r.y;
  return vec2f(-1.04, 1.04) * a004 + r.zw;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  var n = normalize(i.n);
  let v = normalize(fr.cam.xyz - i.wp);
  if (dot(n, v) < 0.0) { n = -n; }                       // dos caras: siempre la normal que mira al observador
  let noV = max(dot(n, v), 1e-3);
  let base = d.color.rgb; let metal = d.pbr.x;
  let rough = clamp(d.pbr.y, 0.045, 1.0); let cc = d.pbr.z; let ccr = clamp(d.pbr.w, 0.045, 1.0);
  let f0 = mix(vec3f(0.04), base, metal);
  let cs = cos(fr.misc.w); let sn = sin(fr.misc.w);
  let r0 = reflect(-v, n);
  let r = vec3f(r0.x * cs - r0.z * sn, r0.y, r0.x * sn + r0.z * cs);        // el entorno gira alrededor del eje vertical
  let nr = vec3f(n.x * cs - n.z * sn, n.y, n.x * sn + n.z * cs);
  let mm = fr.misc.z;
  let spec = textureSampleLevel(envT, envS, r, rough * mm).rgb;
  let irr = textureSampleLevel(envT, envS, nr, mm * 0.62).rgb * 0.8;   // difuso: entorno poco desenfocado, así la luz tiene dirección (lado iluminado / lado en sombra)
  let ab = envBRDF(noV, rough);
  var col = (base * (1.0 - metal) * irr + spec * (f0 * ab.x + ab.y)) * fr.misc.y;
  // barniz: capa transparente de F0 = 0.04 con su propia rugosidad; atenúa lo de debajo
  let fc = (0.04 + 0.96 * pow(1.0 - noV, 5.0)) * cc;
  let coat = textureSampleLevel(envT, envS, r, ccr * mm).rgb * fc * fr.misc.y;
  // luz principal FIJA EN EL MUNDO (gira solo con el "giro del entorno"): sombra y brillo recorren la pieza al mover la cámara
  let ld = normalize(vec3f(-0.5, 0.78, 0.38));
  let lw = vec3f(ld.x * cs + ld.z * sn, ld.y, -ld.x * sn + ld.z * cs);
  let nol = max(dot(n, lw), 0.0);
  let hv = normalize(lw + v);
  let noh = max(dot(n, hv), 0.0); let voh = max(dot(v, hv), 0.0);
  let a = rough * rough; let a2 = a * a;
  let dd = noh * noh * (a2 - 1.0) + 1.0;
  let dg = a2 / (3.14159265 * dd * dd);
  let kk = a * 0.5;
  let vis = 0.25 / max((nol * (1.0 - kk) + kk) * (noV * (1.0 - kk) + kk), 1e-3);
  let fl = f0 + (vec3f(1.0) - f0) * pow(1.0 - voh, 5.0);
  let keyI = 2.4 * fr.misc.y;
  col += (base * (1.0 - metal) * nol / 3.14159265 * 1.6 + dg * vis * fl * nol) * keyI;
  let ac = ccr * ccr; let ac2 = ac * ac; let dc = noh * noh * (ac2 - 1.0) + 1.0;
  col += vec3f(dg * 0.0 + (ac2 / (3.14159265 * dc * dc)) * 0.25 / max(nol * noV, 1e-3) * (0.04 + 0.96 * pow(1.0 - voh, 5.0)) * nol * cc) * keyI;
  col = col * (1.0 - fc) + coat;
  col = aces(col * fr.misc.x);
  let srgb = select(col * 12.92, 1.055 * pow(col, vec3f(1.0 / 2.4)) - 0.055, col > vec3f(0.0031308));
  return vec4f(srgb, 1.0);
}
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
    // sin z-index: crearía una capa por encima de la cabecera y taparía los menús; el orden lo da el DOM (WebGPU primero, WebGL después)
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
    device.onuncapturederror = (e) => { this.error = 'WebGPU: ' + e.error.message; console.warn(this.error); };
    const module = device.createShaderModule({ code: WGSL });
    const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform', hasDynamicOffset: true } }] });
    const bgl1 = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { viewDimension: 'cube', sampleType: 'float' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } }] });
    const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl, bgl1] });
    const pipe = device.createRenderPipeline({
      layout, vertex: { module, entryPoint: 'vs', buffers: [
        { arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] },
        { arrayStride: 12, attributes: [{ shaderLocation: 1, offset: 0, format: 'float32x3' }] }] },
      fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' }, multisample: { count: 4 },
    });
    const env = buildStudioEnv(device, this._pendingHdr || null); this._pendingHdr = null;
    const fbuf = device.createBuffer({ size: 32, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const bind1 = device.createBindGroup({ layout: bgl1, entries: [{ binding: 0, resource: { buffer: fbuf } }, { binding: 1, resource: env.view }, { binding: 2, resource: env.sampler }] });
    this.gpu = { device, canvas, context, format, pipe, bgl, bgl1, bind1, fbuf, env, ubuf: null, ucap: 0, bind: null, msaa: null, depth: null, w: 0, h: 0 };
  }
  // cambia el entorno: hdr = { w, h, data: Uint16Array rgba16float } o null para volver al estudio procedural
  setEnv(hdr) {
    const g = this.gpu; if (!g) { this._pendingHdr = hdr; return; }
    const old = g.env, env = buildStudioEnv(g.device, hdr);
    g.env = env;
    g.bind1 = g.device.createBindGroup({ layout: g.bgl1, entries: [{ binding: 0, resource: { buffer: g.fbuf } }, { binding: 1, resource: env.view }, { binding: 2, resource: env.sampler }] });
    old.textures.forEach((t) => t.destroy());
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
  beginFrame() { this._first = true; this._frame++; this._drew = false; }
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
    const nat = geo.attributes.normal;
    let narr = new Float32Array(pos.count * 3);
    if (nat) for (let i = 0; i < pos.count; i++) { narr[3 * i] = nat.getX(i); narr[3 * i + 1] = nat.getY(i); narr[3 * i + 2] = nat.getZ(i); }
    const nb = g.device.createBuffer({ size: Math.ceil(narr.byteLength / 4) * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST }); g.device.queue.writeBuffer(nb, 0, narr);
    c = { vb, nb, ib, count: ia.length, fmt: u32 ? 'uint32' : 'uint16', used: this._frame };
    this._cache.set(geo, c);
    return c;
  }
  _gpuPane(p) {
    const g = this.gpu, cam = this.ctx.camera, dpr = g.w / Math.max(1, this._w);
    const list = [];
    this.ctx.scene.traverseVisible((o) => { if (o.isMesh && o.userData.gpuSurf && o.layers.test(cam.layers)) list.push(o); });
    if (!list.length) return;   // este panel no usa WebGPU (modos clásicos): el lienzo de abajo queda transparente
    // uniformes por superficie: mvp, matriz del modelo, color base (lineal) y material (metal, rugosidad, barniz, rugosidad del barniz)
    if (list.length > g.ucap) {
      g.ubuf?.destroy(); g.ucap = Math.max(64, list.length * 2);
      g.ubuf = g.device.createBuffer({ size: g.ucap * STRIDE, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      g.bind = g.device.createBindGroup({ layout: g.bgl, entries: [{ binding: 0, resource: { buffer: g.ubuf, size: 160 } }] });
    }
    const VP = new THREE.Matrix4().multiplyMatrices(ZFIX, cam.projectionMatrix).multiply(cam.matrixWorldInverse), m = new THREE.Matrix4(), col = new THREE.Color();
    const data = new Float32Array(Math.max(1, list.length) * (STRIDE / 4));
    const draws = [];
    list.forEach((o) => {
      const b = this._buffers(o.geometry); if (!b) return;
      const k = draws.length, q = k * (STRIDE / 4);
      m.multiplyMatrices(VP, o.matrixWorld); data.set(m.elements, q);
      data.set(o.matrixWorld.elements, q + 16);
      col.setHex(o.userData.gpuColor ?? 0x888888);   // Color pasa de sRGB a lineal al guardarse
      data.set([col.r, col.g, col.b, 1], q + 32);
      data.set(o.userData.gpuPbr ?? [0, 0.6, 0, 0.1], q + 36);
      draws.push({ b, k });
    });
    if (draws.length) g.device.queue.writeBuffer(g.ubuf, 0, data.buffer, 0, draws.length * STRIDE);
    const ce = cam.matrixWorld.elements;
    g.device.queue.writeBuffer(g.fbuf, 0, new Float32Array([ce[12], ce[13], ce[14], 1, this.ctx.renderer.toneMappingExposure || 1, this.envIntensity ?? 1, g.env.maxMip, this.envRotation ?? 0]));
    const enc = g.device.createCommandEncoder(), first = this._first; this._first = false;
    const pass = enc.beginRenderPass({
      colorAttachments: [{ view: g.msaa.createView(), resolveTarget: this._tex().createView(), clearValue: [0, 0, 0, 0], loadOp: first ? 'clear' : 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: g.depth.createView(), depthClearValue: 1, depthLoadOp: first ? 'clear' : 'load', depthStoreOp: 'store' },
    });
    const vx = Math.round(p.x * dpr), vw = Math.max(1, Math.min(g.w - vx, Math.round(p.w * dpr))), vh = Math.min(g.h, Math.round(p.h * dpr));
    pass.setViewport(vx, g.h - vh, vw, vh, 0, 1); pass.setScissorRect(vx, g.h - vh, vw, vh);
    pass.setPipeline(g.pipe); pass.setBindGroup(1, g.bind1);
    for (const d of draws) { pass.setBindGroup(0, g.bind, [d.k * STRIDE]); pass.setVertexBuffer(0, d.b.vb); pass.setVertexBuffer(1, d.b.nb); pass.setIndexBuffer(d.b.ib, d.b.fmt); pass.drawIndexed(d.b.count); }
    pass.end();
    g.device.queue.submit([enc.finish()]);
    this._drew = true;
  }
  // si ningún panel usó WebGPU en este cuadro, se borra lo que quedó del anterior (el lienzo de abajo no puede enseñar imágenes viejas)
  _clear() {
    const g = this.gpu, enc = g.device.createCommandEncoder();
    enc.beginRenderPass({ colorAttachments: [{ view: g.msaa.createView(), resolveTarget: this._tex().createView(), clearValue: [0, 0, 0, 0], loadOp: 'clear', storeOp: 'discard' }] }).end();
    g.device.queue.submit([enc.finish()]);
  }
  // se llama al terminar el cuadro: libera lo que no se usa y, si adaptInk lo pidió, lee los píxeles del lienzo de abajo
  endFrame() {
    if (!this.hybrid || !this.gpu) return;
    if (!this._drew && this._hadDraw && this.gpu.msaa) { try { this._clear(); } catch (e) { /* sin lienzo todavía */ } }
    this._hadDraw = this._drew;
    if (this.offscreen && !this._reading && !this._read) this._wantRead = true;
    for (const [geo, c] of this._cache) if (this._frame - c.used > 90) { c.vb.destroy(); c.nb.destroy(); c.ib.destroy(); this._cache.delete(geo); }
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
  dispose() { this._cache.forEach((c) => { c.vb.destroy(); c.nb.destroy(); c.ib.destroy(); }); this._cache.clear(); this.gpu?.canvas.remove(); super.dispose(); }
}
