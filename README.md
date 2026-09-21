# bobbymeyer.com

Personal site. Built with [Astro](https://astro.build), deployed on Netlify.

## Local dev

```bash
nvm use            # picks up .nvmrc
npm install
npm run dev        # http://localhost:4321
```

`npm run build` produces a static site in `dist/`. `npm run preview` serves it.

Both read GitHub. Unauthenticated that is 60 requests an hour, which is enough
for a few projects but not for a day of rebuilds — put a token in `.env` and it
becomes 5,000:

```
GITHUB_TOKEN=ghp_…
```

It needs no scopes; every repository on the site is public.

The contact form only submits on Netlify (production or `netlify dev`). Plain
`npm run dev` will show an error if you try to send.

## Structure

```
src/
  projects.ts              # the list of projects — which repos, what colour, what tags
  site.ts                  # the name, the lede, the place — shared by index, about, cards
  lib/
    github.ts              # the GitHub API, with an on-disk cache
    github-text.ts         # readme HTML and pull request bodies, tidied
    project-entries.ts     # a repo + its note, assembled into a page
    og.ts                  # the social card, drawn at build time
  pages/
    index.astro            # the index — featured first, newest change after
    posts/[...slug].astro  # one project page
    og/[slug].png.ts       # /og/<slug>.png, one card per project + /og/site.png
  components/
    Timeline.astro         # the merged pull requests, under the splash
    RegMark.astro          # the registration target on an interactive splash
  content.config.ts        # the note schema (there is barely any)
  content/posts/           # optional note per project, named for its slug
  layouts/Base.astro       # HTML wrapper, meta and social tags
  scripts/
    sketch-fallback.ts     # what an interactive piece says when it cannot load
  styles/                  # fonts, global, home, post, project, page (contact form)
  assets/fonts/            # Archivo TTF — for drawing cards, never served
  breakpoints.ts           # shared layout widths (sync with global.css)
public/
  posts/<slug>/            # per-project images
  fonts/                   # Archivo woff2 — self-hosted, see src/styles/fonts.css
  robots.txt
.github/workflows/
  ci.yml                   # type-check and build, on every push
  refresh.yml              # the clock that asks Netlify to rebuild
TODO.md                    # what this site still needs, in order
```

## How the index works

The index is a list of projects, and a project is a GitHub repository. At build
time each repo in `src/projects.ts` is read for its description, its README, its
latest release or tag, and its merged pull requests.

The order is three bands — featured, live, archived — and inside each one the
last commit on the repo's default branch, so a project that moves comes back to
the top of its band on the next build. Featured projects also take two of the
four fields, pinned to the left, and the rest pack into the two they leave; see
**Tags**.

A project page sets a project out in two fields: the note and the README on the
left across three of four, and on the right the repository's own account of
itself — the splash, the facts under it, the merged pull requests under those,
each with whatever was written about the merge. The merges had a field of their
own on the far left until they didn't: that gave the loudest column on the page
to a list of commit titles and pushed what the project actually *is* into the
middle.

Nothing here is checked in. Push to a project, and the site says so the next time
it builds.

### Adding a project

One entry in `src/projects.ts`:

```ts
{
  repo: 'bobbymeyer/pandatone',   // owner/repo. Public repositories only
  title: '🐼 Pandatone',           // optional; defaults to the repo name
  summary: 'A unix inspired color tool',  // optional; defaults to the GitHub description
  tags: ['featured', 'interactive'],      // optional; see below
  bg_color: POST_PALETTE.vermillion,      // fills the 16:9 splash field
  splash: '/posts/pandatone/splash.svg',  // optional, laid over that field
  slug: 'pandatone',              // optional; defaults to the repo name
  draft: true,                    // optional; visible in dev, not in the built site
}
```

The build **fails** on a repo it cannot read, rather than quietly shipping a page
with nothing on it. `npm run dev` warns and carries on without it.

### Tags

Two, both declared in `src/projects.ts`, both acted on by the index. A typo in
either is a type error rather than a tag that quietly does nothing.

| Tag | What it does |
| --- | --- |
| `featured` | Two fields wide on the index instead of one, and sorted above everything unfeatured however recently anything moved. Below 1200px the grid is two fields, where two of two is the whole width, so there the tag carries order alone. |
| `interactive` | The project runs on its own page, so its splash gets a registration target in the corner and the index prints a legend beside the heading saying what the mark means. |

Archiving still beats featuring: an archived repository sorts to the bottom
whatever it is tagged, because archiving is the last commit a project gets and
that commit should not put a finished project back at the top.

A featured project is asking for the thing only you can write — see
`TODO.md`.

### Writing a note

A project can have a note — the part only you can write, set above the README:
`src/content/posts/<slug>.md`, named for the project's slug.

```yaml
---
---
markdown body…
```

The frontmatter is empty on purpose. The title, summary, colour and splash are
declared once in `src/projects.ts`; the version, the dates and the README come
from GitHub. `draft: true` keeps an unfinished note off the site without hiding
the project.

**Palette** — pick one from `src/palette.ts` (mid-century inks):

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

### Keeping it up to date

Netlify rebuilds when this repo is pushed to, and knows nothing about a push to
any other one. `.github/workflows/refresh.yml` is the clock: every three hours it
asks Netlify for a build, which re-reads GitHub and re-sorts the index. Two
one-time settings, both described at the top of that file:

- `NETLIFY_BUILD_HOOK` — a build hook URL, in this repo's Actions secrets.
- `GITHUB_TOKEN` — in Netlify's environment, so the build reads the API at 5,000
  requests an hour instead of 60. It needs no scopes; every repo on the site is
  public.

Run the workflow by hand from the Actions tab when a change should not wait.

Responses are cached under `.cache/` for ten minutes so that editing a stylesheet
does not re-read GitHub on every save. A Netlify build starts without it and
always reads fresh.

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

| Viewport | Columns | Index | Project layout |
| --- | --- | --- | --- |
| Phone (&lt; 640px) | 1 | Stacked | Stacked |
| Tablet (640–1199px) | 2 | Two up, featured first | Stacked |
| Desktop (1200–1599px) | 4 | Featured 2 fields, rest pack right | Note + readme, then the rail |
| Ultrawide (1600px+) | 4, capped width | As above | As above |

Prose in the note and the README keeps a 70ch measure on the wide layouts —
three fields of body text runs past 160 characters otherwise. Tables, code,
figures, sketches and marginalia go on using the full width.

## Social cards

A link to this site unfurls into a picture, and that picture is drawn here at
build time: `/og/<slug>.png` for each project, `/og/site.png` for every page
that is not one. 1200×630, which is what every platform crops to, and PNG,
which is the part that matters — Twitter, Facebook, LinkedIn, Slack and
iMessage all decline to render an SVG in a preview, and five of the eight
splashes on this site are SVGs.

Satori lays the card out from `src/lib/og.ts` and hands back SVG; sharp
rasterises it. The splash is flattened to a PNG over the project's ink first,
because it may itself be an SVG and nesting one inside another renders on your
machine and not on the build. Emoji are dropped from the title — Satori has no
glyph for one without an emoji font bundled, and the card's right-hand third is
already the project's own artwork.

Check one after changing the card: `npm run build`, then open
`dist/og/site.png`.

## Fonts

Archivo, served from this origin — `public/fonts`, declared in
`src/styles/fonts.css`. No connection to fonts.googleapis.com, no DNS and no
round trip before the first paint. Four files cover the eight faces the site
sets, because they are Google's subsets of the variable face and each carries
the whole 200–800 axis.

`src/assets/fonts/*.ttf` is a second copy, and not a mistake: Satori draws the
social cards and wants a file per weight and does not decompress woff2. Those
are never served.

Refreshing either: fetch the stylesheet with a browser User-Agent (which is
what makes Google answer in woff2) and take the URLs out of it. OFL 1.1, text
in `public/fonts/OFL.txt`.

## Checks

`.github/workflows/ci.yml` type-checks and builds on every push. The build is
a real check here rather than a formality: it reads every repository in
`src/projects.ts`, so one that has been renamed, made private or deleted fails
CI instead of failing a deploy.

```bash
npm run check      # astro check
npm run build
```

## Feed

`/rss.xml` lists the projects, dated by their last change rather than by when
they were first published — it is a feed of what moved. Linked from every page
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
