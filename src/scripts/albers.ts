// Albers' Squares — the sketch itself lives in bobbymeyer/albers-squares and is
// loaded from its deploy, so there is one copy of it rather than two that drift.
// That file defines window.albersSketch, an instance-mode factory, and leaves
// starting it to whoever loaded it: here that means one instance per visit to
// the post, torn down on client-side navigation. p5 and the sketch both load on
// demand, only on the page that has the #albers-container.

const P5_SRC = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js';
const SKETCH_SRC = 'https://bobbymeyer.github.io/albers-squares/sketch.js';

let p5Loading: Promise<void> | null = null;
let sketchLoading: Promise<void> | null = null;
let instance: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)));
    document.head.appendChild(script);
  });
}

function loadP5(): Promise<void> {
  p5Loading ??= loadScript(P5_SRC);
  return p5Loading;
}

function loadSketch(): Promise<void> {
  sketchLoading ??= loadScript(SKETCH_SRC);
  return sketchLoading;
}

function teardown() {
  if (!instance) return;
  instance.remove();
  instance = null;
}

export async function initAlbers() {
  const container = document.getElementById('albers-container');
  if (!container || instance) return;

  // Both loads reach across the network, and the reader can navigate away
  // while they are in flight. Neither failing should take the page with it —
  // the post reads fine without the canvas.
  try {
    await Promise.all([loadP5(), loadSketch()]);
  } catch (error) {
    console.error('Albers: could not load the sketch', error);
    return;
  }

  const p5 = (window as any).p5;
  const albersSketch = (window as any).albersSketch;
  if (!p5 || !albersSketch || !document.getElementById('albers-container')) return;

  instance = new p5(albersSketch, container);
}

// The client router swaps the DOM without a full reload; tear the sketch down
// before each swap so no canvas survives the navigation.
document.addEventListener('astro:before-swap', teardown);
