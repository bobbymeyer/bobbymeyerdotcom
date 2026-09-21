/**
 * Narrowing the project grid to a set of tags, in the browser.
 *
 * Several tags at once cannot be a static page — there are 2^n of those — so
 * this is the one piece of the site that filters at runtime. Everything it
 * does is a convenience over a page that is already complete: with scripting
 * off the dropdown does nothing, every project is listed, and the single-tag
 * pages under /tags are still there for /about to link to and for a crawler
 * to follow.
 *
 * A project matching *any* ticked tag is shown, so adding a tag widens the
 * result. Intersection reads like the obvious meaning of a filter right up
 * until you try it on nine projects, where a second tag almost always empties
 * the page.
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

function apply(cards: HTMLElement[], badge: HTMLElement | null, tags: string[]): void {
  const wanted = new Set(tags);

  for (const card of cards) {
    const own = (card.dataset.tags ?? '').split(' ').filter(Boolean);
    const shown = wanted.size === 0 || own.some((tag) => wanted.has(tag));

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

  if (badge) {
    badge.textContent = tags.length ? String(tags.length) : '';
    badge.toggleAttribute('hidden', tags.length === 0);
  }
}

export function initProjectFilter(): void {
  const filter = document.querySelector<HTMLDetailsElement>('[data-project-filter]');
  const grid = document.querySelector<HTMLElement>('[data-project-grid]');
  if (!filter || !grid) return;

  const boxes = [...filter.querySelectorAll<HTMLInputElement>('[data-filter-tag]')];
  const badge = filter.querySelector<HTMLElement>('[data-filter-badge]');
  const cards = [...grid.querySelectorAll<HTMLElement>('.home-item')];

  // A tag page was narrowed by the server and holds nothing else to reveal,
  // so changing the selection there means going somewhere that does.
  if (!grid.hasAttribute('data-filterable')) {
    for (const box of boxes) {
      box.addEventListener('change', () => {
        const tags = selectedTags(boxes);
        window.location.href = tags.length ? `/?${PARAM}=${encodeURIComponent(tags.join(','))}` : '/';
      });
    }
    return;
  }

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

  apply(cards, badge, selectedTags(boxes));

  for (const box of boxes) {
    box.addEventListener('change', () => {
      const tags = selectedTags(boxes);
      apply(cards, badge, tags);
      writeUrl(tags);
    });
  }
}
