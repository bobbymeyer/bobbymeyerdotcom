# bobbymeyer.com

Personal site. Built with [Astro](https://astro.build), deployed on Netlify.

## Local dev

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # http://localhost:4321
```

`npm run build` produces a static site in `dist/`. `npm run preview` serves it.

## Structure

```
src/
  pages/
    index.astro            # landing page (lists posts)
    posts/[...slug].astro  # dynamic post route
  content/
    config.ts              # post collection schema
    posts/                 # one markdown file per post
  layouts/Base.astro       # HTML wrapper
  styles/global.css        # global stylesheet
public/
  posts/<slug>/            # per-post static assets (css, js, images)
```

## Writing a post

Drop `src/content/posts/<slug>.md`:

```yaml
---
title: "post title"
date: 2026-05-28 10:00:00 -0800
summary: one-line description
custom_css: name         # optional, loads /posts/<slug>/name.css
custom_js: name          # optional, loads /posts/<slug>/name.js
p5js: true               # optional, injects p5 + p5.sound from CDN
tags:
- whatever
---
markdown body…
```

Per-post assets live in `public/posts/<slug>/`. The post route automatically
links any declared `custom_css`/`custom_js` and CDN-loads p5 when needed.

## Branching

Default branch is `main`. Push directly; Netlify rebuilds on push.

## License

Site content © Bobby Meyer. Code MIT, take what's useful.
