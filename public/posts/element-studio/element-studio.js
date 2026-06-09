// element studio — a visual editor for girard's element-ir documents.
//
// Canvas-first: a single large cell stage you draw on directly. Click a
// shape to select it; drag to move, resize, or spin it. The op-tree is
// demoted to a Layers panel (shapes named the way a maker thinks — Circle,
// Ring of copies, Stripes — not the interpreter's ops). Properties are
// plain-language sliders. The raw IR JSON lives in an Export drawer for the
// power users and the girard handoff.
//
// The drawing is produced by the very same GirardElementIR.render that
// paints girard's cells (see ../girard/element-ir.js), so what you author
// is exactly what girard draws. Output is a plain element-ir JSON document:
// save it to your browser library, export .json, or load a preset.
//
// Framework-free, no build step — a global script loaded by the post page.

(function () {
  'use strict';

  const ROOT = document.getElementById('element-studio');
  if (!ROOT) return;

  const SVG = 'http://www.w3.org/2000/svg';
  const CELL = 100;            // the stage's single cell, in user units

  // --- DOM helpers ------------------------------------------------------
  const svg = (tag, attrs) => {
    const n = document.createElementNS(SVG, tag);
    for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    return n;
  };
  const h = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k === 'style') n.style.cssText = attrs[k];
      else if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const kid of kids) { if (kid == null) continue; n.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid); }
    return n;
  };
  const clear = (n) => { while (n.firstChild) n.removeChild(n.firstChild); return n; };
  const clone = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));
  const mod = (a, n) => ((a % n) + n) % n;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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
  // Vocabulary. The "add" menu and Layers panel speak shapes, not ops.
  // ---------------------------------------------------------------------
  const SHAPES = [
    { id: 'disc',  name: 'Circle',    make: () => ({ op: 'disc', r: 0.3, fill: { cycle: true } }) },
    { id: 'poly',  name: 'Polygon',   make: () => ({ op: 'poly', sides: 6, r: 0.45, fill: { cycle: true } }) },
    { id: 'star',  name: 'Star',      make: () => ({ op: 'poly', sides: 5, depth: 0.45, r: 0.5, fill: { cycle: true } }) },
    { id: 'box',   name: 'Rectangle', make: () => ({ op: 'box', w: 0.5, h: 0.5, fill: { cycle: true } }) },
    { id: 'wedge', name: 'Wedge',     make: () => ({ op: 'wedge', corner: 0, r: 1, fill: { cycle: true } }) },
    { id: 'rect',  name: 'Fill',      make: () => ({ op: 'rect', fill: { cycle: true } }) },
    { id: 'path',  name: 'Curve',     make: () => ({ op: 'path', fill: { cycle: true }, segs: [['M', 0, -0.5], ['Q', 0.5, 0, 0, 0.5], ['Q', -0.5, 0, 0, -0.5], ['Z']] }) },
  ];
  const CONTAINERS = [
    { id: 'repeat',  name: 'Ring of copies',   make: () => ({ op: 'repeat', count: 6, radius: 0.34, child: { op: 'disc', r: 0.12, fill: { cycle: true } } }) },
    { id: 'nest',    name: 'Concentric rings', make: () => ({ op: 'nest', count: 3, child: { op: 'poly', sides: 4, rx: 1, ry: 1, fill: { band: true } } }) },
    { id: 'split',   name: 'Stripes',          make: () => ({ op: 'split', axis: 'y', count: 4, children: [{ op: 'rect', fill: { band: true } }] }) },
    { id: 'mirror',  name: 'Reflect',          make: () => ({ op: 'mirror', axis: 'x', children: [{ op: 'disc', r: 0.22, dx: 0.32, fill: { cycle: true } }] }) },
    { id: 'boolean', name: 'Clip / lens',      make: () => ({ op: 'boolean', clip: { op: 'disc', r: 0.5, dx: -0.3, fill: '#000000' }, child: { op: 'disc', r: 0.5, dx: 0.3, fill: { cycle: true } } }) },
    { id: 'group',   name: 'Group',            make: () => ({ op: 'group', children: [] }) },
  ];
  const opLabel = (n) => {
    if (!n) return '';
    if (n.op === 'poly') return (n.depth != null && n.depth < 1) ? 'Star' : 'Polygon';
    return ({ group: 'Group', rect: 'Fill', disc: 'Circle', box: 'Rectangle', wedge: 'Wedge', path: 'Curve', split: 'Stripes', repeat: 'Ring of copies', nest: 'Concentric rings', mirror: 'Reflect', boolean: 'Clip / lens' })[n.op] || n.op;
  };
  const isContainer = (n) => ['group', 'split', 'mirror', 'repeat', 'nest', 'boolean'].includes(n.op);
  // Ops that carry a unit-relative dx/dy offset (movable on the canvas).
  const MOVABLE = ['disc', 'box', 'poly', 'path'];

  // The child slots of a node, normalised so the tree can walk uniformly.
  function slotsOf(node) {
    switch (node.op) {
      case 'group': case 'split': case 'mirror':
        if (!Array.isArray(node.children)) node.children = node.child ? [node.child] : [];
        delete node.child;
        return [{ key: 'children', list: true }];
      case 'repeat': case 'nest':
        return [{ key: 'child', list: false }];
      case 'boolean':
        return [{ key: 'clip', list: false }, { key: 'child', list: false }];
      default: return [];
    }
  }

  // ---------------------------------------------------------------------
  // Properties. Per-op fields with plain labels + sliders. `kind`:
  //   slider  -> range + numeric echo        select -> dropdown
  //   color   -> the colour widget           segs   -> advanced path editor
  // `deg` converts a radian param to a degrees control.
  // ---------------------------------------------------------------------
  const S = (key, label, min, max, step, def) => ({ key, label, kind: 'slider', min, max, step, def });
  const FIELDS = {
    disc:  [color(), S('r', 'Size', 0.02, 0.6, 0.01, 0.3), S('dx', 'Move ↔', -0.6, 0.6, 0.01, 0), S('dy', 'Move ↕', -0.6, 0.6, 0.01, 0)],
    poly:  [color(), S('sides', 'Sides', 3, 24, 1, 6), S('depth', 'Pointiness', 0.05, 1, 0.01, 1), S('rotate', 'Spin°', -180, 180, 1, 0), S('jitter', 'Roughness', 0, 1, 0.01, 0), S('r', 'Size', 0.05, 0.6, 0.01, 0.45), S('dx', 'Move ↔', -0.6, 0.6, 0.01, 0), S('dy', 'Move ↕', -0.6, 0.6, 0.01, 0)],
    box:   [color(), S('w', 'Width', 0.05, 1, 0.01, 0.5), S('h', 'Height', 0.05, 1, 0.01, 0.5), S('dx', 'Move ↔', -0.6, 0.6, 0.01, 0), S('dy', 'Move ↕', -0.6, 0.6, 0.01, 0), S('rx', 'Round corners', 0, 0.5, 0.01, 0), S('rotate', 'Spin°', -180, 180, 1, 0)],
    wedge: [color(), { key: 'corner', label: 'Corner', kind: 'select', options: [['0', 'top-left'], ['1', 'top-right'], ['2', 'bottom-right'], ['3', 'bottom-left']], cast: Number, def: 0 }, S('r', 'Size', 0.1, 1, 0.01, 1)],
    rect:  [color(), S('inset', 'Inset', 0, 0.45, 0.01, 0)],
    path:  [color(), S('dx', 'Move ↔', -0.6, 0.6, 0.01, 0), S('dy', 'Move ↕', -0.6, 0.6, 0.01, 0), { key: 'segs', label: 'Outline', kind: 'segs' }],
    split: [{ key: 'axis', label: 'Direction', kind: 'select', options: [['y', 'horizontal bands'], ['x', 'vertical bands']], def: 'y' }, S('count', 'How many', 1, 24, 1, 4), S('offset', 'Brick shift', 0, 1, 0.01, 0)],
    repeat:[S('count', 'How many', 1, 36, 1, 6), S('radius', 'Spread', 0, 0.6, 0.01, 0.34), { key: 'phase', label: 'Start angle°', kind: 'slider', min: 0, max: 360, step: 1, def: 0, deg: true }],
    nest:  [S('count', 'How many', 1, 12, 1, 3)],
    mirror:[{ key: 'axis', label: 'Reflect', kind: 'select', options: [['x', 'left ↔ right'], ['y', 'top ↕ bottom'], ['xy', 'both ✶']], def: 'x' }],
    group: [],
    boolean: [],
  };
  function color() { return { key: 'fill', label: 'Colour', kind: 'color' }; }

  // ---------------------------------------------------------------------
  // Colour. Mirrors girard's resolver so the preview matches: a literal hex
  // draws as-is; {cycle} walks the palette per cell; {band}/{p} index it.
  // ---------------------------------------------------------------------
  let palette = ['#d24a45', '#2c7fb8', '#f2b933', '#3f7a8c', '#7d9a40', '#8a5fb0'];
  const NAMED = { ground: '#e7e2d6', wedge: '#d24a45' };
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
  // State + history (path-based selection survives undo's doc swaps).
  // ---------------------------------------------------------------------
  const STARTERS = {
    flower: { op: 'group', size: 0.6, children: [
      { op: 'disc', r: 0.34, fill: { cycle: true } },
      { op: 'repeat', count: 16, radius: 0.34, child: { op: 'disc', r: 0.105, fill: { cycle: true } } },
    ] },
  };
  let doc = clone(STARTERS.flower);
  let selPath = [];                 // path from root to the selected node
  let IR = null;
  let presets = [];
  let seed = 1;
  const history = []; let hIndex = -1;

  const LIB_KEY = 'element-studio:library';
  const loadLibrary = () => { try { return JSON.parse(localStorage.getItem(LIB_KEY)) || []; } catch { return []; } };
  const saveLibrary = (l) => { try { localStorage.setItem(LIB_KEY, JSON.stringify(l)); } catch {} };
  let library = loadLibrary();

  // Autosave: the working document + palette survive a refresh (single
  // slot, mirroring girard's autosave model).
  const AUTOSAVE_KEY = 'element-studio:autosave:v1';
  function persist() { try { localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({ v: 1, doc, palette })); } catch {} }
  (function restore() {
    try {
      const d = JSON.parse(localStorage.getItem(AUTOSAVE_KEY));
      if (d && d.doc && d.doc.op) { doc = d.doc; if (Array.isArray(d.palette) && d.palette.length) palette = d.palette; }
    } catch { /* corrupt / unavailable → start fresh */ }
  })();

  function nodePath(root, target, path) {
    path = path || [];
    if (root === target) return path;
    for (const s of slotsOf(root)) {
      if (s.list) { const arr = root[s.key] || []; for (let i = 0; i < arr.length; i++) { const r = nodePath(arr[i], target, path.concat([{ k: s.key, i }])); if (r) return r; } }
      else { const c = root[s.key]; if (c) { const r = nodePath(c, target, path.concat([{ k: s.key }])); if (r) return r; } }
    }
    return null;
  }
  function getByPath(p) { let n = doc; for (const s of (p || [])) { n = s.i != null ? (n[s.k] || [])[s.i] : n[s.k]; if (!n) return null; } return n; }
  function parentOf(p) { return p && p.length ? { parent: getByPath(p.slice(0, -1)), slot: p[p.length - 1] } : null; }
  const selected = () => getByPath(selPath) || doc;

  function pushHistory() {
    history.splice(hIndex + 1);
    history.push(JSON.stringify(doc));
    if (history.length > 80) history.shift();
    hIndex = history.length - 1;
    refreshUndo();
    persist();
  }
  // Undo/redo keep the selection path: after the doc swap it re-resolves
  // against the new tree (same position ≈ same node), so the tweak–undo–
  // compare loop doesn't lose your place.
  function undo() { if (hIndex > 0) { hIndex--; doc = JSON.parse(history[hIndex]); if (!getByPath(selPath)) selPath = []; refreshAll(); persist(); } }
  function redo() { if (hIndex < history.length - 1) { hIndex++; doc = JSON.parse(history[hIndex]); if (!getByPath(selPath)) selPath = []; refreshAll(); persist(); } }
  // Debounced history for high-frequency edits (arrow nudges): one undo
  // step per burst, not per keypress.
  let pushTimer = null;
  function schedulePush() {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushHistory(); renderProps(); renderLayers(); }, 400);
  }

  // ---------------------------------------------------------------------
  // Layout
  // ---------------------------------------------------------------------
  const elLayers = h('div', { class: 'es-layers' });
  const elAdd = h('div', { class: 'es-add-grid' });
  const elProps = h('div', { class: 'es-props' });
  const elStageWrap = h('div', { class: 'es-stage-wrap' });
  const elTile = h('div', { class: 'es-tile' });
  const elPalette = h('div', { class: 'es-palette' });
  const elLibrary = h('div', { class: 'es-library' });
  const elPresetSel = h('select', { class: 'es-select' });
  const elJson = h('textarea', { class: 'es-json', spellcheck: 'false', rows: '10' });
  const elJsonMsg = h('div', { class: 'es-json-msg' });
  let undoBtn, redoBtn;

  function build() {
    clear(ROOT);
    ROOT.appendChild(h('div', { class: 'es-titlebar' },
      h('h1', { class: 'es-title' }, 'element studio', h('sup', { class: 'es-version' }, 'v0.02')),
      h('p', { class: 'es-subtitle' }, 'draw a motif — click a shape to select, drag to shape it; it tiles the way girard repeats it'),
    ));

    undoBtn = h('button', { class: 'es-btn', title: 'undo (⌘Z)', onclick: undo }, '↶ undo');
    redoBtn = h('button', { class: 'es-btn', title: 'redo (⌘⇧Z)', onclick: redo }, '↷ redo');
    const stageBar = h('div', { class: 'es-stagebar' }, undoBtn, redoBtn,
      h('button', { class: 'es-btn', title: 'duplicate selected (⌘D)', onclick: duplicateSelected }, '⧉ duplicate'),
      h('button', { class: 'es-btn', title: 're-roll random / roughness', onclick: () => { seed = (seed + 1) | 0; renderStage(); } }, '⟳ re-seed'));

    const left = h('div', { class: 'es-rail es-rail-left' },
      h('h3', { class: 'es-rail-head' }, 'add'),
      elAdd,
      h('h3', { class: 'es-rail-head' }, 'layers'),
      elLayers,
    );
    const centre = h('div', { class: 'es-centre' }, stageBar, elStageWrap,
      h('div', { class: 'es-centre-foot' },
        h('div', { class: 'es-foot-block' }, h('h3', { class: 'es-rail-head' }, 'tile preview'), elTile),
        h('div', { class: 'es-foot-block' }, h('h3', { class: 'es-rail-head' }, 'palette'), elPalette),
      ),
    );
    const right = h('div', { class: 'es-rail es-rail-right' },
      h('h3', { class: 'es-rail-head' }, 'properties'),
      elProps,
      h('h3', { class: 'es-rail-head' }, 'library'),
      elLibrary,
    );

    ROOT.appendChild(h('div', { class: 'es-toolbar' },
      h('label', { class: 'es-tool-group' }, h('span', { class: 'es-tool-label' }, 'start from'), elPresetSel),
      h('button', { class: 'es-btn', onclick: () => loadDoc(clone(STARTERS.flower)) }, 'new'),
      h('button', { class: 'es-btn es-btn-accent', onclick: saveToLibrary }, 'save'),
      h('button', { class: 'es-btn', onclick: exportJSON }, 'export .json'),
      h('button', { class: 'es-btn', onclick: importJSON }, 'import…'),
    ));
    ROOT.appendChild(h('div', { class: 'es-main' }, left, centre, right));

    // Advanced drawer — the raw IR document, folded away.
    const drawer = h('details', { class: 'es-drawer' },
      h('summary', { class: 'es-drawer-sum' }, 'advanced — raw element-ir json'),
      h('div', { class: 'es-drawer-body' },
        h('p', { class: 'es-muted' }, 'this is the document girard imports. edit and apply, or copy it out.'),
        elJson,
        h('div', { class: 'es-json-row' }, h('button', { class: 'es-btn es-btn-sm', onclick: applyJSON }, 'apply json'), elJsonMsg),
      ),
    );
    ROOT.appendChild(drawer);
    elPresetSel.addEventListener('change', onPresetPick);
  }

  // ---------------------------------------------------------------------
  // Add menu — shape + container chips, each with a tiny live icon.
  // ---------------------------------------------------------------------
  function renderAdd() {
    clear(elAdd);
    const chip = (item) => {
      const c = h('button', { class: 'es-chip', title: 'add ' + item.name, onclick: () => addNode(item.make()) });
      c.appendChild(iconFor(item.make()));
      c.appendChild(h('span', { class: 'es-chip-label' }, item.name));
      return c;
    };
    for (const it of SHAPES) elAdd.appendChild(chip(it));
    elAdd.appendChild(h('div', { class: 'es-chip-sep' }, 'arrange'));
    for (const it of CONTAINERS) elAdd.appendChild(chip(it));
  }
  // A 28×28 thumbnail of a doc, drawn by the interpreter.
  function iconFor(d) {
    const s = svg('svg', { class: 'es-icon', viewBox: '0 0 100 100' });
    if (IR) {
      const rng = rngFor(1);
      try { for (const n of IR.render(d, { x: 0, y: 0, w: 100, h: 100 }, { el: svg, color: colorResolver(0, rng), rng })) s.appendChild(n); } catch {}
    }
    return s;
  }

  // Place a node inside any container: list containers append (paints on
  // top); single-slot arrangements (Ring, Concentric) fill the slot when
  // empty, otherwise wrap the occupant in a Group alongside the new node;
  // Clip fills child first, then the mask.
  function insertInto(target, node) {
    const slots = slotsOf(target);
    if (!slots.length) return false;
    if (slots.some((s) => s.list)) { target.children.push(node); return true; }
    if (!target.child) target.child = node;
    else if (target.op === 'boolean' && !target.clip) target.clip = node;
    else target.child = { op: 'group', children: [target.child, node] };
    return true;
  }

  // Insert a node relative to the selection: into the selected container,
  // else beside the selection in its parent, else wrap a leaf root.
  function addNode(node) {
    const sel = selected();
    let placed = isContainer(sel) && insertInto(sel, node);
    if (!placed) {
      const p = parentOf(selPath);
      placed = !!(p && p.parent && insertInto(p.parent, node));
    }
    if (!placed) doc = { op: 'group', size: doc.size, children: [doc, node] };
    selPath = nodePath(doc, node) || [];
    pushHistory();
    refreshAll();
  }

  // ---------------------------------------------------------------------
  // Layers panel (the demoted op-tree)
  // ---------------------------------------------------------------------
  let dragSrcPath = null;        // path of the layer being dragged

  function renderLayers() {
    clear(elLayers);
    elLayers.appendChild(layerRow(doc, [], 0));
  }
  function layerRow(node, path, depth) {
    const sel = node === selected();
    const wrap = h('div', { class: 'es-layer' });
    const row = h('div', { class: 'es-layer-row' + (sel ? ' es-layer-sel' : ''), style: `padding-left:${depth * 12 + 6}px` });
    // Double-click the name to rename the layer in place. The name rides
    // on the IR node (the interpreter ignores unknown keys).
    const nameSpan = h('span', {}, node.name || opLabel(node));
    const label = h('button', { class: 'es-layer-label', onclick: () => selectPath(path) }, swatch(node), nameSpan);
    label.addEventListener('dblclick', (e) => {
      e.preventDefault();
      const inp = h('input', { type: 'text', class: 'es-rename', value: node.name || opLabel(node) });
      const commit = () => {
        const v = inp.value.trim();
        if (v && v !== opLabel(node)) node.name = v; else delete node.name;
        pushHistory(); refreshAll();
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', (ke) => {
        if (ke.key === 'Enter') inp.blur();
        else if (ke.key === 'Escape') { inp.removeEventListener('blur', commit); renderLayers(); }
      });
      label.replaceChild(inp, nameSpan);
      inp.focus(); inp.select();
    });
    row.appendChild(label);
    if (path.length) row.appendChild(h('button', { class: 'es-x', title: 'delete', onclick: (e) => { e.stopPropagation(); deletePath(path); } }, '×'));

    // Drag the layer (non-root) to reorder it among its siblings or into
    // another container.
    if (path.length) {
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        dragSrcPath = path; e.dataTransfer.effectAllowed = 'move';
        try { e.dataTransfer.setData('text/plain', 'layer'); } catch {}
        row.classList.add('es-dragging');
      });
      row.addEventListener('dragend', () => { dragSrcPath = null; row.classList.remove('es-dragging'); });
    }
    // Drop onto any container's row → move inside it (list containers
    // append; single-slot arrangements fill / wrap via insertInto).
    if (isContainer(node)) {
      row.addEventListener('dragover', (e) => { if (canDrop(path)) { e.preventDefault(); row.classList.add('es-row-drop'); } });
      row.addEventListener('dragleave', () => row.classList.remove('es-row-drop'));
      row.addEventListener('drop', (e) => { e.preventDefault(); row.classList.remove('es-row-drop'); const src = dragSrcPath; dragSrcPath = null; if (src) moveNode(src, path, (node.children || []).length); });
    }
    wrap.appendChild(row);

    for (const s of slotsOf(node)) {
      if (s.list) {
        // Panel shows stacking order — topmost row = painted last (the
        // end of the children array), like every other layers panel. The
        // document keeps SVG paint order; only the display is reversed,
        // so drop lines translate their visual position back to an array
        // insertion index (line below row i = insert at i).
        const arr = node[s.key] || [];
        wrap.appendChild(dropLine(path, arr.length, depth + 1));
        for (let i = arr.length - 1; i >= 0; i--) {
          wrap.appendChild(layerRow(arr[i], path.concat([{ k: s.key, i }]), depth + 1));
          wrap.appendChild(dropLine(path, i, depth + 1));
        }
      } else if (node[s.key]) wrap.appendChild(layerRow(node[s.key], path.concat([{ k: s.key }]), depth + 1));
      else wrap.appendChild(emptySlotRow(path, s.key, depth + 1));
    }
    return wrap;
  }
  // A vacant single slot (Ring/Concentric child, Clip parts): visible,
  // selectable (so the Add menu targets the container) and a drop target.
  function emptySlotRow(containerPath, key, depth) {
    const d = h('div', { class: 'es-slot-empty', style: `padding-left:${depth * 12 + 6}px`,
      onclick: () => selectPath(containerPath) },
      key === 'clip' ? 'empty mask — add a shape' : 'empty — add a shape');
    d.addEventListener('dragover', (e) => { if (canDrop(containerPath)) { e.preventDefault(); d.classList.add('es-row-drop'); } });
    d.addEventListener('dragleave', () => d.classList.remove('es-row-drop'));
    d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('es-row-drop'); const src = dragSrcPath; dragSrcPath = null; if (src) moveNode(src, containerPath, 0); });
    return d;
  }
  // A thin insertion target between sibling rows of a list container.
  function dropLine(containerPath, index, depth) {
    const d = h('div', { class: 'es-drop', style: `margin-left:${depth * 12 + 6}px` });
    d.addEventListener('dragover', (e) => { if (canDrop(containerPath)) { e.preventDefault(); d.classList.add('es-drop-on'); } });
    d.addEventListener('dragleave', () => d.classList.remove('es-drop-on'));
    d.addEventListener('drop', (e) => { e.preventDefault(); d.classList.remove('es-drop-on'); const src = dragSrcPath; dragSrcPath = null; if (src) moveNode(src, containerPath, index); });
    return d;
  }
  // Can the in-flight layer drop into the container at destPath? Reject
  // dropping a node into itself or its own subtree (would orphan it).
  function canDrop(destPath) {
    if (!dragSrcPath) return false;
    const src = getByPath(dragSrcPath), dest = getByPath(destPath);
    if (!src || !dest || !slotsOf(dest).length) return false;
    return dest !== src && !isDescendant(src, dest);
  }
  function isDescendant(anc, node) {
    for (const s of slotsOf(anc)) {
      if (s.list) { for (const c of (anc[s.key] || [])) if (c === node || isDescendant(c, node)) return true; }
      else { const c = anc[s.key]; if (c && (c === node || isDescendant(c, node))) return true; }
    }
    return false;
  }
  function moveNode(srcPath, destPath, destIndex) {
    const src = getByPath(srcPath), dest = getByPath(destPath);
    // Validate from the arguments directly — the drag globals are already
    // cleared by the time the drop handler calls in.
    if (!src || !dest || !slotsOf(dest).length) return;
    if (dest === src || isDescendant(src, dest)) return;
    const pr = parentOf(srcPath); if (!pr) return;
    const sameArray = pr.parent === dest && pr.slot.k === 'children';
    const oldIndex = pr.slot.i;
    // Detach from the old parent…
    if (pr.slot.i != null) (pr.parent[pr.slot.k] || []).splice(pr.slot.i, 1);
    else delete pr.parent[pr.slot.k];
    // …then insert. List containers splice at the drop index (accounting
    // for the shift within one array); single-slot arrangements go
    // through insertInto (fill the slot, or wrap the occupant in a Group).
    if (slotsOf(dest).some((s) => s.list)) {
      let idx = destIndex;
      if (sameArray && oldIndex != null && oldIndex < destIndex) idx -= 1;
      if (!Array.isArray(dest.children)) slotsOf(dest);
      dest.children.splice(clamp(idx, 0, dest.children.length), 0, src);
    } else {
      insertInto(dest, src);
    }
    selPath = nodePath(doc, src) || [];
    pushHistory(); refreshAll();
  }
  function swatch(node) {
    const ref = node.fill; let bg = 'transparent', cls = 'es-sw';
    if (typeof ref === 'string') bg = NAMED[ref] != null ? NAMED[ref] : ref;
    else if (ref && (ref.cycle || ref.band != null || ref.rand)) { bg = palette[0]; cls += ' es-sw-cycle'; }
    else if (ref && ref.p != null) bg = palette[mod(ref.p, palette.length)];
    else if (ref && 'center' in ref) bg = ref.center;
    else if (isContainer(node)) cls += ' es-sw-none';
    return h('span', { class: cls, style: `background:${bg}` });
  }
  function selectPath(p) { selPath = p; renderLayers(); renderProps(); drawSelection(); }
  function deletePath(p) {
    const pr = parentOf(p); if (!pr) return;
    if (pr.slot.i != null) (pr.parent[pr.slot.k] || []).splice(pr.slot.i, 1);
    else delete pr.parent[pr.slot.k];
    selPath = []; pushHistory(); refreshAll();
  }

  // Duplicate the selected layer (⌘D / button). In a list container the
  // copy lands right after the original; in a single slot (Ring child,
  // Clip parts) the slot is wrapped in a Group holding both. Shapes that
  // can carry an offset get a small nudge so the copy is visibly distinct.
  function duplicateSelected() {
    const node = selected();
    if (node === doc) return;
    const pr = parentOf(selPath); if (!pr) return;
    const copy = clone(node);
    if (MOVABLE.includes(copy.op)) {
      copy.dx = clamp((copy.dx || 0) + 0.08, -1, 1);
      copy.dy = clamp((copy.dy || 0) + 0.08, -1, 1);
    }
    if (pr.slot.i != null) pr.parent[pr.slot.k].splice(pr.slot.i + 1, 0, copy);
    else pr.parent[pr.slot.k] = { op: 'group', children: [node, copy] };
    selPath = nodePath(doc, copy) || [];
    pushHistory(); refreshAll();
  }

  // Arrow-key nudge for shapes that carry an offset. Returns false when
  // the selection can't move so the page keeps its scroll behaviour.
  function nudgeSelected(dx, dy) {
    const n = selected();
    if (n === doc || !MOVABLE.includes(n.op)) return false;
    n.dx = clamp((n.dx || 0) + dx, -1, 1);
    n.dy = clamp((n.dy || 0) + dy, -1, 1);
    renderStageLight();
    schedulePush();
    return true;
  }

  // ---------------------------------------------------------------------
  // Properties
  // ---------------------------------------------------------------------
  // --- shape/arrangement conversion ------------------------------------
  const ALL_ITEMS = SHAPES.concat(CONTAINERS);
  const findItem = (id) => ALL_ITEMS.find((x) => x.id === id);
  const itemIdOf = (n) => (n.op === 'poly' ? ((n.depth != null && n.depth < 1) ? 'star' : 'poly') : n.op);
  const hasField = (op, key) => (FIELDS[op] || []).some((f) => f.key === key);
  const childrenOf = (n) => {
    if (Array.isArray(n.children)) return n.children.slice();
    const out = []; if (n.clip) out.push(n.clip); if (n.child) out.push(n.child);
    return out;
  };

  // Convert the selected node to another shape/arrangement in place,
  // preserving what carries across: name, fill, position, spin, root
  // size, and — container to container — the contents.
  function changeNodeTo(node, make) {
    const keep = { fill: node.fill, name: node.name, dx: node.dx, dy: node.dy, rotate: node.rotate, size: node.size, kids: childrenOf(node) };
    const fresh = make();
    for (const k of Object.keys(node)) delete node[k];
    Object.assign(node, fresh);
    if (keep.name) node.name = keep.name;
    if (keep.fill != null && hasField(node.op, 'fill')) node.fill = keep.fill;
    if (keep.dx != null && MOVABLE.includes(node.op)) node.dx = keep.dx;
    if (keep.dy != null && MOVABLE.includes(node.op)) node.dy = keep.dy;
    if (keep.rotate != null && hasField(node.op, 'rotate')) node.rotate = keep.rotate;
    if (keep.size != null && (node === doc || node.op === 'split' || node.op === 'nest')) node.size = keep.size;
    if (keep.kids.length && isContainer(node)) {
      if (slotsOf(node).some((s) => s.list)) node.children = keep.kids;
      else if (node.op === 'boolean' && keep.kids.length >= 2) { node.clip = keep.kids[0]; node.child = keep.kids[1]; }
      else node.child = keep.kids.length === 1 ? keep.kids[0] : { op: 'group', children: keep.kids };
    }
    pushHistory(); refreshAll();
  }

  // Wrap the selection in an arrangement — the one-step "ring of stars":
  // the node becomes the wrapper's content (default contents discarded;
  // Clip keeps its default mask).
  function wrapSelected(make) {
    const node = selected();
    const wrapper = make();
    if (wrapper.op === 'repeat' || wrapper.op === 'nest' || wrapper.op === 'boolean') wrapper.child = node;
    else wrapper.children = [node];
    if (!selPath.length) {
      if (node.size != null) { wrapper.size = node.size; delete node.size; }
      doc = wrapper;
    } else {
      const pr = parentOf(selPath);
      if (pr.slot.i != null) pr.parent[pr.slot.k][pr.slot.i] = wrapper;
      else pr.parent[pr.slot.k] = wrapper;
    }
    selPath = nodePath(doc, wrapper) || [];
    pushHistory(); refreshAll();
  }

  function changeToField(node) {
    const cur = itemIdOf(node);
    const sel = h('select', { class: 'es-select', onchange: (e) => { const it = findItem(e.target.value); if (it && e.target.value !== cur) changeNodeTo(node, it.make); } });
    const grp = (label, items) => {
      const g = h('optgroup', { label });
      for (const it of items) { const o = h('option', { value: it.id }, it.name); if (it.id === cur) o.setAttribute('selected', ''); g.appendChild(o); }
      sel.appendChild(g);
    };
    grp('shapes', SHAPES); grp('arrangements', CONTAINERS);
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, 'Change to'), sel);
  }
  function wrapInField() {
    const sel = h('select', { class: 'es-select', onchange: (e) => { const it = findItem(e.target.value); e.target.value = ''; if (it) wrapSelected(it.make); } });
    sel.appendChild(h('option', { value: '' }, 'choose…'));
    for (const it of CONTAINERS) sel.appendChild(h('option', { value: it.id }, it.name));
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, 'Wrap in'), sel);
  }

  function renderProps() {
    clear(elProps);
    const node = selected();
    if (!node) { elProps.appendChild(h('div', { class: 'es-muted' }, 'select a shape')); return; }
    elProps.appendChild(h('div', { class: 'es-props-head' }, node.name || opLabel(node)));
    elProps.appendChild(changeToField(node));
    elProps.appendChild(wrapInField());

    if (node === doc) elProps.appendChild(sliderField(node, S('size', 'Overall scale', 0.1, 1, 0.01, 0.6)));
    for (const f of FIELDS[node.op] || []) {
      if (f.kind === 'color') elProps.appendChild(colorField(node, f));
      else if (f.kind === 'select') elProps.appendChild(selectField(node, f));
      else if (f.kind === 'segs') elProps.appendChild(segsField(node, f));
      else elProps.appendChild(sliderField(node, f));
    }
    // Star toggle for polygons (depth<1).
    if (node.op === 'poly') {
      const isStar = node.depth != null && node.depth < 1;
      elProps.appendChild(h('label', { class: 'es-check' },
        h('input', { type: 'checkbox', checked: isStar ? '' : null, onchange: (e) => {
          if (e.target.checked) node.depth = 0.45; else delete node.depth;
          pushHistory(); refreshAll();
        } }),
        h('span', {}, 'star points')));
    }
  }

  // Slider + an editable value box: drag to explore, type for exact.
  function sliderField(node, f) {
    const cur = node[f.key] != null ? (f.deg ? node[f.key] * 180 / Math.PI : node[f.key]) : f.def;
    const apply = (v) => { node[f.key] = f.deg ? v * Math.PI / 180 : v; renderStageLight(); };
    const echo = h('input', { type: 'number', class: 'es-echo', step: String(f.step), min: String(f.min), max: String(f.max), value: fmt(cur, f.step),
      oninput: () => { const v = Number(echo.value); if (Number.isFinite(v)) { apply(clamp(v, f.min, f.max)); range.value = String(clamp(v, f.min, f.max)); } },
      onchange: () => { pushHistory(); renderLayers(); } });
    const range = h('input', { type: 'range', class: 'es-range', min: String(f.min), max: String(f.max), step: String(f.step), value: String(cur),
      oninput: () => { const v = Number(range.value); apply(v); echo.value = fmt(v, f.step); },
      onchange: () => { pushHistory(); renderLayers(); } });
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, f.label), h('span', { class: 'es-field-ctl' }, range, echo));
  }
  const fmt = (v, step) => (step >= 1 ? String(Math.round(v)) : String(Math.round(v * 100) / 100));

  function selectField(node, f) {
    const cur = node[f.key] != null ? String(node[f.key]) : String(f.def);
    const sel = h('select', { class: 'es-select', onchange: (e) => { node[f.key] = f.cast ? f.cast(e.target.value) : e.target.value; pushHistory(); refreshAll(); } });
    for (const [val, lbl] of f.options) { const o = h('option', { value: val }, lbl); if (val === cur) o.setAttribute('selected', ''); sel.appendChild(o); }
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, f.label), sel);
  }

  // Colour widget: a swatch up front, with a small "source" menu for the
  // symbolic modes (follow palette / by ring / a slot / random / literal).
  function colorField(node, f) {
    const ref = node[f.key];
    const kindOf = (r) => r == null ? 'none' : typeof r === 'string' ? 'hex' : r.cycle ? 'cycle' : r.rand ? 'rand' : r.band != null ? 'band' : r.p != null ? 'p' : ('center' in r) ? 'center' : 'none';
    const kind = kindOf(ref);
    const swatchInput = h('input', { type: 'color', class: 'es-color', value: hexGuess(ref),
      oninput: (e) => { node[f.key] = (kindOf(node[f.key]) === 'center') ? { center: e.target.value } : e.target.value; renderStageLight(); renderLayers(); },
      onchange: () => { pushHistory(); renderJson(); } });
    const idx = h('input', { type: 'number', class: 'es-num', min: '0', step: '1', value: String((ref && ref.p) || 0),
      oninput: (e) => { node[f.key] = { p: Math.max(0, Math.round(Number(e.target.value) || 0)) }; renderStageLight(); renderLayers(); },
      onchange: () => { pushHistory(); renderJson(); } });
    const modeSel = h('select', { class: 'es-select es-select-sm', onchange: (e) => {
      const k = e.target.value;
      node[f.key] = k === 'cycle' ? { cycle: true } : k === 'rand' ? { rand: true } : k === 'band' ? { band: true } : k === 'p' ? { p: 0 } : k === 'center' ? { center: '#ffffff' } : k === 'hex' ? palette[0] : undefined;
      if (node[f.key] === undefined) delete node[f.key];
      pushHistory(); refreshAll();
    } });
    for (const [val, lbl] of [['cycle', 'follow palette'], ['hex', 'pick a colour'], ['center', 'pick (fixed)'], ['band', 'by ring'], ['p', 'palette slot'], ['rand', 'random'], ['none', 'invisible']]) {
      const o = h('option', { value: val }, lbl); if (val === kind) o.setAttribute('selected', ''); modeSel.appendChild(o);
    }
    const ctl = h('span', { class: 'es-field-ctl' }, modeSel);
    if (kind === 'hex' || kind === 'center') ctl.appendChild(swatchInput);
    if (kind === 'p') ctl.appendChild(idx);
    return h('label', { class: 'es-field' }, h('span', { class: 'es-field-label' }, f.label), ctl);
  }
  const hexGuess = (ref) => typeof ref === 'string' ? (/^#/.test(ref) ? ref : palette[0]) : (ref && ref.center) || palette[0];

  function segsField(node, f) {
    const ta = h('textarea', { class: 'es-json es-segs', rows: '4', spellcheck: 'false' });
    ta.value = JSON.stringify(node.segs || [], null, 0);
    const msg = h('span', { class: 'es-json-msg' });
    ta.addEventListener('change', () => {
      try { const v = JSON.parse(ta.value); if (!Array.isArray(v)) throw new Error('expected an array'); node.segs = v; msg.textContent = ''; pushHistory(); refreshAll(); }
      catch (err) { msg.textContent = '✗ ' + err.message; msg.className = 'es-json-msg es-err'; }
    });
    return h('div', { class: 'es-field es-field-col' }, h('span', { class: 'es-field-label' }, f.label), ta, msg);
  }

  // ---------------------------------------------------------------------
  // Stage — the single editable cell + direct-manipulation handles.
  // ---------------------------------------------------------------------
  let stage = null, overlay = null, tagMap = new Map();

  function renderStage(skipTile) {
    clear(elStageWrap);
    if (!IR) { elStageWrap.appendChild(h('div', { class: 'es-muted' }, 'loading…')); return; }
    stage = svg('svg', { class: 'es-stage', viewBox: `0 0 ${CELL} ${CELL}` });
    stage.appendChild(svg('rect', { x: 0, y: 0, width: CELL, height: CELL, fill: 'none', stroke: '#e2e2e2', 'stroke-width': 0.5 }));
    tagMap = new Map(); let tagSeq = 0;
    const tag = (elNode, irNode) => { if (elNode.__tagged) return; elNode.__tagged = true; const id = ++tagSeq; tagMap.set(id, irNode); elNode.setAttribute('data-ir', id); };
    const rng = rngFor((seed * 2654435761) >>> 0);
    const env = { el: svg, color: colorResolver(0, rng), rng, tag };
    try { for (const n of IR.render(doc, { x: 0, y: 0, w: CELL, h: CELL }, env)) stage.appendChild(n); } catch (e) { /* draw what we can */ }
    overlay = svg('g', { class: 'es-overlay' });
    stage.appendChild(overlay);
    stage.addEventListener('pointerdown', onStagePointerDown);
    stage.style.cursor = 'default';
    elStageWrap.appendChild(stage);
    drawSelection();
    if (!skipTile) renderTile();
  }
  // Light repaint during a slider/handle drag: redraw the stage now, but
  // defer the 16-cell tile preview and the JSON serialisation until the
  // gesture pauses — rebuilding those per pointermove makes drags stutter.
  let lightTimer = null;
  function renderStageLight() {
    renderStage(true);
    clearTimeout(lightTimer);
    lightTimer = setTimeout(() => { renderTile(); renderJson(); }, 150);
  }

  function elementsFor(node) {
    if (!stage) return [];
    const out = [];
    for (const el of stage.querySelectorAll('[data-ir]')) if (tagMap.get(+el.getAttribute('data-ir')) === node) out.push(el);
    return out;
  }
  function unionBBox(els) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const el of els) { const b = el.getBBox(); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); }
    if (!isFinite(x0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // All rendered elements belonging to a container's subtree (containers
  // own no elements themselves under deepest-wins tagging).
  function elementsForSubtree(node) {
    if (!stage) return [];
    const out = [];
    for (const el of stage.querySelectorAll('[data-ir]')) {
      const src = tagMap.get(+el.getAttribute('data-ir'));
      if (src && (src === node || isDescendant(node, src))) out.push(el);
    }
    return out;
  }
  // True when every ancestor of the selected node renders exactly once
  // (group / clip) — i.e. no ring/stripe/reflect multiplies it — so its
  // context is the plain cell and on-canvas handles map back exactly.
  function singleInstancePath(p) {
    let n = doc;
    for (const s of p) {
      if (!(n.op === 'group' || n.op === 'boolean')) return false;
      n = s.i != null ? (n[s.k] || [])[s.i] : n[s.k];
      if (!n) return false;
    }
    return true;
  }
  // Snap guides shown while a move-drag is snapped to an axis.
  let dragGuides = null;

  function drawSelection() {
    if (!overlay) return;
    clear(overlay);
    const node = selected();
    if (!node || node === doc) return;
    let els = elementsFor(node);
    const direct = els.length;
    if (!direct) els = elementsForSubtree(node);     // container: outline its contents
    const bb = unionBBox(els);
    if (bb) overlay.appendChild(svg('rect', { x: bb.x, y: bb.y, width: bb.w, height: bb.h, fill: 'none', stroke: '#157a86', 'stroke-width': 0.8, 'stroke-dasharray': '3 2' }));

    // Snap guide flash (during a move drag).
    if (dragGuides) {
      if (dragGuides.x != null) overlay.appendChild(svg('line', { x1: dragGuides.x, y1: 0, x2: dragGuides.x, y2: CELL, stroke: '#157a86', 'stroke-width': 0.5 }));
      if (dragGuides.y != null) overlay.appendChild(svg('line', { x1: 0, y1: dragGuides.y, x2: CELL, y2: dragGuides.y, stroke: '#157a86', 'stroke-width': 0.5 }));
    }

    // Ring of copies: a draggable spread handle on the ring itself, when
    // the ring's centre is the plain cell centre (single-instance path).
    if (node.op === 'repeat' && singleInstancePath(selPath)) {
      const u = CELL * (doc.size == null ? 1 : doc.size);   // min(cell) × size
      const R = (node.radius == null ? 0.34 : node.radius) * u;
      const a = node.phase || 0;
      const hx = CELL / 2 + Math.cos(a) * R, hy = CELL / 2 + Math.sin(a) * R;
      overlay.appendChild(svg('circle', { cx: CELL / 2, cy: CELL / 2, r: R, fill: 'none', stroke: '#157a86', 'stroke-width': 0.5, 'stroke-dasharray': '1.5 2' }));
      overlay.appendChild(handle(hx, hy, 'spread', 'ew-resize'));
      return;
    }

    // Direct-manipulation handles, only for a single-instance leaf shape.
    if (direct !== 1 || !bb) return;
    const cap = handleCaps(node);
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    if (cap.move) overlay.appendChild(handle(cx, cy, 'move', 'move'));
    if (cap.resize) overlay.appendChild(handle(bb.x + bb.w, bb.y + bb.h, 'resize', 'nwse-resize'));
    if (cap.rotate) {
      overlay.appendChild(svg('line', { x1: cx, y1: bb.y, x2: cx, y2: bb.y - 10, stroke: '#157a86', 'stroke-width': 0.6 }));
      overlay.appendChild(handle(cx, bb.y - 10, 'rotate', 'grab'));
    }
  }
  function handle(x, y, kind, cursor) {
    const g = svg('circle', { cx: x, cy: y, r: 2.6, fill: '#fff', stroke: '#157a86', 'stroke-width': 0.8, 'data-handle': kind, style: `cursor:${cursor}` });
    return g;
  }
  function handleCaps(node) {
    return {
      move: MOVABLE.includes(node.op),
      resize: ['disc', 'box', 'poly', 'wedge'].includes(node.op),
      rotate: node.op === 'poly' || node.op === 'box',
    };
  }

  // Screen → user-space coordinate.
  function toUser(evt) {
    const pt = stage.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
    const m = stage.getScreenCTM(); return m ? pt.matrixTransform(m.inverse()) : pt;
  }

  let drag = null;
  function onStagePointerDown(evt) {
    const handleEl = evt.target.closest('[data-handle]');
    const node = selected();
    if (handleEl && node && node !== doc) { startDrag(handleEl.getAttribute('data-handle'), node, evt); return; }
    const hit = evt.target.closest('[data-ir]');
    if (hit) { const n = tagMap.get(+hit.getAttribute('data-ir')); if (n) selectPath(nodePath(doc, n) || []); }
    else selectPath([]);
  }
  function startDrag(kind, node, evt) {
    evt.preventDefault();
    const p = toUser(evt);
    // Spread handle: the ring centre is the cell centre (guaranteed by
    // singleInstancePath before the handle is shown) and the unit is the
    // root's, so the radius maps back exactly.
    if (kind === 'spread') {
      drag = { kind, node, cx: CELL / 2, cy: CELL / 2, unit: CELL * (doc.size == null ? 1 : doc.size), start: { ...node }, p0: p, d0: 1, a0: 0 };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragUp, { once: true });
      return;
    }
    const els = elementsFor(node); const bb = unionBBox(els); if (!bb) return;
    const cx = bb.x + bb.w / 2, cy = bb.y + bb.h / 2;
    // Derive the node's world unit from its rendered size so edits map back
    // to unit-fraction params without re-deriving the nesting chain.
    let unit = CELL * (doc.size || 1);
    if (node.op === 'disc') unit = (bb.w / 2) / (node.r || 0.3);
    else if (node.op === 'poly') unit = (bb.w / 2) / (node.r || 0.45);
    else if (node.op === 'box') unit = bb.w / (node.w || 0.5);
    else if (node.op === 'wedge') unit = bb.w / (node.r || 1);
    drag = { kind, node, cx, cy, unit,
      // Where the shape's centre sits at dx/dy = 0 — the snap target.
      baseCx: cx - (node.dx || 0) * unit,
      baseCy: cy - (node.dy || 0) * unit,
      start: { ...node }, p0: p,
      d0: Math.hypot(p.x - cx, p.y - cy) || 1,
      a0: Math.atan2(p.y - cy, p.x - cx) };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp, { once: true });
  }
  function onDragMove(evt) {
    if (!drag) return;
    const p = toUser(evt); const n = drag.node;
    if (drag.kind === 'move') {
      let ndx = (drag.start.dx || 0) + (p.x - drag.p0.x) / drag.unit;
      let ndy = (drag.start.dy || 0) + (p.y - drag.p0.y) / drag.unit;
      // Snap to the natural centre with a guide flash.
      dragGuides = null;
      if (Math.abs(ndx) < 0.03) { ndx = 0; (dragGuides = dragGuides || {}).x = drag.baseCx; }
      if (Math.abs(ndy) < 0.03) { ndy = 0; (dragGuides = dragGuides || {}).y = drag.baseCy; }
      n.dx = clamp(ndx, -1, 1);
      n.dy = clamp(ndy, -1, 1);
    } else if (drag.kind === 'spread') {
      const d = Math.hypot(p.x - drag.cx, p.y - drag.cy);
      n.radius = clamp(Math.round((d / drag.unit) * 100) / 100, 0, 0.7);
    } else if (drag.kind === 'resize') {
      const ratio = (Math.hypot(p.x - drag.cx, p.y - drag.cy) || 1) / drag.d0;
      if (n.op === 'disc') n.r = clamp((drag.start.r || 0.3) * ratio, 0.02, 0.7);
      else if (n.op === 'poly') n.r = clamp((drag.start.r || 0.45) * ratio, 0.05, 0.7);
      else if (n.op === 'wedge') n.r = clamp((drag.start.r || 1) * ratio, 0.1, 1);
      else if (n.op === 'box') { n.w = clamp((drag.start.w || 0.5) * ratio, 0.05, 1.4); n.h = clamp((drag.start.h || 0.5) * ratio, 0.05, 1.4); }
    } else if (drag.kind === 'rotate') {
      const a = Math.atan2(p.y - drag.cy, p.x - drag.cx);
      const deg = (drag.start.rotate || 0) + (a - drag.a0) * 180 / Math.PI;
      n.rotate = Math.round(((deg + 180) % 360 + 360) % 360 - 180);
    }
    renderStageLight();
  }
  function onDragUp() { window.removeEventListener('pointermove', onDragMove); drag = null; dragGuides = null; pushHistory(); renderProps(); renderLayers(); renderStage(); }

  // ---------------------------------------------------------------------
  // Tile preview (small), palette, presets, library, I/O, JSON
  // ---------------------------------------------------------------------
  function renderTile() {
    clear(elTile);
    if (!IR) return;
    const cols = 4, rows = 4, s = svg('svg', { class: 'es-tilesvg', viewBox: `0 0 ${cols * CELL} ${rows * CELL}` });
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const idx = r * cols + c, rng = rngFor((seed * 2654435761 + idx * 40503) >>> 0);
      try { for (const n of IR.render(doc, { x: c * CELL, y: r * CELL, w: CELL, h: CELL }, { el: svg, color: colorResolver(idx, rng), rng })) s.appendChild(n); } catch {}
    }
    elTile.appendChild(s);
  }
  function renderPalette() {
    clear(elPalette);
    const row = h('div', { class: 'es-pal-row' });
    palette.forEach((c, i) => row.appendChild(h('span', { class: 'es-pal-cell' },
      h('input', { type: 'color', class: 'es-color', value: c, oninput: (e) => { palette[i] = e.target.value; renderStage(); renderLayers(); persist(); } }),
      palette.length > 1 ? h('button', { class: 'es-x', title: 'remove', onclick: () => { palette.splice(i, 1); renderPalette(); renderStage(); renderLayers(); persist(); } }, '×') : null)));
    elPalette.appendChild(row);
    elPalette.appendChild(h('button', { class: 'es-btn es-btn-sm', onclick: () => { palette.push('#888888'); renderPalette(); renderStage(); persist(); } }, '+ colour'));
  }
  function populatePresets() {
    clear(elPresetSel);
    elPresetSel.appendChild(h('option', { value: '' }, 'a preset…'));
    const group = (label, items) => { if (!items.length) return; const g = h('optgroup', { label }); for (const it of items) g.appendChild(h('option', { value: it.id }, it.name)); elPresetSel.appendChild(g); };
    group('presets', presets.map((p, i) => ({ id: 'preset:' + i, name: p.name })));
    if (IR) { group('demos', Object.keys(IR.DEMOS || {}).map((k) => ({ id: 'demo:' + k, name: k }))); group('shapes', Object.keys(IR.SHAPES || {}).map((k) => ({ id: 'shape:' + k, name: k }))); }
  }
  function onPresetPick(e) {
    const val = e.target.value; e.target.value = '';
    if (!val) return;
    const [kind, key] = val.split(':'); let d = null;
    if (kind === 'preset') d = presets[Number(key)] && presets[Number(key)].doc;
    else if (kind === 'demo') d = IR && IR.DEMOS[key];
    else if (kind === 'shape') d = IR && IR.SHAPES[key];
    if (d) loadDoc(clone(d));
  }
  // A motif is designed in a colourway — library entries carry their
  // palette and restore it on load.
  function loadDoc(d, pal) {
    doc = d; selPath = [];
    if (Array.isArray(pal) && pal.length) { palette = pal.slice(); renderPalette(); }
    pushHistory(); refreshAll();
  }

  function renderLibrary() {
    clear(elLibrary);
    if (!library.length) { elLibrary.appendChild(h('div', { class: 'es-muted' }, 'nothing saved yet — shape a motif, then “save”.')); return; }
    const ul = h('ul', { class: 'es-lib-list' });
    library.forEach((item, i) => ul.appendChild(h('li', { class: 'es-lib-item' },
      h('button', { class: 'es-lib-load', onclick: () => loadDoc(clone(item.doc), item.palette) }, item.name),
      h('button', { class: 'es-btn es-btn-sm', onclick: () => downloadDoc(item.doc, item.name) }, '↓'),
      h('button', { class: 'es-x', title: 'delete', onclick: () => { library.splice(i, 1); saveLibrary(library); renderLibrary(); } }, '×'))));
    elLibrary.appendChild(ul);
  }
  function saveToLibrary() {
    const name = (prompt('Name this element:', 'untitled') || '').trim(); if (!name) return;
    const i = library.findIndex((x) => x.name === name);
    const item = { name, doc: clone(doc), palette: palette.slice(), ts: Date.now() };
    if (i >= 0) library[i] = item; else library.push(item);
    saveLibrary(library); renderLibrary();
  }
  function downloadDoc(d, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }));
    const a = h('a', { href: url, download: (name || 'element').replace(/[^a-z0-9_-]+/gi, '-') + '.json' });
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  const exportJSON = () => downloadDoc(doc, opLabel(doc));
  function importJSON() {
    const inp = h('input', { type: 'file', accept: '.json,application/json' });
    inp.addEventListener('change', () => {
      const f = inp.files && inp.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = () => { try { loadDoc(JSON.parse(reader.result)); } catch (err) { alert('Could not parse JSON: ' + err.message); } };
      reader.readAsText(f);
    });
    inp.click();
  }

  function renderJson() { elJson.value = JSON.stringify(doc, null, 2); elJsonMsg.textContent = ''; elJsonMsg.className = 'es-json-msg'; }
  function applyJSON() {
    try { const d = JSON.parse(elJson.value); if (!d || typeof d !== 'object' || !d.op) throw new Error('document needs an "op"'); doc = d; selPath = []; pushHistory(); refreshAll(); elJsonMsg.textContent = '✓ applied'; elJsonMsg.className = 'es-json-msg es-ok'; }
    catch (err) { elJsonMsg.textContent = '✗ ' + err.message; elJsonMsg.className = 'es-json-msg es-err'; }
  }

  function refreshUndo() { if (undoBtn) undoBtn.disabled = hIndex <= 0; if (redoBtn) redoBtn.disabled = hIndex >= history.length - 1; }
  function refreshAll() { renderAdd(); renderLayers(); renderProps(); renderStage(); renderJson(); refreshUndo(); }

  // ---------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------
  function loadScript(src) {
    return new Promise((res, rej) => { if (window.GirardElementIR) return res(); const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('failed to load ' + src)); document.head.appendChild(s); });
  }
  window.addEventListener('keydown', (e) => {
    // Don't steal keys from form fields (typing a value, editing JSON).
    const t = document.activeElement;
    if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateSelected(); return; }
    if (e.key === 'Escape') { selectPath([]); return; }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selPath.length) { e.preventDefault(); deletePath(selPath); return; }
    const step = e.shiftKey ? 0.05 : 0.01;
    if (e.key === 'ArrowLeft'  && nudgeSelected(-step, 0)) e.preventDefault();
    else if (e.key === 'ArrowRight' && nudgeSelected(step, 0)) e.preventDefault();
    else if (e.key === 'ArrowUp'    && nudgeSelected(0, -step)) e.preventDefault();
    else if (e.key === 'ArrowDown'  && nudgeSelected(0, step)) e.preventDefault();
  });

  build();
  renderAdd(); renderLayers(); renderProps(); renderPalette(); renderLibrary(); renderJson();
  elStageWrap.appendChild(h('div', { class: 'es-muted' }, 'loading interpreter…'));
  pushHistory();

  fetch('/posts/element-studio/presets.json')
    .then((r) => (r.ok ? r.json() : [])).then((p) => { presets = Array.isArray(p) ? p : []; })
    .catch(() => { presets = []; })
    .finally(() => {
      loadScript('/posts/girard/element-ir.js')
        .then(() => { IR = window.GirardElementIR; populatePresets(); refreshAll(); })
        .catch((err) => { clear(elStageWrap); elStageWrap.appendChild(h('div', { class: 'es-json-msg es-err' }, '✗ ' + err.message)); });
    });
})();
