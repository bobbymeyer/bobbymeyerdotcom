// The misprint — the address that missed, printed in three process plates.
//
// Each plate is a halftone screen of the same words at its own screen angle,
// the way a press lays them, and the three are multiplied on white so they
// meet as ink meets ink. At rest they sit almost in register and drift, like
// the mark in the header. Dragging pulls them apart along the drag, each plate
// by its own amount; letting go lets them settle back. Arrow keys do the same
// for a reader without a pointer.
//
// The screens are drawn once per size into a canvas per plate, so a frame is
// three image draws, not twenty thousand dots.

type Plate = {
  ink: string;
  /** Screen angle in degrees: the conventional cyan 15, magenta 75, yellow 0. */
  angle: number;
  /** How much of the plate is printed where the type is solid, 0 to 1. */
  coverage: number;
  /**
   * How this plate follows a drag: the drag turned through this many degrees.
   * Magenta follows, cyan goes the other way and yellow goes across, so a drag
   * in any direction parts all three — on one line, two of them would always
   * sit together and read as a single red or green.
   */
  turn: number;
  /**
   * Which way this plate sits off register, each its own way: at rest just
   * enough that all three inks show at the edges before anyone touches it, and
   * further when the figure blooms.
   */
  rest: [number, number];
  /** Phase of the resting drift, so no two plates move together. */
  phase: number;
  canvas: HTMLCanvasElement;
};

const INKS = { cyan: '#00aeef', magenta: '#ec008c', yellow: '#fff200' };
const MAX_CHARS = 28;
/**
 * The most empty sheet the canvas keeps round the type, and so how far a plate
 * can be pulled without running off what is drawn. CSS px. Narrower where the
 * page's own gutter is narrower: the sheet stops at the edge of the screen.
 */
const REACH = 24;
const LEADING = 0.92;

let teardown: (() => void) | null = null;

function missedPath(): string {
  let path = location.pathname;
  try {
    path = decodeURIComponent(path);
  } catch {
    // A malformed escape is still the address they typed; print it raw.
  }
  path = path.replace(/\/+$/, '') || '/';
  return path.length > MAX_CHARS ? path.slice(0, MAX_CHARS - 1) + '…' : path;
}

/** The words as a coverage mask: alpha 0 to 255, softened so edges carry tone. */
function drawMask(lines: string[], w: number, h: number, size: number, font: string, dpr: number, room: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.filter = `blur(${Math.max(1, size * 0.012) * dpr}px)`;
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  g.font = `600 ${size * dpr}px ${font}`;
  g.letterSpacing = `${-0.025 * size * dpr}px`;
  const pad = room * dpr;
  lines.forEach((line, i) => g.fillText(line, pad, pad + size * dpr * (0.8 + i * LEADING)));
  return g.getImageData(0, 0, w, h).data;
}

/** One plate: dots on a grid rotated to the plate's angle, sized by coverage. */
function screen(plate: Plate, mask: Uint8ClampedArray, w: number, h: number, cell: number) {
  plate.canvas.width = w;
  plate.canvas.height = h;
  const g = plate.canvas.getContext('2d')!;
  g.fillStyle = plate.ink;
  const a = (plate.angle * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const reach = Math.hypot(w, h);
  // Walk the rotated grid across a square big enough to cover the canvas at
  // any angle, and keep the dots that land on it.
  for (let v = -reach; v < reach; v += cell) {
    for (let u = -reach; u < reach; u += cell) {
      const x = u * cos - v * sin;
      const y = u * sin + v * cos;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const tone = (mask[((y | 0) * w + (x | 0)) * 4 + 3] / 255) * plate.coverage;
      if (tone < 0.04) continue;
      // Area, not radius, carries the tone, so a dot's radius goes with the
      // square root. Kept short of the point where neighbouring dots join, so even
      // the solid parts of the type still read as a screen.
      const r = cell * 0.56 * Math.sqrt(tone);
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  }
}

export function initMisprint() {
  teardown?.();
  const root = document.querySelector<HTMLElement>('[data-misprint]');
  if (!root) return;
  const view = root.querySelector('canvas')!;
  const text = missedPath();
  root.hidden = false;

  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const plates: Plate[] = [
    { ink: INKS.cyan, angle: 15, coverage: 0.62, turn: 180, rest: [-2.2, -0.8], phase: 0, canvas: document.createElement('canvas') },
    { ink: INKS.magenta, angle: 75, coverage: 0.56, turn: 0, rest: [2.2, -0.8], phase: 2.1, canvas: document.createElement('canvas') },
    { ink: INKS.yellow, angle: 0, coverage: 0.6, turn: 90, rest: [0, 2.2], phase: 4.2, canvas: document.createElement('canvas') },
  ];

  let w = 0;
  let room = REACH;
  let h = 0;
  let dpr = 1;
  // The pull: where the drag has taken the plates, and where they are now on
  // their way to it. Both in CSS pixels.
  const target = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  let drag: { id: number; x: number; y: number } | null = null;
  // The bloom: the plates blown a little further apart along their resting
  // offsets, the way a card's mark spreads on the index. 0 at rest, 1 bloomed.
  let bloom = 0;
  let bloomTo = 0;
  let frame = 0;

  const layout = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    const cssW = root.clientWidth;
    const box = root.getBoundingClientRect();
    room = Math.max(8, Math.floor(Math.min(REACH, box.left, document.documentElement.clientWidth - box.right)));
    view.style.width = `calc(100% + ${room * 2}px)`;
    view.style.margin = `${-room}px ${-room}px 0`;
    const font = getComputedStyle(root).fontFamily;
    const heading = parseFloat(getComputedStyle(document.querySelector('.notfound h1') ?? root).fontSize);
    const probe = document.createElement('canvas').getContext('2d')!;
    probe.font = `600 100px ${font}`;
    probe.letterSpacing = '-2.5px';
    const fitting = (ls: string[]) => (cssW / Math.max(...ls.map((l) => probe.measureText(l).width))) * 100;
    // One line where it fits at a size worth reading; otherwise broken after
    // each slash, the way the address is built, so a phone gets it big enough
    // to read rather than a strip of dots.
    let lines = [text];
    if (fitting(lines) < heading * 1.4) lines = text.split(/(?<=.\/)(?=.)/);
    // Never louder than the question mark: about twice the heading above it,
    // big enough that the screen reads as a screen and the words as words.
    // Broken over lines it is already a bigger mass, so it is set smaller.
    const size = Math.max(24, Math.min(fitting(lines), heading * (lines.length > 1 ? 1.5 : 2.1)));
    const cssH = Math.round(size * (0.8 + (lines.length - 1) * LEADING + 0.3) + room * 2);
    const cssWide = cssW + room * 2;
    w = Math.round(cssWide * dpr);
    h = Math.round(cssH * dpr);
    view.width = w;
    view.height = h;
    view.style.height = `${cssH}px`;
    const mask = drawMask(lines, w, h, size, font, dpr, room);
    // A screen coarse enough to read as a screen at arm's length, and fine
    // enough at phone sizes that a dot stays well under the width of a stroke.
    const cell = Math.max(2.4, size / (size < 60 ? 24 : 20)) * dpr;
    for (const p of plates) screen(p, mask, w, h, cell);
  };

  const draw = (t: number) => {
    frame = 0;
    // Ease toward the pull; a spring would overshoot, and a plate that
    // overshoots looks like it bounced off something rather than slid.
    now.x += (target.x - now.x) * 0.18;
    now.y += (target.y - now.y) * 0.18;
    bloom += (bloomTo - bloom) * 0.15;
    const g = view.getContext('2d')!;
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#fff';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'multiply';
    const drift = still.matches ? 0 : 1;
    for (const p of plates) {
      const s = t / 1000;
      const a = (p.turn * Math.PI) / 180;
      const px = now.x * Math.cos(a) - now.y * Math.sin(a);
      const py = now.x * Math.sin(a) + now.y * Math.cos(a);
      const spread = 0.8 + bloom * 1.2;
      const dx = (px + Math.sin(s * 0.7 + p.phase) * 0.5 * drift + p.rest[0] * spread) * dpr;
      const dy = (py + Math.cos(s * 0.5 + p.phase) * 0.4 * drift + p.rest[1] * spread) * dpr;
      g.drawImage(p.canvas, dx, dy);
    }
    const settling = Math.abs(target.x - now.x) + Math.abs(target.y - now.y) + Math.abs(bloomTo - bloom) > 0.02;
    if (drift || settling || drag) frame = requestAnimationFrame(draw);
  };

  const caption = root.querySelector<HTMLElement>('figcaption');
  const resting = caption?.textContent ?? '';
  const readout = () => {
    if (!caption) return;
    const off = Math.round(Math.hypot(target.x, target.y) * 2);
    caption.textContent = off ? `out of register by ${off}px. let go and it settles.` : resting;
  };

  const kick = () => {
    readout();
    if (!frame) frame = requestAnimationFrame(draw);
  };

  // Short of the sheet's margin, so the drift and the bloom still fit on it.
  const clamp = (n: number) => Math.max(-(room - 6), Math.min(room - 6, n));

  const down = (e: PointerEvent) => {
    drag = { id: e.pointerId, x: e.clientX - target.x, y: e.clientY - target.y };
    view.setPointerCapture(e.pointerId);
    root.dataset.dragging = '';
    kick();
  };
  const move = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    target.x = clamp((e.clientX - drag.x) * 0.5);
    target.y = clamp((e.clientY - drag.y) * 0.5);
    kick();
  };
  const up = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    delete root.dataset.dragging;
    target.x = 0;
    target.y = 0;
    kick();
  };
  const key = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 16 : 6;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter') {
      target.x = 0;
      target.y = 0;
    } else if (moves[e.key]) {
      target.x = clamp(target.x + moves[e.key][0]);
      target.y = clamp(target.y + moves[e.key][1]);
    } else return;
    e.preventDefault();
    kick();
  };

  // Pointing at it, or tabbing to it, blooms it: the same answer the index
  // gives a card, and the hint that the plates come apart. With no pointer to
  // point, scrolling it into view blooms it once and lets it settle.
  const hoverable = matchMedia('(hover: hover)');
  const enter = () => {
    if (hoverable.matches) {
      bloomTo = 1;
      kick();
    }
  };
  const leave = () => {
    if (document.activeElement === view) return;
    bloomTo = 0;
    kick();
  };
  const focus = () => {
    bloomTo = 1;
    kick();
  };
  const blur = () => {
    bloomTo = 0;
    kick();
  };
  let settle = 0;
  const seen = new IntersectionObserver(
    ([entry]) => {
      if (hoverable.matches || !entry.isIntersecting) return;
      seen.disconnect();
      bloomTo = 1;
      kick();
      settle = window.setTimeout(() => {
        bloomTo = 0;
        kick();
      }, 1200);
    },
    { threshold: 0.6 },
  );
  seen.observe(view);

  view.addEventListener('pointerenter', enter);
  view.addEventListener('pointerleave', leave);
  view.addEventListener('focus', focus);
  view.addEventListener('blur', blur);
  view.addEventListener('pointerdown', down);
  view.addEventListener('pointermove', move);
  view.addEventListener('pointerup', up);
  view.addEventListener('pointercancel', up);
  view.addEventListener('keydown', key);
  still.addEventListener('change', kick);

  let resized = 0;
  const ro = new ResizeObserver(() => {
    cancelAnimationFrame(resized);
    resized = requestAnimationFrame(() => {
      layout();
      kick();
    });
  });

  // The face has to be in before the screens are cut, or the first set is cut
  // from the fallback font and never redrawn.
  document.fonts.ready.then(() => {
    if (!root.isConnected) return;
    layout();
    ro.observe(root);
    kick();
  });

  teardown = () => {
    cancelAnimationFrame(frame);
    ro.disconnect();
    seen.disconnect();
    clearTimeout(settle);
    still.removeEventListener('change', kick);
    teardown = null;
  };
}

// The client router swaps the DOM without a full reload; stop the loop before
// each swap so no frame is drawn into a canvas that has left the page.
document.addEventListener('astro:before-swap', () => teardown?.());
