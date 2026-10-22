// Núcleo CAD de OpenCascade (replicad-opencascadejs, LGPL-2.1), compartido por Forge y el Redondeo.
// Se carga una sola vez y solo cuando hace falta (10 MB): primero el .wasm que va con la página, si no, el de jsdelivr.
const OCC_VER = '0.20.2';
const OCC_JS = `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@${OCC_VER}/src/replicad_single.js`;
const OCC_WASM = ['src/forge/replicad_single.wasm', `https://cdn.jsdelivr.net/npm/replicad-opencascadejs@${OCC_VER}/src/replicad_single.wasm`];
let occPromise = null;
async function fetchBytes(url, progress) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const total = +r.headers.get('content-length') || 0;
  if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
  const rd = r.body.getReader(), parts = [];
  let got = 0;
  for (;;) {
    const { done, value } = await rd.read();
    if (done) break;
    parts.push(value); got += value.length; progress(Math.min(1, got / total));
  }
  const out = new Uint8Array(got);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
export function getOCC(progress = () => {}) {
  if (!occPromise) {
    occPromise = (async () => {
      const mod = await import(OCC_JS);
      let bin = null, err = null;
      for (const u of OCC_WASM) { try { bin = await fetchBytes(u, progress); break; } catch (e) { err = e; } }
      if (!bin) throw new Error('no se pudo cargar el núcleo CAD (' + (err && err.message ? err.message : err) + ')');
      return mod.default({ wasmBinary: bin });
    })();
    occPromise.catch(() => { occPromise = null; });
  }
  return occPromise;
}
