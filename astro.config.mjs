import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({
  integrations: [mdx()],
  vite: {
    server: {
      watch: { usePolling: true },
    },
  },
});
