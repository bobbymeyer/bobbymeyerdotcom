/**
 * `/og/<slug>.png` — one social card per project, plus `/og/site.png` for
 * every page that is not a project.
 *
 * Static, like the rest of the site: these are drawn during the build and
 * written out as files, so nothing renders an image at request time.
 */
import type { APIRoute } from 'astro';
import { ogImage, SITE_CARD, type OgCard } from '@/lib/og';
import { projectEntries } from '@/lib/project-entries';

/** The card for a page with no project of its own. */
export const SITE_OG_SLUG = 'site';

export async function getStaticPaths() {
  const projects = await projectEntries();

  return [
    { params: { slug: SITE_OG_SLUG }, props: { card: SITE_CARD } },
    ...projects.map((project) => ({
      params: { slug: project.slug },
      props: {
        card: {
          title: project.title,
          summary: project.summary,
          splash: project.splash,
          bg: project.bg,
        } satisfies OgCard,
      },
    })),
  ];
}

export const GET: APIRoute = async ({ props }) => {
  const png = await ogImage((props as { card: OgCard }).card);

  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
