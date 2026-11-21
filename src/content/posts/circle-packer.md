---
title: ⭕ circle packer
summary: a poster of packed circles, after Kusama Yayoi
date: 2026-10-31
color: orange
splash: /posts/circle-packer/splash.png
sketch: circle-packer
tags: [post, generative, typography]
stack: [typescript]
---

<div id="circle-packer"></div>

The layout follows a Kusama Yayoi exhibition poster: a heavy headline, a small
line of type level with its top, a field of black circles below, and a red bar
of upright type that starts in the headline and cuts into the field. Every line
of type on the sheet comes from the controls. The headline takes one word per
line and shrinks only if a word would run into the small text or the bar.

Circles keep arriving in the roomiest gaps they can find and grow until they
meet something: another circle, the edge of the field or the bar. Each one is
given a share of the space when it arrives. Most get a small share and a few
get a large one, which gives the field big circles with small ones filling the
gaps between them.

Each circle also has its own resistance. Under pressure, a stubborn one holds
its size and pushes back, and a soft one gives way and shrinks. Turn **max
resistance** up and the packing gets tighter and more crowded. Turn it down and
the circles settle into an even field.

Whatever is in **shape text**, a triangle to start with, is packed into the
field in the same red as the bar. The shape is never drawn. It is a mask, and a
circle that ends up mostly inside it takes the accent colour, so the figure
appears from the packing. Words work too, one line each. Circles inside the shape are set small so the edges read
cleanly, and they grow again over the **falloff distance**. The circles never
measure that distance themselves: one distance field is worked out per run,
and each circle looks up its size from that.

Change the type or the size controls and the run starts again. Change the count
and it carries on from where it is.
