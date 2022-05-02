---
layout: posts
title:  "Sanitizing inconsistent user input"
date:   2021-03-17 00:00:00 -0800
categories: code
tags:
- rails
- ruby
- postgresql
---
While working on a client project, I noticed that users had started using a field intended to store only a single value to store multiple values. When recording a property's *Parking Type* they were entering values like "Open Lot & Street Parking" or "Carport/Subterranean Parking."

Additionally, because I had allowed users to enter this data as text, I found variations in capitalization and pluralization for what should have been a single value, i.e. *'Garage', 'garages', 'garage'*.

I decided the best solution was to clean up the existing values and limit the future user input to a checkbox collection of approved values.

## Converting string field to a Postgresql array
Because users needed to record multiple values, I first converted the parking_type field to a Postgresql array.

I created a new migration with the following command and migrated the database.

{% highlight ruby %}
  change_column :risks,
                :parking_type,
                :string,
                array: true,
                default: [],
                using: "(string_to_array(parking_type, ','))"
{% endhighlight %}

## Sanitizing existing values
The *using* option in the migration would split entries with multiple values separated by commas. In my case, however, users were not using commas. Instead, they favored slashes and ampersands.

I prefer to split these values with a ruby script (which I understand well) rather than relying on the Postgres specific *using* method (which I understand less well). I wrote the following script and stuck it in a rake task.

{% highlight ruby %}
Risk.all.each do |risk|
  if risk.parking_type.present?
    # Set a new array to store values
    new_pt_array = []
    risk.parking_type.each do |pt|
      # N/A would be split into two values,
      # "N" & "A", if left as is.
      # Better to simply rename to "Not Applicable"
      if pt == 'N/A'
        pt = 'Not Applicable'
      # nil values are not strings and cannot be split
      # I could check for nil and skip them, but I think
      # it is better to rename blank values to "Unknown"
      elsif pt == nil
        pt = 'Unknown'
      end
      # Split values separated by slashes or ampersands...
      pt = pt.split(Regexp.union(['&', '/']))
      # ... and push them into a new array
      new_pt_array.push(pt)
    end
    # Sanitizing the data with...
    # strip:        remove leading and trailing spaces
    # titleize:     regularize capitalization
    # singularize:  regularize pluralization
    new_pt_array = new_pt_array.flatten
                               .map { |pt| pt.strip
                                             .titleize
                                             .singularize }
    # Replace the old dirty array with the new clean array
    risk.parking_type = new_pt_array
  else
    puts 'No Parking Type'
    # Set blank/nil values to 'Unknown'
    risk.parking_type = ['Unknown']
  end
  # Save changes
  risk.save
end
{% endhighlight %}

Running this rake task took care of most of the cleanup, leaving only a few errant values (misspellings or disallowed categories) that needed to be changed manually in the console.

## Strong params
To allow users to record multiple values, I needed to make a small change to the risks_controller. The parking_type field in the strong params needs to be set to an array to allow multiple values.

Change this...
{% highlight ruby %}
# app/controllers/risks_controller.rb
def risk_params
    params.require(:risk)
          .permit(
            # other attributes omitted from sample
            :parking_type
          )
{% endhighlight %}

... to this.
{% highlight ruby %}
# app/controllers/risks_controller.rb
def risk_params
    params.require(:risk)
          .permit(
            # Changed to an array to allow multiple values
            parking_type: []
          )
{% endhighlight %}

## Checkbox form
Finally, I need to amend the form, forcing users to choose from approved values. I will allow users to choose from any of the now sanitized values currently in the database.

{% highlight erb %}
# app/views/risks/_form.html.erb
<%= f.input :parking_type,
                as: :check_boxes,
                collection: Risk.pluck(:parking_type)
                                .reject(&:blank)
                                .uniq
                                .sort %>
{% endhighlight %}

Now users can select multiple values from an approved list keeping the data squeaky clean!