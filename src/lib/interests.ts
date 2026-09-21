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

export interface Interest {
  tag: string;
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
  const seen = new Map<string, Interest>();

  for (const project of projects) {
    for (const tag of project.tags) {
      const found = seen.get(tag);
      if (!found) {
        seen.set(tag, { tag, count: 1, latest: project.updated });
        continue;
      }

      found.count += 1;
      if (project.updated > found.latest) found.latest = project.updated;
    }
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
