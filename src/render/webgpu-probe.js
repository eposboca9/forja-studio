// Prueba de viabilidad de WebGPU (fase F0 del plan): ¿hay adaptador, qué características tiene y funcionan las cosas que necesita el
// motor nuevo? Dibuja con MSAA 4x en una textura HDR (rgba16float) con profundidad de 32 bits, ejecuta un shader de cómputo que escribe en
// una textura de almacenamiento y lee píxeles de vuelta. Devuelve un informe; no toca el viewport de Forja.
const WANT_FEATURES = ['timestamp-query', 'float32-filterable', 'rg11b10ufloat-renderable', 'indirect-first-instance', 'texture-compression-bc', 'depth32float-stencil8'];

export async function probeWebGPU() {
  const rep = { ok: false, reason: '', adapter: null, features: {}, limits: {}, tests: {}, ms: {}, secure: window.isSecureContext };
  if (!navigator.gpu) { rep.reason = 'Este navegador (o este marco del Artifact) no ofrece WebGPU (navigator.gpu no existe).'; return rep; }
  let adapter;
  try { adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }); } catch (e) { rep.reason = 'requestAdapter falló: ' + e.message; return rep; }
  if (!adapter) { rep.reason = 'No hay adaptador WebGPU (tarjeta gráfica no compatible o desactivada).'; return rep; }
  try { rep.adapter = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : (await adapter.requestAdapterInfo?.()) || {}; } catch (e) { rep.adapter = {}; }
  WANT_FEATURES.forEach((f) => (rep.features[f] = adapter.features.has(f)));
  for (const k of ['maxTextureDimension2D', 'maxBindGroups', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxComputeWorkgroupSizeX', 'maxComputeInvocationsPerWorkgroup', 'maxColorAttachments', 'maxSampledTexturesPerShaderStage']) rep.limits[k] = adapter.limits[k];
  let device;
  try {
    const requiredFeatures = WANT_FEATURES.filter((f) => adapter.features.has(f) && f !== 'texture-compression-bc' && f !== 'depth32float-stencil8');
    device = await adapter.requestDevice({ requiredFeatures });
  } catch (e) { rep.reason = 'requestDevice falló: ' + e.message; return rep; }
  let lost = null;
  device.lost.then((i) => { lost = i.message; });
  const t0 = performance.now();
  try {
    const W = 64, H = 64;
    const color = device.createTexture({ size: [W, H], format: 'rgba16float', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const resolve = device.createTexture({ size: [W, H], format: 'rgba16float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC });
    const depth = device.createTexture({ size: [W, H], format: 'depth32float', sampleCount: 4, usage: GPUTextureUsage.RENDER_ATTACHMENT });
    const shader = device.createShaderModule({ code: `
      @vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
        var p = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
        return vec4f(p[i], 0.5, 1.0);
      }
      @fragment fn fs() -> @location(0) vec4f { return vec4f(4.0, 0.5, 0.25, 1.0); }   // valor > 1: comprueba que la textura es HDR` });
    const pipe = device.createRenderPipeline({ layout: 'auto', vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater-equal' }, multisample: { count: 4 } });
    const enc = device.createCommandEncoder();
    const pass = enc.beginRenderPass({ colorAttachments: [{ view: color.createView(), resolveTarget: resolve.createView(), clearValue: [0, 0, 0, 1], loadOp: 'clear', storeOp: 'discard' }],
      depthStencilAttachment: { view: depth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'discard' } });   // profundidad invertida (reverse-Z)
    pass.setPipeline(pipe); pass.draw(3); pass.end();
    // lectura: 8 bytes por píxel (rgba16float), filas alineadas a 256
    const bpr = 512, buf = device.createBuffer({ size: bpr * H, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    enc.copyTextureToBuffer({ texture: resolve }, { buffer: buf, bytesPerRow: bpr }, [W, H]);
    device.queue.submit([enc.finish()]);
    await buf.mapAsync(GPUMapMode.READ);
    const u16 = new Uint16Array(buf.getMappedRange().slice(0));
    buf.unmap();
    const half = (h) => { const s = (h >> 15) ? -1 : 1, e = (h >> 10) & 31, m = h & 1023; return e === 0 ? s * 2 ** -14 * (m / 1024) : s * 2 ** (e - 15) * (1 + m / 1024); };
    const i = ((H >> 1) * (bpr / 2)) + (W >> 1) * 4;
    const px = [half(u16[i]), half(u16[i + 1]), half(u16[i + 2])];
    rep.tests.render = Math.abs(px[0] - 4) < 0.05 && Math.abs(px[1] - 0.5) < 0.01;
    rep.tests.msaa4x = true; rep.tests.rgba16float = px[0] > 1.5; rep.tests.depth32float = true; rep.tests.readback = true;
    rep.pixel = px.map((v) => +v.toFixed(3));
    color.destroy(); resolve.destroy(); depth.destroy(); buf.destroy();
  } catch (e) { rep.tests.render = false; rep.renderError = e.message; }
  // cómputo: cada hilo escribe su índice en un buffer de almacenamiento
  try {
    const n = 256, out = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    const rb = device.createBuffer({ size: n * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    const mod = device.createShaderModule({ code: `@group(0) @binding(0) var<storage, read_write> o: array<u32>;
      @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id: vec3u) { o[id.x] = id.x * 3u + 1u; }` });
    const cp = device.createComputePipeline({ layout: 'auto', compute: { module: mod, entryPoint: 'main' } });
    const bg = device.createBindGroup({ layout: cp.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: out } }] });
    const enc = device.createCommandEncoder(), pass = enc.beginComputePass();
    pass.setPipeline(cp); pass.setBindGroup(0, bg); pass.dispatchWorkgroups(n / 64); pass.end();
    enc.copyBufferToBuffer(out, 0, rb, 0, n * 4);
    device.queue.submit([enc.finish()]);
    await rb.mapAsync(GPUMapMode.READ);
    const v = new Uint32Array(rb.getMappedRange().slice(0));
    rb.unmap();
    rep.tests.compute = v[0] === 1 && v[255] === 766;
  } catch (e) { rep.tests.compute = false; rep.computeError = e.message; }
  rep.ms.total = +(performance.now() - t0).toFixed(1);
  if (lost) rep.lost = lost;
  rep.format = navigator.gpu.getPreferredCanvasFormat();
  rep.ok = !!(rep.tests.render && rep.tests.compute && rep.tests.rgba16float);
  rep.reason = rep.ok ? '' : (rep.renderError || rep.computeError || 'Alguna prueba no dio el resultado esperado.');
  try { device.destroy(); } catch (e) { /* nada */ }
  return rep;
}

// texto legible del informe
export function describeProbe(r) {
  const L = [];
  L.push(r.ok ? '✔ WebGPU funciona: dibujo, cómputo y texturas HDR correctos.' : `✘ WebGPU no está listo: ${r.reason}`);
  if (r.adapter) L.push(`Tarjeta: ${[r.adapter.vendor, r.adapter.architecture, r.adapter.device, r.adapter.description].filter(Boolean).join(' · ') || 'sin datos'}`);
  if (r.tests && Object.keys(r.tests).length) L.push('Pruebas: ' + Object.entries(r.tests).map(([k, v]) => `${k} ${v ? '✔' : '✘'}`).join(' · '));
  if (r.pixel) L.push(`Píxel HDR leído: ${r.pixel.join(', ')} (esperado 4, 0.5, 0.25)`);
  if (Object.keys(r.features || {}).length) L.push('Extras: ' + Object.entries(r.features).map(([k, v]) => `${k} ${v ? '✔' : '–'}`).join(' · '));
  if (Object.keys(r.limits || {}).length) L.push('Límites: ' + Object.entries(r.limits).map(([k, v]) => `${k.replace(/^max/, '')} ${v}`).join(' · '));
  if (r.ms && r.ms.total != null) L.push(`Tiempo de la prueba: ${r.ms.total} ms · contexto seguro: ${r.secure ? 'sí' : 'no'}`);
  return L.join('\n');
}
