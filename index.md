---
title: blog
layout: default
pagination:
  enabled: true
---
<div class='flex items-start mb-8'>
  <h1 class='text-rose-500 min-h-full'>posts</h1>
  <img src="{{site.url}}/assets/img/logo-teal.svg" class="h-4">
</div>
{% include post-index.html %}
{% include post-index-paginator.html %}
