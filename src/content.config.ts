import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { fileURLToPath } from 'node:url';
import { POST_PALETTE, type PostColorName } from './palette';

/**
 * A note on a project: `src/content/posts/<slug>.md`, matched to the entry in
 * `src/projects.ts` with the same slug, and set above that project's README.
 *
 * There is almost no frontmatter because there is almost nothing left for it
 * to say. The title, the summary, the colour and the splash are declared once
 * in the manifest; the version, the dates and the README come from GitHub. A
 * note is the part of a project that only a person can write.
 *
 * A note tagged `post` with no project behind it is a standalone post, and
 * stands on its own at the same address. With no repository to read, it
 * carries the few facts a repository would have supplied — see the fields at
 * the end.
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
     * What this is about — subjects, not tools. What a thing is *made of*
     * goes in `stack` below, because "generative" and "p5" are not the same
     * kind of fact and a list that ran them together answered neither
     * question well. The about page collects these across every note and sets
     * them out as a list of interests, ordered either by how often a tag comes
     * up or by how recently.
     *
     * They live on the note rather than in `src/projects.ts` because the note
     * is the part that is not a repository: a note carries tags whether or not
     * a project stands behind it, so writing that is not a project gets them
     * for free when there is any.
     *
     * Lowercase, and reuse a tag before inventing one — a vocabulary of four
     * tags used three times each says something, and twelve used once each
     * says nothing.
     *
     * One of them says what the thing *is* rather than what it is about:
     * every note carries `project`, and writing that is not a project will
     * carry `post`. Those two are held apart wherever a reader meets them —
     * off the about page's interests, off the cards, and in their own group
     * in the filter — because "what is this" and "what is it about" are
     * different questions. See `KIND_TAGS` in `src/lib/interests.ts`.
     */
    tags: z.array(z.string()).default([]),
    /**
     * What it is built with, in three tiers and in this order: the language,
     * the framework, and any major library the project is built around.
     * `[ruby, rails]`, `[javascript, p5]`, `[python]`.
     *
     * Those three and nothing else: a host, a CI service or a package manager
     * is none of them, however much the project leans on it.
     *
     * Every project names its language, even where the framework implies it.
     * Incidental dependencies stay out — this site draws its social cards
     * with satori and sharp and names neither, because nobody would call it a
     * satori app.
     *
     * Its own field rather than more tags, because a technology answers a
     * different question from a subject, and a reader looking for the Rails
     * projects and a reader looking for the typography ones are not doing the
     * same thing. It has its own group in the filter and stays off the about
     * page's interests, which are subjects.
     *
     * Lowercase, and set as the thing calls itself — `p5`, not `p5.js` — but
     * spell a language out: `javascript` and `typescript`, never `js` or `ts`,
     * so neither of the pair looks abbreviated beside the other.
     *
     * Nothing technological belongs in `tags`. See CLAUDE.md.
     */
    stack: z.array(z.string()).default([]),

    /*
     * The rest is for a standalone post: a note tagged `post` with no project
     * in `src/projects.ts` behind it. A project's note leaves these alone,
     * because a repository already answers each of them; a post has no
     * repository to ask, so it says them here. `src/lib/project-entries.ts`
     * refuses a post that is missing its title or its date.
     */

    /** Lowercase, like every title on the site. Emoji are fine. */
    title: z.string().optional(),
    /** The one line under the title, and on the card. */
    summary: z.string().optional(),
    /** When it went up. */
    date: z.coerce.date().optional(),
    /** When it last changed, if it has since. The index sorts on this. */
    updated: z.coerce.date().optional(),
    /** Fills the 16:9 splash field. A name from `src/palette.ts`. */
    color: z
      .enum(Object.keys(POST_PALETTE) as [PostColorName, ...PostColorName[]])
      .default('paper'),
    /** Image laid over the splash field. */
    splash: z.string().optional(),
  }),
});

export const collections = { posts };
