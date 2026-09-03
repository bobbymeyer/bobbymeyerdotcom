---
title: "🇨🇭 its-swiss"
date: 2026-08-31 10:00:00 -0800
summary: sensible Swiss defaults, in one gem
bg_color: "#E03A2B"
splash: "/posts/its-swiss/splash.svg"
version: "0.6.0"
---

I enjoy and am inspired by mid-century Swiss design — the style and the thought
process behind it, figures like Josef Müller-Brockmann and Emil Ruder.
its-swiss condenses that into a set of sensible defaults I can use across my
projects: a value scale, a baseline, a type hierarchy, a way to divide a page.
The gem keeps them consistent everywhere, and as I learn more and refine the
rules, they update in one place.

Below, the specimen: every component the library ships, the type scale,
the value scale and the grid primitives, rendered by the library itself and
published from its own repository.

<figure class="specimen">
  <iframe class="specimen-frame" src="https://bobbymeyer.github.io/its-swiss/0.6.0.html" title="its-swiss specimen" height="7800" loading="lazy" scrolling="no"></iframe>
  <figcaption>The specimen, live. Unset the accent, or turn on the baseline grid.</figcaption>
</figure>

its-swiss is a rubygem: 1,018 lines of CSS in six files, everything inside
`@layer` so any app rule wins without effort. 98 tests, thirteen of them in a
real browser — a rule on the wrong selector reads correctly in the CSS and
does nothing on a page.
[Pandatone](/posts/pandatone) runs on it; Stripeclub is next.
