---
title: "girard"
date: 2026-05-28 10:00:00 -0800
summary: a tool for building infinitely repeatable textile patterns
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
        </select>
      </label>
      <label class='ctrl'>
        <span>surround veil</span>
        <input id='girard-veil' type='range' min='0' max='1' step='0.05' value='0.5' />
      </label>
      <label class='ctrl'>
        <span>sample</span>
        <select id='girard-sample'></select>
      </label>
      <button id='girard-load-sample' class='ctrl'>load sample</button>
    </div>
    <div id='girard-layer-panel'>
      <div class='layer-panel-header'>
        <h3>layers</h3>
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
      </div>
      <ul id='girard-layer-list'></ul>
      <div id='girard-layer-config'></div>
    </div>
  </aside>
</div>
