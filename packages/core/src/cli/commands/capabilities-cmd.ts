import { loadConfig } from '../../config/load.js';
import { resolveEmbedder } from '../../api/resolve-embedder.js';
import { buildCapabilities, type Capabilities } from '../../capabilities.js';
import { banner, header, keyValues, bullet, c } from '../format.js';

/**
 * Resolve the configured embedder's model + dim without downloading anything
 * (the ONNX model loads lazily on first embed). Returns null if no project /
 * embedder can be resolved — capabilities still reports the rest.
 */
async function resolveEmbedderInfo(): Promise<{ model: string; dim: number } | null> {
  try {
    const cfg = await loadConfig(process.cwd());
    const e = await resolveEmbedder(cfg.raw);
    return { model: e.modelId, dim: e.dim };
  } catch {
    return null;
  }
}

/**
 * `remember capabilities` — one stable discovery object describing this engine:
 * version, engine, embedder, HTTP endpoints, CLI commands, and the JSON schema
 * version. `--json` emits the machine shape (same as `GET /v1/capabilities`).
 */
export async function capabilitiesCommand(argv: string[] = []): Promise<void> {
  const json = argv.includes('--json');
  const embedder = await resolveEmbedderInfo();
  const caps = buildCapabilities({ embedder });

  if (json) {
    process.stdout.write(JSON.stringify(caps, null, 2) + '\n');
    return;
  }

  printHuman(caps);
}

function printHuman(caps: Capabilities): void {
  const out = process.stdout;
  out.write(`\n${banner(caps.version)}  ${c.dim('capabilities')}\n`);

  out.write(
    header('engine') +
      '\n' +
      keyValues([
        ['name', caps.engine.name],
        ['edition', caps.engine.edition],
        ['search', caps.engine.search],
        ['license', caps.engine.license],
        ['api base', `${caps.engine.api_base} ${c.dim(`(port ${caps.engine.default_port})`)}`],
        [
          'embedder',
          caps.embedder
            ? `${caps.embedder.model} ${c.dim(`(${caps.embedder.dim}-d)`)}`
            : c.dim('(unresolved — run inside a wiki)'),
        ],
        ['schema', `v${caps.json_schema_version}`],
      ]) +
      '\n',
  );

  out.write(header('endpoints') + '\n');
  for (const e of caps.endpoints) {
    out.write(bullet(`${c.cyan(e.method.padEnd(4))} ${c.bold(e.path)}  ${c.dim(e.summary)}`) + '\n');
  }

  out.write('\n' + header('commands') + '\n');
  for (const cmd of caps.commands) {
    const label = `${cmd.name}${cmd.args ? ' ' + c.dim(cmd.args) : ''}`;
    out.write(bullet(`${c.cyan(label)}  ${c.dim(cmd.summary)}`) + '\n');
  }

  out.write(`\n${c.dim('Machine shape: remember capabilities --json  ·  GET /v1/capabilities')}\n`);
}
