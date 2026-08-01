import os from 'node:os';
import path from 'node:path';

/**
 * Expand a leading `~` to the user's home directory.
 *
 * Tilde expansion is a *shell* feature — when a path is typed into an interactive
 * prompt (e.g. the setup wizard) rather than passed as a shell argument, the `~`
 * arrives literally and `path.resolve` would treat it as a real directory name
 * (creating an actual "~" folder). Expand it ourselves for any path that reaches
 * the filesystem from a prompt or a quoted argument.
 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2));
  return p;
}
