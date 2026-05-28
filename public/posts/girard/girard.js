// girard — textile pattern tool, v0.1 (SVG-native).
// All geometry lives in SVG: shapes are <circle>/<rect>/<polygon>,
// repeat is an SVG <pattern>, hex tiling uses a clipPath alpha mask.
// No canvas, no raster — export to SVG is just serializing the DOM.

const SVG_NS = 'http://www.w3.org/2000/svg';

// ---------- Seeded PRNG (mulberry32) ----------
function makeRng(seed) {
  let s = (seed | 0) >>> 0 || 1;
  return function rng() {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Default pattern ----------
const defaultPattern = () => ({
  seed: 1,
  tileSize: 480,
  repeat: 'square',                                  // square | half-drop | half-brick | hex
  palette: ['#e94e3b', '#f4c44b', '#1f6b8a', '#2c3e50', '#f5e9d0'],
  background: '#f5e9d0',
  layers: [
    {
      kind: 'shape',
      shape: { kind: 'circle', r: 22 },
      grid: { cols: 6, rows: 6 },
      modifiers: {
        scale:  { type: 'random', min: 0.55, max: 1.2 },
        rotate: { type: 'random', min: 0, max: 360 },
        jitter: { type: 'random', min: -10, max: 10 },
        color:  { type: 'palette' },
      },
    },
    {
      kind: 'shape',
      shape: { kind: 'square', size: 14 },
      grid: { cols: 6, rows: 6, originOffset: 0.5 },
      modifiers: {
        scale:  { type: 'random', min: 0.4, max: 1.1 },
        rotate: { type: 'random', min: 0, max: 45 },
        jitter: { type: 'random', min: -6, max: 6 },
        color:  { type: 'palette' },
      },
    },
  ],
});

// Stripes layer template, inserted at the bottom of the layer stack
// when the user turns stripes on.
const stripesLayer = (orientation) => ({
  kind: 'stripes',
  orientation,                                       // horizontal | vertical
  count: 8,
  widthJitter: 0.6,                                  // 0 uniform, 1 max variation
  colorMode: 'palette-cycle',                        // palette-cycle | palette-random
});

// ---------- Modifier evaluation ----------
function evalMod(mod, rng, col, row, base) {
  if (!mod) return base;
  switch (mod.type) {
    case 'random': return mod.min + rng() * (mod.max - mod.min);
    case 'sine':   return (mod.amp || 1) * Math.sin(col * (mod.fx || 0) + row * (mod.fy || 0)) + (mod.offset || 0);
    case 'linear': return base + col * (mod.dx || 0) + row * (mod.dy || 0);
    default:       return base;
  }
}

function pickColor(mod, rng, palette) {
  if (!mod || mod.type === 'palette') {
    return palette[Math.floor(rng() * palette.length)];
  }
  return mod.value || '#000';
}

// ---------- SVG helpers ----------
function el(tag, attrs, children) {
  const node = document.createElementNS(SVG_NS, tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v != null) node.setAttribute(k, String(v));
  }
  if (children) for (const c of children) node.appendChild(c);
  return node;
}

function shapeNode(shape, fill) {
  switch (shape.kind) {
    case 'circle':
      return el('circle', { r: shape.r, fill });
    case 'square':
      return el('rect', {
        x: -shape.size / 2, y: -shape.size / 2,
        width: shape.size, height: shape.size, fill,
      });
    case 'triangle': {
      const s = shape.size || 20;
      return el('polygon', {
        points: `0,${-s} ${s * 0.866},${s * 0.5} ${-s * 0.866},${s * 0.5}`,
        fill,
      });
    }
    default:
      return el('g', {});
  }
}

// ---------- Tile content ----------
// Builds a <g> containing every layer in the tile. Each layer dispatches
// to its own renderer keyed off layer.kind.
function buildTileGroup(pattern) {
  const N = pattern.tileSize;
  const root = el('g');

  pattern.layers.forEach((layer, li) => {
    const rng = makeRng(pattern.seed + li * 9973);
    if (layer.kind === 'stripes') {
      renderStripes(root, layer, N, rng, pattern.palette);
    } else {
      renderShapeGrid(root, layer, N, rng, pattern.palette);
    }
  });

  return root;
}

// Stripes layer: parallel rows or columns of solid color, widths
// summing exactly to N so the stripes themselves tile seamlessly.
function renderStripes(parent, layer, N, rng, palette) {
  const count = Math.max(1, layer.count | 0);
  const jitter = Math.max(0, Math.min(1, layer.widthJitter ?? 0));

  // Generate per-stripe weights with jitter, then normalise so the
  // widths sum to exactly N regardless of jitter.
  const weights = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const w = 1 + jitter * (rng() * 2 - 1);
    const clamped = Math.max(0.1, w);
    weights.push(clamped);
    sum += clamped;
  }
  const widths = weights.map(w => (w / sum) * N);

  let pos = 0;
  for (let i = 0; i < count; i++) {
    const w = widths[i];
    const color = layer.colorMode === 'palette-random'
      ? palette[Math.floor(rng() * palette.length)]
      : palette[i % palette.length];
    const attrs = layer.orientation === 'vertical'
      ? { x: pos, y: 0, width: w, height: N, fill: color }
      : { x: 0, y: pos, width: N, height: w, fill: color };
    parent.appendChild(el('rect', attrs));
    pos += w;
  }
}

// Shape-on-grid layer: places one shape per grid cell with optional
// per-cell scale / rotate / jitter / colour modifiers, drawn at 9
// wrapped positions so shapes that cross the tile edge appear on the
// opposite side.
function renderShapeGrid(parent, layer, N, rng, palette) {
  const { cols, rows, originOffset = 0 } = layer.grid;
  const cw = N / cols, rh = N / rows;
  const off = originOffset * (cw + rh) / 2;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const cx = col * cw + cw / 2 + off;
      const cy = row * rh + rh / 2 + off;
      const m = layer.modifiers;
      const s  = evalMod(m.scale,  rng, col, row, 1);
      const r  = evalMod(m.rotate, rng, col, row, 0);
      const jx = evalMod(m.jitter, rng, col, row, 0);
      const jy = evalMod(m.jitter, rng, col, row, 0);
      const color = pickColor(m.color, rng, palette);
      for (let dy = -N; dy <= N; dy += N) {
        for (let dx = -N; dx <= N; dx += N) {
          const node = shapeNode(layer.shape, color);
          node.setAttribute(
            'transform',
            `translate(${cx + jx + dx} ${cy + jy + dy}) rotate(${r}) scale(${s})`,
          );
          parent.appendChild(node);
        }
      }
    }
  }
}

// Pointy-top hexagon path centered on the origin, flat-to-flat = w.
function hexagonPath(w) {
  const s = w / Math.sqrt(3); // side length
  return `M0,${-s} ${w / 2},${-s / 2} ${w / 2},${s / 2} 0,${s} ${-w / 2},${s / 2} ${-w / 2},${-s / 2}Z`;
}

// ---------- Repeat unit (SVG <pattern> body) ----------
// Returns { width, height, content[] } describing the geometry of
// one SVG <pattern> tile in user space.
function buildRepeatUnit(pattern, tileGroup) {
  const N = pattern.tileSize;
  switch (pattern.repeat) {
    case 'half-drop': {
      // Two-column unit: even col at y=0, odd col at y=N/2.
      const g1 = tileGroup.cloneNode(true);
      const g2 = tileGroup.cloneNode(true);
      g2.setAttribute('transform', `translate(${N} ${N / 2})`);
      return { width: N * 2, height: N, content: [g1, g2] };
    }
    case 'half-brick': {
      const g1 = tileGroup.cloneNode(true);
      const g2 = tileGroup.cloneNode(true);
      g2.setAttribute('transform', `translate(${N / 2} ${N})`);
      return { width: N, height: N * 2, content: [g1, g2] };
    }
    case 'hex': {
      // Pointy-top hex tiling. Hex width (flat-to-flat) = N. Two
      // hex cells per rectangular unit; the second wraps to both
      // edges of the unit so it tiles seamlessly.
      const w = N;
      const side = N / Math.sqrt(3);
      const rowStep = 1.5 * side;       // vertical centre-to-centre
      const unitH = 2 * rowStep;        // unit covers two row steps
      const clipId = 'girard-hex-clip';

      const clipPath = el('clipPath', { id: clipId },
        [el('path', { d: hexagonPath(w) })]);

      const place = (cx, cy) => {
        const wrap = el('g', {
          transform: `translate(${cx} ${cy})`,
          'clip-path': `url(#${clipId})`,
        });
        const inner = tileGroup.cloneNode(true);
        inner.setAttribute('transform', `translate(${-N / 2} ${-N / 2})`);
        wrap.appendChild(inner);
        return wrap;
      };

      const content = [
        clipPath,
        place(w / 2, rowStep / 2),       // upper hex, centered in unit
        place(0,     rowStep / 2 + rowStep), // lower hex, wrapping left
        place(w,     rowStep / 2 + rowStep), // lower hex, wrapping right
      ];
      return { width: w, height: unitH, content };
    }
    default: {
      return { width: N, height: N, content: [tileGroup] };
    }
  }
}

// ---------- Top-level SVG ----------
function buildSvg(pattern, viewSize = pattern.tileSize * 3) {
  const root = el('svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${viewSize} ${viewSize}`,
    width: '100%',
    height: '100%',
  });

  const tileGroup = buildTileGroup(pattern);
  const unit = buildRepeatUnit(pattern, tileGroup);

  const patternId = 'girard-tile';
  const tilePattern = el('pattern', {
    id: patternId,
    width: unit.width,
    height: unit.height,
    patternUnits: 'userSpaceOnUse',
  });
  unit.content.forEach(n => tilePattern.appendChild(n));

  const defs = el('defs', {}, [tilePattern]);
  root.appendChild(defs);

  // Background.
  root.appendChild(el('rect', {
    width: viewSize, height: viewSize, fill: pattern.background,
  }));

  // 3x3 visualization: pattern fills the whole viewport, but the
  // outer ring of cells is rendered at lower opacity so the centre
  // cell reads as the "live" tile. Each rect references the same
  // <pattern>, which uses userSpaceOnUse — the tile keeps registering
  // across rect boundaries.
  const cell = viewSize / 3;
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const isCenter = row === 1 && col === 1;
      root.appendChild(el('rect', {
        x: col * cell, y: row * cell,
        width: cell, height: cell,
        fill: `url(#${patternId})`,
        opacity: isCenter ? 1 : 0.35,
      }));
    }
  }

  return root;
}

// ---------- Mount ----------
function mount() {
  const stage = document.getElementById('girard-stage');
  if (!stage) return;

  let pattern = defaultPattern();

  const rerender = () => {
    stage.replaceChildren(buildSvg(pattern));
  };

  rerender();

  const seed       = document.getElementById('girard-seed');
  const roll       = document.getElementById('girard-roll');
  const repeat     = document.getElementById('girard-repeat');
  const density    = document.getElementById('girard-density');
  const stripeSel  = document.getElementById('girard-stripes');
  const stripeNum  = document.getElementById('girard-stripe-count');
  const stripeJit  = document.getElementById('girard-stripe-jitter');

  const findStripes = () => pattern.layers.find(l => l.kind === 'stripes');

  seed.addEventListener('input', () => {
    pattern.seed = Number(seed.value) | 0;
    rerender();
  });

  roll.addEventListener('click', () => {
    const s = Math.floor(Math.random() * 99999);
    seed.value = s;
    pattern.seed = s;
    rerender();
  });

  repeat.addEventListener('change', () => {
    pattern.repeat = repeat.value;
    rerender();
  });

  density.addEventListener('input', () => {
    const d = Number(density.value) | 0;
    pattern.layers
      .filter(l => l.kind !== 'stripes')
      .forEach(l => { l.grid.cols = d; l.grid.rows = d; });
    rerender();
  });

  stripeSel.addEventListener('change', () => {
    const existing = findStripes();
    if (stripeSel.value === 'off') {
      if (existing) pattern.layers = pattern.layers.filter(l => l !== existing);
    } else {
      const next = existing || stripesLayer(stripeSel.value);
      next.orientation = stripeSel.value;
      next.count = Number(stripeNum.value) | 0;
      next.widthJitter = Number(stripeJit.value);
      if (!existing) pattern.layers.unshift(next);
    }
    rerender();
  });

  stripeNum.addEventListener('input', () => {
    const s = findStripes();
    if (s) { s.count = Number(stripeNum.value) | 0; rerender(); }
  });

  stripeJit.addEventListener('input', () => {
    const s = findStripes();
    if (s) { s.widthJitter = Number(stripeJit.value); rerender(); }
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
