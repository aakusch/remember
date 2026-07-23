import { describe, expect, it } from 'vitest';
import {
  createEvidencePackage,
  estimateTokens,
  type EvidenceCandidate,
} from '../src/search/evidence.js';

describe('evidence package', () => {
  it('assigns stable unique citation IDs and serializes source signals', () => {
    const evidence = createEvidencePackage(
      { query: 'rollback', intent: 'production recovery' },
      [candidate('rollback.md', 'rollback.md#0'), candidate('deploy.md', 'deploy.md#0')],
      {
        tokenBudget: 100,
        corpusVersion: 'corpus-1',
      },
    );

    expect(evidence.passages.map((passage) => passage.citation_id)).toEqual([
      'S1',
      'S2',
    ]);
    expect(evidence.passages[0]).toEqual(
      expect.objectContaining({
        source_id: 'rollback.md',
        chunk_id: 'rollback.md#0',
        signals: {
          score: 1,
          retrievers: ['bm25'],
          retrieval_score: 0.8,
        },
      }),
    );
    expect(() => JSON.stringify(evidence)).not.toThrow();
  });

  it('keeps the highest-ranked passage and excludes lower-value passages at budget', () => {
    const first = candidate('first.md', 'first.md#0', 'a'.repeat(40));
    const second = candidate('second.md', 'second.md#0', 'b'.repeat(40));
    const evidence = createEvidencePackage('query', [first, second], {
      tokenBudget: 10,
    });

    expect(evidence.passages.map((passage) => passage.path)).toEqual(['first.md']);
    expect(evidence.estimatedTokens).toBeLessThanOrEqual(10);
    expect(evidence.passages[0]!.estimated_tokens).toBe(
      estimateTokens(evidence.passages[0]!.text),
    );
  });

  it('does not let adjacent candidates bypass the caller access boundary', () => {
    const evidence = createEvidencePackage(
      'query',
      [
        candidate('allowed.md', 'allowed.md#0'),
        candidate('allowed.md', 'allowed.md#1'),
        candidate('private.md', 'private.md#0'),
      ],
      {
        tokenBudget: 100,
        allowedChunkIds: ['allowed.md#0'],
      },
    );

    expect(evidence.passages.map((passage) => passage.chunk_id)).toEqual([
      'allowed.md#0',
    ]);
  });

  it('preserves visible conflicts and gaps only for selected evidence', () => {
    const evidence = createEvidencePackage(
      'query',
      [candidate('a.md', 'a.md#0'), candidate('b.md', 'b.md#0')],
      {
        tokenBudget: 100,
        conflicts: [
          {
            id: 'decision-conflict',
            chunkIds: ['a.md#0', 'b.md#0', 'not-selected.md#0'],
            description: 'The two runbooks recommend different recovery paths.',
          },
        ],
        gaps: ['  missing owner ', 'missing owner'],
      },
    );

    expect(evidence.conflicts).toEqual([
      {
        id: 'decision-conflict',
        passage_ids: ['S1', 'S2'],
        description: 'The two runbooks recommend different recovery paths.',
      },
    ]);
    expect(evidence.gaps).toEqual(['missing owner']);
  });
});

function candidate(
  filePath: string,
  chunkId: string,
  snippet = `Evidence from ${filePath}`,
): EvidenceCandidate {
  return {
    path: filePath,
    chunk_idx: 0,
    snippet,
    frontmatter: {},
    score: 1,
    retrievers: ['bm25'],
    chunk_id: chunkId,
    heading_path: ['Runbook'],
    retrievalScore: 0.8,
    access_scope: { scope_hash: 'scope-1' },
  };
}
