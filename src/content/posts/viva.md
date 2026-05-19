---
title:  "design viva"
date:   2023-12-13 10:31:00 -0800
summary: a responsive recreation of a Müller-Brockman poster
custom_css: viva
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
    <!-- Headline / caption registers alternate, stepping down the
         diagonal. Within a register, items lie along the text
         reading axis (rotated -45deg). -->
    <!-- R0 H -->
    <div class='h' style='left:250px;top:280px'>design viva</div>
    <!-- R1 C -->
    <div class='p' style='left:260px;top:430px'>a recreation of a poster work by Josef Müller-Brockmann on behalf of musica viva</div>
    <div class='p' style='left:360px;top:330px'>creating a responsive version of this design</div>
    <!-- R2 H -->
    <div class='h red' style='left:320px;top:520px'>bobby</div>
    <div class='h red' style='left:440px;top:400px'>meyer</div>
    <!-- R3 C -->
    <div class='p' style='left:390px;top:610px'>requires careful attention to detail</div>
    <div class='p' style='left:490px;top:510px'>the task involves leveraging CSS grids</div>
    <!-- R4 H -->
    <div class='h blue' style='left:510px;top:660px'>designer</div>
    <!-- R5 C -->
    <div class='p' style='left:520px;top:810px'>and flexbox to preserve the spatial arrangement</div>
    <div class='p' style='left:620px;top:710px'>ensuring the layout maintains its integrity on different screens</div>
    <!-- R6 H -->
    <div class='h indigo' style='left:640px;top:860px'>developer</div>
    <!-- R7 C -->
    <div class='p' style='left:650px;top:1010px'>this means that as the viewport changes size, text elements must reposition smoothly</div>
    <div class='p' style='left:750px;top:910px'>keeping their deliberate stagger and angle without losing the interactive dance between elements</div>
    <!-- R8 H -->
    <div class='h green' style='left:770px;top:1060px;font-size:84px'>⌘ pixels &amp; bits</div>
    <!-- R9 C -->
    <div class='p' style='left:840px;top:1170px'>the goal is to maintain legibility and visual impact — <strong>striking a balance between the fluidity of responsive design and staying true to the original artistic intent</strong></div>
  </div>
</div>