// girard — textile pattern tool, v0.2 (SVG-native).
//
// Layer taxonomy
//   solid       one colour (or transparent)
//   regular     deterministic tessellations: striped | checkered |
//                triangular | hex
//   randomized  shape-on-grid with per-cell modifiers
//
// Every layer is dispatched on layer.type; regular layers branch
// further on layer.subtype. Pattern repeat (square / half-drop /
// half-brick / hex) is orthogonal to layer types and lives at the
// pattern root.

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
  layers: [
    { type: 'solid', color: '#8a8a8a' },
  ],
});

// Factory: spec is 'solid' | 'regular:<subtype>' | 'randomized'.
function makeLayer(spec) {
  const [type, subtype] = spec.split(':');
  if (type === 'solid') return { type: 'solid', color: '#8a8a8a' };
  if (type === 'regular') {
    switch (subtype) {
      case 'striped':    return { type: 'regular', subtype: 'striped', orientation: 'horizontal', count: 8, widthJitter: 0.6, colorMode: 'palette-cycle' };
      case 'checkered':  return { type: 'regular', subtype: 'checkered', cols: 6, rows: 6 };
      case 'triangular': return { type: 'regular', subtype: 'triangular', cols: 6 };
      case 'hex':        return { type: 'regular', subtype: 'hex', cols: 6 };
    }
  }
  return {
    type: 'randomized',
    shape: { kind: 'circle', r: 22 },
    grid: { cols: 6, rows: 6 },
    modifiers: {
      scale:  { type: 'random', min: 0.55, max: 1.2 },
      rotate: { type: 'random', min: 0, max: 360 },
      jitter: { type: 'random', min: -10, max: 10 },
      color:  { type: 'palette' },
    },
  };
}

function layerLabel(layer) {
  if (layer.type === 'solid') return 'solid';
  if (layer.type === 'regular') return layer.subtype;
  return 'randomized';
}

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

// Pointy-top hex polygon points (string) centred at (cx, cy) with
// flat-to-flat width w.
function hexPolygonPoints(cx, cy, w) {
  const s = w / Math.sqrt(3);
  return `${cx},${cy - s} ${cx + w / 2},${cy - s / 2} ${cx + w / 2},${cy + s / 2} ${cx},${cy + s} ${cx - w / 2},${cy + s / 2} ${cx - w / 2},${cy - s / 2}`;
}

// Pointy-top hex *path* (for clip masks) centred on origin.
function hexagonPath(w) {
  const s = w / Math.sqrt(3);
  return `M0,${-s} ${w / 2},${-s / 2} ${w / 2},${s / 2} 0,${s} ${-w / 2},${s / 2} ${-w / 2},${-s / 2}Z`;
}

// ---------- Tile content ----------
function buildTileGroup(pattern) {
  const N = pattern.tileSize;
  const root = el('g');

  pattern.layers.forEach((layer, li) => {
    const rng = makeRng(pattern.seed + li * 9973);
    switch (layer.type) {
      case 'solid':      renderSolid(root, layer, N); break;
      case 'regular':    renderRegular(root, layer, N, rng, pattern.palette); break;
      case 'randomized': renderRandomized(root, layer, N, rng, pattern.palette); break;
    }
  });

  return root;
}

function renderSolid(parent, layer, N) {
  if (!layer.color || layer.mode === 'transparent') return;
  parent.appendChild(el('rect', { x: 0, y: 0, width: N, height: N, fill: layer.color }));
}

function renderRegular(parent, layer, N, rng, palette) {
  switch (layer.subtype) {
    case 'striped':    return renderStriped(parent, layer, N, rng, palette);
    case 'checkered':  return renderCheckered(parent, layer, N, palette);
    case 'triangular': return renderTriangular(parent, layer, N, palette);
    case 'hex':        return renderHex(parent, layer, N, palette);
  }
}

// Parallel rows or columns. Widths jittered then normalised to sum
// exactly to N so the stripes tile seamlessly.
function renderStriped(parent, layer, N, rng, palette) {
  const count = Math.max(1, layer.count | 0);
  const jitter = Math.max(0, Math.min(1, layer.widthJitter ?? 0));
  const weights = [];
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const w = Math.max(0.1, 1 + jitter * (rng() * 2 - 1));
    weights.push(w); sum += w;
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

// Square checkerboard. cols x rows cells, colours cycle the palette
// along (row + col).
function renderCheckered(parent, layer, N, palette) {
  const cols = Math.max(1, layer.cols | 0 || 8);
  const rows = Math.max(1, layer.rows | 0 || 8);
  const cw = N / cols, rh = N / rows;
  const colors = layer.colors || palette.slice(0, 2);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const color = colors[(row + col) % colors.length];
      parent.appendChild(el('rect', {
        x: col * cw, y: row * rh, width: cw, height: rh, fill: color,
      }));
    }
  }
}

// Equilateral triangle tessellation. cols full-width triangles per
// row; row height = side * √3/2. Colours cycle the palette.
function renderTriangular(parent, layer, N, palette) {
  const cols = Math.max(1, layer.cols | 0 || 8);
  const s = N / cols;
  const h = s * Math.sqrt(3) / 2;
  const rows = Math.ceil(N / h) + 1;
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const y0 = r * h;
    // Each strip contains 2*cols triangles alternating up/down.
    // Adjacent strips offset by half so triangles share full edges.
    const stripFlip = r % 2 === 1;
    for (let i = -1; i <= cols * 2; i++) {
      const xMid = i * s / 2;
      const up = (i % 2 === 0) !== stripFlip;
      const points = up
        ? `${xMid - s / 2},${y0 + h} ${xMid + s / 2},${y0 + h} ${xMid},${y0}`
        : `${xMid - s / 2},${y0} ${xMid + s / 2},${y0} ${xMid},${y0 + h}`;
      parent.appendChild(el('polygon', {
        points,
        fill: palette[idx++ % palette.length],
      }));
    }
  }
}

// Pointy-top hexagon tessellation across the tile rect. cols sets
// the horizontal hex count. Colours cycle the palette by row × col.
function renderHex(parent, layer, N, palette) {
  const cols = Math.max(1, layer.cols | 0 || 6);
  const w = N / cols;                       // hex flat-to-flat
  const side = w / Math.sqrt(3);
  const rowStep = 1.5 * side;
  const rows = Math.ceil(N / rowStep) + 2;
  let idx = 0;
  for (let r = -1; r < rows; r++) {
    const offX = ((r % 2) + 2) % 2 === 1 ? w / 2 : 0;
    for (let c = -1; c < cols + 1; c++) {
      const cx = c * w + offX + w / 2;
      const cy = r * rowStep + side;
      parent.appendChild(el('polygon', {
        points: hexPolygonPoints(cx, cy, w),
        fill: palette[idx++ % palette.length],
      }));
    }
  }
}

// Randomized: shape per grid cell with per-cell modifiers. Drawn at
// 9 wrapped offsets so shapes crossing the tile edge appear on the
// opposite side too.
function renderRandomized(parent, layer, N, rng, palette) {
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

// ---------- Repeat unit ----------
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
    case 'hex': {
      const w = N;
      const side = N / Math.sqrt(3);
      const rowStep = 1.5 * side;
      const unitH = 2 * rowStep;
      const clipId = 'girard-hex-clip';
      const clipPath = el('clipPath', { id: clipId }, [el('path', { d: hexagonPath(w) })]);
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
      return {
        width: w, height: unitH,
        content: [
          clipPath,
          place(w / 2, rowStep / 2),
          place(0,     rowStep / 2 + rowStep),
          place(w,     rowStep / 2 + rowStep),
        ],
      };
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

// ---------- Layer list rendering ----------
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

  switch (layer.type) {
    case 'solid': {
      const c = addCtrl('color', 'color', layer.color || '#8a8a8a');
      c.addEventListener('input', () => { layer.color = c.value; onChange(); });
      break;
    }
    case 'regular':
      switch (layer.subtype) {
        case 'striped': {
          const o = addCtrl('orientation', 'select', layer.orientation || 'horizontal', { options: ['horizontal', 'vertical'] });
          const n = addCtrl('count', 'number', layer.count ?? 8, { min: 2, max: 24, step: 1 });
          const j = addCtrl('jitter', 'range', layer.widthJitter ?? 0.6, { min: 0, max: 1, step: 0.05 });
          o.addEventListener('change', () => { layer.orientation = o.value; onChange(); });
          n.addEventListener('input',  () => { layer.count = Number(n.value) | 0; onChange(); });
          j.addEventListener('input',  () => { layer.widthJitter = Number(j.value); onChange(); });
          break;
        }
        case 'checkered': {
          const c = addCtrl('cols', 'number', layer.cols ?? 6, { min: 1, max: 24, step: 1 });
          const r = addCtrl('rows', 'number', layer.rows ?? 6, { min: 1, max: 24, step: 1 });
          c.addEventListener('input', () => { layer.cols = Number(c.value) | 0; onChange(); });
          r.addEventListener('input', () => { layer.rows = Number(r.value) | 0; onChange(); });
          break;
        }
        case 'triangular':
        case 'hex': {
          const c = addCtrl('cols', 'number', layer.cols ?? 6, { min: 2, max: 24, step: 1 });
          c.addEventListener('input', () => { layer.cols = Number(c.value) | 0; onChange(); });
          break;
        }
      }
      break;
    case 'randomized': {
      const shape = addCtrl('shape', 'select', layer.shape?.kind || 'circle', { options: ['circle', 'square', 'triangle'] });
      const grid  = addCtrl('grid', 'number', layer.grid?.cols ?? 6, { min: 1, max: 24, step: 1 });
      shape.addEventListener('change', () => {
        layer.shape = shape.value === 'circle' ? { kind: 'circle', r: 22 } : { kind: shape.value, size: 30 };
        onChange();
      });
      grid.addEventListener('input', () => {
        const v = Number(grid.value) | 0;
        layer.grid = { ...(layer.grid || {}), cols: v, rows: v };
        onChange();
      });
      break;
    }
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

  rerender();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
