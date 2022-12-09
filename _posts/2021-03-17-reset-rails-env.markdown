---
layout: post
title:  "Reset Rails DB Environment after a Pull"
date:   2021-03-17 08:00:00 -0800
categories: code
tags:
- rails
- ruby
- postgresql
- heroku
---
When you pull production data from Heroku to your local development environment, the data includes metadata for the environment from which it was pulled. This means that your local development database is tagged as a production database, and Rails will give it extra protection.

If you try to drop that database, you will get an error like:

{% highlight shell %}
ActiveRecord::ProtectedEnvironmentError: You are attempting to run a destructive action against your 'production' database.
{% endhighlight %}

To reset the database environment to development, and thus be allowed to drop it, you can run the following command:

{% highlight shell %}
bin/rails db:environment:set RAILS_ENV=development
{% endhighlight %}

<hr>
🎩 HT: [Zieski](https://github.com/rails/rails/issues/34041#issuecomment-426817146)