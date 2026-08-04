import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock the native binding so the classification branches (Scanned / ImageBased /
// Mixed / title recovery) can be exercised deterministically without fabricating
// real scanned PDFs. vi.hoisted lets the hoisted mock factory reference the spy.
const { processPdf } = vi.hoisted(() => ({ processPdf: vi.fn() }));
vi.mock('@firecrawl/pdf-inspector', () => ({ processPdf }));

import { createPdfDocumentParser } from '../src/parsers/pdf.js';

const parser = createPdfDocumentParser({ onNeedsOcr: 'silent' });
const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // "%PDF" — content is irrelevant to the mock

beforeEach(() => processPdf.mockReset());

describe('PDF parser — classification branches (mocked binding)', () => {
  it('records an empty page for a Scanned PDF without throwing', async () => {
    processPdf.mockReturnValue({
      pdfType: 'Scanned',
      markdown: '',
      pageCount: 3,
      pagesNeedingOcr: [1, 2, 3],
    });
    const parsed = await parser.parseDocument({ path: 'scan.pdf', content: bytes });
    expect(parsed.plain.trim()).toBe('');
  });

  it('records an empty page for an ImageBased PDF without throwing', async () => {
    processPdf.mockReturnValue({
      pdfType: 'ImageBased',
      markdown: '',
      pageCount: 1,
      pagesNeedingOcr: [1],
    });
    const parsed = await parser.parseDocument({ path: 'img.pdf', content: bytes });
    expect(parsed.plain.trim()).toBe('');
  });

  it('records an empty page when TextBased yields no markdown', async () => {
    processPdf.mockReturnValue({
      pdfType: 'TextBased',
      markdown: '   ',
      pageCount: 1,
      pagesNeedingOcr: [],
    });
    const parsed = await parser.parseDocument({ path: 'blank.pdf', content: bytes });
    expect(parsed.plain.trim()).toBe('');
  });

  it('indexes the text pages of a Mixed PDF', async () => {
    processPdf.mockReturnValue({
      pdfType: 'Mixed',
      markdown: '# Master Services Agreement\n\nThe parties agree as follows.',
      pageCount: 2,
      pagesNeedingOcr: [2],
    });
    const parsed = await parser.parseDocument({ path: 'msa.pdf', content: bytes });
    expect(parsed.plain).toContain('The parties agree as follows.');
    expect(parsed.plain).toContain('# Master Services Agreement');
  });

  it('injects a recovered title when the extracted markdown carries none', async () => {
    processPdf.mockReturnValue({
      pdfType: 'TextBased',
      markdown: 'Body text with no heading of its own.',
      pageCount: 1,
      pagesNeedingOcr: [],
      title: 'Q3 Financial Report',
    });
    const parsed = await parser.parseDocument({ path: 'q3.pdf', content: bytes });
    expect(parsed.frontmatter['title']).toBe('Q3 Financial Report');
  });

  it('sanitizes a recovered title (collapses whitespace, caps length)', async () => {
    processPdf.mockReturnValue({
      pdfType: 'TextBased',
      markdown: 'Body only, no heading.',
      pageCount: 1,
      pagesNeedingOcr: [],
      title: '  Multi\n  Line\treport  ' + 'x'.repeat(400),
    });
    const parsed = await parser.parseDocument({ path: 't.pdf', content: bytes });
    const title = parsed.frontmatter['title'] as string;
    expect(title).not.toMatch(/[\n\t]/);
    expect(title.length).toBeLessThanOrEqual(300);
    expect(title.startsWith('Multi Line report')).toBe(true);
  });

  it('warns but still indexes a PDF with font-encoding issues', async () => {
    const warnParser = createPdfDocumentParser(); // default onNeedsOcr: 'warn'
    processPdf.mockReturnValue({
      pdfType: 'TextBased',
      markdown: '# Doc\n\nPossibly garbled text.',
      pageCount: 1,
      pagesNeedingOcr: [],
      hasEncodingIssues: true,
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const parsed = await warnParser.parseDocument({ path: 'enc.pdf', content: bytes });
    // Still indexed (a real page, not degraded)…
    expect(parsed.plain).toContain('Possibly garbled text.');
    // …but the operator is told the text may be unreliable.
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('font-encoding issues'));
    spy.mockRestore();
  });

  it('does NOT warn about needsOcr pages when the markdown extracted fine', async () => {
    // Regression guard: pdf-inspector flags pages as needsOcr even on clean text
    // PDFs; the earlier code warned "N pages need OCR and were skipped" on every
    // normal PDF, which was both alarming and false.
    const warnParser = createPdfDocumentParser();
    processPdf.mockReturnValue({
      pdfType: 'Mixed',
      markdown: '# Report\n\nAll the text is here.',
      pageCount: 3,
      pagesNeedingOcr: [1, 2, 3],
    });
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await warnParser.parseDocument({ path: 'clean.pdf', content: bytes });
    const messages = spy.mock.calls.map((c) => String(c[0])).join('');
    expect(messages).not.toMatch(/need OCR/i);
    spy.mockRestore();
  });

  // The "binding throws → degrade to empty, never abort" path is covered against
  // the REAL engine in parser-pdf.test.ts (invalid bytes), which is the stronger
  // proof; the mocked equivalent is intentionally omitted.
});
