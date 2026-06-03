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

// Deterministic per-cell PRNG. Hashes (col, row, salt, extra) so the
// same cell reproduces under a fixed seed and wrapped cells (col/row
// out of range) match their in-range twins via the caller's mod.
function cellRng(col, row, salt, extra = 0) {
  return makeRng(((((col * 73856093) ^ (row * 19349663) ^ (salt >>> 0) ^ (extra * 0x9E3779B1)) >>> 0) || 1));
}

// Shade a #rrggbb colour toward white (amt > 0) or black (amt < 0),
// |amt| in 0..1. Non-hex input is returned unchanged.
function shadeHex(hex, amt) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const mix = (ch) => {
    const t = amt < 0 ? 0 : 255;
    return Math.round(ch + (t - ch) * Math.abs(amt));
  };
  const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Pick a random palette entry.
function randColor(rng, palette) {
  return palette[Math.floor(rng() * palette.length)];
}

// Build stroke attributes when width > 0; width is a fraction of dim.
function strokeAttrs(color, widthFrac, dim, fallback = '#000000') {
  if (!(widthFrac > 0)) return {};
  return { stroke: color || fallback, 'stroke-width': widthFrac * dim, 'stroke-linejoin': 'round' };
}

// Whole-layer generators (mesh / triangles / voronoi / maze) all need
// the layer's pixel rect, per-cell dims, and salt. Returns null if the
// caller isn't at the (0,0) cell — they short-circuit then.
function layerGeom(col, row, cw, rh, nc, nr, layerBounds) {
  if (col !== 0 || row !== 0) return null;
  const lw = layerBounds?.w ?? cw * nc;
  const lh = layerBounds?.h ?? rh * nr;
  const ox = layerBounds?.x ?? 0;
  const oy = layerBounds?.y ?? 0;
  return {
    lw, lh, ox, oy,
    cellW: lw / nc, cellH: lh / nr,
    salt: layerBounds?.salt ?? 1,
  };
}

// Paint `fn` at the cell centre and at the 8 layer-canvas wrap
// offsets — anything spilling past an edge appears on the opposite
// edge so shapes tile cleanly.
function drawWrapped(parent, lw, lh, fn) {
  if (!lw || !lh) { fn(parent, 0, 0); return; }
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) fn(parent, dx * lw, dy * lh);
  }
}

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
// Repeat a colour n times — handy for building striped warp / weft
// thread sequences for the weave samples.
const band = (c, n) => Array(n).fill(c);

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
    // Cream ground; horizontal orange bars stacked in vertical columns.
    // gutterY 0.5 makes each bar exactly half its cell, so bar = gap;
    // an alternate-column half-drop offsets neighbours by half a period
    // — so every orange bar lines up with a white gap next door and the
    // negative space is congruent to the positive. gutterX leaves thin
    // white channels between the columns.
    palette: ['#e0954a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3eedd', mode: 'fixed' },
      },
      {
        grid: {
          cols: 6, rows: 16,
          offset: { x: 0, y: 0.5 }, offsetMode: 'alternate-col',
        },
        fill: { kind: 'firecracker', color: '#e0954a', fuse: 0.08, barWidth: 0.5, barLen: 0.4 },
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
  'One Way (solid)': {
    // Cream ground; a grid of right-triangles, all the same
    // orientation ("one way"), scattered with position + scale
    // jitter. Solid tan fill.
    palette: ['#d49a6a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f5efe1', mode: 'fixed' },
      },
      {
        grid: { cols: 6, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'shape', shape: { kind: 'right-triangle', size: 0.85 }, mode: 'fixed', color: '#d49a6a' },
        vary: {
          scale:  { type: 'random', min: 0.55, max: 1.05 },
          jitter: { type: 'random', min: -0.28, max: 0.28 },
        },
      },
    ],
  },
  'One Way (outline)': {
    // Same scatter, but the triangles are transparent with a thick
    // green outline.
    palette: ['#6cb24a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f0efe7', mode: 'fixed' },
      },
      {
        grid: { cols: 6, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: { kind: 'right-triangle', size: 0.85, strokeWidth: 0.045, stroke: '#6cb24a' },
          mode: 'fixed', color: 'transparent',
        },
        vary: {
          scale:  { type: 'random', min: 0.55, max: 1.05 },
          jitter: { type: 'random', min: -0.28, max: 0.28 },
        },
      },
    ],
  },
  'Manhattan': {
    // Girard "Manhattan" (1958): blueprint-blue ground scattered with
    // small white "buildings" — bars, dotted grids, solid blocks,
    // checkers and single pixels on a fine sub-lattice. A coarse plot
    // grid with most plots left empty gives the loose city-from-above
    // scatter. Roll the seed for a new skyline.
    palette: ['#ffffff'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#2f5aa8', mode: 'fixed' },
      },
      {
        grid: { cols: 12, rows: 9, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'manhattan', mode: 'fixed', color: '#ffffff', density: 0.66, pixel: 0.16 },
      },
    ],
  },
  'Treads': {
    // Girard "Treads": like Extrusions but the glyphs are grouped into
    // vertical bands — diamonds, cups, dashes, I-beams, blocks — light
    // pink on a coral-red ground.
    palette: ['#f4bdb5'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#e0564f', mode: 'fixed' },
      },
      {
        grid: { cols: 10, rows: 13, offset: { x: 0, y: 0 }, offsetMode: 'none', gutterX: 0.12, gutterY: 0.14 },
        fill: {
          kind: 'glyph', weight: 0.2,
          inks: ['#f4bdb5'],
          columns: ['diamond', 'ubar', 'ubar', 'vdash', 'vdash', 'ibeam', 'ibeam', 'block', 'block', 'diamond'],
        },
      },
    ],
  },
  'Palio': {
    // Girard "Palio": a sampler of self-complementary stripe bands — each
    // a different boundary profile (Flame, Square Comb, Crown, Checker,
    // Drop, Spear, Angle, Goo) where the white negative space is the
    // colour shape inverted. One comb layer renders all eight bands.
    palette: ['#c0413c'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f1ece0', mode: 'fixed' },
      },
      {
        grid: { cols: 8, rows: 1, gutterX: 0.14, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'comb',
          profiles: ['flame', 'square', 'crown', 'checker', 'round', 'triangle', 'angle', 'round'],
          colors: ['#c0413c', '#4a6fb0', '#e8b53f', '#2c3340', '#e07a4e', '#c2a878', '#7a6cb0', '#4a9e78'],
          teeth: [14, 16, 11, 8, 13, 18, 11, 9],
          amp: [0.34, 0.28, 0.34, 0, 0.4, 0.38, 0, 0.42],
        },
      },
    ],
  },
  'Extrusions': {
    // Girard "Extrusions": I-beams, plusses and brackets in navy and
    // white scattered on a grey ground — the glyph fill in two-tone
    // (inks) mode, restricted to those forms.
    palette: ['#2b3242'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#9a9ca0', mode: 'fixed' },
      },
      {
        grid: { cols: 8, rows: 10, offset: { x: 0, y: 0 }, offsetMode: 'none', gutterX: 0.26, gutterY: 0.26 },
        fill: {
          kind: 'glyph', weight: 0.22,
          inks: ['#2b3242', '#f1eee4'],
          glyphs: ['ibeam', 'hbeam', 'plus', 'lbracket', 'rbracket'],
        },
      },
    ],
  },
  'Menu': {
    // Girard L'Etoile menu (1966): a modular black-and-white
    // "geometric alphabet" — each cell a bar-built glyph or a ring /
    // disc, tiles randomly inverted. Roll the seed for a new layout.
    palette: ['#21242b'],
    layers: [
      {
        grid: { cols: 6, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'glyph', ink: '#21242b', paper: '#f3ede0', invert: 0.5, weight: 0.22 },
      },
    ],
  },
  'Alphabet': {
    // Girard "Alphabet": rows of big bold condensed letters and numbers
    // in charcoal on linen. Each cell shows the next glyph from a flat
    // 9×4 sequence (palette-cycle indexes col + row*cols). Uses the
    // Google font "Anton" (loaded on demand).
    palette: ['#2f3239'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#cabfa8', mode: 'fixed' },
      },
      {
        grid: { cols: 9, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: {
            kind: 'text', size: 1.15,
            fontFamily: 'Anton', fontWeight: '400', fontStyle: 'normal',
            text: [
              '2', 'V', '5', 'L', 'R', '3', 'M', 'O', 'T',
              'J', '8', 'N', 'C', '&', 'F', 'S', 'P', 'B',
              '4', 'E', 'I', 'Z', 'Q', '1', 'W', 'A', 'H',
              'D', 'X', '9', 'C', 'K', 'U', 'Y', '6', '7',
            ],
          },
          mode: 'palette-cycle',
        },
      },
    ],
  },
  'Fruit': {
    // The "Fruit Tree" fruits without the tree: a scatter of stalked
    // mid-century fruit shapes in warm colours with the odd leaf, on a
    // half-drop grid over cream.
    palette: ['#e0463a', '#ef7d2e', '#f3c11f', '#d9a72a', '#d24a8e', '#e85a2a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#faf6ec', mode: 'fixed' },
      },
      {
        grid: { cols: 6, rows: 7, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'fruit', mode: 'random', density: 0.78, size: 1, leafChance: 0.28, stalk: '#4f4a22', leaf: '#7d9a40' },
      },
    ],
  },
  'Plusses': {
    // Girard "Plusses": a half-drop grid of rust plus signs on cream.
    palette: ['#bf6b32'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#ece7d8', mode: 'fixed' },
      },
      {
        grid: { cols: 9, rows: 11, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: {
          kind: 'shape', shape: { kind: 'plus', size: 0.62, arm: 0.34 },
          mode: 'fixed', color: '#bf6b32',
        },
      },
    ],
  },
  'Giant Rectangles': {
    // Girard "Giant Rectangles": big warm colour blocks in staggered
    // columns, separated by thin cream grout (a small gutter on every
    // side). Varied row weights + an alternate-column offset keep the
    // block boundaries from lining up across columns.
    palette: ['#e0584a', '#d24d86', '#dd86b0', '#ee8a5a', '#9a5a8e', '#e36a52'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#efe7d6', mode: 'fixed' },
      },
      {
        grid: {
          cols: 3, rows: 4, rowWeights: [2, 5, 3, 4],
          gutterX: 0.035, gutterY: 0.045,
          offset: { x: 0, y: 0.22 }, offsetMode: 'alternate-col',
        },
        fill: { kind: 'solid', mode: 'random' },
      },
    ],
  },
  'Feathers': {
    // Girard "Feathers": diamonds — rounded on the sides, sharp top and
    // bottom (the onion shape) — on a grid, sized to OVERLAP their
    // neighbours, drawn on a multiply blend. Where the translucent
    // shapes cross, the colour deepens (the darker cores and ikat
    // seams); small white diamonds remain at the interstices.
    palette: ['#e0463a', '#ee7a3a', '#d24a7e', '#bf3a72', '#e85a44', '#d8395a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#fbf8f1', mode: 'fixed' },
      },
      {
        grid: { cols: 7, rows: 8, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        blendMode: 'multiply',
        blendPerCell: true,
        opacity: 0.9,
        fill: {
          kind: 'shape', shape: { kind: 'onion', size: 1.9, ratio: 1.12, bulge: 0.55 },
          mode: 'cell',
        },
      },
    ],
  },
  'Mexigrid': {
    // Girard "Mexigrid": yellow vertical stripes and sparser coral
    // horizontal stripes on warm linen — a loose window-pane plaid.
    palette: ['#e8b04a', '#ee8a76'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#efe8d4', mode: 'fixed' },
      },
      {
        grid: {
          cols: 4, rows: 1,
          colWeights: [10, 1, 10, 1],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['transparent', '#e8b04a', 'transparent', '#e8b04a'],
      },
      {
        grid: {
          cols: 1, rows: 2,
          rowWeights: [22, 1],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['transparent', '#ee8a76'],
      },
    ],
  },
  'Mexidot': {
    // Girard "Mexidot": olive vertical stripes alternating with white
    // bands filled by a column of stacked blue horizontal dashes, thin
    // white gaps between. Aligned colWeights on both layers.
    palette: ['#6d80c2'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#ece7d6', mode: 'fixed' },
      },
      {
        grid: {
          cols: 4, rows: 1, colWeights: [1.3, 0.3, 3.4, 0.3],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['#979a51', 'transparent', 'transparent', 'transparent'],
      },
      {
        grid: {
          cols: 4, rows: 22, colWeights: [1.3, 0.3, 3.4, 0.3],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: {
          kind: 'glyph', weight: 0.5,
          inks: ['#6d80c2'],
          columns: ['blank', 'blank', 'hdash', 'blank'],
        },
      },
    ],
  },
  'Miller Stripe': {
    // Girard "Miller Stripe": a blue-violet ground with a clustered group
    // of thin red / cream vertical stripes, wide purple between. Solid
    // vertical bands sized by colWeights.
    palette: ['#585a93', '#c0494e', '#e8e2d4', '#c0494e', '#e8e2d4', '#c0494e', '#e8e2d4', '#c0494e'],
    layers: [
      {
        grid: {
          cols: 8, rows: 1,
          // big blue field, then 2-1-1-1-4-3-3 alternating red / cream.
          colWeights: [18, 2, 1, 1, 1, 4, 3, 3],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['#585a93', '#c0494e', '#e8e2d4', '#c0494e', '#e8e2d4', '#c0494e', '#e8e2d4', '#c0494e'],
      },
    ],
  },
  'Linomix': {
    // Girard "Linomix": a warp-faced weave of many narrow colour stripes
    // (orange, green, pink, red, blue, magenta, navy, brown) on a cream
    // weft, which speckles through as the little woven dashes.
    palette: ['#e8902f', '#5fa86a', '#e87fa0', '#d2503f', '#6fb0d8', '#b03a6a', '#3a3f5c', '#9c6b4a'],
    layers: [
      {
        grid: { cols: 36, rows: 24, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'weave', face: 'warp', gap: 0.06, round: 0.2, noise: 0.12,
          warp: [
            ...band('#9c6b4a', 2), ...band('#e9e0c8', 1), ...band('#e8902f', 2), ...band('#e9e0c8', 1),
            ...band('#3a3f5c', 2), ...band('#e9e0c8', 1), ...band('#5fa86a', 1), ...band('#e9e0c8', 1),
            ...band('#e87fa0', 2), ...band('#e9e0c8', 1), ...band('#d2503f', 2), ...band('#e9e0c8', 2),
            ...band('#e87fa0', 1), ...band('#e9e0c8', 1), ...band('#6fb0d8', 2), ...band('#e9e0c8', 1),
            ...band('#3a3f5c', 2), ...band('#e9e0c8', 1), ...band('#b03a6a', 1), ...band('#e9e0c8', 1),
            ...band('#9c6b4a', 2), ...band('#e9e0c8', 1), ...band('#6fb0d8', 1), ...band('#e9e0c8', 1),
            ...band('#e8902f', 1), ...band('#5fa86a', 1), ...band('#e9e0c8', 1),
          ],
          weft: ['#e9e0c8'],
        },
      },
    ],
  },
  'Jax': {
    // Girard "Jax": a tiny ditsy of green four-dot clovers on a dusty
    // pink linen ground, set on a dense half-drop grid.
    palette: ['#3f9956'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#dcc7c0', mode: 'fixed' },
      },
      {
        grid: { cols: 14, rows: 18, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: {
          kind: 'shape',
          shape: { kind: 'jacks', size: 0.95, dot: 0.17, spread: 0.3, bar: 0.09 },
          mode: 'fixed', color: '#3f9956',
        },
      },
    ],
  },
  'Superstripe': {
    // Girard "Superstripe": tall columns of stacked colour blocks with
    // wide white channels between them. A big horizontal gutter makes
    // the columns; varied row weights give blocks of different heights;
    // an alternate-column vertical offset destaggers the stacks. Sparse
    // white squares and diamonds accent some blocks.
    palette: ['#c8402e', '#d2592f', '#5e7ea8', '#6f757b', '#e08a2e', '#d6a878'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f4f1e8', mode: 'fixed' },
      },
      {
        grid: {
          cols: 4, rows: 8, rowWeights: [3, 5, 2, 6, 3, 5, 2, 4],
          gutterX: 0.5, gutterY: 0,
          offset: { x: 0, y: 0.45 }, offsetMode: 'alternate-col',
        },
        fill: { kind: 'solid', mode: 'random' },
      },
      {
        grid: {
          cols: 4, rows: 8, rowWeights: [3, 5, 2, 6, 3, 5, 2, 4],
          gutterX: 0.5, gutterY: 0,
          offset: { x: 0, y: 0.45 }, offsetMode: 'alternate-col',
        },
        fill: { kind: 'shape', shape: { kind: 'square', size: 0.34 }, mode: 'fixed', color: '#f4f1e8', density: 0.16 },
      },
      {
        grid: {
          cols: 4, rows: 8, rowWeights: [3, 5, 2, 6, 3, 5, 2, 4],
          gutterX: 0.5, gutterY: 0,
          offset: { x: 0, y: 0.45 }, offsetMode: 'alternate-col',
        },
        fill: { kind: 'shape', shape: { kind: 'diamond', size: 0.42, rings: 1 }, mode: 'fixed', color: '#f4f1e8', density: 0.12 },
        palette: ['#f4f1e8'],
      },
    ],
  },
  'Multiform': {
    // Girard "Multiform": a dense sampler scatter of the whole shape
    // vocabulary — flowers, circles, squares, diamonds, lenses, stars,
    // barbells, crosses, dot-grids — in a soft folk palette on white.
    palette: ['#6f8f3f', '#3a4a63', '#3f7fc0', '#f0b53a', '#e0768f', '#b69a82', '#9aa0a0'],
    layers: [
      {
        grid: { cols: 9, rows: 12, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'multiform', density: 0.82 },
      },
    ],
  },
  'Rain': {
    // Girard "Rain": a loose collage of translucent colour blocks with
    // up-pointing triangles scattered over them, all on a multiply
    // blend so the overlaps deepen into maroon and aubergine — like the
    // layered semi-sheer cotton of the original. White ground.
    palette: ['#e0473a', '#ef7d3a', '#4a78b8', '#3f3a8e', '#e07a93'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f6f3ec', mode: 'fixed' },
      },
      {
        // Blocks: kept fairly steady so their bottom edge is a
        // predictable anchor for the triangles below.
        grid: {
          cols: 3, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none',
          gutterX: 0.1, gutterY: 0.34,
        },
        blendMode: 'multiply', opacity: 0.85,
        fill: { kind: 'solid', mode: 'cell', density: 0.72 },
        vary: {
          scale:  { type: 'random', min: 0.82, max: 1.05 },
          jitter: { type: 'random', min: -0.05, max: 0.05 },
        },
      },
      {
        // Cut-outs: paper triangles, opaque, anchored to bite into the
        // block's bottom edge (offsetY straddles it) — they knock a
        // white triangle out of the block.
        grid: { cols: 3, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: { kind: 'triangle', size: 0.5, offsetX: -0.16, offsetY: 0.28 },
          mode: 'fixed', color: '#f6f3ec', density: 0.42,
        },
        vary: {
          scale:  { type: 'random', min: 0.8, max: 1.1 },
          rotate: { type: 'random', min: -6, max: 6 },
        },
      },
      {
        // Colour triangles: anchored to straddle the block's bottom
        // edge (top half over the block, point hanging below) — the
        // pendant motif. offsetY keeps them crossing the edge, never
        // fully inside or outside. Same grid as the blocks.
        grid: { cols: 3, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        blendMode: 'multiply', opacity: 0.85,
        fill: {
          kind: 'shape',
          shape: { kind: 'triangle', size: 0.74, offsetX: 0.12, offsetY: 0.34 },
          mode: 'cell', density: 0.7,
        },
        vary: {
          scale:  { type: 'random', min: 0.78, max: 1.12 },
          rotate: { type: 'random', min: -9, max: 9 },
        },
      },
    ],
  },
  'Mikado': {
    // Girard "Mikado": a red / pink checkerboard, each square holding a
    // scalloped daisy (white on red, pink on pink — a checker offset
    // from the ground) with a little yellow square at its heart.
    palette: ['#e04b3f', '#e88aa4'],
    layers: [
      {
        grid: { cols: 4, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', mode: 'checker' },
        palette: ['#e04b3f', '#e88aa4'],
      },
      {
        grid: { cols: 4, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: { kind: 'flower', size: 1.05, petals: 16, center: true, centerSize: 0.13, centerColor: '#f2b933' },
          mode: 'checker',
        },
        palette: ['#f6f1e7', '#f4b8c9'],
      },
    ],
  },
  'Jacobs Coat': {
    // Girard "Jacobs Coat": a warp-faced weave of many-coloured vertical
    // stripes (pink, blue, orange, navy, maroon, coral) with a dark weft
    // speckling horizontal woven texture into every band.
    palette: ['#e0728c', '#2f6fb0', '#ef8f3a', '#27314f', '#9c3b3f', '#e2574c'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#2a2030', mode: 'fixed' },
      },
      {
        grid: { cols: 39, rows: 18, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'weave', face: 'warp', gap: 0.0, round: 0.12, noise: 0.05, weftShade: 0.28,
          warp: [
            ...band('#e0728c', 5), ...band('#27314f', 2), ...band('#2f6fb0', 6),
            ...band('#ef8f3a', 3), ...band('#27314f', 2), ...band('#ef8f3a', 4),
            ...band('#9c3b3f', 3), ...band('#ef8f3a', 3), ...band('#27314f', 2),
            ...band('#e2574c', 4), ...band('#27314f', 2), ...band('#ef8f3a', 3),
          ],
        },
      },
    ],
  },
  'Broken Lines': {
    // Girard "Broken Lines": thick dark dashes on linen, each tilted per
    // column so adjacent columns lean opposite ways — the Graph idea but
    // with the lines broken into separate bars. Some columns sit flat.
    palette: ['#3a4150'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#cdc2ac', mode: 'fixed' },
      },
      {
        grid: { cols: 8, rows: 10, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'graph', broken: true, stroke: '#3a4150',
          barWidth: 0.32, margin: 0.08,
          // node heights run flat then step: horizontal dashes at high /
          // low, joined by tilted ones → lines break up and down.
          offsets: [0.32, 0.32, 0.68, 0.68, 0.5, 0.5, 0.32, 0.68],
        },
      },
    ],
  },
  'Graph': {
    // Girard "Graph": thin olive line-art — vertical dividers, ladder
    // grids and stacked chevron arrows in vertical bands, on off-white.
    palette: ['#8a9a4a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#eef0ea', mode: 'fixed' },
      },
      {
        grid: { cols: 12, rows: 12, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'graph', stroke: '#8a9a4a', strokeWidth: 0.012,
          // flat grid, then a zigzag band of chevrons, flat, chevrons.
          offsets: [0, 0, 0.6, 0, 0.6, 0, 0, 0, 0.6, 0, 0.6, 0],
        },
      },
    ],
  },
  'Hexagons': {
    // Girard "Hexagons": a thin blue honeycomb outline on linen.
    palette: ['#3a4aa0'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#e7e3d6', mode: 'fixed' },
      },
      {
        grid: { cols: 4, rows: 4, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'honeycomb', stroke: '#3a4aa0', strokeWidth: 0.03 },
      },
    ],
  },
  'Lines': {
    // Girard "Lines": a field of short vertical strokes of varied length,
    // a redder orange marking on an orange ground — a loose barcode.
    palette: ['#e8533a', '#d8492f'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f0913f', mode: 'fixed' },
      },
      {
        grid: { cols: 90, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'dashes', mode: 'random', density: 0.46, width: 0.55 },
      },
    ],
  },
  'Pepitas': {
    // Girard "Pepitas": orange pointed ovals (pumpkin seeds) in an
    // offset brick grid on a soft linen ground, with light size jitter.
    palette: ['#d98a3d'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#ddd6c4', mode: 'fixed' },
      },
      {
        grid: { cols: 7, rows: 9, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: {
          kind: 'shape',
          shape: { kind: 'lens', size: 0.95, ratio: 0.5 },
          mode: 'fixed', color: '#d98a3d',
        },
        vary: { scale: { type: 'random', min: 0.82, max: 1.12 } },
      },
    ],
  },
  'Double Triangles': {
    // Girard "Double Triangles": a vertical-strip triangle tessellation
    // in a single green, the linen ground showing through as thick white
    // grout lines (a fat white stroke on every triangle).
    palette: ['#6f8f4e'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#efe9da', mode: 'fixed' },
      },
      {
        grid: { cols: 7, rows: 6, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'triangles', mode: 'fixed', orient: 'vertical',
          color: '#6f8f4e', stroke: '#efe9da', strokeWidth: 0.06,
        },
      },
    ],
  },
  'Circles': {
    // Girard "Circles": a dense grid of large dots, nearly touching,
    // randomly red / royal blue / navy on a warm cream ground.
    palette: ['#d34b42', '#3f4f9e', '#1f2535'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#efe9da', mode: 'fixed' },
      },
      {
        grid: { cols: 9, rows: 11, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: { kind: 'circle', size: 0.92 },
          mode: 'random',
        },
      },
    ],
  },
  'Small Squares': {
    // Girard "Small Squares" (1952): little squares scattered on white,
    // each a random pick from a cool palette (purple, indigo, teal,
    // green, grey). A density below 1 leaves cells empty; light position
    // and size jitter loosens the grid.
    palette: ['#5b3a9e', '#3f4ea8', '#2aa3c0', '#4caf63', '#9a9a9a', '#5f5f66'],
    layers: [
      {
        grid: { cols: 12, rows: 15, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'shape',
          shape: { kind: 'square', size: 0.62 },
          mode: 'random',
          density: 0.5,
        },
        vary: {
          scale:  { type: 'random', min: 0.82, max: 1.12 },
          jitter: { type: 'random', min: -0.16, max: 0.16 },
        },
      },
    ],
  },
  'Lincheck': {
    // Girard "Lincheck": a windowpane check on white linen — faint
    // plain vertical lines and prominent horizontal cross-stitch bands
    // (little X's) on a softly textured ground.
    palette: ['#9aa0a6'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3f2ec', mode: 'fixed' },
      },
      {
        grid: { cols: 7, rows: 8, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'windowpane',
          vColor: '#b7bbc0', hColor: '#9aa0a6',
          vWidth: 0.016, hWidth: 0.018, amp: 0.04, jitter: 0.18,
        },
      },
    ],
  },
  'Lattice': {
    // Girard "Lattice": a fine gingham — the same blue / linen thread
    // sequence on warp and weft. Wide blue bands cross into solid slate
    // squares, with a single light thread channel between them.
    palette: ['#41505f', '#d2cab4'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#d2cab4', mode: 'fixed' },
      },
      {
        grid: { cols: 22, rows: 28, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'weave', gap: 0.3, round: 0.16, noise: 0.1,
          warp: ['#41505f'], weft: ['#41505f'],
        },
      },
    ],
  },
  'Jutestripe': {
    // Girard "Jutestripe": a plain weave whose vertical warp threads
    // are striped (navy / cream / tan) crossing a natural light weft.
    // Inside each stripe the weft shows through on alternate crossings,
    // giving the speckled woven texture.
    palette: ['#2c303a', '#e8dec3', '#c2a878'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#1d2027', mode: 'fixed' },
      },
      {
        grid: { cols: 30, rows: 18, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'weave', face: 'warp', gap: 0.08, round: 0.28, noise: 0.13,
          warp: [
            ...band('#2c303a', 7), ...band('#e8dec3', 4), ...band('#c2a878', 4),
            ...band('#2c303a', 7), ...band('#c2a878', 4), ...band('#e8dec3', 4),
          ],
          weft: ['#c2a878', '#e8dec3'],
        },
      },
    ],
  },
  'Juteplaid': {
    // Girard "Juteplaid": the same striped sequence on BOTH warp and
    // weft, so the bands cross into a tartan — solid blocks where two
    // like colours meet, woven checks where they differ.
    palette: ['#2c303a', '#c2a878', '#e8dec3'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#1d2027', mode: 'fixed' },
      },
      {
        grid: { cols: 14, rows: 14, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: {
          kind: 'weave', gap: 0.08, round: 0.28, noise: 0.13,
          warp: [
            ...band('#2c303a', 5), ...band('#c2a878', 4),
            ...band('#e8dec3', 2), ...band('#c2a878', 3),
          ],
          weft: [
            ...band('#2c303a', 5), ...band('#c2a878', 4),
            ...band('#e8dec3', 2), ...band('#c2a878', 3),
          ],
        },
      },
    ],
  },
  'Twigs': {
    // Girard "Twigs": a field of little L-system twigs — bending stems
    // with feather-fan branches and a Y-fork on top, in mixed brown and
    // blue on a warm cream ground. Roll the seed for a fresh thicket.
    palette: ['#9c7350', '#8298ad'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#efe7d3', mode: 'fixed' },
      },
      {
        grid: { cols: 5, rows: 3, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'twigs', thickness: 0.045, height: 0.98, twig: 1.0 },
      },
    ],
  },
  'Stones': {
    // Girard "Stones": cream rounded "tiles" of varied size and slight
    // jitter on a dark slate ground. Roll the seed for a new layout.
    palette: ['#efe9dc'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#3a4453', mode: 'fixed' },
      },
      {
        grid: { cols: 3, rows: 4, offset: { x: 0.3, y: 0 }, offsetMode: 'alternate-row' },
        fill: { kind: 'stones', color: '#efe9dc', gap: 0.06, round: 0.75, jitter: 0.04, sizeJitter: 0.18, roundJitter: 0.35 },
      },
    ],
  },
  'Pinwheel': {
    // Girard "Pinwheel": 2×2 blocks of half-square triangles spiral
    // into pinwheels on a cream ground, blocks alternating red / green
    // in a checker. cols/rows are multiples of 4 so it tiles cleanly.
    palette: ['#cf4b3e', '#5fae6b'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3ede0', mode: 'fixed' },
      },
      {
        grid: { cols: 8, rows: 8, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'pinwheel' },
      },
    ],
  },
  'Shower': {
    // Girard "Shower" (1958): tall tapered streaks (wide at top,
    // narrow at the bottom) scattered on a warm cream ground, each
    // a random palette colour. Heavy scale jitter gives the mix of
    // long and short "drops"; positional jitter keeps the grid from
    // reading as a grid.
    palette: ['#c44a2e', '#d96a3a', '#e98a5b', '#efb5a0', '#3946a0', '#2bb3b8', '#7a3a2a'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#f3ede0', mode: 'fixed' },
      },
      {
        grid: { cols: 10, rows: 5, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: {
          kind: 'shape',
          shape: { kind: 'spike', size: 0.55, aspect: 3.2, taper: 0.25 },
          mode: 'random',
        },
        vary: {
          scale:  { type: 'random', min: 0.55, max: 1.25 },
          jitter: { type: 'random', min: -0.35, max: 0.35 },
        },
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
  'Ribbons': {
    // Girard "Ribbons" (1957): warm vertical stripes (gold, orange,
    // rose, magenta, red) of varied width, with broad translucent
    // horizontal ribbons woven across on a multiply blend — where the
    // two cross the colour deepens into crimson and purple, just like
    // the layered semi-sheer cotton of the original.
    palette: ['#f0a93f', '#ef7d3a', '#de7ba0', '#c76a9e', '#d6453f'],
    layers: [
      {
        grid: {
          cols: 11, rows: 1,
          colWeights: [5, 3, 6, 4, 3, 6, 4, 5, 3, 6, 4],
          offset: { x: 0, y: 0 }, offsetMode: 'none',
        },
        fill: { kind: 'solid', mode: 'palette-cycle' },
        palette: ['#f0a93f', '#ef7d3a', '#de7ba0', '#c76a9e', '#d6453f', '#ef8f6a'],
      },
      {
        grid: {
          cols: 3, rows: 4,
          colWeights: [4, 3, 4], rowWeights: [4, 3, 5, 3],
          offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row',
        },
        blendMode: 'multiply',
        opacity: 0.75,
        fill: { kind: 'solid', mode: 'random' },
        palette: ['transparent', 'transparent', '#c0394f', '#8e4f86', '#d6453f', 'transparent'],
        vary: {
          scale:  { type: 'random', min: 0.78, max: 1.18 },
          jitter: { type: 'random', min: -0.18, max: 0.18 },
        },
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
        || (l.fill?.kind === 'shape' && (paletteModes.includes(l.fill?.mode) || l.vary?.color?.type === 'palette' || paletteModes.includes(l.fill?.shape?.strokeMode)))
        || (l.fill?.kind === 'split')
        || (l.fill?.kind === 'arc-split')
        || (l.fill?.kind === 'arc-block')
        || (l.fill?.kind === 'mesh' && l.fill?.mode === 'palette-cycle')
        || (l.fill?.kind === 'triangles' && (l.fill?.mode === 'palette-cycle' || l.fill?.mode === 'random'))
        || (l.fill?.kind === 'voronoi' && (l.fill?.mode === 'palette-cycle' || l.fill?.mode === 'random'))
        || (l.fill?.kind === 'bloom')
        || (l.fill?.kind === 'flower-seal')
        || (l.fill?.kind === 'manhattan' && paletteModes.includes(l.fill?.mode))
        || (l.fill?.kind === 'pinwheel')
        || (l.fill?.kind === 'twigs')
        || (l.fill?.kind === 'dashes' && l.fill?.mode === 'random')
        || (l.fill?.kind === 'multiform')
        || (l.fill?.kind === 'fruit');
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
  const sAttrs = strokeAttrs(ctx?.stroke ?? shape.stroke, shape.strokeWidth, Math.min(cw, rh), '#000000');

  switch (shape.kind) {
    case 'circle':
      return el('circle', { r: dim / 2, fill, ...sAttrs });
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
        ...sAttrs,
      });
    case 'triangle': {
      const r = dim / 2;
      return el('polygon', {
        points: `0,${-r} ${r * 0.866},${r * 0.5} ${-r * 0.866},${r * 0.5}`,
        fill,
        ...sAttrs,
      });
    }
    case 'right-triangle': {
      // Right-isoceles triangle, right angle at top-left, hypotenuse
      // from top-right down to bottom-left. All instances share this
      // orientation (the "one way" look); rotate via vary if wanted.
      const r = dim / 2;
      return el('polygon', {
        points: `${-r},${-r} ${r},${-r} ${-r},${r}`,
        fill,
        ...sAttrs,
      });
    }
    case 'spike': {
      // Tapered trapezoid pointing down — wide at top, narrow at
      // bottom. Like a rain streak. size sets the top width
      // (× cell); aspect is height as a multiple of that width;
      // taper is the bottom width as a fraction of the top.
      const topW = dim;
      const h = topW * (shape.aspect ?? 4);
      const botW = topW * (shape.taper ?? 0.3);
      const tx = topW / 2, bx = botW / 2;
      const y0 = -h / 2, y1 = h / 2;
      return el('polygon', {
        points: `${-tx},${y0} ${tx},${y0} ${bx},${y1} ${-bx},${y1}`,
        fill,
        ...sAttrs,
      });
    }
    case 'blossom': {
      // A simple flower: n round petals in a ring with a centre dot.
      const g = el('g', {});
      const n = Math.max(4, shape.petals | 0 || 5);
      const pr = dim * (shape.petal ?? 0.26);
      const off = dim * (shape.spread ?? 0.3);
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n - Math.PI / 2;
        g.appendChild(el('circle', { cx: Math.cos(a) * off, cy: Math.sin(a) * off, r: pr, fill }));
      }
      g.appendChild(el('circle', { cx: 0, cy: 0, r: dim * (shape.centerSize ?? 0.13), fill: shape.centerColor || '#ffffff' }));
      return g;
    }
    case 'jacks': {
      // Four small dots joined by a thin cross (a clover / "jacks" pip).
      const g = el('g', {});
      const r = dim * (shape.dot ?? 0.17);
      const off = dim * (shape.spread ?? 0.3);
      const bw = dim * (shape.bar ?? 0.09);
      // Connecting cross through the centre, reaching the dots.
      g.appendChild(el('rect', { x: -bw / 2, y: -off, width: bw, height: off * 2, fill }));
      g.appendChild(el('rect', { x: -off, y: -bw / 2, width: off * 2, height: bw, fill }));
      for (const [dx, dy] of [[0, -off], [0, off], [-off, 0], [off, 0]]) {
        g.appendChild(el('circle', { cx: dx, cy: dy, r, fill, ...sAttrs }));
      }
      return g;
    }
    case 'barbell': {
      // A bar with a round knob at each end (vertical by default).
      const g = el('g', {});
      const len = dim, bw = dim * 0.13, kr = dim * 0.2;
      g.appendChild(el('rect', { x: -bw / 2, y: -len / 2, width: bw, height: len, fill, ...sAttrs }));
      g.appendChild(el('circle', { cx: 0, cy: -len / 2, r: kr, fill, ...sAttrs }));
      g.appendChild(el('circle', { cx: 0, cy: len / 2, r: kr, fill, ...sAttrs }));
      return g;
    }
    case 'plus': {
      // A plus sign: vertical and horizontal bars with square ends.
      const g = el('g', {});
      const L = dim, w = dim * (shape.arm ?? 0.34);
      g.appendChild(el('rect', { x: -w / 2, y: -L / 2, width: w, height: L, fill, ...sAttrs }));
      g.appendChild(el('rect', { x: -L / 2, y: -w / 2, width: L, height: w, fill, ...sAttrs }));
      return g;
    }
    case 'cross': {
      // Fat rounded X (two crossing capsules).
      const g = el('g', {});
      const L = dim, w = dim * 0.28;
      for (const a of [45, -45]) {
        g.appendChild(el('rect', {
          x: -L / 2, y: -w / 2, width: L, height: w, rx: w / 2, ry: w / 2,
          fill, transform: `rotate(${a})`, ...sAttrs,
        }));
      }
      return g;
    }
    case 'quadDots': {
      // 2×2 grid of little squares.
      const g = el('g', {});
      const sq = dim * 0.36, gap = dim * 0.12, o = (sq + gap) / 2;
      for (const px of [-o, o]) for (const py of [-o, o]) {
        g.appendChild(el('rect', { x: px - sq / 2, y: py - sq / 2, width: sq, height: sq, fill, ...sAttrs }));
      }
      return g;
    }
    case 'flower': {
      // Scalloped disc: a central circle ringed by overlapping bump
      // circles (same fill) that union into a daisy / cog edge, with an
      // optional small square at the centre (a different colour).
      const g = el('g', {});
      const n = Math.max(6, shape.petals | 0 || 16);
      const R = dim * 0.34;
      const pr = dim * 0.105;
      g.appendChild(el('circle', { r: R, fill, ...sAttrs }));
      for (let i = 0; i < n; i++) {
        const a = (2 * Math.PI * i) / n;
        g.appendChild(el('circle', { cx: Math.cos(a) * R, cy: Math.sin(a) * R, r: pr, fill }));
      }
      if (shape.center) {
        const cs = dim * (shape.centerSize ?? 0.14);
        g.appendChild(el('rect', {
          x: -cs / 2, y: -cs / 2, width: cs, height: cs,
          fill: shape.centerColor || '#f2b933',
        }));
      }
      return g;
    }
    case 'onion': {
      // Fat pointed oval ("feather"): sharp points top and bottom with a
      // bulging round body (cubic curves), much wider than the lens.
      const hy = dim / 2;
      const hx = hy * (shape.ratio ?? 1.0);
      const cy = hy * (shape.bulge ?? 0.62);
      return el('path', {
        d: `M 0,${-hy} C ${hx},${-cy} ${hx},${cy} 0,${hy} C ${-hx},${cy} ${-hx},${-cy} 0,${-hy} Z`,
        fill,
        ...sAttrs,
      });
    }
    case 'lens': {
      // Vesica / pointed oval ("pepita"). Two quadratic curves bulging
      // out from sharp points top and bottom. ratio = width / height.
      const hy = dim / 2;
      const hx = hy * (shape.ratio ?? 0.5);
      return el('path', {
        d: `M 0,${-hy} Q ${hx},0 0,${hy} Q ${-hx},0 0,${-hy} Z`,
        fill,
        ...sAttrs,
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
          fill, ...sAttrs,
        }));
      }
      if (centerScale > 0) {
        g.appendChild(el('circle', {
          cx: 0, cy: 0, r: r * centerScale,
          fill, ...sAttrs,
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
        ...sAttrs,
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
        ...sAttrs,
        ...((shape.strokeWidth ?? 0) > 0 ? { 'paint-order': 'stroke fill' } : {}),
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
  // blendPerCell: apply the blend (and opacity) to each drawn element
  // rather than the group, so the cells blend with EACH OTHER (and the
  // layers below), not just collectively against the backdrop. Used for
  // overlapping-shape effects like Feathers.
  const perCell = !!layer.blendPerCell;
  if (!perCell && (blend || op)) group.setAttribute('style', blend + op);
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

  // Apply per-cell blend / opacity to each drawn element so overlapping
  // cells multiply each other (not just the group against the backdrop).
  if (perCell && (blend || op)) {
    const kids = group.childNodes || group.children || [];
    for (let k = 0; k < kids.length; k++) {
      const c = kids[k];
      if (!c.setAttribute) continue;
      const prev = (c.getAttribute && c.getAttribute('style')) || '';
      c.setAttribute('style', prev + blend + op);
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
      // Optional sparseness (positional PRNG so it tiles): scatter the
      // blocks with gaps, like the shape fill's density.
      if (fill.density != null && fill.density < 1) {
        const dr = cellRng(ci, ri, (layerBounds?.salt ?? 1) ^ 0x5151);
        if (dr() > fill.density) break;
      }
      const color = (fill.mode === 'palette-cycle' || fill.mode === 'checker')
        ? palette[paletteIndex(fill.mode)]
        : fill.mode === 'random'
        ? palette[Math.floor(rng() * palette.length)]
        : fill.mode === 'cell'
        ? palette[Math.floor(cellRng(ci, ri, 0x9E37)() * palette.length)]
        : (fill.color || '#888');
      if (isTransparent(color)) break;
      // Optional per-cell jitter / scale — lets a "solid" layer break
      // its grid into a looser scatter of rectangles. jitter is
      // independent on x/y; scale is uniform per cell.
      let rx = ix, ry = iy, rw = iw, rh2 = ih;
      if (layer.vary?.scale || layer.vary?.jitter) {
        const s = layer.vary?.scale ? evalMod(layer.vary.scale, rng, col, row, 1) : 1;
        const jx = layer.vary?.jitter ? evalMod(layer.vary.jitter, rng, col, row, 0) * iw : 0;
        const jy = layer.vary?.jitter ? evalMod(layer.vary.jitter, rng, col, row, 0) * ih : 0;
        rw = iw * s; rh2 = ih * s;
        rx = ix + (iw - rw) / 2 + jx;
        ry = iy + (ih - rh2) / 2 + jy;
      }
      parent.appendChild(el('rect', {
        x: rx, y: ry, width: rw, height: rh2, fill: color,
      }));
      break;
    }
    case 'shape': {
      const shape = fill.shape || { kind: 'circle', size: 0.6 };
      // Optional sparseness: skip a fraction of cells (positional PRNG
      // so it tiles) for a scattered "some cells empty" look.
      if (fill.density != null && fill.density < 1) {
        const dr = cellRng(ci, ri, (layerBounds?.salt ?? 1) ^ 0x5151);
        if (dr() > fill.density) break;
      }
      // Base rotation applies to every instance; vary.rotate (when on)
      // adds a per-cell jitter on top.
      let s = 1, rot = (shape.rotate ?? 0), jx = 0, jy = 0;
      if (layer.vary?.scale)  s   = evalMod(layer.vary.scale,  rng, col, row, 1);
      if (layer.vary?.rotate) rot += evalMod(layer.vary.rotate, rng, col, row, 0);
      if (layer.vary?.jitter) {
        jx = evalMod(layer.vary.jitter, rng, col, row, 0) * iw;
        jy = evalMod(layer.vary.jitter, rng, col, row, 0) * ih;
      }
      const color = (fill.mode === 'palette-cycle' || fill.mode === 'checker')
        ? palette[paletteIndex(fill.mode)]
        : fill.mode === 'random'
        ? palette[Math.floor(rng() * palette.length)]
        : fill.mode === 'cell'
        ? palette[Math.floor(cellRng(ci, ri, 0x9E37)() * palette.length)]
        : (layer.vary?.color?.type === 'palette'
            ? palette[Math.floor(rng() * palette.length)]
            : (fill.color || palette[0]));
      // A transparent fill is still drawn when the shape has a stroke
      // (outline-only shapes); otherwise skip the cell entirely.
      const hasStroke = (shape.strokeWidth ?? 0) > 0;
      if (isTransparent(color) && !hasStroke) break;
      const fillColor = isTransparent(color) ? 'none' : color;
      // Stroke colour can follow its own palette mode independently
      // of the fill mode. Defaults to the shape's fixed stroke.
      let strokeColor = shape.stroke;
      if (hasStroke && palette.length > 0) {
        const sMode = shape.strokeMode || 'fixed';
        if (sMode === 'palette-cycle' || sMode === 'checker') {
          strokeColor = palette[paletteIndex(sMode)];
        } else if (sMode === 'random') {
          strokeColor = palette[Math.floor(rng() * palette.length)];
        }
      }
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
      const baseX = ix + iw / 2 + jx + (shape.offsetX ?? 0) * iw;
      const baseY = iy + ih / 2 + jy + (shape.offsetY ?? 0) * ih;
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, dx, dy) => {
        const node = shapeNode(shape, iw, ih, fillColor, { textIndex, rng, palette, colorStart, stroke: strokeColor });
        node.setAttribute(
          'transform',
          `translate(${baseX + dx} ${baseY + dy}) rotate(${rot}) scale(${s})`,
        );
        host.appendChild(node);
      });
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
      const tcols = cols;
      const strips = Math.max(2, rows - (rows % 2));
      const G = layerGeom(col, row, cw, rh, tcols, strips, layerBounds);
      if (!G) break;
      const { lw, lh, ox, oy } = G;
      // "Vertical" orientation swaps the construction axes: strips run
      // vertically and triangles point left / right (the Double
      // Triangles look). The 'a' axis is the division axis (tcols),
      // 'b' the strip axis; pt() maps (a,b) back to x,y.
      const vertical = fill.orient === 'vertical';
      const lengthA = vertical ? lh : lw;
      const lengthB = vertical ? lw : lh;
      const oa = vertical ? oy : ox;
      const ob = vertical ? ox : oy;
      const pt = vertical ? (a, b) => `${b},${a}` : (a, b) => `${a},${b}`;
      const s = lengthA / tcols;
      const h = lengthB / strips;

      const sAttrs = strokeAttrs(fill.stroke, fill.strokeWidth, Math.min(s, h), '#ffffff');

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
        if (isTransparent(color) && !sAttrs.stroke) return;
        parent.appendChild(el('polygon', {
          points,
          fill: isTransparent(color) ? 'none' : color,
          ...sAttrs,
        }));
      };

      for (let r = 0; r < strips; r++) {
        const b0 = ob + r * h;
        const b1 = b0 + h;
        const odd = r % 2 === 1;
        const off = odd ? s / 2 : 0;
        // Up triangles: tcols for odd strips, tcols+1 for even strips
        // — the c=tcols copy shares colour with c=0 via mod, supplying
        // the wrap along the division axis.
        const upCount = odd ? tcols : tcols + 1;
        for (let c = 0; c < upCount; c++) {
          const ca = oa + c * s + off;
          drawTri(`${pt(ca - s/2, b1)} ${pt(ca + s/2, b1)} ${pt(ca, b0)}`, colorAt(r, c, 'up'));
        }
        if (odd) {
          for (let c = 0; c < tcols - 1; c++) {
            const aL = oa + c * s + s/2;
            drawTri(`${pt(aL, b0)} ${pt(aL + s, b0)} ${pt(aL + s/2, b1)}`, colorAt(r, c, 'down'));
          }
          const wrapColor = colorAt(r, tcols - 1, 'down');
          for (const aL of [oa + (tcols - 1) * s + s/2, oa - s/2]) {
            drawTri(`${pt(aL, b0)} ${pt(aL + s, b0)} ${pt(aL + s/2, b1)}`, wrapColor);
          }
        } else {
          for (let c = 0; c < tcols; c++) {
            const aL = oa + c * s;
            drawTri(`${pt(aL, b0)} ${pt(aL + s, b0)} ${pt(aL + s/2, b1)}`, colorAt(r, c, 'down'));
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
      const G = layerGeom(col, row, cw, rh, ncols, nrows, layerBounds);
      if (!G) break;
      const { lw, lh, ox, oy, cellW, cellH } = G;
      // Draw a per-layer salt off the layer's RNG so the same layer
      // re-rolls when the pattern seed changes, while the per-point
      // hash stays deterministic within one render.
      const meshSalt = ((rng() * 0xffffffff) >>> 0) | 1;
      const pointAt = (i, j) => {
        // Deterministic per-lattice-point jitter via mulberry32 of a
        // mixed hash of (ii, jj, salt). Identical jitter on wrap
        // copies because ii / jj wrap mod cols / rows.
        const ii = mod(i, ncols), jj = mod(j, nrows);
        const r = cellRng(ii, jj, meshSalt);
        const dx = (r() * 2 - 1) * jitterAmt * cellW;
        const dy = (r() * 2 - 1) * jitterAmt * cellH;
        return { x: ox + i * cellW + dx, y: oy + j * cellH + dy };
      };
      const sAttrs = strokeAttrs(fill.stroke, fill.strokeWidth, Math.min(cellW, cellH), '#ffffff');
      const paint = (pa, pb, pc, colorIdx) => {
        const color = fill.mode === 'palette-cycle'
          ? palette[mod(colorIdx, palette.length)]
          : (fill.color || palette[0] || '#888');
        if (isTransparent(color) && !sAttrs.stroke) return;
        // Paint the triangle at the 9 layer-canvas wraps so any
        // vertex pushed past an edge by jitter still tiles cleanly —
        // the pattern element clips off-tile portions and the
        // neighbouring tile draws the matching wrap copy.
        drawWrapped(parent, lw, lh, (host, ox2, oy2) => {
          host.appendChild(el('polygon', {
            points: `${pa.x + ox2},${pa.y + oy2} ${pb.x + ox2},${pb.y + oy2} ${pc.x + ox2},${pc.y + oy2}`,
            fill: isTransparent(color) ? 'none' : color,
            ...sAttrs,
          }));
        });
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
      const crng = cellRng(col, row, salt);

      const sealColor = randColor(crng, palette);
      const flowerColor = randColor(crng, palette);

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
      const crng = cellRng(col, row, salt);

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
        const color = randColor(crng, palette);
        if (isTransparent(color)) continue;
        const r = bloomR * (0.7 + crng() * 0.6);
        const poly = bloomPolygon(kind, r, pts, fill.depth ?? 0.5, distort, crng);
        flower.appendChild(el('path', {
          d: polyPath(poly.map(p => [tipX + p[0], tipY + p[1]]), round),
          fill: color,
        }));
      }

      drawWrapped(parent, lw, lh, (host, dx, dy) => {
        const node = flower.cloneNode(true);
        if (dx || dy) node.setAttribute('transform', `translate(${dx} ${dy})`);
        host.appendChild(node);
      });
      break;
    }
    case 'voronoi': {
      // Toroidal Voronoi "pebbles". Jittered seed points on a torus
      // (jitter hashed per wrapped cell so it tiles). Each cell is
      // computed by clipping a bounding box against the perpendicular
      // bisectors of nearby sites, then inset by a gap and corner-
      // rounded. Drawn at the 9 layer wraps so edge cells complete
      // across the seam.
      const nc = cols, nr = rows;
      const G = layerGeom(col, row, cw, rh, nc, nr, layerBounds);
      if (!G) break;
      const { lw, lh, ox, oy, cellW, cellH, salt } = G;
      const jitterAmt = Math.max(0, Math.min(0.5, fill.jitter ?? 0.4));
      const gap = (fill.gap ?? 0.08) * Math.min(cellW, cellH);
      const round = fill.round ?? 0.5;

      const siteAt = (c, r) => {
        const cc = mod(c, nc), rr = mod(r, nr);
        const rng2 = cellRng(cc, rr, salt);
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
          drawWrapped(parent, lw, lh, (host, dx, dy) => {
            const node = el('path', { d: dPath, fill: color });
            if (dx || dy) node.setAttribute('transform', `translate(${dx} ${dy})`);
            host.appendChild(node);
          });
        }
      }
      break;
    }
    case 'maze': {
      // Perfect maze (spanning tree of passages) generated on a TORUS
      // so it tiles seamlessly: adjacency wraps in both axes. Walls
      // for every non-passage edge are drawn as thick strokes; wrap
      // walls are mirrored to the opposite edge.
      const nc = cols, nr = rows;
      const G = layerGeom(col, row, cw, rh, nc, nr, layerBounds);
      if (!G) break;
      const { lw, lh, ox, oy, cellW, cellH, salt } = G;
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
      const crng = cellRng(col, row, salt);
      const types = ['blank', 'arc', 'vsplit', 'hsplit', 'full'];
      const weights = (Array.isArray(fill.weights) && fill.weights.length === types.length)
        ? fill.weights : [1, 3, 1, 1, 1];
      const total = weights.reduce((a, b) => a + Math.max(0, b), 0) || 1;
      let pick = crng() * total, cellType = 'blank';
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
      const color = randColor(blockRng, palette);
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
      const pickRandom = () => randColor(rng, palette);
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
      const pickRandom = () => randColor(rng, palette);
      const colorA = pickRandom();
      const colorB = pickRandom();
      const dir = Math.floor(rng() * 4);
      drawSplit(parent, ix, iy, iw, ih, colorA, colorB, dir);
      break;
    }
    case 'manhattan': {
      // Girard "Manhattan" (1958): a field scattered with small white
      // "buildings" — clusters of pixel squares on a fine sub-lattice.
      // Each grid cell is a building plot; most plots are empty. The
      // module type (bars, dot-grids, solid blocks, checkers, single
      // dots) and its size/position are picked from a per-cell PRNG
      // keyed on the *wrapped* index, so the tile repeats seamlessly.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      const density = fill.density ?? 0.62;
      if (crng() > density) break;

      // Resolve the ink colour (white by default; can follow palette).
      let ink = fill.color || palette[0] || '#ffffff';
      if (palette.length > 0) {
        if (fill.mode === 'palette-cycle' || fill.mode === 'checker') ink = palette[paletteIndex(fill.mode)];
        else if (fill.mode === 'random') ink = palette[Math.floor(crng() * palette.length)];
      }
      if (isTransparent(ink)) break;

      const pixel = fill.pixel ?? 0.13;           // pixel size, × cell
      const u = Math.min(iw, ih) * pixel;
      if (!(u > 0)) break;
      const maxU = Math.max(2, Math.floor(1 / pixel)); // units per cell

      const ri2 = (a, b) => a + Math.floor(crng() * (b - a + 1));
      const pick = (items) => {
        const tot = items.reduce((s, it) => s + it[0], 0);
        let t = crng() * tot;
        for (const it of items) { if ((t -= it[0]) <= 0) return it[1]; }
        return items[items.length - 1][1];
      };

      // Each generator returns { cells:[[x,y],...], w, h } in pixel units.
      const gens = {
        dot:    () => ({ cells: [[0, 0]], w: 1, h: 1 }),
        vbar:   () => { const h = ri2(3, maxU); const c = []; for (let y = 0; y < h; y++) c.push([0, y]); return { cells: c, w: 1, h }; },
        vbars:  () => { const k = ri2(2, Math.min(4, Math.ceil(maxU / 2))); const h = ri2(3, maxU); const c = []; for (let i = 0; i < k; i++) for (let y = 0; y < h; y++) c.push([i * 2, y]); return { cells: c, w: 2 * k - 1, h }; },
        dotGrid:() => { const gw = ri2(2, Math.min(4, Math.ceil(maxU / 2))); const gh = ri2(2, Math.min(4, Math.ceil(maxU / 2))); const c = []; for (let x = 0; x < gw; x++) for (let y = 0; y < gh; y++) c.push([x * 2, y * 2]); return { cells: c, w: 2 * gw - 1, h: 2 * gh - 1 }; },
        block:  () => { const gw = ri2(2, Math.min(4, maxU)); const gh = ri2(2, Math.min(4, maxU)); const c = []; for (let x = 0; x < gw; x++) for (let y = 0; y < gh; y++) c.push([x, y]); return { cells: c, w: gw, h: gh }; },
        checker:() => { const gw = ri2(3, Math.min(5, maxU)); const gh = ri2(3, Math.min(5, maxU)); const c = []; for (let x = 0; x < gw; x++) for (let y = 0; y < gh; y++) if ((x + y) % 2 === 0) c.push([x, y]); return { cells: c, w: gw, h: gh }; },
        hbar:   () => { const w = ri2(3, maxU); const c = []; for (let x = 0; x < w; x++) c.push([x, 0]); return { cells: c, w, h: 1 }; },
        hdots:  () => { const gw = ri2(2, Math.min(4, Math.ceil(maxU / 2))); const c = []; for (let x = 0; x < gw; x++) c.push([x * 2, 0]); return { cells: c, w: 2 * gw - 1, h: 1 }; },
      };
      const kind = pick([
        [3, 'dot'], [2, 'vbar'], [2, 'vbars'], [4, 'dotGrid'],
        [2, 'block'], [2, 'checker'], [1, 'hbar'], [2, 'hdots'],
      ]);
      const mod0 = gens[kind]();

      // Random placement within the plot, clamped so the module stays
      // inside the cell (modules never overflow → no cross-tile bleed).
      const slackX = Math.max(0, iw - mod0.w * u);
      const slackY = Math.max(0, ih - mod0.h * u);
      const ox = ix + crng() * slackX;
      const oy = iy + crng() * slackY;
      for (const [px, py] of mod0.cells) {
        parent.appendChild(el('rect', {
          x: ox + px * u, y: oy + py * u, width: u, height: u, fill: ink,
        }));
      }
      break;
    }
    case 'pinwheel': {
      // Girard "Pinwheel": each cell is one half-square triangle; a
      // 2×2 block of them spirals into a pinwheel. The coloured half
      // hugs the block centre, rotated 90° per quadrant for the spin.
      // Blocks alternate two palette colours in a checker. Purely
      // positional (mod) so it tiles when cols/rows are multiples of 4.
      const lc = mod(col, 2), lr = mod(row, 2);
      // Quadrant within the block, clockwise from top-left.
      const p = lr === 0 ? (lc === 0 ? 0 : 1) : (lc === 1 ? 2 : 3);
      // corners[p] picks the half-square-triangle (TL/TR/BR/BL) whose
      // colour hugs the block centre — all four same-colour blades meet
      // at the centre point and spiral. spin offsets the rotation.
      const corners = fill.corners || [3, 0, 1, 2];
      const corner = corners[mod(p + (fill.spin || 0), 4)];
      const bc = Math.floor(col / 2), br = Math.floor(row / 2);
      const color = palette[mod(bc + br, palette.length)] || fill.color || '#c0504d';
      if (fill.ground && !isTransparent(fill.ground)) {
        parent.appendChild(el('rect', { x: ix, y: iy, width: iw, height: ih, fill: fill.ground }));
      }
      if (!isTransparent(color)) drawHalfTriangle(parent, ix, iy, iw, ih, color, corner);
      break;
    }
    case 'glyph': {
      // Girard L'Etoile menu (1966): a modular "geometric alphabet".
      // Each cell carries one bar-built glyph (I-beam, comb, frame,
      // U/L/T forms, stacked bars) or a ring / disc, drawn in ink on
      // paper — and randomly inverted (white-on-black). Per-cell PRNG
      // keyed on the wrapped index so it tiles seamlessly.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      const ink = fill.ink || palette[0] || '#21242b';
      const paper = fill.paper || '#f3ede0';
      // With `inks` (an array), the cell ground is left transparent and
      // the glyph is drawn in a random ink colour — for two-tone glyphs
      // on a separate ground (Extrusions). Otherwise it's ink-on-paper
      // with random inversion (the Menu look).
      const inks = fill.inks;
      const transparent = !!(inks && inks.length);
      const invert = !transparent && crng() < (fill.invert ?? 0.5);
      const bg = transparent ? 'none' : (invert ? ink : paper);
      const fg = transparent ? inks[Math.floor(crng() * inks.length)] : (invert ? paper : ink);
      const t = fill.weight ?? 0.22;            // bar thickness, × cell
      if (!transparent) parent.appendChild(el('rect', { x: ix, y: iy, width: iw, height: ih, fill: bg }));
      // R: filled rect in normalised cell coords (0..1).
      const R = (nx, ny, nw, nh) => parent.appendChild(el('rect', {
        x: ix + nx * iw, y: iy + ny * ih, width: nw * iw, height: nh * ih, fill: fg,
      }));
      const dim = Math.min(iw, ih);
      const e = 1 - t;                          // far edge of a t-bar
      const m = (1 - t) / 2;                     // centred bar offset
      const glyphs = fill.glyphs || [
        'hbars', 'vbars', 'ibeam', 'tbar', 'ubar', 'lbar',
        'comb', 'frame', 'hpair', 'vpair', 'ring', 'disc', 'solid', 'blank',
      ];
      // `columns` assigns a fixed glyph per grid column (cycled), so the
      // glyphs group into vertical bands (Treads); otherwise random.
      const name = fill.columns
        ? fill.columns[mod(ci, fill.columns.length)]
        : glyphs[Math.floor(crng() * glyphs.length)];
      switch (name) {
        case 'plus':     R(m, 0, t, 1); R(0, m, 1, t); break;
        case 'hbeam':    R(0, 0, t, 1); R(e, 0, t, 1); R(0, m, 1, t); break;
        case 'lbracket': R(0, 0, t, 1); R(0, 0, 0.5, t); R(0, e, 0.5, t); break;
        case 'rbracket': R(e, 0, t, 1); R(0.5, 0, 0.5, t); R(0.5, e, 0.5, t); break;
        case 'vdash':    R(m, 0.16, t, 0.68); break;
        case 'hdash':    R(0.06, 0.22, 0.88, 0.56); break;
        case 'block':    R(0.16, 0.14, 0.68, 0.72); break;
        case 'diamond': {
          const cx2 = ix + iw / 2, cy2 = iy + ih / 2, r = dim * 0.56;
          parent.appendChild(el('polygon', {
            points: `${cx2},${cy2 - r} ${cx2 + r},${cy2} ${cx2},${cy2 + r} ${cx2 - r},${cy2}`,
            fill: fg,
          }));
          break;
        }
        case 'hbars': R(0, 0, 1, t); R(0, m, 1, t); R(0, e, 1, t); break;
        case 'vbars': R(0, 0, t, 1); R(m, 0, t, 1); R(e, 0, t, 1); break;
        case 'hpair': R(0, 0, 1, t); R(0, e, 1, t); break;
        case 'vpair': R(0, 0, t, 1); R(e, 0, t, 1); break;
        case 'ibeam': R(0, 0, 1, t); R(0, e, 1, t); R(m, 0, t, 1); break;
        case 'tbar':  R(0, 0, 1, t); R(m, t, t, e); break;
        case 'ubar':  R(0, 0, t, 1); R(e, 0, t, 1); R(0, e, 1, t); break;
        case 'lbar':  R(0, 0, t, 1); R(0, e, 1, t); break;
        case 'comb':  R(0, 0, t, 1); R(t, 0, e, t); R(t, m, e, t); R(t, e, e, t); break;
        case 'frame': R(0, 0, 1, t); R(0, e, 1, t); R(0, 0, t, 1); R(e, 0, t, 1); break;
        case 'solid': R(0, 0, 1, 1); break;
        case 'blank': break;
        case 'disc':
          parent.appendChild(el('circle', { cx: ix + iw / 2, cy: iy + ih / 2, r: dim * 0.42, fill: fg }));
          break;
        case 'ring':
          parent.appendChild(el('circle', { cx: ix + iw / 2, cy: iy + ih / 2, r: dim * 0.42, fill: fg }));
          parent.appendChild(el('circle', { cx: ix + iw / 2, cy: iy + ih / 2, r: dim * (0.42 - t * 0.62), fill: bg }));
          break;
      }
      break;
    }
    case 'stones': {
      // Girard "Stones": fat rounded rectangles of varied size on a
      // dark ground, generous gaps between them. Each cell hosts one
      // stone; per-cell jitter / scale / corner-radius variation breaks
      // the grid. Stones are wrap-painted so the tile is seamless.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      const stone = fill.color || palette[0] || '#efe9dc';
      if (isTransparent(stone)) break;
      const gap = fill.gap ?? 0.18;                  // inset, × cell
      const round = fill.round ?? 0.55;              // 0..1, × half-min
      const sjit = fill.jitter ?? 0.08;              // pos jitter, × cell
      const svar = fill.sizeJitter ?? 0.25;          // ± size, × cell
      const rvar = fill.roundJitter ?? 0.25;         // ± corner, 0..1
      // Per-stone parameters (deterministic).
      const sx = 1 + (crng() * 2 - 1) * svar;
      const sy = 1 + (crng() * 2 - 1) * svar;
      const dx = (crng() * 2 - 1) * sjit * iw;
      const dy = (crng() * 2 - 1) * sjit * ih;
      const rA = Math.max(0, Math.min(1, round + (crng() * 2 - 1) * rvar));
      const rB = Math.max(0, Math.min(1, round + (crng() * 2 - 1) * rvar));
      const baseW = (iw - 2 * gap * iw) * sx;
      const baseH = (ih - 2 * gap * ih) * sy;
      if (!(baseW > 0 && baseH > 0)) break;
      const half = Math.min(baseW, baseH) / 2;
      const rx = rA * half;
      const ry = rB * half;
      const cx0 = ix + iw / 2 + dx;
      const cy0 = iy + ih / 2 + dy;
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, ox, oy) => {
        host.appendChild(el('rect', {
          x: cx0 - baseW / 2 + ox,
          y: cy0 - baseH / 2 + oy,
          width: baseW,
          height: baseH,
          rx, ry,
          fill: stone,
        }));
      });
      break;
    }
    case 'twigs': {
      // Girard "Twigs": a tiny L-system per cell. A near-vertical stem
      // bends gently, sprouts feather-fan twiglets on alternating
      // sides, and forks into a Y at the top. Stem and twig colours are
      // each picked from the palette per plant, so some are one-colour
      // and some mix brown / blue like the original. Segments are
      // collected then wrap-painted for a seamless tile.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      const pal = palette.length ? palette : ['#9c7350', '#8298ad'];
      const stemColor = pal[Math.floor(crng() * pal.length)];
      const twigColor = pal[Math.floor(crng() * pal.length)];
      const sw = (fill.thickness ?? 0.03) * iw;
      const segs = [];
      const root = {
        x: ix + iw / 2 + (crng() * 2 - 1) * iw * 0.18,
        y: iy + ih * 0.99,
      };
      const H = ih * (fill.height ?? 0.9) * (0.8 + crng() * 0.45);
      const n = 5 + Math.floor(crng() * 3);
      const step = H / n;
      const twlen = step * (fill.twig ?? 0.78);
      // Polar segment helper.
      const seg = (x, y, ang, len, c, w) =>
        segs.push({ x1: x, y1: y, x2: x + Math.cos(ang) * len, y2: y + Math.sin(ang) * len, c, w });
      let cur = { ...root };
      let dir = -Math.PI / 2;                  // up
      for (let k = 0; k < n; k++) {
        dir += (crng() * 2 - 1) * 0.16;         // gentle bend
        const nx = cur.x + Math.cos(dir) * step;
        const ny = cur.y + Math.sin(dir) * step;
        const w = sw * (1 - 0.4 * k / n);       // taper toward the top
        segs.push({ x1: cur.x, y1: cur.y, x2: nx, y2: ny, c: stemColor, w });
        cur = { x: nx, y: ny };
        if (k > 0 && k < n - 1) {
          // Feather fan on alternating side, pointing up-and-out.
          const side = k % 2 === 0 ? 1 : -1;
          const base = -Math.PI / 2 + side * (0.5 + crng() * 0.25);
          const prongs = 2 + (crng() < 0.5 ? 1 : 0);
          for (let p = 0; p < prongs; p++) {
            const a = base + (p - (prongs - 1) / 2) * 0.4;
            seg(cur.x, cur.y, a, twlen * (0.7 + crng() * 0.5), twigColor, sw * 0.85);
          }
        }
      }
      // Top Y-fork in stem colour.
      for (const s of [-1, 1]) {
        seg(cur.x, cur.y, dir + s * (0.3 + crng() * 0.2), step * 0.85, stemColor, sw * 0.8);
      }
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, ox, oy) => {
        for (const s of segs) host.appendChild(el('line', {
          x1: s.x1 + ox, y1: s.y1 + oy, x2: s.x2 + ox, y2: s.y2 + oy,
          stroke: s.c, 'stroke-width': s.w, 'stroke-linecap': 'round',
        }));
      });
      break;
    }
    case 'weave': {
      // Plain over/under weave. warp = vertical thread colours (indexed
      // by column), weft = horizontal thread colours (by row). At each
      // crossing the warp is "on top" on one checker phase and the weft
      // on the other, so colours interlace into the woven texture.
      // Striped warp/weft give Jutestripe; striping both gives a plaid.
      const warp = fill.warp && fill.warp.length ? fill.warp : palette;
      const weft = fill.weft && fill.weft.length ? fill.weft : (fill.warp && fill.warp.length ? fill.warp : palette);
      // Balanced = 50/50 checker. Warp-faced shows the vertical thread
      // on 2 of every 3 crossings, so warp stripes stay dominant with
      // the weft just speckling through (needs dims ÷3 to tile).
      // warpN controls warp dominance for a warp-faced weave: the warp
      // shows on (warpN-1) of every warpN crossings (default 3 → 2/3).
      // Higher = more solid warp stripes. Dims must be ÷ warpN to tile.
      const warpN = fill.warpN || 3;
      const over = (fill.face === 'warp')
        ? mod(ci + ri, warpN) !== 0
        : mod(ci + ri, 2) === 0;
      const warpColor = warp[mod(col, warp.length)];
      // weftShade keeps the weft tone-on-tone: a darker shade of the
      // warp colour right here, so stripes stay solid with just a woven
      // ribbing rather than a contrasting checker.
      let color = over ? warpColor
        : (fill.weftShade != null ? shadeHex(warpColor, -fill.weftShade)
                                  : weft[mod(row, weft.length)]);
      if (fill.noise) {
        const crng = cellRng(ci, ri, layerBounds?.salt ?? 1);
        color = shadeHex(color, (crng() * 2 - 1) * fill.noise);
      }
      if (isTransparent(color)) break;
      const g2 = (fill.gap ?? 0.12);
      const gx2 = iw * g2 / 2, gy2 = ih * g2 / 2;
      const rr = Math.min(iw, ih) * (fill.round ?? 0.35);
      parent.appendChild(el('rect', {
        x: ix + gx2, y: iy + gy2, width: iw - 2 * gx2, height: ih - 2 * gy2,
        rx: rr, ry: rr, fill: color,
      }));
      break;
    }
    case 'windowpane': {
      // Girard "Lincheck": a windowpane check. Each cell draws a plain
      // thin vertical line on its left edge and a decorative horizontal
      // band of cross-stitch X's (two opposing zigzags) on its top
      // edge, so the lines join into a continuous grid that tiles.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      const vColor = fill.vColor || '#b7bbc0';
      const hColor = fill.hColor || '#9aa0a6';
      const vW = (fill.vWidth ?? 0.018) * iw;
      const hW = (fill.hWidth ?? 0.02) * ih;
      const jit = fill.jitter ?? 0.12;
      // Plain vertical line (left edge), with a touch of position jitter.
      const vx = ix + (crng() * 2 - 1) * jit * vW;
      parent.appendChild(el('line', {
        x1: vx, y1: iy, x2: vx, y2: iy + ih,
        stroke: vColor, 'stroke-width': vW,
      }));
      // Horizontal cross-stitch band on the top edge: two opposing
      // zigzags that cross into a row of X's. n forced even so the
      // phase matches at both ends and joins the next cell cleanly.
      const y0 = iy + (crng() * 2 - 1) * jit * hW;
      const amp = ih * (fill.amp ?? 0.04);
      let n = Math.max(2, Math.round(iw / (amp * 1.6)));
      if (n % 2) n++;
      const dx = iw / n;
      let d1 = `M ${ix} ${y0 - amp}`;
      let d2 = `M ${ix} ${y0 + amp}`;
      for (let i = 1; i <= n; i++) {
        const x = ix + i * dx;
        d1 += ` L ${x} ${i % 2 ? y0 + amp : y0 - amp}`;
        d2 += ` L ${x} ${i % 2 ? y0 - amp : y0 + amp}`;
      }
      for (const d of [d1, d2]) parent.appendChild(el('path', {
        d, fill: 'none', stroke: hColor, 'stroke-width': hW,
      }));
      break;
    }
    case 'honeycomb': {
      // Outlined flat-top hexagons (a honeycomb). Generated once across
      // the whole layer (guarded to the 0,0 cell). Hexes are slightly
      // stretched to fit cols × rows exactly so the lattice tiles; cols
      // must be even for the column-offset phase to match at the seam.
      const G = layerGeom(col, row, cw, rh, cols, rows, layerBounds);
      if (!G) break;
      const { lw, lh } = G;
      const stroke = fill.stroke || palette[0] || '#3a4aa0';
      const cx = lw / cols, cy = lh / rows;
      const Rx = cx / 1.5;                       // flat-top horizontal radius
      const hy = cy / 2;
      const hexAt = (mx, my) => {
        const p = [
          [Rx, 0], [Rx / 2, hy], [-Rx / 2, hy],
          [-Rx, 0], [-Rx / 2, -hy], [Rx / 2, -hy],
        ].map(([dx, dy]) => `${(mx + dx).toFixed(2)},${(my + dy).toFixed(2)}`).join(' ');
        parent.appendChild(el('polygon', {
          points: p, fill: 'none', stroke,
          'stroke-width': fill.strokeWidth ? fill.strokeWidth * cx : Math.max(1, cx * 0.04),
          'stroke-linejoin': 'round',
        }));
      };
      for (let i = -1; i <= cols; i++) {
        for (let j = -1; j <= rows; j++) {
          const mx = i * cx + cx / 2;
          const my = j * cy + (i % 2 ? cy : cy / 2);
          hexAt(mx, my);
        }
      }
      break;
    }
    case 'dashes': {
      // Field of full-height vertical lines (uniform height; use a fine
      // column grid). Width varies only a little, and adjacent filled
      // columns pack into thicker "duplicate" bars — a loose barcode.
      // Per-cell PRNG (wrapped index) keeps the tile seamless.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      if (crng() > (fill.density ?? 0.55)) break;
      const mark = (fill.mode === 'random' && palette.length)
        ? palette[Math.floor(crng() * palette.length)]
        : (fill.color || palette[0] || '#d2624d');
      if (isTransparent(mark)) break;
      const w = iw * (fill.width ?? 0.5) * (0.8 + crng() * 0.5);
      const x = ix + (iw - w) / 2;
      parent.appendChild(el('rect', { x, y: iy, width: w, height: ih, fill: mark }));
      break;
    }
    case 'multiform': {
      // Girard "Multiform": a sampler scatter — each cell picks a random
      // motif from the shape vocabulary in a random palette colour, some
      // filled, some outlined, with size / rotation / position jitter.
      // Per-cell PRNG (wrapped index) + wrap painting keep it seamless.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      if (crng() > (fill.density ?? 0.82)) break;
      const kinds = fill.shapes || [
        'circle', 'square', 'flower', 'lens', 'diamond', 'star',
        'barbell', 'cross', 'quadDots', 'triangle',
      ];
      const kind = kinds[Math.floor(crng() * kinds.length)];
      const color = palette.length ? palette[Math.floor(crng() * palette.length)] : (fill.color || '#6f8f3f');
      const shape = { kind, size: 0.5 + crng() * 0.4, petals: 12 + Math.floor(crng() * 6), rings: 1 };
      // A few motifs read better rotated to vertical or horizontal.
      let rot = 0;
      if (kind === 'barbell' || kind === 'lens') rot = crng() < 0.5 ? 0 : 90;
      // Outline (ring / open square) for a subset, sometimes.
      let fillColor = color;
      if ((kind === 'circle' || kind === 'square' || kind === 'diamond') && crng() < 0.32) {
        shape.strokeWidth = 0.05; shape.stroke = color; fillColor = 'none';
      }
      const bx = ix + iw / 2 + (crng() * 2 - 1) * iw * 0.1;
      const by = iy + ih / 2 + (crng() * 2 - 1) * ih * 0.1;
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, dx, dy) => {
        const node = shapeNode(shape, iw, ih, fillColor, { rng: crng, palette, colorStart: 0 });
        node.setAttribute('transform', `translate(${bx + dx} ${by + dy}) rotate(${rot})`);
        host.appendChild(node);
      });
      break;
    }
    case 'fruit': {
      // Girard "Fruit Tree" — minus the tree. Scattered "fruits" from a
      // mid-century vocabulary (circle, ellipse, rounded square, arch,
      // half-disc) in warm colours, each with a short dark stalk and
      // the odd green leaf. Per-cell PRNG + wrap painting tile cleanly.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      if (crng() > (fill.density ?? 0.72)) break;
      const pal = palette.length ? palette : ['#e0463a', '#ef7d2e', '#f3c11f', '#d9a72a', '#d24a8e'];
      const color = fill.mode === 'cell'
        ? pal[Math.floor(cellRng(ci, ri, 0x9E37)() * pal.length)]
        : pal[Math.floor(crng() * pal.length)];
      if (isTransparent(color)) break;
      const stalkColor = fill.stalk || '#4f4a22';
      const leafColor = fill.leaf || '#7d9a40';
      const baseR = Math.min(iw, ih) * 0.42 * (fill.size ?? 1) * (0.78 + crng() * 0.44);
      const cx0 = ix + iw / 2 + (crng() * 2 - 1) * iw * 0.06;
      const cy0 = iy + ih / 2 + (crng() * 2 - 1) * ih * 0.06;
      const kinds = ['circle', 'ellipseW', 'ellipseT', 'roundsquare', 'arch', 'semicircle'];
      const kind = kinds[Math.floor(crng() * kinds.length)];
      const rot = (crng() * 2 - 1) * 8;
      const stalkOff = (crng() * 2 - 1) * baseR * 0.18;
      const stalkAngle = -Math.PI / 2 + (crng() * 2 - 1) * 0.22; // up, ± ~13°
      const leafOn = crng() < (fill.leafChance ?? 0.26);
      const leafSide = crng() < 0.5 ? -1 : 1;
      const draw = (host, ox, oy) => {
        const cx = cx0 + ox, cy = cy0 + oy;
        const g = el('g', { transform: `rotate(${rot.toFixed(1)} ${cx} ${cy})` });
        let bh = baseR;                              // half-height for stalk attach
        if (kind === 'circle') g.appendChild(el('circle', { cx, cy, r: baseR, fill: color }));
        else if (kind === 'ellipseW') { bh = baseR * 0.62; g.appendChild(el('ellipse', { cx, cy, rx: baseR, ry: bh, fill: color })); }
        else if (kind === 'ellipseT') { g.appendChild(el('ellipse', { cx, cy, rx: baseR * 0.72, ry: baseR, fill: color })); }
        else if (kind === 'roundsquare') { const s = baseR * 0.92; bh = s; g.appendChild(el('rect', { x: cx - s, y: cy - s, width: s * 2, height: s * 2, rx: s * 0.22, ry: s * 0.22, fill: color })); }
        else if (kind === 'arch') { const w = baseR * 1.5, H = baseR * 1.9, r = w / 2; bh = H / 2; g.appendChild(el('path', { d: `M ${cx - w / 2},${cy + H / 2} L ${cx - w / 2},${cy - H / 2 + r} A ${r},${r} 0 0 1 ${cx + w / 2},${cy - H / 2 + r} L ${cx + w / 2},${cy + H / 2} Z`, fill: color })); }
        else if (kind === 'semicircle') { const r = baseR * 1.1; bh = r * 0.55; g.appendChild(el('path', { d: `M ${cx - r},${cy + r * 0.2} A ${r},${r} 0 0 1 ${cx + r},${cy + r * 0.2} Z`, fill: color })); }
        // Short dark stalk poking from the top, angled slightly.
        const ax = cx + stalkOff, ay = cy - bh * 0.5;
        const slen = bh * 0.62;
        g.appendChild(el('line', {
          x1: ax, y1: ay,
          x2: ax + Math.cos(stalkAngle) * slen, y2: ay + Math.sin(stalkAngle) * slen,
          stroke: stalkColor, 'stroke-width': baseR * 0.09, 'stroke-linecap': 'round',
        }));
        if (leafOn) {
          const lx = ax + leafSide * baseR * 0.24, ly = cy - bh * 0.82;
          const lg = el('g', { transform: `translate(${lx.toFixed(1)} ${ly.toFixed(1)}) rotate(${(leafSide * 42).toFixed(0)})` });
          lg.appendChild(el('ellipse', { cx: 0, cy: 0, rx: baseR * 0.32, ry: baseR * 0.13, fill: leafColor }));
          g.appendChild(lg);
        }
        host.appendChild(g);
      };
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, draw);
      break;
    }
    case 'graph': {
      // Girard "Graph": a thin line-art grid whose column nodes are
      // pulled up or down. Vertical dividers stay straight; the
      // horizontal rungs tilt between each column's offset, so where the
      // offsets zigzag the rungs become stacked chevrons, and where they
      // are equal they stay a flat grid. `offsets` is per column
      // (fraction of a row), cycled — keep ends equal so it tiles.
      const stroke = fill.stroke || palette[0] || '#8a9a4a';
      const sw = (fill.strokeWidth ?? 0.012) * Math.min(iw, ih);
      const offsets = fill.offsets && fill.offsets.length ? fill.offsets : [0, 0.5, 0, -0.5];
      const P = offsets.length;
      const offL = offsets[mod(ci, P)];
      const offR = offsets[mod(ci + 1, P)];
      const L = (x1, y1, x2, y2, w) => parent.appendChild(el('line', {
        x1: ix + x1 * iw, y1: iy + y1 * ih, x2: ix + x2 * iw, y2: iy + y2 * ih,
        stroke, 'stroke-width': w ?? sw, 'stroke-linecap': fill.broken ? 'butt' : 'round', 'stroke-linejoin': 'round',
      }));
      if (fill.broken) {
        // Broken Lines: thick dashes that sit at the per-column node
        // heights (offsets, 0..1) with gaps between — so where the
        // offsets run flat the dashes are horizontal at a height, and
        // where they step the dashes tilt: the line breaks up and down.
        const m = fill.margin ?? 0.12;
        const bw = (fill.barWidth ?? 0.24) * ih;
        L(m, offL, 1 - m, offR, bw);
        break;
      }
      L(0, 0, 0, 1);                            // vertical divider
      L(0, offL, 1, offR);                      // rung, tilted by the node offsets
      break;
    }
    case 'grass': {
      // Girard "June": thin meadow blades. Each cell grows one near-
      // vertical stem with a few paired needle-leaves and, sometimes, a
      // lens "seed pod" at the tip. Angles vary so blades cross. Lines
      // are collected then wrap-painted for a seamless tile.
      const salt = layerBounds?.salt ?? 1;
      const crng = cellRng(ci, ri, salt);
      const color = fill.color || palette[0] || '#3f7a8c';
      const sw = (fill.thickness ?? 0.01) * Math.min(iw, ih);
      const rootX = ix + iw / 2 + (crng() * 2 - 1) * iw * 0.45;
      const baseY = iy + ih * 1.02;
      const ang = -Math.PI / 2 + (crng() * 2 - 1) * 0.3;
      const len = ih * (fill.height ?? 1.0) * (0.6 + crng() * 0.7);
      const dx = Math.cos(ang), dy = Math.sin(ang);
      const tipX = rootX + dx * len, tipY = baseY + dy * len;
      const lines = [[rootX, baseY, tipX, tipY]];
      const nn = 2 + Math.floor(crng() * 3);
      for (let k = 0; k < nn; k++) {
        const f = 0.3 + (k / Math.max(1, nn)) * 0.55 + crng() * 0.06;
        const px = rootX + dx * len * f, py = baseY + dy * len * f;
        const nlen = len * 0.1 * (0.7 + crng() * 0.6);
        for (const s of [-1, 1]) {
          const na = ang - s * (0.55 + crng() * 0.15);
          lines.push([px, py, px + Math.cos(na) * nlen, py + Math.sin(na) * nlen]);
        }
      }
      const pod = crng() < (fill.podChance ?? 0.4);
      const podLen = len * 0.07, podW = sw * 2.4;
      const podDeg = (ang * 180 / Math.PI + 90).toFixed(1);
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, ox, oy) => {
        for (const [x1, y1, x2, y2] of lines) host.appendChild(el('line', {
          x1: x1 + ox, y1: y1 + oy, x2: x2 + ox, y2: y2 + oy,
          stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round',
        }));
        if (pod) {
          const g = el('g', { transform: `translate(${(tipX + ox).toFixed(1)} ${(tipY + oy).toFixed(1)}) rotate(${podDeg})` });
          g.appendChild(el('ellipse', { cx: 0, cy: -podLen, rx: podW, ry: podLen, fill: color }));
          host.appendChild(g);
        }
      });
      break;
    }
    case 'firecracker': {
      // A vertical "fuse" down each column with horizontal bars hanging
      // off ALTERNATING sides as they descend (fishbone). Bar height =
      // its gap, so each side reads 50/50 and the two sides mirror.
      const color = fill.color || palette[0] || '#e0954a';
      const cx = ix + iw / 2;
      const fuseW = (fill.fuse ?? 0.08) * iw;
      parent.appendChild(el('rect', { x: cx - fuseW / 2, y: iy, width: fuseW, height: ih, fill: color }));
      const side = mod(ri, 2) === 0 ? -1 : 1;     // alternate left / right
      const barH = (fill.barWidth ?? 0.5) * ih;
      const barLen = (fill.barLen ?? 0.4) * iw;
      const by = iy + (ih - barH) / 2;
      const bx = side < 0 ? cx - barLen : cx;
      parent.appendChild(el('rect', { x: bx, y: by, width: barLen, height: barH, fill: color }));
      break;
    }
    case 'comb': {
      // Self-complementary 50/50 band: a colour fills the left part of
      // the band up to a periodic boundary x = b(y); the white ground is
      // the congruent complement (shift by half a period swaps them).
      // `profile` picks the boundary; per-column arrays let one layer
      // render a whole striped sampler (Palio). profiles: square,
      // triangle, round, crown, flame, checker, angle.
      const nB = (fill.profiles && fill.profiles.length) || 1;
      const idx = mod(ci, nB);
      const at = (v, d) => Array.isArray(v) ? v[mod(idx, v.length)] : (v ?? d);
      const profile = fill.profiles ? fill.profiles[idx] : (fill.profile || 'square');
      const color = fill.colors ? fill.colors[mod(idx, fill.colors.length)] : (fill.color || palette[0] || '#888');
      const teeth = Math.max(1, at(fill.teeth, 10));
      const amp = at(fill.amp, 0.3);
      const W = iw, H = ih, x0 = ix, y0 = iy;
      const wide = W * (0.5 + amp), narrow = W * (0.5 - amp);
      const T = H / teeth;
      if (isTransparent(color)) break;

      if (profile === 'checker') {
        const s = W / 2;
        const nr = Math.max(1, Math.round(H / s));
        const sh = H / nr;
        for (let r = 0; r < nr; r++) for (let c = 0; c < 2; c++) {
          if ((r + c) % 2 === 0) parent.appendChild(el('rect', { x: x0 + c * s, y: y0 + r * sh, width: s, height: sh, fill: color }));
        }
        break;
      }
      if (profile === 'angle') {
        const clipId = `cmb-${mod(ci, 9999)}-${(layerBounds?.salt || 1) & 0xffff}`;
        const clip = el('clipPath', { id: clipId });
        clip.appendChild(el('rect', { x: x0, y: y0, width: W, height: H }));
        const g = el('g', { 'clip-path': `url(#${clipId})` });
        const P = T;
        for (let k = -Math.ceil(H / P) - 1; k < Math.ceil((W + H) / P) + 1; k++) {
          const off = k * P;
          g.appendChild(el('line', {
            x1: x0 + off, y1: y0, x2: x0 + off + H, y2: y0 + H,
            stroke: color, 'stroke-width': P / (2 * Math.SQRT2),
          }));
        }
        parent.appendChild(el('defs', {}, [clip]));
        parent.appendChild(g);
        break;
      }

      const pts = [];
      if (profile === 'square') {
        for (let i = 0; i < teeth; i++) {
          const yt = y0 + i * T;
          pts.push([x0 + wide, yt], [x0 + wide, yt + T / 2], [x0 + narrow, yt + T / 2], [x0 + narrow, yt + T]);
        }
      } else if (profile === 'triangle' || profile === 'spear' || profile === 'crown') {
        for (let i = 0; i < teeth; i++) {
          const yt = y0 + i * T;
          pts.push([x0 + narrow, yt], [x0 + wide, yt + T / 2], [x0 + narrow, yt + T]);
        }
      } else if (profile === 'round' || profile === 'drop' || profile === 'goo') {
        const steps = teeth * 14;
        for (let s = 0; s <= steps; s++) {
          const y = H * s / steps;
          pts.push([x0 + W * (0.5 + amp * Math.cos(2 * Math.PI * y / T)), y0 + y]);
        }
      } else if (profile === 'flame') {
        // Asymmetric licking wave: quick rise, long curved fall.
        const steps = teeth * 16;
        for (let s = 0; s <= steps; s++) {
          const y = H * s / steps;
          const ph = (y / T) % 1;
          const f = ph < 0.34 ? (ph / 0.34) : (1 - (ph - 0.34) / 0.66);
          const ff = Math.max(0, f) * Math.max(0, f) * (3 - 2 * Math.max(0, f)); // smoothstep ease → rounded lick
          pts.push([x0 + narrow + (wide - narrow) * ff, y0 + y]);
        }
      }
      let d = `M ${x0} ${y0}`;
      for (const [px, py] of pts) d += ` L ${px.toFixed(2)} ${py.toFixed(2)}`;
      d += ` L ${x0} ${y0 + H} Z`;
      parent.appendChild(el('path', { d, fill: color }));
      if (profile === 'crown') {
        // A dot in each valley (between the points) — the jewels.
        for (let i = 0; i < teeth; i++) {
          parent.appendChild(el('circle', { cx: x0 + wide * 0.62, cy: y0 + (i + 1) * T, r: W * 0.09, fill: color }));
        }
      }
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
// ---------- Google Fonts (loaded on demand) ----------
const GOOGLE_FONTS = [
  'Anton', 'Oswald', 'Archivo Black', 'Bebas Neue', 'Fjalla One',
  'Staatliches', 'Passion One', 'Bungee', 'Abril Fatface', 'Rubik Mono One',
  'Libre Franklin', 'Playfair Display',
];
const GENERIC_FONTS = ['sans-serif', 'serif', 'monospace'];
const _loadedFonts = new Set();

// Inject the Google Fonts stylesheet for `family` (once) and resolve
// when the actual font faces are ready, so a re-render can use them.
function ensureFont(family) {
  if (!family || GENERIC_FONTS.includes(family)) return Promise.resolve();
  if (!_loadedFonts.has(family)) {
    _loadedFonts.add(family);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700;900&display=swap`;
    document.head.appendChild(link);
  }
  if (document.fonts && document.fonts.load) {
    return Promise.all([
      document.fonts.load(`900 40px "${family}"`),
      document.fonts.load(`700 40px "${family}"`),
      document.fonts.load(`400 40px "${family}"`),
    ]).catch(() => {});
  }
  return Promise.resolve();
}

// Every font family referenced by a text-shape layer in the pattern.
function patternFonts(pattern) {
  const set = new Set();
  for (const l of pattern.layers || []) {
    if (l.fill?.kind === 'shape' && l.fill.shape?.kind === 'text' && l.fill.shape.fontFamily) {
      set.add(l.fill.shape.fontFamily);
    }
  }
  return [...set];
}

function buildSvg(pattern) {
  const { w: tileW, h: tileH } = tileDims(pattern);
  // Show one full centre tile plus only a fraction of the surrounding
  // tiles for tiling context, rather than a full 3×3.
  const frac = Math.max(0, Math.min(1, pattern.surroundFraction ?? 0.33));
  const mx = frac * tileW, my = frac * tileH;
  const viewW = tileW + 2 * mx, viewH = tileH + 2 * my;
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
    // Offset so a tile boundary lands at the centre tile's edges.
    x: mx, y: my,
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
  // Veil dims the surrounding margins so the centre tile reads as the
  // unit; the four border strips leave the centre tile clear.
  const veil = Math.max(0, Math.min(1, pattern.surroundVeil ?? 0.5));
  if (veil > 0 && frac > 0) {
    const strips = [
      [0, 0, viewW, my],                 // top
      [0, my + tileH, viewW, my],        // bottom
      [0, my, mx, tileH],                // left
      [mx + tileW, my, mx, tileH],       // right
    ];
    for (const [x, y, w, h] of strips) {
      root.appendChild(el('rect', { x, y, width: w, height: h, fill: '#ffffff', opacity: veil }));
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
  const fillKind = addCtrl('kind', 'select', layer.fill.kind, { options: ['solid', 'shape', 'split', 'arc-split', 'arc-block', 'mesh', 'triangles', 'voronoi', 'bloom', 'flower-seal', 'maze', 'manhattan', 'pinwheel', 'glyph', 'stones', 'twigs', 'weave', 'windowpane', 'honeycomb', 'dashes', 'multiform', 'fruit', 'graph', 'grass', 'firecracker', 'comb'] });
  fillKind.addEventListener('change', () => {
    if (fillKind.value === 'pinwheel') {
      layer.fill = { kind: 'pinwheel', spin: 0 };
    } else if (fillKind.value === 'glyph') {
      layer.fill = { kind: 'glyph', ink: '#21242b', paper: '#f3ede0', invert: 0.5, weight: 0.22 };
    } else if (fillKind.value === 'stones') {
      layer.fill = { kind: 'stones', color: '#efe9dc', gap: 0.18, round: 0.6, jitter: 0.08, sizeJitter: 0.22, roundJitter: 0.3 };
    } else if (fillKind.value === 'twigs') {
      layer.fill = { kind: 'twigs', thickness: 0.03, height: 0.92, twig: 0.78 };
    } else if (fillKind.value === 'weave') {
      layer.fill = { kind: 'weave', gap: 0.14, round: 0.4, noise: 0.13, warp: ['#2c303a', '#c2a878', '#e8dec3'], weft: ['#c2a878', '#e8dec3'] };
    } else if (fillKind.value === 'windowpane') {
      layer.fill = { kind: 'windowpane', vColor: '#b7bbc0', hColor: '#9aa0a6', vWidth: 0.016, hWidth: 0.018, amp: 0.04, jitter: 0.18 };
    } else if (fillKind.value === 'honeycomb') {
      layer.fill = { kind: 'honeycomb', stroke: '#3a4aa0', strokeWidth: 0.03 };
    } else if (fillKind.value === 'dashes') {
      layer.fill = { kind: 'dashes', mode: 'random', density: 0.42, width: 0.5 };
    } else if (fillKind.value === 'multiform') {
      layer.fill = { kind: 'multiform', density: 0.82 };
    } else if (fillKind.value === 'fruit') {
      layer.fill = { kind: 'fruit', mode: 'random', density: 0.78, size: 1, leafChance: 0.28, stalk: '#4f4a22', leaf: '#7d9a40' };
    } else if (fillKind.value === 'graph') {
      layer.fill = { kind: 'graph', stroke: '#8a9a4a', strokeWidth: 0.012, offsets: [0, 0, 0.6, 0, 0.6, 0, 0, 0, 0.6, 0, 0.6, 0] };
    } else if (fillKind.value === 'grass') {
      layer.fill = { kind: 'grass', color: '#3f7a8c', thickness: 0.01, height: 1.05, podChance: 0.4 };
    } else if (fillKind.value === 'firecracker') {
      layer.fill = { kind: 'firecracker', color: '#e0954a', fuse: 0.08, barWidth: 0.5, barLen: 0.4 };
    } else if (fillKind.value === 'comb') {
      layer.fill = { kind: 'comb', profile: 'square', color: '#4a6fb0', teeth: 14, amp: 0.3 };
    } else if (fillKind.value === 'solid') {
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
    } else if (fillKind.value === 'manhattan') {
      layer.fill = { kind: 'manhattan', mode: 'fixed', color: '#ffffff', density: 0.66, pixel: 0.16 };
    } else if (fillKind.value === 'flower-seal') {
      layer.fill = { kind: 'flower-seal', petals: 5, sealSize: 0.95, petalSize: 0.42, petalOffset: 0.55, centerSize: 0.45, dotSize: 0.18 };
    } else {
      layer.fill = { kind: 'triangles', mode: 'random', strokeWidth: 0.02, stroke: '#ffffff' };
    }
    onChange();
    rebuild();
  });

  if (layer.fill.kind === 'solid') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle', 'checker', 'random', 'cell'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#8a8a8a', (v) => { layer.fill.color = v; onChange(); });
    }
  } else if (layer.fill.kind === 'shape') {
    const shapeKind = addCtrl('shape', 'select', layer.fill.shape?.kind || 'circle', {
      options: ['circle', 'square', 'triangle', 'right-triangle', 'diamond', 'text', 'star', 'quatrefoil', 'spike', 'lens', 'onion', 'flower', 'blossom', 'barbell', 'plus', 'cross', 'quadDots', 'jacks'],
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
    const dens = addCtrl('density', 'number', layer.fill.density ?? 1, { min: 0, max: 1, step: 0.05 });
    dens.addEventListener('input', () => { layer.fill.density = Number(dens.value); onChange(); });
    const strokeW = addCtrl('stroke (× cell)', 'number', layer.fill.shape?.strokeWidth ?? 0, { min: 0, max: 0.3, step: 0.005 });
    strokeW.addEventListener('input', () => {
      const was = (layer.fill.shape?.strokeWidth ?? 0) > 0;
      const v = Number(strokeW.value);
      layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), strokeWidth: v };
      onChange();
      if (was !== (v > 0)) rebuild();
    });
    if ((layer.fill.shape?.strokeWidth ?? 0) > 0) {
      const sMode = addCtrl('stroke colour', 'select', layer.fill.shape?.strokeMode || 'fixed', {
        options: ['fixed', 'palette-cycle', 'checker', 'random'],
      });
      sMode.addEventListener('change', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), strokeMode: sMode.value };
        onChange();
        rebuild();
      });
      if ((layer.fill.shape?.strokeMode || 'fixed') === 'fixed') {
        addColorCtrl('stroke color', layer.fill.shape?.stroke ?? '#000000', (v) => {
          layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), stroke: v };
          onChange();
        });
      }
    }
    const rot = addCtrl('rotate°', 'number', layer.fill.shape?.rotate ?? 0, { min: -180, max: 180, step: 5 });
    rot.addEventListener('input', () => {
      layer.fill.shape = { ...(layer.fill.shape || { kind: 'circle' }), rotate: Number(rot.value) };
      onChange();
    });
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
    if (layer.fill.shape?.kind === 'spike') {
      const asp = addCtrl('aspect (h/w)', 'number', layer.fill.shape?.aspect ?? 4, { min: 1, max: 12, step: 0.25 });
      asp.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'spike' }), aspect: Number(asp.value) };
        onChange();
      });
      const tap = addCtrl('taper (bot/top)', 'number', layer.fill.shape?.taper ?? 0.3, { min: 0, max: 1, step: 0.05 });
      tap.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'spike' }), taper: Number(tap.value) };
        onChange();
      });
    }
    if (layer.fill.shape?.kind === 'lens') {
      const rt = addCtrl('ratio (w/h)', 'number', layer.fill.shape?.ratio ?? 0.5, { min: 0.1, max: 1.5, step: 0.05 });
      rt.addEventListener('input', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'lens' }), ratio: Number(rt.value) };
        onChange();
      });
    }
    if (layer.fill.shape?.kind === 'blossom') {
      const bp = addCtrl('petals', 'number', layer.fill.shape?.petals ?? 5, { min: 4, max: 12, step: 1 });
      bp.addEventListener('input', () => { layer.fill.shape = { ...(layer.fill.shape || { kind: 'blossom' }), petals: Number(bp.value) | 0 }; onChange(); });
      addColorCtrl('center', layer.fill.shape?.centerColor ?? '#ffffff', (v) => { layer.fill.shape = { ...(layer.fill.shape || { kind: 'blossom' }), centerColor: v }; onChange(); });
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
      // Font family — generic plus a curated set of Google Fonts that
      // are fetched on demand when chosen.
      const fontOpts = [...GENERIC_FONTS, ...GOOGLE_FONTS];
      const cur = layer.fill.shape?.fontFamily || 'sans-serif';
      const font = addCtrl('font', 'select', fontOpts.includes(cur) ? cur : 'sans-serif', { options: fontOpts });
      font.addEventListener('change', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'text' }), fontFamily: font.value };
        ensureFont(font.value).then(onChange);
        onChange();
      });
      const weight = addCtrl('weight', 'select', String(layer.fill.shape?.fontWeight ?? 'bold'), { options: ['400', '700', '900', 'bold'] });
      weight.addEventListener('change', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'text' }), fontWeight: weight.value };
        onChange();
      });
      const style = addCtrl('style', 'select', layer.fill.shape?.fontStyle ?? 'italic', { options: ['normal', 'italic'] });
      style.addEventListener('change', () => {
        layer.fill.shape = { ...(layer.fill.shape || { kind: 'text' }), fontStyle: style.value };
        onChange();
      });
    }
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'palette-cycle', { options: ['fixed', 'palette-cycle', 'checker', 'random', 'cell'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'palette-cycle') === 'fixed') {
      addColorCtrl('color', layer.fill.color || '#8a8a8a', (v) => { layer.fill.color = v; onChange(); });
    }
  } else if (layer.fill.kind === 'triangles') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'random', { options: ['fixed', 'palette-cycle', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    const orient = addCtrl('orient', 'select', layer.fill.orient || 'horizontal', { options: ['horizontal', 'vertical'] });
    orient.addEventListener('change', () => { layer.fill.orient = orient.value; onChange(); });
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
  } else if (layer.fill.kind === 'pinwheel') {
    const sp = addCtrl('spin (¼ turn)', 'number', layer.fill.spin ?? 0, { min: 0, max: 3, step: 1 });
    sp.addEventListener('input', () => { layer.fill.spin = Number(sp.value) | 0; onChange(); });
    addColorCtrl('ground', layer.fill.ground ?? 'transparent', (v) => { layer.fill.ground = v; onChange(); });
  } else if (layer.fill.kind === 'multiform') {
    const dn = addCtrl('density', 'number', layer.fill.density ?? 0.82, { min: 0, max: 1, step: 0.05 });
    dn.addEventListener('input', () => { layer.fill.density = Number(dn.value); onChange(); });
  } else if (layer.fill.kind === 'comb' && !layer.fill.profiles) {
    const pf = addCtrl('profile', 'select', layer.fill.profile || 'square', { options: ['square', 'triangle', 'round', 'crown', 'flame', 'checker', 'angle'] });
    pf.addEventListener('change', () => { layer.fill.profile = pf.value; onChange(); });
    addColorCtrl('color', layer.fill.color || '#4a6fb0', (v) => { layer.fill.color = v; onChange(); });
    const tt = addCtrl('teeth', 'number', layer.fill.teeth ?? 14, { min: 2, max: 40, step: 1 });
    tt.addEventListener('input', () => { layer.fill.teeth = Number(tt.value) | 0; onChange(); });
    const ap = addCtrl('depth', 'number', layer.fill.amp ?? 0.3, { min: 0.05, max: 0.48, step: 0.02 });
    ap.addEventListener('input', () => { layer.fill.amp = Number(ap.value); onChange(); });
  } else if (layer.fill.kind === 'firecracker') {
    addColorCtrl('color', layer.fill.color || '#e0954a', (v) => { layer.fill.color = v; onChange(); });
    const fz = addCtrl('fuse', 'number', layer.fill.fuse ?? 0.08, { min: 0.02, max: 0.3, step: 0.01 });
    fz.addEventListener('input', () => { layer.fill.fuse = Number(fz.value); onChange(); });
    const bw = addCtrl('bar height', 'number', layer.fill.barWidth ?? 0.5, { min: 0.1, max: 1, step: 0.05 });
    bw.addEventListener('input', () => { layer.fill.barWidth = Number(bw.value); onChange(); });
    const bl = addCtrl('bar length', 'number', layer.fill.barLen ?? 0.4, { min: 0.1, max: 0.5, step: 0.02 });
    bl.addEventListener('input', () => { layer.fill.barLen = Number(bl.value); onChange(); });
  } else if (layer.fill.kind === 'grass') {
    addColorCtrl('blade', layer.fill.color || '#3f7a8c', (v) => { layer.fill.color = v; onChange(); });
    const th = addCtrl('thickness', 'number', layer.fill.thickness ?? 0.01, { min: 0.003, max: 0.04, step: 0.002 });
    th.addEventListener('input', () => { layer.fill.thickness = Number(th.value); onChange(); });
    const ht = addCtrl('height', 'number', layer.fill.height ?? 1.05, { min: 0.4, max: 1.6, step: 0.05 });
    ht.addEventListener('input', () => { layer.fill.height = Number(ht.value); onChange(); });
    const pc = addCtrl('pod chance', 'number', layer.fill.podChance ?? 0.4, { min: 0, max: 1, step: 0.05 });
    pc.addEventListener('input', () => { layer.fill.podChance = Number(pc.value); onChange(); });
  } else if (layer.fill.kind === 'graph') {
    addColorCtrl('line', layer.fill.stroke || '#8a9a4a', (v) => { layer.fill.stroke = v; onChange(); });
    const sw = addCtrl('line width', 'number', layer.fill.strokeWidth ?? 0.012, { min: 0.003, max: 0.05, step: 0.002 });
    sw.addEventListener('input', () => { layer.fill.strokeWidth = Number(sw.value); onChange(); });
    const off = addCtrl('offsets', 'text', (layer.fill.offsets || []).join(', '), {});
    off.placeholder = '0, 0, 0.6, 0, 0.6, 0';
    off.addEventListener('input', () => {
      const list = off.value.split(',').map(s => Number(s.trim())).filter(n => isFinite(n));
      if (list.length) { layer.fill.offsets = list; onChange(); }
    });
  } else if (layer.fill.kind === 'fruit') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'random', { options: ['random', 'cell'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); });
    const dn = addCtrl('density', 'number', layer.fill.density ?? 0.78, { min: 0, max: 1, step: 0.05 });
    dn.addEventListener('input', () => { layer.fill.density = Number(dn.value); onChange(); });
    const sz = addCtrl('size', 'number', layer.fill.size ?? 1, { min: 0.4, max: 1.6, step: 0.05 });
    sz.addEventListener('input', () => { layer.fill.size = Number(sz.value); onChange(); });
    const lc = addCtrl('leaf chance', 'number', layer.fill.leafChance ?? 0.26, { min: 0, max: 1, step: 0.05 });
    lc.addEventListener('input', () => { layer.fill.leafChance = Number(lc.value); onChange(); });
    addColorCtrl('stalk', layer.fill.stalk || '#4f4a22', (v) => { layer.fill.stalk = v; onChange(); });
    addColorCtrl('leaf', layer.fill.leaf || '#7d9a40', (v) => { layer.fill.leaf = v; onChange(); });
  } else if (layer.fill.kind === 'honeycomb') {
    addColorCtrl('line', layer.fill.stroke || '#3a4aa0', (v) => { layer.fill.stroke = v; onChange(); });
    const sw = addCtrl('line width', 'number', layer.fill.strokeWidth ?? 0.03, { min: 0.005, max: 0.12, step: 0.005 });
    sw.addEventListener('input', () => { layer.fill.strokeWidth = Number(sw.value); onChange(); });
  } else if (layer.fill.kind === 'dashes') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'random', { options: ['fixed', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'random') === 'fixed') {
      addColorCtrl('mark', layer.fill.color || '#d2624d', (v) => { layer.fill.color = v; onChange(); });
    }
    const dn = addCtrl('density', 'number', layer.fill.density ?? 0.5, { min: 0, max: 1, step: 0.05 });
    dn.addEventListener('input', () => { layer.fill.density = Number(dn.value); onChange(); });
    const wd = addCtrl('mark width', 'number', layer.fill.width ?? 0.4, { min: 0.1, max: 1, step: 0.05 });
    wd.addEventListener('input', () => { layer.fill.width = Number(wd.value); onChange(); });
  } else if (layer.fill.kind === 'windowpane') {
    addColorCtrl('v line', layer.fill.vColor || '#b7bbc0', (v) => { layer.fill.vColor = v; onChange(); });
    addColorCtrl('h stitch', layer.fill.hColor || '#9aa0a6', (v) => { layer.fill.hColor = v; onChange(); });
    const vw = addCtrl('v width', 'number', layer.fill.vWidth ?? 0.016, { min: 0.004, max: 0.06, step: 0.002 });
    vw.addEventListener('input', () => { layer.fill.vWidth = Number(vw.value); onChange(); });
    const hw = addCtrl('h width', 'number', layer.fill.hWidth ?? 0.018, { min: 0.004, max: 0.06, step: 0.002 });
    hw.addEventListener('input', () => { layer.fill.hWidth = Number(hw.value); onChange(); });
    const am = addCtrl('stitch amp', 'number', layer.fill.amp ?? 0.04, { min: 0.01, max: 0.15, step: 0.005 });
    am.addEventListener('input', () => { layer.fill.amp = Number(am.value); onChange(); });
    const jt = addCtrl('jitter', 'number', layer.fill.jitter ?? 0.12, { min: 0, max: 0.5, step: 0.02 });
    jt.addEventListener('input', () => { layer.fill.jitter = Number(jt.value); onChange(); });
  } else if (layer.fill.kind === 'weave') {
    const gp = addCtrl('thread gap', 'number', layer.fill.gap ?? 0.14, { min: 0, max: 0.4, step: 0.02 });
    gp.addEventListener('input', () => { layer.fill.gap = Number(gp.value); onChange(); });
    const rd = addCtrl('thread round', 'number', layer.fill.round ?? 0.4, { min: 0, max: 0.5, step: 0.05 });
    rd.addEventListener('input', () => { layer.fill.round = Number(rd.value); onChange(); });
    const nz = addCtrl('fibre noise', 'number', layer.fill.noise ?? 0.13, { min: 0, max: 0.4, step: 0.02 });
    nz.addEventListener('input', () => { layer.fill.noise = Number(nz.value); onChange(); });
  } else if (layer.fill.kind === 'twigs') {
    const th = addCtrl('thickness', 'number', layer.fill.thickness ?? 0.03, { min: 0.008, max: 0.08, step: 0.004 });
    th.addEventListener('input', () => { layer.fill.thickness = Number(th.value); onChange(); });
    const ht = addCtrl('height', 'number', layer.fill.height ?? 0.92, { min: 0.4, max: 1.2, step: 0.04 });
    ht.addEventListener('input', () => { layer.fill.height = Number(ht.value); onChange(); });
    const tw = addCtrl('twig length', 'number', layer.fill.twig ?? 0.78, { min: 0.3, max: 1.4, step: 0.05 });
    tw.addEventListener('input', () => { layer.fill.twig = Number(tw.value); onChange(); });
  } else if (layer.fill.kind === 'stones') {
    addColorCtrl('stone', layer.fill.color || '#efe9dc', (v) => { layer.fill.color = v; onChange(); });
    const gap = addCtrl('gap', 'number', layer.fill.gap ?? 0.18, { min: 0, max: 0.45, step: 0.01 });
    gap.addEventListener('input', () => { layer.fill.gap = Number(gap.value); onChange(); });
    const rd = addCtrl('round', 'number', layer.fill.round ?? 0.6, { min: 0, max: 1, step: 0.05 });
    rd.addEventListener('input', () => { layer.fill.round = Number(rd.value); onChange(); });
    const jt = addCtrl('jitter', 'number', layer.fill.jitter ?? 0.08, { min: 0, max: 0.3, step: 0.01 });
    jt.addEventListener('input', () => { layer.fill.jitter = Number(jt.value); onChange(); });
    const sj = addCtrl('size jitter', 'number', layer.fill.sizeJitter ?? 0.22, { min: 0, max: 0.5, step: 0.02 });
    sj.addEventListener('input', () => { layer.fill.sizeJitter = Number(sj.value); onChange(); });
    const rj = addCtrl('round jitter', 'number', layer.fill.roundJitter ?? 0.3, { min: 0, max: 0.5, step: 0.05 });
    rj.addEventListener('input', () => { layer.fill.roundJitter = Number(rj.value); onChange(); });
  } else if (layer.fill.kind === 'glyph') {
    addColorCtrl('ink', layer.fill.ink || '#21242b', (v) => { layer.fill.ink = v; onChange(); });
    addColorCtrl('paper', layer.fill.paper || '#f3ede0', (v) => { layer.fill.paper = v; onChange(); });
    const inv = addCtrl('invert prob', 'number', layer.fill.invert ?? 0.5, { min: 0, max: 1, step: 0.05 });
    inv.addEventListener('input', () => { layer.fill.invert = Number(inv.value); onChange(); });
    const wt = addCtrl('bar weight', 'number', layer.fill.weight ?? 0.22, { min: 0.08, max: 0.4, step: 0.02 });
    wt.addEventListener('input', () => { layer.fill.weight = Number(wt.value); onChange(); });
  } else if (layer.fill.kind === 'manhattan') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle', 'checker', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addColorCtrl('ink', layer.fill.color || '#ffffff', (v) => { layer.fill.color = v; onChange(); });
    }
    const den = addCtrl('density', 'number', layer.fill.density ?? 0.66, { min: 0, max: 1, step: 0.02 });
    den.addEventListener('input', () => { layer.fill.density = Number(den.value); onChange(); });
    const px = addCtrl('pixel (× cell)', 'number', layer.fill.pixel ?? 0.16, { min: 0.04, max: 0.5, step: 0.01 });
    px.addEventListener('input', () => { layer.fill.pixel = Number(px.value); onChange(); });
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
    // If any layer uses a web font, load it then redraw once it's ready
    // (SVG text needs the face present to measure/paint correctly).
    const fonts = patternFonts(pattern);
    if (fonts.length) {
      Promise.all(fonts.map(ensureFont)).then(() => {
        stage.replaceChildren(buildSvg(pattern));
      });
    }
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
