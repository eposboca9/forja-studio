// Entorno de estudio PROCEDURAL para el motor WebGPU (fase F3a de docs/render-webgpu.md).
// Un cubo HDR (rgba16float, 256 px por cara, 7 niveles) con un estudio oscuro y cajas de luz rectangulares (arriba, dos laterales,
// contraluz y relleno bajo). Se genera en la tarjeta gráfica con shaders de cómputo:
//   1) gen: pinta el nivel 0 de la textura base con la función studio(dirección);
//   2) down: baja los niveles siguientes (promedio 2×2) para que el muestreo por importancia no tenga ruido;
//   3) filtro GGX: cada nivel m de la textura filtrada es el entorno desenfocado con rugosidad m/6 (split-sum de Karis).
// El nivel 0 filtrado = reflejo nítido; el último = luz difusa. Más adelante: cargar un .hdr propio (mismo filtro) y editar las cajas.
export const ENV_SIZE = 256, ENV_MIPS = 7;

const COMMON = `
const PI = 3.14159265359;
fn faceDir(face: u32, uv: vec2f) -> vec3f {
  var d: vec3f;
  switch (face) {
    case 0u: { d = vec3f(1.0, -uv.y, -uv.x); }
    case 1u: { d = vec3f(-1.0, -uv.y, uv.x); }
    case 2u: { d = vec3f(uv.x, 1.0, uv.y); }
    case 3u: { d = vec3f(uv.x, -1.0, -uv.y); }
    case 4u: { d = vec3f(uv.x, -uv.y, 1.0); }
    default: { d = vec3f(-uv.x, -uv.y, -1.0); }
  }
  return normalize(d);
}`;

const GEN = `${COMMON}
@group(0) @binding(0) var dst: texture_storage_2d_array<rgba16float, write>;
// caja de luz: centro c (unitario), ejes ex / ey del plano, medias anchuras w, h. El borde es muy suave y el centro más brillante que los
// extremos (como un softbox real): así los reflejos largos tienen degradado y no se queman a blanco plano
fn box(d: vec3f, c: vec3f, ex: vec3f, ey: vec3f, w: f32, h: f32, col: vec3f) -> vec3f {
  let t = dot(d, c);
  if (t <= 0.05) { return vec3f(0.0); }
  let p = d / t - c;
  let u = abs(dot(p, ex)) / w; let v = abs(dot(p, ey)) / h;
  let m = (1.0 - smoothstep(0.55, 1.0, u)) * (1.0 - smoothstep(0.55, 1.0, v));
  let core = 0.55 + 0.45 * (1.0 - smoothstep(0.0, 1.0, max(u, v)));
  return col * m * core;
}
fn studio(d: vec3f) -> vec3f {
  var c = mix(vec3f(0.004, 0.005, 0.008), vec3f(0.035, 0.04, 0.055), smoothstep(-0.3, 1.0, d.y));
  if (d.y < 0.0) { c = vec3f(0.005, 0.005, 0.006) * (1.0 + 2.0 * d.y); }
  c += box(d, normalize(vec3f(0.0, 1.0, 0.12)), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), 1.0, 0.7, vec3f(3.6, 3.6, 3.7));            // caja de arriba
  c += box(d, normalize(vec3f(-1.0, 0.25, 0.35)), vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), 0.55, 1.0, vec3f(3.4, 3.4, 3.5));       // lateral izquierdo
  c += box(d, normalize(vec3f(1.0, 0.2, -0.25)), vec3f(0.0, 0.0, 1.0), vec3f(0.0, 1.0, 0.0), 0.5, 0.95, vec3f(2.2, 2.6, 3.4));       // lateral derecho (frío)
  c += box(d, normalize(vec3f(0.25, 0.45, -1.0)), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), 1.0, 0.25, vec3f(6.0, 5.6, 5.2));       // contraluz
  c += box(d, normalize(vec3f(-0.1, 0.1, 1.0)), vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), 0.6, 0.14, vec3f(1.2, 1.2, 1.3));        // relleno de frente
  return c;
}
@compute @workgroup_size(8, 8, 1) fn gen(@builtin(global_invocation_id) id: vec3u) {
  let s = textureDimensions(dst).xy;
  if (id.x >= s.x || id.y >= s.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(s) * 2.0 - 1.0;
  textureStore(dst, id.xy, id.z, vec4f(studio(faceDir(id.z, uv)), 1.0));
}`;

const GEN_EQ = `${COMMON}
@group(0) @binding(0) var dst: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(1) var eq: texture_2d<f32>;
@group(0) @binding(2) var eqS: sampler;
@compute @workgroup_size(8, 8, 1) fn gen(@builtin(global_invocation_id) id: vec3u) {
  let s = textureDimensions(dst).xy;
  if (id.x >= s.x || id.y >= s.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(s) * 2.0 - 1.0;
  let d = faceDir(id.z, uv);
  let u = atan2(d.z, d.x) / (2.0 * PI) + 0.5;
  let v = acos(clamp(d.y, -1.0, 1.0)) / PI;
  textureStore(dst, id.xy, id.z, vec4f(min(textureSampleLevel(eq, eqS, vec2f(u, v), 0.0).rgb, vec3f(60.0)), 1.0));
}`;

const DOWN = `
@group(0) @binding(0) var src: texture_2d_array<f32>;
@group(0) @binding(1) var dst: texture_storage_2d_array<rgba16float, write>;
@compute @workgroup_size(8, 8, 1) fn down(@builtin(global_invocation_id) id: vec3u) {
  let s = textureDimensions(dst).xy;
  if (id.x >= s.x || id.y >= s.y) { return; }
  let b = vec2i(id.xy) * 2; let l = i32(id.z);
  let c = textureLoad(src, b, l, 0) + textureLoad(src, b + vec2i(1, 0), l, 0) + textureLoad(src, b + vec2i(0, 1), l, 0) + textureLoad(src, b + vec2i(1, 1), l, 0);
  textureStore(dst, id.xy, id.z, c * 0.25);
}`;

const FILTER = `${COMMON}
struct P { rough: f32, level: f32, pad0: f32, pad1: f32 };
@group(0) @binding(0) var envT: texture_cube<f32>;
@group(0) @binding(1) var envS: sampler;
@group(0) @binding(2) var dst: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(3) var<uniform> prm: P;
fn radicalInverse(i: u32) -> f32 { return f32(reverseBits(i)) * 2.3283064365386963e-10; }
fn ggxD(noh: f32, a: f32) -> f32 { let a2 = a * a; let d = noh * noh * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }
@compute @workgroup_size(8, 8, 1) fn filt(@builtin(global_invocation_id) id: vec3u) {
  let s = textureDimensions(dst).xy;
  if (id.x >= s.x || id.y >= s.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(s) * 2.0 - 1.0;
  let n = faceDir(id.z, uv);
  if (prm.rough < 0.001) { textureStore(dst, id.xy, id.z, vec4f(textureSampleLevel(envT, envS, n, 0.0).rgb, 1.0)); return; }
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tx = normalize(cross(up, n)); let ty = cross(n, tx);
  let a = prm.rough * prm.rough;
  let NUM = 160u;
  let saTexel = 4.0 * PI / (6.0 * f32(${ENV_SIZE}) * f32(${ENV_SIZE}));
  var acc = vec3f(0.0); var wsum = 0.0;
  for (var i = 0u; i < NUM; i = i + 1u) {
    let xi = vec2f((f32(i) + 0.5) / f32(NUM), radicalInverse(i));
    let phi = 2.0 * PI * xi.x;
    let cosT = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sinT = sqrt(max(0.0, 1.0 - cosT * cosT));
    let h = tx * (sinT * cos(phi)) + ty * (sinT * sin(phi)) + n * cosT;
    let l = 2.0 * dot(n, h) * h - n;
    let nol = dot(n, l);
    if (nol > 0.0) {
      let pdf = ggxD(cosT, a) / 4.0 + 1e-4;
      let saSample = 1.0 / (f32(NUM) * pdf);
      let lod = max(0.0, 0.5 * log2(saSample / saTexel) + 1.0);
      acc += textureSampleLevel(envT, envS, l, lod).rgb * nol;
      wsum += nol;
    }
  }
  textureStore(dst, id.xy, id.z, vec4f(acc / max(wsum, 1e-4), 1.0));
}`;

// Devuelve { view (cubo con mips para muestrear), maxMip }
export function buildStudioEnv(device, hdr = null) {   // hdr = { w, h, data: Uint16Array (rgba16float) } o null = estudio procedural
  const mk = (usage) => device.createTexture({ size: [ENV_SIZE, ENV_SIZE, 6], format: 'rgba16float', mipLevelCount: ENV_MIPS, usage });
  const base = mk(GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING);
  const pf = mk(GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING);
  const arr = (t, m, usage) => t.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 });
  const enc = device.createCommandEncoder();
  const run = (pipe, entries, w, h) => {
    const p = enc.beginComputePass();
    p.setPipeline(pipe); p.setBindGroup(0, device.createBindGroup({ layout: pipe.getBindGroupLayout(0), entries }));
    p.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), 6); p.end();
  };
  const gen = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: GEN }), entryPoint: 'gen' } });
  const down = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: DOWN }), entryPoint: 'down' } });
  const filt = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: FILTER }), entryPoint: 'filt' } });
  let eqTex = null;
  if (hdr) {
    eqTex = device.createTexture({ size: [hdr.w, hdr.h], format: 'rgba16float', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST });
    device.queue.writeTexture({ texture: eqTex }, hdr.data, { bytesPerRow: hdr.w * 8 }, [hdr.w, hdr.h]);
    const eqS = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge' });
    const genEq = device.createComputePipeline({ layout: 'auto', compute: { module: device.createShaderModule({ code: GEN_EQ }), entryPoint: 'gen' } });
    run(genEq, [{ binding: 0, resource: arr(base, 0) }, { binding: 1, resource: eqTex.createView() }, { binding: 2, resource: eqS }], ENV_SIZE, ENV_SIZE);
  } else run(gen, [{ binding: 0, resource: arr(base, 0) }], ENV_SIZE, ENV_SIZE);
  for (let m = 1; m < ENV_MIPS; m++) { const s = ENV_SIZE >> m; run(down, [{ binding: 0, resource: arr(base, m - 1) }, { binding: 1, resource: arr(base, m) }], s, s); }
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const baseCube = base.createView({ dimension: 'cube' });
  for (let m = 0; m < ENV_MIPS; m++) {
    const s = ENV_SIZE >> m, ub = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(ub, 0, new Float32Array([m / (ENV_MIPS - 1), m, 0, 0]));
    run(filt, [{ binding: 0, resource: baseCube }, { binding: 1, resource: sampler }, { binding: 2, resource: arr(pf, m) }, { binding: 3, resource: { buffer: ub } }], s, s);
  }
  device.queue.submit([enc.finish()]);
  return { view: pf.createView({ dimension: 'cube' }), sampler, maxMip: ENV_MIPS - 1, textures: [base, pf, eqTex].filter(Boolean) };
}
