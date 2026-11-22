import { defineConfig } from 'astro/config';

const base = process.env.BASE_PATH ?? (process.env.GITHUB_ACTIONS ? '/jocelyn-portofolio' : '/');

export default defineConfig({
  site: process.env.GITHUB_ACTIONS ? 'https://morimomo.github.io' : 'https://jocelynlau.work',
  base,
  compressHTML: true,
  devToolbar: { enabled: false },
  build: {
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      chunkSizeWarningLimit: 650,
    },
  },
});
