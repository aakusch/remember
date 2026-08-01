/**
 * `remember doctor` — a deterministic, no-LLM, no-network corpus-health sweep.
 *
 * It reads only data already in the index (plus one cheap pass over content/ for
 * on-disk / H1 checks) and reports documents that are unfindable, unstructured, or
 * duplicated — the problems that quietly wreck retrieval. Every check is
 * high-precision and embedding-independent, so the report is trustworthy regardless
 * of which embedder built the index. LLM-assisted remediation and doc scoring are a
 * Pro concern; this is the free flagging pass that funnels into it.
 */

export type DoctorSeverity = 'error' | 'warn' | 'info';

/** Per-page facts gathered from the index (see SqliteVecStore.collectDoctorFacts). */
export interface DoctorPageFact {
  path: string;
  title: string | null;
  /** frontmatter is `{}` / empty (no metadata at all). */
  frontmatterEmpty: boolean;
  /** chunk_count from the manifest. */
  chunkCount: number;
  /** content hash from the manifest (exact-duplicate detection). */
  sha256: string;
  /** chunks whose heading_path is non-empty. */
  headingChunks: number;
  /** total chunks in the chunks table for this page. */
  totalChunks: number;
  /** the chunk_idx 0 text, for thin-page detection. */
  firstChunkText: string;
}

/** One file found on disk during the content pass. */
export interface DoctorDiskFile {
  path: string;
  /** True when the file has a manifest row (was indexed). */
  indexed: boolean;
  /** The first `# H1` heading in the body, or null. */
  h1: string | null;
}

export interface DoctorFinding {
  check: string;
  severity: DoctorSeverity;
  path: string;
  detail?: string;
  hint: string;
}

export interface DoctorReport {
  version: number;
  checked_at: string;
  pages: number;
  findings: DoctorFinding[];
  summary: Record<DoctorSeverity, number>;
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * Pure health analysis. `checkedAt` is injected (never call Date.now here) so the
 * report is deterministic and testable.
 */
export function runDoctor(
  pages: DoctorPageFact[],
  disk: DoctorDiskFile[],
  checkedAt: string,
): DoctorReport {
  const findings: DoctorFinding[] = [];
  const byPath = new Map(pages.map((p) => [p.path, p]));

  // 1. On disk but not indexed — silently invisible to search.
  for (const f of disk) {
    if (!f.indexed) {
      findings.push({
        check: 'not-indexed',
        severity: 'error',
        path: f.path,
        hint: 'run `remember index` — or check .rememberignore / the file extension',
      });
    }
  }

  // 2. Unfindable — indexed but zero chunks, so search can never return it.
  for (const p of pages) {
    if (p.chunkCount === 0) {
      findings.push({
        check: 'unfindable',
        severity: 'error',
        path: p.path,
        detail: '0 chunks',
        hint: 'the file is empty or all-frontmatter — add body text',
      });
    }
  }

  // 3. Exact duplicate bodies (same content hash across pages).
  const bySha = new Map<string, string[]>();
  for (const p of pages) {
    if (p.chunkCount === 0) continue;
    const list = bySha.get(p.sha256) ?? [];
    list.push(p.path);
    bySha.set(p.sha256, list);
  }
  for (const [, paths] of bySha) {
    if (paths.length > 1) {
      const sorted = [...paths].sort();
      for (const path of sorted) {
        findings.push({
          check: 'duplicate-body',
          severity: 'error',
          path,
          detail: `identical to ${sorted.filter((x) => x !== path).join(', ')}`,
          hint: 'delete or differentiate the duplicates — they compete for the same queries',
        });
      }
    }
  }

  // 4. Duplicate titles (case/space-insensitive).
  const byTitle = new Map<string, string[]>();
  for (const p of pages) {
    if (!p.title) continue;
    const key = norm(p.title);
    const list = byTitle.get(key) ?? [];
    list.push(p.path);
    byTitle.set(key, list);
  }
  for (const [, paths] of byTitle) {
    if (paths.length > 1) {
      for (const path of [...paths].sort()) {
        findings.push({
          check: 'duplicate-title',
          severity: 'warn',
          path,
          detail: `title shared with ${paths.filter((x) => x !== path).sort().join(', ')}`,
          hint: 'give each page a distinct title so results are disambiguable',
        });
      }
    }
  }

  // 5 & 6. Structure: no headings captured, and the worse "wall of prose".
  for (const p of pages) {
    if (p.totalChunks > 0 && p.headingChunks === 0) {
      if (p.chunkCount >= 3) {
        findings.push({
          check: 'wall-of-prose',
          severity: 'warn',
          path: p.path,
          detail: `${p.chunkCount} chunks, no headings`,
          hint: 'add `##` section headings — long unstructured pages retrieve poorly',
        });
      } else {
        findings.push({
          check: 'no-structure',
          severity: 'warn',
          path: p.path,
          hint: 'add at least one `##` heading so sections are retrievable',
        });
      }
    }
  }

  // 7. Thin page — a single short chunk carries little signal.
  for (const p of pages) {
    if (p.chunkCount === 1 && p.firstChunkText.trim().length < 200) {
      findings.push({
        check: 'thin-page',
        severity: 'info',
        path: p.path,
        detail: `${p.firstChunkText.trim().length} chars of body`,
        hint: 'expand it, or merge into a richer page',
      });
    }
  }

  // 6. No frontmatter at all.
  for (const p of pages) {
    if (p.frontmatterEmpty && p.chunkCount > 0) {
      findings.push({
        check: 'no-frontmatter',
        severity: 'info',
        path: p.path,
        hint: 'add title/type/status/tags — stored, returned, and filterable by agents',
      });
    }
  }

  // 7. No H1 / title↔H1 mismatch (from the disk pass).
  for (const f of disk) {
    if (!f.indexed) continue;
    const page = byPath.get(f.path);
    if (!f.h1) {
      findings.push({
        check: 'no-h1',
        severity: 'info',
        path: f.path,
        hint: 'open the document with one `# H1` that names the thing',
      });
    } else if (page?.title && norm(page.title) !== norm(f.h1)) {
      findings.push({
        check: 'title-mismatch',
        severity: 'info',
        path: f.path,
        detail: `frontmatter "${page.title}" != H1 "${f.h1}"`,
        hint: 'align the frontmatter title with the H1 so results read consistently',
      });
    }
  }

  const summary: Record<DoctorSeverity, number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) summary[f.severity]++;

  return { version: 1, checked_at: checkedAt, pages: pages.length, findings, summary };
}

/** Parse a first-H1 out of raw markdown body (frontmatter already implicitly ignored). */
export function extractH1(raw: string): string | null {
  const body = raw.replace(/^---\n[\s\S]*?\n---\n/, '');
  const m = body.match(/^#\s+(.+)$/m);
  return m ? m[1]!.trim() : null;
}
