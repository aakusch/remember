import path from 'node:path';
import { promises as fs } from 'node:fs';
import crypto from 'node:crypto';

/**
 * Generate a cryptographically-strong admin token, encoded as URL-safe base64
 * without padding. ~32 bytes of entropy.
 */
function generateAdminToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

const CONFIG_TEMPLATE = (opts: { adminToken: string | null }) => {
  const tokenLine = opts.adminToken
    ? `    // Generated at init. Required to bind to non-loopback hosts and to use\n    // any write/admin endpoint from a remote machine. Keep it secret.\n    adminToken: process.env.REMEMBER_ADMIN_TOKEN ?? '${opts.adminToken}',\n`
    : `    // adminToken: process.env.REMEMBER_ADMIN_TOKEN, // required for non-loopback binds\n`;
  return `import { defineConfig, defaults } from '@useremember/core';

export default defineConfig({
  name: 'My Knowledge Base',
  description: 'A local-first AI-ready wiki',

  content: './content',

  server: {
    host: '127.0.0.1',
    apiPort: 4320,
    port: 4321,
${tokenLine}  },

  pipeline: {
    walker: defaults.walker.chokidar({ respectGitignore: true }),
    parser: defaults.parser.remark(),
    chunker: defaults.chunker.smartSplit({ size: 900, overlap: 0.15 }),
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

  // ─── Connectors ─────────────────────────────────────────────────────────
  // Uncomment and configure to pull external content into your wiki.
  // Synced files land in content/external/<name>/ and flow through the same
  // indexing pipeline as your hand-written pages.
  //
  // connectors: [
  //   defaults.connector.obsidian({
  //     name: 'obsidian',
  //     vaultPath: '/path/to/your/Obsidian Vault',
  //     transformWikilinks: true,
  //     tag: 'obsidian',
  //   }),
  //   defaults.connector.granola({
  //     name: 'granola',
  //     apiUrl: process.env.GRANOLA_API_URL,
  //     apiKey: process.env.GRANOLA_API_KEY,
  //     tag: 'meeting',
  //   }),
  // ],

  schemaVersion: 1,
});
`;
};

const README_TEMPLATE = `---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to your wiki

This is your wiki's landing page. It renders at \`/\` because of the \`viewer.landing\` setting in \`remember.config.ts\`.

## What can I do?

- **Edit any page** in your editor of choice (VS Code, Cursor, Obsidian, vim). Save → reindex → searchable in <1 second.
- **Or edit in the browser** — click ✎ Edit on any page. Markdown source + live preview side-by-side. Type \`/\` at line start for the command palette.
- **Search** the wiki via the search bar above, or \`/search\`, or [GET /v1/search](http://localhost:4320/v1/search?q=welcome).
- **Plug in your AI** via [GET /v1/tools](http://localhost:4320/v1/tools) — drop the Anthropic/OpenAI-shaped tool defs into any LLM tool-use call.

## What's where?

| | |
|---|---|
| **Landing** | This page — change in \`remember.config.ts\` via \`viewer.landing\` |
| **Getting started** | [getting-started](./getting-started.md) — a 2-minute tour |
| **Frontmatter example** | [examples/with-frontmatter](./examples/with-frontmatter.md) — sortable in the table view |
| **Admin** | [/admin](http://localhost:4321/admin) — setup, files, reindex, settings, table view, connectors |
| **Setup wizard** | [/admin/setup](http://localhost:4321/admin/setup) — first-run guided config |

## Next steps

- Add your own pages to \`content/\`
- Open [/admin/setup](http://localhost:4321/admin/setup) to walk through configuration
- Skim [getting-started](./getting-started.md) for the full feature tour
- Configure connectors (Obsidian, Granola, any folder) in \`remember.config.ts\` to pull external content into the index
`;

const GETTING_STARTED_TEMPLATE = `---
title: Getting started
tags: [getting-started, onboarding]
---

# Getting started

A two-minute tour of your new wiki.

## Add a page

Drop any \`.md\` file in \`content/\` and it's automatically indexed:

\`\`\`bash
echo "# My new page\\n\\nContent here." > content/my-page.md
\`\`\`

The file watcher catches the new file, runs it through the indexing pipeline (parse → chunk → embed → store), and it's searchable within ~1 second. The viewer auto-refreshes via Server-Sent Events.

## Frontmatter

Any markdown frontmatter you set is indexed and searchable:

\`\`\`markdown
---
title: Deploy runbook
tags: [runbook, ops]
owner: platform
severity: high
status: tested
---
\`\`\`

This unlocks two things:

1. **Tag pills** render in the page header automatically.
2. **Table view** (\`/admin/views\`) lets you filter and sort by any frontmatter key.

## Search

Three patterns:

1. **Browser** — search bar at top of every page, or visit [/search](/search)
2. **HTTP** — \`curl 'http://localhost:4320/v1/search?q=...'\`
3. **AI tool definitions** — \`curl http://localhost:4320/v1/tools\` returns Anthropic/OpenAI tool defs ready to drop in

## Edit in the browser

Click ✎ Edit on any page. The browser editor has:

- Side-by-side markdown source + live preview
- Slash command palette (type \`/\` at line start) — \`/h1\`, \`/code\`, \`/table\`, \`/mermaid\`, and 16 more
- Save with \`Cmd/Ctrl+S\` or the Save button
- File is written to disk + reindexed immediately
- Git stays hands-off — commit when you're satisfied

## Connectors

Pull external content into your wiki. Configure in \`remember.config.ts\` (commented example included). Three connectors out of the box:

- **Obsidian** — point at a vault, wikilinks get rewritten, files land in \`content/external/obsidian/\`
- **Granola** — pull meeting summaries via HTTP API or your own \`fetchMeetings\` callback
- **Filesystem** — generic markdown-folder sync from anywhere

Manage them at [/admin/connectors](http://localhost:4321/admin/connectors).

## Commit when ready

Your wiki is just markdown files in a git repo. \`remember\` doesn't touch git on your behalf. Edit, organize, restructure — then run \`git add\` and \`git commit\` when you're satisfied.

## Further reading

- [examples/with-frontmatter](./examples/with-frontmatter.md) — frontmatter that drives the table view
- [Setup wizard](http://localhost:4321/admin/setup) — the in-browser config tour
`;

const EXAMPLE_FRONTMATTER_TEMPLATE = `---
title: Frontmatter example
tags: [example, reference]
owner: you
status: stable
priority: medium
---

# Frontmatter example

This page demonstrates how frontmatter drives the table view.

## What you wrote

\`\`\`yaml
title: Frontmatter example
tags: [example, reference]
owner: you
status: stable
priority: medium
\`\`\`

## What it does

- \`title\` becomes the page title in the browser, the sidebar, and the table view
- \`tags\` render as pills in the header AND become a filterable array
- \`owner\`, \`status\`, \`priority\` — any field you add is queryable

## Try the table view

Visit [/admin/views](http://localhost:4321/admin/views?columns=path,title,tags,owner,status). All your pages with all their frontmatter, sortable and filterable.

Try these queries:

- \`?filter[tags]=example\` — pages tagged \`example\` (array membership)
- \`?filter[owner]=you\` — pages you own
- \`?sort=-priority\` — by priority descending
- \`?filter[status]=stable&sort=title\` — stable pages alphabetically

Build your own taxonomy. Define what fields matter for your team and use them across the corpus.
`;

const GITIGNORE_TEMPLATE = `.remember/
node_modules/
*.bak.*
.DS_Store
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
  },
  dependencies: {
    '@useremember/core': '*',
    '@useremember/viewer': '*',
  },
});

const ENV_EXAMPLE_TEMPLATE = `# Copy to .env and fill in if you want to override defaults.
# All optional — \`remember\` runs entirely locally without any of these.

# REMEMBER_HOST=127.0.0.1
# REMEMBER_API_PORT=4320
# REMEMBER_PORT=4321

# Required if you bind to a non-loopback host (e.g. 0.0.0.0 for remote access).
# Also gates remote reads when set.
# REMEMBER_ADMIN_TOKEN=$(openssl rand -hex 32)

# Optional: switches the embedder to OpenAI for higher-quality embeddings.
# OPENAI_API_KEY=sk-...

# Optional: configure a Granola connector (see remember.config.ts).
# GRANOLA_API_URL=https://your-granola-bridge.example.com/meetings
# GRANOLA_API_KEY=...
`;

export interface InitOptions {
  template?: 'minimal' | 'starter';
  noToken?: boolean;
}

export async function init(targetDir: string, opts: InitOptions = {}): Promise<void> {
  if (!targetDir) {
    throw new Error('remember init: target directory is required.\nUsage: remember init <dir>');
  }
  const template = opts.template ?? 'starter';
  const absTarget = path.resolve(process.cwd(), targetDir);
  const basename = path.basename(absTarget);

  try {
    const entries = await fs.readdir(absTarget);
    if (entries.length > 0) {
      throw new Error(`remember init: ${absTarget} exists and is not empty. Choose an empty directory.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  const adminToken = opts.noToken ? null : generateAdminToken();

  await fs.mkdir(path.join(absTarget, 'content'), { recursive: true });
  await fs.writeFile(path.join(absTarget, 'content', 'README.md'), README_TEMPLATE);
  await fs.writeFile(path.join(absTarget, 'remember.config.ts'), CONFIG_TEMPLATE({ adminToken }));
  await fs.writeFile(path.join(absTarget, '.gitignore'), GITIGNORE_TEMPLATE);
  await fs.writeFile(path.join(absTarget, '.rememberignore'), REMEMBERIGNORE_TEMPLATE);
  await fs.writeFile(path.join(absTarget, '.env.example'), ENV_EXAMPLE_TEMPLATE);
  await fs.writeFile(
    path.join(absTarget, 'package.json'),
    JSON.stringify(PACKAGE_TEMPLATE(basename), null, 2) + '\n',
  );

  if (template === 'starter') {
    await fs.writeFile(path.join(absTarget, 'content', 'getting-started.md'), GETTING_STARTED_TEMPLATE);
    await fs.mkdir(path.join(absTarget, 'content', 'examples'), { recursive: true });
    await fs.writeFile(
      path.join(absTarget, 'content', 'examples', 'with-frontmatter.md'),
      EXAMPLE_FRONTMATTER_TEMPLATE,
    );
  }

  const lines = [
    ``,
    `✓ Initialized remember wiki in ${absTarget}`,
    ``,
    `Next steps:`,
    `  cd ${targetDir}`,
    `  pnpm install            # or: npm install`,
    `  pnpm dev                # or: npx @useremember/core dev`,
    ``,
    `Then open http://localhost:4321 — the in-browser setup wizard walks you through configuration.`,
  ];
  if (adminToken) {
    lines.push(
      ``,
      `Admin token (also written to remember.config.ts):`,
      `  ${adminToken}`,
      ``,
      `Use it as the REMEMBER_ADMIN_TOKEN env var, or paste it into the Admin UI when prompted.`,
      `Required to bind to a non-loopback host or to write/edit from a remote machine.`,
    );
  }
  lines.push('');
  process.stdout.write(lines.join('\n'));
}
