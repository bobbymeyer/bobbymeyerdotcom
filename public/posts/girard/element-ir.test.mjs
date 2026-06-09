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

// Node factory + colour resolver injected into the interpreter.
const el = (tag, attrs) => ({ tag, attrs });
const PAL = ['#d24a45', '#2c7fb8', '#f2b933', '#3f7a8c', '#7d9a40', '#8a5fb0'];
const NAMED = { ground: '#e7e2d6', wedge: '#d24a45' };
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

const round = (v) => {
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  const n = Number(v);
  return Number.isFinite(n) && String(v).trim() !== '' ? Math.round(n * 1000) / 1000 : v;
};
const canon = (node) => {
  const a = node.attrs || {};
  const keys = Object.keys(a).sort();
  return node.tag + '|' + keys.map((k) => `${k}=${round(a[k])}`).join(';');
};
const same = (A, B) => A.length === B.length && A.every((n, i) => canon(n) === canon(B[i]));

const REGION = { x: 0, y: 0, w: 100, h: 100 };
const cases = [
  {
    name: 'flower  (motif: disc + repeat:radial)',
    legacy: legacyFlower(50, 50, 100, 100, PAL[0]),
    ir: IR.render(IR.DEMOS.flower, REGION, env),
  },
  {
    name: 'stripes (split: split:y + rect/band)',
    legacy: legacyStripes(0, 0, 100, 100),
    ir: IR.render(IR.DEMOS.stripes, REGION, env),
  },
  {
    name: 'arc-split (divide: rect + wedge)',
    legacy: legacyArcSplit(0, 0, 100, 100, NAMED.wedge, NAMED.ground, 1),
    ir: IR.render(IR.DEMOS.arcSplit, REGION, env),
  },
];

let allPass = true;
console.log('\nelement-ir spike — IR vs legacy girard draw\n');
for (const c of cases) {
  const ok = same(c.legacy, c.ir);
  allPass = allPass && ok;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${c.name}   (${c.ir.length} nodes)`);
  if (!ok) {
    console.log('    legacy:', c.legacy.map(canon).join('\n            '));
    console.log('    ir:    ', c.ir.map(canon).join('\n            '));
  }
}

// ---- proof SVG -------------------------------------------------------

const toMarkup = (nodes) => nodes.map((n) => {
  const a = Object.entries(n.attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
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
  body += `<text x="20" y="${ty - 6}" font-family="sans-serif" font-size="11" fill="#111">${c.name} — ${same(c.legacy, c.ir) ? 'PASS' : 'FAIL'}</text>`;
  body += cell(c.legacy, 20, ty, 'legacy girard');
  body += cell(c.ir, 170, ty, 'element-ir');
  ty += 160;
}
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="${ty}" viewBox="0 0 320 ${ty}">` +
  `<rect width="320" height="${ty}" fill="#ffffff"/>${body}</svg>`;
const outPath = join(here, 'element-ir-proof.svg');
writeFileSync(outPath, svg);
console.log(`\n  proof SVG -> ${outPath}\n`);

process.exit(allPass ? 0 : 1);
