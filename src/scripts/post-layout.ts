/** Keep in sync with src/breakpoints.ts */
import { POST_SPLIT_MQ } from '@/breakpoints';
const MARGINALIA_SEL = ':scope > .marginalia';

const FLOW_BLOCK =
  'p, h2, h3, h4, h5, h6, ul, ol, blockquote, figure, pre, table, hr, details';

let boundArticle: HTMLElement | null = null;
let observer: ResizeObserver | null = null;

function topInLayout(el: Element, layout: Element) {
  return el.getBoundingClientRect().top - layout.getBoundingClientRect().top;
}

function marginColumn(layout: HTMLElement, aside: HTMLElement) {
  const layoutBox = layout.getBoundingClientRect();
  const asideBox = aside.getBoundingClientRect();
  return {
    left: asideBox.left - layoutBox.left,
    width: asideBox.width,
  };
}

function bottomInLayout(el: Element, layout: Element) {
  const box = el.getBoundingClientRect();
  return box.bottom - layout.getBoundingClientRect().top;
}

function occupiedSlots(layout: HTMLElement, aside: HTMLElement) {
  const slots: { bottom: number }[] = [];
  const splash = aside.querySelector('.splash');
  if (splash) {
    slots.push({ bottom: bottomInLayout(splash, layout) });
  }
  return slots;
}

function anchorTarget(el: HTMLElement, article: HTMLElement): HTMLElement | null {
  const id = el.dataset.anchor;
  if (id) {
    return article.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
  }

  let node = el.previousElementSibling as HTMLElement | null;
  while (node) {
    if (node.classList.contains('marginalia')) {
      node = node.previousElementSibling as HTMLElement | null;
      continue;
    }
    if (node.matches(FLOW_BLOCK)) return node;
    node = node.previousElementSibling as HTMLElement | null;
  }
  return null;
}

function resetMarginalia(items: HTMLElement[]) {
  for (const el of items) {
    el.classList.remove('marginalia-anchor', 'marginalia-inline');
    el.style.top = '';
    el.style.left = '';
    el.style.width = '';
  }
}

function placeMarginalia(
  layout: HTMLElement,
  aside: HTMLElement,
  main: HTMLElement,
  article: HTMLElement,
  items: HTMLElement[],
) {
  resetMarginalia(items);

  const { left, width } = marginColumn(layout, aside);
  const sample = main.querySelector('.post-article :is(p, h2, h3, h4)');
  const gap = sample ? parseFloat(getComputedStyle(sample).marginTop) || 16 : 16;
  const placed = occupiedSlots(layout, aside);
  let minHeight = main.offsetHeight;

  for (const el of items) {
    const anchor = anchorTarget(el, article);
    if (!anchor) continue;

    const anchorTop = topInLayout(anchor, layout);
    let blocked = false;
    for (const slot of placed) {
      if (anchorTop < slot.bottom + gap) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      el.classList.add('marginalia-inline');
      continue;
    }

    el.classList.add('marginalia-anchor');
    el.style.left = `${left}px`;
    el.style.width = `${width}px`;
    el.style.top = `${anchorTop}px`;

    const bottom = anchorTop + el.getBoundingClientRect().height;
    placed.push({ bottom });
    minHeight = Math.max(minHeight, bottom);
  }

  layout.style.minHeight = `${minHeight}px`;
}

export function initPostLayout() {
  const layout = document.querySelector<HTMLElement>('.post-layout');
  const article = document.querySelector<HTMLElement>('.post-article');
  const aside = document.querySelector<HTMLElement>('.post-aside');
  const main = document.querySelector<HTMLElement>('.post-main');
  if (!layout || !article || !aside || !main) return;

  const items = [...article.querySelectorAll<HTMLElement>(MARGINALIA_SEL)];
  const wide = window.matchMedia(POST_SPLIT_MQ).matches;

  layout.classList.toggle('post-layout--split', wide);
  resetMarginalia(items);
  layout.style.minHeight = '';

  if (!wide) {
    observer?.disconnect();
    observer = null;
    boundArticle = null;
    return;
  }

  const run = () => placeMarginalia(layout, aside, main, article, items);
  run();
  requestAnimationFrame(run);

  if (boundArticle !== article) {
    observer?.disconnect();
    boundArticle = article;
    observer = new ResizeObserver(() => {
      const nodes = [...article.querySelectorAll<HTMLElement>(MARGINALIA_SEL)];
      placeMarginalia(layout, aside, main, article, nodes);
    });
    observer.observe(layout);
    observer.observe(article);
    observer.observe(main);
    observer.observe(aside);
  }
}

if (typeof window !== 'undefined') {
  window.matchMedia(POST_SPLIT_MQ).addEventListener('change', () => initPostLayout());
  document.fonts?.ready.then(() => initPostLayout());
}
