# Notes for Claude

## Design rules

- **Never use "Anthropic beige"** (warm cream/tan tones like `#f3f0e6`,
  `#f6f3eb`, `#f3eedd`, `#efe9da`, etc.) for site chrome — UI panels,
  borders, backgrounds. They evoke the Anthropic palette and we want to
  stay clear of that aesthetic. Neutrals (white, light grey, dashed
  borders) or pattern-specific palette colors are fine.
  Pattern-internal use (e.g., a textile sample's cream ground inside
  the girard tool's stage) is fine — the rule is for site UI only.

- **Always left-align text** unless a specific reason pushes otherwise.
  Don't use `text-align: center` / `text-center` or `text-align: right`
  / `text-right` for prose, headings, labels, paragraphs, or button
  text. Legitimate exceptions: a single icon/glyph centred in a small
  fixed-size button or badge, numeric data in a cell where the column
  is right-aligned by convention. Default to left for everything else.

- **Downcase titles.** Page titles, headings, project titles and the
  one-line summaries under them are lowercase — `readme`, `merged`,
  `about`, `music for bus stops`, `ink-first halftones from press
  profiles`. Proper nouns keep their capital: a person (`Albers`), a place
  or people (`Swiss`), a product or framework (`Rails`), the title of a
  work (`a homage to Homage to the Square`).
  This is a rule for our own words. Text that comes from somewhere else —
  a pull request title from GitHub, a repository description — is quoted
  as written, not recased.

  **Bobby's own name is the exception to the exception**: it is set
  `bobby meyer`, lowercase, wherever the site displays it — the header
  lockup, the index, the social card, the feed. Set it from `NAME` in
  `src/site.ts` rather than typing it, and track it tighter than the
  -0.025em headings take when it is set large. Prose that happens to
  mention him — image alt text, a sentence — is ordinary prose and
  capitalises normally.

  One line breaks that rule on purpose: the opening statement on
  `/about`, which reads `Bobby Meyer. Based in Ojai, California.` That
  is the formal statement of who this is rather than a piece of chrome,
  so it is typed out in full and capitalised, and it is the only place
  on the site that does so.

- **Never use a shadow.** No `drop-shadow`, no `box-shadow`, no
  `text-shadow`, for any reason, including making something legible over
  an image. This site is ink on paper and ink does not cast shadows. When
  a mark has to hold up over artwork, give it its own ground — the disc
  under the mark on an interactive project's splash is how that is done.

## Post metadata

A note in `src/content/posts` answers three questions and keeps them
apart, because they are not the same kind of fact and a list that ran
them together answered none of them well.

- **`tags` is what a thing is about.** Subjects and disciplines:
  `generative`, `typography`, `print`, `color`, `music`, `games`,
  `simulation`, `nature`, `design-systems`. Plus exactly one kind,
  `project` or `post`, which says what the thing *is*.

- **`stack` is what it is built with.** Languages, frameworks,
  libraries, formats, the applications it came out of: `astro`,
  `javascript`, `typescript`, `python`, `rails`, `p5`, `canvas`,
  `midi`, `netlify`.

  **A technology never goes in `tags`.** Not a language, not a
  framework, not a library, not a file format, not a hosting platform.
  If a new note wants to say it is a Rails app, that is `stack:
  [rails]` and nothing else. This is settled, not a preference — the
  two vocabularies are counted separately, set out separately on
  `/about`, and filtered as separate groups on the index, and a tool
  in `tags` lands in the wrong one of each.

Both are lowercase. Set a thing as it calls itself — `p5`, not `p5.js`
— but spell a language out: `javascript` and `typescript`, never `js`
or `ts`, so neither of the pair looks abbreviated beside the other.
Reuse a name before inventing one: four names used three times each
say something, twelve used once each say nothing.

Where they surface: `/about` runs one tally of each, the subjects under
"This site documents my … interests" and the tools under "I have …
been building with"; the index filter has a group for each, "about" and
"built with", beside "what" for the kinds and marks. A card prints its
subjects only.

## Contact

- **Never publish an email address.** No `mailto:`, no address written out,
  no address assembled at runtime to dodge a scraper. A published address is
  scraped within days, and Bobby has decided he would rather not be. The
  contact form on `/contact` is the channel, and it is sufficient: it posts to
  Netlify Forms and he replies by email, so a real conversation still starts
  there — the address just is not the thing on the page.

  This is a settled decision, not an omission waiting to be fixed. If a future
  change wants somewhere to put "get in touch", it links to `/contact`.
