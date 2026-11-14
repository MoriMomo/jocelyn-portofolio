import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const work = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/work' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      summary: z.string(),
      order: z.number(),
      category: z.enum(['Strategy & Consulting', 'Leadership & Community']),
      role: z.string(),
      org: z.string(),
      team: z.string().optional(),
      result: z.string().optional(),
      tag: z.string(),
      cover: image(),
      coverAlt: z.string(),
      gallery: z
        .array(
          z.object({
            src: image(),
            alt: z.string(),
            caption: z.string().optional(),
          }),
        )
        .default([]),
      deckUrl: z.string().url().optional(),
      learned: z.array(z.string()).optional(),
      metrics: z
        .array(
          z.object({
            value: z.string(),
            label: z.string(),
          }),
        )
        .default([]),
    }),
});

export const collections = { work };
