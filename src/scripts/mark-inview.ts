/**
 * The spread, for a reader with no pointer to hover with.
 *
 * Hovering a card blows its mark out to full register. On a touchscreen there
 * is no hover and never will be, so the gesture that brings a card to
 * attention is scrolling it into view, and that is what stands in.
 *
 * Bloom and settle, not spread and hold. Held open the mark would be blown
 * out for as long as the card was on screen — which on a phone, where one
 * card fills most of it, is nearly always — and a mark permanently at full
 * register says nothing. The point of the spread is that it is a moment. It
 * is the same shape as the gesture the header lockup makes on a navigation:
 * out, briefly, then back to the drift.
 *
 * Keyed off `(hover: none)` rather than a width. A touchscreen laptop has a
 * pointer and a narrow window on a desktop still has one; what matters is
 * whether hover exists, not how big the viewport is.
 */

/** How long the mark stays out before it settles back. */
const HOLD_MS = 1100;

/** How much of a card has to be on screen to count as being looked at. */
const THRESHOLD = 0.5;

export function initMarkInView(): void {
  const grid = document.querySelector<HTMLElement>('[data-project-grid]');
  if (!grid) return;

  // Where hover exists it already does this job, and doing both would mean a
  // mark blooming on scroll under a pointer that is about to bloom it again.
  if (!window.matchMedia('(hover: none)').matches) return;

  // Somebody who has asked for less movement is not asking for a flourish
  // they did not even trigger. The CSS drops the transition as well, so this
  // is belt and braces, but the observer may as well not run.
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  if (grid.dataset.inviewWired) return;
  grid.dataset.inviewWired = 'true';

  const timers = new WeakMap<Element, number>();

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const card = entry.target as HTMLElement;

        if (!entry.isIntersecting) {
          // Left the screen: clear the hold so that coming back blooms again.
          window.clearTimeout(timers.get(card));
          timers.delete(card);
          card.removeAttribute('data-inview');
          continue;
        }

        if (timers.has(card)) continue;

        card.setAttribute('data-inview', '');
        timers.set(
          card,
          window.setTimeout(() => card.removeAttribute('data-inview'), HOLD_MS),
        );
      }
    },
    { threshold: THRESHOLD },
  );

  for (const card of grid.querySelectorAll<HTMLElement>('.home-item')) {
    if (card.querySelector('.mark-dot')) observer.observe(card);
  }

  // The client router swaps the document without unloading it, so the
  // observer would otherwise go on watching nodes that are no longer anywhere.
  document.addEventListener('astro:before-swap', () => observer.disconnect(), { once: true });
}
