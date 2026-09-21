/**
 * Reordering the about page's interests when the dropdown changes.
 *
 * The page ships the list already in its default order and carries both
 * positions on every tag, so this moves nodes and never fetches, re-renders,
 * or asks the server anything. With the script blocked the select simply does
 * nothing and the list is still correct, which is why the order is server-side
 * in the first place.
 *
 * The DOM is reordered rather than the tags being given a CSS `order`:
 * `order` moves boxes and leaves reading order where it was, and this is a
 * ranked list, so the sequence is the content. A screen reader should get the
 * order the page is claiming to show.
 */

const ORDERS = ['greatest', 'recent'] as const;
type Order = (typeof ORDERS)[number];

function isOrder(value: string): value is Order {
  return (ORDERS as readonly string[]).includes(value);
}

/** Where a tag sits in a given order, as the page wrote it onto the element. */
function rank(item: HTMLElement, order: Order): number {
  const value = Number(item.dataset[order === 'greatest' ? 'rankGreatest' : 'rankRecent']);
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function apply(list: HTMLElement, order: Order): void {
  const items = [...list.querySelectorAll<HTMLElement>('.about-tag')];
  items.sort((a, b) => rank(a, order) - rank(b, order));

  // One fragment, one insertion: appending each node in turn would move the
  // live list item by item and lay the page out between each move.
  const fragment = document.createDocumentFragment();
  for (const item of items) fragment.append(item);
  list.append(fragment);
}

export function initInterestOrder(): void {
  const select = document.querySelector<HTMLSelectElement>('[data-interest-order]');
  const list = document.querySelector<HTMLElement>('[data-interest-list]');
  if (!select || !list) return;

  // The client router can run this against a page it has already wired up.
  if (select.dataset.wired) return;
  select.dataset.wired = 'true';

  select.addEventListener('change', () => {
    if (isOrder(select.value)) apply(list, select.value);
  });
}
