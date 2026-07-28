import { AGENT_TOOL_DEFS } from '../../api/tool-defs.js';
import { c, header } from '../format.js';

export interface ToolsCmdOptions {
  json: boolean;
}

export function parseToolsArgs(argv: string[]): ToolsCmdOptions {
  const opts: ToolsCmdOptions = { json: false };
  for (const a of argv) {
    if (a === '--json') opts.json = true;
    else if (a && a.startsWith('-')) {
      throw new Error(`unknown flag "${a}"\nUsage: remember tools [--json]`);
    }
  }
  return opts;
}

/**
 * `remember tools` — print the agent tool definitions (the same
 * Anthropic/OpenAI-shaped defs the API serves at `GET /v1/tools`) to stdout, so
 * wiring an LLM to the CLI/API needs no running server.
 */
export async function toolsCommand(argv: string[]): Promise<void> {
  const opts = parseToolsArgs(argv);

  // The defs themselves are JSON — mirror the API envelope exactly.
  if (opts.json) {
    process.stdout.write(JSON.stringify({ tools: AGENT_TOOL_DEFS }, null, 2) + '\n');
    return;
  }

  const out = process.stdout;
  out.write(
    header('agent tools') +
      `  ${c.dim('— Anthropic / OpenAI tool defs (same as GET /v1/tools)')}\n\n`,
  );
  for (const t of AGENT_TOOL_DEFS) {
    out.write(`  ${c.cyan(c.bold(t.name))}\n`);
    out.write(`    ${c.dim(t.description)}\n`);
    const props = t.input_schema.properties as Record<string, { type?: string; description?: string }>;
    const required = new Set(t.input_schema.required ?? []);
    for (const [name, spec] of Object.entries(props)) {
      const req = required.has(name) ? c.yellow(' required') : c.dim(' optional');
      const type = spec.type ? c.dim(`<${spec.type}>`) : '';
      out.write(`      ${c.bold(name)} ${type}${req}${spec.description ? c.dim(`  — ${spec.description}`) : ''}\n`);
    }
    out.write('\n');
  }
  out.write(`${c.dim('Pipe the machine shape: remember tools --json')}\n`);
}
