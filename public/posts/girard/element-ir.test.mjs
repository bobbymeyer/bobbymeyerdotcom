// Headless A/B for the element-ir spike. Transcribes girard's legacy
// per-cell drawing verbatim (shapeNode 'flower', the h-stripes preset,
// drawArcSplit) and asserts the IR interpreter produces identical SVG
// for the same inputs. Also writes element-ir-proof.svg for eyeballing.
//
//   node element-ir.test.mjs
//
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// element-ir.js is a plain browser <script> that attaches to the global
// (girard loads it that way). Import it for side-effect, then read it off
// globalThis — there is no ESM export surface to depend on.
await import('./element-ir.js');
const IR = globalThis.GirardElementIR;
const here = dirname(fileURLToPath(import.meta.url));

// Node factory + colour resolver injected into the interpreter. Nodes
// support appendChild so container ops (mirror / boolean) can nest.
const el = (tag, attrs) => ({
  tag, attrs: attrs || {}, children: [],
  appendChild(n) { this.children.push(n); return n; },
});
const PAL = ['#d24a45', '#2c7fb8', '#f2b933', '#3f7a8c', '#7d9a40', '#8a5fb0'];
const NAMED = { ground: '#e7e2d6', wedge: '#d24a45', center: '#ffffff' };
const color = (ref, ctx) => {
  if (ref == null) return null;
  if (typeof ref === 'string') return NAMED[ref] != null ? NAMED[ref] : ref;
  if (ref.cycle) return PAL[0];
  if (ref.band) return PAL[(ctx.band || 0) % PAL.length];
  if (ref.p != null) return PAL[ref.p % PAL.length];
  return null;
};
const env = { el, color };

// ---- legacy reference draws (verbatim from girard.js) ----------------

function legacyFlower(cx, cy, w, h, fill) {
  const dim = Math.min(w, h) * 0.6;                 // shape.size default 0.6
  const n = 16, R = dim * 0.34, pr = dim * 0.105;
  const out = [el('circle', { cx, cy, r: R, fill })];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    out.push(el('circle', { cx: cx + Math.cos(a) * R, cy: cy + Math.sin(a) * R, r: pr, fill }));
  }
  return out;
}

function legacyStripes(x, y, w, h) {
  const n = 6, out = [];
  for (let i = 0; i < n; i++) {
    const bh = h / n;
    out.push(el('rect', { x, y: y + i * bh, width: w, height: bh, fill: PAL[i % PAL.length] }));
  }
  return out;
}

function legacyTriangle(cx, cy, w, h) {
  const r = Math.min(w, h) * 0.6 / 2;
  return [el('polygon', { points: `${cx},${cy - r} ${cx + r * 0.866},${cy + r * 0.5} ${cx - r * 0.866},${cy + r * 0.5}`, fill: PAL[0] })];
}
function legacySquare(cx, cy, w, h) {
  const dim = Math.min(w, h) * 0.6;
  return [el('rect', { x: cx - dim / 2, y: cy - dim / 2, width: dim, height: dim, fill: PAL[0] })];
}
function legacyStar(cx, cy, w, h) {
  const np = 5, depth = 0.5, R = Math.min(w, h) * 0.6 / 2, r = R * depth, out = [];
  const v = [];
  for (let i = 0; i < np * 2; i++) {
    const a = (Math.PI * 2 * i) / (np * 2) - Math.PI / 2;
    const rr = i % 2 === 0 ? R : r;
    v.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  out.push(el('polygon', { points: v.join(' '), fill: PAL[0] }));
  return out;
}
function legacyDiamond(cx, cy, w, h) {
  const rings = 3, hw = w / 2, hh = h / 2, out = [];
  for (let k = 0; k < rings; k++) {
    const f = 1 - k / rings, wq = hw * f, hq = hh * f;
    out.push(el('polygon', {
      points: `${(cx).toFixed(2)},${(cy - hq).toFixed(2)} ${(cx + wq).toFixed(2)},${(cy).toFixed(2)} ${(cx).toFixed(2)},${(cy + hq).toFixed(2)} ${(cx - wq).toFixed(2)},${(cy).toFixed(2)}`,
      fill: PAL[k % PAL.length],
    }));
  }
  return out;
}
function legacyQuatrefoil(cx, cy, w, h) {
  const dim = Math.min(w, h) * 0.6, r = dim / 4, off = dim / 4, out = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
    out.push(el('circle', { cx: cx + sx * off, cy: cy + sy * off, r, fill: PAL[0] }));
  out.push(el('circle', { cx, cy, r, fill: PAL[0] }));
  return out;
}

function legacyBlossom(cx, cy, w, h) {
  const dim = Math.min(w, h) * 0.6, n = 5, ringR = dim * 0.3, petalR = dim * 0.26, out = [];
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.PI * 2 * i) / n;
    out.push(el('circle', { cx: cx + Math.cos(a) * ringR, cy: cy + Math.sin(a) * ringR, r: petalR, fill: PAL[0] }));
  }
  out.push(el('circle', { cx, cy, r: dim * 0.13, fill: '#ffffff' }));
  return out;
}
function legacyOnion(cx, cy, w, h) {
  const hy = Math.min(w, h) * 0.6 / 2, hx = hy, cyy = hy * 0.62;
  return [el('path', { d: `M ${cx},${cy - hy} C ${cx + hx},${cy - cyy} ${cx + hx},${cy + cyy} ${cx},${cy + hy} C ${cx - hx},${cy + cyy} ${cx - hx},${cy - cyy} ${cx},${cy - hy} Z`, fill: PAL[0] })];
}
function legacyLens(cx, cy, w, h) {
  const hy = Math.min(w, h) * 0.6 / 2, hx = hy * 0.5;
  return [el('path', { d: `M ${cx},${cy - hy} Q ${cx + hx},${cy} ${cx},${cy + hy} Q ${cx - hx},${cy} ${cx},${cy - hy} Z`, fill: PAL[0] })];
}

function legacyArcSplit(x, y, w, h, colorWedge, colorGround, corner) {
  const out = [];
  if (!(colorGround == null || colorGround === 'transparent' || colorGround === 'none'))
    out.push(el('rect', { x, y, width: w, height: h, fill: colorGround }));
  if (colorWedge == null || colorWedge === 'transparent' || colorWedge === 'none') return out;
  const r = Math.min(w, h);
  let d;
  switch (((corner % 4) + 4) % 4) {
    case 0: d = `M${x},${y} L${x + r},${y} A${r},${r} 0 0,1 ${x},${y + r} Z`; break;
    case 1: d = `M${x + w},${y} L${x + w},${y + r} A${r},${r} 0 0,1 ${x + w - r},${y} Z`; break;
    case 2: d = `M${x + w},${y + h} L${x + w - r},${y + h} A${r},${r} 0 0,1 ${x + w},${y + h - r} Z`; break;
    case 3: d = `M${x},${y + h} L${x},${y + h - r} A${r},${r} 0 0,1 ${x + r},${y + h} Z`; break;
  }
  out.push(el('path', { d, fill: colorWedge }));
  return out;
}

// ---- comparison ------------------------------------------------------

// Normalise every numeric token inside an attribute value, so geometry
// is compared rather than formatting ("50" === "50.00", and coordinate
// lists in points/d round consistently).
const normNums = (v) => String(v).replace(/-?\d*\.?\d+(?:e-?\d+)?/g,
  (m) => String(Math.round(Number(m) * 1000) / 1000));
const canon = (node) => {
  const a = node.attrs || {};
  // cx/cy/x/y default to 0 on both sides, so an absent attr (legacy) and
  // an explicit 0 (IR) compare equal.
  const keys = Array.from(new Set(['cx', 'cy', 'x', 'y', ...Object.keys(a)])).sort();
  return node.tag + '|' + keys.map((k) => `${k}=${k in a ? normNums(a[k]) : 0}`).join(';');
};
const same = (A, B) => A.length === B.length && A.every((n, i) => canon(n) === canon(B[i]));

const REGION = { x: 0, y: 0, w: 100, h: 100 };
const C = 50;   // cell centre for the shape motifs

// compare:'byte'   -> IR output must equal the legacy draw node-for-node
// compare:'render' -> primitive differs (rect vs poly, clip vs path) so
//                     we only assert it produces geometry; the proof SVG
//                     carries the visual A/B.
const cases = [
  { name: 'flower      (motif: disc + repeat:radial)', compare: 'byte',
    legacy: legacyFlower(C, C, 100, 100, PAL[0]), ir: IR.render(IR.DEMOS.flower, REGION, env) },
  { name: 'stripes     (split: split:y + rect/band)', compare: 'byte',
    legacy: legacyStripes(0, 0, 100, 100), ir: IR.render(IR.DEMOS.stripes, REGION, env) },
  { name: 'arc-split   (divide: rect + wedge)', compare: 'byte',
    legacy: legacyArcSplit(0, 0, 100, 100, NAMED.wedge, NAMED.ground, 1), ir: IR.render(IR.DEMOS.arcSplit, REGION, env) },

  // ---- shape sub-family (shapeNode arms re-authored on poly/disc/...) ----
  { name: 'triangle    (poly:3)', compare: 'byte',
    legacy: legacyTriangle(C, C, 100, 100), ir: IR.render(IR.SHAPES.triangle, REGION, env) },
  { name: 'star        (poly:5 depth)', compare: 'byte',
    legacy: legacyStar(C, C, 100, 100), ir: IR.render(IR.SHAPES.star, REGION, env) },
  { name: 'diamond     (nest poly:4)', compare: 'byte',
    legacy: legacyDiamond(C, C, 100, 100), ir: IR.render(IR.SHAPES.diamond, REGION, env) },
  { name: 'quatrefoil  (group of discs)', compare: 'byte',
    legacy: legacyQuatrefoil(C, C, 100, 100), ir: IR.render(IR.SHAPES.quatrefoil, REGION, env) },
  { name: 'blossom     (repeat:radial + centre)', compare: 'byte',
    legacy: legacyBlossom(C, C, 100, 100), ir: IR.render(IR.SHAPES.blossom, REGION, env) },
  { name: 'square      (poly:4 rot45 -> polygon vs rect)', compare: 'render',
    legacy: legacySquare(C, C, 100, 100), ir: IR.render(IR.SHAPES.square, REGION, env) },
  { name: 'onion       (path: cubic curve)', compare: 'render',
    legacy: legacyOnion(C, C, 100, 100), ir: IR.render(IR.SHAPES.onion, REGION, env) },
  { name: 'lens        (path: quadratic vesica)', compare: 'render',
    legacy: legacyLens(C, C, 100, 100), ir: IR.render(IR.SHAPES.lens, REGION, env) },
  { name: 'pentagon    (poly:5 — new)', compare: 'render',
    legacy: [], ir: IR.render(IR.SHAPES.pentagon, REGION, env) },
  { name: 'hexagon     (poly:6 — new)', compare: 'render',
    legacy: [], ir: IR.render(IR.SHAPES.hexagon, REGION, env) },
  { name: 'vesica      (boolean: disc ∩ disc)', compare: 'render',
    legacy: [], ir: IR.render(IR.SHAPES.vesica, REGION, env) },
];

let allPass = true;
console.log('\nelement-ir spike — IR vs legacy girard draw\n');
for (const c of cases) {
  const ok = c.compare === 'byte' ? same(c.legacy, c.ir) : c.ir.length > 0;
  allPass = allPass && ok;
  const tag = c.compare === 'byte' ? (ok ? 'PASS' : 'FAIL') : (ok ? 'DRAW' : 'EMPTY');
  console.log(`  ${tag}  ${c.name}   (${c.ir.length} nodes)`);
  if (c.compare === 'byte' && !ok) {
    console.log('    legacy:', c.legacy.map(canon).join('\n            '));
    console.log('    ir:    ', c.ir.map(canon).join('\n            '));
  }
}

// ---- proof SVG -------------------------------------------------------

const toMarkup = (nodes) => nodes.map((n) => {
  const a = Object.entries(n.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
  if (n.children && n.children.length) return `<${n.tag} ${a}>${toMarkup(n.children)}</${n.tag}>`;
  return `<${n.tag} ${a}/>`;
}).join('');
const cell = (nodes, tx, ty, label) =>
  `<g transform="translate(${tx},${ty})">` +
  `<rect x="0" y="0" width="100" height="100" fill="none" stroke="#cccccc" stroke-dasharray="3 3"/>` +
  toMarkup(nodes) +
  `<text x="0" y="118" font-family="sans-serif" font-size="9" fill="#333">${label}</text></g>`;

let body = '';
let ty = 20;
for (const c of cases) {
  const verdict = c.compare === 'byte' ? (same(c.legacy, c.ir) ? 'identical' : 'DIFFERS')
                : (c.ir.length ? 'visual A/B' : 'EMPTY');
  body += `<text x="20" y="${ty - 6}" font-family="sans-serif" font-size="11" fill="#111">${c.name.trim()} — ${verdict}</text>`;
  body += cell(c.legacy, 20, ty, c.legacy.length ? 'legacy girard' : '(no legacy)');
  body += cell(c.ir, 170, ty, 'element-ir');
  ty += 160;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="${ty}" viewBox="0 0 320 ${ty}">` +
  `<rect width="320" height="${ty}" fill="#ffffff"/>${body}</svg>`;
const outPath = join(here, 'element-ir-proof.svg');
writeFileSync(outPath, svg);
console.log(`\n  proof SVG -> ${outPath}\n`);

process.exit(allPass ? 0 : 1);
