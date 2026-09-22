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

/**
 * How many times the import has failed.
 *
 * Clearing the memo above is not enough on its own. A dynamic import is
 * remembered by the browser's own module map, keyed on the URL and for the
 * life of the document — and a *failed* one is remembered too, so asking for
 * the same URL again returns the same failure without going near the network.
 * Reloading the page was the only way out of it, which for a reader who hit
 * one bad moment meant the piece stayed broken for the rest of their visit.
 *
 * A different URL is a different entry in that map, so each retry carries a
 * count the previous attempt did not. It only ever appears after a failure.
 */
let attempt = 0;

const retryable = (url: string) => (attempt === 0 ? url : `${url}?retry=${attempt}`);
let live: TreegenModule | null = null;

function load(): Promise<TreegenModule> {
  // Set before the import, so the module does not start itself.
  (window as any).__treegenEmbedded = true;
  // Memoised so two calls in one visit make one request, but *not* past a
  // failure: a rejected promise left in here would be handed to every later
  // attempt, so one flaky moment would follow the reader around the site
  // until they reloaded the page themselves.
  loading ??= (import(/* @vite-ignore */ retryable(TREEGEN_SRC)) as Promise<TreegenModule>).catch((error) => {
    loading = null;
    attempt += 1;
    throw error;
  });
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
