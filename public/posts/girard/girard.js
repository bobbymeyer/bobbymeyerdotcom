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
  const usesPalette = (l) =>
    (l.fill?.kind === 'solid'  && l.fill?.mode === 'palette-cycle') ||
    (l.fill?.kind === 'shape'  && (l.fill?.mode === 'palette-cycle' || l.vary?.color?.type === 'palette'));
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
          rotate: { type: 'random', min: 0, max: 360 },
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
function shapeNode(shape, cw, rh, fill) {
  const dim = Math.min(cw, rh) * (shape.size ?? 0.6);
  switch (shape.kind) {
    case 'circle':
      return el('circle', { r: dim / 2, fill });
    case 'square':
      return el('rect', {
        x: -dim / 2, y: -dim / 2, width: dim, height: dim, fill,
      });
    case 'triangle': {
      const r = dim / 2;
      return el('polygon', {
        points: `0,${-r} ${r * 0.866},${r * 0.5} ${-r * 0.866},${r * 0.5}`,
        fill,
      });
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

  for (let row = 0; row < nRows; row++) {
    for (let col = 0; col < nCols; col++) {
      placeCellRect(group, layer,
        x + xStarts[col] + (offsetMode === 'alternate-row' && row % 2 === 1 ? offset.x * widths[col] : 0),
        y + yStarts[row] + (offsetMode === 'alternate-col' && col % 2 === 1 ? offset.y * heights[row] : 0),
        widths[col], heights[row],
        col, row, nCols, nRows, rng, palette);
    }
    if (offsetMode === 'alternate-row' && row % 2 === 1 && offset.x !== 0) {
      const lastCol = nCols - 1;
      const cw = widths[lastCol], rh = heights[row];
      placeCellRect(group, layer,
        x - cw + offset.x * cw, y + yStarts[row], cw, rh,
        lastCol, row, nCols, nRows, rng, palette);
    }
  }
  if (offsetMode === 'alternate-col') {
    for (let col = 0; col < nCols; col++) {
      if (col % 2 === 1 && offset.y !== 0) {
        const lastRow = nRows - 1;
        const cw = widths[col], rh = heights[lastRow];
        placeCellRect(group, layer,
          x + xStarts[col], y - rh + offset.y * rh, cw, rh,
          col, lastRow, nCols, nRows, rng, palette);
      }
    }
  }
}

function normWeights(weights, total) {
  const sum = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return weights.map(w => (Math.max(0, w) / sum) * total);
}

function placeCellRect(parent, layer, cx, cy, cw, rh, col, row, cols, rows, rng, palette) {
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
  // of a 3x3 grid where the four corners are empty).
  const isTransparent = (c) => c == null || c === 'transparent' || c === 'none';

  switch (fill.kind) {
    case 'solid': {
      const color = fill.mode === 'palette-cycle'
        ? palette[mod(ci + ri * cols, palette.length)]
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
      const color = fill.mode === 'palette-cycle'
        ? palette[mod(ci + ri * cols, palette.length)]
        : (layer.vary?.color?.type === 'palette'
            ? palette[Math.floor(rng() * palette.length)]
            : (fill.color || palette[0]));
      if (isTransparent(color)) break;
      const node = shapeNode(shape, iw, ih, color);
      node.setAttribute(
        'transform',
        `translate(${ix + iw / 2 + jx} ${iy + ih / 2 + jy}) rotate(${rot}) scale(${s})`,
      );
      parent.appendChild(node);
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
  const isFixedSolid = layer.fill.kind === 'solid' && layer.fill.mode !== 'palette-cycle';
  if (!isFixedSolid) {
    addHeader('palette');
    const wrap = document.createElement('div');
    wrap.className = 'palette-swatches';
    host.appendChild(wrap);
    const renderSwatches = () => {
      wrap.replaceChildren();
      const list = layer.palette || [];
      list.forEach((color, i) => {
        const cell = document.createElement('div');
        cell.className = 'swatch';
        const input = document.createElement('input');
        input.type = 'color';
        input.value = color;
        input.addEventListener('input', () => {
          layer.palette = [...list];
          layer.palette[i] = input.value;
          onChange();
        });
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.textContent = '×';
        rm.addEventListener('click', () => {
          layer.palette = list.filter((_, j) => j !== i);
          renderSwatches();
          onChange();
        });
        cell.appendChild(input);
        cell.appendChild(rm);
        wrap.appendChild(cell);
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
  const fillKind = addCtrl('kind', 'select', layer.fill.kind, { options: ['solid', 'shape'] });
  fillKind.addEventListener('change', () => {
    if (fillKind.value === 'solid') {
      layer.fill = { kind: 'solid', color: layer.fill.color || '#8a8a8a', mode: layer.fill.mode || 'fixed' };
    } else {
      layer.fill = { kind: 'shape', shape: layer.fill.shape || { kind: 'circle', size: 0.6 }, mode: 'palette-cycle' };
    }
    onChange();
    rebuild();
  });

  if (layer.fill.kind === 'solid') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      const c = addCtrl('color', 'color', layer.fill.color || '#8a8a8a');
      c.addEventListener('input', () => { layer.fill.color = c.value; onChange(); });
    }
  } else if (layer.fill.kind === 'shape') {
    const shapeKind = addCtrl('shape', 'select', layer.fill.shape?.kind || 'circle', {
      options: ['circle', 'square', 'triangle'],
    });
    shapeKind.addEventListener('change', () => {
      layer.fill.shape = { ...(layer.fill.shape || {}), kind: shapeKind.value };
      onChange();
    });
    const size = addCtrl('size (× cell)', 'number', layer.fill.shape?.size ?? 0.6, { min: 0.05, max: 1.5, step: 0.05 });
    size.addEventListener('input', () => {
      layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), size: Number(size.value) };
      onChange();
    });
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'palette-cycle', { options: ['fixed', 'palette-cycle'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'palette-cycle') === 'fixed') {
      const c = addCtrl('color', 'color', layer.fill.color || '#8a8a8a');
      c.addEventListener('input', () => { layer.fill.color = c.value; onChange(); });
    }
  }

  // --- Vary (per-cell randomization) ---
  addHeader('vary (per-cell)');
  const varyOn = addCtrl('enable', 'select', layer.vary ? 'on' : 'off', { options: ['off', 'on'] });
  varyOn.addEventListener('change', () => {
    if (varyOn.value === 'on') {
      layer.vary = layer.vary || {
        scale:  { type: 'random', min: 0.5, max: 1.2 },
        rotate: { type: 'random', min: 0, max: 360 },
        jitter: { type: 'random', min: -0.2, max: 0.2 },
      };
    } else {
      delete layer.vary;
    }
    onChange();
    rebuild();
  });
  if (layer.vary) {
    const sMax = addCtrl('scale max', 'number', layer.vary.scale?.max ?? 1.2, { min: 0.5, max: 2, step: 0.05 });
    sMax.addEventListener('input', () => {
      layer.vary.scale = { type: 'random', min: layer.vary.scale?.min ?? 0.5, max: Number(sMax.value) };
      onChange();
    });
    const rMax = addCtrl('rotate max°', 'number', layer.vary.rotate?.max ?? 360, { min: 0, max: 360, step: 5 });
    rMax.addEventListener('input', () => {
      layer.vary.rotate = { type: 'random', min: 0, max: Number(rMax.value) };
      onChange();
    });
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
