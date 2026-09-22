import { getCollection, type CollectionEntry } from 'astro:content';
import { PROJECTS, projectSlug, isFeatured, isInteractive, type ProjectDef } from '@/projects';
import { cleanReadmeHtml, cleanNote } from '@/lib/github-text';
import {
  ghHtml,
  ghJson,
  hasToken,
  type Commit,
  type PullRequest,
  type Release,
  type Repo,
  type Tag,
} from '@/lib/github';

/** How many merged pull requests a project's timeline shows. */
const TIMELINE_LIMIT = 25;

/**
 * A merged pull request, with whatever was said about it when it went in: the
 * description if it has one, otherwise the body of the merge commit. Squash
 * merges put the description in the commit and plain merges do not, so the two
 * together cover both without a request per pull request in the common case.
 */
const MERGE_COMMIT_LOOKUPS = 10;

export interface TimelineEntry {
  number: number;
  title: string;
  url: string;
  mergedAt: Date;
  author: string | null;
  note: string | null;
}

export interface ProjectEntry {
  slug: string;
  href: string;
  title: string;
  summary: string;
  version: string | null;
  versionUrl: string | null;
  bg: string;
  splash: string | undefined;
  /**
   * What this project is about, from its note's frontmatter. The index prints
   * them on the card, the about page counts them, and each one has a page of
   * its own listing everything that carries it.
   */
  tags: string[];
  /**
   * What it is built with, from its note's frontmatter: languages,
   * frameworks, libraries, formats. Its own group in the filter, and held
   * apart from `tags` because a tool is not a subject.
   */
  stack: string[];
  /** Wears a star on the index, and is a group of its own in the filter. */
  featured: boolean;
  /** Runs on its own page; the index marks it with a registration target. */
  interactive: boolean;
  /** When the repository was created. */
  published: Date;
  /**
   * The last commit on the default branch — the date the index sorts on,
   * within its half of the list.
   */
  updated: Date;
  repo: {
    nameWithOwner: string;
    url: string;
    homepage: string | null;
    language: string | null;
    topics: string[];
    stars: number;
    /**
     * Archived on GitHub: the splash says so, it loses its colour, and the
     * project sorts below the live ones.
     */
    archived: boolean;
  };
  readmeHtml: string | null;
  timeline: TimelineEntry[];
  note: CollectionEntry<'posts'> | null;
}

let cached: Promise<ProjectEntry[]> | null = null;

/**
 * Every project on the site, newest change first, archived ones last. Memoised:
 * the index, each project page and the feed all ask for this during one build,
 * and they should agree with each other and cost one read of GitHub between
 * them.
 */
export function projectEntries(): Promise<ProjectEntry[]> {
  cached ??= build();
  return cached;
}

export async function projectEntry(slug: string): Promise<ProjectEntry | undefined> {
  return (await projectEntries()).find((entry) => entry.slug === slug);
}

async function build(): Promise<ProjectEntry[]> {
  if (!hasToken) {
    console.warn(
      '[projects] No GITHUB_TOKEN — reading GitHub unauthenticated, 60 requests an hour.',
    );
  }

  const notes = new Map(
    (await getCollection('posts', ({ data }) => !data.draft)).map((note) => [
      note.id.replace(/\.mdx?$/, ''),
      note,
    ]),
  );

  const visible = PROJECTS.filter((project) => import.meta.env.DEV || !project.draft);
  const loaded = await Promise.all(visible.map((project) => guard(project, notes)));
  const entries = loaded.filter((entry): entry is ProjectEntry => entry !== null);

  for (const slug of notes.keys()) {
    if (!entries.some((entry) => entry.slug === slug)) {
      console.warn(`[projects] src/content/posts/${slug}.md has no project in src/projects.ts.`);
    }
  }

  return entries.sort(byBandThenUpdated);
}

/**
 * Whether a project sorts to the bottom.
 *
 * Featured used to sort to the top, on the grounds that a commit date cannot
 * tell you which projects are worth stopping on and the tag can. It is a
 * filter of its own now, which asks the question better than an order can:
 * an order says "these three matter" to everyone at once and cannot be turned
 * off, and nobody reading a list sorted by date can tell which part of it is
 * the date talking.
 *
 * Archived stays down, and is not the same kind of rule. Archiving is the
 * last commit a project gets, so a finished project would otherwise arrive at
 * the head of a list ordered by last change on the strength of being finished.
 * That is a correction for a date that lies rather than a ranking.
 */
function band(entry: ProjectEntry): number {
  return entry.repo.archived ? 1 : 0;
}

/**
 * The order the index and the feed both use: newest change first, with the
 * archived below the live.
 */
function byBandThenUpdated(a: ProjectEntry, b: ProjectEntry): number {
  const bands = band(a) - band(b);
  if (bands !== 0) return bands;
  return b.updated.valueOf() - a.updated.valueOf();
}

/**
 * A project that cannot be read is a broken page, and a broken page should not
 * ship: a build stops and says which repository and why, and the deploy that
 * is already live stays live. Development is the other way round — one renamed
 * repository should not stand between you and the stylesheet you are editing —
 * so there it is a warning and the project drops off the list until it reads.
 */
async function guard(
  project: ProjectDef,
  notes: Map<string, CollectionEntry<'posts'>>,
): Promise<ProjectEntry | null> {
  try {
    return await load(project, notes);
  } catch (error) {
    if (!import.meta.env.DEV) throw error;
    console.warn(`[projects] Skipping ${project.repo}: ${(error as Error).message}`);
    return null;
  }
}

async function load(
  project: ProjectDef,
  notes: Map<string, CollectionEntry<'posts'>>,
): Promise<ProjectEntry> {
  const slug = projectSlug(project);
  const path = `/repos/${project.repo}`;

  const repo = await ghJson<Repo>(path);
  if (!repo) throw new Error(`[projects] ${project.repo} is not readable — check src/projects.ts.`);
  if (repo.private) {
    throw new Error(
      `[projects] ${project.repo} is private. The site is public and the README and pull ` +
        'request titles would be too; make the repository public or take it out of src/projects.ts.',
    );
  }

  const [readme, release, tags, pulls, head] = await Promise.all([
    ghHtml(`${path}/readme`),
    ghJson<Release>(`${path}/releases/latest`),
    ghJson<Tag[]>(`${path}/tags?per_page=1`),
    ghJson<PullRequest[]>(`${path}/pulls?state=closed&sort=updated&direction=desc&per_page=100`),
    ghJson<Commit[]>(`${path}/commits?sha=${encodeURIComponent(repo.default_branch)}&per_page=1`),
  ]);

  const timeline = await buildTimeline(path, pulls ?? []);
  const lastCommit = head?.[0]?.commit.committer?.date;
  const version = versionOf(repo, release, tags?.[0] ?? null);

  return {
    slug,
    href: `/posts/${slug}`,
    title: project.title ?? repo.name,
    summary: project.summary ?? repo.description ?? '',
    version: version?.label ?? null,
    versionUrl: version?.url ?? null,
    bg: project.bg_color,
    splash: project.splash,
    tags: normalizeTags(notes.get(slug)?.data.tags),
    stack: normalizeTags(notes.get(slug)?.data.stack),
    featured: isFeatured(project),
    interactive: isInteractive(project),
    published: new Date(repo.created_at),
    updated: new Date(lastCommit ?? repo.pushed_at),
    repo: {
      nameWithOwner: repo.full_name,
      url: repo.html_url,
      homepage: repo.homepage?.trim() ? repo.homepage : null,
      language: repo.language,
      topics: repo.topics ?? [],
      stars: repo.stargazers_count,
      archived: repo.archived,
    },
    readmeHtml: readme
      ? cleanReadmeHtml(readme, { nameWithOwner: repo.full_name, branch: repo.default_branch })
      : null,
    timeline,
    note: notes.get(slug) ?? null,
  };
}

/**
 * A note's tags, tidied and deduplicated.
 *
 * Lowercased so that `Print` and `print` are one interest rather than two,
 * and order is kept as written — a note lists what it is mostly about first,
 * and the card prints them in that order.
 */
function normalizeTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();

  for (const raw of tags ?? []) {
    const tag = raw.trim().toLowerCase();
    if (tag) seen.add(tag);
  }

  return [...seen];
}

/** For comparing a note with a title: case, spacing and final stop are noise. */
function flatten(text: string): string {
  return text.trim().replace(/\s+/g, ' ').replace(/[.!?]+$/, '').toLowerCase();
}

/**
 * A timeline note with the entry's own title taken back out of it.
 *
 * Squash merges put the pull request title in the commit subject and plain
 * merges put it in the commit body, so the text that stands in for a missing
 * description very often *is* the title — and the title is already set, in
 * bold, directly above. A note that only repeats it says nothing twice, and a
 * note that opens with it and then goes on is worth keeping from the second
 * line. Everything else passes through as it came.
 */
function withoutEchoOf(note: string | null, title: string): string | null {
  if (!note) return null;

  const wanted = flatten(title);
  if (flatten(note) === wanted) return null;

  const [first, ...rest] = note.split('\n');
  if (flatten(first ?? '') === wanted) {
    const remainder = rest.join('\n').trim();
    return remainder || null;
  }

  return note;
}

/**
 * What version a project is at.
 *
 * A release is the answer when there is one. Plenty of repositories tag and
 * never cut one — a gem push is the release, and GitHub's Releases tab stays
 * empty — so the newest tag answers for those. GitHub returns tags newest
 * first, and a tag page renders whether or not a release was made from it.
 */
function versionOf(
  repo: Repo,
  release: Release | null,
  tag: Tag | null,
): { label: string; url: string } | null {
  const name = release?.tag_name ?? tag?.name;
  if (!name) return null;

  return {
    label: name.replace(/^v/, ''),
    url: release?.html_url ?? `${repo.html_url}/releases/tag/${encodeURIComponent(name)}`,
  };
}

async function buildTimeline(path: string, pulls: PullRequest[]): Promise<TimelineEntry[]> {
  const merged = pulls
    .filter((pull): pull is PullRequest & { merged_at: string } => Boolean(pull.merged_at))
    .sort((a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at))
    .slice(0, TIMELINE_LIMIT);

  let lookups = 0;

  return Promise.all(
    merged.map(async (pull) => {
      let note = cleanNote(pull.body);

      if (!note && pull.merge_commit_sha && lookups < MERGE_COMMIT_LOOKUPS) {
        lookups += 1;
        const commit = await ghJson<Commit>(`${path}/commits/${pull.merge_commit_sha}`);
        // The first line of a merge commit is "Merge pull request #n from …",
        // which the entry already says. What is worth showing is under it.
        note = cleanNote(commit?.commit.message.split('\n').slice(1).join('\n') ?? null);
      }

      // GitHub's default body for a merge commit *is* the pull request title,
      // so a pull request merged without a description arrives here with a
      // note that repeats the heading it would be set under. Say it once.
      note = withoutEchoOf(note, pull.title);

      return {
        number: pull.number,
        title: pull.title,
        url: pull.html_url,
        mergedAt: new Date(pull.merged_at),
        author: pull.user?.login ?? null,
        note,
      };
    }),
  );
}
