# Notes for Claude

## Design rules

The general rules (no Anthropic beige, always left-align, downcase titles,
no shadows) come from the `house-rules:design` skill. What follows is
only what this site adds.

- **Bobby's own name is the exception to the exception**: it is set
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

- **Shadows over artwork**: the disc under the mark on an interactive
  project's splash is how a mark gets its own ground on this site.

## Post metadata

A note in `src/content/posts` answers three questions and keeps them
apart, because they are not the same kind of fact and a list that ran
them together answered none of them well.

- **`tags` is what a thing is about.** Subjects and disciplines:
  `generative`, `typography`, `print`, `color`, `music`, `games`,
  `simulation`, `nature`, `design-systems`. Plus exactly one kind,
  `project` or `post`, which says what the thing *is*.

- **`stack` is what it is built with.** Three tiers, in this order:
  the **language**, the **framework**, and any **major library** — one
  the project is actually built around. `[ruby, rails]`,
  `[javascript, p5]`, `[typescript, astro]`, `[python]`.

  Those three tiers and nothing else. A host, a CI service, an editor
  or a package manager is not any of them, however much the project
  leans on it: this site's contact form posts to Netlify Forms and the
  stack still says `[typescript, astro]`, because "what is it built
  with" and "where does it run" are different questions and only one
  of them is being asked.

  **Every project names its language**, even when a framework already
  implies it: `rails` without `ruby` leaves the tally unable to answer
  "what does he write in", which is the first thing anyone asks it.

  **Incidental libraries stay out.** If it is a dependency rather than
  something the project is built around, it is not in the list — this
  site uses satori and sharp to draw its social cards and names
  neither. The test is whether someone reading the project would say
  it is *a p5 sketch* or *a Rails app*; they would not say it is *a
  satori app*. A vocabulary of a few names used several times each says
  something; a dependency manifest says nothing.

  **A technology never goes in `tags`.** Not a language, not a
  framework, not a library, not a file format, not a hosting platform.
  If a new note wants to say it is a Rails app, that is `stack:
  [rails]` and nothing else. This is settled, not a preference — the
  two vocabularies are counted separately, set out separately on
  `/about`, and filtered as separate groups on the index, and a tool
  in `tags` lands in the wrong one of each.

Both are lowercase, and a stack is set language first. Set a thing as
it calls itself — `p5`, not `p5.js`
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
