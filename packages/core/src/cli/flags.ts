/** A bad-invocation error (unknown flag, missing/invalid argument). Carries a
 *  stable `code: 'USAGE'` so `--json` consumers get a real code instead of the
 *  blanket `COMMAND_ERROR` — the `{ code }` contract `remember help agents` implies. */
export class UsageError extends Error {
  code = 'USAGE' as const;
}

/**
 * Reject unrecognized `--flags`. The flag-driven commands (status/capabilities/
 * doctor) used to accept any flag silently (`argv.includes('--json')`), so a typo
 * like `--jsom` ran as if unflagged. Call this to fail loudly instead.
 */
export function assertKnownFlags(argv: string[], allowed: string[]): void {
  const ok = new Set(allowed);
  for (const a of argv) {
    if (a.startsWith('-') && !ok.has(a.split('=')[0]!)) {
      throw new UsageError(`unknown flag "${a}" (allowed: ${allowed.join(', ')})`);
    }
  }
}
