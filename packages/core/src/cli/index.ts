const VERSION = '0.0.1';

const HELP = `remember v${VERSION} — local-first AI-ready wiki

USAGE:
  remember <command> [options]

COMMANDS:
  init <dir>       Scaffold a new wiki in <dir>
  dev              Index, then start the dev server
  start            Start the production server (assumes index is up to date)
  index            (Re)index the content directory
  status           Print index status
  benchmark         Run the versioned retrieval evaluation

OPTIONS:
  -v, --version    Print version
  -h, --help       Show this help

ENV:
  REMEMBER_HOST          API bind host (default 127.0.0.1)
  REMEMBER_API_PORT      API port (default 4320)
  REMEMBER_PORT          Viewer port (default 4321)
  REMEMBER_ADMIN_TOKEN   Required for non-loopback binds + remote admin
  OPENAI_API_KEY         Opts into OpenAI embeddings

Docs: https://github.com/<owner>/remember
`;

export async function run(argv: string[]): Promise<void> {
  const command = argv[0];

  if (!command || command === 'help' || command === '-h' || command === '--help') {
    process.stdout.write(HELP);
    return;
  }

  if (command === '-v' || command === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return;
  }

  try {
    switch (command) {
      case 'init': {
        const { init } = await import('./commands/init.js');
        const positional = argv.slice(1).filter((a) => !a.startsWith('--'));
        const flags = new Set(argv.slice(1).filter((a) => a.startsWith('--')));
        const target = positional[0];
        if (!target) {
          process.stderr.write('remember init: target directory required\nUsage: remember init <dir> [--no-token]\n');
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
      case 'status': {
        const { statusCommand } = await import('./commands/status-cmd.js');
        await statusCommand();
        return;
      }
      case 'benchmark': {
        const { benchmarkCommand } = await import('./commands/benchmark-cmd.js');
        await benchmarkCommand(argv.slice(1));
        return;
      }
      default:
        process.stderr.write(
          `remember: unknown command "${command}"\nRun "remember help" for usage.\n`,
        );
        process.exit(1);
    }
  } catch (err) {
    process.stderr.write(`remember ${command}: ${(err as Error).message}\n`);
    process.exit(1);
  }
}
