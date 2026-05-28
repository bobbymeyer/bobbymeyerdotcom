// girard — textile pattern tool, v0.
// Architecture preview of @bobbymeyer/girard. Single file for now;
// extracted to its own package once the data model stabilizes.

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
  repeat: 'square',
  palette: ['#e94e3b', '#f4c44b', '#1f6b8a', '#2c3e50', '#f5e9d0'],
  background: '#f5e9d0',
  layers: [
    {
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

// ---------- Modifier evaluation ----------
function evalMod(mod, rng, col, row, base) {
  if (!mod) return base;
  switch (mod.type) {
    case 'random':
      return mod.min + rng() * (mod.max - mod.min);
    case 'sine':
      return (mod.amp || 1) * Math.sin((col * (mod.fx || 0) + row * (mod.fy || 0))) + (mod.offset || 0);
    case 'linear':
      return base + col * (mod.dx || 0) + row * (mod.dy || 0);
    default:
      return base;
  }
}

function pickColor(mod, rng, palette) {
  if (!mod || mod.type === 'palette') {
    return palette[Math.floor(rng() * palette.length)];
  }
  return mod.value || '#000';
}

// ---------- Shapes ----------
function drawShape(g, shape) {
  switch (shape.kind) {
    case 'circle':
      g.ellipse(0, 0, shape.r * 2, shape.r * 2);
      break;
    case 'square':
      g.rectMode(g.CENTER);
      g.rect(0, 0, shape.size, shape.size);
      break;
    case 'triangle': {
      const s = shape.size || 20;
      g.triangle(0, -s, s * 0.866, s * 0.5, -s * 0.866, s * 0.5);
      break;
    }
  }
}

// ---------- Tile renderer ----------
// Renders one repeat unit. Shapes whose draw position falls outside
// the tile rect are also drawn wrapped to the opposite edge, so the
// resulting bitmap tiles seamlessly.
function renderTile(p, pattern) {
  const N = pattern.tileSize;
  const g = p.createGraphics(N, N);
  g.background(pattern.background);
  g.noStroke();

  // Sub-RNG per layer keeps layer noise independent of layer count.
  pattern.layers.forEach((layer, li) => {
    const rng = makeRng(pattern.seed + li * 9973);
    const { cols, rows, originOffset = 0 } = layer.grid;
    const cw = N / cols;
    const rh = N / rows;
    const off = originOffset * (cw + rh) / 2;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const cx = col * cw + cw / 2 + off;
        const cy = row * rh + rh / 2 + off;
        const mod = layer.modifiers;
        const s  = evalMod(mod.scale,  rng, col, row, 1);
        const r  = evalMod(mod.rotate, rng, col, row, 0);
        const jx = evalMod(mod.jitter, rng, col, row, 0);
        const jy = evalMod(mod.jitter, rng, col, row, 0);
        const color = pickColor(mod.color, rng, pattern.palette);
        // Draw at 9 wrapped positions so shapes crossing the edge
        // appear on the opposite side too.
        for (let dy = -N; dy <= N; dy += N) {
          for (let dx = -N; dx <= N; dx += N) {
            g.push();
            g.translate(cx + jx + dx, cy + jy + dy);
            g.rotate(p.radians(r));
            g.scale(s);
            g.fill(color);
            drawShape(g, layer.shape);
            g.pop();
          }
        }
      }
    }
  });
  return g;
}

// ---------- Repeat draw ----------
// Draws the cached tile into the preview viewport with the chosen
// repeat scheme. Edge-overflow wrapping is handled in the tile itself.
function drawRepeat(p, tile, mode) {
  const N = 3;
  const size = p.width / N;
  for (let row = -1; row <= N; row++) {
    for (let col = -1; col <= N; col++) {
      let ox = 0, oy = 0;
      if (mode === 'half-drop' && ((col % 2) + 2) % 2 === 1) oy = size / 2;
      if (mode === 'half-brick' && ((row % 2) + 2) % 2 === 1) ox = size / 2;
      if (mode === 'hex') {
        // staggered rows by 1/2 width, vertical step of size * √3/2
        const hexStep = size * Math.sqrt(3) / 2;
        const x = col * size + (((row % 2) + 2) % 2 === 1 ? size / 2 : 0);
        const y = row * hexStep;
        p.image(tile, x, y, size, size);
        continue;
      }
      p.image(tile, col * size + ox, row * size + oy, size, size);
    }
  }
}

// ---------- p5 instance ----------
function start(stage) {
  let pattern = defaultPattern();
  let tile = null;

  const sketch = (p) => {
    p.setup = () => {
      const size = Math.min(stage.clientWidth, 720);
      const cnv = p.createCanvas(size, size);
      cnv.parent(stage);
      p.pixelDensity(window.devicePixelRatio || 1);
      tile = renderTile(p, pattern);
      p.noLoop();
    };

    p.draw = () => {
      p.background(pattern.background);
      if (tile) drawRepeat(p, tile, pattern.repeat);
    };

    p.windowResized = () => {
      const size = Math.min(stage.clientWidth, 720);
      p.resizeCanvas(size, size);
      p.redraw();
    };

    p.setPattern = (next) => {
      pattern = next;
      tile = renderTile(p, pattern);
      p.redraw();
    };

    p.getPattern = () => pattern;
  };

  return new p5(sketch);
}

// ---------- Mount ----------
function mount() {
  const stage = document.getElementById('girard-stage');
  if (!stage) return;
  const inst = start(stage);

  const seedInput   = document.getElementById('girard-seed');
  const rollBtn     = document.getElementById('girard-roll');
  const repeatSel   = document.getElementById('girard-repeat');
  const densityIn   = document.getElementById('girard-density');

  const apply = (mut) => {
    const next = JSON.parse(JSON.stringify(inst.getPattern()));
    mut(next);
    inst.setPattern(next);
  };

  seedInput.addEventListener('input', () =>
    apply(n => { n.seed = Number(seedInput.value) | 0; }));

  rollBtn.addEventListener('click', () => {
    const s = Math.floor(Math.random() * 99999);
    seedInput.value = s;
    apply(n => { n.seed = s; });
  });

  repeatSel.addEventListener('change', () =>
    apply(n => { n.repeat = repeatSel.value; }));

  densityIn.addEventListener('input', () =>
    apply(n => {
      const d = Number(densityIn.value) | 0;
      n.layers.forEach(l => { l.grid.cols = d; l.grid.rows = d; });
    }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
