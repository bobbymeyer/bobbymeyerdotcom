import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    // Posts that bring their own CSS / JS (preserved from the Jekyll era).
    custom_css: z.string().optional(),
    custom_js: z.string().optional(),
    // Load p5.js + p5.sound from CDN when the post needs a sketch.
    p5js: z.boolean().default(false),
    // Tile thumbnail. Image lives at /posts/<slug>/<thumbnail>; rendered
    // as a cover-fit background on the post's grid tile.
    thumbnail: z.string().optional(),
    // Grid footprint in unigrid cells. Posts default to a 2×2 square;
    // override either dimension in frontmatter for wider / taller tiles.
    width: z.number().int().min(1).default(2),
    height: z.number().int().min(1).default(2),
  }),
});

export const collections = { posts };
