import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://jocelynlau.work',
  compressHTML: true,
  build: {
    inlineStylesheets: 'auto',
  },
});
