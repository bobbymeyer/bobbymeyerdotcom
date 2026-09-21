// treegen — the tool itself lives in bobbymeyer/treegen and is loaded from its
// deploy, so there is one copy of it rather than two that drift. That module
// exports initTreegen/destroyTreegen and, left alone, would boot itself against
// any #treegen markup it found; the flag below tells it to wait and let this
// file decide, which is what lets the sketch be torn down on client-side
// navigation. It loads on demand, only on the page that has the markup.

import { clearSketchFallback, showSketchFallback } from '@/scripts/sketch-fallback';

const TREEGEN_SRC = 'https://bobbymeyer.github.io/treegen/treegen.js';

/** Where the tool runs when this page cannot run it. */
const FALLBACK = {
  href: 'https://bobbymeyer.github.io/treegen/',
  label: 'its own deploy',
};

type TreegenModule = {
  initTreegen: (root?: HTMLElement) => unknown;
  destroyTreegen: () => void;
};

let loading: Promise<TreegenModule> | null = null;
let live: TreegenModule | null = null;

function load(): Promise<TreegenModule> {
  // Set before the import, so the module does not start itself.
  (window as any).__treegenEmbedded = true;
  loading ??= import(/* @vite-ignore */ TREEGEN_SRC) as Promise<TreegenModule>;
  return loading;
}

function teardown() {
  clearSketchFallback(document.getElementById('treegen'));
  if (!live) return;
  live.destroyTreegen();
  live = null;
}

export async function initTreegen() {
  if (!document.getElementById('treegen') || live) return;

  // A retry after a failed load starts from a clean container.
  clearSketchFallback(document.getElementById('treegen'));

  // The load reaches across the network and the reader can navigate away while
  // it is in flight. Failing should not take the page with it — the note reads
  // fine without the tool.
  let mod: TreegenModule;
  try {
    mod = await load();
  } catch (error) {
    console.error('treegen: could not load the tool', error);
    const root = document.getElementById('treegen');
    if (root) showSketchFallback(root, FALLBACK);
    return;
  }

  // The page may have changed under us during the load.
  if (!document.getElementById('treegen')) return;
  mod.initTreegen();
  live = mod;
}

// The client router swaps the DOM without a full reload; stop the tool before
// each swap so no animation loop survives the navigation.
document.addEventListener('astro:before-swap', teardown);
