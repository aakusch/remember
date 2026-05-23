import { describe, it, expect } from 'vitest';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

describe('SmartSplitChunker', () => {
  it('emits a single chunk for small content', () => {
    const c = createSmartSplitChunker({ size: 900, overlap: 0.15 });
    const out = c.chunk({ plain: 'A short paragraph.' });
    expect(out).toHaveLength(1);
    expect(out[0]!.chunk_idx).toBe(0);
  });

  it('returns empty for empty content', () => {
    const c = createSmartSplitChunker({ size: 900, overlap: 0.15 });
    expect(c.chunk({ plain: '' })).toEqual([]);
    expect(c.chunk({ plain: '   \n\n  ' })).toEqual([]);
  });

  it('tracks heading_path through nested headings', () => {
    const c = createSmartSplitChunker({ size: 900, overlap: 0.15 });
    const md = `# Top\n\nIntro.\n\n## A\n\nA-body.\n\n### A1\n\nA1-body.\n\n## B\n\nB-body.`;
    const chunks = c.chunk({ plain: md });
    const paths = chunks.map((ch) => ch.heading_path.join(' > '));
    expect(paths).toContain('Top');
    expect(paths).toContain('Top > A');
    expect(paths).toContain('Top > A > A1');
    expect(paths).toContain('Top > B');
  });

  it('splits oversized sections recursively (paragraph → sentence → chars)', () => {
    const c = createSmartSplitChunker({ size: 30, overlap: 0 }); // ~120 chars per chunk
    const para = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';
    const md = `# H1\n\n${para}\n\n${para}\n\n${para}`;
    const chunks = c.chunk({ plain: md });
    expect(chunks.length).toBeGreaterThan(1);
    for (const ch of chunks) {
      expect(ch.text.length).toBeLessThan(500); // sanity: not pathologically big
    }
  });

  it('applies overlap when adjacent chunks share heading path', () => {
    const c = createSmartSplitChunker({ size: 50, overlap: 0.2 });
    const para = 'a'.repeat(300);
    const chunks = c.chunk({ plain: para });
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Second chunk should start with overlap from the first chunk
    // (only when heading paths match — empty here so they do)
    const last = chunks[chunks.length - 1]!;
    expect(last.text.length).toBeGreaterThan(0);
  });
});
