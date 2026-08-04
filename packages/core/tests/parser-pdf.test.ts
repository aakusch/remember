import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPdfDocumentParser } from '../src/parsers/pdf.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures/runbook.pdf');

// The native binding is an OPTIONAL dependency. If it is not installed on this
// platform, skip the tests that actually run it rather than fail — the parser's
// missing-dependency contract is asserted separately below, without the binding.
const bindingAvailable = await import('@firecrawl/pdf-inspector')
  .then(() => true)
  .catch(() => false);

const parser = createPdfDocumentParser();

describe.skipIf(!bindingAvailable)('PDF parser — real binding', () => {
  it('declares .pdf as a binary extension', () => {
    expect(parser.extensions).toContain('.pdf');
    expect(parser.binaryExtensions).toContain('.pdf');
  });

  it('extracts a native-text PDF into a nested heading_path', async () => {
    // The whole point of routing PDF through the markdown pipeline: pdf-inspector's
    // font-ratio heading detection produces ATX markers the chunker matches, so a
    // PDF's visual heading hierarchy survives into heading_path — the pro engine's
    // structure-aware ranking depends on it.
    const bytes = await fs.readFile(FIXTURE);
    const parsed = await parser.parseDocument({ path: 'runbook.pdf', content: bytes });
    const chunks = createSmartSplitChunker({ size: 900, overlap: 0.15 }).chunk(parsed);
    const paths = chunks.map((c) => c.heading_path);

    expect(chunks.length).toBeGreaterThan(0);
    expect(paths.every((p) => p.length > 0)).toBe(true);
    expect(paths).toContainEqual(['Deployment Runbook']);
    // Depth 2 proves the hierarchy nests rather than flattening to one level.
    expect(paths).toContainEqual(['Deployment Runbook', 'Rollback Steps']);
    // Body prose survives intact.
    expect(parsed.plain).toContain('roll back production');
  });

  it('degrades a non-text / corrupt PDF to an empty page instead of throwing', async () => {
    // CRITICAL: the pro indexer has no per-file error recovery, so a throw here
    // would abort the entire index run. Scanned and corrupt PDFs are common, so
    // this MUST resolve to an empty (recorded) page, never reject.
    const parsed = await parser.parseDocument({
      path: 'scanned.pdf',
      content: new Uint8Array([1, 2, 3, 4, 5]),
    });
    expect(parsed.plain.trim()).toBe('');
    // And chunking an empty doc yields nothing rather than erroring.
    const chunks = createSmartSplitChunker({ size: 900, overlap: 0.15 }).chunk(parsed);
    expect(chunks.length).toBe(0);
  });
});

describe('PDF parser — contract (no binding needed)', () => {
  it('rejects string content instead of indexing mojibake', async () => {
    // A .pdf utf8-decoded is unrecoverable bytes; this is a wiring bug (missing
    // from binaryExtensions) and must fail loudly, not index garbage.
    await expect(
      parser.parseDocument({ path: 'x.pdf', content: 'not really bytes' }),
    ).rejects.toThrow(/must be delivered as bytes|binaryExtensions/);
  });

  it('gives an actionable error contract when the binding cannot be loaded', async () => {
    // The absent-optional-dependency branch names the package, the install
    // command, and the config escape hatch. Asserted at the source since the
    // package is installed in this workspace and the branch cannot be reached.
    const src = await fs.readFile(path.join(HERE, '../src/parsers/pdf.ts'), 'utf8');
    expect(src).toContain('requires the optional dependency "@firecrawl/pdf-inspector"');
    expect(src).toContain('npm install @firecrawl/pdf-inspector');
    expect(src).toContain('index.formats');
  });

  it('leaves other formats working when pdf is not enabled', async () => {
    // The pdf parser's lazy binding import must be scoped to .pdf files: the
    // router only builds it when the format is enabled, and never invokes it for
    // other extensions. (This engine has no html format — that is pro-only — so
    // the non-pdf companion here is markdown plus an anydoc format.)
    const { createFormatRouter } = await import('../src/parsers/format-router.js');
    const router = createFormatRouter({ formats: ['md', 'rtf'] });
    const md = await router.parser.parseDocument({ path: 'a.md', content: '# ok' });
    expect(md.plain).toContain('# ok');
    expect(router.extensions).not.toContain('.pdf');
  });

  it('is registered in the format router', async () => {
    const { createFormatRouter, SUPPORTED_FORMATS } = await import(
      '../src/parsers/format-router.js'
    );
    expect(SUPPORTED_FORMATS).toContain('pdf');
    const router = createFormatRouter({ formats: ['pdf'] });
    expect(router.extensions).toContain('.pdf');
    expect(router.binaryExtensions).toContain('.pdf');
  });
});
