---
title: "girard"
date: 2026-05-28 10:00:00 -0800
summary: a tool for building infinitely repeatable textile patterns
custom_css: girard
custom_js: girard
thumbnail: cover.png
width: 6
height: 4
tags:
- tool
- generative
- textile
- pattern
---
<div id='girard'>
  <div id='girard-stage'></div>
  <aside id='girard-controls'>
    <header>
      <h2>girard <small>v0</small></h2>
    </header>
    <div class='ctrl-row'>
      <label class='ctrl'>
        <span>seed</span>
        <input id='girard-seed' type='number' value='1' min='0' max='99999' />
      </label>
      <button id='girard-roll' class='ctrl'>roll seed</button>
      <label class='ctrl'>
        <span>repeat</span>
        <select id='girard-repeat'>
          <option value='square'>square</option>
          <option value='half-drop'>half-drop</option>
          <option value='half-brick'>half-brick</option>
          <option value='hex'>hex</option>
        </select>
      </label>
    </div>
    <div id='girard-layer-panel'>
      <div class='layer-panel-header'>
        <h3>layers</h3>
        <select id='girard-add-layer'>
          <option value=''>+ add layer…</option>
          <option value='solid'>solid</option>
          <option value='regular:striped'>striped</option>
          <option value='regular:checkered'>checkered</option>
          <option value='regular:triangular'>triangular</option>
          <option value='regular:hex'>hex</option>
          <option value='randomized'>randomized</option>
        </select>
      </div>
      <ul id='girard-layer-list'></ul>
      <div id='girard-layer-config'></div>
    </div>
  </aside>
</div>
