// element-ir — a tiny shape-grammar interpreter for girard.
//
// SPIKE (see element-ir-demo.html). girard's per-cell fills are ~40
// hand-written `case` arms, and the shape sub-fill is ~25 more. Most of
// them are the same few operations with different parameters. This
// interpreter is a proof that distinct families collapse into one small
// set of composable ops. Three representatives are reproduced from a
// single evaluator:
//
//   motif    (flower)     -> disc + repeat:radial
//   split    (stripes)    -> split:y + rect-per-band   (== h/v-stripes, brick)
//   divide   (arc-split)  -> rect ground + wedge
//
// The interpreter is framework-free: the caller injects an `el(tag,
// attrs)` factory and a `color(ref, ctx)` resolver. That way the exact
// same code runs in the standalone demo AND (later) inside girard's
// render pipeline, where `el` already remaps fills to the active
// colourway and `color` already knows the palette / cycle index. The IR
// never sees a hex unless it's literal — colours stay symbolic
// (`{cycle:true}`, `{p:i}`, `{band:true}`, or a named slot) so the host
// stays in charge of palette behaviour.
//
// An IR document is a tree of `{ op, ...params, child|children }`. Two
// idioms share the tree: motif ops (disc/poly/repeat) size off a `unit`
// (min cell dim x `size`, mirroring shapeNode's `shape.size`); region
// ops (rect/split/wedge) act on the sub-rect directly. `split` recurses,
// so the grammar is genuinely nested, not a flat list.

(function (root) {
  'use strict';

  let _clipId = 0;   // unique ids for boolean()'s clipPaths

  // Build the evaluation context for a region. `size` (0..1) shrinks the
  // motif reference dimension the way shapeNode's `shape.size` does;
  // region ops ignore `unit` and use the rect. `base` carries the
  // injected el/color/rng plus any inherited index hints (band/idx).
  function ctxFor(region, size, base) {
    const { x, y, w, h } = region;
    return {
      x, y, w, h,
      cx: x + w / 2,
      cy: y + h / 2,
      unit: Math.min(w, h) * (size == null ? 1 : size),
      el: base.el,
      color: base.color,
      rng: base.rng,
      band: base.band,
      idx: base.idx,
    };
  }

  // Resolve a colour ref and skip the draw entirely when it reads as
  // empty — same sentinels girard uses for transparent palette slots.
  function paint(ctx, ref, build) {
    const c = ctx.color ? ctx.color(ref, ctx) : ref;
    if (c == null || c === 'transparent' || c === 'none') return null;
    return build(c);
  }

  const OPS = {
    group(node, ctx, out) {
      for (const child of node.children || []) render(child, ctx, out);
    },

    // Fill the (optionally inset) region rect.
    rect(node, ctx, out) {
      const inset = node.inset || 0;
      const ix = ctx.x + ctx.w * inset, iy = ctx.y + ctx.h * inset;
      const iw = ctx.w * (1 - 2 * inset), ih = ctx.h * (1 - 2 * inset);
      const node2 = paint(ctx, node.fill, (c) =>
        ctx.el('rect', { x: ix, y: iy, width: iw, height: ih, fill: c }));
      if (node2) out.push(node2);
    },

    // Circle centred in the region (with optional unit-relative offset).
    disc(node, ctx, out) {
      const r = (node.r == null ? 0.5 : node.r) * ctx.unit;
      const cx = ctx.cx + (node.dx || 0) * ctx.unit;
      const cy = ctx.cy + (node.dy || 0) * ctx.unit;
      const node2 = paint(ctx, node.fill, (c) =>
        ctx.el('circle', { cx, cy, r, fill: c }));
      if (node2) out.push(node2);
    },

    // Regular polygon or star. depth === 1 -> regular n-gon; depth < 1
    // alternates an inner radius to make a star. This is the bloomPolygon
    // generalisation that already subsumes circle/triangle/square/star.
    poly(node, ctx, out) {
      const sides = Math.max(3, node.sides | 0 || 3);
      const depth = node.depth == null ? 1 : node.depth;
      const R = (node.r == null ? 0.5 : node.r) * ctx.unit;
      const rot = ((node.rotate || 0) * Math.PI) / 180 - Math.PI / 2;
      const n = depth < 1 ? sides * 2 : sides;
      const jitter = node.jitter || 0;        // star vertex wobble
      const pts = [];
      for (let i = 0; i < n; i++) {
        const a = rot + (Math.PI * 2 * i) / n;
        let rr = (depth < 1 && i % 2) ? R * depth : R;
        if (jitter > 0 && ctx.rng) rr += (ctx.rng() * 2 - 1) * jitter * R;
        pts.push(`${(ctx.cx + Math.cos(a) * rr).toFixed(2)},${(ctx.cy + Math.sin(a) * rr).toFixed(2)}`);
      }
      const node2 = paint(ctx, node.fill, (c) =>
        ctx.el('polygon', { points: pts.join(' '), fill: c }));
      if (node2) out.push(node2);
    },

    // Quarter-circle wedge at a cell corner (0=TL,1=TR,2=BR,3=BL). The
    // path is identical to girard's drawArcSplit so output is
    // byte-for-byte comparable.
    wedge(node, ctx, out) {
      const { x, y, w, h } = ctx;
      const r = (node.r == null ? 1 : node.r) * Math.min(w, h);
      const corner = (((node.corner | 0) % 4) + 4) % 4;
      let d;
      switch (corner) {
        case 0: d = `M${x},${y} L${x + r},${y} A${r},${r} 0 0,1 ${x},${y + r} Z`; break;
        case 1: d = `M${x + w},${y} L${x + w},${y + r} A${r},${r} 0 0,1 ${x + w - r},${y} Z`; break;
        case 2: d = `M${x + w},${y + h} L${x + w - r},${y + h} A${r},${r} 0 0,1 ${x + w},${y + h - r} Z`; break;
        case 3: d = `M${x},${y + h} L${x},${y + h - r} A${r},${r} 0 0,1 ${x + r},${y + h} Z`; break;
      }
      const node2 = paint(ctx, node.fill, (c) => ctx.el('path', { d, fill: c }));
      if (node2) out.push(node2);
    },

    // CGA-style subdivision: cut the region into `count` equal bands
    // along an axis and recurse a child into each (a single child
    // repeats; an array cycles). The band index rides in ctx as `band`
    // so a child's colour ref can read it. This one op is the
    // generalisation of the h-stripes / v-stripes / brick presets.
    split(node, ctx, out) {
      const count = Math.max(1, node.count | 0 || 1);
      const axis = node.axis === 'x' ? 'x' : 'y';
      const offset = node.offset || 0;   // brick: shift alternate bands
      const kids = Array.isArray(node.children) ? node.children
                 : (node.child ? [node.child] : []);
      if (!kids.length) return;
      for (let i = 0; i < count; i++) {
        let sub;
        if (axis === 'y') {
          const bh = ctx.h / count;
          const shift = (i % 2 ? offset : 0) * ctx.w;
          sub = { x: ctx.x + shift, y: ctx.y + i * bh, w: ctx.w, h: bh };
        } else {
          const bw = ctx.w / count;
          const shift = (i % 2 ? offset : 0) * ctx.h;
          sub = { x: ctx.x + i * bw, y: ctx.y + shift, w: bw, h: ctx.h };
        }
        const cctx = ctxFor(sub, node.size, ctx);
        cctx.band = i;
        cctx.idx = i;
        render(kids[i % kids.length], cctx, out);
      }
    },

    // Radial repeat: place `child` at `count` points on a circle of
    // `radius` (x unit) around the centre. The petal-ring half of the
    // flower motif. Children keep the parent `unit` so their geometry
    // sizes off the same dim; only the centre moves.
    repeat(node, ctx, out) {
      const count = Math.max(1, node.count | 0 || 1);
      const R = (node.radius == null ? 0.34 : node.radius) * ctx.unit;
      const phase = node.phase || 0;
      for (let i = 0; i < count; i++) {
        const a = phase + (Math.PI * 2 * i) / count;
        const cctx = Object.assign({}, ctx, {
          cx: ctx.cx + Math.cos(a) * R,
          cy: ctx.cy + Math.sin(a) * R,
          idx: i,
        });
        render(node.child, cctx, out);
      }
    },

    // Concentric copies of a child at shrinking unit, the ring index
    // riding in ctx as band/idx for palette cycling. Reproduces the
    // nested-rhombi 'diamond' (and any onion/target motif).
    nest(node, ctx, out) {
      const count = Math.max(1, node.count | 0 || 1);
      for (let k = 0; k < count; k++) {
        const f = 1 - k / count;            // outer -> inner
        const cctx = Object.assign({}, ctx, { unit: ctx.unit * f, band: k, idx: k });
        render(node.child, cctx, out);
      }
    },

    // Reflect children through the region centre. axis 'x' mirrors
    // left<->right, 'y' top<->bottom, 'xy' is a point reflection. The
    // originals are kept; reflected copies are re-rendered into a
    // transformed group (no node cloning, so it stays renderer-agnostic).
    mirror(node, ctx, out) {
      const kids = node.children || (node.child ? [node.child] : []);
      for (const c of kids) render(c, ctx, out);
      const sign = node.axis === 'y' ? [1, -1] : node.axis === 'xy' ? [-1, -1] : [-1, 1];
      const g = ctx.el('g', {
        transform: `translate(${ctx.cx} ${ctx.cy}) scale(${sign[0]} ${sign[1]}) translate(${-ctx.cx} ${-ctx.cy})`,
      });
      const refl = [];
      for (const c of kids) render(c, ctx, refl);
      for (const node2 of refl) g.appendChild(node2);
      out.push(g);
    },

    // Intersect: paint `child` only where it overlaps `clip`. A
    // vesica / lens is just two discs intersected. Emits an SVG clipPath
    // (resolved by id), so the host must keep the emitted node in the
    // tree alongside the clipped group.
    boolean(node, ctx, out) {
      const id = 'ir-clip-' + (++_clipId);
      const clipNodes = [];
      render(node.clip, ctx, clipNodes);
      const cp = ctx.el('clipPath', { id });
      for (const node2 of clipNodes) cp.appendChild(node2);
      out.push(cp);
      const childNodes = [];
      render(node.child, ctx, childNodes);
      const g = ctx.el('g', { 'clip-path': `url(#${id})` });
      for (const node2 of childNodes) g.appendChild(node2);
      out.push(g);
    },
  };

  function render(node, ctx, out) {
    if (!node) return;
    const op = OPS[node.op];
    if (op) op(node, ctx, out);
  }

  // Public entry. Returns an array of nodes built via env.el; the host
  // appends them wherever it likes (a <g>, the cell, etc.).
  function renderDoc(doc, region, env) {
    const out = [];
    render(doc, ctxFor(region, doc && doc.size, env), out);
    return out;
  }

  // The three spike documents. Defaults chosen to match girard's
  // existing generators exactly (see element-ir-demo.html for the A/B).
  const DEMOS = {
    // shapeNode 'flower': central disc r=dim*0.34, ring of 16 bump discs
    // r=dim*0.105 at radius dim*0.34, all the cell colour. dim = min*0.6.
    flower: {
      op: 'group', size: 0.6, children: [
        { op: 'disc', r: 0.34, fill: { cycle: true } },
        { op: 'repeat', count: 16, radius: 0.34, child: { op: 'disc', r: 0.105, fill: { cycle: true } } },
      ],
    },

    // h-stripes / brick preset, expressed in-cell: 6 horizontal bands,
    // each band painted from the palette by its index. offset>0 + the
    // brick look (shift alternate bands).
    stripes: {
      op: 'split', axis: 'y', count: 6,
      child: { op: 'rect', fill: { band: true } },
    },

    // drawArcSplit: solid ground rect + a quarter-circle wedge at a
    // corner. corner is supplied by the host per cell (here fixed for
    // the A/B).
    arcSplit: {
      op: 'group', children: [
        { op: 'rect', fill: 'ground' },
        { op: 'wedge', corner: 1, fill: 'wedge' },
      ],
    },
  };

  // shapeNode's per-shape switch, re-authored in the grammar. This is
  // the bulk of the reduction: ~25 bespoke arms collapse onto poly /
  // disc / nest / boolean / group. `size` matches shapeNode's cell
  // fraction so output lines up with the legacy shapes (0.6 for the
  // centred motifs; diamond fills the cell like its 1.0 default).
  const SHAPES = {
    triangle:   { op: 'poly', size: 0.6, sides: 3, r: 0.5, fill: { cycle: true } },
    square:     { op: 'poly', size: 0.6, sides: 4, rotate: 45, r: Math.SQRT1_2, fill: { cycle: true } },
    pentagon:   { op: 'poly', size: 0.6, sides: 5, r: 0.5, fill: { cycle: true } },
    hexagon:    { op: 'poly', size: 0.6, sides: 6, rotate: 30, r: 0.5, fill: { cycle: true } },
    star:       { op: 'poly', size: 0.6, sides: 5, depth: 0.5, r: 0.5, fill: { cycle: true } },
    diamond:    { op: 'nest', size: 1, count: 3, child: { op: 'poly', sides: 4, r: 0.5, fill: { band: true } } },
    quatrefoil: { op: 'group', size: 0.6, children: [
      { op: 'disc', r: 0.25, dx: -0.25, dy: -0.25, fill: { cycle: true } },
      { op: 'disc', r: 0.25, dx:  0.25, dy: -0.25, fill: { cycle: true } },
      { op: 'disc', r: 0.25, dx: -0.25, dy:  0.25, fill: { cycle: true } },
      { op: 'disc', r: 0.25, dx:  0.25, dy:  0.25, fill: { cycle: true } },
      { op: 'disc', r: 0.25, fill: { cycle: true } },
    ] },
    // Vesica: the visible overlap of two discs offset along x.
    lens:       { op: 'boolean', size: 0.6,
      clip:  { op: 'disc', r: 0.5, dx: -0.32, fill: '#000' },
      child: { op: 'disc', r: 0.5, dx:  0.32, fill: { cycle: true } },
    },
  };

  // Build an IR document from a live shapeNode `shape` spec, honouring
  // its size / params. Returns null for shapes not yet ported (the
  // caller then falls back to its legacy arm). The single resolved cell
  // colour flows in via the {cycle} ref; stroke is applied by the caller
  // on a wrapping group, so these docs stay fill-only.
  function shapeToElement(shape) {
    if (!shape) return null;
    const size = shape.size == null ? 0.6 : shape.size;
    switch (shape.kind) {
      case 'circle':
        return { op: 'disc', size, r: 0.5, fill: { cycle: true } };
      case 'triangle':
        return { op: 'poly', size, sides: 3, r: 0.5, fill: { cycle: true } };
      case 'square':
        // circumradius (√2/2)·dim puts the corners at ±dim/2 → a side-dim
        // square once the intrinsic 45° rotation is applied.
        return { op: 'poly', size, sides: 4, rotate: 45, r: Math.SQRT1_2, fill: { cycle: true } };
      case 'star':
        return {
          op: 'poly', size, r: 0.5, fill: { cycle: true },
          sides: Math.max(3, shape.numPoints | 0 || 5),
          depth: Math.max(0.05, Math.min(1, shape.depth == null ? 0.5 : shape.depth)),
          jitter: Math.max(0, Math.min(1, shape.jitter || 0)),
        };
      case 'quatrefoil': {
        const cs = shape.center == null ? 1 : shape.center;
        const children = [
          { op: 'disc', r: 0.25, dx: -0.25, dy: -0.25, fill: { cycle: true } },
          { op: 'disc', r: 0.25, dx:  0.25, dy: -0.25, fill: { cycle: true } },
          { op: 'disc', r: 0.25, dx: -0.25, dy:  0.25, fill: { cycle: true } },
          { op: 'disc', r: 0.25, dx:  0.25, dy:  0.25, fill: { cycle: true } },
        ];
        if (cs > 0) children.push({ op: 'disc', r: 0.25 * cs, fill: { cycle: true } });
        return { op: 'group', size, children };
      }
      default:
        return null;
    }
  }

  const api = { render: renderDoc, shapeToElement, DEMOS, SHAPES, OPS: Object.keys(OPS) };
  root.GirardElementIR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
