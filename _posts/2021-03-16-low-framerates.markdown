---
layout: posts
title:  "Low Frame Rates and Slow Loading times in P5js"
date:   2021-03-16 9:00:00 -0800
categories: code
tags: 
- javascript
- p5js
- design
---
I have been making sketches lately that use low frame rates. Usually, you set your frame rate in the setup function, as it is generally a static value. When you do this with a particularly low framerate, it creates a noticeable delay before loading the sketch. Refresh the page to see an example below.

<iframe src="https://editor.p5js.org/bobbymeyer/embed/4MVuKraNE"
        style="width: 400px; 
              height: 400px; 
              overflow: hidden;"  
        scrolling="no" 
        frameborder="0">
</iframe>
<i>Slow loading code</i>
{% highlight javascript %}

function setup() {
  createCanvas(400, 400);
  frameRate(0.5);
}

function draw() {
  background(50);
  fill(random(50,200), random(50,200), random(50,200));
  noStroke();
  square(100, 100, 200);
}

{% endhighlight %}

To solve this problem, use a reasonably quick framerate in the setup (30fps). Then set the framerate down to the desired rate (0.5fps) in the draw function. Refresh again to see a faster load.

<iframe src="https://editor.p5js.org/bobbymeyer/embed/c5kniDVTR"
        style="width: 400px; 
              height: 400px; 
              overflow: hidden;"  
        scrolling="no" 
        frameborder="0"></iframe>

<i>Fast loading code</i>
{% highlight javascript %}
function setup() {
  createCanvas(400, 400);
  frameRate(30);
}

function draw() {
  frameRate(0.5);
  background(50);
  fill(random(50,200), random(50,200), random(50,200));
  noStroke();
  square(100, 100, 200);
}
{% endhighlight %}

<br>