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
    <div class='h' style='left:330px;top:240px'>design viva</div>
    <div class='p' style='left:210px;top:470px'>a recreation of a poster work by Josef Müller-Brockmann on behalf of musica viva</div>
    <div class='p' style='left:490px;top:380px'>creating a responsive version of this design</div>
    <div class='h red' style='left:290px;top:560px'>bobby</div>
    <div class='h red' style='left:510px;top:590px'>meyer</div>
    <div class='p' style='left:390px;top:740px'>requires careful attention to detail</div>
    <div class='p' style='left:640px;top:660px'>the task involves leveraging CSS grids</div>
    <div class='h blue' style='left:580px;top:740px'>designer</div>
    <div class='p' style='left:450px;top:900px'>and flexbox to preserve the spatial arrangement</div>
    <div class='p' style='left:760px;top:820px'>ensuring the layout maintains its integrity on different screens</div>
    <div class='h indigo' style='left:710px;top:920px'>developer</div>
    <div class='p' style='left:570px;top:1070px'>this means that as the viewport changes size, text elements must reposition smoothly</div>
    <div class='p' style='left:880px;top:1000px'>keeping their deliberate stagger and angle without losing the interactive dance between elements</div>
    <div class='h green' style='left:780px;top:1100px;font-size:84px'>⌘ pixels &amp; bits</div>
    <div class='p' style='left:790px;top:1200px'>the goal is to maintain legibility and visual impact — <strong>striking a balance between the fluidity of responsive design and staying true to the original artistic intent</strong></div>
  </div>
</div>