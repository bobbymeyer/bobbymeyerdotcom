import type { PostColor } from '@/palette';
import { POST_PALETTE } from '@/palette';

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
export interface ProjectDef {
  /** `owner/repo`, exactly as GitHub spells it. Public repositories only. */
  repo: string;
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
  /** Kept out of the built site, still visible in dev. */
  draft?: boolean;
}

export const PROJECTS: ProjectDef[] = [
  {
    repo: 'bobbymeyer/its-swiss',
    title: '🇨🇭 its-swiss',
    summary: 'Sensible Swiss Defaults for Rails',
    bg_color: POST_PALETTE.vermillion,
    splash: '/posts/its-swiss/splash.svg',
  },
  {
    repo: 'bobbymeyer/pandatone',
    title: '🐼 pandatone',
    summary: 'Palette Management for Robots',
    bg_color: POST_PALETTE.vermillion,
    splash: '/posts/pandatone/splash.svg',
  },
  {
    repo: 'bobbymeyer/music-for-bus-stops',
    title: '🚏 music for bus stops',
    summary: 'Algorithmic ambience on the cheap',
    bg_color: POST_PALETTE.teal,
    splash: '/posts/music-for-bus-stops/map.png',
  },
  {
    repo: 'bobbymeyer/albers-squares',
    title: '🟧 Albers’ squares',
    summary: 'a Homage to Homage to the Square',
    bg_color: POST_PALETTE.violet,
    splash: '/posts/albers-squares/splash.png',
  },
  {
    repo: 'bobbymeyer/treegen',
    title: '🌳 treegen',
    summary: 'Get in tough with nature, but dear god do not go outside!',
    bg_color: POST_PALETTE.green,
    splash: '/posts/treegen/splash.svg',
  },
  {
    repo: 'bobbymeyer/halftoner',
    title: '🖨️ halftoner',
    summary: 'Ink-first halftones from press profiles',
    bg_color: POST_PALETTE.cobalt,
    splash: '/posts/halftoner/splash.png',
  },
  // Public, and recently worked on, but never written up. They are declared
  // here so the list is one edit away from carrying them: drop the `draft`
  // line and the project is on the site, README and timeline and all.
  {
    repo: 'bobbymeyer/design-chassis',
    title: 'design-chassis',
    bg_color: POST_PALETTE.cobalt,
    draft: true,
  },
  {
    repo: 'bobbymeyer/stripeclub',
    title: 'stripeclub',
    bg_color: POST_PALETTE.green,
    draft: true,
  },
  {
    repo: 'bobbymeyer/badger',
    title: 'badger',
    bg_color: POST_PALETTE.yellow,
    draft: true,
  },
];

/** The slug a project lives at: `slug` if it sets one, else the repo name. */
export function projectSlug(project: ProjectDef): string {
  return project.slug ?? project.repo.split('/')[1]!;
}
