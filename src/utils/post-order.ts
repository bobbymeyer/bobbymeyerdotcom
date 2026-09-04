import type { CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'posts'>;

/**
 * When a post was last touched: its `updated` date if it has one, else the day
 * it was published. The index and the feed order on this, so a post that is
 * revised comes back to the top rather than sinking under whatever was written
 * since. The published date stays what it was; it is the byline, not the sort.
 */
export function lastTouched(post: Post): Date {
  return post.data.updated ?? post.data.date;
}

/** Newest touch first. */
export function byLastTouched(a: Post, b: Post): number {
  return lastTouched(b).valueOf() - lastTouched(a).valueOf();
}
