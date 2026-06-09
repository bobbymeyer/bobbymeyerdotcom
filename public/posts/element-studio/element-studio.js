// element studio — a visual editor for girard's element-ir documents.
//
// girard's per-cell motifs collapse onto a small shape-grammar IR
// (see ../girard/element-ir.js). This page authors those documents as
// *data*: an op-tree editor on the left, a live tiling preview on the
// right. The same `GirardElementIR.render` that paints girard's cells
// paints the preview here, so what you see is what girard draws.
//
// Output is a plain element-ir JSON document. Author it, save it to your
// browser library (localStorage), export it as .json, or load one of the
// committed presets. girard imports the exported docs as `element` fills.
//
// Framework-free, no build step — a plain global script loaded by the
// post page, mirroring girard's setup.

(function () {
  'use strict';

  const ROOT = document.getElementById('element-studio');
  if (!ROOT) return;

  const SVG = 'http://www.w3.org/2000/svg';

  // --- tiny DOM helpers -------------------------------------------------
  // svg(): namespaced node factory injected into the interpreter.
  const svg = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };
  // h(): HTML element builder for the UI chrome.
  const h = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) {
      if (kid == null) continue;
      n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    }
    return n;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const mod = (a, n) => ((a % n) + n) % n;

  // Deterministic per-cell RNG so jitter / rand are stable across repaints
  // (mulberry32). Re-seed via the preview's "re-seed" button.
  function rngFor(seed) {
    let t = seed >>> 0;
    return function () {
      t += 0x6D2B79F5;
      let x = Math.imul(t ^ (t >>> 15), 1 | t);
      x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
      return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------------------------------------------------------------------
  // Op metadata. Drives the param forms and the tree's add menu. Each op
  // lists its editable params; `container` says how it nests children.
  //   'children' -> children[]   (group, split, mirror)
  //   'child'    -> child         (repeat, nest)
  //   'boolean'  -> clip + child  (boolean)
  //   null       -> a leaf draw
  // `size` is handled separately (root + split/nest only — see below).
  // ---------------------------------------------------------------------
  const NUM = (key, label, def, opt) => Object.assign({ key, label, kind: 'num', def, step: 0.05 }, opt);
  const INT = (key, label, def, opt) => Object.assign({ key, label, kind: 'int', def, step: 1 }, opt);

  const OP_META = {
    group:  { container: 'children', params: [] },
    rect:   { container: null, params: [{ key: 'fill', label: 'fill', kind: 'colorRef' }, NUM('inset', 'inset', 0, { min: 0, max: 0.5 })] },
    disc:   { container: null, params: [{ key: 'fill', label: 'fill', kind: 'colorRef' }, NUM('r', 'radius', 0.3), NUM('dx', 'offset x', 0), NUM('dy', 'offset y', 0)] },
    poly:   { container: null, params: [
      { key: 'fill', label: 'fill', kind: 'colorRef' },
      INT('sides', 'sides', 5, { min: 3, max: 24 }),
      NUM('depth', 'depth (·<1 = star)', 1, { min: 0.05, max: 1 }),
      NUM('rotate', 'rotate°', 0, { step: 5 }),
      NUM('jitter', 'jitter', 0, { min: 0, max: 1 }),
      NUM('r', 'radius', 0.5),
      NUM('rx', 'radius x (aspect)', null),
      NUM('ry', 'radius y (aspect)', null),
    ] },
    path:   { container: null, params: [{ key: 'fill', label: 'fill', kind: 'colorRef' }, { key: 'segs', label: 'segments', kind: 'segs' }] },
    box:    { container: null, params: [
      { key: 'fill', label: 'fill', kind: 'colorRef' },
      NUM('w', 'width', 0.5), NUM('h', 'height', 0.5),
      NUM('dx', 'offset x', 0), NUM('dy', 'offset y', 0),
      NUM('rx', 'corner rx', null), NUM('ry', 'corner ry', null),
      NUM('rotate', 'rotate°', 0, { step: 5 }),
    ] },
    wedge:  { container: null, params: [
      { key: 'fill', label: 'fill', kind: 'colorRef' },
      { key: 'corner', label: 'corner', kind: 'select', def: 0, options: [['0', 'TL'], ['1', 'TR'], ['2', 'BR'], ['3', 'BL']], cast: Number },
      NUM('r', 'radius', 1, { min: 0, max: 1 }),
    ] },
    split:  { container: 'children', params: [
      { key: 'axis', label: 'axis', kind: 'select', def: 'y', options: [['y', 'y'], ['x', 'x']] },
      INT('count', 'count', 4, { min: 1, max: 64 }),
      NUM('offset', 'offset (brick)', 0, { min: 0, max: 1 }),
    ] },
    repeat: { container: 'child', params: [
      INT('count', 'count', 6, { min: 1, max: 64 }),
      NUM('radius', 'radius', 0.34),
      NUM('phase', 'phase (rad)', 0, { step: 0.1 }),
    ] },
    nest:   { container: 'child', params: [INT('count', 'count', 3, { min: 1, max: 32 })] },
    mirror: { container: 'children', params: [
      { key: 'axis', label: 'axis', kind: 'select', def: 'x', options: [['x', 'x ↔'], ['y', 'y ↕'], ['xy', 'xy ✶']] },
    ] },
    boolean: { container: 'boolean', params: [] },
  };
  const OP_LIST = Object.keys(OP_META);

  // A node may carry `size` (0..1, the unit scale) when it's the document
  // root or a split/nest band — those are the points where the interpreter
  // reads it (ctxFor). Showing it elsewhere would be a no-op.
  const takesSize = (node) => node === doc || node.op === 'split' || node.op === 'nest';

  // Build a fresh node with sensible defaults for an op.
  function newNode(op) {
    switch (op) {
      case 'group':  return { op: 'group', children: [] };
      case 'rect':   return { op: 'rect', fill: { cycle: true } };
      case 'disc':   return { op: 'disc', r: 0.3, fill: { cycle: true } };
      case 'poly':   return { op: 'poly', sides: 5, r: 0.5, fill: { cycle: true } };
      case 'path':   return { op: 'path', fill: { cycle: true }, segs: [['M', 0, -0.5], ['L', 0.5, 0.5], ['L', -0.5, 0.5], ['Z']] };
      case 'box':    return { op: 'box', w: 0.5, h: 0.5, fill: { cycle: true } };
      case 'wedge':  return { op: 'wedge', corner: 0, r: 1, fill: { cycle: true } };
      case 'split':  return { op: 'split', axis: 'y', count: 4, children: [{ op: 'rect', fill: { band: true } }] };
      case 'repeat': return { op: 'repeat', count: 6, radius: 0.34, child: { op: 'disc', r: 0.12, fill: { cycle: true } } };
      case 'nest':   return { op: 'nest', count: 3, child: { op: 'poly', sides: 4, rx: 1, ry: 1, fill: { band: true } } };
      case 'mirror': return { op: 'mirror', axis: 'x', children: [{ op: 'disc', r: 0.22, dx: 0.32, fill: { cycle: true } }] };
      case 'boolean': return { op: 'boolean', clip: { op: 'disc', r: 0.5, dx: -0.32, fill: '#000000' }, child: { op: 'disc', r: 0.5, dx: 0.32, fill: { cycle: true } } };
      default: return { op: 'group', children: [] };
    }
  }

  // The container slot(s) of a node, as { label, get, set } so the tree
  // can render and mutate uniformly.
  function slotsOf(node) {
    const c = OP_META[node.op]?.container;
    if (c === 'children') {
      if (!Array.isArray(node.children)) node.children = node.child ? [node.child] : [];
      delete node.child;
      return [{ key: 'children', list: true }];
    }
    if (c === 'child') return [{ key: 'child', list: false }];
    if (c === 'boolean') return [{ key: 'clip', list: false }, { key: 'child', list: false }];
    return [];
  }

  // ---------------------------------------------------------------------
  // Colour. The IR keeps colour symbolic; the host resolves. We mirror
  // girard's resolver so the preview matches: a literal hex draws as-is;
  // {cycle} walks the palette per cell (the colourway); {band}/{p} index
  // it; {rand} picks at random; {center} is a literal escape hatch.
  // ---------------------------------------------------------------------
  let palette = ['#d24a45', '#2c7fb8', '#f2b933', '#3f7a8c', '#7d9a40', '#8a5fb0'];
  const NAMED = { ground: '#e7e2d6', wedge: '#d24a45', center: '#ffffff' };

  // The interpreter's signature is color(ref, ctx). Build a resolver that
  // honours ctx.band for {band}-refs (used by split/nest cycling).
  function colorResolver(cellIndex, rng) {
    return (ref, ctx) => {
      if (ref == null) return null;
      if (typeof ref === 'string') return NAMED[ref] != null ? NAMED[ref] : ref;
      if (ref.cycle) return palette[mod(cellIndex, palette.length)];
      if (ref.rand) return palette[Math.floor(rng() * palette.length)];
      if (ref.band != null) return palette[mod((ctx && ctx.band) || 0, palette.length)];
      if (ref.p != null) return palette[mod(ref.p, palette.length)];
      if ('center' in ref) return ref.center;
      return null;
    };
  }

  // ---------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------
  const DEFAULT_DOC = {
    op: 'group', size: 0.6, children: [
      { op: 'disc', r: 0.34, fill: { cycle: true } },
      { op: 'repeat', count: 16, radius: 0.34, child: { op: 'disc', r: 0.105, fill: { cycle: true } } },
    ],
  };
  let doc = clone(DEFAULT_DOC);
  let selected = doc;
  let IR = null;           // window.GirardElementIR once loaded
  let preview = { cols: 4, rows: 4, aspect: 1, grid: true, seed: 1 };

  const LIB_KEY = 'element-studio:library';
  const loadLibrary = () => {
    try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch (_) { return []; }
  };
  const saveLibrary = (lib) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(lib)); } catch (_) {} };
  let library = loadLibrary();
  let presets = [];        // committed presets.json + interpreter DEMOS/SHAPES

  // ---------------------------------------------------------------------
  // Layout scaffold
  // ---------------------------------------------------------------------
  const elTree = h('div', { class: 'es-tree' });
  const elParams = h('div', { class: 'es-params' });
  const elJson = h('textarea', { class: 'es-json', spellcheck: 'false', rows: '10' });
  const elJsonMsg = h('div', { class: 'es-json-msg' });
  const elPreview = h('div', { class: 'es-preview' });
  const elPalette = h('div', { class: 'es-palette' });
  const elLibrary = h('div', { class: 'es-library' });
  const elPresetSel = h('select', { class: 'es-select' });

  function build() {
    clear(ROOT);

    const title = h('div', { class: 'es-titlebar' },
      h('h1', { class: 'es-title' }, 'element studio', h('sup', { class: 'es-version' }, 'v0.01a')),
      h('p', { class: 'es-subtitle' }, 'author girard pattern elements as data — edit the op-tree, watch it tile'),
    );

    const toolbar = h('div', { class: 'es-toolbar' },
      h('label', { class: 'es-tool-group' }, h('span', { class: 'es-tool-label' }, 'preset'), elPresetSel),
      h('button', { class: 'es-btn', onclick: () => loadDoc(clone(DEFAULT_DOC), 'flower') }, 'new'),
      h('button', { class: 'es-btn', onclick: importJSON }, 'import…'),
      h('button', { class: 'es-btn', onclick: exportJSON }, 'export'),
      h('button', { class: 'es-btn es-btn-accent', onclick: saveToLibrary }, 'save to library'),
    );
    elPresetSel.addEventListener('change', onPresetPick);

    const editorCol = h('div', { class: 'es-col es-col-editor' },
      h('h3', { class: 'es-panel-heading' }, 'op-tree'),
      h('div', { class: 'es-panel' }, elTree),
      h('h3', { class: 'es-panel-heading' }, 'parameters'),
      h('div', { class: 'es-panel' }, elParams),
      h('h3', { class: 'es-panel-heading' }, 'json source'),
      h('div', { class: 'es-panel' },
        elJson,
        h('div', { class: 'es-json-row' },
          h('button', { class: 'es-btn es-btn-sm', onclick: applyJSON }, 'apply json'),
          elJsonMsg,
        ),
      ),
    );

    const previewCol = h('div', { class: 'es-col es-col-preview' },
      h('h3', { class: 'es-panel-heading' }, 'preview'),
      buildPreviewControls(),
      h('div', { class: 'es-panel es-panel-stage' }, elPreview),
      h('h3', { class: 'es-panel-heading' }, 'palette'),
      h('div', { class: 'es-panel' }, elPalette),
      h('h3', { class: 'es-panel-heading' }, 'library'),
      h('div', { class: 'es-panel' }, elLibrary),
    );

    ROOT.appendChild(title);
    ROOT.appendChild(toolbar);
    ROOT.appendChild(h('div', { class: 'es-main' }, editorCol, previewCol));
  }

  function buildPreviewControls() {
    const numCtl = (label, key, min, max, step) => {
      const inp = h('input', {
        type: 'number', class: 'es-num', value: String(preview[key]),
        min: String(min), max: String(max), step: String(step || 1),
        oninput: (e) => { preview[key] = Number(e.target.value) || min; renderPreview(); },
      });
      return h('label', { class: 'es-ctl' }, h('span', {}, label), inp);
    };
    const gridToggle = h('label', { class: 'es-ctl es-ctl-check' },
      h('input', { type: 'checkbox', checked: preview.grid ? '' : null,
        onchange: (e) => { preview.grid = e.target.checked; renderPreview(); } }),
      h('span', {}, 'cell guides'));
    return h('div', { class: 'es-preview-controls' },
      numCtl('cols', 'cols', 1, 16, 1),
      numCtl('rows', 'rows', 1, 16, 1),
      numCtl('aspect', 'aspect', 0.25, 4, 0.05),
      gridToggle,
      h('button', { class: 'es-btn es-btn-sm', onclick: () => { preview.seed = (preview.seed + 1) | 0; renderPreview(); } }, 're-seed'),
    );
  }

  // ---------------------------------------------------------------------
  // Tree
  // ---------------------------------------------------------------------
  function renderTree() {
    clear(elTree);
    elTree.appendChild(nodeRow(doc, null, null, 0));
  }

  // One node and its descendants. `parentSlot` describes where this node
  // sits in its parent so delete / replace can mutate in place.
  function nodeRow(node, parent, slot, depth) {
    const wrap = h('div', { class: 'es-node', style: `--depth:${depth}` });
    const row = h('div', { class: 'es-node-row' + (node === selected ? ' es-node-sel' : '') });

    const sw = colorSwatch(node);
    const label = h('button', { class: 'es-node-label', onclick: () => selectNode(node) },
      sw, h('span', { class: 'es-node-op' }, node.op));
    row.appendChild(label);

    const acts = h('span', { class: 'es-node-acts' });
    if (parent) {
      acts.appendChild(h('button', { class: 'es-icon-btn', title: 'delete', onclick: () => deleteNode(parent, slot) }, '×'));
    }
    row.appendChild(acts);
    wrap.appendChild(row);

    // Children / slots.
    for (const s of slotsOf(node)) {
      const slotWrap = h('div', { class: 'es-slot', style: `--depth:${depth + 1}` });
      if (s.list) {
        const list = node[s.key] || [];
        for (let i = 0; i < list.length; i++) {
          slotWrap.appendChild(nodeRow(list[i], node, { key: s.key, index: i }, depth + 1));
        }
        slotWrap.appendChild(addMenu(node, { key: s.key, index: list.length }));
      } else {
        const childNode = node[s.key];
        const tag = h('div', { class: 'es-slot-tag' }, s.key);
        slotWrap.appendChild(tag);
        if (childNode) slotWrap.appendChild(nodeRow(childNode, node, { key: s.key }, depth + 1));
        else slotWrap.appendChild(addMenu(node, { key: s.key }));
      }
      wrap.appendChild(slotWrap);
    }
    return wrap;
  }

  // "+ add" control: a select of ops that inserts a new node into a slot.
  function addMenu(parent, slot) {
    const sel = h('select', { class: 'es-add', onchange: (e) => {
      const op = e.target.value;
      e.target.value = '';
      if (!op) return;
      const node = newNode(op);
      if (slot.index != null) {
        const list = parent[slot.key] || (parent[slot.key] = []);
        list.splice(slot.index, 0, node);
      } else {
        parent[slot.key] = node;
      }
      selectNode(node);
      refreshAll();
    } });
    sel.appendChild(h('option', { value: '' }, '+ add…'));
    for (const op of OP_LIST) sel.appendChild(h('option', { value: op }, op));
    return sel;
  }

  function deleteNode(parent, slot) {
    if (slot.index != null) {
      (parent[slot.key] || []).splice(slot.index, 1);
    } else {
      delete parent[slot.key];
    }
    selected = doc;
    refreshAll();
  }

  function selectNode(node) {
    selected = node;
    renderTree();
    renderParams();
  }

  // A small swatch summarising a node's fill ref (best-effort preview).
  function colorSwatch(node) {
    const ref = node.fill;
    let bg = 'transparent', cls = 'es-swatch';
    if (typeof ref === 'string') bg = NAMED[ref] != null ? NAMED[ref] : ref;
    else if (ref && ref.cycle) { bg = palette[0]; cls += ' es-swatch-cycle'; }
    else if (ref && ref.band != null) { bg = palette[0]; cls += ' es-swatch-cycle'; }
    else if (ref && ref.p != null) bg = palette[mod(ref.p, palette.length)];
    else if (ref && 'center' in ref) bg = ref.center;
    else if (ref && ref.rand) { bg = palette[0]; cls += ' es-swatch-cycle'; }
    else if (OP_META[node.op]?.container) cls += ' es-swatch-none';
    return h('span', { class: cls, style: `background:${bg}` });
  }

  // ---------------------------------------------------------------------
  // Parameter panel
  // ---------------------------------------------------------------------
  function renderParams() {
    clear(elParams);
    const node = selected;
    if (!node) { elParams.appendChild(h('div', { class: 'es-muted' }, 'select a node')); return; }

    // Op switcher.
    const opSel = h('select', { class: 'es-select', onchange: (e) => changeOp(node, e.target.value) });
    for (const op of OP_LIST) {
      const o = h('option', { value: op }, op);
      if (op === node.op) o.setAttribute('selected', '');
      opSel.appendChild(o);
    }
    elParams.appendChild(h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, 'op'), opSel));

    if (takesSize(node)) elParams.appendChild(numField(node, { key: 'size', label: 'size (unit)', kind: 'num', def: 0.6, min: 0.05, max: 1 }));

    for (const p of OP_META[node.op]?.params || []) {
      if (p.kind === 'colorRef') elParams.appendChild(colorRefField(node, p));
      else if (p.kind === 'select') elParams.appendChild(selectField(node, p));
      else if (p.kind === 'segs') elParams.appendChild(segsField(node, p));
      else elParams.appendChild(numField(node, p));
    }
  }

  function changeOp(node, op) {
    if (op === node.op) return;
    // Preserve children where both old and new ops are list-containers.
    const keepChildren = OP_META[node.op]?.container === 'children' && OP_META[op]?.container === 'children' ? node.children : null;
    for (const k of Object.keys(node)) delete node[k];
    Object.assign(node, newNode(op));
    if (keepChildren) node.children = keepChildren;
    refreshAll();
    renderParams();
  }

  function numField(node, p) {
    const has = node[p.key] != null;
    const inp = h('input', {
      type: 'number', class: 'es-num', step: String(p.step ?? 0.05),
      value: has ? String(node[p.key]) : '',
      placeholder: p.def == null ? '—' : String(p.def),
      min: p.min != null ? String(p.min) : null,
      max: p.max != null ? String(p.max) : null,
      oninput: (e) => {
        const v = e.target.value;
        if (v === '') delete node[p.key];
        else node[p.key] = p.kind === 'int' ? Math.round(Number(v)) : Number(v);
        refreshPreviewAndJson();
        refreshSwatch(node);
      },
    });
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, p.label), inp);
  }

  function selectField(node, p) {
    const cur = node[p.key] != null ? String(node[p.key]) : String(p.def);
    const sel = h('select', { class: 'es-select', onchange: (e) => {
      node[p.key] = p.cast ? p.cast(e.target.value) : e.target.value;
      refreshPreviewAndJson();
    } });
    for (const [val, lbl] of p.options) {
      const o = h('option', { value: val }, lbl);
      if (val === cur) o.setAttribute('selected', '');
      sel.appendChild(o);
    }
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, p.label), sel);
  }

  // A colour-ref widget: choose the ref kind, then its value.
  //   literal hex · cycle · rand · band · palette[i] · center hex · named
  function colorRefField(node, p) {
    const ref = node[p.key];
    const kindOf = (r) => {
      if (r == null) return 'none';
      if (typeof r === 'string') return NAMED[r] != null && !/^#/.test(r) ? 'named' : 'hex';
      if (r.cycle) return 'cycle';
      if (r.rand) return 'rand';
      if (r.band != null) return 'band';
      if (r.p != null) return 'p';
      if ('center' in r) return 'center';
      return 'none';
    };
    const kind = kindOf(ref);
    const kinds = [['cycle', 'cycle (colourway)'], ['hex', 'literal hex'], ['band', 'band index'], ['p', 'palette[i]'], ['rand', 'random'], ['center', 'literal (center)'], ['named', 'named role'], ['none', 'none']];

    const valWrap = h('span', { class: 'es-ref-val' });
    const renderVal = (k) => {
      clear(valWrap);
      if (k === 'hex' || k === 'center') {
        const cur = typeof ref === 'string' ? ref : (ref && ref.center) || palette[0];
        valWrap.appendChild(h('input', { type: 'color', class: 'es-color', value: /^#/.test(cur) ? cur : palette[0],
          oninput: (e) => { node[p.key] = k === 'center' ? { center: e.target.value } : e.target.value; refreshPreviewAndJson(); refreshSwatch(node); } }));
      } else if (k === 'p') {
        valWrap.appendChild(h('input', { type: 'number', class: 'es-num', min: '0', step: '1', value: String((ref && ref.p) || 0),
          oninput: (e) => { node[p.key] = { p: Math.max(0, Math.round(Number(e.target.value) || 0)) }; refreshPreviewAndJson(); refreshSwatch(node); } }));
      } else if (k === 'named') {
        valWrap.appendChild(h('input', { type: 'text', class: 'es-text', value: typeof ref === 'string' ? ref : 'ground',
          oninput: (e) => { node[p.key] = e.target.value; refreshPreviewAndJson(); refreshSwatch(node); } }));
      }
    };
    const sel = h('select', { class: 'es-select', onchange: (e) => {
      const k = e.target.value;
      if (k === 'cycle') node[p.key] = { cycle: true };
      else if (k === 'rand') node[p.key] = { rand: true };
      else if (k === 'band') node[p.key] = { band: true };
      else if (k === 'p') node[p.key] = { p: 0 };
      else if (k === 'hex') node[p.key] = palette[0];
      else if (k === 'center') node[p.key] = { center: '#ffffff' };
      else if (k === 'named') node[p.key] = 'ground';
      else delete node[p.key];
      renderVal(k); refreshPreviewAndJson(); refreshSwatch(node);
    } });
    for (const [val, lbl] of kinds) {
      const o = h('option', { value: val }, lbl);
      if (val === kind) o.setAttribute('selected', '');
      sel.appendChild(o);
    }
    renderVal(kind);
    return h('label', { class: 'es-field es-field-ref' }, h('span', { class: 'es-field-label' }, p.label), sel, valWrap);
  }

  // Path segments are edited as JSON — advanced, but exact. Each segment
  // is [cmd, ...coords], coords in unit-fractions from centre.
  function segsField(node, p) {
    const ta = h('textarea', { class: 'es-json es-segs', rows: '5', spellcheck: 'false' });
    ta.value = JSON.stringify(node.segs || [], null, 0);
    const msg = h('span', { class: 'es-json-msg' });
    ta.addEventListener('change', () => {
      try {
        const v = JSON.parse(ta.value);
        if (!Array.isArray(v)) throw new Error('expected an array of segments');
        node.segs = v; msg.textContent = ''; refreshPreviewAndJson();
      } catch (err) { msg.textContent = '✗ ' + err.message; msg.className = 'es-json-msg es-err'; }
    });
    return h('div', { class: 'es-field es-field-col' }, h('span', { class: 'es-field-label' }, p.label), ta, msg);
  }

  // Keep the tree swatch in sync without a full tree rebuild.
  function refreshSwatch(node) {
    // Cheap: rebuild the whole tree only if structure could change. Fills
    // don't change structure, so just repaint swatches by re-rendering.
    renderTree();
  }

  // ---------------------------------------------------------------------
  // Preview — tile the document across a grid of cells.
  // ---------------------------------------------------------------------
  function renderPreview() {
    clear(elPreview);
    if (!IR) { elPreview.appendChild(h('div', { class: 'es-muted' }, 'loading interpreter…')); return; }
    const cols = Math.max(1, preview.cols | 0), rows = Math.max(1, preview.rows | 0);
    const aspect = preview.aspect || 1;       // cell w : h
    const cw = 100, ch = 100 / aspect;
    const W = cols * cw, H = rows * ch;
    const stage = svg('svg', { class: 'es-stage', viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'xMidYMid meet' });
    stage.setAttribute('width', '100%');

    let err = null;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const region = { x: c * cw, y: r * ch, w: cw, h: ch };
        const rng = rngFor((preview.seed * 2654435761 + idx * 40503) >>> 0);
        const env = { el: svg, color: colorResolver(idx, rng), rng };
        try {
          const nodes = IR.render(doc, region, env);
          for (const n of nodes) stage.appendChild(n);
        } catch (e) { err = e; }
        if (preview.grid) {
          stage.appendChild(svg('rect', { x: region.x, y: region.y, width: cw, height: ch, fill: 'none', stroke: '#d0d0d0', 'stroke-dasharray': '2 3', 'stroke-width': 0.5 }));
        }
      }
    }
    elPreview.appendChild(stage);
    if (err) elPreview.appendChild(h('div', { class: 'es-json-msg es-err' }, '✗ render: ' + err.message));
  }

  // ---------------------------------------------------------------------
  // Palette
  // ---------------------------------------------------------------------
  function renderPalette() {
    clear(elPalette);
    const row = h('div', { class: 'es-pal-row' });
    palette.forEach((c, i) => {
      const cell = h('div', { class: 'es-pal-cell' },
        h('input', { type: 'color', class: 'es-color', value: c,
          oninput: (e) => { palette[i] = e.target.value; renderPreview(); renderTree(); } }),
        palette.length > 1 ? h('button', { class: 'es-icon-btn', title: 'remove', onclick: () => { palette.splice(i, 1); renderPalette(); renderPreview(); renderTree(); } }, '×') : null,
      );
      row.appendChild(cell);
    });
    elPalette.appendChild(row);
    elPalette.appendChild(h('button', { class: 'es-btn es-btn-sm', onclick: () => { palette.push('#888888'); renderPalette(); renderPreview(); } }, '+ colour'));
  }

  // ---------------------------------------------------------------------
  // Presets + library + import / export
  // ---------------------------------------------------------------------
  function populatePresets() {
    clear(elPresetSel);
    elPresetSel.appendChild(h('option', { value: '' }, 'load a preset…'));
    const group = (label, items) => {
      if (!items.length) return;
      const g = h('optgroup', { label });
      for (const it of items) g.appendChild(h('option', { value: it.id }, it.name));
      elPresetSel.appendChild(g);
    };
    group('committed presets', presets.map((p, i) => ({ id: 'preset:' + i, name: p.name })));
    if (IR) {
      group('interpreter demos', Object.keys(IR.DEMOS || {}).map((k) => ({ id: 'demo:' + k, name: k })));
      group('shape catalog', Object.keys(IR.SHAPES || {}).map((k) => ({ id: 'shape:' + k, name: k })));
    }
  }

  function onPresetPick(e) {
    const val = e.target.value;
    e.target.value = '';
    if (!val) return;
    const [kind, key] = val.split(':');
    let d = null, name = key;
    if (kind === 'preset') { const p = presets[Number(key)]; d = p && p.doc; name = p && p.name; }
    else if (kind === 'demo') d = IR && IR.DEMOS[key];
    else if (kind === 'shape') d = IR && IR.SHAPES[key];
    if (d) loadDoc(clone(d), name);
  }

  function loadDoc(d, name) {
    doc = d; selected = doc;
    refreshAll();
  }

  function renderLibrary() {
    clear(elLibrary);
    if (!library.length) { elLibrary.appendChild(h('div', { class: 'es-muted' }, 'no saved elements yet — author one, then “save to library”.')); return; }
    const list = h('ul', { class: 'es-lib-list' });
    library.forEach((item, i) => {
      list.appendChild(h('li', { class: 'es-lib-item' },
        h('button', { class: 'es-lib-load', onclick: () => loadDoc(clone(item.doc), item.name) }, item.name),
        h('button', { class: 'es-btn es-btn-sm', onclick: () => downloadDoc(item.doc, item.name) }, 'export'),
        h('button', { class: 'es-icon-btn', title: 'delete', onclick: () => { library.splice(i, 1); saveLibrary(library); renderLibrary(); } }, '×'),
      ));
    });
    elLibrary.appendChild(list);
  }

  function saveToLibrary() {
    const name = (prompt('Name this element:', 'untitled') || '').trim();
    if (!name) return;
    const existing = library.findIndex((x) => x.name === name);
    const item = { name, doc: clone(doc), ts: Date.now() };
    if (existing >= 0) library[existing] = item; else library.push(item);
    saveLibrary(library);
    renderLibrary();
  }

  function downloadDoc(d, name) {
    const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: (name || 'element').replace(/[^a-z0-9_-]+/gi, '-') + '.json' });
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }
  const exportJSON = () => downloadDoc(doc, (selected && selected.op) || 'element');

  function importJSON() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', () => {
      const file = inp.files && inp.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try { loadDoc(JSON.parse(reader.result), file.name.replace(/\.json$/, '')); }
        catch (err) { alert('Could not parse JSON: ' + err.message); }
      };
      reader.readAsText(file);
    });
    inp.click();
  }

  // ---------------------------------------------------------------------
  // JSON source — a two-way view of the whole document.
  // ---------------------------------------------------------------------
  function renderJson() {
    elJson.value = JSON.stringify(doc, null, 2);
    elJsonMsg.textContent = '';
    elJsonMsg.className = 'es-json-msg';
  }
  function applyJSON() {
    try {
      const d = JSON.parse(elJson.value);
      if (!d || typeof d !== 'object' || !d.op) throw new Error('document needs an "op"');
      doc = d; selected = doc;
      renderTree(); renderParams(); renderPreview();
      elJsonMsg.textContent = '✓ applied';
      elJsonMsg.className = 'es-json-msg es-ok';
    } catch (err) {
      elJsonMsg.textContent = '✗ ' + err.message;
      elJsonMsg.className = 'es-json-msg es-err';
    }
  }

  // ---------------------------------------------------------------------
  // Refresh orchestration
  // ---------------------------------------------------------------------
  const refreshPreviewAndJson = () => { renderPreview(); renderJson(); };
  function refreshAll() {
    renderTree(); renderParams(); renderPreview(); renderJson();
  }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function loadScript(src) {
    return new Promise((res, rej) => {
      if (window.GirardElementIR) return res();
      const s = document.createElement('script');
      s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src));
      document.head.appendChild(s);
    });
  }

  build();
  renderPalette();
  renderLibrary();
  renderTree();
  renderParams();
  renderJson();
  elPreview.appendChild(h('div', { class: 'es-muted' }, 'loading interpreter…'));

  // Committed presets (authored "for us") + the shared interpreter.
  fetch('/posts/element-studio/presets.json')
    .then((r) => (r.ok ? r.json() : []))
    .then((p) => { presets = Array.isArray(p) ? p : []; })
    .catch(() => { presets = []; })
    .finally(() => {
      loadScript('/posts/girard/element-ir.js')
        .then(() => { IR = window.GirardElementIR; populatePresets(); renderPreview(); })
        .catch((err) => { elPreview.appendChild(h('div', { class: 'es-json-msg es-err' }, '✗ ' + err.message)); });
    });
})();
