# todo

In order, and the first is the one that matters: the about page now introduces
you and the index says what you work on, but nothing on this site is written
by you yet.

## 1. Write the featured notes

`featured` in `src/projects.ts` buys a project twice the width on the index
and the top of the order. What it is supposed to buy the reader is the part
only you can write, and right now every note in `src/content/posts/` is a
container for a sketch, or for a line of tags, and nothing else — not one
sentence across all nine.

Per featured project, a few hundred words: why you built it, the constraint
or the joke at the heart of it, what turned out to be hard, what you would do
differently. The note sets above the README, and the three fields it has to
be interesting in are the reason the merge list moved off the left of the
project page.

Currently featured: `treegen`, `music for bus stops`. That was a guess —
change it.

## 2. A colophon

The cleverest thing on this site is the site: no CMS, no content to keep in
step, a portfolio that reads its own projects out of GitHub every three hours
and fails the build rather than shipping a page with nothing on it. The
README explains it well and no visitor ever sees the README.

`bobbymeyer.com` is now a project on the index like any other, which is the
hook. A note on it — `src/content/posts/bobbymeyerdotcom.md` — is the
colophon, and it lands in the one place where somebody is already looking at
the thing it describes.

## 3. A 404 worth landing on

`src/pages/404.astro` says "Nothing here." on a site whose whole argument is
generative toys. Grow a tree, print a halftone of the path that missed, run
an Albers square. The sketches are already instance-mode factories loaded on
demand — `src/scripts/albers.ts` is the shortest of them to borrow from.

## Smaller

- **Standalone posts.** A note in `src/content/posts` is matched to a project
  by slug and does not render without one. Most of the groundwork is in:
  tags live on the note rather than on the project, and every note already
  declares a kind, so a post tagged `post` would sort itself out on the about
  page and in the filter the moment one exists. What it still needs is a
  route, a date of its own (there is no repo to read one from), and a decision
  about whether it shares the index with the projects or gets a list of its
  own.
- **Lockfile.** `package-lock.json` is gitignored, so CI installs with
  `npm install` and two runs can resolve different trees. Committing it and
  switching `.github/workflows/ci.yml` to `npm ci` makes builds reproducible.
- **Action versions.** `actions/checkout@v4` and `actions/setup-node@v4` target
  Node 20, which GitHub has deprecated — runs carry a warning and are forced
  onto Node 24. Bumping both to v5 clears it.
- **The its-swiss specimen** is an iframe with a hardcoded `height="7800"`
  fallback and a script that corrects it once the frame reports its own
  height. Fine, but it is a lot of machinery for one embed.
- **Dependabot in the merge list.** "Bump actions/checkout from 4 to 5" is
  carried at the same weight as real work. Filtering authors named
  `dependabot[bot]` out of `buildTimeline` in `src/lib/project-entries.ts`
  would be a few lines.
