import path from 'node:path';
import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import { configSchema, type ValidatedConfig } from './schema.js';
import type { RememberConfig } from '../types.js';

const CONFIG_NAMES = [
  'remember.config.ts',
  'remember.config.mjs',
  'remember.config.js',
];

/**
 * The scaffolded remember.config.ts does
 * `import { defineConfig, defaults } from '@useremember/core'`. When the CLI is
 * installed globally (`npm i -g @useremember/core`) and run inside a wiki that
 * never ran a local `npm install`, jiti — resolving from the project dir — can't
 * find `@useremember/core` in any node_modules above the config, and loading
 * fails. Point that bare specifier (and its subpaths) at THIS very package's
 * build, wherever the CLI itself is installed, so a global install just works.
 *
 * `import.meta.url` here is <pkg>/dist/config/load.js; '../' is <pkg>/dist,
 * whose index.js is the package entry and whose subdirs mirror the "./x"
 * export map. A directory target lets jiti resolve both the bare name (→
 * dist/index.js) and subpath exports (→ dist/<subpath>.js).
 */
const SELF_DIST_DIR = fileURLToPath(new URL('../', import.meta.url));
const SELF_ALIAS: Record<string, string> = {
  '@useremember/core': SELF_DIST_DIR,
};

/** True when a module-resolution failure is about our own package specifier. */
function isCoreResolutionError(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  const code = e?.code;
  const msg = e?.message ?? '';
  return (
    (code === 'ERR_MODULE_NOT_FOUND' ||
      code === 'MODULE_NOT_FOUND' ||
      code === 'ERR_PACKAGE_PATH_NOT_EXPORTED' ||
      /cannot find|could not (?:load|resolve)|failed to resolve/i.test(msg)) &&
    /@useremember\/core/.test(msg)
  );
}

export interface LoadedConfig {
  raw: RememberConfig;
  validated: ValidatedConfig;
  rootDir: string;
  configPath: string | null;
}

/**
 * Load `<rootDir>/.env` into process.env before the config is evaluated, so a
 * scaffolded `.env` (which is where the admin token and connector secrets now live,
 * kept out of the committable config) actually takes effect. Existing process.env
 * values always win — the file only fills in what isn't already set. Best-effort:
 * a missing or malformed file is silently ignored.
 */
async function loadDotEnv(absRoot: string): Promise<void> {
  const envPath = path.join(absRoot, '.env');
  let text: string;
  try {
    text = await fs.readFile(envPath, 'utf8');
  } catch {
    return; // no .env — nothing to do
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key || key in process.env) continue;
    let value = line.slice(eq + 1).trim();
    // Strip a single layer of matching surrounding quotes.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export async function loadConfig(rootDir: string): Promise<LoadedConfig> {
  const absRoot = path.resolve(rootDir);
  await loadDotEnv(absRoot);
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
    // moduleCache: false — required for hot-reload to actually pick up
    // a re-written config file. Without it, jiti returns the cached module.
    // alias — resolves `@useremember/core` to this installed build so a global
    // CLI works in a project that never ran `npm install` (see SELF_ALIAS).
    const jiti = createJiti(absRoot, {
      interopDefault: true,
      moduleCache: false,
      alias: SELF_ALIAS,
    });
    let mod: RememberConfig | { default: RememberConfig };
    try {
      mod = (await jiti.import(configPath)) as RememberConfig | { default: RememberConfig };
    } catch (err) {
      if (isCoreResolutionError(err)) {
        throw new Error(
          `Could not load ${path.basename(configPath)}: it imports "@useremember/core", ` +
            `which isn't resolvable from ${absRoot}.\n` +
            `Fix it with either:\n` +
            `  • npm install            (installs @useremember/core into this project), or\n` +
            `  • npm install -g @useremember/core   (if you meant to use the global CLI)\n` +
            `Underlying error: ${(err as Error).message}`,
        );
      }
      throw err;
    }
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
