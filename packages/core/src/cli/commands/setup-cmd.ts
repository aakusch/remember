import path from 'node:path';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import * as p from '@clack/prompts';
import { init } from './init.js';
import { AGENT_TRIGGER_SNIPPET } from '../agent-snippet.js';
import { expandHome } from '../expand-home.js';
import { c } from '../format.js';

type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

interface SetupFlags {
  yes: boolean;
  noStart: boolean;
  noToken: boolean;
  folder?: string;
}

export function parseFlags(argv: string[]): SetupFlags {
  const flags: SetupFlags = { yes: false, noStart: false, noToken: false };
  for (const a of argv) {
    if (a === '--yes' || a === '-y') flags.yes = true;
    else if (a === '--no-start') flags.noStart = true;
    else if (a === '--no-token') flags.noToken = true;
    else if (a.startsWith('-')) throw new Error(`unknown flag "${a}"\nUsage: remember setup [<dir>] [--yes] [--no-start] [--no-token]`);
    else if (!flags.folder) flags.folder = a;
  }
  return flags;
}

/** Detect the package manager that launched us (npx → npm, pnpm dlx → pnpm, …). */
export function detectPackageManager(ua = process.env.npm_config_user_agent ?? ''): PackageManager {
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

/** Run a child process, capturing output; reject with the tail on non-zero exit. */
function run(cmd: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      // npm/pnpm resolve as .cmd shims on Windows — a shell handles that.
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout?.on('data', (d) => (out += d));
    child.stderr?.on('data', (d) => (out += d));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`\`${cmd} ${args.join(' ')}\` failed:\n${out.trim().slice(-1200)}`)),
    );
  });
}

function bail(): never {
  p.cancel('Setup cancelled — nothing was created.');
  process.exit(0);
}

/**
 * `remember setup` — the guided onboarding wizard. Reuses `init`'s scaffold, then
 * (optionally) installs deps, indexes, and starts the dev server, so a newcomer
 * goes from nothing to a live, searchable, agent-ready wiki in one command.
 *
 * It never edits any of your files — it PRINTS the agent trigger snippet for you to
 * paste into CLAUDE.md/AGENTS.md (the seeded content/remember.md carries it too, so
 * an agent pointed at the wiki can wire itself up).
 */
export async function setupCommand(argv: string[] = []): Promise<void> {
  const flags = parseFlags(argv);
  const interactive = Boolean(process.stdout.isTTY) && !flags.yes;

  if (!process.stdout.isTTY && !flags.yes) {
    throw new Error(
      'remember setup needs an interactive terminal. Re-run with --yes to use defaults (folder ./my-wiki, local embeddings, install + index, no auto-start).',
    );
  }

  p.intro(`${c.accent('remember')} ${c.dim('· new wiki')}`);

  // ── Prompts ──────────────────────────────────────────────────────────────
  let folder = flags.folder;
  if (!folder) {
    if (interactive) {
      const r = await p.text({ message: 'Where should your wiki live?', placeholder: './my-wiki', defaultValue: './my-wiki' });
      if (p.isCancel(r)) bail();
      folder = (r as string)?.trim() || './my-wiki';
    } else {
      folder = './my-wiki';
    }
  }
  // A ~ typed into the prompt (or a quoted arg) is NOT shell-expanded — expand it
  // here so we never scaffold into a literal "~" directory.
  folder = expandHome(folder);

  let embed: 'local' | 'openai' = 'local';
  let openaiKey: string | undefined;
  if (interactive) {
    const r = await p.select({
      message: 'Embeddings',
      options: [
        { value: 'local', label: 'Local — free, runs on your machine (recommended)' },
        { value: 'openai', label: 'OpenAI — higher quality, needs an API key' },
      ],
      initialValue: 'local',
    });
    if (p.isCancel(r)) bail();
    embed = r as 'local' | 'openai';
    if (embed === 'openai') {
      const k = await p.password({ message: 'OpenAI API key (saved to .env, gitignored)' });
      if (p.isCancel(k)) bail();
      openaiKey = (k as string).trim();
    }
  }

  let seed = true;
  if (interactive) {
    const r = await p.confirm({ message: 'Seed a few example pages to search right away?', initialValue: true });
    if (p.isCancel(r)) bail();
    seed = r as boolean;
  }

  let doInstall = true;
  let doStart = !flags.noStart;
  if (interactive) {
    const r = await p.confirm({ message: 'Install dependencies now?', initialValue: true });
    if (p.isCancel(r)) bail();
    doInstall = r as boolean;
    if (doInstall && !flags.noStart) {
      const s = await p.confirm({ message: 'Index and start the dev server now?', initialValue: true });
      if (p.isCancel(s)) bail();
      doStart = s as boolean;
    } else {
      doStart = false;
    }
  } else {
    // Non-interactive (--yes): scaffold + install + index, but never auto-serve —
    // a long-running server would hang a script.
    doInstall = true;
    doStart = false;
  }

  const pm = detectPackageManager();
  const absFolder = path.resolve(process.cwd(), folder);

  // ── Scaffold ─────────────────────────────────────────────────────────────
  const spin = p.spinner();
  spin.start('Scaffolding');
  const { adminToken } = await init(folder, { noToken: flags.noToken, quiet: true });
  if (!seed) {
    // Empty the content dir — the user brings their own docs.
    await fs.rm(path.join(absFolder, 'content'), { recursive: true, force: true });
    await fs.mkdir(path.join(absFolder, 'content'), { recursive: true });
  }
  if (embed === 'openai' && openaiKey) {
    // resolveEmbedder prefers OPENAI_API_KEY over the default local pin, so writing
    // the key to .env is all it takes — no config rewrite.
    await fs.appendFile(path.join(absFolder, '.env'), `OPENAI_API_KEY=${openaiKey}\n`).catch(() =>
      fs.writeFile(path.join(absFolder, '.env'), `OPENAI_API_KEY=${openaiKey}\n`),
    );
  }
  spin.stop(`Scaffolded ${c.dim(absFolder)}`);

  // ── Install ──────────────────────────────────────────────────────────────
  if (doInstall) {
    spin.start(`Installing dependencies with ${pm}`);
    try {
      await run(pm, ['install'], absFolder);
      spin.stop('Dependencies installed');
    } catch (err) {
      spin.stop('Dependency install failed');
      p.log.error((err as Error).message);
      p.log.info(`You can finish by hand: cd ${folder} && ${pm} install`);
      throw err;
    }
  }

  // ── What you got: the directory layout ───────────────────────────────────
  p.note(
    [
      `${c.bold('Your wiki')}  ${c.dim(absFolder)}`,
      ``,
      `  ${c.cyan('content/')}            your markdown (edit in any editor; edits reindex live)`,
      `  ${c.cyan('content/remember.md')} agent guide + the trigger snippet`,
      `  ${c.cyan('remember.config.ts')}  config: embedder, connectors, ports`,
      `  ${c.cyan('.env')}                secrets (token / API keys) — gitignored`,
    ].join('\n'),
    'What was created',
  );

  // ── Agent wiring (print only — never writes your files) ──────────────────
  p.note(
    `${AGENT_TRIGGER_SNIPPET}\n\n${c.dim('↑ GIVE THIS TO YOUR AGENT — paste the block into your project\'s CLAUDE.md /')}\n${c.dim('  AGENTS.md, or point your agent at content/remember.md and let it add this itself.')}`,
    'Make "remember …" route to the wiki',
  );

  // ── Index + serve, or hand off ───────────────────────────────────────────
  if (doStart) {
    p.note(
      [
        `${c.dim('$')} remember search "…"   ${c.dim('search from the terminal (or GET /v1/search?q=…)')}`,
        `${c.dim('$')} remember doctor       ${c.dim('check corpus health')}`,
        `${c.dim('$')} remember --help       ${c.dim('everything remember can do')}`,
      ].join('\n'),
      'Once it\'s running, in another terminal',
    );
    p.outro(`Indexing + starting the dev server… ${c.dim('(first run downloads the model; Ctrl+C to stop)')}`);
    process.chdir(absFolder);
    const { devCommand } = await import('./dev-cmd.js');
    await devCommand(); // indexes + serves + watches; blocks until stopped
    return;
  }

  if (doInstall) {
    p.outro('Indexing…');
    const prevCwd = process.cwd();
    process.chdir(absFolder);
    const { indexCommand } = await import('./index-cmd.js');
    await indexCommand();
    process.chdir(prevCwd);
  }

  printNextSteps(folder, pm, doInstall, adminToken);
}

function printNextSteps(folder: string, pm: PackageManager, installed: boolean, adminToken: string | null): void {
  const runScript = pm === 'npm' ? 'npm run' : pm;
  const lines = [`  ${c.dim('$')} cd ${folder}`];
  if (!installed) lines.push(`  ${c.dim('$')} ${pm} install`);
  lines.push(`  ${c.dim('$')} ${runScript} dev              ${c.dim('# index + serve the agent API on :4320')}`);
  lines.push(`  ${c.dim('$')} remember search "…"      ${c.dim('# or GET /v1/search?q=…')}`);
  lines.push(`  ${c.dim('$')} remember doctor          ${c.dim('# check corpus health')}`);
  lines.push(`  ${c.dim('$')} remember --help          ${c.dim('# everything remember can do')}`);
  process.stdout.write(`\n${lines.join('\n')}\n`);
  if (adminToken) {
    process.stdout.write(`\n  ${c.dim('Admin token (for remote writes) is in')} ${folder}/.env\n`);
  }
  process.stdout.write('\n');
}
