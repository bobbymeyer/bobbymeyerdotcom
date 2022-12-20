---
layout: 'p5js'
title:  "Procedurally Illustrating with p5.js"
date:   2022-12-15 10:31:00 -0800
summary: Spending less time and money at the grocery store
custom_css: illustration
tags:
- art
- graphic-design
- procedural-generation
- p5js
---
I stumbled upon this illustration by [Christiana Couceiro](https://cristianacouceiro.com/), and I quite liked it. I also noticed it had a modularity to it that I thought could make a good model for a piece of procedural generation.

<div class='my-8 flex flex-row-reverse'>
<a href='#.button' onclick="window.location.reload(true);">
  <span id='button' class='bg-white hover:bg-gray-200 transition-all rounded p-2'>
    Generate a New Illustration
  </span>
</a>
</div>

<div class='grid md:grid-cols-2 gap-4'>
  <div markdown=1>
  ![](cristiana-couceiro.jpg)
  {: .w-full}
  **Original Illustration** by [Cristiana Couceiro](https://cristianacouceiro.com/)
  </div>
  <div id="p5js" class=''></div>
</div>

<script src="illustration.js" >

