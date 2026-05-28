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
      <p class='hint'>seed + repeat. more knobs landing soon.</p>
    </header>
    <label class='ctrl'>
      <span>seed</span>
      <input id='girard-seed' type='number' value='1' min='0' max='99999' />
    </label>
    <button id='girard-roll' class='ctrl'>roll a new seed</button>
    <label class='ctrl'>
      <span>repeat</span>
      <select id='girard-repeat'>
        <option value='square'>square</option>
        <option value='half-drop'>half-drop</option>
        <option value='half-brick'>half-brick</option>
        <option value='hex'>hex</option>
      </select>
    </label>
    <label class='ctrl'>
      <span>density</span>
      <input id='girard-density' type='range' min='2' max='12' step='1' value='6' />
    </label>
  </aside>
</div>
