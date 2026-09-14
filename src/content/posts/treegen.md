---
sketch: treegen
draft: false
---

Click anywhere on the stage to place a point. **The first point you place sets
the horizon** — everything above it is canopy, everything below is root.

**Only the points snap to the grid.** A branch is a straight line between two of
them, at whatever angle and length that takes — it doesn't walk the lattice, so
nothing staircases. Click somewhere distant and you get one long branch, not a
chain of little steps.

Points stay invisible until you put the cursor on one, so the tree isn't
peppered with dots. Drag one and it takes everything downstream with it —
you're moving a limb, and the branch above it simply stretches. **Right-click a
point to cut it**, and everything past it goes too.

<div id='treegen'>
  <div id='tg-head'>
    <h1>treegen<sup class='tg-version'>v0.01a</sup></h1>
    <p class='tg-sub'>a tool for growing trees on a grid</p>
  </div>
  <div class='tg-bar'>
    <div class='tg-group'>
      <span class='tg-label'>structure</span>
      <select id='tg-grid' title='lattice'></select>
      <label class='tg-check' title='Strahler order at which the stem stops being trunk — higher ends the trunk lower'>trunk<input type='number' id='tg-trunk' min='1' max='6' step='1' value='2'></label>
      <button id='tg-clear' class='tg-btn'>clear</button>
    </div>
    <div class='tg-group'>
      <span class='tg-label'>look</span>
      <button id='tg-roll' class='tg-btn'>roll seed</button>
      <code id='tg-seed' class='tg-readout'>1</code>
      <select id='tg-palette' title='palette'></select>
      <label class='tg-check' title='rings of leaf cells around each branch'>layers<input type='number' id='tg-layers' min='0' max='5' step='1' value='2'></label>
    </div>
    <div class='tg-group'>
      <span class='tg-label'>season</span>
      <button id='tg-next' class='tg-btn'>next season</button>
      <label class='tg-check' title='extend the tree by one l-system step each spring'><input type='checkbox' id='tg-grow'> grow</label>
      <code class='tg-readout'><span id='tg-season'>spring</span> · yr <span id='tg-year'>1</span></code>
      <label class='tg-check'><input type='checkbox' id='tg-auto'> auto</label>
      <input type='number' id='tg-interval' min='1' max='60' step='1' value='4' title='seconds per season'>
      <span class='tg-unit'>s</span>
    </div>
    <div class='tg-group'>
      <span class='tg-label'>file</span>
      <button id='tg-save' class='tg-btn'>save json</button>
      <label class='tg-btn tg-file'>load<input type='file' id='tg-load' accept='application/json'></label>
      <button id='tg-export' class='tg-btn'>export svg</button>
    </div>
  </div>
  <details id='tg-lsys'>
    <summary>l-system</summary>
    <div class='tg-lsys-body'>
      <label class='tg-field'><span>axiom</span><input type='text' id='tg-ls-axiom' value='F'></label>
      <label class='tg-field tg-field-wide'><span>rules</span><textarea id='tg-ls-rules' rows='3' spellcheck='false'>F -> F[+F][-F]F</textarea></label>
      <label class='tg-field'><span>iterations</span><input type='number' id='tg-ls-iters' min='0' max='8' value='5'></label>
      <label class='tg-field'><span>angle</span><input type='number' id='tg-ls-angle' min='5' max='120' value='35'></label>
      <label class='tg-field' title='branch length, in grid steps'><span>segment</span><input type='number' id='tg-ls-step' min='1' max='8' step='1' value='2'></label>
      <label class='tg-field' title='how far branches may depart from the exact rule, 0-100'><span>variation</span><input type='number' id='tg-ls-jitter' min='0' max='100' step='5' value='35'></label>
      <label class='tg-field' title='depth of the root system below the horizon; 0 for none'><span>roots</span><input type='number' id='tg-ls-roots' min='0' max='6' step='1' value='3'></label>
      <button id='tg-ls-run' class='tg-btn'>generate</button>
    </div>
  </details>
  <div id='tg-canvas'></div>
  <p id='tg-status' class='tg-status'></p>
</div>

### vegetation is never placed by hand

There is no way to put a leaf somewhere. Foliage comes from rules evaluated
against the graph — how deep a node is, whether it's a tip or an interior node,
how thick the branch is, and a seeded coin flip. Those are properties of shape
alone, so the same rules work identically whether you drew the tree or grew it.
Leaves fill whole grid cells, so the canopy reads as a mass on the lattice
rather than marks scattered near it. The **layers** control sets how many rings
of cells around each branch can hold foliage.

Colour runs in two stages. First every object takes a **grayscale tone** from
its position in the graph, knowing nothing about colour. Then a separate step
maps tone onto a swatch. That split is why switching palette never disturbs the
design underneath — and why autumn needs no special machinery at all. Fall is
the second stage re-run against a different swatch list: same objects, same
tones, new colours.

### the trunk is found, not drawn

From the root, follow the dominant branch at every fork — the one carrying the
highest Strahler order, which is what "main channel" means in a branching
network. That path is the trunk. It grows nothing and no neighbouring foliage
may cover it, so the main stem always reads as wood. The **trunk** control sets
where the stem stops counting as trunk: order falls as you move outward and
order 1 is a twig, so the number reads as *how thick a branch must still be to
be stem*.

### seasons, and growing

Seasons run in the real order and only forward. Spring fades foliage in from the
trunk outward; summer adds blossom and fruit; fall recolours; winter drops every
leaf on a sine-wave path with the swing narrowing as it falls, fading out before
it reaches the ground line. Each object keeps a stable identity across all four,
which is what makes those transitions continuous rather than four unrelated
pictures.

Turn on **grow** and the tree puts on growth each spring — extending from its
tips rather than regenerating, so everything from earlier years survives.
Branches mature as they thicken: past a Strahler threshold a limb stops bearing
foliage and sheds its fine twigs, which come away in winter along with the
leaves. That is what opens the inside of an older crown. The canvas zooms out on
its own as the tree outgrows its world.

### seeds

Everything stochastic is seeded and reproducible: the Voronoi sites, the
l-system, vegetation placement, tone, palette substitution, growth, and every
leaf's fall. Each draws from its own named stream, so rolling the seed changes
the canopy without touching the tree you drew, and a leaf's fall never changes
because you added a branch somewhere else.

Save the JSON to keep a tree — that's the real document. SVG export is one-way:
a snapshot of the current season, not something you can load back in.
