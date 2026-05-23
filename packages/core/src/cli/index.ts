const VERSION = '0.0.1';

const HELP = `remember v${VERSION} — local-first AI-ready wiki

USAGE:
  remember <command> [options]

COMMANDS:
  init <dir>       Scaffold a new wiki in <dir>
  dev              Start the dev server (viewer + API)
  start            Start the production server
  index            (Re)index the content directory
  status           Print index status

OPTIONS:
  -v, --version    Print version
  -h, --help       Show this help

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

  // Stubs — concrete implementations land progressively.
  switch (command) {
    case 'init':
    case 'dev':
    case 'start':
    case 'index':
    case 'status':
      process.stdout.write(
        `remember ${command}: not yet implemented (scaffold only — see docs/superpowers/specs/ for v1 design)\n`,
      );
      return;
    default:
      process.stderr.write(
        `remember: unknown command "${command}"\nRun "remember help" for usage.\n`,
      );
      process.exit(1);
  }
}
