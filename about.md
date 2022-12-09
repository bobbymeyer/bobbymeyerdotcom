---
layout: default
title: "about"
---

<div class='lg:w-1/2 xs:1/3' markdown=1>
<div class='flex items-start mb-8'>
  <h1 class='text-teal-600'>about</h1>
  <img src="{{site.url}}/assets/img/logo-rose.svg" class="h-4">
</div>
<div class='border-b-4 border-black'>
<div class="h-80 w-80 cover bg-gradient-to-b mx-auto from-rose-500 to-purple-400 rounded-full flex justify-center items-end">
<img src="{{site.url}}/assets/img/bobby.png" class="h-64">
</div>
</div>
My name is **Bobby Meyer**. I am a designer and a developer. I have a passion for creating simple, elegant solutions to complex problems.

I write clean, well tested code.

I design attractive, intuitive interfaces.

I create applications that are functional and appealing. Whether I am building a web application from scratch or working on a team to bring a client's vision to life, I am committed to delivering high-quality work that meets the needs of my clients.

<ul class="flex gap-4 flex-wrap mt-16">
  <b>I post about...</b>
  {% assign sorted_items = site.tags | sort %}
  {% for item in sorted_items %}
    <li>{{ item[0] }}</li>
  {% endfor %}
</ul>
</div>
