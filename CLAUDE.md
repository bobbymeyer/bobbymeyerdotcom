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
  or people (`Swiss`), a product or framework (`Rails`), a name (`Bobby
  Meyer`), the title of a work (`a homage to Homage to the Square`).
  This is a rule for our own words. Text that comes from somewhere else —
  a pull request title from GitHub, a repository description — is quoted
  as written, not recased.
