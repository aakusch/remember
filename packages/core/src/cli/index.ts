import { VERSION } from '../version.js';
import { c, banner, header, padEndVisible, bullet } from './format.js';

interface CommandSpec {
  name: string;
  args?: string;
  summary: string;
  /** Full help body shown by `remember help <cmd>` / `remember <cmd> --help`. */
  help: string;
}

export const COMMANDS: CommandSpec[] = [
  {
    name: 'setup',
    args: '[dir]',
    summary: 'Guided wizard: scaffold → install → index → serve, in one command',
    help: `${c.bold('remember setup')} ${c.dim('[dir] [--yes] [--no-start] [--no-token]')}

The one-command onboarding wizard. Prompts for a folder, embeddings (local or
OpenAI), and whether to seed example pages — then scaffolds the wiki, installs
dependencies, indexes, and starts the dev server, so you go from nothing to a
live, searchable, agent-ready wiki without running five separate commands.

It never edits your files: it PRINTS the "remember …" agent trigger snippet for
you to paste into ${c.cyan('CLAUDE.md')}/${c.cyan('AGENTS.md')} (the seeded ${c.cyan('content/remember.md')} carries
it too, so an agent pointed at the wiki can wire itself up).

${c.dim('Options')}
  --yes        Non-interactive: defaults (./my-wiki, local, install + index, no auto-start)
  --no-start   Scaffold + install + index, but don't start the server
  --no-token   Skip generating an admin token (loopback-only setups)

${c.dim('Examples')}
  npx @useremember/core setup
  remember setup my-wiki
  remember setup --yes`,
  },
  {
    name: 'init',
    args: '<dir>',
    summary: 'Scaffold a new wiki in <dir> (raw — no install/index/serve)',
    help: `${c.bold('remember init')} ${c.dim('<dir> [--no-token]')}

Scaffold a new, ready-to-run wiki: a ${c.cyan('remember.config.ts')}, a ${c.cyan('content/')} folder
seeded with starter docs, and a ${c.cyan('package.json')} wired to the CLI. Files only —
for the guided end-to-end flow use ${c.cyan('remember setup')}.

${c.dim('Options')}
  --no-token   Skip generating an admin token (loopback-only setups)

${c.dim('Examples')}
  remember init my-wiki
  remember init . --no-token`,
  },
  {
    name: 'dev',
    summary: 'Index, then serve the agent API with a live file watcher',
    help: `${c.bold('remember dev')}

Index ${c.cyan('content/')}, then start the agent API with a filesystem watcher.
Edits reindex within about a second. CLI + API only — no browser UI.

${c.dim('Examples')}
  remember dev
  REMEMBER_API_PORT=8080 remember dev`,
  },
  {
    name: 'start',
    summary: 'Serve the production API (assumes the index is up to date)',
    help: `${c.bold('remember start')}

Start the agent API without reindexing first. Use in production once the
index has been built (e.g. by ${c.cyan('remember index')} in your deploy step).`,
  },
  {
    name: 'index',
    summary: '(Re)index the content directory',
    help: `${c.bold('remember index')}

Walk ${c.cyan('content/')}, parse → chunk → embed → store. Incremental: unchanged
files are skipped, deleted files are pruned.`,
  },
  {
    name: 'search',
    args: '"<query>"',
    summary: 'Hybrid search from the terminal (formatted or --json)',
    help: `${c.bold('remember search')} ${c.dim('"<query>" [-k <n>] [--json] [--open]')}

Run a hybrid BM25 + vector search over the local index and print ranked
result cards — rank, score, path, title, and a query-relevant snippet.

${c.dim('Options')}
  -k <n>     Number of results to return (default 10, max 50)
  --json     Machine-readable output (no color) for scripts and agents
  --open     Open the top result in $EDITOR (falls back to $VISUAL / $PAGER / less)

${c.dim('Examples')}
  remember search "deploy runbook"
  remember search "auth flow" -k 5
  remember search "vector store" --json | jq -r '.results[0].path'`,
  },
  {
    name: 'list',
    summary: 'List indexed documents (table or --json)',
    help: `${c.bold('remember list')} ${c.dim('[--limit <n>] [--offset <n>] [--sort <key>] [--q <text>] [--filter k=v] [--json]')}

List indexed documents as an aligned table — title, path, size, and when it was
last indexed. Reads the local index directly (no server needed).

${c.dim('Options')}
  --limit <n>    Max rows to show (default 50, max 500)   ${c.dim('alias: -n')}
  --offset <n>   Skip the first n rows (pagination)
  --sort <key>   path | title | size | modified | last_modified | last_indexed ${c.dim('(alias: -s; prefix - for desc)')}
  --q <text>     Free-text contains match on title + path
  --filter k=v   Exact frontmatter match, e.g. --filter status=current ${c.dim('(repeatable)')}
  --json         Machine-readable output (no color) for scripts and agents

${c.dim('Examples')}
  remember list --sort -modified --limit 20
  remember list --filter status=current --q deploy
  remember list --json | jq -r '.pages[].path'`,
  },
  {
    name: 'get',
    args: '<path>',
    summary: "Print one document's frontmatter + content (or --json)",
    help: `${c.bold('remember get')} ${c.dim('<path> [--json]')}

Fetch a single document by its content-relative path (as returned by
${c.cyan('search')} / ${c.cyan('list')}). Human view shows frontmatter then the markdown body;
${c.cyan('--json')} returns { path, title, frontmatter, body, size, last_modified }.

${c.dim('Examples')}
  remember get ops/deploy.md
  remember get "$(remember search 'deploys' --json | jq -r '.results[0].path')" --json`,
  },
  {
    name: 'status',
    summary: 'Print a dashboard of the local index (or --json)',
    help: `${c.bold('remember status')} ${c.dim('[--json]')}

Show page + chunk counts, the embedding model, index freshness, and where
the config and content live. ${c.cyan('--json')} emits the same as a machine shape.`,
  },
  {
    name: 'doctor',
    summary: 'Corpus-health sweep — flag unfindable / unstructured / duplicate docs',
    help: `${c.bold('remember doctor')} ${c.dim('[--json] [--strict]')}

A deterministic, no-LLM, no-network health check over your indexed corpus.
Flags documents that quietly wreck retrieval: markdown on disk that isn't
indexed, pages with zero chunks (unfindable), duplicate bodies/titles, pages
with no heading structure, walls of prose, thin pages, and missing frontmatter.

Reads only the local index + one cheap pass over ${c.cyan('content/')}. ${c.cyan('--json')} emits the
machine shape (same as ${c.cyan('GET /v1/doctor')}); ${c.cyan('--strict')} exits non-zero if any
error-severity problem is found, so you can gate CI on it.

${c.dim('Examples')}
  remember doctor
  remember doctor --strict
  remember doctor --json | jq '.findings[] | select(.severity=="error")'`,
  },
  {
    name: 'tools',
    summary: 'Print agent tool definitions (same as GET /v1/tools)',
    help: `${c.bold('remember tools')} ${c.dim('[--json]')}

Print the Anthropic/OpenAI-shaped tool definitions (search_wiki, get_page,
list_pages) — the same defs the API serves at ${c.cyan('/v1/tools')}, so you can wire an
LLM to remember without a running server. ${c.cyan('--json')} emits the raw defs.

${c.dim('Examples')}
  remember tools
  remember tools --json | jq '.tools[].name'`,
  },
  {
    name: 'capabilities',
    summary: 'Print the machine-discoverable capabilities object (or --json)',
    help: `${c.bold('remember capabilities')} ${c.dim('[--json]')}

Print one stable discovery object describing this engine — ${c.cyan('version')},
${c.cyan('engine')}, ${c.cyan('embedder')}, HTTP ${c.cyan('endpoints')}, CLI ${c.cyan('commands')}, and
${c.cyan('json_schema_version')}. One call for an agent to learn how to drive remember,
instead of stitching together ${c.cyan('status')} + ${c.cyan('tools')} + ${c.cyan('health')}.

Same shape as ${c.cyan('GET /v1/capabilities')}. ${c.cyan('--json')} emits the machine shape.

${c.dim('Examples')}
  remember capabilities
  remember capabilities --json | jq '.endpoints[].path'`,
  },
  {
    name: 'mcp',
    summary: 'Serve the wiki to MCP clients (Claude Desktop/Code, Cursor) over stdio',
    help: `${c.bold('remember mcp')}

Expose this wiki to any MCP client as native tools — ${c.cyan('search_wiki')}, ${c.cyan('get_page')},
${c.cyan('list_pages')}, and ${c.cyan('write_page')} (stage a note) — over stdio. Runs in-process
against the wiki in the current directory; no HTTP server needed.

This is the *mechanism* half of agent integration; the trigger snippet in
${c.cyan('content/remember.md')} (paste into CLAUDE.md/AGENTS.md) is the *when-to-use* half.

${c.dim('Add to an MCP client')} ${c.dim('(e.g. Claude Desktop / Claude Code mcpServers):')}
  {
    "remember": {
      "command": "remember",
      "args": ["mcp"],
      "cwd": "/absolute/path/to/your-wiki"
    }
  }

${c.dim('Run `remember index` once first so the embedding model is cached.')}`,
  },
  {
    name: 'benchmark',
    summary: 'Run the versioned retrieval evaluation',
    help: `${c.bold('remember benchmark')} ${c.dim('[--profile <name>] [--compare <file>] …')}

Run the deterministic retrieval evaluation harness. Mainly for CI and
regression tracking.`,
  },
];

function globalHelp(): string {
  const nameWidth = COMMANDS.reduce(
    (w, cmd) => Math.max(w, `${cmd.name} ${cmd.args ?? ''}`.trim().length),
    0,
  );
  const rows = COMMANDS.map((cmd) => {
    const label = `${cmd.name}${cmd.args ? ' ' + c.dim(cmd.args) : ''}`;
    return `  ${c.cyan(padEndVisible(label, nameWidth + 2))}  ${cmd.summary}`;
  }).join('\n');

  return `${banner(VERSION)} ${c.dim('— local-first retrieval for people and agents')}

${c.dim('USAGE')}
  ${c.bold('remember')} <command> [options]

${header('Commands')}
${rows}

${header('Options')}
  ${c.cyan('-v, --version')}   Print version
  ${c.cyan('-h, --help')}      Show this help ${c.dim('(or `remember help <command>`)')}

${header('Environment')}
${bullet(`${c.cyan('REMEMBER_HOST')}         API bind host ${c.dim('(default 127.0.0.1)')}`)}
${bullet(`${c.cyan('REMEMBER_API_PORT')}     API port ${c.dim('(default 4320)')}`)}
${bullet(`${c.cyan('REMEMBER_ADMIN_TOKEN')}  Required for non-loopback binds + remote admin`)}
${bullet(`${c.cyan('OPENAI_API_KEY')}        Opt into OpenAI embeddings`)}
${bullet(`${c.cyan('NO_COLOR')}              Disable colored output`)}

${header('Examples')}
  ${c.dim('$')} remember init my-wiki ${c.dim('&&')} cd my-wiki ${c.dim('&&')} npm install
  ${c.dim('$')} remember dev
  ${c.dim('$')} remember search "how do deploys work" -k 5

${header('For agents')}
  Every read command takes ${c.cyan('--json')} (stable shapes). See ${c.cyan('remember help agents')}.

${c.dim('Docs: https://github.com/aakusch/remember')}
`;
}

/** `remember help agents` — the search → get loop, all offline, no server. */
function agentsHelp(): string {
  return `
${c.bold('Using remember from an agent')}

remember is a first-class agent tool: every read command speaks ${c.cyan('--json')} with
stable, documented shapes, exits ${c.bold('0')} on success and non-zero on error, and emits
${c.cyan('{ "error": { "code", "message" } }')} on stderr when a ${c.cyan('--json')} command fails. No
server required — these read the local index directly.

${header('The core loop: search → pick a path → get')}
  ${c.dim('$')} remember search "how do deploys work" --json ${c.dim('| jq -r .results[0].path')}
  ${c.dim('# → ops/deploy.md')}
  ${c.dim('$')} remember get ops/deploy.md --json ${c.dim('| jq -r .body')}

${header('One-liner')}
  ${c.dim('$')} remember get "$(remember search 'deploys' --json | jq -r '.results[0].path')" --json

${header('Start here: one call to discover the engine')}
  ${c.dim('$')} remember capabilities --json ${c.dim('# { version, engine, embedder, endpoints, commands, json_schema_version }')}
  ${c.dim('Same object as')} ${c.cyan('GET /v1/capabilities')}${c.dim('. Read it once, then use the commands/endpoints it lists.')}

${header('Read commands (all support --json)')}
${bullet(`${c.cyan('capabilities')}  discovery: { version, engine, embedder, endpoints, commands, json_schema_version }`)}
${bullet(`${c.cyan('search "<q>"')}  ranked hits: { query, count, query_ms, results[] }`)}
${bullet(`${c.cyan('get <path>')}    one page: { path, title, frontmatter, body, size, last_modified }`)}
${bullet(`${c.cyan('list')}          the corpus: { count, total, limit, sort, pages[] }`)}
${bullet(`${c.cyan('status')}        index state: { version, index, project }`)}

${header('Wiring an LLM')}
  ${c.dim('$')} remember tools --json   ${c.dim('# Anthropic/OpenAI tool defs — same as GET /v1/tools')}

  Or run the HTTP API (${c.cyan('remember dev')}) and hit ${c.cyan('/v1/search')}, ${c.cyan('/v1/pages/<path>')}, ${c.cyan('/v1/tools')}.

${c.dim('A result means the corpus ranked text for the query — not that an answer exists.')}
`;
}

function commandHelp(name: string): string | null {
  if (name === 'agents') return agentsHelp();
  const cmd = COMMANDS.find((x) => x.name === name);
  return cmd ? `\n${cmd.help}\n` : null;
}

export async function run(argv: string[]): Promise<void> {
  const command = argv[0];
  const rest = argv.slice(1);
  const wantsHelp = rest.includes('--help') || rest.includes('-h');

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    // `remember help <cmd>` → per-command help.
    const topic = command === 'help' ? rest[0] : undefined;
    if (topic) {
      const h = commandHelp(topic);
      process.stdout.write(h ?? globalHelp());
      return;
    }
    process.stdout.write(globalHelp());
    return;
  }

  if (command === '-v' || command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  // `remember <cmd> --help` → per-command help.
  if (wantsHelp) {
    const h = commandHelp(command);
    if (h) {
      process.stdout.write(h);
      return;
    }
  }

  try {
    switch (command) {
      case 'setup': {
        const { setupCommand } = await import('./commands/setup-cmd.js');
        await setupCommand(rest);
        return;
      }
      case 'init': {
        const { init } = await import('./commands/init.js');
        const positional = rest.filter((a) => !a.startsWith('--'));
        const flags = new Set(rest.filter((a) => a.startsWith('--')));
        const target = positional[0];
        if (!target) {
          process.stderr.write(
            `${c.red('remember init:')} target directory required\n${c.dim('Usage: remember init <dir> [--no-token]')}\n`,
          );
          process.exit(1);
        }
        await init(target, { noToken: flags.has('--no-token') });
        return;
      }
      case 'index': {
        const { indexCommand } = await import('./commands/index-cmd.js');
        await indexCommand();
        return;
      }
      case 'dev': {
        const { devCommand } = await import('./commands/dev-cmd.js');
        await devCommand();
        return;
      }
      case 'start': {
        const { startCommand } = await import('./commands/start-cmd.js');
        await startCommand();
        return;
      }
      case 'search': {
        const { searchCommand } = await import('./commands/search-cmd.js');
        await searchCommand(rest);
        return;
      }
      case 'list': {
        const { listCommand } = await import('./commands/list-cmd.js');
        await listCommand(rest);
        return;
      }
      case 'get': {
        const { getCommand } = await import('./commands/get-cmd.js');
        await getCommand(rest);
        return;
      }
      case 'status': {
        const { statusCommand } = await import('./commands/status-cmd.js');
        await statusCommand(rest);
        return;
      }
      case 'doctor': {
        const { doctorCommand } = await import('./commands/doctor-cmd.js');
        await doctorCommand(rest);
        return;
      }
      case 'tools': {
        const { toolsCommand } = await import('./commands/tools-cmd.js');
        await toolsCommand(rest);
        return;
      }
      case 'capabilities': {
        const { capabilitiesCommand } = await import('./commands/capabilities-cmd.js');
        await capabilitiesCommand(rest);
        return;
      }
      case 'mcp': {
        const { mcpCommand } = await import('./commands/mcp-cmd.js');
        await mcpCommand();
        return;
      }
      case 'benchmark': {
        const { benchmarkCommand } = await import('./commands/benchmark-cmd.js');
        await benchmarkCommand(rest);
        return;
      }
      default:
        process.stderr.write(
          `${c.red(`remember: unknown command "${command}"`)}\n${c.dim('Run `remember help` for usage.')}\n`,
        );
        process.exit(1);
    }
  } catch (err) {
    const error = err as Error & { code?: string };
    // When the caller asked for --json, fail with a structured JSON error on
    // stderr (exit non-zero) so an agent can script against it. Otherwise, a
    // human-friendly red line.
    if (rest.includes('--json')) {
      process.stderr.write(
        JSON.stringify({
          error: { code: error.code ?? 'COMMAND_ERROR', message: error.message },
        }) + '\n',
      );
    } else {
      process.stderr.write(`${c.red(`remember ${command}:`)} ${error.message}\n`);
    }
    process.exit(1);
  }
}
