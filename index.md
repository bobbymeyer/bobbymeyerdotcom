---
title: posts
layout: index
pagination:
  enabled: true
---
<div class='grid grid-cols-1 gap-4 lg:w-2/3 xl:w-1/2 mx-auto'>
{% include masthead.html %}
<h1 class='w-full text-8xl tracking-tight border-b-2 border-black py-4 text-white'>Posts</h1>
{% include post-index.html %}
{% include post-index-paginator.html %}
</div>