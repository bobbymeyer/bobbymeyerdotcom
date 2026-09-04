import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { fileURLToPath } from 'node:url';
import { POST_COLOR_VALUES } from '@/palette';

const posts = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: fileURLToPath(new URL('./content/posts', import.meta.url)),
  }),
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    // Set when a post is revised after publishing. The index and the feed
    // order on it, so the revision brings the post back to the top; the
    // byline shows both dates.
    updated: z.coerce.date().optional(),
    summary: z.string(),
    draft: z.boolean().default(false),
    version: z.string().optional(),
    hide_header: z.boolean().default(false),
    bg_color: z.enum(POST_COLOR_VALUES),
    splash: z.string().optional(),
  }),
});

export const collections = { posts };
