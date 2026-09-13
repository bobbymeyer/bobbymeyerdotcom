---
---

Most halftone tools are filters: pixels in, dots out, and whatever the printer
makes of it afterwards is the printer's problem. halftoner starts from the other
end. A press profile — the paper, its dot gain, the smallest dot it can hold,
the finest screen it can carry, how much ink it will take before it stops
drying — is the input, and the picture is what gets fitted to it.

So the artifact is a recipe, not an image. It carries the canvas, the ink set,
the overprints, the sources and the seed, and every output is a render of it:
a screen proof, an SVG, print-on-demand sizes, 1-bit film positives with
registration marks and a step wedge, or PDF/X-1a with one overprinting
separation per ink and the dots already screened so the RIP leaves them alone.
Compositing happens in ink space through the Neugebauer primaries rather than
as RGB layers with multiply, which is the whole reason an overprint can be a
colour you picked instead of one arithmetic handed you.

<figure>
  <img src="/posts/halftoner/shapes.png" alt="One tone ramp printed four times, with round, elliptical, square and line dots" />
  <figcaption>One ramp, four cell fills. A screen is a fill function over a
  grid — round dots join their neighbours all at once, elliptical ones join
  along the long axis first, and a line screen never joins across at all.</figcaption>
</figure>

<aside class="marginalia">
  <p>The splash above is one of its own outputs: a screened field rendered with
  hard alpha, so nothing is painted where no ink prints and the blue behind it
  is doing the job the paper does.</p>
</aside>

Every constraint is computed for every job and each target decides what a
failure means — the screen target reports a ruling past the paper's ceiling,
print-on-demand caps it, film and PDF refuse and say why. Press artifacts are
modelled rather than faked: misregistration with a low-frequency walk, slur
along the direction of travel, ink film thickness wandering across the sheet,
all seeded and all applied per ink, never per RGB channel. There is an
underbase generator for dark garments, because white on cotton spreads far
more than the colours printed onto it and wants its own curve.

The part I care about most is the loop back to reality. `halftoner measure`
reads a scan of real print — the paper, the inks and their overprints, the
ruling and angle of each screen, the registration error between plates, the
gain — and writes a draft profile from it. Print the step wedge that comes on
a film sheet, scan it, feed it back, and the numbers stop being generic. The
profiles that ship are all marked `NOMINAL` for exactly this reason: they are
plausible ranges, not anybody's actual press, and the provenance field says so
until a scan replaces it.
