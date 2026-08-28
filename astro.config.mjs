import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  site: 'https://bobbymeyer.com',
  integrations: [mdx()],
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
