/**
 * Narrowing the project grid to a set of tags, in the browser.
 *
 * Several tags at once cannot be a static page — there are 2^n of those — so
 * this is the one piece of the site that filters at runtime. Everything it
 * does is a convenience over a page that is already complete: with scripting
 * off the dropdown does nothing and every project is listed and reachable;
 * the only thing missing is the narrowing. A link from /about carries the
 * same `?tags=` query, so there is one filtered view of the projects and one
 * code path that produces it.
 *
 * Ticking tags narrows: a project has to carry *all* of them. On nine
 * projects most second picks would land on nothing, so rather than let a
 * reader walk into an empty page, every option that would take the result to
 * zero is disabled as the selection changes. The empty state below is the
 * safety net for the one way left in — a hand-written `?tags=` in the address
 * bar.
 *
 * The selection is written into the address bar so a narrowed view can be
 * sent to someone, and with `replaceState` rather than `pushState` so that
 * ticking four boxes does not leave four entries for the back button to
 * unwind.
 */

const PARAM = 'tags';

function selectedTags(boxes: HTMLInputElement[]): string[] {
  return boxes.filter((box) => box.checked).map((box) => box.value);
}

function writeUrl(tags: string[]): void {
  const url = new URL(window.location.href);

  // Built by hand rather than through `searchParams`, which escapes the
  // separator and turns a link someone might read into `?tags=print%2Cmusic`.
  // Each tag is still encoded; only the comma between them is spared.
  url.search = tags.length > 0 ? `${PARAM}=${tags.map(encodeURIComponent).join(',')}` : '';

  window.history.replaceState(window.history.state, '', url);
}

/** The tags a card carries. */
function cardTags(card: HTMLElement): string[] {
  return (card.dataset.tags ?? '').split(' ').filter(Boolean);
}

/** Whether a card carries every tag asked for. */
function matches(card: HTMLElement, wanted: string[]): boolean {
  const own = cardTags(card);
  return wanted.every((tag) => own.includes(tag));
}

function apply(
  cards: HTMLElement[],
  boxes: HTMLInputElement[],
  badge: HTMLElement | null,
  empty: HTMLElement | null,
  tags: string[],
): void {
  const wanted = new Set(tags);
  let shownCount = 0;

  for (const card of cards) {
    const own = cardTags(card);
    const shown = matches(card, tags);
    if (shown) shownCount += 1;

    // `hidden` rather than a class, so a filtered-out card leaves the
    // accessibility tree and the tab order as well as the page. It needs a
    // rule of its own in home.css: `.home-item` sets `display: flex`, which
    // beats the user agent's `[hidden]` on equal specificity and source order.
    card.toggleAttribute('hidden', !shown);

    // The tag that put a card here is drawn in, as it is on a tag page.
    for (const chip of card.querySelectorAll<HTMLElement>('.home-item-tag')) {
      const tag = chip.dataset.tag ?? '';
      chip.toggleAttribute('data-active', wanted.has(tag));
    }
  }

  // An option that would take the result to nothing is not worth offering.
  // Recomputed on every change, because what is a dead end depends entirely
  // on what is already ticked.
  for (const box of boxes) {
    if (box.checked) {
      box.disabled = false;
      continue;
    }

    const wouldMatch = cards.some((card) => matches(card, [...tags, box.value]));
    box.disabled = !wouldMatch;
    box.closest('.home-filter-option')?.toggleAttribute('data-empty', !wouldMatch);
  }

  if (badge) {
    badge.textContent = tags.length ? String(tags.length) : '';
    badge.toggleAttribute('hidden', tags.length === 0);
  }

  empty?.toggleAttribute('hidden', shownCount > 0);
}

export function initProjectFilter(): void {
  const filter = document.querySelector<HTMLDetailsElement>('[data-project-filter]');
  const grid = document.querySelector<HTMLElement>('[data-project-grid]');
  if (!filter || !grid) return;

  const boxes = [...filter.querySelectorAll<HTMLInputElement>('[data-filter-tag]')];
  const badge = filter.querySelector<HTMLElement>('[data-filter-badge]');
  const clear = filter.querySelector<HTMLAnchorElement>('[data-filter-clear]');
  const empty = document.querySelector<HTMLElement>('[data-filter-empty]');
  const cards = [...grid.querySelectorAll<HTMLElement>('.home-item')];

  // Arriving with a selection already in the address bar — a shared link, a
  // reload, or a hop from a tag page.
  const fromUrl = (new URL(window.location.href).searchParams.get(PARAM) ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (fromUrl.length > 0) {
    const wanted = new Set(fromUrl);
    for (const box of boxes) box.checked = wanted.has(box.value);
    filter.open = true;
  }

  const refresh = () => {
    const tags = selectedTags(boxes);
    apply(cards, boxes, badge, empty, tags);
    writeUrl(tags);
  };

  apply(cards, boxes, badge, empty, selectedTags(boxes));

  for (const box of boxes) box.addEventListener('change', refresh);

  // The panel is laid over the grid, so it has to be dismissable the way
  // anything laid over a page is: click away from it, or press Escape. A
  // <details> does neither on its own.
  const closeOnOutside = (event: MouseEvent) => {
    if (filter.open && !filter.contains(event.target as Node)) filter.open = false;
  };

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !filter.open) return;
    filter.open = false;
    // Focus followed the pointer into the panel; put it back on the control
    // that opened it rather than dropping it at the top of the document.
    filter.querySelector<HTMLElement>('summary')?.focus();
  };

  document.addEventListener('click', closeOnOutside);
  document.addEventListener('keydown', closeOnEscape);

  // The client router swaps the document without unloading it, so these would
  // otherwise stack up one pair per visit.
  document.addEventListener(
    'astro:before-swap',
    () => {
      document.removeEventListener('click', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    },
    { once: true },
  );

  // Clearing is a link to the index so that it works with no script at all.
  // Here there is nothing to navigate to — this *is* the index — so it unticks
  // in place and leaves the reader where they were, with the panel still open.
  clear?.addEventListener('click', (event) => {
    event.preventDefault();
    for (const box of boxes) box.checked = false;
    refresh();
  });
}
