/**
 * Tiny, dependency-free terminal formatting toolkit for the remember CLI.
 *
 * No CLI framework, no color library — just hand-rolled ANSI wrapped in a
 * color-support gate. This is the OSS user experience, so the output has to
 * look good on a TTY and stay clean when piped.
 *
 * Color rules (checked once, at module load, from the real stdout):
 *   • NO_COLOR set (any value)         → no color   (https://no-color.org)
 *   • FORCE_COLOR set (non-"0")        → force color
 *   • stdout is not a TTY (piped/file) → no color
 *   • otherwise                        → color
 *
 * Callers should never emit raw escape codes; go through `c.*` so the gate
 * applies everywhere.
 */

function detectColor(): boolean {
  const env = process.env;
  if (env.NO_COLOR !== undefined) return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== '0') return true;
  return Boolean(process.stdout.isTTY);
}

export const COLOR_ENABLED = detectColor();

/** True when stdout is an interactive terminal (drives progress-line behaviour). */
export const IS_TTY = Boolean(process.stdout.isTTY);

function wrap(open: number, close: number): (s: string | number) => string {
  const prefix = `[${open}m`;
  const suffix = `[${close}m`;
  return (s) => (COLOR_ENABLED ? prefix + String(s) + suffix : String(s));
}

/** Restrained palette — one accent (cyan), plus semantic states + dim/bold. */
export const c = {
  reset: (s: string | number) => String(s),
  bold: wrap(1, 22),
  dim: wrap(2, 22),
  italic: wrap(3, 23),
  underline: wrap(4, 24),
  red: wrap(31, 39),
  green: wrap(32, 39),
  yellow: wrap(33, 39),
  blue: wrap(34, 39),
  magenta: wrap(35, 39),
  cyan: wrap(36, 39),
  gray: wrap(90, 39),
  /** Accent used for the product mark, headers, and links. */
  accent: wrap(36, 39),
};

/** Visible (escape-stripped) length, for column alignment. */
export function visibleLength(s: string): number {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\[[0-9;]*m/g, '').length;
}

/** Pad a possibly-colored string to `width` visible columns. */
export function padEndVisible(s: string, width: number): string {
  const len = visibleLength(s);
  return len >= width ? s : s + ' '.repeat(width - len);
}

/** A banner line: the product mark + version. */
export function banner(version: string): string {
  return `${c.accent(c.bold('remember'))} ${c.dim('v' + version)}`;
}

/** A section header — bold accent title with a dim rule under it. */
export function header(title: string): string {
  return `\n${c.bold(title)}`;
}

/** Green check success line. */
export function success(msg: string): string {
  return `${c.green('✓')} ${msg}`;
}

/** Red cross error line. */
export function errorLine(msg: string): string {
  return `${c.red('✗')} ${msg}`;
}

/** Yellow warning line. */
export function warn(msg: string): string {
  return `${c.yellow('!')} ${msg}`;
}

/**
 * Render aligned key/value rows. Keys are right-padded to the longest key so
 * values line up in a column. Keys are dimmed; values pass through as-is.
 */
export function keyValues(rows: Array<[string, string]>, indent = '  '): string {
  const keyWidth = rows.reduce((w, [k]) => Math.max(w, k.length), 0);
  return rows
    .map(([k, v]) => `${indent}${c.dim(padEndVisible(k, keyWidth))}  ${v}`)
    .join('\n');
}

/** A bulleted list item with the accent bullet. */
export function bullet(msg: string, indent = '  '): string {
  return `${indent}${c.accent('•')} ${msg}`;
}

/** Format a duration in ms as a compact human string. */
export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Pluralize `word` based on `n` (naive: append s). */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Format an ISO timestamp as a friendly relative + absolute string. */
export function fmtWhen(iso: string | undefined | null): string {
  if (!iso) return c.dim('(never)');
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return String(iso);
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  let rel: string;
  if (secs < 60) rel = `${secs}s ago`;
  else if (secs < 3600) rel = `${Math.round(secs / 60)}m ago`;
  else if (secs < 86400) rel = `${Math.round(secs / 3600)}h ago`;
  else rel = `${Math.round(secs / 86400)}d ago`;
  return `${new Date(then).toLocaleString()} ${c.dim(`(${rel})`)}`;
}
