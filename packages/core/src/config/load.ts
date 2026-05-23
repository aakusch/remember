import path from 'node:path';
import { promises as fs } from 'node:fs';
import { createJiti } from 'jiti';
import { configSchema, type ValidatedConfig } from './schema.js';
import type { RememberConfig } from '../types.js';

const CONFIG_NAMES = [
  'remember.config.ts',
  'remember.config.mjs',
  'remember.config.js',
];

export interface LoadedConfig {
  raw: RememberConfig;
  validated: ValidatedConfig;
  rootDir: string;
  configPath: string | null;
}

export async function loadConfig(rootDir: string): Promise<LoadedConfig> {
  const absRoot = path.resolve(rootDir);
  let configPath: string | null = null;

  for (const name of CONFIG_NAMES) {
    const candidate = path.join(absRoot, name);
    try {
      await fs.access(candidate);
      configPath = candidate;
      break;
    } catch {
      // missing — try next
    }
  }

  let raw: RememberConfig = {};
  if (configPath) {
    const jiti = createJiti(absRoot, { interopDefault: true });
    const mod = (await jiti.import(configPath)) as RememberConfig | { default: RememberConfig };
    raw = ('default' in (mod as object) ? (mod as { default: RememberConfig }).default : mod) as RememberConfig;
  }

  const merged = applyEnvOverrides(raw);
  const validated = configSchema.parse(merged);
  return { raw: merged, validated, rootDir: absRoot, configPath };
}

function applyEnvOverrides(raw: RememberConfig): RememberConfig {
  const env = process.env;
  const next: RememberConfig = { ...raw };
  next.server = { ...(raw.server ?? {}) };

  if (env.REMEMBER_CONTENT) next.content = env.REMEMBER_CONTENT;
  if (env.REMEMBER_PORT) next.server.port = Number(env.REMEMBER_PORT);
  if (env.REMEMBER_API_PORT) next.server.apiPort = Number(env.REMEMBER_API_PORT);
  if (env.REMEMBER_HOST) next.server.host = env.REMEMBER_HOST;
  if (env.REMEMBER_ADMIN_TOKEN) next.server.adminToken = env.REMEMBER_ADMIN_TOKEN;

  return next;
}
