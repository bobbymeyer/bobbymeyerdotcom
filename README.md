# bobbymeyer.com

Personal site. Built with [Astro](https://astro.build), deployed on Netlify.

## Local dev

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # http://localhost:4321
```

`npm run build` produces a static site in `dist/`. `npm run preview` serves it.

The contact form only submits on Netlify (production or `netlify dev`). Plain
`npm run dev` will show an error if you try to send.

## Structure

```
src/
  pages/
    index.astro            # landing page (lists posts)
    posts/[...slug].astro  # dynamic post route
  content.config.ts        # post collection schema
  content/posts/           # one markdown file per post
  layouts/Base.astro       # HTML wrapper
  styles/                  # global, home, post, page (contact form)
  breakpoints.ts           # shared layout widths (sync with global.css)
public/
  posts/<slug>/            # per-post images
```

## Writing a post

Drop `src/content/posts/<slug>.md`:

```yaml
---
title: Post title
date: 2026-05-28 10:00:00 -0800
summary: One or two sentences used as the card caption and the post deck.
bg_color: "#E03A2B"                  # required — see palette below
splash: "/posts/<slug>/image.svg"   # optional
version: "0.1"                     # optional, shown as a superscript
draft: true                        # optional, hidden in production
hide_header: true                  # optional; skip the post header when the title
                                   # lives in the body (interactive work, etc.)
---
markdown body…
```

`bg_color` is required — it fills the 16:9 splash field on the index and in the
post margin. Add `splash` for an image on top of that field.

**Palette** — pick one hex from `src/palette.ts` (mid-century inks):

| Name | Hex |
| --- | --- |
| vermillion | `#E03A2B` |
| orange | `#F15A24` |
| yellow | `#F5C400` |
| green | `#3D9970` |
| teal | `#00A3A0` |
| blue | `#2F6FED` |
| violet | `#5B4BB7` |
| magenta | `#E83A75` |
| cobalt | `#0047AB` |
| rust | `#B7410E` |

### Marginalia

Wrap anything that can sit in the right column at wide widths:

```html
<div class="marginalia">

## Section title

A note, figure, or code group.

</div>
```

At 1200px and up, the block moves beside the nearest preceding paragraph,
heading, or list — skipping other marginalia and decorative elements in
between. Optional `data-anchor="section-id"` pins it to a specific heading.
If the margin row is taken, the block stays inline in the article with a lighter
indented treatment (`.marginalia-inline`).

### Layout widths

| Viewport | Columns | Post layout |
| --- | --- | --- |
| Phone (&lt; 640px) | 1 | Stacked |
| Tablet (640–1199px) | 2 | Stacked |
| Desktop (1200–1599px) | 4 | Article + margin |
| Ultrawide (1600px+) | 4, capped width | Article + margin |

## Feed

`/rss.xml` lists published posts (title, date, summary). Linked from every page
via `<link rel="alternate">` in the document head.

## Contact form (Netlify)

The contact page uses [Netlify Forms](https://docs.netlify.com/forms/setup/) — no extra
service. After the first deploy with the form live:

1. Netlify dashboard → your site → **Forms** — confirm `contact` appears
2. **Form notifications** → **Add notification** → **Email** → your address

Optional: enable honeypot (already in markup) or Akismet under **Forms** → **Spam
filters**. Free tier includes 100 submissions per month.

## Branching

Default branch is `main`. Push directly; Netlify rebuilds on push.

## License

Site content © Bobby Meyer. Code MIT, take what's useful.
