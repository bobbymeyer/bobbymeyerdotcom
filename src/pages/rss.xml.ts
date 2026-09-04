import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIContext } from 'astro';
import { byLastTouched } from '@/utils/post-order';

const slugOf = (id: string) => id.replace(/\.mdx?$/, '');

export async function GET(context: APIContext) {
  const posts = (await getCollection('posts', ({ data }) => import.meta.env.DEV || !data.draft))
    .sort(byLastTouched);

  return rss({
    title: 'Bobby Meyer',
    description: 'Writing and notes by Bobby Meyer.',
    site: context.site!,
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.date,
      description: post.data.summary,
      link: `/posts/${slugOf(post.id)}/`,
    })),
  });
}
