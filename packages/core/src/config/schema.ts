import { z } from 'zod';
import { SUPPORTED_FORMATS } from '../parsers/format-router.js';

export const retrievalLimitsSchema = z.object({
  perRetrieverK: z.number().int().positive().default(30),
  candidateK: z.number().int().positive().default(30),
  finalK: z.number().int().positive().default(10),
});

export const configSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  content: z.string().default('./content'),
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      apiPort: z.number().int().positive().default(4320),
      adminToken: z.string().nullable().default(null),
    })
    .default({}),
  search: z
    .object({
      engine: z.unknown().optional(),
    })
    .default({}),
  index: z
    .object({
      /**
       * Formats to ingest. Defaults to `['md']` — an unconfigured install must
       * walk, parse, and index exactly the files it did before multi-format
       * support, so this default is load-bearing, not cosmetic.
       *
       * Anything other than `md` needs the optional `@firecrawl/anydoc`
       * dependency; the parser says so by name if it is missing.
       *
       * The enum is derived from the router's own list rather than restated
       * here: a hand-maintained second list silently rejects a format the
       * engine can actually parse.
       */
      formats: z
        .array(z.enum(SUPPORTED_FORMATS))
        .nonempty()
        .default(['md']),
    })
    .default({}),
  schemaVersion: z.number().int().default(1),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
