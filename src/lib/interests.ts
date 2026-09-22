/**
 * What the site is about, counted.
 *
 * Every note in `src/content/posts` carries tags. Collected across all of
 * them, they are a fair account of what someone actually spends their time
 * on — fairer than a sentence about it, because nobody writes nine projects
 * about a thing they are not interested in, and the count is not a claim, it
 * is a tally.
 *
 * Two orders, because they answer different questions. *Greatest* is by how
 * often a tag comes up, which is what someone keeps returning to. *Recent* is
 * by when a tag was last touched, which is what they are on now. A tag can
 * rank high in one and low in the other, and that difference is the
 * interesting part: a preoccupation that has gone quiet, a new enthusiasm
 * with only one project behind it.
 */
import type { ProjectEntry } from '@/lib/project-entries';

/**
 * Tags that say what a thing *is* rather than what it is about.
 *
 * Every note carries one. They live in the same list as the topics because a
 * tag is a tag and the filter already understands them, but they are held
 * apart everywhere a reader meets them: "project" is not an interest, so it
 * has no business in the list on the about page, and it is on all nine cards
 * at once, so printing it on each of them says nothing.
 *
 * Where they earn their place is the filter, in the group above the subjects —
 * which is worth nearly nothing today, with one kind and everything in it, and
 * is the whole point the first time a post appears next to the projects.
 */
export const KIND_TAGS = ['project', 'post'] as const;

export type KindTag = (typeof KIND_TAGS)[number];

export function isKind(tag: string): tag is KindTag {
  return (KIND_TAGS as readonly string[]).includes(tag);
}

/**
 * Marks a thing wears rather than subjects it covers.
 *
 * Unlike the kinds these are not on the note at all: they are set in
 * `src/projects.ts` and read back by `isFeatured` and `isInteractive`. They
 * are joined onto a card's filter keys by `filterTags` below rather than
 * folded into its `tags`, because `tags` is what the card prints as chips and
 * what the about page counts as interests, and a mark is neither. It is a
 * fact about a thing, not a thing the thing is about.
 */
export const MARK_TAGS = ['featured', 'interactive'] as const;

export type MarkTag = (typeof MARK_TAGS)[number];

export function isMark(tag: string): tag is MarkTag {
  return (MARK_TAGS as readonly string[]).includes(tag);
}

/**
 * The group above the subjects, in the order it is set in.
 *
 * Fixed rather than counted, unlike the topics: there are four of these and
 * they are always the same four, so an order that shuffled as the tallies
 * moved would only make the row harder to find something in. Posts lead
 * because they are the thing this site does not have yet and will.
 */
export const FACET_ORDER = ['post', 'project', 'featured', 'interactive'] as const;

export function isFacet(tag: string): boolean {
  return isKind(tag) || isMark(tag);
}

/**
 * How a facet is set in the dropdown.
 *
 * The kinds are pluralised because the option names a set of things —
 * "projects 9" — while the marks are adjectives and stay as they are: a thing
 * is featured, it is not a featured. Only the label moves; the value behind it
 * stays singular, because that is the tag as the note carries it and as it
 * goes into the address bar.
 */
export function facetLabel(tag: string): string {
  return isKind(tag) ? `${tag}s` : tag;
}

/**
 * Everything a card can be narrowed by: the tags on its note, what it is built
 * with, plus whichever marks it wears. This is what goes into `data-tags`, and what the counts in
 * the dropdown are counted from, so the two cannot drift apart.
 */
export function filterTags(project: ProjectEntry): string[] {
  return [
    ...project.tags,
    ...project.stack,
    ...MARK_TAGS.filter((mark) => (mark === 'featured' ? project.featured : project.interactive)),
  ];
}

/**
 * Which vocabulary an interest came out of.
 *
 * Three questions, kept apart: what a thing is and how it is marked, what it
 * is about, and what it is built with. They are counted in one pass and
 * labelled as they go, rather than sorted out afterwards by name — which
 * would have to guess if a word ever turned up in two of them.
 */
export type InterestField = 'facet' | 'topic' | 'stack';

export interface Interest {
  tag: string;
  field: InterestField;
  /** How many things carry it. */
  count: number;
  /** The most recent change to anything carrying it. */
  latest: Date;
}

/** How a list of interests is ordered. */
export type InterestOrder = 'greatest' | 'recent';

export const INTEREST_ORDERS: { value: InterestOrder; label: string }[] = [
  { value: 'greatest', label: 'greatest' },
  { value: 'recent', label: 'recent' },
];

/**
 * The same two orders, said the way they are said about tools.
 *
 * A subject is one he keeps returning to or one he is on now; a tool is one he
 * usually reaches for or one he has lately been reaching for. Same tally, same
 * sort, different sentence around it — so the values match and only the words
 * change.
 */
export const STACK_ORDERS: { value: InterestOrder; label: string }[] = [
  { value: 'greatest', label: 'usually' },
  { value: 'recent', label: 'lately' },
];

export const DEFAULT_INTEREST_ORDER: InterestOrder = 'greatest';

/**
 * Every tag across every project's note, with its tally and its latest date.
 *
 * A project dates its own tags by its last commit, which is the date the
 * index already sorts on. Archived projects count: they are still things he
 * was interested in, and *recent* will sink them on its own without the list
 * having to take a view.
 */
export function interestsFrom(projects: ProjectEntry[]): Interest[] {
  // Keyed by field as well as name, so a word that is both a subject and a
  // tool somewhere would be counted as each rather than collapsed into one.
  const seen = new Map<string, Interest>();

  const count = (tag: string, field: InterestField, latest: Date) => {
    const key = `${field}\0${tag}`;
    const found = seen.get(key);
    if (!found) {
      seen.set(key, { tag, field, count: 1, latest });
      return;
    }

    found.count += 1;
    if (latest > found.latest) found.latest = latest;
  };

  for (const project of projects) {
    for (const tag of project.tags) {
      count(tag, isFacet(tag) ? 'facet' : 'topic', project.updated);
    }
    for (const mark of MARK_TAGS) {
      if (mark === 'featured' ? project.featured : project.interactive) {
        count(mark, 'facet', project.updated);
      }
    }
    for (const tool of project.stack) count(tool, 'stack', project.updated);
  }

  return [...seen.values()];
}

/**
 * The same interests in a given order.
 *
 * Both orders break their ties the other way round, so neither ever has to
 * fall back on whatever order the notes happened to load in: the most-used
 * tags settle by recency, and the most recent settle by weight.
 */
export function orderInterests(interests: Interest[], order: InterestOrder): Interest[] {
  const sorted = [...interests];

  if (order === 'recent') {
    sorted.sort(
      (a, b) => b.latest.valueOf() - a.latest.valueOf() || b.count - a.count || a.tag.localeCompare(b.tag),
    );
  } else {
    sorted.sort(
      (a, b) => b.count - a.count || b.latest.valueOf() - a.latest.valueOf() || a.tag.localeCompare(b.tag),
    );
  }

  return sorted;
}

/** The ones that describe a subject. What the about page counts. */
export function topicsOnly(interests: Interest[]): Interest[] {
  return interests.filter((interest) => interest.field === 'topic');
}

/**
 * The ones that name a tool: languages, frameworks, libraries, formats.
 *
 * Their own group in the filter, and off the about page, which is a list of
 * interests rather than a CV. That someone reaches for Rails twice is a fact
 * about how the work got made, not about what he is drawn to.
 */
export function stackOnly(interests: Interest[]): Interest[] {
  return interests.filter((interest) => interest.field === 'stack');
}

/**
 * What a thing is and how it is marked, for the group above the subjects.
 *
 * In FACET_ORDER, and only the ones something actually carries: an option
 * standing at nought is one a reader can only be disappointed by, and each of
 * these appears on its own the first time it is true of anything. Today that
 * is projects, featured and interactive; posts joins them when there is one.
 */
export function facetsOnly(interests: Interest[]): Interest[] {
  return FACET_ORDER.map((tag) =>
    interests.find((interest) => interest.field === 'facet' && interest.tag === tag),
  ).filter(
    (interest): interest is Interest => interest !== undefined,
  );
}

/**
 * The index, narrowed to a tag.
 *
 * There is one filtered view of the projects and it is the index with a
 * query on it. There were briefly static pages under `/tags/` as well, which
 * meant two URLs for one idea, two code paths to keep in step, and a
 * dropdown that behaved differently depending on which of them you were
 * standing on. One mechanism is worth more than the crawlable pages were.
 *
 * The query is read by `src/scripts/project-filter.ts`, so a link here
 * narrows nothing on its own: with scripting off it lands on the index with
 * every project listed, which is a worse answer than the one asked for but
 * not a broken one.
 */
export function tagHref(tag: string): string {
  return `/?tags=${encodeURIComponent(tag)}`;
}

/**
 * The position of each tag in each order, which is what the page hands the
 * browser so that changing the order is a reordering rather than a reload.
 */
export function interestRanks(
  interests: Interest[],
): Record<InterestOrder, Record<string, number>> {
  const ranks = {} as Record<InterestOrder, Record<string, number>>;

  for (const { value } of INTEREST_ORDERS) {
    ranks[value] = Object.fromEntries(
      orderInterests(interests, value).map((interest, index) => [interest.tag, index]),
    );
  }

  return ranks;
}
