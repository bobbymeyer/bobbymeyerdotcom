---
layout: posts
title:  "Auto-migrate Heroku/Rails DB upon Push"
date:   2021-03-06 12:45:00 -0800
categories: code
tags: 
- rails 
- postgresql
- heroku
---
I have a habit of forgetting to migrate my production database after releasing, only "remembering" when my users send me a "Hey, this stopped working..." email. To make sure this doesn't happen again I added the following line to my Procfile.

{% highlight shell %}
release: bundle exec rake db:migrate
{% endhighlight %}

Now the database is migrated on every release, and I have stopped receiving embarrassing emails.