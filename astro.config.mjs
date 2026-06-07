import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

// Tailwind runs through PostCSS (see postcss.config.mjs) rather than the
// @astrojs/tailwind integration, which doesn't support Astro 6. This
// keeps us on Tailwind v3 — no utility/visual migration — while letting
// Astro update past the advisory-affected 4.x/5.x line.
export default defineConfig({
  integrations: [mdx()],
});
