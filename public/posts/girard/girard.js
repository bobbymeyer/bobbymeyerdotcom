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

// ---------- Layer factories ----------
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
  const { cols, rows, offset = { x: 0, y: 0 }, offsetMode = 'none' } = layer.grid;
  const cw = w / cols, rh = h / rows;

  // For each cell in [0..cols) × [0..rows), plus wrap-around cells at
  // col=-1 or row=-1 when an offset extends the grid past the tile
  // edge, so the layer tiles seamlessly.
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      placeCell(group, layer, x, y, col, row, cw, rh, offset, offsetMode, rng, palette);
    }
    if (offsetMode === 'alternate-row' && row % 2 === 1 && offset.x !== 0) {
      placeCell(group, layer, x, y, -1, row, cw, rh, offset, offsetMode, rng, palette);
    }
  }
  if (offsetMode === 'alternate-col') {
    for (let col = 0; col < cols; col++) {
      if (col % 2 === 1 && offset.y !== 0) {
        placeCell(group, layer, x, y, col, -1, cw, rh, offset, offsetMode, rng, palette);
      }
    }
  }
}

function cellOriginX(x, col, cw, offset, offsetMode, row) {
  let dx = 0;
  if (offsetMode === 'alternate-row' && mod(row, 2) === 1) dx = offset.x * cw;
  return x + col * cw + dx;
}

function cellOriginY(y, row, rh, offset, offsetMode, col) {
  let dy = 0;
  if (offsetMode === 'alternate-col' && mod(col, 2) === 1) dy = offset.y * rh;
  return y + row * rh + dy;
}

function placeCell(parent, layer, x, y, col, row, cw, rh, offset, offsetMode, rng, palette) {
  const cx = cellOriginX(x, col, cw, offset, offsetMode, row);
  const cy = cellOriginY(y, row, rh, offset, offsetMode, col);
  const { cols, rows, gutter, gutterX, gutterY } = layer.grid;
  const gX = gutterX ?? gutter ?? 0;
  const gY = gutterY ?? gutter ?? 0;
  // Inset the cell by half the gutter on every side so adjacent
  // cells share the gap symmetrically.
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

  switch (fill.kind) {
    case 'solid': {
      const color = fill.mode === 'palette-cycle'
        ? palette[mod(ci + ri * cols, palette.length)]
        : (fill.color || '#888');
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
  });

  if (layer.fill.kind === 'solid') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); });
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
  if (!stage) return;

  let pattern = defaultPattern();
  let selected = 0;

  const rerender = () => {
    stage.replaceChildren(buildSvg(pattern));
    renderLayerList(listEl, pattern, selected, {
      select: (i) => { selected = i; rerender(); },
      move: (i, dir) => {
        const j = i + dir;
        if (j < 0 || j >= pattern.layers.length) return;
        [pattern.layers[i], pattern.layers[j]] = [pattern.layers[j], pattern.layers[i]];
        if (selected === i) selected = j;
        else if (selected === j) selected = i;
        rerender();
      },
      remove: (i) => {
        pattern.layers.splice(i, 1);
        if (selected >= pattern.layers.length) selected = pattern.layers.length - 1;
        if (selected < 0) selected = 0;
        rerender();
      },
    });
    buildConfigForm(configEl, pattern.layers[selected], rerender);
  };

  addSelect.addEventListener('change', () => {
    if (!addSelect.value) return;
    pattern.layers.push(makeLayer(addSelect.value));
    selected = pattern.layers.length - 1;
    addSelect.value = '';
    rerender();
  });

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

  veil.addEventListener('input', () => {
    pattern.surroundVeil = Number(veil.value);
    rerender();
  });

  rerender();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
