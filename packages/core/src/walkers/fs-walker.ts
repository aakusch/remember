import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import ignore, { type Ignore } from 'ignore';
import type { Walker } from '../types.js';

export interface FsWalkerOptions {
  respectGitignore?: boolean;
  ignore?: string[];
  /**
   * Maximum file size (bytes) to read into memory during a walk. Files larger
   * than this are skipped (with a stderr warning) rather than buffered whole.
   * Why: unbounded `readFile` on a multi-GB file is a memory-DoS vector.
   * Default 5 MiB — generous for markdown, cheap to raise via config.
   */
  maxFileBytes?: number;
}

const DEFAULT_MAX_FILE_BYTES = 5 * 1024 * 1024;

const DEFAULT_IGNORES = [
  'node_modules',
  '.git',
  '.remember',
  'drafts/**',
  '_*/**',
  '*.tmp',
];

export function createFsWalker(opts: FsWalkerOptions = {}): Walker {
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  return {
    async *walk(root) {
      const absRoot = path.resolve(root);
      // Friendly message instead of a raw ENOENT scandir stack when content/ is missing.
      try {
        await fs.access(absRoot);
      } catch {
        throw new Error(
          `content directory not found: ${absRoot}. Create it (or fix \`content\` in remember.config.ts), then run \`remember index\`.`,
        );
      }
      const ig = await loadIgnore(absRoot, opts);

      for await (const entry of walkDir(absRoot, absRoot, ig, maxFileBytes)) {
        yield entry;
      }
    },
  };
}

async function loadIgnore(absRoot: string, opts: FsWalkerOptions): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);

  if (opts.ignore && opts.ignore.length > 0) {
    ig.add(opts.ignore);
  }

  if (opts.respectGitignore !== false) {
    const gitignorePath = path.join(absRoot, '.gitignore');
    const rememberignorePath = path.join(absRoot, '.rememberignore');
    for (const p of [gitignorePath, rememberignorePath]) {
      try {
        const text = await fs.readFile(p, 'utf8');
        ig.add(text);
      } catch {
        // file absent — fine
      }
    }
  }

  return ig;
}

async function* walkDir(
  absRoot: string,
  dir: string,
  ig: Ignore,
  maxFileBytes: number,
): AsyncGenerator<{ path: string; content: string; mtime: Date; sha256: string }> {
  const entries = await fs.readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    const rel = path.relative(absRoot, abs);
    const relPosix = rel.split(path.sep).join('/');

    if (!relPosix || ig.ignores(relPosix) || (entry.isDirectory() && ig.ignores(`${relPosix}/`))) {
      continue;
    }

    if (entry.isDirectory()) {
      yield* walkDir(absRoot, abs, ig, maxFileBytes);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      const stat = await fs.stat(abs);
      // Skip oversized files rather than buffering them whole (memory-DoS guard).
      if (stat.size > maxFileBytes) {
        process.stderr.write(
          `[remember] skipping ${relPosix}: ${stat.size} bytes exceeds maxFileBytes (${maxFileBytes})\n`,
        );
        continue;
      }
      const content = await fs.readFile(abs, 'utf8');
      yield {
        path: relPosix,
        content,
        mtime: stat.mtime,
        sha256: createHash('sha256').update(content).digest('hex'),
      };
    }
  }
}
