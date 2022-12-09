---
layout: about
title: "about"
---

<div class='grid grid-cols-1 gap-4 lg:w-2/3 xl:w-1/2 mx-auto' markdown=1>
  {% include masthead.html %}
<div class="grid grid-cols-6 gap-8 py-4">




  <h1 class='col-span-6 border-b-2 border-black py-2 text-white text-8xl tracking-tight'>Who am I?</h1>

  <div class='md:col-start-2 col-span-3 grid gap-4' markdown=1>
  My name is **Bobby Meyer**. I am a designer and a developer. I have a passion for creating simple, elegant solutions to complex problems.

  I write clean, well tested code & attractive, intuitive interfaces.

  I create applications that are functional and appealing. Whether I am building a web application from scratch or working on a team to bring a client's vision to life, I am committed to delivering high-quality work that meets the needs of my clients.
  </div>

  <div class="md:col-span-2 flex items-end justify-start">
    <div class="flex gap-2 flex-wrap">
      <b>I post about...</b>
      {% assign sorted_items = site.tags | sort %}
      {% for item in sorted_items %}
        <span>{{ item[0] }}</span>
      {% endfor %}
    </div>
  </div>
  <div class="hidden lg:flex bg-black opacity-10 justify-end items-end w-full">

  </div>
</div>


