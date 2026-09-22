/**
 * The index is a list of projects, not of posts, and this is the list.
 *
 * Everything a project page shows that GitHub already knows — the title, the
 * description, the version, when it was published, when it last changed, the
 * README, the merged pull requests — is read from the repository at build
 * time. What stays here is the part GitHub has no opinion about: which repos
 * are projects, in what order they are declared, and what colour each one is.
 *
 * Adding a project is one entry. Taking one off the site is `draft: true`,
 * which keeps it visible in `npm run dev` and out of the built site.
 *
 * A project may also have a note: `src/content/posts/<slug>.md`, whose body is
 * set above the README on the project page. It is optional — a project with no
 * note is the README and the timeline, and reads fine.
 */
import type { PostColor } from '@/palette';
import { POST_PALETTE } from '@/palette';

/**
 * What a project can be tagged as.
 *
 * Two tags, both of which the index acts on, and a typo in either is a type
 * error rather than a tag that silently does nothing. Adding a third is a
 * word here and whatever reads it.
 *
 * - `featured` — the projects worth stopping on, which is a judgement no
 *   commit date can make. It wears a star and it is a group in the filter,
 *   so a reader can ask for them; it used to sort them to the top instead,
 *   and before that gave them two fields of width, and both of those asserted
 *   at everyone at once what a filter lets one person ask.
 * - `interactive` — the thing runs on its own project page, so the index
 *   marks it with a registration target and says so in the legend.
 */
export type ProjectTag = 'featured' | 'interactive';

export interface ProjectDef {
  /** `owner/repo`, exactly as GitHub spells it. Public repositories only. */
  repo: string;
  /** See `ProjectTag`. Order does not matter; a project may have both. */
  tags?: ProjectTag[];
  /** URL segment, and the name of the optional note. Defaults to the repo name. */
  slug?: string;
  /** Defaults to the repo name. Emoji are fine; they are part of the title. */
  title?: string;
  /** Overrides the repository description from GitHub. */
  summary?: string;
  /** Fills the 16:9 splash field. One of the hexes in `src/palette.ts`. */
  bg_color: PostColor;
  /** Image laid over the splash field. */
  splash?: string;
  /**
   * Sorted below the other live projects, whatever its last commit says.
   *
   * For the one project whose date cannot be compared with the rest: this
   * site. Every change to any of the others is published by committing to it,
   * so it holds "most recently touched" permanently and says nothing by
   * holding it — the list would open on the same card forever, and on the one
   * a reader is already standing in.
   *
   * It is still live and still worth reading, so it sits under the live
   * projects rather than under the archived ones.
   */
  demote?: boolean;
  /** Kept out of the built site, still visible in dev. */
  draft?: boolean;
}

export const PROJECTS: ProjectDef[] = [
  {
    repo: 'bobbymeyer/its-swiss',
    title: '🇨🇭 its-swiss',
    summary: 'sensible Swiss defaults for Rails',
    bg_color: POST_PALETTE.vermillion,
    splash: '/posts/its-swiss/splash.svg',
  },
  {
    repo: 'bobbymeyer/pandatone',
    title: '🐼 pandatone',
    summary: 'palette management for robots',
    bg_color: POST_PALETTE.vermillion,
    splash: '/posts/pandatone/splash.svg',
  },
  {
    repo: 'bobbymeyer/music-for-bus-stops',
    title: '🚏 music for bus stops',
    summary: 'algorithmic ambience on the cheap',
    tags: ['featured', 'interactive'],
    bg_color: POST_PALETTE.teal,
    splash: '/posts/music-for-bus-stops/map.png',
  },
  {
    repo: 'bobbymeyer/albers-squares',
    title: '🟧 Albers’ squares',
    summary: 'a homage to Homage to the Square',
    tags: ['interactive'],
    bg_color: POST_PALETTE.violet,
    splash: '/posts/albers-squares/splash.png',
  },
  {
    repo: 'bobbymeyer/treegen',
    title: '🌳 treegen',
    summary: 'get in touch with nature without touching any nature',
    tags: ['featured', 'interactive'],
    bg_color: POST_PALETTE.green,
    splash: '/posts/treegen/splash.svg',
  },
  {
    repo: 'bobbymeyer/halftoner',
    title: '🖨️ halftoner',
    summary: 'ink-first halftones from press profiles',
    bg_color: POST_PALETTE.cobalt,
    splash: '/posts/halftoner/splash.png',
  },
  {
    repo: 'bobbymeyer/gridi',
    title: '🎹 gridi',
    summary: 'route based midi generation',
    bg_color: POST_PALETTE.blue,
    splash: '/posts/gridi/splash.svg',
    tags: ['interactive'],
  },
  {
    repo: 'bobbymeyer/succession',
    title: '👑 succession',
    bg_color: POST_PALETTE.rust,
    splash: '/posts/succession/splash.svg',
  },
  {
    repo: 'bobbymeyer/bobbymeyerdotcom',
    demote: true,
    title: '🪞 bobbymeyer.com',
    summary: 'a portfolio that rebuilds itself from GitHub',
    bg_color: POST_PALETTE.paper,
    splash: '/posts/bobbymeyerdotcom/splash.svg',
  },
];

/** The slug a project lives at: `slug` if it sets one, else the repo name. */
export function projectSlug(project: ProjectDef): string {
  return project.slug ?? project.repo.split('/')[1]!;
}

/** Wears a star on the index, and can be filtered for. Order is not its job. */
export function isFeatured(project: ProjectDef): boolean {
  return project.tags?.includes('featured') ?? false;
}

/** Runs on its own page: the index marks it, and the legend explains the mark. */
export function isInteractive(project: ProjectDef): boolean {
  return project.tags?.includes('interactive') ?? false;
}
