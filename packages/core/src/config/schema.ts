import { z } from 'zod';

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
  schemaVersion: z.number().int().default(1),
});

export type ValidatedConfig = z.infer<typeof configSchema>;
