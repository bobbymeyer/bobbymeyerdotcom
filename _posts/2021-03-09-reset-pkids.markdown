---
layout: posts
title:  "Resetting PostgreSQL pk_sequences in Rails"
date:   2021-03-06 14:52:20 -0800
categories: code
tags: 
- rails 
- postgresql
---
I have recently been working on a project that required transferring a large amount of data to a new PostgreSQL database with a dissimilar schema. I needed to import these records with their primary keys intact. Because of this, the primary key sequence was no longer in sync with the values in the database, and attempting to create new records can lead to this error:
{% highlight ruby %}
ActiveRecord::RecordNotUnique: PG::UniqueViolation: ERROR:  duplicate key value violates unique constraint
{% endhighlight %}

To solve this, you need to reset the pk_sequence to the max value in the existing data. You can do this for a single table in the console by running:

{% highlight ruby %}
ActiveRecord::Base.connection.reset_pk_sequence!('table_name')
{% endhighlight %}

More efficiently, you can do this for all tables with the following command.

{% highlight ruby %}
ActiveRecord::Base.connection.tables.each do |t|
  ActiveRecord::Base.connection.reset_pk_sequence!(t)
end
{% endhighlight %}
