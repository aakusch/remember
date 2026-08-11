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
 * scaffolded `.env` (which is where the admin token and any API keys now live,
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
  warnUnknownConfigKeys(merged, configPath);
  const validated = configSchema.parse(merged);
  return { raw: merged, validated, rootDir: absRoot, configPath };
}

/**
 * Say so when a config key does nothing.
 *
 * `configSchema` is a plain `z.object()`, so zod strips unknown top-level keys
 * silently. That turned a removed feature into a lie: a config carrying the
 * 0.2.x `connectors: [...]` block parsed cleanly, ingested nothing, and reported
 * nothing. The honesty contract says the engine publishes its limits, so an
 * ignored key has to be visible.
 *
 * A warning rather than `.strict()`: a hard failure would break configs whose
 * extra keys are harmless, and silently breaking someone's boot is a worse
 * trade than telling them what was dropped.
 */
function warnUnknownConfigKeys(raw: RememberConfig, configPath: string | null): void {
  // `pipeline` is read straight off `raw` by the indexer and resolveEmbedder, so
  // it is a real key even though `configSchema` has no entry for it. That also
  // means it is never validated: a typo inside pipeline (a misspelled adapter
  // key, a bad opts field) silently falls back to a default rather than
  // erroring. Schema coverage for pipeline is a separate fix.
  const READ_OFF_RAW = ['pipeline'];
  warnInertPipelineKeys(raw, configPath);
  const known = new Set([...Object.keys(configSchema.shape), ...READ_OFF_RAW]);
  const unknown = Object.keys(raw as Record<string, unknown>).filter((key) => !known.has(key));
  if (unknown.length === 0) return;

  const where = configPath ? path.basename(configPath) : 'the remember config';
  const removed: Record<string, string> = {
    connectors:
      'removed in 0.3.0 — ingestion is not the engine\'s job. Write Markdown into content/ instead (see content/remember.md, "bring content in").',
  };
  for (const key of unknown) {
    const note = removed[key] ? ` ${removed[key]}` : ' It is being ignored.';
    console.warn(`remember: ${where} sets "${key}", which this version does not read.${note}`);
  }
}

function applyEnvOverrides(raw: RememberConfig): RememberConfig {
  const env = process.env;
  const next: RememberConfig = { ...raw };
  next.server = { ...(raw.server ?? {}) };

  if (env.REMEMBER_CONTENT) next.content = env.REMEMBER_CONTENT;
  if (env.REMEMBER_API_PORT) next.server.apiPort = Number(env.REMEMBER_API_PORT);
  if (env.REMEMBER_HOST) next.server.host = env.REMEMBER_HOST;
  if (env.REMEMBER_ADMIN_TOKEN) next.server.adminToken = env.REMEMBER_ADMIN_TOKEN;

  return next;
}

/**
 * Say so when a pipeline knob does nothing.
 *
 * `pipeline` is read straight off `raw`, but only `embedder` is actually consumed:
 * the runtime constructs the walker, parser, chunker and store itself with fixed
 * settings. A config that sets `chunker.smartSplit({ size: 2000 })` therefore
 * changes nothing, reports nothing, and leaves its author debugging retrieval
 * quality against a number that was never applied.
 *
 * Wiring them is a feature, not a bugfix — until then the honest move is to name
 * what is being ignored. Same reasoning as warnUnknownConfigKeys above.
 */
function warnInertPipelineKeys(raw: RememberConfig, configPath: string | null): void {
  const pipeline = (raw as { pipeline?: Record<string, unknown> }).pipeline;
  if (!pipeline) return;
  const INERT = ['walker', 'parser', 'chunker', 'store'] as const;
  const set = INERT.filter((k) => pipeline[k] !== undefined);
  if (set.length === 0) return;
  const where = configPath ? path.basename(configPath) : 'the remember config';
  console.warn(
    `remember: ${where} sets pipeline.${set.join(', pipeline.')} — not yet wired to ` +
      `config and ignored. The runtime uses its built-in walker/parser/chunker/store. ` +
      `Only pipeline.embedder is read.`,
  );
}
