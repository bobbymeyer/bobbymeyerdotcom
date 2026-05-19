---
title:  "design viva"
date:   2023-12-13 10:31:00 -0800
summary: a responsive recreation of a Müller-Brockman poster
custom_css: viva
width: 2
height: 3
tags:
- html
- css
- graphic-design
- design-history
---
<h2>recreating a design classic</h2>
<div class='grid md:grid-cols-2'>
  <div>
    <p>This is a recreation of a poster work by Josef Müller-Brockmann on behalf of musica viva. Creating a responsive version of this design requires careful attention to detail. The task involves leveraging CSS grids and flexbox to preserve the spatial arrangement ensuring that the layout maintains its integrity on different screens. This means that as the viewport changes size the text elements must reposition smoothly keeping their deliberate stagger and angle without losing the interactive dance between the elements.</p>
    <br>
    <p>The goal is to maintain legibility and visual impact, scaling elements proportionately ensuring that the design's essence is communicated effectively no matter the device, striking a balance between the fluidity of responsive design and staying true to the original artistic intent.</p>
    <br>
    <i>Resize your browser window for the full effect.</i>
  </div>
  <div class='flex flex-col items-center md:items-end py-4'>
    <img src='/posts/viva/viva.jpg'>
    <small>The Müller-Brockmann Original</small>
  </div>
</div>
<div class='poster-container'>
  <div class='poster-stage'>
    <div class='poster-grid'>
      <!-- R0 H -->
      <h1 style='grid-column:1/-1'>design viva</h1>
      <!-- R1 C -->
      <p style='grid-column:1'>a recreation of a poster work by Josef Müller-Brockmann on behalf of musica viva</p>
      <p style='grid-column:3'>creating a responsive version of this design</p>
      <!-- R2 H -->
      <h1 class='red' style='grid-column:1'>bobby</h1>
      <h1 class='red' style='grid-column:3'>meyer</h1>
      <!-- R3 C -->
      <p style='grid-column:1'>requires careful attention to detail</p>
      <p style='grid-column:3'>the task involves leveraging CSS grids</p>
      <!-- R4 H -->
      <h1 class='blue' style='grid-column:3'>designer</h1>
      <!-- R5 C -->
      <p style='grid-column:1'>and flexbox to preserve the spatial arrangement</p>
      <p style='grid-column:3'>ensuring the layout maintains its integrity on different screens</p>
      <!-- R6 H -->
      <h1 class='indigo' style='grid-column:3'>developer</h1>
      <!-- R7 C -->
      <p style='grid-column:1'>this means that as the viewport changes size, text elements must reposition smoothly</p>
      <p style='grid-column:3'>keeping their deliberate stagger and angle without losing the interactive dance between elements</p>
      <!-- R8 H -->
      <h1 class='green' style='grid-column:1/-1;font-size:60px'>⌘ pixels &amp; bits</h1>
      <!-- R9 C -->
      <p style='grid-column:3'>the goal is to maintain legibility and visual impact — <strong>striking a balance between the fluidity of responsive design and staying true to the original artistic intent</strong></p>
    </div>
  </div>
</div>