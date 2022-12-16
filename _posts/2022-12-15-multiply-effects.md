---
layout: post
title:  "Multiply Effects in CSS"
date:   2022-12-15 10:31:00 -0800
summary:
tags:
- design
- photography
- css
---
<div class='grid md:grid-cols-2 gap-4'>
  <figure class='text-sm italic'>
    <img src="{{site.baseurl}}/assets/img/buckminster-fuller.jpg" class="mix-blend-multiply grayscale w-full">
    <caption>Our example models, Buckminster Fuller and his Geodesic Dome</caption>
  </figure>
  <div markdown=1 class='flex flex-col gap-4'>
  Desaturating a photo and setting the blending mode to multiply can be a useful technique, particulary in monochrome designs. It helps maintain a cohesive look and feel, and can also contribute to a more dramatic, moody look.

  Desaturating a photo means reducing the saturation of its colors, or removing the color entirely and turning it into a grayscale image. This can be useful in monochrome designs because it allows you to create a cohesive look using different shades of gray, rather than using a variety of colors.

  Setting the blending mode to multiply in this case can help to create darker tones and add depth to the design. Multiply blending mode multiplies the colors of the layer being blended with the colors of the layer below it, resulting in a darker image. This can be useful in monochrome designs because it allows you to create a range of shades using a single color channel.
  </div>
</div>




{% highlight css %}
/* CSS Snippet */
img {
  filter: grayscale(0);
  mix-blend-mode: multiply;
}
{% endhighlight %}