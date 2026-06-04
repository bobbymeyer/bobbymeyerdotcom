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
draft: true
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
      <label class='ctrl'>
        <span>aspect (w/h)</span>
        <input id='girard-aspect' type='number' value='1' min='0.2' max='5' step='0.05' />
      </label>
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
    <h4 class='panel-subheading'>export</h4>
    <div class='export-buttons'>
      <button id='girard-export-svg' class='ctrl-inline-btn'>SVG</button>
      <button id='girard-export-png' class='ctrl-inline-btn'>PNG</button>
      <button id='girard-export-jpg' class='ctrl-inline-btn'>JPG</button>
      <button class='ctrl-inline-btn' disabled title='Coming soon'>PDF</button>
      <button class='ctrl-inline-btn' disabled title='Coming soon'>TIF</button>
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
