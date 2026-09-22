// Albers' Squares — the sketch itself lives in bobbymeyer/albers-squares and is
// loaded from its deploy, so there is one copy of it rather than two that drift.
// That file defines window.albersSketch, an instance-mode factory, and leaves
// starting it to whoever loaded it: here that means one instance per visit to
// the post, torn down on client-side navigation. p5 and the sketch both load on
// demand, only on the page that has the #albers-container.

import { clearSketchFallback, showSketchFallback } from '@/scripts/sketch-fallback';

const P5_SRC = 'https://cdn.jsdelivr.net/npm/p5@1.11.3/lib/p5.min.js';
const SKETCH_SRC = 'https://bobbymeyer.github.io/albers-squares/sketch.js';

/** Where the sketch runs when this page cannot run it. */
const FALLBACK = {
  href: 'https://bobbymeyer.github.io/albers-squares/',
  label: 'its own deploy',
};

let p5Loading: Promise<void> | null = null;
let sketchLoading: Promise<void> | null = null;
let instance: any = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // A tag already here means the script is loaded or on its way. That is
    // only true because a failed one is taken out again below: left in, it
    // would answer for the script it never managed to fetch, and every retry
    // would resolve at once against a global that was never defined.
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => {
      script.remove();
      reject(new Error(`Failed to load ${src}`));
    });
    document.head.appendChild(script);
  });
}

function loadP5(): Promise<void> {
    // Memoised so one visit makes one request, but *not* past a failure: a
  // rejected promise left here would be handed to every later attempt, so one
  // flaky moment would follow the reader around the site until they reloaded.
  p5Loading ??= (loadScript(P5_SRC)).catch((error) => {
    p5Loading = null;
    throw error;
  });
  return p5Loading;
}

function loadSketch(): Promise<void> {
    // Memoised so one visit makes one request, but *not* past a failure: a
  // rejected promise left here would be handed to every later attempt, so one
  // flaky moment would follow the reader around the site until they reloaded.
  sketchLoading ??= (loadScript(SKETCH_SRC)).catch((error) => {
    sketchLoading = null;
    throw error;
  });
  return sketchLoading;
}

function teardown() {
  clearSketchFallback(document.getElementById('albers-container'));
  if (!instance) return;
  instance.remove();
  instance = null;
}

export async function initAlbers() {
  const container = document.getElementById('albers-container');
  if (!container || instance) return;

  // A retry after a failed load starts from a clean container.
  clearSketchFallback(container);

  // Both loads reach across the network, and the reader can navigate away
  // while they are in flight. Neither failing should take the page with it —
  // the post reads fine without the canvas.
  try {
    await Promise.all([loadP5(), loadSketch()]);
  } catch (error) {
    console.error('Albers: could not load the sketch', error);
    showSketchFallback(container, FALLBACK);
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
