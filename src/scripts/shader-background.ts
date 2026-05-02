import * as THREE from 'three';
import swissShader from './shaders/swiss.glsl?raw';
import { makeFontAtlas, whenFontReady } from './font-atlas';
import { GridCA, GRID_W, GRID_H } from './grid-ca';

const TICK_DURATION_MS = 700;

const SHADERS: Record<string, string> = {
  swiss: swissShader,
  plasma: `
    precision highp float;
    uniform float uTime;
    uniform vec2 uResolution;
    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      float t = uTime * 0.3;
      float v = sin(uv.x * 8.0 + t)
              + sin(uv.y * 6.0 - t)
              + sin((uv.x + uv.y) * 5.0 + t);
      vec3 col = 0.5 + 0.5 * cos(vec3(0.0, 2.0, 4.0) + v);
      gl_FragColor = vec4(col, 1.0);
    }
  `,
  noise: `
    precision highp float;
    uniform float uTime;
    uniform vec2 uResolution;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      vec2 uv = gl_FragCoord.xy / uResolution.xy;
      float n = hash(floor(uv * 200.0) + floor(uTime * 10.0));
      gl_FragColor = vec4(vec3(n) * 0.4, 1.0);
    }
  `,
};

const SHADERS_NEEDING_ATLAS = new Set(['swiss']);

export async function mountShaderBackground(canvas: HTMLCanvasElement, shaderKey: string) {
  const fragmentShader = SHADERS[shaderKey] ?? SHADERS.plasma;

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const uniforms: Record<string, { value: unknown }> = {
    uTime: { value: 0 },
    uResolution: { value: new THREE.Vector2() },
    uObjectDensity: { value: 0.5 },
  };

  let atlasTexture: THREE.CanvasTexture | null = null;
  let ca: GridCA | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;
  if (SHADERS_NEEDING_ATLAS.has(shaderKey)) {
    await whenFontReady('Space Grotesk', '700', 64);
    atlasTexture = makeFontAtlas();
    uniforms.uAtlas = { value: atlasTexture };

    ca = new GridCA();
    uniforms.uState = { value: ca.texture };
    uniforms.uGridSize = { value: new THREE.Vector2(GRID_W, GRID_H) };
    tickTimer = setInterval(() => ca!.tick(), TICK_DURATION_MS);
  }

  // object_density driver:
  //  - desktop / fine pointer: mouse X, mapped 1..99 → 0.01..0.99
  //  - touch / coarse pointer: auto-oscillates between ~0.10 and ~0.95
  const isTouch =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches;

  let densityTarget = 0.5;
  let onMouseMove: ((e: MouseEvent) => void) | null = null;

  if (!isTouch) {
    onMouseMove = (e: MouseEvent) => {
      const xNorm = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
      const scale = Math.round(1 + xNorm * 98); // 1..99
      densityTarget = scale / 100; // 0.01..0.99
    };
    window.addEventListener('mousemove', onMouseMove, { passive: true });
  }

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: `void main() { gl_Position = vec4(position, 1.0); }`,
    fragmentShader,
  });

  const geometry = new THREE.PlaneGeometry(2, 2);
  scene.add(new THREE.Mesh(geometry, material));

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    (uniforms.uResolution.value as THREE.Vector2).set(w, h);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  const start = performance.now();
  let raf = 0;
  const tick = () => {
    const t = (performance.now() - start) / 1000;
    uniforms.uTime.value = t;

    if (isTouch) {
      // Slow sine sweep on touch devices: 0.10..0.95 over ~12s
      densityTarget = 0.525 + 0.425 * Math.sin(t * (Math.PI * 2 / 12));
    }

    const cur = uniforms.uObjectDensity.value as number;
    uniforms.uObjectDensity.value = cur + (densityTarget - cur) * 0.12;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(raf);
    if (tickTimer) clearInterval(tickTimer);
    ro.disconnect();
    if (onMouseMove) window.removeEventListener('mousemove', onMouseMove);
    renderer.dispose();
    geometry.dispose();
    material.dispose();
    atlasTexture?.dispose();
    ca?.texture.dispose();
  };
}
