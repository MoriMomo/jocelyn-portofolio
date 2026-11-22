import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://jocelynlau-portofolio.sclassbinus.com',
  base: '/',
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
