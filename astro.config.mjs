import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://bobbymeyer.com',
  integrations: [
    mdx(),
    // Writes /sitemap-index.xml and /sitemap-0.xml, which public/robots.txt
    // points at. The social cards under /og are images, not pages, and /lab
    // is a bench that only previews build.
    sitemap({ filter: (page) => !page.includes('/og/') && !page.includes('/lab/') }),
  ],
  markdown: {
    syntaxHighlight: 'shiki',
    shikiConfig: {
      theme: 'github-light',
    },
  },
  devToolbar: {
    enabled: false,
  },
  vite: {
    server: {
      watch: { usePolling: true },
    },
  },
});
