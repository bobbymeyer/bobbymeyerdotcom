// girard — textile pattern tool, v0.3 (SVG-native, grid-first).
//
// Every layer IS a grid. The grid defines cols × rows, an optional
// per-row or per-col offset (brick / drop), and a fill that goes in
// each cell. Fills can be solid colour, a shape, or another layer
// (nested grids — the "stripes of dashes" Girard move).
//
// What used to be stripes / checkered / random-shapes are all just
// presets over this one model:
//   horizontal stripes = cols 1 × rows N, solid (palette cycles)
//   vertical stripes   = cols N × rows 1, solid
//   half-brick stripes = cols N × rows M, offset.x 0.5, alternate-row
//   checker            = cols N × rows N, solid (palette cycles)
//   dots               = cols N × rows N, shape: circle
//   random dots        = same + vary scale / rotate / jitter / colour

const SVG_NS = 'http://www.w3.org/2000/svg';

const BLEND_MODES = [
  'normal', 'multiply', 'screen', 'overlay',
  'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion',
];

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

function mod(a, n) { return ((a % n) + n) % n; }

// ---------- Colour helpers ----------
function parseColor(str) {
  if (!str || str === 'transparent' || str === 'none') return { r: 0, g: 0, b: 0, a: 0 };
  if (typeof str === 'string' && str.startsWith('#')) {
    const h = str.slice(1);
    if (h.length === 3) return { r: parseInt(h[0]+h[0],16), g: parseInt(h[1]+h[1],16), b: parseInt(h[2]+h[2],16), a: 1 };
    if (h.length === 6) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: 1 };
    if (h.length === 8) return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16), a: parseInt(h.slice(6,8),16) / 255 };
  }
  const m = String(str).match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] != null ? +m[4] : 1 };
  return { r: 0, g: 0, b: 0, a: 1 };
}
function formatColor({ r, g, b, a }) {
  if (a <= 0) return 'transparent';
  const hex = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  if (a >= 1) return '#' + hex(r) + hex(g) + hex(b);
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${(+a).toFixed(3)})`;
}

// ---------- Default pattern ----------
const defaultPattern = () => ({
  seed: 1,
  tileSize: 480,
  repeat: 'square',                                  // square | half-drop | half-brick
  palette: ['#e94e3b', '#f4c44b', '#1f6b8a', '#2c3e50', '#f5e9d0'],
  surroundVeil: 0.5,
  layers: [
    makeLayer('solid'),
  ],
});

// ---------- Sample library ----------
// Each entry is a partial pattern: a layers stack plus optional
// palette / repeat overrides. Loading either replaces the current
// pattern (default palette + repeat reset) or appends the sample's
// layers on top of the existing pattern.
const SAMPLES = {
  'starter dots': {
    palette: ['#f5e9d0', '#e94e3b', '#f4c44b', '#1f6b8a', '#2c3e50'],
    layers: [
      { grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f5e9d0', mode: 'fixed' } },
      { grid: { cols: 8, rows: 8, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'shape', shape: { kind: 'circle', size: 0.5 }, mode: 'palette-cycle' } },
    ],
  },
  'Quatrefoil': {
    // 16x16 grid of quatrefoils (4 overlapping circles each), random
    // palette pick per cell from a saturated 12-colour set, over an
    // off-white ground.
    palette: [
      '#d3367c', '#283a78', '#1d99b2', '#5d8e4d', '#a06236', '#cd3a6e',
      '#e88438', '#c5377a', '#cc7d96', '#f06a8e', '#3b7ec6', '#8a3973',
    ],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f5f0e6', mode: 'fixed' },
      },
      {
        grid: { cols: 16, rows: 16, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: { kind: 'quatrefoil', size: 0.85 },
          mode: 'random',
        },
        palette: [
          '#d3367c', '#283a78', '#1d99b2', '#5d8e4d', '#a06236', '#cd3a6e',
          '#e88438', '#c5377a', '#cc7d96', '#f06a8e', '#3b7ec6', '#8a3973',
        ],
      },
    ],
  },
  'Triangle': {
    // Cream ground; an equilateral triangle tessellation with a 14-col
    // 16-strip grid (close to square aspect). Palette is heavy on
    // 'transparent' so most triangles drop out as cream — leaving
    // scattered colour, like the 1952 print.
    palette: ['#e85a3a', '#cc2d4f', '#a8327a', '#f6efe1'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f6efe1', mode: 'fixed' },
      },
      {
        grid: { cols: 14, rows: 16, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'triangles',
          mode: 'random',
          strokeWidth: 0.025,
          stroke: '#f6efe1',
        },
        palette: [
          '#e85a3a', '#cc2d4f', '#a8327a',
          'transparent', 'transparent', 'transparent', 'transparent',
        ],
      },
    ],
  },
  'Triangular lattice': {
    // Cream ground; one mesh layer fills the tile with a jittered
    // triangle field. Palette cycles two colours per cell (one per
    // triangle of the / split); white stroke holds the edges.
    palette: ['#d24a45', '#f5e9d0'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f5e9d0', mode: 'fixed' },
      },
      {
        grid: { cols: 14, rows: 14, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'mesh',
          mode: 'palette-cycle',
          jitter: 0.32,
          strokeWidth: 0.025,
          stroke: '#f5e9d0',
        },
        palette: ['#d24a45', '#c44741', '#b34038', '#d24a45'],
      },
    ],
  },
  'Checker split': {
    // Off-white ground; a 22x22 split-fill grid picks two random
    // palette entries per cell with one of four 90° rotations. With
    // 'transparent' in the palette some halves (or whole cells) read
    // as empty, and duplicate solid entries mean some cells land
    // wholly filled.
    palette: ['#1c1c2c', '#e0dfd5'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3f0e6', mode: 'fixed' },
      },
      {
        grid: { cols: 22, rows: 22, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'split', mode: 'random' },
        // Weighting: dark + light twice each, transparent once. Tunes
        // the share of empty vs half-filled vs full cells.
        palette: ['#1c1c2c', '#1c1c2c', '#e0dfd5', '#e0dfd5', 'transparent'],
      },
    ],
  },
  'Checker': {
    // Two-colour checker via the diagonal-index colour mode.
    palette: ['#d4c89c', '#4f3d20'],
    layers: [
      {
        grid: { cols: 12, rows: 12, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', mode: 'checker' },
        palette: ['#d4c89c', '#4f3d20'],
      },
    ],
  },
  'Brick': {
    // Tan ground; a 5x12 brick grid with alternate-row x-offset of
    // 0.5 and asymmetric gutters lets the tan show through as
    // mortar. Wrap cells fill the staggered left edge on odd rows.
    palette: ['#d3b288', '#d2624d'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#d3b288', mode: 'fixed' },
      },
      {
        grid: {
          cols: 5, rows: 12,
          offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row',
          gutterX: 0.04, gutterY: 0.10,
        },
        fill: { kind: 'solid', color: '#d2624d', mode: 'fixed' },
      },
    ],
  },
  'Geometric cross': {
    // White ground; one 3x3 grid weighted [9,2,9] in both axes
    // paints the cross — the four corners are transparent so the
    // ground shows through; the cross cells are blue. A 2x2 grid
    // of red squares fills the four quadrants.
    palette: ['#f3efe1', '#5b85be', '#e23827'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3efe1', mode: 'fixed' },
      },
      {
        grid: {
          cols: 3, rows: 3,
          colWeights: [9, 2, 9], rowWeights: [9, 2, 9],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        // 3x3 cells indexed (col + row*cols): corners go transparent,
        // the five cross cells get blue.
        palette: [
          'transparent', '#5b85be', 'transparent',
          '#5b85be',     '#5b85be', '#5b85be',
          'transparent', '#5b85be', 'transparent',
        ],
      },
      {
        grid: { cols: 2, rows: 2, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'shape', shape: { kind: 'square', size: 0.35 }, mode: 'palette-cycle' },
        palette: ['#e23827'],
      },
    ],
  },
  'Rayamax stripe': {
    // Order: black, yellow, grey, pink, blue, white. Two small + one
    // large band on each side, repeating vertically.
    palette: ['#1a1c2c', '#e8d36a', '#c2c4ce', '#e8a4c2', '#7e8fbe', '#f3efe1'],
    layers: [
      {
        grid: {
          cols: 1, rows: 6,
          rowWeights: [1, 1, 8, 1, 1, 8],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['#1a1c2c', '#e8d36a', '#c2c4ce', '#e8a4c2', '#7e8fbe', '#f3efe1'],
      },
    ],
  },
};

function loadSample(name, current, clear) {
  const sample = SAMPLES[name];
  if (!sample) return current;
  const layers = JSON.parse(JSON.stringify(sample.layers));
  // Surface the sample's palette on each layer that uses palette
  // cycling but doesn't carry its own; otherwise the per-layer
  // palette editor would appear empty even though the renderer is
  // pulling colours from pattern.palette.
  const usesPalette = (l) => {
    const paletteModes = ['palette-cycle', 'checker', 'random'];
    return (l.fill?.kind === 'solid' && paletteModes.includes(l.fill?.mode))
        || (l.fill?.kind === 'shape' && (paletteModes.includes(l.fill?.mode) || l.vary?.color?.type === 'palette'))
        || (l.fill?.kind === 'split')
        || (l.fill?.kind === 'mesh' && l.fill?.mode === 'palette-cycle')
        || (l.fill?.kind === 'triangles' && (l.fill?.mode === 'palette-cycle' || l.fill?.mode === 'random'));
  };
  if (sample.palette) {
    for (const l of layers) {
      if (usesPalette(l) && !l.palette) l.palette = [...sample.palette];
    }
  }
  if (clear) {
    return {
      ...defaultPattern(),
      ...(sample.palette ? { palette: sample.palette } : {}),
      ...(sample.repeat ? { repeat: sample.repeat } : {}),
      layers,
    };
  }
  return { ...current, layers: [...current.layers, ...layers] };
}
function makeLayer(spec) {
  switch (spec) {
    case 'solid':
      return {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#8a8a8a', mode: 'fixed' },
      };
    case 'h-stripes':
      return {
        grid: { cols: 1, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', mode: 'palette-cycle' },
      };
    case 'v-stripes':
      return {
        grid: { cols: 6, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', mode: 'palette-cycle' },
      };
    case 'brick':
      return {
        grid: { cols: 6, rows: 8, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'solid', mode: 'palette-cycle' },
      };
    case 'checker':
      return {
        grid: { cols: 6, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', mode: 'palette-cycle' },
      };
    case 'dots':
      return {
        grid: { cols: 6, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'shape', shape: { kind: 'circle', size: 0.6 }, mode: 'palette-cycle' },
      };
    case 'random':
      return {
        grid: { cols: 6, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'shape', shape: { kind: 'circle', size: 0.6 }, mode: 'palette-cycle' },
        vary: {
          scale:  { type: 'random', min: 0.5, max: 1.2 },
          rotate: { type: 'random', min: -180, max: 180 },
          jitter: { type: 'random', min: -0.2, max: 0.2 },
        },
      };
  }
}

// Human label derived from the layer's structure.
function layerLabel(layer) {
  const { cols, rows, offsetMode } = layer.grid;
  let body;
  if (layer.fill.kind === 'solid') body = (cols === 1 && rows === 1) ? 'solid' : 'tiles';
  else if (layer.fill.kind === 'shape') body = (layer.fill.shape?.kind || 'shape') + 's';
  else body = 'nested';
  const off = offsetMode !== 'none' ? ' ↻' : '';
  const v = layer.vary ? ' ★' : '';
  return `${cols}×${rows} ${body}${off}${v}`;
}

// ---------- Modifier evaluation ----------
function evalMod(modSpec, rng, col, row, base) {
  if (!modSpec) return base;
  switch (modSpec.type) {
    case 'random': return modSpec.min + rng() * (modSpec.max - modSpec.min);
    case 'sine':   return (modSpec.amp || 1) * Math.sin(col * (modSpec.fx || 0) + row * (modSpec.fy || 0)) + (modSpec.offset || 0);
    case 'linear': return base + col * (modSpec.dx || 0) + row * (modSpec.dy || 0);
    default:       return base;
  }
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

// Shape.size is a fraction (0..1) of the smaller cell dimension.
// Lets shapes scale with the grid instead of needing absolute pixels.
function shapeNode(shape, cw, rh, fill, ctx) {
  const dim = Math.min(cw, rh) * (shape.size ?? 0.6);
  // Optional stroke. strokeWidth is a fraction of the smaller cell
  // dim so outlines scale with the grid.
  const swFrac = shape.strokeWidth;
  const sw = (swFrac != null && swFrac > 0) ? swFrac * Math.min(cw, rh) : 0;
  const strokeAttrs = sw > 0
    ? { stroke: shape.stroke || '#000000', 'stroke-width': sw, 'stroke-linejoin': 'round' }
    : {};

  switch (shape.kind) {
    case 'circle':
      return el('circle', { r: dim / 2, fill, ...strokeAttrs });
    case 'square':
      return el('rect', {
        x: -dim / 2, y: -dim / 2, width: dim, height: dim, fill,
        ...strokeAttrs,
      });
    case 'triangle': {
      const r = dim / 2;
      return el('polygon', {
        points: `0,${-r} ${r * 0.866},${r * 0.5} ${-r * 0.866},${r * 0.5}`,
        fill,
        ...strokeAttrs,
      });
    }
    case 'quatrefoil': {
      // 4 tangent circles forming a clover. r = off = dim/4 makes
      // the lobes touch at single points on the axes (sharp cusps).
      // shape.center adds a 5th circle at the origin with radius
      // (shape.center × dim/4) — 0 disables it, 1 matches the lobe
      // radius, default 0.5 = a soft accent that fills the centre
      // diamond.
      const r = dim / 4;
      const off = dim / 4;
      // Default 1: centre circle radius equals lobe radius, which
      // exactly inscribes the four tangent points — the diamond gap
      // between the lobes is fully covered.
      const centerScale = shape.center ?? 1;
      const g = el('g', {});
      for (const [sx, sy] of [[-1,-1],[1,-1],[-1,1],[1,1]]) {
        g.appendChild(el('circle', {
          cx: sx * off, cy: sy * off, r,
          fill, ...strokeAttrs,
        }));
      }
      if (centerScale > 0) {
        g.appendChild(el('circle', {
          cx: 0, cy: 0, r: r * centerScale,
          fill, ...strokeAttrs,
        }));
      }
      return g;
    }
    case 'star': {
      const numPoints = Math.max(3, shape.numPoints | 0 || 5);
      const depth = Math.max(0.05, Math.min(1, shape.depth ?? 0.5));
      const jitter = Math.max(0, Math.min(1, shape.jitter ?? 0));
      const rng = ctx?.rng;
      const outerR = dim / 2;
      const innerR = outerR * depth;
      const verts = [];
      for (let i = 0; i < numPoints * 2; i++) {
        const angle = (Math.PI * 2 * i) / (numPoints * 2) - Math.PI / 2;
        let r = i % 2 === 0 ? outerR : innerR;
        if (jitter > 0 && rng) r += (rng() * 2 - 1) * jitter * outerR;
        verts.push(`${(r * Math.cos(angle)).toFixed(2)},${(r * Math.sin(angle)).toFixed(2)}`);
      }
      return el('polygon', {
        points: verts.join(' '),
        fill,
        ...strokeAttrs,
      });
    }
    case 'text': {
      // shape.text can be a string or array. Arrays cycle per cell
      // using the same formula as the fill colour mode (see ctx).
      const list = Array.isArray(shape.text) ? shape.text
                 : (typeof shape.text === 'string' ? [shape.text] : ['BI']);
      const t = list[(ctx?.textIndex ?? 0) % list.length] ?? list[0];
      const node = el('text', {
        fill,
        'font-family': shape.fontFamily || 'sans-serif',
        'font-weight': shape.fontWeight || 'bold',
        'font-style': shape.fontStyle || 'italic',
        'font-size': dim,
        'text-anchor': 'middle',
        'dominant-baseline': 'central',
        ...strokeAttrs,
        ...(sw > 0 ? { 'paint-order': 'stroke fill' } : {}),
      });
      node.textContent = t;
      return node;
    }
    default:
      return el('g', {});
  }
}

// ---------- Layer rendering ----------
function buildTileGroup(pattern) {
  const N = pattern.tileSize;
  const root = el('g');
  pattern.layers.forEach((layer, li) => {
    renderLayer(root, layer, 0, 0, N, N, pattern.palette, pattern.seed + li * 9973);
  });
  return root;
}

// Recursive layer renderer. (x, y, w, h) is the layer's canvas in
// user-space units (the tile for top-level layers; the parent cell
// for nested layers).
function renderLayer(parent, layer, x, y, w, h, parentPalette, rngSeed) {
  const group = el('g');
  const blend = layer.blendMode && layer.blendMode !== 'normal' ? `mix-blend-mode: ${layer.blendMode};` : '';
  const op = layer.opacity != null && layer.opacity < 1 ? `opacity: ${layer.opacity};` : '';
  if (blend || op) group.setAttribute('style', blend + op);
  parent.appendChild(group);

  const palette = layer.palette && layer.palette.length ? layer.palette : parentPalette;
  const rng = makeRng(rngSeed);
  const { cols, rows, rowWeights, colWeights,
          offset = { x: 0, y: 0 }, offsetMode = 'none' } = layer.grid;

  // Per-cell dimensions. With *Weights present, each cell occupies
  // its share of the canvas (weight / sum) — count comes from the
  // array length. Without weights, uniform cells from cols / rows.
  const widths  = colWeights && colWeights.length
    ? normWeights(colWeights, w)
    : Array(cols).fill(w / cols);
  const heights = rowWeights && rowWeights.length
    ? normWeights(rowWeights, h)
    : Array(rows).fill(h / rows);
  const nCols = widths.length, nRows = heights.length;
  // Cumulative starts in user space (relative to x / y).
  const xStarts = [0];
  for (let i = 0; i < nCols; i++) xStarts.push(xStarts[i] + widths[i]);
  const yStarts = [0];
  for (let j = 0; j < nRows; j++) yStarts.push(yStarts[j] + heights[j]);

  // Layer-canvas bounds for shape wrap. A shape whose bounding box
  // crosses the layer edge is also painted at the opposite edge by
  // placeCellRect, so the layer reads continuously across its bounds.
  const layerBounds = { x, y, w, h };

  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col < nCols; col++) {
      placeCellRect(group, layer,
        x + xStarts[col] + (offsetMode === 'alternate-row' && row % 2 === 1 ? offset.x * widths[col] : 0),
        y + yStarts[row] + (offsetMode === 'alternate-col' && col % 2 === 1 ? offset.y * heights[row] : 0),
        widths[col], heights[row],
        col, row, nCols, nRows, rng, palette, layerBounds);
    }
    if (offsetMode === 'alternate-row' && row % 2 === 1 && offset.x !== 0) {
      const lastCol = nCols - 1;
      const cw = widths[lastCol], rh = heights[row];
      placeCellRect(group, layer,
        x - cw + offset.x * cw, y + yStarts[row], cw, rh,
        lastCol, row, nCols, nRows, rng, palette, layerBounds);
    }
  }
  if (offsetMode === 'alternate-col') {
    for (let col = 0; col < nCols; col++) {
      if (col % 2 === 1 && offset.y !== 0) {
        const lastRow = nRows - 1;
        const cw = widths[col], rh = heights[lastRow];
        placeCellRect(group, layer,
          x + xStarts[col], y - rh + offset.y * rh, cw, rh,
          col, lastRow, nCols, nRows, rng, palette, layerBounds);
      }
    }
  }
}

// Draws one cell as two triangles sharing a diagonal. dir ∈ [0..3]
// picks which diagonal and which side is colour A:
//   0:  \ , A = upper-right
//   1:  / , A = upper-left
//   2:  \ , A = lower-left
//   3:  / , A = lower-right
function drawSplit(parent, x, y, w, h, colorA, colorB, dir) {
  const tl = `${x},${y}`;
  const tr = `${x + w},${y}`;
  const br = `${x + w},${y + h}`;
  const bl = `${x},${y + h}`;
  const variants = [
    { pA: `${tl} ${tr} ${br}`, pB: `${tl} ${br} ${bl}` },
    { pA: `${tl} ${tr} ${bl}`, pB: `${tr} ${br} ${bl}` },
    { pA: `${tl} ${br} ${bl}`, pB: `${tl} ${tr} ${br}` },
    { pA: `${tr} ${br} ${bl}`, pB: `${tl} ${tr} ${bl}` },
  ];
  const { pA, pB } = variants[((dir % 4) + 4) % 4];
  const drawTri = (points, color) => {
    if (color == null || color === 'transparent' || color === 'none') return;
    parent.appendChild(el('polygon', { points, fill: color }));
  };
  drawTri(pA, colorA);
  drawTri(pB, colorB);
}

function normWeights(weights, total) {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return weights.map(w => (Math.max(0, w) / sum) * total);
}

function placeCellRect(parent, layer, cx, cy, cw, rh, col, row, cols, rows, rng, palette, layerBounds) {
  const { gutter, gutterX, gutterY } = layer.grid;
  const gX = gutterX ?? gutter ?? 0;
  const gY = gutterY ?? gutter ?? 0;
  const gx = cw * gX / 2;
  const gy = rh * gY / 2;
  const ix = cx + gx;
  const iy = cy + gy;
  const iw = cw - 2 * gx;
  const ih = rh - 2 * gy;
  // Wrap col/row for colour indexing so a wrap cell at col=-1 matches
  // the colour of col=cols-1.
  const ci = mod(col, cols), ri = mod(row, rows);
  const fill = layer.fill;

  // Transparent palette entries skip painting that cell — useful for
  // "draw only on certain grid positions" tricks (e.g. a cross made
  // of a 3x3 grid where the four corners are empty). Recognises the
  // string sentinels plus any rgba() / #rrggbb00 with alpha 0.
  const isTransparent = (c) => {
    if (c == null || c === 'transparent' || c === 'none') return true;
    if (typeof c === 'string') {
      if (/^rgba?\([^,]+,[^,]+,[^,]+,\s*0(?:\.0*)?\s*\)$/.test(c)) return true;
      if (/^#[0-9a-f]{6}00$/i.test(c)) return true;
    }
    return false;
  };

  // Index helpers per colour mode.
  //   palette-cycle: col + row * cols — unique index per cell. Use
  //     when you want to address specific cells in the palette.
  //   checker:       col + row        — diagonal cycling. Two colours
  //     make a classic checker; 3+ make diagonal bands.
  const paletteIndex = (mode) =>
    mode === 'checker' ? mod(ci + ri, palette.length)
                       : mod(ci + ri * cols, palette.length);

  switch (fill.kind) {
    case 'solid': {
      const color = (fill.mode === 'palette-cycle' || fill.mode === 'checker')
        ? palette[paletteIndex(fill.mode)]
        : fill.mode === 'random'
        ? palette[Math.floor(rng() * palette.length)]
        : (fill.color || '#888');
      if (isTransparent(color)) break;
      parent.appendChild(el('rect', {
        x: ix, y: iy, width: iw, height: ih, fill: color,
      }));
      break;
    }
    case 'shape': {
      const shape = fill.shape || { kind: 'circle', size: 0.6 };
      let s = 1, rot = 0, jx = 0, jy = 0;
      if (layer.vary?.scale)  s   = evalMod(layer.vary.scale,  rng, col, row, 1);
      if (layer.vary?.rotate) rot = evalMod(layer.vary.rotate, rng, col, row, 0);
      if (layer.vary?.jitter) {
        jx = evalMod(layer.vary.jitter, rng, col, row, 0) * iw;
        jy = evalMod(layer.vary.jitter, rng, col, row, 0) * ih;
      }
      const color = (fill.mode === 'palette-cycle' || fill.mode === 'checker')
        ? palette[paletteIndex(fill.mode)]
        : fill.mode === 'random'
        ? palette[Math.floor(rng() * palette.length)]
        : (layer.vary?.color?.type === 'palette'
            ? palette[Math.floor(rng() * palette.length)]
            : (fill.color || palette[0]));
      if (isTransparent(color)) break;
      // Text shapes can cycle through an array; pick the index by
      // the same formula the colour mode uses, or randomly if
      // vary.color picks randomly.
      const textIndex = fill.mode === 'checker' ? mod(ci + ri, 1e9)
                      : fill.mode === 'palette-cycle' ? mod(ci + ri * cols, 1e9)
                      : (layer.vary?.color?.type === 'palette' ? Math.floor(rng() * 1e9) : 0);
      // Paint the shape at the cell centre AND at the 8 layer-canvas
      // wraps. Anything that would spill past the layer edge appears
      // on the opposite edge — keeps shapes whose size or jitter
      // exceeds the cell tiling seamlessly.
      const lw = layerBounds?.w, lh = layerBounds?.h;
      const baseX = ix + iw / 2 + jx;
      const baseY = iy + ih / 2 + jy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!lw || !lh) { if (dx || dy) continue; }
          const node = shapeNode(shape, iw, ih, color, { textIndex, rng });
          node.setAttribute(
            'transform',
            `translate(${baseX + dx * (lw || 0)} ${baseY + dy * (lh || 0)}) rotate(${rot}) scale(${s})`,
          );
          parent.appendChild(node);
        }
      }
      break;
    }
    case 'triangles': {
      // Equilateral-ish triangle tessellation across the layer canvas.
      // cols controls up-triangles per strip; rows is rounded to an
      // even strip count so the offset alternation completes a period.
      // Colour by rhombus identity — the up at strip r, col c and the
      // down at strip r+1, col c' (where c' depends on parity) share a
      // base edge; both pull from the same hash so vertical seams match
      // across tiles.
      if (col !== 0 || row !== 0) break;
      const tcols = cols;
      const strips = Math.max(2, rows - (rows % 2));
      const lw = layerBounds?.w ?? cw * cols;
      const lh = layerBounds?.h ?? rh * rows;
      const ox = layerBounds?.x ?? 0;
      const oy = layerBounds?.y ?? 0;
      const s = lw / tcols;
      const h = lh / strips;

      const swFrac = fill.strokeWidth;
      const sw = (swFrac != null && swFrac > 0) ? swFrac * Math.min(s, h) : 0;
      const strokeAttrs = sw > 0
        ? { stroke: fill.stroke || '#ffffff', 'stroke-width': sw, 'stroke-linejoin': 'round' }
        : {};

      const triSalt = ((rng() * 0xffffffff) >>> 0) | 1;
      const rhombusHash = (r, c) => mod(r, strips) * tcols + mod(c, tcols);
      const colorAt = (r, c, type) => {
        let hashR = r, hashC = c;
        if (type === 'down') {
          const prevR = r - 1;
          const prevEven = mod(prevR, 2) === 0;
          hashR = prevR;
          hashC = prevEven ? c + 1 : c;
        }
        if (fill.mode === 'fixed') return fill.color || palette[0] || '#888';
        const hashVal = rhombusHash(hashR, hashC);
        if (fill.mode === 'palette-cycle') return palette[mod(hashVal, palette.length)];
        // random: deterministic per-rhombus PRNG so the seam-sharing
        // up and down triangles compute the same colour.
        const seed = ((hashVal * 0x9E3779B1) ^ triSalt) >>> 0;
        return palette[Math.floor(makeRng(seed || 1)() * palette.length)];
      };

      const drawTri = (points, color) => {
        if (isTransparent(color) && !sw) return;
        parent.appendChild(el('polygon', {
          points,
          fill: isTransparent(color) ? 'none' : color,
          ...strokeAttrs,
        }));
      };

      for (let r = 0; r < strips; r++) {
        const y0 = oy + r * h;
        const y1 = y0 + h;
        const odd = r % 2 === 1;
        const off = odd ? s / 2 : 0;
        // Up triangles: tcols for odd strips, tcols+1 for even strips
        // — the c=tcols copy shares colour with c=0 via mod, supplying
        // the horizontal wrap.
        const upCount = odd ? tcols : tcols + 1;
        for (let c = 0; c < upCount; c++) {
          const cx = ox + c * s + off;
          drawTri(`${cx - s/2},${y1} ${cx + s/2},${y1} ${cx},${y0}`, colorAt(r, c, 'up'));
        }
        if (odd) {
          for (let c = 0; c < tcols - 1; c++) {
            const xL = ox + c * s + s/2;
            drawTri(`${xL},${y0} ${xL + s},${y0} ${xL + s/2},${y1}`, colorAt(r, c, 'down'));
          }
          const wrapColor = colorAt(r, tcols - 1, 'down');
          for (const xL of [ox + (tcols - 1) * s + s/2, ox - s/2]) {
            drawTri(`${xL},${y0} ${xL + s},${y0} ${xL + s/2},${y1}`, wrapColor);
          }
        } else {
          for (let c = 0; c < tcols; c++) {
            const xL = ox + c * s;
            drawTri(`${xL},${y0} ${xL + s},${y0} ${xL + s/2},${y1}`, colorAt(r, c, 'down'));
          }
        }
      }
      break;
    }
    case 'mesh': {
      // Jittered triangle mesh. Each lattice point's jitter is
      // hashed off (i mod cols, j mod rows) so the right-edge points
      // share jitter with the left-edge points → tiles seamlessly.
      const jitterAmt = Math.max(0, Math.min(0.49, fill.jitter ?? 0.25));
      const ncols = cols, nrows = rows;
      // Cell rect here is the WHOLE LAYER for mesh — we iterate all
      // lattice points off the layer canvas, not per-cell. But our
      // dispatcher calls placeCellRect once per cell, so guard: only
      // generate the mesh on the (0,0) cell, draw it across the layer
      // bounds in one pass.
      if (col !== 0 || row !== 0) break;
      const lw = layerBounds?.w ?? (cw * ncols);
      const lh = layerBounds?.h ?? (rh * nrows);
      const ox = layerBounds?.x ?? 0;
      const oy = layerBounds?.y ?? 0;
      const cellW = lw / ncols, cellH = lh / nrows;
      // Draw a per-layer salt off the layer's RNG so the same layer
      // re-rolls when the pattern seed changes, while the per-point
      // hash stays deterministic within one render.
      const meshSalt = ((rng() * 0xffffffff) >>> 0) | 1;
      const pointAt = (i, j) => {
        // Deterministic per-lattice-point jitter via mulberry32 of a
        // mixed hash of (ii, jj, salt). Identical jitter on wrap
        // copies because ii / jj wrap mod cols / rows.
        const ii = mod(i, ncols), jj = mod(j, nrows);
        const r = makeRng((ii * 73856093) ^ (jj * 19349663) ^ meshSalt);
        const dx = (r() * 2 - 1) * jitterAmt * cellW;
        const dy = (r() * 2 - 1) * jitterAmt * cellH;
        return { x: ox + i * cellW + dx, y: oy + j * cellH + dy };
      };
      const swFrac = fill.strokeWidth;
      const sw = (swFrac != null && swFrac > 0) ? swFrac * Math.min(cellW, cellH) : 0;
      const strokeAttrs = sw > 0
        ? { stroke: fill.stroke || '#ffffff', 'stroke-width': sw, 'stroke-linejoin': 'round' }
        : {};
      const paint = (pa, pb, pc, colorIdx) => {
        const color = fill.mode === 'palette-cycle'
          ? palette[mod(colorIdx, palette.length)]
          : (fill.color || palette[0] || '#888');
        if (isTransparent(color) && !sw) return;
        // Paint the triangle at the 9 layer-canvas wraps so any
        // vertex pushed past an edge by jitter still tiles cleanly —
        // the pattern element clips off-tile portions and the
        // neighbouring tile draws the matching wrap copy.
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const ox2 = dx * lw, oy2 = dy * lh;
            parent.appendChild(el('polygon', {
              points: `${pa.x + ox2},${pa.y + oy2} ${pb.x + ox2},${pb.y + oy2} ${pc.x + ox2},${pc.y + oy2}`,
              fill: isTransparent(color) ? 'none' : color,
              ...strokeAttrs,
            }));
          }
        }
      };
      for (let r = 0; r < nrows; r++) {
        for (let c = 0; c < ncols; c++) {
          const p00 = pointAt(c, r),     p10 = pointAt(c + 1, r);
          const p01 = pointAt(c, r + 1), p11 = pointAt(c + 1, r + 1);
          // Two triangles split along the / diagonal.
          paint(p00, p10, p01, (c + r * ncols) * 2);
          paint(p10, p11, p01, (c + r * ncols) * 2 + 1);
        }
      }
      break;
    }
    case 'split': {
      // Diagonal half-cell fill. Two independent palette picks per
      // cell (random or per-cell mode), plus a random rotation in
      // four 90° steps. Transparent palette entries make some halves
      // — or whole cells — read as empty.
      const pickRandom = () => palette[Math.floor(rng() * palette.length)];
      const colorA = pickRandom();
      const colorB = pickRandom();
      const dir = Math.floor(rng() * 4);
      drawSplit(parent, ix, iy, iw, ih, colorA, colorB, dir);
      break;
    }
    case 'layer': {
      if (fill.layer) {
        renderLayer(parent, fill.layer, ix, iy, iw, ih, palette,
          (rng() * 0xffffffff) | 0);
      }
      break;
    }
  }
}

// ---------- Repeat unit (SVG <pattern> body) ----------
function buildRepeatUnit(pattern, tileGroup) {
  const N = pattern.tileSize;
  switch (pattern.repeat) {
    case 'half-drop': {
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
    default:
      return { width: N, height: N, content: [tileGroup] };
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
  root.appendChild(el('defs', {}, [tilePattern]));

  const cell = viewSize / 3;
  root.appendChild(el('rect', {
    width: viewSize, height: viewSize,
    fill: `url(#${patternId})`,
  }));
  const veil = Math.max(0, Math.min(1, pattern.surroundVeil ?? 0.5));
  if (veil > 0) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        root.appendChild(el('rect', {
          x: col * cell, y: row * cell,
          width: cell, height: cell,
          fill: '#ffffff',
          opacity: veil,
        }));
      }
    }
  }

  return root;
}

// ---------- Layer list ----------
function renderLayerList(listEl, pattern, selected, handlers) {
  const items = pattern.layers.map((layer, i) => {
    const li = document.createElement('li');
    li.className = 'layer-item' + (i === selected ? ' selected' : '');
    const label = document.createElement('span');
    label.className = 'layer-label';
    label.textContent = `${i + 1}. ${layerLabel(layer)}`;
    label.addEventListener('click', () => handlers.select(i));
    li.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'layer-actions';
    const btn = (text, title, fn) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    actions.appendChild(btn('↑', 'move up',   () => handlers.move(i, -1)));
    actions.appendChild(btn('↓', 'move down', () => handlers.move(i, +1)));
    actions.appendChild(btn('×', 'delete',    () => handlers.remove(i)));
    li.appendChild(actions);
    return li;
  });
  listEl.replaceChildren(...items);
}

// ---------- Per-layer config form ----------
function buildConfigForm(host, layer, onChange) {
  host.replaceChildren();
  if (!layer) return;
  // Self-rebuild for controls that change which fields are visible
  // (fill kind, vary on/off, solid colour mode).
  const rebuild = () => buildConfigForm(host, layer, onChange);

  // Compact RGBA editor: small swatch + four number inputs. Returns
  // a DOM node; pair with addColorCtrl when a label row is wanted.
  const createColorWidget = (initial, onColorChange) => {
    const root = document.createElement('div');
    root.className = 'rgba-widget';
    const swatch = document.createElement('span');
    swatch.className = 'rgba-swatch';
    root.appendChild(swatch);
    const rgba = parseColor(initial);
    const sync = () => { swatch.style.background = formatColor(rgba); };
    sync();
    const inputs = document.createElement('span');
    inputs.className = 'rgba-inputs';
    const mkInput = (axis, max, step) => {
      const cell = document.createElement('span');
      cell.className = 'rgba-cell';
      const tag = document.createElement('em');
      tag.textContent = axis.toUpperCase();
      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = 0;
      inp.max = max;
      inp.step = step;
      inp.value = axis === 'a' ? rgba.a : rgba[axis];
      inp.addEventListener('input', () => {
        let v = Number(inp.value);
        if (axis === 'a') v = Math.max(0, Math.min(1, v));
        else v = Math.max(0, Math.min(255, v));
        rgba[axis] = v;
        sync();
        onColorChange(formatColor(rgba));
      });
      cell.appendChild(tag);
      cell.appendChild(inp);
      inputs.appendChild(cell);
    };
    mkInput('r', 255, 1);
    mkInput('g', 255, 1);
    mkInput('b', 255, 1);
    mkInput('a', 1, 0.05);
    root.appendChild(inputs);
    return root;
  };
  const addColorCtrl = (label, value, onColorChange) => {
    const wrap = document.createElement('label');
    wrap.className = 'ctrl';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    wrap.appendChild(createColorWidget(value, onColorChange));
    host.appendChild(wrap);
  };

  const addCtrl = (label, kind, value, opts = {}) => {
    const wrap = document.createElement('label');
    wrap.className = 'ctrl';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    let input;
    if (kind === 'select') {
      input = document.createElement('select');
      opts.options.forEach(o => {
        const opt = document.createElement('option');
        opt.value = o; opt.textContent = o;
        if (o === value) opt.selected = true;
        input.appendChild(opt);
      });
    } else {
      input = document.createElement('input');
      input.type = kind;
      input.value = value;
      if (opts.min !== undefined) input.min = opts.min;
      if (opts.max !== undefined) input.max = opts.max;
      if (opts.step !== undefined) input.step = opts.step;
    }
    wrap.appendChild(input);
    host.appendChild(wrap);
    return input;
  };
  const addHeader = (text) => {
    const h = document.createElement('h4');
    h.className = 'config-section';
    h.textContent = text;
    host.appendChild(h);
  };

  // --- Blend + opacity (universal) ---
  const blend = addCtrl('blend', 'select', layer.blendMode || 'normal', { options: BLEND_MODES });
  const op = addCtrl('opacity', 'number', layer.opacity ?? 1, { min: 0, max: 1, step: 0.05 });
  blend.addEventListener('change', () => { layer.blendMode = blend.value; onChange(); });
  op.addEventListener('input',  () => { layer.opacity = Number(op.value); onChange(); });

  // --- Palette (skipped for fixed-color solid) ---
  const isFixedSolid = layer.fill.kind === 'solid'
    && layer.fill.mode !== 'palette-cycle'
    && layer.fill.mode !== 'checker'
    && layer.fill.mode !== 'random';
  if (!isFixedSolid) {
    addHeader('palette');
    const wrap = document.createElement('div');
    wrap.className = 'palette-swatches';
    host.appendChild(wrap);
    const renderSwatches = () => {
      wrap.replaceChildren();
      const list = layer.palette || [];
      list.forEach((color, i) => {
        const row = document.createElement('div');
        row.className = 'palette-row';
        row.appendChild(createColorWidget(color, (v) => {
          // Read layer.palette live so concurrent edits from other
          // swatches aren't reverted to a stale captured copy.
          const next = [...(layer.palette || [])];
          next[i] = v;
          layer.palette = next;
          onChange();
        }));
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'palette-rm';
        rm.textContent = '×';
        rm.title = 'remove colour';
        rm.addEventListener('click', () => {
          layer.palette = (layer.palette || []).filter((_, j) => j !== i);
          renderSwatches();
          onChange();
        });
        row.appendChild(rm);
        wrap.appendChild(row);
      });
      const add = document.createElement('button');
      add.type = 'button';
      add.className = 'swatch-add';
      add.textContent = '+';
      add.addEventListener('click', () => {
        layer.palette = [...(layer.palette || []), '#888888'];
        renderSwatches();
        onChange();
      });
      wrap.appendChild(add);
    };
    renderSwatches();
  }

  // --- Grid ---
  addHeader('grid');
  const cols = addCtrl('cols', 'number', layer.grid.cols, { min: 1, max: 64, step: 1 });
  const rows = addCtrl('rows', 'number', layer.grid.rows, { min: 1, max: 64, step: 1 });
  cols.addEventListener('input', () => { layer.grid.cols = Math.max(1, Number(cols.value) | 0); onChange(); });
  rows.addEventListener('input', () => { layer.grid.rows = Math.max(1, Number(rows.value) | 0); onChange(); });

  const offMode = addCtrl('offset mode', 'select', layer.grid.offsetMode || 'none', {
    options: ['none', 'alternate-row', 'alternate-col'],
  });
  offMode.addEventListener('change', () => { layer.grid.offsetMode = offMode.value; onChange(); });

  const offX = addCtrl('offset x', 'number', layer.grid.offset?.x ?? 0, { min: 0, max: 1, step: 0.05 });
  const offY = addCtrl('offset y', 'number', layer.grid.offset?.y ?? 0, { min: 0, max: 1, step: 0.05 });
  offX.addEventListener('input', () => {
    layer.grid.offset = { ...(layer.grid.offset || {}), x: Number(offX.value) };
    onChange();
  });
  offY.addEventListener('input', () => {
    layer.grid.offset = { ...(layer.grid.offset || {}), y: Number(offY.value) };
    onChange();
  });
  const gx = addCtrl('gutter x (× cell)', 'number',
    layer.grid.gutterX ?? layer.grid.gutter ?? 0,
    { min: 0, max: 0.9, step: 0.02 });
  gx.addEventListener('input', () => {
    layer.grid.gutterX = Number(gx.value);
    delete layer.grid.gutter;
    onChange();
  });
  const gy = addCtrl('gutter y (× cell)', 'number',
    layer.grid.gutterY ?? layer.grid.gutter ?? 0,
    { min: 0, max: 0.9, step: 0.02 });
  gy.addEventListener('input', () => {
    layer.grid.gutterY = Number(gy.value);
    delete layer.grid.gutter;
    onChange();
  });

  // Optional explicit weights for variable-width columns / rows.
  // Comma-separated list of positive numbers; blank = fall back to
  // uniform cols/rows.
  const parseWeights = (str) => {
    const list = str.split(',').map(s => Number(s.trim())).filter(n => isFinite(n) && n > 0);
    return list.length ? list : null;
  };
  const cWeights = addCtrl('col weights', 'text',
    (layer.grid.colWeights || []).join(', '),
    {});
  cWeights.placeholder = 'uniform';
  cWeights.addEventListener('input', () => {
    const w = parseWeights(cWeights.value);
    if (w) layer.grid.colWeights = w; else delete layer.grid.colWeights;
    onChange();
  });
  const rWeights = addCtrl('row weights', 'text',
    (layer.grid.rowWeights || []).join(', '),
    {});
  rWeights.placeholder = 'uniform';
  rWeights.addEventListener('input', () => {
    const w = parseWeights(rWeights.value);
    if (w) layer.grid.rowWeights = w; else delete layer.grid.rowWeights;
    onChange();
  });

  // --- Fill ---
  addHeader('fill');
  const fillKind = addCtrl('kind', 'select', layer.fill.kind, { options: ['solid', 'shape', 'split', 'mesh', 'triangles'] });
  fillKind.addEventListener('change', () => {
    if (fillKind.value === 'solid') {
      layer.fill = { kind: 'solid', color: layer.fill.color || '#8a8a8a', mode: layer.fill.mode || 'fixed' };
    } else if (fillKind.value === 'shape') {
      layer.fill = { kind: 'shape', shape: layer.fill.shape || { kind: 'circle', size: 0.6 }, mode: 'palette-cycle' };
    } else if (fillKind.value === 'split') {
      layer.fill = { kind: 'split', mode: 'random' };
    } else if (fillKind.value === 'mesh') {
      layer.fill = { kind: 'mesh', mode: 'fixed', color: '#d24a45', jitter: 0.25, strokeWidth: 0.01, stroke: '#ffffff' };
    } else {
      layer.fill = { kind: 'triangles', mode: 'random', strokeWidth: 0.02, stroke: '#ffffff' };
    }
    onChange();
    rebuild();
  });

  if (layer.fill.kind === 'solid') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle', 'checker', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#8a8a8a', (v) => { layer.fill.color = v; onChange(); });
    }
  } else if (layer.fill.kind === 'shape') {
    const shapeKind = addCtrl('shape', 'select', layer.fill.shape?.kind || 'circle', {
      options: ['circle', 'square', 'triangle', 'text', 'star', 'quatrefoil'],
    });
    shapeKind.addEventListener('change', () => {
      layer.fill.shape = { ...(layer.fill.shape || {}), kind: shapeKind.value };
      onChange();
      rebuild();
    });
    const size = addCtrl('size (× cell)', 'number', layer.fill.shape?.size ?? 0.6, { min: 0.05, max: 1.5, step: 0.05 });
    size.addEventListener('input', () => {
      layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), size: Number(size.value) };
      onChange();
    });
    const strokeW = addCtrl('stroke (× cell)', 'number', layer.fill.shape?.strokeWidth ?? 0, { min: 0, max: 0.3, step: 0.005 });
    strokeW.addEventListener('input', () => {
      const was = (layer.fill.shape?.strokeWidth ?? 0) > 0;
      const v = Number(strokeW.value);
      layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), strokeWidth: v };
      onChange();
      if (was !== (v > 0)) rebuild();
    });
    if ((layer.fill.shape?.strokeWidth ?? 0) > 0) {
      addColorCtrl('stroke color', layer.fill.shape?.stroke ?? '#000000', (v) => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), stroke: v };
        onChange();
      });
    }
    if (layer.fill.shape?.kind === 'quatrefoil') {
      const c = addCtrl('center (× lobe)', 'number', layer.fill.shape?.center ?? 1, { min: 0, max: 2, step: 0.05 });
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'quatrefoil' }), center: Number(c.value) };
        onChange();
      });
    }
    if (layer.fill.shape?.kind === 'star') {
      const pts = addCtrl('points', 'number', layer.fill.shape?.numPoints ?? 5, { min: 3, max: 16, step: 1 });
      pts.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'star' }), numPoints: Math.max(3, Number(pts.value) | 0) };
        onChange();
      });
      const depth = addCtrl('indent (0..1)', 'number', layer.fill.shape?.depth ?? 0.5, { min: 0.05, max: 1, step: 0.05 });
      depth.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'star' }), depth: Number(depth.value) };
        onChange();
      });
      const sjit = addCtrl('vertex jitter', 'number', layer.fill.shape?.jitter ?? 0, { min: 0, max: 0.5, step: 0.02 });
      sjit.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'star' }), jitter: Number(sjit.value) };
        onChange();
      });
    }
    if (layer.fill.shape?.kind === 'text') {
      const raw = Array.isArray(layer.fill.shape?.text)
        ? layer.fill.shape.text.join(', ')
        : (layer.fill.shape?.text ?? 'BI');
      const text = addCtrl('text(s)', 'text', raw, {});
      text.placeholder = 'BI, AA, UA';
      text.addEventListener('input', () => {
        const parts = text.value.split(',').map(s => s.trim()).filter(s => s.length);
        const value = parts.length <= 1 ? (parts[0] ?? '') : parts;
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'text' }), text: value };
        onChange();
      });
    }
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'palette-cycle', { options: ['fixed', 'palette-cycle', 'checker', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'palette-cycle') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#8a8a8a', (v) => { layer.fill.color = v; onChange(); });
    }
  } else if (layer.fill.kind === 'triangles') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'random', { options: ['fixed', 'palette-cycle', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'random') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#d24a45', (v) => { layer.fill.color = v; onChange(); });
    }
    const sw = addCtrl('stroke (× cell)', 'number', layer.fill.strokeWidth ?? 0, { min: 0, max: 0.15, step: 0.005 });
    sw.addEventListener('input', () => {
      const was = (layer.fill.strokeWidth ?? 0) > 0;
      const v = Number(sw.value);
      layer.fill.strokeWidth = v;
      if (v > 0 && !layer.fill.stroke) layer.fill.stroke = '#ffffff';
      onChange();
      if (was !== (v > 0)) rebuild();
    });
    if ((layer.fill.strokeWidth ?? 0) > 0) {
      addColorCtrl('stroke color', layer.fill.stroke ?? '#ffffff', (v) => { layer.fill.stroke = v; onChange(); });
    }
  } else if (layer.fill.kind === 'mesh') {
    const jit = addCtrl('point jitter (× cell)', 'number', layer.fill.jitter ?? 0.25, { min: 0, max: 0.49, step: 0.01 });
    jit.addEventListener('input', () => { layer.fill.jitter = Number(jit.value); onChange(); });
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#d24a45', (v) => { layer.fill.color = v; onChange(); });
    }
    const sw = addCtrl('stroke (× cell)', 'number', layer.fill.strokeWidth ?? 0, { min: 0, max: 0.1, step: 0.002 });
    sw.addEventListener('input', () => {
      const was = (layer.fill.strokeWidth ?? 0) > 0;
      const v = Number(sw.value);
      layer.fill.strokeWidth = v;
      if (v > 0 && !layer.fill.stroke) layer.fill.stroke = '#ffffff';
      onChange();
      if (was !== (v > 0)) rebuild();
    });
    if ((layer.fill.strokeWidth ?? 0) > 0) {
      addColorCtrl('stroke color', layer.fill.stroke ?? '#ffffff', (v) => { layer.fill.stroke = v; onChange(); });
    }
  }

  // --- Vary (per-cell randomization) ---
  addHeader('vary (per-cell)');
  const toggleAxis = (axisKey, label, defaultSpec) => {
    const on = addCtrl(`${label}`, 'select', layer.vary?.[axisKey] ? 'on' : 'off', { options: ['off', 'on'] });
    on.addEventListener('change', () => {
      if (on.value === 'on') {
        layer.vary = layer.vary || {};
        layer.vary[axisKey] = layer.vary[axisKey] || defaultSpec;
      } else if (layer.vary) {
        delete layer.vary[axisKey];
        if (!layer.vary.scale && !layer.vary.rotate && !layer.vary.jitter) delete layer.vary;
      }
      onChange();
      rebuild();
    });
  };
  toggleAxis('scale',  'scale',  { type: 'random', min: 0.5, max: 1.2 });
  if (layer.vary?.scale) {
    const sMax = addCtrl('scale max', 'number', layer.vary.scale?.max ?? 1.2, { min: 0.5, max: 2, step: 0.05 });
    sMax.addEventListener('input', () => {
      layer.vary.scale = { type: 'random', min: layer.vary.scale?.min ?? 0.5, max: Number(sMax.value) };
      onChange();
    });
  }
  toggleAxis('rotate', 'rotate', { type: 'random', min: -180, max: 180 });
  if (layer.vary?.rotate) {
    const rMax = addCtrl('rotate ±°', 'number', layer.vary.rotate?.max ?? 180, { min: 0, max: 360, step: 5 });
    rMax.addEventListener('input', () => {
      const v = Number(rMax.value);
      layer.vary.rotate = { type: 'random', min: -v, max: v };
      onChange();
    });
  }
  toggleAxis('jitter', 'jitter', { type: 'random', min: -0.2, max: 0.2 });
  if (layer.vary?.jitter) {
    const jit = addCtrl('jitter (× cell)', 'number', layer.vary.jitter?.max ?? 0.2, { min: 0, max: 0.5, step: 0.02 });
    jit.addEventListener('input', () => {
      const v = Number(jit.value);
      layer.vary.jitter = { type: 'random', min: -v, max: v };
      onChange();
    });
  }
}

// ---------- Mount ----------
function mount() {
  const stage     = document.getElementById('girard-stage');
  const listEl    = document.getElementById('girard-layer-list');
  const configEl  = document.getElementById('girard-layer-config');
  const addSelect = document.getElementById('girard-add-layer');
  const seed      = document.getElementById('girard-seed');
  const roll      = document.getElementById('girard-roll');
  const repeat    = document.getElementById('girard-repeat');
  const veil      = document.getElementById('girard-veil');
  const sampleSel = document.getElementById('girard-sample');
  const loadBtn   = document.getElementById('girard-load-sample');
  if (!stage) return;

  // Populate sample dropdown from SAMPLES.
  if (sampleSel) {
    sampleSel.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = '(pick a sample)';
    sampleSel.appendChild(placeholder);
    for (const name of Object.keys(SAMPLES)) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sampleSel.appendChild(opt);
    }
  }

  let pattern = defaultPattern();
  let selected = 0;

  // Two separate re-render paths so editing a number input doesn't
  // tear down the input being typed into.
  //   rerenderSvg(): pattern → SVG. Cheap. Called on every parameter
  //                  edit from inside the config form.
  //   rerenderUI():  rebuilds the layer list and the config form
  //                  itself. Called on add / remove / reorder /
  //                  select, where the surrounding DOM has to change.
  const rerenderSvg = () => {
    stage.replaceChildren(buildSvg(pattern));
  };
  const layerHandlers = {
    select: (i) => { selected = i; rerenderUI(); },
    move: (i, dir) => {
      const j = i + dir;
      if (j < 0 || j >= pattern.layers.length) return;
      [pattern.layers[i], pattern.layers[j]] = [pattern.layers[j], pattern.layers[i]];
      if (selected === i) selected = j;
      else if (selected === j) selected = i;
      rerenderUI();
    },
    remove: (i) => {
      pattern.layers.splice(i, 1);
      if (selected >= pattern.layers.length) selected = pattern.layers.length - 1;
      if (selected < 0) selected = 0;
      rerenderUI();
    },
  };
  const rerenderUI = () => {
    rerenderSvg();
    renderLayerList(listEl, pattern, selected, layerHandlers);
    buildConfigForm(configEl, pattern.layers[selected], rerenderSvg);
  };

  addSelect.addEventListener('change', () => {
    if (!addSelect.value) return;
    pattern.layers.push(makeLayer(addSelect.value));
    selected = pattern.layers.length - 1;
    addSelect.value = '';
    rerenderUI();
  });

  seed.addEventListener('input', () => {
    pattern.seed = Number(seed.value) | 0;
    rerenderSvg();
  });

  roll.addEventListener('click', () => {
    const s = Math.floor(Math.random() * 99999);
    seed.value = s;
    pattern.seed = s;
    rerenderSvg();
  });

  repeat.addEventListener('change', () => {
    pattern.repeat = repeat.value;
    rerenderSvg();
  });

  veil.addEventListener('input', () => {
    pattern.surroundVeil = Number(veil.value);
    rerenderSvg();
  });

  loadBtn.addEventListener('click', () => {
    const name = sampleSel.value;
    if (!name) return;
    // OK = clear and load fresh. Cancel = layer on top of current.
    const clear = window.confirm(
      `Load "${name}"?\n\nOK: clear current design and load fresh.\nCancel: layer this sample on top of the current pattern.`
    );
    pattern = loadSample(name, pattern, clear);
    selected = pattern.layers.length - 1;
    // Mirror any incoming top-level fields onto their UI controls.
    seed.value = pattern.seed;
    repeat.value = pattern.repeat;
    veil.value = pattern.surroundVeil;
    rerenderUI();
  });

  rerenderUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
