/**
 * Reject unrecognized `--flags`. The flag-driven commands (status/capabilities/
 * doctor) used to accept any flag silently (`argv.includes('--json')`), so a typo
 * like `--jsom` ran as if unflagged. Call this to fail loudly instead.
 */
export function assertKnownFlags(argv: string[], allowed: string[]): void {
  const ok = new Set(allowed);
  for (const a of argv) {
    if (a.startsWith('-') && !ok.has(a.split('=')[0]!)) {
      throw new Error(`unknown flag "${a}" (allowed: ${allowed.join(', ')})`);
    }
  }
}
