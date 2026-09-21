/**
 * What an interactive piece says when it cannot load.
 *
 * Every sketch on this site is fetched from somewhere else — p5 from a CDN,
 * the sketches themselves from the deploy in their own repository, so there
 * is one copy of each rather than two that drift. That is the right trade for
 * keeping them honest and the wrong one to be silent about: when one of those
 * requests fails, the note is left holding an empty container the height of a
 * canvas that never arrived, and the only account of it goes to a console
 * nobody reading the page has open.
 *
 * So say it, and say where the thing does work. A reader who came for the
 * sketch leaves with the link rather than with a gap.
 */

export interface Fallback {
  /** Where the piece runs when this page cannot run it. */
  href: string;
  /** What that place is called, in the sentence. */
  label: string;
}

const MARKER = 'data-sketch-fallback';

/**
 * Put the notice in the container, in place of the canvas that did not come.
 *
 * Idempotent: a reader navigating back and forth with the client router can
 * run this more than once against the same element, and one notice is enough.
 */
export function showSketchFallback(container: HTMLElement, fallback: Fallback): void {
  if (container.querySelector(`[${MARKER}]`)) return;

  const notice = document.createElement('div');
  notice.setAttribute(MARKER, '');
  notice.className = 'sketch-fallback';

  const said = document.createElement('p');
  said.textContent =
    'This one runs in the page, and the script it runs did not load — it is ' +
    'served from another origin, and that request did not come back.';

  const where = document.createElement('p');
  const link = document.createElement('a');
  link.href = fallback.href;
  link.rel = 'noopener';
  link.textContent = `Open it on ${fallback.label}`;
  where.append(link);

  notice.append(said, where);
  container.append(notice);
}

/** Take the notice back out — a later load succeeded, or the page is leaving. */
export function clearSketchFallback(container: HTMLElement | null): void {
  container?.querySelector(`[${MARKER}]`)?.remove();
}
