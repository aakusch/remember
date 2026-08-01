import path from 'node:path';
import { promises as fs } from 'node:fs';
import { assertKnownFlags } from '../flags.js';
import { loadConfig } from '../../config/load.js';
import { requireWiki } from '../require-wiki.js';
import { createSqliteVecStore } from '../../stores/sqlite-vec.js';
import { gatherDoctorReport } from '../../doctor/scan.js';
import type { DoctorReport, DoctorSeverity } from '../../doctor/doctor.js';
import { VERSION } from '../../version.js';
import { banner, header, success, c, plural } from '../format.js';

const SEVERITY_ORDER: DoctorSeverity[] = ['error', 'warn', 'info'];
const SEVERITY_COLOR: Record<DoctorSeverity, (s: string) => string> = {
  error: c.red,
  warn: c.yellow,
  info: c.dim,
};

/**
 * `remember doctor` — deterministic, no-LLM corpus-health sweep. Exits 0 unless
 * `--strict` is set and any error-severity finding exists (CI-friendly).
 */
export async function doctorCommand(args: string[] = []): Promise<void> {
  const asJson = args.includes('--json');
  const strict = args.includes('--strict');
  assertKnownFlags(args, ['--json', '--strict']);

  const cfg = await loadConfig(process.cwd());
  // Same wiki-detection + coded error as every other read command.
  await requireWiki(cfg);

  const contentRoot = path.resolve(cfg.rootDir, cfg.validated.content);
  const dbPath = path.join(cfg.rootDir, '.remember', 'index.db');
  try {
    await fs.access(dbPath);
  } catch {
    const msg = 'no index found — run `remember index` first';
    if (asJson) process.stderr.write(JSON.stringify({ error: { code: 'NO_INDEX', message: msg } }) + '\n');
    else process.stderr.write(`${c.red('remember doctor:')} ${msg}\n`);
    process.exit(1);
  }

  const store = await createSqliteVecStore({ path: dbPath });
  const report = await gatherDoctorReport(store, contentRoot, new Date().toISOString());
  store.close();

  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  } else {
    renderHuman(report);
  }

  if (strict && report.summary.error > 0) process.exit(1);
}

function renderHuman(report: DoctorReport): void {
  const out = process.stdout;
  out.write(`\n${banner(VERSION)}  ${c.dim('doctor')}\n`);
  out.write(
    header('corpus health') +
      '\n' +
      `  ${c.dim('pages')} ${report.pages}   ` +
      `${c.red(String(report.summary.error))} error · ` +
      `${c.yellow(String(report.summary.warn))} warn · ` +
      `${c.dim(String(report.summary.info) + ' info')}\n\n`,
  );

  if (report.findings.length === 0) {
    out.write(`${success('no problems found — the corpus is healthy')}\n\n`);
    return;
  }

  // Group by check, ordered by severity then check name.
  const byCheck = new Map<string, typeof report.findings>();
  for (const f of report.findings) {
    const list = byCheck.get(f.check) ?? [];
    list.push(f);
    byCheck.set(f.check, list);
  }
  const checks = [...byCheck.entries()].sort((a, b) => {
    const sa = SEVERITY_ORDER.indexOf(a[1][0]!.severity);
    const sb = SEVERITY_ORDER.indexOf(b[1][0]!.severity);
    return sa - sb || a[0].localeCompare(b[0]);
  });

  for (const [check, items] of checks) {
    const sev = items[0]!.severity;
    const paint = SEVERITY_COLOR[sev];
    out.write(`${paint(`● ${check}`)} ${c.dim(`(${plural(items.length, 'page')})`)}\n`);
    out.write(`  ${c.dim(items[0]!.hint)}\n`);
    for (const f of items.slice(0, 20)) {
      out.write(`    ${c.dim('-')} ${f.path}${f.detail ? c.dim(`  ${f.detail}`) : ''}\n`);
    }
    if (items.length > 20) out.write(`    ${c.dim(`… and ${items.length - 20} more`)}\n`);
    out.write('\n');
  }
}
