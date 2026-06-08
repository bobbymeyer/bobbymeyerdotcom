---
title: "girard"
version: "0.01a"
hide_header: true
date: 2026-05-28 10:00:00 -0800
summary: a tool for building infinitely repeatable patterns
custom_css: girard
custom_js: girard
thumbnail: cover.png
width: 3
height: 3
draft: false
tags:
- tool
- generative
- textile
- pattern
---
<div id='girard'>
  <div id='girard-title'>
    <h1>girard<sup class='girard-version'>v0.01a</sup></h1>
    <p class='girard-subtitle'>a tool for building infinitely repeatable patterns</p>
  </div>
  <h3 id='girard-composition-label' class='panel-heading'>project settings</h3>
  <h3 id='girard-layers-label' class='panel-heading'>layers</h3>

  <aside id='girard-composition' class='girard-panel'>
    <div class='ctrl-row'>
      <button id='girard-samples-open' class='ctrl-inline-btn' title='Browse the sample library'>sample library</button>
      <!-- Hidden until the library modal lands; preserves the existing
           load-by-name handler so nothing else has to change yet. -->
      <select id='girard-sample' class='is-hidden'></select>
      <button id='girard-load-sample' class='is-hidden'>load</button>
    </div>
    <details class='girard-section' open>
      <summary>rng<span class='section-hint' id='girard-rng-hint'></span></summary>
      <div class='ctrl-row'>
        <div class='ctrl ctrl-inline'>
          <span>seed</span>
          <div class='ctrl-inline-row'>
            <input id='girard-seed' type='number' value='1' min='0' max='99999' />
            <button id='girard-roll' class='ctrl-inline-btn'>roll</button>
          </div>
        </div>
      </div>
    </details>
    <details class='girard-section'>
      <summary>tile<span class='section-hint' id='girard-tile-hint'></span></summary>
      <div class='ctrl-row'>
        <label class='ctrl'>
          <span>repeat style</span>
          <select id='girard-repeat'>
            <option value='square'>square</option>
            <option value='half-drop'>half-drop</option>
            <option value='half-brick'>half-brick</option>
            <option value='drop'>drop (custom %)</option>
            <option value='brick'>brick (custom %)</option>
            <option value='mirror-x'>mirror horizontal</option>
            <option value='mirror-y'>mirror vertical</option>
            <option value='mirror-xy'>mirror both (kaleidoscope)</option>
          </select>
        </label>
        <label class='ctrl' id='girard-repeat-fraction-wrap'>
          <span>offset %</span>
          <input id='girard-repeat-fraction' type='number' value='50' min='0' max='100' step='1' />
        </label>
        <div class='ctrl ctrl-inline'>
          <span>aspect (w : h)</span>
          <div class='ctrl-inline-row aspect-inputs'>
            <input id='girard-aspect-w' type='number' value='1' min='1' max='999' step='1' />
            <span class='aspect-sep'>:</span>
            <input id='girard-aspect-h' type='number' value='1' min='1' max='999' step='1' />
          </div>
        </div>
        <div class='ctrl ctrl-inline'>
          <span>physical size</span>
          <div class='ctrl-inline-row'>
            <input id='girard-physical-repeat' type='number' value='24' min='0.1' max='999' step='0.1' />
            <select id='girard-physical-unit'>
              <option value='in'>in</option>
              <option value='cm'>cm</option>
            </select>
          </div>
        </div>
      </div>
    </details>
    <details class='girard-section' open>
      <summary>palette<span class='section-hint' id='girard-palette-hint'></span></summary>
      <p class='icc-status'>Rows are colour <em>roles</em>; columns are colourways. A cell you set is explicit; faint cells are auto-derived from that colourway's base. Layers paint by role, so switching colourways recolours everything.</p>
      <div id='girard-colorway-matrix' class='girard-colorway-matrix'></div>
      <details class='girard-subsection' id='girard-derive-roles'>
        <summary>recolour active colourway from a scheme</summary>
        <div class='ctrl-row'>
          <div class='ctrl ctrl-inline'>
            <span>scheme</span>
            <div class='ctrl-inline-row'>
              <select id='girard-palette-scheme'>
                <option value='analogous'>analogous (±30°)</option>
                <option value='complement'>complementary</option>
                <option value='split'>split complementary</option>
                <option value='triad'>triadic (120°)</option>
                <option value='square'>tetradic / square (90°)</option>
                <option value='tonal'>tonal (muted drift)</option>
                <option value='mono'>mono (single hue)</option>
                <option value='value-ramp'>value ramp</option>
                <option value='hue-ramp'>hue ramp</option>
              </select>
              <input id='girard-palette-count' type='number' value='4' min='1' max='15' step='1' title='accent role count' />
              <button id='girard-palette-apply' class='ctrl-inline-btn'>apply</button>
            </div>
          </div>
        </div>
        <p class='icc-status'>Sets the active colourway's accent colours from its base. Other colourways are left alone; ground / ink are kept. Switch the active colourway to recolour a different one.</p>
      </details>
    </details>
    <details class='girard-section'>
      <summary>colour<span class='section-hint' id='girard-colour-hint'></span></summary>
      <div class='ctrl-row'>
        <label class='ctrl'>
          <span>mode</span>
          <select id='girard-color-mode'>
            <option value='srgb'>sRGB (screen / digital)</option>
            <option value='cmyk'>CMYK (print)</option>
          </select>
        </label>
        <label class='ctrl' id='girard-icc-profile-wrap'>
          <span>icc profile</span>
          <select id='girard-icc-profile'></select>
        </label>
        <label class='ctrl ctrl-checkbox' id='girard-soft-proof-wrap'>
          <input id='girard-soft-proof' type='checkbox' />
          <span>soft proof on stage</span>
        </label>
      </div>
      <details class='girard-subsection' id='girard-icc-advanced'>
        <summary>advanced ICC</summary>
        <div class='ctrl-row'>
          <button id='girard-icc-load' class='ctrl-inline-btn icc-load-btn'
            title='Load the built-in ICC profiler for gamma-correct, K-generated CMYK math.'>load ICC profiler</button>
          <label class='ctrl-inline-btn icc-load-btn' for='girard-icc-file' style='cursor:pointer;'
            title='Drop in a vendor .icc file for press-accurate LUT-based conversion.'>
            load .icc file…
          </label>
          <input id='girard-icc-file' type='file' accept='.icc,.icm,application/vnd.iccprofile' style='display:none;' />
        </div>
        <p id='girard-icc-status' class='icc-status'>Fast math conversion in use. Load profiler for ICC-accurate colour.</p>
      </details>
    </details>
    <details class='girard-section'>
      <summary>shapes<span class='section-hint' id='girard-shapes-hint'></span></summary>
      <div class='ctrl-row'>
        <label class='ctrl-inline-btn' for='girard-shape-file' style='cursor:pointer;'>
          import SVG…
        </label>
        <input id='girard-shape-file' type='file' accept='.svg,image/svg+xml' multiple style='display:none;' />
      </div>
      <div id='girard-shape-list' class='girard-shape-list'></div>
      <p class='icc-status'>SVG paths render with the cell's palette colour. Pasting an icon from Iconify, Heroicons, etc. works as long as it has a viewBox.</p>
    </details>
    <details class='girard-section'>
      <summary>export<span class='section-hint' id='girard-export-hint'></span></summary>
      <div class='ctrl-row'>
        <label class='ctrl'>
          <span>size (px, longer side)</span>
          <input id='girard-export-width' type='number' value='1024' min='64' max='8192' step='32' />
        </label>
        <label class='ctrl ctrl-checkbox'>
          <input id='girard-export-flatten' type='checkbox' />
          <span>flatten alpha onto background</span>
        </label>
        <label class='ctrl' id='girard-export-bg-wrap'>
          <span>background (when flattening)</span>
          <input id='girard-export-bg' type='color' value='#ffffff' />
        </label>
      </div>
      <div class='export-buttons'>
        <button id='girard-export-svg' class='ctrl-inline-btn'>SVG</button>
        <button id='girard-export-png' class='ctrl-inline-btn'>PNG</button>
        <button id='girard-export-jpg' class='ctrl-inline-btn'>JPG</button>
        <button id='girard-export-pdf' class='ctrl-inline-btn'>PDF</button>
        <button id='girard-export-tif' class='ctrl-inline-btn'>TIF</button>
      </div>
    </details>
  </aside>
  <div id='girard-stage-wrap'>
    <div id='girard-stage'></div>
    <div id='girard-stage-tools'>
      <span class='girard-history'>
        <button id='girard-undo' class='ctrl-inline-btn' title='Undo (⌘Z / Ctrl+Z)' disabled>↶ undo</button>
        <button id='girard-redo' class='ctrl-inline-btn' title='Redo (⌘⇧Z / Ctrl+Y)' disabled>↷ redo</button>
      </span>
      <button id='girard-yardage-open' class='ctrl-inline-btn' title='Open full-screen yardage preview'>yardage</button>
      <label class='stage-veil' title='Dim the surrounding tile margins'>
        <span>veil</span>
        <input id='girard-veil' type='range' min='0' max='1' step='0.05' value='0.2' />
        <button id='girard-veil-preview' class='ctrl-inline-btn' aria-pressed='false'>preview</button>
      </label>
    </div>
  </div>
  <aside id='girard-layers' class='girard-panel'>
    <select id='girard-add-layer'>
      <option value=''>+ add layer…</option>
      <option value='solid'>solid</option>
      <option value='h-stripes'>horizontal stripes</option>
      <option value='v-stripes'>vertical stripes</option>
      <option value='brick'>brick</option>
      <option value='checker'>checker</option>
      <option value='dots'>dots</option>
      <option value='random'>random shapes</option>
    </select>
    <ul id='girard-layer-list'></ul>
    <div id='girard-layer-config'></div>
  </aside>
</div>

<div id='girard-samples-modal' class='girard-modal' aria-hidden='true'>
  <div class='girard-modal-controls'>
    <span class='girard-modal-title'>sample library</span>
    <input id='girard-samples-search' type='search' placeholder='search…' class='girard-samples-search' />
    <span id='girard-samples-count' class='girard-modal-size'></span>
    <button id='girard-samples-close' class='girard-modal-close' title='Close (Esc)'>×</button>
  </div>
  <div id='girard-samples-tags' class='girard-samples-tags'></div>
  <div id='girard-samples-grid' class='girard-samples-grid'></div>
</div>

<div id='girard-yardage-modal' class='girard-modal' aria-hidden='true'>
  <div class='girard-modal-controls'>
    <span class='girard-modal-title'>yardage</span>
    <label class='girard-modal-tiles'>
      <span>tiles</span>
      <select id='girard-yardage-tiles'>
        <option value='2'>2 × 2</option>
        <option value='3'>3 × 3</option>
        <option value='4' selected>4 × 4</option>
        <option value='6'>6 × 6</option>
        <option value='8'>8 × 8</option>
      </select>
    </label>
    <span id='girard-yardage-size' class='girard-modal-size'></span>
    <button id='girard-yardage-close' class='girard-modal-close' title='Close (Esc)'>×</button>
  </div>
  <div id='girard-yardage-stage' class='girard-modal-stage'></div>
</div>

<p class='girard-repo'>
  named for <a href='https://en.wikipedia.org/wiki/Alexander_Girard' target='_blank' rel='noopener'>Alexander Girard</a>. source on <a href='https://github.com/bobbymeyer/bobbymeyerdotcom/tree/main/public/posts/girard' target='_blank' rel='noopener'>github</a>.
</p>
