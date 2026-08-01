import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runDoctor, extractH1, type DoctorDiskFile, type DoctorPageFact, type DoctorReport } from './doctor.js';

/** The only store capability doctor needs — kept minimal so it's easy to test. */
interface DoctorStore {
  collectDoctorFacts(): DoctorPageFact[];
}

const MD_EXT = /\.(md|mdx|markdown|mdown)$/i;
// Best-effort mirror of the default .rememberignore + always-skip dirs, so the
// not-indexed check doesn't flag deliberately-excluded files as problems.
const SKIP_DIR = (name: string): boolean =>
  name === '.remember' ||
  name === 'node_modules' ||
  name === '.git' ||
  name === 'drafts' ||
  name.startsWith('.') ||
  name.startsWith('_');

async function walkMarkdown(contentRoot: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!SKIP_DIR(e.name)) await walk(path.join(dir, e.name));
      } else if (e.isFile() && MD_EXT.test(e.name)) {
        out.push(path.relative(contentRoot, path.join(dir, e.name)).split(path.sep).join('/'));
      }
    }
  };
  await walk(contentRoot);
  return out;
}

/**
 * Gather a full doctor report: per-page facts from the index + a cheap pass over
 * content/ for on-disk presence and H1s. `checkedAt` is injected for determinism.
 */
export async function gatherDoctorReport(
  store: DoctorStore,
  contentRoot: string,
  checkedAt: string,
): Promise<DoctorReport> {
  const facts = store.collectDoctorFacts();
  const indexed = new Set(facts.map((f) => f.path));

  const diskPaths = await walkMarkdown(contentRoot);
  const disk: DoctorDiskFile[] = [];
  for (const rel of diskPaths) {
    const isIndexed = indexed.has(rel);
    let h1: string | null = null;
    if (isIndexed) {
      try {
        h1 = extractH1(await fs.readFile(path.join(contentRoot, rel), 'utf8'));
      } catch {
        h1 = null;
      }
    }
    disk.push({ path: rel, indexed: isIndexed, h1 });
  }

  return runDoctor(facts, disk, checkedAt);
}
