import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { projectEntries } from '@/lib/project-entries';

export async function GET(context: APIContext) {
  const projects = await projectEntries();

  return rss({
    title: 'Bobby Meyer',
    description: 'Projects by Bobby Meyer, newest change first.',
    site: context.site!,
    items: projects.map((project) => ({
      title: project.version ? `${project.title} v${project.version}` : project.title,
      // The feed is a feed of changes, so an item is dated by the last one.
      // A project that moves comes back round rather than staying where it
      // was first published.
      pubDate: project.updated,
      description: project.summary,
      link: `${project.href}/`,
    })),
  });
}
