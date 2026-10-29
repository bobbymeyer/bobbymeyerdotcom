---
tags: [project, design-systems, typography, print]
stack: [python]
---

I built a flyer generator. It reads a folder of YAML, one file per show, and
writes an 8.5 by 11 inch SVG. The page bisects, a photograph fills one half and
bleeds off the trim, the type sets in the other half on a grid, one ink on a
coloured ground. The photographs are screened as newsprint halftones.

Then I asked an image model for the same six flyers. Same content, same brief,
typed into a prompt instead of parsed from YAML. The ground colour and the ink
were the ones the generator had already assigned, so method was the only
variable.

The diffusion flyers are good. All six got the register: flat ground, one ink,
halftone photograph, heavy grotesque, a defensible hierarchy. Two of them I
would accept from a designer.

<figure>
  <img src="/posts/concert-series/01-both-ways.webp" alt="Six concert flyers in two versions each, the generated SVG beside the image model's attempt at the same show" />
  <figcaption>The same six shows, twice: generated from YAML on the left, from one prompt on the right.</figcaption>
</figure>

Then I measured them.

The page is 8.5 by 11 inches. Every image came back 1024 by 1536, which is 2:3,
the nearest portrait size on offer. There is no parameter for trim size. The
brief asked for one flat ground and exactly one ink; the six images hold between
61,000 and 185,000 distinct colours, and in the worst one the commonest single
colour covers 0.6 percent of the page. ENNIO MORRICONE runs under the
photograph it was told to sit clear of. Two prices lost their dollar sign and a
third went missing. One flyer typeset the words "Opening acts" because my prompt
used that phrase as a field label.

<figure>
  <img src="/posts/concert-series/02-page-and-ground.webp" alt="Six pairs of colour swatches, the flat hex asked for beside a magnified square of the mottled colour returned" />
  <figcaption>The hex each flyer was given, beside a fifty pixel square of the ground that came back, at 3x. Every one was specified as a single flat colour.</figcaption>
</figure>

<figure>
  <img src="/posts/concert-series/03-defects.webp" alt="Four crops from the generated flyers showing a headline colliding with a photograph, a field label set as type, a missing price and a dropped dollar sign" />
  <figcaption>Four crops at full resolution from the generated images.</figcaption>
</figure>

None of those is a failure of taste; they are all the same failure. The model is
painting a picture of a flyer. It has no page, no measure, no colour value, no
string that has to survive intact. It has a very good idea of what those things
look like.

The generator has all of them. It knows the page is 8.5 by 11 because the page
is a number. It knows DE ANGELIS fits because it read the font's metrics table
and added up the advance widths, and when a name does not fit it shrinks that
line until it does. Run it again and you get the same bytes.

That argument is old, and procedural design has always lost it anyway, because
writing the system cost more than drawing the thing. The generator parses
TrueType metrics tables from the spec, because I did not want the dependency. It
resolves every unspecified slot deterministically, sets a column grid, and
screens each photograph at the size it will print. I did not write most of it. I
specified it, in conversation, and corrected it when it went wrong. The
expensive half of procedural design got cheap.

The clearest demonstration was a mistake. Halfway through, the halftone looked
mechanical. The screen was sitting at 45 degrees, which is the classic angle for
a single ink and also the one angle where a square screen lands every dot back
in a straight row. I changed one number to 22.5 and the whole series was right.
With the prompt I would have rolled again and taken what came.

<figure>
  <img src="/posts/concert-series/04-screen-angle.webp" alt="A flat tint screened at 45 degrees beside the same tint at 22.5 degrees, the first falling into straight rows and the second into diagonals" />
  <figcaption>A 45% flat tint at 45 lines per inch, screened twice. A square lattice turned 45 degrees returns every dot to a straight row.</figcaption>
</figure>

Diffusion is the right tool when you want one image, you will not need it again,
and nothing about it has to be true. Plenty of work is like that.

I could not have written that prompt before I built the generator, though. The
halves, the bleed, the single ink, the gutter against the photograph, the screen
ruling, flush left on a grid: I knew none of it when I started. The build argued
me into it, one wrong version at a time. The prompt is the design document the
generator produced, read back out, and the diffusion flyers came out well on
borrowed work. Someone writing that brief cold would not get close.

The generator was the quick part. What took the time was working out what it
should do, and that is the part worth keeping. Building the system forces those
decisions, because every vagueness comes back as a crash or an ugly page. The
thinking ports to any toolchain, including the one that paints pictures.
