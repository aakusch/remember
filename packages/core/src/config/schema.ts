import { z } from 'zod';

export const configSchema = z.object({
  name: z.string().optional(),
  description: z.string().optional(),
  content: z.string().default('./content'),
  server: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().positive().default(4321),
      apiPort: z.number().int().positive().default(4320),
      adminToken: z.string().nullable().default(null),
    })
    .default({}),
  index: z
    .object({
      watchMode: z.enum(['on', 'off', 'on-dev-only']).default('on'),
      debounceMs: z.number().int().nonnegative().default(500),
      onStaleModel: z.enum(['prompt', 'auto-reembed', 'ignore']).default('prompt'),
    })
    .default({}),
  viewer: z
    .object({
      landing: z.string().default('README.md'),
      showAdmin: z.boolean().default(true),
      breadcrumbs: z.boolean().default(true),
    })
    .default({}),
  schemaVersion: z.number().int().default(1),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
