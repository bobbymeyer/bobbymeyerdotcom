import { defineCollection, z } from 'astro:content';

const posts = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string().optional(),
    tags: z.array(z.string()).optional(),
    // Posts that bring their own CSS / JS (preserved from the Jekyll era).
    custom_css: z.string().optional(),
    custom_js: z.string().optional(),
  }),
});

export const collections = { posts };
