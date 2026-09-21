import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { fileURLToPath } from 'node:url';

/**
 * A note on a project: `src/content/posts/<slug>.md`, matched to the entry in
 * `src/projects.ts` with the same slug, and set above that project's README.
 *
 * There is almost no frontmatter because there is almost nothing left for it
 * to say. The title, the summary, the colour and the splash are declared once
 * in the manifest; the version, the dates and the README come from GitHub. A
 * note is the part of a project that only a person can write.
 */
const posts = defineCollection({
  loader: glob({
    pattern: '**/*.{md,mdx}',
    base: fileURLToPath(new URL('./content/posts', import.meta.url)),
  }),
  schema: z.object({
    /** Keeps an unfinished note off the site. The project still shows. */
    draft: z.boolean().default(false),
    /**
     * An interactive sketch to run inside this note. The project page loads
     * `src/scripts/<sketch>` and its stylesheet from
     * `public/posts/<slug>/`; the note's body supplies the markup it drives.
     */
    sketch: z.string().optional(),
    /**
     * What this is about. The about page collects these across every note and
     * sets them out as a list of interests, ordered either by how often a tag
     * comes up or by how recently.
     *
     * They live on the note rather than in `src/projects.ts` because the note
     * is the part that is not a repository: a note carries tags whether or not
     * a project stands behind it, so writing that is not a project gets them
     * for free when there is any.
     *
     * Lowercase, and reuse a tag before inventing one — a vocabulary of four
     * tags used three times each says something, and twelve used once each
     * says nothing.
     */
    tags: z.array(z.string()).default([]),
  }),
});

export const collections = { posts };
