---
title: "🇨🇭 its-swiss"
date: 2026-08-31 10:00:00 -0800
summary: sensible Swiss defaults, in one gem
bg_color: "#E03A2B"
splash: "/posts/its-swiss/splash.svg"
version: "0.3"
---

I enjoy and am inspired by mid-century Swiss design — the style and the thought
process behind it, figures like Josef Müller-Brockmann and Emil Ruder.
its-swiss condenses that into a set of sensible defaults I can use across my
projects: a value scale, a baseline, a type hierarchy, a way to divide a page.
The gem keeps them consistent everywhere, and as I learn more and refine the
rules, they update in one place.

Below, a specimen of the elements involved.

<figure class="specimen">
  <iframe class="specimen-frame" src="/posts/its-swiss/specimen.html" title="its-swiss specimen" height="1400" loading="lazy" scrolling="no"></iframe>
  <figcaption>The specimen, live. Unset the accent, or turn on the baseline grid.</figcaption>
</figure>

its-swiss is a rubygem: 928 lines of CSS in six files, everything inside
`@layer` so any app rule wins without effort. 89 tests.
[Pandatone](/posts/pandatone) runs on it; Stripeclub is next.
