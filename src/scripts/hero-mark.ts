// The hero mark answers the reader. With a pointer, the three plates lean
// toward it, each by its own amount, as if they were three sheets at three
// depths: move across the page and the registration slips and comes back.
// With a finger, a tap blooms them out to the full Venn — what hovering does
// with a pointer — and lets them settle.
//
// All this does is set custom properties and an attribute; home.css turns
// them into offsets on `translate`, under the transition every mark dot
// already has, so the movement eases on its own. Without this script, or with
// reduced motion, the mark rests and blooms exactly as before.

/** How far each plate leans at the edge of the screen, in CSS px. */
const LEAN = { c: 14, m: -10, y: 6 };
const BLOOM_MS = 1400;

let teardown: (() => void) | null = null;

export function initHeroMark() {
  teardown?.();
  const root = document.querySelector<HTMLElement>('[data-hero-mark]');
  if (!root) return;

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const hoverable = matchMedia('(hover: hover)');
  let frame = 0;
  let settle = 0;

  const lean = (e: PointerEvent) => {
    if (still.matches || e.pointerType === 'touch') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // -1 to 1 across the viewport, from the mark's own centre, so a pointer
      // on the mark leans nothing and one at the far edge leans the most.
      const box = root.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (e.clientX - (box.left + box.width / 2)) / innerWidth));
      const y = Math.max(-1, Math.min(1, (e.clientY - (box.top + box.height / 2)) / innerHeight));
      for (const [plate, k] of Object.entries(LEAN)) {
        root.style.setProperty(`--lean-x-${plate}`, `${(x * k).toFixed(2)}px`);
        root.style.setProperty(`--lean-y-${plate}`, `${(y * k).toFixed(2)}px`);
      }
    });
  };

  const tap = () => {
    if (hoverable.matches) return;
    root.dataset.bloom = '';
    clearTimeout(settle);
    settle = window.setTimeout(() => delete root.dataset.bloom, BLOOM_MS);
  };

  document.addEventListener('pointermove', lean, { passive: true });
  root.addEventListener('click', tap);

  teardown = () => {
    cancelAnimationFrame(frame);
    clearTimeout(settle);
    document.removeEventListener('pointermove', lean);
    root.removeEventListener('click', tap);
    teardown = null;
  };
}

// The client router swaps the DOM without a full reload; drop the listeners
// before each swap so none outlives the index.
document.addEventListener('astro:before-swap', () => teardown?.());
