import path from 'node:path';
import { promises as fs } from 'node:fs';

const CONFIG_TEMPLATE = `import { defineConfig, defaults } from '@remember/core';

export default defineConfig({
  name: 'My Knowledge Base',
  content: './content',

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

  schemaVersion: 1,
});
`;

const README_TEMPLATE = `---
title: Welcome
tags: [welcome, getting-started]
---

# Welcome to your wiki

This is the landing page of your \`remember\` wiki. Drop more markdown files into the \`content/\` folder and they'll be indexed automatically.

## How AI plugs in

\`\`\`bash
curl 'http://localhost:4320/v1/search?q=welcome&k=5'
\`\`\`

## Edit

Open any \`.md\` file in your editor of choice — your changes show up in search within ~1 second.
`;

const GITIGNORE_TEMPLATE = `.remember/
node_modules/
`;

const REMEMBERIGNORE_TEMPLATE = `# Patterns to skip when indexing.
# Lines starting with # are comments. Same syntax as .gitignore.
drafts/
_*/
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
  },
  dependencies: {
    '@remember/core': '*',
  },
});

export interface InitOptions {
  template?: 'minimal' | 'sample';
}

export async function init(targetDir: string, opts: InitOptions = {}): Promise<void> {
  if (!targetDir) {
    throw new Error('remember init: target directory is required.\nUsage: remember init <dir>');
  }
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

  await fs.mkdir(path.join(absTarget, 'content'), { recursive: true });
  await fs.writeFile(path.join(absTarget, 'content', 'README.md'), README_TEMPLATE);
  await fs.writeFile(path.join(absTarget, 'remember.config.ts'), CONFIG_TEMPLATE);
  await fs.writeFile(path.join(absTarget, '.gitignore'), GITIGNORE_TEMPLATE);
  await fs.writeFile(path.join(absTarget, '.rememberignore'), REMEMBERIGNORE_TEMPLATE);
  await fs.writeFile(
    path.join(absTarget, 'package.json'),
    JSON.stringify(PACKAGE_TEMPLATE(basename), null, 2) + '\n',
  );

  if (opts.template === 'sample') {
    await fs.mkdir(path.join(absTarget, 'content', 'examples'), { recursive: true });
    await fs.writeFile(
      path.join(absTarget, 'content', 'examples', 'first-page.md'),
      '---\ntitle: First page\n---\n\n# First page\n\nThis is a sample page.\n',
    );
  }

  process.stdout.write(
    `Initialized remember wiki in ${absTarget}\n\nNext steps:\n  cd ${targetDir}\n  pnpm install\n  pnpm dev   # or: npx remember dev\n`,
  );
}
