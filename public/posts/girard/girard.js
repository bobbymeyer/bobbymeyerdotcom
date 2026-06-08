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
const defaultPattern = () => {
  // Parametric palette: paletteSpec describes the relationships, the
  // colorways map carries one (base, anchored-overrides) per name.
  // pattern.palette is derived from the active colorway each render.
  const seedHexes = ['#e94e3b', '#f5e9d0', '#f4c44b', '#1f6b8a', '#2c3e50'];
  const spec = inferPaletteSpec(seedHexes);
  const colorways = buildColorways(spec, { main: seedHexes });
  const pat = {
  seed: 1,
  tileSize: 480,
  repeat: 'square',                                  // square | half-drop | half-brick
  paletteSpec: spec,
  colorways,
  activeColorway: 'main',
  palette: [],                                       // filled by refreshPaletteFromSpec below
  surroundVeil: 0.2,
  // Project-level colour mode. 'srgb' shows RGB pickers; 'cmyk' adds
  // CMYK readouts on every picker and exports targets the chosen
  // profile. Pickers and rendering still use sRGB hex internally; the
  // CMYK fields are derived (and stored back) via conversion.
  colorMode: 'srgb',
  // Region-flavoured CMYK profile to target on export. Only used when
  // colorMode === 'cmyk'. Without the heavy ICC profiler loaded we use
  // a fast math conversion; selecting a profile + loading the profiler
  // enables ICC-accurate conversion.
  iccProfile: 'sRGB IEC61966-2.1',
  // Soft-proof preview: when on and the ICC profiler is loaded, the
  // stage colours are routed through the profile's RGB→CMYK→RGB round
  // trip before painting. The result simulates on-screen what the
  // pattern will look like printed (slight desat / hue shift / dot-
  // gain bloom in midtones).
  softProof: false,
  // Export controls (live on the pattern so they survive sample loads).
  exportWidth: 1024,
  exportFlatten: false,
  exportBackground: '#ffffff',
  // User-imported custom shapes, keyed by name. Each entry is
  // { viewBox: [vx, vy, vw, vh], paths: [{ d }] }. Layers reference
  // them via fill.shape.kind = `custom:NAME`.
  customShapes: {},
  // Physical size of one repeat. Pixels are the rendering unit; this
  // is the printed scale of one tile. Used by the units overlay and
  // by features that need real-world scale (yardage preview, future
  // bleed marks). Unit defaults to inches — most US textile work —
  // and 24 in is a fair default repeat for upholstery / drapery.
  physicalRepeat: 24,
  physicalUnit: 'in',
  layers: [
    makeLayer('solid'),
  ],
  };
  refreshPaletteFromSpec(pat);
  return pat;
};

// ---------- Colour conversions ----------
// Two conversion paths:
//   - Naive: linear (1-R-K)/(1-K). Cheap, always available, used by
//     default. Saturated colours drift visibly on press.
//   - Profile-aware: gamma-correct sRGB decode, smooth K-generation,
//     per-profile ink limits + black-point parameters. Closer to what
//     an actual SWOP / FOGRA / GRACoL / Japan Color press produces.
//     Enabled when the user clicks "Load ICC Profiler". Still an
//     approximation (true colorimetric accuracy needs a full ICC v4
//     parser + LUT transform — that lands next pass with bundled
//     profile binaries) but a real step up.

// sRGB ⇄ linear gamma (IEC 61966-2.1 transfer function).
function srgbToLinear(v) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}
function linearToSrgb(v) {
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

// ---------- OKLCH + colour theory ----------
// Björn Ottosson's OKLab transform — perceptually uniform, so equal
// hue steps look equal and lightness ramps step evenly. Used to drive
// the palette generators (mono / analogous / complementary / etc.)
// so the output reads as a designed palette, not a numeric stunt.
function linearRgbToOklab(r, g, b) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}
function oklabToLinearRgb(L, a, b) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
  return [
     4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
}
function hexToOklch(hex) {
  const c = parseColor(hex);
  const lr = srgbToLinear(c.r / 255);
  const lg = srgbToLinear(c.g / 255);
  const lb = srgbToLinear(c.b / 255);
  const [L, a, b] = linearRgbToOklab(lr, lg, lb);
  const C = Math.hypot(a, b);
  let H = (Math.atan2(b, a) * 180) / Math.PI;
  if (H < 0) H += 360;
  return [L, C, H];
}
function oklchToHex(L, C, H) {
  const rad = (H * Math.PI) / 180;
  const a = C * Math.cos(rad), b = C * Math.sin(rad);
  const [lr, lg, lb] = oklabToLinearRgb(L, a, b);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const to8 = (lv) => Math.round(linearToSrgb(clamp(lv)) * 255);
  return '#' + [to8(lr), to8(lg), to8(lb)].map(v => v.toString(16).padStart(2, '0')).join('');
}

// Colour-theory palette schemes. Each takes (baseHex, count) and
// returns a list of hex colours. Lightness / chroma profiles favour
// readability over saturation; ramps span roughly 0.22 → 0.92 L for
// good print contrast. Schemes are designed to be deterministic, not
// random — random palettes are still available via the existing roll.
const PALETTE_SCHEMES = {
  mono: (base, n) => {
    // Single hue / chroma, stepped lightness — useful for shade
    // variants of a single ink colour.
    const [, C, H] = hexToOklch(base);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      out.push(oklchToHex(0.92 - t * 0.7, C, H));
    }
    return out;
  },
  analogous: (base, n) => {
    // Hues spanning ±30° around the base.
    const [L, C, H] = hexToOklch(base);
    const span = 60;
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      out.push(oklchToHex(L, C, (H + (t - 0.5) * span + 360) % 360));
    }
    return out;
  },
  complement: (base, n) => {
    // Two hues 180° apart, alternating, with mild lightness offsets
    // for separation.
    const [L, C, H] = hexToOklch(base);
    const H2 = (H + 180) % 360;
    const out = [];
    for (let i = 0; i < n; i++) {
      const h = i % 2 === 0 ? H : H2;
      const lv = Math.max(0.18, Math.min(0.94, L + ((i % 2) - 0.5) * 0.18));
      out.push(oklchToHex(lv, C, h));
    }
    return out;
  },
  split: (base, n) => {
    // Base + the two hues flanking its complement (180° ± 30°).
    const [L, C, H] = hexToOklch(base);
    const hues = [H, (H + 150) % 360, (H + 210) % 360];
    return Array.from({ length: n }, (_, i) => oklchToHex(L, C, hues[i % 3]));
  },
  triad: (base, n) => {
    // Three hues 120° apart.
    const [L, C, H] = hexToOklch(base);
    const hues = [H, (H + 120) % 360, (H + 240) % 360];
    return Array.from({ length: n }, (_, i) => oklchToHex(L, C, hues[i % 3]));
  },
  square: (base, n) => {
    // Four hues 90° apart.
    const [L, C, H] = hexToOklch(base);
    const hues = [H, (H + 90) % 360, (H + 180) % 360, (H + 270) % 360];
    return Array.from({ length: n }, (_, i) => oklchToHex(L, C, hues[i % 4]));
  },
  tonal: (base, n) => {
    // Small hue drift, similar value — the muted modernist look.
    const [L, C, H] = hexToOklch(base);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = n > 1 ? i / (n - 1) : 0.5;
      const h = (H + (t - 0.5) * 30 + 360) % 360;
      const lv = L + (Math.sin(t * Math.PI) - 0.5) * 0.1;
      out.push(oklchToHex(Math.max(0.2, Math.min(0.9, lv)), C * 0.85, h));
    }
    return out;
  },
  'value-ramp': (base, n) => {
    // Same hue / chroma, lightness stepped 0.95 → 0.2.
    const [, C, H] = hexToOklch(base);
    return Array.from({ length: n }, (_, i) => {
      const t = n > 1 ? i / (n - 1) : 0.5;
      return oklchToHex(0.95 - t * 0.75, C, H);
    });
  },
  'hue-ramp': (base, n) => {
    // Equal-spaced hues at the base's lightness / chroma — full wheel
    // sweep, useful for high-key crayon palettes.
    const [L, C] = hexToOklch(base);
    return Array.from({ length: n }, (_, i) => oklchToHex(L, C, (i * 360 / n) % 360));
  },
};

// Same schemes expressed as relationship deltas — the new palette
// spec model uses these directly so a scheme written as "+120°" stays
// "+120°" when the base changes. PALETTE_SCHEMES above keeps the
// hex-array form for the legacy generator UI until it's torn down.
const PALETTE_SCHEME_DELTAS = {
  mono: (n) => Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? (i + 1) / (n + 1) : 0.5;
    return { dL: 0.45 - t * 0.9, dC: 0, dH: 0 };
  }),
  analogous: (n) => Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? (i + 1) / (n + 1) : 0.5;
    return { dL: 0, dC: 0, dH: (t - 0.5) * 60 };
  }),
  complement: (n) => Array.from({ length: n }, (_, i) => ({
    dL: (((i % 4) - 1.5) / 1.5) * 0.18,
    dC: 0,
    dH: i % 2 === 0 ? 180 : 0,
  })),
  split: (n) => {
    const hues = [150, 210, 0];
    return Array.from({ length: n }, (_, i) => ({ dL: 0, dC: 0, dH: hues[i % 3] }));
  },
  triad: (n) => {
    const hues = [120, 240, 0];
    return Array.from({ length: n }, (_, i) => ({ dL: 0, dC: 0, dH: hues[i % 3] }));
  },
  square: (n) => {
    const hues = [90, 180, 270, 0];
    return Array.from({ length: n }, (_, i) => ({ dL: 0, dC: 0, dH: hues[i % 4] }));
  },
  tonal: (n) => Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? (i + 1) / (n + 1) : 0.5;
    return { dL: (Math.sin(t * Math.PI) - 0.5) * 0.1, dC: -0.05, dH: (t - 0.5) * 30 };
  }),
  'value-ramp': (n) => Array.from({ length: n }, (_, i) => {
    const t = n > 1 ? (i + 1) / (n + 1) : 0.5;
    return { dL: 0.4 - t * 0.8, dC: 0, dH: 0 };
  }),
  'hue-ramp': (n) => Array.from({ length: n }, (_, i) =>
    ({ dL: 0, dC: 0, dH: ((i + 1) * 360 / (n + 1)) % 360 })
  ),
};

// ---------- Parametric palette spec + colorway resolution ----------
// A palette splits in two: paletteSpec carries the *shape* — which
// role names exist, which swatches track the base via OKLCH deltas,
// which are anchored to a literal hex — and pattern.colorways[name]
// is one { base, overrides } pair in that shape. Switching colorway
// changes the base (tracked swatches recompute) and applies per-
// colorway anchored overrides for the literal ones.
const DEFAULT_PALETTE_ROLES = ['base', 'ground', 'accent-1', 'accent-2', 'ink', 'highlight'];

// Resolve one swatch entry to a hex code given the current base in
// OKLCH and the active colorway's overrides. Precedence is the heart
// of the model: an explicit per-colorway override for this role ALWAYS
// wins (intentional design is never silently overwritten); otherwise
// the role's default fills the blank — a fixed hex for anchored roles,
// or a colour derived from this colorway's base for tracked roles.
function resolveSwatch(swatch, baseOklch, overrides) {
  if (swatch.kind === 'base') return oklchToHex(...baseOklch);
  const ov = overrides && overrides[swatch.role];
  if (ov) return ov;
  if (swatch.kind === 'abs') return swatch.hex || '#888888';
  const L = Math.max(0, Math.min(1, baseOklch[0] + (swatch.dL || 0)));
  const C = Math.max(0, Math.min(0.4, baseOklch[1] + (swatch.dC || 0)));
  const H = ((baseOklch[2] + (swatch.dH || 0)) % 360 + 360) % 360;
  return oklchToHex(L, C, H);
}

// Does a colorway carry an explicit, hand-set colour for this role?
// Used by the matrix to mark cells "explicit" vs "auto" (derived).
function hasExplicitColor(swatch, overrides) {
  return !!(swatch && swatch.role && overrides &&
    Object.prototype.hasOwnProperty.call(overrides, swatch.role));
}

function resolvePalette(pattern) {
  const spec = pattern.paletteSpec;
  if (!spec || !spec.swatches || !spec.swatches.length) {
    return { hexes: pattern.palette || [], byRole: {} };
  }
  const cwName = pattern.activeColorway || Object.keys(pattern.colorways || {})[0];
  const cw = (pattern.colorways && pattern.colorways[cwName]) || { base: '#888888', overrides: {} };
  const base = cw.base || '#888888';
  const overrides = cw.overrides || {};
  const baseOklch = hexToOklch(base);
  const hexes = [];
  const byRole = {};
  for (const sw of spec.swatches) {
    const hex = resolveSwatch(sw, baseOklch, overrides);
    hexes.push(hex);
    if (sw.role) byRole[sw.role] = hex;
  }
  return { hexes, byRole };
}

function refreshPaletteFromSpec(pattern) {
  if (!pattern.paletteSpec) return;
  const { hexes } = resolvePalette(pattern);
  pattern.palette = hexes;
}

// Normalise a colour string to a #rrggbb key for role matching, or ''
// for anything that isn't a plain six-digit hex (transparent, rgba(),
// short hex). Non-hex slots stay literal — we never bind them to a role.
function normHex(c) {
  return typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c) ? c.toLowerCase() : '';
}

// Render-time map of role → resolved hex for the active colourway. Set
// by buildTileGroup each draw (mirrors _currentCustomShapes) so layer
// palettes can bind slots to project roles and follow colourway swaps
// without threading byRole through every render signature.
let _currentByRole = {};

// Render-time map of original authored hex → the active colourway's
// colour for that hex's role. Lets ANY literal fill in the pattern
// (fixed grounds, glyph inks, stalks, …) follow colourway swaps, not
// just palette-bound slots. Rebuilt each draw in buildTileGroup; keyed
// on lowercase #rrggbb (see normHex). Empty = no remapping.
let _recolorMap = {};

// Build the original-hex → current-colour map from the pattern's spec.
// Each swatch carries `orig` (the colour the sample authored for that
// role); _currentByRole gives that role's colour in the active
// colourway. At the unedited colourway this is (near-)identity.
function buildRecolorMap(pattern) {
  const map = {};
  const spec = pattern && pattern.paletteSpec;
  if (!spec || !spec.swatches) return map;
  for (const sw of spec.swatches) {
    const key = normHex(sw.orig);
    if (!key || !sw.role) continue;
    const cur = _currentByRole[sw.role];
    if (cur != null) map[key] = cur;
  }
  return map;
}

// Make the spec cover EVERY colour the layers paint with, so colourway
// edits recolour the whole pattern no matter how it was assembled
// (fresh load, layered-on-top, hand-built, restored). Idempotent:
//   1. backfill `orig` on existing swatches from the current resolved
//      palette (the authored state, captured before any edit), then
//   2. add any layer colour not yet represented as an anchored role.
// Anchored (abs) keeps the added colour rendering as itself until the
// user edits its matrix cell.
function ensureLayerColorsInSpec(pattern) {
  if (!pattern || !pattern.paletteSpec || !pattern.layers) return;
  const spec = pattern.paletteSpec;
  if (!spec.swatches) spec.swatches = [{ role: 'base', kind: 'base' }];
  const { byRole } = resolvePalette(pattern);
  for (const sw of spec.swatches) {
    if (sw.orig == null && sw.role && byRole[sw.role]) sw.orig = byRole[sw.role];
  }
  const known = new Set(spec.swatches.map(s => normHex(s.orig)).filter(Boolean));
  let accentN = spec.swatches.reduce(
    (n, s) => { const m = /^accent-(\d+)$/.exec(s.role || ''); return m ? Math.max(n, +m[1]) : n; }, 0);
  for (const hex of collectColors(pattern.layers)) {
    const k = normHex(hex);
    if (!k || known.has(k)) continue;
    known.add(k);
    spec.swatches.push({ role: `accent-${++accentN}`, kind: 'abs', hex, orig: hex });
  }
}

// Resolve a layer's effective palette for the current draw. A layer
// with no palette of its own inherits the parent palette. A layer that
// carries paletteRoles binds each slot to a project role (so it tracks
// colourway changes); a slot with no role — or whose role is absent
// from the active colourway — falls back to the layer's literal hex.
function resolveLayerPalette(layer, parentPalette) {
  const list = layer.palette;
  if (!list || !list.length) return parentPalette;
  const roles = layer.paletteRoles;
  if (!roles || !roles.length) return list;
  return list.map((hex, i) => {
    const role = roles[i];
    if (role && _currentByRole[role] != null) return _currentByRole[role];
    return hex;
  });
}

// Infer a paletteSpec from a hex array — first colour = base; rest
// get OKLCH deltas (tracked) or anchored hex fallback when the delta
// is "messy" (very low chroma, extreme lightness jump). Roles are
// assigned by lightness extremes (lightest → ground, darkest → ink)
// then sequentially as accent-1, accent-2, …
function inferPaletteSpec(hexes) {
  const list = (hexes || []).filter(Boolean);
  if (list.length === 0) return { swatches: [{ role: 'base', kind: 'base' }] };
  const [bL, bC, bH] = hexToOklch(list[0]);
  const rest = list.slice(1);
  if (rest.length === 0) return { swatches: [{ role: 'base', kind: 'base' }] };
  const meta = rest.map((hex, i) => {
    const [L, C, H] = hexToOklch(hex);
    let dH = H - bH;
    if (dH > 180) dH -= 360;
    if (dH < -180) dH += 360;
    return { hex, i, L, C, H, dL: L - bL, dC: C - bC, dH };
  });
  let lightestIdx = 0, darkestIdx = 0;
  for (let i = 1; i < meta.length; i++) {
    if (meta[i].L > meta[lightestIdx].L) lightestIdx = i;
    if (meta[i].L < meta[darkestIdx].L) darkestIdx = i;
  }
  const swatches = [{ role: 'base', kind: 'base' }];
  let accentN = 0;
  for (const m of meta) {
    let role;
    if (m.i === lightestIdx && m.L > bL + 0.12) role = 'ground';
    else if (m.i === darkestIdx && m.L < bL - 0.12) role = 'ink';
    else { accentN++; role = `accent-${accentN}`; }
    const lowSat = m.C < 0.04;
    const isAnchored = lowSat || (Math.abs(m.dL) > 0.45);
    if (isAnchored) swatches.push({ role, kind: 'abs', hex: m.hex });
    else swatches.push({ role, kind: 'rel', dL: m.dL, dC: m.dC, dH: m.dH });
  }
  return { swatches };
}

// Given a spec and a map of {name → hex array}, produce the new
// colorway entries {name → { base, overrides }}. Tracked swatches
// share the spec's delta across colorways; anchored swatches get
// per-colorway hex overrides pulled from each array's matching slot.
function buildColorways(spec, namedHexArrays) {
  const colorways = {};
  for (const [name, hexes] of Object.entries(namedHexArrays)) {
    const base = (hexes && hexes[0]) || '#888888';
    const overrides = {};
    for (let i = 1; i < spec.swatches.length; i++) {
      const sw = spec.swatches[i];
      if (sw.kind === 'abs' && hexes[i]) overrides[sw.role] = hexes[i];
    }
    colorways[name] = { base, overrides };
  }
  return colorways;
}

// Walk a layer tree and collect every #rrggbb colour it paints with —
// fill.color, inks[], ink/paper, stalk/leaf, strokes, nested layers,
// etc. — in first-seen order. Generic (matches any 6-digit hex string)
// so new fill kinds are covered without bespoke wiring.
function collectColors(node) {
  const out = [];
  const seen = new Set();
  const walk = (v) => {
    if (v == null) return;
    if (typeof v === 'string') {
      const k = normHex(v);
      if (k && !seen.has(k)) { seen.add(k); out.push(v); }
    } else if (Array.isArray(v)) {
      for (const x of v) walk(x);
    } else if (typeof v === 'object') {
      for (const key in v) walk(v[key]);
    }
  };
  walk(node);
  return out;
}

// --- One colour system: a layer's colours all live in layer.palette.
// layer.paletteLabels[i] gives a slot a semantic name ('stalk', 'leaf',
// 'stroke', …); unlabelled slots are the cycling set. Renderers read a
// named colour via fillSlotColor() and the cycling set via cycleColors()
// — both resolve through the active colourway (the passed `palette` is
// the role-resolved layer palette) and fall back to the legacy fill
// field / whole palette when a layer hasn't been migrated. ---
function slotIndex(layer, key) {
  const labels = layer && layer.paletteLabels;
  return labels ? labels.indexOf(key) : -1;
}
function fillSlotColor(layer, fill, palette, key, def) {
  const i = slotIndex(layer, key);
  if (i >= 0 && palette[i] != null) return palette[i];
  let v = fill;                                   // legacy: dotted path
  for (const part of key.split('.')) v = v && v[part];
  return v != null ? v : def;
}
function cycleColors(layer, palette) {
  const labels = layer && layer.paletteLabels;
  if (!labels || !labels.length) return palette;
  const out = palette.filter((_, i) => !labels[i]);
  return out.length ? out : palette;
}

// Fills whose named colours can move into the layer palette without
// disturbing a cycling set (these fills don't cycle the palette). Each
// listed key is migrated to a labelled slot. Cycling fills (solid,
// shape, triangles, fruit, …) are left for a follow-up since their
// accents must coexist with the cycling set.
const FILL_SLOT_SCHEMA = {
  maze: ['color'],
  stones: ['color'],
  firecracker: ['color'],
  grass: ['color'],
  graph: ['stroke'],
  honeycomb: ['stroke'],
  windowpane: ['vColor', 'hColor'],
  fruit: ['stalk', 'leaf'],
  bloom: ['stemColor'],
  solid: ['color'],
  mesh: ['color', 'stroke'],
  voronoi: ['color'],
  manhattan: ['color'],
  triangles: ['color', 'stroke'],
  pinwheel: ['ground'],
  dashes: ['color'],
  comb: ['color'],
};

// Move a fill's legacy named colour fields into labelled layer.palette
// slots (the single colour system), then drop the old fields. Idempotent;
// recurses into nested layers.
function seedFillPalette(l) {
  if (!l) return;
  const f = l.fill;
  const keys = f && FILL_SLOT_SCHEMA[f.kind];
  if (keys) {
    if (!l.palette) l.palette = [];
    if (!l.paletteLabels) l.paletteLabels = l.palette.map(() => null);
    while (l.paletteLabels.length < l.palette.length) l.paletteLabels.push(null);
    for (const key of keys) {
      if (l.paletteLabels.includes(key)) continue;
      if (f[key] == null) continue;
      l.palette.push(f[key]);
      l.paletteLabels.push(key);
      delete f[key];
    }
  }
  if (f && f.layer) seedFillPalette(f.layer);
}

// Migrate a glyph layer's legacy colour fields (inks / ink+paper) into
// the layer palette, then drop them so colour lives in ONE place. Adds
// `twoTone` to preserve the transparent-ground look the `inks` array
// used to imply. Recurses into nested layers. Idempotent.
function seedGlyphPalette(l) {
  if (!l) return;
  const f = l.fill;
  if (f && f.kind === 'glyph') {
    if (f.twoTone == null) f.twoTone = !!(f.inks && f.inks.length);
    if (!l.palette || !l.palette.length) {
      l.palette = (f.inks && f.inks.length)
        ? [...f.inks]
        : [f.ink || '#21242b', f.paper || '#f3ede0'];
    }
    delete f.inks; delete f.ink; delete f.paper;
  }
  if (f && f.layer) seedGlyphPalette(f.layer);
}

// Dedupe a hex list down to distinct #rrggbb (dropping transparents /
// short hex, which can't be project roles), keeping first-seen order.
function dedupeHex(hexes) {
  const out = [];
  const seen = new Set();
  for (const h of hexes || []) {
    const k = normHex(h);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(h);
  }
  return out;
}

// Per-profile parameters governing K generation, total ink limit, and
// black-point offset. Values picked to roughly match published TVI
// (tone value increase) and TAC behaviour for each profile.
// Per-profile parameters governing K generation, total ink limit, TVI
// (tone value increase = dot gain), and black-point offset. TVI values
// represent the additional ink density a 50% commanded dot prints as,
// approximated as gain50 ≈ printed - commanded at the curve peak.
// Sourced from published characterization data for each ISO/SWOP/FOGRA
// reference. CMYK printers typically run higher TVI on coated stock
// than uncoated — the values here target coated runs.
const PROFILE_PARAMS = {
  'sRGB IEC61966-2.1':           { tac: 4.00, kStart: 0.00, kStrength: 1.00, blackPoint: 0.00, tviC: 0.00, tviM: 0.00, tviY: 0.00, tviK: 0.00 },
  'U.S. Web Coated (SWOP) v2':   { tac: 3.00, kStart: 0.30, kStrength: 0.95, blackPoint: 0.04, tviC: 0.18, tviM: 0.18, tviY: 0.14, tviK: 0.20 },
  'GRACoL2006_Coated1v2':        { tac: 3.40, kStart: 0.50, kStrength: 0.82, blackPoint: 0.02, tviC: 0.15, tviM: 0.15, tviY: 0.12, tviK: 0.17 },
  'FOGRA39':                     { tac: 3.30, kStart: 0.35, kStrength: 0.92, blackPoint: 0.04, tviC: 0.14, tviM: 0.14, tviY: 0.10, tviK: 0.16 },
  'FOGRA51':                     { tac: 3.20, kStart: 0.45, kStrength: 0.88, blackPoint: 0.02, tviC: 0.12, tviM: 0.12, tviY: 0.10, tviK: 0.14 },
  'Japan Color 2001 Coated':     { tac: 3.50, kStart: 0.25, kStrength: 0.98, blackPoint: 0.05, tviC: 0.20, tviM: 0.20, tviY: 0.16, tviK: 0.22 },
};

// Inverse TVI: given target printed density, return the command ink
// such that running it through a press with this gain produces the
// target. Modeled as ink - gain * sin(πink)/2 — peaks at 50%, zero at
// 0/100%. This is the standard sine-based ISO 12642 approximation.
function tviCompensate(ink, gain) {
  if (gain <= 0 || ink <= 0 || ink >= 1) return Math.max(0, Math.min(1, ink));
  return Math.max(0, Math.min(1, ink - gain * Math.sin(Math.PI * ink) / 2));
}
// Forward TVI: given command ink, return apparent printed density.
function tviApply(ink, gain) {
  if (gain <= 0 || ink <= 0 || ink >= 1) return Math.max(0, Math.min(1, ink));
  return Math.max(0, Math.min(1, ink + gain * Math.sin(Math.PI * ink) / 2));
}

// Naive RGB→CMYK (fallback / fast path).
function naiveRgbToCmyk(r, g, b) {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k >= 1 - 1e-6) return { c: 0, m: 0, y: 0, k: 1 };
  const c = (1 - R - k) / (1 - k);
  const m = (1 - G - k) / (1 - k);
  const y = (1 - B - k) / (1 - k);
  return { c, m, y, k };
}
// Profile-aware RGB→CMYK. Steps:
//   1. sRGB → linear (gamma decode) so the maths reflect actual light.
//   2. Compute "ink density" 1 - linear; pick K as the shared minimum
//      ink, scaled in via a smooth threshold (kStart..1) and strength
//      so neutrals print mostly K (no muddy CMY mix), and saturated
//      tones keep more colour ink. This is a perceptual approximation
//      of the K-generation curves real ICC profiles encode.
//   3. CMY = remaining ink after removing K.
//   4. Enforce total ink limit (TAC) by scaling all four channels
//      down proportionally if they overshoot — keeps ink load printable.
//   5. blackPoint adds a small lift so 0% ink doesn't map to perfect
//      paper (press-realistic dot gain).
//   6. TVI pre-compensation: invert the press's dot-gain curve per
//      channel so the COMMANDED ink, after the press's gain, prints
//      at the target density.
function profileRgbToCmyk(r, g, b, profileId) {
  const user = iccProfiler.userProfiles.get(profileId);
  if (user && user.parsed) {
    const cmyk = lutRgbToCmyk(r, g, b, user.parsed);
    if (cmyk) return cmyk;
  }
  const p = PROFILE_PARAMS[profileId] || PROFILE_PARAMS['U.S. Web Coated (SWOP) v2'];
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  const cInk = 1 - R, mInk = 1 - G, yInk = 1 - B;
  const minInk = Math.min(cInk, mInk, yInk);
  // Smooth K generation: 0% K below kStart, linearly rising to kStrength·minInk above.
  const t = Math.max(0, (minInk - p.kStart) / Math.max(1e-6, 1 - p.kStart));
  let k = p.kStrength * minInk * (t * t * (3 - 2 * t));   // smoothstep ease
  // CMY = ink minus the K we generated, clamped at 0.
  let c = Math.max(0, cInk - k);
  let m = Math.max(0, mInk - k);
  let y = Math.max(0, yInk - k);
  // Total area coverage limit (TAC).
  const total = c + m + y + k;
  if (total > p.tac) {
    const scale = p.tac / total;
    c *= scale; m *= scale; y *= scale; k *= scale;
  }
  // Black-point lift so 0% ink ≠ perfect paper.
  const bp = p.blackPoint;
  c = Math.min(1, c + bp * (1 - c));
  m = Math.min(1, m + bp * (1 - m));
  y = Math.min(1, y + bp * (1 - y));
  k = Math.min(1, k + bp * (1 - k));
  // Pre-compensate for the press's dot gain so the COMMANDED ink,
  // after the press's TVI curve, lands at our target density.
  return {
    c: tviCompensate(c, p.tviC),
    m: tviCompensate(m, p.tviM),
    y: tviCompensate(y, p.tviY),
    k: tviCompensate(k, p.tviK),
  };
}
// Profile-aware CMYK→RGB: invert the gamma-aware transform. Forward
// TVI on the command ink to recover printed density, reverse BP lift,
// merge K back into CMY, then linear → sRGB encode.
function profileCmykToRgb(c, m, y, k, profileId) {
  const user = iccProfiler.userProfiles.get(profileId);
  if (user && user.parsed) {
    const rgb = lutCmykToRgb(c, m, y, k, user.parsed);
    if (rgb) return rgb;
  }
  const p = PROFILE_PARAMS[profileId] || PROFILE_PARAMS['U.S. Web Coated (SWOP) v2'];
  // Forward TVI: command ink → apparent printed density.
  c = tviApply(c, p.tviC);
  m = tviApply(m, p.tviM);
  y = tviApply(y, p.tviY);
  k = tviApply(k, p.tviK);
  const unBp = (v) => Math.max(0, (v - p.blackPoint) / Math.max(1e-6, 1 - p.blackPoint));
  const cc = unBp(c), mm = unBp(m), yy = unBp(y), kk = unBp(k);
  // CMY + K each contribute ink; add K back so total ink density per
  // channel is the original CMY + K.
  const cInk = Math.min(1, cc + kk);
  const mInk = Math.min(1, mm + kk);
  const yInk = Math.min(1, yy + kk);
  const R = linearToSrgb(1 - cInk);
  const G = linearToSrgb(1 - mInk);
  const B = linearToSrgb(1 - yInk);
  return { r: Math.round(R * 255), g: Math.round(G * 255), b: Math.round(B * 255) };
}

// Dispatchers: route to profile-aware or naive based on profiler state.
function rgbToCmyk(r, g, b, profileId) {
  if (iccProfiler.loaded) return profileRgbToCmyk(r, g, b, profileId || iccProfiler.profileId);
  return naiveRgbToCmyk(r, g, b);
}
function cmykToRgb(c, m, y, k, profileId) {
  if (iccProfiler.loaded) return profileCmykToRgb(c, m, y, k, profileId || iccProfiler.profileId);
  return { r: Math.round(255 * (1 - c) * (1 - k)),
           g: Math.round(255 * (1 - m) * (1 - k)),
           b: Math.round(255 * (1 - y) * (1 - k)) };
}
function hexToCmyk(hex, profileId) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { c: 0, m: 0, y: 0, k: 0 };
  const n = parseInt(m[1], 16);
  return rgbToCmyk((n >> 16) & 255, (n >> 8) & 255, n & 255, profileId);
}
function cmykToHex(c, m, y, k, profileId) {
  const { r, g, b } = cmykToRgb(c, m, y, k, profileId);
  const x = (1 << 24) | (r << 16) | (g << 8) | b;
  return '#' + x.toString(16).slice(1);
}

// Catalogue of region-flavoured CMYK targets. Display labels include
// the region so the user can pick by where they're printing.
const ICC_PROFILES = [
  { id: 'sRGB IEC61966-2.1', label: 'sRGB (screen / digital)' },
  { id: 'U.S. Web Coated (SWOP) v2', label: 'SWOP v2 — US web coated' },
  { id: 'GRACoL2006_Coated1v2', label: 'GRACoL 2006 — US sheetfed' },
  { id: 'FOGRA39', label: 'FOGRA39 — EU coated' },
  { id: 'FOGRA51', label: 'FOGRA51 — EU coated (PSO v3)' },
  { id: 'Japan Color 2001 Coated', label: 'Japan Color 2001 — JP coated' },
];

// Lazy state for the ICC profiler. Loading is real (the better
// conversion is gated behind the loaded flag and the chosen profile);
// the actual ICC v4 binary parser lands next pass for true
// colorimetric accuracy. Today's "loaded" state gives gamma-correct,
// K-generated, ink-limited per-profile maths — meaningfully better
// than the naive (1-R-K)/(1-K) formula, but still an approximation.
const iccProfiler = {
  loaded: false,
  loading: false,
  profileId: null,
  // userProfiles: profileId → { bytes, parsed } for ICC files the user
  // dropped in via the file picker. When a profileId has a real
  // userProfile, profileRgbToCmyk / profileCmykToRgb route through its
  // LUT instead of the synthesised math, and the PDF/TIFF embedders
  // inline the original bytes.
  userProfiles: new Map(),
  load: function(profileId) {
    if (this.loaded) { this.profileId = profileId; return Promise.resolve(); }
    if (this.loading) return Promise.resolve();
    this.loading = true;
    return new Promise(resolve => {
      setTimeout(() => {
        this.loaded = true;
        this.loading = false;
        this.profileId = profileId;
        resolve();
      }, 80);
    });
  },
};

// ---------- ICC v2 LUT parser ----------
// Parses the bare minimum of an ICC profile to drive colour transforms:
// header, tag table, and the mft1 (LUT8) / mft2 (LUT16) tags for A2B0
// (device → PCS) and B2A0 (PCS → device). v4 mAB / mBA aren't handled;
// most CMYK shop profiles still ship as v2 lut*Type tables. Returns
// null on any unsupported shape so callers fall back to the synthesised
// math without losing the profile binding.
function parseIccProfile(bytes) {
  if (!bytes || bytes.length < 128) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const readU32 = (o) => dv.getUint32(o, false);   // ICC is big-endian
  const readU16 = (o) => dv.getUint16(o, false);
  const readS15Fixed16 = (o) => dv.getInt32(o, false) / 65536;
  const sig = String.fromCharCode(...bytes.slice(36, 40));
  if (sig !== 'acsp') return null;
  const colorSpace = String.fromCharCode(...bytes.slice(16, 20)).trim();
  const pcs = String.fromCharCode(...bytes.slice(20, 24)).trim();
  // Tag table starts at offset 128.
  const tagCount = readU32(128);
  const tags = {};
  for (let i = 0; i < tagCount; i++) {
    const o = 132 + i * 12;
    const name = String.fromCharCode(...bytes.slice(o, o + 4));
    tags[name] = { offset: readU32(o + 4), size: readU32(o + 8) };
  }
  const parseLutTag = (tag) => {
    if (!tag) return null;
    const start = tag.offset;
    const type = String.fromCharCode(...bytes.slice(start, start + 4));
    if (type !== 'mft1' && type !== 'mft2') return null;
    const inChans = bytes[start + 8];
    const outChans = bytes[start + 9];
    const gridSize = bytes[start + 10];
    // 3x3 matrix at start+12 .. start+12+36 (9 s15Fixed16 values).
    const matrix = [];
    for (let i = 0; i < 9; i++) matrix.push(readS15Fixed16(start + 12 + i * 4));
    const is16 = type === 'mft2';
    let off = start + 48;
    let inTableEntries, outTableEntries;
    if (is16) {
      inTableEntries  = readU16(off);     off += 2;
      outTableEntries = readU16(off);     off += 2;
    } else {
      inTableEntries = 256;
      outTableEntries = 256;
    }
    const readSample = () => {
      if (is16) { const v = readU16(off); off += 2; return v / 65535; }
      const v = bytes[off]; off += 1; return v / 255;
    };
    const inputCurves = [];
    for (let c = 0; c < inChans; c++) {
      const curve = new Float64Array(inTableEntries);
      for (let i = 0; i < inTableEntries; i++) curve[i] = readSample();
      inputCurves.push(curve);
    }
    const clutCount = Math.pow(gridSize, inChans) * outChans;
    const clut = new Float64Array(clutCount);
    for (let i = 0; i < clutCount; i++) clut[i] = readSample();
    const outputCurves = [];
    for (let c = 0; c < outChans; c++) {
      const curve = new Float64Array(outTableEntries);
      for (let i = 0; i < outTableEntries; i++) curve[i] = readSample();
      outputCurves.push(curve);
    }
    return { inChans, outChans, gridSize, matrix, inputCurves, clut, outputCurves };
  };
  return {
    bytes,
    colorSpace,    // 'RGB ', 'CMYK', etc.
    pcs,           // 'XYZ ' or 'Lab '
    a2b0: parseLutTag(tags['A2B0']),   // device → PCS
    b2a0: parseLutTag(tags['B2A0']),   // PCS → device
  };
}

// 1-D curve interpolation: t∈[0,1] → curve sample with linear
// interpolation between adjacent entries.
function lutCurve(curve, t) {
  const n = curve.length;
  if (n === 1) return curve[0];
  const x = Math.max(0, Math.min(1, t)) * (n - 1);
  const i = Math.floor(x), f = x - i;
  return i >= n - 1 ? curve[n - 1] : curve[i] * (1 - f) + curve[i + 1] * f;
}

// N-dimensional CLUT lookup via multi-linear interpolation. `inputs`
// is an array of N values in [0,1]; returns outChans-long array.
// gridSize G means each axis has G samples; the table is flat row-
// major with the LAST input axis varying fastest (ICC ordering).
function lutClut(table, gridSize, inChans, outChans, inputs) {
  const G = gridSize, G1 = G - 1;
  // Index strides: last input changes fastest, so stride for axis i
  // is G^(inChans-1-i) * outChans.
  const strides = new Array(inChans);
  let s = outChans;
  for (let i = inChans - 1; i >= 0; i--) { strides[i] = s; s *= G; }
  const idx = new Array(inChans), frac = new Array(inChans);
  for (let i = 0; i < inChans; i++) {
    const x = Math.max(0, Math.min(1, inputs[i])) * G1;
    const fi = Math.floor(x);
    idx[i] = Math.min(fi, G1 - 1 < 0 ? 0 : G1 - 1);
    frac[i] = x - idx[i];
    if (idx[i] >= G1) { idx[i] = G1 - 1 < 0 ? 0 : G1 - 1; frac[i] = idx[i] < 0 ? 0 : 1; }
    if (G === 1) { idx[i] = 0; frac[i] = 0; }
  }
  // Multilinear: sum over 2^N corners.
  const out = new Float64Array(outChans);
  const corners = 1 << inChans;
  for (let c = 0; c < corners; c++) {
    let weight = 1;
    let base = 0;
    for (let i = 0; i < inChans; i++) {
      const hi = (c >> i) & 1;
      weight *= hi ? frac[i] : (1 - frac[i]);
      base += (idx[i] + hi) * strides[i];
    }
    if (weight === 0) continue;
    for (let k = 0; k < outChans; k++) out[k] += weight * table[base + k];
  }
  return out;
}

// Drive an mft1/mft2 LUT: input curves → CLUT → output curves.
function applyLut(lut, inputs) {
  if (!lut) return null;
  const curved = inputs.map((v, i) => lutCurve(lut.inputCurves[i], v));
  const clutOut = lutClut(lut.clut, lut.gridSize, lut.inChans, lut.outChans, curved);
  return Array.from(clutOut, (v, i) => lutCurve(lut.outputCurves[i], v));
}

// PCS conversions. ICC v2 Lab PCS encoding: L*∈[0,100] maps to
// [0,1] via L/100 (lut16: 0xFF00/0xFFFF, lut8: 0xFF/0xFF — close
// enough). a*,b*∈[-128,127] map to [0,1] via (a+128)/255. XYZ PCS
// encoding: X,Y,Z∈[0,2) map to [0,1] via v/2 (since 0x8000 represents
// Y=1 in lut16). The conversions here invert those encodings.
function srgbToLabPcs(r, g, b) {
  // sRGB → XYZ D50 → Lab D50.
  const { X, Y, Z } = srgbToXyzD50(r, g, b);
  const Xn = 0.9642, Yn = 1.0000, Zn = 0.8249;     // D50 reference white
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  const fx = f(X / Xn), fy = f(Y / Yn), fz = f(Z / Zn);
  const L = 116 * fy - 16;
  const a = 500 * (fx - fy);
  const bb = 200 * (fy - fz);
  // ICC PCS encoding for lut16 (close enough for lut8 too).
  return [L / 100, (a + 128) / 255, (bb + 128) / 255];
}
function labPcsToSrgb(L01, a01, b01) {
  const L = L01 * 100, a = a01 * 255 - 128, b = b01 * 255 - 128;
  const Xn = 0.9642, Yn = 1.0000, Zn = 0.8249;
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const fInv = (t) => t > 0.20689655 ? t * t * t : (t - 16 / 116) / 7.787;
  const X = Xn * fInv(fx), Y = Yn * fInv(fy), Z = Zn * fInv(fz);
  return xyzD50ToSrgb(X, Y, Z);
}
// XYZ PCS encoding (lut16): each channel scaled by 1/2.
function srgbToXyzPcs(r, g, b) {
  const { X, Y, Z } = srgbToXyzD50(r, g, b);
  return [X / 2, Y / 2, Z / 2];
}
function xyzPcsToSrgb(X01, Y01, Z01) {
  return xyzD50ToSrgb(X01 * 2, Y01 * 2, Z01 * 2);
}

// LUT-backed sRGB → CMYK using a loaded CMYK profile's B2A0.
function lutRgbToCmyk(r, g, b, parsed) {
  if (!parsed || !parsed.b2a0 || parsed.colorSpace !== 'CMYK') return null;
  const pcs = parsed.pcs === 'Lab ' ? srgbToLabPcs(r, g, b) : srgbToXyzPcs(r, g, b);
  const cmyk = applyLut(parsed.b2a0, pcs);
  if (!cmyk) return null;
  return { c: cmyk[0], m: cmyk[1], y: cmyk[2], k: cmyk[3] };
}
// LUT-backed CMYK → sRGB using a loaded profile's A2B0.
function lutCmykToRgb(c, m, y, k, parsed) {
  if (!parsed || !parsed.a2b0 || parsed.colorSpace !== 'CMYK') return null;
  const pcs = applyLut(parsed.a2b0, [c, m, y, k]);
  if (!pcs) return null;
  return parsed.pcs === 'Lab ' ? labPcsToSrgb(pcs[0], pcs[1], pcs[2]) : xyzPcsToSrgb(pcs[0], pcs[1], pcs[2]);
}

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
  'Barber Pole': {
    // Girard "Barber Pole": vertical columns of diagonal bars in random
    // blues and teals, separated by white channels and thin white
    // diagonal gaps.
    palette: ['#2c7fb8', '#2f93b8', '#2aa6ac', '#1f6fa8', '#3aa0c2', '#1a5f9e', '#34b0b4', '#2d86bd'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#ffffff', mode: 'fixed' },
      },
      {
        grid: { cols: 5, rows: 1, gutterX: 0.2, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'slant', bars: 8, slope: 0.6, gap: 0.15 },
      },
    ],
  },
  'Leaves': {
    // Girard "Leaves": outlined pointed-oval leaves (like Pepitas but
    // unfilled) with a vein straight down the centre that extends below
    // into a stem, scattered on a soft off-white ground in muted teal.
    palette: ['#6f9a93'],
    layers: [
      {
        grid: { cols: 1, rows: 1, offset: { x: 0, y: 0 }, offsetMode: 'none' },
        fill: { kind: 'solid', color: '#eef0ec', mode: 'fixed' },
      },
      {
        grid: { cols: 5, rows: 7, offset: { x: 0.5, y: 0 }, offsetMode: 'alternate-row' },
        fill: {
          kind: 'shape',
          shape: { kind: 'leaf', size: 0.82, ratio: 0.62, stem: 0.55, strokeWidth: 0.012 },
          mode: 'fixed', color: '#6f9a93',
        },
        vary: {
          scale:  { type: 'random', min: 0.5, max: 1.2 },
          jitter: { type: 'random', min: -0.34, max: 0.34 },
          rotate: { type: 'random', min: -10, max: 10 },
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

// Tag inference for the sample library. Each layer's fill kind maps
// to a set of tags; some specific shape kinds add their own. Sample
// names also carry strong hints ("stripe", "checker", …) we layer on
// top. A sample can also declare its own tags via `sample.tags`.
const FILL_TAG_MAP = {
  triangles:   ['geometric', 'scatter'],
  mesh:        ['grid', 'geometric'],
  windowpane:  ['grid', 'geometric'],
  graph:       ['grid', 'linear'],
  weave:       ['textile', 'woven', 'dense'],
  honeycomb:   ['geometric', 'hexagonal'],
  manhattan:   ['architectural', 'dense'],
  glyph:       ['typographic', 'abstract'],
  maze:        ['linear', 'geometric'],
  pinwheel:    ['geometric', 'radial'],
  'flower-seal': ['floral', 'radial'],
  bloom:       ['floral', 'organic'],
  firecracker: ['radial', 'geometric'],
  comb:        ['radial', 'geometric'],
  voronoi:     ['organic', 'scatter'],
  stones:      ['organic', 'scatter'],
  twigs:       ['organic', 'branching'],
  grass:       ['organic', 'foliage'],
  fruit:       ['organic', 'foliage'],
  slant:       ['stripes', 'diagonal'],
  dashes:      ['textural'],
  multiform:   ['abstract', 'scatter'],
  split:       ['geometric'],
  'arc-block': ['geometric', 'radial'],
  'arc-split': ['geometric'],
};
const SHAPE_TAG_MAP = {
  circle:      ['geometric'],
  square:      ['geometric'],
  diamond:     ['geometric'],
  triangle:    ['geometric'],
  'right-triangle': ['geometric'],
  star:        ['geometric'],
  text:        ['typographic'],
  blossom:     ['floral'],
  flower:      ['floral'],
  leaf:        ['organic', 'foliage'],
  jacks:       ['geometric'],
  plus:        ['geometric'],
  cross:       ['geometric'],
  quatrefoil:  ['geometric'],
  quadDots:    ['geometric'],
};
function sampleTags(name, sample) {
  const tags = new Set(sample.tags || []);
  for (const l of sample.layers || []) {
    const k = l.fill?.kind;
    (FILL_TAG_MAP[k] || []).forEach(t => tags.add(t));
    if (k === 'shape') {
      const sk = l.fill.shape?.kind;
      (SHAPE_TAG_MAP[sk] || []).forEach(t => tags.add(t));
    }
  }
  const n = name.toLowerCase();
  if (/stripe|pole|raya|miller|lino|super|ribbon/.test(n))   tags.add('stripes');
  if (/check/.test(n))                                       tags.add('checker');
  if (/grid|lattice|graph|pane/.test(n))                     tags.add('grid');
  if (/floral|flower|bloom|seal|fruit|leaves|petal/.test(n)) tags.add('floral');
  if (/jute|weave|cloth/.test(n))                            tags.add('textile');
  if (/circle|round|pebble|stone/.test(n))                   tags.add('organic');
  if (/triang|hex|diamond|square/.test(n))                   tags.add('geometric');
  return Array.from(tags).sort();
}

// Render a small SVG thumbnail for a sample by reconstructing its
// pattern via loadSample, then tiling 2×2 into the card area. Mirrors
// the yardage builder's approach but at a single fixed (small) size.
function buildSampleThumb(samplePattern) {
  const { w: tileW, h: tileH } = tileDims(samplePattern);
  const root = el('svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${tileW * 2} ${tileH * 2}`,
    width: '100%',
    height: '100%',
    preserveAspectRatio: 'xMidYMid meet',
  });
  const tileGroup = buildTileGroup(samplePattern);
  const unit = buildRepeatUnit(samplePattern, tileGroup);
  const patternId = `thumb-${Math.random().toString(36).slice(2, 8)}`;
  const tilePattern = el('pattern', {
    id: patternId,
    x: 0, y: 0,
    width: unit.width,
    height: unit.height,
    patternUnits: 'userSpaceOnUse',
  });
  unit.content.forEach(node => tilePattern.appendChild(node));
  root.appendChild(el('defs', {}, [tilePattern]));
  root.appendChild(el('rect', {
    width: tileW * 2,
    height: tileH * 2,
    fill: `url(#${patternId})`,
  }));
  return root;
}

function loadSample(name, current, clear) {
  const sample = SAMPLES[name];
  if (!sample) return current;
  const layers = JSON.parse(JSON.stringify(sample.layers));
  // Glyph layers historically stored colour in their own fields (inks /
  // ink+paper). Migrate them into the layer palette — the single colour
  // system — so the swatch editor, role binding and colourways drive
  // them like every other fill. `twoTone` preserves the look that the
  // `inks` array used to signal.
  for (const l of layers) seedGlyphPalette(l);
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
        || (l.fill?.kind === 'fruit')
        || (l.fill?.kind === 'slant');
  };
  // Infer the colour roles for this sample once, so both the copied
  // palettes and any hand-authored layer palettes can bind their slots
  // to roles (base / ground / accent-N / ink) and follow colourway
  // swaps instead of staying pinned to literal hexes.
  const sampleSpec = sample.palette ? inferPaletteSpec(sample.palette) : null;
  const roleByHex = {};
  if (sample.palette && sampleSpec) {
    sample.palette.forEach((hex, i) => {
      const role = sampleSpec.swatches[i] && sampleSpec.swatches[i].role;
      const key = normHex(hex);
      if (role && key && !(key in roleByHex)) roleByHex[key] = role;
    });
  }
  // Tag each palette slot with the role its colour maps to (recursing
  // into nested `layer` fills). Slots whose colour isn't a project
  // role — transparents, one-off hexes — stay null and render literal.
  const bindRoles = (l) => {
    if (!l) return;
    if (l.palette && l.palette.length) {
      l.paletteRoles = l.palette.map(h => roleByHex[normHex(h)] || null);
    }
    if (l.fill && l.fill.layer) bindRoles(l.fill.layer);
  };
  if (sample.palette) {
    for (const l of layers) {
      if (usesPalette(l) && !l.palette) l.palette = [...sample.palette];
    }
  }
  // After the cycling set is in place, append named accent slots so they
  // sit *after* the cycling colours (and never join the rotation).
  for (const l of layers) seedFillPalette(l);
  for (const l of layers) bindRoles(l);
  if (clear) {
    const baseP = defaultPattern();
    // Every colour the sample paints with becomes a project role, so
    // colourway edits recolour the WHOLE pattern (grounds, inks, …),
    // not only sample.palette. Palette colours stay first to keep the
    // historic base + accent roles stable; extra colours append after.
    const allColors = dedupeHex([...(sample.palette || []), ...collectColors(layers)]);
    const hexes = allColors.length ? allColors : baseP.palette;
    // Rebuild the spec around the full colour list so each sample picks
    // up a coherent base + tracked accents instead of a flat hex array.
    // `orig` records each role's authored hex for render-time recolour.
    const spec = inferPaletteSpec(hexes);
    spec.swatches.forEach((sw, i) => { if (hexes[i]) sw.orig = hexes[i]; });
    // Re-bind every layer.palette slot to the full role set (the spec
    // may now name more roles than sample.palette alone did).
    const fullRoleByHex = {};
    spec.swatches.forEach((sw) => {
      const key = normHex(sw.orig);
      if (sw.role && key && !(key in fullRoleByHex)) fullRoleByHex[key] = sw.role;
    });
    const rebind = (l) => {
      if (!l) return;
      if (l.palette && l.palette.length) {
        l.paletteRoles = l.palette.map(h => fullRoleByHex[normHex(h)] || null);
      }
      if (l.fill && l.fill.layer) rebind(l.fill.layer);
    };
    for (const l of layers) rebind(l);
    const colorways = buildColorways(spec, { main: hexes });
    const next = {
      ...baseP,
      paletteSpec: spec,
      colorways,
      activeColorway: 'main',
      ...(sample.repeat ? { repeat: sample.repeat } : {}),
      layers,
    };
    refreshPaletteFromSpec(next);
    return next;
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
    let v = attrs[k];
    if (v == null) continue;
    // Recolour authored fills/strokes to the active colourway. Only
    // full #rrggbb values are remapped; short hex (#fff), 'none',
    // 'url(...)' etc. pass through untouched — so masks and structural
    // util colours are unaffected.
    if ((k === 'fill' || k === 'stroke') && typeof v === 'string' && v.charCodeAt(0) === 35) {
      const m = _recolorMap[normHex(v)];
      if (m != null) v = m;
    }
    node.setAttribute(k, String(v));
  }
  if (children) for (const c of children) node.appendChild(c);
  return node;
}

// Append `count` circles around (cx, cy) at ringR with petalR each.
// Shared by shape:blossom and fill:flower-seal (both painted petals
// and its punch-mask negative). Starts at -π/2 (12 o'clock).
function appendPetalRing(host, { cx = 0, cy = 0, ringR, petalR, count, fill, extraAttrs = null }) {
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / count;
    const attrs = {
      cx: cx + Math.cos(a) * ringR,
      cy: cy + Math.sin(a) * ringR,
      r: petalR, fill,
    };
    host.appendChild(el('circle', extraAttrs ? { ...attrs, ...extraAttrs } : attrs));
  }
}

// Shape.size is a fraction (0..1) of the smaller cell dimension.
// Lets shapes scale with the grid instead of needing absolute pixels.
// Apply an affine matrix [a, b, c, d, e, f] to every endpoint and
// control point in an SVG `d` string, returning a new d. Handles
// M/L/H/V/C/S/Q/T/Z in both absolute and relative forms; arc (A)
// scales radii by the matrix's per-axis scale magnitude (good
// enough for the icon-export case where arcs are rare).
function transformPathData(d, m) {
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const apply = (x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const sxLen = Math.hypot(m[0], m[1]);
  const syLen = Math.hypot(m[2], m[3]);
  const fmt = (v) => Number.isFinite(v) ? (Math.round(v * 1000) / 1000).toString() : '0';
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0;
  let out = '';
  let cmd = '';
  const num = () => parseFloat(tokens[i++]);
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') {
      let nx = num(), ny = num();
      if (rel) { nx += cx; ny += cy; }
      const [tx, ty] = apply(nx, ny);
      out += `M ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny; sx = nx; sy = ny;
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      let nx = num(), ny = num();
      if (rel) { nx += cx; ny += cy; }
      const [tx, ty] = apply(nx, ny);
      out += `L ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny;
    } else if (C === 'H') {
      let nx = num();
      if (rel) nx += cx;
      const [tx, ty] = apply(nx, cy);
      out += `L ${fmt(tx)} ${fmt(ty)} `;
      cx = nx;
    } else if (C === 'V') {
      let ny = num();
      if (rel) ny += cy;
      const [tx, ty] = apply(cx, ny);
      out += `L ${fmt(tx)} ${fmt(ty)} `;
      cy = ny;
    } else if (C === 'C') {
      let c1x = num(), c1y = num(), c2x = num(), c2y = num(), nx = num(), ny = num();
      if (rel) { c1x += cx; c1y += cy; c2x += cx; c2y += cy; nx += cx; ny += cy; }
      const [t1x, t1y] = apply(c1x, c1y);
      const [t2x, t2y] = apply(c2x, c2y);
      const [tx, ty] = apply(nx, ny);
      out += `C ${fmt(t1x)} ${fmt(t1y)} ${fmt(t2x)} ${fmt(t2y)} ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny;
    } else if (C === 'S') {
      let c2x = num(), c2y = num(), nx = num(), ny = num();
      if (rel) { c2x += cx; c2y += cy; nx += cx; ny += cy; }
      const [t2x, t2y] = apply(c2x, c2y);
      const [tx, ty] = apply(nx, ny);
      out += `S ${fmt(t2x)} ${fmt(t2y)} ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny;
    } else if (C === 'Q') {
      let qx = num(), qy = num(), nx = num(), ny = num();
      if (rel) { qx += cx; qy += cy; nx += cx; ny += cy; }
      const [tqx, tqy] = apply(qx, qy);
      const [tx, ty] = apply(nx, ny);
      out += `Q ${fmt(tqx)} ${fmt(tqy)} ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny;
    } else if (C === 'T') {
      let nx = num(), ny = num();
      if (rel) { nx += cx; ny += cy; }
      const [tx, ty] = apply(nx, ny);
      out += `T ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny;
    } else if (C === 'A') {
      const rx = num(), ry = num(), rot = num(), large = num(), sweep = num();
      let nx = num(), ny = num();
      if (rel) { nx += cx; ny += cy; }
      const [tx, ty] = apply(nx, ny);
      out += `A ${fmt(rx * sxLen)} ${fmt(ry * syLen)} ${rot} ${large} ${sweep} ${fmt(tx)} ${fmt(ty)} `;
      cx = nx; cy = ny;
    } else if (C === 'Z') {
      out += 'Z ';
      cx = sx; cy = sy;
    } else {
      i++;
    }
  }
  return out.trim();
}

// Convert any SVG shape element to a path `d` string.
function svgElToPathD(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === 'path') return el.getAttribute('d');
  if (tag === 'circle') {
    const cx = +el.getAttribute('cx') || 0, cy = +el.getAttribute('cy') || 0, r = +el.getAttribute('r') || 0;
    if (r <= 0) return null;
    return `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  if (tag === 'ellipse') {
    const cx = +el.getAttribute('cx') || 0, cy = +el.getAttribute('cy') || 0;
    const rx = +el.getAttribute('rx') || 0, ry = +el.getAttribute('ry') || 0;
    if (rx <= 0 || ry <= 0) return null;
    return `M ${cx - rx} ${cy} a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
  }
  if (tag === 'rect') {
    const x = +el.getAttribute('x') || 0, y = +el.getAttribute('y') || 0;
    const w = +el.getAttribute('width') || 0, h = +el.getAttribute('height') || 0;
    if (w <= 0 || h <= 0) return null;
    return `M ${x} ${y} h ${w} v ${h} h ${-w} Z`;
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') || '').match(/-?\d*\.?\d+/g) || [];
    if (pts.length < 4) return null;
    let d = `M ${pts[0]} ${pts[1]}`;
    for (let i = 2; i + 1 < pts.length; i += 2) d += ` L ${pts[i]} ${pts[i + 1]}`;
    if (tag === 'polygon') d += ' Z';
    return d;
  }
  return null;
}

// Browser-assisted parse: drop the SVG into a hidden node and use the
// engine's own CTM / getBBox so group transforms, <use> references,
// nested viewBoxes etc. flatten correctly. Falls back to a pure-text
// walk if the DOM path fails (jsdom in node tests, malformed SVG, …).
function parseSvgShape(svgText) {
  if (!svgText) return null;
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  if (doc.getElementsByTagName('parsererror').length) return null;
  const root = doc.documentElement;
  if (!root || root.tagName.toLowerCase() !== 'svg') return null;

  // Browser-assisted flatten: mount the parsed SVG in a hidden host
  // node, then walk shape elements using getCTM() / getBBox() so all
  // group transforms, <use> references, and nested viewBoxes apply
  // exactly the way the browser would render them.
  const host = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (host && document.body) {
    // Offscreen + 0×0 + overflow:hidden keeps it invisible. NOT
    // using visibility:hidden because that cascades into every
    // descendant and the visibility filter below would then skip
    // every shape in the import.
    host.setAttribute('style', 'position:absolute;left:-99999px;top:0;width:0;height:0;overflow:hidden;');
    host.innerHTML = svgText;
    document.body.appendChild(host);
    try {
      const liveSvg = host.querySelector('svg');
      if (!liveSvg) { host.remove(); return null; }
      // Decide whether an element is direct rendering geometry or a
      // definition. <defs>, <clipPath>, <mask>, <symbol>, <pattern>
      // children are referenced by other elements; they shouldn't be
      // extracted as visible paths or the result is "the icon plus
      // every clip rectangle stacked on top".
      const isInDefs = (el) => {
        let p = el.parentNode;
        while (p && p !== liveSvg && p.tagName) {
          const t = p.tagName.toLowerCase();
          if (t === 'defs' || t === 'clippath' || t === 'mask'
              || t === 'symbol' || t === 'pattern') return true;
          p = p.parentNode;
        }
        return false;
      };
      const shapes = liveSvg.querySelectorAll('path, rect, circle, ellipse, polygon, polyline');
      const paths = [];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const shapeEl of shapes) {
        if (isInDefs(shapeEl)) continue;
        const d0 = svgElToPathD(shapeEl);
        if (!d0) continue;
        // Honour the source's visibility — skip fill="none",
        // display:none, visibility:hidden, zero-opacity, etc. so we
        // don't repaint invisible scaffolding (background rects on a
        // hidden layer, registration marks, …).
        let computedFill = null;
        try {
          const cs = getComputedStyle(shapeEl);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          if (parseFloat(cs.opacity) === 0) continue;
          computedFill = cs.fill;
          if (computedFill === 'none' || computedFill === 'rgba(0, 0, 0, 0)') continue;
        } catch {}
        let ctm = null;
        try { ctm = shapeEl.getCTM(); } catch {}
        const m = ctm ? [ctm.a, ctm.b, ctm.c, ctm.d, ctm.e, ctm.f] : [1, 0, 0, 1, 0, 0];
        const dT = (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0)
          ? d0
          : transformPathData(d0, m);
        paths.push({ d: dT, fill: computedFill });
        // Use the live element's transformed bbox to compute the
        // tight viewBox — avoids huge declared viewBoxes that the
        // author left around the artwork.
        try {
          const bb = shapeEl.getBBox();
          const corners = [
            [bb.x, bb.y], [bb.x + bb.width, bb.y],
            [bb.x, bb.y + bb.height], [bb.x + bb.width, bb.y + bb.height],
          ];
          for (const [cx, cy] of corners) {
            const x = m[0] * cx + m[2] * cy + m[4];
            const y = m[1] * cx + m[3] * cy + m[5];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        } catch {}
      }
      host.remove();
      if (paths.length === 0) return null;
      // Multi-colour artwork keeps its source fills; monochrome
      // icons fall through to palette colouring at render time. The
      // user can flip the explicit `preserveColors` flag either way
      // later if heuristic guesses wrong.
      const distinctFills = new Set(paths.map(p => p.fill).filter(Boolean));
      const preserveColors = distinctFills.size > 1;
      const vb = isFinite(minX)
        ? [minX, minY, maxX - minX, maxY - minY]
        : (root.getAttribute('viewBox') || '0 0 100 100').split(/[\s,]+/).map(Number);
      return { viewBox: vb.length === 4 ? vb : [0, 0, 100, 100], paths, preserveColors };
    } catch (err) {
      host.remove();
      // fall through to the string-walk fallback below
    }
  }

  // Fallback: text-only walk (no transforms, no <use> resolution).
  // Used in headless environments without a real SVG engine.
  const vbAttr = root.getAttribute('viewBox');
  let vx = 0, vy = 0, vw = 100, vh = 100;
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(n => !isNaN(n))) {
      [vx, vy, vw, vh] = parts;
    }
  } else {
    vw = parseFloat(root.getAttribute('width')) || 100;
    vh = parseFloat(root.getAttribute('height')) || 100;
  }
  const paths = [];
  const walk = (node) => {
    for (const child of Array.from(node.children || [])) {
      const tag = child.tagName.toLowerCase();
      if (tag === 'g' || tag === 'svg' || tag === 'defs' || tag === 'symbol') {
        walk(child);
        continue;
      }
      const d = svgElToPathD(child);
      if (d) paths.push({ d });
    }
  };
  walk(root);
  if (paths.length === 0) return null;
  return { viewBox: [vx, vy, vw, vh], paths };
}

// Set by buildTileGroup so the shape catalog can resolve `custom:NAME`
// kinds without threading a `pattern` arg through every shapeNode call
// site. Renders are synchronous so the module-level reference is safe.
let _currentCustomShapes = {};

function shapeNode(shape, cw, rh, fill, ctx) {
  const dim = Math.min(cw, rh) * (shape.size ?? 0.6);
  // Optional stroke. strokeWidth is a fraction of the smaller cell
  // dim so outlines scale with the grid.
  const sAttrs = strokeAttrs(ctx?.stroke ?? shape.stroke, shape.strokeWidth, Math.min(cw, rh), '#000000');

  // Custom user-imported shape: `kind` is `custom:NAME`, where NAME
  // indexes into _currentCustomShapes. Renders the parsed paths
  // scaled and centred to `dim`, picking up the cell's fill colour.
  if (shape.kind && shape.kind.startsWith('custom:')) {
    const name = shape.kind.slice(7);
    const custom = _currentCustomShapes[name];
    if (!custom || !custom.paths || custom.paths.length === 0) return el('g', {});
    // Custom shapes default to 1.0 (fit the cell by the longer axis)
    // instead of the catalog's 0.6 — imported artwork wants to be
    // seen, not breathing-room-padded. The slider still drives the
    // multiplier from there.
    const customDim = Math.min(cw, rh) * (shape.size ?? 1.0);
    const [vx, vy, vw, vh] = custom.viewBox;
    const scale = customDim / Math.max(vw, vh || 1, 1);
    const tx = -(vx + vw / 2) * scale;
    const ty = -(vy + vh / 2) * scale;
    const g = el('g', { transform: `translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${scale.toFixed(6)})` });
    // Multi-colour imports (preserveColors true, set by the parser
    // when the source had >1 distinct fill) keep their original
    // fills. Monochrome icons fall through to the cell's palette
    // colour so they read as part of the pattern.
    const preserve = !!custom.preserveColors;
    for (const p of custom.paths) {
      const f = preserve && p.fill ? p.fill : fill;
      g.appendChild(el('path', { d: p.d, fill: f, ...sAttrs }));
    }
    return g;
  }

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
      appendPetalRing(g, {
        count: n,
        ringR: dim * (shape.spread ?? 0.3),
        petalR: dim * (shape.petal ?? 0.26),
        fill,
      });
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
    case 'leaf': {
      // Outlined pointed oval (a pepita with no fill) plus a vein down
      // the centre that extends past the bottom into a stem. Drawn in
      // the resolved colour as strokes.
      const g = el('g', {});
      const hy = dim / 2;
      const hx = hy * (shape.ratio ?? 0.42);
      const stemLen = dim * (shape.stem ?? 0.5);
      const sw2 = (shape.strokeWidth ?? 0.016) * Math.min(cw, rh);
      const stroke = {
        fill: 'none',
        stroke: (fill && fill !== 'none') ? fill : (shape.stroke || '#6f9a93'),
        'stroke-width': sw2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      };
      g.appendChild(el('path', {
        d: `M 0,${(-hy).toFixed(2)} Q ${hx.toFixed(2)},0 0,${hy.toFixed(2)} Q ${(-hx).toFixed(2)},0 0,${(-hy).toFixed(2)} Z`,
        ...stroke,
      }));
      g.appendChild(el('line', { x1: 0, y1: (-hy).toFixed(2), x2: 0, y2: (hy + stemLen).toFixed(2), ...stroke }));
      return g;
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

// Glyph alphabet for the rectangle-only entries of fill:glyph. Each
// recipe takes (t, m, e) — bar thickness, centred-bar offset, far-edge
// position — and returns a list of [x, y, w, h] in normalised cell
// coords (0..1). The geometric glyphs (diamond / disc / ring) stay
// inline in the dispatcher since they paint circles / polygons rather
// than rectangles. Adding a new rect-based glyph is now one line.
const GLYPH_RECT_RECIPES = {
  plus:     (t, m, e) => [[m, 0, t, 1], [0, m, 1, t]],
  hbeam:    (t, m, e) => [[0, 0, t, 1], [e, 0, t, 1], [0, m, 1, t]],
  lbracket: (t, m, e) => [[0, 0, t, 1], [0, 0, 0.5, t], [0, e, 0.5, t]],
  rbracket: (t, m, e) => [[e, 0, t, 1], [0.5, 0, 0.5, t], [0.5, e, 0.5, t]],
  vdash:    (t, m, e) => [[m, 0.16, t, 0.68]],
  hdash:    (t, m, e) => [[0.06, 0.22, 0.88, 0.56]],
  block:    (t, m, e) => [[0.16, 0.14, 0.68, 0.72]],
  hbars:    (t, m, e) => [[0, 0, 1, t], [0, m, 1, t], [0, e, 1, t]],
  vbars:    (t, m, e) => [[0, 0, t, 1], [m, 0, t, 1], [e, 0, t, 1]],
  hpair:    (t, m, e) => [[0, 0, 1, t], [0, e, 1, t]],
  vpair:    (t, m, e) => [[0, 0, t, 1], [e, 0, t, 1]],
  ibeam:    (t, m, e) => [[0, 0, 1, t], [0, e, 1, t], [m, 0, t, 1]],
  tbar:     (t, m, e) => [[0, 0, 1, t], [m, t, t, e]],
  ubar:     (t, m, e) => [[0, 0, t, 1], [e, 0, t, 1], [0, e, 1, t]],
  lbar:     (t, m, e) => [[0, 0, t, 1], [0, e, 1, t]],
  comb:     (t, m, e) => [[0, 0, t, 1], [t, 0, e, t], [t, m, e, t], [t, e, e, t]],
  frame:    (t, m, e) => [[0, 0, 1, t], [0, e, 1, t], [0, 0, t, 1], [e, 0, t, 1]],
  solid:    () => [[0, 0, 1, 1]],
  blank:    () => [],
};

// ---------- Layer rendering ----------
// Tile dimensions. aspect = width / height (default 1 = square). The
// longer side is held at tileSize so the tile always fits the view.
function tileDims(pattern) {
  const base = pattern.tileSize;
  const a = pattern.aspect ?? 1;
  return a >= 1 ? { w: base, h: base / a } : { w: base * a, h: base };
}

function buildTileGroup(pattern) {
  _currentCustomShapes = pattern.customShapes || {};
  _currentByRole = resolvePalette(pattern).byRole || {};
  _recolorMap = buildRecolorMap(pattern);
  const { w, h } = tileDims(pattern);
  const root = el('g');
  // Solo: when any layer is solo'd, only solo'd layers render.
  const anySolo = pattern.layers.some(l => l.solo);
  pattern.layers.forEach((layer, li) => {
    if (anySolo && !layer.solo) return;
    // Locked layers carry a frozen RNG seed; everything else flows
    // from the project seed so a "roll" reshuffles them together.
    const rngSeed = (layer.locked && layer.lockedSeed != null)
      ? layer.lockedSeed
      : pattern.seed + li * 9973;
    renderLayer(root, layer, 0, 0, w, h, pattern.palette, rngSeed);
  });
  return root;
}

// Build a polygon `points` string for a line segment that tapers
// from width w1 at (x1, y1) to width w2 at (x2, y2). Used by stroke-
// based fills (twigs, grass) when the layer's taper > 0 so each
// segment narrows along its length. Result is a quadrilateral.
function taperedLinePoints(x1, y1, x2, y2, w1, w2) {
  const dx = x2 - x1, dy = y2 - y1;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;     // unit normal
  const ax = x1 + nx * w1 / 2, ay = y1 + ny * w1 / 2;
  const bx = x2 + nx * w2 / 2, by = y2 + ny * w2 / 2;
  const cx = x2 - nx * w2 / 2, cy = y2 - ny * w2 / 2;
  const dx2 = x1 - nx * w1 / 2, dy2 = y1 - ny * w1 / 2;
  return `${ax.toFixed(2)},${ay.toFixed(2)} ${bx.toFixed(2)},${by.toFixed(2)} `
       + `${cx.toFixed(2)},${cy.toFixed(2)} ${dx2.toFixed(2)},${dy2.toFixed(2)}`;
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
  // Mirror / flip the layer's content around its own bounding box.
  // `translate(w, 0) scale(-1, 1)` flips horizontally about the right
  // edge then shifts the right edge to x=0 — net effect: mirror across
  // the layer's vertical centre line. Same idea for the Y axis.
  const fx = layer.flipX ? -1 : 1;
  const fy = layer.flipY ? -1 : 1;
  if (fx === -1 || fy === -1) {
    const tx = fx === -1 ? w : 0;
    const ty = fy === -1 ? h : 0;
    group.setAttribute('transform', `translate(${tx} ${ty}) scale(${fx} ${fy})`);
  }
  parent.appendChild(group);

  const palette = resolveLayerPalette(layer, parentPalette);
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
  // One colour system: a layer's named accents are labelled slots in
  // layer.palette; the cycling set is the unlabelled slots. `fullPalette`
  // keeps every slot (for fillSlotColor's index lookups); `palette` is
  // narrowed to the cycling set so accents never enter the rotation.
  // Identity when the layer has no labels.
  const fullPalette = palette;
  palette = cycleColors(layer, palette);

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
        : fillSlotColor(layer, fill, fullPalette, 'color', '#888');
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

      const sAttrs = strokeAttrs(fillSlotColor(layer, fill, fullPalette, 'stroke', '#ffffff'), fill.strokeWidth, Math.min(s, h), '#ffffff');

      const triSalt = ((rng() * 0xffffffff) >>> 0) | 1;
      // Each triangle gets its own colour; horizontal wrap pairs land
      // on the same index via mod(cols). Up and down at the same (r,c)
      // are distinct triangles (no rhombus pairing) so they don't
      // collapse into a visible diamond.
      const colorAt = (r, c, type) => {
        if (fill.mode === 'fixed') return fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#888');
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
      const sAttrs = strokeAttrs(fillSlotColor(layer, fill, fullPalette, 'stroke', '#ffffff'), fill.strokeWidth, Math.min(cellW, cellH), '#ffffff');
      const paint = (pa, pb, pc, colorIdx) => {
        const color = fill.mode === 'palette-cycle'
          ? palette[mod(colorIdx, palette.length)]
          : fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#888');
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
        appendPetalRing(mask, { cx: 0.5, cy: 0.5, ringR: petalOffN, petalR: petalRN, count: n, fill: '#000' });
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
        appendPetalRing(parent, { cx, cy, ringR: petalOff, petalR, count: n, fill: flowerColor });
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

      const stemColor = fillSlotColor(layer, fill, fullPalette, 'stemColor', '#454545');
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
            : fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#d8c79c');
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

      const color = fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#2c3340');
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
      let ink = fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#ffffff');
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
      const ground = fillSlotColor(layer, fill, fullPalette, 'ground', 'transparent');
      if (ground && !isTransparent(ground)) {
        parent.appendChild(el('rect', { x: ix, y: iy, width: iw, height: ih, fill: ground }));
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
      // Colours come from the layer palette (seeded from inks / ink+paper
      // on load), so the swatch editor, role binding and colourways all
      // drive them. Legacy patterns with no layer palette fall back to
      // the raw fill fields.
      const cols = (layer.palette && layer.palette.length)
        ? fullPalette
        : (fill.inks && fill.inks.length
            ? fill.inks
            : [fill.ink || palette[0] || '#21242b', fill.paper || '#f3ede0']);
      // two-tone: transparent ground, glyph drawn in a random ink (the
      // Extrusions / Treads look). Otherwise ink-on-paper with random
      // inversion (the Menu look). Migrated patterns carry fill.twoTone;
      // legacy ones are inferred from the presence of an `inks` array.
      const twoTone = fill.twoTone ?? !!(fill.inks && fill.inks.length);
      const ink = cols[0] || palette[0] || '#21242b';
      const paper = cols[1] ?? cols[0] ?? '#f3ede0';
      const transparent = twoTone;
      const invert = !transparent && crng() < (fill.invert ?? 0.5);
      const bg = transparent ? 'none' : (invert ? ink : paper);
      const fg = transparent ? cols[Math.floor(crng() * cols.length)] : (invert ? paper : ink);
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
      const rects = GLYPH_RECT_RECIPES[name];
      if (rects) {
        for (const [x, y, w, h] of rects(t, m, e)) R(x, y, w, h);
      } else if (name === 'diamond') {
        const cx2 = ix + iw / 2, cy2 = iy + ih / 2, r = dim * 0.56;
        parent.appendChild(el('polygon', {
          points: `${cx2},${cy2 - r} ${cx2 + r},${cy2} ${cx2},${cy2 + r} ${cx2 - r},${cy2}`,
          fill: fg,
        }));
      } else if (name === 'disc') {
        parent.appendChild(el('circle', { cx: ix + iw / 2, cy: iy + ih / 2, r: dim * 0.42, fill: fg }));
      } else if (name === 'ring') {
        parent.appendChild(el('circle', { cx: ix + iw / 2, cy: iy + ih / 2, r: dim * 0.42, fill: fg }));
        parent.appendChild(el('circle', { cx: ix + iw / 2, cy: iy + ih / 2, r: dim * (0.42 - t * 0.62), fill: bg }));
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
      const stone = fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#efe9dc');
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
      // Taper: convert each line into a tapered quadrilateral that
      // narrows from full width at its start to (1 - taper) at its
      // end. Stacked across twig segments this paints a continuous
      // root → tip narrowing.
      const taper = Math.max(0, Math.min(1, layer.taper ?? 0));
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, ox, oy) => {
        for (const s of segs) {
          if (taper > 0) {
            host.appendChild(el('polygon', {
              points: taperedLinePoints(s.x1 + ox, s.y1 + oy, s.x2 + ox, s.y2 + oy, s.w, s.w * (1 - taper)),
              fill: s.c,
            }));
          } else {
            host.appendChild(el('line', {
              x1: s.x1 + ox, y1: s.y1 + oy, x2: s.x2 + ox, y2: s.y2 + oy,
              stroke: s.c, 'stroke-width': s.w, 'stroke-linecap': 'round',
            }));
          }
        }
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
      const vColor = fillSlotColor(layer, fill, fullPalette, 'vColor', '#b7bbc0');
      const hColor = fillSlotColor(layer, fill, fullPalette, 'hColor', '#9aa0a6');
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
      const stroke = fillSlotColor(layer, fill, fullPalette, 'stroke', palette[0] || '#3a4aa0');
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
        : fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#d2624d');
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
      const stalkColor = fillSlotColor(layer, fill, fullPalette, 'stalk', '#4f4a22');
      const leafColor = fillSlotColor(layer, fill, fullPalette, 'leaf', '#7d9a40');
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
      const stroke = fillSlotColor(layer, fill, fullPalette, 'stroke', palette[0] || '#8a9a4a');
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
      const color = fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#3f7a8c');
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
      const grassTaper = Math.max(0, Math.min(1, layer.taper ?? 0));
      drawWrapped(parent, layerBounds?.w, layerBounds?.h, (host, ox, oy) => {
        for (const [x1, y1, x2, y2] of lines) {
          if (grassTaper > 0) {
            host.appendChild(el('polygon', {
              points: taperedLinePoints(x1 + ox, y1 + oy, x2 + ox, y2 + oy, sw, sw * (1 - grassTaper)),
              fill: color,
            }));
          } else {
            host.appendChild(el('line', {
              x1: x1 + ox, y1: y1 + oy, x2: x2 + ox, y2: y2 + oy,
              stroke: color, 'stroke-width': sw, 'stroke-linecap': 'round',
            }));
          }
        }
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
      const color = fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#e0954a');
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
      // A comb band: a solid spine (base) down one edge with teeth of a
      // chosen profile combing off it. The white gaps between teeth are
      // congruent to the teeth, so the negative space mirrors the
      // positive. Per-column arrays let one layer render the whole Palio
      // sampler. profiles: square, triangle/spear, spearhead, finger,
      // drop, flame, checker, angle.
      const nB = (fill.profiles && fill.profiles.length) || 1;
      const idx = mod(ci, nB);
      const at = (v, d) => Array.isArray(v) ? v[mod(idx, v.length)] : (v ?? d);
      let profile = fill.profiles ? fill.profiles[idx] : (fill.profile || 'square');
      if (profile === 'goo') profile = 'finger';
      if (profile === 'crown') profile = 'spearhead';
      if (profile === 'round') profile = 'drop';
      const color = fill.colors ? fill.colors[mod(idx, fill.colors.length)] : fillSlotColor(layer, fill, fullPalette, 'color', palette[0] || '#888');
      const teeth = Math.max(1, at(fill.teeth, 10));
      const base = at(fill.base, 0.3);            // spine width, × band
      const duty = at(fill.duty, 0.52);           // tooth height, × period
      const W = iw, H = ih, x0 = ix, y0 = iy;
      if (isTransparent(color)) break;
      const spineW = base * W;
      const sx = x0 + spineW;                      // spine outer edge
      const tipX = x0 + W;                          // teeth reach band edge
      const tw = tipX - sx;
      const T = H / teeth;
      const toothH = T * duty;

      // Solid spine down the full height.
      parent.appendChild(el('rect', { x: x0, y: y0, width: spineW, height: H, fill: color }));

      if (profile === 'checker') {
        const s = tw / 2;
        const nr = Math.max(1, Math.round(H / s));
        const sh = H / nr;
        for (let r = 0; r < nr; r++) for (let c = 0; c < 2; c++) {
          if ((r + c) % 2 === 0) parent.appendChild(el('rect', { x: sx + c * s, y: y0 + r * sh, width: s, height: sh, fill: color }));
        }
        break;
      }
      if (profile === 'angle') {
        const clipId = `cmb-${mod(ci, 9999)}-${(layerBounds?.salt || 1) & 0xffff}`;
        const clip = el('clipPath', { id: clipId });
        clip.appendChild(el('rect', { x: sx, y: y0, width: tw, height: H }));
        const g = el('g', { 'clip-path': `url(#${clipId})` });
        const P = T;
        for (let k = -Math.ceil(H / P) - 1; k < Math.ceil((tw + H) / P) + 1; k++) {
          const off = k * P;
          g.appendChild(el('line', {
            x1: sx + off, y1: y0, x2: sx + off + H, y2: y0 + H,
            stroke: color, 'stroke-width': P / (2 * Math.SQRT2),
          }));
        }
        parent.appendChild(el('defs', {}, [clip]));
        parent.appendChild(g);
        break;
      }

      // Discrete teeth off the spine, one per period.
      for (let i = 0; i < teeth; i++) {
        const ya = y0 + i * T, yb = ya + toothH, ym = (ya + yb) / 2;
        if (profile === 'square') {
          parent.appendChild(el('rect', { x: sx, y: ya, width: tw, height: toothH, fill: color }));
        } else if (profile === 'finger') {
          // Rounded inner end (away from the spine) — so the negative
          // space (a comb's gap with a round inner end) is congruent to
          // the positive. The tip end stays flush with the band edge.
          const r = toothH * 0.5;
          parent.appendChild(el('path', {
            d: `M ${sx} ${ya} L ${tipX - r} ${ya} A ${r} ${r} 0 0 1 ${tipX - r} ${yb} L ${sx} ${yb} Z`,
            fill: color,
          }));
        } else if (profile === 'triangle' || profile === 'spear') {
          parent.appendChild(el('polygon', { points: `${sx},${ya} ${tipX},${ym} ${sx},${yb}`, fill: color }));
        } else if (profile === 'spearhead') {
          // Triangle whose base is a concave arc — a circle bites into
          // the base, leaving the top and bottom corners as flange points
          // and pinching the neck where the head meets the spine.
          const aR = toothH * 0.6;
          parent.appendChild(el('path', {
            d: `M ${sx} ${ya} L ${tipX} ${ym} L ${sx} ${yb} A ${aR} ${aR} 0 0 0 ${sx} ${ya} Z`,
            fill: color,
          }));
        } else if (profile === 'drop') {
          // Strong taper: full attach at the spine narrowing to a sharp
          // rounded tip. Bezier handles biased toward the spine.
          parent.appendChild(el('path', {
            d: `M ${sx} ${ya} C ${sx + tw * 0.18} ${ya} ${tipX} ${ym - toothH * 0.04} ${tipX} ${ym}`
             + ` C ${tipX} ${ym + toothH * 0.04} ${sx + tw * 0.18} ${yb} ${sx} ${yb} Z`,
            fill: color,
          }));
        } else if (profile === 'flame') {
          // Triangle distorted via a sine wave: take the straight
          // triangle edges (spine→tip) and bend them up by sin(πt) so
          // the body bulges and the tip leans upward like a licking
          // flame. Bottom edge bends a bit too for the S-curve.
          const steps = 24;
          const A = toothH * 0.55;
          const top = [], bot = [];
          for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const x = sx + tw * t;
            const yT = ya + (ym - ya) * t;       // straight triangle upper edge
            const yB = yb - (yb - ym) * t;       // straight triangle lower edge
            const wave = Math.sin(t * Math.PI);
            top.push(`${x.toFixed(2)},${(yT - A * wave).toFixed(2)}`);
            bot.push(`${x.toFixed(2)},${(yB - A * 0.7 * wave).toFixed(2)}`);
          }
          parent.appendChild(el('polygon', {
            points: top.join(' ') + ' ' + bot.reverse().join(' '),
            fill: color,
          }));
        }
      }
      break;
    }
    case 'slant': {
      // Girard "Barber Pole". Continuous diagonal-bar pole per column,
      // running top-to-bottom of the layer with M*rows bars total.
      // `bars` (M) controls bar count per row band; `rows` multiplies
      // it. Colour cycles per band (the `r * 0x9E37` salt XOR), so
      // rows>1 gives stacked colour sections in one continuous pole.
      // Bars wrap at the layer's top/bottom for seamless tile-to-tile.
      const G = layerGeom(col, row, cw, rh, cols, rows, layerBounds);
      if (!G) break;
      const { lw, lh, ox, oy, salt } = G;
      const M = Math.max(2, fill.bars ?? 9);
      const slope = fill.slope ?? 0.6;
      const { gutter, gutterX } = layer.grid;
      const gX = gutterX ?? gutter ?? 0;
      const colW = lw / cols;
      const innerW = colW * (1 - gX);
      const innerOff = colW * gX / 2;
      const totalBars = M * rows;
      const pitch = lh / totalBars;
      const s = innerW * slope;
      const gapY = (fill.gap ?? 0.16) * pitch;
      const barH = pitch - gapY;
      // Wrap range: enough bars beyond each edge that a bar whose
      // diagonal sweeps across `s` vertical pixels still has its
      // visible (un-clipped) portion drawn. Without this, high bar
      // counts leave a triangular gap at the top-left / bottom-right
      // of each column where the missing wrap bars would have sat.
      const wrapN = Math.ceil(s / pitch) + 1;
      for (let c = 0; c < cols; c++) {
        const cx = ox + c * colW + innerOff;
        for (let i = -wrapN; i <= totalBars + wrapN - 1; i++) {
          const bi = mod(i, totalBars);
          const band = Math.floor(bi / M);            // which row's palette pick
          const bandBi = bi % M;                       // bar index inside the band
          const color = palette[Math.floor(cellRng(c, bandBi, (salt ^ (band * 0x9E37)) >>> 0)() * palette.length)] || fill.color || '#2c7fb8';
          if (isTransparent(color)) continue;
          const y0 = oy + i * pitch + gapY / 2;
          parent.appendChild(el('polygon', {
            points: `${cx},${(y0 + s).toFixed(2)} ${cx + innerW},${y0.toFixed(2)} `
                  + `${cx + innerW},${(y0 + barH).toFixed(2)} ${cx},${(y0 + barH + s).toFixed(2)}`,
            fill: color,
          }));
        }
      }
      break;
    }
    case 'layer': {
      if (fill.layer) {
        renderLayer(parent, fill.layer, ix, iy, iw, ih, fullPalette,
          (rng() * 0xffffffff) | 0);
      }
      break;
    }
  }
}

// ---------- Repeat unit (SVG <pattern> body) ----------
function buildRepeatUnit(pattern, tileGroup) {
  const { w, h } = tileDims(pattern);
  const repeat = pattern.repeat || 'square';
  // Custom drop / brick fractions; default 0.5 so a user typing
  // `drop` without setting a fraction still gets a half-drop.
  const dropFr  = Math.max(0, Math.min(1, pattern.dropFraction  ?? 0.5));
  const brickFr = Math.max(0, Math.min(1, pattern.brickFraction ?? 0.5));
  const clone = () => tileGroup.cloneNode(true);
  switch (repeat) {
    // Drop column: the right-hand tile in a 2W×H unit shifts down.
    // half-drop is the textile-standard 0.5; `drop` keeps that name
    // free for explicit fractions (1/3 = 60° / diamond drop, etc.).
    case 'half-drop':
    case 'drop': {
      const off = h * (repeat === 'half-drop' ? 0.5 : dropFr);
      const g1 = clone(), g2 = clone();
      g2.setAttribute('transform', `translate(${w} ${off})`);
      return { width: w * 2, height: h, content: [g1, g2] };
    }
    // Brick row: the second row shifts right.
    case 'half-brick':
    case 'brick': {
      const off = w * (repeat === 'half-brick' ? 0.5 : brickFr);
      const g1 = clone(), g2 = clone();
      g2.setAttribute('transform', `translate(${off} ${h})`);
      return { width: w, height: h * 2, content: [g1, g2] };
    }
    // Mirror repeats: each axis flips the next tile. mirror-xy is
    // the four-tile kaleidoscope (think Rorschach quilt).
    case 'mirror-x': {
      const g1 = clone(), g2 = clone();
      g2.setAttribute('transform', `translate(${w * 2} 0) scale(-1 1)`);
      return { width: w * 2, height: h, content: [g1, g2] };
    }
    case 'mirror-y': {
      const g1 = clone(), g2 = clone();
      g2.setAttribute('transform', `translate(0 ${h * 2}) scale(1 -1)`);
      return { width: w, height: h * 2, content: [g1, g2] };
    }
    case 'mirror-xy': {
      const g1 = clone(), g2 = clone(), g3 = clone(), g4 = clone();
      g2.setAttribute('transform', `translate(${w * 2} 0) scale(-1 1)`);
      g3.setAttribute('transform', `translate(0 ${h * 2}) scale(1 -1)`);
      g4.setAttribute('transform', `translate(${w * 2} ${h * 2}) scale(-1 -1)`);
      return { width: w * 2, height: h * 2, content: [g1, g2, g3, g4] };
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

// Soft proof: walk the rendered SVG tree, rewrite every fill/stroke
// colour through the active profile's sRGB→CMYK→sRGB round trip so the
// preview shows what the pattern will look like printed. Skips colours
// the renderer flagged as semantically transparent ('none',
// 'transparent') and leaves alpha untouched.
function applySoftProof(svgNode, profileId) {
  const transform = (colour) => {
    if (!colour || colour === 'none' || colour === 'transparent') return colour;
    const rgba = parseColor(colour);
    if (rgba.a <= 0) return colour;
    const cmyk = profileRgbToCmyk(rgba.r, rgba.g, rgba.b, profileId);
    const back = profileCmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k, profileId);
    return formatColor({ r: back.r, g: back.g, b: back.b, a: rgba.a });
  };
  const walk = (n) => {
    if (!n || !n.attrs) return;
    if (n.attrs.fill   != null) n.setAttribute('fill',   transform(n.attrs.fill));
    if (n.attrs.stroke != null) n.setAttribute('stroke', transform(n.attrs.stroke));
    (n.children || []).forEach(walk);
  };
  walk(svgNode);
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
  // Soft proof on the preview: rewrite every fill/stroke through the
  // active profile so the stage shows the print simulation.
  if (pattern.softProof && iccProfiler.loaded) {
    applySoftProof(tileGroup, pattern.iccProfile || 'U.S. Web Coated (SWOP) v2');
  }
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

// ---------- Export ----------
// Deferred-load helper. Hits a CDN <script> once and resolves when the
// global it exposes is available. Used to lazy-fetch UTIF (TIFF) and
// pdf-lib (PDF) only when the user actually exports those formats.
const _loadedScripts = new Set();
function loadScript(src) {
  if (_loadedScripts.has(src)) return Promise.resolve();
  _loadedScripts.add(src);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => { _loadedScripts.delete(src); reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
}

// Cache of font-binary fetches. Maps "Family|weight" to an ArrayBuffer
// of the actual font file (WOFF2 from Google Fonts), used to inline
// @font-face inside exported SVGs so the file is self-contained.
const _fontBinaries = new Map();

// Fetch the Google Fonts CSS for a family, find the woff2 URLs, fetch
// each binary, and return [{weight, mime, buffer}, ...]. Cached.
function fetchFontBinaries(family) {
  if (!family || GENERIC_FONTS.includes(family)) return Promise.resolve([]);
  const cacheKey = family;
  if (_fontBinaries.has(cacheKey)) return Promise.resolve(_fontBinaries.get(cacheKey));
  const cssUrl = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700;900&display=swap`;
  return fetch(cssUrl, { mode: 'cors' })
    .then(r => r.text())
    .then(css => {
      // Parse @font-face blocks: extract font-weight + woff2 src URL.
      const out = [];
      const blocks = css.split('@font-face').slice(1);
      for (const b of blocks) {
        const w = /font-weight:\s*(\d+)/.exec(b);
        const u = /url\((https?:\/\/[^)]+\.woff2)\)/.exec(b);
        if (w && u) out.push({ weight: Number(w[1]), url: u[1] });
      }
      // Fetch unique URLs, dedupe by weight.
      const seen = new Set();
      const filtered = out.filter(x => { if (seen.has(x.weight)) return false; seen.add(x.weight); return true; });
      return Promise.all(filtered.map(x =>
        fetch(x.url, { mode: 'cors' }).then(r => r.arrayBuffer()).then(buf => ({ weight: x.weight, mime: 'font/woff2', buffer: buf }))
      ));
    })
    .then(items => { _fontBinaries.set(cacheKey, items); return items; })
    .catch(err => { console.warn('girard: font fetch failed for', family, err); return []; });
}

// Build <style> contents with @font-face data URIs for every family
// referenced by text-shape layers. Embedding inside the SVG makes the
// exported file viewable / printable without external font CDN access.
function buildEmbeddedFontStyle(pattern) {
  const families = patternFonts(pattern);
  if (!families.length) return Promise.resolve('');
  return Promise.all(families.map(fam => fetchFontBinaries(fam).then(items => ({ fam, items }))))
    .then(entries => {
      const rules = [];
      for (const { fam, items } of entries) {
        for (const it of items) {
          const b64 = arrayBufferToBase64(it.buffer);
          rules.push(
            `@font-face{font-family:"${fam}";font-style:normal;font-weight:${it.weight};` +
            `src:url("data:${it.mime};base64,${b64}") format("woff2");}`
          );
        }
      }
      return rules.join('');
    });
}

// opentype.js lazy-loaded once for vector text outlining. TTF binaries
// come from jsDelivr's @fontsource mirror (Google Fonts WOFF2s would
// need a wasm decoder; TTF is parseable straight out of opentype.js).
const OPENTYPE_URL = 'https://cdn.jsdelivr.net/npm/opentype.js@1.3.4/dist/opentype.min.js';
const _ttfCache = new Map();  // family|weight|style → opentype.Font
function fontSlug(family) { return family.toLowerCase().replace(/ /g, '-'); }
async function loadGlyphsForPattern(pattern) {
  const families = patternFonts(pattern);
  if (!families.length) return new Map();
  try { await loadScript(OPENTYPE_URL); }
  catch { return new Map(); }
  if (!window.opentype) return new Map();
  const map = new Map();
  const fetches = [];
  for (const family of families) {
    const slug = fontSlug(family);
    for (const w of [400, 700, 900]) {
      for (const style of ['normal', 'italic']) {
        const key = `${family}|${w}|${style}`;
        if (_ttfCache.has(key)) { map.set(key, _ttfCache.get(key)); continue; }
        fetches.push((async () => {
          const url = `https://cdn.jsdelivr.net/npm/@fontsource/${slug}/files/${slug}-latin-${w}-${style}.ttf`;
          try {
            const r = await fetch(url);
            if (!r.ok) return;
            const buf = await r.arrayBuffer();
            const font = window.opentype.parse(buf);
            _ttfCache.set(key, font);
            map.set(key, font);
          } catch {}
        })());
      }
    }
  }
  await Promise.all(fetches);
  return map;
}

function arrayBufferToBase64(buf) {
  let s = '';
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

// Yardage preview: render N×N copies of the tile via SVG <pattern>
// so the designer can see the print "in the field." Reuses the same
// tile group buildSvg builds; the surround veil is skipped here since
// the whole point is to see contiguous tiles.
function buildYardageSvg(pattern, tileCount) {
  const { w: tileW, h: tileH } = tileDims(pattern);
  const n = Math.max(1, tileCount | 0 || 4);
  const viewW = tileW * n, viewH = tileH * n;
  const root = el('svg', {
    xmlns: SVG_NS,
    viewBox: `0 0 ${viewW} ${viewH}`,
    preserveAspectRatio: 'xMidYMid meet',
  });
  const tileGroup = buildTileGroup(pattern);
  if (pattern.softProof && iccProfiler.loaded) {
    applySoftProof(tileGroup, pattern.iccProfile || 'U.S. Web Coated (SWOP) v2');
  }
  const unit = buildRepeatUnit(pattern, tileGroup);
  const patternId = 'girard-yardage-tile';
  const tilePattern = el('pattern', {
    id: patternId,
    x: 0, y: 0,
    width: unit.width,
    height: unit.height,
    patternUnits: 'userSpaceOnUse',
  });
  unit.content.forEach(node => tilePattern.appendChild(node));
  root.appendChild(el('defs', {}, [tilePattern]));
  root.appendChild(el('rect', {
    width: viewW, height: viewH,
    fill: `url(#${patternId})`,
  }));
  return root;
}

// Build a deployable repeat-unit SVG: just the one tile that tiles
// seamlessly when laid out edge-to-edge. No veil, no surround, no
// extra margin. Geometry that crosses an edge is wrap-painted at the
// opposite edge by the renderer, then clipped here so the unit's
// bounds are exactly the repeat dimensions.
function buildTileSvg(pattern, opts = {}) {
  const proof = pattern.softProof && iccProfiler.loaded && !opts.skipSoftProof;
  const tileGroup = buildTileGroup(pattern);
  if (proof) applySoftProof(tileGroup, pattern.iccProfile || 'U.S. Web Coated (SWOP) v2');
  const unit = buildRepeatUnit(pattern, tileGroup);
  const root = el('svg', {
    xmlns: SVG_NS,
    'xmlns:xlink': 'http://www.w3.org/1999/xlink',
    viewBox: `0 0 ${unit.width} ${unit.height}`,
    width: unit.width,
    height: unit.height,
  });
  // Clip the unit to its own bounds so wrap-painted geometry doesn't
  // extend past the deployable canvas.
  const clipId = 'girard-export-clip';
  const clip = el('clipPath', { id: clipId });
  clip.appendChild(el('rect', { x: 0, y: 0, width: unit.width, height: unit.height }));
  root.appendChild(el('defs', {}, [clip]));
  const g = el('g', { 'clip-path': `url(#${clipId})` });
  unit.content.forEach(n => g.appendChild(n));
  root.appendChild(g);
  return { svg: root, width: unit.width, height: unit.height };
}

function serializeSvg(svgNode) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svgNode);
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Inject an SVG <defs><style>@font-face…</style></defs> for every
// family used by text-shape layers, so exported files don't depend on
// the viewer having those fonts installed. Real DOM methods so this
// works in the browser (the headless test harness uses array-shaped
// children; the real browser uses HTMLCollection).
function injectFontStyle(svg, fontCss) {
  if (!fontCss) return;
  let defs = svg.querySelector ? svg.querySelector('defs') : null;
  if (!defs) {
    defs = el('defs', {});
    if (svg.insertBefore) svg.insertBefore(defs, svg.firstChild || null);
    else svg.appendChild(defs);
  }
  const style = el('style', {});
  style.textContent = fontCss;
  defs.appendChild(style);
}

function exportTileSvg(pattern, baseName) {
  const { svg } = buildTileSvg(pattern);
  buildEmbeddedFontStyle(pattern).then(fontCss => {
    injectFontStyle(svg, fontCss);
    const xml = serializeSvg(svg);
    downloadBlob(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }), `${baseName}.svg`);
  });
}

// ---------- ICC profile binary (sRGB v2) ----------
// Generate a minimal but valid sRGB IEC 61966-2.1 ICC v2 profile from
// scratch so we can embed it in TIFF tag 34675 and PDF /OutputIntent
// without shipping a separate .icc binary. Tag set: desc / cprt / wtpt
// / rXYZ / gXYZ / bXYZ / rTRC / gTRC / bTRC. Standard sRGB primaries
// (D65 → Bradford-adapted to D50 PCS), parametric tone curve (type 3).
let _srgbIccCache = null;
function buildSrgbIccProfile() {
  if (_srgbIccCache) return _srgbIccCache;
  // ---------- Tag data builders ----------
  const writeSig = (buf, off, sig) => {
    for (let i = 0; i < 4; i++) buf[off + i] = sig.charCodeAt(i);
  };
  const writeU32 = (buf, off, v) => { new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint32(off, v >>> 0, false); };
  const writeI32 = (buf, off, v) => { new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setInt32(off, v | 0, false); };
  const writeU16 = (buf, off, v) => { new DataView(buf.buffer, buf.byteOffset, buf.byteLength).setUint16(off, v & 0xffff, false); };
  const s15Fixed16 = (v) => Math.round(v * 65536);  // ICC s15Fixed16Number

  const xyzTag = (X, Y, Z) => {
    const t = new Uint8Array(20);
    writeSig(t, 0, 'XYZ ');
    // bytes 4–7 reserved (zero)
    writeI32(t, 8,  s15Fixed16(X));
    writeI32(t, 12, s15Fixed16(Y));
    writeI32(t, 16, s15Fixed16(Z));
    return t;
  };
  // ICC parametric curve type 3: Y = (a*X + b)^g  if X ≥ d, else c*X.
  // sRGB transfer params: g=2.4, a=1/1.055, b=0.055/1.055, c=1/12.92, d=0.04045.
  const paraTag = () => {
    const t = new Uint8Array(32);
    writeSig(t, 0, 'para');
    writeU16(t, 8, 3);     // function type 3
    // bytes 10–11 reserved
    writeI32(t, 12, s15Fixed16(2.4));
    writeI32(t, 16, s15Fixed16(1 / 1.055));
    writeI32(t, 20, s15Fixed16(0.055 / 1.055));
    writeI32(t, 24, s15Fixed16(1 / 12.92));
    writeI32(t, 28, s15Fixed16(0.04045));
    return t;
  };
  // 'desc' tag: ICC v2 profileDescriptionTag.
  const descTag = (text) => {
    const ascii = new TextEncoder().encode(text + '\0');
    const total = 8 + 4 + ascii.length + 4 + 4 + 2 + 1 + 67;
    const t = new Uint8Array(total);
    writeSig(t, 0, 'desc');
    writeU32(t, 8, ascii.length);  // ASCII count incl null
    t.set(ascii, 12);
    // unicode lang (u32=0), unicode count (u32=0), scriptcode (u16=0),
    // scriptcode length (u8=0), scriptcode buf (67 zeros) all stay zero.
    return t;
  };
  // 'text' tag for copyright.
  const textTag = (s) => {
    const ascii = new TextEncoder().encode(s + '\0');
    const t = new Uint8Array(8 + ascii.length);
    writeSig(t, 0, 'text');
    t.set(ascii, 8);
    return t;
  };
  // Pad a tag to a 4-byte boundary as ICC requires for tag data.
  const pad4 = (buf) => {
    const r = buf.length % 4;
    if (r === 0) return buf;
    const out = new Uint8Array(buf.length + (4 - r));
    out.set(buf, 0);
    return out;
  };

  // ---------- Build tag payloads ----------
  // sRGB primaries adapted from D65 → D50 (Bradford), from the public
  // sRGB v4 reference profile (numbers used by every ICC-blessed sRGB).
  const tagPayloads = {
    desc: pad4(descTag('sRGB IEC61966-2.1 (girard)')),
    cprt: pad4(textTag('Public domain. Generated by girard.')),
    wtpt: pad4(xyzTag(0.9642, 1.0000, 0.8249)),  // D50 PCS white point
    rXYZ: pad4(xyzTag(0.4361, 0.2225, 0.0139)),
    gXYZ: pad4(xyzTag(0.3851, 0.7169, 0.0971)),
    bXYZ: pad4(xyzTag(0.1431, 0.0606, 0.7141)),
    rTRC: pad4(paraTag()),
    gTRC: pad4(paraTag()),
    bTRC: pad4(paraTag()),
  };
  const tagOrder = ['desc', 'cprt', 'wtpt', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC'];

  // ---------- Assemble profile ----------
  const tagCount = tagOrder.length;
  const tagTableOffset = 128;
  const tagDataStart = tagTableOffset + 4 + tagCount * 12;
  let cursor = tagDataStart;
  const tagInfo = {};
  for (const sig of tagOrder) {
    tagInfo[sig] = { offset: cursor, size: tagPayloads[sig].length };
    cursor += tagPayloads[sig].length;
  }
  const totalSize = cursor;
  const profile = new Uint8Array(totalSize);

  // Header (128 bytes).
  writeU32(profile, 0, totalSize);                 // profile size
  writeSig(profile, 4, 'lcms');                    // preferred CMM (just a hint)
  writeU32(profile, 8, 0x02400000);                // profile version 2.4
  writeSig(profile, 12, 'mntr');                   // device class: display
  writeSig(profile, 16, 'RGB ');                   // colour space
  writeSig(profile, 20, 'XYZ ');                   // PCS
  // bytes 24–35 creation date — leave zero, valid per spec
  writeSig(profile, 36, 'acsp');                   // file signature
  // bytes 40–43 platform — leave zero
  // 44–47 flags = 0
  // 48–51 device manufacturer = 0
  // 52–55 device model = 0
  // 56–63 device attributes = 0
  writeU32(profile, 64, 0);                        // rendering intent = perceptual
  // PCS illuminant (D50): X=0.9642, Y=1.0000, Z=0.8249.
  writeI32(profile, 68, s15Fixed16(0.9642));
  writeI32(profile, 72, s15Fixed16(1.0000));
  writeI32(profile, 76, s15Fixed16(0.8249));
  writeSig(profile, 80, 'girl');                   // profile creator (just a label)
  // 84–99 profile ID (16 bytes) — leave zero (legal for v2 profiles)
  // 100–127 reserved zeros

  // Tag table (count + entries).
  writeU32(profile, tagTableOffset, tagCount);
  let tagEntryCursor = tagTableOffset + 4;
  for (const sig of tagOrder) {
    writeSig(profile, tagEntryCursor, sig);
    writeU32(profile, tagEntryCursor + 4, tagInfo[sig].offset);
    writeU32(profile, tagEntryCursor + 8, tagInfo[sig].size);
    tagEntryCursor += 12;
  }
  // Tag payloads.
  for (const sig of tagOrder) {
    profile.set(tagPayloads[sig], tagInfo[sig].offset);
  }
  _srgbIccCache = profile;
  return profile;
}

// sRGB → XYZ D50 PCS using the same primaries the sRGB profile encodes.
// The matrix is sRGB (D65) primaries Bradford-adapted to D50. Inputs
// are 0-255 sRGB integers, output is 0..1 PCS XYZ (1.0 = 0x8000 in
// ICC lut16 encoding).
function srgbToXyzD50(r, g, b) {
  const R = srgbToLinear(r / 255), G = srgbToLinear(g / 255), B = srgbToLinear(b / 255);
  return {
    X: 0.4361 * R + 0.3851 * G + 0.1431 * B,
    Y: 0.2225 * R + 0.7169 * G + 0.0606 * B,
    Z: 0.0139 * R + 0.0971 * G + 0.7141 * B,
  };
}
// Inverse: XYZ D50 → sRGB integers, clamped 0–255.
function xyzD50ToSrgb(X, Y, Z) {
  // Inverse of the above matrix.
  const R =  3.1339 * X - 1.6173 * Y - 0.4907 * Z;
  const G = -0.9788 * X + 1.9162 * Y + 0.0335 * Z;
  const B =  0.0720 * X - 0.2290 * Y + 1.4055 * Z;
  return {
    r: Math.round(linearToSrgb(Math.max(0, Math.min(1, R))) * 255),
    g: Math.round(linearToSrgb(Math.max(0, Math.min(1, G))) * 255),
    b: Math.round(linearToSrgb(Math.max(0, Math.min(1, B))) * 255),
  };
}

// ---------- CMYK ICC profile generator ----------
// Build a real ICC v2 CMYK profile for the given region by SAMPLING our
// profile-aware math at LUT grid points. The resulting binary is a
// spec-valid ICC profile (device class 'prtr', colour space 'CMYK',
// PCS 'XYZ ') that a print shop's preflight will accept and a RIP can
// use as a colour-management target.
//
// Tags emitted: desc, cprt, wtpt, bkpt, A2B0 (CMYK→XYZ), B2A0 (XYZ→CMYK).
// A2B0 uses a 9⁴ grid (6,561 samples ≈ 39 KB); B2A0 uses a 17³ grid
// (4,913 samples ≈ 39 KB). Total profile ~85 KB — comparable to a
// real-world CMYK profile.
const _cmykIccCache = new Map();
function buildCmykIccProfile(profileId) {
  // User-uploaded profile takes precedence: embed the original bytes
  // so the PDF/TIFF OutputIntent points at exactly the profile the
  // shop expects, not our synthesised approximation.
  const user = iccProfiler.userProfiles.get(profileId);
  if (user && user.bytes) return user.bytes;
  if (_cmykIccCache.has(profileId)) return _cmykIccCache.get(profileId);
  const params = PROFILE_PARAMS[profileId];
  if (!params) return null;

  // ----- helpers -----
  const writeSig = (buf, off, sig) => { for (let i = 0; i < 4; i++) buf[off + i] = sig.charCodeAt(i); };
  const dv = (buf) => new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const w32 = (b, o, v) => dv(b).setUint32(o, v >>> 0, false);
  const wi32 = (b, o, v) => dv(b).setInt32(o, v | 0, false);
  const w16 = (b, o, v) => dv(b).setUint16(o, v & 0xffff, false);
  const wi16 = (b, o, v) => dv(b).setInt16(o, v, false);
  const s15Fixed16 = (v) => Math.round(v * 65536);
  const clamp16 = (v) => Math.max(0, Math.min(65535, Math.round(v)));
  // ICC lut16 XYZ encoding: 1.0 = 0x8000 (32768), max representable ≈ 1.9999.
  const xyz16 = (v) => clamp16(v * 32768);

  // ----- generate A2B0 LUT: CMYK → XYZ -----
  // ICC lut16Type expects input order such that the LAST input dim is the
  // fastest-changing. For CMYK that means K is innermost when reading,
  // so we iterate C (outermost) → M → Y → K (innermost) to match.
  const gA = 9;
  const a2bClut = new Uint16Array(gA * gA * gA * gA * 3);
  let aIdx = 0;
  for (let ci = 0; ci < gA; ci++) {
    const c = ci / (gA - 1);
    for (let mi = 0; mi < gA; mi++) {
      const m = mi / (gA - 1);
      for (let yi = 0; yi < gA; yi++) {
        const y = yi / (gA - 1);
        for (let ki = 0; ki < gA; ki++) {
          const k = ki / (gA - 1);
          const rgb = profileCmykToRgb(c, m, y, k, profileId);
          const xyz = srgbToXyzD50(rgb.r, rgb.g, rgb.b);
          a2bClut[aIdx++] = xyz16(xyz.X);
          a2bClut[aIdx++] = xyz16(xyz.Y);
          a2bClut[aIdx++] = xyz16(xyz.Z);
        }
      }
    }
  }

  // ----- generate B2A0 LUT: XYZ → CMYK -----
  // PCS XYZ inputs are 0..2 (clamped at 0x8000=1.0 typically); we sample
  // the printable cube 0..1 X and Z, 0..1 Y.
  const gB = 17;
  const b2aClut = new Uint16Array(gB * gB * gB * 4);
  let bIdx = 0;
  for (let xi = 0; xi < gB; xi++) {
    const X = xi / (gB - 1);
    for (let yi = 0; yi < gB; yi++) {
      const Y = yi / (gB - 1);
      for (let zi = 0; zi < gB; zi++) {
        const Z = zi / (gB - 1);
        const rgb = xyzD50ToSrgb(X, Y, Z);
        const cmyk = profileRgbToCmyk(rgb.r, rgb.g, rgb.b, profileId);
        b2aClut[bIdx++] = clamp16(cmyk.c * 65535);
        b2aClut[bIdx++] = clamp16(cmyk.m * 65535);
        b2aClut[bIdx++] = clamp16(cmyk.y * 65535);
        b2aClut[bIdx++] = clamp16(cmyk.k * 65535);
      }
    }
  }

  // ----- build mft2 tag bytes -----
  // Layout: 'mft2' + reserved + (i,o,g,reserved) + 36-byte identity matrix
  // + (n,m as u16) + input tables (i*n*2) + CLUT (g^i*o*2) + output tables (o*m*2)
  const buildMft2 = (inCh, outCh, g, clutData) => {
    const n = 256, m = 256;
    const inTableSize = inCh * n * 2;
    const clutSize = clutData.length * 2;
    const outTableSize = outCh * m * 2;
    const total = 8 + 4 + 36 + 4 + inTableSize + clutSize + outTableSize;
    const t = new Uint8Array(total);
    writeSig(t, 0, 'mft2');
    // bytes 4–7 reserved
    t[8] = inCh; t[9] = outCh; t[10] = g; t[11] = 0;
    // identity matrix at 12..47
    wi32(t, 12, s15Fixed16(1)); wi32(t, 16, s15Fixed16(0)); wi32(t, 20, s15Fixed16(0));
    wi32(t, 24, s15Fixed16(0)); wi32(t, 28, s15Fixed16(1)); wi32(t, 32, s15Fixed16(0));
    wi32(t, 36, s15Fixed16(0)); wi32(t, 40, s15Fixed16(0)); wi32(t, 44, s15Fixed16(1));
    w16(t, 48, n);
    w16(t, 50, m);
    // Input tables: linear 0..65535 across n=256 entries per input channel.
    let p = 52;
    for (let ch = 0; ch < inCh; ch++) {
      for (let i = 0; i < n; i++) {
        w16(t, p, Math.round((i / (n - 1)) * 65535));
        p += 2;
      }
    }
    // CLUT.
    for (let i = 0; i < clutData.length; i++) {
      w16(t, p, clutData[i]);
      p += 2;
    }
    // Output tables: linear 0..65535 across m=256 entries per output channel.
    for (let ch = 0; ch < outCh; ch++) {
      for (let i = 0; i < m; i++) {
        w16(t, p, Math.round((i / (m - 1)) * 65535));
        p += 2;
      }
    }
    return t;
  };

  const a2b0 = buildMft2(4, 3, gA, a2bClut);
  const b2a0 = buildMft2(3, 4, gB, b2aClut);

  // ----- desc / cprt / wtpt / bkpt tags -----
  const xyzTag = (X, Y, Z) => {
    const t = new Uint8Array(20);
    writeSig(t, 0, 'XYZ ');
    wi32(t, 8,  s15Fixed16(X));
    wi32(t, 12, s15Fixed16(Y));
    wi32(t, 16, s15Fixed16(Z));
    return t;
  };
  const descTag = (text) => {
    const ascii = new TextEncoder().encode(text + '\0');
    const total = 12 + ascii.length + 4 + 4 + 2 + 1 + 67;
    const t = new Uint8Array(total);
    writeSig(t, 0, 'desc');
    w32(t, 8, ascii.length);
    t.set(ascii, 12);
    return t;
  };
  const textTag = (s) => {
    const ascii = new TextEncoder().encode(s + '\0');
    const t = new Uint8Array(8 + ascii.length);
    writeSig(t, 0, 'text');
    t.set(ascii, 8);
    return t;
  };
  const pad4 = (buf) => {
    const r = buf.length % 4;
    if (r === 0) return buf;
    const out = new Uint8Array(buf.length + (4 - r));
    out.set(buf, 0);
    return out;
  };

  const tagPayloads = {
    desc: pad4(descTag(`${profileId} (girard-synthesised)`)),
    cprt: pad4(textTag('Synthesised by girard from profile-aware math. Public domain.')),
    wtpt: pad4(xyzTag(0.9642, 1.0000, 0.8249)),    // D50 reference white
    bkpt: pad4(xyzTag(0.0034, 0.0035, 0.0029)),    // typical CMYK black point
    A2B0: pad4(a2b0),
    B2A0: pad4(b2a0),
  };
  const tagOrder = ['desc', 'cprt', 'wtpt', 'bkpt', 'A2B0', 'B2A0'];

  // ----- assemble profile -----
  const tagCount = tagOrder.length;
  const tagTableOffset = 128;
  let cursor = tagTableOffset + 4 + tagCount * 12;
  const tagInfo = {};
  for (const sig of tagOrder) {
    tagInfo[sig] = { offset: cursor, size: tagPayloads[sig].length };
    cursor += tagPayloads[sig].length;
  }
  const totalSize = cursor;
  const profile = new Uint8Array(totalSize);

  // header
  w32(profile, 0, totalSize);
  writeSig(profile, 4, 'lcms');
  w32(profile, 8, 0x02400000);            // version 2.4
  writeSig(profile, 12, 'prtr');           // device class: output
  writeSig(profile, 16, 'CMYK');
  writeSig(profile, 20, 'XYZ ');
  writeSig(profile, 36, 'acsp');
  w32(profile, 64, 0);                     // rendering intent: perceptual
  wi32(profile, 68, s15Fixed16(0.9642));
  wi32(profile, 72, s15Fixed16(1.0000));
  wi32(profile, 76, s15Fixed16(0.8249));
  writeSig(profile, 80, 'girl');

  // tag table
  w32(profile, tagTableOffset, tagCount);
  let entry = tagTableOffset + 4;
  for (const sig of tagOrder) {
    writeSig(profile, entry, sig);
    w32(profile, entry + 4, tagInfo[sig].offset);
    w32(profile, entry + 8, tagInfo[sig].size);
    entry += 12;
  }
  for (const sig of tagOrder) {
    profile.set(tagPayloads[sig], tagInfo[sig].offset);
  }

  _cmykIccCache.set(profileId, profile);
  return profile;
}

// ---------- TIFF ----------
// Two modes:
//   - sRGB TIFF (default): RGBA pixels, LZW, RGB photometric. Same as
//     viewing in any image tool.
//   - CMYK TIFF (when ICC profiler is loaded): every pixel converted
//     through the active profile's RGB→CMYK transform, then written as
//     PhotometricInterpretation=5 (Separated) so RIPs see real CMYK.
const TIFF_LIB_URL = 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';
function exportTileTiff(pattern, baseName) {
  // CMYK destination: bypass soft proof so the conversion goes
  // straight from original sRGB → CMYK, not through a round-trip.
  const skipSoftProof = iccProfiler.loaded;
  rasterizeForExport(pattern, { forceBackground: true, skipSoftProof }).then(({ canvas, W, H }) =>
    loadScript(TIFF_LIB_URL).then(() => {
      const UTIF = window.UTIF;
      if (!UTIF || !UTIF.encodeImage) throw new Error('UTIF not available');
      const ctx = canvas.getContext('2d');
      const rgba = ctx.getImageData(0, 0, W, H).data;
      const useCmyk = iccProfiler.loaded;
      let ifd;
      const intent = useCmyk
        ? `girard tile — converted sRGB→${pattern.iccProfile || 'U.S. Web Coated (SWOP) v2'} (profile-aware approx)`
        : 'girard tile — sRGB IEC61966-2.1';
      if (useCmyk) {
        // Per-pixel RGB→CMYK using the active profile.
        const profileId = pattern.iccProfile || 'U.S. Web Coated (SWOP) v2';
        const cmyk = new Uint8Array(W * H * 4);
        const N = W * H;
        for (let i = 0; i < N; i++) {
          const o = i * 4;
          const px = profileRgbToCmyk(rgba[o], rgba[o + 1], rgba[o + 2], profileId);
          cmyk[o]     = Math.round(px.c * 255);
          cmyk[o + 1] = Math.round(px.m * 255);
          cmyk[o + 2] = Math.round(px.y * 255);
          cmyk[o + 3] = Math.round(px.k * 255);
        }
        // Hand-built IFD for chunky-CMYK output. UTIF.encode honours
        // the tag values we set, so PhotometricInterpretation=5 with
        // SamplesPerPixel=4 produces a Separated TIFF that print
        // tools (Photoshop, Acrobat, RIPs) will read as CMYK.
        ifd = {
          't254': [0],            // NewSubfileType
          't256': [W],            // ImageWidth
          't257': [H],            // ImageLength
          't258': [8, 8, 8, 8],   // BitsPerSample (8-bit × 4 channels)
          't259': [1],            // Compression: 1 = none (LZW path through UTIF is RGB-tuned)
          't262': [5],            // PhotometricInterpretation: 5 = Separated (CMYK)
          't277': [4],            // SamplesPerPixel
          't278': [H],            // RowsPerStrip (single strip = full image)
          't279': [cmyk.length],  // StripByteCounts
          't282': [300],          // XResolution
          't283': [300],          // YResolution
          't284': [1],            // PlanarConfiguration: 1 = chunky (CMYK CMYK …)
          't296': [2],            // ResolutionUnit: 2 = inch
          't339': [1, 1, 1, 1],   // SampleFormat: unsigned integer
          'data': cmyk,
          'isLE': true,
        };
      } else {
        ifd = UTIF.encodeImage(rgba, W, H);
        ifd.t282 = [300]; ifd.t283 = [300]; ifd.t296 = [2];
      }
      // Metadata (intent + producer) on both branches.
      ifd.t270 = [intent];
      ifd.t305 = ['girard v0.01a'];
      // Tag 34675 (ICCProfile): real ICC profile binary embedded so the
      // RIP / image viewer can colour-manage the file. CMYK TIFFs get
      // the synthesised CMYK profile for the chosen region; sRGB TIFFs
      // get the generated sRGB v2 profile.
      const iccBytes = useCmyk
        ? buildCmykIccProfile(pattern.iccProfile || 'U.S. Web Coated (SWOP) v2')
        : buildSrgbIccProfile();
      if (iccBytes) ifd.t34675 = iccBytes;
      const buf = UTIF.encode([ifd]);
      downloadBlob(new Blob([buf], { type: 'image/tiff' }), `${baseName}.tif`);
    }).catch(err => console.error('girard: TIFF export failed:', err))
  );
}

// ---------- SVG → PDF vector emitter ----------
// Walks a tile SVG tree and emits PDF content-stream operators. The
// emitter is intentionally conservative: it handles the geometry we
// actually generate (rect / circle / ellipse / polygon / polyline /
// line / path with M/L/C/Q/Z) and group transforms, and bails out
// when it encounters features that need real implementation work
// (text, clipPath, filters, masks). Callers check `canVectorize()`
// before committing to the vector path; if false they fall back to
// raster.
// Node accessors that work on both real SVG DOM nodes and the plain
// {tag, attrs, children} objects used in unit tests.
function nTag(n) {
  if (!n) return null;
  const t = n.tag || n.tagName;
  return t ? String(t).toLowerCase() : null;
}
function nAttr(n, k) {
  if (!n) return null;
  if (n.attrs) return n.attrs[k];
  if (n.getAttribute) return n.getAttribute(k);
  return null;
}
function nChildren(n) {
  if (!n) return [];
  if (Array.isArray(n.children)) return n.children;
  if (n.children) return Array.from(n.children);
  return [];
}
function nText(n) {
  if (!n) return '';
  if (typeof n.textContent === 'string') return n.textContent;
  if (typeof n.text === 'string') return n.text;
  return '';
}

// CSS font-weight → numeric. SVG accepts both `400` and `bold`; the
// font map is keyed by number so we have to canonicalise.
const FONT_WEIGHT_MAP = { normal: 400, bold: 700, bolder: 900, lighter: 100 };
function parseFontWeight(v) {
  if (v == null) return 400;
  const s = String(v).toLowerCase().trim();
  if (FONT_WEIGHT_MAP[s] != null) return FONT_WEIGHT_MAP[s];
  const n = parseInt(s, 10);
  return isNaN(n) ? 400 : n;
}

// Parse the subset of `style` attribute properties the walker cares
// about (opacity / mix-blend-mode). Returns { opacity, blendMode } —
// undefined for keys not present so callers can fall back cleanly.
function parseStyleAttr(s) {
  const out = {};
  if (!s) return out;
  for (const decl of String(s).split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const k = decl.slice(0, i).trim().toLowerCase();
    const v = decl.slice(i + 1).trim();
    if (k === 'opacity') out.opacity = Number(v);
    else if (k === 'mix-blend-mode') out.blendMode = v;
    else if (k === 'fill-opacity') out.fillOpacity = Number(v);
    else if (k === 'stroke-opacity') out.strokeOpacity = Number(v);
  }
  return out;
}

// SVG mix-blend-mode → PDF /BM name. CSS uses kebab-case; PDF uses
// CamelCase. PDF 1.4+ supports the full Porter-Duff + separable
// blending set, so the mapping is one-to-one for every standard mode.
function svgBlendToPdf(bm) {
  if (!bm || bm === 'normal') return 'Normal';
  return String(bm).split('-').map(p => p ? p[0].toUpperCase() + p.slice(1) : '').join('');
}

// Per-export registry of /ExtGState resources used by the page. Keyed
// by (ca, CA, blendMode) tuple → { name, ca, CA, BM }. The caller
// materialises these into the page's Resources/ExtGState dict after
// walking.
function makeGsRegistry() { return new Map(); }
function gsRefName(reg, ca, CA, BM) {
  const k = `${ca.toFixed(4)}|${CA.toFixed(4)}|${BM}`;
  const hit = reg.get(k);
  if (hit) return hit.name;
  const name = `GS${reg.size}`;
  reg.set(k, { name, ca, CA, BM });
  return name;
}

// `fontMap` is the per-export Map<family|weight|style, opentypeFont>
// built by loadGlyphsForPattern. When supplied, text whose font is
// loaded vectorizes inline; when omitted (or missing a needed font),
// the presence of any <text> forces raster fallback.
function canVectorize(svg, fontMap) {
  let ok = true;
  const walk = (n) => {
    if (!ok || !n) return;
    const tag = nTag(n);
    if (tag === 'text') {
      const family = nAttr(n, 'font-family') || 'sans-serif';
      const w = parseFontWeight(nAttr(n, 'font-weight'));
      const s = nAttr(n, 'font-style') || 'normal';
      if (!fontMap || !fontMap.get(`${family}|${w}|${s}`)) ok = false;
    }
    if (tag === 'use' || tag === 'mask' || tag === 'filter') ok = false;
    // clip-path is now handled — we walk the defs and emit `W n` inside
    // a saved graphics state, so every clipPath the patterns produce
    // round-trips into PDF natively.
    nChildren(n).forEach(walk);
  };
  walk(svg);
  return ok;
}

// Parse an SVG transform string into a 2D affine matrix [a, b, c, d, e, f].
function parseSvgTransform(str) {
  if (!str) return [1, 0, 0, 1, 0, 0];
  let M = [1, 0, 0, 1, 0, 0];
  const mul = (A, B) => [
    A[0] * B[0] + A[2] * B[1],
    A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3],
    A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4],
    A[1] * B[4] + A[3] * B[5] + A[5],
  ];
  const re = /(matrix|translate|rotate|scale|skewX|skewY)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const args = m[2].split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    let T;
    switch (m[1]) {
      case 'matrix':    T = args; break;
      case 'translate': T = [1, 0, 0, 1, args[0] || 0, args[1] || 0]; break;
      case 'scale':     T = [args[0] || 1, 0, 0, (args[1] != null ? args[1] : args[0]) || 1, 0, 0]; break;
      case 'rotate': {
        const a = ((args[0] || 0) * Math.PI) / 180;
        const c = Math.cos(a), s = Math.sin(a);
        let R = [c, s, -s, c, 0, 0];
        if (args.length >= 3) {
          const cx = args[1], cy = args[2];
          R = mul([1, 0, 0, 1, cx, cy], R);
          R = mul(R, [1, 0, 0, 1, -cx, -cy]);
        }
        T = R;
        break;
      }
      case 'skewX': { const t = Math.tan(((args[0] || 0) * Math.PI) / 180); T = [1, 0, t, 1, 0, 0]; break; }
      case 'skewY': { const t = Math.tan(((args[0] || 0) * Math.PI) / 180); T = [1, t, 0, 1, 0, 0]; break; }
      default: continue;
    }
    M = mul(M, T);
  }
  return M;
}

// Emit a PDF colour operator for the given hex (or named) colour. Uses
// /DeviceCMYK when the ICC profiler is loaded; otherwise /DeviceRGB.
function pdfColor(hex, profileId, stroke) {
  if (!hex || hex === 'none' || hex === 'transparent') return null;
  const rgba = parseColor(hex);
  const fmt = (v) => v.toFixed(4);
  if (iccProfiler.loaded) {
    const c = profileRgbToCmyk(rgba.r, rgba.g, rgba.b, profileId);
    return `${fmt(c.c)} ${fmt(c.m)} ${fmt(c.y)} ${fmt(c.k)} ${stroke ? 'K' : 'k'}`;
  }
  return `${fmt(rgba.r / 255)} ${fmt(rgba.g / 255)} ${fmt(rgba.b / 255)} ${stroke ? 'RG' : 'rg'}`;
}

// Convert an SVG path 'd' attribute into PDF path operators (m, l, c, h).
// Handles M/m, L/l, C/c, Q/q (cubic via 2/3 lifting), Z/z, H/h, V/v.
function svgPathToPdf(d) {
  const out = [];
  // Tokenise: command letters + signed floats.
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e-?\d+)?/g) || [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, prevC = null;
  const num = () => parseFloat(tokens[i++]);
  const fmt = (v) => v.toFixed(3);
  let cmd = '';
  while (i < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[i])) { cmd = tokens[i++]; }
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'M') {
      let nx = num(), ny = num();
      if (rel) { nx += x; ny += y; }
      out.push(`${fmt(nx)} ${fmt(ny)} m`);
      x = nx; y = ny; sx = x; sy = y; prevC = null;
      // Subsequent pairs after M are implicit L
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      let nx = num(), ny = num();
      if (rel) { nx += x; ny += y; }
      out.push(`${fmt(nx)} ${fmt(ny)} l`);
      x = nx; y = ny; prevC = null;
    } else if (C === 'H') {
      let nx = num();
      if (rel) nx += x;
      out.push(`${fmt(nx)} ${fmt(y)} l`);
      x = nx; prevC = null;
    } else if (C === 'V') {
      let ny = num();
      if (rel) ny += y;
      out.push(`${fmt(x)} ${fmt(ny)} l`);
      y = ny; prevC = null;
    } else if (C === 'C') {
      let c1x = num(), c1y = num(), c2x = num(), c2y = num(), nx = num(), ny = num();
      if (rel) { c1x += x; c1y += y; c2x += x; c2y += y; nx += x; ny += y; }
      out.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(nx)} ${fmt(ny)} c`);
      prevC = [c2x, c2y]; x = nx; y = ny;
    } else if (C === 'S') {
      let c2x = num(), c2y = num(), nx = num(), ny = num();
      if (rel) { c2x += x; c2y += y; nx += x; ny += y; }
      const c1x = prevC ? 2 * x - prevC[0] : x;
      const c1y = prevC ? 2 * y - prevC[1] : y;
      out.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(nx)} ${fmt(ny)} c`);
      prevC = [c2x, c2y]; x = nx; y = ny;
    } else if (C === 'Q') {
      // Quadratic → cubic: C1 = P0 + (2/3)(P1-P0); C2 = P2 + (2/3)(P1-P2)
      let qx = num(), qy = num(), nx = num(), ny = num();
      if (rel) { qx += x; qy += y; nx += x; ny += y; }
      const c1x = x + (2 / 3) * (qx - x);
      const c1y = y + (2 / 3) * (qy - y);
      const c2x = nx + (2 / 3) * (qx - nx);
      const c2y = ny + (2 / 3) * (qy - ny);
      out.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(nx)} ${fmt(ny)} c`);
      prevC = null; x = nx; y = ny;
    } else if (C === 'Z') {
      out.push('h');
      x = sx; y = sy; prevC = null;
    } else {
      // Unsupported (A — elliptical arc). Skip its args best-effort.
      if (C === 'A') { num(); num(); num(); num(); num(); num(); num(); }
      else { i++; } // skip stray token
    }
  }
  return out;
}

// Build a map of clipPath id → defining element by walking the tree
// once. Patterns put clipPaths either in a top-level <defs> (slant
// fill is the main example) or directly under <svg>. We accept both.
function indexClipPaths(root) {
  const map = new Map();
  const walk = (n) => {
    if (!n) return;
    if (nTag(n) === 'clippath') {
      const id = nAttr(n, 'id');
      if (id) map.set(id, n);
    }
    nChildren(n).forEach(walk);
  };
  walk(root);
  return map;
}

// Emit path-only PDF operators (no paint) for the children of a
// clipPath element. Followed by `W n` this becomes the active clip.
function emitClipShapeOps(clipNode, ops) {
  for (const child of nChildren(clipNode)) {
    const tag = nTag(child);
    if (tag === 'rect') {
      const x = +nAttr(child, 'x') || 0, y = +nAttr(child, 'y') || 0;
      const w = +nAttr(child, 'width') || 0, h = +nAttr(child, 'height') || 0;
      ops.push(`${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)} re`);
    } else if (tag === 'polygon' || tag === 'polyline') {
      const pts = (nAttr(child, 'points') || '').match(/-?\d*\.?\d+/g) || [];
      if (pts.length >= 4) {
        ops.push(`${pts[0]} ${pts[1]} m`);
        for (let p = 2; p + 1 < pts.length; p += 2) ops.push(`${pts[p]} ${pts[p + 1]} l`);
        if (tag === 'polygon') ops.push('h');
      }
    } else if (tag === 'path') {
      const d = nAttr(child, 'd');
      if (d) svgPathToPdf(d).forEach(o => ops.push(o));
    } else if (tag === 'circle') {
      const cx = +nAttr(child, 'cx') || 0, cy = +nAttr(child, 'cy') || 0, r = +nAttr(child, 'r') || 0;
      const k = 0.5522847 * r;
      ops.push(`${(cx - r).toFixed(3)} ${cy.toFixed(3)} m`);
      ops.push(`${(cx - r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx - k).toFixed(3)} ${(cy + r).toFixed(3)} ${cx.toFixed(3)} ${(cy + r).toFixed(3)} c`);
      ops.push(`${(cx + k).toFixed(3)} ${(cy + r).toFixed(3)} ${(cx + r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx + r).toFixed(3)} ${cy.toFixed(3)} c`);
      ops.push(`${(cx + r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx + k).toFixed(3)} ${(cy - r).toFixed(3)} ${cx.toFixed(3)} ${(cy - r).toFixed(3)} c`);
      ops.push(`${(cx - k).toFixed(3)} ${(cy - r).toFixed(3)} ${(cx - r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx - r).toFixed(3)} ${cy.toFixed(3)} c`);
      ops.push('h');
    }
  }
}

// Emit PDF path operators for an opentype.js Path. TTF outlines are
// quadratic; we convert Q → C inline since PDF only has cubic curves.
function emitOpentypePath(path, ops) {
  const fmt = v => v.toFixed(3);
  let px = 0, py = 0;
  for (const cmd of path.commands) {
    if (cmd.type === 'M') { ops.push(`${fmt(cmd.x)} ${fmt(cmd.y)} m`); px = cmd.x; py = cmd.y; }
    else if (cmd.type === 'L') { ops.push(`${fmt(cmd.x)} ${fmt(cmd.y)} l`); px = cmd.x; py = cmd.y; }
    else if (cmd.type === 'C') { ops.push(`${fmt(cmd.x1)} ${fmt(cmd.y1)} ${fmt(cmd.x2)} ${fmt(cmd.y2)} ${fmt(cmd.x)} ${fmt(cmd.y)} c`); px = cmd.x; py = cmd.y; }
    else if (cmd.type === 'Q') {
      const c1x = px + (2 / 3) * (cmd.x1 - px);
      const c1y = py + (2 / 3) * (cmd.y1 - py);
      const c2x = cmd.x + (2 / 3) * (cmd.x1 - cmd.x);
      const c2y = cmd.y + (2 / 3) * (cmd.y1 - cmd.y);
      ops.push(`${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(cmd.x)} ${fmt(cmd.y)} c`);
      px = cmd.x; py = cmd.y;
    }
    else if (cmd.type === 'Z') ops.push('h');
  }
}

// Walk a tile SVG tree, accumulating PDF operator strings. State:
// current fill / stroke / strokeWidth / linecap / linejoin / opacity.
// `clipDefs` is the Map returned by indexClipPaths; if omitted (top-
// level call) we build it from `node` so callers don't need to know.
// `fontMap` is the per-export font dictionary used for text outlining.
function walkSvgToPdfOps(node, state, ops, profileId, clipDefs, fontMap, gsRegistry) {
  if (!node) return;
  if (!clipDefs) clipDefs = indexClipPaths(node);
  if (!fontMap) fontMap = new Map();
  if (!gsRegistry) gsRegistry = makeGsRegistry();
  const tag = nTag(node);
  if (!tag) return;
  if (tag === 'defs' || tag === 'clippath') return;
  const transform = nAttr(node, 'transform');
  const clipPath = nAttr(node, 'clip-path');
  // Pull opacity / blend-mode from either explicit attrs or the
  // `style` attribute (renderLayer writes group opacity / blend via
  // style; per-cell text shapes use attrs directly).
  const styleParsed = parseStyleAttr(nAttr(node, 'style'));
  const rawOp     = nAttr(node, 'opacity');
  const rawFillOp = nAttr(node, 'fill-opacity');
  const rawStkOp  = nAttr(node, 'stroke-opacity');
  const opacity      = rawOp     != null ? Number(rawOp)     : (styleParsed.opacity        != null ? styleParsed.opacity        : 1);
  const fillOpacity  = rawFillOp != null ? Number(rawFillOp) : (styleParsed.fillOpacity    != null ? styleParsed.fillOpacity    : 1);
  const strokeOpacity= rawStkOp  != null ? Number(rawStkOp)  : (styleParsed.strokeOpacity  != null ? styleParsed.strokeOpacity  : 1);
  const blendMode = svgBlendToPdf(styleParsed.blendMode);
  const ca = opacity * fillOpacity;
  const CA = opacity * strokeOpacity;
  const needGs = ca < 0.9995 || CA < 0.9995 || blendMode !== 'Normal';
  let pushed = false;
  if (transform || clipPath || needGs) {
    ops.push('q');
    pushed = true;
  }
  if (transform) {
    const [a, b, c, d, e, f] = parseSvgTransform(transform);
    ops.push(`${a.toFixed(5)} ${b.toFixed(5)} ${c.toFixed(5)} ${d.toFixed(5)} ${e.toFixed(3)} ${f.toFixed(3)} cm`);
  }
  if (clipPath) {
    // Accept url(#id), url("#id"), url('#id').
    const m = /url\(["']?#([^"')]+)["']?\)/.exec(clipPath);
    const def = m && clipDefs.get(m[1]);
    if (def) {
      emitClipShapeOps(def, ops);
      ops.push('W n');
    }
  }
  if (needGs) ops.push(`/${gsRefName(gsRegistry, ca, CA, blendMode)} gs`);

  // Inherit state, override with this node's attrs.
  const fillA   = nAttr(node, 'fill');
  const strokeA = nAttr(node, 'stroke');
  const swA     = nAttr(node, 'stroke-width');
  const fill   = fillA   != null ? fillA   : state.fill;
  const stroke = strokeA != null ? strokeA : state.stroke;
  const swPx   = swA     != null ? Number(swA) : state.strokeWidth;

  const lcA = nAttr(node, 'stroke-linecap');
  const ljA = nAttr(node, 'stroke-linejoin');
  const sdA = nAttr(node, 'stroke-dasharray');
  const soA = nAttr(node, 'stroke-dashoffset');
  const emitFillStroke = () => {
    const f = pdfColor(fill, profileId, false);
    const s = pdfColor(stroke, profileId, true);
    const hasFill = f && fill !== 'none';
    const hasStroke = s && stroke && stroke !== 'none' && swPx > 0;
    if (hasFill) ops.push(f);
    if (hasStroke) {
      ops.push(s);
      ops.push(`${swPx.toFixed(3)} w`);
      if (lcA) {
        const lcMap = { butt: 0, round: 1, square: 2 };
        ops.push(`${lcMap[lcA] ?? 0} J`);
      }
      if (ljA) {
        const ljMap = { miter: 0, round: 1, bevel: 2 };
        ops.push(`${ljMap[ljA] ?? 0} j`);
      }
      if (sdA && sdA !== 'none') {
        // SVG: comma- or space-separated lengths. PDF: `[a b c …] phase d`.
        const arr = String(sdA).split(/[\s,]+/).filter(Boolean).map(v => Number(v).toFixed(3)).join(' ');
        const phase = Number(soA) || 0;
        ops.push(`[${arr}] ${phase.toFixed(3)} d`);
      }
    }
    return { hasFill, hasStroke };
  };

  const closePaint = ({ hasFill, hasStroke }) => {
    if (hasFill && hasStroke) ops.push('B');
    else if (hasFill) ops.push('f');
    else if (hasStroke) ops.push('S');
    else ops.push('n');
  };

  const recur = () => {
    for (const c of nChildren(node)) walkSvgToPdfOps(c, { fill, stroke, strokeWidth: swPx }, ops, profileId, clipDefs, fontMap, gsRegistry);
  };

  switch (tag) {
    case 'g':
    case 'svg':
      recur();
      break;
    case 'rect': {
      const x = Number(nAttr(node, 'x') || 0), y = Number(nAttr(node, 'y') || 0);
      const w = Number(nAttr(node, 'width') || 0), h = Number(nAttr(node, 'height') || 0);
      const rx = Number(nAttr(node, 'rx') || 0), ry = Number(nAttr(node, 'ry') || rx);
      const fs = emitFillStroke();
      if (rx > 0 || ry > 0) {
        // Rounded rect via 4 corner curves. PDF doesn't have a builtin.
        const k = 0.5522847;  // circle constant
        const ax = Math.min(rx, w / 2), ay = Math.min(ry, h / 2);
        ops.push(`${(x + ax).toFixed(3)} ${y.toFixed(3)} m`);
        ops.push(`${(x + w - ax).toFixed(3)} ${y.toFixed(3)} l`);
        ops.push(`${(x + w - ax * (1 - k)).toFixed(3)} ${y.toFixed(3)} ${(x + w).toFixed(3)} ${(y + ay * (1 - k)).toFixed(3)} ${(x + w).toFixed(3)} ${(y + ay).toFixed(3)} c`);
        ops.push(`${(x + w).toFixed(3)} ${(y + h - ay).toFixed(3)} l`);
        ops.push(`${(x + w).toFixed(3)} ${(y + h - ay * (1 - k)).toFixed(3)} ${(x + w - ax * (1 - k)).toFixed(3)} ${(y + h).toFixed(3)} ${(x + w - ax).toFixed(3)} ${(y + h).toFixed(3)} c`);
        ops.push(`${(x + ax).toFixed(3)} ${(y + h).toFixed(3)} l`);
        ops.push(`${(x + ax * (1 - k)).toFixed(3)} ${(y + h).toFixed(3)} ${x.toFixed(3)} ${(y + h - ay * (1 - k)).toFixed(3)} ${x.toFixed(3)} ${(y + h - ay).toFixed(3)} c`);
        ops.push(`${x.toFixed(3)} ${(y + ay).toFixed(3)} l`);
        ops.push(`${x.toFixed(3)} ${(y + ay * (1 - k)).toFixed(3)} ${(x + ax * (1 - k)).toFixed(3)} ${y.toFixed(3)} ${(x + ax).toFixed(3)} ${y.toFixed(3)} c`);
        ops.push('h');
      } else {
        ops.push(`${x.toFixed(3)} ${y.toFixed(3)} ${w.toFixed(3)} ${h.toFixed(3)} re`);
      }
      closePaint(fs);
      break;
    }
    case 'circle': {
      const cx = Number(nAttr(node, 'cx') || 0), cy = Number(nAttr(node, 'cy') || 0), r = Number(nAttr(node, 'r') || 0);
      const fs = emitFillStroke();
      const k = 0.5522847 * r;
      ops.push(`${(cx - r).toFixed(3)} ${cy.toFixed(3)} m`);
      ops.push(`${(cx - r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx - k).toFixed(3)} ${(cy + r).toFixed(3)} ${cx.toFixed(3)} ${(cy + r).toFixed(3)} c`);
      ops.push(`${(cx + k).toFixed(3)} ${(cy + r).toFixed(3)} ${(cx + r).toFixed(3)} ${(cy + k).toFixed(3)} ${(cx + r).toFixed(3)} ${cy.toFixed(3)} c`);
      ops.push(`${(cx + r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx + k).toFixed(3)} ${(cy - r).toFixed(3)} ${cx.toFixed(3)} ${(cy - r).toFixed(3)} c`);
      ops.push(`${(cx - k).toFixed(3)} ${(cy - r).toFixed(3)} ${(cx - r).toFixed(3)} ${(cy - k).toFixed(3)} ${(cx - r).toFixed(3)} ${cy.toFixed(3)} c`);
      ops.push('h');
      closePaint(fs);
      break;
    }
    case 'ellipse': {
      const cx = Number(nAttr(node, 'cx') || 0), cy = Number(nAttr(node, 'cy') || 0);
      const rx = Number(nAttr(node, 'rx') || 0), ry = Number(nAttr(node, 'ry') || 0);
      const fs = emitFillStroke();
      const kx = 0.5522847 * rx, ky = 0.5522847 * ry;
      ops.push(`${(cx - rx).toFixed(3)} ${cy.toFixed(3)} m`);
      ops.push(`${(cx - rx).toFixed(3)} ${(cy + ky).toFixed(3)} ${(cx - kx).toFixed(3)} ${(cy + ry).toFixed(3)} ${cx.toFixed(3)} ${(cy + ry).toFixed(3)} c`);
      ops.push(`${(cx + kx).toFixed(3)} ${(cy + ry).toFixed(3)} ${(cx + rx).toFixed(3)} ${(cy + ky).toFixed(3)} ${(cx + rx).toFixed(3)} ${cy.toFixed(3)} c`);
      ops.push(`${(cx + rx).toFixed(3)} ${(cy - ky).toFixed(3)} ${(cx + kx).toFixed(3)} ${(cy - ry).toFixed(3)} ${cx.toFixed(3)} ${(cy - ry).toFixed(3)} c`);
      ops.push(`${(cx - kx).toFixed(3)} ${(cy - ry).toFixed(3)} ${(cx - rx).toFixed(3)} ${(cy - ky).toFixed(3)} ${(cx - rx).toFixed(3)} ${cy.toFixed(3)} c`);
      ops.push('h');
      closePaint(fs);
      break;
    }
    case 'line': {
      const x1 = Number(nAttr(node, 'x1') || 0), y1 = Number(nAttr(node, 'y1') || 0);
      const x2 = Number(nAttr(node, 'x2') || 0), y2 = Number(nAttr(node, 'y2') || 0);
      const fs = emitFillStroke();
      ops.push(`${x1.toFixed(3)} ${y1.toFixed(3)} m`);
      ops.push(`${x2.toFixed(3)} ${y2.toFixed(3)} l`);
      // Lines are stroke-only — force stroke regardless of fill, no close.
      if (fs.hasStroke) ops.push('S'); else ops.push('n');
      break;
    }
    case 'polygon':
    case 'polyline': {
      const pts = (nAttr(node, 'points') || '').match(/-?\d*\.?\d+/g) || [];
      const close = tag === 'polygon';
      const fs = emitFillStroke();
      if (pts.length >= 4) {
        ops.push(`${pts[0]} ${pts[1]} m`);
        for (let p = 2; p + 1 < pts.length; p += 2) ops.push(`${pts[p]} ${pts[p + 1]} l`);
        if (close) ops.push('h');
        closePaint(fs);
      }
      break;
    }
    case 'path': {
      const d = nAttr(node, 'd');
      if (!d) break;
      const fs = emitFillStroke();
      svgPathToPdf(d).forEach(op => ops.push(op));
      closePaint(fs);
      break;
    }
    case 'text': {
      const text = nText(node);
      if (!text) break;
      const family = nAttr(node, 'font-family') || 'sans-serif';
      const fw = parseFontWeight(nAttr(node, 'font-weight'));
      const fstyle = nAttr(node, 'font-style') || 'normal';
      const font = fontMap.get(`${family}|${fw}|${fstyle}`);
      if (!font) break;  // canVectorize would have rejected; defensive
      const fontSize = Number(nAttr(node, 'font-size') || 16);
      const anchor = nAttr(node, 'text-anchor') || 'start';
      const baseline = nAttr(node, 'dominant-baseline') || 'alphabetic';
      let tx = Number(nAttr(node, 'x') || 0);
      let ty = Number(nAttr(node, 'y') || 0);
      const advance = font.getAdvanceWidth(text, fontSize);
      if (anchor === 'middle') tx -= advance / 2;
      else if (anchor === 'end') tx -= advance;
      if (baseline === 'central' || baseline === 'middle') {
        // Centre by the visual midline: (ascender + descender) / 2.
        const upm = font.unitsPerEm || 1000;
        const mid = ((font.ascender || upm * 0.8) + (font.descender || -upm * 0.2)) / 2;
        ty -= (mid * fontSize) / upm;
      }
      const fs = emitFillStroke();
      const path = font.getPath(text, tx, ty, fontSize);
      emitOpentypePath(path, ops);
      closePaint(fs);
      break;
    }
    default:
      // Walk children for unrecognised wrappers.
      recur();
  }
  if (pushed) ops.push('Q');
}

// ---------- PDF (raster at high DPI, sRGB) ----------
// Vector PDF / PDF/X-4 with embedded CMYK profile lands next pass; for
// now this is a raster PDF that embeds the high-DPI PNG. Fonts are
// rasterized into that PNG so they reproduce reliably without the
// reader needing the typeface installed.
const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
function exportTilePdf(pattern, baseName) {
  // PDF supports alpha natively (both vector and raster paths) so we
  // honour pattern.exportFlatten: when false, the page has no opaque
  // background and the pattern paints onto transparency.
  rasterizeForExport(pattern, { forceBackground: !!pattern.exportFlatten }).then(({ canvas, W, H }) =>
    loadScript(PDF_LIB_URL).then(async () => {
      const { PDFDocument } = window.PDFLib;
      const pdfDoc = await PDFDocument.create();
      pdfDoc.setTitle(baseName);
      pdfDoc.setCreator('girard — bobbymeyer.com');
      pdfDoc.setProducer('girard v0.01a');
      // Declare colour intent in metadata. Real PDF/X-4 OutputIntent
      // with the embedded ICC binary lands next pass.
      const intent = iccProfiler.loaded
        ? `sRGB source; intended for ${pattern.iccProfile || 'sRGB IEC61966-2.1'} (profile-aware approximation)`
        : 'sRGB IEC61966-2.1';
      pdfDoc.setSubject(intent);
      pdfDoc.setKeywords(['girard', 'tile', 'pattern', pattern.iccProfile || 'sRGB']);
      // Try the vector path first: build the deployable tile SVG, walk
      // it, and emit PDF drawing operators. This produces a
      // resolution-independent vector PDF whose colours go through
      // DeviceRGB / DeviceCMYK directly (no rasterisation step). If
      // the SVG uses features the emitter doesn't handle (text shapes,
      // clip paths), fall back to the raster path.
      const tileSvgForVector = buildTileSvg(pattern, { skipSoftProof: true });
      const fontMap = await loadGlyphsForPattern(pattern);
      const vector = canVectorize(tileSvgForVector.svg, fontMap);
      const vW = tileSvgForVector.width, vH = tileSvgForVector.height;
      const page = pdfDoc.addPage([vector ? vW : W, vector ? vH : H]);
      if (vector) {
        const { PDFOperator, PDFName } = window.PDFLib;
        const profileId = pattern.iccProfile || 'U.S. Web Coated (SWOP) v2';
        // Mark the page contents as a transparency group. Without this
        // most viewers ignore /BM (blend mode) entries on ExtGStates —
        // blend modes are only defined inside a transparency context.
        const groupCS = iccProfiler.loaded ? 'DeviceCMYK' : 'DeviceRGB';
        page.node.set(PDFName.of('Group'), pdfDoc.context.obj({
          Type: PDFName.of('Group'),
          S: PDFName.of('Transparency'),
          CS: PDFName.of(groupCS),
          I: true,
        }));
        const ops = [];
        // Top-level CTM: flip Y so SVG y-down coordinates work directly.
        ops.push('q');
        ops.push(`1 0 0 -1 0 ${vH.toFixed(3)} cm`);
        // Background paint. Only emitted when the user has asked to
        // flatten alpha onto a solid background; otherwise the page
        // stays transparent and viewers / placement apps composite as
        // they see fit.
        if (pattern.exportFlatten) {
          const bgPaint = pdfColor(pattern.exportBackground || '#ffffff', profileId, false);
          if (bgPaint) {
            ops.push(bgPaint);
            ops.push(`0 0 ${vW.toFixed(3)} ${vH.toFixed(3)} re`);
            ops.push('f');
          }
        }
        const gsRegistry = makeGsRegistry();
        walkSvgToPdfOps(tileSvgForVector.svg, { fill: '#000000', stroke: 'none', strokeWidth: 1 }, ops, profileId, undefined, fontMap, gsRegistry);
        ops.push('Q');
        // Materialise any /ExtGState references used by the stream
        // into the page's Resources/ExtGState dict. Each entry holds
        // fill alpha (/ca), stroke alpha (/CA), and blend mode (/BM).
        if (gsRegistry.size > 0) {
          const { PDFName, PDFNumber } = window.PDFLib;
          const resources = pdfDoc.context.obj({});
          const extDict = pdfDoc.context.obj({});
          for (const { name, ca, CA, BM } of gsRegistry.values()) {
            extDict.set(PDFName.of(name), pdfDoc.context.obj({
              Type: PDFName.of('ExtGState'),
              ca: PDFNumber.of(ca),
              CA: PDFNumber.of(CA),
              BM: PDFName.of(BM),
            }));
          }
          resources.set(PDFName.of('ExtGState'), extDict);
          page.node.set(PDFName.of('Resources'), resources);
        }
        page.pushOperators(...ops.map(s => PDFOperator.of(s + '\n')));
      } else if (iccProfiler.loaded) {
        // True CMYK content: convert pixels through the active profile
        // and embed as a /DeviceCMYK image XObject. PDF/X-4 with this
        // CMYK content + matching CMYK OutputIntent (set below) is real
        // press-ready conformance, not just a metadata claim.
        const profileId = pattern.iccProfile || 'U.S. Web Coated (SWOP) v2';
        const ctx = canvas.getContext('2d');
        const rgba = ctx.getImageData(0, 0, W, H).data;
        const cmyk = new Uint8Array(W * H * 4);
        const alpha = new Uint8Array(W * H);
        let anyAlpha = false;
        for (let i = 0, N = W * H; i < N; i++) {
          const o = i * 4;
          const px = profileRgbToCmyk(rgba[o], rgba[o + 1], rgba[o + 2], profileId);
          cmyk[o]     = Math.round(px.c * 255);
          cmyk[o + 1] = Math.round(px.m * 255);
          cmyk[o + 2] = Math.round(px.y * 255);
          cmyk[o + 3] = Math.round(px.k * 255);
          const a = rgba[o + 3];
          alpha[i] = a;
          if (a < 255) anyAlpha = true;
        }
        const { PDFName, PDFNumber, PDFRawStream, PDFOperator, PDFHexString, PDFContext } = window.PDFLib;
        // Image XObject dictionary. pdf-lib's flateStream compresses the
        // pixel data with FlateDecode and sets the /Filter entry.
        const imgDict = pdfDoc.context.obj({
          Type: PDFName.of('XObject'),
          Subtype: PDFName.of('Image'),
          Width: PDFNumber.of(W),
          Height: PDFNumber.of(H),
          ColorSpace: PDFName.of('DeviceCMYK'),
          BitsPerComponent: PDFNumber.of(8),
        });
        // Soft mask: 8-bit grayscale image of per-pixel alpha. DeviceCMYK
        // images have no alpha channel of their own, so transparency
        // rides along on /SMask. Skipped when the canvas is fully opaque.
        if (anyAlpha && !pattern.exportFlatten) {
          const smaskDict = pdfDoc.context.obj({
            Type: PDFName.of('XObject'),
            Subtype: PDFName.of('Image'),
            Width: PDFNumber.of(W),
            Height: PDFNumber.of(H),
            ColorSpace: PDFName.of('DeviceGray'),
            BitsPerComponent: PDFNumber.of(8),
          });
          const smaskStream = pdfDoc.context.flateStream(alpha, smaskDict);
          const smaskRef = pdfDoc.context.register(smaskStream);
          imgDict.set(PDFName.of('SMask'), smaskRef);
        }
        const imgStream = pdfDoc.context.flateStream(cmyk, imgDict);
        const imgRef = pdfDoc.context.register(imgStream);
        // Add to page's Resources/XObject.
        const resources = pdfDoc.context.obj({});
        const xObjects = pdfDoc.context.obj({});
        xObjects.set(PDFName.of('GirardCmyk'), imgRef);
        resources.set(PDFName.of('XObject'), xObjects);
        page.node.set(PDFName.of('Resources'), resources);
        // Page transparency group: required for SMask compositing to work
        // correctly. Matches the dict the vector path sets up.
        page.node.set(PDFName.of('Group'), pdfDoc.context.obj({
          Type: PDFName.of('Group'),
          S: PDFName.of('Transparency'),
          CS: PDFName.of('DeviceCMYK'),
        }));
        // Push raw operators: q / cm (scale to page) / Do (draw image) / Q.
        // PDF image space is 1×1, so scale to [W H 0 0 0 0] places it
        // covering the page. Y is already flipped by PDF convention.
        page.pushOperators(
          PDFOperator.of('q\n'),
          PDFOperator.of(`${W} 0 0 ${H} 0 0 cm\n`),
          PDFOperator.of('/GirardCmyk Do\n'),
          PDFOperator.of('Q\n'),
        );
      } else {
        // sRGB path: embed PNG of the canvas (existing behaviour).
        const pngDataUrl = canvas.toDataURL('image/png');
        const pngBytes = await fetch(pngDataUrl).then(r => r.arrayBuffer());
        const img = await pdfDoc.embedPng(pngBytes);
        page.drawImage(img, { x: 0, y: 0, width: W, height: H });
      }

      // ---- PDF/X-4 or PDF/X-3 compliance ----
      // OutputIntent's DestOutputProfile is the CMYK target when the
      // ICC profiler is loaded (synthesised CMYK profile for the
      // chosen region — PDF/X-4); otherwise the embedded sRGB profile
      // (PDF/X-3). Either is a real, parsable profile binary that
      // print shop preflight accepts.
      try {
        const { PDFName, PDFString, PDFArray, PDFNumber, PDFRawStream } = window.PDFLib;
        const isCmykTarget = iccProfiler.loaded;
        const profileId = pattern.iccProfile || 'U.S. Web Coated (SWOP) v2';
        const iccBytes = isCmykTarget
          ? buildCmykIccProfile(profileId)
          : buildSrgbIccProfile();
        const profileN = isCmykTarget ? 4 : 3;
        const profileLabel = isCmykTarget ? profileId : 'sRGB IEC61966-2.1';
        const profileDict = pdfDoc.context.obj({});
        profileDict.set(PDFName.of('N'), PDFNumber.of(profileN));
        profileDict.set(PDFName.of('Length'), PDFNumber.of(iccBytes.length));
        const profileStream = PDFRawStream.of(profileDict, iccBytes);
        const profileRef = pdfDoc.context.register(profileStream);

        const outputIntentDict = pdfDoc.context.obj({});
        outputIntentDict.set(PDFName.of('Type'), PDFName.of('OutputIntent'));
        outputIntentDict.set(PDFName.of('S'), PDFName.of('GTS_PDFX'));
        outputIntentDict.set(PDFName.of('OutputConditionIdentifier'), PDFString.of(profileLabel));
        outputIntentDict.set(PDFName.of('OutputCondition'), PDFString.of(`${profileLabel} (girard-embedded)`));
        outputIntentDict.set(PDFName.of('RegistryName'), PDFString.of('http://www.color.org'));
        outputIntentDict.set(PDFName.of('Info'), PDFString.of(intent));
        outputIntentDict.set(PDFName.of('DestOutputProfile'), profileRef);

        const outputIntents = PDFArray.withContext(pdfDoc.context);
        outputIntents.push(outputIntentDict);
        pdfDoc.catalog.set(PDFName.of('OutputIntents'), outputIntents);

        // Info-dict markers: X-4 when CMYK profile is target, X-3
        // otherwise. Both spec versions require Trapped explicit.
        const info = pdfDoc.context.lookup(pdfDoc.context.trailerInfo.Info);
        const xVersion = isCmykTarget ? 'PDF/X-4' : 'PDF/X-3:2003';
        if (info) {
          info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of(xVersion));
          info.set(PDFName.of('GTS_PDFXConformance'), PDFString.of(xVersion));
          info.set(PDFName.of('Trapped'), PDFName.of('False'));
        }
      } catch (e) {
        console.warn('girard: PDF/X OutputIntent setup failed:', e);
      }

      const bytes = await pdfDoc.save();
      downloadBlob(new Blob([bytes], { type: 'application/pdf' }), `${baseName}.pdf`);
    }).catch(err => console.error('girard: PDF export failed:', err))
  );
}

// Shared rasterization step used by TIFF / PDF / JPG / PNG. Returns a
// canvas painted with the tile at exportWidth resolution. Honours the
// flatten flag for alpha-bearing formats (raster PDF and TIFF always
// composite onto the background since neither LZW-TIFF nor raster PDF
// preserves alpha reliably across print workflows).
// Shared rasterization step used by TIFF / PDF / JPG / PNG. Returns a
// canvas painted with the tile at the configured export size. The
// `forceBackground` flag is used by formats that don't preserve alpha
// reliably (TIFF, raster PDF, JPG) — they always composite onto the
// background regardless of the flatten flag.
function rasterizeForExport(pattern, opts = {}) {
  const forceBg = !!opts.forceBackground;
  const wantAlpha = !forceBg && !pattern.exportFlatten;
  const background = pattern.exportBackground || '#ffffff';
  const { svg, width, height } = buildTileSvg(pattern, { skipSoftProof: !!opts.skipSoftProof });
  return buildEmbeddedFontStyle(pattern).then(fontCss => {
    injectFontStyle(svg, fontCss);
    const xml = serializeSvg(svg);
    const blob = new Blob([xml], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const { W, H } = exportPixelDims(pattern, width, height);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!wantAlpha) {
          ctx.fillStyle = background;
          ctx.fillRect(0, 0, W, H);
        }
        ctx.drawImage(img, 0, 0, W, H);
        URL.revokeObjectURL(url);
        resolve({ canvas, W, H });
      };
      img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  });
}

// Compute the export target pixel dimensions. The user picks a target
// `exportWidth` (the longer side of the unit); height scales to match
// the unit's aspect, so half-drop / half-brick units stay correct.
function exportPixelDims(pattern, unitWidth, unitHeight) {
  const target = Math.max(64, Math.min(8192, Number(pattern.exportWidth) || 1024));
  const longSide = Math.max(unitWidth, unitHeight);
  const k = target / longSide;
  return { W: Math.round(unitWidth * k), H: Math.round(unitHeight * k) };
}

// Render the tile and encode via canvas.toBlob. PNG preserves alpha
// unless flatten is set; JPG always flattens (no alpha channel).
function exportTilePng(pattern, baseName) {
  rasterizeForExport(pattern).then(({ canvas }) =>
    canvas.toBlob(b => b && downloadBlob(b, `${baseName}.png`), 'image/png')
  );
}
function exportTileJpeg(pattern, baseName, quality = 0.92) {
  rasterizeForExport(pattern, { forceBackground: true }).then(({ canvas }) =>
    canvas.toBlob(b => b && downloadBlob(b, `${baseName}.jpg`), 'image/jpeg', quality)
  );
}

// ---------- Layer list ----------
function renderLayerList(listEl, pattern, selected, handlers) {
  const items = pattern.layers.map((layer, i) => {
    const li = document.createElement('li');
    const anySolo = pattern.layers.some(l => l.solo);
    const dimmed = anySolo && !layer.solo;
    li.className = 'layer-item'
      + (i === selected ? ' selected' : '')
      + (layer.locked ? ' is-locked' : '')
      + (layer.solo ? ' is-solo' : '')
      + (dimmed ? ' is-dimmed' : '');
    const label = document.createElement('span');
    label.className = 'layer-label';
    label.textContent = `${i + 1}. ${layerLabel(layer)}`;
    label.addEventListener('click', () => handlers.select(i));
    li.appendChild(label);

    const actions = document.createElement('span');
    actions.className = 'layer-actions';
    const btn = (text, title, fn, extraClass) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.title = title;
      if (extraClass) b.className = extraClass;
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const lockBtn = btn(
      layer.locked ? '🔒' : '🔓',
      layer.locked ? 'unlock (will react to roll again)' : 'lock (freezes the layer against roll + edits)',
      () => handlers.lock(i),
      'layer-lock' + (layer.locked ? ' is-locked' : '')
    );
    actions.appendChild(lockBtn);
    const soloBtn = btn(
      'S',
      layer.solo
        ? 'unsolo'
        : 'solo (hide all other layers in the preview)',
      () => handlers.solo(i),
      'layer-solo' + (layer.solo ? ' is-solo' : '')
    );
    actions.appendChild(soloBtn);
    actions.appendChild(btn('↑', 'move up',   () => handlers.move(i, -1)));
    actions.appendChild(btn('↓', 'move down', () => handlers.move(i, +1)));
    actions.appendChild(btn('×', 'delete',    () => handlers.remove(i)));
    li.appendChild(actions);
    return li;
  });
  listEl.replaceChildren(...items);
}

// ---------- Per-layer config form ----------
function buildConfigForm(rootHost, layer, onChange, opts = {}) {
  const colorMode = opts.colorMode || 'srgb';
  const iccProfile = opts.iccProfile || 'U.S. Web Coated (SWOP) v2';
  // Project colour roles + their currently-resolved colours, so each
  // layer palette slot can be bound to a role and follow colourways.
  const roleNames = opts.roles || [];
  const byRole = opts.byRole || {};
  rootHost.replaceChildren();
  // Mirror the layer's lock state onto the form so CSS can dim it
  // and block pointer events. The lock toggle itself lives on the
  // layer list, not in this panel, so the user always has an exit.
  rootHost.classList.toggle('is-locked', !!(layer && layer.locked));
  if (!layer) return;
  // `host` is the *current* append target. Starts as the root panel
  // body, gets reassigned to a fresh <details> body each time
  // addHeader runs. Existing helpers (addCtrl, addPair, addColorCtrl,
  // renderSwatches) keep appending to `host`, so they automatically
  // land in the active section.
  let host = rootHost;
  // Self-rebuild for controls that change which fields are visible
  // (fill kind, vary on/off, solid colour mode).
  const rebuild = () => buildConfigForm(rootHost, layer, onChange, opts);

  // Compact colour editor laid out as a single-row table matching the
  // palette table format: header labels (R/G/B/A and optionally
  // C/M/Y/K) over a body row with a native colour-picker swatch and
  // number cells. Returns the <table> node.
  const createColorWidget = (initial, onColorChange) => {
    const table = document.createElement('table');
    table.className = 'palette-table';
    const isCmyk = colorMode === 'cmyk';
    const cols = isCmyk ? ['', 'C', 'M', 'Y', 'K'] : ['', 'R', 'G', 'B', 'A'];
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const label of cols) {
      const th = document.createElement('th');
      th.textContent = label;
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const rgba = parseColor(initial);
    const hexOf = (x) => '#' + [x.r, x.g, x.b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');

    const tbody = document.createElement('tbody');
    const tr = document.createElement('tr');
    // Swatch: native colour picker. Click to open OS picker; the rgba
    // alpha is preserved when the user changes the colour.
    const swatchTd = document.createElement('td');
    const picker = document.createElement('input');
    picker.type = 'color';
    picker.className = 'palette-color-picker';
    picker.value = hexOf(rgba);
    swatchTd.appendChild(picker);
    tr.appendChild(swatchTd);

    const rgbInputs = {};
    const cmykInputs = {};
    const refresh = () => {
      picker.value = hexOf(rgba);
      if (isCmyk) {
        const c = hexToCmyk(formatColor(rgba));
        cmykInputs.c.value = Math.round(c.c * 100);
        cmykInputs.m.value = Math.round(c.m * 100);
        cmykInputs.y.value = Math.round(c.y * 100);
        cmykInputs.k.value = Math.round(c.k * 100);
      } else {
        rgbInputs.r.value = rgba.r;
        rgbInputs.g.value = rgba.g;
        rgbInputs.b.value = rgba.b;
        rgbInputs.a.value = rgba.a;
      }
    };
    const fire = () => { onColorChange(formatColor(rgba)); refresh(); };

    picker.addEventListener('input', () => {
      const next = parseColor(picker.value);
      rgba.r = next.r; rgba.g = next.g; rgba.b = next.b;
      fire();
    });

    if (isCmyk) {
      const cmyk = hexToCmyk(formatColor(rgba));
      for (const axis of ['c', 'm', 'y', 'k']) {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = 0; inp.max = 100; inp.step = 1;
        inp.value = Math.round(cmyk[axis] * 100);
        inp.addEventListener('input', () => {
          cmyk[axis] = Math.max(0, Math.min(100, Number(inp.value) || 0)) / 100;
          const { r, g, b } = cmykToRgb(cmyk.c, cmyk.m, cmyk.y, cmyk.k);
          rgba.r = r; rgba.g = g; rgba.b = b;
          fire();
        });
        td.appendChild(inp);
        tr.appendChild(td);
        cmykInputs[axis] = inp;
      }
    } else {
      for (const axis of ['r', 'g', 'b', 'a']) {
        const td = document.createElement('td');
        const inp = document.createElement('input');
        inp.type = 'number';
        inp.min = 0;
        inp.max = axis === 'a' ? 1 : 255;
        inp.step = axis === 'a' ? 0.05 : 1;
        inp.value = axis === 'a' ? rgba.a : rgba[axis];
        inp.addEventListener('input', () => {
          const v = Number(inp.value);
          rgba[axis] = axis === 'a' ? Math.max(0, Math.min(1, v)) : Math.max(0, Math.min(255, v));
          fire();
        });
        td.appendChild(inp);
        tr.appendChild(td);
        rgbInputs[axis] = inp;
      }
    }

    tbody.appendChild(tr);
    table.appendChild(tbody);
    return table;
  };
  // Colour pickers are wide (RGBA + maybe CMYK rows) so they span both
  // columns of the 2-col layout via .ctrl-span-2.
  const addColorCtrl = (label, value, onColorChange, opts = {}) => {
    const wrap = document.createElement('label');
    wrap.className = 'ctrl ctrl-span-2';
    const span = document.createElement('span');
    span.textContent = label;
    wrap.appendChild(span);
    wrap.appendChild(createColorWidget(value, onColorChange));
    (opts.into || host).appendChild(wrap);
  };

  // A labelled colour picker backed by a named slot in layer.palette
  // (the single colour system). Creates the slot if absent. Editing
  // detaches the slot from its project role (hand-pick wins), mirroring
  // the swatch grid; until then the slot follows the colourway.
  const ensureSlot = (key, def) => {
    if (!layer.palette) layer.palette = [];
    if (!layer.paletteLabels) layer.paletteLabels = layer.palette.map(() => null);
    while (layer.paletteLabels.length < layer.palette.length) layer.paletteLabels.push(null);
    let i = layer.paletteLabels.indexOf(key);
    if (i < 0) { layer.palette.push(def); layer.paletteLabels.push(key); i = layer.palette.length - 1; }
    return i;
  };
  const addSlotColorCtrl = (label, key, def, opts = {}) => {
    const i = ensureSlot(key, def);
    addColorCtrl(label, layer.palette[i] ?? def, (v) => {
      layer.palette[i] = v;
      if (layer.paletteRoles) layer.paletteRoles[i] = null;
      onChange();
    }, opts);
  };

  const addCtrl = (label, kind, value, opts = {}) => {
    const wrap = document.createElement('label');
    wrap.className = 'ctrl' + (opts.span === 2 ? ' ctrl-span-2' : '');
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
    (opts.into || host).appendChild(wrap);
    return input;
  };
  // A side-by-side pair container that occupies one cell of the
  // parent grid and itself holds two ctrls in a 2-col sub-grid. Used
  // for X/Y pairs (offsetX + offsetY) that need to share one column
  // of the parent layout.
  const addPair = () => {
    const p = document.createElement('div');
    p.className = 'config-pair';
    host.appendChild(p);
    return p;
  };
  // Each addHeader opens a new collapsible <details> section anchored
  // on the root panel. Subsequent ctrls land in its body until the
  // next addHeader. The first section ("fill") and the always-relevant
  // "palette" stay open by default; the rest fold so the panel isn't
  // wall-to-wall controls for one selected layer.
  const DEFAULT_OPEN = new Set(['fill', 'palette']);
  const addHeader = (text) => {
    const det = document.createElement('details');
    det.className = 'config-section-details';
    if (DEFAULT_OPEN.has(text)) det.open = true;
    const sum = document.createElement('summary');
    sum.className = 'config-section';
    sum.textContent = text;
    det.appendChild(sum);
    const body = document.createElement('div');
    body.className = 'config-section-body';
    det.appendChild(body);
    rootHost.appendChild(det);
    host = body;
  };

  // --- Blend + opacity + mirror (universal) ---
  const blend = addCtrl('blend', 'select', layer.blendMode || 'normal', { options: BLEND_MODES });
  const op = addCtrl('opacity', 'number', layer.opacity ?? 1, { min: 0, max: 1, step: 0.05 });
  // Mirror: flip the layer's content about its own bounding box. Stored
  // as two booleans (flipX / flipY); collapsed into a single 4-state
  // picker for the UI so the common cases are one click away.
  const mirrorState = layer.flipX && layer.flipY ? 'both'
                     : layer.flipX ? 'horizontal'
                     : layer.flipY ? 'vertical'
                     : 'none';
  const mirror = addCtrl('mirror', 'select', mirrorState, {
    options: ['none', 'horizontal', 'vertical', 'both'],
  });
  // Taper: stroke-using fills (twigs, grass) narrow from full width
  // at each segment's start to (1 - taper) at its end. 0 = uniform.
  const taper = addCtrl('taper', 'number', layer.taper ?? 0, { min: 0, max: 1, step: 0.05 });
  blend.addEventListener('change', () => { layer.blendMode = blend.value; onChange(); });
  op.addEventListener('input',  () => { layer.opacity = Number(op.value); onChange(); });
  mirror.addEventListener('change', () => {
    const v = mirror.value;
    layer.flipX = v === 'horizontal' || v === 'both';
    layer.flipY = v === 'vertical'   || v === 'both';
    onChange();
  });
  taper.addEventListener('input', () => {
    layer.taper = Math.max(0, Math.min(1, Number(taper.value) || 0));
    onChange();
  });

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
      // Labelled slots are named accents (stalk, leaf, stroke, …) edited
      // by their own pickers in the fill section — skip them here so the
      // swatch table shows only the cycling set (the unlabelled slots).
      const isLabelled = (i) => !!(layer.paletteLabels && layer.paletteLabels[i]);
      const hasCycling = list.some((_, i) => !isLabelled(i));
      // Per-row sync callbacks: keep the swatch picker and number cells
      // in step with `layer.palette[i]` without tearing down DOM. Built
      // by the row builder below; called by `update` instead of
      // re-rendering the whole table — which would destroy the native
      // colour picker the user is currently dragging in.
      const rowSyncs = [];

      // A manual edit detaches that slot from its project role so the
      // hand-picked colour wins at render instead of the colourway's
      // role colour (mirrors the swatch grid's tracked → anchored move).
      const unbindRole = (i) => {
        if (layer.paletteRoles) layer.paletteRoles[i] = null;
      };

      const update = (i, hex, alpha) => {
        const c = parseColor(list[i]);
        const next = parseColor(hex);
        next.a = alpha != null ? alpha : c.a;
        list[i] = formatColor(next);
        layer.palette = list;
        unbindRole(i);
        if (rowSyncs[i]) rowSyncs[i](list[i]);
        onChange();
      };
      const hexOf = (c) => {
        const x = parseColor(c);
        return '#' + [x.r, x.g, x.b].map(v => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0')).join('');
      };

      // Role binding for a slot: paint elements by role so they follow
      // colourways. `roleOf` returns the bound role (if it's a real
      // project role) or null = literal/custom hex.
      const ensureRolesArray = () => {
        if (!layer.paletteRoles) layer.paletteRoles = list.map(() => null);
        while (layer.paletteRoles.length < list.length) layer.paletteRoles.push(null);
      };
      const roleOf = (i) => {
        const r = layer.paletteRoles && layer.paletteRoles[i];
        return r && roleNames.includes(r) ? r : null;
      };
      const isTransparentSlot = (i) => parseColor(list[i]).a <= 0;
      const setSlotRole = (i, choice) => {
        ensureRolesArray();
        if (choice === '__custom') {
          layer.paletteRoles[i] = null;
          if (isTransparentSlot(i)) list[i] = '#888888';
        } else if (choice === '__transparent') {
          layer.paletteRoles[i] = null;
          list[i] = 'transparent';
        } else {
          layer.paletteRoles[i] = choice;
          if (byRole[choice]) list[i] = byRole[choice];  // display + fallback
        }
        layer.palette = list;
        renderSwatches();
        onChange();
      };

      if (hasCycling) {
        const table = document.createElement('table');
        table.className = 'palette-table';
        // Header row — column labels (R G B A, plus C M Y K in CMYK mode).
        const thead = document.createElement('thead');
        const headRow = document.createElement('tr');
        const isCmyk = colorMode === 'cmyk';
        const cols = isCmyk ? ['role', '', 'C', 'M', 'Y', 'K'] : ['role', '', 'R', 'G', 'B', 'A'];
        if (isCmyk && iccProfiler.loaded) cols.push('ΔE');
        cols.push('');
        for (const label of cols) {
          const th = document.createElement('th');
          th.textContent = label;
          headRow.appendChild(th);
        }
        thead.appendChild(headRow);
        table.appendChild(thead);

        // Body — one row per palette entry.
        const tbody = document.createElement('tbody');
        list.forEach((color, i) => {
          if (isLabelled(i)) return;   // named accent — shown by its picker
          const tr = document.createElement('tr');
          // A slot bound to a project role is driven by the colourway,
          // so its colour fields are read-only; the role drop-down is
          // the control. `displayColor` is what the row shows.
          const bound = roleOf(i);
          if (bound) tr.className = 'is-role-bound';
          const displayColor = bound ? (byRole[bound] || color) : color;

          // Role selector: literal/custom, a project role, or transparent.
          const roleTd = document.createElement('td');
          const roleSel = document.createElement('select');
          roleSel.className = 'palette-role-select';
          const addOpt = (value, label) => {
            const o = document.createElement('option');
            o.value = value;
            o.textContent = label;
            roleSel.appendChild(o);
          };
          addOpt('__custom', 'custom');
          for (const r of roleNames) addOpt(r, r);
          addOpt('__transparent', 'transparent');
          roleSel.value = bound ? bound : (isTransparentSlot(i) ? '__transparent' : '__custom');
          roleSel.title = bound
            ? `painted with role "${bound}" — follows the colourway`
            : 'bind this slot to a colour role, or keep a custom hex';
          roleSel.addEventListener('change', () => setSlotRole(i, roleSel.value));
          roleTd.appendChild(roleSel);
          tr.appendChild(roleTd);

          // Swatch is a real <input type="color"> so the native picker opens.
          const swatchTd = document.createElement('td');
          const picker = document.createElement('input');
          picker.type = 'color';
          picker.className = 'palette-color-picker';
          picker.value = hexOf(displayColor);
          picker.disabled = !!bound;
          picker.addEventListener('input', () => update(i, picker.value, null));
          swatchTd.appendChild(picker);
          tr.appendChild(swatchTd);

          // sRGB mode: R / G / B / A number inputs.
          const rgbInputs = {};
          if (!isCmyk) {
            const initRgba = parseColor(displayColor);
            for (const axis of ['r', 'g', 'b', 'a']) {
              const td = document.createElement('td');
              const inp = document.createElement('input');
              inp.type = 'number';
              inp.min = 0;
              inp.max = axis === 'a' ? 1 : 255;
              inp.step = axis === 'a' ? 0.05 : 1;
              inp.value = axis === 'a' ? initRgba.a : initRgba[axis];
              inp.disabled = !!bound;
              inp.addEventListener('input', () => {
                const v = Number(inp.value);
                const clamped = axis === 'a' ? Math.max(0, Math.min(1, v)) : Math.max(0, Math.min(255, v));
                const cur = parseColor(list[i]);
                const next = { ...cur, [axis]: clamped };
                list[i] = formatColor(next);
                layer.palette = list;
                unbindRole(i);
                if (rowSyncs[i]) rowSyncs[i](list[i], inp);
                onChange();
              });
              td.appendChild(inp);
              tr.appendChild(td);
              rgbInputs[axis] = inp;
            }
          }

          // CMYK mode: C / M / Y / K inputs replace the RGBA columns.
          const cmykInputs = {};
          if (isCmyk) {
            const cmykInit = hexToCmyk(formatColor(parseColor(displayColor)));
            for (const axis of ['c', 'm', 'y', 'k']) {
              const td = document.createElement('td');
              const inp = document.createElement('input');
              inp.type = 'number';
              inp.min = 0; inp.max = 100; inp.step = 1;
              inp.value = Math.round(cmykInit[axis] * 100);
              inp.disabled = !!bound;
              inp.addEventListener('input', () => {
                const cur = parseColor(list[i]);
                const cmykCur = hexToCmyk(formatColor(cur));
                cmykCur[axis] = Math.max(0, Math.min(100, Number(inp.value) || 0)) / 100;
                const { r, g, b } = cmykToRgb(cmykCur.c, cmykCur.m, cmykCur.y, cmykCur.k);
                list[i] = formatColor({ r, g, b, a: cur.a });
                layer.palette = list;
                unbindRole(i);
                if (rowSyncs[i]) rowSyncs[i](list[i], inp);
                onChange();
              });
              td.appendChild(inp);
              tr.appendChild(td);
              cmykInputs[axis] = inp;
            }
          }
          // Gamut ΔE: how far the colour sits outside printable CMYK.
          // Computed as the RGB-distance of the round-trip sRGB→CMYK→sRGB.
          // Values are bucketed into in-gamut / borderline / out-of-gamut.
          let gamutTd = null;
          if (colorMode === 'cmyk' && iccProfiler.loaded) {
            gamutTd = document.createElement('td');
            tr.appendChild(gamutTd);
          }
          // In-place sync: rebuild the row's display values from the
          // current colour, but skip the input the user is editing so
          // their cursor / drag doesn't get yanked.
          const syncRow = (newColor, skipInput) => {
            const rgba = parseColor(newColor);
            if (picker !== skipInput) picker.value = hexOf(newColor);
            if (!isCmyk) {
              for (const axis of ['r', 'g', 'b', 'a']) {
                if (rgbInputs[axis] !== skipInput) {
                  rgbInputs[axis].value = axis === 'a' ? rgba.a : rgba[axis];
                }
              }
            } else {
              const cmykNow = hexToCmyk(formatColor(rgba));
              for (const axis of ['c', 'm', 'y', 'k']) {
                if (cmykInputs[axis] !== skipInput) {
                  cmykInputs[axis].value = Math.round(cmykNow[axis] * 100);
                }
              }
            }
            if (gamutTd) {
              const cmykNow = hexToCmyk(formatColor(rgba));
              const back = profileCmykToRgb(cmykNow.c, cmykNow.m, cmykNow.y, cmykNow.k, iccProfile);
              const dE = Math.hypot(rgba.r - back.r, rgba.g - back.g, rgba.b - back.b);
              gamutTd.className = 'palette-gamut ' + (dE > 12 ? 'oog' : dE > 5 ? 'edge' : 'inside');
              gamutTd.textContent = dE.toFixed(0);
              gamutTd.title = dE > 12
                ? `Out of gamut (ΔE ≈ ${dE.toFixed(1)}): will desaturate / shift hue on press.`
                : dE > 5
                ? `Near gamut edge (ΔE ≈ ${dE.toFixed(1)}): minor shift on press.`
                : `In gamut (ΔE ≈ ${dE.toFixed(1)}).`;
            }
          };
          rowSyncs[i] = syncRow;
          syncRow(displayColor);   // initial gamut paint

          // Remove button — full re-render is fine here since the row
          // count changes.
          const rmTd = document.createElement('td');
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.className = 'palette-rm';
          rm.textContent = '×';
          rm.title = 'remove colour';
          rm.addEventListener('click', () => {
            layer.palette = (layer.palette || []).filter((_, j) => j !== i);
            if (layer.paletteRoles) {
              layer.paletteRoles = layer.paletteRoles.filter((_, j) => j !== i);
            }
            renderSwatches();
            onChange();
          });
          rmTd.appendChild(rm);
          tr.appendChild(rmTd);

          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        wrap.appendChild(table);
      } else if (!list.length && roleNames.length) {
        // Inheriting: this layer has no palette of its own, so it paints
        // with the full project palette (every role) and follows
        // colourways. Show the roles read-only so it's clear the colours
        // ARE applied, with a one-click way to start overriding per slot.
        const note = document.createElement('p');
        note.className = 'icc-status';
        note.textContent = 'Using the full project palette — every role, follows colourways.';
        wrap.appendChild(note);
        const strip = document.createElement('div');
        strip.className = 'palette-inherit-strip';
        for (const r of roleNames) {
          const chip = document.createElement('span');
          chip.className = 'palette-inherit-chip';
          chip.title = `${r}: ${byRole[r] || ''}`;
          const sw = document.createElement('span');
          sw.className = 'palette-inherit-sw';
          sw.style.background = byRole[r] || '#888';
          const lab = document.createElement('span');
          lab.className = 'palette-inherit-label';
          lab.textContent = r;
          chip.appendChild(sw);
          chip.appendChild(lab);
          strip.appendChild(chip);
        }
        wrap.appendChild(strip);
        const customise = document.createElement('button');
        customise.type = 'button';
        customise.className = 'swatch-add';
        customise.textContent = 'customise (copy roles)';
        customise.title = 'Give this layer its own slots — one per role — so you can rebind or override them';
        customise.addEventListener('click', () => {
          layer.palette = roleNames.map(r => byRole[r] || '#888888');
          layer.paletteRoles = [...roleNames];
          renderSwatches();
          onChange();
        });
        wrap.appendChild(customise);
      }

      // "+" adds a cycling slot. Only offered when the layer already
      // cycles or has no palette at all (inheriting) — not for fills
      // whose only colours are named accents.
      if (hasCycling || !list.length) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'swatch-add';
        add.textContent = '+';
        add.addEventListener('click', () => {
          layer.palette = [...(layer.palette || []), '#888888'];
          // Keep the role + label maps index-aligned; a fresh swatch is
          // a literal, unlabelled (cycling) slot.
          if (layer.paletteRoles) layer.paletteRoles.push(null);
          if (layer.paletteLabels) layer.paletteLabels.push(null);
          renderSwatches();
          onChange();
        });
        wrap.appendChild(add);
      }
    };
    renderSwatches();
  }

  // --- Grid ---
  addHeader('grid');
  const cols = addCtrl('cols', 'number', layer.grid.cols, { min: 1, max: 64, step: 1 });
  const rows = addCtrl('rows', 'number', layer.grid.rows, { min: 1, max: 64, step: 1 });
  cols.addEventListener('input', () => { layer.grid.cols = Math.max(1, Number(cols.value) | 0); onChange(); });
  rows.addEventListener('input', () => { layer.grid.rows = Math.max(1, Number(rows.value) | 0); onChange(); });

  addHeader('offset');
  const offMode = addCtrl('mode', 'select', layer.grid.offsetMode || 'none', {
    options: ['none', 'alternate-row', 'alternate-col'],
  });
  offMode.addEventListener('change', () => { layer.grid.offsetMode = offMode.value; onChange(); });

  // X / Y sit side-by-side inside col 2 of the parent grid, pairing
  // visually with the offset mode select in col 1.
  const offsetPair = addPair();
  const offX = addCtrl('x', 'number', layer.grid.offset?.x ?? 0, { min: 0, max: 1, step: 0.05, into: offsetPair });
  const offY = addCtrl('y', 'number', layer.grid.offset?.y ?? 0, { min: 0, max: 1, step: 0.05, into: offsetPair });
  offX.addEventListener('input', () => {
    layer.grid.offset = { ...(layer.grid.offset || {}), x: Number(offX.value) };
    onChange();
  });
  offY.addEventListener('input', () => {
    layer.grid.offset = { ...(layer.grid.offset || {}), y: Number(offY.value) };
    onChange();
  });
  addHeader('gutter (× cell)');
  const gutterPair = addPair();
  const gx = addCtrl('x', 'number',
    layer.grid.gutterX ?? layer.grid.gutter ?? 0,
    { min: 0, max: 0.9, step: 0.02, into: gutterPair });
  gx.addEventListener('input', () => {
    layer.grid.gutterX = Number(gx.value);
    delete layer.grid.gutter;
    onChange();
  });
  const gy = addCtrl('y', 'number',
    layer.grid.gutterY ?? layer.grid.gutter ?? 0,
    { min: 0, max: 0.9, step: 0.02, into: gutterPair });
  gy.addEventListener('input', () => {
    layer.grid.gutterY = Number(gy.value);
    delete layer.grid.gutter;
    onChange();
  });

  // Optional explicit weights for variable-width columns / rows.
  // Comma-separated list of positive numbers; blank = fall back to
  // uniform cols/rows.
  addHeader('weights');
  const parseWeights = (str) => {
    const list = str.split(',').map(s => Number(s.trim())).filter(n => isFinite(n) && n > 0);
    return list.length ? list : null;
  };
  const cWeights = addCtrl('col', 'text',
    (layer.grid.colWeights || []).join(', '),
    {});
  cWeights.placeholder = 'uniform';
  cWeights.addEventListener('input', () => {
    const w = parseWeights(cWeights.value);
    if (w) layer.grid.colWeights = w; else delete layer.grid.colWeights;
    onChange();
  });
  const rWeights = addCtrl('row', 'text',
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
  const fillKind = addCtrl('kind', 'select', layer.fill.kind, { options: ['solid', 'shape', 'split', 'arc-split', 'arc-block', 'mesh', 'triangles', 'voronoi', 'bloom', 'flower-seal', 'maze', 'manhattan', 'pinwheel', 'glyph', 'stones', 'twigs', 'weave', 'windowpane', 'honeycomb', 'dashes', 'multiform', 'fruit', 'graph', 'grass', 'firecracker', 'comb', 'slant'] });
  fillKind.addEventListener('change', () => {
    if (fillKind.value === 'pinwheel') {
      layer.fill = { kind: 'pinwheel', spin: 0 };
    } else if (fillKind.value === 'glyph') {
      // Colour lives in the layer palette (the single colour system).
      layer.fill = { kind: 'glyph', twoTone: false, invert: 0.5, weight: 0.22 };
      layer.palette = ['#21242b', '#f3ede0'];
      layer.paletteRoles = [null, null];
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
    } else if (fillKind.value === 'slant') {
      layer.fill = { kind: 'slant', bars: 9, slope: 0.62, gap: 0.16 };
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
      addSlotColorCtrl('color', 'color', '#8a8a8a');
    }
  } else if (layer.fill.kind === 'shape') {
    // Custom user-imported shapes pile onto the catalog with a
    // `custom:NAME` prefix so the renderer can dispatch on the
    // namespace.
    const customNames = Object.keys((opts.customShapes || {}));
    const shapeKind = addCtrl('shape', 'select', layer.fill.shape?.kind || 'circle', {
      options: [
        'circle', 'square', 'triangle', 'right-triangle', 'diamond', 'text', 'star', 'quatrefoil', 'spike', 'lens', 'leaf', 'onion', 'flower', 'blossom', 'barbell', 'plus', 'cross', 'quadDots', 'jacks',
        ...customNames.map(n => `custom:${n}`),
      ],
    });
    shapeKind.addEventListener('change', () => {
      const oldKind = layer.fill.shape?.kind || '';
      const newKind = shapeKind.value;
      const wasCustom = oldKind.startsWith('custom:');
      const isCustom = newKind.startsWith('custom:');
      layer.fill.shape = { ...(layer.fill.shape || {}), kind: newKind };
      // Toggle the size default when crossing the custom boundary —
      // imported artwork wants to fill the cell (1.0); catalog shapes
      // want breathing room (0.6).
      if (wasCustom !== isCustom) {
        layer.fill.shape.size = isCustom ? 1.0 : 0.6;
      }
      onChange();
      rebuild();
    });
    const isCustom = (layer.fill.shape?.kind || '').startsWith('custom:');
    const sizeDefault = isCustom ? 1.0 : 0.6;
    const size = addCtrl('size (× cell)', 'number', layer.fill.shape?.size ?? sizeDefault, { min: 0.05, max: 1.5, step: 0.05 });
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
      addSlotColorCtrl('color', 'color', '#d24a45');
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
      addSlotColorCtrl('stroke color', 'stroke', '#ffffff');
    }
  } else if (layer.fill.kind === 'pinwheel') {
    const sp = addCtrl('spin (¼ turn)', 'number', layer.fill.spin ?? 0, { min: 0, max: 3, step: 1 });
    sp.addEventListener('input', () => { layer.fill.spin = Number(sp.value) | 0; onChange(); });
    addSlotColorCtrl('ground', 'ground', 'transparent');
  } else if (layer.fill.kind === 'multiform') {
    const dn = addCtrl('density', 'number', layer.fill.density ?? 0.82, { min: 0, max: 1, step: 0.05 });
    dn.addEventListener('input', () => { layer.fill.density = Number(dn.value); onChange(); });
  } else if (layer.fill.kind === 'comb' && !layer.fill.profiles) {
    const pf = addCtrl('profile', 'select', layer.fill.profile || 'square', { options: ['square', 'spear', 'spearhead', 'drop', 'finger', 'flame', 'checker', 'angle'] });
    pf.addEventListener('change', () => { layer.fill.profile = pf.value; onChange(); });
    addSlotColorCtrl('color', 'color', '#4a6fb0');
    const tt = addCtrl('teeth', 'number', layer.fill.teeth ?? 14, { min: 2, max: 40, step: 1 });
    tt.addEventListener('input', () => { layer.fill.teeth = Number(tt.value) | 0; onChange(); });
    const bs = addCtrl('base', 'number', layer.fill.base ?? 0.3, { min: 0.05, max: 0.6, step: 0.02 });
    bs.addEventListener('input', () => { layer.fill.base = Number(bs.value); onChange(); });
    const dt = addCtrl('tooth height', 'number', layer.fill.duty ?? 0.52, { min: 0.2, max: 0.9, step: 0.04 });
    dt.addEventListener('input', () => { layer.fill.duty = Number(dt.value); onChange(); });
  } else if (layer.fill.kind === 'slant') {
    const bn = addCtrl('bars', 'number', layer.fill.bars ?? 9, { min: 3, max: 24, step: 1 });
    bn.addEventListener('input', () => { layer.fill.bars = Number(bn.value) | 0; onChange(); });
    const sl = addCtrl('slope', 'number', layer.fill.slope ?? 0.62, { min: 0, max: 2, step: 0.05 });
    sl.addEventListener('input', () => { layer.fill.slope = Number(sl.value); onChange(); });
    const gp = addCtrl('gap', 'number', layer.fill.gap ?? 0.16, { min: 0, max: 0.5, step: 0.02 });
    gp.addEventListener('input', () => { layer.fill.gap = Number(gp.value); onChange(); });
  } else if (layer.fill.kind === 'firecracker') {
    addSlotColorCtrl('color', 'color', '#e0954a');
    const fz = addCtrl('fuse', 'number', layer.fill.fuse ?? 0.08, { min: 0.02, max: 0.3, step: 0.01 });
    fz.addEventListener('input', () => { layer.fill.fuse = Number(fz.value); onChange(); });
    const bw = addCtrl('bar height', 'number', layer.fill.barWidth ?? 0.5, { min: 0.1, max: 1, step: 0.05 });
    bw.addEventListener('input', () => { layer.fill.barWidth = Number(bw.value); onChange(); });
    const bl = addCtrl('bar length', 'number', layer.fill.barLen ?? 0.4, { min: 0.1, max: 0.5, step: 0.02 });
    bl.addEventListener('input', () => { layer.fill.barLen = Number(bl.value); onChange(); });
  } else if (layer.fill.kind === 'grass') {
    addSlotColorCtrl('blade', 'color', '#3f7a8c');
    const th = addCtrl('thickness', 'number', layer.fill.thickness ?? 0.01, { min: 0.003, max: 0.04, step: 0.002 });
    th.addEventListener('input', () => { layer.fill.thickness = Number(th.value); onChange(); });
    const ht = addCtrl('height', 'number', layer.fill.height ?? 1.05, { min: 0.4, max: 1.6, step: 0.05 });
    ht.addEventListener('input', () => { layer.fill.height = Number(ht.value); onChange(); });
    const pc = addCtrl('pod chance', 'number', layer.fill.podChance ?? 0.4, { min: 0, max: 1, step: 0.05 });
    pc.addEventListener('input', () => { layer.fill.podChance = Number(pc.value); onChange(); });
  } else if (layer.fill.kind === 'graph') {
    addSlotColorCtrl('line', 'stroke', '#8a9a4a');
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
    addSlotColorCtrl('stalk', 'stalk', '#4f4a22');
    addSlotColorCtrl('leaf', 'leaf', '#7d9a40');
  } else if (layer.fill.kind === 'honeycomb') {
    addSlotColorCtrl('line', 'stroke', '#3a4aa0');
    const sw = addCtrl('line width', 'number', layer.fill.strokeWidth ?? 0.03, { min: 0.005, max: 0.12, step: 0.005 });
    sw.addEventListener('input', () => { layer.fill.strokeWidth = Number(sw.value); onChange(); });
  } else if (layer.fill.kind === 'dashes') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'random', { options: ['fixed', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'random') === 'fixed') {
      addSlotColorCtrl('mark', 'color', '#d2624d');
    }
    const dn = addCtrl('density', 'number', layer.fill.density ?? 0.5, { min: 0, max: 1, step: 0.05 });
    dn.addEventListener('input', () => { layer.fill.density = Number(dn.value); onChange(); });
    const wd = addCtrl('mark width', 'number', layer.fill.width ?? 0.4, { min: 0.1, max: 1, step: 0.05 });
    wd.addEventListener('input', () => { layer.fill.width = Number(wd.value); onChange(); });
  } else if (layer.fill.kind === 'windowpane') {
    addSlotColorCtrl('v line', 'vColor', '#b7bbc0');
    addSlotColorCtrl('h stitch', 'hColor', '#9aa0a6');
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
    addSlotColorCtrl('stone', 'color', '#efe9dc');
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
    // Colours live in the layer palette (edited via the palette swatches
    // above). Here we only pick the look + structure.
    //   two-tone     — transparent ground, glyph in a random palette ink
    //   ink-on-paper — opaque, palette[0] on palette[1], random inversion
    const twoTone = layer.fill.twoTone ?? !!(layer.fill.inks && layer.fill.inks.length);
    const style = addCtrl('style', 'select', twoTone ? 'two-tone' : 'ink-on-paper',
      { options: ['ink-on-paper', 'two-tone'] });
    style.addEventListener('change', () => {
      layer.fill.twoTone = style.value === 'two-tone';
      onChange(); rebuild();
    });
    if (!twoTone) {
      const inv = addCtrl('invert prob', 'number', layer.fill.invert ?? 0.5, { min: 0, max: 1, step: 0.05 });
      inv.addEventListener('input', () => { layer.fill.invert = Number(inv.value); onChange(); });
    }
    const wt = addCtrl('bar weight', 'number', layer.fill.weight ?? 0.22, { min: 0.08, max: 0.4, step: 0.02 });
    wt.addEventListener('input', () => { layer.fill.weight = Number(wt.value); onChange(); });
  } else if (layer.fill.kind === 'manhattan') {
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle', 'checker', 'random'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addSlotColorCtrl('ink', 'color', '#ffffff');
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
    addSlotColorCtrl('stem color', 'stemColor', '#454545');
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
      addSlotColorCtrl('color', 'color', '#d8c79c');
    }
  } else if (layer.fill.kind === 'maze') {
    addSlotColorCtrl('color', 'color', '#2c3340');
    const th = addCtrl('thickness (× cell)', 'number', layer.fill.thickness ?? 0.18, { min: 0.02, max: 0.5, step: 0.01 });
    th.addEventListener('input', () => { layer.fill.thickness = Number(th.value); onChange(); });
  } else if (layer.fill.kind === 'mesh') {
    const jit = addCtrl('point jitter (× cell)', 'number', layer.fill.jitter ?? 0.25, { min: 0, max: 0.49, step: 0.01 });
    jit.addEventListener('input', () => { layer.fill.jitter = Number(jit.value); onChange(); });
    const cmode = addCtrl('colour', 'select', layer.fill.mode || 'fixed', { options: ['fixed', 'palette-cycle'] });
    cmode.addEventListener('change', () => { layer.fill.mode = cmode.value; onChange(); rebuild(); });
    if ((layer.fill.mode || 'fixed') === 'fixed') {
      addSlotColorCtrl('color', 'color', '#d24a45');
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
      addSlotColorCtrl('stroke color', 'stroke', '#ffffff');
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
  // Forward-declared so the various input handlers and refreshers can
  // call _refreshHints() without caring whether refreshSectionState
  // (which assigns it) has run yet. Must live at the top of mount()
  // so any reference within mount avoids the TDZ that a later `let`
  // would create — typeof on a TDZ-bound let throws ReferenceError
  // and kills the rest of init, including the sample-library wiring.
  let _refreshHints = null;
  const stage     = document.getElementById('girard-stage');
  const listEl    = document.getElementById('girard-layer-list');
  const configEl  = document.getElementById('girard-layer-config');
  const addSelect = document.getElementById('girard-add-layer');
  const seed      = document.getElementById('girard-seed');
  const roll      = document.getElementById('girard-roll');
  const repeat    = document.getElementById('girard-repeat');
  const aspectW   = document.getElementById('girard-aspect-w');
  const aspectH   = document.getElementById('girard-aspect-h');
  const physRepeat = document.getElementById('girard-physical-repeat');
  const physUnit   = document.getElementById('girard-physical-unit');
  const yardStage  = document.getElementById('girard-yardage-stage');
  const yardTiles  = document.getElementById('girard-yardage-tiles');
  const yardSize   = document.getElementById('girard-yardage-size');
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
  const rerenderYardage = () => {
    if (!yardStage) return;
    // Skip rebuilding while the modal is closed — the SVG isn't shown
    // and `rerenderYardage` rides on every parameter tick. We refresh
    // on open instead.
    const modalEl = document.getElementById('girard-yardage-modal');
    if (modalEl && !modalEl.classList.contains('is-open')) return;
    const n = Number(yardTiles?.value) || 4;
    yardStage.replaceChildren(buildYardageSvg(pattern, n));
    // CSS var drives the SVG's aspect-ratio so the field renders at
    // its real shape (letterbox in the surrounding modal area, not
    // forced square).
    yardStage.style.setProperty('--girard-yardage-aspect', String(pattern.aspect || 1));
    if (yardSize) {
      const w = (Number(pattern.physicalRepeat) || 0) * n;
      const h = w / (pattern.aspect || 1);
      const u = pattern.physicalUnit || 'in';
      const fmt = (v) => (Math.round(v * 100) / 100).toString();
      yardSize.textContent = `${fmt(w)} × ${fmt(h)} ${u}`;
    }
  };
  // ----- Undo / redo history -----
  // Past: snapshots taken at save-points before each "burst" of edits.
  // Future: states the user undid out of, replayable via redo.
  // Bursts collapse via a 500 ms debounce on scheduleSave so dragging
  // a slider is one undo step, not 50.
  const _hist = { past: [], future: [], max: 50, saveTimer: null, applying: false };
  const _snap = () => JSON.parse(JSON.stringify(pattern));
  let _lastSavedSnap = _snap();
  const _commitSave = () => {
    const cur = _snap();
    // Skip no-op rerenders so identical snapshots don't pollute past.
    if (JSON.stringify(cur) === JSON.stringify(_lastSavedSnap)) return;
    _hist.past.push(_lastSavedSnap);
    if (_hist.past.length > _hist.max) _hist.past.shift();
    _lastSavedSnap = cur;
    _hist.future = [];
  };
  const _flushPendingSave = () => {
    if (!_hist.saveTimer) return;
    clearTimeout(_hist.saveTimer);
    _hist.saveTimer = null;
    _commitSave();
  };
  const scheduleSave = () => {
    if (_hist.applying) return;   // undo / redo isn't itself a save-point
    if (_hist.saveTimer) clearTimeout(_hist.saveTimer);
    _hist.saveTimer = setTimeout(() => {
      _commitSave();
      _hist.saveTimer = null;
    }, 500);
  };
  // Restore a snapshot into the live pattern and mirror it onto every
  // top-level UI input that doesn't get rebuilt by rerenderUI(). Layer
  // list + config form are handled by rerenderUI itself.
  const applyPatternToUI = () => {
    seed.value = pattern.seed;
    repeat.value = pattern.repeat;
    if (aspectW && aspectH) {
      if (pattern.aspectW && pattern.aspectH) {
        aspectW.value = pattern.aspectW; aspectH.value = pattern.aspectH;
      } else {
        const a = pattern.aspect ?? 1;
        if (a >= 1) { aspectW.value = Math.round(a * 10) / 10; aspectH.value = 1; }
        else        { aspectW.value = 1; aspectH.value = Math.round((1 / a) * 10) / 10; }
      }
    }
    if (veil) veil.value = pattern.surroundVeil;
    if (typeof syncRepeatFractionUI === 'function') syncRepeatFractionUI();
    if (physRepeat) physRepeat.value = pattern.physicalRepeat;
    if (physUnit) physUnit.value = pattern.physicalUnit;
    if (colorModeSel) colorModeSel.value = pattern.colorMode || 'srgb';
    if (iccProfileSel) iccProfileSel.value = pattern.iccProfile || 'sRGB IEC61966-2.1';
    if (exportWidthInp) exportWidthInp.value = pattern.exportWidth ?? 1024;
    if (exportFlattenInp) exportFlattenInp.checked = !!pattern.exportFlatten;
    if (exportBgInp) exportBgInp.value = pattern.exportBackground || '#ffffff';
    refreshColorwaySelect();
    refreshProjectPalette();
    refreshPhysicalOverlay();
    rerenderUI();
  };
  const undo = () => {
    _flushPendingSave();
    if (_hist.past.length === 0) return;
    _hist.future.push(_snap());
    pattern = _hist.past.pop();
    _lastSavedSnap = JSON.parse(JSON.stringify(pattern));
    _hist.applying = true;
    applyPatternToUI();
    _hist.applying = false;
  };
  const redo = () => {
    if (_hist.future.length === 0) return;
    _hist.past.push(_snap());
    pattern = _hist.future.pop();
    _lastSavedSnap = JSON.parse(JSON.stringify(pattern));
    _hist.applying = true;
    applyPatternToUI();
    _hist.applying = false;
  };
  document.addEventListener('keydown', (e) => {
    const meta = e.metaKey || e.ctrlKey;
    if (!meta) return;
    // Ignore when typing into form fields so Cmd-Z in an input still
    // undoes the input's text, not the pattern.
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo(); }
  });

  const rerenderSvg = () => {
    stage.replaceChildren(buildSvg(pattern));
    rerenderYardage();
    scheduleSave();
    // If any layer uses a web font, load it then redraw once it's ready
    // (SVG text needs the face present to measure/paint correctly).
    const fonts = patternFonts(pattern);
    if (fonts.length) {
      Promise.all(fonts.map(ensureFont)).then(() => {
        stage.replaceChildren(buildSvg(pattern));
        rerenderYardage();
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
    // Locking freezes the layer's RNG seed at lock-time so subsequent
    // "roll"s (or any other change to pattern.seed) don't shuffle this
    // layer. Unlocking drops the frozen seed and the layer re-joins the
    // global RNG flow.
    lock: (i) => {
      const layer = pattern.layers[i];
      if (!layer) return;
      if (layer.locked) {
        layer.locked = false;
        delete layer.lockedSeed;
      } else {
        layer.locked = true;
        layer.lockedSeed = (pattern.seed + i * 9973) | 0;
      }
      rerenderUI();
    },
    // Solo: when any layer is solo'd, only solo'd layers render.
    // Mixer convention — toggling all off returns to "everyone visible."
    // Independent of lock; a layer can be both.
    solo: (i) => {
      const layer = pattern.layers[i];
      if (!layer) return;
      layer.solo = !layer.solo;
      rerenderUI();
    },
  };
  const rerenderUI = () => {
    rerenderSvg();
    renderLayerList(listEl, pattern, selected, layerHandlers);
    buildConfigForm(configEl, pattern.layers[selected], rerenderSvg, {
      colorMode: pattern.colorMode || 'srgb',
      iccProfile: pattern.iccProfile || 'U.S. Web Coated (SWOP) v2',
      customShapes: pattern.customShapes || {},
      roles: (pattern.paletteSpec?.swatches || []).map(s => s.role).filter(Boolean),
      byRole: resolvePalette(pattern).byRole || {},
    });
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
    if (typeof _refreshHints === 'function') _refreshHints();
  });

  roll.addEventListener('click', () => {
    const s = Math.floor(Math.random() * 99999);
    seed.value = s;
    pattern.seed = s;
    rerenderSvg();
    if (typeof _refreshHints === 'function') _refreshHints();
  });

  // The offset fraction input is shared between `drop` and `brick`
  // styles. It writes to dropFraction or brickFraction depending on
  // the current style, and hides for repeat styles that don't take
  // a fraction (square / half-* / mirror-*).
  const repeatFractionWrap = document.getElementById('girard-repeat-fraction-wrap');
  const repeatFractionInp  = document.getElementById('girard-repeat-fraction');
  const repeatTakesFraction = (r) => r === 'drop' || r === 'brick';
  const syncRepeatFractionUI = () => {
    const r = repeat.value;
    if (repeatFractionWrap) {
      repeatFractionWrap.classList.toggle('is-hidden', !repeatTakesFraction(r));
    }
    if (repeatFractionInp) {
      const v = r === 'brick' ? (pattern.brickFraction ?? 0.5) : (pattern.dropFraction ?? 0.5);
      repeatFractionInp.value = Math.round(v * 100);
    }
  };
  repeat.addEventListener('change', () => {
    pattern.repeat = repeat.value;
    syncRepeatFractionUI();
    rerenderSvg();
    if (typeof _refreshHints === 'function') _refreshHints();
  });
  if (repeatFractionInp) {
    repeatFractionInp.addEventListener('input', () => {
      const pct = Math.max(0, Math.min(100, Number(repeatFractionInp.value) || 0));
      const fr = pct / 100;
      if (pattern.repeat === 'brick') pattern.brickFraction = fr;
      else pattern.dropFraction = fr;
      rerenderSvg();
      if (typeof _refreshHints === 'function') _refreshHints();
    });
  }
  syncRepeatFractionUI();

  const syncAspect = () => {
    const w = Math.max(0.1, Number(aspectW.value) || 1);
    const h = Math.max(0.1, Number(aspectH.value) || 1);
    pattern.aspectW = w;
    pattern.aspectH = h;
    pattern.aspect = w / h;
    rerenderSvg();
    refreshPhysicalOverlay();
    if (typeof _refreshHints === 'function') _refreshHints();
  };
  if (aspectW) aspectW.addEventListener('input', syncAspect);
  if (aspectH) aspectH.addEventListener('input', syncAspect);
  // Seed initial UI values from the loaded pattern, in case it carries
  // an explicit aspectW/aspectH; otherwise factor the ratio sensibly.
  if (aspectW && aspectH) {
    if (pattern.aspectW && pattern.aspectH) {
      aspectW.value = pattern.aspectW;
      aspectH.value = pattern.aspectH;
    } else if (pattern.aspect && Math.abs(pattern.aspect - 1) > 1e-3) {
      const a = pattern.aspect;
      if (a >= 1) { aspectW.value = Math.round(a * 10) / 10; aspectH.value = 1; }
      else        { aspectW.value = 1; aspectH.value = Math.round((1 / a) * 10) / 10; }
    }
  }

  // Physical repeat: drives the units overlay (W × H in the chosen
  // unit) and is the foundation for the yardage preview / bleed marks.
  // Pixel rendering is independent — this is a "what does it print as"
  // declaration.
  const refreshPhysicalOverlay = () => {
    if (!stage) return;
    let overlay = stage.querySelector('.girard-units-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'girard-units-overlay';
      stage.appendChild(overlay);
    }
    const w = Number(pattern.physicalRepeat) || 0;
    const aspect = pattern.aspect || 1;
    const h = w / aspect;
    const u = pattern.physicalUnit || 'in';
    const fmt = (v) => (Math.round(v * 100) / 100).toString();
    overlay.textContent = `${fmt(w)} × ${fmt(h)} ${u}`;
  };
  if (physRepeat) {
    physRepeat.value = pattern.physicalRepeat;
    physRepeat.addEventListener('input', () => {
      pattern.physicalRepeat = Math.max(0.1, Number(physRepeat.value) || 0);
      refreshPhysicalOverlay();
      if (typeof _refreshHints === 'function') _refreshHints();
    });
  }
  if (physUnit) {
    physUnit.value = pattern.physicalUnit;
    physUnit.addEventListener('change', () => {
      // Convert the stored value when switching units so the printed
      // size stays the same, not the number.
      const prev = pattern.physicalUnit;
      const next = physUnit.value;
      if (prev !== next) {
        const factor = (prev === 'in' && next === 'cm') ? 2.54
                    : (prev === 'cm' && next === 'in') ? (1 / 2.54)
                    : 1;
        pattern.physicalRepeat = Math.round(pattern.physicalRepeat * factor * 100) / 100;
        pattern.physicalUnit = next;
        if (physRepeat) physRepeat.value = pattern.physicalRepeat;
      }
      refreshPhysicalOverlay();
      if (typeof _refreshHints === 'function') _refreshHints();
    });
  }
  refreshPhysicalOverlay();
  if (yardTiles) yardTiles.addEventListener('change', () => rerenderYardage());

  // Yardage modal: full-viewport overlay that renders the tile field.
  // Hidden by default; toggled by the "yardage" button. ESC and a
  // click on the dim backdrop also close it.
  const yardModal    = document.getElementById('girard-yardage-modal');
  const yardOpenBtn  = document.getElementById('girard-yardage-open');
  const yardCloseBtn = document.getElementById('girard-yardage-close');
  const yardageOpen = () => {
    if (!yardModal) return;
    yardModal.classList.add('is-open');
    yardModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    rerenderYardage();
  };
  const yardageClose = () => {
    if (!yardModal) return;
    yardModal.classList.remove('is-open');
    yardModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };
  const yardageToggle = () => {
    if (yardModal?.classList.contains('is-open')) yardageClose();
    else yardageOpen();
  };
  if (yardOpenBtn)  yardOpenBtn.addEventListener('click', yardageToggle);
  if (yardCloseBtn) yardCloseBtn.addEventListener('click', yardageClose);
  if (yardModal) {
    yardModal.addEventListener('click', (e) => {
      // Backdrop click closes; clicks inside the SVG / controls bubble
      // to those elements and don't reach here as the modal's target.
      if (e.target === yardModal) yardageClose();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && yardModal?.classList.contains('is-open')) yardageClose();
  });

  // ----- Project palette + colorways (parametric model) -----
  // pattern.paletteSpec holds the shape (role names + tracked OKLCH
  // deltas + anchored hex defaults). pattern.colorways[name] = { base,
  // overrides } provides one (base, anchored-overrides) tuple in
  // that shape. The renderer keeps reading pattern.palette as a hex
  // array; refreshPaletteFromSpec keeps it in step.
  const paletteSchemeSel  = document.getElementById('girard-palette-scheme');
  const paletteCountInp   = document.getElementById('girard-palette-count');
  const paletteApplyBtn   = document.getElementById('girard-palette-apply');
  const matrixEl          = document.getElementById('girard-colorway-matrix');

  // Ensure a palette spec + at least one colorway exist on the
  // pattern. Runs on initial mount and after any operation that
  // could have left them empty (sample load, undo to old state, …).
  const ensurePaletteSpec = () => {
    if (!pattern.paletteSpec) {
      pattern.paletteSpec = inferPaletteSpec(pattern.palette && pattern.palette.length
        ? pattern.palette
        : ['#888888']);
    }
    if (!pattern.colorways || !Object.keys(pattern.colorways).length) {
      pattern.colorways = buildColorways(
        pattern.paletteSpec,
        { main: pattern.palette && pattern.palette.length ? pattern.palette : ['#888888'] }
      );
    }
    if (!pattern.activeColorway || !pattern.colorways[pattern.activeColorway]) {
      pattern.activeColorway = Object.keys(pattern.colorways)[0];
    }
    // Fold every layer colour into the spec so the matrix lists them and
    // colourway edits recolour the whole pattern (covers layered / legacy
    // patterns whose spec predates the colour, not just fresh loads).
    ensureLayerColorsInSpec(pattern);
    refreshPaletteFromSpec(pattern);
  };

  const activeCw = () => pattern.colorways[pattern.activeColorway];

  // Unique label suffix per accent slot when generating fresh roles.
  const nextAccentRole = () => {
    let n = 1;
    const taken = new Set((pattern.paletteSpec.swatches || []).map(s => s.role));
    while (taken.has(`accent-${n}`)) n++;
    return `accent-${n}`;
  };

  // ----- Colourway matrix -----
  // Rows = roles (paletteSpec.swatches), columns = colourways. Each
  // cell shows the colour that role resolves to in that colourway:
  // explicit (a hand-set override) or faint/auto (derived from that
  // colourway's base, or the role's anchored default).

  // Unique "colourway N" name for new columns.
  const uniqueColorwayName = () => {
    let n = Object.keys(pattern.colorways).length + 1;
    while (pattern.colorways[`colourway ${n}`]) n++;
    return `colourway ${n}`;
  };

  // Rename a role everywhere it's referenced: the spec swatch, every
  // colourway's overrides, and any layer slot bound to it.
  const renameRole = (sw, trimmed) => {
    if (!trimmed || trimmed === sw.role) return;
    for (const c of Object.values(pattern.colorways)) {
      if (c.overrides && Object.prototype.hasOwnProperty.call(c.overrides, sw.role)) {
        c.overrides[trimmed] = c.overrides[sw.role];
        delete c.overrides[sw.role];
      }
    }
    const repoint = (l) => {
      if (!l) return;
      if (l.paletteRoles) l.paletteRoles = l.paletteRoles.map(r => r === sw.role ? trimmed : r);
      if (l.fill && l.fill.layer) repoint(l.fill.layer);
    };
    pattern.layers.forEach(repoint);
    sw.role = trimmed;
  };

  // Rename a colourway key while preserving column order.
  const renameColorway = (oldName, trimmed) => {
    if (!trimmed || trimmed === oldName || pattern.colorways[trimmed]) return;
    const rebuilt = {};
    for (const [k, v] of Object.entries(pattern.colorways)) {
      rebuilt[k === oldName ? trimmed : k] = v;
    }
    pattern.colorways = rebuilt;
    if (pattern.activeColorway === oldName) pattern.activeColorway = trimmed;
  };

  // Full resync after a matrix mutation: recompute the active palette,
  // repaint the matrix, and rebuild the stage + layer panel so a layer's
  // role-bound swatches track the active colourway too.
  const commit = () => {
    refreshPaletteFromSpec(pattern);
    renderColorwayMatrix();
    rerenderUI();
  };

  // Drag-reorder. Colourways are object keys (rebuilt in new order);
  // roles are the swatches array (base stays pinned at index 0).
  const reorderColorways = (from, to) => {
    if (from === to) return;
    const names = Object.keys(pattern.colorways);
    if (from < 0 || to < 0 || from >= names.length || to >= names.length) return;
    const [m] = names.splice(from, 1);
    names.splice(to, 0, m);
    const rebuilt = {};
    for (const n of names) rebuilt[n] = pattern.colorways[n];
    pattern.colorways = rebuilt;
  };
  const reorderRoles = (from, to) => {
    if (from === to || from === 0 || to === 0) return;
    const arr = pattern.paletteSpec.swatches;
    if (from < 1 || to < 1 || from >= arr.length || to >= arr.length) return;
    const [m] = arr.splice(from, 1);
    arr.splice(to, 0, m);
  };

  const renderColorwayMatrix = () => {
    if (!matrixEl) return;
    ensurePaletteSpec();
    matrixEl.replaceChildren();
    const swatches = pattern.paletteSpec.swatches;
    const names = Object.keys(pattern.colorways);
    matrixEl.style.gridTemplateColumns =
      `minmax(104px, 1.3fr) repeat(${names.length}, minmax(40px, 1fr)) auto`;

    // Drag-reorder wiring shared by row + column headers. `spec` carries
    // { kind:'col'|'row', i }. dragover marks a drop target; drop reorders.
    const makeDraggable = (el, spec) => {
      el.draggable = true;
      el.classList.add('cwm-draggable');
      el.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', JSON.stringify(spec));
      });
      el.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        el.classList.add('cwm-drop-target');
      });
      el.addEventListener('dragleave', () => el.classList.remove('cwm-drop-target'));
      el.addEventListener('drop', (e) => {
        e.preventDefault();
        el.classList.remove('cwm-drop-target');
        let from;
        try { from = JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return; }
        if (!from || from.kind !== spec.kind) return;
        if (spec.kind === 'col') reorderColorways(from.i, spec.i);
        else reorderRoles(from.i, spec.i);
        commit();
      });
    };

    // -- header row: corner + one head per colourway + add-column --
    const corner = document.createElement('div');
    corner.className = 'cwm-corner';
    corner.textContent = 'roles \\ ways';
    matrixEl.appendChild(corner);

    names.forEach((name, ci) => {
      const head = document.createElement('div');
      head.className = 'cwm-colhead' + (name === pattern.activeColorway ? ' is-active' : '');
      makeDraggable(head, { kind: 'col', i: ci });
      const label = document.createElement('button');
      label.type = 'button';
      label.className = 'cwm-colname';
      label.textContent = name;
      label.title = name === pattern.activeColorway
        ? `${name} (active) — double-click to rename · drag to reorder`
        : `${name} — click to make active · double-click to rename · drag to reorder`;
      label.addEventListener('click', () => {
        if (name === pattern.activeColorway) return;
        pattern.activeColorway = name;
        commit();
      });
      label.addEventListener('dblclick', () => {
        const next = prompt(`Rename colourway "${name}":`, name);
        if (next == null) return;
        renameColorway(name, next.trim());
        commit();
      });
      head.appendChild(label);
      if (names.length > 1) {
        const rm = document.createElement('button');
        rm.type = 'button';
        rm.className = 'cwm-colrm';
        rm.textContent = '×';
        rm.title = 'delete colourway';
        rm.addEventListener('click', () => {
          delete pattern.colorways[name];
          if (pattern.activeColorway === name) {
            pattern.activeColorway = Object.keys(pattern.colorways)[0];
          }
          commit();
        });
        head.appendChild(rm);
      }
      matrixEl.appendChild(head);
    });

    const addCol = document.createElement('button');
    addCol.type = 'button';
    addCol.className = 'cwm-addcol';
    addCol.textContent = '+';
    addCol.title = 'add colourway (clone of active)';
    addCol.addEventListener('click', () => {
      const cur = activeCw();
      const name = uniqueColorwayName();
      pattern.colorways[name] = { base: cur.base, overrides: { ...(cur.overrides || {}) } };
      pattern.activeColorway = name;
      commit();
    });
    matrixEl.appendChild(addCol);

    // -- one row per role --
    swatches.forEach((sw, i) => {
      const rh = document.createElement('div');
      rh.className = 'cwm-rowhead cwm-rowhead--' + sw.kind;
      if (i > 0) makeDraggable(rh, { kind: 'row', i });
      const rlabel = document.createElement('button');
      rlabel.type = 'button';
      rlabel.className = 'cwm-rolename';
      rlabel.textContent = sw.role || `slot-${i}`;
      if (i === 0) {
        rlabel.disabled = true;
        rlabel.title = 'base — the colour each colourway is built from';
      } else {
        rlabel.title = 'double-click to rename role · drag to reorder';
        rlabel.addEventListener('dblclick', () => {
          const next = prompt(`Rename role "${sw.role}":`, sw.role);
          if (next == null) return;
          renameRole(sw, next.trim());
          commit();
        });
      }
      rh.appendChild(rlabel);

      if (i > 0) {
        // lock = the role's *default* (auto) behaviour: tracked
        // (follows each colourway base) vs anchored (fixed colour).
        const lock = document.createElement('button');
        lock.type = 'button';
        lock.className = 'cwm-lock';
        lock.textContent = sw.kind === 'abs' ? '🔒' : '🔗';
        lock.title = sw.kind === 'abs'
          ? 'anchored: auto cells use a fixed colour — click to track the base'
          : 'tracked: auto cells follow each colourway base — click to anchor';
        lock.addEventListener('click', () => {
          const cw = activeCw();
          const baseOklch = hexToOklch(cw.base);
          const resolved = resolveSwatch(sw, baseOklch, cw.overrides || {});
          if (sw.kind === 'abs') {
            const [L, C, H] = hexToOklch(resolved);
            let dH = H - baseOklch[2];
            if (dH > 180) dH -= 360;
            if (dH < -180) dH += 360;
            sw.kind = 'rel';
            sw.dL = L - baseOklch[0];
            sw.dC = C - baseOklch[1];
            sw.dH = dH;
            delete sw.hex;
          } else {
            sw.kind = 'abs';
            sw.hex = resolved;
            delete sw.dL; delete sw.dC; delete sw.dH;
          }
          commit();
        });
        rh.appendChild(lock);

        const rrm = document.createElement('button');
        rrm.type = 'button';
        rrm.className = 'cwm-rowrm';
        rrm.textContent = '×';
        rrm.title = 'remove role';
        rrm.addEventListener('click', () => {
          pattern.paletteSpec.swatches.splice(i, 1);
          for (const c of Object.values(pattern.colorways)) {
            if (c.overrides) delete c.overrides[sw.role];
          }
          commit();
        });
        rh.appendChild(rrm);
      }
      matrixEl.appendChild(rh);

      // one cell per colourway
      names.forEach((name) => {
        const cw = pattern.colorways[name];
        const baseOklch = hexToOklch(cw.base);
        const isBase = sw.kind === 'base';
        const resolved = isBase ? cw.base : resolveSwatch(sw, baseOklch, cw.overrides || {});
        const explicit = isBase || hasExplicitColor(sw, cw.overrides || {});
        const cell = document.createElement('label');
        cell.className = 'cwm-cell' + (explicit ? ' is-explicit' : ' is-auto')
          + (name === pattern.activeColorway ? ' in-active-col' : '');
        cell.title = isBase
          ? `${name} base`
          : explicit
          ? `${name} · ${sw.role}: explicit ${resolved} — alt-click / right-click to clear → auto`
          : `${name} · ${sw.role}: auto ${resolved} — click to set explicit`;
        const picker = document.createElement('input');
        picker.type = 'color';
        picker.className = 'cwm-cell-picker';
        picker.value = resolved;
        // Live-edit on input (no full re-render → the picker isn't torn
        // down mid-drag); full resync on change so siblings + the layer
        // panel catch up once the colour is committed.
        picker.addEventListener('input', () => {
          if (isBase) cw.base = picker.value;
          else cw.overrides = { ...(cw.overrides || {}), [sw.role]: picker.value };
          cell.classList.remove('is-auto');
          cell.classList.add('is-explicit');
          if (name === pattern.activeColorway) {
            refreshPaletteFromSpec(pattern);
            rerenderSvg();
          }
        });
        picker.addEventListener('change', commit);
        cell.appendChild(picker);
        if (!isBase) {
          // Clear an override → the cell reverts to auto.
          const clearOverride = (e) => {
            if (!hasExplicitColor(sw, cw.overrides || {})) return;
            e.preventDefault();
            delete cw.overrides[sw.role];
            commit();
          };
          cell.addEventListener('contextmenu', clearOverride);
          cell.addEventListener('click', (e) => { if (e.altKey) clearOverride(e); });
        }
        matrixEl.appendChild(cell);
      });

      // spacer under the add-column button
      const spacer = document.createElement('div');
      spacer.className = 'cwm-spacer';
      matrixEl.appendChild(spacer);
    });

    // -- footer: add role (spans the whole grid) --
    const addRow = document.createElement('button');
    addRow.type = 'button';
    addRow.className = 'cwm-addrow';
    addRow.textContent = '+ role';
    addRow.title = 'add a tracked accent role';
    addRow.style.gridColumn = '1 / -1';
    addRow.addEventListener('click', () => {
      const role = nextAccentRole();
      pattern.paletteSpec.swatches.push({ role, kind: 'rel', dL: 0, dC: 0, dH: 0 });
      commit();
    });
    matrixEl.appendChild(addRow);

    if (typeof _refreshHints === 'function') _refreshHints();
  };

  // Combined refresh used after operations that touch both the spec
  // and the colourway list (initial mount, sample load, undo).
  const refreshPaletteUI = () => {
    ensurePaletteSpec();
    renderColorwayMatrix();
  };

  // ----- Wire events -----
  if (paletteApplyBtn) {
    paletteApplyBtn.addEventListener('click', () => {
      ensurePaletteSpec();
      const scheme = paletteSchemeSel?.value || 'analogous';
      const n = Math.max(1, Math.min(15, Number(paletteCountInp?.value) || 4));
      const gen = PALETTE_SCHEME_DELTAS[scheme];
      if (!gen) return;
      const deltas = gen(n);
      // Recolour the ACTIVE colourway only. The scheme writes explicit
      // colours onto each accent role, derived from this colourway's
      // base — so other colourways are left untouched. The shared role
      // set may grow (new accents) if the scheme asks for more than
      // exist, but existing roles' relationships aren't rewritten.
      const cw = activeCw();
      const baseOklch = hexToOklch(cw.base);
      const swatches = pattern.paletteSpec.swatches;
      const accents = swatches.filter(s =>
        s.kind !== 'base' && s.role !== 'ground' && s.role !== 'ink');
      // Add tracked accent roles if the scheme needs more than we have.
      while (accents.length < deltas.length) {
        const d = deltas[accents.length];
        const role = nextAccentRole();
        const sw = { role, kind: 'rel', dL: d.dL, dC: d.dC, dH: d.dH };
        swatches.push(sw);
        accents.push(sw);
      }
      cw.overrides = { ...(cw.overrides || {}) };
      deltas.forEach((d, idx) => {
        const sw = accents[idx];
        const L = Math.max(0, Math.min(1, baseOklch[0] + (d.dL || 0)));
        const C = Math.max(0, Math.min(0.4, baseOklch[1] + (d.dC || 0)));
        const H = ((baseOklch[2] + (d.dH || 0)) % 360 + 360) % 360;
        cw.overrides[sw.role] = oklchToHex(L, C, H);
      });
      commit();
    });
  }

  // Backwards-compat aliases used by the sample-load + undo paths.
  const refreshColorwaySelect = refreshPaletteUI;
  const refreshProjectPalette = refreshPaletteUI;

  refreshPaletteUI();

  veil.addEventListener('input', () => {
    pattern.surroundVeil = Number(veil.value);
    // Slider use cancels the "preview" toggle (which forces veil=1).
    if (veilPreviewBtn) {
      veilPreviewBtn.dataset.previewOn = '';
      veilPreviewBtn.setAttribute('aria-pressed', 'false');
    }
    rerenderSvg();
  });

  // "preview" button toggles between 100% visible (full tiling, no
  // veil) and the slider's value. Stash the slider value when previewing
  // so we can restore it on toggle off.
  const veilPreviewBtn = document.getElementById('girard-veil-preview');
  if (veilPreviewBtn) {
    veilPreviewBtn.addEventListener('click', () => {
      const on = veilPreviewBtn.dataset.previewOn === '1';
      if (on) {
        const stash = Number(veilPreviewBtn.dataset.previewStash);
        const restored = isFinite(stash) ? stash : Number(veil.value);
        pattern.surroundVeil = restored;
        veilPreviewBtn.dataset.previewOn = '';
        veilPreviewBtn.setAttribute('aria-pressed', 'false');
      } else {
        veilPreviewBtn.dataset.previewStash = String(pattern.surroundVeil);
        pattern.surroundVeil = 0;
        veilPreviewBtn.dataset.previewOn = '1';
        veilPreviewBtn.setAttribute('aria-pressed', 'true');
      }
      rerenderSvg();
    });
  }

  // Colour mode + ICC profile picker. Switching the mode rebuilds the
  // layer config form so colour pickers gain / lose their CMYK readouts.
  const colorModeSel = document.getElementById('girard-color-mode');
  const iccProfileSel = document.getElementById('girard-icc-profile');
  const iccLoadBtn = document.getElementById('girard-icc-load');
  const iccStatus = document.getElementById('girard-icc-status');
  if (iccProfileSel) {
    for (const p of ICC_PROFILES) {
      const opt = document.createElement('option');
      opt.value = p.id; opt.textContent = p.label;
      iccProfileSel.appendChild(opt);
    }
    iccProfileSel.value = pattern.iccProfile || 'sRGB IEC61966-2.1';
    iccProfileSel.addEventListener('change', () => {
      pattern.iccProfile = iccProfileSel.value;
    });
  }
  const profileLabel = (id) => {
    const entry = ICC_PROFILES.find(p => p.id === id);
    return entry ? entry.label : (id || 'sRGB');
  };
  const refreshIccStatus = () => {
    if (iccStatus) {
      iccStatus.textContent = iccProfiler.loaded
        ? `Profile-aware conversion enabled — ${profileLabel(pattern.iccProfile)} (gamma-correct, K-generated, ink-limited; full ICC v4 LUTs land next pass).`
        : iccProfiler.loading
        ? 'Loading ICC profiler…'
        : 'Fast math conversion in use. Load profiler for profile-aware (gamma + K-generation + ink limit) colour.';
    }
    if (typeof _refreshHints === 'function') _refreshHints();
  };
  // _refreshHints is forward-declared at the top of mount(); see
  // the comment there. It's just used here.
  if (colorModeSel) {
    colorModeSel.value = pattern.colorMode || 'srgb';
    colorModeSel.addEventListener('change', () => {
      pattern.colorMode = colorModeSel.value;
      rerenderUI();
    });
  }
  if (iccProfileSel) {
    iccProfileSel.addEventListener('change', () => {
      pattern.iccProfile = iccProfileSel.value;
      iccProfiler.profileId = iccProfileSel.value;
      refreshIccStatus();
      rerenderUI();
    });
  }
  if (iccLoadBtn) {
    iccLoadBtn.addEventListener('click', () => {
      if (iccProfiler.loaded) { refreshIccStatus(); return; }
      if (iccProfiler.loading) return;
      refreshIccStatus();
      iccProfiler.load(pattern.iccProfile).then(() => {
        refreshIccStatus();
        rerenderUI();
      });
    });
  }
  // File picker: parse the user's .icc binary into LUTs and bind it
  // to the currently-selected profileId. From that point on, every
  // RGB↔CMYK conversion for that profile routes through the LUT and
  // every PDF/TIFF export embeds the original bytes verbatim.
  const iccFileInp = document.getElementById('girard-icc-file');
  if (iccFileInp) {
    iccFileInp.addEventListener('change', () => {
      const file = iccFileInp.files && iccFileInp.files[0];
      if (!file) return;
      file.arrayBuffer().then(buf => {
        const bytes = new Uint8Array(buf);
        const parsed = parseIccProfile(bytes);
        if (!parsed) {
          if (iccStatus) iccStatus.textContent = `Could not parse ${file.name} — not an ICC v2 mft1/mft2 profile.`;
          return;
        }
        const profileId = pattern.iccProfile;
        iccProfiler.userProfiles.set(profileId, { bytes, parsed, filename: file.name });
        // Profile binding implies loaded state — synth math is replaced
        // by LUT lookup for this profile.
        iccProfiler.loaded = true;
        iccProfiler.profileId = profileId;
        // Drop the synth cache for this profileId so the embed path
        // re-fetches via buildCmykIccProfile and gets the user bytes.
        _cmykIccCache.delete(profileId);
        if (iccStatus) iccStatus.textContent = `Loaded ${file.name} — LUT-based ${parsed.colorSpace.trim()} → ${parsed.pcs.trim()} transforms active for ${profileLabel(profileId)}.`;
        rerenderUI();
      }).catch(err => {
        console.error('girard: ICC file read failed:', err);
        if (iccStatus) iccStatus.textContent = `Failed to read ${file.name}.`;
      });
      iccFileInp.value = '';   // allow re-loading the same file
    });
  }
  refreshIccStatus();

  // Soft-proof toggle. Only effective when ICC profiler is loaded.
  const softProofInp = document.getElementById('girard-soft-proof');
  if (softProofInp) {
    softProofInp.checked = !!pattern.softProof;
    softProofInp.addEventListener('change', () => {
      pattern.softProof = softProofInp.checked;
      rerenderSvg();
    });
  }

  // Export controls: size, flatten, background.
  const exportWidthInp = document.getElementById('girard-export-width');
  const exportFlattenInp = document.getElementById('girard-export-flatten');
  const exportBgInp = document.getElementById('girard-export-bg');
  if (exportWidthInp) {
    exportWidthInp.value = pattern.exportWidth ?? 1024;
    exportWidthInp.addEventListener('input', () => {
      pattern.exportWidth = Math.max(64, Math.min(8192, Number(exportWidthInp.value) || 1024));
    });
  }
  if (exportFlattenInp) {
    exportFlattenInp.checked = !!pattern.exportFlatten;
    exportFlattenInp.addEventListener('change', () => { pattern.exportFlatten = exportFlattenInp.checked; });
  }
  if (exportBgInp) {
    exportBgInp.value = pattern.exportBackground ?? '#ffffff';
    exportBgInp.addEventListener('input', () => {
      pattern.exportBackground = exportBgInp.value;
      refreshSectionState();
    });
  }

  // ----- Collapsed-section hints + conditional fields -----
  // Each <details> section gets a one-line state hint in its summary
  // so users can read what's inside without expanding. Conditional
  // fields (soft proof, export background, ICC profile select) hide
  // when they don't apply to the current settings, so the form isn't
  // cluttered with controls that wouldn't do anything.
  const rngHint     = document.getElementById('girard-rng-hint');
  const tileHint    = document.getElementById('girard-tile-hint');
  const paletteHint = document.getElementById('girard-palette-hint');
  const colourHint  = document.getElementById('girard-colour-hint');
  const exportHint  = document.getElementById('girard-export-hint');
  const iccProfileWrap = document.getElementById('girard-icc-profile-wrap');
  const softProofWrap  = document.getElementById('girard-soft-proof-wrap');
  const exportBgWrap   = document.getElementById('girard-export-bg-wrap');
  const refreshSectionState = () => {
    if (rngHint) {
      rngHint.textContent = `seed ${pattern.seed ?? 1}`;
    }
    if (tileHint) {
      const repeat = pattern.repeat || 'square';
      const aspect = pattern.aspectW && pattern.aspectH
        ? `${pattern.aspectW}:${pattern.aspectH}`
        : (pattern.aspect && Math.abs(pattern.aspect - 1) > 1e-3
            ? (pattern.aspect >= 1 ? `${Math.round(pattern.aspect * 10) / 10}:1` : `1:${Math.round((1 / pattern.aspect) * 10) / 10}`)
            : '1:1');
      const size = `${pattern.physicalRepeat ?? 24}${pattern.physicalUnit || 'in'}`;
      tileHint.textContent = `${repeat} · ${aspect} · ${size}`;
    }
    if (paletteHint) {
      const n = (pattern.palette || []).length;
      paletteHint.textContent = `${n} colour${n === 1 ? '' : 's'} · ${pattern.activeColorway || 'main'}`;
    }
    if (colourHint) {
      const mode = (pattern.colorMode || 'srgb').toUpperCase();
      const icc = iccProfiler.loaded ? ` · ${profileLabel(pattern.iccProfile)}` : '';
      colourHint.textContent = mode + icc;
    }
    if (exportHint) {
      const px = pattern.exportWidth ?? 1024;
      exportHint.textContent = `${px}px${pattern.exportFlatten ? ' · flattened' : ''}`;
    }
    // ICC profile only matters in CMYK mode.
    if (iccProfileWrap) iccProfileWrap.classList.toggle('is-hidden', (pattern.colorMode || 'srgb') !== 'cmyk');
    // Soft proof needs ICC loaded to do anything.
    if (softProofWrap)  softProofWrap.classList.toggle('is-hidden', !iccProfiler.loaded);
    // Export background only matters when flattening alpha onto it.
    if (exportBgWrap)   exportBgWrap.classList.toggle('is-hidden', !pattern.exportFlatten);
  };
  if (exportFlattenInp) {
    exportFlattenInp.addEventListener('change', refreshSectionState);
  }
  if (exportWidthInp) {
    exportWidthInp.addEventListener('input', refreshSectionState);
  }
  if (colorModeSel) {
    colorModeSel.addEventListener('change', refreshSectionState);
  }
  if (iccProfileSel) {
    iccProfileSel.addEventListener('change', refreshSectionState);
  }
  refreshSectionState();
  // Expose to the colour / palette refreshers below so they can keep
  // the summary hints in step when state changes. Closures resolve
  // the name lazily, so the order here doesn't matter.
  _refreshHints = refreshSectionState;

  // ----- Custom SVG shape import -----
  // Each imported SVG is parsed into a path-only descriptor and
  // stashed on pattern.customShapes by its filename (sans extension).
  // The layer config shape-kind dropdown picks them up via the
  // `custom:NAME` prefix; the renderer reads them via the module-level
  // _currentCustomShapes pointer that buildTileGroup updates per draw.
  const shapeFileInp = document.getElementById('girard-shape-file');
  const shapeListEl  = document.getElementById('girard-shape-list');
  const shapesHint   = document.getElementById('girard-shapes-hint');
  const refreshShapeList = () => {
    if (!shapeListEl) return;
    shapeListEl.replaceChildren();
    const names = Object.keys(pattern.customShapes || {});
    for (const name of names) {
      const chip = document.createElement('span');
      chip.className = 'shape-chip';
      const label = document.createElement('span');
      label.className = 'shape-chip-name';
      label.textContent = name;
      chip.appendChild(label);
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'remove';
      rm.addEventListener('click', () => {
        delete pattern.customShapes[name];
        refreshShapeList();
        rerenderUI();
      });
      chip.appendChild(rm);
      shapeListEl.appendChild(chip);
    }
    if (shapesHint) shapesHint.textContent = names.length ? `${names.length} imported` : '';
  };
  if (shapeFileInp) {
    shapeFileInp.addEventListener('change', () => {
      const files = Array.from(shapeFileInp.files || []);
      if (!files.length) return;
      let imported = 0, failed = [];
      const reads = files.map(f => f.text().then(text => {
        const parsed = parseSvgShape(text);
        if (!parsed) { failed.push(f.name); return; }
        const baseName = f.name.replace(/\.svg$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-');
        let name = baseName || 'shape';
        // Deduplicate against existing names.
        let suffix = 1;
        while (pattern.customShapes[name]) name = `${baseName}-${++suffix}`;
        pattern.customShapes[name] = parsed;
        imported++;
      }));
      Promise.all(reads).then(() => {
        if (failed.length) console.warn('girard: could not parse', failed.join(', '));
        refreshShapeList();
        rerenderUI();
        shapeFileInp.value = '';   // allow re-importing the same file
      });
    });
  }
  refreshShapeList();

  // Export — the clean deployable repeat unit. Wait for any web fonts
  // to be ready first (text-shape layers need real metrics).
  const exportBase = () => (sampleSel.value || 'girard-tile').toString().toLowerCase().replace(/\s+/g, '-');
  const fontsReady = () => {
    const fonts = patternFonts(pattern);
    return fonts.length ? Promise.all(fonts.map(ensureFont)) : Promise.resolve();
  };
  const exportSvgBtn = document.getElementById('girard-export-svg');
  if (exportSvgBtn) {
    exportSvgBtn.addEventListener('click', () => {
      fontsReady().then(() => exportTileSvg(pattern, exportBase()));
    });
  }
  const exportPngBtn = document.getElementById('girard-export-png');
  if (exportPngBtn) {
    exportPngBtn.addEventListener('click', () => {
      fontsReady().then(() => exportTilePng(pattern, exportBase()));
    });
  }
  const exportJpgBtn = document.getElementById('girard-export-jpg');
  if (exportJpgBtn) {
    exportJpgBtn.addEventListener('click', () => {
      fontsReady().then(() => exportTileJpeg(pattern, exportBase()));
    });
  }
  const exportTifBtn = document.getElementById('girard-export-tif');
  if (exportTifBtn) {
    exportTifBtn.addEventListener('click', () => {
      fontsReady().then(() => exportTileTiff(pattern, exportBase()));
    });
  }
  const exportPdfBtn = document.getElementById('girard-export-pdf');
  if (exportPdfBtn) {
    exportPdfBtn.addEventListener('click', () => {
      fontsReady().then(() => exportTilePdf(pattern, exportBase()));
    });
  }

  // Apply a named sample by mirroring the loadSample result onto all
  // the UI inputs that drive top-level state, then redraw. Shared by
  // the (legacy hidden) sample select and the new library modal.
  const applySample = (name, clear) => {
    if (!name) return;
    pattern = loadSample(name, pattern, clear);
    selected = pattern.layers.length - 1;
    seed.value = pattern.seed;
    repeat.value = pattern.repeat;
    if (aspectW && aspectH) {
      if (pattern.aspectW && pattern.aspectH) {
        aspectW.value = pattern.aspectW; aspectH.value = pattern.aspectH;
      } else {
        const a = pattern.aspect ?? 1;
        if (a >= 1) { aspectW.value = Math.round(a * 10) / 10; aspectH.value = 1; }
        else        { aspectW.value = 1; aspectH.value = Math.round((1 / a) * 10) / 10; }
      }
    }
    veil.value = pattern.surroundVeil;
    refreshColorwaySelect();
    refreshProjectPalette();
    rerenderUI();
  };

  loadBtn.addEventListener('click', () => {
    const name = sampleSel.value;
    if (!name) return;
    const clear = window.confirm(
      `Load "${name}"?\n\nOK: clear current design and load fresh.\nCancel: layer this sample on top of the current pattern.`
    );
    applySample(name, clear);
  });

  // Sample library modal: opens to a grid of clickable sample names.
  // Tag pills + thumbnail previews land in the next pass; the modal
  // shell is here now so the button isn't dead and the markup is
  // wired through.
  const samplesModal    = document.getElementById('girard-samples-modal');
  const samplesOpenBtn  = document.getElementById('girard-samples-open');
  const samplesCloseBtn = document.getElementById('girard-samples-close');
  const samplesGrid     = document.getElementById('girard-samples-grid');
  const samplesTagsEl   = document.getElementById('girard-samples-tags');
  const samplesSearchEl = document.getElementById('girard-samples-search');
  const samplesCount    = document.getElementById('girard-samples-count');

  // Build the sample → tags index once. Reused by the tag-pill bar
  // and the card filter; tag inference is pure so the result is
  // stable for the session.
  const sampleNames = Object.keys(SAMPLES).sort((a, b) => a.localeCompare(b));
  const sampleTagsByName = new Map();
  const allTagCounts = new Map();
  for (const name of sampleNames) {
    const tags = sampleTags(name, SAMPLES[name]);
    sampleTagsByName.set(name, tags);
    for (const t of tags) allTagCounts.set(t, (allTagCounts.get(t) || 0) + 1);
  }
  const allTags = [...allTagCounts.keys()].sort((a, b) => {
    // Sort by count descending so the most-used tags appear first.
    const d = allTagCounts.get(b) - allTagCounts.get(a);
    return d !== 0 ? d : a.localeCompare(b);
  });
  const activeTags = new Set();
  let searchTerm = '';

  // Card thumbnail builder — uses loadSample to reconstruct the
  // sample's pattern at default state and renders it as a 2×2 tile
  // field. Heavy SVG nodes are built on demand; the modal opens
  // immediately and cards fill in synchronously (62 samples × a small
  // tile render is comfortably under a frame budget on modern devices,
  // but if it becomes an issue we can swap to IntersectionObserver).
  const renderSamplesGrid = () => {
    if (!samplesGrid) return;
    samplesGrid.replaceChildren();
    const lowerSearch = searchTerm.trim().toLowerCase();
    let shown = 0;
    for (const name of sampleNames) {
      const tags = sampleTagsByName.get(name);
      if (activeTags.size > 0) {
        // AND across active tags — selecting "geometric" + "radial"
        // narrows to samples that hit both.
        let ok = true;
        for (const t of activeTags) if (!tags.includes(t)) { ok = false; break; }
        if (!ok) continue;
      }
      if (lowerSearch && !name.toLowerCase().includes(lowerSearch)) continue;
      shown++;
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'sample-card';
      const thumbWrap = document.createElement('div');
      thumbWrap.className = 'sample-card-thumb';
      try {
        const samplePattern = loadSample(name, defaultPattern(), true);
        thumbWrap.appendChild(buildSampleThumb(samplePattern));
      } catch (err) {
        console.warn('thumbnail failed for', name, err);
      }
      card.appendChild(thumbWrap);
      const meta = document.createElement('div');
      meta.className = 'sample-card-meta';
      const title = document.createElement('span');
      title.className = 'sample-card-title';
      title.textContent = name;
      meta.appendChild(title);
      if (tags.length) {
        const tagList = document.createElement('span');
        tagList.className = 'sample-card-tags';
        tagList.textContent = tags.slice(0, 3).join(' · ');
        meta.appendChild(tagList);
      }
      card.appendChild(meta);
      card.addEventListener('click', () => {
        const clear = window.confirm(
          `Load "${name}"?\n\nOK: clear current design and load fresh.\nCancel: layer this sample on top of the current pattern.`
        );
        applySample(name, clear);
        samplesClose();
      });
      samplesGrid.appendChild(card);
    }
    if (samplesCount) {
      const total = sampleNames.length;
      samplesCount.textContent = shown === total ? `${total} samples` : `${shown} of ${total}`;
    }
  };

  const renderTagPills = () => {
    if (!samplesTagsEl) return;
    samplesTagsEl.replaceChildren();
    for (const t of allTags) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'sample-tag-pill';
      pill.dataset.tag = t;
      pill.textContent = `${t} · ${allTagCounts.get(t)}`;
      if (activeTags.has(t)) pill.classList.add('is-active');
      pill.addEventListener('click', () => {
        if (activeTags.has(t)) activeTags.delete(t);
        else activeTags.add(t);
        renderTagPills();
        renderSamplesGrid();
      });
      samplesTagsEl.appendChild(pill);
    }
    if (activeTags.size > 0) {
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'sample-tag-pill is-clear';
      clear.textContent = 'clear';
      clear.addEventListener('click', () => {
        activeTags.clear();
        renderTagPills();
        renderSamplesGrid();
      });
      samplesTagsEl.appendChild(clear);
    }
  };

  if (samplesSearchEl) {
    samplesSearchEl.addEventListener('input', () => {
      searchTerm = samplesSearchEl.value || '';
      renderSamplesGrid();
    });
  }
  const samplesOpen = () => {
    if (!samplesModal) return;
    renderTagPills();
    renderSamplesGrid();
    samplesModal.classList.add('is-open');
    samplesModal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
  };
  const samplesClose = () => {
    if (!samplesModal) return;
    samplesModal.classList.remove('is-open');
    samplesModal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
  };
  if (samplesOpenBtn)  samplesOpenBtn.addEventListener('click', samplesOpen);
  if (samplesCloseBtn) samplesCloseBtn.addEventListener('click', samplesClose);
  if (samplesModal) {
    samplesModal.addEventListener('click', (e) => {
      if (e.target === samplesModal) samplesClose();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && samplesModal?.classList.contains('is-open')) samplesClose();
  });

  rerenderUI();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount);
} else {
  mount();
}
