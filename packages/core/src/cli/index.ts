import { VERSION } from '../version.js';
import { c, banner, header, padEndVisible, bullet } from './format.js';

interface CommandSpec {
  name: string;
  args?: string;
  summary: string;
  /** Full help body shown by `remember help <cmd>` / `remember <cmd> --help`. */
  help: string;
}

const COMMANDS: CommandSpec[] = [
  {
    name: 'init',
    args: '<dir>',
    summary: 'Scaffold a new wiki in <dir>',
    help: `${c.bold('remember init')} ${c.dim('<dir> [--no-token]')}

Scaffold a new, ready-to-run wiki: a ${c.cyan('remember.config.ts')}, a ${c.cyan('content/')} folder
seeded with three starter docs, and a ${c.cyan('package.json')} wired to the CLI.

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
  --open     Open the top result in $EDITOR (falls back to $PAGER / less)

${c.dim('Examples')}
  remember search "deploy runbook"
  remember search "auth flow" -k 5
  remember search "vector store" --json | jq '.results[0].path'`,
  },
  {
    name: 'status',
    summary: 'Print a dashboard of the local index',
    help: `${c.bold('remember status')}

Show page + chunk counts, the embedding model, index freshness, and where
the config and content live.`,
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

${c.dim('Docs: https://github.com/aakusch/remember')}
`;
}

function commandHelp(name: string): string | null {
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
      case 'status': {
        const { statusCommand } = await import('./commands/status-cmd.js');
        await statusCommand();
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
    process.stderr.write(`${c.red(`remember ${command}:`)} ${(err as Error).message}\n`);
    process.exit(1);
  }
}
