# bobbymeyer.com

Personal site. Built with [Astro](https://astro.build) + Tailwind, deployed on Netlify.

(Was a Jekyll/Minimal Mistakes blog through 2023; rewritten on the Astro stack in 2026.)

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
    index.astro            # grid landing page
    posts/[...slug].astro  # dynamic post route
  content/
    config.ts              # post collection schema
    posts/                 # one markdown file per post
  layouts/Base.astro       # minimal HTML wrapper
  styles/global.css        # tailwind entry
public/
  posts/<slug>/            # per-post static assets (css, js, images)
  bobby.png                # global images
  BM-LogoType-SM.png
```

## Writing a post

Drop `src/content/posts/<slug>.md`:

```yaml
---
title: "post title"
date: 2026-05-28 10:00:00 -0800
summary: one-line description
thumbnail: cover.png     # optional, path relative to /posts/<slug>/
width: 2                 # tile width on index grid (defaults 2)
height: 2                # tile height on index grid (defaults 2)
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

## Index grid

The landing page is a CSS grid of `minmax(96px, 1fr)` cells with `gap: 1rem`.
Each post occupies `width × height` cells (default 2×2) and renders its
`thumbnail` as a cover-fit background. Posts without a thumbnail fall back to
a per-slug deterministic HSL gradient.

The yellow "bobbymeyer" badge sits top-right at 3×2.

## Branching

Default branch is `main`. Push directly; Netlify rebuilds on push.

## License

Site content © Bobby Meyer. Code MIT, take what's useful.
