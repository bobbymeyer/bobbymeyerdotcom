---
title: "girard"
version: "0.01a"
hide_header: true
date: 2026-05-28 10:00:00 -0800
summary: a tool for building infinitely repeatable patterns
custom_css: girard
custom_js: girard
thumbnail: cover.png
width: 6
height: 4
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
      <div class='ctrl ctrl-inline'>
        <span>seed</span>
        <div class='ctrl-inline-row'>
          <input id='girard-seed' type='number' value='1' min='0' max='99999' />
          <button id='girard-roll' class='ctrl-inline-btn'>roll</button>
        </div>
      </div>
      <label class='ctrl'>
        <span>repeat</span>
        <select id='girard-repeat'>
          <option value='square'>square</option>
          <option value='half-drop'>half-drop</option>
          <option value='half-brick'>half-brick</option>
        </select>
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
        <span>surround veil</span>
        <div class='ctrl-inline-row'>
          <input id='girard-veil' type='range' min='0' max='1' step='0.05' value='0.2' />
          <button id='girard-veil-preview' class='ctrl-inline-btn' aria-pressed='false'>preview</button>
        </div>
      </div>
      <div class='ctrl ctrl-inline'>
        <span>sample</span>
        <div class='ctrl-inline-row'>
          <select id='girard-sample'></select>
          <button id='girard-load-sample' class='ctrl-inline-btn'>load</button>
        </div>
      </div>
    </div>
    <h4 class='panel-subheading'>colour</h4>
    <div class='ctrl-row'>
      <label class='ctrl'>
        <span>mode</span>
        <select id='girard-color-mode'>
          <option value='srgb'>sRGB (screen / digital)</option>
          <option value='cmyk'>CMYK (print)</option>
        </select>
      </label>
      <label class='ctrl'>
        <span>icc profile</span>
        <select id='girard-icc-profile'></select>
      </label>
      <button id='girard-icc-load' class='ctrl-inline-btn icc-load-btn'>load ICC profiler</button>
      <label class='ctrl-inline-btn icc-load-btn' for='girard-icc-file' style='cursor:pointer;'>
        load .icc file…
      </label>
      <input id='girard-icc-file' type='file' accept='.icc,.icm,application/vnd.iccprofile' style='display:none;' />
      <label class='ctrl ctrl-checkbox'>
        <input id='girard-soft-proof' type='checkbox' />
        <span>soft proof on stage</span>
      </label>
      <p id='girard-icc-status' class='icc-status'>Fast math conversion in use. Load profiler for ICC-accurate colour.</p>
    </div>
    <h4 class='panel-subheading'>export</h4>
    <div class='ctrl-row'>
      <label class='ctrl'>
        <span>size (px, longer side)</span>
        <input id='girard-export-width' type='number' value='1024' min='64' max='8192' step='32' />
      </label>
      <label class='ctrl ctrl-checkbox'>
        <input id='girard-export-flatten' type='checkbox' />
        <span>flatten alpha onto background</span>
      </label>
      <label class='ctrl'>
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
  </aside>
  <div id='girard-stage'></div>
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

<p class='girard-repo'>
  source on <a href='https://github.com/bobbymeyer/bobbymeyerdotcom/tree/main/public/posts/girard' target='_blank' rel='noopener'>github</a>
</p>
