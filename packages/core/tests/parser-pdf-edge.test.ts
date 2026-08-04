import { describe, expect, it } from 'vitest';
import { createPdfDocumentParser } from '../src/parsers/pdf.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

// The native binding is optional; gate the tests that run it (the size-guard test
// below does NOT need it, since the guard trips before the binding is touched).
const bindingAvailable = await import('@firecrawl/pdf-inspector')
  .then(() => true)
  .catch(() => false);

// ── Minimal valid-PDF generators (correct xref) so the adversarial inputs are
// real files, not opaque fixtures. ──────────────────────────────────────────
function buildPdf(objs: string[]): Uint8Array {
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => (out += String(o).padStart(10, '0') + ' 00000 n \n'));
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}
function page(streamLines: string[]): Uint8Array {
  const stream = streamLines.join('\n');
  return buildPdf([
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [3 0 R] /Count 1 >>`,
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ]);
}
function manyPages(n: number): Uint8Array {
  const kids: string[] = [];
  const body: string[] = [];
  let obj = 3;
  const fontObj = 2 + 2 * n + 1;
  for (let i = 0; i < n; i++) {
    const pageIdx = obj++;
    const contentIdx = obj++;
    kids.push(`${pageIdx} 0 R`);
    const s = `BT /F1 18 Tf 72 720 Td (Section ${i + 1}) Tj ET\nBT /F1 12 Tf 72 690 Td (Body on page ${i + 1}.) Tj ET`;
    body.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 ${fontObj} 0 R >> >> /Contents ${contentIdx} 0 R >>`,
    );
    body.push(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
  }
  return buildPdf([
    `<< /Type /Catalog /Pages 2 0 R >>`,
    `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${n} >>`,
    ...body,
    `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>`,
  ]);
}

const parser = createPdfDocumentParser();
const chunker = createSmartSplitChunker({ size: 900, overlap: 0.15 });

describe.skipIf(!bindingAvailable)('PDF parser — adversarial inputs (real binding)', () => {
  it.each([
    ['non-PDF bytes', Buffer.from('this is plainly not a pdf at all')],
    ['truncated PDF', Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog', 'latin1')],
    ['zero bytes', Buffer.from([])],
    ['whitespace-only text', page(['BT /F1 12 Tf 72 720 Td (   ) Tj ET'])],
    ['empty content stream', page([])],
  ])('degrades %s to an empty page without throwing', async (_name, content) => {
    // The single most important guarantee: NOTHING a malformed/empty PDF can do
    // may throw (the indexer has no per-file recovery) — it must record an empty
    // page so the run continues.
    const parsed = await parser.parseDocument({ path: 'bad.pdf', content });
    expect(parsed.plain.trim()).toBe('');
    expect(chunker.chunk(parsed).length).toBe(0);
  });

  it('indexes a PDF with no visual headings (flat heading_path, body kept)', async () => {
    const parsed = await parser.parseDocument({
      path: 'flat.pdf',
      content: page([
        'BT /F1 12 Tf 72 720 Td (All text is one size here.) Tj ET',
        'BT /F1 12 Tf 72 700 Td (There is no heading at all.) Tj ET',
      ]),
    });
    const chunks = chunker.chunk(parsed);
    expect(chunks.length).toBeGreaterThan(0);
    expect(parsed.plain).toContain('no heading');
    // A headingless PDF legitimately yields an empty heading_path — the body is
    // still searchable, it simply has no breadcrumb.
    expect(chunks.every((c) => Array.isArray(c.heading_path))).toBe(true);
  });

  it('extracts literal markup as text (escaping is the viewer\'s responsibility)', async () => {
    // A PDF may legitimately contain "<script>" as visible text. The parser must
    // surface it verbatim; the viewer HTML-escapes extracted text before render
    // (asserted in the viewer suite), so this is not an injection here.
    const parsed = await parser.parseDocument({
      path: 'markup.pdf',
      content: page(['BT /F1 12 Tf 72 720 Td (a <script> tag as body text) Tj ET']),
    });
    expect(parsed.plain).toContain('<script>');
  });

  it('handles a 100-page PDF (stress) without error', async () => {
    const parsed = await parser.parseDocument({ path: 'big.pdf', content: manyPages(100) });
    const chunks = chunker.chunk(parsed);
    expect(chunks.length).toBeGreaterThan(50);
    expect(parsed.plain).toContain('Body on page 100.');
  });
});

describe('PDF parser — size guard (no binding needed)', () => {
  it('records an empty page for a PDF over maxBytes, before touching the parser', async () => {
    const guarded = createPdfDocumentParser({ maxBytes: 512 });
    // 4 KB of bytes — well over the 512-byte limit. The guard runs before the
    // native binding, so this holds even where the binding is not installed.
    const parsed = await guarded.parseDocument({
      path: 'oversized.pdf',
      content: new Uint8Array(4096),
    });
    expect(parsed.plain.trim()).toBe('');
  });
});
