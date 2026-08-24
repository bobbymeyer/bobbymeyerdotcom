import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    // Posts that bring their own CSS / JS.
    custom_css: z.string().optional(),
    custom_js: z.string().optional(),
    // Load p5.js + p5.sound from CDN when the post needs a sketch.
    p5js: z.boolean().default(false),
    thumbnail: z.string().optional(),
    width: z.number().int().min(1).default(2),
    height: z.number().int().min(1).default(2),
    // Drafts render in dev but are excluded from production builds.
    draft: z.boolean().default(false),
    // Optional version tag rendered as a superscript on the title.
    version: z.string().optional(),
    // Posts that render their own title (e.g. tools that pull the title
    // into a custom layout) set this true to skip the page header.
    hide_header: z.boolean().default(false),
  }),
});

export const collections = { posts };
