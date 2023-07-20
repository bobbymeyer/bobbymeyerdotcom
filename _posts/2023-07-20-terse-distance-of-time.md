---
layout: post
title:  "Terse Distance of Time in Words"
date:   2023-07-20 10:52:20 -0800
summary: Cleanup your rails primary keys after a large import
emoji: 🔑
tags:
- rails
- ruby
---

Rails has a helpful method called **[distance_of_time_in_words](https://apidock.com/rails/ActionView/Helpers/DateHelper/distance_of_time_in_words)**, which displays how long ago a date was in a way that is easy to understand for humans.

By default, the method generates quite lengthy descriptions, like "about 3 years" for a date that is 3 years away. This was causing issues for me when using the method in a chat app to show timestamps on messages, as it was too wordy to display alongside each message.

The good news is that you can customize the default output by redefining it in your locale YAML.

{% highlight yaml %}
# config/locales/en.yml
en:
  datetime:
    distance_in_words:
      half_a_minute: "~30s"
      less_than_x_seconds:
        one:   "~1s"
        other: "~%{count}s"
      x_seconds:
        one:   "1s"
        other: "%{count}s"
      less_than_x_minutes:
        one:   "~1m"
        other: "~%{count}m"
      x_minutes:
        one:   "1m"
        other: "%{count}m"
      about_x_hours:
        one:   "~1h"
        other: "~%{count}h"
      x_days:
        one:   "1d"
        other: "%{count}d"
      about_x_months:
        one:   "~1m"
        other: "~%{count}m"
      x_months:
        one:   "1m"
        other: "%{count}m"
      about_x_years:
        one:   "~1y"
        other: "~%{count}y"
      over_x_years:
        one:   "1y+"
        other: "%{count}y+"
      almost_x_years:
        one:   "~1y"
        other: "~%{count}y"
{% endhighlight %}

Now a message sent 33 minutes ago will say "~30m" instead of "about 30 minutes" ago.