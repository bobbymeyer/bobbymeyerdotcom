---
title: ⭕ circle packer
summary: a poster packed around a word
date: 2026-10-31
color: orange
splash: /posts/circle-packer/splash.png
sketch: circle-packer
tags: [post, generative, typography]
stack: [typescript]
---

<div id="circle-packer"></div>

Type a few words and the poster packs itself around them. Each word gets its own
line, set as wide as the box allows, and that lettering is never drawn. It is a
mask. Circles keep arriving in the roomiest gaps they can find and grow until
they meet something. A circle that ends up mostly inside a letter takes the
shape colour, so the type appears from the packing.

Each circle has its own resistance. Under pressure, a stubborn one holds its
size and pushes back, and a soft one gives way and shrinks. Turn **max
resistance** up and the packing gets tighter and more crowded. Turn it down and
the circles settle into an even field.

Size depends on distance from the type. Circles inside the letters are set
small, so the edges read cleanly. Away from the letters they grow, and the
change happens over the **falloff distance**. The circles never measure that
distance themselves: one distance field is worked out per run, and each circle
looks up its size from that.

Change the size controls and the run starts again. Change the count and it
carries on from where it is.
