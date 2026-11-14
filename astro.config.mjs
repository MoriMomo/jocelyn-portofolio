import { defineConfig } from 'astro/config';

export default defineConfig({
  site: process.env.GITHUB_ACTIONS ? 'https://morimomo.github.io' : 'https://jocelynlau.work',
  base: process.env.GITHUB_ACTIONS ? '/jocelyn-portofolio' : '/',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
});
