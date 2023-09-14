---
layout: post
title:  "Rails Template"
date:   2023-09-13 10:52:20 -0800
summary: Building on rails is fast, starting to build on rails is SLOW
emoji: 🛤️
tags:
- rails
- ruby
- templates
---

Starting a Rails project involves several configuration steps before diving into the main development. While these steps are crucial, they can be time-consuming. To address this, I created the Rails Template, which serves as a starting point for new Rails projects.

### **About the Rails Template**

The [Rails Template](https://github.com/bobbymeyer/rails_template) is a straightforward Rails application template with a selection of tools and configurations that many developers use in their projects.

The template includes:

- Ruby on Rails 7 as its core.
- Hotwire (Turbo & Stimulus)
- PostgreSQL for database management.
- esbuild for JavaScript bundling.
- Tailwind CSS for styling.
- Devise for user authentication.
- ActiveAdmin for admin functionalities.
- Testing tools like RSpec, Capybara, Factory Bot, and SimpleCov.
- Additional utilities like Bullet, Rack Mini Profiler, RuboCop, and more for optimization and code quality checks.

### **Using the Template**

To use the template, ensure Ruby (3.0.0) and Rails (7.0.0) are installed. Then, initiate a new Rails project with the template by running:

```shell
rails new my_new_project -d postgresql --skip-turbolinks --skip-test -j esbuild --css tailwind -m ./rails_template.rb
```

### **Final Thoughts**

I built this Rails Template out of a need to simplify the initialization of new projects. If you often work with Rails, you might find this template helpful in streamlining your setup process. As always, I'm open to feedback and suggestions, so feel free to check out the repository and share your thoughts.