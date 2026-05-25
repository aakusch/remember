import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface StartViewerOptions {
  rootDir: string;
  host: string;
  port: number;
  apiUrl: string;
}

export interface ViewerHandle {
  url: string;
  child: ChildProcess;
  kill: () => void;
}

/**
 * Locate the `@useremember/viewer` package on disk. Looks first in the consumer
 * project's node_modules (the published-npm case), then walks up from this
 * package's own location to find the sibling workspace (the monorepo case).
 *
 * Returns null when neither is found so dev-cmd can degrade to API-only.
 */
function locateViewerPackage(rootDir: string): string | null {
  // 1. Consumer-project node_modules — npm/pnpm install case.
  try {
    const require_ = createRequire(path.join(rootDir, 'package.json'));
    const pkg = require_.resolve('@useremember/viewer/package.json');
    return path.dirname(pkg);
  } catch {
    /* fall through */
  }

  // 2. Sibling workspace — local monorepo case. Walk up from this file's URL.
  const here = path.dirname(fileURLToPath(import.meta.url));
  // dist/cli/start-viewer.js → packages/core/dist/cli → packages/core → packages/viewer
  let cursor = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.resolve(cursor, '..', 'viewer');
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(candidate, 'package.json'), 'utf8'));
        if (pkg.name === '@useremember/viewer') return candidate;
      } catch {
        /* keep walking */
      }
    }
    cursor = path.dirname(cursor);
  }

  return null;
}

/** Resolve the astro binary inside the viewer package. */
function locateAstroBin(viewerDir: string): string | null {
  const candidates = [
    path.join(viewerDir, 'node_modules', '.bin', 'astro'),
    path.join(viewerDir, '..', '..', 'node_modules', '.bin', 'astro'),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

/**
 * Spawn `astro dev` for the viewer alongside the API server. Returns a handle
 * with the viewer URL, the child process, and a kill function. Returns null
 * (with a console warning) when the viewer can't be located — callers should
 * continue with API-only operation in that case.
 */
export async function startViewer(opts: StartViewerOptions): Promise<ViewerHandle | null> {
  if (process.env.REMEMBER_NO_VIEWER === '1') {
    process.stdout.write('remember dev: REMEMBER_NO_VIEWER=1 — running API-only\n');
    return null;
  }

  const viewerDir = locateViewerPackage(opts.rootDir);
  if (!viewerDir) {
    process.stdout.write(
      'remember dev: @useremember/viewer not installed — running API-only. ' +
        'Run `npm install @useremember/viewer` to enable the browser UI.\n',
    );
    return null;
  }

  const astroBin = locateAstroBin(viewerDir);
  if (!astroBin) {
    process.stdout.write(
      `remember dev: astro binary not found inside ${viewerDir}/node_modules — running API-only\n`,
    );
    return null;
  }

  const child = spawn(
    astroBin,
    ['dev', '--host', opts.host, '--port', String(opts.port)],
    {
      cwd: viewerDir,
      env: {
        ...process.env,
        REMEMBER_API: opts.apiUrl,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  // Prefix astro's stdout/stderr so it doesn't visually fight the API banner.
  const prefix = (stream: NodeJS.WritableStream, tag: string) => (chunk: Buffer) => {
    const lines = chunk.toString('utf8').split('\n');
    for (const line of lines) {
      if (line.trim().length === 0) continue;
      stream.write(`  [viewer] ${tag === 'err' ? line : line}\n`);
    }
  };
  child.stdout?.on('data', prefix(process.stdout, 'out'));
  child.stderr?.on('data', prefix(process.stderr, 'err'));

  const url = `http://${opts.host === '0.0.0.0' ? '127.0.0.1' : opts.host}:${opts.port}`;
  return {
    url,
    child,
    kill: () => {
      if (!child.killed) child.kill('SIGTERM');
    },
  };
}
