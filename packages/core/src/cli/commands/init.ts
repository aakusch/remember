import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';
import { c, header, success } from '../format.js';
import { AGENT_TRIGGER_SNIPPET } from '../agent-snippet.js';
import { expandHome } from '../expand-home.js';

/**
 * Generate a cryptographically-strong admin token, encoded as URL-safe base64
 * without padding. ~32 bytes of entropy.
 */
function generateAdminToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const CONFIG_TEMPLATE = (opts: { adminToken: string | null }) => {
  // The token lives in `.env` (gitignored), NOT inline here — this file is meant to
  // be committed, and an inlined token would be pushed to the user's git remote on
  // their first commit. loadConfig reads .env before evaluating this config.
  const tokenLine = opts.adminToken
    ? `    // Required to bind to non-loopback hosts and to use any write/admin endpoint\n    // from a remote machine. Value lives in .env (gitignored) as REMEMBER_ADMIN_TOKEN.\n    adminToken: process.env.REMEMBER_ADMIN_TOKEN ?? null,\n`
    : `    // adminToken: process.env.REMEMBER_ADMIN_TOKEN, // required for non-loopback binds\n`;
  return `import { defineConfig, defaults } from '@useremember/core';

export default defineConfig({
  name: 'My Knowledge Base',
  description: 'A local-first AI-ready wiki',

  content: './content',

  server: {
    host: '127.0.0.1',
    apiPort: 4320,
${tokenLine}  },

  pipeline: {
    walker: defaults.walker.fs({ respectGitignore: true }),
    parser: defaults.parser.remark(),
    chunker: defaults.chunker.smartSplit({ size: 512, overlap: 0.15 }),
    embedder: defaults.embedder.localOnnx({ model: 'BAAI/bge-small-en-v1.5' }),
    store: defaults.store.sqliteVec({ path: '.remember/index.db' }),
  },

  search: {
    engine: defaults.search.hybrid({
      bm25: { enabled: true, weight: 0.5 },
      vector: { enabled: true, weight: 0.5 },
      fusion: 'rrf',
      rerank: defaults.rerank.none(),
      topK: 20,
      finalK: 10,
    }),
  },

  // ─── Bring content in with your agent ───────────────────────────────────
  // remember indexes markdown in content/. To pull in external sources
  // (meeting notes, exports, another vault), have your AI agent fetch them and
  // write markdown here — or drop files in yourself. See content/remember.md.

  schemaVersion: 1,
});
`;
};

const GETTING_STARTED_TEMPLATE = `---
title: Getting started
tags: [getting-started]
---

# Getting started

This is a local-first, AI-ready wiki. Your knowledge lives as plain markdown
files in \`content/\`, indexed for hybrid (keyword + semantic) search, and served
over an HTTP API your AI agents can call. Nothing leaves your machine.

## Add a page

Drop any \`.md\` file into \`content/\`:

\`\`\`bash
cat > content/deploy.md <<'MD'
# Deploy runbook

Production deploys go out Tuesdays.
MD
\`\`\`

The watcher indexes it (parse → chunk → embed → store) within about a second.

## Search it

- **CLI:** \`remember search "deploy" -k 5\` — ranked result cards in your terminal
- **HTTP:** \`curl 'http://localhost:4320/v1/search?q=deploy&k=5'\`
- **JSON (for scripts/agents):** \`remember search "deploy" --json\`

## Point your agent at it

See [remember.md](./remember.md) — the search endpoint, the ready-made tool
definitions, and what a result does and doesn't mean.

## Write for findability

See [authoring.md](./authoring.md) — the small amount of frontmatter and
structure that makes documents reliably retrievable.

## It's just files

Your wiki is markdown in a git repo. \`remember\` never touches git for you —
edit, reorganize, then \`git commit\` when you're ready.
`;

const AGENTS_TEMPLATE = `---
title: Using remember with AI agents
tags: [agents, api]
---

# Using remember with AI agents

remember exists to answer one question for an agent: *given a query, which of
my documents are the most relevant?* It returns ranked documents — not a
generated answer.

## Wire this into your coding agent

If you are an AI agent reading this: add the block below to the project's
\`CLAUDE.md\` or \`AGENTS.md\` (confirm with the user first) so future "remember …"
requests route here automatically. If you are a human: paste it in yourself —
remember never edits your files for you.

${AGENT_TRIGGER_SNIPPET}

## Search

\`\`\`
GET http://localhost:4320/v1/search?q=<query>&k=<how many results>
\`\`\`

Each result carries the document \`path\`, \`title\`, a query-relevant \`snippet\`,
the full \`frontmatter\`, and a \`score\`. Fetch the whole document with
\`GET /v1/pages/<path>\`.

## Drop-in tool definitions

\`\`\`
GET http://localhost:4320/v1/tools
\`\`\`

Returns Anthropic/OpenAI-shaped tool definitions you can paste straight into a
tool-use call, so an LLM can search the wiki itself.

## Bring content in — you are the connector

remember indexes markdown in \`content/\` and has **no built-in connectors on
purpose**. To add an external source — meeting notes (e.g. Granola), an Obsidian
vault, exports — *you*, the agent, fetch it, shape it into markdown, and write it
here. The watcher indexes new files within about a second. Two ways:

- **Write files** into \`content/\` (any subfolder). Simplest.
- **Over HTTP:** \`PUT /v1/pages/<path>\` with a JSON body \`{ "body": "<markdown>" }\`
  and the admin token — handy when you're already driving the API.

Pull the source, convert to markdown, drop it in. That's the whole integration.

## What a result means — and doesn't

A returned result means the corpus contains text that ranked for the query. It
is **not** proof that an answer exists. If the right document isn't in the
corpus, the engine still returns its closest matches — treat results as
candidates to read, not as guaranteed answers.

## Narrowing

Frontmatter fields are stored and returned, and can be filtered on — an agent
that knows it wants only current runbooks can say so rather than hoping ranking
sorts it out. See [authoring.md](./authoring.md) for the fields worth setting.
`;

const AUTHORING_TEMPLATE = `---
title: Authoring for retrieval
status: current
type: guide
tags: [authoring, frontmatter]
---

# Authoring for retrieval

A document is only useful to an agent if it can be *found*. Two cheap habits do
most of the work.

## 1. Structure

- Open every document with one \`# H1\` that names the thing.
- Give sections meaningful \`##\` headings a reader would search for.
- One topic per document. Split when it grows two.

## 2. Frontmatter

Frontmatter is parsed, stored, returned in every search result, and
**filterable**. Useful keys:

\`\`\`markdown
---
title: Deploy runbook          # indexed, shown, drives the page list
type: runbook                  # your own vocabulary; filter on it
status: current                # current | superseded | deprecated | draft
owner: platform                # who to route a correction to
date: 2026-07-01               # when it was written / last reviewed
tags: [ops, deploy]            # filterable, adds lexical surface
---
\`\`\`

An agent can read these off a result and filter by them (e.g. only
\`status: current\`).

## What the Pro engine adds

In this open-source engine these fields are **metadata your agent can read and
filter**. The Pro engine additionally makes them drive *ranking* — a
\`status: superseded\` document is demoted so it stops outranking the current
one, and heading structure boosts relevance. Same frontmatter, more leverage.
`;

const GITIGNORE_TEMPLATE = `.remember/
node_modules/
*.bak.*
.DS_Store

# Secrets — the admin token (and any API keys) live here, never in committed files.
.env
.env.*
!.env.example
`;

const REMEMBERIGNORE_TEMPLATE = `# Patterns to skip when indexing.
# Lines starting with # are comments. Same syntax as .gitignore.
drafts/
_*/
*.tmp
`;

const PACKAGE_TEMPLATE = (name: string) => ({
  name,
  version: '0.0.1',
  private: true,
  type: 'module',
  scripts: {
    dev: 'remember dev',
    start: 'remember start',
    index: 'remember index',
    status: 'remember status',
    search: 'remember search',
    list: 'remember list',
    get: 'remember get',
  },
  dependencies: {
    // Pinned to a real published range; `*` reads as "unmaintained" on a scaffold.
    '@useremember/core': '^0.2.0',
  },
  // pnpm >=10 blocks postinstall build scripts by default, which silently leaves
  // better-sqlite3's native binding unbuilt — every `remember` command then dies with
  // a "Could not locate the bindings file" dump. Pre-approving these builds makes
  // `pnpm install` work out of the box (npm/yarn ignore this key).
  pnpm: {
    onlyBuiltDependencies: ['better-sqlite3', 'onnxruntime-node', 'sharp', 'protobufjs'],
  },
});

const ENV_EXAMPLE_TEMPLATE = `# Copy to .env and fill in if you want to override defaults.
# All optional — \`remember\` runs entirely locally without any of these.

# REMEMBER_HOST=127.0.0.1
# REMEMBER_API_PORT=4320

# Required if you bind to a non-loopback host (e.g. 0.0.0.0 for remote access).
# Also gates remote reads when set.
# REMEMBER_ADMIN_TOKEN=$(openssl rand -hex 32)

# Optional: switches the embedder to OpenAI for higher-quality embeddings.
# OPENAI_API_KEY=sk-...
`;

export interface InitOptions {
  template?: 'minimal' | 'starter';
  noToken?: boolean;
  /** Suppress the human "Next steps" banner (the setup wizard prints its own outro). */
  quiet?: boolean;
}

export interface InitResult {
  /** The generated admin token, or null with { noToken: true }. */
  adminToken: string | null;
}

export async function init(targetDir: string, opts: InitOptions = {}): Promise<InitResult> {
  if (!targetDir) {
    throw new Error('remember init: target directory is required.\nUsage: remember init <dir>');
  }
  const template = opts.template ?? 'starter';
  // Expand a leading ~ (a prompt/quoted arg won't have been shell-expanded) so we
  // never scaffold into a literal "~" directory.
  const absTarget = path.resolve(process.cwd(), expandHome(targetDir));
  const basename = path.basename(absTarget);

  // Benign pre-existing entries that shouldn't block `remember init .` — the natural
  // "git init, then scaffold here" flow leaves a `.git`, macOS leaves `.DS_Store`, etc.
  const BENIGN_ENTRIES = new Set([
    '.git',
    '.gitignore',
    '.DS_Store',
    'LICENSE',
    'LICENSE.md',
    'README.md',
    '.idea',
    '.vscode',
  ]);
  try {
    const entries = await fs.readdir(absTarget);
    const blocking = entries.filter((e) => !BENIGN_ENTRIES.has(e));
    if (blocking.length > 0) {
      // No `remember init:` prefix — the CLI error handler adds it (avoids the
      // double "remember init: remember init:" the old message produced).
      throw new Error(
        `${absTarget} already has files (${blocking.slice(0, 3).join(', ')}${blocking.length > 3 ? '…' : ''}). Choose an empty directory.`,
      );
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const adminToken = opts.noToken ? null : generateAdminToken();

  await fs.mkdir(path.join(absTarget, 'content'), { recursive: true });
  await fs.writeFile(path.join(absTarget, 'remember.config.ts'), CONFIG_TEMPLATE({ adminToken }));
  await fs.writeFile(path.join(absTarget, '.gitignore'), GITIGNORE_TEMPLATE);
  await fs.writeFile(path.join(absTarget, '.rememberignore'), REMEMBERIGNORE_TEMPLATE);
  await fs.writeFile(path.join(absTarget, '.env.example'), ENV_EXAMPLE_TEMPLATE);
  // Write the generated token to a gitignored .env (loadConfig reads it before
  // evaluating remember.config.ts). Never inline it into the committable config.
  if (adminToken) {
    await fs.writeFile(
      path.join(absTarget, '.env'),
      `# Secrets for this wiki — gitignored, never commit.\nREMEMBER_ADMIN_TOKEN=${adminToken}\n`,
    );
  }
  await fs.writeFile(
    path.join(absTarget, 'package.json'),
    JSON.stringify(PACKAGE_TEMPLATE(basename), null, 2) + '\n',
  );

  // Seed exactly three purposeful documents. getting-started.md is the entry
  // point a human reads first. A `blank` template seeds only that one; the
  // `starter` default adds the agent + authoring guides.
  await fs.writeFile(path.join(absTarget, 'content', 'getting-started.md'), GETTING_STARTED_TEMPLATE);
  if (template === 'starter') {
    // The agent-onboarding doc is named remember.md — the conventional filename an
    // AI agent looks for (alongside CLAUDE.md / AGENTS.md) to learn how to use this wiki.
    await fs.writeFile(path.join(absTarget, 'content', 'remember.md'), AGENTS_TEMPLATE);
    await fs.writeFile(path.join(absTarget, 'content', 'authoring.md'), AUTHORING_TEMPLATE);
  }

  if (opts.quiet) return { adminToken };

  const lines = [
    ``,
    success(`Initialized remember wiki in ${c.bold(absTarget)}`),
    ``,
    header('Next steps'),
    `  ${c.dim('$')} cd ${targetDir}`,
    `  ${c.dim('$')} npm install`,
    `  ${c.dim('$')} npm run dev                 ${c.dim('# index + serve the agent API')}`,
    `  ${c.dim('$')} npm run search -- "…"       ${c.dim('# search from the terminal')}`,
    ``,
    `  ${c.dim('API')}  ${c.accent('http://localhost:4320')}   ${c.dim('search + agent endpoints')}`,
    ``,
    c.dim(`First run downloads a ~100 MB embedding model, then caches it — you'll`),
    c.dim(`see progress in the terminal.`),
  ];
  if (adminToken) {
    lines.push(
      ``,
      header('Admin token'),
      c.dim(`(saved to .env as REMEMBER_ADMIN_TOKEN — gitignored)`),
      `  ${c.yellow(adminToken)}`,
      ``,
      c.dim(`You only need it by hand for direct API writes (Authorization: Bearer`),
      c.dim(`<token>) or to bind on a non-loopback host for remote access.`),
    );
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
  return { adminToken };
}
