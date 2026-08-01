import { describe, it, expect } from 'vitest';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

// Integration guard: the chunker detects section boundaries + builds heading_path
// by matching heading markers on the parser's flattened `plain`. The parser used to
// strip the markers, so every chunk got an empty heading_path (and `#` comments
// inside fenced code were the ONLY lines that looked like headings). This feeds the
// REAL parser output — not hand-written `#` markdown — so a regression is caught.
function headingPaths(md: string): string[][] {
  const parsed = createRemarkParser().parse(md);
  const chunks = createSmartSplitChunker({ size: 435, overlap: 0.15 }).chunk({
    plain: parsed.plain,
    ast: parsed.ast,
  });
  return chunks.map((ch) => ch.heading_path);
}

describe('parser → chunker heading_path integration', () => {
  it('populates heading_path from real (nested) headings', () => {
    const md = '# Deploy runbook\n\n## Rollback\n\nRoll it back.\n\n## Restore\n\nRestore it.';
    const paths = headingPaths(md);
    expect(paths).toContainEqual(['Deploy runbook', 'Rollback']);
    expect(paths).toContainEqual(['Deploy runbook', 'Restore']);
  });

  it('does NOT treat a `#` comment inside fenced code as a heading', () => {
    const md = '# Real heading\n\n```bash\n# not a heading\necho hi\n```\n\nProse after.';
    const paths = headingPaths(md);
    for (const p of paths) {
      expect(p[0]).toBe('Real heading');
      expect(p).not.toContain('not a heading');
    }
  });

  it('leaves heading_path empty for a doc with no headings', () => {
    const paths = headingPaths('Just a paragraph of text with no headings at all.');
    expect(paths.every((p) => p.length === 0)).toBe(true);
  });
});
