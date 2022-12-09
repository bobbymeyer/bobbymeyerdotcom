---
layout: post
title:  "Automatic Database Migration on Heroku"
date:   2021-03-17 08:00:00 -0800
categories: code
tags:
- rails
- ruby
- postgresql
- heroku
---
More than once, I have pushed a new release to Heroku and forgot to migrate the database. This can be avoided by adding a release command to your Procfile:

{% highlight shell %}
# Procfile
web: bundle exec puma -t 5:5 -p ${PORT:-3000} -e ${RACK_ENV:-development}
web: bundle exec puma -C config/puma.rb
worker: rake jobs:work

# Add this...
release: bundle exec rake db:migrate
{% endhighlight %}

Now, the database migrations are run immediately upon release.