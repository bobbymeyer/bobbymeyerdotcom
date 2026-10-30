/**
 * The index as a wheel, on the bench at /lab/wheel.
 *
 * One number drives all of it: `position`, how far through the list the reader
 * has turned, 0 at the first project and n − 1 at the last. Every card works
 * out its distance from that and takes its place, its size and its ink from the
 * distance alone. Nothing turns in depth — further away is smaller and fainter,
 * and that is the whole of the effect.
 *
 * The number is the page's own scroll. The section is a tall track with a
 * sticky stage in it, and how far the track has scrolled past the top of the
 * window is how far the wheel has turned. So there is nothing to hijack: a
 * trackpad, a wheel, a thumb, the space bar all turn it the way they would
 * scroll anything, and at either end the track runs out and the page carries
 * on. A drag with a mouse is the one input scroll does not already give, and it
 * is turned into scroll too.
 *
 * The wheel's hub is the right-hand edge of the page, halfway down the
 * window, and the wheel is about a card wide: the current card hangs off the
 * leftmost point of the rim with its right edge near the page's, and the rest
 * ride round it toward the hub — upright, like the cars on a Ferris wheel,
 * getting smaller as they go. Each card hangs from its left edge, which is the
 * point on the rim, so shrinking pulls toward that edge too.
 */

interface Tuning {
  /** How far the column bends: 0 a straight list, 1 the rim of the wheel. */
  arc: number;
  /** The wheel's radius, in card widths: 1 puts the current card flush right. */
  size: number;
  /** Scale of each step away from the centre: 0.72 makes the next card 72%. */
  shrink: number;
  /** Gap between neighbours, as a fraction of the current card's height. */
  spacing: number;
  /** Opacity lost per step away from the centre. */
  fade: number;
  /** Page scroll it takes to turn one item, as a fraction of the window. */
  travel: number;
}

const DEFAULTS: Tuning = {
  arc: 1,
  size: 1,
  shrink: 0.72,
  spacing: 1.1,
  fade: 0.22,
  travel: 0.35,
};

/** How long the scroll has to be still before the wheel settles on a card. */
const SETTLE_MS = 140;

/** A drag shorter than this is a click. */
const DRAG_SLOP = 5;

/** Torn down when Astro swaps the page out. */
let teardown: (() => void) | undefined;

export function initWheel(): void {
  teardown?.();
  teardown = undefined;

  const track = document.querySelector<HTMLElement>('[data-wheel]');
  const stage = track?.querySelector<HTMLElement>('[data-wheel-stage]');
  if (!track || !stage) return;

  const items = [...track.querySelectorAll<HTMLElement>('[data-wheel-item]')];
  const cards = items.map((item) => item.querySelector<HTMLAnchorElement>('a')!);
  const last = items.length - 1;
  if (last < 0) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tuning: Tuning = { ...DEFAULTS };

  track.dataset.wheelOn = '';

  let step = 0;
  let cardHeight = 0;
  let stageHeight = 0;
  let radius = 1;
  let current = -1;
  let frame = 0;
  let settleTimer = 0;

  /** Pixels of page scroll from the top of the document to item `index`. */
  const scrollFor = (index: number) =>
    track.getBoundingClientRect().top + window.scrollY + index * step;

  const position = () => {
    const turned = -track.getBoundingClientRect().top / step;
    return Math.min(Math.max(turned, 0), last);
  };

  // Every length here depends on the window, so all of them are taken again
  // when it changes. The track is the stage plus one `step` per card after the
  // first, which is what makes the last card land as the track runs out.
  const measure = () => {
    step = Math.max(window.innerHeight * tuning.travel, 1);
    stageHeight = stage.clientHeight;
    cardHeight = items[0].offsetHeight;
    // From the hub, the right-hand edge of the page, to the current card's
    // left edge: a card's width and the margin the page keeps on the right,
    // so at size 1 the card sits where a right-aligned card would. Never
    // further left than the stage starts.
    const box = stage.getBoundingClientRect();
    const hub = window.innerWidth;
    const flush = items[0].offsetWidth + (hub - box.right);
    radius = Math.max(Math.min(flush * tuning.size, hub - box.left), 1);
    stage.style.setProperty('--wheel-left', `${hub - radius - box.left}px`);
    track.style.height = `${stageHeight + last * step}px`;
  };

  /** Distance from the centre, `d` steps out, in pixels along the column. */
  const offset = (d: number) => {
    const k = tuning.shrink;
    const gap = cardHeight * tuning.spacing;
    // The gaps shrink with the cards: each is `shrink` times the one before,
    // so a far card sits as close to its neighbour as it is small.
    const along = k === 1 ? Math.abs(d) : (1 - k ** Math.abs(d)) / (1 - k);
    return Math.sign(d) * gap * along;
  };

  const render = () => {
    frame = 0;
    const p = position();

    // Held in the window by hand. `position: sticky` would be the natural way,
    // but body clips its overflow sideways, which makes it the box a sticky
    // element sticks to, and body never scrolls.
    const top = track.getBoundingClientRect().top;
    const pinned = Math.min(Math.max(-top, 0), last * step);
    stage.style.transform = `translateY(${pinned}px)`;

    for (const [index, item] of items.entries()) {
      const d = index - p;
      const away = Math.abs(d);
      const along = offset(d);
      // The distance along the column is laid round the rim as arc length,
      // and stops a quarter turn out: past the top or bottom of the wheel a
      // card would start coming back, and by then it has faded anyway.
      const angle = Math.min(Math.max(along / radius, -Math.PI / 2), Math.PI / 2);
      const x = tuning.arc * radius * (1 - Math.cos(angle));
      const y = along + tuning.arc * (radius * Math.sin(angle) - along);
      const scale = tuning.shrink ** away;
      const opacity = Math.max(1 - tuning.fade * away, 0);

      item.style.transform = `translate(${x}px, calc(-50% + ${y}px)) scale(${scale})`;
      item.style.opacity = String(opacity);
      item.style.zIndex = String(1000 - Math.round(away * 10));
      item.style.visibility = opacity <= 0.01 ? 'hidden' : '';
    }

    const nearest = Math.round(p);
    if (nearest !== current) {
      current = nearest;
      for (const [index, item] of items.entries()) {
        item.toggleAttribute('data-current', index === current);
      }
    }
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(render);
  };

  const goTo = (index: number, smooth = !reduceMotion) => {
    const target = Math.min(Math.max(index, 0), last);
    window.scrollTo({ top: scrollFor(target), behavior: smooth ? 'smooth' : 'auto' });
  };

  /** Inside the track, and stopped between two cards: finish the turn. */
  const settle = () => {
    const top = track.getBoundingClientRect().top;
    if (top > 0 || top < -last * step) return;
    const p = position();
    if (Math.abs(p - Math.round(p)) > 0.01) goTo(Math.round(p));
  };

  const onScroll = () => {
    schedule();
    window.clearTimeout(settleTimer);
    if (!dragging) settleTimer = window.setTimeout(settle, SETTLE_MS);
  };

  const onResize = () => {
    const p = position();
    measure();
    window.scrollTo({ top: scrollFor(p), behavior: 'auto' });
    schedule();
  };

  // A card that is not the current one is not a way off the page yet, it is
  // a way to turn the wheel to it. Only the card at the centre navigates.
  const onClick = (event: MouseEvent) => {
    if (suppressClick) {
      event.preventDefault();
      suppressClick = false;
      return;
    }
    const index = cards.indexOf((event.target as Element).closest('a')!);
    if (index >= 0 && index !== current) {
      event.preventDefault();
      goTo(index);
    }
  };

  // Tab walks the list in order, and the wheel follows wherever focus lands.
  const onFocusIn = (event: FocusEvent) => {
    const index = cards.indexOf(event.target as HTMLAnchorElement);
    if (index >= 0 && index !== current) goTo(index);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowDown: current + 1,
      ArrowRight: current + 1,
      ArrowUp: current - 1,
      ArrowLeft: current - 1,
      Home: 0,
      End: last,
    };
    if (!(event.key in keys)) return;
    const target = keys[event.key];
    // At either end the key goes back to the page, so an arrow past the last
    // card scrolls on rather than doing nothing.
    if (target < 0 || target > last) return;
    if (!cards.includes(document.activeElement as HTMLAnchorElement)) return;
    event.preventDefault();
    cards[target].focus({ preventScroll: true });
  };

  // A mouse drag is the one way of turning it that is not already a scroll.
  // Dragging the column by one card's height turns it by one card.
  let dragging = false;
  let suppressClick = false;
  let dragStart = 0;
  let scrollStart = 0;

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    if ((event.target as Element).closest('.wheel-tune')) return;
    dragging = true;
    suppressClick = false;
    dragStart = event.clientY;
    scrollStart = window.scrollY;
    stage.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    const dy = event.clientY - dragStart;
    if (Math.abs(dy) > DRAG_SLOP) {
      suppressClick = true;
      stage.dataset.dragging = '';
    }
    const perCard = Math.max(cardHeight * tuning.spacing, 1);
    window.scrollTo({ top: scrollStart - (dy / perCard) * step, behavior: 'auto' });
  };

  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    delete stage.dataset.dragging;
    settle();
  };

  // A dragged link would otherwise be picked up and carried off as a URL.
  const onDragStart = (event: DragEvent) => event.preventDefault();

  // The bench's own knobs, and a line of their values to paste back.
  const readout = track.querySelector<HTMLElement>('[data-tune-readout]');
  const inputs = [...track.querySelectorAll<HTMLInputElement>('[data-tune]')];

  const showTuning = () => {
    for (const input of inputs) {
      const key = input.dataset.tune as keyof Tuning;
      const out = track.querySelector<HTMLOutputElement>(`[data-tune-out="${key}"]`);
      if (out) out.value = String(tuning[key]);
    }
    if (readout) {
      readout.textContent = (Object.keys(tuning) as (keyof Tuning)[])
        .map((key) => `${key} ${tuning[key]}`)
        .join(' · ');
    }
  };

  const onTune = (event: Event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset.tune as keyof Tuning | undefined;
    if (!key) return;
    const p = position();
    tuning[key] = Number(input.value);
    showTuning();
    if (key === 'travel' || key === 'size') {
      measure();
      window.scrollTo({ top: scrollFor(p), behavior: 'auto' });
    }
    schedule();
  };

  for (const input of inputs) {
    const key = input.dataset.tune as keyof Tuning;
    input.value = String(tuning[key]);
  }

  measure();
  showTuning();
  render();

  const tune = track.querySelector<HTMLDetailsElement>('.wheel-tune');
  // On a phone the knobs would sit over the column, so they start folded.
  if (tune && window.matchMedia('(max-width: 639.98px)').matches) tune.open = false;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  stage.addEventListener('click', onClick);
  stage.addEventListener('focusin', onFocusIn);
  stage.addEventListener('keydown', onKeyDown);
  stage.addEventListener('pointerdown', onPointerDown);
  stage.addEventListener('pointermove', onPointerMove);
  stage.addEventListener('pointerup', onPointerUp);
  stage.addEventListener('pointercancel', onPointerUp);
  stage.addEventListener('dragstart', onDragStart);
  tune?.addEventListener('input', onTune);

  teardown = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(settleTimer);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
  };
  document.addEventListener('astro:before-swap', () => teardown?.(), { once: true });
}
