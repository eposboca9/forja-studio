// Oclusión ambiental (AO) sobre el viewport, como el de Plasticity: asienta cavidades, perforaciones y la unión con el suelo.
// Usa GTAO de three (sin EffectComposer): se dibuja la vista normal, y después este pase multiplica el resultado por la
// oclusión directamente sobre el lienzo, dentro del recuadro de cada vista (viewport y scissor ya puestos por renderPane).
import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';

export function createAO(renderer, scene, camera) {
  const pass = new GTAOPass(scene, camera, 64, 64);
  // Normales para la oclusión: se sacan de la propia geometría que se ve (derivadas de la posición en pantalla), siempre hacia la
  // cámara. Las superficies de Forja se dibujan a doble cara y el giro de sus triángulos varía, así que ni las normales de vértice
  // ni el giro sirven.
  pass.normalMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide, blending: THREE.NoBlending,
    vertexShader: 'varying vec3 vP; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vP; void main() { vec3 c = cross(dFdx(vP), dFdy(vP)); vec3 n = dot(c, c) > 1e-18 ? normalize(c) : vec3(0.0, 0.0, 1.0); gl_FragColor = vec4(n * 0.5 + 0.5, 1.0); }',
  });
  pass.updateGtaoMaterial({ radius: 0.7, distanceExponent: 1.4, thickness: 1.5, scale: 1.7, samples: 14, distanceFallOff: 1, screenSpaceRadius: false });
  pass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 });
  pass.blendIntensity = 2.1;
  // El pase de normales solo debe ver superficies. GTAOPass solo esconde Line y Points, pero las líneas gruesas de Forja (Line2 y
  // LineSegments2) son mallas: dibujadas con el material de normales salen como planos sueltos en el origen (la raya negra que
  // aparecía dentro de los objetos). Se esconden también ellas, los sprites y lo que no se pinta (colorWrite apagado).
  pass.overrideVisibility = function () {
    const cache = this._visibilityCache;
    this.scene.traverse((o) => {
      cache.set(o, o.visible);
      const m = o.material;
      if (o.isPoints || o.isLine || o.isLineSegments || o.isLine2 || o.isLineSegments2 || o.isSprite || (m && (m.isLineMaterial || m.isSpriteMaterial || (m.colorWrite === false && !o.userData.gpuSurf) || m.visible === false)) || o.userData.noAO) o.visible = false;
    });
  };
  // Mezcla "por encima": en el motor híbrido las superficies están en el lienzo de abajo (WebGPU), así que multiplicar el lienzo de WebGL no oscurece nada.
  // Se dibuja negro con alfa = 1 - oclusión (C' = C·(1-a)); sobre píxeles opacos da lo mismo que multiplicar, y también oscurece lo que hay debajo.
  const over = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, intensity: { value: 1 } },
    vertexShader: pass.blendMaterial.vertexShader,
    fragmentShader: 'uniform float intensity; uniform sampler2D tDiffuse; varying vec2 vUv; void main() { float a = 1.0 - mix(1.0, texture2D(tDiffuse, vUv).r, intensity); gl_FragColor = vec4(0.0, 0.0, 0.0, clamp(a, 0.0, 0.92)); }',
    transparent: true, depthTest: false, depthWrite: false, blending: THREE.CustomBlending,
    blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendEquation: THREE.AddEquation,
    blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
  let w = 0, h = 0, lastKey = '';
  const HALF = 0.5;   // el cálculo va a media resolución (4 veces menos píxeles); la mezcla final sí es a resolución completa
  return {
    pass,
    set intensity(v) { pass.blendIntensity = v; },
    set radius(v) { pass.updateGtaoMaterial({ radius: v }); lastKey = ''; },
    invalidate() { lastKey = ''; },
    // Dibuja la oclusión sobre lo que ya hay en la vista actual. `key` identifica la vista (cámara + escena): si no cambió,
    // se reutiliza el resultado y solo se hace la mezcla (barata). Con `moving` no se calcula nada (la vista se está moviendo).
    apply(paneW, paneH, key, moving, overMode = false) {
      if (moving) return false;
      const dpr = renderer.getPixelRatio(), W = Math.max(8, Math.round(paneW * dpr * HALF)), H = Math.max(8, Math.round(paneH * dpr * HALF));
      if (W !== w || H !== h) { pass.setSize(W, H); w = W; h = H; lastKey = ''; }
      if (key !== lastKey) { lastKey = key; compute(); }
      const bm = overMode ? over : pass.blendMaterial;
      bm.uniforms.intensity.value = pass.blendIntensity;
      bm.uniforms.tDiffuse.value = pass.pdRenderTarget.texture;
      pass.renderPass(renderer, bm, null);
      return true;
    },
  };
  function compute() {
    const persp = camera.isPerspectiveCamera ? 1 : 0;
    if (pass.gtaoMaterial.defines.PERSPECTIVE_CAMERA !== persp) { pass.gtaoMaterial.defines.PERSPECTIVE_CAMERA = persp; pass.gtaoMaterial.needsUpdate = true; }
    if (pass.pdMaterial.defines.PERSPECTIVE_CAMERA !== persp) { pass.pdMaterial.defines.PERSPECTIVE_CAMERA = persp; pass.pdMaterial.needsUpdate = true; }
    const gm = pass.gtaoMaterial.uniforms, pm = pass.pdMaterial.uniforms;
    // 1) normales y profundidad de la escena (solo mallas)
    pass.overrideVisibility();
    pass.renderOverride(renderer, pass.normalMaterial, pass.normalRenderTarget, 0x7777ff, 1.0);
    pass.restoreVisibility();
    // 2) oclusión
    gm.cameraNear.value = camera.near; gm.cameraFar.value = camera.far;
    gm.cameraProjectionMatrix.value.copy(camera.projectionMatrix);
    gm.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    gm.cameraWorldMatrix.value.copy(camera.matrixWorld);
    pass.renderPass(renderer, pass.gtaoMaterial, pass.gtaoRenderTarget, 0xffffff, 1.0);
    // 3) quitar el ruido
    pm.cameraProjectionMatrixInverse.value.copy(camera.projectionMatrixInverse);
    pass.renderPass(renderer, pass.pdMaterial, pass.pdRenderTarget, 0xffffff, 1.0);
  }
}
