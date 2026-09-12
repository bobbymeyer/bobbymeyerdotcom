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
  projects.ts              # the list of projects — which repos, what colour
  lib/
    github.ts              # the GitHub API, with an on-disk cache
    github-text.ts         # readme HTML and pull request bodies, tidied
    project-entries.ts     # a repo + its note, assembled into a page
  pages/
    index.astro            # the index — projects, newest change first
    posts/[...slug].astro  # one project page
  components/Timeline.astro
  content.config.ts        # the note schema (there is barely any)
  content/posts/           # optional note per project, named for its slug
  layouts/Base.astro       # HTML wrapper
  styles/                  # global, home, post, project, page (contact form)
  breakpoints.ts           # shared layout widths (sync with global.css)
public/
  posts/<slug>/            # per-project images
.github/workflows/refresh.yml   # the clock that asks Netlify to rebuild
```

## How the index works

The index is a list of projects, and a project is a GitHub repository. At build
time each repo in `src/projects.ts` is read for its description, its README, its
latest release or tag, and its merged pull requests. The index is ordered by the
last commit on each repo's default branch, so a project that moves comes back to
the top on the next build.

A project page sets that out in three fields: the merged pull requests down the
left with whatever was written about each merge, the README in the middle, and
the splash and the repository's facts on the right.

Nothing here is checked in. Push to a project, and the site says so the next time
it builds.

### Adding a project

One entry in `src/projects.ts`:

```ts
{
  repo: 'bobbymeyer/pandatone',   // owner/repo. Public repositories only
  title: '🐼 Pandatone',           // optional; defaults to the repo name
  summary: 'A unix inspired color tool',  // optional; defaults to the GitHub description
  bg_color: POST_PALETTE.vermillion,      // fills the 16:9 splash field
  splash: '/posts/pandatone/splash.svg',  // optional, laid over that field
  slug: 'pandatone',              // optional; defaults to the repo name
  draft: true,                    // optional; visible in dev, not in the built site
}
```

The build **fails** on a repo it cannot read, rather than quietly shipping a page
with nothing on it. `npm run dev` warns and carries on without it.

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

| Viewport | Columns | Project layout |
| --- | --- | --- |
| Phone (&lt; 640px) | 1 | Stacked |
| Tablet (640–1199px) | 2 | Stacked |
| Desktop (1200–1599px) | 4 | Timeline + readme + margin |
| Ultrawide (1600px+) | 4, capped width | Timeline + readme + margin |

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
