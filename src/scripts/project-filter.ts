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

import type { TransitionBeforeSwapEvent } from 'astro:transitions/client';

declare global {
  interface Window {
    /** Set once the before-swap narrowing below is listening. */
    __projectFilterPreSwap?: boolean;
  }
}

const PARAM = 'tags';

/** How long a panel the address bar opened stays up before it withdraws. */
const DISMISS_AFTER_MS = 2000;

/** The panel's opacity transition in home.css, which the close has to wait out. */
const FADE_MS = 400;

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

/** What a tag is called in the panel — the kinds are worded there, not raw. */
function labelOf(boxes: HTMLInputElement[], tag: string): string {
  const box = boxes.find((candidate) => candidate.value === tag);
  return box?.closest('.home-filter-option')?.querySelector('.home-filter-name')?.textContent?.trim() || tag;
}

/**
 * The line in the projects row that says what the grid is narrowed to: how
 * many of how many, then each tag as a chip that takes itself off when
 * pressed. Rebuilt whole on every change — it is a handful of elements.
 */
function renderState(
  state: HTMLElement,
  boxes: HTMLInputElement[],
  tags: string[],
  shown: number,
  total: number,
): void {
  const doc = state.ownerDocument;
  state.replaceChildren();
  state.toggleAttribute('hidden', tags.length === 0);
  if (tags.length === 0) return;

  const count = doc.createElement('span');
  count.className = 'home-filter-state-count';
  count.textContent = `${shown} of ${total}`;
  state.append(count);

  for (const tag of tags) {
    const label = labelOf(boxes, tag);
    const chip = doc.createElement('button');
    chip.type = 'button';
    chip.className = 'home-filter-state-tag';
    chip.dataset.filterRemove = tag;
    chip.setAttribute('aria-label', `Stop filtering by ${label}`);
    chip.textContent = label;
    const cross = doc.createElement('span');
    cross.className = 'home-filter-state-x';
    cross.setAttribute('aria-hidden', 'true');
    cross.textContent = '×';
    chip.append(cross);
    state.append(chip);
  }

  // One chip is its own way out. From two, taking them off one at a time is
  // a chore, so the row offers the lot.
  if (tags.length > 1) {
    const clear = doc.createElement('button');
    clear.type = 'button';
    clear.className = 'home-filter-clear';
    clear.dataset.filterClear = '';
    clear.textContent = 'clear';
    state.append(clear);
  }
}

function apply(
  cards: HTMLElement[],
  boxes: HTMLInputElement[],
  state: HTMLElement | null,
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

  // Each option says how many projects there would be with it added, not how
  // many carry it on the whole site: a count that never moves cannot tell a
  // reader what ticking it will do. A ticked option's number is the grid as it
  // stands. One that would take the result to nothing is not worth offering,
  // and is disabled rather than removed so the panel does not reflow.
  for (const box of boxes) {
    const asked = box.checked ? tags : [...tags, box.value];
    const would = cards.filter((card) => matches(card, asked)).length;
    const option = box.closest('.home-filter-option');

    box.disabled = !box.checked && would === 0;
    option?.toggleAttribute('data-empty', box.disabled);

    const count = option?.querySelector<HTMLElement>('[data-filter-count]');
    const said = option?.querySelector<HTMLElement>('[data-filter-count-said]');
    if (count) count.textContent = String(would);
    if (said) said.textContent = would === 1 ? '1 to show' : `${would} to show`;
  }

  if (state) renderState(state, boxes, tags, shownCount, cards.length);

  const done = state?.ownerDocument.querySelector<HTMLElement>('[data-filter-done]');
  if (done) done.textContent = shownCount === 1 ? 'show 1 project' : `show ${shownCount} projects`;

  empty?.toggleAttribute('hidden', shownCount > 0);
}

/** The tags a `?tags=` query asks for. */
function tagsFromSearch(search: string): string[] {
  return (new URLSearchParams(search).get(PARAM) ?? '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

interface Parts {
  filter: HTMLDetailsElement;
  boxes: HTMLInputElement[];
  state: HTMLElement | null;
  empty: HTMLElement | null;
  cards: HTMLElement[];
}

/**
 * The pieces of the narrowed view, found inside whichever document is passed.
 *
 * It takes a root rather than reaching for the global one so that the page
 * arriving over the client router can be narrowed before it is swapped in —
 * see `initFilterPreSwap` below. On the live document it is the same lookup.
 */
function partsOf(root: ParentNode): Parts | null {
  const filter = root.querySelector<HTMLDetailsElement>('[data-project-filter]');
  const grid = root.querySelector<HTMLElement>('[data-project-grid]');
  if (!filter || !grid) return null;

  return {
    filter,
    boxes: [...filter.querySelectorAll<HTMLInputElement>('[data-filter-tag]')],
    state: root.querySelector<HTMLElement>('[data-filter-state]'),
    empty: root.querySelector<HTMLElement>('[data-filter-empty]'),
    cards: [...grid.querySelectorAll<HTMLElement>('.home-item')],
  };
}

/**
 * Narrow the page the client router is about to swap in, before it is painted.
 *
 * The index's own script does not exist yet while a reader is standing on
 * /about — it arrives with the page and runs after the swap — so a tag link
 * used to land on the whole grid and narrow it a frame or two later, and all
 * nine cards flickered past before the four that were asked for. This runs
 * from the layout, so it is already loaded wherever the link is pressed, and
 * `astro:before-swap` hands it the incoming document while there is still time
 * to set it right.
 *
 * It paints and nothing else. The wiring, and the panel's withdrawal, belong
 * to `initProjectFilter`, which runs on the other side of the swap.
 */
export function initFilterPreSwap(): void {
  // `document` outlives a swap, so a second registration would narrow the
  // incoming page twice. Harmless, but the flag says what is meant.
  if (window.__projectFilterPreSwap) return;
  window.__projectFilterPreSwap = true;

  document.addEventListener('astro:before-swap', (event) => {
    const swap = event as TransitionBeforeSwapEvent;
    const parts = partsOf(swap.newDocument);
    if (!parts) return;

    const tags = tagsFromSearch(swap.to?.search ?? '');
    for (const box of parts.boxes) box.checked = tags.includes(box.value);
    apply(parts.cards, parts.boxes, parts.state, parts.empty, tags);

    // Open it here too, so the panel is there in the first painted frame
    // rather than appearing under the reader a moment later.
    if (tags.length > 0) parts.filter.open = true;
  });
}

export function initProjectFilter(): void {
  const found = partsOf(document);
  if (!found) return;
  const { filter } = found;

  // The page calls this directly *and* on `astro:page-load`, which the client
  // router fires for the first load as well as for later ones — so without
  // this the whole thing wires itself twice per document, and the teardown
  // below only ever unhooks one of the two pairs it leaves on `document`.
  if (filter.dataset.wired) return;
  filter.dataset.wired = 'true';

  const { boxes, state, empty, cards } = found;

  /*
   * A panel the address bar opened rather than the reader: following a tag
   * link from /about lands here with the dropdown up, showing which tags came
   * in with the link. That is the answer to "what am I looking at", and once
   * it has been read the panel is in the way of the grid it was explaining —
   * it is laid *over* the cards — so it withdraws on its own. A panel the
   * reader opened stays open, as it should.
   *
   * Anyone who reaches for it calls the whole thing off: pointer in, focus in,
   * a box ticked, or the summary pressed. Fading out from under somebody who
   * is using the thing would be worse than never getting out of the way.
   *
   * `open` is a boolean and cannot be transitioned, so the fade and the close
   * are two steps: CSS takes the panel to nothing, and the <details> shuts
   * once it has, which is what FADE_MS is waiting for.
   */
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let fadeTimer = 0;
  let closeTimer = 0;

  const cancelDismiss = () => {
    window.clearTimeout(fadeTimer);
    window.clearTimeout(closeTimer);
    filter.removeAttribute('data-dismissing');
  };

  const dismissLater = () => {
    fadeTimer = window.setTimeout(() => {
      filter.setAttribute('data-dismissing', '');
      closeTimer = window.setTimeout(
        () => {
          filter.open = false;
          filter.removeAttribute('data-dismissing');
        },
        reduceMotion ? 0 : FADE_MS,
      );
    }, DISMISS_AFTER_MS);
  };

  for (const event of ['pointerenter', 'pointerdown', 'focusin', 'change'] as const) {
    filter.addEventListener(event, cancelDismiss);
  }

  // Shut by hand during the wait. Opening it is a toggle too, so this only
  // acts on the closing one — and our own close has already cleared both
  // timers by the time it fires.
  filter.addEventListener('toggle', () => {
    if (!filter.open) cancelDismiss();
  });

  // Arriving with a selection already in the address bar — a shared link, a
  // reload, or a tag link from /about.
  const fromUrl = tagsFromSearch(window.location.search);

  if (fromUrl.length > 0) {
    const wanted = new Set(fromUrl);
    for (const box of boxes) box.checked = wanted.has(box.value);
    filter.open = true;
    dismissLater();
  }

  const refresh = () => {
    const tags = selectedTags(boxes);
    apply(cards, boxes, state, empty, tags);
    writeUrl(tags);
  };

  // The query narrows the page, not the boxes it managed to tick. A tag that
  // nothing carries — a typo, or one that has since been renamed — has no box
  // to tick, so reading the selection back off the boxes quietly dropped it
  // and left every project showing under an address bar still claiming a
  // filter. Asked for something that is not here, the honest answer is the
  // empty note, which is the same answer `?tags=ruby,python` already gave.
  //
  // Only on arrival. From the first change onwards the reader is driving the
  // boxes, and `refresh` writes the query back from them, which is what drops
  // the unknown tag out of the address bar.
  apply(cards, boxes, state, empty, fromUrl);

  for (const box of boxes) box.addEventListener('change', refresh);

  // Shut the panel and bring the row back to the top of the screen: on a
  // phone the reader is somewhere down inside the panel, and shutting it
  // alone would leave them looking at whatever the grid has scrolled to.
  const done = filter.querySelector<HTMLButtonElement>('[data-filter-done]');
  if (done) {
    done.hidden = false;
    done.addEventListener('click', () => {
      filter.open = false;
      const summary = filter.querySelector<HTMLElement>('summary');
      summary?.closest('.home-head')?.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
      summary?.focus({ preventScroll: true });
    });
  }

  // A chip in the row takes its own tag off. Focus goes to the next chip
  // along, or back to the button once there are none, so a keyboard reader
  // clearing several in a row is not dropped at the top of the page.
  state?.addEventListener('click', (event) => {
    if ((event.target as Element).closest('[data-filter-clear]')) {
      for (const box of boxes) box.checked = false;
      refresh();
      filter.querySelector<HTMLElement>('summary')?.focus();
      return;
    }

    const chip = (event.target as Element).closest<HTMLElement>('[data-filter-remove]');
    if (!chip) return;
    const tag = chip.dataset.filterRemove;
    const at = [...state.querySelectorAll('[data-filter-remove]')].indexOf(chip);
    for (const box of boxes) if (box.value === tag) box.checked = false;
    refresh();
    const left = state.querySelectorAll<HTMLElement>('[data-filter-remove]');
    (left[Math.min(at, left.length - 1)] ?? filter.querySelector<HTMLElement>('summary'))?.focus();
  });

  // The panel is laid over the grid, so it has to be dismissable the way
  // anything laid over a page is: click away from it, or press Escape. A
  // <details> does neither on its own.
  // The chips in the row are part of the filter too: taking a tag off there
  // with the panel up should not also shut it. Asked of the event's path, not
  // of `contains`, because by the time the click reaches the document the
  // chip pressed has already been rebuilt away and is in nothing at all.
  const closeOnOutside = (event: MouseEvent) => {
    const path = event.composedPath();
    if (!filter.open || path.includes(filter) || (state && path.includes(state))) return;
    filter.open = false;
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
      // A withdrawal still on the clock would fire against a detached panel.
      cancelDismiss();
    },
    { once: true },
  );


}
