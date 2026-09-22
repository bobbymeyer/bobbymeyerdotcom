/**
 * gridi — the sequencer itself lives in bobbymeyer/gridi and is loaded from
 * its deploy, so there is one copy of it rather than two that drift. The
 * module exports initGridi/destroyGridi and, left alone, would boot itself
 * against any #app it found; the flag below tells it to wait and let this file
 * decide, which is what lets it be torn down on client-side navigation.
 *
 * The difference from the other sketches here is that gridi is not a canvas
 * with a loop behind it. It is a whole application — forty-five controls, an
 * inspector, a footer — and it brings a stylesheet to match: a `*` reset, and
 * rules on `html, body`. Dropped into this page as-is that would flatten
 * everything around it.
 *
 * So it mounts in a shadow root. Its stylesheet goes inside, where it reaches
 * the app and nothing else, and this page's own CSS does not reach in. Neither
 * side has to be rewritten to accommodate the other, which is the only version
 * of this that stays true once either of them changes.
 */

import { clearSketchFallback, showSketchFallback } from '@/scripts/sketch-fallback';

const GRIDI_BASE = 'https://bobbymeyer.github.io/gridi/';
const GRIDI_SRC = `${GRIDI_BASE}src/main.js`;
const GRIDI_CSS = `${GRIDI_BASE}styles/app.css`;

/** Where the sequencer runs when this page cannot run it. */
const FALLBACK = {
  href: GRIDI_BASE,
  label: 'its own deploy',
};

type GridiModule = {
  initGridi: (mount: Element, options?: Record<string, unknown>) => unknown;
  destroyGridi: () => void;
};

let loading: Promise<GridiModule> | null = null;
let live: GridiModule | null = null;

/**
 * Set before the first await, and that is the whole point of it.
 *
 * The page calls init directly *and* on `astro:page-load`. `live` is only set
 * once the module is back, so both calls used to get past the import together:
 * the first built the container and filled it, and the second rebuilt the
 * container — throwing away the app that was in it — and then asked gridi to
 * mount again, which it declined to do because as far as it knew it was
 * already running. A shadow root with nothing in it and not one error anywhere.
 */
let mounting = false;

function load(): Promise<GridiModule> {
  // Set before the import, so the module does not start itself.
  (window as any).__gridiEmbedded = true;
  // Memoised so two calls in one visit make one request, but *not* past a
  // failure: a rejected promise left in here would be handed to every later
  // attempt, so one flaky moment would follow the reader around the site
  // until they reloaded the page themselves.
  loading ??= (import(/* @vite-ignore */ GRIDI_SRC) as Promise<GridiModule>).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

function teardown() {
  clearSketchFallback(document.getElementById('gridi'));
  if (!live) return;
  // Stops the clock, the audio graph and any MIDI ports it opened. Without it
  // a reader who navigates away leaves a sequencer running behind them.
  live.destroyGridi();
  live = null;
}

export async function initGridi() {
  const host = document.getElementById('gridi');
  if (!host || live || mounting) return;
  mounting = true;

  try {
    await mountInto(host);
  } finally {
    mounting = false;
  }
}

async function mountInto(host: HTMLElement) {
  // A retry after a failed load starts from a clean container.
  clearSketchFallback(host);

  // The load reaches across the network and the reader can navigate away while
  // it is in flight. Failing should not take the page with it — the note reads
  // fine without the sequencer, and says where it does work.
  let mod: GridiModule;
  try {
    mod = await load();
  } catch (error) {
    console.error('gridi: could not load the sequencer', error);
    showSketchFallback(host, FALLBACK);
    return;
  }

  // The page may have changed under us during the load.
  if (!document.getElementById('gridi')) return;

  // One shadow root per element, reused across mounts: attachShadow throws the
  // second time, and after a client-side navigation this is a new element
  // anyway.
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<link rel="stylesheet" href="${GRIDI_CSS}"><div class="gridi-mount"></div>`;

  const mount = shadow.querySelector('.gridi-mount');
  if (!mount) return;

  mod.initGridi(mount, {
    // Theme the mount rather than this page's <html>.
    embedded: true,
    // The heading above already says what this is; gridi does not need to say
    // it again directly underneath. The transport stays.
    mark: false,
    // Its own patch. Playing with the one in this note must not overwrite the
    // one somebody has been working on at the real thing.
    storagePrefix: 'bobbymeyer.com:',
  });
  live = mod;
}

// The client router swaps the DOM without a full reload; stop the sequencer
// before each swap so no clock, and no sound, survives the navigation.
document.addEventListener('astro:before-swap', teardown);
