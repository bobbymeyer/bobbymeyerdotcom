---
layout: posts
title:  "Generating Simple Mid-Century Line Design in P5js"
date:   2021-03-11 10:18:00 -0800
categories: code
tags: 
- javascript
- p5js
- design
---


<iframe src="https://editor.p5js.org/bobbymeyer/embed/PKv3_NBW_"
        style="width: 150px; 
              height: 300px; 
              overflow: hidden;
              float: left;"  
        scrolling="no" 
        frameborder="0"></iframe>

A simple [P5js](https://p5js.org/) sketch which generates minimal designs, with a mid-century flavor, composed of overlapping colored lines. 

With a frame rate of zero, it could be used to generate static sidebar designs. 

Code below.
<div style='clear: both;'>
{% highlight javascript %}
function setup() {
  canvasHeight = 300;
  canvasWidth = 150;
  margin = 20;
  color_a = color(random(5, 255));
  createCanvas(canvasWidth, canvasHeight);
  frameRate(30);
  numberOfLines = 5;
}

function draw() {
  frameRate(.25);
  clear();
  strokeWeight(10);
  set_palette();
  set_lines();
  for (n = numberOfLines; n > 1; n -= 1) {
    stroke(colors[Math.floor(n - 1)]);
    line(
      random(margin, canvasWidth - margin),
      random(margin, 50),
      random(margin, canvasWidth - margin),
      random(canvasHeight - margin, canvasHeight - 50),
    );
  }
}

function set_palette() {
  lerps = []
  color_a = color(random(5, 255), random(5, 255), random(5, 255));
  color_b = color(random(5, 255), random(5, 255), random(5, 255));
  let steps = 1 / (numberOfLines - 2);
  for (let n = numberOfLines; n > 0; n -= 1) {
    let lerp = lerpColor(color_a, color_b, steps * n);
    lerps.push(lerp);
  };
  colors = lerps.reverse();
  colors.unshift(color_a);
  colors.push(color_b);

}

function set_lines() {
  numberOfLines = random(3, 5);
}
{% endhighlight %}