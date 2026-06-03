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

// ---------- Convex polygon helpers (for Voronoi cells) ----------
// Sutherland-Hodgman clip: keep the side of the bisector nearer P.
// M = midpoint of P,Q; dir = Q-P. Keep verts with dot(v-M, dir) <= 0.
function clipHalfPlane(poly, mx, my, dx, dy) {
  const out = [];
  const n = poly.length;
  const side = (p) => (p[0] - mx) * dx + (p[1] - my) * dy;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const sa = side(a), sb = side(b);
    if (sa <= 0) out.push(a);
    if ((sa < 0 && sb > 0) || (sa > 0 && sb < 0)) {
      const t = sa / (sa - sb);
      out.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
    }
  }
  return out;
}

// Inset a convex polygon by distance d (toward its interior). Returns
// null if the polygon collapses.
function insetConvex(poly, d) {
  if (poly.length < 3) return null;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  const lines = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey) || 1;
    ex /= len; ey /= len;
    // Inward normal (toward centroid).
    let nx = -ey, ny = ex;
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if ((cx - mx) * nx + (cy - my) * ny < 0) { nx = -nx; ny = -ny; }
    lines.push([a[0] + nx * d, a[1] + ny * d, ex, ey]);
  }
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const L1 = lines[(i - 1 + lines.length) % lines.length], L2 = lines[i];
    const [px, py, dx1, dy1] = L1;
    const [qx, qy, dx2, dy2] = L2;
    const denom = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(denom) < 1e-9) { out.push([qx, qy]); continue; }
    const t = ((qx - px) * dy2 - (qy - py) * dx2) / denom;
    out.push([px + dx1 * t, py + dy1 * t]);
  }
  // Reject if it turned inside out (centroid moved far / negative area).
  let area = 0;
  for (let i = 0; i < out.length; i++) {
    const a = out[i], b = out[(i + 1) % out.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (Math.abs(area) < 1e-3) return null;
  return out;
}

// Vertices for a bloom head, centred on the origin.
//   circle  → many-sided blob (smooth once rounded)
//   polygon → n-gon
//   star    → 2n alternating outer/inner radii (depth = inner/outer)
// `distort` randomly perturbs each vertex radius by ±distort.
function bloomPolygon(kind, r, n, depth, distort, rng) {
  const verts = [];
  const jitter = () => 1 + (rng() * 2 - 1) * distort;
  if (kind === 'circle') {
    const sides = 10;
    for (let i = 0; i < sides; i++) {
      const a = (Math.PI * 2 * i) / sides - Math.PI / 2;
      const rr = r * jitter();
      verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  } else if (kind === 'star') {
    for (let i = 0; i < n * 2; i++) {
      const a = (Math.PI * 2 * i) / (n * 2) - Math.PI / 2;
      const rr = (i % 2 === 0 ? r : r * depth) * jitter();
      verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  } else { // polygon
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n - Math.PI / 2;
      const rr = r * jitter();
      verts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
    }
  }
  return verts;
}

// Build an SVG path for a polygon, optionally rounding corners by
// fraction `round` (0 = sharp, 1 = max). Rounds via quadratic curves.
function polyPath(poly, round) {
  if (!poly || poly.length < 3) return '';
  if (!round || round <= 0) {
    return 'M' + poly.map(p => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' L') + 'Z';
  }
  const n = poly.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n], cur = poly[i], next = poly[(i + 1) % n];
    const t = Math.min(0.5, round * 0.5);
    const p1 = [cur[0] + (prev[0] - cur[0]) * t, cur[1] + (prev[1] - cur[1]) * t];
    const p2 = [cur[0] + (next[0] - cur[0]) * t, cur[1] + (next[1] - cur[1]) * t];
    if (i === 0) d += `M${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
    else d += ` L${p1[0].toFixed(2)},${p1[1].toFixed(2)}`;
    d += ` Q${cur[0].toFixed(2)},${cur[1].toFixed(2)} ${p2[0].toFixed(2)},${p2[1].toFixed(2)}`;
  }
  return d + 'Z';
}

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
  'Circle sections': {
    // Cream ground; an arc-block layer where every cell renders a
    // quarter-circle wedge toward its 2x2 block centre. Four cells
    // combine into a full circle. Per-cell colour is two random
    // palette picks (wedge + ground) — duplicate red entries skew
    // toward solid coverage; transparent entries leave gaps.
    palette: ['#d6433a', 'transparent'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3eedd', mode: 'fixed' },
      },
      {
        grid: { cols: 8, rows: 8, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'arc-block', weights: [1, 5, 1, 1, 1] },
        palette: ['#d6433a'],
      },
    ],
  },
  'Diamonds': {
    // Orange ground; a diamond grid (alternate-row half-offset so the
    // rhombi pack into a harlequin lattice) of concentric nested
    // diamonds. The orange shows between them via the cell gutter.
    // Each cell starts at a random palette index so colours vary.
    palette: ['#dd5b3e', '#b7a13f', '#b9863f', '#e08a3c'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#ef9a3d', mode: 'fixed' },
      },
      {
        grid: {
          cols: 7, rows: 9,
          offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row',
          gutterX: 0.12, gutterY: 0.12,
        },
        fill: {
          kind: 'shape',
          shape: { kind: 'diamond', rings: 3, size: 1 },
          mode: 'random',
        },
        palette: ['#dd5b3e', '#b7a13f', '#b9863f', '#ef9a3d'],
      },
    ],
  },
  'Firecrackers': {
    // Cream ground; a 1x3 row grid paints a thin orange top band (and
    // leaves the lower rows transparent); a 32x3 row grid positions
    // vertical tabs only in the middle row by addressing specific
    // palette positions — top and bottom rows all transparent, middle
    // row all orange, gutterX carves the gaps between tabs.
    palette: ['#e0954a', '#f3eedd'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3eedd', mode: 'fixed' },
      },
      {
        grid: {
          cols: 1, rows: 3,
          rowWeights: [1, 5, 8],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['#e0954a', 'transparent', 'transparent'],
      },
      {
        grid: {
          cols: 32, rows: 3,
          rowWeights: [1, 5, 8],
          gutterX: 0.4,
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: [
          ...Array(32).fill('transparent'),
          ...Array(32).fill('#e0954a'),
          ...Array(32).fill('transparent'),
        ],
      },
    ],
  },
  'Labyrinth': {
    // Cream ground; a perfect maze generated on a torus so the wall
    // pattern tiles seamlessly. 90° passages only. Roll the seed for
    // a new maze.
    palette: ['#2c3340'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#efe9dc', mode: 'fixed' },
      },
      {
        grid: { cols: 10, rows: 10, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'maze', color: '#2c3340', thickness: 0.18 },
      },
    ],
  },
  'Pebbles': {
    // Dark ground; a toroidal Voronoi layer of rounded tan pebbles
    // with a thin dark gap between them. Roll the seed for a fresh
    // arrangement.
    palette: ['#d8c79c'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#2b2b2b', mode: 'fixed' },
      },
      {
        grid: { cols: 14, rows: 14, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'voronoi', mode: 'fixed', color: '#d8c79c', jitter: 0.42, gap: 0.12, round: 0.6 },
      },
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
  'Blooms': {
    // White ground; a bloom layer scatters little flowers — stems
    // fanning from a base, each tipped with a rounded, slightly
    // distorted bloom. Bright palette per the Girard collage.
    palette: ['#e8612d', '#f2a93b', '#f4d23b', '#b9d44a', '#e8408a', '#f0a8c8', '#cfcabb'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#fbfaf6', mode: 'fixed' },
      },
      {
        grid: { cols: 5, rows: 5, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'bloom', bloom: 'circle', stems: 4, spread: 52, bloomSize: 0.13, round: 0.7, distort: 0.18, stemColor: '#4a4a4a', stemWidth: 0.01 },
        palette: ['#e8612d', '#f2a93b', '#f4d23b', '#b9d44a', '#e8408a', '#f0a8c8', '#cfcabb'],
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
  'Flower seals': {
    // Cream base; 4-band horizontal stripes (peach / lavender /
    // magenta / pink) repeating vertically; a 5x5 flower-seal grid
    // with alternate-row x-offset 0.5 (so seals sit on the stripe
    // seams). Two-colour palette draws a seal + flower pair per
    // cell, randomly picking from peach / magenta / pink / lavender.
    palette: ['#f1a061', '#e6b6db', '#c258a3', '#ef85a3', '#a9a039'],
    aspect: 1,
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#fbf3e2', mode: 'fixed' },
      },
      {
        grid: { cols: 1, rows: 4, rowWeights: [1, 1, 1, 1], offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['#f1a061', '#e6b6db', '#c258a3', '#ef85a3'],
      },
      {
        grid: { cols: 5, rows: 5, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'flower-seal', punch: true, petals: 5, sealSize: 0.95, petalSize: 0.42, petalOffset: 0.55, centerSize: 0.45, dotSize: 0.18 },
        palette: ['#c258a3', '#ef6a44', '#a9a039', '#7a2c6e'],
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
        || (l.fill?.kind === 'arc-split')
        || (l.fill?.kind === 'arc-block')
        || (l.fill?.kind === 'mesh' && l.fill?.mode === 'palette-cycle')
        || (l.fill?.kind === 'triangles' && (l.fill?.mode === 'palette-cycle' || l.fill?.mode === 'random'))
        || (l.fill?.kind === 'voronoi' && (l.fill?.mode === 'palette-cycle' || l.fill?.mode === 'random'))
        || (l.fill?.kind === 'bloom')
        || (l.fill?.kind === 'flower-seal');
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
    case 'diamond': {
      // Concentric rhombi filling the cell, cycling the palette so
      // each cell nests several colours. Uses cw/rh directly so the
      // diamond matches the cell aspect.
      const g = el('g', {});
      const rings = Math.max(1, shape.rings | 0 || 3);
      const pal = (ctx && ctx.palette && ctx.palette.length) ? ctx.palette : [fill];
      const start = ctx?.colorStart ?? 0;
      const sizeF = shape.size ?? 1;
      const hw = (cw / 2) * sizeF, hh = (rh / 2) * sizeF;
      for (let k = 0; k < rings; k++) {
        const f = 1 - k / rings;            // outer → inner
        const w = hw * f, h = hh * f;
        const c = pal[mod(start + k, pal.length)];
        if (c == null || c === 'transparent' || c === 'none') continue;
        g.appendChild(el('polygon', {
          points: `0,${(-h).toFixed(2)} ${w.toFixed(2)},0 0,${h.toFixed(2)} ${(-w).toFixed(2)},0`,
          fill: c,
        }));
      }
      return g;
    }
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
// Tile dimensions. aspect = width / height (default 1 = square). The
// longer side is held at tileSize so the tile always fits the view.
function tileDims(pattern) {
  const base = pattern.tileSize;
  const a = pattern.aspect ?? 1;
  return a >= 1 ? { w: base, h: base / a } : { w: base * a, h: base };
}

function buildTileGroup(pattern) {
  const { w, h } = tileDims(pattern);
  const root = el('g');
  pattern.layers.forEach((layer, li) => {
    renderLayer(root, layer, 0, 0, w, h, pattern.palette, pattern.seed + li * 9973);
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
  const layerBounds = { x, y, w, h, salt: (rngSeed >>> 0) | 1 };

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
// Cell with a quarter-circle wedge at one corner over a solid ground.
// corner ∈ [0..3] maps to TL, TR, BR, BL. Wedge radius = min(w, h);
// when the cell is square the arc reaches the two opposite midlines.
function drawArcSplit(parent, x, y, w, h, colorWedge, colorGround, corner) {
  if (!(colorGround == null || colorGround === 'transparent' || colorGround === 'none')) {
    parent.appendChild(el('rect', { x, y, width: w, height: h, fill: colorGround }));
  }
  if (colorWedge == null || colorWedge === 'transparent' || colorWedge === 'none') return;
  const r = Math.min(w, h);
  let d;
  switch (((corner % 4) + 4) % 4) {
    case 0: d = `M${x},${y} L${x + r},${y} A${r},${r} 0 0,1 ${x},${y + r} Z`; break;
    case 1: d = `M${x + w},${y} L${x + w},${y + r} A${r},${r} 0 0,1 ${x + w - r},${y} Z`; break;
    case 2: d = `M${x + w},${y + h} L${x + w - r},${y + h} A${r},${r} 0 0,1 ${x + w},${y + h - r} Z`; break;
    case 3: d = `M${x},${y + h} L${x},${y + h - r} A${r},${r} 0 0,1 ${x + r},${y + h} Z`; break;
  }
  parent.appendChild(el('path', { d, fill: colorWedge }));
}

// Quarter annular sector. 90° band centred at one cell corner with
// outer radius = cell side and inner radius = cell side / 2. Four
// of these at the four corners of a 2x2 block combine into a ring.
function drawArcRing(parent, x, y, w, h, color, corner) {
  const r2 = Math.min(w, h);
  const r1 = r2 / 2;
  let d;
  switch (((corner % 4) + 4) % 4) {
    case 0: // TL
      d = `M ${x + r2},${y} A ${r2},${r2} 0 0,1 ${x},${y + r2}`
        + ` L ${x},${y + r1} A ${r1},${r1} 0 0,0 ${x + r1},${y} Z`;
      break;
    case 1: // TR
      d = `M ${x + w},${y + r2} A ${r2},${r2} 0 0,1 ${x + w - r2},${y}`
        + ` L ${x + w - r1},${y} A ${r1},${r1} 0 0,0 ${x + w},${y + r1} Z`;
      break;
    case 2: // BR
      d = `M ${x + w - r2},${y + h} A ${r2},${r2} 0 0,1 ${x + w},${y + h - r2}`
        + ` L ${x + w},${y + h - r1} A ${r1},${r1} 0 0,0 ${x + w - r1},${y + h} Z`;
      break;
    case 3: // BL
      d = `M ${x},${y + h - r2} A ${r2},${r2} 0 0,1 ${x + r2},${y + h}`
        + ` L ${x + r1},${y + h} A ${r1},${r1} 0 0,0 ${x},${y + h - r1} Z`;
      break;
  }
  parent.appendChild(el('path', { d, fill: color }));
}

// Triangular half. corner ∈ [0..3] (TL, TR, BR, BL). The triangle
// includes the named corner and its two neighbours — split by the
// diagonal NOT touching that corner.
function drawHalfTriangle(parent, x, y, w, h, color, corner) {
  const tl = `${x},${y}`;
  const tr = `${x + w},${y}`;
  const br = `${x + w},${y + h}`;
  const bl = `${x},${y + h}`;
  let points;
  switch (((corner % 4) + 4) % 4) {
    case 0: points = `${tl} ${tr} ${bl}`; break; // TL + TR + BL
    case 1: points = `${tl} ${tr} ${br}`; break; // TL + TR + BR
    case 2: points = `${tr} ${br} ${bl}`; break; // TR + BR + BL
    case 3: points = `${tl} ${bl} ${br}`; break; // TL + BL + BR
  }
  parent.appendChild(el('polygon', { points, fill: color }));
}

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
      // Starting palette index for this cell (used by multi-colour
      // shapes like diamond's concentric rings).
      const colorStart = (fill.mode === 'palette-cycle' || fill.mode === 'checker')
        ? paletteIndex(fill.mode)
        : fill.mode === 'random'
        ? Math.floor(rng() * palette.length)
        : 0;
      const lw = layerBounds?.w, lh = layerBounds?.h;
      const baseX = ix + iw / 2 + jx;
      const baseY = iy + ih / 2 + jy;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!lw || !lh) { if (dx || dy) continue; }
          const node = shapeNode(shape, iw, ih, color, { textIndex, rng, palette, colorStart });
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
      // Each triangle gets its own colour; horizontal wrap pairs land
      // on the same index via mod(cols). Up and down at the same (r,c)
      // are distinct triangles (no rhombus pairing) so they don't
      // collapse into a visible diamond.
      const colorAt = (r, c, type) => {
        if (fill.mode === 'fixed') return fill.color || palette[0] || '#888';
        const idx = mod(r, strips) * tcols * 2 + mod(c, tcols) * 2 + (type === 'down' ? 1 : 0);
        if (fill.mode === 'palette-cycle') return palette[mod(idx, palette.length)];
        const seed = ((idx * 0x9E3779B1) ^ triSalt) >>> 0;
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
    case 'flower-seal': {
      // A disc ("seal") with a circular-petal flower laid on top.
      // Both colours are drawn from the palette (random per cell) so
      // you can balance the flower against an underlying stripe by
      // hand. Petal count, petal size, ring offset, and centre size
      // are all tunable.
      const salt = layerBounds?.salt ?? 1;
      const cseed = (((col * 73856093) ^ (row * 19349663) ^ salt) >>> 0) || 1;
      const crng = makeRng(cseed);

      const sealColor = palette[Math.floor(crng() * palette.length)];
      const flowerColor = palette[Math.floor(crng() * palette.length)];

      const cx = ix + iw / 2;
      const cy = iy + ih / 2;
      const sealR = (fill.sealSize ?? 0.95) * Math.min(iw, ih) / 2;
      const n = Math.max(3, fill.petals | 0 || 5);
      const petalR = (fill.petalSize ?? 0.42) * sealR;
      const petalOff = sealR * (fill.petalOffset ?? 0.55);
      const centerR = (fill.centerSize ?? 0.45) * sealR;
      const dotR = (fill.dotSize ?? 0.18) * sealR;

      if (fill.punch) {
        // Seal disc with the flower (union of petals + centre) knocked
        // out via a mask. objectBoundingBox keeps the mask coords
        // normalised relative to each masked circle, so the same mask
        // matches every tile instance — userSpaceOnUse only worked at
        // the original position and left the other tiles blank.
        if (isTransparent(sealColor) || sealR <= 0) break;
        const maskId = `gs-${mod(col, 9999)}-${mod(row, 9999)}-${salt & 0xffff}`;
        const petalOffN = 0.5 * (fill.petalOffset ?? 0.55);
        const petalRN = 0.5 * (fill.petalSize ?? 0.42);
        const centerRN = 0.5 * (fill.centerSize ?? 0.45);
        const mask = el('mask', {
          id: maskId,
          maskUnits: 'objectBoundingBox',
          maskContentUnits: 'objectBoundingBox',
          x: 0, y: 0, width: 1, height: 1,
        });
        mask.appendChild(el('circle', { cx: 0.5, cy: 0.5, r: 0.5, fill: '#fff' }));
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          mask.appendChild(el('circle', {
            cx: 0.5 + Math.cos(a) * petalOffN,
            cy: 0.5 + Math.sin(a) * petalOffN,
            r: petalRN, fill: '#000',
          }));
        }
        if (centerRN > 0) {
          mask.appendChild(el('circle', { cx: 0.5, cy: 0.5, r: centerRN, fill: '#000' }));
        }
        parent.appendChild(mask);
        parent.appendChild(el('circle', { cx, cy, r: sealR, fill: sealColor, mask: `url(#${maskId})` }));
        if (dotR > 0) parent.appendChild(el('circle', { cx, cy, r: dotR, fill: sealColor }));
        break;
      }

      if (!isTransparent(sealColor) && sealR > 0) {
        parent.appendChild(el('circle', { cx, cy, r: sealR, fill: sealColor }));
      }
      if (!isTransparent(flowerColor) && sealR > 0) {
        for (let i = 0; i < n; i++) {
          const a = (Math.PI * 2 * i) / n - Math.PI / 2;
          parent.appendChild(el('circle', {
            cx: cx + Math.cos(a) * petalOff,
            cy: cy + Math.sin(a) * petalOff,
            r: petalR,
            fill: flowerColor,
          }));
        }
        if (centerR > 0) {
          parent.appendChild(el('circle', { cx, cy, r: centerR, fill: flowerColor }));
        }
      }
      break;
    }
    case 'bloom': {
      // A "flower" per cell: stems fan out from a base point near the
      // bottom of the cell, each tipped with a bloom shape (blob /
      // polygon / star) that can be rounded and distorted. Per-cell
      // randomness (stem count, angles, lengths, bloom colours and
      // sizes) comes from a deterministic cell RNG so it's seed-
      // responsive; drawn at the 9 wraps so flowers crossing the cell
      // edge tile cleanly.
      const salt = layerBounds?.salt ?? 1;
      const lw = layerBounds?.w, lh = layerBounds?.h;
      const cseed = (((col * 73856093) ^ (row * 19349663) ^ salt) >>> 0) || 1;
      const crng = makeRng(cseed);

      const stemColor = fill.stemColor || '#454545';
      const stemW = (fill.stemWidth ?? 0.012) * Math.min(iw, ih);
      const nStems = Math.max(1, Math.round((fill.stems ?? 4) + (crng() * 2 - 1)));
      const spread = (fill.spread ?? 48) * Math.PI / 180;
      const angleJit = (fill.angleJitter ?? 0) * Math.PI / 180;
      const baseX = ix + iw / 2 + (crng() * 2 - 1) * iw * 0.12;
      const baseY = iy + ih * 0.92;
      const stemLen = ih * (0.62 + crng() * 0.16);
      const bloomR = (fill.bloomSize ?? 0.16) * Math.min(iw, ih);
      const kind = fill.bloom || 'circle';
      const pts = Math.max(3, fill.points | 0 || 5);
      const round = fill.round ?? 0.4;
      const distort = fill.distort ?? 0.15;

      const flower = el('g');
      for (let i = 0; i < nStems; i++) {
        const frac = nStems === 1 ? 0.5 : i / (nStems - 1);
        const ang = (frac - 0.5) * spread + (crng() * 2 - 1) * angleJit; // from vertical
        const len = stemLen * (0.78 + crng() * 0.3);
        const tipX = baseX + Math.sin(ang) * len;
        const tipY = baseY - Math.cos(ang) * len;
        flower.appendChild(el('line', {
          x1: baseX, y1: baseY, x2: tipX, y2: tipY,
          stroke: stemColor, 'stroke-width': stemW, 'stroke-linecap': 'round',
        }));

        // Leaves: football/almond shapes placed randomly along the
        // stem, matching the stem colour, oriented along it. Count
        // scales with leafDensity.
        const leafDensity = fill.leafDensity ?? 0;
        if (leafDensity > 0) {
          const stemAng = Math.atan2(tipY - baseY, tipX - baseX);
          const nLeaves = Math.floor(leafDensity * 6 + crng() * leafDensity * 4);
          const leafLen = (fill.leafSize ?? 0.1) * Math.min(iw, ih);
          const leafW = leafLen * 0.42;
          for (let k = 0; k < nLeaves; k++) {
            const t = 0.15 + crng() * 0.7;          // position along stem
            const lx = baseX + (tipX - baseX) * t;
            const ly = baseY + (tipY - baseY) * t;
            // Tilt the leaf off the stem to one side.
            const side = crng() < 0.5 ? -1 : 1;
            const tilt = (0.5 + crng() * 0.5) * side;
            const a = stemAng + tilt;
            const ca = Math.cos(a), sa = Math.sin(a);
            // Lens centred at origin, long axis = leafLen, then placed
            // so its inner tip touches the stem.
            const hx = ca * leafLen / 2, hy = sa * leafLen / 2;     // half long-axis
            const px = -sa * leafW / 2, py = ca * leafW / 2;        // half short-axis
            const x0 = lx - hx, y0 = ly - hy;   // inner tip on stem
            const x1 = lx + hx, y1 = ly + hy;   // outer tip
            const cx1 = lx + px, cy1 = ly + py;
            const cx2 = lx - px, cy2 = ly - py;
            flower.appendChild(el('path', {
              d: `M${x0.toFixed(2)},${y0.toFixed(2)} Q${cx1.toFixed(2)},${cy1.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)} Q${cx2.toFixed(2)},${cy2.toFixed(2)} ${x0.toFixed(2)},${y0.toFixed(2)} Z`,
              fill: stemColor,
            }));
          }
        }
        const color = palette[Math.floor(crng() * palette.length)];
        if (isTransparent(color)) continue;
        const r = bloomR * (0.7 + crng() * 0.6);
        const poly = bloomPolygon(kind, r, pts, fill.depth ?? 0.5, distort, crng);
        flower.appendChild(el('path', {
          d: polyPath(poly.map(p => [tipX + p[0], tipY + p[1]]), round),
          fill: color,
        }));
      }

      const wx = lw || 0, wy = lh || 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if ((dx || dy) && (!wx || !wy)) continue;
          const node = flower.cloneNode(true);
          if (dx || dy) node.setAttribute('transform', `translate(${dx * wx} ${dy * wy})`);
          parent.appendChild(node);
        }
      }
      break;
    }
    case 'voronoi': {
      // Toroidal Voronoi "pebbles". Jittered seed points on a torus
      // (jitter hashed per wrapped cell so it tiles). Each cell is
      // computed by clipping a bounding box against the perpendicular
      // bisectors of nearby sites, then inset by a gap and corner-
      // rounded. Drawn at the 9 layer wraps so edge cells complete
      // across the seam.
      if (col !== 0 || row !== 0) break;
      const nc = cols, nr = rows;
      const lw = layerBounds?.w ?? cw * nc;
      const lh = layerBounds?.h ?? rh * nr;
      const ox = layerBounds?.x ?? 0;
      const oy = layerBounds?.y ?? 0;
      const cellW = lw / nc, cellH = lh / nr;
      const salt = layerBounds?.salt ?? 1;
      const jitterAmt = Math.max(0, Math.min(0.5, fill.jitter ?? 0.4));
      const gap = (fill.gap ?? 0.08) * Math.min(cellW, cellH);
      const round = fill.round ?? 0.5;

      const siteAt = (c, r) => {
        const cc = mod(c, nc), rr = mod(r, nr);
        const rng2 = makeRng((((cc * 73856093) ^ (rr * 19349663) ^ salt) >>> 0) || 1);
        const jx = (rng2() * 2 - 1) * jitterAmt * cellW;
        const jy = (rng2() * 2 - 1) * jitterAmt * cellH;
        return [ox + (c + 0.5) * cellW + jx, oy + (r + 0.5) * cellH + jy];
      };

      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          const P = siteAt(c, r);
          // Start with a generous bounding box around the site.
          let poly = [
            [P[0] - cellW * 1.6, P[1] - cellH * 1.6],
            [P[0] + cellW * 1.6, P[1] - cellH * 1.6],
            [P[0] + cellW * 1.6, P[1] + cellH * 1.6],
            [P[0] - cellW * 1.6, P[1] + cellH * 1.6],
          ];
          for (let dr = -2; dr <= 2 && poly.length; dr++) {
            for (let dc = -2; dc <= 2; dc++) {
              if (dc === 0 && dr === 0) continue;
              const Q = siteAt(c + dc, r + dr);
              const mx = (P[0] + Q[0]) / 2, my = (P[1] + Q[1]) / 2;
              poly = clipHalfPlane(poly, mx, my, Q[0] - P[0], Q[1] - P[1]);
              if (!poly.length) break;
            }
          }
          const pebble = insetConvex(poly, gap / 2);
          if (!pebble) continue;
          const color = fill.mode === 'random' || fill.mode === 'palette-cycle'
            ? palette[fill.mode === 'random'
                ? Math.floor(makeRng((((c * 12347) ^ (r * 56789) ^ salt) >>> 0) || 1)() * palette.length)
                : mod(c + r * nc, palette.length)]
            : (fill.color || palette[0] || '#d8c79c');
          if (isTransparent(color)) continue;
          const dPath = polyPath(pebble, round);
          for (let wy = -1; wy <= 1; wy++) {
            for (let wx = -1; wx <= 1; wx++) {
              const node = el('path', { d: dPath, fill: color });
              if (wx || wy) node.setAttribute('transform', `translate(${wx * lw} ${wy * lh})`);
              parent.appendChild(node);
            }
          }
        }
      }
      break;
    }
    case 'maze': {
      // Perfect maze (spanning tree of passages) generated on a TORUS
      // so it tiles seamlessly: adjacency wraps in both axes. Walls
      // for every non-passage edge are drawn as thick strokes; wrap
      // walls are mirrored to the opposite edge.
      if (col !== 0 || row !== 0) break;
      const nc = cols, nr = rows;
      const lw = layerBounds?.w ?? cw * nc;
      const lh = layerBounds?.h ?? rh * nr;
      const ox = layerBounds?.x ?? 0;
      const oy = layerBounds?.y ?? 0;
      const cellW = lw / nc, cellH = lh / nr;
      const salt = layerBounds?.salt ?? 1;
      const mr = makeRng(salt);

      // Walls present by default; carving removes them.
      const vWall = new Set(); // 'c:r' = wall east of (c,r) → ((c+1)%nc, r)
      const hWall = new Set(); // 'c:r' = wall south of (c,r) → (c,(r+1)%nr)
      for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        vWall.add(`${c}:${r}`);
        hWall.add(`${c}:${r}`);
      }

      // Randomized DFS (recursive backtracker) on the torus.
      const visited = new Uint8Array(nc * nr);
      const stack = [[0, 0]];
      visited[0] = 1;
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      while (stack.length) {
        const [c, r] = stack[stack.length - 1];
        // Shuffle directions deterministically.
        const order = [0, 1, 2, 3];
        for (let i = order.length - 1; i > 0; i--) {
          const j = Math.floor(mr() * (i + 1));
          [order[i], order[j]] = [order[j], order[i]];
        }
        let advanced = false;
        for (const di of order) {
          const [dc, dr] = dirs[di];
          const ncx = mod(c + dc, nc), nry = mod(r + dr, nr);
          if (visited[nry * nc + ncx]) continue;
          // Remove the wall between (c,r) and the neighbour.
          if (dc === 1) vWall.delete(`${c}:${r}`);
          else if (dc === -1) vWall.delete(`${ncx}:${r}`);
          else if (dr === 1) hWall.delete(`${c}:${r}`);
          else hWall.delete(`${c}:${nry}`);
          visited[nry * nc + ncx] = 1;
          stack.push([ncx, nry]);
          advanced = true;
          break;
        }
        if (!advanced) stack.pop();
      }

      const color = fill.color || palette[0] || '#2c3340';
      const thickness = (fill.thickness ?? 0.18) * Math.min(cellW, cellH);
      const segs = [];
      const addSeg = (x1, y1, x2, y2) => segs.push([x1, y1, x2, y2]);
      // Vertical walls (east edges).
      for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        if (!vWall.has(`${c}:${r}`)) continue;
        const x = ox + ((c + 1) * cellW);
        const y1 = oy + r * cellH, y2 = oy + (r + 1) * cellH;
        addSeg(x, y1, x, y2);
        if (c === nc - 1) addSeg(ox, y1, ox, y2); // mirror wrap wall to left edge
      }
      // Horizontal walls (south edges).
      for (let r = 0; r < nr; r++) for (let c = 0; c < nc; c++) {
        if (!hWall.has(`${c}:${r}`)) continue;
        const y = oy + ((r + 1) * cellH);
        const x1 = ox + c * cellW, x2 = ox + (c + 1) * cellW;
        addSeg(x1, y, x2, y);
        if (r === nr - 1) addSeg(x1, oy, x2, oy); // mirror wrap wall to top edge
      }
      // Render each wall as a filled rectangle extended by
      // thickness/2 at both ends. Collinear walls overlap by t,
      // perpendicular walls overlap in a t × t square at corners,
      // and edge walls extend past the tile boundary so the
      // adjacent tile's mirrored wall completes the seam.
      for (const [x1, y1, x2, y2] of segs) {
        if (x1 === x2) {
          parent.appendChild(el('rect', {
            x: x1 - thickness / 2,
            y: Math.min(y1, y2) - thickness / 2,
            width: thickness,
            height: Math.abs(y2 - y1) + thickness,
            fill: color,
          }));
        } else {
          parent.appendChild(el('rect', {
            x: Math.min(x1, x2) - thickness / 2,
            y: y1 - thickness / 2,
            width: Math.abs(x2 - x1) + thickness,
            height: thickness,
            fill: color,
          }));
        }
      }
      break;
    }
    case 'arc-block': {
      // 2x2 block tile set. Each cell picks one of five types:
      //   blank  | nothing
      //   arc    | quarter-circle at the inner corner (facing block centre)
      //   vsplit | half-cell, vertical split, inner side filled
      //   hsplit | half-cell, horizontal split, inner side filled
      //   full   | whole cell filled
      // Orientation in every type is derived from the cell's position
      // in the block — four arcs always combine into a full circle,
      // four vsplits into a vertical bar through the block, etc.
      // Colour is picked once PER BLOCK so a circle reads as one
      // colour even when cells differ in type.
      const innerX = mod(col, 2);
      const innerY = mod(row, 2);
      const salt = layerBounds?.salt ?? 1;

      // Per-cell type (deterministic weighted random).
      const cellSeed = (((col * 73856093) ^ (row * 19349663) ^ salt) >>> 0) || 1;
      const cellRng = makeRng(cellSeed);
      const types = ['blank', 'arc', 'vsplit', 'hsplit', 'full'];
      const weights = (Array.isArray(fill.weights) && fill.weights.length === types.length)
        ? fill.weights : [1, 3, 1, 1, 1];
      const total = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      let pick = cellRng() * total, cellType = 'blank';
      for (let i = 0; i < types.length; i++) {
        pick -= Math.max(0, weights[i]);
        if (pick <= 0) { cellType = types[i]; break; }
      }
      if (cellType === 'blank') break;

      // Per-block colour.
      const blockCol = Math.floor(col / 2);
      const blockRow = Math.floor(row / 2);
      const blockSeed = (((blockCol * 73856093) ^ (blockRow * 19349663) ^ salt ^ 0x5bd1e995) >>> 0) || 1;
      const blockRng = makeRng(blockSeed);
      const color = palette[Math.floor(blockRng() * palette.length)];
      if (isTransparent(color)) break;

      if (cellType === 'arc') {
        const innerCorner = innerY === 0
          ? (innerX === 0 ? 2 : 3)  // TL→BR, TR→BL
          : (innerX === 0 ? 1 : 0); // BL→TR, BR→TL
        drawArcRing(parent, ix, iy, iw, ih, color, innerCorner);
      } else if (cellType === 'vsplit') {
        // Fill the OUTER half — the side away from the block centre,
        // aligning with the edge the annular band hugs. Right-column
        // cells fill right, left-column cells fill left.
        const fillRight = innerX === 1;
        parent.appendChild(el('rect', {
          x: fillRight ? ix + iw / 2 : ix,
          y: iy, width: iw / 2, height: ih, fill: color,
        }));
      } else if (cellType === 'hsplit') {
        // Bottom-row cells fill bottom, top-row cells fill top.
        const fillBottom = innerY === 1;
        parent.appendChild(el('rect', {
          x: ix, y: fillBottom ? iy + ih / 2 : iy,
          width: iw, height: ih / 2, fill: color,
        }));
      } else if (cellType === 'full') {
        parent.appendChild(el('rect', { x: ix, y: iy, width: iw, height: ih, fill: color }));
      }
      break;
    }
    case 'arc-split': {
      // Quarter-circle split. Each cell paints a pie wedge at one of
      // four corners (random or palette-cycle position) over a
      // background rect. Two palette picks per cell — one for the
      // wedge, one for the ground — with transparent surfacing as
      // empty.
      const pickRandom = () => palette[Math.floor(rng() * palette.length)];
      const colorWedge = pickRandom();
      const colorGround = pickRandom();
      const corner = Math.floor(rng() * 4);
      drawArcSplit(parent, ix, iy, iw, ih, colorWedge, colorGround, corner);
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
  const { w, h } = tileDims(pattern);
  switch (pattern.repeat) {
    case 'half-drop': {
      const g1 = tileGroup.cloneNode(true);
      const g2 = tileGroup.cloneNode(true);
      g2.setAttribute('transform', `translate(${w} ${h / 2})`);
      return { width: w * 2, height: h, content: [g1, g2] };
    }
    case 'half-brick': {
      const g1 = tileGroup.cloneNode(true);
      const g2 = tileGroup.cloneNode(true);
      g2.setAttribute('transform', `translate(${w / 2} ${h})`);
      return { width: w, height: h * 2, content: [g1, g2] };
    }
    default:
      return { width: w, height: h, content: [tileGroup] };
  }
}

// ---------- Top-level SVG ----------
function buildSvg(pattern) {
  const { w: tileW, h: tileH } = tileDims(pattern);
  const viewW = tileW * 3, viewH = tileH * 3;
  const root = el('svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${viewW} ${viewH}`,
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

  root.appendChild(el('rect', {
    width: viewW, height: viewH,
    fill: `url(#${patternId})`,
  }));
  const veil = Math.max(0, Math.min(1, pattern.surroundVeil ?? 0.5));
  if (veil > 0) {
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        if (row === 1 && col === 1) continue;
        root.appendChild(el('rect', {
          x: col * tileW, y: row * tileH,
          width: tileW, height: tileH,
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
  const fillKind = addCtrl('kind', 'select', layer.fill.kind, { options: ['solid', 'shape', 'split', 'arc-split', 'arc-block', 'mesh', 'triangles', 'voronoi', 'bloom', 'flower-seal', 'maze'] });
  fillKind.addEventListener('change', () => {
    if (fillKind.value === 'solid') {
      layer.fill = { kind: 'solid', color: layer.fill.color || '#8a8a8a', mode: layer.fill.mode || 'fixed' };
    } else if (fillKind.value === 'shape') {
      layer.fill = { kind: 'shape', shape: layer.fill.shape || { kind: 'circle', size: 0.6 }, mode: 'palette-cycle' };
    } else if (fillKind.value === 'split') {
      layer.fill = { kind: 'split', mode: 'random' };
    } else if (fillKind.value === 'arc-split') {
      layer.fill = { kind: 'arc-split', mode: 'random' };
    } else if (fillKind.value === 'arc-block') {
      layer.fill = { kind: 'arc-block' };
    } else if (fillKind.value === 'mesh') {
      layer.fill = { kind: 'mesh', mode: 'fixed', color: '#d24a45', jitter: 0.25, strokeWidth: 0.01, stroke: '#ffffff' };
    } else if (fillKind.value === 'maze') {
      layer.fill = { kind: 'maze', color: '#2c3340', thickness: 0.18 };
    } else if (fillKind.value === 'voronoi') {
      layer.fill = { kind: 'voronoi', mode: 'fixed', color: '#d8c79c', jitter: 0.4, gap: 0.08, round: 0.5 };
    } else if (fillKind.value === 'bloom') {
      layer.fill = { kind: 'bloom', bloom: 'circle', stems: 4, spread: 48, bloomSize: 0.16, points: 5, round: 0.5, distort: 0.15, stemColor: '#454545', stemWidth: 0.012 };
    } else if (fillKind.value === 'flower-seal') {
      layer.fill = { kind: 'flower-seal', petals: 5, sealSize: 0.95, petalSize: 0.42, petalOffset: 0.55, centerSize: 0.45, dotSize: 0.18 };
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
      options: ['circle', 'square', 'triangle', 'diamond', 'text', 'star', 'quatrefoil'],
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
    if (layer.fill.shape?.kind === 'diamond') {
      const rg = addCtrl('rings', 'number', layer.fill.shape?.rings ?? 3, { min: 1, max: 8, step: 1 });
      rg.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'diamond' }), rings: Number(rg.value) | 0 };
        onChange();
      });
    }
    if (layer.fill.shape?.kind === 'quatrefoil') {
      const c = addCtrl('center (× lobe)', 'number', layer.fill.shape?.center ?? 1, { min: 0, max: 2, step: 0.05 });
      c.addEventListener('input', () => {
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
  } else if (layer.fill.kind === 'flower-seal') {
    const punch = addCtrl('punch out', 'select', layer.fill.punch ? 'on' : 'off', { options: ['off', 'on'] });
    punch.addEventListener('change', () => { layer.fill.punch = punch.value === 'on'; onChange(); });
    const pet = addCtrl('petals', 'number', layer.fill.petals ?? 5, { min: 3, max: 12, step: 1 });
    pet.addEventListener('input', () => { layer.fill.petals = Number(pet.value) | 0; onChange(); });
    const ss = addCtrl('seal size (× cell)', 'number', layer.fill.sealSize ?? 0.95, { min: 0.2, max: 1.2, step: 0.05 });
    ss.addEventListener('input', () => { layer.fill.sealSize = Number(ss.value); onChange(); });
    const ps = addCtrl('petal size (× seal)', 'number', layer.fill.petalSize ?? 0.32, { min: 0.1, max: 0.6, step: 0.02 });
    ps.addEventListener('input', () => { layer.fill.petalSize = Number(ps.value); onChange(); });
    const po = addCtrl('petal offset (× seal)', 'number', layer.fill.petalOffset ?? 0.55, { min: 0.2, max: 0.9, step: 0.02 });
    po.addEventListener('input', () => { layer.fill.petalOffset = Number(po.value); onChange(); });
    const cs = addCtrl('center size (× seal)', 'number', layer.fill.centerSize ?? 0.45, { min: 0, max: 0.8, step: 0.02 });
    cs.addEventListener('input', () => { layer.fill.centerSize = Number(cs.value); onChange(); });
    const ds = addCtrl('dot size (× seal)', 'number', layer.fill.dotSize ?? 0.18, { min: 0, max: 0.5, step: 0.02 });
    ds.addEventListener('input', () => { layer.fill.dotSize = Number(ds.value); onChange(); });
  } else if (layer.fill.kind === 'bloom') {
    const bk = addCtrl('bloom', 'select', layer.fill.bloom || 'circle', { options: ['circle', 'polygon', 'star'] });
    bk.addEventListener('change', () => { layer.fill.bloom = bk.value; onChange(); rebuild(); });
    const stems = addCtrl('stems', 'number', layer.fill.stems ?? 4, { min: 1, max: 9, step: 1 });
    stems.addEventListener('input', () => { layer.fill.stems = Number(stems.value) | 0; onChange(); });
    const spread = addCtrl('spread°', 'number', layer.fill.spread ?? 48, { min: 0, max: 180, step: 2 });
    spread.addEventListener('input', () => { layer.fill.spread = Number(spread.value); onChange(); });
    const aj = addCtrl('angle jitter ±°', 'number', layer.fill.angleJitter ?? 0, { min: 0, max: 45, step: 1 });
    aj.addEventListener('input', () => { layer.fill.angleJitter = Number(aj.value); onChange(); });
    const bs = addCtrl('bloom size (× cell)', 'number', layer.fill.bloomSize ?? 0.16, { min: 0.02, max: 0.5, step: 0.01 });
    bs.addEventListener('input', () => { layer.fill.bloomSize = Number(bs.value); onChange(); });
    if (layer.fill.bloom !== 'circle') {
      const p = addCtrl('points', 'number', layer.fill.points ?? 5, { min: 3, max: 12, step: 1 });
      p.addEventListener('input', () => { layer.fill.points = Number(p.value) | 0; onChange(); });
    }
    const rnd = addCtrl('corner round', 'number', layer.fill.round ?? 0.5, { min: 0, max: 1, step: 0.05 });
    rnd.addEventListener('input', () => { layer.fill.round = Number(rnd.value); onChange(); });
    const dst = addCtrl('distort', 'number', layer.fill.distort ?? 0.15, { min: 0, max: 0.6, step: 0.02 });
    dst.addEventListener('input', () => { layer.fill.distort = Number(dst.value); onChange(); });
    const sw = addCtrl('stem width (× cell)', 'number', layer.fill.stemWidth ?? 0.012, { min: 0.002, max: 0.05, step: 0.002 });
    sw.addEventListener('input', () => { layer.fill.stemWidth = Number(sw.value); onChange(); });
    const ld = addCtrl('leaf density', 'number', layer.fill.leafDensity ?? 0, { min: 0, max: 1, step: 0.05 });
    ld.addEventListener('input', () => { layer.fill.leafDensity = Number(ld.value); onChange(); rebuild(); });
    if ((layer.fill.leafDensity ?? 0) > 0) {
      const ls = addCtrl('leaf size (× cell)', 'number', layer.fill.leafSize ?? 0.1, { min: 0.02, max: 0.3, step: 0.01 });
      ls.addEventListener('input', () => { layer.fill.leafSize = Number(ls.value); onChange(); });
    }
    addColorCtrl('stem color', layer.fill.stemColor || '#454545', (v) => { layer.fill.stemColor = v; onChange(); });
  } else if (layer.fill.kind === 'voronoi') {
    const jit = addCtrl('jitter (× cell)', 'number', layer.fill.jitter ?? 0.4, { min: 0, max: 0.5, step: 0.02 });
    jit.addEventListener('input', () => { layer.fill.jitter = Number(jit.value); onChange(); });
    const gap = addCtrl('gap (× cell)', 'number', layer.fill.gap ?? 0.08, { min: 0, max: 0.5, step: 0.01 });
    gap.addEventListener('input', () => { layer.fill.gap = Number(gap.value); onChange(); });
    const rnd = addCtrl('corner round', 'number', layer.fill.round ?? 0.5, { min: 0, max: 1, step: 0.05 });
    rnd.addEventListener('input', () => { layer.fill.round = Number(rnd.value); onChange(); });
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#d8c79c', (v) => { layer.fill.color = v; onChange(); });
    }
  } else if (layer.fill.kind === 'maze') {
    addColorCtrl('color', layer.fill.color || '#2c3340', (v) => { layer.fill.color = v; onChange(); });
    const th = addCtrl('thickness (× cell)', 'number', layer.fill.thickness ?? 0.18, { min: 0.02, max: 0.5, step: 0.01 });
    th.addEventListener('input', () => { layer.fill.thickness = Number(th.value); onChange(); });
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
  const aspect    = document.getElementById('girard-aspect');
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
    for (const name of Object.keys(SAMPLES).sort((a, b) => a.localeCompare(b))) {
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

  aspect.addEventListener('input', () => {
    pattern.aspect = Math.max(0.2, Number(aspect.value) || 1);
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
    aspect.value = pattern.aspect ?? 1;
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
