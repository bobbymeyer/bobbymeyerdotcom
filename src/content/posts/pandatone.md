---
title: "pandatone"
date: 2026-08-30 10:00:00 -0800
summary: a library that only holds colors
bg_color: "#E03A2B"
splash: "/posts/pandatone/splash.svg"
---

Pandatone is a color palette API. It serves colors and palettes
programmatically so my other design tools can reach them — a generative image
tool asks for the season's palette, a CAD script asks for the brand red. I
pick and manage them through the UI: the library as swatches, palettes as
strips, lookup by hex, RGB or CMYK, exports to `.ase` and CSS custom
properties.

[Source is on GitHub](https://github.com/bobbymeyer/pandatone).

<figure>
  <img src="/posts/pandatone/palettes.jpg" alt="The Pandatone palettes index: four palettes shown as strips of swatches, above a filter bar for search, tags, sort and card size." />
  <figcaption>The palettes index. Four registers of one filter block, and the swatches are the only color on the page.</figcaption>
</figure>

## Two inspirations

Unix tool philosophy: this is the first of a set of small design tools, each
doing one thing over a clean interface. Nothing in Pandatone renders an image
or lays out a page. It holds colors and answers questions about them, and the
next tool along asks.

And the Swiss International Typographic Style: hand-written CSS,
near-monochrome, so the swatches are the only color on screen. Archivo, one
variable subset shipped with the app rather than pulled from a CDN. Every
signal that matters carries weight as well as an accent, so nothing rests on
color alone — which feels like the least a color tool owes you.

## Colors are first-class

The one structural decision everything else follows from: a color is not a
child of a palette. One brand blue used in ten palettes is **one** row joined
to ten palettes. That is what makes the reverse lookup possible — paste a hex
and get back every palette holding it.

Which forces a rule I like more the longer I use it: **a color is its value.**
No two colors may render the same hex. Otherwise the reverse lookup would be
an arbitrary choice between two rows that look identical. A palette, likewise,
is its set of colors, so no two palettes may hold exactly the same swatches.
Duplicates get refused at the write, not cleaned up later.

Near-duplicates are a question rather than a rule. Inside a redmean distance
of 32 — `#FFFFFF` against `#FAFAF8` scores 17 — you get both swatches side by
side and a "create anyway" button.

<div class="marginalia">

Every color stores both spaces. `source_space` records which one was
authored; the other is redrawn on every write, so the two can't drift. RGB
round-trips through CMYK losslessly, but many CMYK mixes collapse onto one
RGB triple — which is why the source space is recorded rather than inferred.

</div>

## The API

Everything is under `/api/v1`. Collections are bare arrays, no envelope. A
token in the header, never the session cookie — accept the cookie and any page
on the internet could drive the API from a signed-in browser.

```sh
curl -H "Authorization: Bearer $PANDATONE_TOKEN" \
     https://pandatone.example.com/api/v1/palettes?tag=active
```

A color comes back as:

```json
{
  "id": 12,
  "name": "signal-red",
  "hex": "#E30613",
  "rgb": { "r": 227, "g": 6, "b": 19 },
  "cmyk": { "c": 0.0, "m": 97.4, "y": 91.6, "k": 11.0 },
  "source_space": "rgb",
  "tags": ["brand", "primary"]
}
```

That shape, key order included, is pinned by a contract test. It's versioned
from the first commit, because the whole point is that other tools depend on
it: if the contract test fails, something downstream is already broken, and
the fix is a `v2` rather than an edit to v1.

Exports ride the same routes by extension. `.ase` for a design tool, each
color going out in the space it was authored in; `.css` for a stylesheet,
custom properties on `:root` in the palette's order. There's no export of the
whole library — a palette is the unit with a name and an order, which is what
both formats are for.

## Sorting a wheel that has no beginning

Both indexes sort by name, added, modified, color, dark or light. The last
three are about what something *looks* like, which turned out to be the most
interesting small problem in the app.

Dark and light use Rec. 601 luma. Not perceptual, but it puts yellow above
blue where a plain mid-point calls them equal. **Color** runs black, then
ROYGBIV, then white, with near-neutrals falling off the spectrum to whichever
end of the black-to-white axis they sit on. A wheel has no beginning, so the
cut has to go somewhere — I put it between magenta and red, because cutting at
red puts `#E30613`, at hue 356.5, after the violets.

A palette answers all three differently. Dark and light average its swatches,
since a palette is dark as a whole. Color reads the swatch it leads with,
since hue can't be averaged: the mean of red and violet is green.

## What I haven't built

Serious color science. Profiles, gamut mapping, perceptual uniformity —
Pantone spends a fortune on that. CMYK is stored and served, labeled an
approximate device conversion. No ICC profiles, no Lab, no spot colors.
Leaving that out is what keeps the tool small and reliable.

## Stack

Rails 8, omakase: Propshaft, importmap, Hotwire, SQLite, Minitest. No extra
gems, no framework CSS. System tests run through `rack_test` by default, so
the suite needs no browser and the app keeps working with JavaScript off; the
ones that need a real one — measured widths, the live preview, the clipboard —
skip until you point the driver at Chrome. 602 tests.
