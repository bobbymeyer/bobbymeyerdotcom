---
title:  "Procedurally Illustrating with p5.js"
date:   2022-12-15 10:31:00 -0800
summary: Illustrating procedurally in the DOM
custom_css: illustration
thumbnail: cover.jpg
width: 3
height: 4
tags:
- art
- graphic-design
- procedural-generation
- p5js
custom_js: illustration
p5js: true
---
I stumbled upon [this illustration](/public/posts/p5js-illustration/cristiana-couceiro.jpg) by [Christiana Couceiro](https://cristianacouceiro.com/). Her work is very good, and I noticed it had a modularity to it that lends itself to procedural generation.

<div class='my-8 flex flex-row-reverse'>
<a href='#.button' onclick="window.location.reload(true);">
  <span id='button' class='bg-white hover:bg-gray-200 transition-all rounded p-2'>
    Generate a New Illustration
  </span>
</a>
</div>

  <div id="p5js" class=''></div>

