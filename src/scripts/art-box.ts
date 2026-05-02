import * as THREE from 'three';

export function mountArtBox(canvas: HTMLCanvasElement, textureUrls: string[]) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.5, 2.0, 3.0);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dir = new THREE.DirectionalLight(0xffffff, 0.8);
  dir.position.set(3, 5, 4);
  scene.add(dir);

  const loader = new THREE.TextureLoader();
  const faces = Array.from({ length: 6 }, (_, i) => textureUrls[i % textureUrls.length]);
  const materials = faces.map((url) => {
    const map = url ? loader.load(url) : null;
    return new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : 0x222222 });
  });

  const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5), materials);
  scene.add(cube);

  const resize = () => {
    const { clientWidth: w, clientHeight: h } = canvas;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);

  let raf = 0;
  const tick = () => {
    cube.rotation.x += 0.004;
    cube.rotation.y += 0.006;
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    renderer.dispose();
    cube.geometry.dispose();
    materials.forEach((m) => {
      m.map?.dispose();
      m.dispose();
    });
  };
}
