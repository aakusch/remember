import { describe, expect, it } from 'vitest';
import { createRemarkParser } from '../src/parsers/remark.js';
import { createSmartSplitChunker } from '../src/chunkers/smart-split.js';

const DOC = `---
title: Deploy runbook
---

# Deploy runbook

Deploys go out on Tuesday.

## Rollback

Run the rollback script.

### Emergency

Page the on-call engineer.
`;

describe('remark parser preserves document structure', () => {
  it('keeps heading markers so downstream stages can see them', () => {
    const { plain } = createRemarkParser().parse(DOC);
    expect(plain).toContain('# Deploy runbook');
    expect(plain).toContain('## Rollback');
    expect(plain).toContain('### Emergency');
  });

  it('separates blocks instead of running them together', () => {
    const { plain } = createRemarkParser().parse(DOC);
    // Without separators the text becomes "Deploy runbookDeploys go out..."
    expect(plain).not.toContain('runbookDeploys');
    expect(plain).toContain('Deploys go out on Tuesday.');
  });

  it('populates heading_path end to end through the real pipeline', () => {
    // The indexer wires exactly these two adapters together, and every chunk in
    // every built index had an empty heading_path, which silently disabled
    // applyHeadingBoost and stopped chunks splitting on heading boundaries.
    const parsed = createRemarkParser().parse(DOC);
    const chunks = createSmartSplitChunker().chunk(parsed);

    expect(chunks.length).toBeGreaterThan(0);
    const headingPaths = chunks.map((chunk) => chunk.heading_path);
    expect(headingPaths.some((p) => p.length > 0)).toBe(true);
    expect(headingPaths.flat()).toContain('Deploy runbook');
  });
});
